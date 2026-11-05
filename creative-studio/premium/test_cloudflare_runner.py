"""Offline tests: no inference, Cloudflare tokens, requests, or billed usage."""
import base64
from io import BytesIO
import unittest
from unittest.mock import patch

from PIL import Image
from cloudflare_runner import MODEL,ProviderUnavailable,decode_response,generate_scene,reference_png,source_photo,produce

def scene_b64():
    image=Image.new("RGB",(900,1125),(36,20,78))
    out=BytesIO()
    image.save(out,format="PNG")
    return base64.b64encode(out.getvalue()).decode()

def preview():
    return {"preview_id":"4f4425e1-2c3a-4d5f-b678-3a4c2fe948df",
            "variant":1,"prompt":"NO writing, lettering, logos, buttons. Premium studio photography with purple gradients and tasteful soft lime accents.",
            "product_name":"Máquina de ajo eléctrica","publication_locked":True}

class MockResponse:
    def __init__(self,status=200,payload=None):
        self.status_code=status
        self.content=b"encoded-placeholder"
        self.payload=payload or {"success":True,"result":{"image":scene_b64()}}
    def json(self):return self.payload
    def __enter__(self):return self
    def __exit__(self,*args):pass

class ModelTests(unittest.TestCase):
    def setUp(self):
        self.source=Image.new("RGB",(820,900),(230,120,180))
    def test_reference_meets_strict_size(self):
        data=reference_png(self.source)
        with Image.open(BytesIO(data)) as ref:
            self.assertLess(ref.width,512)
            self.assertLess(ref.height,512)
    def test_response_decode(self):
        scene=decode_response({"success":True,"result":{"image":scene_b64()}})
        self.assertEqual(scene.size,(900,1125))
    def test_fail_closed_on_invalid_model_response(self):
        for bad in ({},{"success":False,"result":{"image":scene_b64()}},
                    {"success":True,"result":{"image":"?"}}):
            with self.subTest(bad=bad):
                with self.assertRaises((ProviderUnavailable,ValueError)):
                    decode_response(bad)
    def test_reference_included_in_multipart_with_fixed_free_model(self):
        observed={}
        class FakeSession:
            def post(self,url,**kwargs):
                observed["url"]=url
                observed["kwargs"]=kwargs
                return MockResponse()
        generated=generate_scene(preview(),self.source,"a"*32,"fake-token",session=FakeSession())
        self.assertEqual(generated.size,(900,1125))
        self.assertIn("/ai/run/"+MODEL,observed["url"])
        self.assertIn("input_image_0",observed["kwargs"]["files"])
        self.assertIn("prompt",observed["kwargs"]["files"])
        self.assertEqual(observed["kwargs"]["files"]["width"],(None,"1024"))
        self.assertEqual(observed["kwargs"]["files"]["height"],(None,"1280"))
        self.assertNotIn("data",observed["kwargs"])
        self.assertEqual(observed["kwargs"]["headers"]["Authorization"],"Bearer fake-token")
        self.assertFalse(observed["kwargs"]["allow_redirects"])
    def test_402_quota_failure_no_fake_image(self):
        class Deny:
            def post(self,*args,**kwargs):return MockResponse(status=429)
        with self.assertRaises(ProviderUnavailable):
            generate_scene(preview(),self.source,"a"*32,"fake-token",session=Deny())
    def test_reject_unverified_or_wrong_token_before_network(self):
        class Forbidden:
            def post(self,*args,**kwargs):self.fail("MUST NOT make request")
        with self.assertRaises(ProviderUnavailable):
            generate_scene(preview(),self.source,"invalid","fake",session=Forbidden())
    def test_not_authorized_to_generate_for_unlocked_job(self):
        p=preview()
        p["publication_locked"]=False
        class Forbidden:
            def post(self,*args,**kwargs):self.fail("MUST NOT make request")
        with self.assertRaises(ValueError):
            generate_scene(p,self.source,"a"*32,"fake",session=Forbidden())

class UniversalReferenceTests(unittest.TestCase):
    def test_no_image_does_not_fetch_any_external_url(self):
        class Forbidden:
            def get(self,*args,**kwargs): self.fail("Should not fetch a missing source")
        self.assertIsNone(source_photo(None,session=Forbidden()))
        self.assertIsNone(source_photo("http://evil.example/test.jpg",session=Forbidden()))
        self.assertIsNone(source_photo("https://private.example/test.jpg",session=Forbidden()))

    def test_text_only_creative_has_no_fake_reference_upload(self):
        observed={}
        class Session:
            def post(self,url,**kwargs):
                observed["request"]=kwargs
                return MockResponse()
        scene=generate_scene(preview(),None,"a"*32,"test",session=Session())
        self.assertEqual(scene.size,(900,1125))
        self.assertIn("files",observed["request"])
        self.assertNotIn("input_image_0",observed["request"]["files"])
        self.assertIn("CONCEPTUAL",observed["request"]["files"]["prompt"][1])
        self.assertIn("BOTTOM 82%",observed["request"]["files"]["prompt"][1])
        self.assertNotIn("data",observed["request"])

    def test_produce_marks_no_source_as_conceptual(self):
        p=preview()
        p.update({"processed":True,"original_url":None,"price":None})
        with patch("cloudflare_runner.generate_scene",return_value=Image.new("RGB",(900,1125),(34,20,65))):
            data,mode=produce(p,"a"*32,"test")
        self.assertEqual(mode,"conceptual")
        self.assertTrue(data.startswith(bytes([255,216,255])))

if __name__=="__main__":unittest.main()

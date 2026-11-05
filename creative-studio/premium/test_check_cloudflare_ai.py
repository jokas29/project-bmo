import io
import json
import unittest
from urllib.error import HTTPError,URLError
from check_cloudflare_ai import check,model_available,MODEL

ACCOUNT="fa82c2264e732300804405da89b49da1"
class Response:
    def __init__(self,payload,status=200):
        self.data=json.dumps(payload).encode();self.status=status
    def __enter__(self):return self
    def __exit__(self,*a):return False
    def read(self,n):return self.data[:n]

class PreflightTests(unittest.TestCase):
    def test_list_model_is_ready(self):
        self.assertTrue(model_available({"success":True,"result":[{"id":MODEL}]}).ready)
    def test_unexpected_response_must_skip(self):
        for payload in [{"success":False,"result":[{"id":MODEL}]},{"success":True,"result":[]},[],{}]:
            with self.subTest(payload=payload):
                self.assertFalse(model_available(payload).ready)
    def test_missing_token_or_id_never_calls_api(self):
        def forbidden(*a,**k):self.fail("Should not access network")
        self.assertFalse(check(ACCOUNT,"",opener=forbidden).ready)
        self.assertFalse(check("bad","fake",opener=forbidden).ready)
    def test_no_inference_in_preflight(self):
        visited={}
        def fake(request,timeout):
            visited["url"]=request.full_url
            visited["method"]=request.get_method()
            return Response({"success":True,"result":[{"id":MODEL}]})
        self.assertTrue(check(ACCOUNT,"placeholder-token",opener=fake).ready)
        self.assertIn("/ai/models/search?",visited["url"])
        self.assertNotIn("/ai/run/",visited["url"])
        self.assertEqual("GET",visited["method"])
    def test_402_403_404_429_all_skip_safely(self):
        for status in (401,402,403,404,429,503):
            def fake(req,timeout):raise HTTPError(req.full_url,status,"error",{},io.BytesIO())
            with self.subTest(status=status):
                self.assertFalse(check(ACCOUNT,"test",opener=fake).ready)
    def test_offline_safely_skips(self):
        def offline(req,timeout):raise URLError("offline")
        self.assertFalse(check(ACCOUNT,"test",opener=offline).ready)

if __name__=="__main__":unittest.main()

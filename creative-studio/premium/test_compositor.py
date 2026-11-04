import unittest
from PIL import Image
from compositor import build_poster, jpeg_bytes, source_quality, fit_lines

class PremiumCompositorTests(unittest.TestCase):
    def setUp(self):
        self.scene=Image.new("RGB",(900,1125),(40,10,90))
        self.product=Image.new("RGB",(800,800),(235,35,20))

    def test_exact_dimensions_and_private_jpeg(self):
        poster=build_poster(self.scene,self.product,"Máquina de ajo eléctrica",25.00,1)
        self.assertEqual(poster.size,(1080,1350))
        data=jpeg_bytes(poster)
        self.assertTrue(data[:3]==bytes([255,216,255]))
        self.assertGreater(len(data),15000)

    def test_authentic_product_pixels_are_in_front_of_ai_scene(self):
        poster=build_poster(self.scene,self.product,"Máquina de ajo eléctrica",25.00,2)
        red,green,blue=poster.getpixel((540,800))
        self.assertGreater(red,180)
        self.assertLess(green,80)
        self.assertLess(blue,80)

    def test_refuses_220px_source_from_current_catalogue(self):
        with self.assertRaisesRegex(ValueError,"source resolution too small"):
            source_quality(Image.new("RGB",(220,220),"white"))

    def test_no_silent_fake_price_or_variant(self):
        for price in [float("nan"),-1,0]:
            with self.assertRaises(ValueError):
                build_poster(self.scene,self.product,"Producto",price,1)
        with self.assertRaises(ValueError):
            build_poster(self.scene,self.product,"Producto",25,4)

    def test_long_titles_fail_without_clipping(self):
        with self.assertRaisesRegex(ValueError,"too long"):
            build_poster(self.scene,self.product,"PalabraSinEspacios"*25,25,1)

if __name__=="__main__":
    unittest.main()

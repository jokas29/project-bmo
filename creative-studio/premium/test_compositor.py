import unittest
from PIL import Image, ImageOps
from compositor import W,H,HERO_TOP,HERO_BOTTOM,build_poster,jpeg_bytes,source_quality

class UniversalPremiumCompositorTests(unittest.TestCase):
    def setUp(self):
        self.scene=Image.new("RGB",(1080,1350),(31,42,73))
        self.product=Image.new("RGB",(800,800),(235,35,20))

    def test_full_bleed_scene_and_private_jpeg(self):
        for variant in (1,2,3):
            with self.subTest(variant=variant):
                poster=build_poster(self.scene,self.product,"Máquina de ajo eléctrica",25.00,variant)
                self.assertEqual(poster.size,(W,H))
                self.assertTrue(jpeg_bytes(poster).startswith(bytes([255,216,255])))

    def test_no_original_poster_is_pasted(self):
        poster=build_poster(self.scene,self.product,"Herramienta portátil",25.00,2)
        for point in ((540,500),(540,750),(100,900),(950,1000)):
            with self.subTest(point=point):
                self.assertEqual(poster.getpixel(point),self.scene.getpixel(point))
        self.assertNotEqual(poster.getpixel((540,750)),self.product.getpixel((400,400)))

    def test_concept_without_reference_is_possible(self):
        poster=build_poster(self.scene,None,"Producto sin imagen",None,3,reference_mode="conceptual")
        self.assertEqual(poster.size,(1080,1350))
        self.assertEqual(poster.getpixel((540,800)),self.scene.getpixel((540,800)))
        self.assertGreater(len(jpeg_bytes(poster)),15000)

    def test_low_resolution_reference_is_usable_but_not_authenticated(self):
        source_quality(Image.new("RGB",(220,220),"white"))
        with self.assertRaisesRegex(ValueError,"source resolution too small"):
            source_quality(Image.new("RGB",(100,100),"white"))

    def test_catalogue_is_independent_of_product_type(self):
        for product in ("Zapatos deportivos","Destornillador recargable","Crema facial",
                        "Escurridor de cocina","Reloj inteligente","Decoración del hogar"):
            with self.subTest(product=product):
                poster=build_poster(self.scene,self.product,product,None,1)
                self.assertEqual(poster.getpixel((540,800)),self.scene.getpixel((540,800)))

    def test_refuses_unsupported_variant_or_false_price(self):
        for price in (float("nan"), float("inf"), -1, 0):
            with self.assertRaises(ValueError):
                build_poster(self.scene,self.product,"Producto",price,1)
        with self.assertRaises(ValueError):
            build_poster(self.scene,self.product,"Producto",25,4)
        with self.assertRaises(ValueError):
            build_poster(self.scene,self.product,"Producto",25,1,reference_mode="untrusted")

    def test_refuses_clipped_titles_instead_of_truncating(self):
        with self.assertRaises(ValueError):
            build_poster(self.scene,self.product,"PalabraSinEspacios"*25,25,1)
        with self.assertRaises(ValueError):
            build_poster(self.scene,self.product,"",25,1)

if __name__=="__main__":
    unittest.main()

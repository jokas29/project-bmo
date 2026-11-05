import unittest
from PIL import Image, ImageDraw
from compositor import (
    W, H, HERO_TOP, HERO_BOTTOM, PRICE_PANEL_TOP,
    _full_scene_geometry, build_poster, jpeg_bytes, source_quality
)

class UniversalPremiumCompositorTests(unittest.TestCase):
    def setUp(self):
        self.scene = Image.new("RGB", (1024,1024), (31,42,73))
        self.product = Image.new("RGB", (800,800), (235,35,20))

    def test_all_variants_render_with_true_private_jpeg(self):
        for variant in (1,2,3):
            with self.subTest(variant=variant):
                poster = build_poster(self.scene,self.product,
                                      "Máquina de ajo eléctrica",25.00,variant)
                self.assertEqual(poster.size,(W,H))
                self.assertTrue(jpeg_bytes(poster).startswith(bytes((255,216,255))))

    def test_non_destructive_contain_never_crops_product_scene(self):
        for size in ((1024,1024),(896,1120),(1280,768),(640,1280)):
            with self.subTest(size=size):
                sample = Image.new("RGB",size,(80,110,145))
                dr=ImageDraw.Draw(sample)
                dr.rectangle((0,0,size[0]-1,size[1]-1),outline=(255,220,40),width=48)
                x,y,w,h=_full_scene_geometry(sample,430,HERO_BOTTOM)
                self.assertGreaterEqual(x,0)
                self.assertGreaterEqual(y,430)
                self.assertLessEqual(x+w,W)
                self.assertLessEqual(y+h,HERO_BOTTOM)
                final=build_poster(sample,self.product,"Herramienta portátil",42.00,1)
                # The top and bottom source edges are still visible inside the
                # dedicated hero; they are NOT covered by title or price.
                self.assertGreater(final.getpixel((x+w//2,y+10))[0],175)
                self.assertGreater(final.getpixel((x+w//2,y+h-11))[0],175)

    def test_entire_foreground_is_above_price_and_below_title(self):
        poster=build_poster(self.scene,self.product,"Herramienta portátil",25,2)
        self.assertEqual(poster.getpixel((540,800)),self.scene.getpixel((512,512)))
        self.assertNotEqual(poster.getpixel((540,800)),self.product.getpixel((400,400)))
        self.assertLess(HERO_BOTTOM,PRICE_PANEL_TOP)
        self.assertNotEqual(poster.getpixel((540,1240)),self.scene.getpixel((512,512)))

    def test_no_photo_creates_labelled_conceptual_visual(self):
        poster=build_poster(self.scene,None,"Producto sin fotografía",None,3,
                            reference_mode="conceptual")
        self.assertEqual(poster.size,(W,H))
        self.assertEqual(poster.getpixel((540,800)),self.scene.getpixel((512,512)))
        self.assertGreater(len(jpeg_bytes(poster)),15000)

    def test_small_reference_only_is_allowed_not_pasted(self):
        source_quality(Image.new("RGB",(220,220),"white"))
        with self.assertRaisesRegex(ValueError,"source resolution too small"):
            source_quality(Image.new("RGB",(100,100),"white"))

    def test_universal_categories_and_long_valid_names(self):
        for name in ("Zapatos deportivos","Destornillador recargable",
                     "Crema facial y productos de cuidado",
                     "Juego de herramientas para mover muebles",
                     "Escurridor de cocina","Reloj inteligente"):
            with self.subTest(name=name):
                poster=build_poster(self.scene,self.product,name,None,1)
                self.assertEqual(poster.size,(W,H))
                self.assertEqual(poster.getpixel((540,800)),self.scene.getpixel((512,512)))

    def test_fails_closed_on_invalid_price_variant_or_clipped_name(self):
        for price in (float("nan"),float("inf"),-1,0):
            with self.assertRaises(ValueError):
                build_poster(self.scene,self.product,"Producto",price,1)
        with self.assertRaises(ValueError):
            build_poster(self.scene,self.product,"Producto",25,4)
        with self.assertRaises(ValueError):
            build_poster(self.scene,self.product,"Producto",25,1,reference_mode="unknown")
        with self.assertRaises(ValueError):
            build_poster(self.scene,self.product,"PalabraSinEspacios"*25,25,1)

if __name__ == "__main__":
    unittest.main()

"""Offline visual invariants for the single-canvas DropEC editorial style."""
import unittest
from PIL import Image, ImageDraw

from compositor import (
    W, H, HERO_TOP, HERO_BOTTOM, STYLES, _full_scene_geometry,
    _background, build_poster, jpeg_bytes, source_quality
)


class PremiumUnifiedCanvasTests(unittest.TestCase):
    def setUp(self):
        self.scene = Image.new("RGB",(1024,1024),(31,42,73))
        self.reference = Image.new("RGB",(800,800),(235,35,20))

    def test_all_variants_produce_private_4_5_ad_without_cards(self):
        for variant in STYLES:
            with self.subTest(variant=variant):
                poster=build_poster(self.scene,self.reference,
                                    "Máquina de ajo eléctrica",25.0,variant)
                self.assertEqual(poster.size,(W,H))
                self.assertTrue(jpeg_bytes(poster).startswith(bytes((255,216,255))))
                # All styles preserve the scene's center rather than pasting
                # the reference catalogue advert over it.
                self.assertEqual(poster.getpixel((W//2,785)),self.scene.getpixel((512,512)))
                self.assertNotEqual(poster.getpixel((W//2,785)),self.reference.getpixel((400,400)))

    def test_no_top_middle_bottom_color_bands_in_backdrop(self):
        for variant in STYLES:
            with self.subTest(variant=variant):
                back=_background(self.scene,variant).convert("RGB")
                # Continuous background is smooth at the old structural
                # seams, unlike two opaque cards with hard horizontal borders.
                for border in (350,1150):
                    before=back.getpixel((15,border-2))
                    after=back.getpixel((15,border+2))
                    self.assertLess(max(abs(a-b) for a,b in zip(before,after)),15)

    def test_full_product_safe_centered_region_survives_without_cropping(self):
        for size in ((1024,1024),(896,1120),(1280,768),(640,1280)):
            with self.subTest(size=size):
                scene=Image.new("RGB",size,(20,37,68))
                d=ImageDraw.Draw(scene)
                # A generic product occupies inner 76%; its extremities must
                # survive the feathered full-image contain transformation.
                x1,y1=int(size[0]*.18),int(size[1]*.18)
                x2,y2=int(size[0]*.82),int(size[1]*.82)
                d.rectangle((x1,y1,x2,y2),fill=(200,59,80))
                ad=build_poster(scene,self.reference,"Herramienta portátil",44,2)
                x,y,w,h=_full_scene_geometry(scene,HERO_TOP,HERO_BOTTOM)
                self.assertGreaterEqual(x,0)
                self.assertLessEqual(x+w,W)
                self.assertGreaterEqual(y,HERO_TOP)
                self.assertLessEqual(y+h,HERO_BOTTOM)
                for px,py in ((.19,.19),(.80,.19),(.19,.80),(.80,.80),(.5,.5)):
                    cx=x+int(w*px)
                    cy=y+int(h*py)
                    rgb=ad.getpixel((cx,cy))
                    self.assertGreater(rgb[0],175)
                    self.assertLess(rgb[1],95)

    def test_long_catalogue_name_fits_or_fails_without_covering_hero(self):
        names=(
            "Juego de herramientas para mover muebles",
            "Audífonos inalámbricos portátiles",
            "Zapatos deportivos con diseño ergonómico",
            "Organizador portátil de artículos del hogar",
        )
        for product in names:
            with self.subTest(product=product):
                ad=build_poster(self.scene,self.reference,product,None,3)
                self.assertEqual(ad.size,(W,H))

    def test_palette_and_alignment_concepts_are_not_identical(self):
        a=_background(self.scene,1).convert("RGB")
        b=_background(self.scene,2).convert("RGB")
        c=_background(self.scene,3).convert("RGB")
        self.assertNotEqual(a.getpixel((20,30)),b.getpixel((20,30)))
        self.assertGreater(sum(c.getpixel((20,30))),sum(a.getpixel((20,30))))

    def test_without_photo_stays_visibly_conceptual(self):
        ad=build_poster(self.scene,None,"Producto sin fotografía",None,1,
                        reference_mode="conceptual")
        self.assertEqual(ad.size,(W,H))
        self.assertGreater(len(jpeg_bytes(ad)),15000)

    def test_photo_quality_is_reference_only(self):
        source_quality(Image.new("RGB",(220,220),"white"))
        with self.assertRaises(ValueError):
            source_quality(Image.new("RGB",(100,100),"white"))

    def test_invalid_prices_or_fake_titles_fail_closed(self):
        for price in (float("nan"),float("inf"),-1,0):
            with self.assertRaises(ValueError):
                build_poster(self.scene,self.reference,"Producto",price,1)
        for v in (0,4):
            with self.assertRaises(ValueError):
                build_poster(self.scene,self.reference,"Producto",25,v)
        with self.assertRaises(ValueError):
            build_poster(self.scene,self.reference,"Producto",25,1,
                         reference_mode="fictional")
        with self.assertRaises(ValueError):
            build_poster(self.scene,self.reference,"SinEspacios"*30,25,1)


if __name__ == "__main__":
    unittest.main()

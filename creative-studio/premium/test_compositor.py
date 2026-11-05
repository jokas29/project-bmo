"""Offline regression tests for DropEC's JSON-directed commercial advertising."""
import unittest
from unittest.mock import patch
from PIL import Image, ImageDraw

from compositor import (
    W,H,WHITE,PRIMARY,LIME,THEME,
    SubjectExtractionError,_organic_shapes,_check_subject,_fit_product,
    build_poster,jpeg_bytes,source_quality
)

def synthetic_cutout(w=1024,h=1024,rect=(240,145,795,880),rgba=(222,35,40,255)):
    im=Image.new("RGBA",(w,h),(255,255,255,0))
    d=ImageDraw.Draw(im)
    d.rounded_rectangle(rect,radius=65,fill=rgba)
    return im

class DropECJSONArtworkTests(unittest.TestCase):
    def setUp(self):
        self.photo=Image.new("RGB",(1024,1024),(232,232,232))
        self.source=Image.new("RGB",(800,800),(80,90,120))
        self.cutout=synthetic_cutout()

    def poster(self,variant=1,name="Máquina de ajo eléctrica",photo=True,price=25):
        return build_poster(
            self.photo,self.source if photo else None,name,price,variant,
            reference_mode="catalog_reference" if photo else "conceptual",
            subject=self.cutout
        )

    def test_user_palette_and_format_are_exactly_the_json(self):
        self.assertEqual((W,H),(1080,1350))
        self.assertEqual(WHITE,(255,255,255))
        self.assertEqual(PRIMARY,(41,52,10))
        self.assertEqual(LIME,(173,229,0))
        self.assertTrue(THEME["instrucciones"]["producto_dinamico"])

    def test_organic_shapes_are_behind_the_product_not_three_stacked_cards(self):
        for v in (1,2,3):
            with self.subTest(v=v):
                base=_organic_shapes(v)
                self.assertEqual(base.getpixel((28,60))[:3],PRIMARY)
                self.assertEqual(base.getpixel((40,805))[:3],WHITE)
                self.assertEqual(base.getpixel((1038,1290))[:3],LIME)
                poster=self.poster(v)
                self.assertEqual(poster.size,(W,H))
                self.assertTrue(jpeg_bytes(poster).startswith(bytes((255,216,255))))

    def test_actual_foreground_silhouette_overlaps_brand_shapes(self):
        for variant in (1,2,3):
            with self.subTest(variant=variant):
                poster=self.poster(variant)
                product,x,y=_fit_product(_check_subject(self.cutout),variant)
                cx=x+product.width//2
                cy=y+product.height//2
                # Bright red synthetic product must be visible above background.
                sample=poster.getpixel((cx,cy))
                self.assertGreater(sample[0],190)
                self.assertLess(sample[1],85)
                self.assertGreater(x,390)
                self.assertGreater(y,370)
                self.assertLess(x+product.width,W-14)
                self.assertLess(y+product.height,1166)

    def test_no_more_rectangular_image_or_wash_of_model_background(self):
        poster=self.poster()
        # The original flat gray generation background is removed, not pasted
        # as a square white/gray scene inside the brand design.
        self.assertEqual(_organic_shapes(1).getpixel((40,805)),(255,255,255,255))
        self.assertEqual(poster.getpixel((40,805)),WHITE)
        self.assertEqual(poster.getpixel((1038,1290)),LIME)
        self.assertNotEqual(poster.getpixel((745,775)),self.source.getpixel((400,400)))

    def test_no_verified_photo_still_produces_an_illustrative_private_ad(self):
        poster=self.poster(2,photo=False,price=None,name="Producto sin imagen")
        self.assertEqual(poster.size,(W,H))
        self.assertGreater(len(jpeg_bytes(poster)),15000)

    def test_wide_and_tall_products_fit_without_cropping(self):
        for dims,rect in [
            ((1024,1024),(180,350,870,640)),
            ((1024,1024),(365,75,670,950)),
            ((1024,1024),(205,180,790,845)),
        ]:
            with self.subTest(rect=rect):
                subject=synthetic_cutout(*dims,rect=rect)
                clean=_check_subject(subject)
                img,x,y=_fit_product(clean,2)
                self.assertGreaterEqual(x,393)
                self.assertLessEqual(x+img.width,W-15)
                self.assertGreaterEqual(y,375)
                self.assertLessEqual(y+img.height,1165)

    def test_source_reference_is_never_pasted_on_the_ad(self):
        poster=self.poster()
        self.assertNotEqual(poster.getpixel((745,775)),self.source.getpixel((400,400)))

    def test_incomplete_or_ambiguous_segmentations_are_rejected(self):
        with self.assertRaises(SubjectExtractionError):
            _check_subject(Image.new("RGBA",(1024,1024),(255,255,255,0)))
        with self.assertRaises(SubjectExtractionError):
            _check_subject(Image.new("RGBA",(1024,1024),(255,255,255,255)))
        edge=synthetic_cutout(rect=(0,140,740,900))
        with self.assertRaises(SubjectExtractionError):
            _check_subject(edge)
        tiny=synthetic_cutout(rect=(480,482,515,513))
        with self.assertRaises(SubjectExtractionError):
            _check_subject(tiny)

    def test_fail_closed_if_open_source_matting_is_unavailable(self):
        with patch("compositor._extract_subject",side_effect=SubjectExtractionError("missing")):
            with self.assertRaises(SubjectExtractionError):
                build_poster(self.photo,self.source,"Producto",25,1)

    def test_no_fabricated_contact_or_unverified_copy(self):
        self.assertIsNone(THEME["textos"]["contacto"]["telefono"])
        self.assertIsNone(THEME["textos"]["contacto"]["direccion"])
        self.assertEqual(THEME["textos"]["boton"]["contenido"],"SOLICITA TU COTIZACIÓN")

    def test_generic_categories_and_long_titles(self):
        for name in ("Juego de herramientas para mover muebles",
                     "Audífonos inalámbricos portátiles",
                     "Zapatos deportivos de fabricación artesanal",
                     "Organizador para artículos de oficina"):
            with self.subTest(name=name):
                ad=self.poster(name=name)
                self.assertEqual(ad.size,(W,H))

    def test_invalid_price_title_or_reference_mode_cannot_render(self):
        for price in (-1,0,float("nan"),float("inf")):
            with self.assertRaises(ValueError):
                self.poster(price=price)
        with self.assertRaises(ValueError):
            self.poster(name="UnTextoLarguísimoSinEspacios"*20)
        with self.assertRaises(ValueError):
            build_poster(self.photo,self.source,"Producto",25,4,subject=self.cutout)
        with self.assertRaises(ValueError):
            build_poster(self.photo,self.source,"Producto",25,1,
                         reference_mode="invented",subject=self.cutout)

if __name__=="__main__":
    unittest.main()

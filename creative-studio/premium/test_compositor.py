"""Offline regression checks for premium asymmetrical 2:3 editorial ads."""
import unittest
from unittest.mock import patch
from PIL import Image, ImageDraw

from compositor import (
    W,H,BG,INK,PANEL,THEME,load_font,_editorial_background,
    _headline_layout,_fit_product,_check_subject,SubjectExtractionError,
    build_poster,jpeg_bytes
)

def product_cutout(rect=(200,120,820,886),size=(1024,1024)):
    image=Image.new("RGBA",size,(255,255,255,0))
    ImageDraw.Draw(image).rounded_rectangle(rect,radius=60,fill=(210,37,48,255))
    return image

class EditorialPosterTests(unittest.TestCase):
    def setUp(self):
        self.scene=Image.new("RGB",(1024,1024),(225,225,225))
        self.orig=Image.new("RGB",(800,800),(31,42,73))
        self.subject=product_cutout()

    def poster(self,variant=1,title="Máquina de ajo eléctrica",price=25,
               with_photo=True):
        return build_poster(
            self.scene,self.orig if with_photo else None,title,price,variant,
            reference_mode="catalog_reference" if with_photo else "conceptual",
            subject=self.subject)

    def test_json_dimensions_colors_and_typographic_weights(self):
        self.assertEqual((W,H),(736,1104))
        self.assertEqual(BG,(245,243,239))
        self.assertEqual(PANEL,(170,166,160))
        self.assertEqual(INK,(17,17,17))
        self.assertEqual(THEME["composicion"]["panel_central"]["ancho"],"28%")
        self.assertTrue(THEME["instrucciones"]["mantener_tipografia"])
        self.assertIn("Lato",THEME["estilo"]["tipografia"]["familia"])
        self.assertGreater(load_font(70,"black").size,60)

    def test_panel_is_centered_vertical_architecture_not_photo_rectangle(self):
        for variant in (1,2,3):
            with self.subTest(variant=variant):
                bg=_editorial_background(variant)
                self.assertEqual(bg.getpixel((4,400))[:3],BG)
                self.assertEqual(bg.getpixel((W//2,400))[:3],PANEL)
                self.assertEqual(bg.getpixel((4,1030))[:3],BG)
                self.assertEqual(bg.getpixel((W//2,1060))[:3],BG)

    def test_three_variants_render_and_preserve_foreground_color(self):
        for variant in (1,2,3):
            with self.subTest(variant=variant):
                poster=self.poster(variant)
                self.assertEqual(poster.size,(W,H))
                self.assertTrue(jpeg_bytes(poster).startswith(bytes((255,216,255))))
                d=ImageDraw.Draw(Image.new("RGB",(W,H)))
                lines,font,line_h=_headline_layout("Máquina de ajo eléctrica",d)
                fitted,x,y=_fit_product(_check_subject(self.subject),variant,137+len(lines)*line_h)
                pw,ph=fitted.size
                r,g,b=poster.getpixel((x+pw//2,y+ph//2))
                self.assertGreater(r,180)
                self.assertLess(g,95)
                self.assertGreater(x,150)
                self.assertLess(x+pw,W-10)
                self.assertGreater(y,330)
                self.assertLess(y+ph,962)

    def test_full_silhouette_for_wide_and_tall_items(self):
        d=ImageDraw.Draw(Image.new("RGB",(W,H)))
        lines,font,line_h=_headline_layout("Juego de herramientas para mover muebles",d)
        title_end=137+len(lines)*line_h
        for bbox in [(90,370,935,660),(380,60,650,960),(180,160,850,870)]:
            with self.subTest(bbox=bbox):
                obj=_check_subject(product_cutout(bbox))
                im,x,y=_fit_product(obj,1,title_end)
                self.assertGreater(x,150)
                self.assertGreater(y,title_end+17)
                self.assertLess(x+im.width,W-10)
                self.assertLessEqual(y+im.height,961)

    def test_long_names_use_compact_editorial_type_without_clipping(self):
        for name in ("Juego de herramientas para mover muebles",
                     "Auriculares inalámbricos con estuche compacto",
                     "Organizador multifuncional de artículos para el hogar"):
            with self.subTest(name=name):
                self.assertEqual(self.poster(title=name).size,(W,H))

    def test_no_reference_has_label_and_is_not_published(self):
        poster=self.poster(with_photo=False,price=None)
        self.assertEqual(poster.size,(W,H))
        self.assertGreater(len(jpeg_bytes(poster)),15000)
        self.assertFalse(THEME["instrucciones"]["publicacion_automatica"])

    def test_no_fake_iphone_features_contact_or_phone_colors(self):
        self.assertIsNone(THEME["textos"]["contacto"]["telefono"])
        self.assertIsNone(THEME["textos"]["contacto"]["direccion"])
        self.assertEqual(THEME["caracteristicas"]["elementos"],[])
        self.assertEqual(THEME["variantes_color"]["colores"],[])
        with open(__import__("pathlib").Path(__file__).with_name("compositor.py"),encoding="utf-8") as fi:
            source=fi.read()
        self.assertNotIn("A20 Pro",source)
        self.assertNotIn("Pro Camera",source)
        self.assertNotIn("iPhone",source)

    def test_cutout_cannot_be_missing_touch_outer_edges_or_ambiguous(self):
        for sample in (Image.new("RGBA",(1024,1024),(0,0,0,0)),
                       Image.new("RGBA",(1024,1024),(100,80,80,255)),
                       product_cutout(rect=(0,120,700,900))):
            with self.assertRaises(SubjectExtractionError):
                _check_subject(sample)

    def test_failure_of_free_cpu_matting_is_not_substituted_with_old_photo(self):
        with patch("compositor._extract_subject",side_effect=SubjectExtractionError("no model")):
            with self.assertRaises(SubjectExtractionError):
                build_poster(self.scene,self.orig,"Producto",25,1)

    def test_prices_and_unusable_titles_fail_safely(self):
        for price in (-1,0,float("inf"),float("nan")):
            with self.assertRaises(ValueError):
                self.poster(price=price)
        with self.assertRaises(ValueError):
            self.poster(title="UnaPalabraImposibleDeAcomodar"*12)
        with self.assertRaises(ValueError):
            self.poster(variant=4)

if __name__=="__main__":
    unittest.main()

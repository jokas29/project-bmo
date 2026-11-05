"""Regressions: DropEC Premium cover has ONLY product name + image."""
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image, ImageDraw

from compositor import (
    W,H,BG,INK,PANEL,THEME,load_font,_editorial_background,
    _headline_layout,_fit_product,_check_subject,SubjectExtractionError,
    build_poster,jpeg_bytes
)

def synthetic_cutout(rect=(200,120,820,886),size=(1024,1024)):
    image=Image.new("RGBA",size,(255,255,255,0))
    ImageDraw.Draw(image).rounded_rectangle(rect,radius=60,fill=(215,42,57,255))
    return image

class CoverOnlyTests(unittest.TestCase):
    def setUp(self):
        self.scene=Image.new("RGB",(1024,1024),(229,229,229))
        self.reference=Image.new("RGB",(800,800),(31,42,73))
        self.cutout=synthetic_cutout()

    def poster(self,variant=1,title="Máquina de ajo eléctrica",price=25,photo=True):
        return build_poster(self.scene,self.reference if photo else None,title,
            price,variant,reference_mode="catalog_reference" if photo else "conceptual",
            subject=self.cutout)

    def test_exact_dimensions_palette_heavy_open_font_and_accents(self):
        self.assertEqual((W,H),(736,1104))
        self.assertEqual(BG,(245,243,239))
        self.assertEqual(PANEL,(170,166,160))
        self.assertEqual(INK,(17,17,17))
        self.assertEqual(THEME["estilo"]["tipografia"]["familia"],"Anton")
        self.assertEqual(THEME["textos"]["permitidos_en_portada"],["nombre_producto"])
        font=load_font(92)
        self.assertTrue(font.getmask("MÁQUINA ELÉCTRICA NIÑO ÚTIL").getbbox())

    def test_no_brand_index_edition_price_cta_or_any_secondary_text(self):
        original=ImageDraw.ImageDraw.text
        observed=[]
        def spy(draw,xy,value,*args,**kwargs):
            observed.append(value)
            return original(draw,xy,value,*args,**kwargs)
        title="Máquina de ajo eléctrica"
        with patch.object(ImageDraw.ImageDraw,"text",spy):
            ad=self.poster(title=title)
        self.assertEqual(ad.size,(W,H))
        # All drawn strings must be words from one uppercase catalogue title,
        # never a claim, brand, number, quote CTA, price or other copy.
        self.assertEqual(" ".join(observed),title.upper())
        source=Path(__file__).with_name("compositor.py").read_text()
        for forbidden in ("EDICIÓN","DROPEC","DROP EC","PRECIO DE CATÁLOGO",
                          "SOLICITA TU COTIZACIÓN","IMAGEN ILUSTRATIVA",
                          "load_font(318","_tracked(","_money("):
            self.assertNotIn(forbidden,source)
        self.assertTrue(jpeg_bytes(ad).startswith(bytes((255,216,255))))

    def test_price_does_not_modify_cover(self):
        a=self.poster(price=25)
        b=self.poster(price=99)
        c=self.poster(price=None)
        self.assertEqual(a.tobytes(),b.tobytes())
        self.assertEqual(a.tobytes(),c.tobytes())

    def test_no_photo_uses_same_visual_cover_with_honest_ui_label(self):
        a=self.poster(photo=True)
        b=self.poster(photo=False)
        self.assertEqual(a.tobytes(),b.tobytes())
        # Conceptual status is kept in private UI rather than added to cover.
        html=Path(__file__).resolve().parents[1].joinpath("index.html").read_text()
        self.assertIn("IMAGEN ILUSTRATIVA",html)

    def test_neutral_editorial_background_only_no_unwanted_graphic_text(self):
        for variant in (1,2,3):
            with self.subTest(variant=variant):
                image=_editorial_background(variant)
                self.assertEqual(image.getpixel((5,400))[:3],BG)
                self.assertEqual(image.getpixel((W//2,400))[:3],PANEL)
                self.assertEqual(image.getpixel((5,1050))[:3],BG)

    def test_large_uncropped_product_in_front_and_clear_of_title(self):
        for variant in (1,2,3):
            with self.subTest(variant=variant):
                ad=self.poster(variant)
                d=ImageDraw.Draw(Image.new("RGB",(W,H)))
                lines,font,line_h=_headline_layout("Máquina de ajo eléctrica",d)
                title_bottom=52+len(lines)*line_h
                fitted,x,y=_fit_product(_check_subject(self.cutout),variant,title_bottom)
                fw,fh=fitted.size
                self.assertGreater(fh,600)
                self.assertGreater(y,title_bottom+25)
                self.assertGreaterEqual(x,18)
                self.assertLessEqual(x+fw,W-18)
                self.assertLessEqual(y+fh,H-34)
                self.assertGreater(ad.getpixel((x+fw//2,y+fh//2))[0],180)

    def test_different_categories_and_long_titles_never_truncate(self):
        names=(
            "Juego de herramientas para mover muebles",
            "Audífonos inalámbricos con estuche de carga portátil",
            "Organizador multifuncional de artículos para el hogar",
            "Zapatos deportivos de fabricación artesanal",
            "Cámara digital de vigilancia con accesorios"
        )
        for name in names:
            with self.subTest(name=name):
                d=ImageDraw.Draw(Image.new("RGB",(W,H)))
                lines,font,h=_headline_layout(name,d)
                self.assertEqual(" ".join(lines),name.upper())
                self.assertEqual(self.poster(title=name).size,(W,H))

    def test_very_wide_and_tall_products_keep_all_silhouette(self):
        for rect in ((90,370,935,660),(380,60,650,960),(180,160,850,870)):
            with self.subTest(rect=rect):
                clean=_check_subject(synthetic_cutout(rect))
                im,x,y=_fit_product(clean,2,300)
                self.assertGreaterEqual(x,18)
                self.assertGreaterEqual(y,330)
                self.assertLessEqual(x+im.width,W-18)
                self.assertLessEqual(y+im.height,H-34)

    def test_missing_ambiguous_or_clipped_product_fails_closed(self):
        samples=(Image.new("RGBA",(1024,1024),(0,0,0,0)),
                 Image.new("RGBA",(1024,1024),(10,10,10,255)),
                 synthetic_cutout((0,120,700,900)))
        for item in samples:
            with self.assertRaises(SubjectExtractionError):
                _check_subject(item)
        with patch("compositor._extract_subject",side_effect=SubjectExtractionError("unavailable")):
            with self.assertRaises(SubjectExtractionError):
                build_poster(self.scene,self.reference,"Producto",25,1)

    def test_invalid_price_title_or_variant_fails_closed(self):
        for amount in (0,-1,float("nan"),float("inf")):
            with self.assertRaises(ValueError):
                self.poster(price=amount)
        with self.assertRaises(ValueError):
            self.poster(title="PalabraSinEspaciosImposible"*12)
        with self.assertRaises(ValueError):
            self.poster(variant=4)

if __name__=="__main__":
    unittest.main()

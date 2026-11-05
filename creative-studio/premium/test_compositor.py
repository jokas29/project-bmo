"""Regressions: DropEC Premium cover has ONLY product name + image."""
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image, ImageDraw

from compositor import (
    W,H,BG,INK,PANEL,THEME,load_font,_editorial_background,
    _headline_layout,_fit_product,_check_subject,SubjectExtractionError,
    build_poster,build_carousel_slide,_fit_carousel_subject,jpeg_bytes
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
        self.assertEqual(BG,(21,10,42))
        self.assertEqual(PANEL,(66,28,115))
        self.assertEqual(INK,(249,246,255))
        self.assertEqual(THEME["composicion"]["ambiente"]["tipo"],
                         "estudio_fotografico_editorial_virtual")
        self.assertFalse(THEME["composicion"]["panel_central"]["habilitado"])
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

    def test_cover_headline_is_centered_for_short_and_long_names(self):
        original=ImageDraw.ImageDraw.text
        for title in ("Máquina de ajo eléctrica","Organizador portátil",
                      "Juego de herramientas para mover muebles"):
            with self.subTest(name=title):
                calls=[]
                def spy(draw,xy,value,*args,**kwargs):
                    calls.append((xy,value,kwargs.get("font")))
                    return original(draw,xy,value,*args,**kwargs)
                with patch.object(ImageDraw.ImageDraw,"text",spy):
                    self.poster(title=title)
                self.assertGreater(len(calls),0)
                for (x,y),value,font in calls:
                    bbox=ImageDraw.Draw(Image.new("RGB",(W,H))).textbbox(
                        (0,0),value,font=font)
                    visual_center=x+(bbox[2]+bbox[0])/2
                    self.assertLess(abs(visual_center-W/2),2)

    def test_premium_carousel_has_three_distinct_consistent_interior_images(self):
        outputs=[]
        for number in (2,3,4):
            with self.subTest(slide=number):
                result=build_carousel_slide(
                    self.scene,self.reference,"Máquina de ajo eléctrica",
                    25,number,subject=self.cutout)
                self.assertEqual(result.size,(W,H))
                self.assertTrue(jpeg_bytes(result).startswith(bytes((255,216,255))))
                outputs.append(result.tobytes())
        self.assertEqual(len(set(outputs)),3)

    def test_carousel_title_and_price_are_audited_not_fabricated(self):
        original=ImageDraw.ImageDraw.text
        expected={
            2:["MÍRALO","DE CERCA"],
            3:["OTRA","PERSPECTIVA"],
            4:["¿TE","INTERESA?","SOLICITA TU COTIZACIÓN","$25.00"]
        }
        for number in (2,3,4):
            with self.subTest(number=number):
                painted=[]
                def spy(draw,xy,value,*args,**kwargs):
                    painted.append(value)
                    return original(draw,xy,value,*args,**kwargs)
                with patch.object(ImageDraw.ImageDraw,"text",spy):
                    build_carousel_slide(self.scene,self.reference,
                        "Máquina de ajo eléctrica",25,number,subject=self.cutout)
                self.assertEqual(painted,expected[number])
        painted=[]
        def spy(draw,xy,value,*args,**kwargs):
            painted.append(value)
            return original(draw,xy,value,*args,**kwargs)
        with patch.object(ImageDraw.ImageDraw,"text",spy):
            build_carousel_slide(self.scene,None,"Producto conceptual",
                                None,4,reference_mode="conceptual",
                                subject=self.cutout)
        self.assertNotIn("$25.00",painted)

    def test_carousel_foreground_is_complete_in_all_aspect_ratios(self):
        for number in (2,3,4):
            for rect in ((90,370,935,660),(380,60,650,960),
                         (180,160,850,870)):
                with self.subTest(number=number,bounds=rect):
                    item=_check_subject(synthetic_cutout(rect))
                    image,x,y=_fit_carousel_subject(
                        item,number,230,184 if number==4 else 38)
                    self.assertGreaterEqual(x,15)
                    self.assertLessEqual(x+image.width,W-15)
                    self.assertGreaterEqual(y,253)
                    self.assertLessEqual(y+image.height,
                        H-(184 if number==4 else 38))

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

    def test_violet_cinematic_background_has_depth_and_no_hard_panels(self):
        images=[]
        for variant in (1,2,3):
            with self.subTest(variant=variant):
                image=_editorial_background(variant)
                self.assertEqual(image.size,(W,H))
                # Background now has actual ambient illumination, not a
                # plain color plus a flat gray vertical stripe.
                dark=image.getpixel((8,14))[:3]
                halo=image.getpixel((440,700))[:3]
                self.assertNotEqual(dark,halo)
                self.assertGreater(sum(halo),sum(dark)+20)
                self.assertNotEqual(image.getpixel((8,550)),
                                    image.getpixel((W-8,550)))
                # Smooth background, not three hard horizontal rectangles.
                a=image.getpixel((12,380))[:3]
                b=image.getpixel((12,381))[:3]
                self.assertLess(max(abs(k-v) for k,v in zip(a,b)),20)
                images.append(image)
        self.assertNotEqual(images[0].getpixel((440,700)),
                            images[1].getpixel((440,700)))
        self.assertNotEqual(images[1].getpixel((440,700)),
                            images[2].getpixel((440,700)))

    def test_graphic_details_live_behind_full_foreground_product(self):
        for variant in (1,2,3):
            with self.subTest(variant=variant):
                base=_editorial_background(variant).convert("RGB")
                poster=self.poster(variant)
                self.assertNotEqual(base.getpixel((89,590)),
                                    base.getpixel((98,590)))
                d=ImageDraw.Draw(Image.new("RGB",(W,H)))
                lines,font,h=_headline_layout("Máquina de ajo eléctrica",d)
                fitted,x,y=_fit_product(_check_subject(self.cutout),variant,
                                        52+len(lines)*h)
                center=(x+fitted.width//2,y+fitted.height//2)
                self.assertGreater(poster.getpixel(center)[0],180)
                self.assertLess(poster.getpixel(center)[1],100)

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

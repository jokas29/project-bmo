"""DropEC premium ad compositor: real product pixels + AI scenery + exact typography.
Uses only Pillow on CPU. This module never publishes and never changes a product.
"""
from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Optional
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps
import math

W, H = 1080, 1350
LIME = (204, 255, 82)
WHITE = (250, 247, 255)
PURPLE = (33, 11, 68)
DARK = (15, 8, 32)
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

def load_font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    name = FONT_BOLD if bold else FONT_REGULAR
    try:
        return ImageFont.truetype(name, size)
    except OSError:
        return ImageFont.load_default()

def fit_lines(text: str, width: int, draw: ImageDraw.ImageDraw,
              max_size: int = 76, max_lines: int = 3) -> tuple[list[str], ImageFont.FreeTypeFont]:
    cleaned = " ".join(text.split())[:120]
    for size in range(max_size, 31, -2):
        font = load_font(size)
        words = cleaned.split()
        lines: list[str] = []
        line = ""
        for word in words:
            trial = (line + " " + word).strip()
            if line and draw.textbbox((0,0),trial,font=font)[2] > width:
                lines.append(line)
                line = word
            else:
                line = trial
        if line:
            lines.append(line)
        if len(lines) <= max_lines and all(draw.textbbox((0,0),ln,font=font)[2] <= width for ln in lines):
            return lines,font
    raise ValueError("Product name is too long to render safely without truncation")

def source_quality(image: Image.Image) -> None:
    if image.width < 550 or image.height < 550:
        raise ValueError(f"source resolution too small: {image.width}x{image.height}; provide authentic high-resolution product photo")
    if image.width > 9000 or image.height > 9000:
        raise ValueError("source resolution invalid")
    if image.width/image.height > 4 or image.height/image.width > 4:
        raise ValueError("source aspect ratio invalid")

def build_poster(scene: Image.Image, original: Image.Image, product_name: str,
                 price: Optional[float], variant: int) -> Image.Image:
    """Only the original image goes in the product panel; synthetic scene stays behind it."""
    if variant not in (1,2,3):
        raise ValueError("invalid variant")
    source_quality(original)
    if not isinstance(product_name,str) or not product_name.strip():
        raise ValueError("missing product name")
    if price is not None and (not math.isfinite(float(price)) or float(price) <= 0):
        raise ValueError("invalid price")

    scenery=ImageOps.fit(scene.convert("RGB"),(W,H),method=Image.Resampling.LANCZOS)
    overlay=Image.new("RGBA",(W,H),(0,0,0,0))
    layer=ImageDraw.Draw(overlay,"RGBA")
    # Dark gradient protects text legibility on any AI background
    for y in range(H):
        strength=int(225 * max(0.25, 1-(y/H)*0.65))
        base=(18,5,35) if variant != 2 else (38,9,71)
        layer.line([(0,y),(W,y)], fill=(*base,strength))
    poster=Image.alpha_composite(scenery.convert("RGBA"),overlay)

    dr=ImageDraw.Draw(poster,"RGBA")
    # Brand, editorial category and top accent
    dr.rounded_rectangle((58,56,342,125),radius=34,fill=(*LIME,255))
    dr.text((86,69),"DropEC",font=load_font(42),fill=(18,12,35,255))
    dr.text((788,81),f"IDEA  {variant} / 3",font=load_font(23,False),fill=WHITE+(255,))
    dr.rounded_rectangle((58,155,1022,162),radius=3,fill=(*LIME,250))
    title=product_name.strip()
    lines,title_font=fit_lines(title,936,dr,max_size=76,max_lines=3)
    line_height=max(62,int(getattr(title_font,"size",66)*1.23))
    y=203
    for line in lines:
        dr.text((65,y),line,font=title_font,fill=WHITE+(255,),stroke_width=0)
        y+=line_height

    # Authentic photo remains a separate, unmodified image layer on top
    # of generated scenery. This is deliberate brand/product truth protection.
    panel_top=max(455,y+28)
    panel_bottom=1083 if variant!=2 else 1060
    panel_top=min(panel_top,690)
    shadow=Image.new("RGBA",(W,H),(0,0,0,0))
    sh=ImageDraw.Draw(shadow)
    sh.rounded_rectangle((75,panel_top+20,1005,panel_bottom+22),radius=55,fill=(0,0,0,150))
    shadow=shadow.filter(ImageFilter.GaussianBlur(28))
    poster=Image.alpha_composite(poster,shadow)
    dr=ImageDraw.Draw(poster,"RGBA")
    dr.rounded_rectangle((72,panel_top,1008,panel_bottom),radius=48,fill=(255,255,255,250))
    original_image=original.convert("RGBA")
    fitted=ImageOps.contain(original_image,(864,panel_bottom-panel_top-90),method=Image.Resampling.LANCZOS)
    px=72+(936-fitted.width)//2
    py=panel_top+(panel_bottom-panel_top-fitted.height)//2
    poster.alpha_composite(fitted,(px,py))

    dr=ImageDraw.Draw(poster,"RGBA")
    dr.rounded_rectangle((58,1102,1022,1310),radius=34,fill=(44,10,78,240))
    if price is not None:
        dr.text((88,1125),"PRECIO REFERENCIAL DE CATÁLOGO",font=load_font(21,False),fill=WHITE+(255,))
        dr.text((88,1158),f"${float(price):,.2f}",font=load_font(64),fill=LIME+(255,))
    else:
        dr.text((88,1160),"CONSULTA DISPONIBILIDAD",font=load_font(35),fill=LIME+(255,))
    dr.text((90,1251),"Solicita tu cotización  •  Envío por confirmar",
            font=load_font(22,False),fill=WHITE+(255,))
    return poster.convert("RGB")

def jpeg_bytes(image: Image.Image) -> bytes:
    out=BytesIO()
    image.save(out,"JPEG",quality=91,optimize=True,subsampling=0)
    data=out.getvalue()
    if not (15000 <= len(data) <= 7*1024*1024):
        raise ValueError("poster JPEG byte length out of bounds")
    return data

def render_to_file(scene_path: str, original_path: str, product: str,
                   price: Optional[float], variant: int, output: str) -> str:
    with Image.open(scene_path) as scene, Image.open(original_path) as original:
        data=jpeg_bytes(build_poster(scene,original,product,price,variant))
    Path(output).write_bytes(data)
    return output

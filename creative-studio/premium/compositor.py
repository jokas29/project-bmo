"""DropEC universal commercial poster, based on editorial_theme.json.

Cloudflare/HF generates only a physical product photograph on a clean neutral
background. A local CPU segmentation model removes that background, and Pillow
composes one coherent 1080x1350 advertisement. This is NOT photo-on-poster
pasting: the product's transparent silhouette overlaps the actual branded
organic shapes and casts a natural soft shadow. No hardcoded product IDs.
No public publishing, approval, invented claims or fabricated contact data.
"""
from __future__ import annotations

from functools import lru_cache
from io import BytesIO
from pathlib import Path
import json
import math
from typing import Optional

from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps

THEME = json.loads(Path(__file__).with_name("editorial_theme.json").read_text(encoding="utf-8"))
W, H = 1080, 1350
assert THEME["formato"]["ancho"] == W and THEME["formato"]["alto"] == H

def rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    if len(value) != 6:
        raise ValueError("Bad configured theme color")
    return tuple(int(value[i:i+2], 16) for i in (0, 2, 4))

PRIMARY=rgb(THEME["estilo"]["colores"]["principal"])
LIME=rgb(THEME["estilo"]["colores"]["secundario"])
WHITE=rgb(THEME["estilo"]["fondo"])
MODES=frozenset(("catalog_reference","promotional_reference",
                 "low_resolution_reference","conceptual","legacy_overlay"))
FONT_BOLD="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REGULAR="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

class SubjectExtractionError(RuntimeError):
    """Fail closed: do not store an unprofessional or unverifiable cutout."""


def load_font(size: int, bold: bool=True) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR,size)
    except OSError:
        return ImageFont.load_default()


def source_quality(image: Image.Image) -> None:
    if min(image.size) < 160 or max(image.size) > 9000:
        raise ValueError("Source reference size outside safe bounds")
    if max(image.size)/max(1,min(image.size)) > 4:
        raise ValueError("Source reference aspect ratio unsupported")


def _bezier(a,b,c,d,steps=28):
    out=[]
    for i in range(steps+1):
        t=i/steps; u=1-t
        out.append((u*u*u*a[0]+3*u*u*t*b[0]+3*u*t*t*c[0]+t*t*t*d[0],
                    u*u*u*a[1]+3*u*u*t*b[1]+3*u*t*t*c[1]+t*t*t*d[1]))
    return out


def _mask_shape(points, size=(W,H), oversample=2):
    mask=Image.new("L",(size[0]*oversample,size[1]*oversample),0)
    draw=ImageDraw.Draw(mask)
    draw.polygon([(round(x*oversample),round(y*oversample)) for x,y in points],fill=255)
    return mask.resize(size,Image.Resampling.LANCZOS)


def _organic_shapes(variant: int) -> Image.Image:
    """User's #FFFFFF canvas with olive upper-left and lime lower-right blobs."""
    if variant not in (1,2,3):
        raise ValueError("Variant outside approved designs")
    art=Image.new("RGBA",(W,H),(*WHITE,255))
    # The variants keep original distribution but alter the curve slightly,
    # avoiding a product-specific hard-coded illustration or stacked sections.
    drift=(variant-2)*24
    upper=[(-40,-40),(840+drift,-40)]
    upper+=_bezier((840+drift,-40),(1010,110),(775+drift,325),(600+drift,464))
    upper+=_bezier((600+drift,464),(445,594),(225,589),(-40,612))
    upper.extend([(-40,-40)])
    ink=Image.new("RGBA",(W,H),(*PRIMARY,255))
    art.paste(ink,(0,0),_mask_shape(upper))
    lower=[(W+40,790+drift)]
    lower+=_bezier((W+40,790+drift),(894,864),(831,970),(708,1060))
    lower+=_bezier((708,1060),(582,1160),(543,1222),(496,H+40))
    lower.extend([(W+40,H+40),(W+40,790+drift)])
    lime=Image.new("RGBA",(W,H),(*LIME,255))
    art.paste(lime,(0,0),_mask_shape(lower))
    return art


@lru_cache(maxsize=1)
def _segmentation_session():
    """Download/load free local u2netp once; never use a paid segmentation API."""
    from rembg import new_session
    return new_session("u2netp")


def _extract_subject(scene: Image.Image) -> Image.Image:
    """Extract a product cutout on CPU; fail closed if model is unavailable."""
    try:
        from rembg import remove
        segmented=remove(ImageOps.exif_transpose(scene).convert("RGB"),
                         session=_segmentation_session()).convert("RGBA")
    except Exception as exc:
        raise SubjectExtractionError("Open-source background removal unavailable") from exc
    return _check_subject(segmented)


def _check_subject(cutout: Image.Image) -> Image.Image:
    """Reject empty, truncated, huge-background or tiny-subject masks."""
    product=cutout.convert("RGBA")
    if min(product.size)<512:
        raise SubjectExtractionError("Subject photograph is too small")
    a=product.getchannel("A")
    binary=a.point(lambda v: 255 if v>=72 else 0)
    bbox=binary.getbbox()
    if not bbox:
        raise SubjectExtractionError("No physical product isolated")
    l,t,r,b=bbox
    w,h=product.size
    # Do not present cropped edges as full, authentic product photographs.
    margin=min(l,t,w-r,h-b)
    if margin < min(w,h)*0.012:
        raise SubjectExtractionError("Physical product touches image boundary")
    area=(r-l)*(b-t)/(w*h)
    if area < 0.035 or area>0.87 or (r-l)<w*0.16 or (b-t)<h*0.19:
        raise SubjectExtractionError("Ambiguous or implausible product isolation")
    return product.crop((max(0,l-8),max(0,t-8),min(w,r+8),min(h,b+8)))


def _fit_product(subject: Image.Image, variant: int):
    """Large center-right foreground without intersecting the left CTA."""
    max_width=660
    max_height=760
    scale=min(max_width/subject.width,max_height/subject.height)
    w=max(1,round(subject.width*scale))
    h=max(1,round(subject.height*scale))
    image=subject.resize((w,h),Image.Resampling.LANCZOS)
    center_x=(728,730,726)[variant-1]
    center_y=(780,780,780)[variant-1]
    x=round(center_x-w/2)
    y=round(center_y-h/2)
    if x<393 or x+w>W-15 or y<375 or y+h>1165:
        raise SubjectExtractionError("Product silhouette does not fit safe editorial area")
    return image,x,y


def _wrap_title(text: str, draw: ImageDraw.ImageDraw):
    title=" ".join(text.split())
    if not title or len(title)>120:
        raise ValueError("Product title missing or too long")
    for size in range(73,31,-2):
        font=load_font(size)
        lines=[]; row=""
        for word in title.split():
            next_row=(row+" "+word).strip()
            if row and draw.textbbox((0,0),next_row,font=font)[2]>530:
                lines.append(row); row=word
            else: row=next_row
        if row:lines.append(row)
        line_h=round(size*1.13)
        if len(lines)<=4 and 156+len(lines)*line_h < 520 and all(
            draw.textbbox((0,0),line,font=font)[2] <= 530 for line in lines
        ):
            return lines,font,line_h
    raise ValueError("Product name cannot fit verified text field")


def _draw_brand(draw: ImageDraw.ImageDraw):
    drop_font=load_font(46)
    draw.text((72,46),"Drop",font=drop_font,fill=WHITE)
    offset=draw.textbbox((0,0),"Drop",font=drop_font)[2]
    draw.text((72+offset,46),"EC",font=drop_font,fill=LIME)


def build_poster(scene: Image.Image, original: Optional[Image.Image],
                 product_name: str, price: Optional[float], variant: int, *,
                 reference_mode: str="catalog_reference",
                 subject: Optional[Image.Image]=None) -> Image.Image:
    """A single branded visual composition built from one isolated product."""
    if variant not in (1,2,3):raise ValueError("Unknown variant")
    if reference_mode not in MODES:raise ValueError("Unapproved reference mode")
    if original is not None:source_quality(original)
    if not isinstance(product_name,str):raise ValueError("Invalid name")
    if price is not None:
        price=float(price)
        if not math.isfinite(price) or price<=0:raise ValueError("Invalid price")

    art=_organic_shapes(variant)
    dr=ImageDraw.Draw(art)
    _draw_brand(dr)
    lines,font,line_h=_wrap_title(product_name,dr)
    for idx,line in enumerate(lines):
        dr.text((69,150+idx*line_h),line,font=font,fill=WHITE)

    # Only reliable catalogue data may appear here; no model-generated claims,
    # placeholder WhatsApp number, fake address or brand promises.
    if subject is None:subject=_extract_subject(scene)
    else:subject=_check_subject(subject)
    product,x,y=_fit_product(subject,variant)

    shadow=Image.new("RGBA",(W,H),(0,0,0,0))
    shade=Image.new("L",product.size,0)
    shade.paste(product.getchannel("A"))
    shade=shade.filter(ImageFilter.GaussianBlur(27)).point(lambda v: int(v*.31))
    shadow_product=Image.new("RGBA",product.size,(*PRIMARY,0))
    shadow_product.putalpha(shade)
    shadow.alpha_composite(shadow_product,(x+12,y+18))
    art=Image.alpha_composite(art,shadow)
    art.alpha_composite(product,(x,y))
    dr=ImageDraw.Draw(art)

    # Angled CTA, deliberately left of the foreground object's safe zone.
    cta="SOLICITA TU COTIZACIÓN"
    button=[(70,918),(338,918),(370,942),(370,994),(338,1016),(70,1016)]
    dr.polygon(button,fill=LIME)
    for size in range(22,14,-1):
        f=load_font(size)
        if dr.textbbox((0,0),cta,font=f)[2] <= 278:break
    else:raise ValueError("CTA exceeds configured button")
    dr.text((82,955),cta,font=f,fill=PRIMARY)

    if price is not None:
        dr.text((72,1111),"PRECIO DE CATÁLOGO",font=load_font(22,False),fill=PRIMARY)
        amount=f"${price:,.2f}"
        for fs in range(70,35,-2):
            pf=load_font(fs)
            if dr.textbbox((0,0),amount,font=pf)[2]<350:
                break
        else:raise ValueError("Price is too wide")
        dr.text((69,1144),amount,font=pf,fill=PRIMARY)
    else:
        dr.text((72,1154),"CONSULTA DISPONIBILIDAD",font=load_font(22),fill=PRIMARY)

    if reference_mode=="conceptual" or original is None:
        disclosure="IMAGEN ILUSTRATIVA · MODELO NO VERIFICADO"
        dr.text((68,1295),disclosure,font=load_font(15,False),fill=PRIMARY)

    return art.convert("RGB")


def jpeg_bytes(image: Image.Image) -> bytes:
    buf=BytesIO()
    image.save(buf,format="JPEG",quality=93,optimize=True,subsampling=0)
    data=buf.getvalue()
    if not(15000<=len(data)<=7*1024*1024):
        raise ValueError("JPEG payload outside private staging bounds")
    return data


def render_to_file(scene_path: str, original_path: Optional[str], product: str,
                   price: Optional[float], variant: int, output: str,
                   reference_mode: str="catalog_reference") -> str:
    with Image.open(scene_path) as scene:
        if original_path:
            with Image.open(original_path) as source:
                data=jpeg_bytes(build_poster(scene,source,product,price,variant,
                                             reference_mode=reference_mode))
        else:
            data=jpeg_bytes(build_poster(scene,None,product,price,variant,
                                         reference_mode="conceptual"))
    Path(output).write_bytes(data)
    return output

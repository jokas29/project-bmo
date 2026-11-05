"""DropEC Premium — 2:3 editorial typography with a real foreground product.

Based on editorial_theme.json, not on iPhone/garlic-specific geometry. The
generated object is isolated with free local rembg; it overlaps the background
panel and decorative edition index. Product titles and catalog prices are
typeset deterministically, never fabricated by an image model. Private only.
"""
from __future__ import annotations

from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import Optional
import json
import math

from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps

THEME=json.loads(Path(__file__).with_name("editorial_theme.json").read_text(encoding="utf-8"))
W,H=int(THEME["formato"]["ancho"]),int(THEME["formato"]["alto"])
assert (W,H)==(736,1104) and THEME["formato"]["proporcion"]=="2:3"

def rgb(value: str):
    value=str(value).removeprefix("#")
    if len(value)!=6:raise ValueError("Invalid theme color")
    return tuple(int(value[i:i+2],16) for i in (0,2,4))

BG=rgb(THEME["estilo"]["fondo"])
INK=rgb(THEME["estilo"]["colores"]["texto"])
PANEL=rgb(THEME["estilo"]["colores"]["fondo_central"])
MUTED=rgb(THEME["estilo"]["colores"]["secundario"])
WHITE=(255,255,255)
MODES=frozenset(("catalog_reference","promotional_reference",
                 "low_resolution_reference","conceptual","legacy_overlay"))
# Lato is a licensed open-source Helvetica Neue alternative on Ubuntu.
# It uses genuine Black/Heavy/Light weights, not DejaVu's generic Bold default.
FONT_DIRECTORY=Path("/usr/share/fonts/truetype/lato")
FONTS={
    "black":("Lato-Black.ttf","Lato-Heavy.ttf"),
    "bold":("Lato-Heavy.ttf","Lato-Bold.ttf"),
    "medium":("Lato-Medium.ttf","Lato-Regular.ttf"),
    "regular":("Lato-Regular.ttf",),
    "light":("Lato-Light.ttf","Lato-Regular.ttf"),
}

class SubjectExtractionError(RuntimeError):
    """Reject empty, clipped, background-heavy or failed cutouts."""


def load_font(size: int, weight: str="regular"):
    for name in FONTS[weight]:
        path=FONT_DIRECTORY/name
        if path.is_file():
            return ImageFont.truetype(str(path),size)
    raise RuntimeError("Open-source Lato font not installed on runner")


def source_quality(image: Image.Image):
    if min(image.size)<160 or max(image.size)>9000:
        raise ValueError("Invalid photo reference resolution")
    if max(image.size)/max(1,min(image.size))>4:
        raise ValueError("Unsupported reference aspect")


@lru_cache(maxsize=1)
def _segmentation_session():
    from rembg import new_session
    return new_session("u2netp")


def _check_subject(cutout: Image.Image):
    if min(cutout.size)<512:
        raise SubjectExtractionError("Generated subject image too small")
    subject=cutout.convert("RGBA")
    alpha=subject.getchannel("A")
    bbox=alpha.point(lambda v:255 if v>=72 else 0).getbbox()
    if not bbox:
        raise SubjectExtractionError("No extracted product")
    l,t,r,b=bbox
    sw,sh=subject.size
    if min(l,t,sw-r,sh-b) < min(sw,sh)*.012:
        raise SubjectExtractionError("Product touches generation boundary")
    cover=(r-l)*(b-t)/(sw*sh)
    if not (.035<=cover<=.87) or (r-l)<sw*.16 or (b-t)<sh*.19:
        raise SubjectExtractionError("Unreliable product segmentation")
    return subject.crop((max(0,l-8),max(0,t-8),min(sw,r+8),min(sh,b+8)))


def _extract_subject(scene: Image.Image):
    try:
        from rembg import remove
        cut=remove(ImageOps.exif_transpose(scene).convert("RGB"),
                   session=_segmentation_session()).convert("RGBA")
    except Exception as error:
        raise SubjectExtractionError("Free CPU background removal unavailable") from error
    return _check_subject(cut)


def _editorial_background(variant: int):
    if variant not in (1,2,3):
        raise ValueError("Unrecognized concept")
    img=Image.new("RGBA",(W,H),(*BG,255))
    d=ImageDraw.Draw(img,"RGBA")
    width=round(W*.28)
    x={1:331,2:317,3:343}[variant]
    # Single architectural panel, centered and tall; never a photo card.
    d.rectangle((x,0,x+width,round(H*.92)),fill=(*PANEL,255))
    # Subtle editorial hairlines and print-like register strokes.
    d.line((43,81,693,81),fill=(*INK,65),width=1)
    d.line((43,1066,693,1066),fill=(*INK,65),width=1)
    return img


def _tracked(d,text,x,y,*,size=12,tracking=2,weight="medium",fill=INK):
    font=load_font(size,weight)
    for char in text:
        d.text((round(x),round(y)),char,font=font,fill=fill)
        x+=d.textlength(char,font=font)+tracking
    return x


def _headline_layout(name: str,d):
    name=" ".join(name.split())
    if not (2<=len(name)<=120):
        raise ValueError("Unusable catalogue title")
    # Typography is the lead actor: large black face, tight line-height,
    # with fallback scaling only for genuinely long product names.
    for fs in range(77,29,-2):
        font=load_font(fs,"black")
        lines=[]
        part=""
        for token in name.split():
            candidate=(part+" "+token).strip()
            if part and d.textbbox((0,0),candidate,font=font)[2]>395:
                lines.append(part)
                part=token
            else:
                part=candidate
        if part:lines.append(part)
        line_height=round(fs*.98)
        if len(lines)<=4 and 147+line_height*len(lines)<=348 and all(
            d.textbbox((0,0),line,font=font)[2]<=395 for line in lines
        ):
            return lines,font,line_height
    raise ValueError("Catalogue title is too long for editorial safe area")


def _fit_product(subject: Image.Image,variant: int,title_bottom: int=300):
    """Non-cropping fit, with the product visibly in front of the central panel.

    Dynamic title/subject safe bounds guarantee a complete silhouette without
    covering the headline, prices or the lower CTA.
    """
    if variant not in (1,2,3):
        raise ValueError("Invalid variant")
    top=max(345,title_bottom+18)
    bottom=961
    height=bottom-top
    max_w=527
    ratio=min(max_w/subject.width,height/subject.height)
    if ratio<=0:raise SubjectExtractionError("Invalid product bounds")
    pw=max(1,round(subject.width*ratio))
    ph=max(1,round(subject.height*ratio))
    center={1:460,2:461,3:450}[variant]
    px=round(center-pw/2)
    py=round(top+(height-ph)*.48)
    if px<160 or px+pw>W-11 or py<top or py+ph>bottom:
        raise SubjectExtractionError("Product cannot fit unobstructed editorial canvas")
    return subject.resize((pw,ph),Image.Resampling.LANCZOS),px,py


def _shadow_product(subject,x,y):
    mask=subject.getchannel("A")
    blur=mask.filter(ImageFilter.GaussianBlur(22))
    blur=blur.point(lambda v:round(v*.28))
    layer=Image.new("RGBA",(W,H),(0,0,0,0))
    shadow=Image.new("RGBA",subject.size,(35,29,21,0))
    shadow.putalpha(blur)
    layer.alpha_composite(shadow,(x+9,y+17))
    return layer


def _money(price: float, d):
    label=f"${price:,.2f}"
    for size in range(54,29,-2):
        f=load_font(size,"black")
        if d.textbbox((0,0),label,font=f)[2]<245:
            return label,f
    raise ValueError("Verified catalogue price is too long")


def build_poster(scene: Image.Image,original: Optional[Image.Image],
                 product_name: str,price: Optional[float],variant: int,*,
                 reference_mode: str="catalog_reference",
                 subject: Optional[Image.Image]=None) -> Image.Image:
    """Complete 736×1104 editorial concept, never publishes or invents claims."""
    if variant not in (1,2,3):raise ValueError("Invalid variant")
    if reference_mode not in MODES:raise ValueError("Invalid reference label")
    if original is not None:source_quality(original)
    if not isinstance(product_name,str):raise ValueError("Catalogue name missing")
    if price is not None:
        price=float(price)
        if not math.isfinite(price) or price<=0:
            raise ValueError("Invalid catalogue price")

    art=_editorial_background(variant)
    d=ImageDraw.Draw(art)
    _tracked(d,"DROPEC",42,35,size=23,tracking=1.0,weight="bold")
    _tracked(d,f"EDICIÓN 0{variant} / 03",579,38,size=9,tracking=.6,weight="medium")
    d.line((579,66,690,66),fill=INK,width=2)
    lines,font,line_height=_headline_layout(product_name,d)
    for i,line in enumerate(lines):
        d.text((43,137+i*line_height),line,font=font,fill=INK,stroke_width=0)
    title_bottom=137+len(lines)*line_height

    # The decorative number is the REAL concept index, not a fabricated model
    # number such as "18" from the inspiration photo.
    d.text((-25,641),f"0{variant}",font=load_font(318,"black"),fill=INK)
    # Small typography + micro rules add print/editorial rhythm without fake specs.
    d.line((43,501,122,501),fill=INK,width=2)
    _tracked(d,f"DROP EC  /  0{variant}",43,510,size=11,tracking=1.1,weight="medium")

    # Cut out only the generated PRODUCT, not the original advertising artwork.
    if subject is None:
        subject=_extract_subject(scene)
    else:
        subject=_check_subject(subject)
    product,x,y=_fit_product(subject,variant,title_bottom)
    art=Image.alpha_composite(art,_shadow_product(product,x,y))
    art.alpha_composite(product,(x,y))
    d=ImageDraw.Draw(art)

    # Lower information is truthful and deliberately has space of its own.
    # No invented Apple camera specs, color swatches, chip names or slogans.
    if price is not None:
        _tracked(d,"PRECIO DE CATÁLOGO",43,962,size=12,tracking=1.05,weight="medium")
        amount,price_font=_money(price,d)
        d.text((42,981),amount,font=price_font,fill=INK)
    else:
        _tracked(d,"CONSULTA DISPONIBILIDAD",43,985,size=12,tracking=1.0,weight="medium")
    _tracked(d,"SOLICITA TU COTIZACIÓN",43,1072,size=12,tracking=.35,weight="bold")
    d.line((235,1090,691,1090),fill=INK,width=2)

    if reference_mode=="conceptual" or original is None:
        _tracked(d,"IMAGEN ILUSTRATIVA · MODELO NO VERIFICADO",
                 399,1036,size=8,tracking=.16,weight="medium")

    return art.convert("RGB")


def jpeg_bytes(image: Image.Image) -> bytes:
    out=BytesIO()
    image.save(out,"JPEG",quality=94,optimize=True,subsampling=0)
    data=out.getvalue()
    if not(15000<=len(data)<=7*1024*1024):
        raise ValueError("Private poster JPG size outside limits")
    return data


def render_to_file(scene_path: str,original_path: Optional[str],
                   product: str,price: Optional[float],variant: int,
                   output: str,reference_mode: str="catalog_reference") -> str:
    with Image.open(scene_path) as scene:
        if original_path:
            with Image.open(original_path) as orig:
                data=jpeg_bytes(build_poster(scene,orig,product,price,variant,
                                            reference_mode=reference_mode))
        else:
            data=jpeg_bytes(build_poster(scene,None,product,price,variant,
                                         reference_mode="conceptual"))
    Path(output).write_bytes(data)
    return output

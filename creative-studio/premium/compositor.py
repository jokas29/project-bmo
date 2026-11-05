"""DropEC Premium cinematic cover: ONLY product name and foreground product.

All SKUs share reusable violet studio art direction, with photographic depth,
soft lights, dimensional shadows and decorative non-text elements BEHIND the
extracted product. The heavy Anton headline stays the only rendered lettering.
No price, logo, index, CTA, claims or invented product details.
"""
from __future__ import annotations

from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import Optional
import json
import math

from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps

THEME = json.loads(Path(__file__).with_name("editorial_theme.json").read_text(encoding="utf-8"))
W, H = int(THEME["formato"]["ancho"]), int(THEME["formato"]["alto"])
assert (W, H) == (736, 1104) and THEME["formato"]["proporcion"] == "2:3"

def rgb(value: str):
    value = str(value).removeprefix("#")
    if len(value) != 6:
        raise ValueError("Invalid theme color")
    return tuple(int(value[i:i+2], 16) for i in (0, 2, 4))

BG = rgb(THEME["estilo"]["fondo"])
INK = rgb(THEME["estilo"]["colores"]["texto"])
PANEL = rgb(THEME["estilo"]["colores"]["fondo_central"])
FONT_PATH = Path.home() / ".local/share/fonts/dropec/Anton-Regular.ttf"
MODES = frozenset(("catalog_reference", "promotional_reference",
                   "low_resolution_reference", "conceptual", "legacy_overlay"))

class SubjectExtractionError(RuntimeError):
    """Reject empty, clipped or ambiguous product cutouts rather than fake ads."""


def load_font(size: int, weight: str = "display"):
    """One deliberately heavy, condensed, Latin-accent-capable font."""
    if not FONT_PATH.is_file():
        raise RuntimeError("Pinned open-source Anton font not installed")
    return ImageFont.truetype(str(FONT_PATH), size)


def source_quality(image: Image.Image):
    if min(image.size) < 160 or max(image.size) > 9000:
        raise ValueError("Invalid photo reference resolution")
    if max(image.size) / max(1, min(image.size)) > 4:
        raise ValueError("Unsupported reference aspect")


@lru_cache(maxsize=1)
def _segmentation_session():
    from rembg import new_session
    return new_session("u2netp")


def _check_subject(cutout: Image.Image):
    if min(cutout.size) < 512:
        raise SubjectExtractionError("Generated subject image too small")
    subject = cutout.convert("RGBA")
    bbox = subject.getchannel("A").point(lambda v: 255 if v >= 72 else 0).getbbox()
    if not bbox:
        raise SubjectExtractionError("No extracted product")
    l, t, r, b = bbox
    sw, sh = subject.size
    if min(l, t, sw-r, sh-b) < min(sw, sh)*.012:
        raise SubjectExtractionError("Product touches generation boundary")
    cover = (r-l)*(b-t)/(sw*sh)
    if not (.035 <= cover <= .87) or (r-l) < sw*.16 or (b-t) < sh*.19:
        raise SubjectExtractionError("Unreliable product segmentation")
    return subject.crop((max(0, l-8), max(0, t-8), min(sw, r+8), min(sh, b+8)))


def _extract_subject(scene: Image.Image):
    try:
        from rembg import remove
        output = remove(ImageOps.exif_transpose(scene).convert("RGB"),
                        session=_segmentation_session()).convert("RGBA")
    except Exception as exc:
        raise SubjectExtractionError("Open-source CPU product extraction unavailable") from exc
    return _check_subject(output)


def _lerp(first, second, t):
    return tuple(round(a+(b-a)*t) for a,b in zip(first,second))


def _editorial_background(variant: int):
    """Continuous art-directed studio with depth, never a split poster.

    All shapes, lights, abstract props and reflections are BEHIND the product.
    Uses only Pillow on a low-res light map: no network or second AI inference.
    """
    if variant not in (1,2,3):
        raise ValueError("Invalid variant")
    spec=THEME["composicion"]["ambiente"]["variantes"][variant-1]
    top,mid,bottom=(rgb(spec[k]) for k in ("superior","centro","inferior"))
    halo=rgb(spec["halo"])
    lime=rgb(THEME["estilo"]["colores"]["acento_lima"])

    # Tone-mapped continuous studio background: rich purple but not flat.
    sw,sh=W//4,H//4
    small=Image.new("RGB",(sw,sh))
    pix=small.load()
    for j in range(sh):
        v=(j+.5)/sh
        if v<.68:
            base=_lerp(top,mid,v/.68)
        else:
            base=_lerp(mid,bottom,(v-.68)/.32)
        for i in range(sw):
            u=(i+.5)/sw
            # Elliptical violet rim light, magenta fill and neon-lime bounce
            # give commercial photographic dimensionality.
            main=math.exp(-(((u-.57)/.47)**2+((v-.57)/.34)**2)*1.7)*.53
            side=math.exp(-(((u-.12)/.35)**2+((v-.77)/.28)**2)*2.1)*.19
            edge=math.exp(-(((u-1.02)/.26)**2+((v-.67)/.24)**2)*1.9)*.19
            vignette=.99-.19*(((u-.5)/.66)**2+((v-.55)/.78)**2)
            # Deterministic micrograin, avoids sterile flat vector gradients.
            grain=(((i*73+j*109+variant*37)%23)-11)*.17
            pix[i,j]=tuple(max(0,min(255,round(
                (base[k]*(1-main-side-edge)+halo[k]*main+
                 (102,29,145)[k]*side+lime[k]*edge)*vignette+grain
            ))) for k in range(3))
    image=small.resize((W,H),Image.Resampling.BICUBIC).convert("RGBA")

    # Photographic-looking broad softboxes and a backlit stage. Each appears
    # below, never on top of the alpha-extracted hero.
    glow=Image.new("RGBA",(W,H),(0,0,0,0))
    gd=ImageDraw.Draw(glow,"RGBA")
    gd.ellipse((112,390,673,1025),fill=(*halo,77))
    gd.ellipse((395,600,982,1030),fill=(*lime,26))
    gd.ellipse((-145,815,460,1200),fill=(163,60,228,42))
    image=Image.alpha_composite(image,glow.filter(ImageFilter.GaussianBlur(96)))

    # Fine orbital lines and semi-transparent stage structures recall the
    # first high-end editorial attempts, not an infographic/photo container.
    graphics=Image.new("RGBA",(W,H),(0,0,0,0))
    d=ImageDraw.Draw(graphics,"RGBA")
    d.arc((-245,335,915,1410),start=205,end=336,fill=(*halo,58),width=3)
    d.arc((-85,422,826,1310),start=196,end=337,fill=(242,224,255,35),width=2)
    d.arc((280,275,1017,1105),start=145,end=252,fill=(*lime,42),width=2)
    # Transparent vertical "glass" bevels subtly frame the lighting.
    d.polygon([(0,575),(92,501),(152,975),(0,1032)],fill=(167,81,217,14))
    d.polygon([(W,397),(W-86,482),(W-40,1006),(W,1042)],fill=(215,174,255,13))

    # Studio horizon and reflected floor, with no hard horizontal band.
    d.ellipse((28,1000,W-24,1153),outline=(238,194,255,45),width=2)
    for n in range(8):
        yy=936+n*22
        alpha=max(4,23-n*3)
        d.line((0,yy,W,yy+round(n*1.8)),fill=(238,214,255,alpha),width=1)
    # Small abstract highlights echo the original lime/violet palette.
    sparks=((89,590,5),(667,490,7),(694,750,3),(121,863,4),
            (608,1060,5),(46,1040,3),(638,322,2))
    for idx,(x,y,radius) in enumerate(sparks):
        color=(*lime,155) if idx%3==0 else (239,200,255,95)
        d.ellipse((x-radius,y-radius,x+radius,y+radius),fill=color)
        if idx%3==0:
            d.line((x-3*radius,y,x+3*radius,y),fill=(*lime,53),width=1)
            d.line((x,y-3*radius,x,y+3*radius),fill=(*lime,53),width=1)
    return Image.alpha_composite(image,graphics)



def _headline_layout(name: str, draw: ImageDraw.ImageDraw):
    """Fit any reasonable SKU name using exact words, with no truncation.

    Uppercase is styling only; accents are retained. The face is purpose-made
    for heavy condensed display and retains impact even at narrower widths.
    """
    title = " ".join(name.split()).upper()
    if not (2 <= len(title) <= 120):
        raise ValueError("Unusable catalogue title")
    for size in range(102, 25, -2):
        font = load_font(size)
        lines = []
        line = ""
        for word in title.split():
            candidate = (line+" "+word).strip()
            if line and draw.textbbox((0, 0), candidate, font=font)[2] > W-78:
                lines.append(line)
                line = word
            else:
                line = candidate
        if line:
            lines.append(line)
        line_height = round(size*.96)
        if (len(lines) <= 6 and 56+len(lines)*line_height <= 448 and
            all(draw.textbbox((0, 0), item, font=font)[2] <= W-78 for item in lines)):
            return lines, font, line_height
    raise ValueError("Title cannot fit without losing its exact catalogue wording")


def _fit_product(subject: Image.Image, variant: int, title_bottom: int = 270):
    """Keep the entire physical silhouette huge, clear of the actual title."""
    if variant not in (1, 2, 3):
        raise ValueError("Invalid variant")
    top = max(288, title_bottom + 30)
    bottom = H - 34
    if top >= bottom - 350:
        raise SubjectExtractionError("Title leaves insufficient room for a real product")
    max_width = W-38
    max_height = bottom-top
    ratio = min(max_width/subject.width, max_height/subject.height)
    pw, ph = max(1, round(subject.width*ratio)), max(1, round(subject.height*ratio))
    fitted = subject.resize((pw, ph), Image.Resampling.LANCZOS)
    center_x = {1: 369, 2: 383, 3: 355}[variant]
    x = round(center_x - pw/2)
    x = min(max(18, x), W-pw-18)
    y = round(top + (max_height-ph)*.53)
    if x < 18 or x+pw > W-18 or y < top or y+ph > bottom:
        raise SubjectExtractionError("Physical product does not fit editorial frame")
    return fitted, x, y


def _shadow_product(subject: Image.Image, x: int, y: int):
    alpha = subject.getchannel("A").filter(ImageFilter.GaussianBlur(26))
    alpha = alpha.point(lambda value: round(value*.32))
    shadow = Image.new("RGBA", subject.size, (28, 27, 23, 0))
    shadow.putalpha(alpha)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    # Keep shadow inside canvas without cropping the physical product itself.
    sx = min(x+6, W-subject.width)
    sy = min(y+18, H-subject.height)
    layer.alpha_composite(shadow, (sx, sy))
    return layer


def build_poster(scene: Image.Image, original: Optional[Image.Image],
                 product_name: str, price: Optional[float], variant: int, *,
                 reference_mode: str = "catalog_reference",
                 subject: Optional[Image.Image] = None) -> Image.Image:
    """Only the SKU name and product silhouette are visible on the cover."""
    if variant not in (1, 2, 3):
        raise ValueError("Invalid variant")
    if reference_mode not in MODES:
        raise ValueError("Invalid reference mode")
    if original is not None:
        source_quality(original)
    if not isinstance(product_name, str):
        raise ValueError("Missing catalogue name")
    if price is not None:
        price = float(price)
        if not math.isfinite(price) or price <= 0:
            raise ValueError("Invalid incoming catalogue price")

    art = _editorial_background(variant)
    draw = ImageDraw.Draw(art)
    lines, font, line_height = _headline_layout(product_name, draw)
    title_y = 52
    lime=rgb(THEME["estilo"]["colores"]["acento_lima"])
    for index,line in enumerate(lines):
        # Contrast-led typography; the final line can use the brand's lime
        # accent, but no additional words or badges are drawn.
        color=lime if len(lines)>1 and index==len(lines)-1 else INK
        draw.text((39,title_y+index*line_height),line,font=font,fill=color)
    title_bottom=title_y+len(lines)*line_height
    # A restrained editorial stroke, not a separate section/CTA.
    decoration=ImageDraw.Draw(art,"RGBA")
    decoration.rounded_rectangle(
        (39,title_bottom+7,149,title_bottom+11),
        radius=2,fill=(*lime,203)
    )

    product = _extract_subject(scene) if subject is None else _check_subject(subject)
    fitted, x, y = _fit_product(product, variant, title_bottom)
    art = Image.alpha_composite(art, _shadow_product(fitted, x, y))
    art.alpha_composite(fitted, (x, y))
    return art.convert("RGB")


def jpeg_bytes(image: Image.Image) -> bytes:
    output = BytesIO()
    image.save(output, "JPEG", quality=94, optimize=True, subsampling=0)
    data = output.getvalue()
    if not (15000 <= len(data) <= 7*1024*1024):
        raise ValueError("Private poster JPEG size outside bounds")
    return data


def render_to_file(scene_path: str, original_path: Optional[str],
                   product: str, price: Optional[float], variant: int,
                   output: str, reference_mode: str = "catalog_reference") -> str:
    with Image.open(scene_path) as scene:
        if original_path:
            with Image.open(original_path) as orig:
                data = jpeg_bytes(build_poster(scene, orig, product, price, variant,
                                               reference_mode=reference_mode))
        else:
            data = jpeg_bytes(build_poster(scene, None, product, price, variant,
                                           reference_mode="conceptual"))
    Path(output).write_bytes(data)
    return output

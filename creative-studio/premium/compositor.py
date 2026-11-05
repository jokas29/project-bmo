"""DropEC Premium: a single editorial advertising composition, not stacked panels.

A blurred, color-graded continuation of the FLUX scene fills the entire 4:5
canvas. The WHOLE generated scene is contained as a feather-blended foreground;
photographs from the catalogue are only inference references, never pasted
ads. Typography and price are laid out over genuine negative space, with no
opaque header, photo rectangle or footer card. Owner review remains mandatory.
"""
from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Optional
import math

from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageFilter

W, H = 1080, 1350
LIME = (204, 255, 82)
WHITE = (250, 247, 255)
PLUM = (24, 8, 48)
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

# These are bounds for content placement, not boundaries between panels.
HERO_TOP, HERO_BOTTOM = 295, 1200
MODES = frozenset(("catalog_reference", "promotional_reference",
                   "low_resolution_reference", "conceptual", "legacy_overlay"))

# Every variant works for every product. Different palette/alignment gives each
# concept a considered editorial identity instead of recoloring a fixed card.
STYLES = {
    1: dict(tint=(27, 8, 49), pale=False, align="left", halo=(136, 80, 207)),
    2: dict(tint=(53, 12, 78), pale=False, align="right", halo=(165, 70, 173)),
    3: dict(tint=(239, 236, 233), pale=True, align="left", halo=(155, 117, 189)),
}


def load_font(size: int, bold: bool = True) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR, size)
    except OSError:
        return ImageFont.load_default()


def source_quality(image: Image.Image) -> None:
    """Photo references are only hints; this does not verify product identity."""
    if min(image.size) < 160:
        raise ValueError(f"source resolution too small: {image.width}x{image.height}")
    if max(image.size) > 9000:
        raise ValueError("source resolution invalid")
    if max(image.size) / max(1, min(image.size)) > 4:
        raise ValueError("source aspect ratio invalid")


def fit_lines(text: str, width: int, draw: ImageDraw.ImageDraw,
              max_size: int = 74, max_lines: int = 3) -> tuple[list[str], ImageFont.ImageFont]:
    """Fit the exact product name without clipping, inventing or abbreviating."""
    cleaned = " ".join(str(text).split())
    if not cleaned or len(cleaned) > 120:
        raise ValueError("product name missing or too long")
    for size in range(max_size, 29, -2):
        font = load_font(size)
        lines: list[str] = []
        line = ""
        for word in cleaned.split():
            candidate = (line + " " + word).strip()
            if line and draw.textbbox((0, 0), candidate, font=font)[2] > width:
                lines.append(line)
                line = word
            else:
                line = candidate
        if line:
            lines.append(line)
        if len(lines) <= max_lines and all(
            draw.textbbox((0, 0), part, font=font)[2] <= width for part in lines
        ):
            return lines, font
    raise ValueError("product title cannot fit without clipping")


def _full_scene_geometry(scene: Image.Image, top: int, bottom: int
                         ) -> tuple[int, int, int, int]:
    """Contain EVERY source pixel within the visual field; never use cover-crop."""
    if min(scene.size) < 512:
        raise ValueError("generated scene too small")
    height = bottom - top
    if height < 630:
        raise ValueError("title leaves insufficient height for complete product")
    ratio = min((W - 64) / scene.width, height / scene.height)
    width = max(1, int(round(scene.width * ratio)))
    scaled_height = max(1, int(round(scene.height * ratio)))
    return ((W - width)//2, top + (height - scaled_height)//2,
            width, scaled_height)


def _background(scene: Image.Image, variant: int) -> Image.Image:
    """One continuous full-canvas background derived from the exact FLUX scene."""
    style = STYLES[variant]
    # Blurred continuation provides consistent scenery at top, sides & bottom.
    scene = ImageOps.exif_transpose(scene).convert("RGB")
    full = ImageOps.fit(scene, (W, H),
                        method=Image.Resampling.LANCZOS).filter(
                            ImageFilter.GaussianBlur(56)).convert("RGBA")
    tint_strength = 192 if style["pale"] else 157
    full = Image.alpha_composite(
        full, Image.new("RGBA", (W, H), (*style["tint"], tint_strength))
    )
    wash = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    stroke = ImageDraw.Draw(wash, "RGBA")
    shade = (248, 244, 240) if style["pale"] else (11, 3, 28)
    # Smooth shading across the canvas, not visible header/footer bands.
    for y in range(H):
        top = max(0.0, (600-y)/600)
        bottom = max(0.0, (y-965)/(H-965))
        opacity = int(126*top*top + 155*bottom*bottom)
        if opacity:
            stroke.line((0, y, W, y), fill=(*shade, min(235, opacity)))
    return Image.alpha_composite(full, wash)


def _feathered_foreground(scene: Image.Image, poster: Image.Image,
                          top: int, bottom: int) -> tuple[int, int, int, int]:
    """Blend ALL of the FLUX scene onto the same background without a frame.

    Feathering touches only outer scene margins; the prompt reserves at least
    12% around the actual product. If FLUX itself crops the product, no
    compositor can reconstruct missing physical parts.
    """
    source = ImageOps.exif_transpose(scene).convert("RGB")
    x, y, w, h = _full_scene_geometry(source, top, bottom)
    foreground = source.resize((w, h), Image.Resampling.LANCZOS).convert("RGBA")
    margin = max(30, min(w, h)//13)
    mask = Image.new("L", (w,h), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((margin,margin,w-margin-1,h-margin-1),
                        radius=min(100,margin),fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(max(18,margin//2)))
    # The foreground interior remains 100% real model output.
    poster.paste(foreground, (x,y), mask)
    return x, y, w, h


def _text(draw: ImageDraw.ImageDraw, xy: tuple[int,int], text: str,
          font: ImageFont.ImageFont, fill: tuple[int,int,int],
          shadow: tuple[int,int,int], align: str = "left") -> None:
    # A tiny glyph shadow improves legibility without any opaque text panel.
    x,y=xy
    draw.text((x+2,y+3), text, font=font, fill=(*shadow,95), anchor=None)
    draw.text((x,y), text, font=font, fill=(*fill,255), anchor=None)


def _price_font(draw: ImageDraw.ImageDraw, value: float) -> tuple[str,ImageFont.ImageFont]:
    title=f"${value:,.2f}"
    for size in range(66,31,-2):
        font=load_font(size)
        if draw.textbbox((0,0),title,font=font)[2] <= 875:
            return title,font
    raise ValueError("price does not fit canvas")


def build_poster(scene: Image.Image, original: Optional[Image.Image],
                 product_name: str, price: Optional[float], variant: int, *,
                 reference_mode: str = "catalog_reference") -> Image.Image:
    """Generate unified 1080x1350 artwork with safe product/text placement."""
    if variant not in STYLES:
        raise ValueError("invalid variant")
    if reference_mode not in MODES:
        raise ValueError("invalid reference mode")
    if original is not None:
        source_quality(original)
    if not isinstance(product_name,str):
        raise ValueError("missing product name")
    if price is not None:
        price=float(price)
        if not math.isfinite(price) or price<=0:
            raise ValueError("invalid price")

    style=STYLES[variant]
    poster=_background(scene,variant)
    draw=ImageDraw.Draw(poster,"RGBA")
    title_lines,font=fit_lines(product_name,940,draw,76 if variant==1 else 71)
    spacing=int(getattr(font,"size",62)*1.17)
    title_y=158 if variant!=3 else 167
    title_bottom=title_y+len(title_lines)*spacing
    hero_top=max(HERO_TOP,title_bottom+20)
    # The hero and its 12%-clearance foreground must remain above all pricing.
    _full_scene_geometry(scene,hero_top,HERO_BOTTOM)

    text_color=(36,13,62) if style["pale"] else WHITE
    shadow=(248,248,248) if style["pale"] else (8,3,24)
    accent=(91,38,148) if style["pale"] else LIME

    # Typography behind the hero evokes editorial product campaigns. It is
    # deliberately occluded by the blended foreground, never pasted over SKU.
    ghost=ImageDraw.Draw(poster,"RGBA")
    ghost_font=load_font(162)
    ghost.fill=(0,0,0,0)
    ghost.text((36,610),"DropEC",font=ghost_font,
               fill=(*(77,43,114) if style["pale"] else WHITE,35))
    _feathered_foreground(scene,poster,hero_top,HERO_BOTTOM)
    draw=ImageDraw.Draw(poster,"RGBA")
    # Brand/wordmark floats in the top negative space, no pill or header stripe.
    _text(draw,(62,41),"DropEC",load_font(40),accent,shadow)
    small_label="TIENDA ONLINE"
    label_font=load_font(17,False)
    label_width=draw.textbbox((0,0),small_label,font=label_font)[2]
    _text(draw,(W-label_width-62,62),small_label,label_font,text_color,shadow)

    for index,line in enumerate(title_lines):
        width=draw.textbbox((0,0),line,font=font)[2]
        pos_x=(W-width-64) if style["align"]=="right" else 64
        # These lines are all above the contained foreground, never on product.
        _text(draw,(pos_x,title_y+index*spacing),line,font,text_color,shadow)

    # Price and CTA share the SAME continuous canvas. No footer card, border,
    # opaque rectangle or line divides text from image.
    note_font=load_font(19,False)
    price_label="PRECIO DE CATÁLOGO" if price is not None else "CONSULTA DISPONIBILIDAD"
    right=style["align"]=="right"
    def x_for(t: str,f: ImageFont.ImageFont):
        tw=draw.textbbox((0,0),t,font=f)[2]
        return W-66-tw if right else 66
    _text(draw,(x_for(price_label,note_font),1206),price_label,note_font,text_color,shadow)
    if price is None:
        amount,amount_font="Solicita información",load_font(36)
    else:
        amount,amount_font=_price_font(draw,price)
    _text(draw,(x_for(amount,amount_font),1233),amount,amount_font,accent,shadow)
    cta="Solicita tu cotización  ·  Envío por confirmar"
    cta_font=load_font(19,False)
    _text(draw,(x_for(cta,cta_font),1301),cta,cta_font,text_color,shadow)

    if reference_mode=="conceptual" or original is None:
        marker="IMAGEN ILUSTRATIVA · MODELO NO VERIFICADO"
        marker_font=load_font(15,False)
        # Keep the notice visible but non-obstructing; position in price margin.
        _text(draw,(x_for(marker,marker_font),1182),marker,marker_font,text_color,shadow)
    return poster.convert("RGB")


def jpeg_bytes(image: Image.Image) -> bytes:
    result=BytesIO()
    image.save(result,"JPEG",quality=91,optimize=True,subsampling=0)
    data=result.getvalue()
    if not (15000<=len(data)<=7*1024*1024):
        raise ValueError("poster JPEG byte length out of bounds")
    return data


def render_to_file(scene_path: str, original_path: Optional[str], product: str,
                   price: Optional[float], variant: int, output: str,
                   reference_mode: str = "catalog_reference") -> str:
    with Image.open(scene_path) as scene:
        if original_path:
            with Image.open(original_path) as original:
                data=jpeg_bytes(build_poster(scene,original,product,price,variant,
                                             reference_mode=reference_mode))
        else:
            data=jpeg_bytes(build_poster(scene,None,product,price,variant,
                                         reference_mode="conceptual"))
    Path(output).write_bytes(data)
    return output

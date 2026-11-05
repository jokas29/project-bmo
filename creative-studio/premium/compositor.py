"""Universal DropEC premium compositor: entire generated product scene, no cropping.

The hero image is fitted in a dedicated foreground layer. All catalogue
text and price elements live OUTSIDE its rectangle. No semantic object crop or
replacement is inferred, so actual SKU fidelity still requires owner review.
This is private staging artwork: never publishes anything.
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
DARK = (15, 8, 32)
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

# Hero sits ABOVE the price panel and BELOW the title. The dimensions can be
# derived from the actual product title, but never from a specific Woo product.
HERO_TOP, HERO_BOTTOM = 350, 1150
PRICE_PANEL_TOP = 1163
MODES = frozenset((
    "catalog_reference", "promotional_reference",
    "low_resolution_reference", "conceptual", "legacy_overlay"
))


def load_font(size: int, bold: bool = True) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR, size)
    except OSError:
        return ImageFont.load_default()


def source_quality(image: Image.Image) -> None:
    """Identity reference must be usable, but no pixels are pasted to artwork."""
    if min(image.size) < 160:
        raise ValueError(f"source resolution too small: {image.width}x{image.height}")
    if max(image.size) > 9000:
        raise ValueError("source resolution invalid")
    if max(image.size) / max(1, min(image.size)) > 4:
        raise ValueError("source aspect ratio invalid")


def fit_lines(text: str, width: int, draw: ImageDraw.ImageDraw,
              max_size: int = 69, max_lines: int = 3) -> tuple[list[str], ImageFont.ImageFont]:
    """Render the full catalogue name, never a clipped or invented rewrite."""
    cleaned = " ".join(str(text).split())
    if not cleaned or len(cleaned) > 120:
        raise ValueError("product name missing or too long")
    for size in range(max_size, 31, -2):
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
            draw.textbbox((0, 0), line, font=font)[2] <= width for line in lines
        ):
            return lines, font
    raise ValueError("product title cannot fit without clipping")


def _full_scene_geometry(scene: Image.Image, top: int, bottom: int) -> tuple[int, int, int, int]:
    """Contain the WHOLE generated image, never crop its top, base or edges."""
    if min(scene.size) < 512:
        raise ValueError("generated scene too small")
    available_h = bottom - top
    if available_h < 600:
        raise ValueError("catalogue title leaves insufficient space for whole product")
    ratio = min(W / scene.width, available_h / scene.height)
    scaled_w = max(1, int(round(scene.width * ratio)))
    scaled_h = max(1, int(round(scene.height * ratio)))
    return ((W - scaled_w) // 2, top + (available_h - scaled_h) // 2,
            scaled_w, scaled_h)


def _scene_hero(scene: Image.Image, top: int, bottom: int) -> Image.Image:
    """The original FLUX scene is foreground, its enlarged blurred pixels fill sides.

    No image segmentation or opaque product-covering footer. The complete
    generated scene is preserved inside the foreground rectangle.
    """
    source = ImageOps.exif_transpose(scene).convert("RGB")
    hero_h = bottom - top
    background = ImageOps.fit(source, (W, hero_h),
                              method=Image.Resampling.LANCZOS)
    background = background.filter(ImageFilter.GaussianBlur(36)).convert("RGBA")
    # The background is a blurred continuation, not another copy of the
    # catalogue listing. It creates a seamless premium canvas at any ratio.
    veil = Image.new("RGBA", (W, hero_h), (28, 10, 52, 77))
    background = Image.alpha_composite(background, veil)
    x, y, w, h = _full_scene_geometry(source, top, bottom)
    intact = source.resize((w, h), Image.Resampling.LANCZOS).convert("RGBA")
    background.alpha_composite(intact, (x, y - top))
    return background


def _fit_price(price: float, draw: ImageDraw.ImageDraw) -> tuple[str, ImageFont.ImageFont]:
    label = f"${price:,.2f}"
    for size in range(55, 33, -2):
        font = load_font(size)
        if draw.textbbox((0, 0), label, font=font)[2] < 900:
            return label, font
    raise ValueError("price cannot be displayed without clipping")


def build_poster(scene: Image.Image, original: Optional[Image.Image], product_name: str,
                 price: Optional[float], variant: int, *,
                 reference_mode: str = "catalog_reference") -> Image.Image:
    """Create a 1080x1350 private ad with a full, UNOBSTRUCTED AI scene.

    The original photo is a non-rendered identity reference only. Since we
    cannot guarantee FLUX did not clip the actual subject, owners must still
    inspect and reject crops present in the generated scene itself.
    """
    if variant not in (1, 2, 3):
        raise ValueError("invalid variant")
    if reference_mode not in MODES:
        raise ValueError("invalid reference mode")
    if original is not None:
        source_quality(original)
    if not isinstance(product_name, str):
        raise ValueError("missing product name")
    if price is not None:
        price = float(price)
        if not math.isfinite(price) or price <= 0:
            raise ValueError("invalid price")

    poster = Image.new("RGBA", (W, H), (20, 6, 41, 255))
    draw = ImageDraw.Draw(poster, "RGBA")
    lines, font = fit_lines(product_name, 944, draw)
    line_height = int(getattr(font, "size", 62) * 1.23)
    title_start = 165
    title_bottom = title_start + line_height * len(lines)
    hero_top = max(HERO_TOP, title_bottom + 16)
    x, y, w, h = _full_scene_geometry(scene, hero_top, HERO_BOTTOM)
    hero = _scene_hero(scene, hero_top, HERO_BOTTOM)
    poster.alpha_composite(hero, (0, hero_top))
    draw = ImageDraw.Draw(poster, "RGBA")

    # Header is fully above the image; no product can be hidden by the title.
    draw.rounded_rectangle((57, 38, 335, 111), radius=34, fill=(*LIME, 255))
    draw.text((86, 48), "DropEC", font=load_font(42), fill=(*DARK, 255))
    draw.text((805, 62), f"DISEÑO {variant}/3", font=load_font(22, False),
              fill=(*WHITE, 255))
    draw.rounded_rectangle((57, 133, 1023, 140), radius=3, fill=(*LIME, 255))
    for index, line in enumerate(lines):
        draw.text((65, title_start + index * line_height), line, font=font,
                  fill=(*WHITE, 255))

    # Price/info panel is physically BELOW the entire rendered image, so the
    # product can never disappear behind it regardless of reference/variant.
    draw.rounded_rectangle((50, PRICE_PANEL_TOP, 1030, 1326),
                           radius=26, fill=(41, 9, 77, 255))
    draw.text((82, 1179), "PRECIO DE CATÁLOGO" if price is not None else
              "CONSULTA DISPONIBILIDAD", font=load_font(19, False),
              fill=(*WHITE, 255))
    if price is not None:
        label, price_font = _fit_price(price, draw)
        draw.text((82, 1210), label, font=price_font, fill=(*LIME, 255))
    else:
        draw.text((82, 1216), "Solicita información", font=load_font(35),
                  fill=(*LIME, 255))
    draw.text((82, 1285), "Solicita tu cotización  •  Envío por confirmar",
              font=load_font(19, False), fill=(*WHITE, 255))

    # A concept without verified source must never look like a SKU photograph.
    if reference_mode == "conceptual" or original is None:
        draw.rounded_rectangle((613, 1180, 1007, 1211), radius=9,
                               fill=(18, 5, 33, 245))
        draw.text((629, 1187), "IMAGEN ILUSTRATIVA · NO VERIFICADA",
                  font=load_font(16, False), fill=(*WHITE, 255))
    return poster.convert("RGB")


def jpeg_bytes(image: Image.Image) -> bytes:
    output = BytesIO()
    image.save(output, "JPEG", quality=91, optimize=True, subsampling=0)
    data = output.getvalue()
    if not (15000 <= len(data) <= 7 * 1024 * 1024):
        raise ValueError("poster JPEG byte length out of bounds")
    return data


def render_to_file(scene_path: str, original_path: Optional[str], product: str,
                   price: Optional[float], variant: int, output: str,
                   reference_mode: str = "catalog_reference") -> str:
    with Image.open(scene_path) as scene:
        if original_path:
            with Image.open(original_path) as original:
                data = jpeg_bytes(build_poster(scene, original, product, price,
                                               variant, reference_mode=reference_mode))
        else:
            data = jpeg_bytes(build_poster(scene, None, product, price,
                                           variant, reference_mode="conceptual"))
    Path(output).write_bytes(data)
    return output

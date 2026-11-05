"""Universal DropEC premium scene compositor (staging-only).

FLUX supplies the entire visual scene; the original photo is a *reference*, never
a pasted poster/photo panel. This compositor adds only deterministic branding,
catalogue price, title and CTA in reserved margins. It never publishes.
"""
from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Optional
import math

from PIL import Image, ImageDraw, ImageFont, ImageOps

W, H = 1080, 1350
LIME = (204, 255, 82)
WHITE = (250, 247, 255)
DARK = (15, 8, 32)
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
# Safe hero band contains the AI subject. Text overlays are outside this band.
HERO_TOP, HERO_BOTTOM = 450, 1090
MODES = frozenset(("catalog_reference", "promotional_reference", "low_resolution_reference", "conceptual", "legacy_overlay"))


def load_font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR, size)
    except OSError:
        return ImageFont.load_default()


def source_quality(image: Image.Image) -> None:
    """Minimum useful identity reference. This is NOT a fidelity guarantee."""
    if min(image.size) < 160:
        raise ValueError(f"source resolution too small: {image.width}x{image.height}")
    if max(image.size) > 9000:
        raise ValueError("source resolution invalid")
    if max(image.size) / max(1, min(image.size)) > 4:
        raise ValueError("source aspect ratio invalid")


def fit_lines(text: str, width: int, draw: ImageDraw.ImageDraw,
              max_size: int = 70, max_lines: int = 3) -> tuple[list[str], ImageFont.ImageFont]:
    """Fit unmodified, verified product name. Never clip or silently truncate."""
    cleaned = " ".join(str(text).split())
    if not cleaned or len(cleaned) > 120:
        raise ValueError("product title missing or too long")
    for size in range(max_size, 31, -2):
        font = load_font(size)
        lines: list[str] = []
        line = ""
        for word in cleaned.split():
            proposal = (line + " " + word).strip()
            if line and draw.textbbox((0, 0), proposal, font=font)[2] > width:
                lines.append(line)
                line = word
            else:
                line = proposal
        if line:
            lines.append(line)
        if (len(lines) <= max_lines and
            all(draw.textbbox((0, 0), value, font=font)[2] <= width for value in lines)):
            return lines, font
    raise ValueError("Product name is too long to render safely without truncation")


def _shade_margin(image: Image.Image, top: bool) -> Image.Image:
    """Only tint dedicated typography margins; preserve central AI imagery."""
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(overlay, "RGBA")
    if top:
        for y in range(0, HERO_TOP):
            strength = int(244 * (1 - (y / HERO_TOP) ** 2) + 4)
            dr.line((0, y, W, y), fill=(16, 5, 35, min(250, strength)))
    else:
        for y in range(HERO_BOTTOM, H):
            relative = (y - HERO_BOTTOM) / (H - HERO_BOTTOM)
            strength = int(172 + 72 * relative)
            dr.line((0, y, W, y), fill=(20, 5, 43, min(248, strength)))
    return Image.alpha_composite(image, overlay)


def build_poster(scene: Image.Image, original: Optional[Image.Image], product_name: str,
                 price: Optional[float], variant: int, *,
                 reference_mode: str = "catalog_reference") -> Image.Image:
    """Create 1080×1350 ad with genuine full-bleed FLUX scene.

    `original` is used only for input/reference validation; it is intentionally
    NEVER alpha-composited, pasted, redrawn or placed on a billboard.
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

    scenery = ImageOps.fit(ImageOps.exif_transpose(scene).convert("RGB"), (W, H),
                           method=Image.Resampling.LANCZOS).convert("RGBA")
    # Keep every original central pixel unchanged even when scene has high detail.
    poster = _shade_margin(_shade_margin(scenery, True), False)
    draw = ImageDraw.Draw(poster, "RGBA")

    draw.rounded_rectangle((58, 47, 342, 123), radius=36, fill=(*LIME, 255))
    draw.text((88, 59), "DropEC", font=load_font(43), fill=(*DARK, 255))
    draw.text((797, 74), f"DISEÑO {variant}/3", font=load_font(22, False),
              fill=(*WHITE, 245))
    draw.rounded_rectangle((60, 151, 1018, 157), radius=3, fill=(*LIME, 250))

    lines, font = fit_lines(product_name, 936, draw, max_size=72, max_lines=3)
    line_height = int(getattr(font, "size", 63) * 1.18)
    title_bottom = 205 + line_height * len(lines)
    if title_bottom > HERO_TOP - 8:
        raise ValueError("title overlaps the image hero area")
    for index, line in enumerate(lines):
        draw.text((66, 200 + index * line_height), line, font=font,
                  fill=(*WHITE, 255), stroke_width=1, stroke_fill=(25, 8, 45, 220))

    # Compact bottom info only; no white rectangular product card.
    draw.rounded_rectangle((58, 1110, 1022, 1320), radius=28,
                           fill=(36, 9, 65, 210))
    draw.text((88, 1132), "PRECIO REFERENCIAL" if price is not None else
              "CONSULTA DISPONIBILIDAD", font=load_font(22, False), fill=(*WHITE, 245))
    if price is not None:
        draw.text((88, 1167), f"${price:,.2f}", font=load_font(57),
                  fill=(*LIME, 255))
    else:
        draw.text((88, 1174), "Solicita información", font=load_font(37),
                  fill=(*LIME, 255))
    draw.text((88, 1265), "Solicita tu cotización  •  Envío por confirmar",
              font=load_font(21, False), fill=(*WHITE, 245))

    # No source means an imagined conceptual illustration. Label it clearly
    # in the export, not only in Studio's review comments.
    if reference_mode == "conceptual" or original is None:
        disclaimer = "IMAGEN ILUSTRATIVA · MODELO NO VERIFICADO"
        font_small = load_font(17)
        draw.rounded_rectangle((58, 1063, 691, 1104), radius=12,
                               fill=(14, 4, 29, 220))
        draw.text((73, 1075), disclaimer, font=font_small,
                  fill=(*WHITE, 255))
    return poster.convert("RGB")


def jpeg_bytes(image: Image.Image) -> bytes:
    result = BytesIO()
    image.save(result, "JPEG", quality=91, optimize=True, subsampling=0)
    data = result.getvalue()
    if not (15000 <= len(data) <= 7 * 1024 * 1024):
        raise ValueError("poster JPEG byte length out of bounds")
    return data


def render_to_file(scene_path: str, original_path: Optional[str], product: str,
                   price: Optional[float], variant: int, output: str,
                   reference_mode: str = "catalog_reference") -> str:
    with Image.open(scene_path) as scene:
        if original_path:
            with Image.open(original_path) as original:
                data = jpeg_bytes(build_poster(scene, original, product, price, variant,
                                               reference_mode=reference_mode))
        else:
            data = jpeg_bytes(build_poster(scene, None, product, price, variant,
                                           reference_mode="conceptual"))
    Path(output).write_bytes(data)
    return output

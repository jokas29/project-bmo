"""DropEC Premium cover: product name + foreground product, nothing else.

The layout is intentionally reusable for every SKU. An open-license, condensed
Anton display face creates the expressive title. The whole FLUX product is
cut out with local CPU rembg, then placed on a quiet neutral background, in
front of the optional architectural gray strip. No promotional copy, edition
index, price, wordmark, CTA, invented claims or contact in the JPEG.
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


def _editorial_background(variant: int):
    """Just neutral paper and a quiet architectural strip; never textual art."""
    if variant not in (1, 2, 3):
        raise ValueError("Invalid variant")
    art = Image.new("RGBA", (W, H), (*BG, 255))
    d = ImageDraw.Draw(art)
    if THEME["composicion"]["panel_central"]["habilitado"]:
        x = {1: 329, 2: 317, 3: 345}[variant]
        pw = round(W*.28)
        d.rectangle((x, 0, x+pw, round(H*.92)), fill=(*PANEL, 255))
    return art


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
    alpha = subject.getchannel("A").filter(ImageFilter.GaussianBlur(19))
    alpha = alpha.point(lambda value: round(value*.23))
    shadow = Image.new("RGBA", subject.size, (28, 27, 23, 0))
    shadow.putalpha(alpha)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    # Keep shadow inside canvas without cropping the physical product itself.
    sx = min(x+6, W-subject.width)
    sy = min(y+12, H-subject.height)
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
    for index, line in enumerate(lines):
        draw.text((39, title_y+index*line_height), line, font=font, fill=INK)
    title_bottom = title_y + len(lines)*line_height

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

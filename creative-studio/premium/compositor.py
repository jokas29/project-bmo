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
        # Center each visual line individually, including visible glyph
        # bearings, so accented words are visually balanced at any length.
        color=lime if len(lines)>1 and index==len(lines)-1 else INK
        left,top,right,bottom=draw.textbbox((0,0),line,font=font)
        x=round((W-(right-left))/2-left)
        draw.text((x,title_y+index*line_height),line,font=font,fill=color)
    title_bottom=title_y+len(lines)*line_height
    # Centered editorial accent; no added letters or advertising slogans.
    decoration=ImageDraw.Draw(art,"RGBA")
    decoration.rounded_rectangle(
        (round(W/2)-53,title_bottom+7,round(W/2)+53,title_bottom+11),
        radius=2,fill=(*lime,203)
    )

    product = _extract_subject(scene) if subject is None else _check_subject(subject)
    fitted, x, y = _fit_product(product, variant, title_bottom)
    art = Image.alpha_composite(art, _shadow_product(fitted, x, y))
    art.alpha_composite(fitted, (x, y))
    return art.convert("RGB")


def _fit_carousel_subject(subject: Image.Image, slide_number: int,
                          reserved_top: int, reserved_bottom: int):
    """Large complete hero with composition offsets, no clipped attachments."""
    if slide_number not in (2,3,4):
        raise ValueError("Interior slide must be 2, 3 or 4")
    top=max(205,reserved_top+23)
    bottom=H-reserved_bottom
    if top>=bottom-325:
        raise SubjectExtractionError("No safe space for complete product")
    max_w=round(W*(.91 if slide_number!=4 else .78))
    max_h=bottom-top
    scale=min(max_w/subject.width,max_h/subject.height)
    w,h=max(1,round(subject.width*scale)),max(1,round(subject.height*scale))
    foreground=subject.resize((w,h),Image.Resampling.LANCZOS)
    center={2:394,3:343,4:408}[slide_number]
    x=max(15,min(W-w-15,round(center-w/2)))
    y=round(top+(bottom-top-h)*(.51 if slide_number!=3 else .42))
    if x<15 or x+w>W-15 or y<top or y+h>bottom:
        raise SubjectExtractionError("Interior composition clips product")
    return foreground,x,y


def _interior_title(canvas: Image.Image, value: str, *,
                    y: int=54, size: int=85, align: str="center"):
    """Only generic editorial storytelling; no invented physical benefits."""
    draw=ImageDraw.Draw(canvas)
    font=load_font(size)
    lime=rgb(THEME["estilo"]["colores"]["acento_lima"])
    # Allow only the three audited, marketing-safe headings below.
    allowed={"MÍRALO DE CERCA","OTRA PERSPECTIVA","¿TE INTERESA?"}
    if value not in allowed:
        raise ValueError("Unreviewed interior advertising claim")
    # Write each interior headline as two intentional typographic lines.
    words={
        "MÍRALO DE CERCA":("MÍRALO","DE CERCA"),
        "OTRA PERSPECTIVA":("OTRA","PERSPECTIVA"),
        "¿TE INTERESA?":("¿TE","INTERESA?"),
    }
    bottom=y
    for i,segment in enumerate(words[value]):
        weight=font
        width=draw.textbbox((0,0),segment,font=weight)[2]
        current=weight
        if width>W-58:
            for n in range(size-2,31,-2):
                trial=load_font(n)
                if draw.textbbox((0,0),segment,font=trial)[2]<=W-58:
                    current=trial
                    break
            else:
                raise ValueError("Interior headline does not fit")
        bounds=draw.textbbox((0,0),segment,font=current)
        x=round((W-(bounds[2]-bounds[0]))/2-bounds[0]) if align=="center" else 40
        position=y+i*round(size*.94)
        draw.text((x,position),segment,font=current,fill=lime if i==1 else INK)
        bottom=max(bottom,position+round(current.size*1.02))
    return bottom


def _story_headline(image: Image.Image, headline: str, *, y: int = 45,
                    max_bottom: int = 224, max_lines: int = 3):
    """Center each verified-copy line while retaining original Spanish accents."""
    if not isinstance(headline,str) or not 2<=len(headline.strip())<=90:
        raise ValueError("Invalid carousel headline")
    value=" ".join(headline.upper().split())
    if any(ch in value for ch in ("\n","\r","$","%")):
        raise ValueError("Unverified claim or pricing in scene headline")
    draw=ImageDraw.Draw(image)
    lime=rgb(THEME["estilo"]["colores"]["acento_lima"])
    for size in range(82,33,-2):
        font=load_font(size)
        lines=[]; current=""
        for word in value.split():
            candidate=(current+" "+word).strip()
            if current and draw.textbbox((0,0),candidate,font=font)[2]>W-76:
                lines.append(current); current=word
            else: current=candidate
        if current: lines.append(current)
        stride=round(size*.92)
        if len(lines)>max_lines or y+len(lines)*stride>max_bottom:continue
        if any(draw.textbbox((0,0),line,font=font)[2]>W-76 for line in lines):continue
        for index,line in enumerate(lines):
            bounds=draw.textbbox((0,0),line,font=font)
            x=round((W-(bounds[2]-bounds[0]))/2-bounds[0])
            draw.text((x,y+index*stride),line,font=font,
                      fill=lime if index==len(lines)-1 else INK)
        return y+len(lines)*stride
    raise ValueError("Carousel headline cannot fit")


def _contextual_photo(art: Image.Image, scene: Image.Image, *,
                      y: int, height: int, focus: float=.5):
    """Show generated photography including people; no subject extraction."""
    if min(scene.size)<640:raise ValueError("Context scene too small")
    photo=ImageOps.fit(ImageOps.exif_transpose(scene.convert("RGB")),
                       (W,height),method=Image.Resampling.LANCZOS,
                       centering=(focus,.5)).convert("RGBA")
    mask=Image.new("L",(W,height),0)
    strips=ImageDraw.Draw(mask)
    fade=min(98,max(30,height//6))
    for i in range(height):
        alpha=round(248*min(1,(i+1)/fade,(height-i)/fade))
        strips.line((0,i,W,i),fill=alpha)
    photo.putalpha(mask)
    art.alpha_composite(photo,(0,y))
    return art


def _clean_benefits(benefits: Optional[list[str]]) -> list[str]:
    """Render only three sourced benefit statements; never invent category copy.

    The authenticated queue verifies the source and requires owner review.
    This renderer independently fails closed when benefits are missing.
    """
    if not isinstance(benefits,(tuple,list)) or len(benefits)!=3:
        raise ValueError("Exactly three sourced benefits are required")
    cleaned=[]
    for item in benefits:
        if not isinstance(item,str):
            raise ValueError("Invalid benefit type")
        value=" ".join(item.upper().split())
        if (not 8<=len(value)<=66 or any(x in value for x in ("$","%","\\n","\\r")) or
            any(x in value for x in ("GARANTIZ","MILAGRO","CURA ","SIN ESFUERZO","100 POR CIENTO"))):
            raise ValueError("Unsupported or overly long product benefit")
        cleaned.append(value)
    if len(set(cleaned))!=3:
        raise ValueError("Product benefits must be distinct")
    return cleaned

def _benefit_cards(art: Image.Image, benefits: list[str]):
    lime=rgb(THEME["estilo"]["colores"]["acento_lima"])
    d=ImageDraw.Draw(art)
    for i,benefit in enumerate(benefits):
        top=654+i*139
        d.rounded_rectangle((33,top,W-33,top+125),radius=22,
                            fill=(41,20,74,242),outline=(132,88,177,230),width=2)
        d.text((58,top+24),f"0{i+1}",font=load_font(44),fill=lime)
        left=145; words=benefit.split()
        for size in range(41,24,-2):
            font=load_font(size)
            lines=[]; current=""
            for word in words:
                candidate=(current+" "+word).strip()
                if current and d.textbbox((0,0),candidate,font=font)[2]>W-left-68:
                    lines.append(current);current=word
                else:current=candidate
            if current:lines.append(current)
            if len(lines)<=2 and all(d.textbbox((0,0),s,font=font)[2]<=W-left-68 for s in lines):
                base_y=top+(125-len(lines)*round(size*1.04))//2
                for j,segment in enumerate(lines):
                    d.text((left,base_y+j*round(size*1.04)),segment,font=font,fill=INK)
                break
        else:raise ValueError("Benefit cannot fit in legible card")


def build_carousel_slide(scene: Image.Image, original: Optional[Image.Image],
                         product_name: str, price: Optional[float],
                         slide_number: int, *,
                         reference_mode: str="catalog_reference",
                         subject: Optional[Image.Image]=None,
                         headline: Optional[str]=None,
                         benefits: Optional[list[str]]=None) -> Image.Image:
    """Real-life use, three sourced benefits, and conversion. Cover is untouched."""
    if slide_number not in (2,3,4):
        raise ValueError("Only inner slides 2, 3 and 4")
    if reference_mode not in MODES:raise ValueError("Unapproved reference mode")
    if original is not None:source_quality(original)
    if not isinstance(product_name,str) or not 2<=len(product_name.strip())<=120:
        raise ValueError("Invalid catalogue product name")
    if price is not None:
        price=float(price)
        if not math.isfinite(price) or price<=0:
            raise ValueError("Invalid catalogue price")
    art=_editorial_background({2:3,3:1,4:2}[slide_number])
    lime=rgb(THEME["estilo"]["colores"]["acento_lima"])
    if slide_number==2:
        _story_headline(art,headline or "EN TU DÍA A DÍA",max_bottom=235)
        _contextual_photo(art,scene,y=218,height=877)
        return art.convert("RGB")
    if slide_number==3:
        _story_headline(art,"3 BENEFICIOS DEL PRODUCTO",max_bottom=208)
        _contextual_photo(art,scene,y=191,height=469)
        _benefit_cards(art,_clean_benefits(benefits))
        return art.convert("RGB")
    # Only the closing slide remains a whole-object hero on the studio stage.
    _interior_title(art,"¿TE INTERESA?",size=86)
    body=_extract_subject(scene) if subject is None else _check_subject(subject)
    foreground,x,y=_fit_carousel_subject(body,4,220,301)
    art=Image.alpha_composite(art,_shadow_product(foreground,x,y))
    art.alpha_composite(foreground,(x,y))
    d=ImageDraw.Draw(art)
    d.line((43,H-295,W-43,H-295),fill=(*lime,200),width=3)
    label="PRECIO DE CATÁLOGO"
    lf=load_font(29)
    bb=d.textbbox((0,0),label,font=lf)
    d.text((round((W-(bb[2]-bb[0]))/2-bb[0]),H-283),
           label,font=lf,fill=INK)
    amount="$"+format(price,",.2f") if price is not None else "PRECIO POR CONSULTAR"
    for size in range(84,29,-2):
        af=load_font(size)
        bb=d.textbbox((0,0),amount,font=af)
        if bb[2]-bb[0]<=W-92:break
    d.text((round((W-(bb[2]-bb[0]))/2-bb[0]),H-240),
           amount,font=af,fill=lime)
    contact="ESCRÍBENOS POR MENSAJE"
    cf=load_font(43)
    bb=d.textbbox((0,0),contact,font=cf)
    d.text((round((W-(bb[2]-bb[0]))/2-bb[0]),H-140),
           contact,font=cf,fill=INK)
    note="PRECIO Y DISPONIBILIDAD POR CONFIRMAR"
    nf=load_font(24)
    bb=d.textbbox((0,0),note,font=nf)
    d.text((round((W-(bb[2]-bb[0]))/2-bb[0]),H-63),
           note,font=nf,fill=INK)
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

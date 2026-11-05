"""Category-aware creative direction for ALL DropEC products.

Never invent product specifications, sizes, benefits or exact appearance.
An image reference from a listing is not proof that FLUX faithfully preserved
the item. Without a usable source, output is explicitly conceptual.
"""
from __future__ import annotations
import re
import unicodedata

_SCENES = (
    "Premium hero advertising photography, considered studio lighting, deep violet atmosphere with restrained neon-lime accent reflections.",
    "Editorial product photography, elegant angled studio perspective, polished shadows, controlled violet highlights, dynamic depth.",
    "Lifestyle-inspired product visualization in an appropriate everyday setting, natural dramatic light and refined commercial styling.",
)
_CONTEXT = {
    "cocina": ("cocina", "alimento", "olla", "cuchillo", "picador", "licuadora", "cortar", "utensilio", "horno", "sarten", "chef", "cafetera"),
    "tecnologia": ("electronico", "tecnologia", "auricular", "telefono", "cargador", "bluetooth", "computador", "usb", "parlante", "camara"),
    "herramientas": ("herramienta", "destornillador", "taladro", "martillo", "tornillo", "bricolaje", "mueble", "llave", "alicate"),
    "bienestar": ("cosmetico", "belleza", "piel", "maquillaje", "crema", "cabello", "cuidado", "masaje", "perfume", "salud"),
    "deporte": ("ejercicio", "entrenamiento", "deporte", "fitness", "mancuerna", "yoga", "bicicleta", "gimnasio"),
    "hogar": ("casa", "hogar", "decoracion", "limpieza", "organizador", "lampara", "almohada", "escritorio", "sofa"),
}
_CONTEXT_SCENE = {
    "cocina": "An uncluttered modern kitchen worktop with atmospheric practical lighting, not showing product operation.",
    "tecnologia": "Modern technology tabletop set with tasteful ambient light, no screens displaying invented interfaces.",
    "herramientas": "Neat neutral workshop table with realistic materials, no unsafe demonstrations.",
    "bienestar": "Elegant personal-care studio with subtle botanical elements, no implied medical effects.",
    "deporte": "Clean fitness editorial background with balanced natural textures, no performance claims.",
    "hogar": "Contemporary home interior backdrop with understated decor and generous uncluttered space.",
    "general": "Neutral premium editorial studio, no fabricated context, no additional accessories.",
}

def normalize(value: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFD", value.lower())
                   if unicodedata.category(ch) != "Mn")

def category_for_name(name: str) -> str:
    value = normalize(name)
    for category, words in _CONTEXT.items():
        if any(re.search(r"(?<!\w)" + re.escape(term) + r"\w*", value) for term in words):
            return category
    return "general"

def classify_reference(image) -> str:
    if image is None:
        return "conceptual"
    if min(image.size) < 160:
        return "conceptual"
    if min(image.size) < 400:
        return "low_resolution_reference"
    # Photo quality and identity are never certified by this heuristic.
    return "catalog_reference"

def scene_prompt(product_name: str, variant: int, reference_mode: str) -> str:
    if not isinstance(product_name, str) or not (2 <= len(product_name.strip()) <= 120):
        raise ValueError("Invalid product name")
    if variant not in (1, 2, 3):
        raise ValueError("Invalid concept variant")
    category = category_for_name(product_name)
    ref = reference_mode != "conceptual"
    instruction = (
        "Image 0 is a product LISTING REFERENCE. Reinterpret only the real physical item, "
        "not its original promotional background, logos, marketing text, diagram, graphics or packaging. "
        "Preserve its physical shape, parts, colors and proportions as closely as possible. "
        "Do not add missing features, components, accessories or interfaces. "
        if ref else
        "NO verified reference photo is provided. Create an atmospheric CONCEPTUAL "
        "representation of the product category only, not an exact or verified SKU. "
        "Avoid recognizable brand marks, precise model details or supposed functional components. "
    )
    return " ".join((
        instruction,
        _SCENES[variant - 1],
        _CONTEXT_SCENE[category],
        "ONE SQUARE 1:1 editorial photograph for a product-centered creative. "
        "The ENTIRE PHYSICAL PRODUCT must be visible at once from its highest point to its base and "
        "from leftmost to rightmost edge, including any protruding handles, cords or supports. "
        "Use a medium-wide camera angle and zoom OUT until the complete product fits in the INNER "
        "76% of the frame, with AT LEAST 12% background clearance on ALL FOUR EDGES. "
        "Never crop any part of the product, never cut off the bottom, never use an extreme closeup. "
        "The single product is the dominant foreground subject, IN FRONT of any decorative props, "
        "with realistic contact shadow and natural depth. Keep all garnish/props behind it and "
        "avoid elements touching or covering the product. "
        "NO writing, lettering, labels, badges, logos, prices, watermarks, buttons or numbers "
        "anywhere in the generated image. No invented benefits, warranty, health claims or measurements. "
        "Premium photographic detail and cohesive natural lighting.",
        "Product name for thematic context only: " + " ".join(product_name.split()) + ".",
    ))

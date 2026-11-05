"""Category-aware creative direction for ALL DropEC products.

Never invent product specifications, sizes, benefits or exact appearance.
An image reference from a listing is not proof that FLUX faithfully preserved
the item. Without a usable source, output is explicitly conceptual.
"""
from __future__ import annotations
import re
import unicodedata

_SCENES = (
    "High-end realistic product photography, three-quarter perspective, refined metallic and material reflections.",
    "Premium catalogue product photography from a slightly elevated three-quarter view, precise edges and soft studio lighting.",
    "Polished commercial product photo, angled slightly from the front, accurate materials, clear physical silhouette.",
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
    # The background is deliberately uniform: the free CPU segmentation
    # model removes it so that the product can overlap DropEC's actual organic
    # shapes. Do NOT ask FLUX to generate the final ad, brand, typography,
    # or another scene which would become a rectangular photo in the layout.
    return " ".join((
        instruction,
        _SCENES[variant-1],
        "Single physical product of category " + category + ".",
        "ONE isolated photorealistic ENTIRE PHYSICAL PRODUCT, entire object visible "
        "from highest to lowest point including handles, wires and accessories "
        "ONLY when actually attached in the reference. "
        "Keep AT LEAST 6% background clearance on ALL FOUR EDGES. "
        "Use an uncluttered FLAT solid matte light gray #E8E8E8 background "
        "which is one continuous uniform color from corner to corner, "
        "with NO horizon line, room, countertop, gradient, texture or objects. "
        "The product occupies 70-84% of the canvas with no cropped parts, "
        "natural commercial proportions and a crisp high-contrast silhouette. "
        "A soft subtle contact shadow directly under the product is acceptable, "
        "but NO props, no floating ingredients, no hands and no humans. "
        "NO split layout, no shape, no product collage, no text, no logos, "
        "no labels, no badges, no buttons and no graphic design. "
        "Do not fabricate capabilities, specifications or components. "
        "The DropEC compositor will add its own verified Spanish text and "
        "brand design after the product has been isolated.",
        "Product name for thematic context only: " + " ".join(product_name.split()) + ".",
    ))

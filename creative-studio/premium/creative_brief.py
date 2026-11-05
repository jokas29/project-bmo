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
    "cocina": ("cocina", "alimento", "olla", "cuchillo", "picador", "picadora", "ajo", "licuadora", "triturador", "procesador", "freidora", "cortar", "utensilio", "horno", "sarten", "chef", "cafetera"),
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


# Unlike the isolated-cover brief, these are explicit contextual scenes.
# The public ad is composited by Pillow; model-rendered text is prohibited.
_USAGE_CONTEXT = {
    "cocina": "A real adult cook in a tidy home kitchen gently operating the referenced kitchen item on a worktop, with appropriate fresh ingredients. If it is an electric food chopper, show the container closed with one hand pressing its existing top control while it rests on the worktop. Never touch blades, open a motorized appliance while running, or depict unknown accessories.",
    "tecnologia": "An adult using the referenced electronic item in a realistic home or desk setting, only with interaction supported by its visible physical controls. Avoid invented screens, app interfaces or connection ports.",
    "herramientas": "An adult demonstrating a safe, physically plausible use at a neat workshop bench. Include protective gear where appropriate; avoid high-risk, live electrical or hazardous-tool demonstrations.",
    "bienestar": "A person showing the product as part of an ordinary personal-care routine, with no treatment, medical, skin-transformation or efficacy implication.",
    "deporte": "An adult in a normal training setting interacting with the product safely. Never imply an athletic result, metric, injury prevention or medical benefit.",
    "hogar": "An adult using or placing the referenced product naturally in a real home setting without adding hidden features or accessories.",
    "general": "A real adult interacting with the product in an everyday location only if the depicted use is unambiguous from its appearance; otherwise show the person examining the item rather than inventing operation.",
}
_DETAIL_CONTEXT = {
    "cocina": "A realistic kitchen preparation still-life with the product beside ordinary fresh ingredients and a cutting board. No invented extra parts, no food inside a sealed product unless physically plausible.",
    "tecnologia": "A tasteful real desk setting with the product and a neutral notebook; avoid invented displays or app screenshots.",
    "herramientas": "A realistic clean workbench scene with the product and only neutral workshop surfaces, no staged hazardous use.",
    "bienestar": "An understated personal-care countertop and natural material details, no before-and-after comparison.",
    "deporte": "A clean gym or living-room practice context with the product and no promised results.",
    "hogar": "A tasteful lived-in interior with the product situated in context, no fabricated functions.",
    "general": "A realistic everyday setting appropriate to the item's verified appearance; no unverified operational scenario.",
}


def carousel_scene_prompt(product_name: str, slide_number: int, reference_mode: str) -> str:
    """Role-specific FLUX scene. People must remain in slide 2; scene 3 is contextual.

    The cover and sales close still use the isolated-product prompt. This
    function never asks FLUX to write claims, headlines, labels or prices.
    """
    if not isinstance(product_name, str) or not (2 <= len(product_name.strip()) <= 120):
        raise ValueError("Invalid product name")
    if slide_number not in (2, 3, 4):
        raise ValueError("Invalid carousel slide")
    if reference_mode not in ("catalog_reference","promotional_reference","low_resolution_reference","conceptual","legacy_overlay"):
        raise ValueError("Invalid reference mode")
    if slide_number == 4:
        # Conversion image retains the accurate, full object cutout.
        return scene_prompt(product_name, 2, reference_mode)
    category = category_for_name(product_name)
    has_ref = reference_mode != "conceptual"
    reference = (
        "Image 0 is an actual catalogue-photo reference. Respect its exact observable "
        "physical silhouette, colors, controls and components. Ignore listing text, "
        "decorative graphics and original marketing background. Never add attachments. "
        if has_ref else
        "There is NO verified product photo. The image is CONCEPTUAL only; do not "
        "invent a recognizable exact model, brand, special feature or accessory. "
    )
    composition = (
        "LIFESTYLE PHOTO FOR SLIDE 2: " + _USAGE_CONTEXT[category] + " "
        "Person, natural hands, actual interaction and product must all be visible "
        "within the CENTER 65% of the square image; preserve human hands and faces. "
        "Medium shot, lived-in authentic environment, believable scale and contact "
        "with the surface. Never isolate the product against blank gray. "
        if slide_number == 2 else
        "USEFUL TIPS BACKDROP FOR SLIDE 3: " + _DETAIL_CONTEXT[category] + " "
        "Premium contextual still-life, top-down or elegant diagonal angle, "
        "different from the usage photo, product smaller than the human demonstration. "
        "Composition centered with real environmental objects. No isolated cutout. "
    )
    return " ".join((
        reference, composition,
        "Realistic editorial photography, subtle violet and warm magenta ambient lighting, "
        "natural material detail, professional documentary-like camera. "
        "Keep the item visually consistent with the provided reference. "
        "Do not illustrate unsafe or imaginary use, do not imply guaranteed outcomes, "
        "health effects, savings, wattage, size, compatibility or extra functionality. "
        "ONE continuous photographic scene, no collage, no infographics, no fake interface. "
        "NO text, logos, numbers, prices, captions, labels, watermarks or lettering in image. "
        "No floating product shots. Product name is contextual, not a claim: "
        + " ".join(product_name.split()) + ".",
    ))

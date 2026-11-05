# DropEC Premium — JSON-directed universal commercial poster (staging B)

## What changed

User-approved reference design is encoded as editable, reusable
`editorial_theme.json`, not a one-off prompt for the sample product.
Every exported ad is **1080×1350 (4:5)** with:

- white `#FFFFFF` canvas;
- large, anti-aliased, curved organic olive `#29340A` shape in the upper left;
- large organic lime `#ADE500` shape in the lower right;
- exact verified product name in bold white sans serif within the olive region;
- the actual rendered product as a transparent, large, center-right **foreground silhouette over the background shapes**, with a soft contact shadow;
- a diagonal-corner lime CTA reading `SOLICITA TU COTIZACIÓN` on the left;
- catalog price in dark olive at the bottom left **only when known**;
- no bogus specifications, random benefit statements, made-up phone numbers,
  addresses, warranties, logo copies or model-specific hardcoded colors.
- without a verified image, `IMAGEN ILUSTRATIVA · MODELO NO VERIFICADO`
  remains visible.

The auriculares/Portuguese sample JSON is a **layout specification only**:
no headphones, fictitious contact information, unrelated logos or Portuguese
copy are hardcoded for other products.

## New generation sequence (entirely in cloud)

1. A locked private staging job is leased from Supabase B only after a FREE
   Cloudflare Workers AI or Hugging Face ZeroGPU availability check.
2. The original photo is used only as a conditional **visual reference**.
   Catalog photos with embedded orange promotional typography are never
   pasted into the final poster.
3. `creative_brief.py` now requests a real full physical product alone on a
   uniform neutral studio background, keeping all parts visible. Category
   detection is generic and determines only the thematic context, not
   fabricated product properties. With no photo, it requests a **conceptual**
   SKU-unverified object.
4. A small **open-source CPU** background-removal model, `rembg` with
   `u2netp`, converts the rendered product into a transparent RGBA cutout.
   No external paid background-removal service is used. The pretrained ONNX
   model is downloaded from the rembg official release on its first use.
5. The cutout undergoes safety gates: alpha coverage, minimum size, margin to
   image edges, adequate bounds, and placement checks. Failed or ambiguous
   segmentation causes a retryable failed preview; **not** a broken accepted
   advertisement. Automatic fidelity or identity verification is **not**
   claimed.
6. Pillow assembles the original reference JSON design as a unified poster:
   organic shapes, foreground shadow/product, catalog typography and CTA.
   The reference image is not overlaid, and there is no separate rectangular
   generated-photo section.
7. The 1080×1350 JPEG is saved to **private Supabase B** via OIDC on the
   GitHub runner. Manual owner review is required. No approval, payment,
   customer contact, Meta action or publication is automated.

Supported provider code: `cloudflare_runner.py` and optional
`runner.py`. Both runners require `rembg[cpu]==2.0.86` locally on the
ephemeral GitHub Actions runner, never on the Mac. Model downloads and
matting may consume additional free GitHub Actions runtime; do not infer
unlimited quotas.

## Safeguards and limits

- No change to old four-card/template renderer.
- Versioned private Premium previews remain in
  `dropec_premium_preview_versions`; regenerating archives the old JPEG.
- Generated physical objects may still change shape, materials or parts
  compared with real SKUs; **owner visual review must confirm fidelity**.
- Color-key segmentation and local matting can fail on complex surfaces,
  translucent objects or low-contrast images. The pipeline fails closed and
  the user can regenerate the private proposal.
- No image-less result can be called an authentic photograph of an exact
  unavailable product; it is visibly marked illustrative.
- Contact information is shown ONLY when verified DropEC data exists.
  The sample JSON's Brazilian phone and street are NOT business facts.
  Today the generator does not place a contact address or number.
- Only private staging B is affected. Meta publishing and payments remain
  unchanged and blocked. No plan upgrades or paid inference are authorized.

## Review and validation

`python -m unittest discover -s creative-studio/premium -p test_*.py`
proves theme configuration, exact colors, shapes, RGBA overlap, product
containment, category-agnostic behavior, conceptual warning, invalid prices
and fail-closed segmentation. GitHub CI validates both runners' CPU matting
dependencies and OIDC safety. This is **not** evidence that every FLUX
generation will be aesthetically successful or true to the catalogue.

The next validation should be a freshly generated private proposal in
Creative Studio, compared visually with the actual source photograph.

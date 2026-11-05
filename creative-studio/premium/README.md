# DropEC Premium — Editorial 2:3 (staging B, 5 Nov 2026)

## Art direction chosen

The owner rejected the generic green organic template and supplied an
asymmetric luxury product-ad reference. `editorial_theme.json` now defines
an **exact 736 × 1104, 2:3 private editorial preview** with:

- a paper-white `#F5F3EF` seamless canvas;
- a narrow `#AAA6A0` vertical architectural panel, **28% width and 92% height**;
- `#111111` and `#000000` near-black type;
- **open-source Lato Black/Heavy/Medium/Light**, in place of the former
  generic DejaVu bold. Helvetica Neue is a proprietary typeface and is not
  bundled or redistributed.
- dynamically line-broken, large catalogue name at upper left;
- exact catalog price when available and a restrained Spanish quote CTA;
- a huge editorial proposal INDEX (`01`, `02`, `03`) behind the foreground
  product. The index is not a product model or technical specification;
- soft realistic shadow and single large foreground product overlapping
  the gray panel and the index, never a rectangular original listing card.

This translates the **editorial composition** of the supplied smartphone
reference, NOT its product details: no Apple logos, `18` model number,
camera/chip/battery specifications, unsupported color variants, fabricated
slogans, telephone numbers or addresses. Nor does DropEC automatically
invent a second product view: only a real verified reference could justify
a second view, so currently the poster keeps the actual single object.

## Universal pipeline

1. The owner queues a locked private product in Creative Studio; jobs remain
   idempotent and GitHub checks at roughly 15-minute intervals.
2. Cloudflare Workers AI free FLUX.2 Klein (or separately configured free HF
   Space) receives the original CDN image *only as a reference*, if available.
   For no-photo products, the output is explicitly conceptual.
3. The generative model creates the one product against a uniform gray
   studio background, not an ad with invented lettering.
4. Free `rembg[cpu]==2.0.86` + `u2netp` on ephemeral GitHub runners removes
   the background. If extraction fails or a silhouette touches the edges, the
   proposal fails safely rather than publishing a white rectangle.
5. Pillow builds the designed poster using verified catalog text and price.
   The reference promotional photograph is never pasted on top of the design.
6. Preview is privately stored in Supabase B, retaining earlier versions
   in `dropec_premium_preview_versions` for comparison and rollback.
   Human fidelity/quality review is mandatory. **No social publishing.**

## Important aspect-ratio distinction

The user's newest reference specifies **2:3**, not the earlier 4:5
1080×1350. This pipeline honors the 2:3 format for a private editorial
preview. **It is not yet a validated Instagram or Facebook export.** Before
enabling social uploads, create platform-specific safe variants without
cropping the product, title, product price or CTA.

## Layout, typography and honest content

The compositor scales product silhouettes without cropping, and reserves
separate no-overlap areas for title, price and CTA. Long names reduce type
size rather than disappearing off-canvas. All three concept variants share
the reference visual language but have subtle panel/product-position changes.

A right-hand technical feature column and color swatches require
**verified attributes from the product catalogue**, not deductions from a
model-generated image. The current preview job only supplies name, price and
optional reference photo, so these fields are deliberately absent. The
architecture permits later data-mapped fields if the Woo source is expanded.

The UI is still a private experiment, not an approved product advertisement.
Without a verified photograph, the design must show
`IMAGEN ILUSTRATIVA · MODELO NO VERIFICADO`. Human review must reject
product detail hallucinations, distorted shadows and uncertain exact SKUs.

## Validation

- `test_compositor.py` verifies 2:3 dimensions, exact neutral colors,
  correct panel geometry, real Lato font loading, title wrapping, large
  foreground product bounding boxes, no cropped silhouette, truthfulness,
  segmentation failures and unchanged source photograph.
- `test_cloudflare_runner.py` and `test_creative_brief.py` verify free
  inference and all with/without reference paths.
- CI installs `fonts-lato` and `rembg[cpu]` and loads the free ONNX
  segmentation model before any main-branch deployment.
- Cloudflare staging and HF free GPU workflows install the same fonts,
  preserve the OIDC staging security boundary and write private JPEG only.

Changes remain in private staging; do not switch on pricing, publication or
paid inference automatically.

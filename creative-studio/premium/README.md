# DropEC — Motor Premium universal (staging B)

**Scope:** isolated Supabase B `ubxkqbnzdtgfvphwohzm`, GitHub Actions and
Cloudflare Workers AI Free. There is **no automatic publication, payment or
change to the shop**. The original four-slide template renderer is retained
as a separate fallback. Premium previews do not become public without owner
review. Cloudflare's Free model quota is finite.

## The universal pipeline (no product-specific ID conditions)

1. Creative Studio stores a job with product title, optional catalogue price,
   and optional product image URL. `source_image_url` may be NULL.
2. Owner queues up to three Premium concepts. GitHub checks the free-provider
   runtime *before* leasing a preview. Cloudflare and Hugging Face remain
   distinct optional providers.
3. An HTTPS photo from the known public catalogue CDN is fetched only if it is
   allowlisted and usable. Photos at least 160px on the shorter edge can be
   provided as **references**, never as layers pasted into the final design.
   Low-resolution or promotional reference images are NOT certified authentic.
4. If there is **no acceptable photo**, the system generates a **conceptual**
   category illustration. It never claims to reproduce the exact SKU, and the
   finished JPG visibly says `IMAGEN ILUSTRATIVA · MODELO NO VERIFICADO`.
5. `creative_brief.py` chooses a general scene context from the **name**:
   kitchen, tools, technology, beauty, sport, home, or neutral studio. Unknown
   products use the neutral style, not invented attributes. No SKU-specific
   rules and no unsupported feature/benefit claims.
6. FLUX.2 Klein 4B is prompted for a **square full-product scene** with
   the entire silhouette visible, at least 12% background clearance on every
   edge, the product in front of decorative props and no crop or close-up.
   This is a generation **request**, not a computer-vision guarantee.
7. `compositor.py` uses a **contain**, not a cover/crop transform, so the
   ENTIRE generated scene appears in a protected foreground hero region above
   the CTA/price card and below the title. Blurred scenery fills unused side
   margins. No catalogue poster or original-photo panel is pasted over the
   generated product. The layout reserves a title-dependent vertical band;
   product pixels in the hero can never be hidden by advertising text.
   Exact catalogue name/price, neutral CTA and conceptual disclosure live in
   separate layout sections. FLUX could itself generate an incomplete
   physical product; owners must reject any such image.
8. A runner uploads the private 1080×1350 JPEG and a reference-confidence
   label into Supabase B using short-lived GitHub OIDC.
9. The owner can compare variants, regenerate a preview without deleting
   older JPEGs (private `dropec_premium_preview_versions`), and manually
   adopt a cover for review. **Approval and publishing remain separate.**

**Important:** image dimensions, URL safety and product-category prompts are
deterministic checks, **not AI fidelity certification**. A human must inspect
the generated product's parts, colors and visual accuracy; a hallucinated
physical detail is a rejection condition. Do not automatically publish visual
concepts as authentic product photos.

## Free-first provider configuration

Primary: Cloudflare Workers AI, model
`@cf/black-forest-labs/flux-2-klein-4b`. Repository Actions secret:
`DROPEC_CF_AI_TOKEN` (scoped Workers AI Read/Edit). Repository variable:
`DROPEC_CF_ACCOUNT_ID`. The provider is invoked **directly from GitHub
Actions** through REST, not inside a new Worker. The workflow
`.github/workflows/dropec-premium-cloudflare-ai.yml` checks model access
before claiming any staging job. Once configured, GitHub automatically
checks for waiting previews **about every 15 minutes**, subject to possible
GitHub Actions cron delays. It claims at most **one** preview per execution
and never makes paid overage calls. Clicking `Preparar 3 ideas Premium`
only inserts missing preview slots; it does **not** trigger an instantaneous
inference run or generate duplicates. To request a fresh version use
`Regenerar con diseño universal`; the previous private JPEG is archived.
The Studio refreshes preview status while the product page is visible.

Optional secondary: Hugging Face ZeroGPU via
`creative-studio/premium/space/`. Requires a qualified free HF account,
`DROPEC_HF_SPACE` and `DROPEC_HF_TOKEN`; bootstrap checks free eligibility
daily. Failure to get a free GPU leaves jobs queued and never selects a paid
GPU.

No paid API keys or metered paid GPU instance are configured in this
implementation. **Do not upgrade to paid without an explicit separate
decision.** Cloudflare Free quota or inference errors may delay work.

## Staging rollout checklist

- Apply `creative-studio/premium/versions.sql` to **Supabase B only**.
- Deploy `creative-studio/premium/edge/index.ts` as
  `dropec-premium-scene` with existing `verify_jwt=false`; the function
  verifies Supabase owner sessions and exact GitHub OIDC workflows itself.
- Wait for the Premium CI to pass: Pillow pixel tests, reference-less
  generation mock, browser JavaScript parse and Edge Deno typecheck.
- Select a **non-approved** staging product, choose a variant, and
  `Regenerar con diseño universal`. Previous premium version is archived
  before resetting the job; Storage is never overwritten.
- Review at least one product from two different categories and one
  truly image-less catalogue entry before using for real campaigns.
- Confirm that Instagram/Facebook publishing is disabled until an owner
  has approved the art and claims.

## Known limits / deliberate safeguards

- Image classification cannot automatically certify whether a catalogue
  image is clean photography or a marketing poster; both are only reference
  material. The model is prompted to ignore printed text, logos and
  infographic elements.
- Without a photo, generated visuals remain **illustrative**.
- The generic vocabulary used to infer visual context is heuristic. Ambiguous
  names default to a neutral studio instead of claiming product function.
- The compositor currently uses a text-only DropEC wordmark. A genuine
  official logo asset should replace it when one is available in the
  repository. Never fabricate a separate brand logo.
- Text-only FLUX inference must be exercised on the connected account;
  offline tests verify request shape but cannot guarantee model support.
- Neither exact product identity nor publishing suitability is automatically
  approved by these deterministic tests.

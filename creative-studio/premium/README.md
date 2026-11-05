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
6. FLUX.2 Klein 4B generates a complete full-bleed scene with central subject
   and empty top/bottom typography margins.
7. `compositor.py` places brand wordmark, **exact catalogue name, exact
   supplied price**, neutral CTA and (for conceptual work) a visible
   illustration disclaimer. It never pastes the original listing advertisement
   or adds a white rectangle over the AI hero image. The entire center of the
   AI image remains pixel-identical after compositing.
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
before claiming any staging job.

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

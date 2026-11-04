# DropEC Premium Scene Pilot

Staging-only `ubxkqbnzdtgfvphwohzm`. This experiment adds a **separate** high-quality
image-generation path and does not replace the existing four-slide free renderer.

## Why a new pipeline

The current cloud compositor is fully automated but paints the same original
photo into four templates. Premium quality needs a visual scene generator
(FLUX.2 Klein 4B) **and** a strict deterministic compositor for all
letters, prices, brand elements and the original product photograph.

This pilot prepares two cover alternatives and one editorial scene per product.
Images are drafts for the owner, not public publications.

## Free-first, unattended architecture

1. Owner presses **Preparar 3 ideas Premium** in Creative Studio.
2. Staging Edge Function authenticates the owner and inserts three isolated
   queue records (no effect on existing slides).
3. Every 30 minutes, GitHub Actions starts a runner **only when**
   repository variable `DROPEC_HF_SPACE` contains a configured Space id.
4. Short-lived GitHub OIDC token binds the worker to the exact main-branch
   workflow. The worker claims at most one request per execution.
5. Runner accepts only a verified public original product image at the known
   catalogue CloudFront host, requiring at least 550 × 550 pixels.
6. An owner's Hugging Face ZeroGPU Gradio Space, if configured and operational,
   creates the scene using `black-forest-labs/FLUX.2-klein-4B` (Apache 2.0).
7. A CPU Pillow compositor superimposes the unchanged real product photo and
   exact safe DropEC wording on top of the generated scenery.
8. The runner POSTs the JPEG through the OIDC-protected Edge Function into
   the existing **private** Storage bucket, under `job-id/premium/`.
9. Creative Studio displays the previews via short-lived signed URLs.
10. Owner may inspect, download or explicitly **adopt** a proposal as slide 1.
    Adoption archives the previous cover and returns the slide to review.

There is **no** Meta/Instagram/Facebook API call in this pilot, and every
preview/job keeps its publication lock.

## Configure (not completed automatically)

* Staging: apply `schema.sql` to **Supabase B only**.
* Deploy `edge/index.ts` as `dropec-premium-scene` to **Supabase B only**,
  with gateway `verify_jwt=false` because it verifies both owner Supabase
  sessions and GitHub OIDC inside its handler.
* One-time authorization: configure the GitHub Actions repository variable
  `DROPEC_HF_SPACE=your-huggingface-username/dropec-flux2-pilot` and the
  **secret** `DROPEC_HF_TOKEN` with write access scoped to that account.
  Do not send the token in chat, in the website or in code.
* GitHub's `DropEC Premium — Bootstrap free ZeroGPU Space` workflow can then
  **create and upload** the private Space automatically under the exact owner
  account; subsequent source changes sync automatically. It requests **only**
  `SpaceHardware.ZERO_A10G` (ZeroGPU). It never requests paid hardware.
* Free hosting eligibility requires a verified HF email and account in good
  standing older than 30 days; otherwise HF may reject creation. We do not
  change the billing plan or use a paid alternative.
* Once the Space actually builds and successfully generates, the separate
  periodic GPU preview workflow consumes queued staging jobs using that Space.
* Both workflows safely skip while the required configuration is absent.
* Test Woo #29 with a verified **higher-resolution real photo**; do not
  upscale 220 × 220 into false photographic detail.

## Operational limits and acceptance

Hugging Face Free ZeroGPU has a small daily GPU-time quota and uncertain queue
priority, so continuous operation at three previews per product is **not
guaranteed free**. No silent substitution with low-quality templates.
A timed-out preview retries up to 3 times, with a lease and backoff. A
low-resolution or unapproved source remains `needs_source`. The existing
image renderer and owner approval process remain functional independently.

Testing must demonstrate GPU readiness, actual scene quality, reference-product
integrity, secure storage, correct Spanish text/prices and explicit review.
ZeroGPU must be used in accordance with Hugging Face terms.

This pilot does not authorize real sales, payments or publishing. Security and
performance review is mandatory before expanding from 3 concepts to full
4-slide premium carousels.

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
3. Every 30 minutes, GitHub Actions performs a **read-only preflight**:
   it checks that the configured Space exists, is RUNNING, and has
   `zero-a10g` hardware. Both the Space identifier and the HF token must
   exist. **Only a confirmed free ZeroGPU runtime permits a queue claim.**
   HTTP 402 (account age), 404 (Space missing), a private access failure,
   interrupted builds, network errors, paid GPUs and CPU-only hardware
   safely skip the run without changing the staging queue.
4. Only after the preflight succeeds, short-lived GitHub OIDC binds the
   worker to the exact main-branch workflow. It claims at most one private
   preview per execution. All unavailable checks leave attempts at zero.
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
* GitHub's `DropEC Premium — Bootstrap free ZeroGPU Space` workflow
  checks eligibility **once daily at 06:17 UTC** after initial setup,
  can create and upload the private Space automatically under the exact owner
  account, and syncs later source changes. The initial HTTP 402 account-age
  restriction becomes a non-failing **skip** with the queue preserved; the
  next daily run checks again. This does not bypass Hugging Face eligibility.
  It requests **only** `SpaceHardware.ZERO_A10G` (ZeroGPU), refuses to
  modify existing paid-hardware Spaces and never requests paid hardware.
* Free hosting eligibility requires a verified HF email and account in good
  standing older than 30 days; otherwise HF may reject creation. We do not
  change the billing plan or use a paid alternative.
* Once the Space actually builds and successfully generates, the separate
  periodic GPU preview workflow consumes queued staging jobs using that Space.
* Both workflows safely skip while the required configuration is absent.
  The GPU workflow also skips when Hugging Face has not created or finished
  starting the Space. A missing Space is **not** a failed CI job.
* The offline regression tests in `test_check_hf_space.py` simulate
  HTTP 402 and 404, missing tokens, stopped builds, paid hardware and
  genuine ZeroGPU readiness. The CI also checks that the runtime gate
  runs **before** the claim step.
* Once eligibility is satisfied, the same pipeline can resume without
  changing the three queued product ideas or re-entering the token.
  A RUNNING state alone is not a guarantee that model inference succeeds;
  the first actual GPU run still needs visual and runtime validation.
* Test Woo #29 with a verified **higher-resolution real photo**; do not
  upscale 220 × 220 into false photographic detail.

## Operational limits and acceptance

Hugging Face Free ZeroGPU has a small daily GPU-time quota and uncertain queue
priority, so continuous operation at three previews per product is **not
guaranteed free**.

## Better immediate provider: Cloudflare Workers AI Free / FLUX.2 Klein 4B

Cloudflare hosts the **same FLUX.2 Klein 4B** model directly, including up to
four reference images. It is accessible using its Workers AI REST API, avoiding
Hugging Face's 30-day personal Space creation requirement and avoiding CPU load
inside a separately deployed Cloudflare Worker.

Cloudflare's Free Workers AI allocation (as documented October 2026) is
**10,000 Neurons/day**, shared across the account's Workers AI usage. On
Workers Free there is no metered overage: requests over the quota are refused.
Do not switch Cloudflare to Workers Paid for this pilot. This is a usage quota,
not a guarantee of unlimited free daily advertisements.

One-time owner-only configuration in GitHub repository settings:

1. Cloudflare dashboard → **Workers AI → Use REST API → Create Workers AI API
   Token**. A narrowly scoped token requires Workers AI Read and Edit; do not
   grant permissions to edit/deploy Workers, R2, DNS or billing.
2. Save that token ONLY as repository Actions secret `DROPEC_CF_AI_TOKEN`.
   Never paste the token into Creative Studio or this repository.
3. Save the Cloudflare 32-character Account ID as repository Actions variable
   `DROPEC_CF_ACCOUNT_ID` (non-secret identifier).
4. GitHub Actions `DropEC Premium — Cloudflare FLUX.2 Free Inference` checks
   model access hourly using a **read-only model-search** API call. Only an
   authorized account and the exact available model allow an OIDC-protected
   private staging preview to be claimed.
5. The GitHub runner uses multipart `input_image_0` of **under 512×512**
   pixels as identity reference, asks for a 1024×1280 synthetic scene, then
   composes the **actual authentic original photo** plus deterministic Spanish
   texts/prices via Pillow into a private 1080×1350 JPEG.
6. The JPEG is sent back to the existing staging Supabase Edge Function.
   Neither provider is allowed to publish to Meta, modify payment flows or
   approve creative automatically. The owner must review and adopt it.

The model is Apache 2.0 under Black Forest Labs' open-weight license; the
Cloudflare hosted API still operates under Cloudflare service terms. If the
Cloudflare token or account is not configured, or the model is inaccessible,
the scheduled run is a **success/no-op with no queue claim**. It does not
generate a fake placeholder or switch to a paid provider. Hugging Face ZeroGPU
remains optional, automatically gated and waiting on account eligibility.

Official references:
- https://developers.cloudflare.com/changelog/post/2026-01-15-flux-2-klein-4b-workers-ai/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/get-started/rest-api/
- https://github.com/black-forest-labs/flux2

 No silent substitution with low-quality templates.
A timed-out preview retries up to 3 times, with a lease and backoff. A
low-resolution or unapproved source remains `needs_source`. The existing
image renderer and owner approval process remain functional independently.

Testing must demonstrate GPU readiness, actual scene quality, reference-product
integrity, secure storage, correct Spanish text/prices and explicit review.
ZeroGPU must be used in accordance with Hugging Face terms.

This pilot does not authorize real sales, payments or publishing. Security and
performance review is mandatory before expanding from 3 concepts to full
4-slide premium carousels.

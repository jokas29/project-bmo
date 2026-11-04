---
title: DropEC FLUX2 Klein 4B Pilot
emoji: 🎨
colorFrom: purple
colorTo: green
sdk: gradio
sdk_version: 5.49.1
python_version: "3.12"
app_file: app.py
short_description: Experimental product-ad scenery generator; no publishing
---

# DropEC FLUX.2 Klein 4B — staging pilot

**Not a live connected Space.** This directory is a deployable template for a
Hugging Face **ZeroGPU** Gradio Space, once an eligible free HF account and
its own Space are configured. It does NOT make the existing DropEC site
automatically able to run a GPU.

- Model: `black-forest-labs/FLUX.2-klein-4B`, Apache 2.0.
- Avoid FLUX.2 Klein 9B / dev weights for the commercial DropEC workflow:
  their weights have different, non-commercial licensing.
- Inputs: verified product photograph + structured scene prompt + seed.
- Outputs: photographic **scene only**, never price, logo or final claim.
- In CI, the compositor overlays **unchanged real product pixels** over the
  scene to prevent a synthetic hallucination being sold as the real item.
- ZeroGPU time is finite. Free account daily quota and availability must be
  validated with a small pilot; no paid endpoints are called or enabled.
- Gradio inputs to public Spaces must not contain private customer data.
- No user-provided code is executed.

Operationally: upload this folder as the root of your own Space, select ZeroGPU
hardware, then place its `owner/space-name` identifier in the repository variable
`DROPEC_HF_SPACE`. If required, store an HF access token in GitHub Actions
secret `DROPEC_HF_TOKEN`. Never insert it into HTML, Supabase rows, or the repo.

**Acceptance checks before usage:** cold-start load, GPU allocation, generation
quality, preserved product identity, credits/quota, scene service reliability,
actual stage upload, and private owner review. Until those pass the queue remains
a preview and public posting is disabled.

# DropEC Creative Studio — private cloud rendering

This module is a **free, no-paid-image-API** fallback that composes four 1080×1350 JPEG slides from each product's authentic source photograph and saved creative brief.

## Architecture

- Production remains untouched: this component works **only** with the isolated Supabase B staging project `ubxkqbnzdtgfvphwohzm`.
- Edge Function: `dropec-creative-render`, code in `index.ts`.
- GitHub Actions: `.github/workflows/dropec-creative-cloud-render.yml`, GitHub OIDC authenticated and scheduled every five minutes (schedule timing is not guaranteed to the exact minute).
- POST `/enqueue` is accepted only from the confirmed Creative Studio owner with a valid Supabase Auth session.
- POST `/worker` is accepted only with GitHub Actions OIDC, restricted to this repository's `main` branch and the exact workflow path.
- Automatic selection of eligible pending products is enabled with an owner-controlled pause switch and a maximum of three new carrusels per day.
- The system selects a missing slide, leases it, renders one slide per request, saves it in private Supabase Storage, and marks it ready for human review.
- Captions and hashtags are prepared from known product information. Owners can edit and save these private drafts.
- Images with WebP sources are decoded with the pinned modern codec, while the proven compositor continues to render JPEG slides.
- POST `/rebuild` requires owner authentication and preserves existing slide file paths in a private versions table before regenerating. Approval/publishing states cannot be rebuilt.
- Failed renders retry with backoff. Old leases are recovered. Existing uploaded or approved images are **never** overwritten.
- The Cloudfront product image host is allowlisted. Private originals under `storage://` are supported. If a source is missing or incompatible, a meaningful error is saved rather than inventing a product.
- Low-resolution source photographs are warned about in the review UI; do not approve blurry results.
- The process has **no public publishing, payment, WooCommerce order, or Dropi side-effect logic**.

## Manual QA

1. Verify `GET /health` responds with `publishing_enabled:false`.
2. In Creative Studio, open Woo #29 and choose **Generar carrusel automáticamente**, or use an intentionally queued staging test.
3. Confirm GitHub Actions processes four slides and each is stored in the private bucket.
4. Check slide status `uploaded`, review and approve each image, and verify job state `review`.
5. Confirm there are no public posts, no changes to commercial production, and no paid generation API calls.
6. Test retry by providing a missing source only on an expendable test product.
7. Woo #124 has a thumbnail-sized source, so expect a resolution warning or provide a higher-quality authentic photograph before approval.

Never enable public publishing or sales as part of testing the creative worker.

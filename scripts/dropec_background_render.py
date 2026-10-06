import base64
import io
import json
import os
import sys

import requests
from PIL import Image
from rembg import new_session, remove

BASE = "https://kzwzputkwcpojevffjrm.supabase.co/functions/v1/dropec-render-bridge"
TOKEN = os.environ.get("DROPEC_OIDC_TOKEN", "")

if not TOKEN:
    raise SystemExit("Missing DROPEC_OIDC_TOKEN")

HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


def post(path, payload=None, timeout=120):
    r = requests.post(BASE + path, headers=HEADERS, json=payload or {}, timeout=timeout)
    r.raise_for_status()
    return r.json()


def download(url):
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return r.content


def normalize_png(raw):
    # Decode and normalize orientation/colors before segmentation.
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    if max(im.size) > 1600:
        im.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def trim_transparency(raw):
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    alpha = im.getchannel("A")
    bbox = alpha.getbbox()
    if bbox:
        pad = 18
        l, t, r, b = bbox
        bbox = (max(0, l - pad), max(0, t - pad), min(im.width, r + pad), min(im.height, b + pad))
        im = im.crop(bbox)
    out = io.BytesIO()
    im.save(out, format="PNG", optimize=True)
    return out.getvalue()


def main():
    pulled = post("/pull")
    job = pulled.get("job")
    if not job:
        print("No background-render job pending")
        return 0

    job_id = job["id"]
    model = job.get("model") or "birefnet-general-lite"
    urls = job.get("source_urls") or []
    print(f"Rendering {job_id} with {model}: {len(urls)} image(s)")

    try:
        session = new_session(model)
        cache = {}
        encoded = []
        for url in urls:
            if url in cache:
                cut = cache[url]
            else:
                raw = normalize_png(download(url))
                # BiRefNet performs semantic foreground segmentation, unlike the old color heuristic.
                cut = remove(raw, session=session)
                cut = trim_transparency(cut)
                cache[url] = cut
            encoded.append(base64.b64encode(cut).decode("ascii"))

        done = post("/complete", {"id": job_id, "ok": True, "images": encoded}, timeout=180)
        print(json.dumps(done, ensure_ascii=False))
        return 0
    except Exception as exc:
        try:
            post("/complete", {"id": job_id, "ok": False, "error": str(exc)[:500]})
        finally:
            print(f"Render failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

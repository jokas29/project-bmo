"""Cloudflare REST FLUX.2 Klein 4B generator for private DropEC visual tests.

No Cloudflare Worker script is deployed or executed by this program.
The model runs server-side via Workers AI REST; GitHub Actions acts as caller.
"""
from __future__ import annotations
import argparse
import base64
from io import BytesIO
import json
import math
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlparse

import requests
from PIL import Image, ImageOps, UnidentifiedImageError
from compositor import build_poster,jpeg_bytes,source_quality

MODEL="@cf/black-forest-labs/flux-2-klein-4b"
HOST="d39ru7awumhhs2.cloudfront.net"
ACCOUNT_RE=re.compile(r"^[0-9a-f]{32}$", re.I)

class ProviderUnavailable(RuntimeError):
    pass

def source_photo(url: str, *, session=requests) -> Image.Image:
    parsed=urlparse(url)
    if(parsed.scheme!="https" or parsed.hostname!=HOST
       or not parsed.path.startswith("/ecuador/products/")
       or parsed.port not in (None,443)
       or parsed.username or parsed.password):
        raise ValueError("source invalid: only public verified DropEC catalog photos allowed")
    r=session.get(url,stream=True,allow_redirects=False,timeout=(15,25),
                  headers={"Accept":"image/png,image/jpeg,image/webp"})
    with r:
        if r.status_code != 200:
            raise ValueError("source invalid: original product photo unavailable")
        if not r.headers.get("content-type","").lower().startswith("image/"):
            raise ValueError("source invalid: unexpected file type")
        data=bytearray()
        for block in r.iter_content(32768):
            data.extend(block)
            if len(data)>12*1024*1024:
                raise ValueError("source invalid: photo exceeds 12MB")
    try:
        im=Image.open(BytesIO(data))
        im.load()
        source_quality(im)
        return im.convert("RGB")
    except (UnidentifiedImageError,OSError) as e:
        raise ValueError("source invalid: cannot decode photograph") from e

def reference_png(image: Image.Image) -> bytes:
    """Cloudflare requires each reference image strictly smaller than 512px."""
    ref=image.copy()
    ref.thumbnail((496,496),Image.Resampling.LANCZOS)
    buf=BytesIO()
    ref.save(buf,format="PNG")
    if ref.width>=512 or ref.height>=512:
        raise AssertionError("Reference exceeds Workers AI limits")
    return buf.getvalue()

def decode_response(payload: object) -> Image.Image:
    if not isinstance(payload,dict) or payload.get("success") is not True:
        raise ProviderUnavailable("Cloudflare inference did not report success")
    body=payload.get("result")
    if not isinstance(body,dict) or not isinstance(body.get("image"),str):
        raise ProviderUnavailable("Cloudflare returned no encoded image")
    encoded=body["image"]
    if encoded.startswith("data:image/") and "," in encoded:
        encoded=encoded.split(",",1)[1]
    if len(encoded)>17*1024*1024:
        raise ProviderUnavailable("Generated image too large")
    try:
        data=base64.b64decode(encoded,validate=True)
        if len(data)>12*1024*1024:
            raise ValueError("excessive image length")
        im=Image.open(BytesIO(data))
        im.load()
    except (ValueError,OSError,UnidentifiedImageError) as e:
        raise ProviderUnavailable("Cloudflare response is not a valid image") from e
    if min(im.size)<640:
        raise ProviderUnavailable("Generated scene resolution too small")
    return im.convert("RGB")

def generate_scene(preview: dict,original: Image.Image,account: str,token: str,*,session=requests) -> Image.Image:
    if not ACCOUNT_RE.fullmatch(account or "") or not token:
        raise ProviderUnavailable("Cloudflare Workers AI credentials are not configured")
    required=("preview_id","variant","prompt","product_name","publication_locked")
    if any(k not in preview for k in required) or preview["publication_locked"] is not True:
        raise ValueError("Unauthorized or malformed private preview")
    variation=int(preview["variant"])
    if variation not in (1,2,3):
        raise ValueError("Invalid private preview variation")
    prompt=str(preview["prompt"])
    if len(prompt)<35 or len(prompt)>1300 or "NO writing" not in prompt:
        raise ValueError("Invalid product scene prompt")
    prompt=("Image 0 is the authentic reference of the product. "
            "Preserve the real product identity, colors and physical features. "
            +prompt)
    seed=(int(preview["preview_id"].replace("-","")[:7],16)+variation*104729)%(2**32)
    api=("https://api.cloudflare.com/client/v4/accounts/"+account+
         "/ai/run/"+MODEL)
    try:
        r=session.post(api,
           headers={"Authorization":"Bearer "+token, "Accept":"application/json"},
           data={"prompt":prompt,"width":"1024","height":"1280","seed":str(seed)},
           files={"input_image_0":("product-reference.png",reference_png(original),"image/png")},
           timeout=(15,120),allow_redirects=False)
    except requests.RequestException as e:
        raise ProviderUnavailable("Cloudflare AI inference unavailable") from e
    with r:
        if r.status_code in (402,403,429):
            raise ProviderUnavailable(f"Cloudflare AI unavailable or quota exhausted (HTTP {r.status_code})")
        if r.status_code!=200:
            raise ProviderUnavailable(f"Cloudflare inference failed (HTTP {r.status_code})")
        if len(r.content)>17*1024*1024:
            raise ProviderUnavailable("Generated response too large")
        try: payload=r.json()
        except ValueError as e:
            raise ProviderUnavailable("Cloudflare returned invalid JSON") from e
        return decode_response(payload)

def produce(preview: dict,account: str,token: str) -> bytes:
    if preview.get("processed") is not True or preview.get("publication_locked") is not True:
        raise ValueError("Only locked leased staging previews may be processed")
    original=source_photo(str(preview.get("original_url","")))
    scene=generate_scene(preview,original,account,token)
    price=preview.get("price")
    value=None if price is None else float(price)
    return jpeg_bytes(build_poster(scene,original,str(preview["product_name"]),value,int(preview["variant"])))

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--claim",required=True)
    parser.add_argument("--output",required=True)
    args=parser.parse_args()
    preview=json.loads(Path(args.claim).read_text())
    data=produce(preview,os.getenv("DROPEC_CF_ACCOUNT_ID",""),os.getenv("DROPEC_CF_AI_TOKEN",""))
    Path(args.output).write_bytes(data)
    print(f"Cloudflare FLUX.2 Klein 4B private preview created ({len(data)} bytes), awaiting owner review. No social publishing.")

if __name__=="__main__":main()

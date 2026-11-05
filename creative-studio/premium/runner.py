"""GitHub Actions worker for staging-only DropEC premium scene previews.
Requires a separately configured HF ZeroGPU Space. No local Mac and no paid API.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlparse
from io import BytesIO

import requests
from gradio_client import Client, handle_file
from PIL import Image, ImageOps
from compositor import build_poster, jpeg_bytes, source_quality
from creative_brief import classify_reference,scene_prompt

CATALOG_HOST = "d39ru7awumhhs2.cloudfront.net"

def fetch_verified_photo(url: str | None) -> Image.Image | None:
    if not url:
        return None
    parsed=urlparse(url)
    if parsed.scheme!="https" or parsed.hostname!=CATALOG_HOST or not parsed.path.startswith("/ecuador/products/"):
        return None
    try:
        response=requests.get(url,timeout=25,allow_redirects=False,stream=True,headers={"Accept":"image/png,image/jpeg,image/webp"})
    except requests.RequestException:
        return None
    if response.status_code!=200 or response.is_redirect:
        return None
    if not response.headers.get("content-type","").startswith("image/"):
        return None
    chunks=[]
    total=0
    for chunk in response.iter_content(32768):
        total+=len(chunk)
        if total>12*1024*1024:
            raise ValueError("source invalid: image exceeds 12 MB")
        chunks.append(chunk)
    data=b"".join(chunks)
    try:
        image=Image.open(BytesIO(data))
        image.load()
        image=ImageOps.exif_transpose(image)
        source_quality(image)
    except (OSError,ValueError):
        return None
    return image.convert("RGB")

def generate(preview: dict, space: str, token: str|None) -> tuple[bytes,str]:
    if not re.fullmatch(r"[A-Za-z0-9_.-]{2,60}/[A-Za-z0-9_.-]{2,80}",space):
        raise ValueError("Hugging Face Space identifier is not configured")
    image=fetch_verified_photo(preview.get("original_url"))
    variant=int(preview["variant"])
    mode=classify_reference(image)
    prompt=scene_prompt(str(preview["product_name"]),variant,mode)
    with tempfile.TemporaryDirectory() as tmp:
        source_path=Path(tmp)/"source.png"
        if image is not None:
            image.save(source_path,"PNG")
        client=Client(space,hf_token=token,verbose=False)
        result=client.predict(
            image=handle_file(str(source_path)) if image is not None else None,
            prompt=prompt,
            seed=(variant*104729 + int(preview["preview_id"].replace("-","")[:6],16)) % 2**32,
            api_name="/generate",
        )
        if isinstance(result,dict):
            result=result.get("path") or result.get("url")
        if not isinstance(result,str):
            raise RuntimeError("GPU Space returned an unexpected image format")
        # Gradio downloads the result locally. Never fetch an arbitrary URL.
        scene_path=Path(result)
        if not scene_path.is_file():
            raise RuntimeError("GPU Space image was not delivered as a local file")
        if scene_path.stat().st_size>12*1024*1024:
            raise RuntimeError("GPU output too large")
        with Image.open(scene_path) as scene:
            scene.load()
            if min(scene.size)<640:
                raise RuntimeError("GPU output too small")
            product_name=str(preview["product_name"])[:120]
            raw_price=preview.get("price")
            price=float(raw_price) if raw_price is not None else None
            poster=build_poster(scene,image,product_name,price,variant,reference_mode=mode)
            return jpeg_bytes(poster),mode

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--claim",required=True)
    parser.add_argument("--output",required=True)
    parser.add_argument("--reference-mode-output")
    args=parser.parse_args()
    claim=json.loads(Path(args.claim).read_text())
    if claim.get("processed") is not True or claim.get("publication_locked") is not True:
        raise RuntimeError("No authorized locked preview job")
    data,mode=generate(claim,os.environ.get("DROPEC_HF_SPACE",""),os.environ.get("DROPEC_HF_TOKEN") or None)
    Path(args.output).write_bytes(data)
    if args.reference_mode_output:
        Path(args.reference_mode_output).write_text(mode,encoding="utf-8")
    print(f"Private premium preview prepared: {len(data)} bytes, mode={mode}. No public post.")

if __name__=="__main__":
    main()

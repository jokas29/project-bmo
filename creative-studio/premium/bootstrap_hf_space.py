"""Safe one-time HF ZeroGPU bootstrap; never requests any paid hardware."""
from __future__ import annotations

import os
import re
from pathlib import Path

from huggingface_hub import HfApi, SpaceHardware
from huggingface_hub.utils import HfHubHTTPError

SPACE = (os.environ.get("DROPEC_HF_SPACE") or "").strip()
TOKEN = os.environ.get("DROPEC_HF_TOKEN") or ""
if not re.fullmatch(r"[A-Za-z0-9_.-]{2,60}/[A-Za-z0-9_.-]{2,80}", SPACE):
    raise SystemExit("DROPEC_HF_SPACE must be the explicit owner/space-name repository variable")
if not TOKEN:
    raise SystemExit("DROPEC_HF_TOKEN (write-scoped) is required to bootstrap a private Space")

api = HfApi(token=TOKEN)
who = api.whoami()
owner = SPACE.split("/")[0]
user = str(who.get("name") or "")
if owner.casefold() != user.casefold():
    raise SystemExit("Space owner must match the authenticated personal HF account; no organizational or third-party changes")

existing = None
try:
    existing = api.space_info(repo_id=SPACE)
except Exception as error:
    # Only an unambiguous 404 permits creation; permission errors must fail.
    if getattr(getattr(error, "response", None), "status_code", None) != 404:
        raise

if existing:
    runtime = api.get_space_runtime(repo_id=SPACE)
    hardware = str(getattr(runtime, "hardware", "") or "").lower()
    requested = str(getattr(runtime, "requested_hardware", "") or "").lower()
    if hardware not in ("zero-a10g", "none", ""):
        raise SystemExit(f"Refusing to modify Space with non-ZeroGPU hardware: {hardware}")
    if requested and requested != "zero-a10g":
        raise SystemExit(f"Refusing to modify Space requesting non-ZeroGPU hardware: {requested}")
    print("Existing Space confirmed; updating source only (no hardware change).")
else:
    # Force ZeroGPU at creation. Omitting hardware would pick CPU Basic,
    # which may require a paid plan on HF for Gradio Spaces in 2026.
    try:
        api.create_repo(
            repo_id=SPACE,
            repo_type="space",
            space_sdk="gradio",
            space_hardware=SpaceHardware.ZERO_A10G,
            private=True,
            exist_ok=False,
        )
    except HfHubHTTPError as error:
        # This is an account eligibility gate, not a script/deployment error.
        # No CPU fallback, payment, upgrades or repeated create attempts.
        if getattr(getattr(error, "response", None), "status_code", None) == 402:
            print("::notice::Hugging Face free ZeroGPU eligibility not met yet (HTTP 402).")
            print("Private DropEC previews stay queued. The scheduled workflow will check again tomorrow.")
            raise SystemExit(0) from None
        raise
    print("Created a private ZeroGPU Space (free shared GPU); no paid hardware requested.")

folder=Path("creative-studio/premium/space")
for name in ("app.py","requirements.txt","README.md"):
    if not (folder/name).is_file():
        raise SystemExit(f"Missing required Space file: {name}")
api.upload_folder(
    folder_path=str(folder),
    repo_id=SPACE,
    repo_type="space",
    commit_message="Sync DropEC FLUX.2 Klein 4B zero-cost pilot from GitHub",
    allow_patterns=["app.py","requirements.txt","README.md"],
)
print(f"Uploaded pilot sources into {SPACE}. Confirm Space build/runtime before using premium queue.")

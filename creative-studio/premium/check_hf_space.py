"""Fail-closed availability gate for the optional DropEC Premium ZeroGPU pipeline.

This check is deliberately READ-ONLY and runs BEFORE any staging queue claim.
Missing, ineligible, unavailable and non-ZeroGPU Spaces all leave queued work untouched.
No payment hardware, retry counters or private customer data are involved.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SPACE_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{2,60}/[A-Za-z0-9_.-]{2,80}$")
RUNTIME_URL_PREFIX = "https://huggingface.co/api/spaces/"
ZERO_GPU = "zero-a10g"


@dataclass(frozen=True)
class SpaceCheck:
    ready: bool
    reason: str


def check_runtime_payload(payload: object) -> SpaceCheck:
    """Only a RUNNING Space *actually* using free ZeroGPU can claim work."""
    if not isinstance(payload, dict):
        return SpaceCheck(False, "Invalid Space runtime response")
    runtime = payload.get("runtime", payload)
    if not isinstance(runtime, dict):
        return SpaceCheck(False, "Space runtime unavailable")
    stage = str(runtime.get("stage") or "").upper()
    hardware = str(runtime.get("hardware") or "").lower()
    requested = str(runtime.get("requested_hardware") or "").lower()
    if stage != "RUNNING":
        return SpaceCheck(False, f"Space is not running (stage: {stage or 'unknown'})")
    if hardware != ZERO_GPU or (requested and requested != ZERO_GPU):
        return SpaceCheck(False, "Space is not confirmed on free ZeroGPU hardware")
    return SpaceCheck(True, "Private ZeroGPU Space is running")


def check_space(space: str, token: str, *, opener=urlopen) -> SpaceCheck:
    if not SPACE_PATTERN.fullmatch(space):
        return SpaceCheck(False, "Space repository variable is missing or invalid")
    if not token:
        return SpaceCheck(False, "Hugging Face token is missing")
    request = Request(
        RUNTIME_URL_PREFIX + space + "/runtime",
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/json",
            "User-Agent": "DropEC-Premium-Free-GPU-Preflight/1.0",
        },
        method="GET",
    )
    try:
        with opener(request, timeout=12) as response:
            if getattr(response, "status", 200) != 200:
                return SpaceCheck(False, "Space runtime did not return HTTP 200")
            raw = response.read(16385)
        if len(raw) > 16384:
            return SpaceCheck(False, "Unexpectedly large Space runtime response")
        return check_runtime_payload(json.loads(raw))
    except HTTPError as exc:
        if exc.code in (401, 403):
            return SpaceCheck(False, "Hugging Face token cannot access this Space")
        if exc.code == 404:
            return SpaceCheck(False, "Space not created yet; premium queue preserved")
        if exc.code == 402:
            return SpaceCheck(False, "Free ZeroGPU eligibility is not yet met (HTTP 402)")
        if exc.code == 429:
            return SpaceCheck(False, "Hugging Face rate-limited preflight; no queue claim")
        return SpaceCheck(False, f"Hugging Face unavailable (HTTP {exc.code})")
    except (URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
        return SpaceCheck(False, "Cannot verify Space availability; queue preserved")


def main() -> None:
    result = check_space(
        os.environ.get("DROPEC_HF_SPACE", "").strip(),
        os.environ.get("DROPEC_HF_TOKEN", ""),
    )
    output_path = os.environ.get("GITHUB_OUTPUT")
    if output_path:
        with open(output_path, "a", encoding="utf-8") as stream:
            stream.write("ready=" + ("true" if result.ready else "false") + "\n")
    print("Space preflight: " + result.reason)
    # Unavailability is a normal condition, not a failed GitHub workflow.
    # Crucially, the caller MUST gate the OIDC claim step on ready=true.


if __name__ == "__main__":
    main()

"""Read-only no-cost Cloudflare Workers AI access gate for DropEC staging.
The model search endpoint does NOT run inference and does not claim work.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

MODEL="@cf/black-forest-labs/flux-2-klein-4b"
ACCOUNT_RE=re.compile(r"^[0-9a-fA-F]{32}$")

@dataclass(frozen=True)
class Result:
    ready: bool
    reason: str

def model_available(payload: object) -> Result:
    if not isinstance(payload,dict) or payload.get("success") is not True:
        return Result(False,"Cloudflare did not confirm a successful model search")
    rows=payload.get("result")
    if not isinstance(rows,list):
        return Result(False,"Cloudflare model list unavailable")
    def has_model(row):
        if not isinstance(row,dict):
            return False
        return any(MODEL==str(row.get(key) or "") or MODEL.lstrip("@cf/")==str(row.get(key) or "")
                   for key in ("id","name","model","model_id"))
    if any(has_model(row) for row in rows):
        return Result(True,"Cloudflare Workers AI lists the exact FLUX.2 Klein 4B model")
    return Result(False,"FLUX.2 Klein 4B not confirmed for this account")

def check(account: str, token: str, *, opener=urlopen) -> Result:
    if not ACCOUNT_RE.fullmatch(account or "") or not token:
        return Result(False,"Cloudflare account ID or AI-scoped token not configured")
    url="https://api.cloudflare.com/client/v4/accounts/"+account+"/ai/models/search?search=flux-2-klein-4b&per_page=20"
    request=Request(url,headers={
       "Authorization":"Bearer "+token,
       "Accept":"application/json",
       "User-Agent":"DropEC-Private-AI-Preflight/1.0"
    },method="GET")
    try:
        with opener(request,timeout=15) as response:
            if getattr(response,"status",200)!=200:
                return Result(False,"Workers AI model search did not return HTTP 200")
            raw=response.read(64*1024+1)
        if len(raw)>64*1024:
            return Result(False,"Model metadata response unexpectedly large")
        return model_available(json.loads(raw))
    except HTTPError as error:
        return Result(False,"Cloudflare AI unavailable (HTTP "+str(error.code)+")")
    except (URLError,TimeoutError,OSError,ValueError,json.JSONDecodeError):
        return Result(False,"Could not confirm Cloudflare AI access")

def main() -> None:
    result=check(os.environ.get("DROPEC_CF_ACCOUNT_ID",""),
                 os.environ.get("DROPEC_CF_AI_TOKEN",""))
    path=os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path,"a",encoding="utf-8") as output:
            output.write("ready="+("true" if result.ready else "false")+"\n")
    print("Workers AI preflight: "+result.reason)
    # No Worker's invocation, no image inference, no queue claim on any failure.

if __name__=="__main__":
    main()

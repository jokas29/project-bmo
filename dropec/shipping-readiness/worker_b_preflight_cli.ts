// Manual GitHub OIDC authentication diagnostic ONLY. No quotes, orders or claims.
// Before a verified main-branch deploy, use the "offline" mode (no network).
import { WORKER_B } from "./worker_b_policy.ts";
const STATUS_URL =
  "https://ubxkqbnzdtgfvphwohzm.supabase.co/functions/v1/dropec-shipping-worker-b/status";
export async function readOnlyWorkerPreflight(
  environment: Record<string,string|undefined>,
  transport: typeof fetch = fetch,
) {
  const githubUrl=environment.ACTIONS_ID_TOKEN_REQUEST_URL;
  const githubRequestToken=environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!githubUrl || !githubRequestToken) throw Error("github_oidc_not_available");
  const url=new URL(githubUrl);
  if (url.protocol!=="https:" ||
      !(url.hostname==="actions.githubusercontent.com" ||
        url.hostname.endsWith(".actions.githubusercontent.com"))) {
    throw Error("github_oidc_endpoint_not_allowed");
  }
  url.searchParams.set("audience",WORKER_B.audience);
  const tokenResponse=await transport(url.href, {
    method:"GET",redirect:"error",signal:AbortSignal.timeout(12000),
    headers:{Authorization:"Bearer "+githubRequestToken},
  });
  if(!tokenResponse.ok) throw Error("github_oidc_request_failed");
  const tokenBody=await tokenResponse.json();
  const jwt=String(tokenBody?.value||"");
  if(jwt.length<50 || jwt.length>15000) throw Error("github_oidc_response_invalid");
  // Never print a token or the signed WordPress request body.
  const response=await transport(STATUS_URL,{
    method:"POST",redirect:"error",signal:AbortSignal.timeout(12000),
    headers:{Authorization:"Bearer "+jwt,"Content-Type":"application/json"},
    body:"{}",
  });
  if(!response.ok) throw Error("supabase_b_oidc_auth_failed");
  const result=await response.json();
  if(result?.ok!==true || result?.project!=="supabase-b" ||
      result?.worker_mode!=="manual_only") throw Error("unexpected_worker_response");
  return {authenticated:true,project:"supabase-b",released:result.released===true,
    requirements_satisfied:result.requirements_satisfied===true};
}
if(import.meta.main) {
  const mode=Deno.env.get("DROPEC_SHIPPING_B_WORKFLOW_MODE")||"offline";
  if(mode==="offline") {
    console.log("DropEC shipping worker B: OFFLINE. No provider or Supabase requests.");
  } else if(mode==="read_only_preflight") {
    const result=await readOnlyWorkerPreflight(Deno.env.toObject());
    console.log("GitHub OIDC -> Supabase B authenticated. No quotes processed.",
      "released="+result.released, "requirements_satisfied="+result.requirements_satisfied);
  } else {
    throw Error("worker_mode_not_allowed"); // no executable live quote mode
  }
}

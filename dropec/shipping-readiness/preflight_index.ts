// DropEC Supabase B ONLY — GitHub Actions OIDC preflight for shipping.
// This function has NO endpoints for pull, claim, complete, orders or quotes.
// It does NOT contact WooCommerce or Dropi and cannot enable a worker.
import postgres from "npm:postgres@3.4.7";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";
import { SHIPPING_PREFLIGHT, validPreflightClaims } from "./bridge_claims.ts";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
const db = dbUrl ? postgres(dbUrl, {
  max:1,prepare:false,ssl:{rejectUnauthorized:true},
  connection:{application_name:"dropec-shipping-preflight-b",statement_timeout:10000}
}) : null;
const jwks=createRemoteJWKSet(
  new URL("https://token.actions.githubusercontent.com/.well-known/jwks")
);
const HEADERS={
  "Cache-Control":"no-store,max-age=0",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
};
const response=(status:number,body:Record<string,unknown>)=>Response.json(body,{status,headers:HEADERS});
async function githubActor(req:Request):Promise<boolean> {
  const raw=req.headers.get("authorization") || "";
  if (!raw.startsWith("Bearer ") || raw.length>16000) return false;
  try {
    const {payload}=await jwtVerify(raw.slice(7),jwks,{
      issuer:SHIPPING_PREFLIGHT.issuer,
      audience:SHIPPING_PREFLIGHT.audience,
      algorithms:["RS256"],
      clockTolerance:3
    });
    return validPreflightClaims(payload);
  } catch {
    return false;
  }
}
Deno.serve(async req=>{
  const pathname=new URL(req.url).pathname.replace(/\/+$/,"");
  if (req.method==="GET" && pathname.endsWith("/health")) {
    return response(200,{service:"dropec-shipping-preflight-b",mode:"read_only_auth_required"});
  }
  if (req.method!=="POST" || !pathname.endsWith("/status")) {
    return response(404,{ok:false,error:"not_found"});
  }
  if (!await githubActor(req)) return response(401,{ok:false,error:"unauthorized"});
  if (!db) return response(503,{ok:false,error:"database_unavailable"});
  try {
    const [config]=await db`
      select worker_enabled, worker_heartbeat_at, provider_bridge_verified_at
      from dropec_private.shipping_pipeline_control
      where singleton=true
    `;
    if (!config) return response(503,{ok:false,error:"configuration_missing"});
    // Even a true flag never grants access to jobs through this preflight.
    return response(200,{
      ok:true,
      project:"supabase-b",
      mode:"preflight_only_no_provider_calls",
      worker_enabled:config.worker_enabled === true,
      worker_heartbeat_present:Boolean(config.worker_heartbeat_at),
      provider_bridge_verified:Boolean(config.provider_bridge_verified_at),
      can_process_jobs:false,
      can_call_dropi:false,
      can_call_woocommerce:false
    });
  } catch {
    return response(503,{ok:false,error:"preflight_unavailable"});
  }
});

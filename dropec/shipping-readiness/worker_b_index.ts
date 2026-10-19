// Draft ONLY: Supabase B shipping worker broker. NEVER deploy until reviewed.
// POST /claim and /complete are doubly gated: an explicit deployment-only release
// switch and B's fail-closed worker/heartbeat/provider/Woo config. No Dropi,
// WordPress, Woo order, payment, cron, /wake or Supabase A calls occur here.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";
import { WORKER_B, validWorkerClaims, shippingAssignment,
  verifyWorkerQuote } from "./worker_b_policy.ts";
import { serializeQuoteRequest, signQuoteBody } from "./wordpress_quote_bridge.ts";

const RELEASED = Deno.env.get("DROPEC_B_SHIPPING_WORKER_RELEASE") === "operator_approved_quote_only_v1";
const CONNECTION = Deno.env.get("SUPABASE_DB_URL");
const sql = CONNECTION ? postgres(CONNECTION, {
  max: 2, prepare: false, ssl: { rejectUnauthorized: true },
  connection: { application_name: "dropec-shipping-worker-b", statement_timeout: 15000 },
}) : null;
const jwks = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
const HEADERS = {"Cache-Control":"no-store, max-age=0",
  "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const output = (status: number, payload: Record<string, unknown>) =>
  Response.json(payload, { status, headers: HEADERS });
const deny = (code: string, status = 503) => output(status, {ok:false,error:code});
const QUOTE_URL = "https://radarcommerce.byethost7.com/wp-json/dropec/v1/shipping-quote-v2";
const hashToken = async (raw: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(raw))), b => b.toString(16).padStart(2, "0")).join("");
function equalHash(a: string,b: string) {
  if(a.length !== b.length) return false;
  let diff=0;
  for(let i=0;i<a.length;i++) diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff === 0;
}
async function actor(req: Request) {
  const auth=req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ") || auth.length>16000) return null;
  try {
    const {payload}=await jwtVerify(auth.slice(7),jwks, {
      issuer: WORKER_B.issuer, audience: WORKER_B.audience,
      algorithms:["RS256"],clockTolerance:3,
    });
    return validWorkerClaims(payload) ? {run_id:String(payload.run_id)} : null;
  } catch { return null; }
}
async function readiness() {
  if(!sql) return false;
  const [r] = await sql`
    select
      coalesce((select worker_enabled from dropec_private.shipping_pipeline_control where singleton=true),false) as worker_enabled,
      (select worker_heartbeat_at from dropec_private.shipping_pipeline_control where singleton=true) as heartbeat,
      (select provider_bridge_verified_at from dropec_private.shipping_pipeline_control where singleton=true) as provider_verified,
      coalesce((select enabled from dropec_private.bot_woo_config where singleton=true),false) as woo_enabled,
      coalesce((select webhook_secret_id is not null from dropec_private.bot_woo_config where singleton=true),false) as woo_signed,
      exists(select 1 from vault.secrets where name='dropec_bot_internal_key') as internal_key
  `;
  const current=Date.now(), heartbeat= r?.heartbeat ? new Date(r.heartbeat).getTime() : NaN;
  const verified= r?.provider_verified ? new Date(r.provider_verified).getTime() : NaN;
  return r?.worker_enabled===true && r?.woo_enabled===true &&
    r?.woo_signed===true && r?.internal_key===true &&
    current-heartbeat>=0 && current-heartbeat<=15*60_000 &&
    current-verified>=0 && current-verified<=24*60*60_000;
}
async function claim(runId: string) {
  if (!sql) return deny("database_unavailable");
  if (!await readiness()) return deny("worker_requirements_unmet");
  try {
    return await sql.begin(async tx => {
      // Serialize claims. No other worker may lease the same job concurrently.
      const [job]=await tx`
        select * from dropec_private.bot_shipping_quote_jobs
        where (status='queued' and available_at<=now()
          or status='processing' and leased_at<now()-interval '5 minutes')
          and attempts<4 order by created_at asc for update skip locked limit 1
      `;
      if(!job) return output(200,{ok:true,job:null});
      const [checkout]=await tx`
        select *, updated_at::text as checkout_version from dropec_private.bot_checkout_sessions
        where platform=${job.platform} and sender_id=${job.sender_id}
        for update
      `;
      const [product]=await tx`
        select woo_product_id, dropi_product_id, approved, woo_status, currency
        from dropec_private.bot_woo_catalog_products where woo_product_id=${job.woo_product_id}
      `;
      const origins=await tx`
        select dropi_product_id, origin_city, stock_available, observed_at, valid_until
        from dropec_private.shipping_verified_origins
        where dropi_product_id=${product?.dropi_product_id ?? -1}
      `;
      const [dest]=await tx`
        select province,city,cod_dane,observed_at,valid_until
        from dropec_private.shipping_verified_destinations
        where province=${job.province} and city=${job.city}
      `;
      if (!checkout || !product) return deny("quote_context_unavailable");
      // Policy rejects mismatched checkout/product, stale stock, multiple warehouses,
      // missing destination verification and mismatched job payload BEFORE lease.
      let assignment;
      try { assignment=shippingAssignment(job,checkout,product,origins,dest||null); }
      catch { return deny("quote_context_unverified"); }
      const [key]=await tx`
        select v.decrypted_secret
        from dropec_private.bot_woo_config c
        join vault.decrypted_secrets v on v.id=c.webhook_secret_id
        where c.singleton=true and c.enabled=true limit 1
      `;
      if (!key?.decrypted_secret) return deny("signing_secret_not_available");
      // Never export the Vault secret; export only the HMAC for this exact request.
      const raw=serializeQuoteRequest(assignment.expected);
      const signature=await signQuoteBody(raw,String(key.decrypted_secret));
      const nonce=crypto.randomUUID()+crypto.randomUUID();
      const tokenHash=await hashToken(nonce);
      const [leased]=await tx`
        update dropec_private.bot_shipping_quote_jobs
        set status='processing',attempts=attempts+1,leased_at=now(),updated_at=now()
        where id=${job.id} and attempts=${job.attempts}
        returning attempts
      `;
      if(!leased) return deny("quote_claim_conflict",409);
      await tx`
        insert into dropec_private.shipping_worker_b_leases
          (job_id,github_run_id,token_sha256,attempt,checkout_version,expires_at)
        values (${job.id},${runId},${tokenHash},${leased.attempts},
          ${assignment.checkout_version}::timestamptz,now()+interval '5 minutes')
        on conflict (job_id) do update set
          github_run_id=excluded.github_run_id,
          token_sha256=excluded.token_sha256,attempt=excluded.attempt,
          checkout_version=excluded.checkout_version,
          expires_at=excluded.expires_at,updated_at=now()
      `;
      return output(200,{
        ok:true,job:{id:job.id,endpoint:QUOTE_URL,raw,signature,
          lease_nonce:nonce,expected:assignment.expected,
          destination_code:assignment.destination_code},
      });
    });
  } catch { return deny("quote_claim_unavailable"); }
}
async function complete(runId: string, body: unknown) {
  if (!sql) return deny("database_unavailable");
  if (!await readiness()) return deny("worker_requirements_unmet");
  if (!body || typeof body!=="object" || Array.isArray(body)) return deny("invalid_completion",400);
  const b=body as Record<string,unknown>;
  const id=String(b.id||""), nonce=String(b.lease_nonce||"");
  if(!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9-]{72}$/.test(nonce))
    return deny("invalid_completion",400);
  const tokenHash=await hashToken(nonce);
  try {
    return await sql.begin(async tx => {
      const [job]=await tx`
        select * from dropec_private.bot_shipping_quote_jobs
        where id=${id}::uuid for update
      `;
      const [lease]=await tx`
        select *, checkout_version::text as checkout_version_raw from dropec_private.shipping_worker_b_leases where job_id=${id}::uuid
      `;
      if(!job||!lease || lease.github_run_id!==runId ||
          !equalHash(lease.token_sha256,tokenHash) ||
          Number(lease.attempt)!==Number(job.attempts)) {
        return deny("invalid_or_replaced_lease",409);
      }
      if(job.status==="completed") return output(200,{ok:true,status:"already_completed"});
      if(job.status!=="processing" ||
          new Date(lease.expires_at).getTime()<=Date.now()) {
        return deny("expired_or_inactive_lease",409);
      }
      const [checkout]=await tx`
        select *, updated_at::text as checkout_version from dropec_private.bot_checkout_sessions
        where platform=${job.platform} and sender_id=${job.sender_id} for update
      `;
      const [product]=await tx`
        select woo_product_id,dropi_product_id,approved,woo_status,currency
        from dropec_private.bot_woo_catalog_products where woo_product_id=${job.woo_product_id}
      `;
      const origins=await tx`
        select dropi_product_id,origin_city,stock_available,observed_at,valid_until
        from dropec_private.shipping_verified_origins
        where dropi_product_id=${product?.dropi_product_id ?? -1}
      `;
      const [dest]=await tx`
        select province,city,cod_dane,observed_at,valid_until
        from dropec_private.shipping_verified_destinations
        where province=${job.province} and city=${job.city}
      `;
      if(!checkout||!product) return deny("quote_context_unavailable");
      let assignment;
      try { assignment=shippingAssignment(job,checkout,product,origins,dest||null); }
      catch { return deny("quote_context_unverified"); }
      if(assignment.checkout_version!==lease.checkout_version_raw)
        return deny("checkout_changed_during_quote",409);
      if(b.ok!==true) {
        // Safe retry. Never store a raw provider response, stack trace or token.
        const next=Number(job.attempts)>=4 ? "failed" : "queued";
        await tx`
          update dropec_private.bot_shipping_quote_jobs
          set status=${next},available_at=now()+interval '5 minutes',
          leased_at=null,updated_at=now(),last_error='provider_quote_failed'
          where id=${id}::uuid and status='processing'
        `;
        return output(200,{ok:true,status:next});
      }
      let quoted;
      try { quoted=verifyWorkerQuote(b.quote,assignment); }
      catch { return deny("invalid_or_mismatched_provider_quote",409); }
      const total=Number(job.product_amount)+quoted.shipping_amount;
      const updated=await tx`
        update dropec_private.bot_checkout_sessions
        set shipping_amount=${quoted.shipping_amount},total_amount=${total},
            payment_amount=${total},shipping_quoted_at=now(),
            shipping_quote_source='dropi_v2',updated_at=now()
        where platform=${job.platform} and sender_id=${job.sender_id}
          and updated_at=${assignment.checkout_version}::timestamptz
          and woo_product_id=${job.woo_product_id}
          and province=${job.province} and city=${job.city}
          and quantity=${job.quantity}
          and unit_price * quantity = ${job.product_amount}
          and payment_status='unpaid' and payment_intent_id is null
          and payment_link is null and paid_at is null
          and pending_order_job_id is null returning platform
      `;
      if(updated.length!==1) return deny("checkout_changed_during_quote",409);
      await tx`
        update dropec_private.bot_shipping_quote_jobs
        set status='completed',shipping_amount=${quoted.shipping_amount},
          carrier=${quoted.carrier},origin_code=${quoted.origin_code},
          destination_code=${quoted.destination_code},options=${tx.json(quoted.options)},
          completed_at=now(),updated_at=now(),leased_at=null,last_error=null
        where id=${id}::uuid and status='processing'
      `;
      return output(200,{ok:true,status:"completed",shipping_amount:quoted.shipping_amount});
    });
  } catch { return deny("quote_completion_unavailable"); }
}
Deno.serve(async req => {
  const path=new URL(req.url).pathname.replace(/\/+$/,"");
  const root="/functions/v1/dropec-shipping-worker-b";
  if (req.method==="GET" && path.endsWith(root+"/health")) return output(200,{
    service:"dropec-shipping-worker-b",mode:"draft_disabled_by_default",
    can_process_jobs:false,provider_calls:false,
  });
  if (!path.endsWith(root+"/status") &&
      !path.endsWith(root+"/claim") && !path.endsWith(root+"/complete")) {
    return deny("not_found",404);
  }
  if(req.method!=="POST") return deny("method_not_allowed",405);
  const who=await actor(req);
  if(!who) return deny("unauthorized",401);
  if(path.endsWith(root+"/status")) return output(200,{
    ok:true,project:"supabase-b",worker_mode:"manual_only",
    released:RELEASED,requirements_satisfied:RELEASED && await readiness(),
  });
  if(!RELEASED) return deny("worker_not_released",423);
  if(path.endsWith(root+"/claim")) return claim(who.run_id);
  const body=await req.json().catch(()=>null);
  return complete(who.run_id,body);
});

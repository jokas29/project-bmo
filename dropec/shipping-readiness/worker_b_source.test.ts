const dir=new URL(".",import.meta.url);
const load=(path:string)=>Deno.readTextFile(new URL(path,dir));
const has=(v:string,p:RegExp,msg:string)=>{if(!p.test(v))throw Error(msg)};
const no=(v:string,p:RegExp,msg:string)=>{if(p.test(v))throw Error(msg)};
Deno.test("B broker is locked by default and separate from orders and providers",async()=>{
  const source=await load("worker_b_index.ts");
  has(source,/DROPEC_B_SHIPPING_WORKER_RELEASE/, "missing locked release");
  has(source,/if\(!RELEASED\) return deny\("worker_not_released",423\)/, "release not enforced");
  has(source,/jwtVerify\(/, "missing OIDC verification");
  has(source,/validWorkerClaims\(payload\)/, "missing pinned worker claims");
  has(source,/for update skip locked/i, "missing atomic queue claim");
  has(source,/shipping_worker_b_leases/, "missing unique lease");
  has(source,/equalHash\(lease.token_sha256,tokenHash\)/, "missing lease validation");
  has(source,/checkout_version/, "missing version pin");
  has(source,/updated_at::text as checkout_version/, "checkout timestamp must keep microseconds");
  has(source,/checkout_version::text as checkout_version_raw/, "lease timestamp must keep microseconds");
  has(source,/assignment.checkout_version!==lease.checkout_version_raw/, "lease must match byte-exact timestamp");
  has(source,/shippingAssignment\(/, "must re-check context before applying amount");
  has(source,/verifyWorkerQuote\(/, "must verify provider quote before commit");
  has(source,/payment_intent_id is null/, "must not finalize paid checkout");
  no(source,/wc_create_order|create_order\(|orders\/create|dropec-payphone|kzwzputkwcpojevffjrm/, "unsafe side-effect route or project A");
});
Deno.test("manual workflow cannot enable quotes or run on a cron",async()=>{
  const yaml=await Deno.readTextFile(new URL("../../.github/workflows/dropec-shipping-worker-b.yml",dir));
  has(yaml,/workflow_dispatch:/, "not manual");
  has(yaml,/read_only_preflight/, "no auth diagnostic");
  no(yaml,/^\s*schedule:|^\s*push:|^\s*pull_request:|\bcreate_order\b|shipping-quote-v2|\/claim\b|\/complete\b/m,"unsafe workflow");
});
Deno.test("B migration creates no fake destinations, jobs or worker heartbeat",async()=>{
  const sql=await load("worker_b_support_migration.sql");
  has(sql,/shipping_verified_destinations/, "destination pin absent");
  has(sql,/shipping_worker_b_leases/, "lease table absent");
  has(sql,/enable row level security/i, "RLS absent");
  no(sql,/\bINSERT INTO\b|\bUPDATE\b|\bcron\.schedule\b|\bpg_net\b/i, "migration must not activate anything");
});

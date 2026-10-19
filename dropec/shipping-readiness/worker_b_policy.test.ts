import {
  WORKER_B, validWorkerClaims, shippingAssignment, verifyWorkerQuote, WorkerPolicyError,
} from "./worker_b_policy.ts";
const now = new Date("2026-10-19T12:00:00Z");
const d = (m: number) => new Date(now.getTime() + m * 60000).toISOString();
const validClaims = { iss: WORKER_B.issuer, aud: WORKER_B.audience,
  repository: WORKER_B.repository, repository_id: WORKER_B.repository_id,
  repository_owner_id: WORKER_B.owner_id, workflow_ref: WORKER_B.workflow_ref,
  ref: WORKER_B.ref, event_name: WORKER_B.event_name, run_id: "987654321" };
const job = { id: "00000000-0000-4000-8000-000000000001",
  platform: "instagram", sender_id: "test", woo_product_id: 29,
  province: "Los Ríos", city: "Babahoyo", quantity: 2, product_amount: 50,
  request_payload: {woo_product_id:29,province:"Los Ríos",city:"Babahoyo",
    amount:50,quantity:2,rate_type:"SIN RECAUDO",origin:{id:51,cod_dane:"201001001001"}} };
const checkout = { platform:"instagram",sender_id:"test",woo_product_id:29,
  province:"Los Ríos",city:"Babahoyo", quantity:2,unit_price:25,
  updated_at:d(-1),payment_status:"unpaid",payment_intent_id:null,
  payment_link:null,paid_at:null,pending_order_job_id:null };
const product = {woo_product_id:29,dropi_product_id:3481,approved:true,
  woo_status:"publish",currency:"USD"};
const origins = [{dropi_product_id:3481,stock_available:30,
  observed_at:d(-30),valid_until:d(60),
  origin_city:{id:51,cod_dane:"201001001001"}}];
const destination = {province:"Los Ríos",city:"Babahoyo",
  cod_dane:"201001013013",observed_at:d(-30),valid_until:d(60)};
const quote = {ok:true,shipping_amount:3,carrier:"Carrier A",
  origin_code:"201001001001",destination_code:"201001013013",
  options:[{price:3,carrier:"Carrier A"},{price:5,carrier:"Carrier B"}]};
const chk = (cond:unknown) => {if(!cond) throw new Error("assertion_failed")};
function rejects(f:()=>unknown,code:string) {
  try {f()} catch(e) {
    if (e instanceof WorkerPolicyError && e.code===code) return;
    throw e;
  }
  throw new Error("expected_"+code);
}
const assign = () => shippingAssignment(job,checkout,product,origins,destination,now);
Deno.test("worker OIDC bound to exact B-only manual main workflow",()=>{
  chk(validWorkerClaims(validClaims));
  for (const wrong of [
    {workflow_ref:"jokas29/project-bmo/.github/workflows/dropec-shipping-quote.yml@refs/heads/main"},
    {ref:"refs/heads/feature/dropec-shipping-readiness"}, {event_name:"schedule"},
    {repository_id:"123"}, {repository_owner_id:"0"}, {aud:"dropec-shipping-preflight-b"},
    {iss:"https://evil.example"}, {run_id:"123"}
  ]) chk(!validWorkerClaims({...validClaims,...wrong}));
});
Deno.test("accepts only fresh official origin and destination for unpaid unchanged checkout",()=>{
  chk(assign().expected.origin.cod_dane === "201001001001");
  chk(assign().destination_code === "201001013013");
  chk(verifyWorkerQuote(quote,assign()).shipping_amount === 3);
});
Deno.test("rejects changed checkout, product totals and paid data",()=>{
  rejects(()=>shippingAssignment({...job,quantity:1},checkout,product,origins,destination,now),"job_snapshot_mismatch");
  rejects(()=>shippingAssignment(job,{...checkout,unit_price:20},product,origins,destination,now),"checkout_changed_or_paid");
  rejects(()=>shippingAssignment(job,{...checkout,payment_status:"paid"},product,origins,destination,now),"checkout_changed_or_paid");
  rejects(()=>shippingAssignment(job,{...checkout,payment_intent_id:"intent"},product,origins,destination,now),"checkout_changed_or_paid");
});
Deno.test("rejects stale, uncertain and wrong-bodega stock",()=>{
  rejects(()=>shippingAssignment(job,checkout,product,[],destination,now),"verified_origin_missing_or_ambiguous");
  rejects(()=>shippingAssignment(job,checkout,product,[...origins,...origins],destination,now),"verified_origin_missing_or_ambiguous");
  rejects(()=>shippingAssignment(job,checkout,product,[{...origins[0],stock_available:1}],destination,now),"verified_origin_changed_or_stale");
  rejects(()=>shippingAssignment(job,checkout,product,[{...origins[0],observed_at:d(-1450)}],destination,now),"verified_origin_changed_or_stale");
  rejects(()=>shippingAssignment(job,checkout,product,[{...origins[0],origin_city:{id:51,cod_dane:"201001013013"}}],destination,now),"verified_origin_changed_or_stale");
});
Deno.test("fails closed without exact official destination pin (Babahoyo DANE mismatch)",()=>{
  rejects(()=>shippingAssignment(job,checkout,product,origins,null,now),"verified_destination_missing_or_stale");
  rejects(()=>shippingAssignment(job,checkout,product,origins,{...destination,valid_until:d(-1)},now),"verified_destination_missing_or_stale");
  rejects(()=>verifyWorkerQuote({...quote,destination_code:"201001013001"},assign()),"verified_destination_mismatch");
});
Deno.test("rejects post-provider origin changes and inconsistent pricing",()=>{
  try {verifyWorkerQuote({...quote,origin_code:"201001013001"},assign());throw Error("accepted")}
  catch(e){chk((e as Error).message==="wordpress_origin_mismatch")}
  try {verifyWorkerQuote({...quote,shipping_amount:5,carrier:"Carrier B"},assign());throw Error("accepted")}
  catch(e){chk((e as Error).message==="invalid_shipping_selection")}
});
Deno.test("prevents credentials or catalogue-free operation if B product not approved",()=>{
  rejects(()=>shippingAssignment(job,checkout,{...product,approved:false},origins,destination,now),"invalid_product_context");
  rejects(()=>shippingAssignment(job,checkout,{...product,currency:"COP"},origins,destination,now),"invalid_product_context");
  rejects(()=>shippingAssignment({...job,request_payload:{...job.request_payload,rate_type:"CON RECAUDO"}},checkout,product,origins,destination,now),"invalid_job_payload");
});

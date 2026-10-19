// Product 260 / Dropi 20566: OFFLINE REGRESSION, no official current stock claims.
// Historical (8 Oct) values were found in Supabase A's read-only product snapshot.
// Operator's screenshot (19 Oct) showed GUAYAQUIL and stock 131, but DOES NOT prove
// current canonical Dropi warehouse or city IDs or verify Babahoyo's DANE.
// All response prices here are simulated; NEVER show mock prices as a quote.
import {
  shippingAssignment, verifyWorkerQuote, WorkerPolicyError,
} from "./worker_b_policy.ts";
const now = new Date("2026-10-19T13:33:00-05:00");
const job = {
  platform: "instagram", sender_id: "offline_product_260",
  woo_product_id: 260, quantity: 1, product_amount: 32,
  province: "Los Ríos", city: "Babahoyo",
  request_payload: {
    woo_product_id: 260, quantity: 1, amount: 32,
    province: "Los Ríos", city: "Babahoyo", rate_type: "SIN RECAUDO",
    origin: {id: 732, cod_dane: "201001002001"},
  },
};
const checkout = {
  platform: "instagram", sender_id: "offline_product_260",
  woo_product_id: 260, quantity: 1, unit_price: 32,
  province: "Los Ríos", city: "Babahoyo",
  checkout_version: "2026-10-19 18:33:00.111222+00",
  payment_status: "unpaid", payment_intent_id: null,
  payment_link: null, paid_at: null, pending_order_job_id: null,
};
const product = {
  woo_product_id: 260, dropi_product_id: 20566,
  approved: true, woo_status: "publish", currency: "USD",
};
const historicOrigin = {
  dropi_product_id: 20566, warehouse_ref: "523",
  origin_city: {id: 732, cod_dane: "201001002001"},
  stock_available: 133,
  observed_at: "2026-10-08T11:18:59Z",
  valid_until: "2026-10-09T11:18:59Z",
};
const recentOrigin = {
  ...historicOrigin, stock_available: 131,
  observed_at: "2026-10-19T17:00:00Z",
  valid_until: "2026-10-20T17:00:00Z",
};
const verifiedDestination = {
  province: "Los Ríos", city: "Babahoyo",
  cod_dane: "201001013013",
  observed_at: "2026-10-19T17:00:00Z",
  valid_until: "2026-10-20T17:00:00Z",
};
function assertBlocked(fn:()=>unknown,code:string) {
  try {fn()} catch(e) {
    if(e instanceof WorkerPolicyError && e.code===code) return;
    throw e;
  }
  throw Error("expected_"+code);
}
function check(x:unknown){if(!x)throw Error("offline_assertion_failed")}
Deno.test("real product 20566 cannot quote from the 8-Oct historical stock snapshot",()=>{
  assertBlocked(
    ()=>shippingAssignment(job,checkout,product,[historicOrigin],verifiedDestination,now),
    "verified_origin_changed_or_stale",
  );
});
Deno.test("19-Oct stock screenshot alone cannot establish Babahoyo destination code",()=>{
  // recentOrigin is a synthetic mock, NOT stored in B and NOT proof of source.
  assertBlocked(
    ()=>shippingAssignment(job,checkout,product,[recentOrigin],null,now),
    "verified_destination_missing_or_stale",
  );
});
Deno.test("without official fresh confirmation, changed bodega or stock fails closed",()=>{
  assertBlocked(
    ()=>shippingAssignment(job,checkout,product,
      [{...recentOrigin,origin_city:{id:999,cod_dane:"201001002001"}}],
      verifiedDestination,now),
    "verified_origin_changed_or_stale",
  );
  assertBlocked(
    ()=>shippingAssignment(job,checkout,product,
      [{...recentOrigin,stock_available:0}],
      verifiedDestination,now),
    "verified_origin_changed_or_stale",
  );
});
Deno.test("Babahoyo candidate codes are mutually exclusive, not interchangeable",()=>{
  // All dates and prices in this case are mock input for defensive code testing.
  const assignment = shippingAssignment(job,checkout,product,[recentOrigin],verifiedDestination,now);
  check(assignment.expected.woo_product_id===260);
  check(assignment.expected.origin.id===732);
  check(assignment.expected.origin.cod_dane==="201001002001");
  check(assignment.destination_code==="201001013013");
  const fakeQuote = {
    ok:true,shipping_amount:3.5,carrier:"TEST-ONLY",
    origin_code:"201001002001",destination_code:"201001013001",
    options:[{price:3.5,carrier:"TEST-ONLY"}],
  };
  assertBlocked(
    ()=>verifyWorkerQuote(fakeQuote,assignment),
    "verified_destination_mismatch",
  );
});

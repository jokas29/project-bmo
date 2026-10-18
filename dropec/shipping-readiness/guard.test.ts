import { assessShipping, type ShippingSnapshot } from "./guard.ts";
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error("not_equal");
}
const now = new Date("2026-10-17T22:00:00.000Z");
const allReady: ShippingSnapshot = {
  worker_enabled: true,
  worker_heartbeat_at: "2026-10-17T21:55:00.000Z",
  provider_bridge_verified_at: "2026-10-17T21:50:00.000Z",
  woo_enabled: true,
  woo_webhook_signature_ready: true,
  internal_key_ready: true,
  linked_products: 63,
  products_with_valid_origin: 63,
  pending_jobs: 0
};
Deno.test("readiness is true only for complete, fresh, authenticated processor", () => {
  const value = assessShipping(allReady, now);
  equal(value.quote_processing_ready, true);
  equal(value.status, "ready");
  equal(value.blockers, []);
});
Deno.test("actual Supabase B state is blocked, not incorrectly healthy", () => {
  const value = assessShipping({
    ...allReady,
    worker_enabled: false, worker_heartbeat_at: null,
    provider_bridge_verified_at: null,
    woo_enabled: false, woo_webhook_signature_ready: false,
    internal_key_ready: false, products_with_valid_origin: 0
  }, now);
  equal(value.quote_processing_ready, false);
  for (const reason of ["shipping_worker_disabled", "origin_catalog_empty", "woocommerce_signature_missing", "bot_internal_key_missing"]) {
    if (!value.blockers.includes(reason)) throw Error("missing_blocker_" + reason);
  }
  equal(value.coverage.missing_origin, 63);
});
Deno.test("stale worker is blocked even if explicitly enabled", () => {
  const value = assessShipping({ ...allReady, worker_heartbeat_at: "2026-10-17T21:44:00.000Z" }, now);
  equal(value.quote_processing_ready, false);
  equal(value.blockers, ["worker_heartbeat_missing_or_stale"]);
});
Deno.test("future heartbeat cannot be treated as proof of operational worker", () => {
  const value = assessShipping({ ...allReady, worker_heartbeat_at: "2026-10-17T22:05:00.000Z" }, now);
  equal(value.quote_processing_ready, false);
});
Deno.test("unverified provider bridge remains blocked even with fresh worker heartbeat", () => {
  const value = assessShipping({ ...allReady, provider_bridge_verified_at: null }, now);
  equal(value.quote_processing_ready, false);
  equal(value.blockers, ["provider_bridge_not_verified_recently"]);
});
Deno.test("partial warehouse coverage is warned, not a global blocker", () => {
  const value = assessShipping({ ...allReady, products_with_valid_origin: 62 }, now);
  equal(value.quote_processing_ready, true);
  equal(value.coverage.missing_origin, 1);
  equal(value.blockers, []);
  equal(value.warnings, ["origin_coverage_incomplete"]);
});
Deno.test("zero fresh origins always blocks new quotes", () => {
  const value = assessShipping({ ...allReady, products_with_valid_origin: 0 }, now);
  equal(value.quote_processing_ready, false);
  equal(value.blockers, ["origin_catalog_empty"]);
  equal(value.warnings, ["origin_coverage_incomplete"]);
});
Deno.test("WooCommerce signature, bot secret and enabled flags are all required", () => {
  const value = assessShipping({
    ...allReady, woo_webhook_signature_ready: false,
    internal_key_ready: false, woo_enabled: false
  }, now);
  equal(value.quote_processing_ready, false);
  equal(value.blockers, ["woocommerce_bridge_disabled", "woocommerce_signature_missing", "bot_internal_key_missing"]);
});
Deno.test("counts never go negative or over-count origins", () => {
  const value = assessShipping({ ...allReady, linked_products: 63, products_with_valid_origin: 600, pending_jobs: -4 }, now);
  equal(value.coverage.missing_origin, 0);
  equal(value.pending_jobs, 0);
  equal(value.quote_processing_ready, true);
});

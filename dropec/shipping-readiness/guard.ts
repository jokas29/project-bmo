// DropEC Shipping v2 — fail-closed readiness assessment (pure, offline-testable).
// Readiness is strictly independent from OAuth and from the master sales switch.
// A paused processor can NEVER accept a new quote into its queue.
export type ShippingSnapshot = {
  worker_enabled: boolean;
  worker_heartbeat_at: string | null;
  provider_bridge_verified_at: string | null;
  woo_enabled: boolean;
  woo_webhook_signature_ready: boolean;
  internal_key_ready: boolean;
  linked_products: number;
  products_with_valid_origin: number;
  pending_jobs: number;
};
export type ShippingStatus = {
  status: "ready" | "blocked";
  quote_processing_ready: boolean;
  blockers: string[];
  warnings: string[];
  coverage: { linked_products: number; products_with_valid_origin: number; missing_origin: number };
  pending_jobs: number;
};
const recent = (value: string | null, minutes: number, now: Date) => {
  if (!value) return false;
  const age = now.getTime() - new Date(value).getTime();
  return Number.isFinite(age) && age >= 0 && age <= minutes * 60_000;
};
export function assessShipping(snapshot: ShippingSnapshot, now = new Date()): ShippingStatus {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!snapshot.worker_enabled) blockers.push("shipping_worker_disabled");
  if (!recent(snapshot.worker_heartbeat_at, 15, now)) blockers.push("worker_heartbeat_missing_or_stale");
  if (!recent(snapshot.provider_bridge_verified_at, 24 * 60, now)) blockers.push("provider_bridge_not_verified_recently");
  if (!snapshot.woo_enabled) blockers.push("woocommerce_bridge_disabled");
  if (!snapshot.woo_webhook_signature_ready) blockers.push("woocommerce_signature_missing");
  if (!snapshot.internal_key_ready) blockers.push("bot_internal_key_missing");
  const linked = Math.max(0, snapshot.linked_products);
  const withOrigin = Math.max(0, Math.min(linked, snapshot.products_with_valid_origin));
  if (linked === 0) blockers.push("product_mapping_empty");
  if (withOrigin === 0) blockers.push("origin_catalog_empty");
  // A selected product must be verified individually. Missing stock/origins for
  // unrelated catalog products should not block diagnostic quotations of an
  // otherwise-ready product.
  if (withOrigin < linked) warnings.push("origin_coverage_incomplete");
  return {
    status: blockers.length === 0 ? "ready" : "blocked",
    quote_processing_ready: blockers.length === 0,
    blockers,
    warnings,
    coverage: {
      linked_products: linked,
      products_with_valid_origin: withOrigin,
      missing_origin: linked - withOrigin
    },
    pending_jobs: Math.max(0, snapshot.pending_jobs)
  };
}

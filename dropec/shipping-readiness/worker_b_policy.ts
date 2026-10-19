// Supabase B shipping worker contract. Pure, offline-testable; never calls providers.
// This policy MUST NOT relax the existing master sales/payment/fulfillment gates.
import { type VerifiedQuoteRequest, validateQuoteResponse } from "./wordpress_quote_bridge.ts";
export const WORKER_B = Object.freeze({
  audience: "dropec-shipping-worker-b",
  issuer: "https://token.actions.githubusercontent.com",
  repository: "jokas29/project-bmo",
  repository_id: "1328431663",
  owner_id: "311696812",
  workflow_ref: "jokas29/project-bmo/.github/workflows/dropec-shipping-worker-b.yml@refs/heads/main",
  ref: "refs/heads/main",
  event_name: "workflow_dispatch",
});
type Obj = Record<string, unknown>;
const obj = (x: unknown): x is Obj => x !== null && typeof x === "object" && !Array.isArray(x);
const date = (x: unknown) => typeof x === "string" ? Date.parse(x) : NaN;
const fresh = (observed: unknown, validUntil: unknown, now: Date) => {
  const start = date(observed), end = date(validUntil), current = now.valueOf();
  return Number.isFinite(start) && Number.isFinite(end) &&
    start <= current && start >= current - 24 * 60 * 60 * 1000 &&
    end > current && end > start && end <= start + 24 * 60 * 60 * 1000;
};
const positiveInt = (x: unknown) => Number.isSafeInteger(Number(x)) && Number(x) > 0;
const positiveMoney = (x: unknown) =>
  Number.isFinite(Number(x)) && Number(x) > 0 && Number(x) <= 100000;
export class WorkerPolicyError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "WorkerPolicyError"; }
}
const block = (code: string): never => { throw new WorkerPolicyError(code); };

export function validWorkerClaims(c: unknown): boolean {
  if (!obj(c)) return false;
  return c.iss === WORKER_B.issuer &&
    (c.aud === WORKER_B.audience ||
      Array.isArray(c.aud) && c.aud.length === 1 && c.aud[0] === WORKER_B.audience) &&
    c.repository === WORKER_B.repository &&
    String(c.repository_id) === WORKER_B.repository_id &&
    String(c.repository_owner_id) === WORKER_B.owner_id &&
    c.workflow_ref === WORKER_B.workflow_ref &&
    c.ref === WORKER_B.ref &&
    c.event_name === WORKER_B.event_name &&
    /^[1-9][0-9]{3,19}$/.test(String(c.run_id || ""));
}

export type ShippingAssignment = {
  expected: VerifiedQuoteRequest;
  destination_code: string;
  checkout_version: string;
  dropi_product_id: number;
};

/** Bind the job to verified B catalog/origin/destination AND an unpaid checkout. */
export function shippingAssignment(
  job: Obj, checkout: Obj, product: Obj, origins: unknown[],
  destination: Obj | null, now = new Date()
): ShippingAssignment {
  const payload = job.request_payload;
  if (!obj(payload) || payload.rate_type !== "SIN RECAUDO" || !obj(payload.origin)) {
    return block("invalid_job_payload");
  }
  const qty = Number(job.quantity), amount = Number(job.product_amount);
  if (!positiveInt(job.woo_product_id) || !Number.isInteger(qty) || qty < 1 || qty > 20 ||
      !positiveMoney(amount) || !positiveInt(product.dropi_product_id) ||
      Number(product.woo_product_id) !== Number(job.woo_product_id) ||
      product.approved !== true || product.woo_status !== "publish" ||
      product.currency !== "USD") return block("invalid_product_context");
  if (typeof job.province !== "string" || !job.province.trim() ||
      typeof job.city !== "string" || !job.city.trim() ||
      job.province.length > 80 || job.city.length > 80) return block("invalid_route");
  if (Number(payload.woo_product_id) !== Number(job.woo_product_id) ||
      payload.province !== job.province || payload.city !== job.city ||
      Number(payload.amount) !== amount || Number(payload.quantity) !== qty) {
    return block("job_snapshot_mismatch");
  }
  if (checkout.platform !== job.platform || checkout.sender_id !== job.sender_id ||
      Number(checkout.woo_product_id) !== Number(job.woo_product_id) ||
      checkout.province !== job.province || checkout.city !== job.city ||
      Number(checkout.quantity) !== qty || !positiveMoney(checkout.unit_price) ||
      Math.abs(Number(checkout.unit_price) * qty - amount) > 0.001 ||
      checkout.payment_status !== "unpaid" || checkout.payment_intent_id != null ||
      checkout.payment_link != null || checkout.paid_at != null ||
      checkout.pending_order_job_id != null) return block("checkout_changed_or_paid");
  if (typeof checkout.updated_at !== "string" || !Number.isFinite(date(checkout.updated_at))) {
    return block("checkout_version_missing");
  }
  if (origins.length !== 1 || !obj(origins[0])) return block("verified_origin_missing_or_ambiguous");
  const origin = origins[0] as Obj;
  if (!fresh(origin.observed_at, origin.valid_until, now) ||
      Number(origin.stock_available) < qty ||
      Number(origin.dropi_product_id) !== Number(product.dropi_product_id) ||
      !obj(origin.origin_city) ||
      !positiveInt(origin.origin_city.id) ||
      !/^[0-9]{6,16}$/.test(String(origin.origin_city.cod_dane || "")) ||
      String(payload.origin.id) !== String(origin.origin_city.id) ||
      payload.origin.cod_dane !== origin.origin_city.cod_dane) {
    return block("verified_origin_changed_or_stale");
  }
  if (!destination || !fresh(destination.observed_at, destination.valid_until, now) ||
      destination.province !== job.province || destination.city !== job.city ||
      !/^[0-9]{6,16}$/.test(String(destination.cod_dane || ""))) {
    return block("verified_destination_missing_or_stale");
  }
  return {
    expected: {
      woo_product_id: Number(job.woo_product_id),
      province: job.province,
      city: job.city,
      amount,
      quantity: qty,
      origin: { id: Number(origin.origin_city.id), cod_dane: String(origin.origin_city.cod_dane) },
    },
    destination_code: String(destination.cod_dane),
    checkout_version: checkout.updated_at,
    dropi_product_id: Number(product.dropi_product_id),
  };
}

/** Revalidate the exact promised carrier/route when a worker reports back. */
export function verifyWorkerQuote(raw: unknown, assignment: ShippingAssignment) {
  const quote = validateQuoteResponse(raw, assignment.expected);
  if (quote.destination_code !== assignment.destination_code) {
    return block("verified_destination_mismatch");
  }
  return quote;
}

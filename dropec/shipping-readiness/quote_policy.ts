// Offline quote-cache policy. Never reuse a shipping price unless the
// verified source, delivery route and financial context are unchanged.
type Obj = Record<string, unknown>;
const rec = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
export type QuoteContext = {
  woo_product_id: number;
  quantity: number;
  product_amount: number;
  province: string;
  city: string;
  origin: { id: number | string; cod_dane: string };
};
export function freshMatchingQuote(
  job: unknown, context: QuoteContext, now = new Date(), ttlMinutes = 30
): number | null {
  if (!rec(job) || job.status !== "completed") return null;
  const amount = Number(job.shipping_amount);
  const completed = Date.parse(String(job.completed_at || ""));
  const age = now.getTime() - completed;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100 ||
      !Number.isFinite(completed) || age < 0 || age > ttlMinutes * 60000) return null;
  const raw = job.request_payload;
  if (!rec(raw) || !rec(raw.origin)) return null;
  if (raw.rate_type !== "SIN RECAUDO") return null;
  if (Number(job.woo_product_id) !== context.woo_product_id ||
      Number(job.product_amount) !== context.product_amount ||
      Number(job.quantity) !== context.quantity ||
      job.province !== context.province ||
      job.city !== context.city) return null;
  if (String(raw.origin.cod_dane) !== String(context.origin.cod_dane) ||
      String(raw.origin.id) !== String(context.origin.id)) return null;
  return amount;
}

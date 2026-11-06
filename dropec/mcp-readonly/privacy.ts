// Dropi get_order can return buyer names, phones, addresses and ID numbers.
// STRICT ALLOWLIST: return only selected scalar status/tracking fields to DropEC.
// Never persist or log a full order response.
type Rec = Record<string, unknown>;
function rec(v: unknown): v is Rec {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function unwrap(raw: unknown): Rec | null {
  if (!rec(raw)) return null;
  if (rec(raw.order)) return raw.order;
  if (rec(raw.data)) return raw.data;
  if (rec(raw.result)) return raw.result;
  return raw;
}
function scalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
export function safeOrderSummary(response: unknown): Rec {
  if (!rec(response)) return { available: false, reason: "invalid_upstream_response" };
  const candidates: unknown[] = [response.structuredContent];
  if (Array.isArray(response.content)) {
    for (const item of response.content.slice(0, 8)) {
      if (!rec(item) || item.type !== "text" || typeof item.text !== "string") continue;
      if (item.text.length > 50000) continue;
      try { candidates.push(JSON.parse(item.text)); } catch {
        // Dropi may send a non-JSON human text; do not return it.
      }
    }
  }
  for (const candidate of candidates) {
    const order = unwrap(candidate);
    if (!order) continue;
    const out: Rec = {};
    for (const key of [
      "id", "order_id", "order_number", "status", "tracking_code",
      "currency", "payment_method", "created_at", "updated_at"
    ]) {
      const v = order[key];
      if (scalar(v) && String(v).length <= 160) out[key] = v;
    }
    if (Object.keys(out).length) return { available: true, ...out };
  }
  return { available: false, reason: "unstructured_order_redacted" };
}

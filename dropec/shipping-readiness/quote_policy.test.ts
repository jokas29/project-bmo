import { freshMatchingQuote, type QuoteContext } from "./quote_policy.ts";
function eq(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error("not_equal"); }
const now = new Date("2026-10-17T22:00:00.000Z");
const context: QuoteContext = {
  woo_product_id: 29, quantity: 1, product_amount: 25, province: "Los Ríos",
  city: "Babahoyo", origin: { id: 802, cod_dane: "201001001001" }
};
const valid = {
  status: "completed", woo_product_id: 29, quantity: 1,
  product_amount: 25, province: "Los Ríos", city: "Babahoyo",
  shipping_amount: 5.12, completed_at: "2026-10-17T21:48:00.000Z",
  request_payload: { rate_type: "SIN RECAUDO", origin: { id: 802, cod_dane: "201001001001" } }
};
Deno.test("fresh same-context shipping quote can be reused", () => {
  eq(freshMatchingQuote(valid, context, now), 5.12);
});
Deno.test("reject stale shipping price even if prior session retains its amount", () => {
  eq(freshMatchingQuote({ ...valid, completed_at: "2026-10-17T21:20:00.000Z" }, context, now), null);
});
Deno.test("reject future or invalid provider time and amount", () => {
  eq(freshMatchingQuote({ ...valid, completed_at: "2026-10-17T22:01:00.000Z" }, context, now), null);
  eq(freshMatchingQuote({ ...valid, shipping_amount: "Infinity" }, context, now), null);
  eq(freshMatchingQuote({ ...valid, shipping_amount: -1 }, context, now), null);
});
Deno.test("changing product, destination, quantity, amount or city ID forces new quote", () => {
  for (const variation of [
    { woo_product_id: 30 }, { quantity: 2 }, { product_amount: 26 },
    { province: "Guayas" }, { city: "Guayaquil" },
    { origin: { id: 999, cod_dane: "201001001001" } },
    { origin: { id: 802, cod_dane: "201001013013" } }
  ]) eq(freshMatchingQuote(valid, { ...context, ...variation }, now), null);
});
Deno.test("reject COD prices, failed jobs, and mismatched origin snapshots", () => {
  eq(freshMatchingQuote({ ...valid, status: "failed" }, context, now), null);
  eq(freshMatchingQuote({ ...valid, request_payload: { ...valid.request_payload, rate_type: "CON RECAUDO" } }, context, now), null);
  eq(freshMatchingQuote({ ...valid, request_payload: {} }, context, now), null);
  eq(freshMatchingQuote(null, context, now), null);
});

import { safeOrderSummary } from "./privacy.ts";
function ok(v: unknown): asserts v { if (!v) throw new Error("assertion_failed"); }
function equal(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("not_equal");
}
Deno.test("structured Dropi orders redact customer contact, address, and items", () => {
  const input = { structuredContent: {
    data: { id: "ORD-2026-11", status: "in_transit", tracking_code: "ABC123",
      currency: "USD", payment_method: "cash",
      customer: { name: "PRIVATE_PERSON", phone: "+593999888777" },
      address: "PRIVATE STREET", document_number: "0123456789", items: [{ title: "PRIVATE ITEM" }]
    }
  }};
  const r = safeOrderSummary(input);
  equal(r, { available: true, id: "ORD-2026-11", status: "in_transit",
    tracking_code: "ABC123", currency: "USD", payment_method: "cash" });
  const raw = JSON.stringify(r);
  for (const value of ["PRIVATE_PERSON", "PRIVATE STREET", "PRIVATE ITEM", "0123456789"]) ok(!raw.includes(value));
});
Deno.test("JSON text MCP response is converted to status-only summary", () => {
  const raw = { content: [{ type: "text",
    text: JSON.stringify({ order: { id: "ORD-2", status: "delivered", customer_email: "person@example.com" } })
  }] };
  equal(safeOrderSummary(raw), { available: true, id: "ORD-2", status: "delivered" });
});
Deno.test("unstructured upstream response never reveals buyer details", () => {
  const raw = { content: [{ type: "text", text: "buyer personally identifiable info: phone and street" }] };
  equal(safeOrderSummary(raw), { available: false, reason: "unstructured_order_redacted" });
});

// Input schemas transcribed from Dropi MCP tool definitions reported on 2026-10-17.
// Fail closed: Dropi specifies additionalProperties: false at every object level.
// This adapter deliberately does NOT expose create_order or arbitrary MCP tool names.
export type ReadOnlyAction = "quote" | "get-order";
type RecordValue = Record<string, unknown>;

function object(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function onlyKeys(value: RecordValue, allowed: readonly string[]): boolean {
  return Object.keys(value).every((name) => allowed.includes(name));
}
function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function textValue(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && value.trim().length > 0;
}
function optionalText(value: unknown, max: number): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.length <= max);
}
function validCity(value: unknown): boolean {
  if (!object(value) || !onlyKeys(value, ["id", "dane_code", "zip_code"])) return false;
  return positiveInteger(value.id) &&
    textValue(value.dane_code, 64) &&
    Object.hasOwn(value, "zip_code") &&
    (value.zip_code === null || (typeof value.zip_code === "string" && value.zip_code.length <= 64));
}
function validProduct(value: unknown): boolean {
  if (!object(value) || !onlyKeys(value, ["id", "type", "quantity", "price", "variation_id"])) return false;
  if (!positiveInteger(value.id) ||
      !["SIMPLE", "VARIABLE", "COMBO"].includes(String(value.type)) ||
      !positiveInteger(value.quantity) ||
      typeof value.price !== "number" ||
      !Number.isFinite(value.price) || value.price <= 0) return false;
  const variation = value.variation_id;
  return value.type === "VARIABLE" ? positiveInteger(variation)
    : variation === undefined || variation === null;
}
export function validateToolInput(action: ReadOnlyAction, input: unknown): string | null {
  if (!object(input)) return "invalid_input_object";
  if (action === "get-order") {
    return onlyKeys(input, ["id"]) && textValue(input.id, 120)
      ? null : "invalid_get_order_input";
  }
  if (action !== "quote") return "tool_not_allowed";
  if (!onlyKeys(input, [
    "cash_on_delivery", "destination_city", "products", "direction", "neighborhood", "zip_code"
  ])) return "unexpected_quote_field";
  if (typeof input.cash_on_delivery !== "boolean") return "cash_on_delivery_required";
  if (!validCity(input.destination_city)) return "invalid_destination_city";
  // The published schema permits null for products, but specifies minItems:1.
  // Fail closed on null: a quote with no products cannot be evaluated safely.
  if (!Array.isArray(input.products) || input.products.length < 1 || input.products.length > 20 ||
    !input.products.every(validProduct)) return "invalid_products";
  if (!optionalText(input.direction, 512) ||
      !optionalText(input.neighborhood, 160) ||
      !optionalText(input.zip_code, 64)) return "invalid_delivery_details";
  return null;
}

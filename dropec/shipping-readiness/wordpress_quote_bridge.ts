/**
 * WordPress shipping-quote-v2 contract (DropEC / Supabase B).
 * OFFLINE BY DEFAULT. Never create Woo/Dropi orders; never use /wake.
 * The caller must obtain a narrowly authorized signing secret from B Vault.
 */
export type VerifiedQuoteRequest = {
  woo_product_id: number;
  province: string;
  city: string;
  amount: number;
  quantity: number;
  origin: { id: number | string; cod_dane: string };
};
export type ValidShippingQuote = {
  shipping_amount: number;
  carrier: string;
  origin_code: string;
  destination_code: string;
  options: { price: number; carrier: string }[];
};
type RecordLike = Record<string, unknown>;
const isRecord = (v: unknown): v is RecordLike =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const money = (v: unknown) => typeof v === "number" &&
  Number.isFinite(v) && v > 0 && v <= 100 && Math.round(v * 100) / 100 === v;
const dane = (v: unknown) => typeof v === "string" && /^[0-9]{6,16}$/.test(v);
const str = (v: unknown) => typeof v === "string" && v.trim().length > 0;
export class WordPressQuoteError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "WordPressQuoteError";
  }
}
function reject(code: string): never { throw new WordPressQuoteError(code); }

/** Only the historical, already-audited quote route is permitted. */
export function assertQuoteEndpoint(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { return reject("invalid_wordpress_quote_endpoint"); }
  if (url.protocol !== "https:" ||
      url.hostname !== "radarcommerce.byethost7.com" ||
      url.port !== "" ||
      url.username || url.password || url.search || url.hash ||
      url.pathname !== "/wp-json/dropec/v1/shipping-quote-v2") {
    reject("invalid_wordpress_quote_endpoint");
  }
  return url.href;
}

/** The verified B warehouse is mandatory; do not let WordPress guess it. */
export function serializeQuoteRequest(value: VerifiedQuoteRequest): string {
  const { woo_product_id, quantity, amount, province, city, origin } = value;
  if (!Number.isSafeInteger(woo_product_id) || woo_product_id < 1 ||
      !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20 ||
      typeof amount !== "number" || !Number.isFinite(amount) ||
      amount <= 0 || amount > 100000 ||
      !str(province) || !str(city) ||
      province.length > 80 || city.length > 80 ||
      !origin || !Number.isSafeInteger(Number(origin.id)) ||
      Number(origin.id) < 1 || !dane(origin.cod_dane)) {
    reject("invalid_verified_quote_context");
  }
  return JSON.stringify({
    woo_product_id, province, city, amount, quantity,
    origin: { id: Number(origin.id), cod_dane: origin.cod_dane }
  });
}

/** HMAC-SHA256, base64 of raw digest, exactly as dropec_v16_verify_signature(). */
export async function signQuoteBody(raw: string, secret: string): Promise<string> {
  if (!secret || !raw) reject("missing_signing_context");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(raw)));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Do not trust WordPress fallbacks or accept an arbitrary cheap numeric value. */
export function validateQuoteResponse(
  raw: unknown, expected: VerifiedQuoteRequest
): ValidShippingQuote {
  if (!isRecord(raw) || raw.ok !== true) reject("wordpress_quote_rejected");
  if (!dane(expected.origin.cod_dane) || !dane(raw.origin_code) ||
      raw.origin_code !== expected.origin.cod_dane) {
    reject("wordpress_origin_mismatch");
  }
  if (!dane(raw.destination_code)) reject("invalid_destination_code");
  if (!Array.isArray(raw.options) || raw.options.length < 1 ||
      raw.options.length > 30) reject("invalid_shipping_options");
  const options: ValidShippingQuote["options"] = [];
  for (const option of raw.options) {
    if (!isRecord(option) || !money(option.price) || !str(option.carrier) ||
        (option.carrier as string).length > 120) reject("invalid_shipping_options");
    options.push({ price: option.price as number, carrier: (option.carrier as string).trim() });
  }
  if (!money(raw.shipping_amount) || !str(raw.carrier)) {
    reject("invalid_shipping_selection");
  }
  const minimum = Math.min(...options.map((o) => o.price));
  const picked = options.some((o) =>
    o.price === raw.shipping_amount && o.carrier === (raw.carrier as string).trim());
  if (!picked || raw.shipping_amount !== minimum) reject("invalid_shipping_selection");
  return {
    shipping_amount: raw.shipping_amount as number,
    carrier: (raw.carrier as string).trim(),
    origin_code: expected.origin.cod_dane,
    destination_code: raw.destination_code as string,
    options,
  };
}

/** No implicit redirects, retries, webhooks, catalog ticks or order-side effects. */
export async function requestWordPressQuote(
  endpoint: string, value: VerifiedQuoteRequest, signingSecret: string,
  transport: typeof fetch = fetch
): Promise<ValidShippingQuote> {
  const url = assertQuoteEndpoint(endpoint);
  const body = serializeQuoteRequest(value);
  const signature = await signQuoteBody(body, signingSecret);
  let response: Response;
  try {
    response = await transport(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(25000),
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "x-dropec-signature": signature,
        "Cache-Control": "no-store",
      },
      body,
    });
  } catch {
    return reject("wordpress_quote_transport_failed");
  }
  if (!response.ok) return reject(response.status === 401 ?
    "wordpress_quote_signature_rejected" : "wordpress_quote_http_error");
  if (Number(response.headers.get("content-length") || 0) > 128000) {
    reject("wordpress_quote_response_too_large");
  }
  let received = 0;
  const chunks: Uint8Array[] = [];
  if (!response.body) reject("wordpress_quote_response_empty");
  const reader = response.body!.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      received += result.value.byteLength;
      if (received > 128000) reject("wordpress_quote_response_too_large");
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(output)); }
  catch { return reject("wordpress_quote_invalid_json"); }
  return validateQuoteResponse(parsed, value);
}

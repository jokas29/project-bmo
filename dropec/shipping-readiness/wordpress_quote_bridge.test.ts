import {
  assertQuoteEndpoint, requestWordPressQuote, serializeQuoteRequest,
  signQuoteBody, validateQuoteResponse, WordPressQuoteError
} from "./wordpress_quote_bridge.ts";
const endpoint = "https://radarcommerce.byethost7.com/wp-json/dropec/v1/shipping-quote-v2";
const context = { woo_product_id: 29, province: "Los Ríos", city: "Babahoyo",
  amount: 25, quantity: 1, origin: { id: 51, cod_dane: "201001001001" } };
const valid = { ok: true, shipping_amount: 3.25, carrier: "Transportadora",
  origin_code: "201001001001", destination_code: "201001013013",
  options: [{price: 3.25, carrier: "Transportadora"}, {price: 4.99, carrier: "Otra"}] };
function check(value: unknown, message: string) {
  if (!value) throw new Error(message);
}
function fails(fn: () => unknown, expected: string) {
  try { fn(); } catch (error) {
    if (error instanceof WordPressQuoteError && error.code === expected) return;
    throw error;
  }
  throw new Error("Expected " + expected);
}
Deno.test("accept only the audited WordPress quote endpoint", () => {
  check(assertQuoteEndpoint(endpoint) === endpoint, "valid endpoint");
  for (const bad of [
    endpoint.replace("shipping-quote-v2", "wake"), endpoint.replace("https:", "http:"),
    endpoint + "?a=b", "https://evil.example/wp-json/dropec/v1/shipping-quote-v2",
    "https://radarcommerce.byethost7.com.evil.example/wp-json/dropec/v1/shipping-quote-v2"
  ]) fails(() => assertQuoteEndpoint(bad), "invalid_wordpress_quote_endpoint");
});
Deno.test("requires fresh-verified origin shape and sane amounts before transport", () => {
  check(JSON.parse(serializeQuoteRequest(context)).origin.cod_dane === "201001001001", "origin serialized");
  fails(() => serializeQuoteRequest({...context, quantity: 0}), "invalid_verified_quote_context");
  fails(() => serializeQuoteRequest({...context, origin:{id:51,cod_dane:""}}), "invalid_verified_quote_context");
  fails(() => serializeQuoteRequest({...context, amount: Number.NaN}), "invalid_verified_quote_context");
});
Deno.test("verifies exact origin, matching cheapest carrier and numeric destination", () => {
  check(validateQuoteResponse(valid, context).shipping_amount === 3.25, "good quote");
  fails(() => validateQuoteResponse({...valid,origin_code:"201001013001"},context),"wordpress_origin_mismatch");
  fails(() => validateQuoteResponse({...valid,shipping_amount:4.99,carrier:"Otra"},context),"invalid_shipping_selection");
  fails(() => validateQuoteResponse({...valid,destination_code:"Babahoyo"},context),"invalid_destination_code");
  fails(() => validateQuoteResponse({...valid,options:[{price:0.02,carrier:""}]},context),"invalid_shipping_options");
  fails(() => validateQuoteResponse({...valid,ok:false},context),"wordpress_quote_rejected");
});
Deno.test("HMAC matches a fixed SHA256 base64 test vector", async () => {
  check(await signQuoteBody("hello", "key") ===
    "kwezuRXvtRcf8U2MtV+8x5jGwO8UVtZt7RpqpyOli3s=", "HMAC digest");
});
Deno.test("signed POST remains on the quote path, one call only; result is allowlisted", async () => {
  let calls = 0;
  const response = await requestWordPressQuote(endpoint, context, "key", async (url,init) => {
    calls++;
    check(url === endpoint, "endpoint mismatch");
    check(init?.method === "POST" && init.redirect === "error", "unsafe method or redirect");
    check(JSON.parse(String(init.body)).quantity === 1, "invalid request");
    check(typeof (init.headers as Record<string,string>)["x-dropec-signature"] === "string", "unsigned");
    return Response.json({...valid, raw:{ secret:"not-for-client" }});
  });
  check(calls === 1 && response.shipping_amount === 3.25, "quote result");
  check(!("raw" in response), "raw leaked");
});
Deno.test("fail closed when WordPress rejects signature or origin mismatches", async () => {
  for (const [source,expected] of [
    [new Response("no", {status:401}),"wordpress_quote_signature_rejected"],
    [Response.json({...valid, origin_code: "201001013001"}),"wordpress_origin_mismatch"],
    [new Response("<html>challenge</html>"),"wordpress_quote_invalid_json"],
  ] as const) {
    try {
      await requestWordPressQuote(endpoint,context,"key",async()=>source);
      throw new Error("Unsafe quote accepted");
    } catch (error) {
      check(error instanceof WordPressQuoteError && error.code === expected, "wrong rejection");
    }
  }
});
Deno.test("never follow redirects or call anything when endpoint is not allowlisted", async () => {
  let called = false;
  try {
    await requestWordPressQuote(endpoint.replace("shipping-quote-v2","wake"),context,"key",
      async()=>{called=true; return Response.json(valid);});
  } catch (error) {
    check(error instanceof WordPressQuoteError, "must reject");
  }
  check(!called, "unsafe transport used");
});

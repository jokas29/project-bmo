import {
  OAUTH, nonce, sha256Base64Url, validateMetadata, redirectUriForB,
  registrationRequest, validateRegistration, authorizationUrl, tokenRequest, validateToken
} from "./oauth_protocol.ts";
function assert(v: unknown) { if (!v) throw Error("assert_failed"); }
function equal(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw Error("not_equal");
}
function throws(fn: () => unknown) {
  let failed = false;
  try { fn(); } catch { failed = true; }
  assert(failed);
}
const resource = {
  resource: OAUTH.resource,
  authorization_servers: [OAUTH.advertisedServer],
  scopes_supported: ["mcp"],
};
const issuer = {
  issuer: OAUTH.issuer,
  authorization_endpoint: OAUTH.authorization,
  token_endpoint: OAUTH.token,
  registration_endpoint: OAUTH.registration,
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"]
};
Deno.test("RFC7636 PKCE reference verifier gives expected challenge", async () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  equal(await sha256Base64Url(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});
Deno.test("state and verifier are cryptographically random and correctly shaped", () => {
  const a = nonce(), b = nonce();
  assert(a !== b);
  equal(a.length, 43);
  assert(/^[a-zA-Z0-9_-]{43}$/.test(a));
  throws(() => nonce(12));
});
Deno.test("OAuth discovery fails closed on the live /bff versus root issuer mismatch", () => {
  // Dropi's current public metadata: the protected resource advertises /bff
  // but the authorization-server metadata says the root is the issuer.
  equal(validateMetadata(resource, issuer), false);
  // After Dropi aligns the resource's authorization_servers to the exact
  // pinned issuer, the metadata can be accepted without weakening checks.
  const corrected = { ...resource, authorization_servers: [OAUTH.issuer] };
  equal(validateMetadata(corrected, issuer), true);
  equal(validateMetadata({ ...corrected, resource: "https://wrong.example/mcp" }, issuer), false);
  equal(validateMetadata(corrected, { ...issuer, issuer: OAUTH.advertisedServer }), false);
  equal(validateMetadata(corrected, { ...issuer, token_endpoint: "https://example.com/steal" }), false);
  equal(validateMetadata({ ...corrected, authorization_servers: ["https://evil.example"] }, issuer), false);
  equal(validateMetadata(corrected, { ...issuer, code_challenge_methods_supported: ["plain"] }), false);
});
Deno.test("OAuth registration always binds to the exact B callback", () => {
  const redirect = redirectUriForB("ubxkqbnzdtgfvphwohzm");
  const body = registrationRequest(redirect);
  equal(body.redirect_uris, [redirect]);
  equal(body.token_endpoint_auth_method, "none");
  throws(() => redirectUriForB("kzwzputkwcpojevffjrm"));
  throws(() => registrationRequest("https://attacker.example/collect"));
  equal(validateRegistration({ client_id: "dropec-client-123", token_endpoint_auth_method: "none", redirect_uris: [redirect] }, redirect), "dropec-client-123");
  equal(validateRegistration({ client_id: "dropec-client-123", client_secret: "unexpected" }, redirect), null);
  equal(validateRegistration({ client_id: "dropec-client-123", redirect_uris: ["https://elsewhere.example"] }, redirect), null);
});
Deno.test("authorization URL uses code flow, S256, state and correct resource", async () => {
  const state = nonce();
  const verifier = nonce();
  const redirectUri = redirectUriForB("ubxkqbnzdtgfvphwohzm");
  const url = new URL(authorizationUrl({ clientId: "dropec-client-123", redirectUri, state, challenge: await sha256Base64Url(verifier) }));
  equal(url.origin, "https://oauth.dropi.co");
  equal(url.searchParams.get("response_type"), "code");
  equal(url.searchParams.get("code_challenge_method"), "S256");
  equal(url.searchParams.get("scope"), "mcp");
  equal(url.searchParams.get("resource"), OAUTH.resource);
  equal(url.searchParams.get("state"), state);
  equal(url.searchParams.get("redirect_uri"), redirectUri);
  assert(!url.href.includes(verifier));
});
Deno.test("token request includes verifier but never client secrets or passwords", () => {
  const verifier = nonce();
  const form = tokenRequest({
    code: "safe-authorization-code", clientId: "dropec-client-123",
    redirectUri: redirectUriForB("ubxkqbnzdtgfvphwohzm"), verifier
  });
  equal(form.get("grant_type"), "authorization_code");
  equal(form.get("code_verifier"), verifier);
  equal(form.get("resource"), OAUTH.resource);
  equal(form.get("client_secret"), null);
});
Deno.test("rejects incomplete tokens (cannot persist without refresh)", () => {
  equal(validateToken({token_type:"Bearer",access_token:"a".repeat(30),expires_in:3600}),null);
  equal(validateToken({token_type:"Bearer",access_token:"a".repeat(30),refresh_token:"b".repeat(40),expires_in:3600})?.expiresIn,3600);
  equal(validateToken({token_type:"Basic",access_token:"a".repeat(30),refresh_token:"b".repeat(40),expires_in:3600}),null);
  equal(validateToken({token_type:"Bearer",access_token:"a".repeat(30),refresh_token:"b".repeat(40),expires_in:10}),null);
});

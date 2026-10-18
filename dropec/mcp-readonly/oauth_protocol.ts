// DropEC -> Dropi OAuth 2.1: trusted, fixed metadata + PKCE helpers.
// This file contains NO credentials and never issues Dropi orders.
// The resource metadata's /bff alias differs from its issuer. We do NOT
// silently normalize issuers; operators must explicitly approve the pinned
// ROOT issuer after reviewing verified metadata.
export const OAUTH = Object.freeze({
  resource: "https://mcp.dropi.co/mcp",
  resourceMetadata: "https://mcp.dropi.co/.well-known/oauth-protected-resource/mcp",
  advertisedServer: "https://integrations.dropi.co/bff",
  issuer: "https://integrations.dropi.co",
  serverMetadata: "https://integrations.dropi.co/.well-known/oauth-authorization-server",
  authorization: "https://oauth.dropi.co/oauth/authorize",
  registration: "https://integrations.dropi.co/oauth/register",
  token: "https://integrations.dropi.co/oauth/token",
  revocation: "https://integrations.dropi.co/oauth/revoke",
  scope: "mcp",
});
export type ValueObject = Record<string, unknown>;
export function isObject(v: unknown): v is ValueObject {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
export function b64url(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
export function nonce(count = 32): string {
  if (!Number.isInteger(count) || count < 32 || count > 64) throw Error("invalid_nonce_size");
  return b64url(crypto.getRandomValues(new Uint8Array(count)));
}
export async function sha256Base64Url(value: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
export function validateMetadata(resource: unknown, issuer: unknown): boolean {
  if (!isObject(resource) || !isObject(issuer)) return false;
  // Precondition: root issuer was pinned manually and is independent of
  // the /bff path advertised by Dropi's protected resource metadata.
  return resource.resource === OAUTH.resource &&
    Array.isArray(resource.authorization_servers) &&
    resource.authorization_servers.length === 1 &&
    resource.authorization_servers[0] === OAUTH.advertisedServer &&
    issuer.issuer === OAUTH.issuer &&
    issuer.authorization_endpoint === OAUTH.authorization &&
    issuer.token_endpoint === OAUTH.token &&
    issuer.registration_endpoint === OAUTH.registration &&
    Array.isArray(issuer.grant_types_supported) &&
    issuer.grant_types_supported.includes("authorization_code") &&
    issuer.grant_types_supported.includes("refresh_token") &&
    Array.isArray(issuer.code_challenge_methods_supported) &&
    issuer.code_challenge_methods_supported.includes("S256") &&
    Array.isArray(issuer.token_endpoint_auth_methods_supported) &&
    issuer.token_endpoint_auth_methods_supported.includes("none");
}
export function redirectUriForB(projectRef: string): string {
  if (projectRef !== "ubxkqbnzdtgfvphwohzm") throw Error("unexpected_project");
  return `https://${projectRef}.supabase.co/functions/v1/dropec-dropi-oauth/callback`;
}
export function registrationRequest(redirectUri: string): ValueObject {
  if (redirectUri !== redirectUriForB("ubxkqbnzdtgfvphwohzm")) throw Error("redirect_not_approved");
  return {
    client_name: "DropEC secure diagnostics (read only)",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: "mcp",
  };
}
export function validateRegistration(value: unknown, redirect: string): string | null {
  if (!isObject(value) || typeof value.client_id !== "string" ||
      !/^[A-Za-z0-9._~:-]{4,512}$/.test(value.client_id)) return null;
  if (value.token_endpoint_auth_method && value.token_endpoint_auth_method !== "none") return null;
  if (value.client_secret !== undefined) return null;
  if (Array.isArray(value.redirect_uris) && !value.redirect_uris.includes(redirect)) return null;
  return value.client_id;
}
export function authorizationUrl(data: {
  clientId: string; redirectUri: string; state: string; challenge: string;
}): string {
  if (data.redirectUri !== redirectUriForB("ubxkqbnzdtgfvphwohzm")) throw Error("redirect_not_approved");
  if (!/^[A-Za-z0-9._~:-]{4,512}$/.test(data.clientId)) throw Error("invalid_client_id");
  if (!/^[a-zA-Z0-9_-]{43,128}$/.test(data.state)) throw Error("invalid_state");
  if (!/^[a-zA-Z0-9_-]{43}$/.test(data.challenge)) throw Error("invalid_challenge");
  const u = new URL(OAUTH.authorization);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", data.clientId);
  u.searchParams.set("redirect_uri", data.redirectUri);
  u.searchParams.set("state", data.state);
  u.searchParams.set("scope", OAUTH.scope);
  u.searchParams.set("resource", OAUTH.resource);
  u.searchParams.set("code_challenge", data.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}
export function tokenRequest(data: {
  code: string; clientId: string; redirectUri: string; verifier: string;
}): URLSearchParams {
  if (data.redirectUri !== redirectUriForB("ubxkqbnzdtgfvphwohzm")) throw Error("redirect_not_approved");
  if (!/^[a-zA-Z0-9._~:-]{4,512}$/.test(data.clientId)) throw Error("invalid_client_id");
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(data.verifier)) throw Error("invalid_verifier");
  if (!data.code || data.code.length > 2048) throw Error("invalid_code");
  return new URLSearchParams({
    grant_type: "authorization_code",
    code: data.code,
    redirect_uri: data.redirectUri,
    client_id: data.clientId,
    code_verifier: data.verifier,
    resource: OAUTH.resource,
  });
}
export function validateToken(data: unknown): {
  accessToken: string; refreshToken: string; expiresIn: number; scope: string;
} | null {
  if (!isObject(data) || String(data.token_type).toLowerCase() !== "bearer" ||
      typeof data.access_token !== "string" || data.access_token.length < 20 ||
      typeof data.refresh_token !== "string" || data.refresh_token.length < 20 ||
      typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) ||
      data.expires_in <= 30 || data.expires_in > 2592000) return null;
  if (data.scope && typeof data.scope !== "string") return null;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: (data.scope as string | undefined) ?? OAUTH.scope,
  };
}

export function refreshRequest(clientId: string, refreshToken: string): URLSearchParams {
  if (!/^[A-Za-z0-9._~:-]{4,512}$/.test(clientId)) throw Error("invalid_client_id");
  if (typeof refreshToken !== "string" || refreshToken.length < 20 || refreshToken.length > 16000)
    throw Error("invalid_refresh_token");
  return new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: refreshToken,
    resource: OAUTH.resource,
  });
}
export function validateRefreshedToken(data: unknown, previousRefresh: string): {
  accessToken: string; refreshToken: string; expiresIn: number; scope: string;
} | null {
  if (!isObject(data) || String(data.token_type).toLowerCase() !== "bearer" ||
      typeof data.access_token !== "string" || data.access_token.length < 20 ||
      typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) ||
      data.expires_in <= 30 || data.expires_in > 2592000 ||
      (data.refresh_token != null && (
        typeof data.refresh_token !== "string" || data.refresh_token.length < 20
      ))) return null;
  const scope = typeof data.scope === "string" ? data.scope : OAUTH.scope;
  if (scope.split(/\s+/).some(s => s !== "mcp")) return null;
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : previousRefresh,
    expiresIn: data.expires_in,
    scope,
  };
}

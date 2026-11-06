// Supabase B ONLY. Separate OAuth callback: verify_jwt=false because Dropi
// redirects an ordinary browser without a Supabase JWT.
// All non-callback setup operations additionally require an internal key
// generated and stored exclusively inside Supabase Vault.
// START IS DISABLED IN DB until the user expressly approves replacing an
// existing Dropi/Claude session and accepts MCP scope ("create_order" is in
// the provider-granted scope; the DropEC MCP client does not expose it).
import postgres from "npm:postgres@3.4.7";
import {
  OAUTH, nonce, sha256Base64Url, validateMetadata, redirectUriForB,
  registrationRequest, validateRegistration, authorizationUrl,
  tokenRequest, validateToken
} from "./oauth_protocol.ts";

const DATABASE_URL = Deno.env.get("SUPABASE_DB_URL");
const sql = DATABASE_URL ? postgres(DATABASE_URL, {
  max: 1, prepare: false, ssl: { rejectUnauthorized: true },
  connection: { application_name: "dropec-mcp-oauth", statement_timeout: 12000 },
}) : null;
const JSON_HEADERS = {
  "Cache-Control": "no-store, max-age=0", "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
};
const ok = (body: object, status = 200) =>
  Response.json(body, { status, headers: JSON_HEADERS });
const refusal = (status: number, code: string) => ok({ ok: false, error: code }, status);

async function jsonGet(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" }, redirect: "error",
    signal: AbortSignal.timeout(9000)
  });
  if (res.status !== 200 || Number(res.headers.get("content-length") || 0) > 30000)
    throw Error("discovery_failed");
  const text = await res.text();
  if (text.length > 30000) throw Error("discovery_oversized");
  return JSON.parse(text);
}
async function jsonPost(url: string, body: object): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(12000)
  });
  if (![200, 201].includes(res.status)) throw Error("registration_failed");
  const text = await res.text();
  if (text.length > 25000) throw Error("registration_oversized");
  return JSON.parse(text);
}
async function compareSecret(provided: string, actual: string): Promise<boolean> {
  if (!provided || !actual || provided.length > 512 || actual.length > 512) return false;
  const hashed = await Promise.all([provided, actual].map(async (v) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))));
  let xor = 0;
  for (let i = 0; i < 32; i++) xor |= hashed[0][i] ^ hashed[1][i];
  return xor === 0;
}
async function authorizedForSetup(req: Request): Promise<boolean> {
  if (!sql) return false;
  const provided = req.headers.get("x-dropec-oauth-setup-key") || "";
  if (!provided) return false;
  const [item] = await sql`
    select decrypted_secret from vault.decrypted_secrets
    where name='dropec_mcp_oauth_setup_key' limit 1`;
  return await compareSecret(provided, String(item?.decrypted_secret || ""));
}
async function start(req: Request): Promise<Response> {
  if (!sql || !await authorizedForSetup(req)) return refusal(401, "unauthorized");
  const [cfg] = await sql`
    select setup_enabled, pinned_issuer_approved, session_replacement_ack
    from dropec_private.dropi_mcp_oauth_settings where singleton=true`;
  if (!cfg?.setup_enabled || !cfg?.pinned_issuer_approved || !cfg?.session_replacement_ack)
    return refusal(423, "oauth_setup_requires_explicit_approval");

  // These two HTTPS endpoints are independently hard-pinned to Dropi.
  // The protected resource advertises an /bff alias; the root issuer is
  // verified against its OWN well-known document, never silently rewritten.
  const [resource, issuer] = await Promise.all([
    jsonGet(OAUTH.resourceMetadata), jsonGet(OAUTH.serverMetadata)
  ]);
  if (!validateMetadata(resource, issuer)) return refusal(502, "oauth_metadata_changed");

  const redirectUri = redirectUriForB("ubxkqbnzdtgfvphwohzm");
  const data = await jsonPost(OAUTH.registration, registrationRequest(redirectUri));
  const clientId = validateRegistration(data, redirectUri);
  if (!clientId) return refusal(502, "oauth_registration_invalid");

  const verifier = nonce(48);
  const state = nonce(48);
  const challenge = await sha256Base64Url(verifier);
  const stateHash = await sha256Base64Url(state);
  await sql.begin(async (tx) => {
    const [secret] = await tx`
      select vault.create_secret(
        ${verifier}, ${"dropec_mcp_pkce_" + crypto.randomUUID()},
        'One-time PKCE verifier; delete after callback'
      ) as id`;
    await tx`
      insert into dropec_private.dropi_mcp_oauth_pending
        (state_sha256, verifier_secret_id, client_id, redirect_uri, expires_at)
      values (${stateHash}, ${secret.id}, ${clientId}, ${redirectUri},
              now() + interval '10 minutes')`;
  });
  return ok({
    ok: true, status: "authorization_required",
    // State is a one-time CSRF token, never the verifier or access token.
    authorization_url: authorizationUrl({ clientId, redirectUri, state, challenge }),
    expires_in_seconds: 600,
    warning: "Approving may terminate your existing Claude Dropi session."
  });
}
async function persist(connection: {
  clientId: string; accessToken: string; refreshToken: string;
  expiresIn: number; scope: string;
}): Promise<void> {
  if (!sql) throw Error("database_unavailable");
  await sql.begin(async tx => {
    const [prev] = await tx`
      select access_secret_id, refresh_secret_id
      from dropec_private.dropi_mcp_oauth_connection
      where singleton=true for update`;
    let accessId: string;
    let refreshId: string;
    if (prev?.access_secret_id && prev?.refresh_secret_id) {
      await tx`select vault.update_secret(${prev.access_secret_id},
        ${connection.accessToken})`;
      await tx`select vault.update_secret(${prev.refresh_secret_id},
        ${connection.refreshToken})`;
      accessId = String(prev.access_secret_id);
      refreshId = String(prev.refresh_secret_id);
    } else {
      const [a] = await tx`
        select vault.create_secret(
          ${connection.accessToken}, ${"dropec_mcp_access_" + crypto.randomUUID()},
          'DropEC MCP access credential, B only'
        ) as id`;
      const [r] = await tx`
        select vault.create_secret(
          ${connection.refreshToken}, ${"dropec_mcp_refresh_" + crypto.randomUUID()},
          'DropEC MCP renewable credential, B only'
        ) as id`;
      accessId = String(a.id);
      refreshId = String(r.id);
    }
    await tx`
      insert into dropec_private.dropi_mcp_oauth_connection
      (singleton, client_id, access_secret_id, refresh_secret_id,
       token_type, scopes, access_expires_at, connected_at, updated_at)
      values (true, ${connection.clientId}, ${accessId},
              ${refreshId}, 'Bearer', ${connection.scope},
              now() + (${Math.floor(connection.expiresIn)} * interval '1 second'),
              now(), now())
      on conflict (singleton) do update set
        client_id=excluded.client_id,
        access_secret_id=excluded.access_secret_id,
        refresh_secret_id=excluded.refresh_secret_id,
        scopes=excluded.scopes,
        access_expires_at=excluded.access_expires_at,
        updated_at=now()`;
  });
}
function safePage(success: boolean): Response {
  const status = success ? 200 : 400;
  const message = success ?
    "La autorización de DropEC se guardó de forma segura. Puedes cerrar esta pestaña." :
    "La autorización no se pudo completar. No se ha activado ningún flujo comercial.";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width">
<title>DropEC OAuth</title></head><body><main><h1>DropEC</h1><p>${message}</p></main></body></html>`;
  return new Response(html, { status, headers: {
    ...JSON_HEADERS, "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
  }});
}
async function callback(req: Request): Promise<Response> {
  if (!sql) return safePage(false);
  const u = new URL(req.url);
  if (u.searchParams.has("error")) return safePage(false);
  const state = u.searchParams.get("state") || "";
  const code = u.searchParams.get("code") || "";
  if (!/^[a-zA-Z0-9_-]{64}$/.test(state) ||
      !code || code.length > 2048) return safePage(false);

  // A setup may be revoked while the user is still on Dropi's consent page.
  // Never exchange/store credentials after any operator gate is switched off.
  const [stillAllowed] = await sql`
    select setup_enabled, pinned_issuer_approved, session_replacement_ack
    from dropec_private.dropi_mcp_oauth_settings where singleton=true`;
  if (!stillAllowed?.setup_enabled ||
      !stillAllowed?.pinned_issuer_approved ||
      !stillAllowed?.session_replacement_ack) return safePage(false);

  // The state is single-use regardless of whether the provider subsequently
  // accepts the code. Never retry an OAuth authorization code automatically.
  const stateHash = await sha256Base64Url(state);
  const [pending] = await sql`
    update dropec_private.dropi_mcp_oauth_pending
    set consumed_at=now()
    where state_sha256=${stateHash}
      and consumed_at is null and expires_at > now()
    returning client_id, redirect_uri, verifier_secret_id`;
  if (!pending) return safePage(false);
  const [verifier] = await sql`
    select decrypted_secret from vault.decrypted_secrets
    where id=${pending.verifier_secret_id} limit 1`;
  if (typeof verifier?.decrypted_secret !== "string") return safePage(false);

  const body = tokenRequest({
    code, verifier: verifier.decrypted_secret,
    clientId: String(pending.client_id), redirectUri: String(pending.redirect_uri)
  });
  const resp = await fetch(OAUTH.token, {
    method: "POST", redirect: "error",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(), signal: AbortSignal.timeout(12000)
  });
  if (resp.status !== 200) return safePage(false);
  const raw = await resp.text();
  if (raw.length > 25000) return safePage(false);
  const tokens = validateToken(JSON.parse(raw));
  if (!tokens || tokens.scope.split(/\s+/).some(s => s !== "mcp")) return safePage(false);

  await persist({ ...tokens, clientId: String(pending.client_id) });
  // Cleanup removes only this expended verifier, never access/refresh tokens.
  try { await sql`delete from vault.secrets where id=${pending.verifier_secret_id}`; } catch { /* Expired/consumed row still prevents replay. */ }
  return safePage(true);
}
async function status(req: Request): Promise<Response> {
  if (!sql || !await authorizedForSetup(req)) return refusal(401, "unauthorized");
  const [cfg] = await sql`
    select setup_enabled, pinned_issuer_approved, session_replacement_ack
    from dropec_private.dropi_mcp_oauth_settings where singleton=true`;
  const [conn] = await sql`
    select connected_at, access_expires_at
    from dropec_private.dropi_mcp_oauth_connection where singleton=true`;
  return ok({
    ok: true,
    setup_enabled: cfg?.setup_enabled === true,
    pinned_issuer_approved: cfg?.pinned_issuer_approved === true,
    session_replacement_ack: cfg?.session_replacement_ack === true,
    connected: Boolean(conn?.connected_at),
    access_expired: conn?.access_expires_at ?
      (new Date(conn.access_expires_at) <= new Date()) : null,
    // No OAuth secrets, client IDs, codes or provider account details.
  });
}
Deno.serve(async req => {
  try {
    const url = new URL(req.url);
    const prefixes = ["/functions/v1/dropec-dropi-oauth", "/dropec-dropi-oauth"];
    const prefix = prefixes.find(p => url.pathname === p || url.pathname.startsWith(p + "/"));
    const path = prefix ? url.pathname.slice(prefix.length) : "";
    if (req.method === "GET" && path === "/callback") return await callback(req);
    if (req.method === "GET" && path === "/status") return await status(req);
    if (req.method === "POST" && path === "/start") return await start(req);
    return refusal(404, "not_found");
  } catch {
    // Intentionally NEVER log stack, provider code, response body, JWT or tokens.
    return refusal(503, "temporary_oauth_failure");
  }
});

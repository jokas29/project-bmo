// Supabase B: Vault-backed MCP session + refresh token rotation.
// OAuth and tool calls remain disabled in DB until explicitly approved.
import postgres from "npm:postgres@3.4.7";
import type { Settings } from "./core.ts";
import { OAUTH, refreshRequest, validateRefreshedToken } from "./oauth_protocol.ts";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
const sql = dbUrl ? postgres(dbUrl, {
  max: 1, prepare: false, ssl: { rejectUnauthorized: true },
  connection: { application_name: "dropec-mcp-readonly", statement_timeout: 15000 }
}) : null;

type Config = {
  readonly_enabled?: boolean;
  access_expires_at?: string | null;
  internal_key?: string | null;
  access_token?: string | null;
};

async function load(): Promise<Config | undefined> {
  if (!sql) return undefined;
  const [item] = await sql`select
     s.readonly_enabled,
     c.access_expires_at,
     k.decrypted_secret as internal_key,
     a.decrypted_secret as access_token
   from dropec_private.dropi_mcp_oauth_settings s
   left join dropec_private.dropi_mcp_oauth_connection c on c.singleton=true
   left join vault.decrypted_secrets k on k.name='dropec_mcp_api_internal_key'
   left join vault.decrypted_secrets a on a.id=c.access_secret_id
   where s.singleton=true limit 1`;
  return item;
}
async function refreshIfDue(): Promise<void> {
  if (!sql) return;
  try {
    await sql.begin(async tx => {
      const [setting] = await tx`select readonly_enabled from
        dropec_private.dropi_mcp_oauth_settings where singleton=true`;
      if (setting?.readonly_enabled !== true) return;
      const [conn] = await tx`
        select client_id, access_expires_at, access_secret_id,
               refresh_secret_id, refresh_attempted_at
        from dropec_private.dropi_mcp_oauth_connection where singleton=true
        for update`;
      if (!conn) return;
      if (Date.parse(String(conn.access_expires_at)) > Date.now() + 60000) return;
      if (conn.refresh_attempted_at &&
          Date.now() - Date.parse(String(conn.refresh_attempted_at)) < 300000) return;
      await tx`update dropec_private.dropi_mcp_oauth_connection
        set refresh_attempted_at=now() where singleton=true`;
      const [old] = await tx`
        select decrypted_secret from vault.decrypted_secrets
        where id=${conn.refresh_secret_id} limit 1`;
      const previous = String(old?.decrypted_secret || "");
      if (!previous || previous.length < 20) return;
      // This refresh is credential rotation only. It never invokes orders.
      const form = refreshRequest(String(conn.client_id), previous);
      let next;
      try {
        const resp = await fetch(OAUTH.token, {
          method: "POST", redirect: "error",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: form.toString(), signal: AbortSignal.timeout(9000)
        });
        if (resp.status !== 200) return;
        const raw = await resp.text();
        if (raw.length > 25000) return;
        next = validateRefreshedToken(JSON.parse(raw), previous);
      } catch { return; }
      if (!next) return;
      await tx`select vault.update_secret(${conn.access_secret_id}, ${next.accessToken})`;
      if (next.refreshToken !== previous)
        await tx`select vault.update_secret(${conn.refresh_secret_id}, ${next.refreshToken})`;
      await tx`update dropec_private.dropi_mcp_oauth_connection
        set access_expires_at = now() + (${Math.floor(next.expiresIn)} * interval '1 second'),
            scopes=${next.scope},
            updated_at=now(),
            refresh_attempted_at=null
        where singleton=true`;
    });
  } catch {
    // Fail closed. No token, user detail or SQL stack is returned or logged.
  }
}
export async function runtimeSettings(): Promise<Settings> {
  let cfg: Config | undefined;
  try {
    cfg = await load();
    if (cfg?.readonly_enabled === true &&
        (!cfg.access_expires_at ||
         Date.parse(String(cfg.access_expires_at)) <= Date.now() + 60000)) {
      await refreshIfDue();
      cfg = await load();
    }
  } catch {
    return {};
  }
  const stillValid = cfg?.access_expires_at &&
    Date.parse(String(cfg.access_expires_at)) > Date.now() + 10000;
  return {
    DROPEC_MCP_INTERNAL_KEY: cfg?.internal_key ?? undefined,
    DROPI_MCP_ACCESS_TOKEN: stillValid ? cfg?.access_token ?? undefined : undefined,
    DROPI_MCP_READONLY_ENABLED: cfg?.readonly_enabled === true ? "true" : "false",
    DROPI_MCP_QUOTE_TOOL: "quote_shipping",
    DROPI_MCP_GET_ORDER_TOOL: "get_order",
  };
}

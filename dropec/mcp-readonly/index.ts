import { handler } from "./core.ts";
import { runtimeSettings } from "./runtime.ts";

// Supabase B only: credentials come from private Vault, never from user input.
// Both the OAuth handshake and read-only calls default to OFF in DB.
// JWT verification remains enabled for this endpoint.
Deno.serve(async (req) => {
  const env = await runtimeSettings();
  const url = new URL(req.url);
  // Normalize both Supabase Edge request-path layouts.
  const prefix = ["/functions/v1/dropec-dropi-mcp-readonly", "/dropec-dropi-mcp-readonly"]
    .find((p) => url.pathname === p || url.pathname.startsWith(p + "/"));
  url.pathname = prefix ? url.pathname.slice(prefix.length) || "/" : "/unrecognized";
  return await handler(new Request(url, req), env);
});

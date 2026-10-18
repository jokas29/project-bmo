import { handler, type Settings } from "./core.ts";

// Supabase Edge Function entrypoint. Deploy to B only after OAuth is configured.
// IMPORTANT: verify_jwt=true in Supabase function settings. Additionally enforce
// the separate internal key below; never call this from the storefront/browser.
const env: Settings = {
  DROPEC_MCP_INTERNAL_KEY: Deno.env.get("DROPEC_MCP_INTERNAL_KEY"),
  DROPI_MCP_ACCESS_TOKEN: Deno.env.get("DROPI_MCP_ACCESS_TOKEN"),
  DROPI_MCP_READONLY_ENABLED: Deno.env.get("DROPI_MCP_READONLY_ENABLED"),
  DROPI_MCP_QUOTE_TOOL: Deno.env.get("DROPI_MCP_QUOTE_TOOL"),
  DROPI_MCP_GET_ORDER_TOOL: Deno.env.get("DROPI_MCP_GET_ORDER_TOOL"),
};

Deno.serve((req) => {
  // Supabase prefixes paths with /functions/v1/<function-name>.
  const lastSegment = new URL(req.url).pathname.split("/").filter(Boolean).pop() || "";
  const url = new URL(req.url);
  url.pathname = "/" + lastSegment;
  return handler(new Request(url, req), env);
});

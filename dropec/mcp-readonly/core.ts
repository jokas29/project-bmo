import { validateToolInput } from "./validate.ts";
import { safeOrderSummary } from "./privacy.ts";

// DropEC / Dropi MCP: deliberately read-only transport.
// Endpoint and tool names are NOT user-controlled. This module never calls Create Order.
export const DROPI_MCP_URL = "https://mcp.dropi.co/mcp";
export type Action = "quote" | "get-order";
export type Settings = {
  DROPEC_MCP_INTERNAL_KEY?: string;
  DROPI_MCP_ACCESS_TOKEN?: string;
  DROPI_MCP_READONLY_ENABLED?: string;
  DROPI_MCP_QUOTE_TOOL?: string;
  DROPI_MCP_GET_ORDER_TOOL?: string;
};
type RecordValue = Record<string, unknown>;
type Rpc = { jsonrpc: "2.0"; id?: number; method: string; params?: RecordValue };
type McpTool = { name: string; description?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean } };
type Fetcher = typeof fetch;
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

export function reply(status: number, body: RecordValue): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
export function isRecord(input: unknown): input is RecordValue {
  return Boolean(input && typeof input === "object" && !Array.isArray(input));
}
export function toolAllowed(action: Action, toolName: string): boolean {
  // Fixed allowlist: no dynamic tool execution based on server metadata.
  const canonical = toolName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return action === "quote" ? canonical === "quoteshipping" : canonical === "getorder";
}
export function hasRuntimeCredentials(env: Settings): boolean {
  return Boolean(
    env.DROPI_MCP_READONLY_ENABLED === "true" &&
    env.DROPEC_MCP_INTERNAL_KEY && env.DROPEC_MCP_INTERNAL_KEY.length >= 32 &&
    env.DROPI_MCP_ACCESS_TOKEN && env.DROPI_MCP_ACCESS_TOKEN.length > 20
  );
}
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const hashes = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const left = new Uint8Array(hashes[0]);
  const right = new Uint8Array(hashes[1]);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}
export async function authenticated(req: Request, env: Settings): Promise<boolean> {
  const provided = req.headers.get("x-dropec-mcp-internal-key") || "";
  if (!env.DROPEC_MCP_INTERNAL_KEY || env.DROPEC_MCP_INTERNAL_KEY.length < 32 || !provided) return false;
  return await sameSecret(provided, env.DROPEC_MCP_INTERNAL_KEY);
}
function protocolResponse(raw: string, contentType: string, id: number): RecordValue {
  if (raw.length > 131072) throw new Error("upstream_response_too_large");
  if (contentType.includes("text/event-stream")) {
    for (const part of raw.split(/\r?\n\r?\n/)) {
      const data = part.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
      if (!data || data === "[DONE]") continue;
      try {
        const value: unknown = JSON.parse(data);
        if (isRecord(value) && value.id === id) return value;
      } catch { /* Ignore unrelated SSE notifications, not the RPC response. */ }
    }
    throw new Error("upstream_missing_rpc_response");
  }
  if (!contentType.includes("application/json")) throw new Error("unexpected_upstream_content_type");
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || value.id !== id) throw new Error("upstream_invalid_rpc_response");
  return value;
}
async function postRpc(
  fetcher: Fetcher, token: string, message: Rpc, sessionId: string | undefined, expectedId: number
): Promise<{ response?: RecordValue; sessionId?: string }> {
  const headers: Record<string, string> = {
    "Authorization": "Bearer " + token,
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream"
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  if (message.method !== "initialize") headers["MCP-Protocol-Version"] = "2025-03-26";
  const response = await fetcher(DROPI_MCP_URL, {
    method: "POST", headers, body: JSON.stringify(message), redirect: "error", signal: AbortSignal.timeout(12000)
  });
  // 202 + empty body is the expected reply to notifications/initialized.
  if (!("id" in message) && response.status === 202) return { sessionId };
  if (!response.ok) throw new Error("upstream_http_" + response.status);
  const text = await response.text();
  const result = protocolResponse(text, response.headers.get("content-type") || "", expectedId);
  if ("error" in result) throw new Error("upstream_rpc_error");
  if (!isRecord(result.result)) throw new Error("upstream_invalid_result");
  return { response: result.result, sessionId: response.headers.get("mcp-session-id") || sessionId };
}
async function connect(fetcher: Fetcher, token: string): Promise<string | undefined> {
  const init = await postRpc(fetcher, token, {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "dropec-readonly", version: "0.1.0" } }
  }, undefined, 1);
  await postRpc(fetcher, token, { jsonrpc: "2.0", method: "notifications/initialized" }, init.sessionId, -1);
  return init.sessionId;
}
async function listTools(fetcher: Fetcher, token: string, sessionId: string | undefined): Promise<McpTool[]> {
  let cursor: string | undefined;
  const tools: McpTool[] = [];
  for (let page = 0; page < 5; page++) {
    const params: RecordValue = {};
    if (cursor) params.cursor = cursor;
    const got = await postRpc(fetcher, token, { jsonrpc: "2.0", id: 10 + page, method: "tools/list", params }, sessionId, 10 + page);
    const list = got.response?.tools;
    if (!Array.isArray(list)) throw new Error("upstream_invalid_tools");
    for (const item of list) if (isRecord(item) && typeof item.name === "string") {
      tools.push(item as McpTool);
    }
    cursor = typeof got.response?.nextCursor === "string" ? got.response.nextCursor : undefined;
    if (!cursor) break;
    if (page === 4) throw new Error("tool_pagination_limit");
  }
  return tools;
}
function scrub(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (typeof value === "string") {
    return value.slice(0, 12000)
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
      .replace(/(?:\+593|0)\d{8,9}/g, "[redacted-phone]");
  }
  if (Array.isArray(value)) return value.slice(0, 60).map((item) => scrub(item, depth + 1));
  if (isRecord(value)) {
    const output: RecordValue = {};
    for (const [key, val] of Object.entries(value).slice(0, 80)) {
      output[key] = /(^|_)(token|secret|password|api.?key|phone|email|address|document|cedula|identification|recipient|customer|surname|last.?name|first.?name)(_|$)/i.test(key)
        ? "[redacted]" : scrub(val, depth + 1);
    }
    return output;
  }
  return value;
}
function classifyError(error: unknown): string {
  if (error instanceof Error && /^(upstream_|unexpected_|tool_|request_)/.test(error.message)) return error.message;
  if (error instanceof Error && error.name === "TimeoutError") return "upstream_timeout";
  return "integration_error";
}

export async function handler(req: Request, env: Settings, fetcher: Fetcher = fetch): Promise<Response> {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  if (!await authenticated(req, env)) return reply(401, { ok: false, error: "unauthorized" });
  if (path === "/health" && req.method === "GET") {
    return reply(200, {
      ok: true, mode: "read_only", ready: hasRuntimeCredentials(env),
      quote_tool_configured: Boolean(env.DROPI_MCP_QUOTE_TOOL),
      order_tool_configured: Boolean(env.DROPI_MCP_GET_ORDER_TOOL)
    });
  }
  if (req.method !== "POST" || !["/discover", "/quote", "/get-order"].includes(path)) {
    return reply(404, { ok: false, error: "route_not_found" });
  }
  if (!hasRuntimeCredentials(env)) return reply(503, { ok: false, error: "mcp_oauth_not_configured_or_disabled" });
  const token = env.DROPI_MCP_ACCESS_TOKEN || "";
  let input: RecordValue = {};
  if (path !== "/discover") {
    try {
      const raw = await req.text();
      if (raw.length > 8192) return reply(413, { ok: false, error: "request_too_large" });
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || Object.keys(parsed).some((k) => k !== "input") || !isRecord(parsed.input)) {
        return reply(400, { ok: false, error: "request_invalid" });
      }
      input = parsed.input;
    } catch { return reply(400, { ok: false, error: "request_invalid" }); }
    const action: Action = path === "/quote" ? "quote" : "get-order";
    const validationError = validateToolInput(action, input);
    if (validationError) return reply(400, { ok: false, error: validationError });
  }
  try {
    const sessionId = await connect(fetcher, token);
    const tools = await listTools(fetcher, token, sessionId);
    if (path === "/discover") {
      // Discover is read-only. Return exact names/schema for operator inspection.
      const list = tools.filter((t) => toolAllowed("quote", t.name) || toolAllowed("get-order", t.name))
        .map((t) => ({ name: t.name, description: scrub(t.description), inputSchema: scrub(t.inputSchema), readOnlyHint: t.annotations?.readOnlyHint ?? null }));
      return reply(200, { ok: true, mode: "read_only", tools: list });
    }
    const action: Action = path === "/quote" ? "quote" : "get-order";
    const name = action === "quote" ? env.DROPI_MCP_QUOTE_TOOL : env.DROPI_MCP_GET_ORDER_TOOL;
    if (!name || !toolAllowed(action, name)) return reply(503, { ok: false, error: "readonly_tool_not_approved" });
    const descriptor = tools.find((t) => t.name === name);
    if (!descriptor || descriptor.annotations?.readOnlyHint === false) {
      return reply(503, { ok: false, error: "readonly_tool_unavailable" });
    }
    const result = await postRpc(fetcher, token, {
      jsonrpc: "2.0", id: 30, method: "tools/call", params: { name, arguments: input }
    }, sessionId, 30);
    if (result.response?.isError === true) {
      // MCP tools may return a business error in an otherwise successful JSON-RPC
      // response. Never present that as a successful shipping quote.
      const blocks = Array.isArray(result.response.content) ? result.response.content : [];
      const message = blocks.filter(isRecord).map((v) => typeof v.text === "string" ? v.text : "").join(" ").slice(0, 2500);
      const cause =
        /tcc.{0,100}linea|indicar la linea/i.test(message) ? "carrier_line_required" :
        /credenciales inv[aá]lidas/i.test(message) ? "carrier_credentials_invalid" :
        /ciudad de operaci[oó]n|no se encontr[oó].{0,50}ciudad|no existe cobertura/i.test(message) ? "carrier_city_unavailable" :
        "carrier_quote_unavailable";
      return reply(502, { ok: false, mode: "read_only", action, error: "upstream_tool_error", reason: cause });
    }
    if (action === "get-order") return reply(200, {
      ok: true, mode: "read_only", action,
      summary: safeOrderSummary(result.response)
    });
    return reply(200, { ok: true, mode: "read_only", action, data: scrub(result.response) });
  } catch (error) {
    // Never log token, request bodies, customer information or upstream payloads.
    return reply(502, { ok: false, error: classifyError(error) });
  }
}

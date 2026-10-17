import { assertEquals, assert } from "jsr:@std/assert@1";
import { authenticated, handler, toolAllowed, hasRuntimeCredentials, type Settings } from "./core.ts";

const env: Settings = {
  DROPEC_MCP_INTERNAL_KEY: "internal-secret-strong-enough-for-test-0123456789",
  DROPI_MCP_ACCESS_TOKEN: "oauth-test-token-never-use-in-production",
  DROPI_MCP_READONLY_ENABLED: "true",
  DROPI_MCP_QUOTE_TOOL: "quote_shipping",
  DROPI_MCP_GET_ORDER_TOOL: "get_order",
};
const url = "https://example.supabase.co";
function request(route: string, options: { method?: string; input?: unknown; key?: string } = {}): Request {
  const method = options.method || "POST";
  return new Request(url + route, {
    method,
    headers: { "x-dropec-mcp-internal-key": options.key ?? env.DROPEC_MCP_INTERNAL_KEY!, "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify({ input: options.input ?? {} }) : undefined
  });
}
function mockMcp(tools: unknown[], seen: string[]): typeof fetch {
  const fn = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const msg = JSON.parse(String(init?.body)) as { method: string; id?: number; params?: { name?: string } };
    seen.push(msg.method + (msg.params?.name ? ":" + msg.params.name : ""));
    if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
    const response = {
      jsonrpc: "2.0", id: msg.id,
      result: msg.method === "initialize" ? { protocolVersion: "2025-03-26", capabilities: {} }
        : msg.method === "tools/list" ? { tools }
        : { content: [{ type: "text", text: "Shipping 4.52; contact person@example.com +593987654321" }] }
    };
    return new Response(JSON.stringify(response), { status: 200, headers: {
      "content-type": "application/json", "mcp-session-id": "test-session"
    } });
  };
  return fn as unknown as typeof fetch;
}
Deno.test("only known read-only actions can call tools", () => {
  assert(toolAllowed("quote", "Quote Shipping"));
  assert(toolAllowed("get-order", "get_order"));
  assertEquals(toolAllowed("quote", "create_order"), false);
  assertEquals(toolAllowed("get-order", "cancel_order"), false);
  assertEquals(toolAllowed("quote", "delete_product"), false);
});
Deno.test("requires configured secure access", async () => {
  assertEquals(hasRuntimeCredentials({ ...env, DROPI_MCP_READONLY_ENABLED: "false" }), false);
  assertEquals(await authenticated(request("/health", { method: "GET", key: "wrong" }), env), false);
  let network = 0;
  const unused = (async () => { network++; throw new Error("must_not_call"); }) as typeof fetch;
  const denied = await handler(request("/quote", { key: "wrong" }), env, unused);
  assertEquals(denied.status, 401);
  const gated = await handler(request("/quote"), { ...env, DROPI_MCP_READONLY_ENABLED: "false" }, unused);
  assertEquals(gated.status, 503);
  assertEquals(network, 0);
});
Deno.test("quote-only call cannot execute a write tool", async () => {
  const calls: string[] = [];
  const result = await handler(request("/quote", { input: { to: "Babahoyo" } }),
    { ...env, DROPI_MCP_QUOTE_TOOL: "create_order" },
    mockMcp([{ name: "create_order" }], calls));
  assertEquals(result.status, 503);
  assertEquals(calls.some((c) => c.startsWith("tools/call")), false);
});
Deno.test("only a discovered permitted tool is called and result is redacted", async () => {
  const calls: string[] = [];
  const result = await handler(request("/quote", { input: { city: "Babahoyo", province: "Los Ríos" } }),
    env, mockMcp([{ name: "quote_shipping", annotations: { readOnlyHint: true } }], calls));
  assertEquals(result.status, 200);
  assertEquals(calls.filter((c) => c === "tools/call:quote_shipping").length, 1);
  assertEquals(calls.some((c) => c.includes("create_order")), false);
  const body = await result.text();
  assert(!body.includes("person@example.com"));
  assert(!body.includes("+593987654321"));
});
Deno.test("discovery cannot send tools/call or return write tools", async () => {
  const calls: string[] = [];
  const resp = await handler(request("/discover"), env,
    mockMcp([{ name: "quote_shipping", inputSchema: {} }, { name: "create_order" }, { name: "get_order" }], calls));
  assertEquals(resp.status, 200);
  const data = await resp.json();
  assertEquals(data.tools.map((t: { name: string }) => t.name), ["quote_shipping", "get_order"]);
  assertEquals(calls.some((c) => c.startsWith("tools/call")), false);
});

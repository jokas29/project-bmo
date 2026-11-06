function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
Deno.test("B preflight bridge can only return status and cannot operate shipping jobs", async () => {
  const code = await Deno.readTextFile(new URL("./preflight_index.ts", import.meta.url));
  assert(code.includes("jwtVerify("), "OIDC signature_not_checked");
  assert(code.includes("validPreflightClaims(payload)"), "OIDC identity_not_pinned");
  assert(code.includes("const [config]=await db"), "configuration_not_checked");
  assert(code.includes("can_process_jobs:false"), "must_never_process_jobs");
  assert(code.includes("can_call_dropi:false"), "must_not_call_Dropi");
  assert(code.includes("can_call_woocommerce:false"), "must_not_call_Woo");
  assert(!code.includes("bot_shipping_quote_jobs"), "job_queue_access_forbidden");
  assert(!code.includes("mcp.dropi.co"), "Dropi_host_forbidden");
  assert(!code.includes("radarcommerce.byethost7.com"), "WordPress_host_forbidden");
});
Deno.test("B workflow is manual only and OIDC-scoped to preflight", async () => {
  const workflow = await Deno.readTextFile(new URL("../../.github/workflows/dropec-shipping-preflight-b.yml", import.meta.url));
  assert(workflow.includes("  workflow_dispatch:"), "manual_trigger_missing");
  assert(!/^  schedule:|^  push:|^  pull_request:|^  workflow_run:/m.test(workflow), "unwanted_automatic_trigger");
  assert(workflow.includes("  id-token: write"), "OIDC_missing");
  assert(workflow.includes("ubxkqbnzdtgfvphwohzm.supabase.co"), "points_to_wrong_supabase");
  assert(!workflow.includes("kzwzputkwcpojevffjrm"), "references_project_A");
  assert(!workflow.includes("radarcommerce.byethost7.com"), "WordPress_provider_access_forbidden");
  assert(!workflow.includes("mcp.dropi.co"), "Dropi_provider_access_forbidden");
  assert(workflow.includes("can_process_jobs"), "must_assert_no_job_processing");
});

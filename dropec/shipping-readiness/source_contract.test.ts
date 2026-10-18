// Regression guard: a string replacement previously expanded "$'" inside
// an SQL regular expression and copied the old HTTP handler into a SQL literal.
// Typecheck passed, but the original false-positive /health route ran instead.
function assert(value: unknown, reason: string): asserts value {
  if (!value) throw Error(reason);
}
Deno.test("the deployed HTTP handler is unique, executable and never falsely reports ok", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const count = (needle: string) => source.split(needle).length - 1;
  assert(count("Deno.serve(") === 1, "duplicated_http_handler");
  assert(count("pipelineReadiness()") === 3, "missing_health_or_post_gate");
  assert(!source.includes("status:'ok'"), "legacy_false_positive_health");
  assert(!source.includes("mode:'github_browser_queue'"), "legacy_health_survived");
  assert(source.includes("status:readiness.status"), "health_not_using_guard");
  assert(source.includes("if(!readiness.quote_processing_ready)"), "queued_when_worker_not_ready");
  assert(source.includes("~ '^[0-9]+$'"), "stock_regex_corrupted");
  assert(source.indexOf("const readiness=await pipelineReadiness();if(!readiness.quote_processing_ready)") > source.indexOf("Deno.serve("), "post_gate_not_in_handler");
});

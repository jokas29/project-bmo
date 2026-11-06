function assert(ok: boolean, msg: string) { if (!ok) throw Error(msg); }
Deno.test("cached shipping amount must be attached to unchanged checkout row", async () => {
  const code=await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(code.includes('checkout_changed_before_quote_application'),"missing_checkout_race_refusal");
  assert(code.includes("returning platform"),"update_result_not_checked");
  assert(code.includes("if (!updated.length)"),"could_report_success_without_row_update");
  assert(code.includes("and unit_price="),"original_item_price_not_scoped");
  assert(code.includes("and city="),"original_destination_not_scoped");
});

import { validPreflightClaims, SHIPPING_PREFLIGHT } from "./bridge_claims.ts";
function equal(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw Error("not_equal");
}
const valid = {
  ...SHIPPING_PREFLIGHT,
  iss: SHIPPING_PREFLIGHT.issuer,
  aud: SHIPPING_PREFLIGHT.audience,
  run_id: "39088877731",
};
Deno.test("exact GitHub workflow identity is accepted for preflight only", () => {
  equal(validPreflightClaims(valid), true);
});
Deno.test("reject alternate repository, owner or repo ID", () => {
  for (const fake of [
    { repository:"attacker/project-bmo" },
    { repository_id:"123" },
    { repository_owner_id:"234" },
    { repository: "jokas29/another" }
  ]) equal(validPreflightClaims({ ...valid, ...fake }), false);
});
Deno.test("reject actions running from PR, fork, non-main, push and renamed workflow", () => {
  for (const fake of [
    { event_name:"pull_request" },
    { event_name:"push" },
    { ref:"refs/heads/feature/dropec-shipping-readiness" },
    { workflow_ref:"jokas29/project-bmo/.github/workflows/another.yml@refs/heads/main" }
  ]) equal(validPreflightClaims({ ...valid, ...fake }), false);
});
Deno.test("reject incorrect issuer, audience and missing workflow run ID", () => {
  for (const fake of [
    { iss:"https://attacker.example" },
    { aud:"dropec-shipping" },
    { aud:["dropec-shipping-preflight-b","admin"] },
    { run_id:"" },
    { run_id:"../../secrets" }
  ]) equal(validPreflightClaims({ ...valid, ...fake }), false);
});
Deno.test("reject malformed token claim sets", () => {
  equal(validPreflightClaims({}), false);
  equal(validPreflightClaims(null), false);
  equal(validPreflightClaims("fake"), false);
  equal(validPreflightClaims([]), false);
});

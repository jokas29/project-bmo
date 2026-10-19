// Narrow GitHub OIDC identity policy for a future B-only shipping worker.
// This helper NEVER executes shipping jobs or makes provider requests.
export const SHIPPING_PREFLIGHT = Object.freeze({
  issuer: "https://token.actions.githubusercontent.com",
  audience: "dropec-shipping-preflight-b",
  repository: "jokas29/project-bmo",
  repository_id: "1328431663",
  repository_owner_id: "311696812",
  workflow_ref: "jokas29/project-bmo/.github/workflows/dropec-shipping-preflight-b.yml@refs/heads/main",
  ref: "refs/heads/main",
  event_name: "workflow_dispatch",
});
type Value = Record<string, unknown>;
export function validPreflightClaims(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claims = value as Value;
  return claims.repository === SHIPPING_PREFLIGHT.repository &&
    String(claims.repository_id) === SHIPPING_PREFLIGHT.repository_id &&
    String(claims.repository_owner_id) === SHIPPING_PREFLIGHT.repository_owner_id &&
    claims.ref === SHIPPING_PREFLIGHT.ref &&
    claims.workflow_ref === SHIPPING_PREFLIGHT.workflow_ref &&
    claims.event_name === SHIPPING_PREFLIGHT.event_name &&
    claims.iss === SHIPPING_PREFLIGHT.issuer &&
    (claims.aud === SHIPPING_PREFLIGHT.audience ||
      Array.isArray(claims.aud) && claims.aud.length === 1 &&
      claims.aud[0] === SHIPPING_PREFLIGHT.audience) &&
    /^[0-9]{4,20}$/.test(String(claims.run_id || ""));
}

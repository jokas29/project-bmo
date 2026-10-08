# DropEC — Operations Runbook

Last updated: 2026-10-07

This document describes the production operating rules for DropEC. It intentionally contains no credentials, tokens, secrets, customer data, or private keys.

## 1. Production architecture

Current production path:

Social posts / Instagram DM / Facebook Messenger → Supabase automation → PayPhone verification → hidden WooCommerce → Dropify → Dropi → carrier → lifecycle tracking → customer notifications.

Expansion path under controlled rollout:

WooCommerce / Shopify → DropEC Commerce Core → channels / CRM / payments / fulfillment / tracking.

Core infrastructure:

- Supabase project: `kzwzputkwcpojevffjrm`
- Hidden WooCommerce: `https://radarcommerce.byethost7.com`
- GitHub repository: `jokas29/project-bmo`
- WordPress order lifecycle MU-plugin: `wordpress/mu-plugins/dropec-order-lifecycle.php`
- GitHub tracking workflow: `.github/workflows/dropec-order-tracking.yml`
- Background render workflow: `.github/workflows/dropec-background-render.yml`
- WordPress wake workflow: `.github/workflows/dropec-wordpress-wake.yml`

## 2. Hard launch rule

Real sales must remain disabled until all required readiness checks pass and the user explicitly authorizes final activation.

The live payment release condition is deliberately redundant:

1. `sales_enabled = true`
2. PayPhone External Notification runtime gate enabled
3. Dropi fulfillment runtime gate enabled
4. database payment-release guard allows creation/reuse of payment links
5. readiness preflight has no required blockers

A PayPhone link is never evidence of payment. Fulfillment starts only after server-side PayPhone verification succeeds and the payment is recorded idempotently.

## 3. Current activation state

Current verified state at this runbook update:

- PayPhone External Notification: confirmed/ready.
- Dropi fulfillment: blocked pending Wallet/fulfillment readiness.
- Master sales: OFF.
- Payment release: remains OFF while master/fulfillment gates are closed.

The current required readiness blocker is Dropi fulfillment. PayPhone is no longer a pending external blocker.

Do not bypass Dropi by manually enabling downstream workers.

## 4. Final activation sequence

When Dropi fulfillment is confirmed operational:

1. Record/verify Dropi fulfillment confirmation.
2. Refresh sales readiness.
3. Confirm there are no required failed checks.
4. Confirm `payment_release_allowed()` remains false before master activation.
5. Receive explicit final activation authorization from the user.
6. Activate the master sales switch using the controlled sales-control path.
7. Confirm runtime PayPhone and Dropi gates became enabled only as part of activation.
8. Run one minimum-value controlled end-to-end order test.
9. Verify PayPhone notification is received and independently verified server-side.
10. Verify exactly one `bot_order_jobs` row exists for the payment intent.
11. Verify WooCommerce order creation and Dropify/Dropi synchronization.
12. Verify lifecycle tracking and customer notification.
13. Only then begin customer acquisition / launch traffic.

Never activate sales by directly editing individual runtime flags.

## 5. Emergency shutdown

If payment, fulfillment, tracking, duplicate-order, or provider behavior becomes unsafe:

1. Disable the master sales switch through `dropec-sales-control`.
2. Confirm runtime payment-link release is OFF.
3. Do not invalidate the PayPhone webhook: already-issued payments must still be accepted and verified safely.
4. Preserve paid order jobs for recovery; do not create replacement orders.
5. Review `dropec_private.ops_incidents` and the latest `ops_health_snapshots`.

The database payment-release guard prevents new payment intents and checkout payment-link assignment while release is false.

## 6. Operations watchdog

The private watchdog runs every 5 minutes through PostgreSQL cron:

`dropec_ops_watchdog_every_5m`

Primary tables:

- `dropec_private.ops_health_snapshots`
- `dropec_private.ops_incidents`

It monitors:

- sellable catalog count
- Instagram inbox backlog
- Facebook Messenger inbox backlog
- checkouts awaiting payment
- verified paid orders stuck in processing
- content render jobs stuck
- Facebook cross-post backlog
- recent DropEC cron failures
- tracking heartbeat freshness
- PayPhone confirmation state
- Dropi confirmation state

Health interpretation:

- `green`: no active operational/readiness blockers
- `yellow`: launch/readiness dependency or non-critical issue
- `red`: unsafe sales state or verified paid order stuck

## 7. Payment safety

Core payment tables:

- `dropec_private.bot_payment_intents`
- `dropec_private.bot_payment_events`
- `dropec_private.bot_checkout_sessions`
- `dropec_private.bot_order_jobs`

Required invariants:

- one payment intent maps to at most one order job
- provider transaction IDs are unique
- final amount and currency must match the intent
- fulfillment uses immutable checkout snapshot data
- stale checkout payment state is reset when a new buying flow starts
- direct payment-link creation is blocked at database level while sales are disabled

The PayPhone notification endpoint must remain able to process an already-issued legitimate payment even if new sales are later disabled.

## 8. Order lifecycle

Lifecycle stages:

`queued → processing → retrying → registered → submitted → accepted → preparing → shipped → in_transit → out_for_delivery → delivered`

Additional states:

- `exception`
- `cancelled`

Tracking tables:

- `dropec_private.bot_order_tracking`
- `dropec_private.bot_order_events`

Do not regress a terminal `delivered` or `cancelled` status automatically.

A failed paid job must be resumed on the same job and same WooCommerce order whenever recovery is appropriate. Do not create a duplicate replacement order.

## 9. Special preserved test order

WooCommerce order `#63` is the known Dropi Wallet failure test case.

Safety rule:

- preserve Woo order #63
- do not create a replacement order
- do not retry it while Dropi fulfillment is unavailable
- it is not a verified customer payment

Its historical Dropi error is intentionally preserved for diagnosis.

## 10. Social automation

Instagram:

- automatic product/profile content publication
- DM bot
- comment event subscription available; new comment-to-lead layer remains shadow/gated

Facebook:

- automatic Page cross-posting using the same rendered assets/caption
- Messenger bot
- Page comment capture requires additional Page content/engagement permission setup before `feed` subscription is enabled

Facebook publishing must reuse the Instagram render instead of performing a second generation.

Production cross-publisher:

`dropec-facebook-publisher-v2`

Current Meta webhook:

`dropec-meta-webhook` v8

Old development publisher and temporary Facebook reconciliation/correction tools are retired and return HTTP 410.

## 11. Commerce Core expansion

Provider-neutral commerce tables now support tenant-aware events, messages, external products/orders and normalized orders.

Current additional modules:

- unified CRM/contact graph
- lead/thread timeline
- role-based agent routing definitions
- Shopify signed webhook + shadow order normalization
- Shopify catalog worker (gated OFF until a real store is configured)
- WhatsApp webhook/outbound worker (gated OFF until official Cloud API setup)
- consent-aware recovery/remarketing sequence engine in shadow mode
- COD operational risk advisory
- product opportunity scoring
- SaaS onboarding/usage/plan/member/audit foundation

Detailed architecture is maintained in `docs/dropec-commerce-expansion.md`.

No expansion module may override master payment/fulfillment gates.

## 12. Shopify safety

Shopify is an additional storefront, not a WooCommerce replacement.

Before any Shopify feature is enabled:

1. connect a real Shopify app/store
2. keep credentials in Vault
3. verify signed webhooks
4. validate product and variant mapping
5. test catalog synchronization in a controlled scope
6. test order ingestion in shadow mode
7. map inventory location before quantity synchronization
8. keep fulfillment bridge OFF until a controlled E2E order passes

Production worker:

`dropec-shopify-catalog-worker`

Cron:

`dropec_shopify_catalog_worker_every_5m`

With current flags/credentials it must return `gated_off` and perform no external mutation.

## 13. WhatsApp safety

WhatsApp requires the dedicated DropEC number and official Cloud API configuration.

Workers/functions:

- `dropec-whatsapp-webhook`
- `dropec-whatsapp-worker`
- `dropec_whatsapp_worker_every_5m`

Outbound messaging requires runtime readiness, feature flags and consent/opt-out checks. Until those conditions are met the worker must remain `gated_off`.

## 14. Recovery / remarketing

The existing recovery worker remains downstream of sales/acquisition/provider gates.

The newer generic sequence engine currently runs only shadow candidate/materialization logic through:

`dropec_sequence_shadow_refresh_every_15m`

Seeded sequences are disabled. Shadow queue records must never be treated as sent messages.

## 15. COD risk advisory

`cod_ops_v1` is advisory only.

It may recommend:

- allow
- confirm
- manual review

It must never automatically reject a customer, cancel an order or override payment/fulfillment logic.

Use `cod_risk_calibration` to compare future scores with actual delivery outcomes before changing weights.

## 16. Tracking infrastructure

The production tracking path uses signed WordPress access rather than the retired direct Dropi tracker:

GitHub OIDC → Supabase tracking bridge → headless Chromium → ByetHost → signed WordPress MU-plugin → Dropify/Dropi data → Supabase lifecycle.

`dropec-background-render.yml` also refreshes the tracking heartbeat every 5 minutes as redundancy, even when there is no active order.

## 17. Render infrastructure

Production render jobs are handled through GitHub Actions and Supabase bridges/finalizers.

Do not recreate content merely because an old render incident existed. First check whether the original render job is still queued/processing or has already completed/been removed.

Development render and shipping probes are retired.

## 18. Functions intentionally retired

The following development/testing surfaces have been neutralized and return HTTP 410:

- `dropec-payphone-selftest`
- `dropec-facebook-publisher` (old v1)
- `dropec-facebook-reconcile`
- `dropec-facebook-post-corrector`
- `dropec-facebook-links`
- `dropec-render-probe`
- `dropec-shipping-probe`
- `dropec-order-tracker` (direct Dropi API version)

Do not reactivate them unless there is a documented migration plan.

## 19. Security notes

Private DropEC tables use RLS. Tables with RLS and no public policies are intentionally deny-by-default unless a specific access policy is required.

New Commerce Core functions/tables must not receive public/anon/authenticated privileges by default.

Provider webhooks validate provider signatures. Internal workers authenticate with the private internal key. The future merchant portal API requires Supabase JWT verification plus an active tenant membership and is currently feature-gated OFF.

Do not move `pg_net` out of `public` without validating every PostgreSQL cron that uses `net.http_post` / `net.http_get`.

Do not remove indexes solely because the advisor reports them unused shortly after creation.

## 20. Pre-launch acceptance criteria

Before marketing/customer acquisition begins, all of the following must be true:

- Instagram publishing works
- Facebook Page publishing works
- Instagram DM bot works
- Facebook Messenger bot works
- sellable catalog is synchronized
- payment-link release remains gated until explicit activation
- PayPhone External Notification is approved and verified
- Dropi fulfillment is funded/operational
- tracking heartbeat is fresh
- no verified paid order is stuck
- no content render is stuck
- no Facebook cross-post backlog remains
- recent DropEC cron failures = 0
- controlled real end-to-end order test passes exactly once

Shopify, WhatsApp, TikTok, social-comment automation and merchant-portal capabilities are optional for the first DropEC launch unless explicitly promoted into the required readiness set.

Only after the required checklist passes and explicit activation is given should DropEC begin active customer acquisition.

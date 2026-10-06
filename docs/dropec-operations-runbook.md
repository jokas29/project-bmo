# DropEC — Operations Runbook

Last updated: 2026-10-06

This document describes the production operating rules for DropEC. It intentionally contains no credentials, tokens, secrets, customer data, or private keys.

## 1. Production architecture

Primary flow:

Social posts / Instagram DM / Facebook Messenger → Supabase automation → payment verification → hidden WooCommerce → Dropify → Dropi → carrier → lifecycle tracking → customer notifications.

Core infrastructure:

- Supabase project: `kzwzputkwcpojevffjrm`
- Hidden WooCommerce: `https://radarcommerce.byethost7.com`
- GitHub repository: `jokas29/project-bmo`
- WordPress order lifecycle MU-plugin: `wordpress/mu-plugins/dropec-order-lifecycle.php`
- GitHub tracking workflow: `.github/workflows/dropec-order-tracking.yml`
- Background render workflow: `.github/workflows/dropec-background-render.yml`
- WordPress wake workflow: `.github/workflows/dropec-wordpress-wake.yml`

## 2. Hard launch rule

Real sales must remain disabled until all required readiness checks pass.

The live payment release condition is deliberately redundant:

1. `sales_enabled = true`
2. PayPhone External Notification runtime gate enabled
3. Dropi fulfillment runtime gate enabled
4. Database payment-release guard allows creation/reuse of payment links
5. Readiness preflight has no required blockers

A PayPhone link is never evidence of payment. Fulfillment starts only after server-side PayPhone verification succeeds and the payment is recorded idempotently.

## 3. Current external activation blockers

At the time of this runbook update, the expected external blockers are:

- PayPhone External Notification approval
- Dropi Wallet / fulfillment funding availability

These blockers are operational dependencies. They must not be bypassed by manually enabling downstream workers.

## 4. Final activation sequence

When PayPhone approval and Dropi fulfillment are both available:

1. Record PayPhone as externally confirmed.
2. Record Dropi fulfillment as externally confirmed.
3. Run/refresh the sales readiness preflight.
4. Confirm there are no required failed checks.
5. Confirm `payment_release_allowed()` remains false before master activation.
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

The database payment-release guard prevents new payment intents and checkout payment-link assignment while the release condition is false.

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

- `green`: no active operational or readiness blockers
- `yellow`: launch/readiness dependency or non-critical operational issue
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
- final amount must match the intent
- currency must match
- fulfillment uses immutable checkout snapshot data
- stale checkout payment state is reset when a new buying flow starts
- direct payment-link creation is blocked at the database layer while sales are disabled

The PayPhone notification endpoint must remain able to process an already-issued legitimate payment even if new sales are disabled after the link was issued.

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

Facebook:

- automatic Page cross-posting using the same rendered assets/caption
- Messenger bot

Facebook publishing must reuse the Instagram render instead of performing a second AI/render generation.

Production cross-publisher:

`dropec-facebook-publisher-v2`

Old development publisher and temporary Facebook reconciliation/correction tools are retired and return HTTP 410.

## 11. Tracking infrastructure

The production tracking path uses signed WordPress access rather than the retired direct Dropi tracker:

GitHub OIDC → Supabase tracking bridge → headless Chromium → ByetHost → signed WordPress MU-plugin → Dropify/Dropi data → Supabase lifecycle.

`dropec-background-render.yml` also refreshes the tracking heartbeat every 5 minutes as redundancy, even when there is no active order.

## 12. Render infrastructure

Production render jobs are handled through GitHub Actions and Supabase bridges/finalizers.

Do not recreate content merely because an old render incident existed. First check whether the original render job is still queued/processing or has already been completed/removed.

Development render and shipping probes are retired.

## 13. Functions intentionally retired

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

## 14. Security notes

Private DropEC tables use RLS. Tables with RLS and no public policies are intentionally deny-by-default unless a specific access policy is required.

Do not move the `pg_net` extension out of `public` without first validating every PostgreSQL cron job that uses `net.http_post` / `net.http_get`.

Do not remove indexes solely because the Supabase advisor reports them as unused shortly after creation. New or low-volume systems frequently have valid indexes that have not yet accumulated usage statistics.

## 15. Pre-launch acceptance criteria

Before marketing/customer acquisition begins, all of the following must be true:

- Instagram publishing works
- Facebook Page publishing works
- Instagram DM bot works
- Facebook Messenger bot works
- sellable catalog is synchronized
- payment-link release remains gated until explicit activation
- PayPhone External Notification is approved and verified
- Dropi fulfillment is funded/operational
- order tracking heartbeat is fresh
- no verified paid order is stuck
- no content render is stuck
- no Facebook cross-post backlog remains
- recent DropEC cron failures = 0
- controlled real end-to-end order test passes exactly once

Only after this checklist passes should DropEC start active customer acquisition.

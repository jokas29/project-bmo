# DropEC / Manjo Commerce — Platform Sprint 2026-10-08

This document records the platform/productization sprint performed after comparing DropEC with mature commerce-automation SaaS products. It contains no credentials, private tokens, customer secrets, or private keys.

## Safety state

The sprint did **not** activate commerce.

- `sales_enabled = false`
- `payment_release_allowed() = false`
- PayPhone External Notification remains confirmed.
- Dropi fulfillment remains the only required launch blocker.
- Preserved WooCommerce test order `#63` was not retried or replaced.
- Shopify, WhatsApp, TikTok, billing, recovery and remarketing external-action flags remain disabled unless explicitly stated otherwise.

The latest platform self-test passed with the safety gates closed.

## 1. Provider-neutral event layer

New private structures:

- `commerce_event_envelopes`
- `commerce_dead_letters`

The event envelope adds:

- tenant ID
- event ID
- correlation ID
- event type/source
- entity type/id
- schema version
- immutable payload/timestamps

Order, lead and channel-message events can now be mirrored into the provider-neutral event layer. This is the foundation for traceability, future replay, observability and connector independence.

Dead-letter replay exists behind `event_replay = false`. Even when later enabled, the current replay helper records a controlled replay request rather than creating provider-side effects directly.

## 2. Customer state and human handoff

New private structures:

- `commerce_customer_state`
- `commerce_handoffs`

Customer state uses operational evidence to classify contacts into states such as:

- curious
- interested
- comparing
- ready_to_buy
- payment_pending
- customer
- repeat_customer
- at_risk
- lost

It also records confidence and a next-best action. The state refresh is internal/non-destructive and never claims payment or bypasses launch gates.

A human handoff queue now exists for conversations needing operator attention. The initial safe rule can create a handoff for open threads with multiple unread inbound messages. It does not send messages or change payment/fulfillment state.

## 3. Fulfillment routing and returns foundation

New private structures:

- `commerce_fulfillment_providers`
- `commerce_fulfillment_quotes`
- `commerce_fulfillment_cases`
- `commerce_return_cases`

Dropi is registered as a fulfillment provider but remains `blocked` while Wallet/fulfillment is unavailable.

The current fulfillment router is advisory-only. Provider candidates explicitly return `dispatch_allowed = false`. The architecture can later compare shipping cost, service and ETA across providers without automatically dispatching an order.

Returns/refunds have a case model but no automatic refund action.

## 4. Discovery / Radar v2

New private structures:

- `commerce_product_performance_daily`
- `commerce_discovery_scores`

The score combines the existing DropEC Radar/launch score with observed internal evidence such as:

- leads
- checkouts
- paid orders
- delivered orders
- refunds
- revenue

Outputs are:

- `TEST`
- `KEEP`
- `SCALE`
- `PAUSE`

Confidence is intentionally lower when real outcome data is sparse. This avoids pretending that a product is proven before actual sales evidence exists.

The scorer is refreshed hourly, and an immediate refresh was successfully tested.

## 5. Merchant portal

### Hosted UI

Edge Function:

- `dropec-commerce-portal` v2

URL:

`https://kzwzputkwcpojevffjrm.supabase.co/functions/v1/dropec-commerce-portal`

The portal contains:

- responsive Manjo Commerce dashboard
- safe synthetic demo mode
- Supabase Auth sign-in/sign-up
- workspace selector
- Overview
- unified Inbox
- Leads
- Orders
- Radar
- Automations
- Integrations
- Analytics
- Onboarding
- Security Center
- Team
- Plan/Billing

The public UI does not expose private commerce data. Real workspace data is retrieved through the authenticated tenant-scoped portal API.

Portal health was tested successfully with HTTP 200.

### Authenticated API

Edge Function:

- `dropec-commerce-portal-api` v3
- Supabase JWT verification enabled
- active tenant membership required
- audit logging for sensitive reads/actions

Read endpoints cover orders, leads, threads, product opportunities, onboarding, connectors, automation definitions, usage, risk, team, plan and security.

Invite acceptance and owner/admin invite creation are implemented. Self-service creation of entirely new tenants remains feature-gated OFF until anti-abuse and billing are production-ready.

The portal exposes no endpoint capable of turning on the production sales/payment/fulfillment gates.

## 6. SaaS plans and entitlements

Reference plan packaging is now modeled for product design:

- Starter: reference $79/month, 1,500 contacts, 1 agent, 3 team members
- Growth: reference $199/month, 10,000 contacts, 3 agents, 8 team members
- Scale: reference $399/month, 50,000 contacts, 8 agents, 20 team members

These are reference product rows only. They do not currently charge anyone.

`commerce_plan_entitlements()` provides a tenant-specific view of plan capabilities and limits.

## 7. Billing adapters

New private structures:

- `commerce_billing_provider_config`
- `commerce_billing_events`
- `commerce_billing_checkout_sessions`

Prepared providers:

- Paddle
- PayPhone Business subscriptions

Edge Function:

- `dropec-billing-webhook` v1

### Paddle

The adapter implements raw-body webhook verification using Paddle's signed timestamp + body HMAC-SHA256 scheme. Subscription events are deduplicated and protected against out-of-order updates before changing internal subscription entitlements.

Current state for DropEC:

- provider: prepared
- mode: sandbox
- webhook secret: not configured
- `billing_paddle = false`

Therefore no real subscription changes can occur.

### PayPhone subscriptions

The provider slot exists, but the live callback endpoint intentionally returns a configuration error until the exact provider activation/webhook contract is confirmed. No guessed signature or callback logic was implemented.

## 8. TikTok adapter

`tiktok_runtime_config` now supports a Vault-backed client secret and runtime metadata.

Edge Function:

- `dropec-tiktok-webhook` v1

The webhook follows the official TikTok signature model:

- `TikTok-Signature`
- timestamp `t`
- signature `s`
- HMAC-SHA256 over `timestamp + '.' + raw body`
- replay-freshness check

It supports signed shadow ingestion through the provider-neutral inbound-event table, but current DropEC state is:

- webhook secret/client secret: not configured
- webhook ready: false
- content API: false
- comments API: false
- messaging API: false
- live ingest: false
- outbound: false

No guessed outbound endpoint was implemented. Live TikTok work waits for a real approved TikTok Business/Developer app and confirmed scopes/endpoints.

## 9. Security Center

New private structures:

- `commerce_security_controls`
- `commerce_retention_policies`

Security controls currently report:

- new platform tables RLS: pass
- private schema role isolation: pass
- master sales gate closed: pass
- payment release gate closed: pass
- Dropi fulfillment dependency: warning while blocked
- legacy RLS advisor review: critical warning

### Legacy RLS advisory

Supabase's advisor reports multiple legacy `dropec_private` tables with RLS disabled. The project currently has a compensating private-schema privilege barrier (`anon`/`authenticated` lack direct schema/table/function access), and the custom isolation test passes.

This does **not** mean the RLS advisory is resolved. Enabling RLS blindly on production legacy tables can break server workers if their access model is not reviewed. A controlled table-by-table hardening migration, with regression testing of every worker/webhook/cron, is still required.

All new platform tables introduced in this sprint have RLS enabled and direct client-role grants removed.

Retention-policy rows were prepared but remain inactive pending legal/operational review.

## 10. Internal automation jobs

Added safe internal jobs:

- `dropec_customer_state_refresh_every_10m`
- `dropec_handoff_candidates_every_10m`
- `dropec_discovery_refresh_hourly`
- `dropec_security_center_every_15m`

Existing Shopify/WhatsApp/message-router/sequence jobs continue to run behind their feature gates.

The first customer-state, handoff and security-center runs completed successfully. Discovery was also refreshed manually and is scheduled hourly.

## 11. Latest verified safety snapshot

At the end of the sprint:

- platform self-test: PASS
- `sales_enabled = false`
- `payment_release_allowed = false`
- PayPhone confirmed: true
- Dropi confirmed: false
- required readiness blocker: `dropi_fulfillment`
- verified paid orders stuck: 0
- content renders stuck: 0
- Instagram inbox pending: 0
- Facebook inbox pending: 0
- recent DropEC cron failures: 0
- sellable catalog: 55 at the latest watchdog snapshot

Preserved order `#63` remains:

- status: failed
- Dropi order: none
- Dropi synced: false
- payment verified: false
- error: insufficient Dropi Wallet balance

## 12. External/configuration-dependent items still pending

These cannot be safely completed without real external account state, credentials, approvals or money movement:

- Dropi Wallet/fulfillment confirmation and controlled real fulfillment
- Shopify store/app credentials + signed webhook registration + controlled live shadow tests
- WhatsApp dedicated number/WABA/Cloud API/token/template approvals
- TikTok Business/Developer app approval, scopes and access token
- Paddle merchant account/config, webhook secret, products/prices and checkout activation
- PayPhone Business subscription activation and exact secure callback contract
- assigning a real authenticated owner/member to the DropEC tenant (the system cannot guess which auth user is the human owner)
- controlled legacy-table RLS hardening migration
- final real end-to-end sale, which must wait for Dropi and explicit launch authorization

## 13. Principle

DropEC remains the laboratory and first case study. Manjo Commerce is becoming the reusable product layer. New providers progress through:

`prepared -> shadow -> controlled E2E -> explicit activation`

Code existence never constitutes authorization to sell, charge or fulfill.

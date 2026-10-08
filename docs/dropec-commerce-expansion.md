# DropEC — Commerce Core / Productization

Last updated: 2026-10-07

This document records the reusable commerce architecture being built from the DropEC production system. The objective is to keep DropEC as the internal proving ground while evolving the automation into a multi-channel, multi-tenant product that can later be operated as a managed service or SaaS.

No change in this document authorizes real sales. The existing payment, fulfillment and master-sales gates remain authoritative.

## 1. Current safety state

- Master sales: OFF.
- PayPhone External Notification: confirmed.
- Dropi fulfillment: blocked until Wallet/fulfillment is operational.
- Database payment-release guard: remains authoritative.
- Shopify outbound/catalog/order features: OFF.
- WhatsApp inbound/outbound features: OFF.
- Automatic social-comment outreach: OFF.
- Generic remarketing sequences: OFF.
- Agent execution: OFF.
- COD risk scoring: ON only as advisory; it cannot reject/cancel/fulfill an order.

The latest production readiness state has one required blocker: Dropi fulfillment.

## 2. Provider-neutral commerce core

The neutral commerce layer includes:

- `commerce_tenants`
- `commerce_connector_registry`
- `commerce_feature_flags`
- `commerce_inbound_events`
- `commerce_external_products`
- `commerce_external_orders`
- `commerce_orders`
- `commerce_order_items`
- `commerce_sync_jobs`
- `channel_message_events`

The reference tenant is `dropec`.

Tenant propagation is now enforced on the neutral commerce event/order/message/sync tables. Legacy single-store workers remain compatible because database triggers assign the DropEC tenant when old code omits `tenant_id`.

WooCommerce remains the current production source of truth. The neutral core is designed so WooCommerce, Shopify and future storefronts can be adapters rather than permanent architectural centers.

## 3. Connector registry

Current connector states:

- WooCommerce: legacy active.
- Shopify: prepared.
- Instagram: legacy active.
- Facebook: legacy active.
- WhatsApp: prepared.
- TikTok: prepared slot only; not connected.
- PayPhone: ready.
- Dropi: blocked.

Connector state is descriptive. It never bypasses provider-specific safety gates.

## 4. Shopify as an additional storefront

Shopify is intentionally additive and does not replace WooCommerce.

Prepared components:

- `shopify_runtime_config`
- raw-body HMAC webhook verification
- webhook deduplication
- inbound event registry
- external order registry
- provider-neutral order normalization
- product/variant mapping
- catalog sync queue
- `dropec-shopify-webhook` v2
- `dropec-shopify-catalog-worker` v1
- cron `dropec_shopify_catalog_worker_every_5m`

The catalog worker is implemented with the Shopify Admin GraphQL product synchronization path, but it is gated by all of the following:

1. Shopify runtime credentials are present.
2. Shopify catalog runtime switch is enabled.
3. `shopify_catalog_sync` feature flag is enabled.
4. `shopify_catalog_worker` feature flag is enabled.

Until then it returns `gated_off` and cannot publish products.

The worker maps title, description, price and SKU and stores Shopify product/variant/inventory-item IDs. Inventory quantity synchronization remains intentionally pending until the real Shopify store/location mapping exists.

Shopify fulfillment remains separate from order ingestion. A signed Shopify webhook can be tested in shadow mode without creating Dropi fulfillment.

## 5. WhatsApp Cloud API foundation

Prepared components:

- dedicated-number readiness gate
- Cloud API connection gate
- webhook verification gate
- signed webhook verification
- `dropec-whatsapp-webhook` v1
- `dropec-whatsapp-worker` v1
- generic private message queue
- opt-in / opt-out awareness
- marketing-consent enforcement
- retries/backoff
- cron `dropec_whatsapp_worker_every_5m`

The outbound worker requires runtime readiness plus both `whatsapp_reply` and `whatsapp_outbound_worker` flags. It currently returns `gated_off` and sends nothing.

WhatsApp remains blocked on the external dedicated DropEC number/SIM and official Meta Cloud API configuration.

## 6. Unified CRM and conversation layer

The commerce core now has a private CRM/contact graph:

- `commerce_contacts`
- `commerce_contact_identities`
- `commerce_leads`
- `commerce_timeline_events`
- `commerce_threads`

Existing Instagram/Facebook conversation history and checkout state were backfilled into the CRM. New bot/channel messages are mirrored through triggers without changing the existing bot behavior.

The contact graph can resolve identities by platform and can later merge by normalized phone/email when available.

Current internal flags:

- `unified_crm = true`
- `agent_routing = true`

These two flags only normalize/rout internal data and do not create new external messaging.

## 7. Multi-agent commerce roles

Defined commerce roles:

- `lead_qualifier`
- `sales_closer`
- `support_agent`
- `recovery_agent`
- `post_purchase_agent`

Routing can classify order/tracking questions toward support, checkout/payment/buying intent toward sales, and general inbound leads toward qualification.

All agent definitions currently have `execution_enabled = false`.

Guardrails include:

- never claim payment without server-side verification
- never bypass sales/payment/fulfillment gates
- respect opt-out state

## 8. Social comments → lead candidates

The Meta webhook was upgraded to `dropec-meta-webhook` v8.

It preserves the existing Instagram/Facebook messaging path and adds comment-event parsing. Comments can be stored as:

- social engagement
- CRM contact/lead
- product-attributed lead candidate
- recommended next action

`social_comment_capture` remains OFF, so candidates stay shadow-only and no automatic DM is sent.

Instagram comment delivery is already part of the existing Instagram app subscription. Full Facebook Page comment capture still requires the missing Page content/engagement permissions and a later `feed` subscription test.

## 9. Recovery and remarketing

Two layers exist:

### Existing operational recovery v2

- recovery runtime configuration
- abandoned checkout/payment queue
- messaging-window checks
- attempts/cooldowns
- stop when customer resumes
- stop when paid/completed/cancelled
- worker `dropec-organic-recovery-worker` v2

`recovery_v2` remains OFF until live commerce is ready.

### Generic sequence engine

Tables:

- `commerce_sequences`
- `commerce_sequence_steps`
- `commerce_sequence_enrollments`
- `commerce_message_queue`

Prepared sequences:

- abandoned checkout
- warm lead nurture
- post-purchase follow-up

Functions identify candidates, honor do-not-contact, consent, replies and purchase completion, choose an available channel and materialize the next step.

Cron `dropec_sequence_shadow_refresh_every_15m` runs the engine safely in shadow mode. A shadow simulation successfully created a message candidate without sending it externally.

`remarketing_sequences` remains OFF and every seeded sequence remains disabled.

## 10. COD anti-flete / operational risk

`cod_ops_v1` is now wired as an advisory-only model.

Signals include:

- phone format sanity
- address/reference completeness
- prior delivered orders
- prior cancellation/exception history
- repeated abandoned checkouts

Outputs:

- low → allow
- medium → confirm
- high → manual review

`cod_risk_assessment = true`, but all assessments have `advisory_only = true`. No score automatically rejects a customer, cancels an order or blocks fulfillment.

`cod_risk_calibration` joins predictions with future delivery outcomes so weights can be calibrated using real operational evidence.

## 11. Product opportunity / winner layer

`commerce_product_opportunities` reuses the existing DropEC launch/radar scoring instead of duplicating a second product-intelligence system.

It combines eligibility, stock, margin, demand, policy and saturation signals and groups products into:

- high
- medium
- test
- hold

This becomes the internal foundation for a future product-discovery/radar experience.

## 12. Internal commerce console

`commerce_console_snapshot()` provides a private consolidated state containing:

- tenant/subscription
- onboarding
- connector states
- feature flags
- contacts/leads/threads
- sequences
- message/sync queues
- risk summary
- usage metrics
- top product opportunities

Edge Function:

- `dropec-commerce-console` v1
- internal-key protected
- no secrets returned

This is a backend dashboard source, not yet a merchant-facing UI.

## 13. SaaS/product packaging foundation

Private productization tables now include:

- `commerce_plans`
- `commerce_plan_features`
- `commerce_tenant_subscriptions`
- `commerce_onboarding_steps`
- `commerce_usage_daily`
- `commerce_tenant_memberships`
- `commerce_tenant_invites`
- `commerce_audit_log`

Reference plan rows exist only to model packaging. No subscription billing is active.

DropEC itself is on the internal/laboratory plan.

Onboarding tracks storefront, social channels, payments, fulfillment, tracking, WhatsApp, controlled E2E and final go-live state.

Usage can measure inbound/outbound conversation activity, contacts, leads, orders, recovery and social engagement.

An authenticated tenant-scoped read API has also been deployed:

- `dropec-commerce-portal-api` v1
- Supabase JWT required
- tenant membership required
- audit log written for reads
- exposes overview/leads/threads/product opportunities

`merchant_portal_api` remains OFF until a real merchant account/membership is provisioned and the frontend is ready.

## 14. Current feature flags

Enabled internal/non-destructive features:

- `unified_crm`
- `agent_routing`
- `cod_risk_assessment` (advisory only)

External-action features remain disabled:

- `recovery_v2`
- `shopify_catalog_sync`
- `shopify_catalog_worker`
- `shopify_order_ingest`
- `shopify_fulfillment_bridge`
- `whatsapp_ingest`
- `whatsapp_reply`
- `whatsapp_outbound_worker`
- `social_comment_capture`
- `remarketing_sequences`
- `tiktok_shadow_adapter`
- `merchant_portal_api`

## 15. Security model

All new operational/productization tables live in `dropec_private`, use RLS and expose no direct policies to `anon`/`authenticated`.

Private functions have direct public/anon/authenticated execution removed unless explicitly needed by a protected Edge Function.

External webhook functions use provider signatures. Internal workers use the existing private internal-key mechanism. The future merchant portal requires a Supabase-authenticated JWT plus an active tenant membership.

No credentials or plaintext secrets are stored in the repository.

## 16. Remaining external/configuration-dependent work

The largest remaining gaps are no longer core backend logic. They are mostly external connections and customer-facing product work:

### Dropi
- confirm the Wallet credit
- verify fulfillment readiness
- preserve test order #63; do not create a replacement

### Shopify
- connect a real store/app
- store credentials in Vault
- register signed webhooks
- shadow-test catalog/order ingestion
- map Shopify location before inventory synchronization
- enable fulfillment bridge only after controlled E2E acceptance

### WhatsApp
- obtain/activate the dedicated DropEC number
- connect official Cloud API
- store credentials and Graph API version
- verify webhook
- run inbound/outbound E2E in shadow/controlled mode

### Facebook comments
- obtain/configure the Page permissions needed to read/manage Page comments
- subscribe/test Page `feed`
- keep comment-to-lead shadow until validated

### TikTok
- real business/API account connection
- shadow event/content tests before activation

### SaaS/product
- merchant-facing frontend
- actual user provisioning/invite flow
- subscription billing provider
- legacy singleton connector configuration migration to true per-tenant connector credentials/runtime
- tenant-by-tenant acceptance/security tests

## 17. Production compatibility

This productization work does not replace or bypass:

- WooCommerce as the current production source of truth
- PayPhone server-side payment verification
- database payment-release hard gate
- Dropi fulfillment gate
- existing order lifecycle/tracking
- watchdog
- Instagram/Facebook automation
- controlled launch procedure

DropEC remains the first real proving ground. New channels must progress through prepared → shadow → controlled E2E → explicit activation rather than becoming live merely because code exists.

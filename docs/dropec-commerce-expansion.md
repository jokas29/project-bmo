# DropEC — Commerce Expansion Foundation

Last updated: 2026-10-07

This document records the reusable commerce modules added after reviewing multi-channel commerce automation products. The goal is to evolve DropEC from a single-store implementation into a reusable commerce core without changing the current WooCommerce production flow or enabling real sales automatically.

## Safety rule

All new commercial release features are OFF by default. Existing payment and fulfillment safety gates remain authoritative. Shopify, WhatsApp, recovery v2 and COD risk scoring cannot activate real fulfillment merely by existing in the database.

Current master sales state remains OFF.

## 1. Reusable commerce core

New private tables:

- `commerce_tenants`
- `commerce_connector_registry`
- `commerce_feature_flags`
- `commerce_inbound_events`
- `commerce_external_products`
- `commerce_external_orders`
- `commerce_sync_jobs`
- `commerce_orders`
- `commerce_order_items`
- `channel_message_events`

The first tenant is `dropec`, used as the reference implementation. Existing WooCommerce/Meta/PayPhone/Dropi integrations remain the live legacy adapters while new providers can be attached incrementally.

The connector registry is descriptive and is not an alternate master switch. Production gates remain in the existing runtime controls.

## 2. Shopify additional storefront

Shopify is designed as an additional storefront, not a WooCommerce replacement.

Prepared components:

- `shopify_runtime_config`
- signed webhook verification using HMAC-SHA256
- webhook deduplication using Shopify webhook IDs / payload hash
- private inbound event storage
- external order registry
- normalized internal commerce order + line-item model
- Woo product mapping through explicit Shopify mapping or SKU fallback
- catalog sync queue
- feature flags for catalog sync, order ingest and fulfillment bridge
- Edge Function `dropec-shopify-webhook`

The webhook can safely operate in shadow mode after credentials are configured. Shadow mode records and normalizes signed Shopify order events but never triggers Dropi fulfillment.

Required before enabling Shopify traffic:

1. Shopify store/domain.
2. Admin API access token stored in Vault.
3. Shopify app/client secret stored in Vault for webhook HMAC validation.
4. Webhook subscriptions configured.
5. Controlled catalog sync test.
6. Controlled signed order webhook test.
7. Product/variant mapping validation.
8. Explicit enablement of the relevant feature flags.

The catalog sync queue is intentionally separate from the external API worker so no product can be published to Shopify merely by deploying this foundation.

## 3. Multi-store normalized order model

`commerce_orders` and `commerce_order_items` are the beginning of the provider-neutral order core.

This allows future sources such as Shopify, WooCommerce or another storefront to be represented with the same internal concepts:

- source provider/order ID
- payment state
- fulfillment state
- currency/totals
- customer/shipping snapshot
- line items
- internal Woo product mapping

`normalize_shopify_order_event()` converts a verified Shopify order webhook into this normalized model. It does not create a Dropi order or a legacy `bot_order_jobs` fulfillment job.

This separation is deliberate: ingestion and normalization may be tested safely before fulfillment is connected.

## 4. WhatsApp official Cloud API foundation

The existing WhatsApp runtime config was hardened and expanded.

Prepared components:

- dedicated-number readiness gate
- Cloud API connection gate
- webhook verification gate
- access-token Vault reference
- app-secret Vault reference
- hashed webhook verify token
- signed webhook HMAC validation
- generic private channel message queue
- Edge Function `dropec-whatsapp-webhook`
- independent feature flags for inbound ingest and outbound replies

The webhook can be configured and verified before outbound messaging is enabled.

WhatsApp remains disabled until the dedicated DropEC number and official Cloud API setup are ready. The new ingress does not feed messages into the current Instagram/Facebook workers automatically.

## 5. Abandoned checkout/payment recovery v2

The existing recovery automation was upgraded with a safer runtime layer.

New components:

- `recovery_runtime_config`
- `recovery_contact_state`
- feature flag `recovery_v2`
- configurable checkout/payment delay
- configurable lookback window
- maximum attempts per stage
- messaging-window age cap
- opt-out state
- duplicate suppression through the existing recovery queue
- automatic skip when the customer has resumed the conversation
- automatic skip if the checkout is paid/completed/cancelled
- updated `dropec-organic-recovery-worker` v2
- recovery refresh cron now calls `refresh_organic_recovery_queue_v2()`

Recovery v2 is currently OFF. It also remains downstream of acquisition, sales, PayPhone and Dropi gates.

## 6. COD operational risk advisory

Added `order_risk_assessments` and `assess_order_risk(order_job_id)`.

The first model (`cod_ops_v1`) uses only operational signals such as:

- basic phone-format sanity
- delivery-address completeness
- delivery-reference completeness
- prior successful deliveries
- prior cancellation/exception history
- repeated abandoned checkouts

It explicitly does not use protected personal characteristics.

Risk output is advisory only:

- low → allow
- medium → confirm
- high → manual review

It never automatically rejects a customer or cancels an order. Non-COD orders receive a non-blocking low-risk advisory result.

Feature flag: `cod_risk_assessment` (OFF by default).

## 7. Feature flags

All were created OFF:

- `shopify_catalog_sync`
- `shopify_order_ingest`
- `shopify_fulfillment_bridge`
- `whatsapp_ingest`
- `whatsapp_reply`
- `recovery_v2`
- `cod_risk_assessment`

These are deliberately separate from the master sales switch.

## 8. Optional readiness checks

Non-blocking readiness entries were added for:

- Shopify storefront
- WhatsApp channel
- recovery v2
- COD risk advisory

They are optional and do not prevent the current DropEC launch.

## 9. Security

All new commerce tables live in `dropec_private`, have RLS enabled and expose no policies to `anon` or `authenticated`.

New private functions have public/anon/authenticated EXECUTE removed. A temporary readiness warning caused by the Shopify trigger function's default execute privilege was corrected immediately; the private-schema isolation check passes again.

Shopify HTTPS webhooks are designed around raw-body HMAC verification and webhook-ID deduplication. WhatsApp POST webhooks require a valid Meta-style `X-Hub-Signature-256` signature.

No credentials or plaintext secrets are stored in this repository.

## 10. What remains external/configuration-dependent

The software foundation is installed, but these steps require external accounts/credentials and therefore remain deliberately inactive:

### Shopify
- create/connect Shopify store/app
- store token and webhook secret in Vault
- register webhook topics
- test shadow order ingest
- implement/activate the external catalog API worker after a controlled product test
- connect normalized orders to fulfillment only after multi-item/idempotency acceptance tests

### WhatsApp
- obtain dedicated DropEC number/SIM
- configure Meta WhatsApp Cloud API
- store token/app secret and verify-token hash
- verify webhook
- test inbound shadow messages
- add outbound transport into the shared bot engine

### Recovery
- enable only after live sales are ready and messaging policy/window behavior is verified

### COD risk
- calibrate weights using real delivery outcomes before using recommendations operationally

## 11. Current production compatibility

This expansion does not replace or bypass:

- WooCommerce as the current production source of truth
- PayPhone server-side payment verification
- database payment release hard gate
- Dropi fulfillment gate
- existing lifecycle tracking
- existing watchdog
- existing Instagram/Facebook automation

WooCommerce can continue unchanged while Shopify is introduced as a second storefront in shadow mode first.

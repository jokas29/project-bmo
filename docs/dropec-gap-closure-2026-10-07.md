# DropEC — Commerce gap closure

Date: 2026-10-07

This note records the second productization/hardening block that moves the DropEC Commerce Core closer to a reusable commerce-automation platform while preserving the existing production gates.

## Safety invariants

Nothing in this block activates real sales.

- `sales_enabled = false`
- `payment_release_allowed() = false`
- PayPhone External Notification is confirmed
- Dropi fulfillment remains the only required readiness blocker
- Shopify external actions remain feature-gated OFF
- WhatsApp inbound/outbound remain feature-gated OFF until the official number/API configuration exists
- TikTok remains prepared-only
- social comment automatic DM remains OFF
- remarketing/sequence sending remains OFF
- Woo test order #63 remains untouched

## Multi-tenant hardening

The neutral commerce core now scopes provider identities by tenant rather than assuming provider IDs are globally unique.

Tenant-aware uniqueness now applies to:

- inbound webhook/event dedupe keys
- external orders
- normalized commerce orders
- external product mappings

This matters for a future SaaS deployment because two Shopify/Woo stores can legitimately expose overlapping provider-local IDs.

Shopify normalization now propagates `tenant_id` through inbound events, normalized orders and line items and only resolves external-product mappings inside the same tenant.

## Shopify webhook v3

`dropec-shopify-webhook` is now v3.

Improvements:

- tenant-aware webhook event storage
- tenant-aware order registry
- tenant-aware idempotency
- signed HMAC verification retained
- shadow vs active mode retained
- `orders/*` normalization retained
- `orders/cancelled` produces a cancellation observation instead of fulfillment
- `refunds/create` produces a refund observation instead of fulfillment
- neither cancellation nor refund handling can create fulfillment

A synthetic shadow self-test normalized one mapped line item successfully with `fulfillment_triggered=false`; all self-test rows were removed afterward.

## WhatsApp webhook v2

`dropec-whatsapp-webhook` is now v2.

The previous prepared webhook did not explicitly propagate the Commerce Core tenant when inserting neutral events/messages. v2 fixes that and routes every signed inbound message through the unified channel-event model.

A new database event processor now:

- upserts the CRM contact and platform identity
- refreshes last-inbound timestamps
- creates/updates the unified conversation thread
- creates a lead for meaningful inbound messages
- writes timeline events
- stops active nurture/recovery sequences when the customer replies
- recognizes common opt-out phrases such as `STOP`, `parar`, `cancelar`, `salir`, `no me escribas` and marks the contact do-not-contact

A synthetic `STOP` test correctly set `do_not_contact=true`, `marketing_consent=false`, `opt_in_status=opted_out`, stopped active sequences and was cleaned up afterward.

## WhatsApp worker v2

`dropec-whatsapp-worker` is now v2.

Outbound safety is stricter:

- still requires official runtime readiness and feature gates
- still requires marketing consent for marketing messages
- still respects do-not-contact / opt-out
- free-form text is only eligible inside a 24-hour customer-service window
- outside that window the queue must provide a template key
- the template must exist in `commerce_message_templates` and be marked `approved`
- approved templates support language code and body parameters
- missing/unapproved templates are skipped rather than sent incorrectly

The new table `commerce_channel_policies` stores channel-level messaging policies, and `commerce_message_templates` stores tenant-scoped provider template metadata without storing provider credentials.

## Unified sequence / remarketing bridge

The generic sequence engine gained `enqueue_due_commerce_sequences()` and a five-minute scheduler.

The scheduler is feature-gated by `sequence_scheduler`, which remains OFF.

When enabled later, it can materialize consent-aware sequence steps into `commerce_message_queue`. External transmission still requires the relevant outbound channel gate.

A unified Meta bridge was prepared:

- Edge Function `dropec-commerce-message-router` v1
- cron every minute
- supports Instagram / Facebook Messenger queue routing
- requires `meta_commerce_outbound=true`
- additionally requires acquisition and master sales to be enabled
- requires marketing consent when appropriate
- refuses delivery outside the recent inbound messaging window
- links neutral queue rows to legacy `bot_outbox` rows
- synchronizes final sent/failed/suppressed state back to the neutral queue

`meta_commerce_outbound` remains OFF.

## Social comments

Comment events captured by `dropec-meta-webhook` v8 can now feed a private suggestion layer:

- table `commerce_suggested_actions`
- periodic `refresh_social_action_suggestions()`
- product-attributed comments receive a higher suggestion score
- suggestions recommend useful reply/private-help actions but do not send anything

`social_comment_dm` remains OFF.

## TikTok prepared runtime

A tenant-safe/product-ready TikTok runtime slot now exists in `tiktok_runtime_config` with separate readiness for:

- webhook verification
- content API
- messaging API
- comments API
- shadow ingest
- final enabled state

No TikTok webhook signature or outbound behavior has been invented. `tiktok_live_ingest` and `tiktok_outbound` remain OFF until official app permissions and provider-specific verification are configured.

## Merchant portal API v2

`dropec-commerce-portal-api` is now v2 and remains protected by Supabase JWT + tenant membership + the `merchant_portal_api` feature flag.

Read-only tenant-scoped endpoints now cover:

- overview
- leads
- threads
- product opportunities
- orders
- connectors
- automation definitions / feature flags
- usage
- onboarding
- suggested actions
- COD-risk history
- account / plan / members
- health

Reads are still audit-logged. The feature remains OFF until a real merchant account/frontend is provisioned.

## Usage and onboarding

Additional onboarding steps now explicitly model:

- storefront connection
- primary messaging channel
- payment configuration
- fulfillment configuration
- tracking
- recovery
- controlled E2E acceptance

Usage metering can roll up messages, contacts, leads, orders, paid orders, recovery touchpoints and social engagements per tenant/day.

## Current production status after this block

Latest verified production watchdog state during this work:

- overall: yellow
- commerce ready: false
- sales enabled: false
- PayPhone confirmed: true
- Dropi confirmed: false
- required blockers: only `dropi_fulfillment`
- catalog sellable: 53
- awaiting payment: 0
- verified orders stuck: 0
- content renders stuck: 0
- Instagram inbox pending: 0
- Facebook inbox pending: 0
- recent DropEC cron failures: 0
- private-schema isolation check: passed

The largest remaining gaps versus a mature platform are now primarily external/product-facing: actual Shopify account connection, official WhatsApp connection/templates, TikTok permissions, merchant UI/onboarding, subscription billing, and real-world E2E data for risk/recovery calibration.

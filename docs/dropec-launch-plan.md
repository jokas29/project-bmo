# DropEC — Launch & Acquisition Plan

Last updated: 2026-10-06

This plan prepares customer acquisition without enabling real sales. It assumes the production safety rule from `docs/dropec-operations-runbook.md`: acquisition only starts after PayPhone External Notification and Dropi fulfillment are confirmed, the controlled E2E order passes, and the master sales switch is enabled.

## 1. Launch principle

DropEC starts organic-first and cost-controlled.

- Fixed launch ad budget: **$0**.
- Do not buy traffic before the first delivered orders prove the real economics.
- Content must sell through demonstration, not exaggerated claims.
- Every CTA routes to Instagram/Facebook DM and the existing conversational checkout.
- Shipping is quoted dynamically; do not publish a universal shipping price.
- Never publish a PayPhone link manually.
- Never advertise a product whose Dropi mapping/fulfillment is not healthy.

## 2. Initial launch portfolio

### HERO 1 — Woo #29 — Máquina de ajo eléctrica

- Retail price: $25.00
- Current supplier price: $4.00
- Gross product margin before payment fees/returns: $21.00
- Current stock observed: 492
- Primary angle: fast kitchen demo / problem → solution
- Why launch: immediate visual payoff, broad audience, low explanation burden, strong margin.

### HERO 2 — Woo #124 — Juego de herramientas para mover muebles

- Retail price: $30.00
- Current supplier price: $9.00
- Gross product margin before payment fees/returns: $21.00
- Current stock observed: 982
- Primary angle: problem → solution / wow demonstration
- Why launch: very high stock, obvious utility, strong before/after video potential.

### CORE 1 — Woo #43 — Pintura de pared con rodillo

- Retail price: $20.00
- Current supplier price: $3.00
- Gross product margin before payment fees/returns: $17.00
- Current stock observed: 498
- Primary angle: before → after home transformation
- Why launch: accessible price and high visual transformation value.

### CORE 2 — Woo #93 — Porta especias / condimentero

- Retail price: $22.00
- Current supplier price: $4.50
- Gross product margin before payment fees/returns: $17.50
- Current stock observed: 512
- Primary angle: kitchen organization / visual order
- Why launch: broad household audience, simple benefit, low education burden.

### CORE 3 — Woo #55 — X2 Luces RGB

- Retail price: $26.00
- Current supplier price: $5.00
- Gross product margin before payment fees/returns: $21.00
- Current stock observed: 374
- Primary angle: instant room transformation
- Why launch: visually strong for Reels/Stories and younger audiences.

## 3. Reserve products

Do not push these in the first wave, but keep them ready for creative diversification:

- Woo #33 — Papel para freidora de aire pack x100 — $25 / supplier $3 / gross product margin $22 / stock 102.
- Woo #35 — Archivador — $22 / supplier $3 / gross product margin $19 / stock 501.
- Woo #105 — Llave universal 48 en 1 — $25 / supplier $7 / gross product margin $18 / stock 460.

Reserve products move into the active set only when one of the following happens:

1. a hero/core product falls below the stock safety threshold;
2. a hero/core product gets weak conversion after enough traffic;
3. the content feed needs a new category;
4. supplier quality or fulfillment changes.

## 4. Launch holds

These products must not be used in launch marketing until separately reviewed:

- Woo #108 Gas Pimienta — regulatory/ad-platform friction; not suitable for default launch.
- Woo #47 Bluetooth AirPods 2 STARK — brand/authenticity/compatibility and return-risk concerns.
- Woo #97 and #99 Rodilleras — supplier descriptions contain pain/recovery/medical-style claims that must be removed/reviewed first.
- Woo #129 iPhone car charger — brand/compatibility/quality validation required.
- Woo #132 Bluetooth Stark ENC — electronics return/quality validation required.

The current `dropec_private.launch_product_policy` table records these tiers as an advisory launch policy. It does not replace the global master sales gate.

## 5. Catalog hygiene rule

Supplier text is not customer copy.

Current catalog audit found published descriptions containing supplier phone numbers, WhatsApp/Telegram links, wholesale instructions, Google Drive links, or medical-style claims. Marketing assets and bot answers must use clean DropEC copy rather than blindly reproducing supplier descriptions.

Before promoting any additional product:

- remove supplier contact details and wholesale instructions;
- remove external resource links from public copy;
- avoid unsupported medical/performance claims;
- avoid claiming certifications or authenticity unless verified;
- describe only observable features and ordinary intended use;
- verify the Dropi mapping exists and current stock is healthy.

## 6. Organic-first 30-day launch

### Pre-launch while sales are OFF

Prepare, but do not run purchase CTAs:

- Build 3–5 creative variants for each hero product.
- Build trust/profile posts: how shipping works, how payment confirmation works, order tracking, customer-service expectations.
- Keep content drafts separate from production publishing if the caption says “compra”, “pide” or “paga”.
- Validate product photos/video sources and remove supplier branding/contact information.

### Days 1–3 after safe activation

Focus almost entirely on Hero #29 and Hero #124.

Daily target:

- 1 demonstration Reel for one hero product.
- 1 alternate hook Reel/short video for the other hero product.
- 3–5 Stories built from the same assets: problem, demo, price, FAQ, DM CTA.
- Reply automation handles DMs; no manual payment links.

Goal: identify whether the strongest signal is product interest, price resistance, shipping resistance, or payment-link completion.

### Days 4–7

Add #43 and #93 while keeping the best hero creative alive.

- Do not replace a winning video just because it is older.
- Re-cut the same winning demonstration with new first 2 seconds/hooks.
- Start collecting objection language from DMs for FAQ content.

### Days 8–14

Introduce #55 and one reserve product only if the first portfolio needs variety.

At this point rank products using actual funnel data, not views alone:

1. unique inbound senders;
2. payment links created;
3. verified payments;
4. Dropi orders synced;
5. delivered orders.

### Days 15–30

Keep the top 2–3 products as the majority of output.

- 60% proven winners.
- 25% new hooks/creative variants for winners.
- 15% reserve/new product tests.

Do not build a feed where every post is a different product; repetition is necessary to learn what works.

## 7. Creative system

The external creative benchmark did not have enough recent Ecuador-specific ad coverage to justify copying local “winners”. Use only robust format patterns:

- problem → solution;
- product demonstration;
- before/after transformation;
- feature callout;
- social proof once DropEC has real proof;
- UGC-style explanation;
- legitimate scarcity only when stock or a real deadline supports it.

Avoid fake countdowns, fabricated reviews, fake “X people are viewing”, invented discounts, unsupported superlatives, and supplier claims copied verbatim.

### Video structure

Default 12–22 second short-form structure:

1. 0–2s: visual problem or surprising end result.
2. 2–7s: product enters and starts solving it.
3. 7–13s: close-up demonstration / second feature.
4. 13–17s: price + simple benefit.
5. final seconds: “Escríbenos por DM” / keyword CTA.

The first frame should make sense with sound off.

## 8. DM acquisition funnel

Target flow:

`Reel/Story/Post → DM → product identified → buyer details → shipping quote → confirmation → PayPhone link → server-verified payment → Woo → Dropify/Dropi → tracking → delivered`

Do not optimize for raw DM count if the DMs do not progress.

Primary funnel metrics live in:

- `dropec_private.launch_daily_funnel`
- `dropec_private.launch_daily_content`
- `dropec_private.launch_product_performance`

## 9. KPI hierarchy

### Tier A — business outcomes

- verified payments;
- Dropi-synced orders;
- delivered orders;
- delivered gross contribution.

### Tier B — funnel health

- payment link → paid conversion;
- paid → Dropi sync rate;
- paid → delivered rate;
- average time from payment to Dropi registration;
- cancellation/exception rate.

### Tier C — acquisition signals

- unique inbound senders;
- DM starts per content item;
- product mentions/selection rate;
- objections by category.

Views, likes and follower count are secondary unless they correlate with the above.

## 10. Paid acquisition rule

Do not spend on Meta/TikTok ads at launch.

Paid traffic becomes eligible only after:

1. at least one product has multiple delivered orders;
2. real PayPhone fees, operational losses and returns are known;
3. its delivered net contribution is positive and repeatable;
4. the creative already generated organic DMs or purchases.

Initial paid tests must be financed from realized business contribution, not a fixed personal budget.

A future CAC ceiling must be calculated from **net delivered contribution**, not from the current gross product margin shown in this document.

## 11. Product kill / promote rules

### Promote

Move a product upward when it has:

- healthy stock;
- clean fulfillment;
- real delivered orders;
- repeatable content-to-DM response;
- acceptable payment and delivery conversion.

### Pause

Pause marketing when:

- supplier stock becomes unreliable;
- Dropi mapping breaks;
- returns/exceptions rise;
- product quality complaints repeat;
- claims/copy cannot be substantiated;
- margin becomes too thin after real fees;
- the product produces many DMs but almost no payment completions after enough observations.

## 12. First launch-day checklist

Do not start traffic until every item below is true:

- PayPhone External Notification confirmed.
- Dropi fulfillment funded and confirmed.
- Master sales readiness check green.
- One controlled real E2E payment/order passes.
- Payment link release enabled only through controlled activation.
- Tracking heartbeat fresh.
- Hero products still have valid Dropi mapping and stock.
- Hero creative has no supplier contact information.
- DM bot wording reflects the actual payment/fulfillment state.

Then launch Hero #29 and #124 first.

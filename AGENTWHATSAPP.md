# AGENTWHATSAPP.md

> **Authoritative project context and execution roadmap**
>
> Last updated: 2026-08-06  
> Current roadmap status: **Phase D4 — VERIFIED_CLOSED**  
> Next planned phase: **D5 — Product Media & Asset Foundation**

---

## 1. Purpose of this file

This file is the canonical continuity document for AgentWhatsApp.

Any developer, coding agent, reviewer, or future ChatGPT conversation must read this file before changing the project. It exists to prevent loss of context, accidental architectural regressions, duplicated conversation engines, reintroduction of legacy fallbacks, and roadmap drift.

Update this file whenever a phase is completed, materially redesigned, or replaced.

A phase is not considered fully closed until:

1. implementation is complete;
2. focused acceptance passes;
3. relevant regressions pass;
4. real browser/live acceptance passes when required;
5. this file is updated;
6. the phase changes are committed.

---

## 2. Project vision

**AgentWhatsApp** is a multi-tenant Moroccan WhatsApp commerce SaaS for COD and e-commerce sellers.

It uses the official WhatsApp Cloud API and a deterministic Hybrid Sales Agent to:

- understand Moroccan Darija/Arabizi customer messages;
- present the correct seller-bound product;
- answer product questions;
- guide customers through a controlled sales conversation;
- collect dynamic product options;
- manage multi-item carts;
- collect delivery details;
- review and confirm orders;
- persist immutable confirmed-order snapshots;
- generate and send PDF receipts;
- notify sellers;
- later integrate with delivery companies;
- later add ChatGPT Nano as a language/intelligence layer without giving AI authority over product truth, pricing, order state, tenant identity, or workflow progression.

The current golden reference product is a **women’s sandal**. It is used to stabilize the product model, configuration model, conversation engine, and platform UX.

The sandal must **never be hardcoded into production logic**. All commercial facts remain dynamic.

---

## 3. Repository and stack

### Repository

```text
C:\AgentWhatsApp
```

### Main applications

```text
C:\AgentWhatsApp\backend
C:\AgentWhatsApp\frontend
```

### Backend

- Node.js
- Express
- strict TypeScript
- PostgreSQL
- Valkey
- BullMQ
- official WhatsApp Cloud API
- transactional outbox
- Puppeteer PDF receipt generation
- Cloudflare R2 asset direction

### Frontend

- Next.js 16 App Router
- strict TypeScript
- Tailwind CSS
- shadcn/Base UI components
- feature-based architecture
- Server Components by default
- typed services/hooks
- no direct fetch calls from UI components

### Runtime scale target

Design for peak throughput above:

```text
2,000,000 messages / 24 hours
```

This is a design target, not a claim of current production load.

---

## 4. Non-negotiable architecture rules

### 4.1 Modular monolith

- Business logic belongs inside the owning module.
- Shared infrastructure belongs under `src/infrastructure/`.
- Runtime composition belongs under `src/composition/`.
- Avoid god files.
- Prefer small cohesive services.
- Do not move business authority into controllers, UI components, queues, or generic helpers.

### 4.2 Strict tenant isolation

- Every seller-owned read/write must be tenant-scoped.
- Never trust seller IDs, workspace IDs, product IDs, or authority fields supplied by the customer.
- Missing and foreign resources should return the same safe response where required.
- No global/default tenant behavior.

### 4.3 No default/demo fallback authority

Connected production must never silently use:

- a default seller;
- a demo seller;
- a default product;
- the first Catalog product;
- a customer-supplied product ID;
- a session-supplied product ID;
- a static sandal template as commercial authority.

Missing authority must fail closed.

### 4.4 One approved production conversation path

Connected customer-owned WhatsApp traffic has one approved orchestration path:

```text
WhatsApp webhook
→ normalized inbound message
→ exact ACTIVE customer-owned connection
→ bound tenant-scoped Catalog Product
→ seller/conversation presentation config
→ approved Hybrid conversation orchestrator
→ WhatsApp Cloud dispatcher
```

The orchestrator may internally call cohesive components such as:

- First Entry;
- More Information;
- Direct Answer;
- guarded order runtime;
- cart;
- delivery;
- review;
- confirmation;
- receipt.

Those are components of one engine, not separate engines.

Old smoke/demo/preview/compatibility paths must be unreachable from production webhook routing unless explicitly normalized into the approved path.

### 4.5 Authority boundaries

#### Catalog owns

- product identity;
- name;
- description;
- price in integer minor units;
- currency;
- availability;
- option IDs and labels;
- value IDs and labels;
- ordering;
- offers;
- product-owned media metadata.

#### Conversation Config owns

- presentation;
- wording;
- tone;
- display preferences;
- information-topic presentation;
- safe message templates.

Conversation Config must not replace Catalog product facts.

#### Hybrid Engine owns

- state progression;
- First Entry;
- More Information loop;
- explicit order start;
- option collection timing;
- multi-item flow;
- cart review/edit;
- delivery collection;
- final review;
- confirmation;
- receipt transition.

#### Session owns

- temporary progression only;
- current state;
- prospective selections;
- cart draft;
- pending action;
- isolated tester state.

Session is never permanent product authority.

### 4.6 External integrations

Use:

- adapters;
- typed contracts;
- outbox;
- retries;
- idempotency;
- safe audit logs;
- fail-closed credentials.

Do not couple Orders directly to one delivery company.

---

## 5. Existing foundation before the D roadmap

The project already includes substantial completed infrastructure:

- PostgreSQL persistence and migrations;
- seller and workspace authority;
- Catalog persistence;
- conversation configuration persistence;
- confirmed-order persistence;
- inbound/outbound queues;
- per-conversation ordering;
- retries and DLQ;
- transactional outbox;
- WhatsApp Cloud runtime cutover;
- authentication and authorization;
- roles and permissions;
- onboarding;
- logo storage direction;
- protected dashboard;
- Development Tenant foundation;
- receipt generation and delivery.

This file focuses on the current D1–D12 product-completion roadmap.

---

# 6. Completed phases

## D1 — Development Tenant Foundation

**Status: VERIFIED_CLOSED**

Implemented:

- explicit Development Tenant purpose and mode;
- no fixed seller or phone authority;
- safe tenant-scoped conversation reset;
- readiness visibility;
- OWNER/ADMIN-only developer tooling;
- WhatsApp, commerce, and runtime readiness display;
- reset behavior that clears ephemeral conversation state only;
- no deletion of products, connection, settings, confirmed orders, or receipts.

Key rule:

```text
Reset test conversation
≠ reset tenant data
```

---

## D2 — Legacy Fallback Removal

**Status: VERIFIED_CLOSED**

Removed or closed production authority from:

- default seller;
- default product;
- demo sandal product authority;
- first-product fallback;
- global WhatsApp token fallback;
- obsolete live-smoke authority.

Missing required configuration now fails closed instead of silently selecting demo/default data.

Compatibility/test helpers may remain only when explicitly isolated.

---

## D3 — Seller Settings API and Settings UI

**Status: VERIFIED_CLOSED**

Backend:

- `GET /api/seller/settings`
- `PUT /api/seller/settings`
- strict DTO validation;
- tenant-derived authority;
- OWNER/ADMIN write access;
- AGENT/VIEWER read-only behavior;
- atomic multi-authority persistence;
- readiness recomputation.

Frontend:

- `/dashboard/settings`
- Store profile;
- Payment;
- Delivery;
- Customer information;
- Order preferences;
- Receipt preferences;
- dirty state;
- Save/Discard;
- single-flight save;
- field-level backend errors;
- retry behavior.

Important contract:

- `store.locale` is read-only;
- no seller/workspace/config-version authority is accepted from the frontend.

---

## D4 — Dynamic Product Authority and Golden Hybrid Commerce Flow

**Status: VERIFIED_CLOSED**

D4 established the current product and conversation foundation.

### D4 product management

Implemented:

- Product list;
- Product create;
- Product edit;
- Product availability;
- dynamic options and values;
- aliases;
- fixed-bundle offers;
- integer minor-unit pricing;
- safe keyset pagination;
- strict tenant isolation;
- read/write role boundaries.

Frontend routes:

```text
/dashboard/products
/dashboard/products/new
/dashboard/products/[productId]
```

### D4 WhatsApp Product binding

One WhatsApp connection binds to zero or one Product.

Authority:

```text
phoneNumberId
→ exact ACTIVE persisted connection
→ boundProductId
→ tenant-scoped Catalog Product
```

No customer/session/default/first-product authority may override this.

### D4 cart, pricing, snapshot, and receipt

Implemented and verified:

- stable Product/option/value identities;
- dynamic required-option collection;
- multi-item cart;
- Same choices;
- Different choices;
- cart editing;
- stale-action validation;
- integer pricing;
- offer authority;
- confirmation revalidation;
- immutable confirmed-order snapshot;
- snapshot-only receipt regeneration;
- duplicate-confirm idempotency.

### D4-R1 — Latest Hybrid conversation restoration

Restored the accepted flow:

```text
fresh greeting
→ natural First Entry
→ dynamic Product introduction
→ Order now / More information
```

Fixed the regression where a fresh greeting entered required-option collection.

### D4-R2 — Dynamic options and golden sandal flow

Proven live and in acceptance:

- price `299 MAD`;
- size `41`;
- color `أصفر`;
- current Catalog menus;
- Same choices;
- Different choices;
- cart edits;
- staged Darija delivery;
- final review;
- confirmation;
- PDF receipt.

Connected production now keeps Catalog options authoritative.

Scoped option action identity:

```text
cart_item_option:<productId>:<optionId>:<valueId>:<targetId>
```

Stale/removed actions:

- do not mutate the cart;
- remain at the current required option;
- regenerate the current authoritative menu.

### D4-R3 — Single production conversation path closure

Removed or isolated older independent production-reachable conversation paths.

Final approved path:

```text
Webhook
→ exact ACTIVE encrypted customer-owned connection
→ bound Catalog projection
→ approved_hybrid
→ Cloud dispatcher
```

Also fixed Products page Base UI semantics:

- navigation uses semantic Links styled as buttons;
- action controls remain native buttons.

### Final D4 acceptance

The user completed:

- real live WhatsApp testing;
- dynamic price/options testing;
- application review;
- Products page review.

Final result:

```text
Phase D4: VERIFIED_CLOSED
```

---

# 7. Current golden conversation contract

The women’s sandal is the current golden reference.

```text
Fresh greeting
→ Hybrid First Entry
→ Product introduction
→ Order now / More information
```

## More Information path

```text
More information
→ information-topic list
→ answer
→ Continue order / More information
```

The customer remains in this loop until explicitly choosing Continue order.

## Order path

```text
explicit Order now
→ current configured required options
→ multi-item choice
→ cart review/edit
→ staged delivery
→ final review
→ confirmation
→ immutable order
→ PDF receipt
```

For the current sandal:

```text
size
→ color
```

This sequence is dynamic and driven by Product configuration, not hardcoded field names.

---

# 8. Approved roadmap: D5–D12

## D5 — Product Media & Asset Foundation

**Status: PLANNED**

Goal:

Build secure tenant-owned media infrastructure required by product images, information-topic images, and prerecorded audio.

Scope:

- Cloudflare R2-backed object storage;
- tenant-scoped asset metadata;
- image upload;
- audio upload;
- MIME validation;
- extension validation;
- file-size limits;
- audio-duration limits;
- safe object keys;
- upload/replace/delete;
- orphan cleanup;
- signed/public delivery strategy;
- asset ownership;
- safe API projection;
- minimal asset picker/library;
- no raw credentials;
- no arbitrary external URL authority.

Acceptance must prove:

- tenant isolation;
- invalid MIME rejection;
- size limits;
- safe replacement/deletion;
- no path traversal;
- no cross-tenant asset access;
- upload does not make media conversation-authoritative automatically.

---

## D6 — Dynamic Information Topics and Information Loop

**Status: PLANNED**

Goal:

Make the existing More Information loop dynamic and seller-configurable without changing Hybrid progression.

Fixed logic:

```text
More information
→ dynamic topic list
→ answer
→ Continue order / More information
```

Topic types:

### System topics

Generated from authoritative configuration:

- price;
- sizes;
- colors;
- availability;
- delivery;
- offers;
- ordering process.

### Custom topics

Seller-defined examples:

- quality;
- material;
- country of origin;
- warranty;
- care instructions;
- authenticity;
- usage.

Answer modes:

- text;
- image;
- text + image;
- prerecorded audio.

Important rules:

- every answer returns the two core actions;
- media is presentation, not workflow authority;
- selecting size/color in the information loop may create a prospective selection;
- prospective selection must not create a cart/order;
- only Continue order may enter order runtime;
- System-topic answers must not duplicate Catalog facts manually.

---

## D7 — Category Profiles

**Status: PLANNED**

Goal:

Introduce category presets over the one shared Hybrid engine.

First and only initial profile:

```text
Clothing & Footwear
```

The women’s sandal remains the golden reference.

Category Profiles may provide defaults for:

- terminology;
- common option patterns;
- default information topics;
- selling points;
- wording;
- display order;
- recommended required fields.

Authority order:

```text
Product Configuration
overrides
Category Profile defaults
overrides
Global defaults
```

A Category Profile must never become:

- a separate conversation engine;
- a separate order state machine;
- permanent Product authority.

Broader categories are deferred until Clothing & Footwear is mature.

---

## D8 — In-Platform Agent / Hybrid Tester

**Status: PLANNED**

Goal:

Allow sellers to test the real Hybrid engine from the dashboard.

Architecture:

```text
same Hybrid engine
├── WhatsApp channel
└── Platform test channel
```

Requirements:

- isolated test sessions;
- no live WhatsApp delivery;
- same Product and published configuration;
- same actions and progression;
- media preview;
- Reset;
- safe tester identity;
- no confirmed production order unless explicitly in test mode;
- no pollution of real customer sessions.

---

## D9 — Message Studio

**Status: PLANNED**

Goal:

Allow safe seller customization of customer-facing wording.

Workflow:

```text
Draft
→ Preview/Test
→ Publish
```

Features:

- controlled message slots;
- safe variables;
- validation;
- reset to default;
- draft version;
- published version;
- version history;
- rollback;
- text/media/audio presentation where allowed.

Safe variables may include:

```text
{{product.name}}
{{product.price}}
{{option.label}}
{{option.values}}
{{delivery.price}}
{{cart.total}}
{{order.number}}
```

The seller must not be able to change:

- Product truth;
- price authority;
- order progression;
- required security checks;
- tenant identity;
- confirmation rules;
- receipt authority.

---

## D10 — Orders Center and Seller Notifications

**Status: PLANNED**

Goal:

Expose confirmed orders in the platform and notify the seller.

Orders UI:

- list;
- search;
- filters;
- detail page;
- Product/options;
- customer;
- delivery details;
- total;
- timestamps;
- receipt;
- audit history.

Planned statuses:

```text
NEW
CONFIRMED
PREPARING
READY_FOR_DELIVERY
SENT_TO_DELIVERY
DELIVERED
CANCELLED
RETURNED
```

Notifications:

- in-app new-order notification;
- unread count;
- safe acknowledgement/read state;
- later email/WhatsApp/push adapters.

Role and tenant isolation are mandatory.

---

## D11 — Delivery Integration Foundation

**Status: PLANNED**

Goal:

Prepare safe delivery-provider integration without coupling Orders to one company.

Architecture:

```text
Confirmed Order
→ Shipment Draft
→ Delivery Provider Adapter
→ Provider API
```

Scope:

- shipment model;
- provider adapter contract;
- provider credentials;
- outbox;
- retries;
- idempotency;
- send one order;
- send selected orders;
- provider response mapping;
- tracking number;
- shipment state;
- failure recovery;
- audit log;
- status sync contract.

No direct provider-specific logic inside Orders core.

---

## D12 — Production Readiness and Launch Closure

**Status: PLANNED**

Goal:

Close the first launch-ready version.

Scope:

- end-to-end security review;
- tenant-isolation review;
- roles/permissions review;
- queue/load testing;
- database performance;
- rate limits;
- observability;
- metrics;
- tracing;
- structured audit logs;
- DLQ/recovery runbooks;
- backup/restore checks;
- complete browser acceptance;
- complete live WhatsApp acceptance;
- onboarding-to-order journey;
- readiness dashboard;
- launch checklist;
- deployment/runbook;
- first-client operational plan.

D12 closes only after real acceptance.

---

# 9. Current execution order

```text
D5 — Media Foundation
→ D6 — Dynamic Information Loop
→ D7 — Category Profiles
→ D8 — Agent Tester
→ D9 — Message Studio
→ D10 — Orders Center
→ D11 — Delivery Foundation
→ D12 — Launch Closure
```

Do not jump directly to the Agent Tester before the configuration and media models it must test are stable.

---

# 10. Phase implementation protocol

For every future phase:

## Step 1 — Architecture contract

Define:

- authority;
- module ownership;
- tenant boundaries;
- API surface;
- persistence;
- failure behavior;
- what is explicitly deferred.

## Step 2 — Backend

Implement:

- domain/persistence/API/runtime;
- strict parsing;
- safe projection;
- permissions;
- tenant isolation;
- focused tests;
- regressions.

## Step 3 — Backend acceptance

Do not start frontend until backend is verified.

## Step 4 — Frontend

Implement:

- typed DTOs;
- services;
- hooks;
- UI;
- loading/error/empty states;
- role behavior;
- accessibility.

## Step 5 — Browser/live acceptance

Use real browser acceptance and live WhatsApp acceptance when relevant.

## Step 6 — Documentation

Update this file with:

- status;
- implementation;
- authority changes;
- migrations;
- routes;
- tests;
- accepted behavior;
- deferred work.

## Step 7 — Commit

Commit only after acceptance and documentation update.

---

# 11. Status vocabulary

Use exactly:

- `PLANNED`
- `IN_PROGRESS`
- `BACKEND_VERIFIED`
- `FRONTEND_VERIFIED`
- `AWAITING_LIVE_ACCEPTANCE`
- `VERIFIED_CLOSED`
- `BLOCKED`

Do not call a phase closed merely because code compiles.

---

# 12. Rules for future agents

Before modifying AgentWhatsApp:

1. Read this file.
2. Inspect the real current code and `git status`.
3. Do not trust outdated chat summaries over current code and this file.
4. Do not reintroduce alternate production conversation paths.
5. Do not change authority boundaries silently.
6. Do not hardcode the sandal, price, colors, sizes, seller, phone, or Product.
7. Do not use global WhatsApp credentials as fallback.
8. Do not bypass tenant context.
9. Do not mix D5–D12 scopes without explicit approval.
10. Do not perform destructive Git actions.
11. Do not send live WhatsApp messages unless explicitly requested.
12. Update this file before closing a phase.

---

# 13. Current next action

Start:

```text
Phase D5 — Product Media & Asset Foundation
```

Before implementation, perform a focused architecture audit of:

- existing logo/R2 adapter;
- existing Product image metadata;
- existing receipt image fallback;
- current upload limits and parsers;
- tenant-owned object-key conventions;
- frontend upload components;
- security gaps.

Do not begin D6 behavior inside D5.

---

# 14. Change log

## 2026-08-06

- D1–D4 documented as `VERIFIED_CLOSED`.
- Recorded the one approved production Hybrid conversation path.
- Recorded Catalog/Config/Session authority boundaries.
- Recorded the golden women’s-sandal conversation flow.
- Added approved D5–D12 roadmap.
- Added documentation and phase-closure protocol.

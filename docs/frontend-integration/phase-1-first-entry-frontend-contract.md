# Phase 1 First Entry Frontend Integration Contract

## 1. Purpose

Phase 1 built the backend First Entry engine for AgentWhatsApp. First Entry is the first commercial reply the WhatsApp AI sales agent sends when a customer enters the conversation. It covers product info, price, delivery/payment wording, CTA buttons, and safe click normalization.

This document is the integration contract for the future seller dashboard/frontend. It explains which backend features exist, which settings a seller dashboard should expose later, which endpoints are safe for preview, and how the current guarded WhatsApp smoke path behaves.

## 2. Current Status

Phase 1 is backend-ready and WhatsApp smoke-tested. It is not a production rollout, not a broadcast or old-lead system, and not real-customer activation.

Phase 1K live smoke test worked using a Meta test phone number and the owner test recipient only. Masked example recipient: `212******073`.

Current live result:

- Message 1: product/commercial info as text.
- Message 2: short CTA question with reply buttons.
- Buttons appeared in WhatsApp.
- Clicking `order_now` was safely blocked from real order flow.

No access tokens, raw secrets, or full real phone numbers belong in frontend logs, docs, or UI.

## 3. What Phase 1 Built

### 1A Config Foundation

Purpose: introduced config-driven First Entry settings and demo seller/product defaults.

Real backend files:

- `backend/src/modules/agent/config/first-entry-config.service.ts`
- `backend/src/modules/agent/config/agent-config.controller.ts`

Frontend relevance: future settings pages should edit data equivalent to this config contract instead of hardcoded copy.

### 1B Renderer Preview

Purpose: renders the First Entry text from config without sending WhatsApp messages.

Real backend files:

- `backend/src/modules/agent/config/first-entry-renderer.service.ts`

Frontend relevance: dashboard preview cards should use the rendered text and metadata to show a WhatsApp-like preview.

### 1C Eligibility

Purpose: decides whether First Entry is eligible for a conversation before the current message is persisted as shown.

Real backend files:

- `backend/src/modules/agent/config/first-entry-eligibility.service.ts`

Frontend relevance: readiness panels can show why a seller/customer pair is or is not eligible.

### 1D CTA Metadata

Purpose: exposes CTA metadata such as `first_entry:order_now` and `first_entry:more_info`.

Real backend files:

- `backend/src/modules/agent/config/first-entry-renderer.service.ts`
- `backend/src/modules/agent/agent-action.types.ts`

Frontend relevance: CTA editor and preview components should render button labels and IDs from backend metadata.

### 1E Intent-Aware Preview

Purpose: previews how likely customer messages map to First Entry-related intents safely.

Real backend files:

- `backend/src/modules/agent/config/first-entry-intent-preview.service.ts`

Frontend relevance: future QA tools can test greeting/order/info inputs before enabling live behavior.

### 1F Dry-Run Integration

Purpose: runs First Entry through a dry-run integration path without live WhatsApp dispatch.

Real backend files:

- `backend/src/modules/agent/config/first-entry-dry-run.service.ts`

Frontend relevance: live test panels should use dry-run first and require explicit guarded live opt-in later.

### 1G Safe Agent Test Integration

Purpose: integrated First Entry preview into `POST /api/agent/test` with explicit opt-in flags only.

Real backend files:

- `backend/src/modules/agent/config/first-entry-agent-test.service.ts`
- `backend/src/modules/agent/agent.controller.ts`

Frontend relevance: internal QA pages can test First Entry without mutating real runtime.

### 1H Click Normalization Preview

Purpose: normalizes CTA click payloads safely and blocks real routing.

Real backend files:

- `backend/src/modules/agent/config/first-entry-click-normalizer.service.ts`

Frontend relevance: click preview tools can show what a button click would mean without starting order or info flows.

### 1I Readiness Gate

Purpose: verifies Phase 1 readiness, safety checks, and no accidental live dispatch dependencies.

Real backend files:

- `backend/scripts/test-phase-1i-first-entry-readiness-gate.ps1`

Frontend relevance: dashboard readiness UI should mirror these safety concepts before exposing live tests.

### 1J Closure

Purpose: final closure checks for Phase 1 backend readiness.

Real backend files:

- `backend/scripts/test-phase-1j-first-entry-final-closure.ps1`
- `docs/first-entry-phase-1-closure.md`

Frontend relevance: future product planning should treat Phase 1 as backend-ready only, not production-ready.

### 1K Guarded Live Smoke Test

Purpose: guarded WhatsApp Cloud live smoke path for owner/test recipient only.

Real backend files:

- `backend/src/modules/agent/config/first-entry-live-smoke.service.ts`
- `backend/src/modules/whatsapp/cloud/whatsapp-cloud.service.ts`
- `backend/scripts/test-phase-1k-first-entry-live-smoke-guard.ps1`
- `docs/first-entry-live-smoke-test-runbook.md`

Frontend relevance: future Live Smoke Test panel should call readiness and preview endpoints, require explicit flags, and never enable broad production sending.

## 4. Real Backend Code Locations

- `backend/src/modules/agent/config/first-entry-config.service.ts`: source of demo First Entry settings and normalized config.
- `backend/src/modules/agent/config/first-entry-renderer.service.ts`: text renderer, CTA metadata, and preview payload assembly.
- `backend/src/modules/agent/config/first-entry-eligibility.service.ts`: eligibility checks for first-time customer entry.
- `backend/src/modules/agent/config/first-entry-intent-preview.service.ts`: safe intent preview for first-entry messages.
- `backend/src/modules/agent/config/first-entry-click-normalizer.service.ts`: CTA click normalization and safe routing preview.
- `backend/src/modules/agent/config/first-entry-live-smoke.service.ts`: guarded live smoke readiness, dispatch preview, and live smoke result construction.
- `backend/src/modules/agent/agent.controller.ts`: HTTP controllers for First Entry previews, readiness, dry-run, click preview, and agent test integration.
- `backend/src/modules/agent/agent.routes.ts`: Express route bindings for the Agent/First Entry API surface.
- `backend/src/modules/agent/agent-action.types.ts`: shared action/UI metadata types, including First Entry smoke metadata.
- `backend/src/modules/whatsapp/cloud/whatsapp-cloud.service.ts`: WhatsApp Cloud webhook/dispatch integration using guarded dispatch paths.
- `backend/src/config/env.ts`: environment flag parsing and safe defaults.

`backend/scripts` contains test/verifier scripts only. These scripts are not customer runtime. `docs` contains documentation/runbooks only. Real WhatsApp behavior comes from `backend/src`.

## 5. Future Frontend Pages Needed

### Seller Onboarding Page

Fields:

- store name
- WhatsApp phone connection status
- default sellerId
- default product selection

### Product Settings Page

Fields:

- product name
- price
- show/hide price
- product availability
- sizes/colors/variants if relevant
- product image/media later

### First Entry Settings Page

Fields:

- enabled/disabled
- greeting style: short, friendly, professional
- CTA mode: order_only, info_only, order_or_info, none
- primary CTA label
- secondary CTA label
- show product name
- show price
- payment line enabled
- trust line enabled/custom
- delivery policy
- preview button

### Delivery Settings Page

Fields:

- delivery mode: all_cities, selected_cities, excluded_cities, not_available, not_mentioned
- delivery price
- free delivery true/false
- selected cities list
- excluded cities list

### Order Settings Page for Phase 2 Later

This is not fully built in Phase 1, but the backend direction is config-driven required fields:

- fullName
- phone
- city
- address
- size
- color
- quantity

### Live Test / Readiness Page

Fields/actions:

- check readiness
- send test only to owner/test recipient
- show liveEnabled false/true
- show warnings
- show masked test recipient
- rollback instructions

## 6. Seller Settings Contract

| Setting | Type | Example | Frontend Control | Backend Meaning | Phase |
| --- | --- | --- | --- | --- | --- |
| `firstEntry.enabled` | boolean | `true` | toggle | enables First Entry rendering/eligibility | 1A |
| `firstEntry.greetingStyle` | enum | `friendly` | segmented control | controls opening tone | 1B |
| `firstEntry.ctaMode` | enum | `order_or_info` | select | chooses CTA set | 1D |
| `firstEntry.primaryCtaLabel` | string | `أطلب الآن` | text input | label for primary CTA | 1D |
| `firstEntry.secondaryCtaLabel` | string | `المزيد من المعلومات` | text input | label for secondary CTA | 1D |
| `firstEntry.showProductName` | boolean | `true` | toggle | includes product name line | 1B |
| `firstEntry.showPrice` | boolean | `true` | toggle | includes price line | 1B |
| `firstEntry.showPaymentLine` | boolean | `true` | toggle | includes payment/COD line | 1B |
| `firstEntry.trustLine` | string/null | `الدفع عند الاستلام متوفر.` | text input | optional reassurance line | 1B |
| `delivery.mode` | enum | `all_cities` | select | controls delivery copy | 1A |
| `delivery.price` | number/null | `20` | number input | delivery cost if known | Future |
| `delivery.free` | boolean | `false` | toggle | free delivery claim only if true | Future |
| `delivery.selectedCities` | string[] | `["الدار البيضاء"]` | city picker | only these cities if mode selected | Future |
| `delivery.excludedCities` | string[] | `[""]` | city picker | excluded cities if mode excluded | Future |
| `product.name` | string | `صندالة نسائية` | text input | product display name | 1A |
| `product.price` | number | `199` | number input | price fact used in copy | 1A |
| `product.available` | boolean | `true` | toggle | availability statement | 1A |
| `order.requiredFields` | string[] | `["fullName","phone","city","address","size","color","quantity"]` | checkbox list | future order collection requirements | Phase 2 |

## 7. API Endpoints for Frontend

### GET `/api/agent/config/:sellerId/first-entry-preview`

Purpose: render First Entry preview for a seller.

Frontend page: First Entry Settings Page.

Mutates state: no.

Sends WhatsApp messages: no.

Safe for preview: yes.

Example request: `GET /api/agent/config/seller_demo_sandals/first-entry-preview`

Example response shape is approximate; use backend response as source of truth:

```json
{
  "previewOnly": true,
  "text": "سلام ...",
  "cta": {
    "items": [
      { "id": "first_entry:order_now", "label": "أطلب الآن" },
      { "id": "first_entry:more_info", "label": "المزيد من المعلومات" }
    ]
  }
}
```

### GET `/api/agent/config/:sellerId/first-entry-eligibility-preview`

Purpose: preview whether First Entry would be eligible.

Frontend page: ReadinessStatusPanel.

Mutates state: no.

Sends WhatsApp messages: no.

Safe for preview: yes.

Example response shape is approximate:

```json
{
  "eligible": true,
  "reason": "first_entry_not_shown"
}
```

### POST `/api/agent/config/:sellerId/first-entry-intent-preview`

Purpose: preview intent treatment for First Entry-related messages.

Frontend page: QA/preview panel.

Mutates state: no.

Sends WhatsApp messages: no.

Safe for preview: yes.

Example request:

```json
{
  "message": "سلام"
}
```

### POST `/api/agent/first-entry-dry-run`

Purpose: run First Entry through dry-run integration without live dispatch.

Frontend page: Live Test / Readiness Page.

Mutates state: no live customer state expected.

Sends WhatsApp messages: no.

Safe for preview: yes.

Example request:

```json
{
  "sellerId": "seller_demo_sandals",
  "customerPhone": "212******073",
  "message": "سلام"
}
```

### POST `/api/agent/first-entry-click-preview`

Purpose: normalize CTA clicks without starting real order/info routing.

Frontend page: CTAButtonsEditor and QA panel.

Mutates state: no.

Sends WhatsApp messages: no.

Safe for preview: yes.

Example request:

```json
{
  "clickId": "first_entry:order_now"
}
```

### GET `/api/agent/first-entry-readiness`

Purpose: backend readiness summary for Phase 1 First Entry.

Frontend page: ReadinessStatusPanel.

Mutates state: no.

Sends WhatsApp messages: no.

Safe for preview: yes.

### GET `/api/agent/first-entry-live-smoke-readiness`

Purpose: checks guarded live smoke flags and allowlisted recipient.

Frontend page: LiveSmokeTestPanel.

Mutates state: no.

Sends WhatsApp messages: no.

Safe for preview: yes.

Example request:

`GET /api/agent/first-entry-live-smoke-readiness?testRecipientPhone=212******073&sellerId=seller_demo_sandals`

### POST `/api/agent/first-entry-live-smoke-dispatch-preview`

Purpose: previews the outgoing live-smoke dispatch shape without sending.

Frontend page: LiveSmokeTestPanel.

Mutates state: no.

Sends WhatsApp messages: no.

Safe for preview: yes.

Example response shape is approximate:

```json
{
  "presentationMode": "split_info_and_cta",
  "messages": [
    { "kind": "text", "text": "سلام ...\nالمنتج: صندالة نسائية" },
    {
      "kind": "interactive_buttons",
      "text": "شنو بغيتي ندير دابا؟",
      "buttons": [
        { "id": "first_entry:order_now", "label": "أطلب الآن" },
        { "id": "first_entry:more_info", "label": "المزيد من المعلومات" }
      ]
    }
  ],
  "interactiveSendDecision": {
    "mode": "interactive_preview"
  }
}
```

### POST `/api/agent/test` with explicit opt-in flags only

Purpose: internal agent testing. First Entry paths require explicit opt-in flags such as preview/click-preview flags.

Frontend page: developer QA only, not seller production UI.

Mutates state: depends on options; avoid stateful options for preview.

Sends WhatsApp messages: no.

Safe for preview: only with explicit preview flags.

## 8. Preview Flow for Frontend

1. Seller changes First Entry settings.
2. Frontend calls preview endpoint.
3. Backend returns rendered text plus CTA metadata.
4. Frontend shows WhatsApp-like preview.
5. Seller saves settings later.
6. No WhatsApp message is sent during preview.

Example request:

```json
{
  "sellerId": "seller_demo_sandals"
}
```

Example response shape is approximate; refer to backend response as source of truth:

```json
{
  "previewOnly": true,
  "text": "سلام 👋\nمرحبا بك، المنتج متوفر حالياً.",
  "cta": {
    "items": [
      { "id": "first_entry:order_now", "label": "أطلب الآن" },
      { "id": "first_entry:more_info", "label": "المزيد من المعلومات" }
    ]
  }
}
```

## 9. WhatsApp Runtime Flow

Customer sends message:

```text
سلام
```

Backend flow:

1. WhatsApp Cloud webhook receives message.
2. `conversationKey = sellerId + ":" + customerPhone`.
3. First Entry smoke guard checks env and allowlist in Phase 1K.
4. Eligibility is evaluated before saving the current message.
5. First Entry is rendered.
6. Cloud dispatch sends Message 1 text and Message 2 reply buttons.
7. `firstEntryShown` is marked only after successful guarded dispatch.
8. CTA clicks are normalized but real routing is blocked until Phase 2/3.

Phase 1K is test/smoke only. Production routing will come later.

## 10. Current WhatsApp Live Smoke Result

Safe summary of the successful live smoke:

- Used Meta test phone number.
- Used owner test recipient only.
- No real customers.
- First message arrived.
- Separate CTA message arrived.
- Buttons appeared.
- Clicking order button returned a safe block message.
- No real order flow started.

## 11. Click Behavior

Current click IDs:

- `first_entry:order_now`
- `first_entry:more_info`

Current Phase 1 behavior:

- recognized
- normalized
- preview/safe block only
- no real order/info routing

Future behavior:

- Phase 2: `order_now` starts order path.
- Phase 3: `more_info` starts information path.

## 12. Safety Rules

- No live send by default.
- No production activation yet.
- No real customers.
- No broadcasts.
- No old leads.
- No AI/LLM required for First Entry.
- No media/images from First Entry.
- No session/order mutation during preview paths.

Live smoke requires:

- `FIRST_ENTRY_LIVE_SMOKE_ENABLED=true`
- `WHATSAPP_INTERACTIVE_LIVE_SEND_ALLOWED=true`
- `WHATSAPP_CLOUD_DRY_RUN=false`
- allowed recipient
- cloud provider
- readiness true

## 13. Environment Flags

| Env flag | Purpose | Safe default | Frontend relevance | Expose in frontend? |
| --- | --- | --- | --- | --- |
| `WHATSAPP_PROVIDER` | chooses provider such as Cloud API | non-live/local value | readiness display | read-only masked/status only |
| `FIRST_ENTRY_LIVE_SMOKE_ENABLED` | enables guarded live smoke | `false` | live smoke readiness | no direct seller edit |
| `FIRST_ENTRY_LIVE_SMOKE_TEST_RECIPIENT` | allowlisted owner test recipient | placeholder only | masked readiness display | masked only |
| `FIRST_ENTRY_LIVE_SMOKE_SELLER_ID` | seller used by smoke path | demo seller | readiness display | read-only |
| `WHATSAPP_INTERACTIVE_LIVE_SEND_ALLOWED` | extra guard for interactive live send | `false` | readiness display | no direct seller edit |
| `WHATSAPP_CLOUD_DRY_RUN` | prevents real Cloud sends when true | `true` for safe testing | readiness display | no direct seller edit |
| `WHATSAPP_CLOUD_REPLY_BUTTONS_ENABLED` | enables Cloud reply buttons | `true` when testing buttons | preview/readiness display | admin only |
| `WHATSAPP_INTERACTIVE_CHOICES_ENABLED` | enables interactive choices/buttons | `true` when testing | preview/readiness display | admin only |
| `WHATSAPP_INTERACTIVE_ENABLED` | legacy/general interactive flag if used | safe disabled unless known | compatibility display | admin only |
| `WHATSAPP_CLOUD_ACCESS_TOKEN` | Meta token for Cloud API | never committed | required for live Cloud | never expose |
| `WHATSAPP_CLOUD_PHONE_NUMBER_ID` | Cloud phone number ID | configured per environment | status only | masked/read-only |
| `PUBLIC_BASE_URL` | public base URL for webhooks/forms | empty in local | webhook diagnostics later | admin only |

## 14. Data Model Notes for Future Database

Future tables/collections likely needed:

### Seller

- id
- storeName
- phone
- whatsappProvider
- status

### Product

- id
- sellerId
- name
- price
- deliveryPrice
- images
- available
- sizes/colors/variants

### FirstEntrySettings

- sellerId
- enabled
- greetingStyle
- ctaMode
- labels
- showPrice
- showProductName
- deliveryPolicy
- paymentEnabled
- trustLine

### ConversationSession

- conversationKey
- sellerId
- customerPhone
- firstEntryShownAt
- orderState
- infoState
- messages metadata

Do not implement DB now. This is only a planning contract.

## 15. Frontend Components Suggested

- `WhatsAppPreviewCard`: inputs are rendered text, message sequence, CTA metadata; output is a visual phone-style preview.
- `FirstEntrySettingsForm`: inputs are First Entry settings; output is draft settings and preview refresh events.
- `DeliveryPolicyEditor`: inputs are delivery mode, price, free flag, city lists; output is normalized delivery policy.
- `CTAButtonsEditor`: inputs are CTA mode and labels; output is ordered CTA config.
- `ReadinessStatusPanel`: inputs are readiness endpoint responses; output is guard status and warnings.
- `LiveSmokeTestPanel`: inputs are readiness, masked recipient, preview result; output is explicit test action only when safe.
- `SellerProductSelector`: inputs are seller products; output is active/default product selection.

## 16. Testing Checklist for Future Developers

Commands:

```powershell
cd C:\AgentWhatsApp\backend
npm run build
powershell -ExecutionPolicy Bypass -File .\scripts\test-phase-1i-first-entry-readiness-gate.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\test-phase-1j-first-entry-final-closure.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\test-phase-1k-first-entry-live-smoke-guard.ps1
```

Live WhatsApp checklist:

1. Enable flags only temporarily.
2. Readiness must be true.
3. Use own test recipient only.
4. Reset session correctly:

```powershell
# DELETE /api/agent/session/212690291073?sellerId=seller_demo_sandals
Invoke-RestMethod -Method Delete -Uri "http://localhost:5000/api/agent/session/212690291073?sellerId=seller_demo_sandals"
```

5. Send `سلام`.
6. Expect split message plus buttons.
7. Click order button.
8. Expect safe block, not order flow.
9. Roll back flags.

## 17. Known Issues / Remaining Work

- Final marketing copy still needs polishing.
- First Entry production activation is not implemented.
- Order button does not start real order flow yet.
- More info button does not start info path yet.
- Settings are currently config/demo/env based, not database/dashboard based.
- Frontend/dashboard is not built yet.
- PostgreSQL persistence is not implemented yet for seller settings.
- Token was exposed during manual testing; user should regenerate Meta token before serious testing/production.

## 18. Next Phase

Next phase: Phase 2 - Order Path.

The Phase 2 Order Path should collect required fields dynamically without depending on Phase 1 live smoke shortcuts.

Goal:

- When user clicks `أطلب الآن`, start real order flow.
- Collect required fields dynamically.
- Support partial messages.
- Support corrections.
- Show summary.
- Confirm order.
- Save order.
- Later receipt/PDF integration belongs Phase 5.

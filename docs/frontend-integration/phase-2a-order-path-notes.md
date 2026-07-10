# Phase 2A Order Path Notes

## 1. Purpose

Phase 2A turns the First Entry `أطلب الآن` action into a real order collection flow. It collects the configured product options and customer delivery information, then renders a review summary.

Phase 2A does not confirm or save the final order. Confirmation and editing belong to Phase 4.

## 2. Current Status

- Backend implementation is complete.
- API and regression tests pass.
- The flow has been tested in real WhatsApp.
- The size list, color buttons, quantity collection, and delivery information collection work.
- Multi-field customer messages are supported.
- The final review summary works.
- Final confirmation remains blocked until Phase 4.
- PDF receipts belong to Phase 5.
- This is not a production rollout.

## 3. WhatsApp Runtime Flow

The customer starts with a normal greeting:

```text
Customer: سلام
Bot: First Entry product information with CTA buttons.
```

After the customer clicks `أطلب الآن`:

```text
Bot:
تمام ✅
نبدأو الطلب ديالك.

اختار المقاس المناسب ليك.
```

The remaining flow is:

1. Size list: `36`, `37`, `38`, `39`, `40`.
2. Color buttons: `أسود`, `وردي`, `أبيض`.
3. Quantity question: `شحال من وحدة بغيتي؟`
4. Delivery information question:

```text
عافاك عطيني معلومات التوصيل:
الاسم + الهاتف + المدينة + العنوان
```

5. Final review summary containing the collected order data.
6. A reply of `نعم` remains blocked and does not confirm the order until Phase 4.

## 4. UX Rules

- Collect valid values silently.
- Ask only for the next missing item.
- Do not repeat fields already collected during the flow.
- Do not repeatedly list all missing fields.
- Show all collected information only in the final summary.
- If all delivery information arrives in one message, proceed directly to the summary.
- If a customer provides only part of the delivery information, ask only for the remaining field.
- Clarification is allowed for invalid or unclear answers.

Example: if name, phone, and city are collected but address is missing, reply only with `عافاك عطيني العنوان الكامل ديال التوصيل.`

## 5. Configurable Settings

The future dashboard must treat the following as seller/product configuration rather than fixed UI copy.

Product settings:

- Product name, price, and availability.
- Sizes and colors.
- Additional variants later.

Order settings:

- Required fields and field order.
- Whether size, color, and quantity are required.
- Customer and delivery fields.

Text settings:

- Size, color, quantity, and delivery questions.
- Final summary template.
- Confirmation-block text.

Delivery settings:

- Delivery wording.
- Delivery price later.
- Supported and excluded cities later.

Payment settings:

- Payment method wording.
- COD enabled or disabled later.

The backend field model already supports optional per-field prompt overrides. Defaults remain centralized until dashboard-managed settings are introduced.

## 6. Required Fields

The default sandals demo collects:

- `size`
- `color`
- `quantity`
- `fullName`
- `phone`
- `city`
- `address`

Required fields and their order are config-driven. The sandals product is only a demo; the frontend must not hardcode sandals-specific fields or options.

## 7. WhatsApp Interactive UI

- Product options with more than three choices are sent as a WhatsApp list. The size options currently use this mode.
- Product options with three or fewer choices are sent as reply buttons. The color options currently use this mode.
- Safe text fallback must remain available when interactive sending is disabled, blocked, or rejected.

Example option identifiers:

```text
size:36
size:37
size:38
color:أسود
color:وردي
color:أبيض
```

The backend normalizes selected IDs before passing their values to the existing order state manager.

## 8. Backend Files

- `backend/src/modules/agent/agent.service.ts`: main agent orchestration and session-aware result construction.
- `backend/src/modules/agent/config/demo-seller-configs.ts`: demo seller order settings and field order.
- `backend/src/modules/agent/config/required-fields.service.ts`: resolves and orders required customer and product-option fields.
- `backend/src/modules/agent/fast-intent-analyzer.service.ts`: deterministic recognition of common order messages.
- `backend/src/modules/agent/order/order-state.service.ts`: extraction, validation, collection, and order-state transitions.
- `backend/src/modules/agent/order/order-response.builder.ts`: progress and final review response selection.
- `backend/src/modules/agent/reply/dynamic-reply-renderer.service.ts`: next-question-only text and interactive UI hints.
- `backend/src/modules/whatsapp/cloud/cloud-interactive-reply-normalizer.service.ts`: normalizes WhatsApp list/button selections.
- `backend/src/modules/whatsapp/cloud/whatsapp-cloud.service.ts`: guarded Cloud API reply dispatch and fallback behavior.
- `backend/src/modules/whatsapp/cloud/whatsapp-cloud.controller.ts`: Cloud API test and diagnostic endpoints.

Files under `backend/scripts` are regression tests only. Runtime behavior belongs under `backend/src`.

## 9. State Model

The conversation identity is isolated by seller and customer:

```text
conversationKey = sellerId + ":" + customerPhone
```

- Seller/customer sessions must remain isolated.
- Collected values live in the conversation order state.
- The Phase 2A summary is review-only.
- `isComplete` can be true when all required values exist.
- `awaitingConfirmation` can be true for the review state.
- `confirmed` must remain false in Phase 2A.

## 10. API / Manual Test Notes

Reset a seller-scoped session:

```powershell
Invoke-RestMethod -Method DELETE `
  -Uri "http://localhost:5000/api/agent/session/212600000000?sellerId=seller_demo_sandals"
```

Exercise the agent flow:

```powershell
$body = @{
  message = "first_entry:order_now"
  customerPhone = "212600000000"
  sellerId = "seller_demo_sandals"
  useMemory = $true
} | ConvertTo-Json

Invoke-RestMethod -Method POST `
  -Uri "http://localhost:5000/api/agent/test" `
  -ContentType "application/json; charset=utf-8" `
  -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

Check confirmed orders:

```powershell
Invoke-RestMethod -Method GET -Uri "http://localhost:5000/api/agent/orders"
```

After the Phase 2A flow, `/api/agent/orders` must remain empty because no final confirmed order is saved.

## 11. Safety Rules

- No production rollout or broadcasts.
- Do not contact old leads.
- No final confirmation or confirmed-order save.
- No PDF receipt or seller notification.
- No AI/LLM is required for this deterministic path.
- Do not place access tokens, secrets, or real customer data in documentation.
- Roll live test flags back to their safe values after controlled testing.

## 12. Known Remaining Work

- The `المزيد من المعلومات` CTA belongs to Phase 3.
- Final confirmation belongs to Phase 4.
- Editing an order after the summary belongs to Phase 4.
- PDF receipt generation and sending belong to Phase 5.
- Seller notifications, database persistence, and dashboard-managed settings come later.
- Regenerate the Meta access token before serious testing or production use.

## 13. Next Phase

Recommended next step: **Phase 3 — More Info Path**.

Its goal is to answer product questions after the customer clicks `المزيد من المعلومات` and guide the customer naturally back to ordering.

Alternative: start **Phase 4 — Confirmation + Edit** first if completing the order lifecycle is the higher priority.

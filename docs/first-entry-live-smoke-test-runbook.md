# First Entry Live Smoke Test Runbook

## Purpose

This runbook is for Phase 1K guarded First Entry WhatsApp live smoke testing.

The goal is to prove that the First Entry renderer, eligibility gate, CTA UI hints, and Cloud API guarded dispatch can send one controlled First Entry reply to the app owner's own test WhatsApp recipient only.

This is not a production rollout.

## Safe Defaults

First Entry live smoke is disabled by default.

Default safe values:

```env
FIRST_ENTRY_LIVE_SMOKE_ENABLED=false
FIRST_ENTRY_LIVE_SMOKE_TEST_RECIPIENT=212600000000
FIRST_ENTRY_LIVE_SMOKE_SELLER_ID=seller_demo_sandals
WHATSAPP_INTERACTIVE_LIVE_SEND_ALLOWED=false
WHATSAPP_CLOUD_DRY_RUN=true
```

When disabled, the webhook must fall back to the existing safe agent behavior and must not send First Entry automatically.

## Required Env Flags

Set these only for a controlled smoke test:

```env
WHATSAPP_PROVIDER=cloud_api
WHATSAPP_CLOUD_DRY_RUN=false
WHATSAPP_INTERACTIVE_ENABLED=true
WHATSAPP_CLOUD_REPLY_BUTTONS_ENABLED=true
WHATSAPP_INTERACTIVE_CHOICES_ENABLED=true
WHATSAPP_INTERACTIVE_LIVE_SEND_ALLOWED=true
FIRST_ENTRY_LIVE_SMOKE_ENABLED=true
FIRST_ENTRY_LIVE_SMOKE_TEST_RECIPIENT=212600000000
FIRST_ENTRY_LIVE_SMOKE_SELLER_ID=seller_demo_sandals
```

Do not include access tokens, app secrets, or real customer phone numbers in screenshots, commits, logs, or notes.

## Own Test Recipient Only

Use only the app owner's own test recipient phone number configured in `FIRST_ENTRY_LIVE_SMOKE_TEST_RECIPIENT`.

Forbidden:

- Real customers
- Broadcasts
- Old leads
- Multiple recipients
- Production rollout
- Sending without a readiness check

## Pre-Flight Readiness Command

Run from PowerShell:

```powershell
Invoke-RestMethod -Method GET -Uri "http://localhost:5000/api/agent/first-entry-live-smoke-readiness?testRecipientPhone=212600000000&sellerId=seller_demo_sandals" | ConvertTo-Json -Depth 20
```

Expected:

- `ok=true`
- `mode="guarded_live_smoke_test_only"`
- `ready=true`
- `recipientAllowed=true`
- `cloudProvider=true`
- `cloudGuardEnabled=true`
- `cloudDryRunDisabled=true`
- `noBroadcast=true`
- `notProductionReady=true`

If `ready=false`, stop. Do not send.

## Button Dispatch Preview

Before a live smoke test, confirm the outgoing First Entry response would use WhatsApp reply buttons:

```powershell
$body = @{
  sellerId = "seller_demo_sandals"
  customerPhone = "212600000000"
  message = "سلام"
  interactiveEnabledOverride = $true
} | ConvertTo-Json

Invoke-RestMethod -Method POST -Uri "http://localhost:5000/api/agent/first-entry-live-smoke-dispatch-preview" -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 20
```

Expected:

- `ctas.items` includes `first_entry:order_now`
- `ctas.items` includes `first_entry:more_info`
- `uiHints.replyUi.kind="buttons"`
- `whatsappInteractivePreview.interactive.type="button"`
- `interactiveSendDecision.mode="interactive_preview"`

This endpoint is preview-only and must not send to Meta.

## Clear Test Session

Before a repeated smoke test, clear only the allowlisted test recipient session.

Use the customer phone as the path parameter and the seller as a query parameter:

```powershell
Invoke-RestMethod -Method DELETE -Uri "http://localhost:5000/api/agent/session/212690291073?sellerId=seller_demo_sandals"
```

Do not delete `/api/agent/session/seller_demo_sandals:212690291073`; that can create an invalid `sellerId:sellerId:phone` lookup shape in this API.

## Exact Backend Start Command

Run from PowerShell:

```powershell
cd C:\AgentWhatsApp\backend
npm run dev
```

Keep the terminal visible and watch for:

- `first_entry.live_smoke.blocked`
- `first_entry.live_smoke.result`
- `whatsapp.cloud.reply.dispatch`

## Exact Manual WhatsApp Messages

From the allowlisted test recipient only, send one clean first message:

```text
سلام
```

Optional additional smoke messages:

```text
واش كاين التوصيل؟
```

```text
شحال الثمن؟
```

Do not test with any non-allowlisted phone number.

## Expected Results

For an eligible new conversation:

- Backend logs `first_entry.live_smoke.result`.
- The First Entry presentation is sent as two messages.
- Message 1 is a text-only product/commercial info message.
- Message 2 is a short CTA question with WhatsApp reply buttons.
- Expected question: `شنو بغيتي ندير دابا؟`
- Expected buttons:
  - `أطلب الآن`
  - `المزيد من المعلومات`
- If buttons are enabled and supported, CTA buttons are sent through the existing Cloud dispatch guard.
- `firstEntryShown` is marked only after successful guarded dispatch.
- Sending the same conversation again should not show First Entry again.

Exact WhatsApp visual rendering can vary by WhatsApp app version and theme. The functional expectation is that the second message has two reply buttons under it.

For blocked cases:

- Backend logs `first_entry.live_smoke.blocked`.
- No First Entry live send happens.
- Existing safe behavior continues.

## What Must NOT Happen

- No send to real customers
- No broadcast
- No old lead blast
- No production rollout
- No First Entry send when readiness is false
- No Meta API call from the readiness endpoint
- No direct Graph API send bypassing the guarded Cloud dispatcher
- No order flow start from First Entry CTA clicks in this phase
- No info flow start from First Entry CTA clicks in this phase
- No AI, media, image, receipt, or DB behavior triggered by First Entry live smoke

## Rollback Steps

Set:

```env
FIRST_ENTRY_LIVE_SMOKE_ENABLED=false
WHATSAPP_INTERACTIVE_LIVE_SEND_ALLOWED=false
WHATSAPP_CLOUD_DRY_RUN=true
```

Then restart:

```powershell
cd C:\AgentWhatsApp\backend
npm run dev
```

Re-run readiness and confirm:

- `ready=false`
- `firstEntryLiveSmokeEnabled=false`

## Stop Conditions

Stop immediately if:

- A message is sent to the wrong recipient.
- Readiness is false but a First Entry message is sent.
- A token, app secret, or Authorization header appears in logs.
- A First Entry CTA starts real order flow or info flow.
- A send bypasses the existing Cloud dispatch guard.
- Unexpected media, image, PDF, AI, or DB behavior appears.

## Evidence To Capture

Capture:

- Readiness endpoint response with masked recipient.
- Backend log line `first_entry.live_smoke.result`.
- Backend log line `whatsapp.cloud.reply.dispatch`.
- Screenshot of the WhatsApp message received by the allowlisted test recipient.
- Confirmation that a second message in the same session does not repeat First Entry.

Do not capture or share secrets.

## Next Phase Dependency

Phase 1K only proves guarded live smoke activation.

Real CTA routing belongs to later phases:

- Order CTA routing: Phase 2 or later
- Info CTA routing: Phase 3 or later
- Production rollout: after explicit multi-tenant, safety, logging, and consent gates

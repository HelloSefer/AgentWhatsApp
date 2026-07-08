# WhatsApp Cloud Live Interactive Smoke Test Runbook

## 1. Purpose

This document is for one controlled live WhatsApp Cloud interactive smoke test.

This runbook does not enable live sending by itself.
This runbook does not send any message by itself.

Use it only after the backend readiness endpoint says the environment is ready and only with a WhatsApp number you control.

## 2. Current safe defaults

The safe defaults are:

```env
WHATSAPP_INTERACTIVE_ENABLED=false
WHATSAPP_INTERACTIVE_LIVE_SEND_ALLOWED=false
```

With these defaults, WhatsApp Cloud replies stay text-only even if the agent can prepare interactive button or list previews.

## 3. Required live-test flags

A live interactive test requires all of these flags:

```env
WHATSAPP_INTERACTIVE_ENABLED=true
WHATSAPP_INTERACTIVE_LIVE_SEND_ALLOWED=true
WHATSAPP_CLOUD_DRY_RUN=false
```

Use these values only for a short controlled test window. Do not leave the system armed for live interactive sending after the smoke test.

## 4. Pre-flight readiness check

Run this before changing anything else:

```powershell
$base = "http://localhost:5000"

Invoke-RestMethod `
  -Method Get `
  -Uri "$base/api/whatsapp/cloud/live-interactive-readiness?testRecipientPhone=YOUR_TEST_PHONE&sellerId=seller_demo_medical" |
  ConvertTo-Json -Depth 100
```

`readyForLiveInteractiveTest` must be `true` before a live test. If it is `false`, stop and fix the blocking checks first.

## 5. Test recipient safety

Use only your own WhatsApp test number.

Do not test with real customers.
Do not test with broadcast lists.
Do not test with old leads.
Do not test multiple recipients at once.

## 6. Exact manual conversation to test

Use the medical demo seller for this first controlled test.

Customer sends:

```text
بغيت نكوموندي
```

Then customer sends:

```text
محمد 0612345678 مراكش
```

Expected result:

- The second bot reply should arrive as interactive buttons.
- Buttons should include:
  - نعم
  - تعديل

Then test pressing:

```text
تعديل
```

Expected result:

- The bot should ask what field to edit or continue the correction flow.

Do not require final order confirmation in this live smoke test unless interactive reply click handling is already implemented and verified. Button click behavior may be completed in the next phase.

## 7. Immediate rollback to safe mode

Immediately after the smoke test, return to safe mode:

```env
WHATSAPP_INTERACTIVE_ENABLED=false
WHATSAPP_INTERACTIVE_LIVE_SEND_ALLOWED=false
WHATSAPP_CLOUD_DRY_RUN=true
```

At minimum, return these two flags to safe values:

```env
WHATSAPP_INTERACTIVE_ENABLED=false
WHATSAPP_INTERACTIVE_LIVE_SEND_ALLOWED=false
```

Then restart the backend.

## 8. What to capture

Capture:

- backend logs
- readiness output
- whether the WhatsApp message arrived
- whether buttons appeared
- whether fallback text was used
- any Meta API error message without exposing token

Do not paste access tokens or authorization headers into notes, commits, screenshots, or chats.

## 9. Stop conditions

Stop immediately if:

- readiness is false
- token error appears
- message sends to the wrong number
- buttons do not appear
- unexpected repeated sends happen
- fallback loops
- Meta returns permission, rate, or template error

After stopping, roll back to safe mode before doing any debugging.

## 10. Next phase dependency

After this runbook is ready, the next engineering phase is interactive reply click handling.

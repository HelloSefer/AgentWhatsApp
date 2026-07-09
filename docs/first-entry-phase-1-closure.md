# Phase 1 First Entry Closure

## Status

Phase 1 First Entry is completed as preview/test-ready.

It is not production/live-enabled. It is not automatically connected to the live WhatsApp webhook, and it must not be treated as production readiness.

## Implemented Phases

- 1A Config Foundation
- 1B Renderer Preview
- 1C Eligibility
- 1D CTA Metadata
- 1E Intent-Aware Preview
- 1F Dry-Run Integration
- 1G Safe Agent Test Integration
- 1H Click Normalization Preview
- 1I Readiness Gate

## Main Endpoints

- `GET /api/agent/config/:sellerId/first-entry-preview`
- `GET /api/agent/config/:sellerId/first-entry-eligibility-preview`
- `POST /api/agent/config/:sellerId/first-entry-intent-preview`
- `POST /api/agent/first-entry-dry-run`
- `POST /api/agent/first-entry-click-preview`
- `GET /api/agent/first-entry-readiness`
- `POST /api/agent/test` with explicit opt-in flags only

## Explicit Opt-In Flags

First-entry behavior in the agent test path is available only when explicitly requested:

- `enableFirstEntryPreview: true`
- `firstEntryMode: "preview"`
- `enableFirstEntryClickPreview: true`
- `firstEntryClickMode: "preview"`

Without these flags, default `/api/agent/test` behavior remains unchanged.

## Safety Guarantees

Phase 1 preview and test paths guarantee:

- no live WhatsApp send
- no Meta Send API
- no AI/LLM
- no session mutation in preview paths
- no order mutation in preview paths
- no media/image send
- no CTA live routing
- default `/api/agent/test` unchanged without explicit flags

## Readiness

The readiness endpoint returns:

- readiness label: `ready_for_guarded_test_activation`
- `liveEnabled: false`

This does not mean production readiness. It only means the First Entry stack is safe to proceed to a guarded test activation or manual WhatsApp smoke test.

## Still Not Implemented

- First-entry is not automatically shown in live WhatsApp.
- CTA clicks are not routed to real order/info flow.
- Order path still belongs to Phase 2.
- Info path still belongs to Phase 3.
- Receipt/PDF belongs to Phase 5.
- Production activation is not allowed yet.

## Final Verification Commands

Run from PowerShell:

```powershell
cd C:\AgentWhatsApp\backend
npm run build
powershell -ExecutionPolicy Bypass -File .\scripts\test-phase-1i-first-entry-readiness-gate.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\test-phase-1i-first-entry-readiness-gate.ps1 -RunSelected0E
powershell -ExecutionPolicy Bypass -File .\scripts\test-phase-1j-first-entry-final-closure.ps1
```

## Next Step

The next allowed step is a guarded WhatsApp live smoke test using the owner's own test recipient only.

## Live Smoke Test Rules

- Use own test number only.
- Use own test recipient only.
- Do not test with real customers.
- Do not test with broadcast lists.
- Do not test with old leads.
- Verify `GET /api/agent/first-entry-readiness` first.
- Use existing live guardrails.
- Keep rollback command/steps visible before testing.
- Stop immediately on unexpected send.
- Stop immediately on unsafe payload.
- Stop immediately on unmasked secret.
- Stop immediately on wrong recipient.

Do not include secrets, real access tokens, or real customer phone numbers in test notes or logs.

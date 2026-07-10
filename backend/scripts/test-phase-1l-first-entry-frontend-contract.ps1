param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendRoot = Split-Path -Parent $scriptDir
$repoRoot = Split-Path -Parent $backendRoot
$docPath = Join-Path $repoRoot "docs/frontend-integration/phase-1-first-entry-frontend-contract.md"
$results = New-Object System.Collections.Generic.List[object]

function Add-Result {
  param(
    [string]$Group,
    [string]$CheckName,
    [bool]$Passed,
    [string]$Details = "",
    [int]$DurationMs = 0
  )

  $script:results.Add([PSCustomObject]@{
    Group = $Group
    CheckName = $CheckName
    Passed = $Passed
    Details = $Details
    DurationMs = $DurationMs
  })
}

function Invoke-Check {
  param(
    [string]$Group,
    [string]$CheckName,
    [scriptblock]$Check,
    [string]$Details = ""
  )

  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $passed = $false
  $checkDetails = $Details

  try {
    $passed = [bool](& $Check)
  } catch {
    $passed = $false
    $checkDetails = $_.Exception.Message
  } finally {
    $watch.Stop()
  }

  Add-Result $Group $CheckName $passed $checkDetails ([int]$watch.ElapsedMilliseconds)
}

function Test-Contains {
  param(
    [string]$Text,
    [string]$Needle
  )

  return $Text.Contains($Needle)
}

function Test-ContainsAny {
  param(
    [string]$Text,
    [string[]]$Needles
  )

  foreach ($needle in $Needles) {
    if ($Text.Contains($needle)) {
      return $true
    }
  }

  return $false
}

function Get-PhaseMentioned {
  param(
    [string]$Text,
    [string]$Phase
  )

  return $Text.Contains($Phase)
}

Write-Host "Phase 1L First Entry Frontend Contract Verifier"
Write-Host ("Repository root: {0}" -f $repoRoot)
Write-Host ("Document: {0}" -f $docPath)

$docExists = Test-Path $docPath
$content = if ($docExists) {
  Get-Content -Raw -Encoding UTF8 $docPath
} else {
  ""
}

Invoke-Check "Document" "document exists" { $docExists } $docPath
Invoke-Check "Document" "title exists" { Test-Contains $content "# Phase 1 First Entry Frontend Integration Contract" }
Invoke-Check "Document" "Purpose section exists" { Test-Contains $content "## 1. Purpose" }
Invoke-Check "Document" "Current Status section exists" { Test-Contains $content "## 2. Current Status" }

$phases = @(
  "1A Config Foundation",
  "1B Renderer Preview",
  "1C Eligibility",
  "1D CTA Metadata",
  "1E Intent-Aware Preview",
  "1F Dry-Run Integration",
  "1G Safe Agent Test Integration",
  "1H Click Normalization Preview",
  "1I Readiness Gate",
  "1J Closure",
  "1K Guarded Live Smoke Test"
)

foreach ($phase in $phases) {
  Invoke-Check "Phases" ("mentions {0}" -f $phase) { Get-PhaseMentioned $content $phase } $phase
}

$codeLocations = @(
  "backend/src/modules/agent/config/first-entry-config.service.ts",
  "backend/src/modules/agent/config/first-entry-renderer.service.ts",
  "backend/src/modules/agent/config/first-entry-eligibility.service.ts",
  "backend/src/modules/agent/config/first-entry-intent-preview.service.ts",
  "backend/src/modules/agent/config/first-entry-click-normalizer.service.ts",
  "backend/src/modules/agent/config/first-entry-live-smoke.service.ts",
  "backend/src/modules/agent/agent.controller.ts",
  "backend/src/modules/agent/agent.routes.ts",
  "backend/src/modules/agent/agent-action.types.ts",
  "backend/src/modules/whatsapp/cloud/whatsapp-cloud.service.ts",
  "backend/src/config/env.ts"
)

foreach ($path in $codeLocations) {
  Invoke-Check "Code Locations" ("documents {0}" -f $path) { Test-Contains $content $path } $path
}

Invoke-Check "Code Locations" "scripts folder described as tests only" {
  Test-Contains $content "backend/scripts" -and
  Test-Contains $content "test/verifier scripts only" -and
  Test-Contains $content "not customer runtime"
}

Invoke-Check "Pages" "future frontend pages documented" {
  (Test-Contains $content "### Seller Onboarding Page") -and
  (Test-Contains $content "### Product Settings Page") -and
  (Test-Contains $content "### First Entry Settings Page") -and
  (Test-Contains $content "### Delivery Settings Page") -and
  (Test-Contains $content "### Order Settings Page for Phase 2 Later") -and
  (Test-Contains $content "### Live Test / Readiness Page")
}

Invoke-Check "Settings" "seller settings contract table exists" {
  (Test-Contains $content "| Setting | Type | Example | Frontend Control | Backend Meaning | Phase |") -and
  (Test-Contains $content "firstEntry.enabled") -and
  (Test-Contains $content "delivery.mode") -and
  (Test-Contains $content "order.requiredFields")
}

$endpoints = @(
  'GET `/api/agent/config/:sellerId/first-entry-preview`',
  'GET `/api/agent/config/:sellerId/first-entry-eligibility-preview`',
  'POST `/api/agent/config/:sellerId/first-entry-intent-preview`',
  'POST `/api/agent/first-entry-dry-run`',
  'POST `/api/agent/first-entry-click-preview`',
  'GET `/api/agent/first-entry-readiness`',
  'GET `/api/agent/first-entry-live-smoke-readiness`',
  'POST `/api/agent/first-entry-live-smoke-dispatch-preview`',
  'POST `/api/agent/test` with explicit opt-in flags only'
)

foreach ($endpoint in $endpoints) {
  Invoke-Check "Endpoints" ("documents {0}" -f $endpoint) { Test-Contains $content $endpoint } $endpoint
}

Invoke-Check "Preview" "preview flow documented" {
  (Test-Contains $content "## 8. Preview Flow for Frontend") -and
  (Test-Contains $content "No WhatsApp message is sent during preview") -and
  (Test-Contains $content "WhatsApp-like preview")
}

Invoke-Check "Runtime" "WhatsApp runtime flow documented" {
  (Test-Contains $content "## 9. WhatsApp Runtime Flow") -and
  (Test-Contains $content "conversationKey = sellerId +") -and
  (Test-Contains $content "Message 1 text and Message 2 reply buttons") -and
  (Test-Contains $content "firstEntryShown")
}

Invoke-Check "Runtime" "live smoke result documented" {
  (Test-Contains $content "## 10. Current WhatsApp Live Smoke Result") -and
  (Test-Contains $content "Buttons appeared") -and
  (Test-Contains $content "No real order flow started")
}

Invoke-Check "Clicks" "click IDs documented" {
  (Test-Contains $content "first_entry:order_now") -and
  (Test-Contains $content "first_entry:more_info") -and
  (Test-Contains $content "no real order/info routing")
}

Invoke-Check "Safety" "safety rules documented" {
  (Test-Contains $content "## 12. Safety Rules") -and
  (Test-Contains $content "No live send by default") -and
  (Test-Contains $content "No broadcasts") -and
  (Test-Contains $content "No old leads") -and
  (Test-Contains $content "No AI/LLM required for First Entry")
}

$envFlags = @(
  "WHATSAPP_PROVIDER",
  "FIRST_ENTRY_LIVE_SMOKE_ENABLED",
  "FIRST_ENTRY_LIVE_SMOKE_TEST_RECIPIENT",
  "FIRST_ENTRY_LIVE_SMOKE_SELLER_ID",
  "WHATSAPP_INTERACTIVE_LIVE_SEND_ALLOWED",
  "WHATSAPP_CLOUD_DRY_RUN",
  "WHATSAPP_CLOUD_REPLY_BUTTONS_ENABLED",
  "WHATSAPP_INTERACTIVE_CHOICES_ENABLED",
  "WHATSAPP_INTERACTIVE_ENABLED",
  "WHATSAPP_CLOUD_ACCESS_TOKEN",
  "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
  "PUBLIC_BASE_URL"
)

foreach ($flag in $envFlags) {
  Invoke-Check "Env" ("documents {0}" -f $flag) { Test-Contains $content $flag } $flag
}

Invoke-Check "Data Model" "data model notes documented" {
  (Test-Contains $content "## 14. Data Model Notes for Future Database") -and
  (Test-Contains $content "### Seller") -and
  (Test-Contains $content "### Product") -and
  (Test-Contains $content "### FirstEntrySettings") -and
  (Test-Contains $content "### ConversationSession")
}

Invoke-Check "Components" "frontend components documented" {
  (Test-Contains $content "## 15. Frontend Components Suggested") -and
  (Test-Contains $content "WhatsAppPreviewCard") -and
  (Test-Contains $content "FirstEntrySettingsForm") -and
  (Test-Contains $content "LiveSmokeTestPanel")
}

Invoke-Check "Testing" "testing checklist documented" {
  (Test-Contains $content "## 16. Testing Checklist for Future Developers") -and
  (Test-Contains $content "npm run build") -and
  (Test-Contains $content "test-phase-1i-first-entry-readiness-gate.ps1") -and
  (Test-Contains $content "test-phase-1j-first-entry-final-closure.ps1") -and
  (Test-Contains $content "test-phase-1k-first-entry-live-smoke-guard.ps1") -and
  (Test-Contains $content "DELETE") -and
  (Test-Contains $content "sellerId=seller_demo_sandals")
}

Invoke-Check "Known Issues" "known issues documented" {
  (Test-Contains $content "## 17. Known Issues / Remaining Work") -and
  (Test-Contains $content "production activation is not implemented") -and
  (Test-Contains $content "Token was exposed during manual testing")
}

Invoke-Check "Next Phase" "Phase 2 Order Path documented" {
  (Test-Contains $content "## 18. Next Phase") -and
  (Test-Contains $content "Phase 2 - Order Path") -and
  (Test-Contains $content "collect required fields dynamically")
}

Invoke-Check "Secrets" "no raw token patterns included" {
  -not (Test-ContainsAny $content @(
    "EAAG",
    "EAAJ",
    "Authorization: Bearer",
    "access_token=",
    "WHATSAPP_CLOUD_ACCESS_TOKEN="
  ))
}

Invoke-Check "Secrets" "no full real phone number except documented safe test reset" {
  $matches = @([regex]::Matches($content, "\b212\d{9}\b") | ForEach-Object { $_.Value } | Sort-Object -Unique)
  $allowed = @("212600000000", "212690291073")
  $bad = @($matches | Where-Object { $allowed -notcontains $_ })
  $bad.Count -eq 0
} "allowed placeholders: 212600000000, 212690291073"

Invoke-Check "Scripts" "Phase 1I script exists" {
  Test-Path (Join-Path $backendRoot "scripts/test-phase-1i-first-entry-readiness-gate.ps1")
}

Invoke-Check "Scripts" "Phase 1J script exists" {
  Test-Path (Join-Path $backendRoot "scripts/test-phase-1j-first-entry-final-closure.ps1")
}

Invoke-Check "Scripts" "Phase 1K script exists" {
  Test-Path (Join-Path $backendRoot "scripts/test-phase-1k-first-entry-live-smoke-guard.ps1")
}

$failed = @($results | Where-Object { -not $_.Passed })
$passed = $results.Count - $failed.Count
$status = if ($failed.Count -eq 0) { "PASSED" } else { "FAILED" }

Write-Host ""
Write-Host "Phase 1L First Entry Frontend Contract Results:"
$results | Sort-Object Group, CheckName | Format-Table Group, CheckName, Passed, Details, DurationMs -AutoSize
Write-Host ("Total checks: {0}" -f $results.Count)
Write-Host ("Passed: {0}" -f $passed)
Write-Host ("Failed: {0}" -f $failed.Count)
Write-Host ("Acceptance: {0}" -f $status)

if ($failed.Count -gt 0) {
  throw ("Phase 1L contract failed: {0}" -f (($failed | ForEach-Object { "$($_.Group): $($_.CheckName)" }) -join ", "))
}

Write-Host "All Phase 1L first entry frontend contract checks passed."

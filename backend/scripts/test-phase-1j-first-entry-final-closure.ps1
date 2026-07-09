param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendRoot = Split-Path -Parent $scriptDir
$repoRoot = Split-Path -Parent $backendRoot
$closurePath = Join-Path $repoRoot "docs/first-entry-phase-1-closure.md"
$readinessGatePath = Join-Path $scriptDir "test-phase-1i-first-entry-readiness-gate.ps1"
$checks = New-Object System.Collections.Generic.List[object]

function Add-Check {
  param(
    [string]$Group,
    [string]$CheckName,
    [bool]$Passed,
    [string]$Details = "",
    [int]$DurationMs = 0
  )

  $script:checks.Add([PSCustomObject]@{
    Group = $Group
    CheckName = $CheckName
    Passed = $Passed
    Details = $Details
    DurationMs = $DurationMs
  })
}

function Test-ContentIncludes {
  param(
    [string]$Group,
    [string]$CheckName,
    [string]$Content,
    [string]$Expected,
    [int]$DurationMs
  )

  Add-Check $Group $CheckName ($Content.Contains($Expected)) $Expected $DurationMs
}

function Test-ContentPattern {
  param(
    [string]$Group,
    [string]$CheckName,
    [string]$Content,
    [string]$Pattern,
    [int]$DurationMs
  )

  Add-Check $Group $CheckName ([regex]::IsMatch($Content, $Pattern, "IgnoreCase")) $Pattern $DurationMs
}

function Invoke-Phase1JExecutableSafetyScan {
  param(
    [string[]]$Paths
  )

  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $files = @(
    $Paths |
      Where-Object { Test-Path $_ } |
      ForEach-Object { Get-Item $_ } |
      Where-Object { -not $_.PSIsContainer }
  )
  $dangerousPatterns = @(
    "sendMessage\s*\(",
    "graph\.facebook\.com",
    ("Invoke-" + "RestMethod[^\r\n]+(graph|facebook)"),
    ("Invoke-" + "WebRequest[^\r\n]+(graph|facebook)"),
    "media\s+upload",
    "uploadMedia\s*\(",
    ("oll" + "ama"),
    ("op" + "enai"),
    "Authorization:\s*Bearer"
  )
  $regex = $dangerousPatterns -join "|"
  $matches = @()

  if ($files.Count -gt 0) {
    $matches = @(
      $files |
        Select-String -Pattern $regex -CaseSensitive:$false -ErrorAction SilentlyContinue
    )
  }

  $watch.Stop()
  $passed = $matches.Count -eq 0
  $details = if ($passed) {
    "no executable live-send/API/AI patterns across {0} file(s)" -f $files.Count
  } else {
    (($matches | Select-Object -First 5 | ForEach-Object {
      $relativePath = $_.Path

      if ($relativePath.StartsWith($repoRoot)) {
        $relativePath = $relativePath.Substring($repoRoot.Length).TrimStart("\", "/")
      }

      "{0}:{1}: {2}" -f $relativePath, $_.LineNumber, $_.Line.Trim()
    }) -join " | ")
  }

  Add-Check "Safety" "Phase 1J touched files safety scan" $passed $details ([int]$watch.ElapsedMilliseconds)
}

$loadWatch = [System.Diagnostics.Stopwatch]::StartNew()
$documentExists = Test-Path $closurePath
$content = if ($documentExists) {
  Get-Content -Raw -Encoding UTF8 $closurePath
} else {
  ""
}
$loadWatch.Stop()

Add-Check "Document" "closure document exists" $documentExists $closurePath ([int]$loadWatch.ElapsedMilliseconds)

$group = "Document content"
Test-ContentIncludes $group "title present" $content "# Phase 1 First Entry Closure" 0
Test-ContentIncludes $group "preview/test-ready status" $content "completed as preview/test-ready" 0
Test-ContentIncludes $group "not production/live-enabled" $content "not production/live-enabled" 0

$phaseItems = @(
  "1A Config Foundation",
  "1B Renderer Preview",
  "1C Eligibility",
  "1D CTA Metadata",
  "1E Intent-Aware Preview",
  "1F Dry-Run Integration",
  "1G Safe Agent Test Integration",
  "1H Click Normalization Preview",
  "1I Readiness Gate"
)

foreach ($phase in $phaseItems) {
  Test-ContentIncludes $group ("includes {0}" -f $phase) $content $phase 0
}

$endpoints = @(
  "GET /api/agent/config/:sellerId/first-entry-preview",
  "GET /api/agent/config/:sellerId/first-entry-eligibility-preview",
  "POST /api/agent/config/:sellerId/first-entry-intent-preview",
  "POST /api/agent/first-entry-dry-run",
  "POST /api/agent/first-entry-click-preview",
  "GET /api/agent/first-entry-readiness",
  "POST /api/agent/test"
)

foreach ($endpoint in $endpoints) {
  Test-ContentIncludes $group ("lists endpoint {0}" -f $endpoint) $content $endpoint 0
}

$flags = @(
  "enableFirstEntryPreview: true",
  'firstEntryMode: "preview"',
  "enableFirstEntryClickPreview: true",
  'firstEntryClickMode: "preview"'
)

foreach ($flag in $flags) {
  Test-ContentIncludes $group ("lists opt-in flag {0}" -f $flag) $content $flag 0
}

$safetyStatements = @(
  "no live WhatsApp send",
  "no Meta Send API",
  "no AI/LLM",
  "no session mutation in preview paths",
  "no order mutation in preview paths",
  "no media/image send",
  "no CTA live routing",
  'default `/api/agent/test` unchanged without explicit flags'
)

foreach ($statement in $safetyStatements) {
  Test-ContentIncludes $group ("safety statement: {0}" -f $statement) $content $statement 0
}

Test-ContentIncludes $group "readiness label included" $content "ready_for_guarded_test_activation" 0
Test-ContentIncludes $group "liveEnabled false included" $content "liveEnabled: false" 0
Test-ContentIncludes $group "does not mean production readiness" $content "does not mean production readiness" 0
Test-ContentIncludes $group "guarded test activation wording" $content "guarded test activation" 0

$notImplemented = @(
  "First-entry is not automatically shown in live WhatsApp.",
  "CTA clicks are not routed to real order/info flow.",
  "Order path still belongs to Phase 2.",
  "Info path still belongs to Phase 3.",
  "Receipt/PDF belongs to Phase 5.",
  "Production activation is not allowed yet."
)

foreach ($item in $notImplemented) {
  Test-ContentIncludes $group ("not implemented: {0}" -f $item) $content $item 0
}

$commands = @(
  "cd C:\AgentWhatsApp\backend",
  "npm run build",
  "powershell -ExecutionPolicy Bypass -File .\scripts\test-phase-1i-first-entry-readiness-gate.ps1",
  "powershell -ExecutionPolicy Bypass -File .\scripts\test-phase-1i-first-entry-readiness-gate.ps1 -RunSelected0E",
  "powershell -ExecutionPolicy Bypass -File .\scripts\test-phase-1j-first-entry-final-closure.ps1"
)

foreach ($command in $commands) {
  Test-ContentIncludes $group ("verification command: {0}" -f $command) $content $command 0
}

$smokeRules = @(
  "own test number only",
  "own test recipient only",
  "Do not test with real customers.",
  "Do not test with broadcast lists.",
  "Do not test with old leads.",
  'Verify `GET /api/agent/first-entry-readiness` first.',
  "Use existing live guardrails.",
  "Keep rollback command/steps visible",
  "Stop immediately on unexpected send.",
  "Stop immediately on unsafe payload.",
  "Stop immediately on unmasked secret.",
  "Stop immediately on wrong recipient."
)

foreach ($rule in $smokeRules) {
  Test-ContentIncludes $group ("live smoke rule: {0}" -f $rule) $content $rule 0
}

Test-ContentPattern $group "no real access token wording" $content "Do not include secrets.*real access tokens" 0
Test-ContentPattern $group "no real customer phone wording" $content "real customer phone numbers" 0

$group = "Readiness dependency"
Add-Check $group "Phase 1I readiness gate script exists" (Test-Path $readinessGatePath) $readinessGatePath 0
Test-ContentIncludes $group "document instructs running Phase 1I normal gate" $content "test-phase-1i-first-entry-readiness-gate.ps1" 0
Test-ContentIncludes $group "document instructs running Phase 1I selected 0E gate" $content "test-phase-1i-first-entry-readiness-gate.ps1 -RunSelected0E" 0

Invoke-Phase1JExecutableSafetyScan -Paths @(
  $closurePath,
  $MyInvocation.MyCommand.Path
)

$failed = @($checks | Where-Object { -not $_.Passed })
$passed = $checks.Count - $failed.Count

Write-Host "Phase 1J first entry final closure checks:"
$checks | Sort-Object Group, CheckName | Format-Table Group, CheckName, Passed, Details, DurationMs -AutoSize
Write-Host ("Total checks: {0}" -f $checks.Count)
Write-Host ("Passed: {0}" -f $passed)
Write-Host ("Failed: {0}" -f $failed.Count)

if ($failed.Count -gt 0) {
  throw ("Phase 1J closure checks failed: {0}" -f (($failed | ForEach-Object { "$($_.Group): $($_.CheckName)" }) -join ", "))
}

Write-Host "All Phase 1J first entry final closure checks passed."

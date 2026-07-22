param(
  [string]$BaseUrl = "http://localhost:5000"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendRoot = Split-Path -Parent $scriptDir
$repoRoot = Split-Path -Parent $backendRoot
$runbookPath = Join-Path $repoRoot "docs/first-entry-live-smoke-test-runbook.md"
$envExamplePath = Join-Path $backendRoot ".env.example"
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

function Invoke-TimedCommand {
  param(
    [string]$Group,
    [string]$CheckName,
    [string]$WorkingDirectory,
    [scriptblock]$Command
  )

  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $output = ""
  $passed = $false

  try {
    Push-Location $WorkingDirectory
    $output = (& $Command *>&1 | Out-String).Trim()
    $passed = $LASTEXITCODE -eq 0 -or $null -eq $LASTEXITCODE
  } catch {
    $output = $_.Exception.Message
    $passed = $false
  } finally {
    Pop-Location
    $watch.Stop()
  }

  $details = if ($passed) {
    "passed"
  } elseif ($output.Length -gt 260) {
    $output.Substring([Math]::Max(0, $output.Length - 260))
  } else {
    $output
  }

  Add-Result $Group $CheckName $passed $details ([int]$watch.ElapsedMilliseconds)
}

function Invoke-TimedJson {
  param(
    [ValidateSet("GET", "POST")]
    [string]$Method,
    [string]$Uri,
    [object]$Body = $null
  )

  $watch = [System.Diagnostics.Stopwatch]::StartNew()

  try {
    if ($null -eq $Body) {
      $response = Invoke-RestMethod -Method $Method -Uri $Uri
    } else {
      $json = $Body | ConvertTo-Json -Depth 100
      $utf8Body = [System.Text.Encoding]::UTF8.GetBytes($json)
      $response = Invoke-RestMethod -Method $Method -Uri $Uri -ContentType "application/json; charset=utf-8" -Body $utf8Body
    }

    $watch.Stop()

    return [PSCustomObject]@{
      Ok = $true
      Response = $response
      Error = ""
      DurationMs = [int]$watch.ElapsedMilliseconds
    }
  } catch {
    $watch.Stop()

    return [PSCustomObject]@{
      Ok = $false
      Response = $null
      Error = $_.Exception.Message
      DurationMs = [int]$watch.ElapsedMilliseconds
    }
  }
}

function Test-ContentIncludes {
  param(
    [string]$Group,
    [string]$CheckName,
    [string]$Content,
    [string]$Expected
  )

  Add-Result $Group $CheckName ($Content.Contains($Expected)) $Expected
}

function Get-SafetyScanFiles {
  $patterns = @(
    "src/modules/agent/config/first-entry-live-smoke.service.ts",
    "src/modules/agent/agent.controller.ts",
    "src/modules/agent/agent.routes.ts",
    "scripts/test-phase-1k-first-entry-live-smoke-guard.ps1"
  )
  $files = New-Object System.Collections.Generic.List[object]

  foreach ($pattern in $patterns) {
    $fullPattern = Join-Path $backendRoot $pattern
    $resolved = @(
      Get-ChildItem -Path $fullPattern -File -ErrorAction SilentlyContinue
    )

    foreach ($file in $resolved) {
      $files.Add($file)
    }
  }

  return @($files | Sort-Object FullName -Unique)
}

function Invoke-Phase1KSafetyScan {
  $dangerousPattern = @(
    ("send" + "Message"),
    ("graph" + "\.facebook" + "\.com"),
    ("Meta" + " Send"),
    ("Cloud" + " API"),
    ("live" + " dispatch"),
    ("whatsapp" + "\.[^\r\n]*" + "send"),
    ("image" + " send"),
    ("media" + " send"),
    ("oll" + "ama"),
    ("op" + "enai"),
    ("Authorization" + ":\s*Bearer"),
    ("\bbroad" + "casts?\b"),
    ("old\s+" + "leads"),
    ("real\s+customers?")
  ) -join "|"
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $files = Get-SafetyScanFiles
  $matches = @()

  if ($files.Count -gt 0) {
    $matches = @(
      $files |
        Select-String -Pattern $dangerousPattern -CaseSensitive:$false -ErrorAction SilentlyContinue
    )
  }

  $watch.Stop()

  $passed = $matches.Count -eq 0
  $details = if ($passed) {
    "no forbidden executable patterns across {0} file(s)" -f $files.Count
  } else {
    (($matches | Select-Object -First 8 | ForEach-Object {
      $relativePath = $_.Path

      if ($relativePath.StartsWith($repoRoot)) {
        $relativePath = $relativePath.Substring($repoRoot.Length).TrimStart("\", "/")
      }

      "{0}:{1}: {2}" -f $relativePath, $_.LineNumber, $_.Line.Trim()
    }) -join " | ")
  }

  Add-Result "Safety" "Phase 1K safety scan" $passed $details ([int]$watch.ElapsedMilliseconds)

  $cloudServicePath = Join-Path $backendRoot "src/modules/whatsapp/cloud/whatsapp-cloud.service.ts"
  $cloudService = if (Test-Path $cloudServicePath) {
    Get-Content -Raw -Encoding UTF8 $cloudServicePath
  } else {
    ""
  }

  Add-Result "Safety" "Cloud hook uses guarded dispatcher" (
    $cloudService.Contains("buildFirstEntryLiveSmokeResult") -and
    $cloudService.Contains("sendAgentCloudResult") -and
    $cloudService.Contains("markFirstEntryLiveSmokeShown")
  ) "first-entry hook dispatches through existing guarded path"
  Add-Result "Runtime CTA Routing" "Cloud webhook activates guarded runtime only through smoke readiness" (
    $cloudService.Contains("guardedRuntimeLiveSmokeActivation") -and
    $cloudService.Contains("orderRuntimeEnabled: guardedRuntimeLiveSmokeActivation") -and
    $cloudService.Contains("firstEntryLiveSmoke.readiness.ready === true") -and
    $cloudService.Contains("firstEntryLiveSmoke.readiness.recipientAllowed === true")
  ) "runtime activation remains tied to the configured seller and allowlisted smoke recipient"
  Add-Result "Safety" "Cloud webhook blocks unscoped dispatch while smoke mode is armed" (
    $cloudService.Contains("liveSmokeDispatchAllowed") -and
    $cloudService.Contains("env.whatsappInteractiveEnabled === true") -and
    $cloudService.Contains("whatsapp.cloud.live_smoke.scope_blocked") -and
    $cloudService.Contains("processResult.sendAttempted = false") -and
    $cloudService.Contains("processResult.sendSuccess = false")
  ) "unrelated seller/recipient webhook messages do not reach Cloud dispatch during an armed smoke test"

  $firstEntryServicePath = Join-Path $backendRoot "src/modules/agent/config/first-entry-live-smoke.service.ts"
  $firstEntryService = if (Test-Path $firstEntryServicePath) {
    Get-Content -Raw -Encoding UTF8 $firstEntryServicePath
  } else {
    ""
  }

  Add-Result "Runtime CTA Routing" "implemented CTA clicks are released to AgentService" (
    $firstEntryService.Contains("first_entry_order_click_routes_to_phase_2a_order_path") -and
    $firstEntryService.Contains("first_entry_info_click_routes_to_phase_3a_info_path")
  ) "order -> Phase 2A; info -> Phase 3A"
  Add-Result "Runtime CTA Routing" "obsolete Phase 3 info blocker removed" (
    -not $firstEntryService.Contains("first_entry_click_preview_blocked") -and
    -not $firstEntryService.Contains("هاد الزر ديال المعلومات باقي غادي يتفعل في Phase 3")
  ) "no runtime blocked AgentResult remains"

  $badDispatchImports = @(
    Get-ChildItem -Path (Join-Path $backendRoot "src") -Recurse -File -Filter "*.ts" -ErrorAction SilentlyContinue |
      Select-String -Pattern "cloud-reply-dispatch\.service\.js" -CaseSensitive:$false -ErrorAction SilentlyContinue
  )
  $badImportDetails = if ($badDispatchImports.Count -eq 0) {
    "no .js cloud dispatch import in TypeScript source"
  } else {
    (($badDispatchImports | Select-Object -First 5 | ForEach-Object {
      $relativePath = $_.Path

      if ($relativePath.StartsWith($repoRoot)) {
        $relativePath = $relativePath.Substring($repoRoot.Length).TrimStart("\", "/")
      }

      "{0}:{1}: {2}" -f $relativePath, $_.LineNumber, $_.Line.Trim()
    }) -join " | ")
  }

  Add-Result "Safety" "no .js cloud dispatcher source import" ($badDispatchImports.Count -eq 0) $badImportDetails
}

function Test-EnvDefaults {
  $content = if (Test-Path $envExamplePath) {
    Get-Content -Raw -Encoding UTF8 $envExamplePath
  } else {
    ""
  }

  Add-Result "Env" ".env.example exists" (Test-Path $envExamplePath) $envExamplePath
  Test-ContentIncludes "Env" "live smoke disabled by default" $content "FIRST_ENTRY_LIVE_SMOKE_ENABLED=false"
  Test-ContentIncludes "Env" "test recipient placeholder present" $content "FIRST_ENTRY_LIVE_SMOKE_TEST_RECIPIENT=212600000000"
  Test-ContentIncludes "Env" "seller id present" $content "FIRST_ENTRY_LIVE_SMOKE_SELLER_ID=seller_demo_sandals"
}

function Test-ReadinessEndpoint {
  $uri = "{0}/api/agent/first-entry-live-smoke-readiness?testRecipientPhone=212600000000&sellerId=seller_demo_sandals" -f $BaseUrl
  $timed = Invoke-TimedJson -Method GET -Uri $uri
  $response = $timed.Response
  $serialized = if ($null -ne $response) { $response | ConvertTo-Json -Depth 100 } else { "" }
  $checks = $response.checks
  $allReadyChecks =
    $timed.Ok -and
    $checks.whatsappProviderCloudApi -eq $true -and
    $checks.explicitLiveSmokeFlagEnabled -eq $true -and
    $checks.cloudLiveSendGuardEnabled -eq $true -and
    $checks.cloudDryRunDisabled -eq $true -and
    $checks.recipientExactlyAllowlisted -eq $true -and
    $checks.sellerIdConfigured -eq $true

  Add-Result "Readiness" "endpoint reachable" $timed.Ok $timed.Error $timed.DurationMs
  Add-Result "Readiness" "mode guarded live smoke only" ($timed.Ok -and $response.mode -eq "guarded_live_smoke_test_only") "$($response.mode)" $timed.DurationMs
  Add-Result "Readiness" "no provider payload" (
    -not $serialized.Contains("messaging_product") -and
    -not $serialized.Contains("interactiveResult") -and
    -not $serialized.Contains("dispatchResult")
  ) "" $timed.DurationMs
  Add-Result "Readiness" "no secrets exposed" (
    -not $serialized.Contains("access_token") -and
    -not $serialized.Contains("Authorization") -and
    -not $serialized.Contains("EAAG") -and
    -not $serialized.Contains("appSecret")
  ) "" $timed.DurationMs
  Add-Result "Readiness" "ready only when every guard is true" (
    $timed.Ok -and $response.ready -eq $allReadyChecks
  ) ("ready={0}" -f $response.ready) $timed.DurationMs
  Add-Result "Readiness" "safety flags present" (
    $timed.Ok -and
    $response.noBroadcast -eq $true -and
    $response.notProductionReady -eq $true
  ) "" $timed.DurationMs

  $wrong = Invoke-TimedJson -Method GET -Uri ("{0}/api/agent/first-entry-live-smoke-readiness?testRecipientPhone=212699999999&sellerId=seller_demo_sandals" -f $BaseUrl)
  Add-Result "Readiness" "wrong recipient blocked" (
    $wrong.Ok -and
    $wrong.Response.ready -eq $false -and
    $wrong.Response.recipientAllowed -eq $false
  ) ("ready={0}; recipientAllowed={1}" -f $wrong.Response.ready, $wrong.Response.recipientAllowed) $wrong.DurationMs

  $missing = Invoke-TimedJson -Method GET -Uri ("{0}/api/agent/first-entry-live-smoke-readiness" -f $BaseUrl)
  Add-Result "Readiness" "missing recipient blocked" (
    $missing.Ok -and
    $missing.Response.ready -eq $false -and
    $missing.Response.recipientAllowed -eq $false
  ) ("ready={0}; recipientAllowed={1}" -f $missing.Response.ready, $missing.Response.recipientAllowed) $missing.DurationMs
}

function Test-PreviewAndClickGuards {
  $preview = Invoke-TimedJson -Method POST -Uri ("{0}/api/agent/test" -f $BaseUrl) -Body @{
    sellerId = "seller_demo_sandals"
    customerPhone = "212600000000"
    message = "سلام"
    enableFirstEntryPreview = $true
  }

  Add-Result "First Entry Preview" "explicit preview still works" (
    $preview.Ok -and
    $preview.Response.handledBy -eq "first_entry_agent_test" -and
    $preview.Response.previewOnly -eq $true
  ) "$($preview.Response.handledBy)" $preview.DurationMs
  Add-Result "First Entry Preview" "preview has no actions" (
    $preview.Ok -and @($preview.Response.actions).Count -eq 0
  ) "actions=$(@($preview.Response.actions).Count)" $preview.DurationMs

  $dispatchPreview = Invoke-TimedJson -Method POST -Uri ("{0}/api/agent/first-entry-live-smoke-dispatch-preview" -f $BaseUrl) -Body @{
    sellerId = "seller_demo_sandals"
    customerPhone = "212600000000"
    message = "سلام"
    interactiveEnabledOverride = $true
  }
  $ctaIds = @($dispatchPreview.Response.ctas.items | ForEach-Object { $_.id })
  $ctaLabels = @($dispatchPreview.Response.ctas.items | ForEach-Object { $_.label })
  $buttonIds = @(
    $dispatchPreview.Response.whatsappInteractivePreview.interactive.action.buttons |
      ForEach-Object { $_.reply.id }
  )
  $messages = @($dispatchPreview.Response.messages)
  $firstMessage = if ($messages.Count -gt 0) { $messages[0] } else { $null }
  $secondMessage = if ($messages.Count -gt 1) { $messages[1] } else { $null }
  $secondButtonIds = @($secondMessage.buttons | ForEach-Object { $_.id })
  $secondButtonLabels = @($secondMessage.buttons | ForEach-Object { $_.label })
  $oldCtaQuestion = "واش بغيتي دير الطلب دابا ولا تشوف معلومات أكثر؟"

  Add-Result "First Entry Buttons" "dispatch preview reachable" $dispatchPreview.Ok $dispatchPreview.Error $dispatchPreview.DurationMs
  Add-Result "First Entry Buttons" "presentation mode splits info and CTA" (
    $dispatchPreview.Ok -and
    $dispatchPreview.Response.presentationMode -eq "split_info_and_cta"
  ) "$($dispatchPreview.Response.presentationMode)" $dispatchPreview.DurationMs
  Add-Result "First Entry Buttons" "dispatch preview has two messages" (
    $dispatchPreview.Ok -and $messages.Count -eq 2
  ) "count=$($messages.Count)" $dispatchPreview.DurationMs
  Add-Result "First Entry Buttons" "first message is text only" (
    $dispatchPreview.Ok -and
    $firstMessage.kind -eq "text" -and
    $null -eq $firstMessage.buttons
  ) "$($firstMessage.kind)" $dispatchPreview.DurationMs
  Add-Result "First Entry Buttons" "first message includes product info" (
    $dispatchPreview.Ok -and
    $firstMessage.text.Contains("صندالة نسائية متوفرة دابا بـ199 درهم،") -and
    $firstMessage.text.Contains("والتوصيل متوفر لجميع المدن")
  ) ($firstMessage.text -replace "`r?`n", " | ") $dispatchPreview.DurationMs
  Add-Result "First Entry Buttons" "first message excludes old CTA question" (
    $dispatchPreview.Ok -and
    -not $firstMessage.text.Contains($oldCtaQuestion)
  ) "" $dispatchPreview.DurationMs
  Add-Result "First Entry Buttons" "second message is interactive buttons" (
    $dispatchPreview.Ok -and
    $secondMessage.kind -eq "interactive_buttons" -and
    @($secondMessage.buttons).Count -ge 1
  ) "$($secondMessage.kind)" $dispatchPreview.DurationMs
  Add-Result "First Entry Buttons" "second message is short CTA question" (
    $dispatchPreview.Ok -and
    $secondMessage.text -eq "شنو بغيتي دابا: دير الطلب ✅ ولا تعرف المزيد من المعلومات على المنتج؟"
  ) "$($secondMessage.text)" $dispatchPreview.DurationMs
  Add-Result "First Entry Buttons" "CTA metadata includes order and info" (
    $dispatchPreview.Ok -and
    $ctaIds -contains "first_entry:order_now" -and
    $ctaIds -contains "first_entry:more_info"
  ) ($ctaIds -join ", ") $dispatchPreview.DurationMs
  Add-Result "First Entry Buttons" "CTA labels are customer-facing" (
    $dispatchPreview.Ok -and
    $ctaLabels -contains "أطلب الآن" -and
    $ctaLabels -contains "المزيد من المعلومات"
  ) ($ctaLabels -join ", ") $dispatchPreview.DurationMs
  Add-Result "First Entry Buttons" "second message includes CTA ids" (
    $dispatchPreview.Ok -and
    $secondButtonIds -contains "first_entry:order_now" -and
    $secondButtonIds -contains "first_entry:more_info"
  ) ($secondButtonIds -join ", ") $dispatchPreview.DurationMs
  Add-Result "First Entry Buttons" "second message includes CTA labels" (
    $dispatchPreview.Ok -and
    $secondButtonLabels -contains "أطلب الآن" -and
    $secondButtonLabels -contains "المزيد من المعلومات"
  ) ($secondButtonLabels -join ", ") $dispatchPreview.DurationMs
  Add-Result "First Entry Buttons" "uiHints request buttons" (
    $dispatchPreview.Ok -and
    $dispatchPreview.Response.uiHints.preferred -eq "buttons" -and
    $dispatchPreview.Response.replyUi.kind -eq "buttons"
  ) ("preferred={0}; kind={1}" -f $dispatchPreview.Response.uiHints.preferred, $dispatchPreview.Response.replyUi.kind) $dispatchPreview.DurationMs
  Add-Result "First Entry Buttons" "Cloud preview is button interactive" (
    $dispatchPreview.Ok -and
    $dispatchPreview.Response.whatsappInteractivePreview.type -eq "interactive" -and
    $dispatchPreview.Response.whatsappInteractivePreview.interactive.type -eq "button" -and
    $dispatchPreview.Response.whatsappInteractivePreview.interactive.body.text -eq "شنو بغيتي دابا: دير الطلب ✅ ولا تعرف المزيد من المعلومات على المنتج؟" -and
    $buttonIds -contains "first_entry:order_now" -and
    $buttonIds -contains "first_entry:more_info"
  ) ($buttonIds -join ", ") $dispatchPreview.DurationMs
  Add-Result "First Entry Buttons" "send decision stays interactive when enabled" (
    $dispatchPreview.Ok -and
    $dispatchPreview.Response.interactiveSendDecision.mode -eq "interactive_preview" -and
    $dispatchPreview.Response.interactiveSendDecision.reason -eq "preview_available"
  ) ("mode={0}; reason={1}" -f $dispatchPreview.Response.interactiveSendDecision.mode, $dispatchPreview.Response.interactiveSendDecision.reason) $dispatchPreview.DurationMs

  $click = Invoke-TimedJson -Method POST -Uri ("{0}/api/agent/test" -f $BaseUrl) -Body @{
    sellerId = "seller_demo_sandals"
    customerPhone = "212600000000"
    message = "first_entry:order_now"
    enableFirstEntryClickPreview = $true
  }

  Add-Result "First Entry Click Preview" "explicit preview endpoint stays preview only" (
    $click.Ok -and
    $click.Response.handledBy -eq "first_entry_click_preview" -and
    $click.Response.safety.noLiveRouting -eq $true
  ) "$($click.Response.firstEntryClick.recommendedNextStep)" $click.DurationMs
  Add-Result "First Entry Click Preview" "explicit preview endpoint does not mutate runtime" (
    $click.Ok -and
    $click.Response.reply -eq "" -and
    @($click.Response.actions).Count -eq 0
  ) "" $click.DurationMs
}

function Test-Runbook {
  $content = if (Test-Path $runbookPath) {
    Get-Content -Raw -Encoding UTF8 $runbookPath
  } else {
    ""
  }

  Add-Result "Runbook" "runbook exists" (Test-Path $runbookPath) $runbookPath

  $sections = @(
    "## Purpose",
    "## Safe Defaults",
    "## Required Env Flags",
    "## Own Test Recipient Only",
    "## Pre-Flight Readiness Command",
    "## Exact Backend Start Command",
    "## Exact Manual WhatsApp Messages",
    "## Expected Results",
    "## What Must NOT Happen",
    "## Rollback Steps",
    "## Stop Conditions",
    "## Evidence To Capture",
    "## Next Phase Dependency"
  )

  foreach ($section in $sections) {
    Test-ContentIncludes "Runbook" ("section {0}" -f $section) $content $section
  }

  Test-ContentIncludes "Runbook" ("forbids real " + "customers") $content ("Real " + "customers")
  Test-ContentIncludes "Runbook" ("forbids broad" + "casts") $content ("Broad" + "casts")
  Test-ContentIncludes "Runbook" ("forbids old " + "leads") $content ("Old " + "leads")
  Test-ContentIncludes "Runbook" "requires readiness" $content 'If `ready=false`, stop. Do not send.'
  Test-ContentIncludes "Runbook" "rollback disables flag" $content "FIRST_ENTRY_LIVE_SMOKE_ENABLED=false"
  Test-ContentIncludes "Runbook" "correct session reset endpoint" $content "/api/agent/session/212690291073?sellerId=seller_demo_sandals"
  Test-ContentIncludes "Runbook" "button dispatch preview endpoint documented" $content "/api/agent/first-entry-live-smoke-dispatch-preview"
  Test-ContentIncludes "Runbook" "reply button flag documented" $content "WHATSAPP_CLOUD_REPLY_BUTTONS_ENABLED=true"
  Test-ContentIncludes "Runbook" "choice flag documented" $content "WHATSAPP_INTERACTIVE_CHOICES_ENABLED=true"
  Test-ContentIncludes "Runbook" "documents two-message presentation" $content "The First Entry presentation is sent as two messages."
  Test-ContentIncludes "Runbook" "documents first text message" $content "Message 1 is a text-only product/commercial info message."
  Test-ContentIncludes "Runbook" "documents second button message" $content "Message 2 is a short CTA question with WhatsApp reply buttons."
  Test-ContentIncludes "Runbook" "documents short CTA question" $content "شنو بغيتي ندير دابا؟"
  Add-Result "Runbook" "warns against seller-prefixed session delete" (
    $content.Contains('Do not delete `/api/agent/session/seller_demo_sandals:212690291073`')
  ) "delete by phone path plus sellerId query"
}

Write-Host "Phase 1K First Entry Live Smoke Guard"
Write-Host ("Backend root: {0}" -f $backendRoot)
Write-Host ("Base URL: {0}" -f $BaseUrl)

Invoke-TimedCommand -Group "Build" -CheckName "npm run build passed" -WorkingDirectory $backendRoot -Command {
  npm run build
}

Invoke-TimedCommand -Group "Runtime" -CheckName "Cloud service loads in TS runtime" -WorkingDirectory $backendRoot -Command {
  node -r ts-node/register/transpile-only -e "require('./src/modules/whatsapp/cloud/whatsapp-cloud.service.ts'); console.log('cloud service loaded')"
}

Invoke-TimedCommand -Group "Dependencies" -CheckName "Phase 1I normal gate passed" -WorkingDirectory $backendRoot -Command {
  powershell -ExecutionPolicy Bypass -File (Join-Path $scriptDir "test-phase-1i-first-entry-readiness-gate.ps1") -BaseUrl $BaseUrl
}

Invoke-TimedCommand -Group "Dependencies" -CheckName "Phase 1J closure passed" -WorkingDirectory $backendRoot -Command {
  powershell -ExecutionPolicy Bypass -File (Join-Path $scriptDir "test-phase-1j-first-entry-final-closure.ps1")
}

Test-EnvDefaults
Test-ReadinessEndpoint
Test-PreviewAndClickGuards
Test-Runbook
Invoke-Phase1KSafetyScan

$failed = @($results | Where-Object { -not $_.Passed })
$passed = $results.Count - $failed.Count
$status = if ($failed.Count -eq 0) { "PASSED" } else { "FAILED" }

Write-Host ""
Write-Host "Phase 1K First Entry Live Smoke Guard Results:"
$results | Sort-Object Group, CheckName | Format-Table Group, CheckName, Passed, Details, DurationMs -AutoSize
Write-Host ("Total checks: {0}" -f $results.Count)
Write-Host ("Passed: {0}" -f $passed)
Write-Host ("Failed: {0}" -f $failed.Count)
Write-Host ("Acceptance: {0}" -f $status)

if ($failed.Count -gt 0) {
  throw ("Phase 1K guard failed: {0}" -f (($failed | ForEach-Object { "$($_.Group): $($_.CheckName)" }) -join ", "))
}

Write-Host "All Phase 1K first entry live smoke guard checks passed."

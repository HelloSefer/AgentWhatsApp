param(
  [string]$BaseUrl = "http://localhost:5000",
  [switch]$RunSelected0E
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendRoot = Split-Path -Parent $scriptDir
$repoRoot = Split-Path -Parent $backendRoot
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
  } elseif ($output.Length -gt 220) {
    $output.Substring([Math]::Max(0, $output.Length - 220))
  } else {
    $output
  }

  Add-Result $Group $CheckName $passed $details ([int]$watch.ElapsedMilliseconds)

  return [PSCustomObject]@{
    Passed = $passed
    Output = $output
    DurationMs = [int]$watch.ElapsedMilliseconds
  }
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

function Invoke-PhaseScript {
  param(
    [string]$PhaseName,
    [string]$ScriptName
  )

  $scriptPath = Join-Path $scriptDir $ScriptName
  $exists = Test-Path $scriptPath
  Add-Result "Phase scripts" ("{0} script exists" -f $PhaseName) $exists $scriptPath

  if (-not $exists) {
    return
  }

  [void](Invoke-TimedCommand -Group "Phase scripts" -CheckName ("{0} passed" -f $PhaseName) -WorkingDirectory $backendRoot -Command {
    powershell -ExecutionPolicy Bypass -File $scriptPath -BaseUrl $BaseUrl
  })
}

function Get-SafetyScanFiles {
  param(
    [string[]]$Patterns
  )

  $files = New-Object System.Collections.Generic.List[object]
  $missingPatterns = New-Object System.Collections.Generic.List[string]

  foreach ($pattern in $Patterns) {
    $fullPattern = Join-Path $backendRoot $pattern
    $resolved = @(
      Get-ChildItem -Path $fullPattern -ErrorAction SilentlyContinue |
        Where-Object { -not $_.PSIsContainer }
    )

    if ($resolved.Count -eq 0) {
      $missingPatterns.Add($pattern)
      continue
    }

    foreach ($file in $resolved) {
      $files.Add($file)
    }
  }

  $uniqueFiles = @(
    $files |
      Sort-Object FullName -Unique
  )

  return [PSCustomObject]@{
    Files = $uniqueFiles
    MissingPatterns = @($missingPatterns)
  }
}

function Invoke-Phase1SafetyScan {
  $targetPatterns = @(
    "src/modules/agent/config/first-entry-*.ts",
    "src/modules/agent/agent.controller.ts",
    "src/modules/agent/agent.routes.ts",
    "src/modules/agent/reply/*.ts",
    "scripts/test-phase-1*.ps1"
  )
  $pattern = @(
    "sendMes" + "sage",
    "graph" + "\.facebook" + "\.com",
    "Meta" + " Send",
    "Cloud" + " API",
    "live" + " dispatch",
    "whatsapp" + " send",
    "image" + " send",
    "media" + " send",
    "oll" + "ama",
    "op" + "enai"
  ) -join "|"
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $scan = Get-SafetyScanFiles -Patterns $targetPatterns
  $matches = @()

  if ($scan.Files.Count -gt 0) {
    $matches = @(
      $scan.Files |
        Select-String -Pattern $pattern -CaseSensitive:$false -ErrorAction SilentlyContinue
    )
  }

  $watch.Stop()

  $passed = $matches.Count -eq 0
  $details = if ($passed) {
    $missingText = if ($scan.MissingPatterns.Count -gt 0) {
      "; skipped missing globs: {0}" -f ($scan.MissingPatterns -join ", ")
    } else {
      ""
    }

    "no forbidden first-entry matches across {0} file(s){1}" -f $scan.Files.Count, $missingText
  } else {
    (($matches | Select-Object -First 5 | ForEach-Object {
      $relativePath = $_.Path

      if ($relativePath.StartsWith($backendRoot)) {
        $relativePath = $relativePath.Substring($backendRoot.Length).TrimStart("\", "/")
      }

      "{0}:{1}: {2}" -f $relativePath, $_.LineNumber, $_.Line.Trim()
    }) -join " | ")
  }

  Add-Result "Safety" "safety grep passed" $passed $details ([int]$watch.ElapsedMilliseconds)
}

function Add-GitContext {
  Push-Location $repoRoot
  $branch = (git branch --show-current 2>$null | Out-String).Trim()
  $commit = (git log -1 --oneline 2>$null | Out-String).Trim()
  $status = (git status --short 2>$null | Out-String).Trim()
  Pop-Location

  Add-Result "Git" "branch visible" ([bool]$branch) $branch
  Add-Result "Git" "recent commit visible" ([bool]$commit) $commit
  Add-Result "Git" "working tree status captured" $true ($(if ($status) { $status.Replace("`r`n", " | ").Replace("`n", " | ") } else { "clean" }))
}

function Test-ReadinessEndpoint {
  $timed = Invoke-TimedJson -Method GET -Uri ("{0}/api/agent/first-entry-readiness" -f $BaseUrl)
  $response = $timed.Response
  $serialized = if ($null -ne $response) { $response | ConvertTo-Json -Depth 100 } else { "" }

  Add-Result "Readiness endpoint" "endpoint reachable" $timed.Ok $timed.Error $timed.DurationMs
  Add-Result "Readiness endpoint" "ok true" ($timed.Ok -and $response.ok -eq $true) "$($response.ok)" $timed.DurationMs
  Add-Result "Readiness endpoint" "previewOnly true" ($timed.Ok -and $response.previewOnly -eq $true) "$($response.previewOnly)" $timed.DurationMs
  Add-Result "Readiness endpoint" "liveEnabled false" ($timed.Ok -and $response.liveEnabled -eq $false) "$($response.liveEnabled)" $timed.DurationMs
  Add-Result "Readiness endpoint" "readiness label safe" ($timed.Ok -and $response.readiness -eq "ready_for_guarded_test_activation") "$($response.readiness)" $timed.DurationMs
  Add-Result "Readiness endpoint" "does not expose secrets" (
    -not $serialized.Contains("access_token") -and
    -not $serialized.Contains("Authorization") -and
    -not $serialized.Contains("EAAG") -and
    -not $serialized.Contains("secret")
  ) "" $timed.DurationMs
  Add-Result "Readiness endpoint" "does not include provider payload" (
    -not $serialized.Contains("messaging_product") -and
    -not $serialized.Contains("dispatchResult") -and
    -not $serialized.Contains("interactiveResult")
  ) "" $timed.DurationMs
}

function Test-DirectGuardChecks {
  $default = Invoke-TimedJson -Method POST -Uri ("{0}/api/agent/test" -f $BaseUrl) -Body @{
    sellerId = "seller_demo_sandals"
    customerPhone = "0612345901"
    message = "سلام"
  }

  Add-Result "Direct guards" "default agent test reachable" $default.Ok $default.Error $default.DurationMs
  Add-Result "Direct guards" "default agent behavior protected" (
    $default.Ok -and
    $null -eq $default.Response.firstEntry -and
    $null -eq $default.Response.firstEntryClick -and
    $default.Response.previewOnly -ne $true
  ) "" $default.DurationMs

  $firstEntry = Invoke-TimedJson -Method POST -Uri ("{0}/api/agent/test" -f $BaseUrl) -Body @{
    sellerId = "seller_demo_sandals"
    customerPhone = "0612345902"
    message = "سلام"
    enableFirstEntryPreview = $true
  }

  Add-Result "Direct guards" "first-entry explicit opt-in works" (
    $firstEntry.Ok -and
    $firstEntry.Response.handledBy -eq "first_entry_agent_test" -and
    $firstEntry.Response.previewOnly -eq $true
  ) "$($firstEntry.Response.handledBy)" $firstEntry.DurationMs

  $click = Invoke-TimedJson -Method POST -Uri ("{0}/api/agent/test" -f $BaseUrl) -Body @{
    sellerId = "seller_demo_sandals"
    customerPhone = "0612345903"
    message = "first_entry:order_now"
    enableFirstEntryClickPreview = $true
  }

  Add-Result "Direct guards" "click normalization preview-only" (
    $click.Ok -and
    $click.Response.handledBy -eq "first_entry_click_preview" -and
    $click.Response.firstEntryClick.normalizedId -eq "first_entry:order_now" -and
    $click.Response.safety.noLiveRouting -eq $true
  ) "$($click.Response.firstEntryClick.recommendedNextStep)" $click.DurationMs
  Add-Result "Direct guards" "click does not route order or info" (
    $click.Ok -and
    $click.Response.reply -eq "" -and
    @($click.Response.actions).Count -eq 0
  ) "actions=$(@($click.Response.actions).Count)" $click.DurationMs

  $media = Invoke-TimedJson -Method POST -Uri ("{0}/api/agent/test" -f $BaseUrl) -Body @{
    sellerId = "seller_demo_sandals"
    customerPhone = "0612345904"
    message = "بغيت الصور"
    enableFirstEntryPreview = $true
  }

  Add-Result "Direct guards" "media preview sends no media" (
    $media.Ok -and
    $media.Response.firstEntry.intent.intent -eq "media" -and
    @($media.Response.actions).Count -eq 0 -and
    $media.Response.safety.noLiveSend -eq $true
  ) "actions=$(@($media.Response.actions).Count)" $media.DurationMs
}

function Test-Selected0EAvailability {
  $scripts = @(
    "test-phase-0e-c2-a-cloud-interactive-method.ps1",
    "test-phase-0e-c2-b1-cloud-reply-dispatch.ps1",
    "test-phase-0e-c2-b2-cloud-dispatch-wiring.ps1",
    "test-phase-0e-c2-b3-real-send-guardrails.ps1",
    "test-phase-0e-c2-b4-live-interactive-readiness.ps1",
    "test-phase-0e-c2-b5-live-interactive-runbook.ps1",
    "test-phase-0e-c2-c1-interactive-reply-normalizer.ps1",
    "test-phase-0e-c2-c2-interactive-order-flow.ps1",
    "test-phase-0e-c2-c3-final-cloud-interactive-safety.ps1"
  )

  foreach ($script in $scripts) {
    Add-Result "Selected 0E" ("available: {0}" -f $script) (Test-Path (Join-Path $scriptDir $script)) $script
  }

  if (-not $RunSelected0E) {
    return
  }

  foreach ($script in $scripts) {
    $scriptPath = Join-Path $scriptDir $script
    if (-not (Test-Path $scriptPath)) {
      continue
    }

    $workingDirectory = if ($script -eq "test-phase-0e-c2-b5-live-interactive-runbook.ps1") {
      $repoRoot
    } else {
      $backendRoot
    }
    $pathForCommand = if ($script -eq "test-phase-0e-c2-b5-live-interactive-runbook.ps1") {
      Join-Path "backend/scripts" $script
    } else {
      $scriptPath
    }

    [void](Invoke-TimedCommand -Group "Selected 0E" -CheckName ("run: {0}" -f $script) -WorkingDirectory $workingDirectory -Command {
      powershell -ExecutionPolicy Bypass -File $pathForCommand -BaseUrl $BaseUrl
    })
  }
}

Write-Host "Phase 1I First Entry Readiness Gate"
Write-Host ("Backend root: {0}" -f $backendRoot)
Write-Host ("Base URL: {0}" -f $BaseUrl)

[void](Invoke-TimedCommand -Group "Build" -CheckName "npm run build passed" -WorkingDirectory $backendRoot -Command {
  npm run build
})

$health = Invoke-TimedJson -Method GET -Uri ("{0}/health" -f $BaseUrl)
Add-Result "API" "backend health reachable" $health.Ok $health.Error $health.DurationMs

$phaseScripts = @(
  @{ Name = "Phase 1A"; Script = "test-phase-1a-first-entry-config.ps1" },
  @{ Name = "Phase 1B"; Script = "test-phase-1b-first-entry-renderer.ps1" },
  @{ Name = "Phase 1C"; Script = "test-phase-1c-first-entry-eligibility.ps1" },
  @{ Name = "Phase 1D"; Script = "test-phase-1d-first-entry-cta-preview.ps1" },
  @{ Name = "Phase 1E"; Script = "test-phase-1e-first-entry-intent-preview.ps1" },
  @{ Name = "Phase 1F"; Script = "test-phase-1f-first-entry-dry-run-integration.ps1" },
  @{ Name = "Phase 1G"; Script = "test-phase-1g-first-entry-agent-test-integration.ps1" },
  @{ Name = "Phase 1H"; Script = "test-phase-1h-first-entry-click-normalization-preview.ps1" }
)

foreach ($phase in $phaseScripts) {
  Invoke-PhaseScript -PhaseName $phase.Name -ScriptName $phase.Script
}

Invoke-Phase1SafetyScan
Test-ReadinessEndpoint
Test-DirectGuardChecks
Test-Selected0EAvailability
Add-GitContext

$failed = @($results | Where-Object { -not $_.Passed })
$passed = $results.Count - $failed.Count
$readiness = if ($failed.Count -eq 0) { "PASSED" } else { "FAILED" }

Write-Host ""
Write-Host "Phase 1I First Entry Readiness Gate Results:"
$results | Sort-Object Group, CheckName | Format-Table Group, CheckName, Passed, Details, DurationMs -AutoSize
Write-Host ("Total checks: {0}" -f $results.Count)
Write-Host ("Passed: {0}" -f $passed)
Write-Host ("Failed: {0}" -f $failed.Count)
Write-Host ("Readiness: {0}" -f $readiness)

if ($failed.Count -gt 0) {
  throw ("Phase 1I readiness gate failed: {0}" -f (($failed | ForEach-Object { "$($_.Group): $($_.CheckName)" }) -join ", "))
}

Write-Host "All Phase 1I first entry readiness checks passed."

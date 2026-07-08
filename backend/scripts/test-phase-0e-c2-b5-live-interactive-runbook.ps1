param(
  [string]$BaseUrl = "http://localhost:5000"
)

$ErrorActionPreference = "Stop"
$checks = New-Object System.Collections.Generic.List[object]
$calls = New-Object System.Collections.Generic.List[object]
$runbookPath = Join-Path (Get-Location) "docs/whatsapp-live-interactive-smoke-test.md"

function Add-Check {
  param(
    [string]$Name,
    [bool]$Passed,
    [string]$Details = ""
  )

  $script:checks.Add([PSCustomObject]@{
    Name = $Name
    Passed = $Passed
    Details = $Details
  })
}

function Invoke-TimedGet {
  param(
    [string]$Uri
  )

  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $response = Invoke-RestMethod -Method GET -Uri $Uri
  $watch.Stop()

  $script:calls.Add([PSCustomObject]@{
    Uri = $Uri
    DurationMs = [int]$watch.ElapsedMilliseconds
    Ready = $response.readyForLiveInteractiveTest
    BlockingCount = $response.summary.blockingCount
    WarningCount = $response.summary.warningCount
  })

  return $response
}

function Get-ReadinessCheck {
  param(
    [object]$Response,
    [string]$Key
  )

  return $Response.checks | Where-Object { $_.key -eq $Key } | Select-Object -First 1
}

Add-Check "runbook file exists" (Test-Path $runbookPath) $runbookPath

if (Test-Path $runbookPath) {
  $content = Get-Content $runbookPath -Raw -Encoding UTF8
} else {
  $content = ""
}

$requiredHeadings = @(
  "## 1. Purpose",
  "## 2. Current safe defaults",
  "## 3. Required live-test flags",
  "## 4. Pre-flight readiness check",
  "## 5. Test recipient safety",
  "## 6. Exact manual conversation to test",
  "## 7. Immediate rollback to safe mode",
  "## 8. What to capture",
  "## 9. Stop conditions",
  "## 10. Next phase dependency"
)

foreach ($heading in $requiredHeadings) {
  Add-Check ("runbook includes heading: {0}" -f $heading) ($content.Contains($heading))
}

Add-Check "runbook says it does not enable live sending" ($content.Contains("This runbook does not enable live sending by itself."))
Add-Check "runbook says it does not send messages" ($content.Contains("This runbook does not send any message by itself."))
Add-Check "runbook includes safe default interactive flag" ($content.Contains("WHATSAPP_INTERACTIVE_ENABLED=false"))
Add-Check "runbook includes safe default live guard" ($content.Contains("WHATSAPP_INTERACTIVE_LIVE_SEND_ALLOWED=false"))
Add-Check "runbook includes live interactive flag" ($content.Contains("WHATSAPP_INTERACTIVE_ENABLED=true"))
Add-Check "runbook includes live guard true" ($content.Contains("WHATSAPP_INTERACTIVE_LIVE_SEND_ALLOWED=true"))
Add-Check "runbook includes cloud dry-run false" ($content.Contains("WHATSAPP_CLOUD_DRY_RUN=false"))
Add-Check "runbook includes rollback dry-run true" ($content.Contains("WHATSAPP_CLOUD_DRY_RUN=true"))
Add-Check "runbook includes readiness endpoint command" ($content.Contains("/api/whatsapp/cloud/live-interactive-readiness"))
Add-Check "runbook warns own test number only" ($content.Contains("Use only your own WhatsApp test number."))
Add-Check "runbook forbids real customers" ($content.Contains("Do not test with real customers."))
Add-Check "runbook forbids broadcasts" ($content.Contains("Do not test with broadcast lists."))
Add-Check "runbook forbids old leads" ($content.Contains("Do not test with old leads."))
Add-Check "runbook includes first test message" ($content.Contains("بغيت نكوموندي"))
Add-Check "runbook includes second test message" ($content.Contains("محمد 0612345678 مراكش"))
Add-Check "runbook includes edit click test" ($content.Contains("تعديل"))
Add-Check "runbook notes click handling next phase" ($content.Contains("Button click behavior may be completed in the next phase."))
Add-Check "runbook states next phase dependency" ($content.Contains("After this runbook is ready, the next engineering phase is interactive reply click handling."))

$fakePhone = "212600000000"
$uri = "{0}/api/whatsapp/cloud/live-interactive-readiness?testRecipientPhone={1}&sellerId=seller_demo_medical" -f $BaseUrl, $fakePhone
$readiness = Invoke-TimedGet -Uri $uri
$serialized = $readiness | ConvertTo-Json -Depth 100
$tokenCheck = Get-ReadinessCheck -Response $readiness -Key "WHATSAPP_CLOUD_ACCESS_TOKEN"

Add-Check "readiness endpoint declares no sends" ($readiness.safety.sendsMessages -eq $false)
Add-Check "readiness endpoint declares no Meta send API call" ($readiness.safety.callsMetaSendApi -eq $false)
Add-Check "readiness response has checks" (@($readiness.checks).Count -gt 0)
Add-Check "readiness response has summary" ($null -ne $readiness.summary.blockingCount -and $null -ne $readiness.summary.warningCount)
Add-Check "readiness response has no send payload" (-not $serialized.Contains('"messaging_product"') -and -not $serialized.Contains('"messages"') -and -not $serialized.Contains('"Authorization"'))
Add-Check "readiness masks full phone" (-not $serialized.Contains($fakePhone) -and $serialized.Contains("212******000"))

if ($tokenCheck.present -eq $true) {
  Add-Check "readiness masks token if present" ($tokenCheck.maskedValue -like "*****" -and $tokenCheck.maskedValue.Length -le 12)
  Add-Check "readiness does not expose common token prefix" (-not $serialized.Contains("EAAG"))
} else {
  Add-Check "readiness reports missing token without value" ($tokenCheck.present -eq $false -and -not $tokenCheck.maskedValue)
}

$failed = $checks | Where-Object { -not $_.Passed }

Write-Host "Phase 0E-C2-B5 live interactive runbook calls:"
$calls | Format-Table -AutoSize

Write-Host "Phase 0E-C2-B5 live interactive runbook checks:"
$checks | Format-Table -AutoSize

if ($failed.Count -gt 0) {
  throw ("Phase 0E-C2-B5 checks failed: {0}" -f (($failed | ForEach-Object { $_.Name }) -join ", "))
}

Write-Host "All Phase 0E-C2-B5 live interactive runbook checks passed."

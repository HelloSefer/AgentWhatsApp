param(
  [string]$BaseUrl = "http://localhost:5000"
)

$ErrorActionPreference = "Stop"
$checks = New-Object System.Collections.Generic.List[object]
$calls = New-Object System.Collections.Generic.List[object]

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

function Get-CheckByKey {
  param(
    [object]$Response,
    [string]$Key
  )

  return $Response.checks | Where-Object { $_.key -eq $Key } | Select-Object -First 1
}

$recipient = "212600000000"
$maskedRecipient = "212******000"
$encodedSeller = [System.Uri]::EscapeDataString("seller_demo_medical")
$withRecipientUri = "{0}/api/whatsapp/cloud/live-interactive-readiness?testRecipientPhone={1}&sellerId={2}" -f $BaseUrl, $recipient, $encodedSeller
$readiness = Invoke-TimedGet -Uri $withRecipientUri

Add-Check "readiness response has boolean ready flag" ($readiness.readyForLiveInteractiveTest -is [bool])
Add-Check "readiness response has checks" (@($readiness.checks).Count -gt 0)
Add-Check "readiness response has summary counts" ($null -ne $readiness.summary.blockingCount -and $null -ne $readiness.summary.warningCount)
Add-Check "readiness endpoint declares no sends" ($readiness.safety.sendsMessages -eq $false)
Add-Check "readiness endpoint declares no Meta send call" ($readiness.safety.callsMetaSendApi -eq $false)

$requiredKeys = @(
  "WHATSAPP_INTERACTIVE_ENABLED",
  "WHATSAPP_INTERACTIVE_LIVE_SEND_ALLOWED",
  "WHATSAPP_CLOUD_DRY_RUN",
  "WHATSAPP_CLOUD_ACCESS_TOKEN",
  "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
  "TEST_RECIPIENT_PHONE",
  "WHATSAPP_CLOUD_API_VERSION"
)

foreach ($key in $requiredKeys) {
  $check = Get-CheckByKey -Response $readiness -Key $key
  Add-Check ("blocking check exists: {0}" -f $key) ($null -ne $check -and $check.severity -eq "blocking")
}

$tokenCheck = Get-CheckByKey -Response $readiness -Key "WHATSAPP_CLOUD_ACCESS_TOKEN"
if ($tokenCheck.present -eq $true) {
  Add-Check "token check masks token" ($tokenCheck.maskedValue -like "*****" -and $tokenCheck.maskedValue -notmatch "^EA" -and $tokenCheck.maskedValue.Length -le 12)
} else {
  Add-Check "missing token is not exposed" ($tokenCheck.present -eq $false -and -not $tokenCheck.maskedValue)
}

$phoneIdCheck = Get-CheckByKey -Response $readiness -Key "WHATSAPP_CLOUD_PHONE_NUMBER_ID"
if ($phoneIdCheck.present -eq $true) {
  Add-Check "phone number id is masked" ($phoneIdCheck.maskedValue -like "*****" -and $phoneIdCheck.maskedValue -notmatch "^\d{8,}$")
} else {
  Add-Check "missing phone number id is not exposed" ($phoneIdCheck.present -eq $false -and -not $phoneIdCheck.maskedValue)
}

$recipientCheck = Get-CheckByKey -Response $readiness -Key "TEST_RECIPIENT_PHONE"
Add-Check "test recipient passes when provided" ($recipientCheck.passed -eq $true)
Add-Check "test recipient is masked in check" ($recipientCheck.maskedValue -eq $maskedRecipient)
Add-Check "test recipient is masked in inputs" ($readiness.inputs.testRecipientPhoneMasked -eq $maskedRecipient)
$serialized = $readiness | ConvertTo-Json -Depth 80
Add-Check "full recipient phone is not exposed" (-not $serialized.Contains($recipient))
Add-Check "response does not include send payload" (-not $serialized.Contains('"messaging_product"') -and -not $serialized.Contains('"messages"'))

$noRecipient = Invoke-TimedGet -Uri ("{0}/api/whatsapp/cloud/live-interactive-readiness" -f $BaseUrl)
$noRecipientCheck = Get-CheckByKey -Response $noRecipient -Key "TEST_RECIPIENT_PHONE"
Add-Check "missing recipient blocks readiness" ($noRecipientCheck.passed -eq $false -and $noRecipient.readyForLiveInteractiveTest -eq $false)
Add-Check "missing recipient adds warning" ((Get-CheckByKey -Response $noRecipient -Key "TEST_RECIPIENT_PHONE_PROVIDED").passed -eq $false)

if ($readiness.readyForLiveInteractiveTest -eq $true) {
  Add-Check "ready true only when no blocking checks fail" ($readiness.summary.blockingCount -eq 0)
} else {
  Add-Check "readiness false by default or when blocking checks fail" ($readiness.summary.blockingCount -gt 0)
}

$failed = $checks | Where-Object { -not $_.Passed }

Write-Host "Phase 0E-C2-B4 live interactive readiness calls:"
$calls | Format-Table -AutoSize

Write-Host "Phase 0E-C2-B4 live interactive readiness checks:"
$checks | Format-Table -AutoSize

if ($failed.Count -gt 0) {
  throw ("Phase 0E-C2-B4 checks failed: {0}" -f (($failed | ForEach-Object { $_.Name }) -join ", "))
}

Write-Host "All Phase 0E-C2-B4 live interactive readiness checks passed."

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

function Invoke-TimedJson {
  param(
    [ValidateSet("GET", "POST", "DELETE")]
    [string]$Method,
    [string]$Uri,
    [object]$Body = $null
  )

  $watch = [System.Diagnostics.Stopwatch]::StartNew()

  if ($null -eq $Body) {
    $response = Invoke-RestMethod -Method $Method -Uri $Uri
  } else {
    $json = $Body | ConvertTo-Json -Depth 60
    $utf8Body = [System.Text.Encoding]::UTF8.GetBytes($json)
    $response = Invoke-RestMethod -Method $Method -Uri $Uri -ContentType "application/json; charset=utf-8" -Body $utf8Body
  }

  $watch.Stop()

  return [PSCustomObject]@{
    Response = $response
    DurationMs = [int]$watch.ElapsedMilliseconds
  }
}

function Clear-Session {
  param(
    [string]$SellerId,
    [string]$Phone
  )

  $uri = "{0}/api/agent/session/{1}?sellerId={2}" -f $BaseUrl, $Phone, $SellerId
  [void](Invoke-TimedJson -Method DELETE -Uri $uri)
}

function Send-CloudFlow {
  param(
    [string]$SellerId,
    [string]$Phone,
    [string]$Message,
    [Nullable[bool]]$InteractiveEnabledOverride = $null,
    [Nullable[bool]]$InteractiveLiveSendAllowedOverride = $null,
    [bool]$ForceDryRun = $true,
    [bool]$SimulateNoProviderCall = $false
  )

  $body = @{
    sellerId = $SellerId
    customerPhone = $Phone
    phoneNumberId = "phase-0e-c2-b3-phone-number-id"
    message = $Message
    forceDryRun = $ForceDryRun
    simulateNoProviderCall = $SimulateNoProviderCall
  }

  if ($null -ne $InteractiveEnabledOverride) {
    $body.interactiveEnabledOverride = [bool]$InteractiveEnabledOverride
  }

  if ($null -ne $InteractiveLiveSendAllowedOverride) {
    $body.interactiveLiveSendAllowedOverride = [bool]$InteractiveLiveSendAllowedOverride
  }

  $result = Invoke-TimedJson -Method POST -Uri ("{0}/api/whatsapp/cloud/test-agent-dispatch-flow" -f $BaseUrl) -Body $body
  $response = $result.Response

  $script:calls.Add([PSCustomObject]@{
    SellerId = $SellerId
    Phone = $Phone
    Message = $Message
    DurationMs = $result.DurationMs
    Decision = $response.meta.interactiveSendDecision.mode
    DispatchMode = $response.dispatchResult.mode
    DryRun = $response.dispatchResult.dryRun
    Blocked = $response.dispatchResult.interactiveBlocked
    Reason = $response.dispatchResult.reason
  })

  return $response
}

$disabledPhone = "2126000C2B3A"
Clear-Session -SellerId "seller_demo_medical" -Phone $disabledPhone
[void](Send-CloudFlow -SellerId "seller_demo_medical" -Phone $disabledPhone -Message "بغيت نكوموندي" -InteractiveEnabledOverride $false -ForceDryRun $true)
$disabledResult = Send-CloudFlow -SellerId "seller_demo_medical" -Phone $disabledPhone -Message "محمد 0612345678 مراكش" -InteractiveEnabledOverride $false -ForceDryRun $true
Add-Check "default disabled decision is text_only" ($disabledResult.meta.interactiveSendDecision.mode -eq "text_only")
Add-Check "default disabled dispatches text" ($disabledResult.dispatchResult.mode -eq "text")
Add-Check "default disabled live guard false" ($disabledResult.dispatchSafety.interactiveLiveSendAllowed -eq $false)
Add-Check "default disabled dry-run true" ($disabledResult.dispatchResult.dryRun -eq $true)

$dryRunPhone = "2126000C2B3B"
Clear-Session -SellerId "seller_demo_medical" -Phone $dryRunPhone
[void](Send-CloudFlow -SellerId "seller_demo_medical" -Phone $dryRunPhone -Message "بغيت نكوموندي" -InteractiveEnabledOverride $true -InteractiveLiveSendAllowedOverride $false -ForceDryRun $true)
$dryRunResult = Send-CloudFlow -SellerId "seller_demo_medical" -Phone $dryRunPhone -Message "محمد 0612345678 مراكش" -InteractiveEnabledOverride $true -InteractiveLiveSendAllowedOverride $false -ForceDryRun $true
Add-Check "interactive dry-run decision is interactive" ($dryRunResult.meta.interactiveSendDecision.mode -eq "interactive_preview")
Add-Check "interactive dry-run dispatches interactive" ($dryRunResult.dispatchResult.mode -eq "interactive")
Add-Check "interactive dry-run stays dry-run" ($dryRunResult.dispatchResult.dryRun -eq $true)
Add-Check "interactive dry-run button payload" ($dryRunResult.dispatchResult.interactiveResult.payload.interactive.type -eq "button")
Add-Check "interactive dry-run not blocked" ($dryRunResult.dispatchResult.interactiveBlocked -ne $true)

$blockedPhone = "2126000C2B3C"
Clear-Session -SellerId "seller_demo_medical" -Phone $blockedPhone
[void](Send-CloudFlow -SellerId "seller_demo_medical" -Phone $blockedPhone -Message "بغيت نكوموندي" -InteractiveEnabledOverride $true -InteractiveLiveSendAllowedOverride $false -ForceDryRun $false -SimulateNoProviderCall $true)
$blockedResult = Send-CloudFlow -SellerId "seller_demo_medical" -Phone $blockedPhone -Message "محمد 0612345678 مراكش" -InteractiveEnabledOverride $true -InteractiveLiveSendAllowedOverride $false -ForceDryRun $false -SimulateNoProviderCall $true
Add-Check "blocked live decision is interactive" ($blockedResult.meta.interactiveSendDecision.mode -eq "interactive_preview")
Add-Check "blocked live guard blocks interactive" ($blockedResult.dispatchResult.interactiveBlocked -eq $true)
Add-Check "blocked live falls back to text" ($blockedResult.dispatchResult.mode -eq "text" -and $blockedResult.dispatchResult.fallbackUsed -eq $true)
Add-Check "blocked live reason is guard" ($blockedResult.dispatchResult.reason -eq "interactive_blocked_by_live_guard")
Add-Check "blocked live uses no-provider dry-run fallback" ($blockedResult.dispatchResult.textResult.dryRun -eq $true)
Add-Check "blocked live safety shows force dry-run false" ($blockedResult.dispatchSafety.forceDryRun -eq $false)
Add-Check "blocked live safety shows simulate provider guard" ($blockedResult.dispatchSafety.simulateNoProviderCall -eq $true)

$allowedDryRunPhone = "2126000C2B3D"
Clear-Session -SellerId "seller_demo_medical" -Phone $allowedDryRunPhone
[void](Send-CloudFlow -SellerId "seller_demo_medical" -Phone $allowedDryRunPhone -Message "بغيت نكوموندي" -InteractiveEnabledOverride $true -InteractiveLiveSendAllowedOverride $true -ForceDryRun $true)
$allowedDryRunResult = Send-CloudFlow -SellerId "seller_demo_medical" -Phone $allowedDryRunPhone -Message "محمد 0612345678 مراكش" -InteractiveEnabledOverride $true -InteractiveLiveSendAllowedOverride $true -ForceDryRun $true
Add-Check "live guard true dry-run dispatches interactive" ($allowedDryRunResult.dispatchResult.mode -eq "interactive")
Add-Check "live guard true remains dry-run" ($allowedDryRunResult.dispatchResult.dryRun -eq $true)
Add-Check "live guard true appears in diagnostics" ($allowedDryRunResult.dispatchSafety.interactiveLiveSendAllowed -eq $true)
Add-Check "live guard true no block in dry-run" ($allowedDryRunResult.dispatchResult.interactiveBlocked -ne $true)

$failed = $checks | Where-Object { -not $_.Passed }

Write-Host "Phase 0E-C2-B3 real send guardrail calls:"
$calls | Format-Table -AutoSize

Write-Host "Phase 0E-C2-B3 real send guardrail checks:"
$checks | Format-Table -AutoSize

if ($failed.Count -gt 0) {
  throw ("Phase 0E-C2-B3 checks failed: {0}" -f (($failed | ForEach-Object { $_.Name }) -join ", "))
}

Write-Host "All Phase 0E-C2-B3 real send guardrail checks passed."

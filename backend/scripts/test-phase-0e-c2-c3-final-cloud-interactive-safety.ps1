param(
  [string]$BaseUrl = "http://localhost:5000"
)

$ErrorActionPreference = "Stop"
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
    $json = $Body | ConvertTo-Json -Depth 80
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
    [string]$Message = "",
    [object]$CloudMessage = $null,
    [Nullable[bool]]$InteractiveEnabledOverride = $null,
    [Nullable[bool]]$InteractiveLiveSendAllowedOverride = $null,
    [bool]$ForceDryRun = $true,
    [bool]$SimulateNoProviderCall = $false
  )

  $body = @{
    sellerId = $SellerId
    customerPhone = $Phone
    phoneNumberId = "phase-0e-c2-c3-phone-number-id"
    forceDryRun = $ForceDryRun
    simulateNoProviderCall = $SimulateNoProviderCall
  }

  if ($Message) {
    $body.message = $Message
  }

  if ($null -ne $CloudMessage) {
    $body.cloudMessage = $CloudMessage
  }

  if ($null -ne $InteractiveEnabledOverride) {
    $body.interactiveEnabledOverride = [bool]$InteractiveEnabledOverride
  }

  if ($null -ne $InteractiveLiveSendAllowedOverride) {
    $body.interactiveLiveSendAllowedOverride = [bool]$InteractiveLiveSendAllowedOverride
  }

  return Invoke-TimedJson -Method POST -Uri ("{0}/api/whatsapp/cloud/test-agent-dispatch-flow" -f $BaseUrl) -Body $body
}

function Normalize-CloudMessage {
  param(
    [object]$Message
  )

  return Invoke-TimedJson -Method POST -Uri ("{0}/api/whatsapp/cloud/test-normalize-interactive-reply" -f $BaseUrl) -Body @{
    message = $Message
  }
}

function New-ButtonReply {
  param(
    [string]$Id,
    [string]$Title
  )

  return @{
    type = "interactive"
    interactive = @{
      type = "button_reply"
      button_reply = @{
        id = $Id
        title = $Title
      }
    }
  }
}

function New-ListReply {
  param(
    [string]$Id,
    [string]$Title
  )

  return @{
    type = "interactive"
    interactive = @{
      type = "list_reply"
      list_reply = @{
        id = $Id
        title = $Title
      }
    }
  }
}

function Has-ButtonId {
  param(
    [object]$Result,
    [string]$Id
  )

  return @($Result.dispatchResult.interactiveResult.payload.interactive.action.buttons | Where-Object { $_.reply.id -eq $Id }).Count -eq 1
}

function Has-ListRowId {
  param(
    [object]$Result,
    [string]$Id
  )

  return @(
    $Result.dispatchResult.interactiveResult.payload.interactive.action.sections |
      ForEach-Object { $_.rows } |
      Where-Object { $_.id -eq $Id }
  ).Count -eq 1
}

$group = "A Safe default text-only"
$phoneA = "2126000C2C3A"
Clear-Session -SellerId "seller_demo_medical" -Phone $phoneA
[void](Send-CloudFlow -SellerId "seller_demo_medical" -Phone $phoneA -Message "بغيت نكوموندي")
$aResultTimed = Send-CloudFlow -SellerId "seller_demo_medical" -Phone $phoneA -Message "محمد 0612345678 مراكش"
$a = $aResultTimed.Response
Add-Check $group "decision remains text_only" ($a.meta.interactiveSendDecision.mode -eq "text_only") $a.meta.interactiveSendDecision.reason $aResultTimed.DurationMs
Add-Check $group "safe default reason" (@("interactive_disabled", "no_interactive_preview") -contains $a.meta.interactiveSendDecision.reason) $a.meta.interactiveSendDecision.reason $aResultTimed.DurationMs
Add-Check $group "dispatches text" ($a.dispatchResult.mode -eq "text") $a.dispatchResult.reason $aResultTimed.DurationMs
Add-Check $group "dry-run only" ($a.dispatchResult.dryRun -eq $true -and $a.dispatchResult.textResult.dryRun -eq $true) "dryRun=$($a.dispatchResult.dryRun)" $aResultTimed.DurationMs
Add-Check $group "no interactive live send" ($a.dispatchResult.interactiveBlocked -ne $false -or $a.dispatchResult.mode -eq "text") "mode=$($a.dispatchResult.mode)" $aResultTimed.DurationMs

$group = "B Interactive enabled dry-run"
$phoneB = "2126000C2C3B"
Clear-Session -SellerId "seller_demo_sandals" -Phone $phoneB
$bResultTimed = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $phoneB -Message "بغيت نكوموندي" -InteractiveEnabledOverride $true
$b = $bResultTimed.Response
Add-Check $group "field option preview is list" ($b.meta.whatsappInteractivePreview.interactive.type -eq "list") "" $bResultTimed.DurationMs
Add-Check $group "decision is interactive_preview" ($b.meta.interactiveSendDecision.mode -eq "interactive_preview") "" $bResultTimed.DurationMs
Add-Check $group "dispatches interactive" ($b.dispatchResult.mode -eq "interactive") $b.dispatchResult.reason $bResultTimed.DurationMs
Add-Check $group "interactive dry-run only" ($b.dispatchResult.dryRun -eq $true -and $b.dispatchResult.interactiveResult.dryRun -eq $true) "" $bResultTimed.DurationMs
Add-Check $group "list includes size 36" (Has-ListRowId -Result $b -Id "size:36") "" $bResultTimed.DurationMs
Add-Check $group "list includes size 40" (Has-ListRowId -Result $b -Id "size:40") "" $bResultTimed.DurationMs

$group = "C Live guard blocks unsafe live"
$phoneC = "2126000C2C3C"
Clear-Session -SellerId "seller_demo_sandals" -Phone $phoneC
$cResultTimed = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $phoneC -Message "بغيت نكوموندي" -InteractiveEnabledOverride $true -InteractiveLiveSendAllowedOverride $false -ForceDryRun $false -SimulateNoProviderCall $true
$c = $cResultTimed.Response
Add-Check $group "decision can be interactive" ($c.meta.interactiveSendDecision.mode -eq "interactive_preview") "" $cResultTimed.DurationMs
Add-Check $group "falls back to text" ($c.dispatchResult.mode -eq "text" -and $c.dispatchResult.fallbackUsed -eq $true) $c.dispatchResult.reason $cResultTimed.DurationMs
Add-Check $group "interactive blocked by guard" ($c.dispatchResult.interactiveBlocked -eq $true) "" $cResultTimed.DurationMs
Add-Check $group "guard reason is explicit" ($c.dispatchResult.reason -eq "interactive_blocked_by_live_guard") $c.dispatchResult.reason $cResultTimed.DurationMs
Add-Check $group "no provider call simulation" ($c.dispatchSafety.simulateNoProviderCall -eq $true -and $c.dispatchResult.textResult.dryRun -eq $true) "" $cResultTimed.DurationMs
Add-Check $group "fallback text includes size 36" ($c.dispatchResult.textResult.payload.text.body -like "*36*") "" $cResultTimed.DurationMs
Add-Check $group "fallback text includes size 40" ($c.dispatchResult.textResult.payload.text.body -like "*40*") "" $cResultTimed.DurationMs

$group = "D Readiness endpoint non-sending"
$fakePhone = "212600000000"
$dTimed = Invoke-TimedJson -Method GET -Uri ("{0}/api/whatsapp/cloud/live-interactive-readiness?testRecipientPhone={1}&sellerId=seller_demo_medical" -f $BaseUrl, $fakePhone)
$d = $dTimed.Response
$dJson = $d | ConvertTo-Json -Depth 100
$tokenCheck = $d.checks | Where-Object { $_.key -eq "WHATSAPP_CLOUD_ACCESS_TOKEN" } | Select-Object -First 1
Add-Check $group "readiness exists" ($null -ne $d.readyForLiveInteractiveTest -and @($d.checks).Count -gt 0) "" $dTimed.DurationMs
Add-Check $group "declares no sends" ($d.safety.sendsMessages -eq $false) "" $dTimed.DurationMs
Add-Check $group "declares no Meta send API" ($d.safety.callsMetaSendApi -eq $false) "" $dTimed.DurationMs
Add-Check $group "no send payload" (-not $dJson.Contains('"messaging_product"') -and -not $dJson.Contains('"messages"')) "" $dTimed.DurationMs
Add-Check $group "full phone masked" (-not $dJson.Contains($fakePhone) -and $dJson.Contains("212******000")) "" $dTimed.DurationMs
if ($tokenCheck.present -eq $true) {
  Add-Check $group "token masked" ($tokenCheck.maskedValue -like "*****" -and $tokenCheck.maskedValue.Length -le 12 -and -not $dJson.Contains("EAAG")) "" $dTimed.DurationMs
} else {
  Add-Check $group "missing token not exposed" ($tokenCheck.present -eq $false -and -not $tokenCheck.maskedValue) "" $dTimed.DurationMs
}

$group = "E Normalizer safety"
$normalizeCases = @(
  @{ Name = "confirm yes"; Message = (New-ButtonReply -Id "confirm:yes" -Title "نعم"); Expected = "نعم" },
  @{ Name = "confirm edit"; Message = (New-ButtonReply -Id "confirm:edit" -Title "تعديل"); Expected = "تعديل" },
  @{ Name = "size list"; Message = (New-ListReply -Id "size:38" -Title "38"); Expected = "38" },
  @{ Name = "color list"; Message = (New-ListReply -Id "color:أسود" -Title "أسود"); Expected = "أسود" }
)
foreach ($case in $normalizeCases) {
  $timed = Normalize-CloudMessage -Message $case.Message
  Add-Check $group ("normalizes {0}" -f $case.Name) ($timed.Response.normalized.normalizedText -eq $case.Expected) $timed.Response.normalized.normalizedText $timed.DurationMs
}
$malformedTimed = Normalize-CloudMessage -Message @{ type = "interactive"; interactive = @{ type = "button_reply"; button_reply = @{} } }
$malformedJson = $malformedTimed.Response | ConvertTo-Json -Depth 30
Add-Check $group "malformed payload safe" ($malformedTimed.Response.normalized.kind -eq "unsupported") "" $malformedTimed.DurationMs
Add-Check $group "malformed has no stack trace" (-not ($malformedJson -match "at .*\\.ts")) "" $malformedTimed.DurationMs

$group = "F Interactive order flow"
$medicalPhone = "2126000C2C3F1"
Clear-Session -SellerId "seller_demo_medical" -Phone $medicalPhone
[void](Send-CloudFlow -SellerId "seller_demo_medical" -Phone $medicalPhone -Message "بغيت نكوموندي" -InteractiveEnabledOverride $true)
[void](Send-CloudFlow -SellerId "seller_demo_medical" -Phone $medicalPhone -Message "محمد 0612345678 مراكش" -InteractiveEnabledOverride $true)
$medicalConfirmTimed = Send-CloudFlow -SellerId "seller_demo_medical" -Phone $medicalPhone -CloudMessage (New-ButtonReply -Id "confirm:yes" -Title "نعم") -InteractiveEnabledOverride $true
$medicalConfirm = $medicalConfirmTimed.Response
Add-Check $group "medical confirm normalized" ($medicalConfirm.cloudNormalization.normalizedText -eq "نعم") "" $medicalConfirmTimed.DurationMs
Add-Check $group "medical order not confirmed in Phase 2A" ($medicalConfirm.meta.orderStateSummary.confirmed -eq $false -and $medicalConfirm.reply -like "*Phase 4*") "" $medicalConfirmTimed.DurationMs
Add-Check $group "medical dry-run only" ($medicalConfirm.dispatchResult.dryRun -eq $true) "" $medicalConfirmTimed.DurationMs

$sandalsPhone = "2126000C2C3F2"
Clear-Session -SellerId "seller_demo_sandals" -Phone $sandalsPhone
[void](Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -Message "بغيت نكوموندي" -InteractiveEnabledOverride $true)
[void](Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -Message "محمد 0612345678 مراكش حي السلام" -InteractiveEnabledOverride $true)
$sandalsSizeTimed = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -CloudMessage (New-ListReply -Id "size:38" -Title "38") -InteractiveEnabledOverride $true
$sandalsSize = $sandalsSizeTimed.Response
$sandalsColorTimed = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -CloudMessage (New-ListReply -Id "color:أسود" -Title "أسود") -InteractiveEnabledOverride $true
$sandalsColor = $sandalsColorTimed.Response
$sandalsQuantityTimed = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -Message "1" -InteractiveEnabledOverride $true
$sandalsQuantity = $sandalsQuantityTimed.Response
$sandalsConfirmTimed = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -CloudMessage (New-ButtonReply -Id "confirm:yes" -Title "نعم") -InteractiveEnabledOverride $true
$sandalsConfirm = $sandalsConfirmTimed.Response
Add-Check $group "sandals size collected" ($sandalsSize.meta.orderStateSummary.collected.size -eq "38") "" $sandalsSizeTimed.DurationMs
Add-Check $group "sandals color collected" ($sandalsColor.meta.orderStateSummary.collected.color -eq "أسود") "" $sandalsColorTimed.DurationMs
Add-Check $group "sandals still missing quantity before summary" (@($sandalsColor.meta.orderStateSummary.missingFields) -contains "quantity") "" $sandalsColorTimed.DurationMs
Add-Check $group "sandals quantity completes review" ($sandalsQuantity.meta.orderStateSummary.awaitingConfirmation -eq $true -and $sandalsQuantity.meta.orderStateSummary.confirmed -eq $false -and $sandalsQuantity.reply -like "*الطلب واجد للمراجعة*") "" $sandalsQuantityTimed.DurationMs
Add-Check $group "sandals order not confirmed in Phase 2A" ($sandalsConfirm.meta.orderStateSummary.confirmed -eq $false -and $sandalsConfirm.reply -like "*Phase 4*") "" $sandalsConfirmTimed.DurationMs
Add-Check $group "sandals dry-run only" ($sandalsConfirm.dispatchResult.dryRun -eq $true) "" $sandalsConfirmTimed.DurationMs

$group = "G Normal text unchanged"
$phoneG = "2126000C2C3G"
Clear-Session -SellerId "seller_demo_medical" -Phone $phoneG
$gTimed = Send-CloudFlow -SellerId "seller_demo_medical" -Phone $phoneG -Message "سلام"
$g = $gTimed.Response
Add-Check $group "no cloud normalization metadata" ($null -eq $g.cloudNormalization) "" $gTimed.DurationMs
Add-Check $group "reply is normal" ($g.reply.Length -gt 0) $g.reply $gTimed.DurationMs
Add-Check $group "dispatch dry-run only" ($g.dispatchResult.dryRun -eq $true) "" $gTimed.DurationMs

$failed = $checks | Where-Object { -not $_.Passed }
$passed = $checks.Count - $failed.Count

Write-Host "Phase 0E-C2-C3 final cloud interactive safety checks:"
$checks | Sort-Object Group, CheckName | Format-Table Group, CheckName, Passed, Details, DurationMs -AutoSize

Write-Host ("Total checks: {0}" -f $checks.Count)
Write-Host ("Passed: {0}" -f $passed)
Write-Host ("Failed: {0}" -f $failed.Count)

if ($failed.Count -gt 0) {
  throw ("Phase 0E-C2-C3 checks failed: {0}" -f (($failed | ForEach-Object { "$($_.Group): $($_.CheckName)" }) -join ", "))
}

Write-Host "All Phase 0E-C2-C3 final cloud interactive safety checks passed."

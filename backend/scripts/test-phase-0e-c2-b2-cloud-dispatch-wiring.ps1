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
    [Nullable[bool]]$InteractiveEnabledOverride = $null
  )

  $body = @{
    sellerId = $SellerId
    customerPhone = $Phone
    phoneNumberId = "phase-0e-c2-b2-phone-number-id"
    message = $Message
    forceDryRun = $true
  }

  if ($null -ne $InteractiveEnabledOverride) {
    $body.interactiveEnabledOverride = [bool]$InteractiveEnabledOverride
  }

  $result = Invoke-TimedJson -Method POST -Uri ("{0}/api/whatsapp/cloud/test-agent-dispatch-flow" -f $BaseUrl) -Body $body
  $response = $result.Response

  $script:calls.Add([PSCustomObject]@{
    SellerId = $SellerId
    Phone = $Phone
    Message = $Message
    DurationMs = $result.DurationMs
    Source = $response.source
    Decision = $response.meta.interactiveSendDecision.mode
    DispatchMode = $response.dispatchResult.mode
    FallbackUsed = $response.dispatchResult.fallbackUsed
  })

  return $response
}

function Send-DispatchDirect {
  param(
    [object]$Body
  )

  $result = Invoke-TimedJson -Method POST -Uri ("{0}/api/whatsapp/cloud/test-dispatch-agent-reply" -f $BaseUrl) -Body $Body
  return $result.Response
}

$medicalDisabledPhone = "2126000C2B2A"
Clear-Session -SellerId "seller_demo_medical" -Phone $medicalDisabledPhone
[void](Send-CloudFlow -SellerId "seller_demo_medical" -Phone $medicalDisabledPhone -Message "بغيت نكوموندي" -InteractiveEnabledOverride $false)
$medicalDisabled = Send-CloudFlow -SellerId "seller_demo_medical" -Phone $medicalDisabledPhone -Message "محمد 0612345678 مراكش" -InteractiveEnabledOverride $false
Add-Check "disabled path has button preview" ($medicalDisabled.meta.whatsappInteractivePreview.interactive.type -eq "button")
Add-Check "disabled path decision is text_only" ($medicalDisabled.meta.interactiveSendDecision.mode -eq "text_only")
Add-Check "disabled path reason is interactive_disabled" ($medicalDisabled.meta.interactiveSendDecision.reason -eq "interactive_disabled")
Add-Check "disabled path dispatches text" ($medicalDisabled.dispatchResult.mode -eq "text" -and $medicalDisabled.dispatchResult.ok -eq $true)
Add-Check "disabled path dry-run text result" ($medicalDisabled.dispatchResult.dryRun -eq $true -and $medicalDisabled.dispatchResult.textResult.dryRun -eq $true)
Add-Check "disabled path no interactive result" ($null -eq $medicalDisabled.dispatchResult.interactiveResult)

$medicalEnabledPhone = "2126000C2B2B"
Clear-Session -SellerId "seller_demo_medical" -Phone $medicalEnabledPhone
[void](Send-CloudFlow -SellerId "seller_demo_medical" -Phone $medicalEnabledPhone -Message "بغيت نكوموندي" -InteractiveEnabledOverride $true)
$medicalEnabled = Send-CloudFlow -SellerId "seller_demo_medical" -Phone $medicalEnabledPhone -Message "محمد 0612345678 مراكش" -InteractiveEnabledOverride $true
Add-Check "enabled path decision is interactive_preview" ($medicalEnabled.meta.interactiveSendDecision.mode -eq "interactive_preview")
Add-Check "enabled path dispatches interactive" ($medicalEnabled.dispatchResult.mode -eq "interactive" -and $medicalEnabled.dispatchResult.ok -eq $true)
Add-Check "enabled path dry-run interactive" ($medicalEnabled.dispatchResult.dryRun -eq $true -and $medicalEnabled.dispatchResult.interactiveResult.dryRun -eq $true)
Add-Check "enabled button payload type" ($medicalEnabled.dispatchResult.interactiveResult.payload.interactive.type -eq "button")
Add-Check "enabled button includes confirm yes" (@($medicalEnabled.dispatchResult.interactiveResult.payload.interactive.action.buttons | Where-Object { $_.reply.id -eq "confirm:yes" }).Count -eq 1)
Add-Check "enabled button includes confirm edit" (@($medicalEnabled.dispatchResult.interactiveResult.payload.interactive.action.buttons | Where-Object { $_.reply.id -eq "confirm:edit" }).Count -eq 1)

$sandalsPhone = "2126000C2B2C"
Clear-Session -SellerId "seller_demo_sandals" -Phone $sandalsPhone
[void](Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -Message "بغيت نكوموندي" -InteractiveEnabledOverride $true)
$sandalsFieldOptions = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -Message "محمد 0612345678 مراكش حي السلام" -InteractiveEnabledOverride $true
Add-Check "field options replyUi purpose" ($sandalsFieldOptions.meta.replyUi.purpose -eq "field_options")
Add-Check "field options preview list" ($sandalsFieldOptions.meta.whatsappInteractivePreview.interactive.type -eq "list")
Add-Check "field options decision interactive" ($sandalsFieldOptions.meta.interactiveSendDecision.mode -eq "interactive_preview")
Add-Check "field options dispatch interactive" ($sandalsFieldOptions.dispatchResult.mode -eq "interactive" -and $sandalsFieldOptions.dispatchResult.ok -eq $true)
Add-Check "field options dry-run" ($sandalsFieldOptions.dispatchResult.dryRun -eq $true)
Add-Check "field options row size 38" (@($sandalsFieldOptions.dispatchResult.interactiveResult.payload.interactive.action.sections[0].rows | Where-Object { $_.id -eq "size:38" }).Count -eq 1)

$invalidPreview = @{
  type = "interactive"
  interactive = @{
    type = "button"
    body = @{ text = "Invalid buttons" }
    action = @{
      buttons = @(
        @{ type = "reply"; reply = @{ id = "one"; title = "One" } },
        @{ type = "reply"; reply = @{ id = "two"; title = "Two" } },
        @{ type = "reply"; reply = @{ id = "three"; title = "Three" } },
        @{ type = "reply"; reply = @{ id = "four"; title = "Four" } }
      )
    }
  }
}
$invalidDispatch = Send-DispatchDirect -Body @{
  to = "212600000000"
  replyText = "Fallback text"
  forceDryRun = $true
  interactiveSendDecision = @{
    mode = "interactive_preview"
    reason = "preview_available"
    channel = "whatsapp_cloud"
    interactiveEnabled = $true
    previewAvailable = $true
    interactiveType = "button"
  }
  whatsappInteractivePreview = $invalidPreview
}
Add-Check "invalid interactive fallback ok" ($invalidDispatch.ok -eq $true)
Add-Check "invalid interactive fallback mode text" ($invalidDispatch.mode -eq "text")
Add-Check "invalid interactive fallbackUsed" ($invalidDispatch.fallbackUsed -eq $true)
Add-Check "invalid interactive fallback reason" ($invalidDispatch.reason -eq "interactive_failed_fallback_text")
Add-Check "invalid interactive validation captured" ($invalidDispatch.interactiveResult.success -eq $false -and $invalidDispatch.interactiveResult.errorMessage -like "*at most 3*")
Add-Check "invalid interactive text fallback dry-run" ($invalidDispatch.textResult.success -eq $true -and $invalidDispatch.textResult.dryRun -eq $true)

$failed = $checks | Where-Object { -not $_.Passed }

Write-Host "Phase 0E-C2-B2 Cloud dispatch wiring calls:"
$calls | Format-Table -AutoSize

Write-Host "Phase 0E-C2-B2 Cloud dispatch wiring checks:"
$checks | Format-Table -AutoSize

if ($failed.Count -gt 0) {
  throw ("Phase 0E-C2-B2 checks failed: {0}" -f (($failed | ForEach-Object { $_.Name }) -join ", "))
}

Write-Host "All Phase 0E-C2-B2 Cloud dispatch wiring checks passed."

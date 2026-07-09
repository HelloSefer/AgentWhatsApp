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
    $json = $Body | ConvertTo-Json -Depth 70
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
    [string]$InputType = "text",
    [bool]$InteractiveEnabledOverride = $true
  )

  $body = @{
    sellerId = $SellerId
    customerPhone = $Phone
    phoneNumberId = "phase-0e-c2-c2-phone-number-id"
    forceDryRun = $true
    interactiveEnabledOverride = $InteractiveEnabledOverride
  }

  if ($Message) {
    $body.message = $Message
  }

  if ($null -ne $CloudMessage) {
    $body.cloudMessage = $CloudMessage
  }

  $result = Invoke-TimedJson -Method POST -Uri ("{0}/api/whatsapp/cloud/test-agent-dispatch-flow" -f $BaseUrl) -Body $body
  $response = $result.Response
  $summary = $response.meta.orderStateSummary
  $normalizedText =
    if ($response.cloudNormalization) {
      $response.cloudNormalization.normalizedText
    } else {
      $Message
    }

  $script:calls.Add([PSCustomObject]@{
    SellerId = $SellerId
    Phone = $Phone
    InputType = $InputType
    NormalizedText = $normalizedText
    Source = $response.source
    Reply = if ($response.reply.Length -gt 55) { $response.reply.Substring(0, 55) + "..." } else { $response.reply }
    Complete = $summary.isComplete
    Awaiting = $summary.awaitingConfirmation
    Confirmed = $summary.confirmed
    Missing = (@($summary.missingFields) -join ",")
    DurationMs = $result.DurationMs
  })

  return $response
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

$medicalConfirmPhone = "2126000C2C2A"
Clear-Session -SellerId "seller_demo_medical" -Phone $medicalConfirmPhone
[void](Send-CloudFlow -SellerId "seller_demo_medical" -Phone $medicalConfirmPhone -Message "بغيت نكوموندي")
$medicalReady = Send-CloudFlow -SellerId "seller_demo_medical" -Phone $medicalConfirmPhone -Message "محمد 0612345678 مراكش"
Add-Check "medical ready before confirm is complete" ($medicalReady.meta.orderStateSummary.isComplete -eq $true)
Add-Check "medical ready before confirm awaits confirmation" ($medicalReady.meta.orderStateSummary.awaitingConfirmation -eq $true)
Add-Check "medical ready before confirm not confirmed" ($medicalReady.meta.orderStateSummary.confirmed -eq $false)
Add-Check "medical ready has confirm button preview" ($medicalReady.meta.whatsappInteractivePreview.interactive.type -eq "button")
$medicalConfirmed = Send-CloudFlow -SellerId "seller_demo_medical" -Phone $medicalConfirmPhone -CloudMessage (New-ButtonReply -Id "confirm:yes" -Title "نعم") -InputType "button"
Add-Check "medical confirm click normalized to نعم" ($medicalConfirmed.cloudNormalization.normalizedText -eq "نعم")
Add-Check "medical confirm click confirms order" ($medicalConfirmed.meta.orderStateSummary.confirmed -eq $true)
Add-Check "medical confirm success reply" ($medicalConfirmed.reply -like "*تأكيد الطلب*")
Add-Check "medical confirm dispatch dry-run" ($medicalConfirmed.dispatchResult.dryRun -eq $true)

$medicalEditPhone = "2126000C2C2B"
Clear-Session -SellerId "seller_demo_medical" -Phone $medicalEditPhone
[void](Send-CloudFlow -SellerId "seller_demo_medical" -Phone $medicalEditPhone -Message "بغيت نكوموندي")
[void](Send-CloudFlow -SellerId "seller_demo_medical" -Phone $medicalEditPhone -Message "محمد 0612345678 مراكش")
$medicalEdit = Send-CloudFlow -SellerId "seller_demo_medical" -Phone $medicalEditPhone -CloudMessage (New-ButtonReply -Id "confirm:edit" -Title "تعديل") -InputType "button"
Add-Check "medical edit click normalized to تعديل" ($medicalEdit.cloudNormalization.normalizedText -eq "تعديل")
Add-Check "medical edit click does not confirm" ($medicalEdit.meta.orderStateSummary.confirmed -eq $false)
Add-Check "medical edit reply asks what to edit" (($medicalEdit.reply -like "*تبدل*") -or ($medicalEdit.reply -like "*المعلومة*") -or ($medicalEdit.reply -like "*شنو*"))

$sandalsPhone = "2126000C2C2C"
Clear-Session -SellerId "seller_demo_sandals" -Phone $sandalsPhone
[void](Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -Message "بغيت نكوموندي")
$sandalsPartial = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -Message "محمد 0612345678 مراكش حي السلام"
$sandalsMissingPartial = @($sandalsPartial.meta.orderStateSummary.missingFields)
Add-Check "sandals partial still missing size" ($sandalsMissingPartial -contains "size")
Add-Check "sandals partial still missing color" ($sandalsMissingPartial -contains "color")
$sandalsSize = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -CloudMessage (New-ListReply -Id "size:38" -Title "38") -InputType "list"
$sandalsMissingSize = @($sandalsSize.meta.orderStateSummary.missingFields)
Add-Check "sandals size click normalized to 38" ($sandalsSize.cloudNormalization.normalizedText -eq "38")
Add-Check "sandals size click collects size" ($sandalsSize.meta.orderStateSummary.collected.size -eq "38")
Add-Check "sandals size click still missing color" ($sandalsMissingSize -contains "color")
Add-Check "sandals size click not complete yet" ($sandalsSize.meta.orderStateSummary.isComplete -eq $false)
$sandalsColor = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -CloudMessage (New-ListReply -Id "color:أسود" -Title "أسود") -InputType "list"
Add-Check "sandals color click normalized to أسود" ($sandalsColor.cloudNormalization.normalizedText -eq "أسود")
Add-Check "sandals color click collects color" ($sandalsColor.meta.orderStateSummary.collected.color -eq "أسود")
Add-Check "sandals color click completes order" ($sandalsColor.meta.orderStateSummary.isComplete -eq $true)
Add-Check "sandals color click awaits confirmation" ($sandalsColor.meta.orderStateSummary.awaitingConfirmation -eq $true)
Add-Check "sandals color confirmation preview exists" ($sandalsColor.meta.whatsappInteractivePreview.interactive.type -eq "button")
if ($null -ne $sandalsColor.meta.orderStateSummary.collected.quantity) {
  Add-Check "sandals quantity is preserved/defaulted" ([int]$sandalsColor.meta.orderStateSummary.collected.quantity -ge 1)
} else {
  Add-Check "sandals quantity is preserved/defaulted" $true "quantity not required in this config"
}
$sandalsConfirmed = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -CloudMessage (New-ButtonReply -Id "confirm:yes" -Title "نعم") -InputType "button"
Add-Check "sandals confirm click normalized to نعم" ($sandalsConfirmed.cloudNormalization.normalizedText -eq "نعم")
Add-Check "sandals confirm click confirms order" ($sandalsConfirmed.meta.orderStateSummary.confirmed -eq $true)
Add-Check "sandals confirm dispatch dry-run" ($sandalsConfirmed.dispatchResult.dryRun -eq $true)

$normalPhone = "2126000C2C2D"
Clear-Session -SellerId "seller_demo_medical" -Phone $normalPhone
$normalText = Send-CloudFlow -SellerId "seller_demo_medical" -Phone $normalPhone -Message "سلام" -InputType "text"
Add-Check "normal text flow has no cloud normalization metadata" ($null -eq $normalText.cloudNormalization)
Add-Check "normal text flow replies normally" ($normalText.reply.Length -gt 0)
Add-Check "normal text flow dry-run only" ($normalText.dispatchResult.dryRun -eq $true)

$failed = $checks | Where-Object { -not $_.Passed }

Write-Host "Phase 0E-C2-C2 interactive order flow calls:"
$calls | Format-Table -AutoSize

Write-Host "Phase 0E-C2-C2 interactive order flow checks:"
$checks | Format-Table -AutoSize

if ($failed.Count -gt 0) {
  throw ("Phase 0E-C2-C2 checks failed: {0}" -f (($failed | ForEach-Object { $_.Name }) -join ", "))
}

Write-Host "All Phase 0E-C2-C2 interactive order flow checks passed."

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
    $json = $Body | ConvertTo-Json -Depth 30
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
  $result = Invoke-TimedJson -Method DELETE -Uri $uri

  $script:calls.Add([PSCustomObject]@{
    Method = "DELETE"
    SellerId = $SellerId
    Phone = $Phone
    Message = ""
    DurationMs = $result.DurationMs
    Source = ""
  })
}

function Send-Agent {
  param(
    [string]$SellerId,
    [string]$Phone,
    [string]$Message
  )

  $result = Invoke-TimedJson -Method POST -Uri ("{0}/api/agent/test" -f $BaseUrl) -Body @{
    sellerId = $SellerId
    customerPhone = $Phone
    message = $Message
    useMemory = $true
  }

  $script:calls.Add([PSCustomObject]@{
    Method = "POST"
    SellerId = $SellerId
    Phone = $Phone
    Message = $Message
    DurationMs = $result.DurationMs
    Source = $result.Response.source
  })

  return $result
}

Write-Host "Phase 0E-C1 interactive send decision test against $BaseUrl"

$medical = "seller_demo_medical"
$sandals = "seller_demo_sandals"

$medicalPhoneA = "2126000000EC1A"
Clear-Session -SellerId $medical -Phone $medicalPhoneA
$medicalStart = Send-Agent -SellerId $medical -Phone $medicalPhoneA -Message "بغيت نكوموندي"
$medicalStartDecision = $medicalStart.Response.meta.interactiveSendDecision

Add-Check -Name "order start replyUi purpose" -Passed ($medicalStart.Response.meta.replyUi.purpose -eq "order_start") -Details ($medicalStart.Response.meta.replyUi | ConvertTo-Json -Compress -Depth 10)
Add-Check -Name "order start has no preview" -Passed ($null -eq $medicalStart.Response.meta.whatsappInteractivePreview) -Details ($medicalStart.Response.meta.whatsappInteractivePreview | ConvertTo-Json -Compress -Depth 10)
Add-Check -Name "order start decision exists" -Passed ($null -ne $medicalStartDecision) -Details ($medicalStartDecision | ConvertTo-Json -Compress -Depth 10)
Add-Check -Name "order start decision text only" -Passed ($medicalStartDecision.mode -eq "text_only") -Details $medicalStartDecision.mode
Add-Check -Name "order start decision disabled default" -Passed ($medicalStartDecision.interactiveEnabled -eq $false) -Details "interactiveEnabled=$($medicalStartDecision.interactiveEnabled)"
Add-Check -Name "order start preview unavailable" -Passed ($medicalStartDecision.previewAvailable -eq $false) -Details "previewAvailable=$($medicalStartDecision.previewAvailable)"
Add-Check -Name "order start reason deterministic" -Passed (@("interactive_disabled", "no_interactive_preview") -contains $medicalStartDecision.reason) -Details $medicalStartDecision.reason

$medicalPhoneB = "2126000000EC1B"
Clear-Session -SellerId $medical -Phone $medicalPhoneB
$null = Send-Agent -SellerId $medical -Phone $medicalPhoneB -Message "بغيت نكوموندي"
$medicalConfirm = Send-Agent -SellerId $medical -Phone $medicalPhoneB -Message "محمد 0612345678 مراكش"
$medicalConfirmDecision = $medicalConfirm.Response.meta.interactiveSendDecision

Add-Check -Name "medical confirmation asks confirmation" -Passed ($medicalConfirm.Response.reply.Contains("واش نأكد لك الطلب؟")) -Details $medicalConfirm.Response.reply
Add-Check -Name "medical confirmation preview is button" -Passed ($medicalConfirm.Response.meta.whatsappInteractivePreview.interactive.type -eq "button") -Details ($medicalConfirm.Response.meta.whatsappInteractivePreview | ConvertTo-Json -Compress -Depth 20)
Add-Check -Name "medical confirmation decision text only" -Passed ($medicalConfirmDecision.mode -eq "text_only") -Details ($medicalConfirmDecision | ConvertTo-Json -Compress -Depth 10)
Add-Check -Name "medical confirmation decision disabled" -Passed ($medicalConfirmDecision.reason -eq "interactive_disabled" -and $medicalConfirmDecision.interactiveEnabled -eq $false) -Details ($medicalConfirmDecision | ConvertTo-Json -Compress -Depth 10)
Add-Check -Name "medical confirmation decision sees preview" -Passed ($medicalConfirmDecision.previewAvailable -eq $true -and $medicalConfirmDecision.interactiveType -eq "button") -Details ($medicalConfirmDecision | ConvertTo-Json -Compress -Depth 10)

$sandalsPhoneC = "2126000000EC1C"
Clear-Session -SellerId $sandals -Phone $sandalsPhoneC
$null = Send-Agent -SellerId $sandals -Phone $sandalsPhoneC -Message "بغيت نكوموندي"
$sandalsOptions = Send-Agent -SellerId $sandals -Phone $sandalsPhoneC -Message "محمد 0612345678 مراكش حي السلام"
$sandalsOptionsDecision = $sandalsOptions.Response.meta.interactiveSendDecision

Add-Check -Name "sandals field options replyUi" -Passed ($sandalsOptions.Response.meta.replyUi.purpose -eq "field_options") -Details ($sandalsOptions.Response.meta.replyUi | ConvertTo-Json -Compress -Depth 10)
Add-Check -Name "sandals field options preview exists" -Passed ($null -ne $sandalsOptions.Response.meta.whatsappInteractivePreview) -Details ($sandalsOptions.Response.meta.whatsappInteractivePreview | ConvertTo-Json -Compress -Depth 20)
Add-Check -Name "sandals field options decision text only" -Passed ($sandalsOptionsDecision.mode -eq "text_only") -Details ($sandalsOptionsDecision | ConvertTo-Json -Compress -Depth 10)
Add-Check -Name "sandals field options disabled reason" -Passed ($sandalsOptionsDecision.reason -eq "interactive_disabled" -and $sandalsOptionsDecision.interactiveEnabled -eq $false) -Details ($sandalsOptionsDecision | ConvertTo-Json -Compress -Depth 10)
Add-Check -Name "sandals field options detects preview type" -Passed ($sandalsOptionsDecision.previewAvailable -eq $true -and @("button", "list") -contains $sandalsOptionsDecision.interactiveType) -Details ($sandalsOptionsDecision | ConvertTo-Json -Compress -Depth 10)

Write-Host ""
$calls | Format-Table -AutoSize -Wrap

Write-Host ""
$checks | Format-Table -AutoSize -Wrap

$failed = @($checks | Where-Object { -not $_.Passed })

if ($failed.Count -gt 0) {
  Write-Host ""
  Write-Host "Failed checks: $($failed.Count)"
  exit 1
}

Write-Host ""
Write-Host "All Phase 0E-C1 interactive send decision checks passed."

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

function Get-ButtonReplies {
  param([object]$Preview)

  if ($null -eq $Preview -or $Preview.interactive.type -ne "button") {
    return @()
  }

  return @($Preview.interactive.action.buttons | ForEach-Object { $_.reply })
}

function Get-ListRows {
  param([object]$Preview)

  if ($null -eq $Preview -or $Preview.interactive.type -ne "list") {
    return @()
  }

  return @($Preview.interactive.action.sections | ForEach-Object { $_.rows } | ForEach-Object { $_ })
}

function Has-Button {
  param(
    [object]$Preview,
    [string]$Id,
    [string]$Title
  )

  return @(
    Get-ButtonReplies -Preview $Preview |
      Where-Object { $_.id -eq $Id -and $_.title -eq $Title }
  ).Count -gt 0
}

function Preview-Has-OptionLabel {
  param(
    [object]$Preview,
    [string]$Label
  )

  if ($Preview.interactive.type -eq "button") {
    return @(
      Get-ButtonReplies -Preview $Preview |
        Where-Object { $_.title -eq $Label }
    ).Count -gt 0
  }

  if ($Preview.interactive.type -eq "list") {
    return @(
      Get-ListRows -Preview $Preview |
        Where-Object { $_.title -eq $Label }
    ).Count -gt 0
  }

  return $false
}

Write-Host "Phase 0E-B2 WhatsApp interactive mapper test against $BaseUrl"

$medical = "seller_demo_medical"
$sandals = "seller_demo_sandals"

$medicalPhoneA = "2126000000EB2A"
Clear-Session -SellerId $medical -Phone $medicalPhoneA
$medicalStart = Send-Agent -SellerId $medical -Phone $medicalPhoneA -Message "بغيت نكوموندي"
Add-Check -Name "order start ui purpose exists" -Passed ($medicalStart.Response.meta.replyUi.purpose -eq "order_start") -Details ($medicalStart.Response.meta.replyUi | ConvertTo-Json -Compress -Depth 10)
Add-Check -Name "order start ui kind auto" -Passed ($medicalStart.Response.meta.replyUi.kind -eq "auto") -Details $medicalStart.Response.meta.replyUi.kind
Add-Check -Name "order start has no interactive preview" -Passed ($null -eq $medicalStart.Response.meta.whatsappInteractivePreview) -Details ($medicalStart.Response.meta.whatsappInteractivePreview | ConvertTo-Json -Compress -Depth 10)

$medicalPhoneB = "2126000000EB2B"
Clear-Session -SellerId $medical -Phone $medicalPhoneB
$null = Send-Agent -SellerId $medical -Phone $medicalPhoneB -Message "بغيت نكوموندي"
$medicalConfirm = Send-Agent -SellerId $medical -Phone $medicalPhoneB -Message "محمد 0612345678 مراكش"
$medicalPreview = $medicalConfirm.Response.meta.whatsappInteractivePreview
Add-Check -Name "medical confirmation asks confirmation" -Passed ($medicalConfirm.Response.reply.Contains("واش نأكد لك الطلب؟")) -Details $medicalConfirm.Response.reply
Add-Check -Name "medical confirmation replyUi buttons" -Passed ($medicalConfirm.Response.meta.replyUi.kind -eq "buttons" -and $medicalConfirm.Response.meta.replyUi.purpose -eq "confirmation") -Details ($medicalConfirm.Response.meta.replyUi | ConvertTo-Json -Compress -Depth 10)
Add-Check -Name "medical confirmation maps to button preview" -Passed ($medicalPreview.interactive.type -eq "button") -Details ($medicalPreview | ConvertTo-Json -Compress -Depth 20)
Add-Check -Name "medical button preview contains confirm ids" -Passed ((Has-Button -Preview $medicalPreview -Id "confirm:yes" -Title "نعم") -and (Has-Button -Preview $medicalPreview -Id "confirm:edit" -Title "تعديل")) -Details ((Get-ButtonReplies -Preview $medicalPreview | ConvertTo-Json -Compress -Depth 10))

$sandalsPhoneC = "2126000000EB2C"
Clear-Session -SellerId $sandals -Phone $sandalsPhoneC
$null = Send-Agent -SellerId $sandals -Phone $sandalsPhoneC -Message "بغيت نكوموندي"
$sandalsOptions = Send-Agent -SellerId $sandals -Phone $sandalsPhoneC -Message "محمد 0612345678 مراكش حي السلام"
$sandalsOptionsPreview = $sandalsOptions.Response.meta.whatsappInteractivePreview
$hasConfiguredOption = (Preview-Has-OptionLabel -Preview $sandalsOptionsPreview -Label "38") -or (Preview-Has-OptionLabel -Preview $sandalsOptionsPreview -Label "أسود")
Add-Check -Name "sandals field options replyUi present" -Passed ($sandalsOptions.Response.meta.replyUi.purpose -eq "field_options") -Details ($sandalsOptions.Response.meta.replyUi | ConvertTo-Json -Compress -Depth 10)
Add-Check -Name "sandals field options preview exists" -Passed ($null -ne $sandalsOptionsPreview) -Details ($sandalsOptionsPreview | ConvertTo-Json -Compress -Depth 20)
Add-Check -Name "sandals field options preview type supported" -Passed (@("button", "list") -contains $sandalsOptionsPreview.interactive.type) -Details $sandalsOptionsPreview.interactive.type
Add-Check -Name "sandals field options preview has configured option" -Passed $hasConfiguredOption -Details ($sandalsOptionsPreview | ConvertTo-Json -Compress -Depth 20)

$sandalsPhoneD = "2126000000EB2D"
Clear-Session -SellerId $sandals -Phone $sandalsPhoneD
$null = Send-Agent -SellerId $sandals -Phone $sandalsPhoneD -Message "بغيت نكوموندي"
$null = Send-Agent -SellerId $sandals -Phone $sandalsPhoneD -Message "مقاس 38"
$null = Send-Agent -SellerId $sandals -Phone $sandalsPhoneD -Message "مراكش"
$null = Send-Agent -SellerId $sandals -Phone $sandalsPhoneD -Message "محمد 0612345678 حي السلام"
$sandalsConfirm = Send-Agent -SellerId $sandals -Phone $sandalsPhoneD -Message "أسود 1"
$sandalsConfirmPreview = $sandalsConfirm.Response.meta.whatsappInteractivePreview
Add-Check -Name "sandals confirmation replyUi present" -Passed ($sandalsConfirm.Response.meta.replyUi.purpose -eq "confirmation") -Details ($sandalsConfirm.Response.meta.replyUi | ConvertTo-Json -Compress -Depth 10)
Add-Check -Name "sandals confirmation maps to button preview" -Passed ($sandalsConfirmPreview.interactive.type -eq "button") -Details ($sandalsConfirmPreview | ConvertTo-Json -Compress -Depth 20)
Add-Check -Name "sandals confirmation buttons include yes edit" -Passed ((Has-Button -Preview $sandalsConfirmPreview -Id "confirm:yes" -Title "نعم") -and (Has-Button -Preview $sandalsConfirmPreview -Id "confirm:edit" -Title "تعديل")) -Details ((Get-ButtonReplies -Preview $sandalsConfirmPreview | ConvertTo-Json -Compress -Depth 10))

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
Write-Host "All Phase 0E-B2 WhatsApp interactive mapper checks passed."

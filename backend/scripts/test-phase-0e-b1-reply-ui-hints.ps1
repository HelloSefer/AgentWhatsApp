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

function Text-Contains-All {
  param(
    [string]$Text,
    [string[]]$Terms
  )

  foreach ($term in $Terms) {
    if (-not $Text.Contains($term)) {
      return $false
    }
  }

  return $true
}

function Text-Contains-None {
  param(
    [string]$Text,
    [string[]]$Terms
  )

  foreach ($term in $Terms) {
    if ($Text.Contains($term)) {
      return $false
    }
  }

  return $true
}

function Option-Labels {
  param([object]$ReplyUi)

  return @($ReplyUi.options | ForEach-Object { $_.label })
}

function Has-Option-Label {
  param(
    [object]$ReplyUi,
    [string]$Label
  )

  return @(Option-Labels -ReplyUi $ReplyUi) -contains $Label
}

Write-Host "Phase 0E-B1 reply UI hint test against $BaseUrl"

$sandals = "seller_demo_sandals"
$medical = "seller_demo_medical"

$medicalPhoneA = "2126000000EB1"
Clear-Session -SellerId $medical -Phone $medicalPhoneA
$medicalStart = Send-Agent -SellerId $medical -Phone $medicalPhoneA -Message "بغيت نكوموندي"
$medicalStartUi = $medicalStart.Response.meta.replyUi

Add-Check -Name "medical order start text stays dynamic" -Passed ((Text-Contains-All -Text $medicalStart.Response.reply -Terms @("الاسم الكامل", "رقم الهاتف", "المدينة")) -and (Text-Contains-None -Text $medicalStart.Response.reply -Terms @("العنوان", "المقاس", "اللون"))) -Details $medicalStart.Response.reply
Add-Check -Name "medical order start exposes replyUi" -Passed ($null -ne $medicalStartUi) -Details ($medicalStartUi | ConvertTo-Json -Compress -Depth 10)
Add-Check -Name "medical order start ui purpose" -Passed ($medicalStartUi.purpose -eq "order_start") -Details $medicalStartUi.purpose
Add-Check -Name "medical order start ui kind safe" -Passed (@("auto", "none") -contains $medicalStartUi.kind) -Details $medicalStartUi.kind

$sandalsPhoneB = "2126000000EB2"
Clear-Session -SellerId $sandals -Phone $sandalsPhoneB
$null = Send-Agent -SellerId $sandals -Phone $sandalsPhoneB -Message "بغيت نكوموندي"
$sandalsMissingOption = Send-Agent -SellerId $sandals -Phone $sandalsPhoneB -Message "محمد 0612345678 مراكش حي السلام"
$sandalsOptionUi = $sandalsMissingOption.Response.meta.replyUi
$sandalsMissing = @($sandalsMissingOption.Response.meta.orderStateSummary.missingFields)
$hasSizeHint = (Has-Option-Label -ReplyUi $sandalsOptionUi -Label "38")
$hasColorHint = (Has-Option-Label -ReplyUi $sandalsOptionUi -Label "أسود")

Add-Check -Name "sandals has product option still missing" -Passed (($sandalsMissing -contains "size") -or ($sandalsMissing -contains "color")) -Details ($sandalsMissing -join ",")
Add-Check -Name "sandals product option exposes field_options hint" -Passed ($sandalsOptionUi.purpose -eq "field_options") -Details ($sandalsOptionUi | ConvertTo-Json -Compress -Depth 10)
Add-Check -Name "sandals field_options kind is interactive hint only" -Passed (@("buttons", "list") -contains $sandalsOptionUi.kind) -Details $sandalsOptionUi.kind
Add-Check -Name "sandals option hint uses configured options" -Passed ($hasSizeHint -or $hasColorHint) -Details ((Option-Labels -ReplyUi $sandalsOptionUi) -join ",")

$medicalPhoneC = "2126000000EB3"
Clear-Session -SellerId $medical -Phone $medicalPhoneC
$null = Send-Agent -SellerId $medical -Phone $medicalPhoneC -Message "بغيت نكوموندي"
$medicalConfirm = Send-Agent -SellerId $medical -Phone $medicalPhoneC -Message "محمد 0612345678 مراكش"
$medicalConfirmUi = $medicalConfirm.Response.meta.replyUi

Add-Check -Name "medical confirmation text asks confirmation" -Passed ($medicalConfirm.Response.reply.Contains("واش نأكد لك الطلب؟")) -Details $medicalConfirm.Response.reply
Add-Check -Name "medical confirmation ui purpose" -Passed ($medicalConfirmUi.purpose -eq "confirmation") -Details ($medicalConfirmUi | ConvertTo-Json -Compress -Depth 10)
Add-Check -Name "medical confirmation ui buttons" -Passed ($medicalConfirmUi.kind -eq "buttons") -Details $medicalConfirmUi.kind
Add-Check -Name "medical confirmation ui options" -Passed ((Has-Option-Label -ReplyUi $medicalConfirmUi -Label "نعم") -and (Has-Option-Label -ReplyUi $medicalConfirmUi -Label "تعديل")) -Details ((Option-Labels -ReplyUi $medicalConfirmUi) -join ",")

$sandalsPhoneD = "2126000000EB4"
Clear-Session -SellerId $sandals -Phone $sandalsPhoneD
$null = Send-Agent -SellerId $sandals -Phone $sandalsPhoneD -Message "بغيت نكوموندي"
$null = Send-Agent -SellerId $sandals -Phone $sandalsPhoneD -Message "مقاس 38"
$null = Send-Agent -SellerId $sandals -Phone $sandalsPhoneD -Message "مراكش"
$null = Send-Agent -SellerId $sandals -Phone $sandalsPhoneD -Message "محمد 0612345678 حي السلام"
$sandalsConfirm = Send-Agent -SellerId $sandals -Phone $sandalsPhoneD -Message "أسود 1"
$sandalsConfirmUi = $sandalsConfirm.Response.meta.replyUi

Add-Check -Name "sandals confirmation text asks confirmation" -Passed ($sandalsConfirm.Response.reply.Contains("واش نأكد لك الطلب؟")) -Details $sandalsConfirm.Response.reply
Add-Check -Name "sandals confirmation ui purpose" -Passed ($sandalsConfirmUi.purpose -eq "confirmation") -Details ($sandalsConfirmUi | ConvertTo-Json -Compress -Depth 10)
Add-Check -Name "sandals confirmation ui buttons" -Passed ($sandalsConfirmUi.kind -eq "buttons") -Details $sandalsConfirmUi.kind
Add-Check -Name "sandals confirmation ui options" -Passed ((Has-Option-Label -ReplyUi $sandalsConfirmUi -Label "نعم") -and (Has-Option-Label -ReplyUi $sandalsConfirmUi -Label "تعديل")) -Details ((Option-Labels -ReplyUi $sandalsConfirmUi) -join ",")

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
Write-Host "All Phase 0E-B1 reply UI hint checks passed."

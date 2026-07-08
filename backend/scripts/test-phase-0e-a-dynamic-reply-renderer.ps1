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

function Get-RequiredKeys {
  param([object]$Result)

  $summary = $Result.Response.meta.orderStateSummary

  if ($summary.requiredFieldKeys) {
    return @($summary.requiredFieldKeys)
  }

  return @($summary.requiredFields)
}

function Contains-All {
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

function Contains-None {
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

function Key-Set-Equals {
  param(
    [string[]]$Actual,
    [string[]]$Expected
  )

  if ($Actual.Count -ne $Expected.Count) {
    return $false
  }

  foreach ($key in $Expected) {
    if (-not ($Actual -contains $key)) {
      return $false
    }
  }

  return $true
}

Write-Host "Phase 0E-A dynamic reply renderer test against $BaseUrl"

$sandals = "seller_demo_sandals"
$medical = "seller_demo_medical"
$sandalsPhone = "2126000000E1"
$medicalPhone = "2126000000E2"
$sandalsRequired = @("fullName", "phone", "city", "address", "size", "color")
$medicalRequired = @("fullName", "phone", "city")

Clear-Session -SellerId $sandals -Phone $sandalsPhone
Clear-Session -SellerId $medical -Phone $medicalPhone

$sandalsStart = Send-Agent -SellerId $sandals -Phone $sandalsPhone -Message "بغيت نكوموندي"
$sandalsStartRequired = Get-RequiredKeys -Result $sandalsStart
Add-Check -Name "sandals order start contains all dynamic labels" -Passed (Contains-All -Text $sandalsStart.Response.reply -Terms @("الاسم الكامل", "رقم الهاتف", "المدينة", "العنوان", "المقاس", "اللون")) -Details $sandalsStart.Response.reply
Add-Check -Name "sandals meta required fields complete" -Passed (Key-Set-Equals -Actual $sandalsStartRequired -Expected $sandalsRequired) -Details ($sandalsStartRequired -join ",")

$medicalStart = Send-Agent -SellerId $medical -Phone $medicalPhone -Message "بغيت نكوموندي"
$medicalStartRequired = Get-RequiredKeys -Result $medicalStart
Add-Check -Name "medical order start contains only needed labels" -Passed ((Contains-All -Text $medicalStart.Response.reply -Terms @("الاسم الكامل", "رقم الهاتف", "المدينة")) -and (Contains-None -Text $medicalStart.Response.reply -Terms @("العنوان", "المقاس", "اللون"))) -Details $medicalStart.Response.reply
Add-Check -Name "medical meta required fields only customer essentials" -Passed (Key-Set-Equals -Actual $medicalStartRequired -Expected $medicalRequired) -Details ($medicalStartRequired -join ",")

$medicalSummary = Send-Agent -SellerId $medical -Phone $medicalPhone -Message "محمد 0612345678 مراكش"
Add-Check -Name "medical summary contains dynamic summary labels" -Passed (Contains-All -Text $medicalSummary.Response.reply -Terms @("الاسم", "الهاتف", "المدينة")) -Details $medicalSummary.Response.reply
Add-Check -Name "medical summary hides irrelevant fields" -Passed (Contains-None -Text $medicalSummary.Response.reply -Terms @("العنوان", "المقاس", "اللون")) -Details $medicalSummary.Response.reply

$null = Send-Agent -SellerId $sandals -Phone $sandalsPhone -Message "مقاس 38"
$null = Send-Agent -SellerId $sandals -Phone $sandalsPhone -Message "مراكش"
$null = Send-Agent -SellerId $sandals -Phone $sandalsPhone -Message "محمد 0612345678 حي السلام"
$sandalsSummary = Send-Agent -SellerId $sandals -Phone $sandalsPhone -Message "أسود 1"
Add-Check -Name "sandals summary contains complete dynamic labels" -Passed (Contains-All -Text $sandalsSummary.Response.reply -Terms @("الاسم", "الهاتف", "المدينة", "العنوان", "المقاس", "اللون", "الكمية")) -Details $sandalsSummary.Response.reply
Add-Check -Name "sandals reaches confirmation summary" -Passed ($sandalsSummary.Response.meta.orderStateSummary.awaitingConfirmation -eq $true -and $sandalsSummary.Response.meta.orderStateSummary.isComplete -eq $true) -Details "awaitingConfirmation=$($sandalsSummary.Response.meta.orderStateSummary.awaitingConfirmation), isComplete=$($sandalsSummary.Response.meta.orderStateSummary.isComplete)"

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
Write-Host "All Phase 0E-A dynamic reply renderer checks passed."

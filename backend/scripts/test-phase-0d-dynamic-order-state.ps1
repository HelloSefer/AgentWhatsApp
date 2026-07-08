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
    message = $Message
    useMemory = $true
    sellerId = $SellerId
    customerPhone = $Phone
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

function Get-MissingKeys {
  param([object]$Result)

  return @($Result.Response.meta.orderStateSummary.missingFields)
}

function Contains-All {
  param(
    [string[]]$Actual,
    [string[]]$Expected
  )

  foreach ($key in $Expected) {
    if (-not ($Actual -contains $key)) {
      return $false
    }
  }

  return $true
}

function Contains-None {
  param(
    [string[]]$Actual,
    [string[]]$Unexpected
  )

  foreach ($key in $Unexpected) {
    if ($Actual -contains $key) {
      return $false
    }
  }

  return $true
}

Write-Host "Phase 0D dynamic order state test against $BaseUrl"

$sandals = "seller_demo_sandals"
$medical = "seller_demo_medical"

# A + E: sandals still uses dynamic customer fields plus product options.
$sandalsPhone = "2126000000D1"
Clear-Session -SellerId $sandals -Phone $sandalsPhone
$sandalsStart = Send-Agent -SellerId $sandals -Phone $sandalsPhone -Message "بغيت نكوموندي"
$sandalsRequiredKeys = Get-RequiredKeys -Result $sandalsStart
$sandalsExpected = @("fullName", "phone", "city", "address", "size", "color")

Add-Check -Name "sandals required keys come from config" -Passed (Contains-All -Actual $sandalsRequiredKeys -Expected $sandalsExpected) -Details ($sandalsRequiredKeys -join ",")
Add-Check -Name "sandals missing keys include configured product options" -Passed (Contains-All -Actual (Get-MissingKeys -Result $sandalsStart) -Expected $sandalsExpected) -Details ((Get-MissingKeys -Result $sandalsStart) -join ",")

$null = Send-Agent -SellerId $sandals -Phone $sandalsPhone -Message "مقاس 38"
$null = Send-Agent -SellerId $sandals -Phone $sandalsPhone -Message "مراكش"
$null = Send-Agent -SellerId $sandals -Phone $sandalsPhone -Message "محمد 0612345678 حي السلام"
$sandalsComplete = Send-Agent -SellerId $sandals -Phone $sandalsPhone -Message "أسود 1"
$sandalsSummary = $sandalsComplete.Response.meta.orderStateSummary

Add-Check -Name "sandals collects size/color from product option fields" -Passed ($sandalsSummary.collected.size -eq "38" -and $sandalsSummary.collected.color -eq "أسود") -Details (($sandalsSummary.collected | ConvertTo-Json -Compress -Depth 10))
Add-Check -Name "sandals completes with configured fields" -Passed ($sandalsSummary.isComplete -eq $true -and $sandalsSummary.awaitingConfirmation -eq $true -and @($sandalsSummary.missingFields).Count -eq 0) -Details "missing=$(@($sandalsSummary.missingFields) -join ',')"

$sandalsConfirm = Send-Agent -SellerId $sandals -Phone $sandalsPhone -Message "نعم"
Add-Check -Name "sandals confirmation still works" -Passed ($sandalsConfirm.Response.meta.orderStateSummary.confirmed -eq $true) -Details "confirmed=$($sandalsConfirm.Response.meta.orderStateSummary.confirmed)"

# B: medical only requires fullName, phone, city.
$medicalPhone = "2126000000D2"
Clear-Session -SellerId $medical -Phone $medicalPhone
$medicalStart = Send-Agent -SellerId $medical -Phone $medicalPhone -Message "بغيت نكوموندي"
$medicalRequiredKeys = Get-RequiredKeys -Result $medicalStart
$medicalMissingStart = Get-MissingKeys -Result $medicalStart

Add-Check -Name "medical required keys exclude address size color" -Passed ((Contains-All -Actual $medicalRequiredKeys -Expected @("fullName", "phone", "city")) -and (Contains-None -Actual $medicalRequiredKeys -Unexpected @("address", "size", "color"))) -Details ($medicalRequiredKeys -join ",")
Add-Check -Name "medical order start asks only required fields" -Passed ((Contains-All -Actual $medicalMissingStart -Expected @("fullName", "phone", "city")) -and (Contains-None -Actual $medicalMissingStart -Unexpected @("address", "size", "color"))) -Details ($medicalStart.Response.reply)

$medicalComplete = Send-Agent -SellerId $medical -Phone $medicalPhone -Message "محمد 0612345678 مراكش"
$medicalSummary = $medicalComplete.Response.meta.orderStateSummary

Add-Check -Name "medical completes with name phone city only" -Passed ($medicalSummary.isComplete -eq $true -and $medicalSummary.awaitingConfirmation -eq $true -and @($medicalSummary.missingFields).Count -eq 0) -Details (($medicalSummary.collected | ConvertTo-Json -Compress -Depth 10))
Add-Check -Name "medical confirmation summary excludes disabled fields" -Passed (($medicalComplete.Response.reply -notmatch "العنوان") -and ($medicalComplete.Response.reply -notmatch "المقاس") -and ($medicalComplete.Response.reply -notmatch "اللون")) -Details $medicalComplete.Response.reply

$medicalConfirm = Send-Agent -SellerId $medical -Phone $medicalPhone -Message "نعم"
Add-Check -Name "medical confirmation works without address size color" -Passed ($medicalConfirm.Response.meta.orderStateSummary.confirmed -eq $true) -Details "confirmed=$($medicalConfirm.Response.meta.orderStateSummary.confirmed)"

# C: partial medical follow-up keeps only remaining configured fields.
$medicalPartialPhone = "2126000000D3"
Clear-Session -SellerId $medical -Phone $medicalPartialPhone
$null = Send-Agent -SellerId $medical -Phone $medicalPartialPhone -Message "بغيت نكوموندي"
$medicalPartial = Send-Agent -SellerId $medical -Phone $medicalPartialPhone -Message "سارة"
$medicalPartialMissing = Get-MissingKeys -Result $medicalPartial

Add-Check -Name "medical partial name leaves only phone city missing" -Passed (($medicalPartial.Response.meta.orderStateSummary.collected.fullName -eq "سارة") -and (Contains-All -Actual $medicalPartialMissing -Expected @("phone", "city")) -and (Contains-None -Actual $medicalPartialMissing -Unexpected @("address", "size", "color"))) -Details (($medicalPartial.Response.meta.orderStateSummary.collected | ConvertTo-Json -Compress -Depth 10))

# D: same phone, two sellers, isolated dynamic required fields.
$sharedPhone = "2126000000D4"
Clear-Session -SellerId $sandals -Phone $sharedPhone
Clear-Session -SellerId $medical -Phone $sharedPhone
$sharedSandals = Send-Agent -SellerId $sandals -Phone $sharedPhone -Message "بغيت نكوموندي"
$sharedMedical = Send-Agent -SellerId $medical -Phone $sharedPhone -Message "بغيت نكوموندي"

Add-Check -Name "same phone sandals has sandal required fields" -Passed (Contains-All -Actual (Get-RequiredKeys -Result $sharedSandals) -Expected $sandalsExpected) -Details ((Get-RequiredKeys -Result $sharedSandals) -join ",")
Add-Check -Name "same phone medical has medical required fields" -Passed ((Contains-All -Actual (Get-RequiredKeys -Result $sharedMedical) -Expected @("fullName", "phone", "city")) -and (Contains-None -Actual (Get-RequiredKeys -Result $sharedMedical) -Unexpected @("address", "size", "color"))) -Details ((Get-RequiredKeys -Result $sharedMedical) -join ",")
Add-Check -Name "same phone sellers keep separate conversation keys" -Passed ($sharedSandals.Response.identity.conversationKey -ne $sharedMedical.Response.identity.conversationKey) -Details "$($sharedSandals.Response.identity.conversationKey) / $($sharedMedical.Response.identity.conversationKey)"

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
Write-Host "All Phase 0D dynamic order state checks passed."

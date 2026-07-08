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
  param([string]$Path)

  $uri = "{0}{1}" -f $BaseUrl, $Path
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $response = Invoke-RestMethod -Method GET -Uri $uri
  $watch.Stop()

  $script:calls.Add([PSCustomObject]@{
    Path = $Path
    DurationMs = [int]$watch.ElapsedMilliseconds
    SellerId = $response.sellerId
    FallbackUsed = $response.fallbackUsed
  })

  return $response
}

function Get-RequiredField {
  param(
    [object]$Config,
    [string]$Key
  )

  return @($Config.requiredOrderFields | Where-Object { $_.key -eq $Key })[0]
}

function Has-Key {
  param(
    [object]$Config,
    [string]$Key
  )

  return @($Config.requiredOrderFieldKeys) -contains $Key
}

Write-Host "Phase 0C required fields test against $BaseUrl"

$sandals = Invoke-TimedGet -Path "/api/agent/config/seller_demo_sandals"
$sandalsExpected = @("fullName", "phone", "city", "address", "size", "color")

foreach ($key in $sandalsExpected) {
  Add-Check -Name "sandals required key $key" -Passed (Has-Key -Config $sandals -Key $key) -Details (@($sandals.requiredOrderFieldKeys) -join ",")
}

foreach ($key in @("fullName", "phone", "city", "address")) {
  $field = Get-RequiredField -Config $sandals -Key $key
  Add-Check -Name "sandals $key source customerField" -Passed ($field.source -eq "customerField") -Details $field.source
}

$sandalsSize = Get-RequiredField -Config $sandals -Key "size"
$sandalsColor = Get-RequiredField -Config $sandals -Key "color"

Add-Check -Name "sandals size source productOption" -Passed ($sandalsSize.source -eq "productOption") -Details $sandalsSize.source
Add-Check -Name "sandals color source productOption" -Passed ($sandalsColor.source -eq "productOption") -Details $sandalsColor.source
Add-Check -Name "sandals size options include 38" -Passed (@($sandalsSize.options) -contains "38") -Details (@($sandalsSize.options) -join ",")
Add-Check -Name "sandals color options include أسود" -Passed (@($sandalsColor.options) -contains "أسود") -Details (@($sandalsColor.options) -join ",")

$medical = Invoke-TimedGet -Path "/api/agent/config/seller_demo_medical"

foreach ($key in @("fullName", "phone", "city")) {
  Add-Check -Name "medical required key $key" -Passed (Has-Key -Config $medical -Key $key) -Details (@($medical.requiredOrderFieldKeys) -join ",")
  $field = Get-RequiredField -Config $medical -Key $key
  Add-Check -Name "medical $key source customerField" -Passed ($field.source -eq "customerField") -Details $field.source
}

foreach ($key in @("address", "size", "color")) {
  Add-Check -Name "medical excludes $key" -Passed (-not (Has-Key -Config $medical -Key $key)) -Details (@($medical.requiredOrderFieldKeys) -join ",")
}

$medicalProductOptions = @($medical.requiredOrderFields | Where-Object { $_.source -eq "productOption" })
Add-Check -Name "medical has no product option required fields" -Passed ($medicalProductOptions.Count -eq 0) -Details "count=$($medicalProductOptions.Count)"
Add-Check -Name "medical safety config remains present" -Passed ($medical.productContext.safety.medicalDisclaimer -eq $true) -Details "medicalDisclaimer=$($medical.productContext.safety.medicalDisclaimer)"

$fallback = Invoke-TimedGet -Path "/api/agent/config/seller_unknown_phase_0c"
Add-Check -Name "unknown seller fallback used" -Passed ($fallback.fallbackUsed -eq $true) -Details "fallbackUsed=$($fallback.fallbackUsed)"
Add-Check -Name "unknown seller fallback seller id" -Passed ($fallback.sellerId -eq "seller_demo_sandals") -Details $fallback.sellerId

foreach ($key in $sandalsExpected) {
  Add-Check -Name "fallback required key $key" -Passed (Has-Key -Config $fallback -Key $key) -Details (@($fallback.requiredOrderFieldKeys) -join ",")
}

$requiredEndpoint = Invoke-TimedGet -Path "/api/agent/config/seller_demo_sandals/required-fields"
Add-Check -Name "standalone required endpoint returns keys" -Passed ((@($requiredEndpoint.requiredOrderFieldKeys) -join ",") -eq ((@($sandals.requiredOrderFieldKeys) -join ","))) -Details (@($requiredEndpoint.requiredOrderFieldKeys) -join ",")

Write-Host ""
$calls | Format-Table -AutoSize

Write-Host ""
$checks | Format-Table -AutoSize -Wrap

$failed = @($checks | Where-Object { -not $_.Passed })

if ($failed.Count -gt 0) {
  Write-Host ""
  Write-Host "Failed checks: $($failed.Count)"
  exit 1
}

Write-Host ""
Write-Host "All Phase 0C required fields checks passed."

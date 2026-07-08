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

function Get-OptionGroup {
  param(
    [object]$ProductContext,
    [string]$Key
  )

  return @($ProductContext.optionGroups | Where-Object { $_.key -eq $Key })[0]
}

function Has-CustomerField {
  param(
    [object]$SellerConfig,
    [string]$Key
  )

  return [bool](@($SellerConfig.customerFields | Where-Object { $_.key -eq $Key }).Count)
}

Write-Host "Phase 0B config model test against $BaseUrl"

$sandals = Invoke-TimedGet -Path "/api/agent/config/seller_demo_sandals"
$sandalsSize = Get-OptionGroup -ProductContext $sandals.productContext -Key "size"
$sandalsColor = Get-OptionGroup -ProductContext $sandals.productContext -Key "color"

Add-Check -Name "sandals seller id" -Passed ($sandals.sellerId -eq "seller_demo_sandals") -Details $sandals.sellerId
Add-Check -Name "sandals product name" -Passed ($sandals.productContext.name -eq "صندالة نسائية") -Details $sandals.productContext.name
Add-Check -Name "sandals has size option group" -Passed ($null -ne $sandalsSize) -Details ($sandalsSize.options -join ",")
Add-Check -Name "sandals size includes 38" -Passed (@($sandalsSize.options) -contains "38") -Details ($sandalsSize.options -join ",")
Add-Check -Name "sandals has color option group" -Passed ($null -ne $sandalsColor) -Details ($sandalsColor.options -join ",")
Add-Check -Name "sandals color includes أسود" -Passed (@($sandalsColor.options) -contains "أسود") -Details ($sandalsColor.options -join ",")
Add-Check -Name "sandals customer field fullName" -Passed (Has-CustomerField -SellerConfig $sandals.sellerConfig -Key "fullName")
Add-Check -Name "sandals customer field phone" -Passed (Has-CustomerField -SellerConfig $sandals.sellerConfig -Key "phone")
Add-Check -Name "sandals customer field city" -Passed (Has-CustomerField -SellerConfig $sandals.sellerConfig -Key "city")
Add-Check -Name "sandals customer field address" -Passed (Has-CustomerField -SellerConfig $sandals.sellerConfig -Key "address")

$medical = Invoke-TimedGet -Path "/api/agent/config/seller_demo_medical"
$medicalSize = Get-OptionGroup -ProductContext $medical.productContext -Key "size"
$medicalColor = Get-OptionGroup -ProductContext $medical.productContext -Key "color"
$medicalAddress = @($medical.sellerConfig.customerFields | Where-Object { $_.key -eq "address" })[0]

Add-Check -Name "medical seller id" -Passed ($medical.sellerId -eq "seller_demo_medical") -Details $medical.sellerId
Add-Check -Name "medical product name" -Passed ($medical.productContext.name -eq "كريم طبي") -Details $medical.productContext.name
Add-Check -Name "medical has no size option group" -Passed ($null -eq $medicalSize)
Add-Check -Name "medical has no color option group" -Passed ($null -eq $medicalColor)
Add-Check -Name "medical disclaimer enabled" -Passed ($medical.productContext.safety.medicalDisclaimer -eq $true)
Add-Check -Name "medical customer field fullName" -Passed (Has-CustomerField -SellerConfig $medical.sellerConfig -Key "fullName")
Add-Check -Name "medical customer field phone" -Passed (Has-CustomerField -SellerConfig $medical.sellerConfig -Key "phone")
Add-Check -Name "medical customer field city" -Passed (Has-CustomerField -SellerConfig $medical.sellerConfig -Key "city")
Add-Check -Name "medical address disabled or optional" -Passed ($medicalAddress.enabled -eq $false -or $medicalAddress.required -eq $false) -Details "enabled=$($medicalAddress.enabled), required=$($medicalAddress.required)"

$fallback = Invoke-TimedGet -Path "/api/agent/config/seller_unknown_phase_0b"
Add-Check -Name "unknown seller falls back" -Passed ($fallback.fallbackUsed -eq $true) -Details "fallbackUsed=$($fallback.fallbackUsed)"
Add-Check -Name "fallback seller is sandals" -Passed ($fallback.sellerId -eq "seller_demo_sandals") -Details $fallback.sellerId
Add-Check -Name "fallback product is sandals" -Passed ($fallback.productContext.name -eq "صندالة نسائية") -Details $fallback.productContext.name

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
Write-Host "All Phase 0B config model checks passed."

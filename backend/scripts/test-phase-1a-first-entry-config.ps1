param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$checks = New-Object System.Collections.Generic.List[object]
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendRoot = Resolve-Path (Join-Path $scriptRoot "..")

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

function Invoke-NodeConfigSnapshot {
  $nodeScript = @'
const path = require("path");
const fromBackend = (...segments) => require(path.join(process.cwd(), ...segments));
const {
  getDefaultFirstEntryPolicy,
  normalizeFirstEntryPolicy,
  normalizeDeliveryPolicy,
  normalizeSellerConfig,
} = fromBackend("dist", "modules", "agent", "config", "first-entry-config.service.js");
const {
  demoSellerConfigs,
} = fromBackend("dist", "modules", "agent", "config", "demo-seller-configs.js");
const {
  demoProductContexts,
} = fromBackend("dist", "modules", "agent", "config", "demo-product-contexts.js");
const {
  requiredFieldsService,
} = fromBackend("dist", "modules", "agent", "config", "required-fields.service.js");

const productForSeller = (sellerId) =>
  demoProductContexts.find((context) => context.sellerId === sellerId && context.active);
const sellerById = (sellerId) =>
  demoSellerConfigs.find((config) => config.sellerId === sellerId);

const sandalsSeller = sellerById("seller_demo_sandals");
const medicalSeller = sellerById("seller_demo_medical");
const notMentionedSeller = sellerById("seller_demo_not_mentioned");
const sandalsProduct = productForSeller("seller_demo_sandals");
const medicalProduct = productForSeller("seller_demo_medical");
const notMentionedProduct = productForSeller("seller_demo_not_mentioned");

const normalizedSellers = demoSellerConfigs.map((sellerConfig) => {
  const product = productForSeller(sellerConfig.sellerId);
  return normalizeSellerConfig(sellerConfig, product && product.price);
});

const requiredFields = {
  sandals: requiredFieldsService.getRequiredOrderFields({
    sellerConfig: normalizeSellerConfig(sandalsSeller, sandalsProduct.price),
    productContext: sandalsProduct,
  }),
  medical: requiredFieldsService.getRequiredOrderFields({
    sellerConfig: normalizeSellerConfig(medicalSeller, medicalProduct.price),
    productContext: medicalProduct,
  }),
};

const snapshot = {
  defaultFirstEntry: getDefaultFirstEntryPolicy(199),
  missingPriceFirstEntry: normalizeFirstEntryPolicy({ showPrice: true }, undefined),
  allCitiesDelivery: normalizeDeliveryPolicy({ availability: "all_cities" }),
  selectedCitiesDelivery: normalizeDeliveryPolicy({
    availability: "selected_cities",
    cities: ["الدار البيضاء", "مراكش"],
  }),
  excludedCitiesDelivery: normalizeDeliveryPolicy({
    availability: "excluded_cities",
    excludedCities: ["طنجة", "أكادير"],
  }),
  notAvailableDelivery: normalizeDeliveryPolicy({
    enabled: false,
    availability: "not_available",
  }),
  notMentionedDelivery: normalizeDeliveryPolicy({
    enabled: false,
    availability: "not_mentioned",
  }),
  fixtureCoverage: {
    normal: normalizedSellers.some((seller) =>
      seller.firstEntryPolicy.enabled === true &&
      seller.firstEntryPolicy.showPrice === true &&
      seller.deliveryPolicy.availability === "all_cities" &&
      seller.firstEntryPolicy.greetingStyle === "friendly" &&
      seller.firstEntryPolicy.ctaMode === "order_or_info"
    ),
    professional: normalizedSellers.some((seller) =>
      seller.firstEntryPolicy.greetingStyle === "professional"
    ),
    selectedCities: normalizedSellers.some((seller) =>
      seller.deliveryPolicy.availability === "selected_cities" &&
      Array.isArray(seller.deliveryPolicy.cities) &&
      seller.deliveryPolicy.cities.length >= 2
    ),
    notMentioned: normalizedSellers.some((seller) =>
      seller.deliveryPolicy.availability === "not_mentioned"
    ),
    deliveryPriceMapped: normalizeDeliveryPolicy(undefined, medicalSeller.delivery).deliveryPrice,
    allSellerIds: normalizedSellers.map((seller) => seller.sellerId),
  },
  requiredFields,
  notMentionedProduct,
};

console.log(JSON.stringify(snapshot));
'@

  Push-Location $backendRoot
  $tempJsPath = Join-Path ([System.IO.Path]::GetTempPath()) ("phase-1a-config-{0}.js" -f ([System.Guid]::NewGuid().ToString("N")))
  try {
    [System.IO.File]::WriteAllText(
      $tempJsPath,
      $nodeScript,
      [System.Text.UTF8Encoding]::new($false)
    )

    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $output = & node $tempJsPath
    $exitCode = $LASTEXITCODE
    $watch.Stop()

    if ($exitCode -ne 0) {
      throw "Node config snapshot failed with exit code $exitCode"
    }

    return [PSCustomObject]@{
      Response = ($output | ConvertFrom-Json)
      DurationMs = [int]$watch.ElapsedMilliseconds
    }
  } finally {
    if (Test-Path $tempJsPath) {
      Remove-Item -LiteralPath $tempJsPath -Force
    }
    Pop-Location
  }
}

$distHelper = Join-Path $backendRoot "dist\modules\agent\config\first-entry-config.service.js"
if (-not (Test-Path $distHelper)) {
  throw "Built config helper not found at $distHelper. Run npm run build from backend before this script."
}

$snapshotTimed = Invoke-NodeConfigSnapshot
$data = $snapshotTimed.Response
$duration = $snapshotTimed.DurationMs

$group = "A First entry defaults"
Add-Check $group "default policy enabled" ($data.defaultFirstEntry.enabled -eq $true) "" $duration
Add-Check $group "default ctaMode order_or_info" ($data.defaultFirstEntry.ctaMode -eq "order_or_info") $data.defaultFirstEntry.ctaMode $duration
Add-Check $group "default greeting friendly" ($data.defaultFirstEntry.greetingStyle -eq "friendly") $data.defaultFirstEntry.greetingStyle $duration
Add-Check $group "default primary CTA label" ($data.defaultFirstEntry.primaryCtaLabel -eq "أطلب الآن") $data.defaultFirstEntry.primaryCtaLabel $duration
Add-Check $group "default secondary CTA label" ($data.defaultFirstEntry.secondaryCtaLabel -eq "المزيد من المعلومات") $data.defaultFirstEntry.secondaryCtaLabel $duration
Add-Check $group "missing price disables showPrice" ($data.missingPriceFirstEntry.showPrice -eq $false) "showPrice=$($data.missingPriceFirstEntry.showPrice)" $duration

$group = "B Delivery policy variants"
Add-Check $group "supports all_cities" ($data.allCitiesDelivery.availability -eq "all_cities") $data.allCitiesDelivery.availability $duration
Add-Check $group "supports selected_cities" ($data.selectedCitiesDelivery.availability -eq "selected_cities" -and @($data.selectedCitiesDelivery.cities).Count -eq 2) (($data.selectedCitiesDelivery.cities -join ", ")) $duration
Add-Check $group "supports excluded_cities" ($data.excludedCitiesDelivery.availability -eq "excluded_cities" -and @($data.excludedCitiesDelivery.excludedCities).Count -eq 2) (($data.excludedCitiesDelivery.excludedCities -join ", ")) $duration
Add-Check $group "supports not_available" ($data.notAvailableDelivery.availability -eq "not_available") $data.notAvailableDelivery.availability $duration
Add-Check $group "supports not_mentioned" ($data.notMentionedDelivery.availability -eq "not_mentioned") $data.notMentionedDelivery.availability $duration
Add-Check $group "maps legacy delivery price" ($data.fixtureCoverage.deliveryPriceMapped -eq 25) "deliveryPrice=$($data.fixtureCoverage.deliveryPriceMapped)" $duration

$group = "C Fixture coverage"
Add-Check $group "normal seller/product fixture exists" ($data.fixtureCoverage.normal -eq $true) "" $duration
Add-Check $group "professional greeting fixture exists" ($data.fixtureCoverage.professional -eq $true) "" $duration
Add-Check $group "selected cities fixture exists" ($data.fixtureCoverage.selectedCities -eq $true) "" $duration
Add-Check $group "not mentioned delivery fixture exists" ($data.fixtureCoverage.notMentioned -eq $true) "" $duration
Add-Check $group "not mentioned product fixture exists" ($null -ne $data.notMentionedProduct -and $data.notMentionedProduct.active -eq $true) $data.notMentionedProduct.productId $duration

$group = "D Existing config safety"
Add-Check $group "sandals required fields compile" (@($data.requiredFields.sandals).Count -ge 6) "count=$(@($data.requiredFields.sandals).Count)" $duration
Add-Check $group "medical required fields compile" (@($data.requiredFields.medical).Count -ge 3) "count=$(@($data.requiredFields.medical).Count)" $duration

$failed = @($checks | Where-Object { -not $_.Passed })
$passed = $checks.Count - $failed.Count

Write-Host "Phase 1A first entry config checks:"
$checks | Sort-Object Group, CheckName | Format-Table Group, CheckName, Passed, Details, DurationMs -AutoSize

Write-Host ("Total checks: {0}" -f $checks.Count)
Write-Host ("Passed: {0}" -f $passed)
Write-Host ("Failed: {0}" -f $failed.Count)

if ($failed.Count -gt 0) {
  throw ("Phase 1A checks failed: {0}" -f (($failed | ForEach-Object { "$($_.Group): $($_.CheckName)" }) -join ", "))
}

Write-Host "All Phase 1A first entry config checks passed."

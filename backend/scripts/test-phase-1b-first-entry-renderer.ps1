param(
  [string]$BaseUrl = "http://localhost:5000"
)

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

function Invoke-TimedJson {
  param(
    [ValidateSet("GET", "DELETE")]
    [string]$Method,
    [string]$Uri
  )

  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $response = Invoke-RestMethod -Method $Method -Uri $Uri
  $watch.Stop()

  return [PSCustomObject]@{
    Response = $response
    DurationMs = [int]$watch.ElapsedMilliseconds
  }
}

function Invoke-NodeRendererSnapshot {
  $nodeScript = @'
const path = require("path");
const fromBackend = (...segments) => require(path.join(process.cwd(), ...segments));
const {
  normalizeSellerConfig,
} = fromBackend("dist", "modules", "agent", "config", "first-entry-config.service.js");
const {
  renderFirstEntryMessage,
} = fromBackend("dist", "modules", "agent", "config", "first-entry-renderer.service.js");
const {
  demoSellerConfigs,
} = fromBackend("dist", "modules", "agent", "config", "demo-seller-configs.js");
const {
  demoProductContexts,
} = fromBackend("dist", "modules", "agent", "config", "demo-product-contexts.js");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const baseSellerRaw = demoSellerConfigs.find((seller) => seller.sellerId === "seller_demo_sandals");
const baseProduct = demoProductContexts.find((product) => product.sellerId === "seller_demo_sandals");
const baseSeller = normalizeSellerConfig(baseSellerRaw, baseProduct.price);

function buildSeller({ policy = {}, deliveryPolicy = {}, delivery = {} } = {}) {
  const seller = clone(baseSeller);
  seller.firstEntryPolicy = {
    ...seller.firstEntryPolicy,
    ...policy,
  };
  seller.deliveryPolicy = {
    ...seller.deliveryPolicy,
    ...deliveryPolicy,
  };
  seller.delivery = {
    ...seller.delivery,
    ...delivery,
  };
  return seller;
}

function renderCase(input) {
  const product = input.product ? { ...clone(baseProduct), ...input.product } : clone(baseProduct);
  if (input.deletePrice) {
    delete product.price;
  }
  const result = renderFirstEntryMessage({
    sellerConfig: buildSeller(input),
    productContext: product,
  });

  return {
    text: result.text,
    lines: result.lines,
    warnings: result.warnings || [],
    ctaMode: result.ctaMode,
    ctas: result.ctas,
    uiHints: result.uiHints,
    previewOnly: result.previewOnly,
    primaryCtaLabel: result.primaryCtaLabel,
    secondaryCtaLabel: result.secondaryCtaLabel,
  };
}

const cases = {
  friendly: renderCase({ policy: { greetingStyle: "friendly" } }),
  short: renderCase({ policy: { greetingStyle: "short" } }),
  professional: renderCase({ policy: { greetingStyle: "professional" } }),
  showProductName: renderCase({ policy: { showProductName: true } }),
  hideProductName: renderCase({ policy: { showProductName: false } }),
  priceShown: renderCase({ policy: { showPrice: true } }),
  priceMissing: renderCase({ policy: { showPrice: true }, deletePrice: true }),
  allCities: renderCase({
    deliveryPolicy: { enabled: true, availability: "all_cities", isFree: false },
  }),
  allCitiesFree: renderCase({
    deliveryPolicy: { enabled: true, availability: "all_cities", isFree: true },
  }),
  allCitiesPrice: renderCase({
    deliveryPolicy: {
      enabled: true,
      availability: "all_cities",
      isFree: false,
      deliveryPrice: 25,
      currency: "MAD",
    },
  }),
  selectedCities: renderCase({
    deliveryPolicy: {
      enabled: true,
      availability: "selected_cities",
      cities: ["الدار البيضاء", "مراكش", "الرباط"],
    },
  }),
  excludedCities: renderCase({
    deliveryPolicy: {
      enabled: true,
      availability: "excluded_cities",
      excludedCities: ["طنجة", "أكادير"],
    },
  }),
  notAvailableDelivery: renderCase({
    deliveryPolicy: { enabled: true, availability: "not_available" },
  }),
  notMentionedDelivery: renderCase({
    deliveryPolicy: { enabled: true, availability: "not_mentioned" },
  }),
  paymentShown: renderCase({
    policy: { showPayment: true },
    delivery: { paymentOnDelivery: true, paymentText: "الدفع عند الاستلام" },
  }),
  paymentHidden: renderCase({
    policy: { showPayment: false },
    delivery: { paymentOnDelivery: true, paymentText: "الدفع عند الاستلام" },
  }),
  trustShown: renderCase({ policy: { showTrustLine: true } }),
  ctaOrderOrInfo: renderCase({ policy: { ctaMode: "order_or_info" } }),
  ctaOrderOnly: renderCase({ policy: { ctaMode: "order_only" } }),
  ctaInfoOnly: renderCase({ policy: { ctaMode: "info_only" } }),
  ctaNone: renderCase({ policy: { ctaMode: "none" } }),
  disabled: renderCase({ policy: { enabled: false } }),
};

const allText = Object.values(cases).map((entry) => entry.text).join("\n");

console.log(JSON.stringify({
  cases,
  allText,
  productName: baseProduct.name,
}));
'@

  Push-Location $backendRoot
  $tempJsPath = Join-Path ([System.IO.Path]::GetTempPath()) ("phase-1b-renderer-{0}.js" -f ([System.Guid]::NewGuid().ToString("N")))
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
      throw "Node renderer snapshot failed with exit code $exitCode"
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

$distRenderer = Join-Path $backendRoot "dist\modules\agent\config\first-entry-renderer.service.js"
if (-not (Test-Path $distRenderer)) {
  throw "Built renderer not found at $distRenderer. Run npm run build from backend before this script."
}

$snapshotTimed = Invoke-NodeRendererSnapshot
$data = $snapshotTimed.Response
$cases = $data.cases
$duration = $snapshotTimed.DurationMs

$group = "A Renderer styles"
Add-Check $group "friendly greeting renders" ($cases.friendly.text.Contains("سلام") -and $cases.friendly.text.Contains("مرحبا")) $cases.friendly.text $duration
Add-Check $group "short CTA style renders" ($cases.short.text.Contains("السلام عليكم 👋 مرحبا بك") -and $cases.short.text.Contains("بغيتي تطلب دابا ولا تشوف معلومات أكثر؟")) $cases.short.text $duration
Add-Check $group "professional CTA style renders" ($cases.professional.text.Contains("السلام عليكم 👋 مرحبا بك") -and $cases.professional.text.Contains("هل ترغب في إتمام الطلب أم الاطلاع على المزيد من المعلومات؟")) $cases.professional.text $duration

$group = "B Product and price"
Add-Check $group "product name appears when enabled" ($cases.showProductName.text.Contains($data.productName)) $cases.showProductName.text $duration
Add-Check $group "product name hidden when disabled" (-not $cases.hideProductName.text.Contains($data.productName) -and $cases.hideProductName.text.Contains("المنتج")) $cases.hideProductName.text $duration
Add-Check $group "product availability uses approved commercial line" ($cases.showProductName.text.Contains(("{0} متوفرة دابا" -f $data.productName))) $cases.showProductName.text $duration
Add-Check $group "price appears inline when configured" ($cases.priceShown.text.Contains("بـ199 درهم،")) $cases.priceShown.text $duration
Add-Check $group "missing price omitted" (-not $cases.priceMissing.text.Contains("بـ") -and $cases.priceMissing.warnings -contains "price_missing") ($cases.priceMissing.warnings -join ", ") $duration
Add-Check $group "no undefined or null text" (-not ($data.allText -match "undefined|null")) "" $duration

$group = "C Delivery rendering"
Add-Check $group "all_cities renders" ($cases.allCities.text.Contains("والتوصيل متوفر لجميع المدن 🚚")) $cases.allCities.text $duration
Add-Check $group "all_cities free renders" ($cases.allCitiesFree.text.Contains("والتوصيل متوفر لجميع المدن بالمجان 🚚")) $cases.allCitiesFree.text $duration
Add-Check $group "all_cities delivery price renders" ($cases.allCitiesPrice.text.Contains("والتوصيل متوفر لجميع المدن بثمن 25 درهم 🚚")) $cases.allCitiesPrice.text $duration
Add-Check $group "selected_cities renders list" ($cases.selectedCities.text.Contains("الدار البيضاء") -and $cases.selectedCities.text.Contains("مراكش") -and $cases.selectedCities.text.Contains("الرباط")) $cases.selectedCities.text $duration
Add-Check $group "excluded_cities renders list" ($cases.excludedCities.text.Contains("ما عدا") -and $cases.excludedCities.text.Contains("طنجة") -and $cases.excludedCities.text.Contains("أكادير")) $cases.excludedCities.text $duration
Add-Check $group "not_available renders safe line" ($cases.notAvailableDelivery.text.Contains("والتوصيل غير متوفر حالياً 🚚")) $cases.notAvailableDelivery.text $duration
Add-Check $group "not_mentioned omits delivery" (-not $cases.notMentionedDelivery.text.Contains("التوصيل")) $cases.notMentionedDelivery.text $duration

$group = "D Payment trust and CTA"
Add-Check $group "compact opening does not duplicate payment line" (-not $cases.paymentShown.text.Contains("الدفع عند الاستلام متوفر.")) $cases.paymentShown.text $duration
Add-Check $group "payment line hidden when disabled" (-not $cases.paymentHidden.text.Contains("الاستلام")) $cases.paymentHidden.text $duration
Add-Check $group "compact opening does not add a separate trust line" (-not $cases.trustShown.text.Contains("تأكيد تفاصيل الطلب")) $cases.trustShown.text $duration
Add-Check $group "order_or_info CTA renders" ($cases.ctaOrderOrInfo.text.Contains("الطلب") -and $cases.ctaOrderOrInfo.text.Contains("معلومات")) $cases.ctaOrderOrInfo.text $duration
Add-Check $group "order_only CTA renders" ($cases.ctaOrderOnly.text.Contains("الطلب") -and -not $cases.ctaOrderOnly.text.Contains("معلومات أكثر؟")) $cases.ctaOrderOnly.text $duration
Add-Check $group "info_only CTA renders" ($cases.ctaInfoOnly.text.Contains("معلومات أكثر") -and -not $cases.ctaInfoOnly.text.Contains("دير الطلب")) $cases.ctaInfoOnly.text $duration
Add-Check $group "none CTA renders no question" (-not $cases.ctaNone.text.Contains("؟")) $cases.ctaNone.text $duration
Add-Check $group "disabled policy returns warning" ($cases.disabled.text -eq "" -and $cases.disabled.previewOnly -eq $true -and $cases.disabled.warnings -contains "first_entry_disabled") ($cases.disabled.warnings -join ", ") $duration

$group = "E Preview endpoint safety"
$previewTimed = Invoke-TimedJson -Method GET -Uri ("{0}/api/agent/config/seller_demo_sandals/first-entry-preview" -f $BaseUrl)
$preview = $previewTimed.Response
$previewJson = $preview | ConvertTo-Json -Depth 80
Add-Check $group "preview endpoint ok" ($preview.ok -eq $true -and $preview.previewOnly -eq $true) "" $previewTimed.DurationMs
Add-Check $group "preview result previewOnly" ($preview.result.previewOnly -eq $true) "" $previewTimed.DurationMs
Add-Check $group "preview includes approved commercial text" ([string]$preview.result.text -and $preview.result.text.Contains("بـ199 درهم،") -and $preview.result.text.Contains("التوصيل")) $preview.result.text $previewTimed.DurationMs
Add-Check $group "preview includes CTA metadata" ($preview.result.ctas.previewOnly -eq $true -and @($preview.result.ctas.items).Count -ge 1) "count=$(@($preview.result.ctas.items).Count)" $previewTimed.DurationMs
Add-Check $group "preview has no send payload" (-not $previewJson.Contains("messaging_product") -and -not $previewJson.Contains("dispatchResult") -and -not $previewJson.Contains("interactiveResult")) "" $previewTimed.DurationMs

$sessionCustomer = "phase-1b-preview-session"
[void](Invoke-TimedJson -Method DELETE -Uri ("{0}/api/agent/session/{1}?sellerId=seller_demo_sandals" -f $BaseUrl, $sessionCustomer))
[void](Invoke-TimedJson -Method GET -Uri ("{0}/api/agent/config/seller_demo_sandals/first-entry-preview" -f $BaseUrl))
$sessionTimed = Invoke-TimedJson -Method GET -Uri ("{0}/api/agent/session/{1}?sellerId=seller_demo_sandals" -f $BaseUrl, $sessionCustomer)
$session = $sessionTimed.Response
Add-Check $group "preview does not mutate session messages" ($session.messageCount -eq 0) "messageCount=$($session.messageCount)" $sessionTimed.DurationMs
Add-Check $group "preview does not mutate order state" (
  $session.orderState.confirmed -eq $false -and
  $session.orderState.awaitingConfirmation -eq $false -and
  $session.orderState.isComplete -eq $false -and
  @($session.orderState.missingFields).Count -eq 0
) "isComplete=$($session.orderState.isComplete)" $sessionTimed.DurationMs

$failed = @($checks | Where-Object { -not $_.Passed })
$passed = $checks.Count - $failed.Count

Write-Host "Phase 1B first entry renderer checks:"
$checks | Sort-Object Group, CheckName | Format-Table Group, CheckName, Passed, Details, DurationMs -AutoSize

Write-Host ("Total checks: {0}" -f $checks.Count)
Write-Host ("Passed: {0}" -f $passed)
Write-Host ("Failed: {0}" -f $failed.Count)

if ($failed.Count -gt 0) {
  throw ("Phase 1B checks failed: {0}" -f (($failed | ForEach-Object { "$($_.Group): $($_.CheckName)" }) -join ", "))
}

Write-Host "All Phase 1B first entry renderer checks passed."

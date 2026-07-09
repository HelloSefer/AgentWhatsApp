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
    [ValidateSet("GET", "POST", "DELETE")]
    [string]$Method,
    [string]$Uri,
    [object]$Body = $null
  )

  $watch = [System.Diagnostics.Stopwatch]::StartNew()

  if ($null -eq $Body) {
    $response = Invoke-RestMethod -Method $Method -Uri $Uri
  } else {
    $json = $Body | ConvertTo-Json -Depth 80
    $utf8Body = [System.Text.Encoding]::UTF8.GetBytes($json)
    $response = Invoke-RestMethod -Method $Method -Uri $Uri -ContentType "application/json; charset=utf-8" -Body $utf8Body
  }

  $watch.Stop()

  return [PSCustomObject]@{
    Response = $response
    DurationMs = [int]$watch.ElapsedMilliseconds
  }
}

function Invoke-IntentPreview {
  param(
    [string]$Message,
    [string]$SellerId = "seller_demo_sandals"
  )

  return Invoke-TimedJson -Method POST -Uri ("{0}/api/agent/config/{1}/first-entry-intent-preview" -f $BaseUrl, $SellerId) -Body @{
    message = $Message
  }
}

function Invoke-NodeIntentSnapshot {
  $nodeScript = @'
const path = require("path");
const fromBackend = (...segments) => require(path.join(process.cwd(), ...segments));
const {
  normalizeSellerConfig,
} = fromBackend("dist", "modules", "agent", "config", "first-entry-config.service.js");
const {
  renderIntentAwareFirstEntryPreview,
} = fromBackend("dist", "modules", "agent", "config", "first-entry-intent-preview.service.js");
const {
  demoSellerConfigs,
} = fromBackend("dist", "modules", "agent", "config", "demo-seller-configs.js");
const {
  demoProductContexts,
} = fromBackend("dist", "modules", "agent", "config", "demo-product-contexts.js");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const sellerRaw = demoSellerConfigs.find((seller) => seller.sellerId === "seller_demo_sandals");
const productRaw = demoProductContexts.find((context) => context.sellerId === "seller_demo_sandals");
const seller = normalizeSellerConfig(sellerRaw, productRaw.price);

function render(message, overrides = {}) {
  const localSeller = clone(seller);
  const localProduct = clone(productRaw);

  if (overrides.policy) {
    localSeller.firstEntryPolicy = {
      ...localSeller.firstEntryPolicy,
      ...overrides.policy,
    };
  }

  if (overrides.deletePrice) {
    delete localProduct.price;
  }

  return renderIntentAwareFirstEntryPreview({
    sellerConfig: localSeller,
    productContext: localProduct,
    customerMessage: message,
  });
}

const cases = {
  greetingArabic: render("سلام"),
  greetingArabizi: render("salam"),
  priceArabic: render("شحال الثمن؟"),
  priceArabizi: render("ch7al taman"),
  priceEnglish: render("price?"),
  orderArabic: render("بغيت نكوموندي"),
  orderArabizi: render("bghit ncommander"),
  infoArabic: render("بغيت معلومات"),
  infoEnglish: render("details"),
  mediaArabic: render("بغيت الصور"),
  mediaEnglish: render("photos"),
  availabilityArabic: render("واش متوفر؟"),
  availabilityArabizi: render("wach kayn"),
  deliveryFrench: render("livraison?"),
  paymentArabic: render("الدفع عند الاستلام؟"),
  unknown: render("random unclear lead text"),
  priceMissing: render("شحال الثمن؟", { deletePrice: true }),
  ctaNonePrice: render("شحال الثمن؟", { policy: { ctaMode: "none" } }),
  sizeExtraction: render("كاين مقاس 38؟"),
};

const allJson = JSON.stringify(cases);

console.log(JSON.stringify({
  cases,
  allJson,
}));
'@

  Push-Location $backendRoot
  $tempJsPath = Join-Path ([System.IO.Path]::GetTempPath()) ("phase-1e-intent-{0}.js" -f ([System.Guid]::NewGuid().ToString("N")))
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
      throw "Node intent preview snapshot failed with exit code $exitCode"
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

$distIntentPreview = Join-Path $backendRoot "dist\modules\agent\config\first-entry-intent-preview.service.js"
if (-not (Test-Path $distIntentPreview)) {
  throw "Built intent preview service not found at $distIntentPreview. Run npm run build from backend before this script."
}

$snapshotTimed = Invoke-NodeIntentSnapshot
$data = $snapshotTimed.Response
$cases = $data.cases
$duration = $snapshotTimed.DurationMs

$group = "A Intent detection"
Add-Check $group "سلام greeting intent" ($cases.greetingArabic.intent.intent -eq "greeting") $cases.greetingArabic.intent.intent $duration
Add-Check $group "salam greeting intent" ($cases.greetingArabizi.intent.intent -eq "greeting") $cases.greetingArabizi.intent.intent $duration
Add-Check $group "شحال الثمن price intent" ($cases.priceArabic.intent.intent -eq "price") $cases.priceArabic.intent.intent $duration
Add-Check $group "ch7al taman price intent" ($cases.priceArabizi.intent.intent -eq "price") $cases.priceArabizi.intent.intent $duration
Add-Check $group "price English intent" ($cases.priceEnglish.intent.intent -eq "price") $cases.priceEnglish.intent.intent $duration
Add-Check $group "بغيت نكوموندي order intent" ($cases.orderArabic.intent.intent -eq "order") $cases.orderArabic.intent.intent $duration
Add-Check $group "bghit ncommander order intent" ($cases.orderArabizi.intent.intent -eq "order") $cases.orderArabizi.intent.intent $duration
Add-Check $group "بغيت معلومات info intent" ($cases.infoArabic.intent.intent -eq "info") $cases.infoArabic.intent.intent $duration
Add-Check $group "details info intent" ($cases.infoEnglish.intent.intent -eq "info") $cases.infoEnglish.intent.intent $duration
Add-Check $group "بغيت الصور media intent" ($cases.mediaArabic.intent.intent -eq "media") $cases.mediaArabic.intent.intent $duration
Add-Check $group "photos media intent" ($cases.mediaEnglish.intent.intent -eq "media") $cases.mediaEnglish.intent.intent $duration
Add-Check $group "واش متوفر availability intent" ($cases.availabilityArabic.intent.intent -eq "availability") $cases.availabilityArabic.intent.intent $duration
Add-Check $group "wach kayn availability intent" ($cases.availabilityArabizi.intent.intent -eq "availability") $cases.availabilityArabizi.intent.intent $duration
Add-Check $group "livraison delivery intent" ($cases.deliveryFrench.intent.intent -eq "delivery") $cases.deliveryFrench.intent.intent $duration
Add-Check $group "payment intent" ($cases.paymentArabic.intent.intent -eq "payment") $cases.paymentArabic.intent.intent $duration
Add-Check $group "unknown safe fallback" ($cases.unknown.intent.intent -eq "unknown" -and $cases.unknown.recommendedNextStep -eq "show_first_entry") $cases.unknown.intent.intent $duration

$group = "B Preview behavior"
Add-Check $group "price includes price" ($cases.priceArabic.text.Contains("الثمن هو 199 درهم.")) $cases.priceArabic.text $duration
Add-Check $group "price missing no undefined" (-not ($cases.priceMissing.text -match "undefined|null") -and -not $cases.priceMissing.text.Contains("الثمن هو")) $cases.priceMissing.text $duration
Add-Check $group "price missing warning" ($cases.priceMissing.warnings -contains "price_unavailable") (($cases.priceMissing.warnings) -join ", ") $duration
Add-Check $group "order recommended step" ($cases.orderArabic.recommendedNextStep -eq "handoff_order_path_preview") $cases.orderArabic.recommendedNextStep $duration
Add-Check $group "info recommended step" ($cases.infoArabic.recommendedNextStep -eq "handoff_info_path_preview") $cases.infoArabic.recommendedNextStep $duration
Add-Check $group "media recommended step" ($cases.mediaArabic.recommendedNextStep -eq "handoff_media_info_preview") $cases.mediaArabic.recommendedNextStep $duration
Add-Check $group "availability recommended step" ($cases.availabilityArabic.recommendedNextStep -eq "answer_availability_then_cta_preview") $cases.availabilityArabic.recommendedNextStep $duration
Add-Check $group "delivery recommended step" ($cases.deliveryFrench.recommendedNextStep -eq "answer_delivery_then_cta_preview") $cases.deliveryFrench.recommendedNextStep $duration
Add-Check $group "payment recommended step" ($cases.paymentArabic.recommendedNextStep -eq "answer_payment_then_cta_preview") $cases.paymentArabic.recommendedNextStep $duration
Add-Check $group "size entity extracted" ($cases.sizeExtraction.intent.extractedEntities.size -eq "38") ($cases.sizeExtraction.intent.extractedEntities | ConvertTo-Json -Compress) $duration
Add-Check $group "all previews previewOnly" (
  $cases.priceArabic.previewOnly -eq $true -and
  $cases.orderArabic.previewOnly -eq $true -and
  $cases.infoArabic.intent.previewOnly -eq $true
) "" $duration

$group = "C CTA preservation"
Add-Check $group "price keeps CTA metadata" (@($cases.priceArabic.ctas.items).Count -eq 2) "count=$(@($cases.priceArabic.ctas.items).Count)" $duration
Add-Check $group "info keeps CTA metadata" (@($cases.infoArabic.ctas.items).Count -eq 2) "count=$(@($cases.infoArabic.ctas.items).Count)" $duration
Add-Check $group "delivery keeps CTA metadata" (@($cases.deliveryFrench.ctas.items).Count -eq 2) "count=$(@($cases.deliveryFrench.ctas.items).Count)" $duration
Add-Check $group "payment keeps CTA metadata" (@($cases.paymentArabic.ctas.items).Count -eq 2) "count=$(@($cases.paymentArabic.ctas.items).Count)" $duration
Add-Check $group "ctaMode none returns no CTA" (@($cases.ctaNonePrice.ctas.items).Count -eq 0) "count=$(@($cases.ctaNonePrice.ctas.items).Count)" $duration
Add-Check $group "no undefined or null in previews" (-not ($data.allJson -match "undefined|null")) "" $duration

$group = "D Preview endpoint safety"
$endpointTimed = Invoke-IntentPreview -Message "شحال الثمن؟"
$endpoint = $endpointTimed.Response
$endpointJson = $endpoint | ConvertTo-Json -Depth 100
Add-Check $group "endpoint previewOnly true" ($endpoint.ok -eq $true -and $endpoint.previewOnly -eq $true -and $endpoint.result.previewOnly -eq $true) "" $endpointTimed.DurationMs
Add-Check $group "endpoint returns price intent" ($endpoint.result.intent.intent -eq "price") $endpoint.result.intent.intent $endpointTimed.DurationMs
Add-Check $group "endpoint has no send payload" (-not $endpointJson.Contains("messaging_product") -and -not $endpointJson.Contains("dispatchResult") -and -not $endpointJson.Contains("interactiveResult")) "" $endpointTimed.DurationMs

$sessionCustomer = "phase-1e-preview-session"
[void](Invoke-TimedJson -Method DELETE -Uri ("{0}/api/agent/session/{1}?sellerId=seller_demo_sandals" -f $BaseUrl, $sessionCustomer))
[void](Invoke-IntentPreview -Message "بغيت نكوموندي")
$sessionTimed = Invoke-TimedJson -Method GET -Uri ("{0}/api/agent/session/{1}?sellerId=seller_demo_sandals" -f $BaseUrl, $sessionCustomer)
$session = $sessionTimed.Response
Add-Check $group "endpoint does not mutate session messages" ($session.messageCount -eq 0) "messageCount=$($session.messageCount)" $sessionTimed.DurationMs
Add-Check $group "endpoint does not mutate order state" (
  $session.orderState.confirmed -eq $false -and
  $session.orderState.awaitingConfirmation -eq $false -and
  $session.orderState.isComplete -eq $false -and
  @($session.orderState.missingFields).Count -eq 0
) "isComplete=$($session.orderState.isComplete)" $sessionTimed.DurationMs

$failed = @($checks | Where-Object { -not $_.Passed })
$passed = $checks.Count - $failed.Count

Write-Host "Phase 1E first entry intent preview checks:"
$checks | Sort-Object Group, CheckName | Format-Table Group, CheckName, Passed, Details, DurationMs -AutoSize

Write-Host ("Total checks: {0}" -f $checks.Count)
Write-Host ("Passed: {0}" -f $passed)
Write-Host ("Failed: {0}" -f $failed.Count)

if ($failed.Count -gt 0) {
  throw ("Phase 1E checks failed: {0}" -f (($failed | ForEach-Object { "$($_.Group): $($_.CheckName)" }) -join ", "))
}

Write-Host "All Phase 1E first entry intent preview checks passed."

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

function Has-CtaId {
  param(
    [object]$Ctas,
    [string]$Id
  )

  return @($Ctas.items | Where-Object { $_.id -eq $Id }).Count -eq 1
}

function Invoke-NodeCtaSnapshot {
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

const sellerRaw = demoSellerConfigs.find((seller) => seller.sellerId === "seller_demo_sandals");
const product = demoProductContexts.find((context) => context.sellerId === "seller_demo_sandals");
const seller = normalizeSellerConfig(sellerRaw, product.price);

function renderCase(policy) {
  const localSeller = clone(seller);
  localSeller.firstEntryPolicy = {
    ...localSeller.firstEntryPolicy,
    ...policy,
  };

  const result = renderFirstEntryMessage({
    sellerConfig: localSeller,
    productContext: clone(product),
  });

  return {
    text: result.text,
    ctaMode: result.ctaMode,
    ctas: result.ctas,
    uiHints: result.uiHints,
    previewOnly: result.previewOnly,
  };
}

const cases = {
  orderOrInfo: renderCase({ ctaMode: "order_or_info" }),
  orderOnly: renderCase({ ctaMode: "order_only" }),
  infoOnly: renderCase({ ctaMode: "info_only" }),
  none: renderCase({ ctaMode: "none" }),
  defaults: renderCase({
    ctaMode: "order_or_info",
    primaryCtaLabel: undefined,
    secondaryCtaLabel: undefined,
  }),
  customLabels: renderCase({
    ctaMode: "order_or_info",
    primaryCtaLabel: "كمّل الطلب",
    secondaryCtaLabel: "شوف التفاصيل",
  }),
  emptyLabels: renderCase({
    ctaMode: "order_or_info",
    primaryCtaLabel: "   ",
    secondaryCtaLabel: "",
  }),
};

const allJson = JSON.stringify(cases);

console.log(JSON.stringify({
  cases,
  allJson,
}));
'@

  Push-Location $backendRoot
  $tempJsPath = Join-Path ([System.IO.Path]::GetTempPath()) ("phase-1d-cta-{0}.js" -f ([System.Guid]::NewGuid().ToString("N")))
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
      throw "Node CTA snapshot failed with exit code $exitCode"
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

$snapshotTimed = Invoke-NodeCtaSnapshot
$data = $snapshotTimed.Response
$cases = $data.cases
$duration = $snapshotTimed.DurationMs

$group = "A CTA modes"
Add-Check $group "order_or_info returns two CTAs" (@($cases.orderOrInfo.ctas.items).Count -eq 2) "count=$(@($cases.orderOrInfo.ctas.items).Count)" $duration
Add-Check $group "order_or_info includes order id" (Has-CtaId -Ctas $cases.orderOrInfo.ctas -Id "first_entry:order_now") "" $duration
Add-Check $group "order_or_info includes info id" (Has-CtaId -Ctas $cases.orderOrInfo.ctas -Id "first_entry:more_info") "" $duration
Add-Check $group "order_only returns one CTA" (@($cases.orderOnly.ctas.items).Count -eq 1) "count=$(@($cases.orderOnly.ctas.items).Count)" $duration
Add-Check $group "order_only only includes order id" (Has-CtaId -Ctas $cases.orderOnly.ctas -Id "first_entry:order_now" -and -not (Has-CtaId -Ctas $cases.orderOnly.ctas -Id "first_entry:more_info")) "" $duration
Add-Check $group "info_only returns one CTA" (@($cases.infoOnly.ctas.items).Count -eq 1) "count=$(@($cases.infoOnly.ctas.items).Count)" $duration
Add-Check $group "info_only only includes info id" (Has-CtaId -Ctas $cases.infoOnly.ctas -Id "first_entry:more_info" -and -not (Has-CtaId -Ctas $cases.infoOnly.ctas -Id "first_entry:order_now")) "" $duration
Add-Check $group "none returns zero CTAs" (@($cases.none.ctas.items).Count -eq 0) "count=$(@($cases.none.ctas.items).Count)" $duration

$group = "B Label safety"
$defaultOrder = @($cases.defaults.ctas.items | Where-Object { $_.id -eq "first_entry:order_now" })[0]
$defaultInfo = @($cases.defaults.ctas.items | Where-Object { $_.id -eq "first_entry:more_info" })[0]
$customOrder = @($cases.customLabels.ctas.items | Where-Object { $_.id -eq "first_entry:order_now" })[0]
$customInfo = @($cases.customLabels.ctas.items | Where-Object { $_.id -eq "first_entry:more_info" })[0]
$emptyOrder = @($cases.emptyLabels.ctas.items | Where-Object { $_.id -eq "first_entry:order_now" })[0]
$emptyInfo = @($cases.emptyLabels.ctas.items | Where-Object { $_.id -eq "first_entry:more_info" })[0]
Add-Check $group "default primary label" ($defaultOrder.label -eq "أطلب الآن") $defaultOrder.label $duration
Add-Check $group "default secondary label" ($defaultInfo.label -eq "المزيد من المعلومات") $defaultInfo.label $duration
Add-Check $group "custom primary label respected" ($customOrder.label -eq "كمّل الطلب") $customOrder.label $duration
Add-Check $group "custom secondary label respected" ($customInfo.label -eq "شوف التفاصيل") $customInfo.label $duration
Add-Check $group "empty primary falls back" ($emptyOrder.label -eq "أطلب الآن") $emptyOrder.label $duration
Add-Check $group "empty secondary falls back" ($emptyInfo.label -eq "المزيد من المعلومات") $emptyInfo.label $duration
Add-Check $group "no undefined or null labels" (-not ($data.allJson -match "undefined|null")) "" $duration

$group = "C Preview metadata"
Add-Check $group "render result previewOnly" ($cases.orderOrInfo.previewOnly -eq $true) "" $duration
Add-Check $group "CTA preview previewOnly" ($cases.orderOrInfo.ctas.previewOnly -eq $true) "" $duration
Add-Check $group "UI hints preview exists" ($cases.orderOrInfo.uiHints.previewOnly -eq $true -and $cases.orderOrInfo.uiHints.preferred -eq "buttons") "" $duration
Add-Check $group "UI hints button count matches CTAs" (@($cases.orderOrInfo.uiHints.buttons).Count -eq @($cases.orderOrInfo.ctas.items).Count) "buttons=$(@($cases.orderOrInfo.uiHints.buttons).Count)" $duration
Add-Check $group "UI hints have no send payload" (-not ($data.allJson.Contains("messaging_product")) -and -not ($data.allJson.Contains("dispatchResult")) -and -not ($data.allJson.Contains("interactiveResult"))) "" $duration

$group = "D Preview endpoint safety"
$previewTimed = Invoke-TimedJson -Method GET -Uri ("{0}/api/agent/config/seller_demo_sandals/first-entry-preview" -f $BaseUrl)
$preview = $previewTimed.Response
$previewJson = $preview | ConvertTo-Json -Depth 100
Add-Check $group "preview endpoint returns CTA metadata" ($preview.result.ctas.previewOnly -eq $true -and @($preview.result.ctas.items).Count -eq 2) "count=$(@($preview.result.ctas.items).Count)" $previewTimed.DurationMs
Add-Check $group "preview endpoint returns UI hints" ($preview.result.uiHints.previewOnly -eq $true -and @($preview.result.uiHints.buttons).Count -eq 2) "buttons=$(@($preview.result.uiHints.buttons).Count)" $previewTimed.DurationMs
Add-Check $group "preview endpoint has no send payload" (-not $previewJson.Contains("messaging_product") -and -not $previewJson.Contains("dispatchResult") -and -not $previewJson.Contains("interactiveResult")) "" $previewTimed.DurationMs

$sessionCustomer = "phase-1d-preview-session"
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

Write-Host "Phase 1D first entry CTA preview checks:"
$checks | Sort-Object Group, CheckName | Format-Table Group, CheckName, Passed, Details, DurationMs -AutoSize

Write-Host ("Total checks: {0}" -f $checks.Count)
Write-Host ("Passed: {0}" -f $passed)
Write-Host ("Failed: {0}" -f $failed.Count)

if ($failed.Count -gt 0) {
  throw ("Phase 1D checks failed: {0}" -f (($failed | ForEach-Object { "$($_.Group): $($_.CheckName)" }) -join ", "))
}

Write-Host "All Phase 1D first entry CTA preview checks passed."

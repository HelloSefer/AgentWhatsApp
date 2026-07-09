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
    [ValidateSet("GET")]
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

function Invoke-NodeEligibilitySnapshot {
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
  evaluateFirstEntryEligibility,
  markFirstEntryShown,
} = fromBackend("dist", "modules", "agent", "config", "first-entry-eligibility.service.js");
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

function session(overrides = {}) {
  return {
    sessionId: "phase-1c-test-session",
    customerId: "phase-1c-customer",
    sellerId: seller.sellerId,
    messages: [],
    orderState: {
      collected: {},
      missingFields: [],
      isComplete: false,
      awaitingConfirmation: false,
      confirmed: false,
      lastUpdatedAt: "2026-07-09T00:00:00.000Z",
    },
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    ...overrides,
  };
}

function withOrder(orderState) {
  return session({
    orderState: {
      collected: {},
      missingFields: [],
      isComplete: false,
      awaitingConfirmation: false,
      confirmed: false,
      lastUpdatedAt: "2026-07-09T00:00:00.000Z",
      ...orderState,
    },
  });
}

function evalCase(input = {}) {
  return evaluateFirstEntryEligibility({
    sellerConfig: input.sellerConfig || seller,
    productContext: input.productContext === null ? undefined : (input.productContext || product),
    session: input.session,
    orderState: input.orderState,
  });
}

const disabledSeller = clone(seller);
disabledSeller.firstEntryPolicy.enabled = false;

const emptyPreviewSeller = clone(seller);
emptyPreviewSeller.firstEntryPolicy.enabled = false;
const emptyPreview = renderFirstEntryMessage({
  sellerConfig: emptyPreviewSeller,
  productContext: product,
});

const mutationSession = session({
  firstEntry: { shown: false },
  messages: [],
  orderState: {
    collected: {},
    missingFields: [],
    isComplete: false,
    awaitingConfirmation: false,
    confirmed: false,
    lastUpdatedAt: "2026-07-09T00:00:00.000Z",
  },
});
const beforeMutationJson = JSON.stringify(mutationSession);
const mutationResult = evalCase({ session: mutationSession });
const afterMutationJson = JSON.stringify(mutationSession);

const marked = markFirstEntryShown(session(), "2026-07-09T01:00:00.000Z");

const cases = {
  newConversation: evalCase({ session: session() }),
  policyDisabled: evalCase({ sellerConfig: disabledSeller, session: session() }),
  alreadyShown: evalCase({ session: session({ firstEntry: { shown: true, shownAt: "2026-07-09T01:00:00.000Z" } }) }),
  hasHistory: evalCase({ session: session({ messages: [{ role: "customer", text: "سلام", timestamp: "2026-07-09T01:00:00.000Z" }] }) }),
  orderMissingFields: evalCase({ session: withOrder({ missingFields: ["phone", "city"] }) }),
  orderCollectedFields: evalCase({ session: withOrder({ collected: { size: "38" }, missingFields: ["phone"] }) }),
  awaitingConfirmation: evalCase({ session: withOrder({ awaitingConfirmation: true, isComplete: true }) }),
  confirmedOrder: evalCase({ session: withOrder({ confirmed: true, isComplete: true }) }),
  editFlow: evalCase({ session: session({ activeFlow: "edit" }) }),
  infoFlow: evalCase({ session: session({ activeFlow: "info" }) }),
  explicitOrderState: evalCase({ session: session(), orderState: { collected: { city: "مراكش" }, missingFields: ["phone"] } }),
  emptyPreviewFromRenderer: emptyPreview,
  mutationResult,
  marked,
};

console.log(JSON.stringify({
  cases,
  mutation: {
    unchanged: beforeMutationJson === afterMutationJson,
    before: beforeMutationJson,
    after: afterMutationJson,
  },
}));
'@

  Push-Location $backendRoot
  $tempJsPath = Join-Path ([System.IO.Path]::GetTempPath()) ("phase-1c-eligibility-{0}.js" -f ([System.Guid]::NewGuid().ToString("N")))
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
      throw "Node eligibility snapshot failed with exit code $exitCode"
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

$distEligibility = Join-Path $backendRoot "dist\modules\agent\config\first-entry-eligibility.service.js"
if (-not (Test-Path $distEligibility)) {
  throw "Built eligibility service not found at $distEligibility. Run npm run build from backend before this script."
}

$snapshotTimed = Invoke-NodeEligibilitySnapshot
$data = $snapshotTimed.Response
$cases = $data.cases
$duration = $snapshotTimed.DurationMs

$group = "A Eligibility blockers"
Add-Check $group "new empty conversation eligible" ($cases.newConversation.eligible -eq $true -and $cases.newConversation.reason -eq "eligible_new_conversation") $cases.newConversation.reason $duration
Add-Check $group "policy disabled blocks" ($cases.policyDisabled.eligible -eq $false -and $cases.policyDisabled.reason -eq "policy_disabled") $cases.policyDisabled.reason $duration
Add-Check $group "already shown blocks" ($cases.alreadyShown.eligible -eq $false -and $cases.alreadyShown.reason -eq "already_shown") $cases.alreadyShown.reason $duration
Add-Check $group "history blocks" ($cases.hasHistory.eligible -eq $false -and $cases.hasHistory.reason -eq "has_session_history") $cases.hasHistory.reason $duration
Add-Check $group "active missing-field order blocks" ($cases.orderMissingFields.eligible -eq $false -and $cases.orderMissingFields.reason -eq "order_flow_active") $cases.orderMissingFields.reason $duration
Add-Check $group "collected order field blocks" ($cases.orderCollectedFields.eligible -eq $false -and $cases.orderCollectedFields.reason -eq "order_flow_active") $cases.orderCollectedFields.reason $duration
Add-Check $group "awaiting confirmation blocks" ($cases.awaitingConfirmation.eligible -eq $false -and $cases.awaitingConfirmation.reason -eq "order_awaiting_confirmation") $cases.awaitingConfirmation.reason $duration
Add-Check $group "confirmed order blocks" ($cases.confirmedOrder.eligible -eq $false -and $cases.confirmedOrder.reason -eq "order_confirmed") $cases.confirmedOrder.reason $duration
Add-Check $group "edit flow blocks" ($cases.editFlow.eligible -eq $false -and $cases.editFlow.reason -eq "edit_flow_active") $cases.editFlow.reason $duration
Add-Check $group "info flow blocks" ($cases.infoFlow.eligible -eq $false -and $cases.infoFlow.reason -eq "info_flow_active") $cases.infoFlow.reason $duration
Add-Check $group "explicit orderState blocks" ($cases.explicitOrderState.eligible -eq $false -and $cases.explicitOrderState.reason -eq "order_flow_active") $cases.explicitOrderState.reason $duration

$group = "B Result shape and purity"
Add-Check $group "result includes reason" ([string]::IsNullOrWhiteSpace($cases.newConversation.reason) -eq $false) $cases.newConversation.reason $duration
Add-Check $group "result includes blockers array" ($null -ne $cases.orderMissingFields.blockers -and @($cases.orderMissingFields.blockers).Count -ge 1) (($cases.orderMissingFields.blockers) -join ", ") $duration
Add-Check $group "eligible blockers empty" (@($cases.newConversation.blockers).Count -eq 0) (($cases.newConversation.blockers) -join ", ") $duration
Add-Check $group "all results previewOnly" (
  $cases.newConversation.previewOnly -eq $true -and
  $cases.policyDisabled.previewOnly -eq $true -and
  $cases.confirmedOrder.previewOnly -eq $true
) "" $duration
Add-Check $group "evaluation does not mutate session" ($data.mutation.unchanged -eq $true) "" $duration
Add-Check $group "mark helper sets firstEntry shown" ($cases.marked.firstEntry.shown -eq $true -and [string]$cases.marked.firstEntry.shownAt) $cases.marked.firstEntry.shownAt $duration
Add-Check $group "disabled renderer has empty preview warning" ($cases.emptyPreviewFromRenderer.text -eq "" -and $cases.emptyPreviewFromRenderer.warnings -contains "first_entry_disabled") (($cases.emptyPreviewFromRenderer.warnings) -join ", ") $duration

$group = "C Preview endpoints"
$eligibilityTimed = Invoke-TimedJson -Method GET -Uri ("{0}/api/agent/config/seller_demo_sandals/first-entry-eligibility-preview" -f $BaseUrl)
$eligibility = $eligibilityTimed.Response
$eligibilityJson = $eligibility | ConvertTo-Json -Depth 80
Add-Check $group "eligibility endpoint ok" ($eligibility.ok -eq $true -and $eligibility.previewOnly -eq $true) "" $eligibilityTimed.DurationMs
Add-Check $group "eligibility endpoint previewOnly result" ($eligibility.result.previewOnly -eq $true) "" $eligibilityTimed.DurationMs
Add-Check $group "eligibility endpoint eligible" ($eligibility.result.eligible -eq $true -and $eligibility.result.reason -eq "eligible_new_conversation") $eligibility.result.reason $eligibilityTimed.DurationMs
Add-Check $group "eligibility endpoint has blockers array" ($null -ne $eligibility.result.blockers -and @($eligibility.result.blockers).Count -eq 0) "" $eligibilityTimed.DurationMs
Add-Check $group "eligibility endpoint has no send payload" (-not $eligibilityJson.Contains("messaging_product") -and -not $eligibilityJson.Contains("dispatchResult") -and -not $eligibilityJson.Contains("interactiveResult")) "" $eligibilityTimed.DurationMs

$previewTimed = Invoke-TimedJson -Method GET -Uri ("{0}/api/agent/config/seller_demo_sandals/first-entry-preview" -f $BaseUrl)
$preview = $previewTimed.Response
Add-Check $group "first-entry preview includes eligibility" ($preview.previewOnly -eq $true -and $preview.eligibility.previewOnly -eq $true -and $preview.eligibility.reason -eq "eligible_new_conversation") $preview.eligibility.reason $previewTimed.DurationMs

$failed = @($checks | Where-Object { -not $_.Passed })
$passed = $checks.Count - $failed.Count

Write-Host "Phase 1C first entry eligibility checks:"
$checks | Sort-Object Group, CheckName | Format-Table Group, CheckName, Passed, Details, DurationMs -AutoSize

Write-Host ("Total checks: {0}" -f $checks.Count)
Write-Host ("Passed: {0}" -f $passed)
Write-Host ("Failed: {0}" -f $failed.Count)

if ($failed.Count -gt 0) {
  throw ("Phase 1C checks failed: {0}" -f (($failed | ForEach-Object { "$($_.Group): $($_.CheckName)" }) -join ", "))
}

Write-Host "All Phase 1C first entry eligibility checks passed."

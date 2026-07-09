param(
  [string]$BaseUrl = "http://localhost:5000"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$checks = New-Object System.Collections.Generic.List[object]

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
    $json = $Body | ConvertTo-Json -Depth 100
    $utf8Body = [System.Text.Encoding]::UTF8.GetBytes($json)
    $response = Invoke-RestMethod -Method $Method -Uri $Uri -ContentType "application/json; charset=utf-8" -Body $utf8Body
  }

  $watch.Stop()

  return [PSCustomObject]@{
    Response = $response
    DurationMs = [int]$watch.ElapsedMilliseconds
  }
}

function Invoke-ClickPreview {
  param(
    [object]$Body
  )

  return Invoke-TimedJson -Method POST -Uri ("{0}/api/agent/first-entry-click-preview" -f $BaseUrl) -Body $Body
}

function Invoke-AgentTest {
  param(
    [object]$Body
  )

  return Invoke-TimedJson -Method POST -Uri ("{0}/api/agent/test" -f $BaseUrl) -Body $Body
}

function Clear-Session {
  param(
    [string]$SellerId,
    [string]$Phone
  )

  [void](Invoke-TimedJson -Method DELETE -Uri ("{0}/api/agent/session/{1}?sellerId={2}" -f $BaseUrl, $Phone, $SellerId))
}

function Get-Session {
  param(
    [string]$SellerId,
    [string]$Phone
  )

  return Invoke-TimedJson -Method GET -Uri ("{0}/api/agent/session/{1}?sellerId={2}" -f $BaseUrl, $Phone, $SellerId)
}

$sellerId = "seller_demo_sandals"
$phone = "0612345678"

$group = "A Stable CTA IDs"
$orderTimed = Invoke-ClickPreview -Body @{
  sellerId = $sellerId
  customerPhone = $phone
  clickId = "first_entry:order_now"
}
$order = $orderTimed.Response
Add-Check $group "first_entry:order_now recognized" ($order.result.recognized -eq $true) "" $orderTimed.DurationMs
Add-Check $group "first_entry:order_now normalized id" ($order.result.normalizedId -eq "first_entry:order_now") $order.result.normalizedId $orderTimed.DurationMs
Add-Check $group "first_entry:order_now intent order" ($order.result.intent -eq "order") $order.result.intent $orderTimed.DurationMs
Add-Check $group "first_entry:order_now handoff order preview" ($order.result.recommendedNextStep -eq "handoff_order_path_preview") $order.result.recommendedNextStep $orderTimed.DurationMs
Add-Check $group "first_entry:order_now confidence high" ($order.result.confidence -eq "high") $order.result.confidence $orderTimed.DurationMs

$infoTimed = Invoke-ClickPreview -Body @{
  sellerId = $sellerId
  customerPhone = $phone
  clickId = "first_entry:more_info"
}
$info = $infoTimed.Response
Add-Check $group "first_entry:more_info recognized" ($info.result.recognized -eq $true) "" $infoTimed.DurationMs
Add-Check $group "first_entry:more_info normalized id" ($info.result.normalizedId -eq "first_entry:more_info") $info.result.normalizedId $infoTimed.DurationMs
Add-Check $group "first_entry:more_info intent info" ($info.result.intent -eq "info") $info.result.intent $infoTimed.DurationMs
Add-Check $group "first_entry:more_info handoff info preview" ($info.result.recommendedNextStep -eq "handoff_info_path_preview") $info.result.recommendedNextStep $infoTimed.DurationMs
Add-Check $group "first_entry:more_info confidence high" ($info.result.confidence -eq "high") $info.result.confidence $infoTimed.DurationMs

$group = "B Label fallback"
$orderLabels = @("أطلب الآن", "كمّل الطلب", "order", "commande")
foreach ($label in $orderLabels) {
  $timed = Invoke-ClickPreview -Body @{
    sellerId = $sellerId
    customerPhone = $phone
    text = $label
  }
  $result = $timed.Response.result
  Add-Check $group ("{0} recognized as order" -f $label) (
    $result.recognized -eq $true -and
    $result.intent -eq "order" -and
    $result.normalizedId -eq "first_entry:order_now" -and
    $result.confidence -eq "medium"
  ) ($result | ConvertTo-Json -Compress) $timed.DurationMs
}

$infoLabels = @("المزيد من المعلومات", "معلومات أكثر", "details", "info")
foreach ($label in $infoLabels) {
  $timed = Invoke-ClickPreview -Body @{
    sellerId = $sellerId
    customerPhone = $phone
    text = $label
  }
  $result = $timed.Response.result
  Add-Check $group ("{0} recognized as info" -f $label) (
    $result.recognized -eq $true -and
    $result.intent -eq "info" -and
    $result.normalizedId -eq "first_entry:more_info" -and
    $result.confidence -eq "medium"
  ) ($result | ConvertTo-Json -Compress) $timed.DurationMs
}

$group = "C Unknown and empty safety"
$unknownTimed = Invoke-ClickPreview -Body @{
  sellerId = $sellerId
  customerPhone = $phone
  text = "random text"
}
$unknown = $unknownTimed.Response
Add-Check $group "unknown input recognized false" ($unknown.result.recognized -eq $false) "" $unknownTimed.DurationMs
Add-Check $group "unknown input intent unknown" ($unknown.result.intent -eq "unknown") $unknown.result.intent $unknownTimed.DurationMs
Add-Check $group "unknown input recommended unknown preview" ($unknown.result.recommendedNextStep -eq "unknown_click_preview") $unknown.result.recommendedNextStep $unknownTimed.DurationMs

$emptyTimed = Invoke-ClickPreview -Body @{
  sellerId = $sellerId
  customerPhone = $phone
}
$empty = $emptyTimed.Response
$emptyJson = $empty | ConvertTo-Json -Depth 100
Add-Check $group "empty input does not throw" ($empty.ok -eq $true) "" $emptyTimed.DurationMs
Add-Check $group "empty input unknown safe result" ($empty.result.recognized -eq $false -and $empty.result.intent -eq "unknown") ($empty.result | ConvertTo-Json -Compress) $emptyTimed.DurationMs
Add-Check $group "no undefined/null text appears" (-not $emptyJson.Contains("undefined") -and -not $emptyJson.Contains("null")) "" $emptyTimed.DurationMs

$group = "D Dedicated endpoint shape and safety"
$orderJson = $order | ConvertTo-Json -Depth 100
Add-Check $group "endpoint ok true" ($order.ok -eq $true) "" $orderTimed.DurationMs
Add-Check $group "endpoint previewOnly true" ($order.previewOnly -eq $true -and $order.result.previewOnly -eq $true) "" $orderTimed.DurationMs
Add-Check $group "endpoint dryRun true" ($order.dryRun -eq $true) "" $orderTimed.DurationMs
Add-Check $group "endpoint includes conversationKey" ($order.conversationKey -eq ("{0}:{1}" -f $sellerId, $phone)) $order.conversationKey $orderTimed.DurationMs
Add-Check $group "endpoint has no send payload" (-not $orderJson.Contains("messaging_product") -and -not $orderJson.Contains("dispatchResult") -and -not $orderJson.Contains("interactiveResult")) "" $orderTimed.DurationMs
Add-Check $group "safety noLiveSend" ($order.safety.noLiveSend -eq $true) "" $orderTimed.DurationMs
Add-Check $group "safety noMetaApi" ($order.safety.noMetaApi -eq $true) "" $orderTimed.DurationMs
Add-Check $group "safety noSessionMutation" ($order.safety.noSessionMutation -eq $true) "" $orderTimed.DurationMs
Add-Check $group "safety noOrderMutation" ($order.safety.noOrderMutation -eq $true) "" $orderTimed.DurationMs
Add-Check $group "safety noLiveRouting" ($order.safety.noLiveRouting -eq $true) "" $orderTimed.DurationMs

$group = "E Agent test explicit opt-in"
$defaultTimed = Invoke-AgentTest -Body @{
  sellerId = $sellerId
  customerPhone = "0612345710"
  message = "first_entry:order_now"
}
$default = $defaultTimed.Response
Add-Check $group "default agent test behavior unchanged without flag" ($null -eq $default.firstEntryClick -and $default.handledBy -ne "first_entry_click_preview") "$($default.handledBy)" $defaultTimed.DurationMs

$agentClickTimed = Invoke-AgentTest -Body @{
  sellerId = $sellerId
  customerPhone = "0612345711"
  message = "first_entry:order_now"
  enableFirstEntryClickPreview = $true
}
$agentClick = $agentClickTimed.Response
Add-Check $group "agent test click preview requires explicit flag" ($agentClick.handledBy -eq "first_entry_click_preview") $agentClick.handledBy $agentClickTimed.DurationMs
Add-Check $group "agent test click preview returns normalized result" ($agentClick.firstEntryClick.normalizedId -eq "first_entry:order_now" -and $agentClick.firstEntryClick.intent -eq "order") ($agentClick.firstEntryClick | ConvertTo-Json -Compress) $agentClickTimed.DurationMs
Add-Check $group "agent test click preview does not route live" ($agentClick.reply -eq "" -and @($agentClick.actions).Count -eq 0 -and $agentClick.safety.noLiveRouting -eq $true) "actions=$(@($agentClick.actions).Count)" $agentClickTimed.DurationMs

$agentInteractiveTimed = Invoke-AgentTest -Body @{
  sellerId = $sellerId
  customerPhone = "0612345712"
  interactiveReplyId = "first_entry:more_info"
  firstEntryClickMode = "preview"
}
$agentInteractive = $agentInteractiveTimed.Response
Add-Check $group "agent test accepts interactiveReplyId without message" ($agentInteractive.firstEntryClick.normalizedId -eq "first_entry:more_info" -and $agentInteractive.firstEntryClick.intent -eq "info") ($agentInteractive.firstEntryClick | ConvertTo-Json -Compress) $agentInteractiveTimed.DurationMs

$group = "F No persistence"
$persistPhone = "0612345713"
Clear-Session -SellerId $sellerId -Phone $persistPhone
[void](Invoke-AgentTest -Body @{
  sellerId = $sellerId
  customerPhone = $persistPhone
  message = "first_entry:order_now"
  enableFirstEntryClickPreview = $true
})
$sessionTimed = Get-Session -SellerId $sellerId -Phone $persistPhone
$session = $sessionTimed.Response
Add-Check $group "click preview does not save current message" ($session.messageCount -eq 0) "messageCount=$($session.messageCount)" $sessionTimed.DurationMs
Add-Check $group "click preview does not mutate order state" (
  $session.orderState.isComplete -eq $false -and
  $session.orderState.awaitingConfirmation -eq $false -and
  $session.orderState.confirmed -eq $false -and
  @($session.orderState.missingFields).Count -eq 0
) "isComplete=$($session.orderState.isComplete)" $sessionTimed.DurationMs

$group = "G Regression script availability"
$scripts = @(
  "scripts/test-phase-1a-first-entry-config.ps1",
  "scripts/test-phase-1b-first-entry-renderer.ps1",
  "scripts/test-phase-1c-first-entry-eligibility.ps1",
  "scripts/test-phase-1d-first-entry-cta-preview.ps1",
  "scripts/test-phase-1e-first-entry-intent-preview.ps1",
  "scripts/test-phase-1f-first-entry-dry-run-integration.ps1",
  "scripts/test-phase-1g-first-entry-agent-test-integration.ps1"
)

foreach ($script in $scripts) {
  Add-Check $group ("existing script available: {0}" -f (Split-Path $script -Leaf)) (Test-Path $script) $script
}

$failed = @($checks | Where-Object { -not $_.Passed })
$passed = $checks.Count - $failed.Count

Write-Host "Phase 1H first entry click normalization preview checks:"
$checks | Sort-Object Group, CheckName | Format-Table Group, CheckName, Passed, Details, DurationMs -AutoSize

Write-Host ("Total checks: {0}" -f $checks.Count)
Write-Host ("Passed: {0}" -f $passed)
Write-Host ("Failed: {0}" -f $failed.Count)

if ($failed.Count -gt 0) {
  throw ("Phase 1H checks failed: {0}" -f (($failed | ForEach-Object { "$($_.Group): $($_.CheckName)" }) -join ", "))
}

Write-Host "All Phase 1H first entry click normalization preview checks passed."

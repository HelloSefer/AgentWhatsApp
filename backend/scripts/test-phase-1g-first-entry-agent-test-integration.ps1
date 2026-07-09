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

function Invoke-AgentTest {
  param(
    [string]$Message,
    [string]$Phone = "0612345678",
    [string]$SellerId = "seller_demo_sandals",
    [bool]$EnableFirstEntryPreview = $true,
    [object]$MockState = $null,
    [object]$ExtraBody = $null
  )

  $body = @{
    sellerId = $SellerId
    customerPhone = $Phone
    message = $Message
  }

  if ($EnableFirstEntryPreview) {
    $body.enableFirstEntryPreview = $true
  }

  if ($null -ne $MockState) {
    $body.mockState = $MockState
  }

  if ($null -ne $ExtraBody) {
    foreach ($property in $ExtraBody.PSObject.Properties) {
      $body[$property.Name] = $property.Value
    }
  }

  return Invoke-TimedJson -Method POST -Uri ("{0}/api/agent/test" -f $BaseUrl) -Body $body
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

$group = "A Guard and default behavior"
$defaultTimed = Invoke-AgentTest -Message "سلام" -Phone "0612345601" -SellerId $sellerId -EnableFirstEntryPreview $false
$default = $defaultTimed.Response
Add-Check $group "default agent test still replies" ([string]::IsNullOrWhiteSpace($default.reply) -eq $false) $default.reply $defaultTimed.DurationMs
Add-Check $group "default path has no firstEntry metadata" ($null -eq $default.firstEntry) "" $defaultTimed.DurationMs
Add-Check $group "default path has no previewOnly flag" ($default.previewOnly -ne $true -and $default.dryRun -ne $true) "" $defaultTimed.DurationMs
Add-Check $group "first-entry requires explicit flag" ($default.handledBy -ne "first_entry_agent_test") "$($default.handledBy)" $defaultTimed.DurationMs

$group = "B Response shape"
$greetingTimed = Invoke-AgentTest -Message "سلام" -Phone $phone -SellerId $sellerId
$greeting = $greetingTimed.Response
$greetingJson = $greeting | ConvertTo-Json -Depth 100
Add-Check $group "endpoint ok true" ($greeting.ok -eq $true) "" $greetingTimed.DurationMs
Add-Check $group "mode agent_test" ($greeting.mode -eq "agent_test") $greeting.mode $greetingTimed.DurationMs
Add-Check $group "previewOnly true" ($greeting.previewOnly -eq $true) "" $greetingTimed.DurationMs
Add-Check $group "dryRun true" ($greeting.dryRun -eq $true) "" $greetingTimed.DurationMs
Add-Check $group "handledBy first_entry_agent_test" ($greeting.handledBy -eq "first_entry_agent_test") $greeting.handledBy $greetingTimed.DurationMs
Add-Check $group "includes sellerId" ($greeting.sellerId -eq $sellerId) $greeting.sellerId $greetingTimed.DurationMs
Add-Check $group "includes customerPhone" ($greeting.customerPhone -eq $phone) $greeting.customerPhone $greetingTimed.DurationMs
Add-Check $group "includes conversationKey" ($greeting.conversationKey -eq ("{0}:{1}" -f $sellerId, $phone)) $greeting.conversationKey $greetingTimed.DurationMs
Add-Check $group "actions array empty" (@($greeting.actions).Count -eq 0) "count=$(@($greeting.actions).Count)" $greetingTimed.DurationMs

$group = "C Intent-aware first-entry paths"
Add-Check $group "سلام greeting intent" ($greeting.firstEntry.intent.intent -eq "greeting") $greeting.firstEntry.intent.intent $greetingTimed.DurationMs
Add-Check $group "سلام commercial opening" ($greeting.firstEntry.recommendedNextStep -eq "show_first_entry" -and $greeting.reply.Contains("المنتج متوفر")) $greeting.reply $greetingTimed.DurationMs

$priceTimed = Invoke-AgentTest -Message "شحال الثمن؟" -Phone "0612345602"
$price = $priceTimed.Response
Add-Check $group "price intent" ($price.firstEntry.intent.intent -eq "price") $price.firstEntry.intent.intent $priceTimed.DurationMs
Add-Check $group "price recommended step" ($price.firstEntry.recommendedNextStep -eq "answer_price_then_cta_preview") $price.firstEntry.recommendedNextStep $priceTimed.DurationMs
Add-Check $group "price includes configured price" ($price.reply.Contains("199 درهم")) $price.reply $priceTimed.DurationMs

$orderPhone = "0612345603"
Clear-Session -SellerId $sellerId -Phone $orderPhone
$orderTimed = Invoke-AgentTest -Message "بغيت نكوموندي" -Phone $orderPhone
$order = $orderTimed.Response
$orderSessionTimed = Get-Session -SellerId $sellerId -Phone $orderPhone
$orderSession = $orderSessionTimed.Response
Add-Check $group "order intent" ($order.firstEntry.intent.intent -eq "order") $order.firstEntry.intent.intent $orderTimed.DurationMs
Add-Check $group "order handoff preview" ($order.firstEntry.recommendedNextStep -eq "handoff_order_path_preview") $order.firstEntry.recommendedNextStep $orderTimed.DurationMs
Add-Check $group "order does not start real order flow" (
  $orderSession.orderState.isComplete -eq $false -and
  $orderSession.orderState.awaitingConfirmation -eq $false -and
  $orderSession.orderState.confirmed -eq $false -and
  @($orderSession.orderState.missingFields).Count -eq 0
) "isComplete=$($orderSession.orderState.isComplete)" $orderSessionTimed.DurationMs

$infoTimed = Invoke-AgentTest -Message "بغيت معلومات" -Phone "0612345604"
$info = $infoTimed.Response
Add-Check $group "info intent" ($info.firstEntry.intent.intent -eq "info") $info.firstEntry.intent.intent $infoTimed.DurationMs
Add-Check $group "info handoff preview" ($info.firstEntry.recommendedNextStep -eq "handoff_info_path_preview") $info.firstEntry.recommendedNextStep $infoTimed.DurationMs

$mediaTimed = Invoke-AgentTest -Message "بغيت الصور" -Phone "0612345605"
$media = $mediaTimed.Response
Add-Check $group "media intent" ($media.firstEntry.intent.intent -eq "media") $media.firstEntry.intent.intent $mediaTimed.DurationMs
Add-Check $group "media does not send images" ($media.firstEntry.recommendedNextStep -eq "handoff_media_info_preview" -and @($media.actions).Count -eq 0) $media.firstEntry.recommendedNextStep $mediaTimed.DurationMs

$availabilityTimed = Invoke-AgentTest -Message "واش متوفر؟" -Phone "0612345606"
$availability = $availabilityTimed.Response
Add-Check $group "availability intent" ($availability.firstEntry.intent.intent -eq "availability") $availability.firstEntry.intent.intent $availabilityTimed.DurationMs

$deliveryTimed = Invoke-AgentTest -Message "livraison?" -Phone "0612345607"
$delivery = $deliveryTimed.Response
Add-Check $group "delivery intent" ($delivery.firstEntry.intent.intent -eq "delivery") $delivery.firstEntry.intent.intent $deliveryTimed.DurationMs

$paymentTimed = Invoke-AgentTest -Message "الدفع عند الاستلام؟" -Phone "0612345608"
$payment = $paymentTimed.Response
Add-Check $group "payment intent" ($payment.firstEntry.intent.intent -eq "payment") $payment.firstEntry.intent.intent $paymentTimed.DurationMs

$group = "D Metadata and safety"
Add-Check $group "CTA metadata present" (@($greeting.firstEntry.ctas.items).Count -eq 2 -and $greeting.firstEntry.ctas.previewOnly -eq $true) "count=$(@($greeting.firstEntry.ctas.items).Count)" $greetingTimed.DurationMs
Add-Check $group "uiHints preview present" ($greeting.uiHints.previewOnly -eq $true -and @($greeting.uiHints.buttons).Count -eq 2) "buttons=$(@($greeting.uiHints.buttons).Count)" $greetingTimed.DurationMs
Add-Check $group "no send payload exists" (-not $greetingJson.Contains("messaging_product") -and -not $greetingJson.Contains("dispatchResult") -and -not $greetingJson.Contains("interactiveResult")) "" $greetingTimed.DurationMs
Add-Check $group "safety noLiveSend" ($greeting.safety.noLiveSend -eq $true) "" $greetingTimed.DurationMs
Add-Check $group "safety noMetaApi" ($greeting.safety.noMetaApi -eq $true) "" $greetingTimed.DurationMs
Add-Check $group "safety noSessionMutation" ($greeting.safety.noSessionMutation -eq $true) "" $greetingTimed.DurationMs
Add-Check $group "safety noOrderMutation" ($greeting.safety.noOrderMutation -eq $true) "" $greetingTimed.DurationMs

$group = "E Blocked mock states"
$shown = (Invoke-AgentTest -Message "سلام" -Phone "0612345609" -MockState @{ firstEntryShown = $true }).Response
Add-Check $group "firstEntryShown blocked" ($shown.handledBy -eq "first_entry_agent_test_blocked" -and $shown.reply -eq "" -and $shown.firstEntry.recommendedNextStep -eq "do_not_show_first_entry") $shown.firstEntry.eligibility.reason

$history = (Invoke-AgentTest -Message "سلام" -Phone "0612345610" -MockState @{ hasSessionHistory = $true }).Response
Add-Check $group "session history blocked" ($history.handledBy -eq "first_entry_agent_test_blocked" -and $history.firstEntry.eligibility.reason -eq "has_session_history") $history.firstEntry.eligibility.reason

$activeOrder = (Invoke-AgentTest -Message "سلام" -Phone "0612345611" -MockState @{ orderFlowActive = $true }).Response
Add-Check $group "active order blocked" ($activeOrder.handledBy -eq "first_entry_agent_test_blocked" -and $activeOrder.firstEntry.eligibility.reason -eq "order_flow_active") $activeOrder.firstEntry.eligibility.reason

$confirmed = (Invoke-AgentTest -Message "سلام" -Phone "0612345612" -MockState @{ orderConfirmed = $true }).Response
Add-Check $group "confirmed order blocked" ($confirmed.handledBy -eq "first_entry_agent_test_blocked" -and $confirmed.firstEntry.eligibility.reason -eq "order_confirmed") $confirmed.firstEntry.eligibility.reason

$group = "F No persistence"
$persistPhone = "0612345613"
Clear-Session -SellerId $sellerId -Phone $persistPhone
[void](Invoke-AgentTest -Message "سلام" -Phone $persistPhone -SellerId $sellerId)
$sessionTimed = Get-Session -SellerId $sellerId -Phone $persistPhone
$session = $sessionTimed.Response
Add-Check $group "test path does not save current message" ($session.messageCount -eq 0) "messageCount=$($session.messageCount)" $sessionTimed.DurationMs
Add-Check $group "test path does not mark firstEntryShown" ($null -eq $session.firstEntry -or $session.firstEntry.shown -ne $true) "firstEntry=$($session.firstEntry | ConvertTo-Json -Compress)" $sessionTimed.DurationMs

$group = "G Regression script availability"
$scripts = @(
  "scripts/test-phase-1a-first-entry-config.ps1",
  "scripts/test-phase-1b-first-entry-renderer.ps1",
  "scripts/test-phase-1c-first-entry-eligibility.ps1",
  "scripts/test-phase-1d-first-entry-cta-preview.ps1",
  "scripts/test-phase-1e-first-entry-intent-preview.ps1",
  "scripts/test-phase-1f-first-entry-dry-run-integration.ps1"
)

foreach ($script in $scripts) {
  Add-Check $group ("existing script available: {0}" -f (Split-Path $script -Leaf)) (Test-Path $script) $script
}

$failed = @($checks | Where-Object { -not $_.Passed })
$passed = $checks.Count - $failed.Count

Write-Host "Phase 1G first entry agent test integration checks:"
$checks | Sort-Object Group, CheckName | Format-Table Group, CheckName, Passed, Details, DurationMs -AutoSize

Write-Host ("Total checks: {0}" -f $checks.Count)
Write-Host ("Passed: {0}" -f $passed)
Write-Host ("Failed: {0}" -f $failed.Count)

if ($failed.Count -gt 0) {
  throw ("Phase 1G checks failed: {0}" -f (($failed | ForEach-Object { "$($_.Group): $($_.CheckName)" }) -join ", "))
}

Write-Host "All Phase 1G first entry agent test integration checks passed."

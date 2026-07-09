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

function Invoke-FirstEntryDryRun {
  param(
    [string]$Message,
    [string]$Phone = "0612345678",
    [string]$SellerId = "seller_demo_sandals",
    [object]$MockState = $null
  )

  $body = @{
    sellerId = $SellerId
    customerPhone = $Phone
    message = $Message
  }

  if ($null -ne $MockState) {
    $body.mockState = $MockState
  }

  return Invoke-TimedJson -Method POST -Uri ("{0}/api/agent/first-entry-dry-run" -f $BaseUrl) -Body $body
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

$group = "A Response shape"
$greetingTimed = Invoke-FirstEntryDryRun -Message "سلام" -Phone $phone -SellerId $sellerId
$greeting = $greetingTimed.Response
$greetingJson = $greeting | ConvertTo-Json -Depth 100
Add-Check $group "endpoint ok true" ($greeting.ok -eq $true) "" $greetingTimed.DurationMs
Add-Check $group "previewOnly true" ($greeting.previewOnly -eq $true -and $greeting.result.previewOnly -eq $true) "" $greetingTimed.DurationMs
Add-Check $group "dryRun true" ($greeting.dryRun -eq $true) "" $greetingTimed.DurationMs
Add-Check $group "includes sellerId" ($greeting.sellerId -eq $sellerId) $greeting.sellerId $greetingTimed.DurationMs
Add-Check $group "includes customerPhone" ($greeting.customerPhone -eq $phone) $greeting.customerPhone $greetingTimed.DurationMs
Add-Check $group "includes conversationKey" ($greeting.conversationKey -eq ("{0}:{1}" -f $sellerId, $phone)) $greeting.conversationKey $greetingTimed.DurationMs

$group = "B Intent dry-run paths"
Add-Check $group "سلام greeting intent" ($greeting.result.intent.intent -eq "greeting") $greeting.result.intent.intent $greetingTimed.DurationMs
Add-Check $group "سلام commercial opening" ($greeting.result.recommendedNextStep -eq "show_first_entry" -and $greeting.result.text.Contains("المنتج متوفر")) $greeting.result.recommendedNextStep $greetingTimed.DurationMs

$priceTimed = Invoke-FirstEntryDryRun -Message "شحال الثمن؟" -Phone "0612345679"
$price = $priceTimed.Response
Add-Check $group "price intent" ($price.result.intent.intent -eq "price") $price.result.intent.intent $priceTimed.DurationMs
Add-Check $group "price recommended step" ($price.result.recommendedNextStep -eq "answer_price_then_cta_preview") $price.result.recommendedNextStep $priceTimed.DurationMs
Add-Check $group "price includes configured price" ($price.result.text.Contains("199 درهم")) $price.result.text $priceTimed.DurationMs

$orderPhone = "0612345680"
Clear-Session -SellerId $sellerId -Phone $orderPhone
$orderTimed = Invoke-FirstEntryDryRun -Message "بغيت نكوموندي" -Phone $orderPhone
$order = $orderTimed.Response
$orderSessionTimed = Get-Session -SellerId $sellerId -Phone $orderPhone
$orderSession = $orderSessionTimed.Response
Add-Check $group "order intent" ($order.result.intent.intent -eq "order") $order.result.intent.intent $orderTimed.DurationMs
Add-Check $group "order handoff preview" ($order.result.recommendedNextStep -eq "handoff_order_path_preview") $order.result.recommendedNextStep $orderTimed.DurationMs
Add-Check $group "order dry-run does not mutate order state" (
  $orderSession.orderState.isComplete -eq $false -and
  $orderSession.orderState.awaitingConfirmation -eq $false -and
  $orderSession.orderState.confirmed -eq $false -and
  @($orderSession.orderState.missingFields).Count -eq 0
) "isComplete=$($orderSession.orderState.isComplete)" $orderSessionTimed.DurationMs

$infoTimed = Invoke-FirstEntryDryRun -Message "بغيت معلومات" -Phone "0612345681"
$info = $infoTimed.Response
Add-Check $group "info intent" ($info.result.intent.intent -eq "info") $info.result.intent.intent $infoTimed.DurationMs
Add-Check $group "info handoff preview" ($info.result.recommendedNextStep -eq "handoff_info_path_preview") $info.result.recommendedNextStep $infoTimed.DurationMs

$mediaTimed = Invoke-FirstEntryDryRun -Message "بغيت الصور" -Phone "0612345682"
$media = $mediaTimed.Response
Add-Check $group "media intent" ($media.result.intent.intent -eq "media") $media.result.intent.intent $mediaTimed.DurationMs
Add-Check $group "media handoff preview" ($media.result.recommendedNextStep -eq "handoff_media_info_preview") $media.result.recommendedNextStep $mediaTimed.DurationMs

$availabilityTimed = Invoke-FirstEntryDryRun -Message "واش متوفر؟" -Phone "0612345683"
$availability = $availabilityTimed.Response
Add-Check $group "availability intent" ($availability.result.intent.intent -eq "availability") $availability.result.intent.intent $availabilityTimed.DurationMs

$deliveryTimed = Invoke-FirstEntryDryRun -Message "livraison?" -Phone "0612345684"
$delivery = $deliveryTimed.Response
Add-Check $group "delivery intent" ($delivery.result.intent.intent -eq "delivery") $delivery.result.intent.intent $deliveryTimed.DurationMs

$paymentTimed = Invoke-FirstEntryDryRun -Message "الدفع عند الاستلام؟" -Phone "0612345685"
$payment = $paymentTimed.Response
Add-Check $group "payment intent" ($payment.result.intent.intent -eq "payment") $payment.result.intent.intent $paymentTimed.DurationMs

$group = "C Metadata and safety"
Add-Check $group "CTA metadata exists" (@($greeting.result.ctas.items).Count -eq 2 -and $greeting.result.ctas.mode -eq "order_or_info") "count=$(@($greeting.result.ctas.items).Count)" $greetingTimed.DurationMs
Add-Check $group "uiHints preview exists" ($greeting.result.uiHints.previewOnly -eq $true -and @($greeting.result.uiHints.buttons).Count -eq 2) "buttons=$(@($greeting.result.uiHints.buttons).Count)" $greetingTimed.DurationMs
Add-Check $group "no send payload exists" (-not $greetingJson.Contains("messaging_product") -and -not $greetingJson.Contains("dispatchResult") -and -not $greetingJson.Contains("interactiveResult")) "" $greetingTimed.DurationMs
Add-Check $group "safety noLiveSend" ($greeting.safety.noLiveSend -eq $true) "" $greetingTimed.DurationMs
Add-Check $group "safety noSessionMutation" ($greeting.safety.noSessionMutation -eq $true) "" $greetingTimed.DurationMs
Add-Check $group "safety noOrderMutation" ($greeting.safety.noOrderMutation -eq $true) "" $greetingTimed.DurationMs
Add-Check $group "safety noMetaApi" ($greeting.safety.noMetaApi -eq $true) "" $greetingTimed.DurationMs

$group = "D Blocked states"
$shown = (Invoke-FirstEntryDryRun -Message "سلام" -Phone "0612345686" -MockState @{ firstEntryShown = $true }).Response
Add-Check $group "firstEntryShown ineligible" ($shown.result.eligibility.eligible -eq $false -and $shown.result.eligibility.reason -eq "already_shown") $shown.result.eligibility.reason

$history = (Invoke-FirstEntryDryRun -Message "سلام" -Phone "0612345687" -MockState @{ hasSessionHistory = $true }).Response
Add-Check $group "session history ineligible" ($history.result.eligibility.eligible -eq $false -and $history.result.eligibility.reason -eq "has_session_history") $history.result.eligibility.reason

$orderActive = (Invoke-FirstEntryDryRun -Message "سلام" -Phone "0612345688" -MockState @{ orderFlowActive = $true }).Response
Add-Check $group "order active ineligible" ($orderActive.result.eligibility.eligible -eq $false -and $orderActive.result.eligibility.reason -eq "order_flow_active") $orderActive.result.eligibility.reason

$confirmed = (Invoke-FirstEntryDryRun -Message "سلام" -Phone "0612345689" -MockState @{ orderConfirmed = $true }).Response
Add-Check $group "confirmed order ineligible" ($confirmed.result.eligibility.eligible -eq $false -and $confirmed.result.eligibility.reason -eq "order_confirmed") $confirmed.result.eligibility.reason

Add-Check $group "blocked result do_not_show" (
  $shown.result.recommendedNextStep -eq "do_not_show_first_entry" -and
  $history.result.recommendedNextStep -eq "do_not_show_first_entry" -and
  $orderActive.result.recommendedNextStep -eq "do_not_show_first_entry" -and
  $confirmed.result.recommendedNextStep -eq "do_not_show_first_entry"
) ""

$group = "E No persistence"
$persistPhone = "0612345690"
Clear-Session -SellerId $sellerId -Phone $persistPhone
[void](Invoke-FirstEntryDryRun -Message "سلام" -Phone $persistPhone -SellerId $sellerId)
$sessionTimed = Get-Session -SellerId $sellerId -Phone $persistPhone
$session = $sessionTimed.Response
Add-Check $group "dry-run does not save current message" ($session.messageCount -eq 0) "messageCount=$($session.messageCount)" $sessionTimed.DurationMs
Add-Check $group "dry-run does not mark firstEntryShown" ($null -eq $session.firstEntry -or $session.firstEntry.shown -ne $true) "firstEntry=$($session.firstEntry | ConvertTo-Json -Compress)" $sessionTimed.DurationMs

$failed = @($checks | Where-Object { -not $_.Passed })
$passed = $checks.Count - $failed.Count

Write-Host "Phase 1F first entry dry-run integration checks:"
$checks | Sort-Object Group, CheckName | Format-Table Group, CheckName, Passed, Details, DurationMs -AutoSize

Write-Host ("Total checks: {0}" -f $checks.Count)
Write-Host ("Passed: {0}" -f $passed)
Write-Host ("Failed: {0}" -f $failed.Count)

if ($failed.Count -gt 0) {
  throw ("Phase 1F checks failed: {0}" -f (($failed | ForEach-Object { "$($_.Group): $($_.CheckName)" }) -join ", "))
}

Write-Host "All Phase 1F first entry dry-run integration checks passed."

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
    $json = $Body | ConvertTo-Json -Depth 70
    $utf8Body = [System.Text.Encoding]::UTF8.GetBytes($json)
    $response = Invoke-RestMethod -Method $Method -Uri $Uri -ContentType "application/json; charset=utf-8" -Body $utf8Body
  }

  $watch.Stop()

  return [PSCustomObject]@{
    Response = $response
    DurationMs = [int]$watch.ElapsedMilliseconds
  }
}

function Clear-Session {
  param(
    [string]$SellerId,
    [string]$Phone
  )

  $uri = "{0}/api/agent/session/{1}?sellerId={2}" -f $BaseUrl, $Phone, $SellerId
  [void](Invoke-TimedJson -Method DELETE -Uri $uri)
}

function Send-CloudFlow {
  param(
    [string]$SellerId,
    [string]$Phone,
    [string]$Message = "",
    [object]$CloudMessage = $null,
    [string]$InputType = "text",
    [bool]$InteractiveEnabledOverride = $true
  )

  $body = @{
    sellerId = $SellerId
    customerPhone = $Phone
    phoneNumberId = "phase-0e-c2-c2-phone-number-id"
    forceDryRun = $true
    interactiveEnabledOverride = $InteractiveEnabledOverride
  }

  if ($Message) {
    $body.message = $Message
  }

  if ($null -ne $CloudMessage) {
    $body.cloudMessage = $CloudMessage
  }

  $result = Invoke-TimedJson -Method POST -Uri ("{0}/api/whatsapp/cloud/test-agent-dispatch-flow" -f $BaseUrl) -Body $body
  $response = $result.Response
  $summary = $response.meta.orderStateSummary
  $normalizedText =
    if ($response.cloudNormalization) {
      $response.cloudNormalization.normalizedText
    } else {
      $Message
    }

  $script:calls.Add([PSCustomObject]@{
    SellerId = $SellerId
    Phone = $Phone
    InputType = $InputType
    NormalizedText = $normalizedText
    Source = $response.source
    Reply = if ($response.reply.Length -gt 55) { $response.reply.Substring(0, 55) + "..." } else { $response.reply }
    Complete = $summary.isComplete
    Awaiting = $summary.awaitingConfirmation
    Confirmed = $summary.confirmed
    Missing = (@($summary.missingFields) -join ",")
    DurationMs = $result.DurationMs
  })

  return $response
}

function New-ButtonReply {
  param(
    [string]$Id,
    [string]$Title
  )

  return @{
    type = "interactive"
    interactive = @{
      type = "button_reply"
      button_reply = @{
        id = $Id
        title = $Title
      }
    }
  }
}

function New-ListReply {
  param(
    [string]$Id,
    [string]$Title
  )

  return @{
    type = "interactive"
    interactive = @{
      type = "list_reply"
      list_reply = @{
        id = $Id
        title = $Title
      }
    }
  }
}

function Has-PreviewListRowId {
  param(
    [object]$Result,
    [string]$Id
  )

  return @(
    $Result.meta.whatsappInteractivePreview.interactive.action.sections |
      ForEach-Object { $_.rows } |
      Where-Object { $_.id -eq $Id }
  ).Count -eq 1
}

function Has-PreviewButtonId {
  param(
    [object]$Result,
    [string]$Id
  )

  return @(
    $Result.meta.whatsappInteractivePreview.interactive.action.buttons |
      Where-Object { $_.reply.id -eq $Id }
  ).Count -eq 1
}

$medicalConfirmPhone = "2126000C2C2A"
Clear-Session -SellerId "seller_demo_medical" -Phone $medicalConfirmPhone
[void](Send-CloudFlow -SellerId "seller_demo_medical" -Phone $medicalConfirmPhone -Message "بغيت نكوموندي")
$medicalReady = Send-CloudFlow -SellerId "seller_demo_medical" -Phone $medicalConfirmPhone -Message "محمد 0612345678 مراكش"
Add-Check "medical ready before confirm is complete" ($medicalReady.meta.orderStateSummary.isComplete -eq $true)
Add-Check "medical ready before confirm awaits confirmation" ($medicalReady.meta.orderStateSummary.awaitingConfirmation -eq $true)
Add-Check "medical ready before confirm not confirmed" ($medicalReady.meta.orderStateSummary.confirmed -eq $false)
Add-Check "medical ready has structured review" ($medicalReady.reply -like "*راجع تفاصيل الطلب ديالك قبل ما نأكدوه*" -and $medicalReady.reply -like "*`n*معلومات التوصيل*`n*")
Add-Check "medical ready uses split confirmation presentation" ($medicalReady.meta.orderConfirmationPresentation.presentationMode -eq "split_order_review_and_confirmation" -and @($medicalReady.meta.orderConfirmationPresentation.messages).Count -eq 2)
Add-Check "medical confirmation CTA is short" ($medicalReady.meta.orderConfirmationPresentation.messages[1].text -eq "واش المعلومات كلها صحيحة؟")
Add-Check "medical ready has confirm button preview" ($medicalReady.meta.whatsappInteractivePreview.interactive.type -eq "button")
Add-Check "medical ready buttons include confirm" (Has-PreviewButtonId -Result $medicalReady -Id "order:confirm")
Add-Check "medical ready buttons include edit" (Has-PreviewButtonId -Result $medicalReady -Id "order:edit")
$medicalConfirmed = Send-CloudFlow -SellerId "seller_demo_medical" -Phone $medicalConfirmPhone -CloudMessage (New-ButtonReply -Id "confirm:yes" -Title "نعم") -InputType "button"
Add-Check "medical confirm click normalized to نعم" ($medicalConfirmed.cloudNormalization.normalizedText -eq "نعم")
Add-Check "medical confirm click confirms in Phase 4" ($medicalConfirmed.meta.orderStateSummary.confirmed -eq $true)
Add-Check "medical confirm reply has order id" ($medicalConfirmed.reply -like "*رقم الطلب:*")
Add-Check "medical confirm exposes public code only" ($medicalConfirmed.meta.publicOrderCode -match "^[A-Z0-9]{4}-[A-Z0-9]{4}$" -and -not ($medicalConfirmed.reply -match "[0-9a-f]{8}-[0-9a-f]{4}-"))
Add-Check "medical confirm dispatch dry-run" ($medicalConfirmed.dispatchResult.dryRun -eq $true)

$medicalEditPhone = "2126000C2C2B"
Clear-Session -SellerId "seller_demo_medical" -Phone $medicalEditPhone
[void](Send-CloudFlow -SellerId "seller_demo_medical" -Phone $medicalEditPhone -Message "بغيت نكوموندي")
[void](Send-CloudFlow -SellerId "seller_demo_medical" -Phone $medicalEditPhone -Message "محمد 0612345678 مراكش")
$medicalEdit = Send-CloudFlow -SellerId "seller_demo_medical" -Phone $medicalEditPhone -CloudMessage (New-ButtonReply -Id "confirm:edit" -Title "تعديل") -InputType "button"
Add-Check "medical edit click normalized to تعديل" ($medicalEdit.cloudNormalization.normalizedText -eq "تعديل")
Add-Check "medical edit click does not confirm" ($medicalEdit.meta.orderStateSummary.confirmed -eq $false)
Add-Check "medical edit reply asks what to edit" (($medicalEdit.reply -like "*تبدل*") -or ($medicalEdit.reply -like "*المعلومة*") -or ($medicalEdit.reply -like "*شنو*"))

$firstEntryOrderPhone = "2126000C2C2FE1"
Clear-Session -SellerId "seller_demo_sandals" -Phone $firstEntryOrderPhone
$firstEntryOrder = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $firstEntryOrderPhone -CloudMessage (New-ButtonReply -Id "first_entry:order_now" -Title "أطلب الآن") -InputType "button"
Add-Check "first entry order click normalized" ($firstEntryOrder.cloudNormalization.normalizedText -eq "first_entry:order_now")
Add-Check "first entry order click starts Phase 2A" ($firstEntryOrder.reply -like "*نبدأو الطلب ديالك*")
Add-Check "first entry order click asks size" ($firstEntryOrder.reply -like "*اختار المقاس*")
Add-Check "first entry order click does not safe-block" (-not ($firstEntryOrder.reply -like "*تجربة آمنة*"))
Add-Check "first entry order click keeps order incomplete" ($firstEntryOrder.meta.orderStateSummary.confirmed -eq $false -and @($firstEntryOrder.meta.orderStateSummary.missingFields) -contains "size")
Add-Check "first entry order click initializes order cycle" (-not [string]::IsNullOrWhiteSpace([string]$firstEntryOrder.meta.orderStateSummary.orderCycleId))
Add-Check "first entry order click has size list preview" ($firstEntryOrder.meta.whatsappInteractivePreview.interactive.type -eq "list")
Add-Check "first entry order click list includes size 36" (Has-PreviewListRowId -Result $firstEntryOrder -Id "size:36")
Add-Check "first entry order click list includes size 40" (Has-PreviewListRowId -Result $firstEntryOrder -Id "size:40")

$firstEntryInfoPhone = "2126000C2C2FE2"
Clear-Session -SellerId "seller_demo_sandals" -Phone $firstEntryInfoPhone
$firstEntryInfo = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $firstEntryInfoPhone -CloudMessage (New-ButtonReply -Id "first_entry:more_info" -Title "المزيد من المعلومات") -InputType "button"
Add-Check "first entry info click normalized" ($firstEntryInfo.cloudNormalization.normalizedText -eq "first_entry:more_info")
Add-Check "first entry info click opens menu" ($firstEntryInfo.reply -like "*شنو بغيتي تعرف على المنتج*")
Add-Check "first entry info click has list preview" ($firstEntryInfo.meta.whatsappInteractivePreview.interactive.type -eq "list")
Add-Check "first entry info menu includes price" (Has-PreviewListRowId -Result $firstEntryInfo -Id "info:price")
Add-Check "first entry info menu includes order" (Has-PreviewListRowId -Result $firstEntryInfo -Id "info:order_now")
Add-Check "first entry info click does not start order" (@($firstEntryInfo.meta.orderStateSummary.missingFields).Count -eq 0)

$infoOrderPhone = "2126000C2C2FE3"
Clear-Session -SellerId "seller_demo_sandals" -Phone $infoOrderPhone
$infoOrderStart = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $infoOrderPhone -CloudMessage (New-ButtonReply -Id "info:order_now" -Title "أطلب الآن") -InputType "button"
Add-Check "info order click initializes order cycle" (-not [string]::IsNullOrWhiteSpace([string]$infoOrderStart.meta.orderStateSummary.orderCycleId))
Add-Check "info order click starts clean draft" ($infoOrderStart.meta.orderStateSummary.confirmed -eq $false -and @($infoOrderStart.meta.orderStateSummary.collected.PSObject.Properties).Count -eq 0 -and @($infoOrderStart.meta.orderStateSummary.missingFields) -contains "size")

$sandalsPhone = "2126000C2C2C"
Clear-Session -SellerId "seller_demo_sandals" -Phone $sandalsPhone
[void](Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -Message "بغيت نكوموندي")
$sandalsPartial = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -Message "محمد 0612345678 مراكش حي السلام"
$sandalsInitialOrderCycleId = [string]$sandalsPartial.meta.orderStateSummary.orderCycleId
Add-Check "first order draft has cycle before confirmation" (-not [string]::IsNullOrWhiteSpace($sandalsInitialOrderCycleId))
$sandalsMissingPartial = @($sandalsPartial.meta.orderStateSummary.missingFields)
Add-Check "sandals partial still missing size" ($sandalsMissingPartial -contains "size")
Add-Check "sandals partial still missing color" ($sandalsMissingPartial -contains "color")
$sandalsSize = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -CloudMessage (New-ListReply -Id "size:38" -Title "38") -InputType "list"
$sandalsMissingSize = @($sandalsSize.meta.orderStateSummary.missingFields)
Add-Check "sandals size click normalized to 38" ($sandalsSize.cloudNormalization.normalizedText -eq "38")
Add-Check "sandals size click collects size" ($sandalsSize.meta.orderStateSummary.collected.size -eq "38")
Add-Check "incomplete order keeps same cycle" ([string]$sandalsSize.meta.orderStateSummary.orderCycleId -eq $sandalsInitialOrderCycleId)
Add-Check "sandals size click still missing color" ($sandalsMissingSize -contains "color")
Add-Check "sandals size click not complete yet" ($sandalsSize.meta.orderStateSummary.isComplete -eq $false)
Add-Check "sandals size click has color button preview" ($sandalsSize.meta.whatsappInteractivePreview.interactive.type -eq "button")
Add-Check "sandals size click buttons include black" (Has-PreviewButtonId -Result $sandalsSize -Id "color:أسود")
Add-Check "sandals size click buttons include pink" (Has-PreviewButtonId -Result $sandalsSize -Id "color:وردي")
$sandalsColor = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -CloudMessage (New-ListReply -Id "color:أسود" -Title "أسود") -InputType "list"
Add-Check "sandals color click normalized to أسود" ($sandalsColor.cloudNormalization.normalizedText -eq "أسود")
Add-Check "sandals color click collects color" ($sandalsColor.meta.orderStateSummary.collected.color -eq "أسود")
Add-Check "sandals color click still missing quantity" (@($sandalsColor.meta.orderStateSummary.missingFields) -contains "quantity")
Add-Check "sandals color click not complete before quantity" ($sandalsColor.meta.orderStateSummary.isComplete -eq $false)
$sandalsQuantity = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -Message "5"
Add-Check "sandals quantity text collects quantity" ([int]$sandalsQuantity.meta.orderStateSummary.collected.quantity -eq 5)
Add-Check "sandals quantity completes order" ($sandalsQuantity.meta.orderStateSummary.isComplete -eq $true)
Add-Check "sandals quantity awaits review" ($sandalsQuantity.meta.orderStateSummary.awaitingConfirmation -eq $true)
Add-Check "sandals quantity has structured review" ($sandalsQuantity.reply -like "*راجع تفاصيل الطلب ديالك قبل ما نأكدوه*" -and $sandalsQuantity.reply -like "*ثمن الوحدة: 199 درهم*" -and $sandalsQuantity.reply -like "*ثمن المنتجات: 995 درهم*" -and $sandalsQuantity.reply -like "*مصاريف التوصيل: غير محددة*" -and $sandalsQuantity.reply -like "*المجموع النهائي: يتحدد بعد تأكيد مصاريف التوصيل*")
Add-Check "sandals review and CTA are separate" ($sandalsQuantity.meta.orderConfirmationPresentation.messages[0].kind -eq "text" -and $sandalsQuantity.meta.orderConfirmationPresentation.messages[1].kind -eq "interactive_buttons" -and $sandalsQuantity.meta.orderConfirmationPresentation.messages[1].text -eq "واش المعلومات كلها صحيحة؟")
Add-Check "sandals quantity has confirm button preview" ($sandalsQuantity.meta.whatsappInteractivePreview.interactive.type -eq "button")
Add-Check "sandals quantity buttons include confirm" (Has-PreviewButtonId -Result $sandalsQuantity -Id "order:confirm")
Add-Check "sandals quantity buttons include edit" (Has-PreviewButtonId -Result $sandalsQuantity -Id "order:edit")
$sandalsConfirmed = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -CloudMessage (New-ButtonReply -Id "confirm:yes" -Title "نعم") -InputType "button"
Add-Check "sandals confirm click normalized to نعم" ($sandalsConfirmed.cloudNormalization.normalizedText -eq "نعم")
Add-Check "sandals confirm click confirms in Phase 4" ($sandalsConfirmed.meta.orderStateSummary.confirmed -eq $true)
Add-Check "sandals confirm reply has order id" ($sandalsConfirmed.reply -like "*رقم الطلب:*")
Add-Check "sandals confirm uses public order code" ($sandalsConfirmed.meta.publicOrderCode -match "^[A-Z0-9]{4}-[A-Z0-9]{4}$" -and $sandalsConfirmed.reply -like "*$($sandalsConfirmed.meta.publicOrderCode)*")
$sandalsOrders = @((Invoke-RestMethod -Method GET -Uri ("{0}/api/agent/orders" -f $BaseUrl)).orders)
$sandalsSavedOrder = @($sandalsOrders | Where-Object { $_.customerId -like "*$sandalsPhone" }) | Select-Object -First 1
Add-Check "sandals saved order keeps internal and public ids" ($sandalsSavedOrder.id -match "^[0-9a-f-]{36}$" -and $sandalsSavedOrder.publicOrderCode -eq $sandalsConfirmed.meta.publicOrderCode)
Add-Check "sandals saved order has non-empty cycle" (-not [string]::IsNullOrWhiteSpace([string]$sandalsSavedOrder.orderCycleId) -and [string]$sandalsSavedOrder.orderCycleId -eq $sandalsInitialOrderCycleId)
Add-Check "sandals saved totals are server calculated" ([decimal]$sandalsSavedOrder.unitPrice -eq 199 -and [decimal]$sandalsSavedOrder.subtotal -eq 995 -and [decimal]$sandalsSavedOrder.deliveryPrice -eq 0 -and [decimal]$sandalsSavedOrder.total -eq 995)
$sandalsDuplicate = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -CloudMessage (New-ButtonReply -Id "order:confirm" -Title "نأكد الطلب") -InputType "button"
$sandalsOrdersAfterDuplicate = @((Invoke-RestMethod -Method GET -Uri ("{0}/api/agent/orders" -f $BaseUrl)).orders | Where-Object { $_.customerId -like "*$sandalsPhone" })
Add-Check "duplicate confirmation keeps one order and public code" ($sandalsOrdersAfterDuplicate.Count -eq 1 -and $sandalsDuplicate.reply -like "*$($sandalsConfirmed.meta.publicOrderCode)*")
$sandalsThanks = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -Message "شكرا" -InputType "text"
Add-Check "post-confirm thanks is conversational" ($sandalsThanks.reply -like "*العفو*" -and $sandalsThanks.reply -notlike "*رقم الطلب:*")
$sandalsDeliveryQuestion = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -Message "فاش غادي يوصل؟" -InputType "text"
Add-Check "post-confirm delivery question still works" ($sandalsDeliveryQuestion.reply -like "*توصيل*" -or $sandalsDeliveryQuestion.reply -like "*24*" -or $sandalsDeliveryQuestion.reply -like "*72*")
$sandalsPriceQuestion = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -Message "شحال الثمن؟" -InputType "text"
Add-Check "post-confirm price question still works" ($sandalsPriceQuestion.reply -like "*199*" -and $sandalsPriceQuestion.reply -notlike "*رقم الطلب:*")
$sandalsStaleEdit = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -CloudMessage (New-ButtonReply -Id "order:edit" -Title "نبدل شي حاجة") -InputType "button"
$sandalsOrderAfterStaleEdit = @((Invoke-RestMethod -Method GET -Uri ("{0}/api/agent/orders" -f $BaseUrl)).orders | Where-Object { $_.customerId -like "*$sandalsPhone" }) | Select-Object -First 1
Add-Check "stale edit is blocked with public code" ($sandalsStaleEdit.reply -like "*تواصل مع المتجر قبل الشحن*" -and $sandalsStaleEdit.reply -like "*$($sandalsConfirmed.meta.publicOrderCode)*")
Add-Check "stale edit does not mutate saved order" ([int]$sandalsOrderAfterStaleEdit.quantity -eq 5 -and $sandalsOrderAfterStaleEdit.size -eq "38" -and $sandalsOrderAfterStaleEdit.color -eq "أسود")
$sandalsFirstPublicCode = [string]$sandalsSavedOrder.publicOrderCode
Clear-Session -SellerId "seller_demo_sandals" -Phone $sandalsPhone
$sandalsNewOrder = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -CloudMessage (New-ButtonReply -Id "info:order_now" -Title "أطلب الآن") -InputType "button"
$sandalsOrdersAfterNewDraft = @((Invoke-RestMethod -Method GET -Uri ("{0}/api/agent/orders" -f $BaseUrl)).orders | Where-Object { $_.customerId -like "*$sandalsPhone" })
Add-Check "session reset order starts fresh draft" ($sandalsNewOrder.reply -like "*نبدأو الطلب ديالك*" -and $sandalsNewOrder.meta.orderStateSummary.confirmed -eq $false -and @($sandalsNewOrder.meta.orderStateSummary.missingFields) -contains "size")
Add-Check "session reset creates new order cycle" (-not [string]::IsNullOrWhiteSpace([string]$sandalsNewOrder.meta.orderStateSummary.orderCycleId) -and [string]$sandalsNewOrder.meta.orderStateSummary.orderCycleId -ne $sandalsInitialOrderCycleId)
Add-Check "session reset clears old collected fields" (@($sandalsNewOrder.meta.orderStateSummary.collected.PSObject.Properties).Count -eq 0)
Add-Check "session reset keeps previous saved order only" ($sandalsOrdersAfterNewDraft.Count -eq 1 -and $sandalsOrdersAfterNewDraft[0].publicOrderCode -eq $sandalsFirstPublicCode)
$sandalsSecondSize = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -CloudMessage (New-ListReply -Id "size:40" -Title "40") -InputType "list"
Add-Check "second order size does not reuse old fields" ($sandalsSecondSize.meta.orderStateSummary.collected.size -eq "40" -and $null -eq $sandalsSecondSize.meta.orderStateSummary.collected.color -and $null -eq $sandalsSecondSize.meta.orderStateSummary.collected.fullName -and @($sandalsSecondSize.meta.orderStateSummary.missingFields) -contains "color" -and $sandalsSecondSize.reply -notlike "*راجع تفاصيل الطلب*")
$sandalsSecondColor = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -CloudMessage (New-ListReply -Id "color:وردي" -Title "وردي") -InputType "list"
$sandalsSecondQuantity = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -Message "5"
$sandalsSecondInfo = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -Message "يوسف 0611111111 الرباط حي النصر"
Add-Check "second order completes with new values" ($sandalsSecondInfo.meta.orderStateSummary.awaitingConfirmation -eq $true -and $sandalsSecondInfo.meta.orderStateSummary.collected.fullName -eq "يوسف" -and $sandalsSecondInfo.meta.orderStateSummary.collected.phone -eq "0611111111" -and $sandalsSecondInfo.meta.orderStateSummary.collected.city -eq "الرباط" -and $sandalsSecondInfo.meta.orderStateSummary.collected.address -eq "حي النصر" -and $sandalsSecondInfo.meta.orderStateSummary.collected.color -eq "وردي" -and [int]$sandalsSecondInfo.meta.orderStateSummary.collected.quantity -eq 5)
Add-Check "second draft keeps new cycle" ([string]$sandalsSecondInfo.meta.orderStateSummary.orderCycleId -eq [string]$sandalsNewOrder.meta.orderStateSummary.orderCycleId)
$sandalsSecondConfirmed = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -CloudMessage (New-ButtonReply -Id "order:confirm" -Title "نأكد الطلب") -InputType "button"
$sandalsOrdersAfterSecondConfirm = @((Invoke-RestMethod -Method GET -Uri ("{0}/api/agent/orders" -f $BaseUrl)).orders | Where-Object { $_.customerId -like "*$sandalsPhone" })
$sandalsSecondSavedOrder = @($sandalsOrdersAfterSecondConfirm | Where-Object { $_.publicOrderCode -eq $sandalsSecondConfirmed.meta.publicOrderCode }) | Select-Object -First 1
Add-Check "second confirmation creates second order" ($sandalsOrdersAfterSecondConfirm.Count -eq 2 -and $sandalsSecondConfirmed.meta.publicOrderCode -ne $sandalsConfirmed.meta.publicOrderCode)
Add-Check "second saved order has separate identity and values" ($sandalsSecondSavedOrder.id -ne $sandalsSavedOrder.id -and $sandalsSecondSavedOrder.publicOrderCode -ne $sandalsSavedOrder.publicOrderCode -and $sandalsSecondSavedOrder.orderCycleId -ne $sandalsSavedOrder.orderCycleId -and $sandalsSecondSavedOrder.fullName -eq "يوسف" -and $sandalsSecondSavedOrder.phone -eq "0611111111" -and $sandalsSecondSavedOrder.city -eq "الرباط" -and $sandalsSecondSavedOrder.address -eq "حي النصر" -and $sandalsSecondSavedOrder.size -eq "40" -and $sandalsSecondSavedOrder.color -eq "وردي" -and [int]$sandalsSecondSavedOrder.quantity -eq 5)
$sandalsSecondDuplicate = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $sandalsPhone -CloudMessage (New-ButtonReply -Id "order:confirm" -Title "نأكد الطلب") -InputType "button"
$sandalsOrdersAfterSecondDuplicate = @((Invoke-RestMethod -Method GET -Uri ("{0}/api/agent/orders" -f $BaseUrl)).orders | Where-Object { $_.customerId -like "*$sandalsPhone" })
Add-Check "second duplicate confirmation keeps two orders" ($sandalsOrdersAfterSecondDuplicate.Count -eq 2 -and $sandalsSecondDuplicate.reply -like "*$($sandalsSecondConfirmed.meta.publicOrderCode)*")
Add-Check "sandals confirm dispatch dry-run" ($sandalsConfirmed.dispatchResult.dryRun -eq $true)

$quantityWordPhone = "2126000C2C2Q"
Clear-Session -SellerId "seller_demo_sandals" -Phone $quantityWordPhone
[void](Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $quantityWordPhone -Message "بغيت نكوموندي")
[void](Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $quantityWordPhone -CloudMessage (New-ListReply -Id "size:38" -Title "38") -InputType "list")
[void](Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $quantityWordPhone -CloudMessage (New-ListReply -Id "color:أسود" -Title "أسود") -InputType "list")
$quantityWordResult = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $quantityWordPhone -Message "واحداة" -InputType "text"
Add-Check "quantity word واحداة collects quantity only" ([int]$quantityWordResult.meta.orderStateSummary.collected.quantity -eq 1 -and $null -eq $quantityWordResult.meta.orderStateSummary.collected.fullName)
Add-Check "quantity word asks delivery information next" ($quantityWordResult.reply -like "*معلومات التوصيل*" -or $quantityWordResult.reply -like "*الاسم الكامل*")

$unseenCityPhone = "2126000C2C2U"
Clear-Session -SellerId "seller_demo_sandals" -Phone $unseenCityPhone
[void](Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $unseenCityPhone -Message "بغيت نكوموندي")
[void](Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $unseenCityPhone -Message "سارة 0612345678 حي النصر")
$unseenCityOne = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $unseenCityPhone -Message "دوار النخيل الجديدة"
Add-Check "unseen locality one is accepted as city" ($unseenCityOne.meta.orderStateSummary.collected.city -eq "دوار النخيل الجديدة" -and @($unseenCityOne.meta.orderStateSummary.missingFields) -notcontains "city")

$secondUnseenCityPhone = "2126000C2C2V"
Clear-Session -SellerId "seller_demo_sandals" -Phone $secondUnseenCityPhone
[void](Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $secondUnseenCityPhone -Message "بغيت نكوموندي")
[void](Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $secondUnseenCityPhone -Message "ليلى 0612222222 حي القدس")
$unseenCityTwo = Send-CloudFlow -SellerId "seller_demo_sandals" -Phone $secondUnseenCityPhone -Message "منطقة الأمل الشرقية"
Add-Check "unseen locality two is accepted generically" ($unseenCityTwo.meta.orderStateSummary.collected.city -eq "منطقة الأمل الشرقية" -and @($unseenCityTwo.meta.orderStateSummary.missingFields) -notcontains "city")

$normalPhone = "2126000C2C2D"
Clear-Session -SellerId "seller_demo_medical" -Phone $normalPhone
$normalText = Send-CloudFlow -SellerId "seller_demo_medical" -Phone $normalPhone -Message "سلام" -InputType "text"
Add-Check "normal text flow has no cloud normalization metadata" ($null -eq $normalText.cloudNormalization)
Add-Check "normal text flow replies normally" ($normalText.reply.Length -gt 0)
Add-Check "normal text flow dry-run only" ($normalText.dispatchResult.dryRun -eq $true)

$failed = @($checks | Where-Object { -not $_.Passed })

Write-Host "Phase 0E-C2-C2 interactive order flow calls:"
$calls | Format-Table -AutoSize

Write-Host "Phase 0E-C2-C2 interactive order flow checks:"
$checks | Format-Table -AutoSize

if ($failed.Count -gt 0) {
  throw ("Phase 0E-C2-C2 checks failed: {0}" -f (($failed | ForEach-Object { $_.Name }) -join ", "))
}

Write-Host "All Phase 0E-C2-C2 interactive order flow checks passed."

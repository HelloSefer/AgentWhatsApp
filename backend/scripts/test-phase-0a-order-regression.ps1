param(
  [string]$BaseUrl = "http://localhost:5000"
)

$ErrorActionPreference = "Stop"
$seller = "seller_demo_sandals"
$phone = "212600000009"
$expectedConversationKey = "{0}:{1}" -f $seller, $phone
$results = New-Object System.Collections.Generic.List[object]
$checks = New-Object System.Collections.Generic.List[object]

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
    $json = $Body | ConvertTo-Json -Depth 20
    $utf8Body = [System.Text.Encoding]::UTF8.GetBytes($json)
    $response = Invoke-RestMethod -Method $Method -Uri $Uri -ContentType "application/json; charset=utf-8" -Body $utf8Body
  }

  $watch.Stop()

  return [PSCustomObject]@{
    Response = $response
    DurationMs = [int]$watch.ElapsedMilliseconds
  }
}

function Get-CollectedValue {
  param(
    [object]$Result,
    [string]$Field
  )

  return $Result.Response.meta.orderStateSummary.collected.$Field
}

function Get-MissingFields {
  param([object]$Result)

  return @($Result.Response.meta.orderStateSummary.missingFields)
}

Write-Host "Phase 0A order regression test against $BaseUrl"

$sessionUri = "{0}/api/agent/session/{1}?sellerId={2}" -f $BaseUrl, $phone, $seller
$deleteResult = Invoke-TimedJson -Method DELETE -Uri $sessionUri
Write-Host "DELETE $sessionUri -> $($deleteResult.DurationMs)ms deleted=$($deleteResult.Response.deleted)"

$messages = @(
  "سلام",
  "بغيت نكوموندي",
  "مقاس 38",
  "مراكش",
  "محمد 0612345678 حي السلام",
  "أسود 1",
  "نعم"
)

foreach ($message in $messages) {
  $uri = "{0}/api/agent/test" -f $BaseUrl
  $result = Invoke-TimedJson -Method POST -Uri $uri -Body @{
    message = $message
    useMemory = $true
    sellerId = $seller
    customerPhone = $phone
  }
  $summary = $result.Response.meta.orderStateSummary
  $collectedJson = if ($summary -and $summary.collected) {
    $summary.collected | ConvertTo-Json -Compress -Depth 10
  } else {
    "{}"
  }
  $missingText = if ($summary -and $summary.missingFields) {
    (@($summary.missingFields) -join ",")
  } else {
    ""
  }

  $results.Add([PSCustomObject]@{
    Message = $message
    DurationMs = $result.DurationMs
    ConversationKey = $result.Response.identity.conversationKey
    Source = $result.Response.source
    Reply = $result.Response.reply
    MissingFields = $missingText
    Collected = $collectedJson
    AwaitingConfirmation = $summary.awaitingConfirmation
    Confirmed = $summary.confirmed
  })

  Add-Check `
    -Name "identity stays stable after '$message'" `
    -Passed ($result.Response.identity.conversationKey -eq $expectedConversationKey) `
    -Details $result.Response.identity.conversationKey

  if ($message -eq "محمد 0612345678 حي السلام") {
    Add-Check `
      -Name "compact name phone address collected" `
      -Passed (
        (Get-CollectedValue -Result $result -Field "fullName") -eq "محمد" -and
        (Get-CollectedValue -Result $result -Field "phone") -eq "0612345678" -and
        (Get-CollectedValue -Result $result -Field "address") -eq "حي السلام"
      ) `
      -Details $collectedJson
  }

  if ($message -eq "أسود 1") {
    Add-Check `
      -Name "color and quantity collected" `
      -Passed (
        (Get-CollectedValue -Result $result -Field "color") -eq "أسود" -and
        (Get-CollectedValue -Result $result -Field "quantity") -eq 1
      ) `
      -Details $collectedJson

    Add-Check `
      -Name "order reaches awaiting confirmation after all fields" `
      -Passed ($summary.awaitingConfirmation -eq $true -and $summary.isComplete -eq $true) `
      -Details "awaitingConfirmation=$($summary.awaitingConfirmation), isComplete=$($summary.isComplete), missing=$missingText"
  }

  if ($message -eq "نعم") {
    Add-Check `
      -Name "order confirmed after yes" `
      -Passed ($summary.confirmed -eq $true) `
      -Details "confirmed=$($summary.confirmed), missing=$missingText"
  }
}

$finalSession = Invoke-TimedJson -Method GET -Uri $sessionUri
Add-Check `
  -Name "final session is stored under conversation key" `
  -Passed (
    $finalSession.Response.identity.conversationKey -eq $expectedConversationKey -and
    $finalSession.Response.sessionKey -eq "session:$expectedConversationKey"
  ) `
  -Details "$($finalSession.Response.identity.conversationKey) / $($finalSession.Response.sessionKey)"

Write-Host ""
$results | Format-Table -AutoSize -Wrap

Write-Host ""
$checks | Format-Table -AutoSize -Wrap

$failed = @($checks | Where-Object { -not $_.Passed })

if ($failed.Count -gt 0) {
  Write-Host ""
  Write-Host "Failed checks: $($failed.Count)"
  exit 1
}

Write-Host ""
Write-Host "All Phase 0A order regression checks passed."

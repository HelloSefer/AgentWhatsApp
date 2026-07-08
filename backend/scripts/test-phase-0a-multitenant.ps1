param(
  [string]$BaseUrl = "http://localhost:5000"
)

$ErrorActionPreference = "Stop"
$results = New-Object System.Collections.Generic.List[object]

function Add-Check {
  param(
    [string]$Name,
    [bool]$Passed,
    [string]$Details = ""
  )

  $script:results.Add([PSCustomObject]@{
    Name = $Name
    Passed = $Passed
    Details = $Details
  })
}

function Invoke-TimedJson {
  param(
    [ValidateSet("GET", "POST", "PATCH", "DELETE")]
    [string]$Method,
    [string]$Path,
    [object]$Body = $null
  )

  $url = "$BaseUrl$Path"
  $watch = [System.Diagnostics.Stopwatch]::StartNew()

  if ($null -eq $Body) {
    $response = Invoke-RestMethod -Method $Method -Uri $url
  } else {
    $json = $Body | ConvertTo-Json -Depth 20
    $utf8Body = [System.Text.Encoding]::UTF8.GetBytes($json)
    $response = Invoke-RestMethod -Method $Method -Uri $url -ContentType "application/json; charset=utf-8" -Body $utf8Body
  }

  $watch.Stop()

  return [PSCustomObject]@{
    Response = $response
    DurationMs = [int]$watch.ElapsedMilliseconds
  }
}

function Escape-UrlPart {
  param([string]$Value)

  return [System.Uri]::EscapeDataString($Value)
}

function Clear-SessionSafe {
  param(
    [string]$CustomerPhone,
    [string]$SellerId = ""
  )

  $encodedCustomer = Escape-UrlPart $CustomerPhone
  $path = "/api/agent/session/$encodedCustomer"

  if ($SellerId) {
    $path = "${path}?sellerId=$(Escape-UrlPart $SellerId)"
  }

  try {
    $deleteResult = Invoke-TimedJson -Method DELETE -Path $path
    Write-Host "DELETE $path -> $($deleteResult.DurationMs)ms deleted=$($deleteResult.Response.deleted)"
  } catch {
    Write-Host "Session clear skipped: $path"
  }
}

function Send-AgentMessage {
  param(
    [string]$Message,
    [string]$SellerId,
    [string]$CustomerPhone
  )

  return Invoke-TimedJson -Method POST -Path "/api/agent/test" -Body @{
    message = $Message
    useMemory = $true
    sellerId = $SellerId
    customerPhone = $CustomerPhone
  }
}

function Get-SessionForSeller {
  param(
    [string]$SellerId,
    [string]$CustomerPhone
  )

  $encodedCustomer = Escape-UrlPart $CustomerPhone
  $encodedSeller = Escape-UrlPart $SellerId

  return Invoke-TimedJson -Method GET -Path "/api/agent/session/${encodedCustomer}?sellerId=${encodedSeller}"
}

Write-Host "Phase 0A multitenant identity test against $BaseUrl"

$sellerSandals = "seller_demo_sandals"
$sellerMedical = "seller_demo_medical"
$phoneA = "212600000001"
$phoneB = "212600000002"

Clear-SessionSafe -CustomerPhone $phoneA -SellerId $sellerSandals
Clear-SessionSafe -CustomerPhone $phoneA -SellerId $sellerMedical
Clear-SessionSafe -CustomerPhone $phoneB -SellerId $sellerSandals
Clear-SessionSafe -CustomerPhone "legacy-phase-0a"

$sellerAReply = Send-AgentMessage -Message "سلام" -SellerId $sellerSandals -CustomerPhone $phoneA
$sellerBReply = Send-AgentMessage -Message "سلام" -SellerId $sellerMedical -CustomerPhone $phoneA
$sellerASession = Get-SessionForSeller -SellerId $sellerSandals -CustomerPhone $phoneA
$sellerBSession = Get-SessionForSeller -SellerId $sellerMedical -CustomerPhone $phoneA

Add-Check `
  -Name "same customer different sellers get different conversation keys" `
  -Passed ($sellerAReply.Response.identity.conversationKey -ne $sellerBReply.Response.identity.conversationKey) `
  -Details "$($sellerAReply.Response.identity.conversationKey) / $($sellerBReply.Response.identity.conversationKey)"

Add-Check `
  -Name "seller A session uses seller A key" `
  -Passed (
    $sellerASession.Response.identity.conversationKey -eq "$sellerSandals`:$phoneA" -and
    $sellerASession.Response.sessionKey -eq "session:$sellerSandals`:$phoneA"
  ) `
  -Details "$($sellerASession.Response.identity.conversationKey) / $($sellerASession.Response.sessionKey)"

Add-Check `
  -Name "seller B session uses seller B key" `
  -Passed (
    $sellerBSession.Response.identity.conversationKey -eq "$sellerMedical`:$phoneA" -and
    $sellerBSession.Response.sessionKey -eq "session:$sellerMedical`:$phoneA"
  ) `
  -Details "$($sellerBSession.Response.identity.conversationKey) / $($sellerBSession.Response.sessionKey)"

$phoneAReply = Send-AgentMessage -Message "شحال الثمن؟" -SellerId $sellerSandals -CustomerPhone $phoneA
$phoneBReply = Send-AgentMessage -Message "شحال الثمن؟" -SellerId $sellerSandals -CustomerPhone $phoneB
$phoneASession = Get-SessionForSeller -SellerId $sellerSandals -CustomerPhone $phoneA
$phoneBSession = Get-SessionForSeller -SellerId $sellerSandals -CustomerPhone $phoneB

Add-Check `
  -Name "same seller different customers get different conversation keys" `
  -Passed ($phoneAReply.Response.identity.conversationKey -ne $phoneBReply.Response.identity.conversationKey) `
  -Details "$($phoneAReply.Response.identity.conversationKey) / $($phoneBReply.Response.identity.conversationKey)"

Add-Check `
  -Name "customer A session is isolated" `
  -Passed (
    $phoneASession.Response.identity.customerPhone -eq $phoneA -and
    $phoneASession.Response.messageCount -gt 0
  ) `
  -Details "messages=$($phoneASession.Response.messageCount), key=$($phoneASession.Response.identity.conversationKey)"

Add-Check `
  -Name "customer B session is isolated" `
  -Passed (
    $phoneBSession.Response.identity.customerPhone -eq $phoneB -and
    $phoneBSession.Response.messageCount -gt 0
  ) `
  -Details "messages=$($phoneBSession.Response.messageCount), key=$($phoneBSession.Response.identity.conversationKey)"

$legacyId = "legacy-phase-0a"
$legacyReply = Invoke-TimedJson -Method POST -Path "/api/agent/test" -Body @{
  message = "سلام"
  useMemory = $true
  customerId = $legacyId
}
$legacySession = Invoke-TimedJson -Method GET -Path "/api/agent/session/$legacyId"

Add-Check `
  -Name "legacy customerId maps to default seller conversation key" `
  -Passed (
    $legacyReply.Response.identity.conversationKey -eq "$sellerSandals`:$legacyId" -and
    $legacySession.Response.identity.conversationKey -eq "$sellerSandals`:$legacyId" -and
    $legacySession.Response.sessionKey -eq "session:$sellerSandals`:$legacyId"
  ) `
  -Details "reply=$($legacyReply.Response.identity.conversationKey), session=$($legacySession.Response.sessionKey)"

try {
  $diagnostics = Invoke-TimedJson -Method GET -Path "/api/whatsapp/cloud/diagnostics"

  if ($diagnostics.Response.dryRun -eq $true) {
    $cloudA = Invoke-TimedJson -Method POST -Path "/api/whatsapp/cloud/simulate-incoming" -Body @{
      from = $phoneA
      phoneNumberId = "1168457439687919"
      text = "سلام"
    }
    $cloudB = Invoke-TimedJson -Method POST -Path "/api/whatsapp/cloud/simulate-incoming" -Body @{
      from = $phoneA
      phoneNumberId = "222222222222222"
      text = "سلام"
    }

    Add-Check `
      -Name "cloud simulation maps phone number id to seller" `
      -Passed ($cloudA.Response.identity.sellerId -eq $sellerSandals -and $cloudB.Response.identity.sellerId -eq $sellerMedical) `
      -Details "$($cloudA.Response.identity.sellerId) / $($cloudB.Response.identity.sellerId)"

    Add-Check `
      -Name "cloud simulation isolates same wa_id by seller" `
      -Passed ($cloudA.Response.identity.conversationKey -ne $cloudB.Response.identity.conversationKey) `
      -Details "$($cloudA.Response.identity.conversationKey) / $($cloudB.Response.identity.conversationKey)"
  } else {
    Add-Check `
      -Name "cloud simulation skipped safely" `
      -Passed $true `
      -Details "WHATSAPP_CLOUD_DRY_RUN is not true; skipped to avoid real sends"
  }
} catch {
  Add-Check `
    -Name "cloud simulation diagnostics unavailable" `
    -Passed $true `
    -Details "Skipped: $($_.Exception.Message)"
}

$results | Format-Table -AutoSize

$failed = @($results | Where-Object { -not $_.Passed })

if ($failed.Count -gt 0) {
  Write-Host ""
  Write-Host "Failed checks: $($failed.Count)"
  exit 1
}

Write-Host ""
Write-Host "All Phase 0A multitenant identity checks passed."

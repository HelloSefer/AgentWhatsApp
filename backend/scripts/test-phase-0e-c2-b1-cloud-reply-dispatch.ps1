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
    [object]$Body
  )

  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $json = $Body | ConvertTo-Json -Depth 50
  $utf8Body = [System.Text.Encoding]::UTF8.GetBytes($json)
  $response = Invoke-RestMethod -Method POST -Uri ("{0}/api/whatsapp/cloud/test-dispatch-agent-reply" -f $BaseUrl) -ContentType "application/json; charset=utf-8" -Body $utf8Body
  $watch.Stop()

  $script:calls.Add([PSCustomObject]@{
    Mode = $response.mode
    Ok = $response.ok
    DryRun = $response.dryRun
    FallbackUsed = $response.fallbackUsed
    Reason = $response.reason
    DurationMs = [int]$watch.ElapsedMilliseconds
  })

  return $response
}

function New-ButtonPreview {
  param(
    [int]$ButtonCount = 2
  )

  $buttons = @(
    @{ type = "reply"; reply = @{ id = "confirm:yes"; title = "نعم" } },
    @{ type = "reply"; reply = @{ id = "confirm:edit"; title = "تعديل" } },
    @{ type = "reply"; reply = @{ id = "confirm:no"; title = "لا" } },
    @{ type = "reply"; reply = @{ id = "confirm:extra"; title = "Extra" } }
  ) | Select-Object -First $ButtonCount

  return @{
    type = "interactive"
    interactive = @{
      type = "button"
      body = @{
        text = "تمام، واش نأكد لك الطلب؟"
      }
      action = @{
        buttons = $buttons
      }
    }
  }
}

function New-ListPreview {
  return @{
    type = "interactive"
    interactive = @{
      type = "list"
      body = @{
        text = "اختاري المقاس ديالك"
      }
      action = @{
        button = "المقاسات"
        sections = @(
          @{
            title = "المقاسات المتوفرة"
            rows = @(
              @{ id = "size:36"; title = "36" },
              @{ id = "size:38"; title = "38" },
              @{ id = "size:40"; title = "40" }
            )
          }
        )
      }
    }
  }
}

$textOnlyDecision = @{
  mode = "text_only"
  reason = "interactive_disabled"
  channel = "test"
  interactiveEnabled = $false
  previewAvailable = $false
}

$buttonDecision = @{
  mode = "interactive_preview"
  reason = "preview_available"
  channel = "whatsapp_cloud"
  interactiveEnabled = $true
  previewAvailable = $true
  interactiveType = "button"
}

$listDecision = @{
  mode = "interactive_preview"
  reason = "preview_available"
  channel = "whatsapp_cloud"
  interactiveEnabled = $true
  previewAvailable = $true
  interactiveType = "list"
}

$textResponse = Invoke-TimedJson -Body @{
  to = "212600000000"
  replyText = "رسالة نصية فقط"
  forceDryRun = $true
  interactiveSendDecision = $textOnlyDecision
  whatsappInteractivePreview = $null
}
Add-Check "text-only decision dispatches text" ($textResponse.ok -eq $true -and $textResponse.mode -eq "text")
Add-Check "text-only dispatch is dry-run" ($textResponse.dryRun -eq $true -and $textResponse.textResult.dryRun -eq $true)
Add-Check "text-only has no interactive result" ($null -eq $textResponse.interactiveResult)

$buttonResponse = Invoke-TimedJson -Body @{
  to = "212600000000"
  replyText = "تمام، واش نأكد لك الطلب؟"
  forceDryRun = $true
  interactiveSendDecision = $buttonDecision
  whatsappInteractivePreview = New-ButtonPreview
}
Add-Check "button decision dispatches interactive" ($buttonResponse.ok -eq $true -and $buttonResponse.mode -eq "interactive")
Add-Check "button dispatch is dry-run" ($buttonResponse.dryRun -eq $true -and $buttonResponse.interactiveResult.dryRun -eq $true)
Add-Check "button payload type preserved" ($buttonResponse.interactiveResult.payload.interactive.type -eq "button")
Add-Check "button ids preserved" (@($buttonResponse.interactiveResult.payload.interactive.action.buttons | Where-Object { $_.reply.id -eq "confirm:yes" }).Count -eq 1)

$listResponse = Invoke-TimedJson -Body @{
  to = "212600000000"
  replyText = "اختاري المقاس ديالك"
  forceDryRun = $true
  interactiveSendDecision = $listDecision
  whatsappInteractivePreview = New-ListPreview
}
Add-Check "list decision dispatches interactive" ($listResponse.ok -eq $true -and $listResponse.mode -eq "interactive")
Add-Check "list dispatch is dry-run" ($listResponse.dryRun -eq $true -and $listResponse.interactiveResult.dryRun -eq $true)
Add-Check "list payload type preserved" ($listResponse.interactiveResult.payload.interactive.type -eq "list")
Add-Check "list row ids preserved" (@($listResponse.interactiveResult.payload.interactive.action.sections[0].rows | Where-Object { $_.id -eq "size:38" }).Count -eq 1)

$fallbackResponse = Invoke-TimedJson -Body @{
  to = "212600000000"
  replyText = "نرجعو للرسالة النصية."
  forceDryRun = $true
  interactiveSendDecision = $buttonDecision
  whatsappInteractivePreview = New-ButtonPreview -ButtonCount 4
}
Add-Check "invalid interactive falls back to text" ($fallbackResponse.ok -eq $true -and $fallbackResponse.mode -eq "text")
Add-Check "fallbackUsed is true" ($fallbackResponse.fallbackUsed -eq $true)
Add-Check "fallback reason is explicit" ($fallbackResponse.reason -eq "interactive_failed_fallback_text")
Add-Check "interactive result has validation failure" ($fallbackResponse.interactiveResult.success -eq $false -and $fallbackResponse.interactiveResult.errorMessage -like "*at most 3*")
Add-Check "text fallback dry-run happened" ($fallbackResponse.textResult.success -eq $true -and $fallbackResponse.textResult.dryRun -eq $true)

$failed = $checks | Where-Object { -not $_.Passed }

Write-Host "Phase 0E-C2-B1 Cloud reply dispatch calls:"
$calls | Format-Table -AutoSize

Write-Host "Phase 0E-C2-B1 Cloud reply dispatch checks:"
$checks | Format-Table -AutoSize

if ($failed.Count -gt 0) {
  throw ("Phase 0E-C2-B1 checks failed: {0}" -f (($failed | ForEach-Object { $_.Name }) -join ", "))
}

Write-Host "All Phase 0E-C2-B1 Cloud reply dispatch checks passed."

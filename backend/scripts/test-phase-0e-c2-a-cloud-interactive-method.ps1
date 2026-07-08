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
    [string]$Uri,
    [object]$Body
  )

  $watch = [System.Diagnostics.Stopwatch]::StartNew()

  try {
    $json = $Body | ConvertTo-Json -Depth 40
    $utf8Body = [System.Text.Encoding]::UTF8.GetBytes($json)
    $response = Invoke-RestMethod -Method POST -Uri $Uri -ContentType "application/json; charset=utf-8" -Body $utf8Body
    $statusCode = 200
  } catch {
    $statusCode = [int]$_.Exception.Response.StatusCode
    $stream = $_.Exception.Response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $errorBody = $reader.ReadToEnd()
    $response = $errorBody | ConvertFrom-Json
  }

  $watch.Stop()

  return [PSCustomObject]@{
    StatusCode = $statusCode
    Response = $response
    DurationMs = [int]$watch.ElapsedMilliseconds
  }
}

function Send-InteractivePreview {
  param(
    [object]$InteractivePreview
  )

  $result = Invoke-TimedJson -Uri ("{0}/api/whatsapp/cloud/test-send-interactive-preview" -f $BaseUrl) -Body @{
    to = "212600000000"
    phoneNumberId = "dry-run-phone-number-id"
    interactivePreview = $InteractivePreview
  }

  $script:calls.Add([PSCustomObject]@{
    StatusCode = $result.StatusCode
    DurationMs = $result.DurationMs
    Success = $result.Response.success
    DryRun = $result.Response.dryRun
    ErrorMessage = $result.Response.errorMessage
    InteractiveType = $result.Response.payload.interactive.type
  })

  return $result.Response
}

$buttonPreview = @{
  type = "interactive"
  interactive = @{
    type = "button"
    body = @{
      text = "واش نأكد لك الطلب؟"
    }
    action = @{
      buttons = @(
        @{
          type = "reply"
          reply = @{
            id = "order_confirm_yes"
            title = "نعم أكد"
          }
        },
        @{
          type = "reply"
          reply = @{
            id = "order_confirm_edit"
            title = "نبدل"
          }
        }
      )
    }
  }
}

$buttonResponse = Send-InteractivePreview -InteractivePreview $buttonPreview
Add-Check "button dry-run succeeds" ($buttonResponse.success -eq $true -and $buttonResponse.dryRun -eq $true)
Add-Check "button payload is Cloud interactive" ($buttonResponse.payload.type -eq "interactive" -and $buttonResponse.payload.interactive.type -eq "button")
Add-Check "button ids preserved" (@($buttonResponse.payload.interactive.action.buttons | Where-Object { $_.reply.id -eq "order_confirm_yes" }).Count -eq 1)

$listPreview = @{
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
            @{
              id = "size:36"
              title = "36"
            },
            @{
              id = "size:38"
              title = "38"
            },
            @{
              id = "size:40"
              title = "40"
            }
          )
        }
      )
    }
  }
}

$listResponse = Send-InteractivePreview -InteractivePreview $listPreview
Add-Check "list dry-run succeeds" ($listResponse.success -eq $true -and $listResponse.dryRun -eq $true)
Add-Check "list payload is Cloud interactive" ($listResponse.payload.type -eq "interactive" -and $listResponse.payload.interactive.type -eq "list")
Add-Check "list row ids preserved" (@($listResponse.payload.interactive.action.sections[0].rows | Where-Object { $_.id -eq "size:38" }).Count -eq 1)

$invalidButtonPreview = @{
  type = "interactive"
  interactive = @{
    type = "button"
    body = @{
      text = "Too many buttons"
    }
    action = @{
      buttons = @(
        @{ type = "reply"; reply = @{ id = "one"; title = "One" } },
        @{ type = "reply"; reply = @{ id = "two"; title = "Two" } },
        @{ type = "reply"; reply = @{ id = "three"; title = "Three" } },
        @{ type = "reply"; reply = @{ id = "four"; title = "Four" } }
      )
    }
  }
}

$invalidResponse = Send-InteractivePreview -InteractivePreview $invalidButtonPreview
Add-Check "invalid button count rejected" ($invalidResponse.success -eq $false -and $invalidResponse.errorMessage -like "*at most 3*")
Add-Check "invalid preview does not build payload" ($null -eq $invalidResponse.payload)

$failed = $checks | Where-Object { -not $_.Passed }

Write-Host "Phase 0E-C2-A Cloud interactive method calls:"
$calls | Format-Table -AutoSize

Write-Host "Phase 0E-C2-A Cloud interactive method checks:"
$checks | Format-Table -AutoSize

if ($failed.Count -gt 0) {
  throw ("Phase 0E-C2-A checks failed: {0}" -f (($failed | ForEach-Object { $_.Name }) -join ", "))
}

Write-Host "All Phase 0E-C2-A Cloud interactive method checks passed."

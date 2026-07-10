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

function Invoke-Normalize {
  param(
    [object]$Message
  )

  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $body = @{ message = $Message }
  $json = $body | ConvertTo-Json -Depth 50
  $utf8Body = [System.Text.Encoding]::UTF8.GetBytes($json)
  $response = Invoke-RestMethod -Method POST -Uri ("{0}/api/whatsapp/cloud/test-normalize-interactive-reply" -f $BaseUrl) -ContentType "application/json; charset=utf-8" -Body $utf8Body
  $watch.Stop()

  $script:calls.Add([PSCustomObject]@{
    Kind = $response.normalized.kind
    InteractiveType = $response.normalized.interactiveType
    ReplyId = $response.normalized.replyId
    NormalizedText = $response.normalized.normalizedText
    Source = $response.normalized.normalizedSource
    DurationMs = [int]$watch.ElapsedMilliseconds
  })

  return $response
}

$textResponse = Invoke-Normalize -Message @{
  type = "text"
  text = @{
    body = "سلام"
  }
}
Add-Check "normal text kind is text" ($textResponse.ok -eq $true -and $textResponse.normalized.kind -eq "text")
Add-Check "normal text unchanged" ($textResponse.normalized.normalizedText -eq "سلام")

$confirmYes = Invoke-Normalize -Message @{
  type = "interactive"
  interactive = @{
    type = "button_reply"
    button_reply = @{
      id = "confirm:yes"
      title = "نعم"
    }
  }
}
Add-Check "confirm yes button is interactive reply" ($confirmYes.normalized.kind -eq "interactive_reply" -and $confirmYes.normalized.interactiveType -eq "button_reply")
Add-Check "confirm yes normalizes to نعم" ($confirmYes.normalized.normalizedText -eq "نعم")

$confirmEdit = Invoke-Normalize -Message @{
  type = "interactive"
  interactive = @{
    type = "button_reply"
    button_reply = @{
      id = "confirm:edit"
      title = "تعديل"
    }
  }
}
Add-Check "confirm edit normalizes to تعديل" ($confirmEdit.normalized.normalizedText -eq "تعديل")

$sizeList = Invoke-Normalize -Message @{
  type = "interactive"
  interactive = @{
    type = "list_reply"
    list_reply = @{
      id = "size:38"
      title = "38"
    }
  }
}
Add-Check "size list is list reply" ($sizeList.normalized.kind -eq "interactive_reply" -and $sizeList.normalized.interactiveType -eq "list_reply")
Add-Check "size list normalizes to 38" ($sizeList.normalized.normalizedText -eq "38")

$colorList = Invoke-Normalize -Message @{
  type = "interactive"
  interactive = @{
    type = "list_reply"
    list_reply = @{
      id = "color:أسود"
      title = "أسود"
    }
  }
}
Add-Check "color list normalizes to أسود" ($colorList.normalized.normalizedText -eq "أسود")

$infoPrice = Invoke-Normalize -Message @{
  type = "interactive"
  interactive = @{
    type = "list_reply"
    list_reply = @{
      id = "info:price"
      title = "الثمن"
    }
  }
}
Add-Check "info price keeps stable id" ($infoPrice.normalized.normalizedText -eq "info:price" -and $infoPrice.normalized.normalizedSource -eq "known_id_mapping")

$infoMenu = Invoke-Normalize -Message @{
  type = "interactive"
  interactive = @{
    type = "button_reply"
    button_reply = @{
      id = "info:menu"
      title = "معلومات أخرى"
    }
  }
}
Add-Check "info menu keeps stable id" ($infoMenu.normalized.normalizedText -eq "info:menu" -and $infoMenu.normalized.normalizedSource -eq "known_id_mapping")

$customList = Invoke-Normalize -Message @{
  type = "interactive"
  interactive = @{
    type = "list_reply"
    list_reply = @{
      id = "custom:abc"
      title = "Custom ABC"
    }
  }
}
Add-Check "custom field value normalizes to value" ($customList.normalized.normalizedText -eq "abc" -and $customList.normalized.normalizedSource -eq "id_value")

$noColon = Invoke-Normalize -Message @{
  type = "interactive"
  interactive = @{
    type = "list_reply"
    list_reply = @{
      id = "unknown_id"
      title = "اختيار ما"
    }
  }
}
Add-Check "no-colon id uses title" ($noColon.normalized.normalizedText -eq "اختيار ما" -and $noColon.normalized.normalizedSource -eq "title")

$malformed = Invoke-Normalize -Message @{
  type = "interactive"
  interactive = @{
    type = "button_reply"
    button_reply = @{}
  }
}
Add-Check "malformed payload returns safely" ($malformed.ok -eq $true)
Add-Check "malformed payload is unsupported" ($malformed.normalized.kind -eq "unsupported")
Add-Check "malformed payload does not expose stack" (-not (($malformed | ConvertTo-Json -Depth 20) -match "at .*\\.ts"))

$failed = $checks | Where-Object { -not $_.Passed }

Write-Host "Phase 0E-C2-C1 interactive reply normalizer calls:"
$calls | Format-Table -AutoSize

Write-Host "Phase 0E-C2-C1 interactive reply normalizer checks:"
$checks | Format-Table -AutoSize

if ($failed.Count -gt 0) {
  throw ("Phase 0E-C2-C1 checks failed: {0}" -f (($failed | ForEach-Object { $_.Name }) -join ", "))
}

Write-Host "All Phase 0E-C2-C1 interactive reply normalizer checks passed."

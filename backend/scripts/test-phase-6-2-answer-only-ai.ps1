param(
  [string]$BaseUrl = "http://localhost:5000"
)

$ErrorActionPreference = "Stop"
$watch = [System.Diagnostics.Stopwatch]::StartNew()
$response = Invoke-RestMethod `
  -Method POST `
  -Uri ("{0}/api/agent/eval-informational-ai" -f $BaseUrl) `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes("{}"))
$watch.Stop()

$response.checks |
  Select-Object name, passed, details |
  Format-Table -AutoSize

Write-Host ("Phase 6.2 checks: {0}/{1} passed in {2} ms" -f `
  $response.summary.passed, `
  $response.summary.total, `
  [int]$watch.ElapsedMilliseconds)

if (-not $response.summary.acceptancePassed) {
  $failed = @($response.checks | Where-Object { -not $_.passed })
  throw ("Phase 6.2 checks failed: {0}" -f (($failed | ForEach-Object { $_.name }) -join ", "))
}

Write-Host "All Phase 6.2 answer-only AI and info-continuity checks passed."

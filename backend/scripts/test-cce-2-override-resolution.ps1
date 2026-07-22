$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$timer = [System.Diagnostics.Stopwatch]::StartNew()
$json = node -e "const m=require('./dist/modules/conversation-engine/evaluation/cce2-resolution-eval.service.js'); console.log(JSON.stringify(m.evaluateCce2OverrideResolution()))"
$timer.Stop()
$report = $json | ConvertFrom-Json
$report.cases | Format-Table name, passed, details -AutoSize
Write-Host ("CCE-2 resolution: {0}/{1} passed in {2}ms" -f $report.summary.passed, $report.summary.total, $timer.ElapsedMilliseconds)
if (-not $report.strictAcceptance) { exit 1 }

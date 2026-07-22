$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$timer = [System.Diagnostics.Stopwatch]::StartNew()
$json = node -e "const c=require('./dist/modules/conversation-engine'); const d=c.resolveConversationConfig(); const checks=[d.locale==='ar-MA',c.renderConversationMessage('first_entry.commercial_intro')==='السلام عليكم 👋 مرحبا بك',c.renderConversationLabel('first_entry.order_now')==='أطلب الآن',c.resolveProductConversationWording({name:'منتج'}).fullName==='منتج']; console.log(JSON.stringify({total:checks.length,passed:checks.filter(Boolean).length,strictAcceptance:checks.every(Boolean)}))"
$timer.Stop()
$report = $json | ConvertFrom-Json
Write-Host ("CCE-1 foundation: {0}/{1} passed in {2}ms" -f $report.passed, $report.total, $timer.ElapsedMilliseconds)
if (-not $report.strictAcceptance) { exit 1 }

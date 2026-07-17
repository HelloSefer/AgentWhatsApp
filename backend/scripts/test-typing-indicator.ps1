$ErrorActionPreference = "Stop"
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDirectory = Split-Path -Parent $scriptDirectory

Push-Location $backendDirectory
try {
  node -r ts-node/register/transpile-only tests/unit/whatsapp-cloud-typing-indicator.test.ts
  if ($LASTEXITCODE -ne 0) {
    throw "Typing indicator unit checks failed."
  }
} finally {
  Pop-Location
}

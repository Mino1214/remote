[CmdletBinding()]
param(
  [string]$Output = (Join-Path (Split-Path -Parent $PSScriptRoot) 'webrtc-helper.exe')
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $here
try {
  go mod tidy
  if ($LASTEXITCODE -ne 0) { throw "go mod tidy failed with exit code $LASTEXITCODE" }
  go build -trimpath -ldflags "-s -w" -o $Output .
  if ($LASTEXITCODE -ne 0) { throw "go build failed with exit code $LASTEXITCODE" }
  Write-Host "Built $Output" -ForegroundColor Green
} finally {
  Pop-Location
}

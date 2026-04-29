<#
.SYNOPSIS
  Streaming Agent 제거. 관리자 권한 필요.
#>

[CmdletBinding()]
param(
  [string]$InstallDir = 'C:\Program Files\StreamMonitor'
)

$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "관리자 권한으로 실행하세요."
}

$taskName = 'StreamMonitorAgent'
schtasks /Delete /TN $taskName /F 2>$null | Out-Null

# 실행 중인 agent 종료
Get-Process -Name powershell -ErrorAction SilentlyContinue | Where-Object {
  $_.Path -like '*Start-StreamAgent*'
} | ForEach-Object { Stop-Process -Id $_.Id -Force }

if (Test-Path $InstallDir) {
  Remove-Item -Recurse -Force $InstallDir
}

$dataDir = Join-Path $env:PROGRAMDATA 'StreamMonitor'
if (Test-Path $dataDir) {
  Remove-Item -Recurse -Force $dataDir
}

Write-Host "[제거 완료]" -ForegroundColor Green

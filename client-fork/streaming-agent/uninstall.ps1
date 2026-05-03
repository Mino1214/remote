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

# schtasks /Delete가 작업이 없을 때 stderr+exit1을 내는데 EAP=Stop에서 throw되므로 격리
$oldEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  & schtasks.exe /Delete /TN $taskName /F *> $null
} finally { $ErrorActionPreference = $oldEAP }

# HKCU Run 백업 자동시작 키도 같이 제거
try {
  Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'StreamMonitorAgent' -ErrorAction SilentlyContinue
} catch {}

# 실행 중인 agent 종료 — powershell -File로 띄웠으므로 CommandLine 기반으로 매칭
try {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*Start-StreamAgent.ps1*' } |
    ForEach-Object {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
} catch {}

# ffmpeg도 같이 정리 (agent 자식이라도 명시적 종료가 안전)
Get-Process ffmpeg -ErrorAction SilentlyContinue | ForEach-Object {
  try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {}
}

Start-Sleep -Milliseconds 500

if (Test-Path $InstallDir) {
  try { Remove-Item -Recurse -Force $InstallDir -ErrorAction Stop }
  catch { Write-Warning "InstallDir 제거 실패: $($_.Exception.Message)" }
}

$dataDir = Join-Path $env:PROGRAMDATA 'StreamMonitor'
if (Test-Path $dataDir) {
  try { Remove-Item -Recurse -Force $dataDir -ErrorAction Stop }
  catch { Write-Warning "ProgramData 제거 실패 (로그 잠금 가능): $($_.Exception.Message)" }
}

Write-Host "[제거 완료]" -ForegroundColor Green

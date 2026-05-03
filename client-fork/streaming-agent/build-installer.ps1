<#
.SYNOPSIS
  StreamMonitor Agent 단일 인스톨러(.exe) 빌드 + dashboard public 폴더에 배치.

.DESCRIPTION
  - Inno Setup의 ISCC.exe 로 setup.iss를 컴파일해서 StreamMonitor-Setup.exe를 만든다.
  - 토큰은 exe에 박지 않는다 (모든 사용자가 같은 generic exe 1개를 공유).
  - 컴파일 결과물을 dashboard/public/agent/StreamMonitor-Setup.exe 로 복사한다.
  - dashboard 의 /api/agent/installer 라우트가 이 파일을 토큰별 파일명으로 다운로드 시 스트리밍한다.

.PARAMETER Version
  exe에 박힐 AgentVersion (기본 0.2.0).

.PARAMETER ISCC
  ISCC.exe 경로 (기본: %LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe).

.PARAMETER PublicDir
  dashboard public 디렉토리 (기본: ../../dashboard/public).

.EXAMPLE
  .\build-installer.ps1
  .\build-installer.ps1 -Version 0.3.0
#>
[CmdletBinding()]
param(
  [string]$Version = "0.2.0",
  [string]$ISCC = (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
  [string]$PublicDir = (Join-Path (Split-Path -Parent $PSScriptRoot) '..\dashboard\public')
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

if (-not (Test-Path $ISCC)) {
  throw "Inno Setup 6 (ISCC.exe) 가 없습니다: $ISCC. https://jrsoftware.org/isdl.php 에서 설치하세요."
}

Write-Host "==> Inno Setup 컴파일 시작 (version=$Version)" -ForegroundColor Cyan
$logPath = Join-Path $here 'setup-build.log'
& $ISCC ".\setup.iss" "/DAgentVersion=$Version" *> $logPath
if ($LASTEXITCODE -ne 0) {
  Write-Warning "ISCC.exe 종료 코드 $LASTEXITCODE — 로그: $logPath"
  Get-Content $logPath -Tail 30 | ForEach-Object { Write-Host "  $_" }
  throw "Inno Setup 컴파일 실패"
}

$exePath = Join-Path $here 'StreamMonitor-Setup.exe'
if (-not (Test-Path $exePath)) {
  throw "빌드 결과물이 없습니다: $exePath"
}
Write-Host "==> 빌드 OK: $exePath ($([Math]::Round((Get-Item $exePath).Length / 1MB, 2)) MB)" -ForegroundColor Green

# dashboard public/agent 로 배치
$publicResolved = (Resolve-Path $PublicDir -ErrorAction SilentlyContinue)
if (-not $publicResolved) {
  Write-Warning "public 디렉토리를 찾을 수 없습니다: $PublicDir — 건너뜀."
  Write-Host "수동 복사: $exePath  →  <dashboard>/public/agent/StreamMonitor-Setup.exe"
  return
}
$agentDir = Join-Path $publicResolved.Path 'agent'
if (-not (Test-Path $agentDir)) {
  New-Item -ItemType Directory -Path $agentDir -Force | Out-Null
}
$dest = Join-Path $agentDir 'StreamMonitor-Setup.exe'
Copy-Item -Path $exePath -Destination $dest -Force
Write-Host "==> 배포 완료: $dest" -ForegroundColor Green
Write-Host ""
Write-Host "다음 단계:" -ForegroundColor Cyan
Write-Host "  1. dashboard에서 prisma migrate (또는 db push) 실행 — ProvisionToken 모델 반영"
Write-Host "  2. dashboard 재배포"
Write-Host "  3. /devices 페이지에서 '+ 새 PC 등록' 클릭 → 자동 다운로드 확인"

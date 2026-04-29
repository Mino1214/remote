<#
.SYNOPSIS
  Streaming Agent 설치/등록. 관리자 권한 필요.

.DESCRIPTION
  - 스크립트 파일을 C:\Program Files\StreamMonitor 로 복사
  - ffmpeg essentials 자동 다운로드 (gyan.dev)
  - 사용자 로그인 시 자동 시작하도록 Task Scheduler 등록
  - agent-config.json은 운영자가 미리 작성하여 동봉

  안전선:
  - LocalSystem 계정으로 돌리지 않는다 (사용자 데스크톱 캡처 + 동의 다이얼로그 표시 위해
    INTERACTIVE 사용자 컨텍스트로만 실행).
  - 첫 실행 시 동의 다이얼로그가 뜨도록 설계되어 있어, 무인 자동 활성화는 불가능.
#>

[CmdletBinding()]
param(
  [string]$InstallDir = 'C:\Program Files\StreamMonitor',
  [string]$ConfigSource,
  [switch]$DownloadFfmpeg
)

$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "관리자 권한으로 실행하세요."
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ConfigSource) { $ConfigSource = Join-Path $here 'agent-config.json' }
if (-not (Test-Path $ConfigSource)) {
  throw "agent-config.json이 없습니다. agent-config.example.json을 복사해 채워두세요."
}

if (-not (Test-Path $InstallDir)) {
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
}

$files = @(
  'Start-StreamAgent.ps1',
  'Show-ConsentDialog.ps1',
  'Invoke-Capture.ps1',
  'Set-StreamPause.ps1',
  'README.md'
)
foreach ($f in $files) {
  Copy-Item -Path (Join-Path $here $f) -Destination $InstallDir -Force
}
Copy-Item -Path $ConfigSource -Destination (Join-Path $InstallDir 'agent-config.json') -Force

# config의 ffmpegPath 확인
$config = Get-Content (Join-Path $InstallDir 'agent-config.json') -Raw | ConvertFrom-Json
if (-not $config.ffmpegPath -or -not (Test-Path $config.ffmpegPath)) {
  if ($DownloadFfmpeg) {
    Write-Host "ffmpeg essentials 다운로드 중..."
    $tmp = Join-Path $env:TEMP 'ffmpeg-essentials.zip'
    Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $tmp
    $extractTo = Join-Path $InstallDir 'ffmpeg'
    Expand-Archive -Path $tmp -DestinationPath $extractTo -Force
    $exe = Get-ChildItem -Path $extractTo -Filter ffmpeg.exe -Recurse | Select-Object -First 1
    if (-not $exe) { throw "ffmpeg.exe extract 실패" }
    $config | Add-Member -NotePropertyName ffmpegPath -NotePropertyValue $exe.FullName -Force
    $config | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $InstallDir 'agent-config.json')
    Write-Host "ffmpeg installed: $($exe.FullName)"
  } else {
    Write-Warning "ffmpegPath가 비어 있습니다. -DownloadFfmpeg 옵션을 주거나 수동으로 ffmpeg.exe 경로를 채우세요."
  }
}

# Task Scheduler: 사용자 로그인 시 자동 시작 (UI 보이도록 Interactive Token)
$taskName = 'StreamMonitorAgent'
schtasks /Delete /TN $taskName /F 2>$null | Out-Null

$taskAction = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$InstallDir\Start-StreamAgent.ps1`""
schtasks /Create `
  /SC ONLOGON `
  /TN $taskName `
  /TR $taskAction `
  /RL LIMITED `
  /F | Out-Null

Write-Host ""
Write-Host "[설치 완료]" -ForegroundColor Green
Write-Host "  설치 위치: $InstallDir"
Write-Host "  로그:      $env:PROGRAMDATA\StreamMonitor\agent.log"
Write-Host "  자동시작:  Task Scheduler '$taskName' (사용자 로그인 시)"
Write-Host ""
Write-Host "[다음 단계]"
Write-Host "  1. 사용자가 다음 로그인 시 동의 다이얼로그가 자동으로 표시됩니다."
Write-Host "  2. 즉시 시작하려면: Start-Process -FilePath 'powershell' -ArgumentList '-File `"$InstallDir\Start-StreamAgent.ps1`"'"
Write-Host ""
Write-Host "[안전선 확인]" -ForegroundColor Yellow
Write-Host "  - 동의 없이는 ingest 차단됨 (서버 정책)"
Write-Host "  - 항상 표시: 트레이 아이콘 + 화면 우상단 빨간 REC 인디케이터"
Write-Host "  - 사용자가 트레이에서 일시정지/철회 가능"

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$SetupExePath,

  [string]$DashboardBase = "https://admin.housingnewshub.info",
  [string]$InstallDir = "C:\Program Files\StreamMonitor",
  [int]$WaitSeconds = 6,
  [switch]$RequireAdmin,
  [switch]$AutoProvision,
  [string]$ProvisionToken,
  [string]$DeviceId,
  [string]$OwnerEmail,
  [string]$DisplayName,
  [int]$RetentionDays = 7,
  [string]$WatermarkText = "● REC | 관리자 모니터링 활성화",
  [string]$StreamId
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).
    IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) {
    throw "관리자 권한 PowerShell에서 실행하세요."
  }
}

function Show-Section([string]$title) {
  Write-Host ""
  Write-Host "=== $title ===" -ForegroundColor Cyan
}

function New-AutoDeviceId {
  $name = ($env:COMPUTERNAME ?? "pc").ToLowerInvariant()
  $name = ($name -replace "[^a-z0-9-]", "-").Trim("-")
  if ([string]::IsNullOrWhiteSpace($name)) { $name = "pc" }

  $rawSeed = $null
  try {
    $rawSeed = (Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Cryptography" -Name "MachineGuid" -ErrorAction Stop).MachineGuid
  } catch {}

  if (-not $rawSeed) {
    try {
      $rawSeed = (Get-CimInstance Win32_ComputerSystemProduct -ErrorAction Stop).UUID
    } catch {}
  }

  if (-not $rawSeed) {
    $rawSeed = [guid]::NewGuid().ToString()
  }

  $seed = ($rawSeed.ToLowerInvariant() -replace "[^a-z0-9]", "")
  if ($seed.Length -gt 12) { $seed = $seed.Substring(0, 12) }
  return "dev-$name-$seed"
}

if ($RequireAdmin) {
  Assert-Admin
}

$resolvedSetup = (Resolve-Path $SetupExePath).Path
if (-not (Test-Path $resolvedSetup)) {
  throw "setup.exe를 찾을 수 없습니다: $SetupExePath"
}

Show-Section "1) Setup 설치 실행"
Write-Host "실행 파일: $resolvedSetup"
Start-Process -FilePath $resolvedSetup -Wait
Write-Host "설치 프로그램 종료 확인"

$configPath = Join-Path $InstallDir "agent-config.json"
$startScript = Join-Path $InstallDir "Start-StreamAgent.ps1"
if (-not (Test-Path $configPath)) {
  throw "설치 후 설정 파일을 찾을 수 없습니다: $configPath"
}
if (-not (Test-Path $startScript)) {
  throw "설치 후 시작 스크립트를 찾을 수 없습니다: $startScript"
}

if ($AutoProvision) {
  if (-not $ProvisionToken) { throw "-AutoProvision 사용 시 -ProvisionToken이 필요합니다." }
  $ProvisionToken = $ProvisionToken.Trim()
  if (-not $ProvisionToken) { throw "ProvisionToken이 비어 있습니다." }
  if (-not $DeviceId) { $DeviceId = New-AutoDeviceId }

  Show-Section "2) 서버 자동 프로비저닝"
  Write-Host "deviceId 자동 사용: $DeviceId"
  $provisionUrl = "$($DashboardBase.TrimEnd('/'))/api/agent/provision"
  $payload = @{
    deviceId = $DeviceId
    provisionToken = $ProvisionToken
    displayName = $DisplayName
    retentionDays = $RetentionDays
    watermarkText = $WatermarkText
    ownerEmail = $OwnerEmail
  } | ConvertTo-Json -Compress

  $resp = Invoke-RestMethod -Method POST -Uri $provisionUrl -Body $payload -ContentType "application/json"
  if (-not $resp.data.streamId -or -not $resp.data.streamKey -or -not $resp.data.ingestSecret) {
    throw "프로비저닝 응답이 올바르지 않습니다."
  }

  $StreamId = [string]$resp.data.streamId
  $streamKey = [string]$resp.data.streamKey
  $ingestSecret = [string]$resp.data.ingestSecret
  if ($resp.data.dashboardBase) {
    $DashboardBase = [string]$resp.data.dashboardBase
  }

  Write-Host "streamId 자동 발급: $StreamId"
  $config = Get-Content $configPath -Raw | ConvertFrom-Json
  $config.dashboardBase = $DashboardBase
  $config.streamId = $StreamId
  $config.streamKey = $streamKey
  $config.ingestSecret = $ingestSecret
  if ($WatermarkText) {
    $config.watermarkText = $WatermarkText
  }
  $config | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding UTF8
} elseif (-not $StreamId) {
  throw "-AutoProvision 없이 실행할 때는 -StreamId를 지정하세요."
}

Show-Section "3) 에이전트 즉시 시작"
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`""
Write-Host "에이전트 시작 요청 완료 (동의 창 확인 필요)"

Show-Section "4) 초기 상태 확인"
Start-Sleep -Seconds $WaitSeconds

Write-Host "[Task Scheduler]"
try {
  schtasks /Query /TN StreamMonitorAgent /V /FO LIST
} catch {
  Write-Warning "작업 스케줄러 조회 실패: $($_.Exception.Message)"
}

$logFile = Join-Path $env:PROGRAMDATA "StreamMonitor\agent.log"
Write-Host ""
Write-Host "[Agent Log: 최근 50줄]"
if (Test-Path $logFile) {
  Get-Content $logFile | Select-Object -Last 50
} else {
  Write-Warning "로그 파일이 아직 없습니다: $logFile"
}

$liveUrl = "$($DashboardBase.TrimEnd('/'))/devices/$StreamId/live"
$recUrl = "$($DashboardBase.TrimEnd('/'))/devices/$StreamId/recordings"

Show-Section "5) 관리자 확인 URL"
Write-Host "LIVE:       $liveUrl"
Write-Host "RECORDINGS: $recUrl"

Write-Host ""
Write-Host "완료. 동의 다이얼로그에서 승인하면 실시간 송출이 활성화됩니다." -ForegroundColor Green

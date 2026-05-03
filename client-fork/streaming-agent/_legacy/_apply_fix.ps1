$ErrorActionPreference = 'Continue'

Write-Host '=== 1) 잔존 agent / ffmpeg 프로세스 정리 ===' -ForegroundColor Cyan
$killed = 0
try {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*Start-StreamAgent.ps1*' } |
    ForEach-Object {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; Write-Host ("  killed agent pid=" + $_.ProcessId); $script:killed++ }
      catch { Write-Warning ("  kill agent failed pid=" + $_.ProcessId) }
    }
} catch {}
Get-Process ffmpeg -ErrorAction SilentlyContinue | ForEach-Object {
  try { Stop-Process -Id $_.Id -Force -ErrorAction Stop; Write-Host ("  killed ffmpeg pid=" + $_.Id) } catch {}
}
if ($killed -eq 0) { Write-Host '  (실행 중인 agent 없음)' }
Start-Sleep -Milliseconds 500

Write-Host ''
Write-Host '=== 2) 신버전 ps1 동기화 (해시 검증) ===' -ForegroundColor Cyan
$src = 'C:\Users\alsdh\OneDrive\Desktop\MINE\remote\client-fork\streaming-agent'
$dst = 'C:\Program Files\StreamMonitor'
if (-not (Test-Path $dst)) {
  Write-Error "설치 폴더가 없습니다: $dst"
  exit 1
}
$files = @('Start-StreamAgent.ps1','Invoke-Capture.ps1','Show-ConsentDialog.ps1','Set-StreamPause.ps1','install.ps1','uninstall.ps1')
$failures = 0
foreach ($f in $files) {
  $s = Join-Path $src $f
  $d = Join-Path $dst $f
  if (-not (Test-Path $s)) { Write-Warning ("  source missing: " + $f); continue }
  try {
    Copy-Item -Path $s -Destination $d -Force -ErrorAction Stop
    $sh = (Get-FileHash -Path $s -Algorithm SHA256).Hash
    $dh = (Get-FileHash -Path $d -Algorithm SHA256).Hash
    if ($sh -eq $dh) { Write-Host ("  OK  " + $f) }
    else { Write-Warning ("  HASH MISMATCH " + $f); $failures++ }
  } catch {
    Write-Warning ("  copy failed " + $f + " : " + $_.Exception.Message)
    $failures++
  }
}
if ($failures -gt 0) { Write-Error "동기화 실패 ${failures}건"; exit 2 }

Write-Host ''
Write-Host '=== 3) 로그 백업 후 클리어 ===' -ForegroundColor Cyan
$logDir = 'C:\ProgramData\StreamMonitor'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
foreach ($lf in @('agent.log','agent-stdout.log','agent-stderr.log','ffmpeg-stdout.log','ffmpeg-stderr.log')) {
  $p = Join-Path $logDir $lf
  if (Test-Path $p) {
    Copy-Item -Path $p -Destination ($p + '.prev') -Force -ErrorAction SilentlyContinue
    Clear-Content -Path $p -Force -ErrorAction SilentlyContinue
  }
}

Write-Host ''
Write-Host '=== 4) agent를 Hidden 모드로 재시작 (창 안 뜸) ===' -ForegroundColor Cyan
$startScript = Join-Path $dst 'Start-StreamAgent.ps1'
$proc = Start-Process -FilePath 'powershell.exe' `
  -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',('"' + $startScript + '"')) `
  -WindowStyle Hidden `
  -PassThru
Write-Host ("  agent started pid=" + $proc.Id + " (hidden)")

Write-Host ''
Write-Host '=== 5) 15초 동안 부팅 대기 ===' -ForegroundColor Cyan
Start-Sleep -Seconds 15

Write-Host ''
Write-Host '=== 6) 상태 진단 ===' -ForegroundColor Cyan

Write-Host ''
Write-Host '[6-1] agent 프로세스 살아있는지'
$alive = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
if ($alive) { Write-Host ("  YES pid=" + $proc.Id + ", started " + $alive.StartTime) }
else { Write-Host ("  NO  pid=" + $proc.Id + " (즉사 -> agent.log 확인)") -ForegroundColor Yellow }

Write-Host ''
Write-Host '[6-2] ffmpeg 프로세스'
$ff = Get-Process ffmpeg -ErrorAction SilentlyContinue
if ($ff) { $ff | Format-Table Id, ProcessName, StartTime, CPU -AutoSize | Out-String -Width 200 | Write-Host }
else { Write-Host '  (없음 -> ffmpeg-stderr.log 확인 필요)' -ForegroundColor Yellow }

Write-Host ''
Write-Host '[6-3] agent.log tail 30'
$logFile = Join-Path $logDir 'agent.log'
if (Test-Path $logFile) {
  Get-Content $logFile -Tail 30 | ForEach-Object { Write-Host ("  " + $_) }
} else { Write-Host '  (로그 없음)' }

Write-Host ''
Write-Host '[6-4] ffmpeg-stderr.log tail 30 (제일 중요)'
$ffErr = Join-Path $logDir 'ffmpeg-stderr.log'
if ((Test-Path $ffErr) -and (Get-Item $ffErr).Length -gt 0) {
  Get-Content $ffErr -Tail 30 | ForEach-Object { Write-Host ("  " + $_) }
} else { Write-Host '  (비어있음)' }

Write-Host ''
Write-Host '[6-5] config 요약'
$cfg = Get-Content 'C:\Program Files\StreamMonitor\agent-config.json' -Raw | ConvertFrom-Json
Write-Host ("  dashboardBase: " + $cfg.dashboardBase)
Write-Host ("  streamId:      " + $cfg.streamId)
Write-Host ("  streamKey:     " + $cfg.streamKey)
$ingestUrl = ($cfg.dashboardBase.TrimEnd('/')) + '/api/streams/ingest/' + $cfg.streamKey + '/index.m3u8'
Write-Host ("  ingest URL:    " + $ingestUrl)

Write-Host ''
Write-Host '[6-6] ingest 엔드포인트 도달성(OPTIONS)'
try {
  $resp = Invoke-WebRequest -Uri $ingestUrl -Method OPTIONS -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
  Write-Host ("  status=" + $resp.StatusCode + " " + $resp.StatusDescription)
} catch {
  if ($_.Exception.Response) {
    Write-Host ("  HTTP " + [int]$_.Exception.Response.StatusCode + " " + $_.Exception.Response.StatusCode)
  } else {
    Write-Warning ("  접근 실패: " + $_.Exception.Message)
  }
}

Write-Host ''
Write-Host '[6-7] 매니페스트가 실제로 dashboard에 도달했는지 (Bearer 인증 PUT 후 GET)'
# OPTIONS는 인증 없이 통과. 실제 PUT은 ffmpeg가 수행. 우리는 GET으로 m3u8 존재만 확인.
# 단 GET은 playback-token 필요 (브라우저 경로). ingest 경로 GET은 없을 수 있어 HEAD/OPTIONS만 의미.
# 대안: HEAD로 수동 인증 — 이는 streamKey 노출되니 진단용으로만 사용.
$headers = @{ Authorization = ('Bearer ' + $cfg.ingestSecret) }
try {
  $r = Invoke-WebRequest -Uri $ingestUrl -Method GET -Headers $headers -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
  Write-Host ("  GET status=" + $r.StatusCode)
} catch {
  if ($_.Exception.Response) {
    $status = [int]$_.Exception.Response.StatusCode
    Write-Host ("  GET HTTP " + $status)
    if ($status -eq 405) { Write-Host '  (405 Method Not Allowed = 정상. ingest는 PUT 전용)' }
    if ($status -eq 401) { Write-Host '  (401 = 인증 실패. ingestSecret 불일치)' -ForegroundColor Yellow }
    if ($status -eq 409) { Write-Host '  (409 = stream.status가 ACTIVE 아님)' -ForegroundColor Yellow }
  } else { Write-Warning ("  네트워크: " + $_.Exception.Message) }
}

Write-Host ''
Write-Host '[6-8] consent flag'
$cf = Join-Path $logDir ('consent-' + $cfg.streamId + '.json')
if (Test-Path $cf) {
  $cflag = Get-Content $cf -Raw | ConvertFrom-Json
  Write-Host ("  acceptedBy: " + $cflag.acceptedBy)
  Write-Host ("  acceptedAt: " + $cflag.acceptedAt)
  if ($cflag.serverResponse -and $cflag.serverResponse.data) {
    Write-Host ("  서버 status: " + $cflag.serverResponse.data.status)
  } else {
    Write-Host '  서버 응답 없음 (consent API 호출 실패 가능성)' -ForegroundColor Yellow
  }
} else {
  Write-Host '  consent flag 없음 -> agent가 동의 다이얼로그 통과 못함' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '=== 완료 ===' -ForegroundColor Green
Write-Host '결과를 그대로 복사해서 보내주세요.'

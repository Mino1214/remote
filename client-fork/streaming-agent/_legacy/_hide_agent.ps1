$ErrorActionPreference = 'Continue'

Write-Host '1) 보이는 agent + ffmpeg 종료' -ForegroundColor Cyan
$killedAgent = 0
try {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*Start-StreamAgent.ps1*' } |
    ForEach-Object {
      try {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
        Write-Host ("   killed agent pid=" + $_.ProcessId)
        $script:killedAgent++
      } catch {}
    }
} catch {}
Get-Process ffmpeg -ErrorAction SilentlyContinue | ForEach-Object {
  try { Stop-Process -Id $_.Id -Force -ErrorAction Stop; Write-Host ("   killed ffmpeg pid=" + $_.Id) } catch {}
}
if ($killedAgent -eq 0) { Write-Host '   (실행 중인 agent 없음)' }
Start-Sleep -Milliseconds 500

Write-Host ''
Write-Host '2) 백그라운드(Hidden)로 agent 재시작' -ForegroundColor Cyan
$startScript = 'C:\Program Files\StreamMonitor\Start-StreamAgent.ps1'
if (-not (Test-Path $startScript)) {
  Write-Error "설치 스크립트 없음: $startScript"
  exit 1
}

# CreateNoWindow=true + WindowStyle=Hidden 으로 실제로 창이 안 뜨게 한다.
# (Task Scheduler ONLOGON 등록과 별개로, 지금 즉시도 띄워두기 위함)
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'powershell.exe'
$psi.Arguments = ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $startScript + '"')
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
$p = New-Object System.Diagnostics.Process
$p.StartInfo = $psi
[void]$p.Start()
Write-Host ("   started pid=" + $p.Id + " (hidden)")

Write-Host ''
Write-Host '3) 8초 후 상태 확인' -ForegroundColor Cyan
Start-Sleep -Seconds 8

$alive = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
if ($alive) { Write-Host ("   agent OK pid=" + $p.Id) -ForegroundColor Green }
else { Write-Host ("   agent died pid=" + $p.Id) -ForegroundColor Yellow }

$ff = Get-Process ffmpeg -ErrorAction SilentlyContinue
if ($ff) {
  foreach ($f in $ff) { Write-Host ("   ffmpeg OK pid=" + $f.Id) -ForegroundColor Green }
} else {
  Write-Host '   ffmpeg 없음 (10~15초 더 기다리면 보통 뜸)' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '확인:'
Write-Host '  - 트레이 영역에 정보 아이콘'
Write-Host '  - 화면 우상단에 빨간 ● REC 바'
Write-Host '  두 개 다 보이면 정상 hidden 동작 중.'

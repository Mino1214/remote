<#
.SYNOPSIS
  ffmpeg를 외부 프로세스로 띄워 화면 캡처 + REC 워터마크 + HLS HTTP PUT.

.DESCRIPTION
  외부 미디어 서버(mediamtx) 없이 ffmpeg HLS muxer의 HTTP PUT 기능으로 dashboard에 직접 전송.
  - 모든 트래픽이 표준 HTTPS이므로 클라이언트는 outbound 연결만 필요 (포트포워딩 X).
  - dashboard는 이미 Cloudflare Tunnel로 외부에 노출되어 있어 추가 인프라 불필요.

  안전선:
  - drawtext 워터마크는 ffmpeg 단계에서 박혀 송출/녹화 결과물에 항상 남는다 (트레이 우회 무력화).
  - 캡처 framerate/bitrate는 너무 낮춰 식별 회피하지 못하도록 최저값 강제.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)] [string]$FfmpegPath,
  [Parameter(Mandatory=$true)] [string]$IngestBaseUrl,    # 예: https://admin.housingnewshub.info/api/streams/ingest/s_xxx
  [Parameter(Mandatory=$true)] [string]$IngestSecret,
  [Parameter(Mandatory=$true)] [string]$WatermarkText,
  [int]$Framerate = 10,
  [int]$BitrateKbps = 1500,
  [int]$SegmentSeconds = 2,
  [int]$PlaylistSize = 6
)

if ($Framerate -lt 5)     { $Framerate = 5 }
if ($BitrateKbps -lt 600) { $BitrateKbps = 600 }
if ($SegmentSeconds -lt 1) { $SegmentSeconds = 1 }

function Escape-Drawtext([string]$s) {
  $s -replace '\\', '\\\\' -replace ':', '\\:' -replace "'", "\\\\'" -replace ',', '\\,'
}
$wm = Escape-Drawtext $WatermarkText
$vf = "drawtext=text='$wm':x=W-tw-20:y=20:fontsize=24:fontcolor=red@0.9:box=1:boxcolor=black@0.4:boxborderw=6"

# HTTP HLS PUT
# - hls_segment_filename은 절대 URL 패턴: dashboard가 .ts 세그먼트를 PUT 받는다.
# - playlist URL은 .m3u8: dashboard가 갱신본을 atomic rename으로 저장.
# - Authorization 헤더는 ffmpeg의 HTTP 옵션을 통해 모든 PUT/DELETE에 적용.
$base = $IngestBaseUrl.TrimEnd('/')
$manifestUrl = "$base/index.m3u8"
$segPattern  = "$base/seg_%05d.ts"
$authHeader = "Authorization: Bearer $IngestSecret`r`n"

$args = @(
  '-hide_banner',
  '-loglevel', 'warning',
  '-f', 'gdigrab', '-framerate', "$Framerate", '-i', 'desktop',
  '-vf', $vf,
  '-c:v', 'libx264',
  '-preset', 'veryfast',
  '-tune', 'zerolatency',
  '-g', "$($Framerate * $SegmentSeconds)",
  '-keyint_min', "$($Framerate * $SegmentSeconds)",
  '-b:v', "${BitrateKbps}k",
  '-maxrate', "${BitrateKbps}k",
  '-bufsize', "$($BitrateKbps * 2)k",
  '-pix_fmt', 'yuv420p',
  '-an',
  '-f', 'hls',
  '-method', 'PUT',
  '-http_persistent', '1',
  '-headers', $authHeader,
  '-hls_time', "$SegmentSeconds",
  '-hls_list_size', "$PlaylistSize",
  '-hls_flags', 'delete_segments+independent_segments+omit_endlist',
  '-hls_segment_type', 'mpegts',
  '-hls_segment_filename', $segPattern,
  $manifestUrl
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

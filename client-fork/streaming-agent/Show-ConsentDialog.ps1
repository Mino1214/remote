<#
.SYNOPSIS
  최초 1회 (또는 동의 만료 시) 사용자 동의 다이얼로그를 표시.

.DESCRIPTION
  안전선:
  - 이 다이얼로그를 통과하지 못하면 dashboard에 consent 콜이 가지 않고, mediamtx 인증 콜백이
    PENDING 스트림 ingest를 차단한다 → 동의 없는 송출은 시스템적으로 불가.
  - 표시되는 안내문구의 sha256 해시를 dashboard로 보내 audit log에 박는다 (추후 분쟁 시 증빙).

.OUTPUTS
  성공 시: { accepted: $true, acceptedBy, acceptedNoticeHash }
  거부 시: { accepted: $false }
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)] [string]$DeviceLabel,
  [Parameter(Mandatory=$true)] [string]$AdminContact,
  [Parameter(Mandatory=$true)] [string]$WatermarkText
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$notice = @"
이 PC에서 다음 모니터링이 활성화됩니다.

[대상 기기] $DeviceLabel
[관리자]    $AdminContact

[수집 범위]
- 화면 영상 (지속 송출 + 서버 녹화)
- 스트림 시청 시각/시청자 식별

[수집되지 않는 항목]
- 마이크/오디오 (이 agent는 화면만 캡처)
- 키보드/마우스 입력 내용
- 파일 본문/메일 본문 (영상에 우연히 비치는 화면 외에는 별도 수집 없음)

[표시]
- 화면 우상단에 항상 위 ● REC 인디케이터가 떠 있습니다.
- 시스템 트레이에 빨간 점 아이콘이 항상 표시됩니다.
- 모든 송출 영상에 워터마크가 박혀 사후 식별 가능합니다.
- 워터마크 문구: $WatermarkText

[권한]
- 트레이 아이콘 우클릭 메뉴에서 언제든 ‘일시정지’ 가능합니다.
- ‘동의 철회’ 시 즉시 송출이 중단되며 관리자는 강제 재개할 수 없습니다.
- 동의 철회 후 다시 활성화하려면 관리자가 새 스트림을 발급해야 합니다.

[저장 및 보존]
- 송출 영상은 서버에서 정해진 보존기간 동안만 저장됩니다.
- 보존기간 만료 후 자동/수동 삭제 정책이 적용됩니다.

[법적 고지]
- 본 모니터링은 사용자의 명시적 동의에 근거합니다.
- 본 화면이 표시되는 시점부터 사용자는 위 내용을 인지한 것으로 간주됩니다.
- 동의하지 않으시면 [동의하지 않음]을 누르세요. 누른 즉시 agent가 종료되고
  서버에서 별도로 차단 처리됩니다.

위 내용을 모두 읽고 동의하십니까?
"@

$form = New-Object System.Windows.Forms.Form
$form.Text = "화면 모니터링 동의"
$form.Size = New-Object System.Drawing.Size(640, 620)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true

$txt = New-Object System.Windows.Forms.TextBox
$txt.Multiline = $true
$txt.ReadOnly = $true
$txt.ScrollBars = "Vertical"
$txt.Text = $notice
$txt.Size = New-Object System.Drawing.Size(600, 420)
$txt.Location = New-Object System.Drawing.Point(15, 15)
$txt.Font = New-Object System.Drawing.Font("Consolas", 10)
$form.Controls.Add($txt)

$lblName = New-Object System.Windows.Forms.Label
$lblName.Text = "동의자 이름/사번 (감사 기록용):"
$lblName.Location = New-Object System.Drawing.Point(15, 445)
$lblName.AutoSize = $true
$form.Controls.Add($lblName)

$inputName = New-Object System.Windows.Forms.TextBox
$inputName.Size = New-Object System.Drawing.Size(300, 24)
$inputName.Location = New-Object System.Drawing.Point(220, 442)
$form.Controls.Add($inputName)

$check = New-Object System.Windows.Forms.CheckBox
$check.Text = "위 내용을 모두 읽고 이해했으며 동의합니다."
$check.Size = New-Object System.Drawing.Size(560, 24)
$check.Location = New-Object System.Drawing.Point(15, 480)
$form.Controls.Add($check)

$btnAccept = New-Object System.Windows.Forms.Button
$btnAccept.Text = "동의함 — 모니터링 시작"
$btnAccept.Size = New-Object System.Drawing.Size(220, 36)
$btnAccept.Location = New-Object System.Drawing.Point(15, 525)
$btnAccept.Enabled = $false
$form.Controls.Add($btnAccept)

$btnReject = New-Object System.Windows.Forms.Button
$btnReject.Text = "동의하지 않음 — 종료"
$btnReject.Size = New-Object System.Drawing.Size(220, 36)
$btnReject.Location = New-Object System.Drawing.Point(390, 525)
$form.Controls.Add($btnReject)

$check.Add_CheckedChanged({
  $btnAccept.Enabled = ($check.Checked -and $inputName.Text.Trim().Length -gt 0)
})
$inputName.Add_TextChanged({
  $btnAccept.Enabled = ($check.Checked -and $inputName.Text.Trim().Length -gt 0)
})

$result = [PSCustomObject]@{ accepted = $false; acceptedBy = $null; acceptedNoticeHash = $null }

$btnAccept.Add_Click({
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($notice)
  $hash = ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join ""
  $result.accepted = $true
  $result.acceptedBy = $inputName.Text.Trim()
  $result.acceptedNoticeHash = $hash
  $form.Close()
})
$btnReject.Add_Click({
  $result.accepted = $false
  $form.Close()
})

[void]$form.ShowDialog()
return $result

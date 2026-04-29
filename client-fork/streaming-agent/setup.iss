; StreamMonitor Agent — Inno Setup 스크립트
;
; iscc setup.iss /DAgentVersion=0.1.0 \
;                /DDashboardBase=https://admin.housingnewshub.info \
;                /DStreamId=cuid /DStreamKey=s_xxx /DIngestSecret=base64url \
;                /DAdminContact=admin@example.com
;
; 주의:
; - 모든 트래픽이 표준 HTTPS이므로 어느 쪽도 포트포워딩 불필요.
; - 안전선(동의 다이얼로그/REC 워터마크/일시정지)은 PowerShell 측에 박혀 있어 setup이 비활성화 못함.
; - LocalSystem 서비스로 등록하지 않음. ONLOGON Task Scheduler만 등록.

#define MyAppName "StreamMonitor Agent"
#ifndef AgentVersion
  #define AgentVersion "0.1.0"
#endif
#ifndef DashboardBase
  #define DashboardBase "https://admin.example.com"
#endif
#ifndef StreamId
  #define StreamId "REPLACE_WITH_STREAM_ID"
#endif
#ifndef IngestSecret
  #define IngestSecret "REPLACE_WITH_INGEST_SECRET"
#endif
#ifndef StreamKey
  #define StreamKey "REPLACE_WITH_STREAM_KEY"
#endif
#ifndef AdminContact
  #define AdminContact "admin@example.com"
#endif
#ifndef WatermarkText
  #define WatermarkText "● REC | 관리자 모니터링 활성화"
#endif

[Setup]
AppId={{8B6E7C71-7C5A-4E8A-B6C0-4A60E3F3F101}
AppName={#MyAppName}
AppVersion={#AgentVersion}
DefaultDirName={autopf}\StreamMonitor
DefaultGroupName={#MyAppName}
PrivilegesRequired=admin
WizardStyle=modern
Compression=lzma
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
OutputDir=.
OutputBaseFilename=streammonitor-agent-setup
DisableWelcomePage=no

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Files]
Source: "Start-StreamAgent.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "Show-ConsentDialog.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "Invoke-Capture.ps1";    DestDir: "{app}"; Flags: ignoreversion
Source: "Set-StreamPause.ps1";   DestDir: "{app}"; Flags: ignoreversion
Source: "install.ps1";           DestDir: "{app}"; Flags: ignoreversion
Source: "uninstall.ps1";         DestDir: "{app}"; Flags: ignoreversion
Source: "README.md";             DestDir: "{app}"; Flags: ignoreversion

[Run]
; 1) agent-config.json 자동 생성 (빌드 시 주입된 값으로)
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""& {{ \
$cfg = @{{}}; \
$cfg.dashboardBase = '{#DashboardBase}'; \
$cfg.streamId = '{#StreamId}'; \
$cfg.streamKey = '{#StreamKey}'; \
$cfg.ingestSecret = '{#IngestSecret}'; \
$cfg.adminContact = '{#AdminContact}'; \
$cfg.watermarkText = '{#WatermarkText}'; \
$cfg.captureFramerate = 10; \
$cfg.captureBitrateKbps = 1500; \
$cfg.segmentSeconds = 2; \
$cfg.playlistSize = 6; \
$cfg.showTrayIcon = $true; \
$cfg.showOnScreenIndicator = $true; \
$cfg.allowUserPause = $true; \
$cfg.allowUserRevoke = $true; \
$cfg.ffmpegPath = ''; \
$cfg | ConvertTo-Json -Depth 5 | Set-Content '{app}\agent-config.json'; \
}}"""; \
  Flags: runhidden waituntilterminated

; 2) install.ps1 실행하여 ffmpeg 다운로드 + Task Scheduler 등록
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install.ps1"" -InstallDir ""{app}"" -DownloadFfmpeg"; \
  Flags: waituntilterminated

[UninstallRun]
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall.ps1"" -InstallDir ""{app}"""; \
  Flags: runhidden waituntilterminated

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    MsgBox(
      '설치 완료. 다음 사항을 반드시 확인하세요.' + #13#10 + #13#10 +
      '1. 사용자가 다음 로그인할 때 "화면 모니터링 동의" 다이얼로그가 자동 표시됩니다.' + #13#10 +
      '2. 사용자가 동의해야만 송출이 시작됩니다 (서버 측에서도 PENDING 상태는 차단).' + #13#10 +
      '3. 송출 중에는 항상 화면 우상단에 ● REC 인디케이터가 떠 있습니다.' + #13#10 +
      '4. 사용자는 트레이 아이콘에서 일시정지/철회를 언제든 할 수 있습니다.',
      mbInformation, MB_OK
    );
  end;
end;

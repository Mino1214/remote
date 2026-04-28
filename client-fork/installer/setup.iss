#define MyAppName "RustDesk Managed Client"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Your Organization"
#define MyAppExeName "rustdesk.exe"

; Build-time params example:
; iscc setup.iss /DServerDomain=housingnewshub.info /DServerRelay=housingnewshub.info:21117 /DServerPubKey=YOUR_PUBLIC_KEY
#ifndef ServerDomain
  #define ServerDomain "housingnewshub.info"
#endif
#ifndef ServerRelay
  #define ServerRelay "housingnewshub.info:21117"
#endif
#ifndef ServerPubKey
  #define ServerPubKey "0u96kmcWNHhHqeVeZk8MhQG7iiAhQzRlJ8cpmu7GzFI="
#endif

[Setup]
AppId={{3A5A9473-AC6A-4D8B-96DA-9DE446CCFD11}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
PrivilegesRequired=admin
Compression=lzma
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
WizardStyle=modern
OutputDir=.
OutputBaseFilename=rustdesk-managed-client-setup

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Files]
Source: "..\dist\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "configure-custom.ps1"; DestDir: "{tmp}"; Flags: deleteafterinstall
Source: "add-firewall-rules.ps1"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Run]
; custom.txt 자동 생성
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{tmp}\configure-custom.ps1"" -InstallDir ""{app}"" -RendezvousServer ""{#ServerDomain}"" -RelayServer ""{#ServerRelay}"" -PublicKey ""{#ServerPubKey}"""; Flags: runhidden waituntilterminated
; Windows 방화벽 규칙 자동 추가(관리자 권한)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{tmp}\add-firewall-rules.ps1"" -AppPath ""{app}\{#MyAppExeName}"""; Flags: runhidden waituntilterminated
; 설치 완료 후 클라이언트 실행(선택)
Filename: "{app}\{#MyAppExeName}"; Description: "RustDesk 실행"; Flags: postinstall nowait skipifsilent

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep=ssPostInstall then
  begin
    MsgBox(
      '외부망 원격 연결이 필요하면 공유기 포트포워딩(21115, 21116 TCP/UDP, 21117, 21118)을 설정하세요.' + #13#10 +
      '가이드: https://portforward.com/router.htm',
      mbInformation, MB_OK
    );
  end;
end;

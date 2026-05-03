; StreamMonitor Agent — Inno Setup 단일-exe 인스톨러
;
; 동작 모델 (open enrollment 기본):
;   - 사용자에게 가는 파일은 "StreamMonitor-Setup.exe" 한 개.
;   - 토큰 없이 더블클릭 → UAC 한 번 → 끝. 서버는 자동으로 deviceId 등록.
;   - 토큰 강제가 필요한 운영 환경에서는 dashboard 측에 환경 변수
;     STREAM_AGENT_REQUIRE_TOKEN=true 를 설정하고, /api/agent/tokens 로
;     1회용 토큰 발급 후 다음과 같이 실행:
;       StreamMonitor-Setup.exe /TOKEN=tk_xxxxxxxx....
;
; 빌드 방법 (개발자 PC에서 1회):
;   & "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe" .\setup.iss
;   → setup.iss 옆에 StreamMonitor-Setup.exe 가 생김.
;   이 파일을 dashboard/public/agent/StreamMonitor-Setup.exe 로 복사하면 끝.
;   build-installer.ps1 가 자동화해준다.

#define MyAppName "StreamMonitor Agent"
#ifndef AgentVersion
  #define AgentVersion "0.2.0"
#endif
#ifndef DashboardBase
  #define DashboardBase "https://admin.housingnewshub.info"
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
OutputBaseFilename=StreamMonitor-Setup
; UI 최소화: 환영/디렉토리/그룹/준비/완료 페이지 모두 숨김.
; UAC 1번만 뜨고 진행률 바 잠깐 보였다 사라짐.
DisableWelcomePage=yes
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
DisableFinishedPage=yes
DisableReadyMemo=yes
ShowLanguageDialog=no
SetupLogging=yes
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\icon.ico

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Files]
Source: "oneclick-install-and-verify.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "Start-StreamAgent.ps1";            DestDir: "{app}"; Flags: ignoreversion
Source: "Show-ConsentDialog.ps1";           DestDir: "{app}"; Flags: ignoreversion
Source: "Invoke-Capture.ps1";               DestDir: "{app}"; Flags: ignoreversion
Source: "Set-StreamPause.ps1";              DestDir: "{app}"; Flags: ignoreversion
Source: "install.ps1";                      DestDir: "{app}"; Flags: ignoreversion
Source: "uninstall.ps1";                    DestDir: "{app}"; Flags: ignoreversion
Source: "README.md";                        DestDir: "{app}"; Flags: ignoreversion
Source: "icon.ico";                         DestDir: "{app}"; Flags: ignoreversion

[Run]
; oneclick-install-and-verify.ps1 한 줄로 모든 설치/프로비저닝/ffmpeg/Task Scheduler/에이전트 기동을 처리.
; - 토큰 모드(고급): /TOKEN=tk_xxxxxxxx... 로 실행하면 [Code] 섹션이 oneclick에 -ProvisionToken으로 넘긴다.
; - 기본: 토큰 없이 open enrollment.
; - WindowStyle Hidden 이므로 콘솔창은 한 개도 안 뜬다.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\oneclick-install-and-verify.ps1"" -DashboardBase ""{#DashboardBase}"" -AutoProvision {code:GetTokenArg}"; \
  Flags: runhidden waituntilterminated

[UninstallRun]
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall.ps1"" -InstallDir ""{app}"""; \
  Flags: runhidden waituntilterminated

[Code]
// 사용자 입장: UAC 한 번만 보고 어떤 wizard 창도 안 떠야 함.
// 전략: 첫 인스턴스는 InitializeSetup에서 자기 자신을 /VERYSILENT로 다시 띄우고 즉시 종료.
//       두 번째(silent) 인스턴스가 실제 [Files]/[Run]을 처리.
//       부모가 이미 elevated이므로 자식은 추가 UAC 없이 elevated 상속.
//
// 디버그: ProgramData\StreamMonitor\setup-init.log 에 진입/재실행 결과를 남긴다.
//        문제가 생기면 거기 보면 됨.
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
  LogDir, LogFile, SrcExe, Params: String;
  Ok: Boolean;
begin
  Result := True;
  LogDir := ExpandConstant('{commonappdata}\StreamMonitor');
  ForceDirectories(LogDir);
  LogFile := LogDir + '\setup-init.log';

  if WizardSilent() then
  begin
    SaveStringToFile(LogFile,
      '[' + GetDateTimeString('yyyy-mm-dd hh:nn:ss', '-', ':') + '] silent child running, proceed with install' + #13#10,
      True);
    Exit;
  end;

  SrcExe := ExpandConstant('{srcexe}');
  Params := '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-';
  SaveStringToFile(LogFile,
    '[' + GetDateTimeString('yyyy-mm-dd hh:nn:ss', '-', ':') + '] re-launching silently: ' + SrcExe + ' ' + Params + #13#10,
    True);
  Ok := Exec(SrcExe, Params, ExtractFilePath(SrcExe), SW_HIDE, ewNoWait, ResultCode);
  if Ok then
  begin
    SaveStringToFile(LogFile,
      '[' + GetDateTimeString('yyyy-mm-dd hh:nn:ss', '-', ':') + '] re-launch spawned OK, exiting first instance' + #13#10,
      True);
    Result := False;
  end
  else
  begin
    SaveStringToFile(LogFile,
      '[' + GetDateTimeString('yyyy-mm-dd hh:nn:ss', '-', ':') + '] re-launch FAILED, falling back to interactive install' + #13#10,
      True);
  end;
end;

// 토큰 형식 약식 검증: tk_ 로 시작 + 16자 이상 base64url
function LooksLikeValidToken(const Tok: String): Boolean;
var
  i: Integer;
  Body: String;
  C: Char;
begin
  Result := False;
  if Length(Tok) < 19 then Exit;
  if Copy(Tok, 1, 3) <> 'tk_' then Exit;
  Body := Copy(Tok, 4, Length(Tok) - 3);
  if Length(Body) < 16 then Exit;
  for i := 1 to Length(Body) do
  begin
    C := Body[i];
    if not ( ((C >= 'A') and (C <= 'Z')) or
             ((C >= 'a') and (C <= 'z')) or
             ((C >= '0') and (C <= '9')) or
             (C = '_') or (C = '-') ) then Exit;
  end;
  Result := True;
end;

// /TOKEN=... 인자가 유효하면 oneclick에 -ProvisionToken으로 넘긴다. 없으면 빈 문자열.
function GetTokenArg(Param: String): String;
var
  Tok: String;
begin
  Tok := ExpandConstant('{param:TOKEN|}');
  if LooksLikeValidToken(Tok) then
    Result := '-ProvisionToken "' + Tok + '"'
  else
    Result := '';
end;

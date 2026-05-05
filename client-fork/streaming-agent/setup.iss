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
SetupIconFile=logo.ico
UninstallDisplayIcon={app}\logo.ico

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
Source: "logo.ico";                         DestDir: "{app}"; Flags: ignoreversion

[Run]
; oneclick-install-and-verify.ps1 한 줄로 모든 설치/프로비저닝/ffmpeg/Task Scheduler/에이전트 기동을 처리.
; - 토큰 모드(고급): /TOKEN=tk_xxxxxxxx... 로 실행하면 [Code] 섹션이 oneclick에 -ProvisionToken으로 넘긴다.
; - 기본: 토큰 없이 open enrollment.
; - nowait: wizard가 ps1 종료 안 기다리고 바로 닫힘 (ps1은 백그라운드에서 계속 돔).
; - runhidden: ps1 콘솔 창 자체도 안 뜸.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\oneclick-install-and-verify.ps1"" -DashboardBase ""{#DashboardBase}"" -AutoProvision {code:GetTokenArg}"; \
  Flags: runhidden nowait

[UninstallRun]
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall.ps1"" -InstallDir ""{app}"""; \
  Flags: runhidden waituntilterminated

[Code]
// 사용자 입장: UAC 한 번만 보고 어떤 wizard 창도 안 떠야 함.
//
// 전략: WS_VISIBLE 비트를 창 스타일에서 직접 제거하고 ShowWindow(SW_HIDE)로 못 박는다.
//       Inno가 내부적으로 다시 보여주려 해도 OS 레벨에서 안 보임.
//       각 페이지 진입 시 NextButton.OnClick 으로 자동 진행.
//       [Run]은 nowait 라 ps1 spawn 즉시 wizard 닫힘.
const
  SW_HIDE_LOCAL = 0;
  GWL_STYLE = -16;
  GWL_EXSTYLE = -20;
  WS_VISIBLE = $10000000;
  WS_EX_TOOLWINDOW = $80;
  SWP_NOACTIVATE = $0010;
  SWP_NOZORDER   = $0004;
  SWP_HIDEWINDOW = $0080;

function ShowWindow(hWnd: HWND; nCmdShow: Integer): Boolean;
  external 'ShowWindow@user32.dll stdcall';
function GetWindowLongW(hWnd: HWND; nIndex: Integer): LongInt;
  external 'GetWindowLongW@user32.dll stdcall';
function SetWindowLongW(hWnd: HWND; nIndex: Integer; dwNewLong: LongInt): LongInt;
  external 'SetWindowLongW@user32.dll stdcall';
function SetWindowPos(hWnd: HWND; hWndInsertAfter: HWND; X, Y, cx, cy: Integer; uFlags: LongInt): Boolean;
  external 'SetWindowPos@user32.dll stdcall';
function PostMessageW(hWnd: HWND; Msg: LongWord; wParam, lParam: LongInt): Boolean;
  external 'PostMessageW@user32.dll stdcall';
procedure ExitProcessAPI(uExitCode: LongInt);
  external 'ExitProcess@kernel32.dll stdcall';

const
  BM_CLICK = $00F5;

procedure HideWizardForm;
var
  ExStyle: LongInt;
begin
  // 주의:
  // - WS_VISIBLE 제거 → 클릭 이벤트가 dispatch 안 됨 (멈춤). ❌
  // - 1x1 크기   → Inno 내부 layout 망가져 NextButton 동작 안 함. ❌
  // - SW_HIDE    → 위와 같은 부작용 가능. ❌
  // 그래서 단순히 화면 밖(-32000,-32000)으로만 보내고, 작업표시줄에서만 숨긴다.
  ExStyle := GetWindowLongW(WizardForm.Handle, GWL_EXSTYLE);
  SetWindowLongW(WizardForm.Handle, GWL_EXSTYLE, ExStyle or WS_EX_TOOLWINDOW);
  SetWindowPos(WizardForm.Handle, 0, -32000, -32000, 0, 0,
               SWP_NOACTIVATE or SWP_NOZORDER or $0001); // SWP_NOSIZE
end;

procedure DebugLog(const Msg: String);
begin
  SaveStringToFile(ExpandConstant('{commonappdata}\StreamMonitor\setup-init.log'),
    '[' + GetDateTimeString('yyyy-mm-dd hh:nn:ss', '-', ':') + '] ' + Msg + #13#10, True);
end;

procedure InitializeWizard();
begin
  ForceDirectories(ExpandConstant('{commonappdata}\StreamMonitor'));
  DebugLog('InitializeWizard: hiding wizard form');
  HideWizardForm;
end;

// 보험: ShouldSkipPage가 동작하면 페이지 자체가 스킵되어 CurPageChanged 안 뜸.
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  DebugLog('ShouldSkipPage: page=' + IntToStr(PageID));
  // wpInstalling/wpPreparing 등은 어차피 호출 안 됨. 나머지 모두 스킵.
  Result := True;
end;

procedure CurPageChanged(CurPageID: Integer);
var
  ClickResult: Boolean;
begin
  DebugLog('CurPageChanged: page=' + IntToStr(CurPageID) +
           ' nextEnabled=' + IntToStr(Ord(WizardForm.NextButton.Enabled)));
  HideWizardForm;
  // wpInstalling(12)/wpFinished(14) 이전 페이지에서는 BM_CLICK을 메시지 큐에 비동기로 넣어
  // 현재 이벤트 핸들러 return 후 정상 dispatch 시킨다. (동기 OnClick은 page=10에서 dropped 됐음)
  if (CurPageID < 11) and WizardForm.NextButton.Enabled then
  begin
    ClickResult := PostMessageW(WizardForm.NextButton.Handle, BM_CLICK, 0, 0);
    DebugLog('  -> PostMessage(BM_CLICK) result=' + IntToStr(Ord(ClickResult)));
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  case CurStep of
    ssInstall:     DebugLog('CurStepChanged: ssInstall');
    ssPostInstall: DebugLog('CurStepChanged: ssPostInstall');
    ssDone:        DebugLog('CurStepChanged: ssDone');
  end;
end;

// 설치가 완전히 끝나면(Cleanup 단계) 프로세스를 즉시 종료해 좀비 setup이 남지 않게 함.
procedure DeinitializeSetup();
begin
  ExitProcessAPI(0);
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

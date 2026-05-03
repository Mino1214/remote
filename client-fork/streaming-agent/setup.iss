; StreamMonitor Agent — Inno Setup 단일-exe 인스톨러
;
; 핵심 패턴 (filename-based provision token):
;   - 이 .iss 는 "generic" exe 한 개를 만든다 (StreamMonitor-Setup.exe).
;   - 토큰은 exe 내부에 박지 않는다.
;   - 대시보드의 /api/agent/installer 라우트가 다운로드 시 파일명을
;     "StreamMonitor-Setup-<token>.exe" 로 바꿔 보낸다.
;   - 사용자가 그대로 더블클릭하면 [Code] 섹션이 자기 자신({srcexe})의 파일명에서
;     토큰 부분을 추출해 oneclick-install-and-verify.ps1에 -ProvisionToken으로 넘긴다.
;   - 파일명에 토큰이 없으면 (사용자가 rename 해버린 경우 등) 입력창으로 fallback.
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

[Run]
; oneclick-install-and-verify.ps1 한 줄로 모든 설치/프로비저닝/ffmpeg/Task Scheduler/에이전트 기동을 처리.
; - {code:GetProvisionToken} 이 자기 파일명에서 토큰을 뽑아준다 (없으면 InputQuery 폴백).
; - WindowStyle Hidden 이므로 콘솔창은 한 개도 안 뜬다.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\oneclick-install-and-verify.ps1"" -DashboardBase ""{#DashboardBase}"" -AutoProvision -ProvisionToken ""{code:GetProvisionToken}"""; \
  Flags: runhidden waituntilterminated

[UninstallRun]
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall.ps1"" -InstallDir ""{app}"""; \
  Flags: runhidden waituntilterminated

[Code]
var
  ResolvedToken: String;

// 파일명에서 토큰 추출. 기대 형식: StreamMonitor-Setup-<token>.exe
//   예) StreamMonitor-Setup-tk_abcd1234efgh5678.exe  →  tk_abcd1234efgh5678
function ExtractTokenFromFilename(const SrcExe: String): String;
var
  Base, Stem, Prefix: String;
  DotPos: Integer;
begin
  Result := '';
  Base := ExtractFileName(SrcExe);
  // 확장자 제거
  DotPos := LastDelimiter('.', Base);
  if DotPos > 0 then
    Stem := Copy(Base, 1, DotPos - 1)
  else
    Stem := Base;

  Prefix := 'StreamMonitor-Setup-';
  if (Length(Stem) > Length(Prefix)) and
     (CompareText(Copy(Stem, 1, Length(Prefix)), Prefix) = 0) then
  begin
    Result := Copy(Stem, Length(Prefix) + 1, Length(Stem) - Length(Prefix));
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

procedure InitializeWizard();
var
  Tok: String;
  Entered: String;
begin
  Tok := ExtractTokenFromFilename(ExpandConstant('{srcexe}'));
  if LooksLikeValidToken(Tok) then
  begin
    ResolvedToken := Tok;
    Exit;
  end;

  // Fallback: 사용자가 파일명을 바꾼 경우 직접 입력 받기 (일반 운영에서는 거의 안 뜸).
  Entered := '';
  if not InputQuery('StreamMonitor 설치',
                    'provision 토큰을 입력하세요 (관리자에게서 받은 값):',
                    Entered) then
  begin
    MsgBox('토큰이 필요합니다. 설치를 취소합니다.', mbCriticalError, MB_OK);
    Abort;
  end;

  Entered := Trim(Entered);
  if not LooksLikeValidToken(Entered) then
  begin
    MsgBox('토큰 형식이 올바르지 않습니다 (예: tk_xxxxxxxx...).', mbCriticalError, MB_OK);
    Abort;
  end;
  ResolvedToken := Entered;
end;

function GetProvisionToken(Param: String): String;
begin
  Result := ResolvedToken;
end;

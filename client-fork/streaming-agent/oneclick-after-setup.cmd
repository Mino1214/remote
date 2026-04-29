@echo off
setlocal
cd /d "%~dp0"

set "SETUP_EXE=%~dp0streammonitor-agent-setup.exe"
set "DASHBOARD_BASE=https://admin.housingnewshub.info"
set "TOKEN_FILE=%~dp0provision-token.txt"
set "PROVISION_TOKEN="

echo [StreamMonitor One-Click]
echo setup: "%SETUP_EXE%"
if not exist "%SETUP_EXE%" (
  echo [ERROR] streammonitor-agent-setup.exe 파일이 없습니다.
  echo 이 CMD와 setup.exe를 같은 폴더에 두고 다시 실행하세요.
  pause
  exit /b 1
)

if exist "%TOKEN_FILE%" (
  set /p PROVISION_TOKEN=<"%TOKEN_FILE%"
)
if "%PROVISION_TOKEN%"=="" if not "%STREAM_AGENT_PROVISION_TOKEN%"=="" (
  set "PROVISION_TOKEN=%STREAM_AGENT_PROVISION_TOKEN%"
)
if not "%PROVISION_TOKEN%"=="" (
  echo token source: auto file/env
)
if "%PROVISION_TOKEN%"=="" set /p PROVISION_TOKEN=ProvisionToken 입력: 
if "%PROVISION_TOKEN%"=="" (
  echo [ERROR] ProvisionToken이 없습니다.
  echo 1^) "%TOKEN_FILE%" 파일에 토큰 1줄 저장 또는
  echo 2^) 환경변수 STREAM_AGENT_PROVISION_TOKEN 설정 또는
  echo 3^) 실행 중 직접 입력
  pause
  exit /b 1
)

echo.
echo 설치(UAC) -> 에이전트 실행 -> 상태 확인을 진행합니다...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0oneclick-install-and-verify.ps1" ^
  -SetupExePath "%SETUP_EXE%" ^
  -DashboardBase "%DASHBOARD_BASE%" ^
  -AutoProvision ^
  -ProvisionToken "%PROVISION_TOKEN%"

echo.
echo 완료. 창을 닫으려면 아무 키나 누르세요.
pause >nul
endlocal

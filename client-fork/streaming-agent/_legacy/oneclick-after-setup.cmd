@echo off
REM 보조용 cmd 진입점. 추천: install.vbs (완전 무음).
REM streammonitor-agent-setup.exe (구버전 빌드)는 안에 옛날 [Code] MsgBox가 박혀있어
REM 마법사 모달이 뜨므로, 이 cmd는 그것을 절대 호출하지 않고 항상 PowerShell 직접 복사 모드로 동작한다.
REM
REM 더블클릭 시 콘솔 창이 잠깐도 보이는 게 싫으면 install.vbs를 사용하세요.
REM 이 .cmd를 클릭하면 자동으로 install.vbs로 위임합니다.

setlocal
cd /d "%~dp0"

if /i "%~1"=="--show" goto :run
if /i "%~1"=="--noredirect" goto :run
if exist "%~dp0install.vbs" (
  start "" "wscript.exe" "%~dp0install.vbs"
  exit /b
)

:run
net session >nul 2>&1
if not "%errorlevel%"=="0" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '--noredirect' -Verb RunAs -WindowStyle Hidden"
  exit /b
)

chcp 65001 >nul 2>&1

set "DASHBOARD_BASE=https://admin.housingnewshub.info"
set "TOKEN_FILE=%~dp0provision-token.txt"
set "PROVISION_TOKEN="

if exist "%TOKEN_FILE%" (
  set /p PROVISION_TOKEN=<"%TOKEN_FILE%"
)
if "%PROVISION_TOKEN%"=="" if not "%STREAM_AGENT_PROVISION_TOKEN%"=="" (
  set "PROVISION_TOKEN=%STREAM_AGENT_PROVISION_TOKEN%"
)
if "%PROVISION_TOKEN%"=="" set /p PROVISION_TOKEN=ProvisionToken: 
if "%PROVISION_TOKEN%"=="" exit /b 1

powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0oneclick-install-and-verify.ps1" ^
  -DashboardBase "%DASHBOARD_BASE%" ^
  -AutoProvision ^
  -ProvisionToken "%PROVISION_TOKEN%"

endlocal

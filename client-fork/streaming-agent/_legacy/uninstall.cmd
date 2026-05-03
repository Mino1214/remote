@echo off
REM 완전 제거. agent + ffmpeg 종료 + Task Scheduler/Run 키 등록 해제 + 설치 폴더 + 로그 폴더 삭제.
REM
REM (참고) 더블클릭 시 콘솔 창 없이 동작하려면 uninstall.vbs 를 사용하세요.

setlocal
cd /d "%~dp0"

REM 사용자가 .cmd를 더블클릭한 경우 같은 폴더의 .vbs로 위임 (콘솔 무음)
if /i "%~1"=="--show" goto :run
if /i "%~1"=="--noredirect" goto :run
if exist "%~dp0uninstall.vbs" (
  start "" "wscript.exe" "%~dp0uninstall.vbs"
  exit /b
)

:run
net session >nul 2>&1
if not "%errorlevel%"=="0" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '--noredirect' -Verb RunAs -WindowStyle Hidden"
  exit /b
)

set "INSTALLED_UNINSTALL=C:\Program Files\StreamMonitor\uninstall.ps1"
set "WORKSPACE_UNINSTALL=%~dp0uninstall.ps1"

if exist "%INSTALLED_UNINSTALL%" (
  powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%INSTALLED_UNINSTALL%"
) else if exist "%WORKSPACE_UNINSTALL%" (
  powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%WORKSPACE_UNINSTALL%"
) else (
  echo [ERROR] uninstall.ps1을 찾을 수 없습니다.
  exit /b 1
)

endlocal

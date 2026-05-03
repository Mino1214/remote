@echo off
REM 잠시 끄기. agent + ffmpeg 프로세스만 종료. 다음 로그인 시 자동 시작 항목들이 다시 시작.
REM 영구 끄기는 uninstall.cmd 사용.
REM
REM (참고) 더블클릭 시 콘솔 창 없이 동작하려면 stop-agent.vbs 를 사용하세요.

setlocal
cd /d "%~dp0"

REM 사용자가 .cmd를 더블클릭한 경우 같은 폴더의 .vbs로 위임 (콘솔 무음)
if /i "%~1"=="--show" goto :run
if /i "%~1"=="--noredirect" goto :run
if exist "%~dp0stop-agent.vbs" (
  start "" "wscript.exe" "%~dp0stop-agent.vbs"
  exit /b
)

:run
net session >nul 2>&1
if not "%errorlevel%"=="0" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '--noredirect' -Verb RunAs -WindowStyle Hidden"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command ^
  "Get-CimInstance Win32_Process -Filter \"Name = 'powershell.exe'\" | Where-Object { $_.CommandLine -like '*Start-StreamAgent.ps1*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }; Get-Process ffmpeg -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $_.Id -Force } catch {} }"

endlocal

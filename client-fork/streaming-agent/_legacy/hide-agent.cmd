@echo off
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if not "%errorlevel%"=="0" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

chcp 65001 >nul 2>&1
echo [Hide Stream Agent]
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_hide_agent.ps1"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" ( echo Done. ) else ( echo Exit %RC%. )
timeout /t 3 >nul
endlocal

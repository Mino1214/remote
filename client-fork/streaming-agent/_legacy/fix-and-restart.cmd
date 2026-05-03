@echo off
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo [INFO] Requesting administrator privileges...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

chcp 65001 >nul 2>&1
echo [Streaming Agent Fix + Restart]
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_apply_fix.ps1"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo [OK] Done. Press any key to close.
) else (
  echo [WARN] Exit code %RC%. Press any key to close.
)
pause >nul
endlocal

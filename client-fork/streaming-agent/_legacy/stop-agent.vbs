' StreamMonitor silent stop
' Double-click -> single UAC prompt -> kill agent + ffmpeg with no visible window.
' Auto-start (Task Scheduler / HKCU Run) is left intact, so the agent will
' restart at the next user logon.

Option Explicit
Dim sh, fso, app, scriptDir, ps1cmd

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set app = CreateObject("Shell.Application")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

ps1cmd = "Get-CimInstance Win32_Process -Filter ""Name = 'powershell.exe'"" | " & _
         "Where-Object { $_.CommandLine -like '*Start-StreamAgent.ps1*' } | " & _
         "ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }; " & _
         "Get-Process ffmpeg -ErrorAction SilentlyContinue | " & _
         "ForEach-Object { try { Stop-Process -Id $_.Id -Force } catch {} }"

app.ShellExecute "powershell.exe", _
    "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command """ & ps1cmd & """", _
    "", "runas", 0

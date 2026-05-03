' StreamMonitor silent full uninstall
' Double-click -> single UAC prompt -> task / Run reg / install dir / data dir
' all cleaned up with no visible window.

Option Explicit
Dim sh, fso, app, scriptDir, installedPs1, workspacePs1, target, args

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set app = CreateObject("Shell.Application")

scriptDir    = fso.GetParentFolderName(WScript.ScriptFullName)
installedPs1 = "C:\Program Files\StreamMonitor\uninstall.ps1"
workspacePs1 = scriptDir & "\uninstall.ps1"

If fso.FileExists(installedPs1) Then
    target = installedPs1
ElseIf fso.FileExists(workspacePs1) Then
    target = workspacePs1
Else
    MsgBox "uninstall.ps1 not found.", vbCritical, "StreamMonitor"
    WScript.Quit 1
End If

args = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & target & """"
app.ShellExecute "powershell.exe", args, "", "runas", 0

' StreamMonitor silent installer entry point
' Double-click -> single UAC prompt -> PowerShell runs hidden in background
'   - no cmd window, no PowerShell window, no install-complete modal
'   - all output goes to C:\ProgramData\StreamMonitor\install.log

Option Explicit

Dim sh, fso, app, scriptDir, ps1, dashboardBase, tokenFile, token, args

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set app = CreateObject("Shell.Application")

scriptDir     = fso.GetParentFolderName(WScript.ScriptFullName)
ps1           = scriptDir & "\oneclick-install-and-verify.ps1"
dashboardBase = "https://admin.housingnewshub.info"
tokenFile     = scriptDir & "\provision-token.txt"

If Not fso.FileExists(ps1) Then
    MsgBox "Cannot find installer script:" & vbCrLf & ps1, vbCritical, "StreamMonitor"
    WScript.Quit 1
End If

token = ""
If fso.FileExists(tokenFile) Then
    ' Read as system default (ANSI) which works for ASCII tokens.
    ' -2 = TristateUseDefault. (-1=Unicode/UTF-16 was wrong and corrupted ASCII tokens.)
    Dim ts, raw
    Set ts = fso.OpenTextFile(tokenFile, 1, False, -2)
    If Not ts.AtEndOfStream Then
        raw = ts.ReadAll()
        ' Strip UTF-8 BOM (EF BB BF) if a UTF-8 saved file slipped in.
        If Len(raw) >= 3 Then
            If Asc(Mid(raw,1,1)) = 239 And Asc(Mid(raw,2,1)) = 187 And Asc(Mid(raw,3,1)) = 191 Then
                raw = Mid(raw, 4)
            End If
        End If
        ' Take only the first non-empty line, trimmed.
        Dim lines, i
        lines = Split(raw, vbCrLf)
        For i = 0 To UBound(lines)
            Dim line
            line = Trim(lines(i))
            If Len(line) > 0 Then
                token = line
                Exit For
            End If
        Next
    End If
    ts.Close
End If
If token = "" Then
    On Error Resume Next
    token = sh.Environment("PROCESS").Item("STREAM_AGENT_PROVISION_TOKEN")
    On Error Goto 0
End If
If token = "" Then
    MsgBox "Provision token not found." & vbCrLf & vbCrLf & _
           "Provide a token in one of these ways:" & vbCrLf & _
           "  1) Save token (single line) into: " & tokenFile & vbCrLf & _
           "  2) Set env var STREAM_AGENT_PROVISION_TOKEN", _
           vbCritical, "StreamMonitor"
    WScript.Quit 2
End If

args = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """" & _
       " -DashboardBase " & dashboardBase & _
       " -AutoProvision" & _
       " -ProvisionToken """ & token & """"

' ShellExecute "runas" -> UAC prompt + elevated. Last 0 = SW_HIDE (no window).
app.ShellExecute "powershell.exe", args, "", "runas", 0

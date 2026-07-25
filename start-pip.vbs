' Launches the Claude Code PiP widget with no visible console window.
' Double-click to run now, or drop a SHORTCUT to this file into your Startup
' folder (Win+R -> shell:startup) to launch it automatically at login.
'
' Kill-then-relaunch: delegates to restart-pip.ps1, which stops any already-
' running instance of this widget before starting a fresh one. That means
' every trigger (double-click, login) always ends up as exactly one, up-to-
' date instance instead of stacking duplicates or leaving a stale process
' running after you've edited the code.
'
' Self-locating: it runs restart-pip.ps1 from this script's own folder, so
' moving or renaming the repo does NOT break this launcher (as long as you
' run the copy that lives inside the repo). Note: the hook paths in
' ~/.claude/settings.json are still absolute and must be updated by hand if
' you move/rename the repo.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
' 0 = hidden window, False = don't wait for it to exit.
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & here & "\restart-pip.ps1""", 0, False

' Launches the Claude Code PiP widget with no visible console window.
' Double-click to run now, or drop a SHORTCUT to this file into your Startup
' folder (Win+R -> shell:startup) to launch it automatically at login.
'
' Self-locating: it runs npm start in this script's own folder, so moving or
' renaming the repo does NOT break this launcher (as long as you run the copy
' that lives inside the repo). Note: the hook paths in ~/.claude/settings.json
' are still absolute and must be updated by hand if you move/rename the repo.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = here
' 0 = hidden window, False = don't wait for it to exit.
sh.Run "cmd /c npm start", 0, False

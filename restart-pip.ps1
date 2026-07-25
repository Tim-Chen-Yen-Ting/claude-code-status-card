# Kill any already-running instance of this widget, then launch a fresh one.
# Invoked by start-pip.vbs so double-clicking it (or logging in, via the
# Startup shortcut) always yields exactly one, up-to-date instance instead of
# stacking duplicates or running stale code after an update.

$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# Match electron.exe processes whose command line references this repo's
# folder, so we only ever kill copies of *this* widget, never an unrelated
# Electron app the user happens to have open.
Get-CimInstance Win32_Process -Filter "name='electron.exe'" |
    Where-Object { $_.CommandLine -like "*$here*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# Give the old process a moment to release its file watch / tray icon before
# the new one starts up.
Start-Sleep -Milliseconds 300

Set-Location $here
Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm start" -WindowStyle Hidden

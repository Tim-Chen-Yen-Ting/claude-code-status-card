@echo off
rem One-click setup. Unlike start-pip.vbs, this deliberately keeps a
rem visible window open (via `pause` below) so npm install progress and
rem any real errors are actually seen -- exactly what silently vanished
rem for a first-time user in practice.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
echo (press any key to close this window)
pause >nul

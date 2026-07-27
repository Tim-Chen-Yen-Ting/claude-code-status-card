#Requires -Version 5.1
# One-click setup: npm install, merge Claude Code hooks into
# ~/.claude/settings.json, set up auto-start at login, and launch the
# widget. Safe to re-run any time (e.g. after moving the repo) — it
# updates its own hook entries in place rather than duplicating them, and
# never touches other settings or other tools' hooks.
$ErrorActionPreference = "Stop"

# Self-locating, same convention as start-pip.vbs/restart-pip.ps1 — works
# regardless of where the repo lives or what it's named.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$hereForward = $here -replace '\\', '/'

Write-Host "== Claude Code Status Card - Setup ==" -ForegroundColor Cyan
Write-Host "Installing from: $here"
Write-Host ""

# --- 1. Dependencies -------------------------------------------------------
Write-Host "[1/3] Installing dependencies..." -ForegroundColor Yellow
Write-Host "(this downloads Electron's ~180MB prebuilt binary from GitHub" -ForegroundColor DarkGray
Write-Host " Releases and can take a long while, or appear to hang, on a" -ForegroundColor DarkGray
Write-Host " slow link -- let it finish)" -ForegroundColor DarkGray

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm was not found on PATH. Install Node.js from https://nodejs.org (it bundles npm), then re-run this setup."
}

Push-Location $here
try {
  & npm install
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed (exit code $LASTEXITCODE). If the output above mentions ETIMEDOUT reaching an IP under github.com, see the README's Setup section for network/mirror workarounds, then re-run this setup."
  }
} finally {
  Pop-Location
}
Write-Host "Dependencies installed." -ForegroundColor Green
Write-Host ""

# --- 2. Claude Code hooks ---------------------------------------------------
Write-Host "[2/3] Configuring Claude Code hooks..." -ForegroundColor Yellow

$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
$settingsDir = Split-Path -Parent $settingsPath
if (-not (Test-Path $settingsDir)) {
  New-Item -ItemType Directory -Path $settingsDir -Force | Out-Null
}

if (Test-Path $settingsPath) {
  $settingsRaw = Get-Content $settingsPath -Raw
  try {
    $settings = $settingsRaw | ConvertFrom-Json
  } catch {
    throw "$settingsPath exists but isn't valid JSON, so it's not safe to auto-merge into. Fix or back up that file, then re-run this setup. Parse error: $($_.Exception.Message)"
  }
} else {
  $settings = [PSCustomObject]@{}
}

if (-not ($settings.PSObject.Properties.Name -contains "hooks")) {
  $settings | Add-Member -NotePropertyName "hooks" -NotePropertyValue ([PSCustomObject]@{})
}

# PreToolUse/PostToolUse carry a "matcher" key in this repo's convention;
# the other four don't (matches hooks-snippet.json / the README's example).
$eventsWithMatcher = @("PreToolUse", "PostToolUse")
$allEvents = @("UserPromptSubmit", "PreToolUse", "PostToolUse", "Notification", "Stop", "SubagentStop")

foreach ($eventName in $allEvents) {
  $command = "node $hereForward/src/hook-relay.cjs $eventName"
  if ($eventsWithMatcher -contains $eventName) {
    $ourEntry = [PSCustomObject]@{ matcher = ""; hooks = @([PSCustomObject]@{ type = "command"; command = $command }) }
  } else {
    $ourEntry = [PSCustomObject]@{ hooks = @([PSCustomObject]@{ type = "command"; command = $command }) }
  }

  $existingList = $settings.hooks.$eventName
  if ($null -eq $existingList) {
    $existingList = @()
  } elseif ($existingList -isnot [System.Array]) {
    $existingList = @($existingList)
  }

  # Drop any prior entry that's ours (a hook-relay.cjs command from ANY
  # path -- handles re-running setup after the repo moved) before adding
  # the fresh one, so this is idempotent. Anything else the user or
  # another tool configured for this event is left untouched.
  $kept = @($existingList | Where-Object {
    -not (@($_.hooks) | Where-Object { $_.command -match 'hook-relay\.cjs' })
  })
  $kept = @($kept) + $ourEntry

  if ($settings.hooks.PSObject.Properties.Name -contains $eventName) {
    $settings.hooks.$eventName = $kept
  } else {
    $settings.hooks | Add-Member -NotePropertyName $eventName -NotePropertyValue $kept
  }
}

# Windows PowerShell 5.1's `-Encoding utf8` writes a BOM, which some JSON
# parsers choke on -- write via .NET directly instead for clean, BOM-less
# UTF-8 (PS 5.1 has no built-in utf8NoBOM option; that was added in PS 6+).
$json = $settings | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($settingsPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Hooks configured in $settingsPath" -ForegroundColor Green
Write-Host ""

# --- 3. Auto-start at login -------------------------------------------------
Write-Host "[3/3] Setting up auto-start at login..." -ForegroundColor Yellow

$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "claude-code-status-card.lnk"
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut($shortcutPath)
$lnk.TargetPath = Join-Path $here "start-pip.vbs"
$lnk.WorkingDirectory = $here
$lnk.Save()
Write-Host "Startup shortcut created at $shortcutPath" -ForegroundColor Green
Write-Host ""

Write-Host "== Setup complete! ==" -ForegroundColor Cyan
Write-Host "Launching the widget now..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here "restart-pip.ps1")

Write-Host ""
Write-Host "All done. The widget should now be running in the bottom-right corner," -ForegroundColor Green
Write-Host "and will auto-start next login. See the README for how it works." -ForegroundColor Green

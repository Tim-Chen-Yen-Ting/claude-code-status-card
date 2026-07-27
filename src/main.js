const { app, BrowserWindow, ipcMain, Tray, Menu, screen, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");

const DATA_DIR = path.join(os.homedir(), ".claude-status-card");
const EVENTS_FILE = path.join(DATA_DIR, "events.ndjson");
const ICON_MAP_FILE = path.join(DATA_DIR, "icon-map.json");

// A rough emoji per icon filename, just so the native menu (text-only, no
// room for our actual SVGs) has some visual recognition instead of bare
// words. Purely cosmetic — an icon file with no entry here just shows its
// name with no prefix.
const ICON_EMOJI = {
  bear: "🐻", cat: "🐱", crab: "🦀", dinosaur: "🦕", dog: "🐶", dolphin: "🐬",
  duck: "🦆", jellyfish: "🪼", penguin: "🐧", rabbit: "🐰", robot: "🤖", wolf: "🐺",
};

// Read-only here: renderer (src/index.html) is the sole writer of
// icon-map.json (same "one writer" convention as hook-relay.cjs owning
// events.ndjson) — this just needs enough to label the menu and mark the
// current icon with a radio dot.
function readIconAssignments() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ICON_MAP_FILE, "utf8"));
    return parsed.assignments && typeof parsed.assignments === "object" ? parsed.assignments : {};
  } catch (_) {
    return {};
  }
}

function listIconNames() {
  try {
    const dir = path.join(__dirname, "..", "assets", "icons");
    return fs.readdirSync(dir).filter((f) => f.endsWith(".svg")).map((f) => f.replace(/\.svg$/i, "")).sort();
  } catch (_) {
    return [];
  }
}

// Native menu, used both standalone (left-click an icon) and nested as a
// submenu (right-click an icon, see buildMenu). Selecting an entry doesn't
// write icon-map.json itself — it tells the renderer to (see the "set-icon"
// send below), keeping a single writer for that file.
function buildIconMenuTemplate(repoKey) {
  const current = readIconAssignments()[repoKey];
  return listIconNames().map((name) => ({
    label: (ICON_EMOJI[name] ? ICON_EMOJI[name] + " " : "") + name,
    type: "radio",
    checked: name === current,
    click: () => { if (win) win.webContents.send("set-icon", { repoKey, name }); },
  }));
}

let win = null;
let tray = null;
// Last-delivered event's `ts` (ISO string — sorts correctly lexically).
// Not a byte offset: the relay's trim rewrites the whole file (drops the
// oldest line, shifts everything), which would make any offset-based tail
// invalid the moment a trim happens. Re-reading the whole (small, capped at
// 500 lines) file each time and de-duping by ts is immune to that rewrite.
let lastTs = null;

const WIDTH = 240;
const HEIGHT = 260;

function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: sw - WIDTH - 24,
    y: sh - HEIGHT - 24,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    // Explicit, distinctive title — Electron otherwise defaults a window's
    // title to the app name from package.json ("claude-code-status-card"),
    // which collides with any repo of the same name and broke
    // click-to-focus for this repo specifically: EnumWindows found this
    // widget's own (always-on-top, so likely enumerated first) window
    // before the real VS Code window and just re-focused itself. Excluded
    // by handle too in focusRepoWindow, below — this title change is
    // belt-and-suspenders against some other repo coincidentally sharing it.
    title: "Claude Code Status Card — widget",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      // Sandbox off so the preload can require Node builtins (fs/path) to
      // load the repo icon SVGs. Safe here: local-only widget, no web content.
      sandbox: false,
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, "index.html"));

  // The window has no taskbar button (skipTaskbar), so a minimize would hide
  // it with no way back. Never allow it to stay minimized.
  win.on("minimize", () => win.restore());
}

// Shared by the tray icon and the widget's own right-click menu, so the app
// can always be controlled (and quit) from the window itself — not only from
// the tray icon, which Windows often hides in the overflow. `repoKey`, when
// present, means the right-click landed on a specific card's icon (see the
// renderer's contextmenu handler), so a "Change icon" submenu is added.
function buildMenu(repoKey) {
  const template = [
    { label: "Clear all cards", click: () => { if (win) win.webContents.send("clear"); } },
    { label: "Reset position", click: () => resetPosition() },
  ];
  if (repoKey) {
    template.push({ label: "Change icon", submenu: buildIconMenuTemplate(repoKey) });
  }
  template.push(
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  );
  return Menu.buildFromTemplate(template);
}

function createTray() {
  // Use a generated 16x16 icon at runtime so we don't need a bundled asset.
  const { nativeImage } = require("electron");
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon.isEmpty() ? nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJUlEQVR4AWNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSggBQwAB1MAAP0jXlAAAAAASUVORK5CYII="
  ) : icon);
  tray.setToolTip("Claude Code PiP");
  tray.setContextMenu(buildMenu());
}

function resetPosition() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  win.setPosition(sw - WIDTH - 24, sh - HEIGHT - 24);
}

// Best-effort "jump to that repo's window" for a genuine (non-drag) click on
// a card. There's no reliable link from a Claude Code session to an actual
// OS window — hooks give us session_id/cwd, never a window handle or PID —
// so this is a heuristic, not a guarantee: it activates the first open
// window whose title contains the repo's folder name anywhere in it.
//
// This does NOT use WScript.Shell's AppActivate, despite that being the
// obvious built-in choice: AppActivate only does an exact match, falling
// back to a "starts with" match — never "contains anywhere" (confirmed via
// FOCUS_DEBUG_LOG below: it consistently returned False against a real,
// open VS Code window). VS Code's title is normally
// `filename — reponame - Visual Studio Code` — the active file leads, not
// the repo folder — so a "starts with reponame" match was never going to
// hit. Instead this enumerates top-level windows directly via user32
// (EnumWindows/GetWindowText) and does a real substring search, then calls
// SetForegroundWindow on the first match.
//
// Still a heuristic on top of that: works well for VS Code (title includes
// the workspace folder name somewhere), unreliable for a plain terminal
// (most shells don't put cwd in the title unless configured to), and
// ambiguous when multiple windows/repos share a folder name — this just
// activates whichever matching window EnumWindows happens to enumerate
// first, with no way to disambiguate further given what the hooks provide.
//
// -EncodedCommand (base64 UTF-16LE) sidesteps shell-quoting entirely, which
// matters since repo names can contain arbitrary Unicode.
function focusRepoWindow(repoName) {
  if (!repoName || !win) return;
  // PowerShell double-quoted strings escape an embedded quote by doubling
  // it (`""`), not with a backslash like JSON/JS — using JSON.stringify here
  // would produce syntactically invalid PowerShell for a repo name containing
  // a quote.
  const escaped = String(repoName).replace(/"/g, '""');
  // Exclude the widget's own window by handle (not just by its now-distinct
  // title) — precise regardless of title, in case some other repo ever
  // coincidentally shares whatever this widget is titled.
  const ownHwnd = win.getNativeWindowHandle().readBigUInt64LE(0).toString();
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class PipWin32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  // CharSet.Unicode (i.e. the *W widechar entry points) explicitly — without
  // it, P/Invoke can resolve GetWindowText to the ANSI (*A) entry point,
  // which mangles non-ASCII titles (confirmed: every CJK window title came
  // back as replacement-character mojibake in testing, while ASCII ones were
  // fine). Window text is always UTF-16 internally, so this isn't optional
  // for repo names in Chinese/Japanese/etc.
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
"@
$target = "${escaped}"
$ownHwnd = [IntPtr]${ownHwnd}
$found = [IntPtr]::Zero
$callback = {
  param($hWnd, $lParam)
  if ($hWnd -eq $ownHwnd) { return $true }
  if ([PipWin32]::IsWindowVisible($hWnd)) {
    $len = [PipWin32]::GetWindowTextLength($hWnd)
    if ($len -gt 0) {
      $sb = New-Object System.Text.StringBuilder ($len + 1)
      [PipWin32]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
      if ($sb.ToString().Contains($target)) {
        $script:found = $hWnd
        return $false
      }
    }
  }
  return $true
}
[PipWin32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
if ($found -eq [IntPtr]::Zero) { return $false }

# SetForegroundWindow alone is unreliable here: Windows generally only lets
# the *current foreground process* (or one that recently received input)
# steal focus, and this runs in a fresh powershell.exe process — not the
# Electron process that actually received your click. Standard workaround:
# temporarily attach this thread's input state to the current foreground
# window's thread, which grants the foreground-switch permission for the
# duration of the attachment.
$currentForeground = [PipWin32]::GetForegroundWindow()
# GetWindowThreadProcessId's *return value* is the thread ID; the out
# parameter is the process ID — easy to get backwards (did, in testing),
# which silently fed a process ID into AttachThreadInput as if it were a
# thread ID and made it fail every time.
$dummyProcessId = 0
$foregroundThreadId = [PipWin32]::GetWindowThreadProcessId($currentForeground, [ref]$dummyProcessId)
$thisThreadId = [PipWin32]::GetCurrentThreadId()
$attached = $false
if ($foregroundThreadId -ne 0 -and $foregroundThreadId -ne $thisThreadId) {
  $attached = [PipWin32]::AttachThreadInput($thisThreadId, $foregroundThreadId, $true)
}
# Only restore if actually minimized — SW_RESTORE unconditionally would also
# force an already-maximized window back to its normal (non-maximized) size,
# which is not what "bring this to front" should do to a fullscreen window.
if ([PipWin32]::IsIconic($found)) { [PipWin32]::ShowWindow($found, 9) | Out-Null }
$result = [PipWin32]::SetForegroundWindow($found)
if ($attached) { [PipWin32]::AttachThreadInput($thisThreadId, $foregroundThreadId, $false) | Out-Null }
$result
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  execFile("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-EncodedCommand", encoded], () => {});
}

function readAllRecords() {
  try {
    const text = fs.readFileSync(EVENTS_FILE, "utf8");
    return text.split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// Return only the records not yet delivered (ts > lastTs), and advance
// lastTs to the newest one seen. Re-sending old history would resurrect
// sessions the user dismissed with the ✕ button, so this must never go
// backwards — but it also must survive the relay's trim rewriting the whole
// file, which a byte-offset tail cannot (see the comment on `lastTs` above).
function readNewEvents() {
  const records = readAllRecords();
  // lastTs === null only happens when the events file was empty at startup
  // (fresh install) — treat that as "everything is new" rather than
  // suppressing the very first batch.
  const fresh = records.filter((r) => lastTs === null || r.ts > lastTs);
  for (const r of records) {
    if (lastTs === null || r.ts > lastTs) lastTs = r.ts;
  }
  return fresh;
}

function watchEvents() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  try { if (!fs.existsSync(EVENTS_FILE)) fs.writeFileSync(EVENTS_FILE, ""); } catch {}

  // Start from the current end of the file: only show sessions that are
  // active from now on, rather than replaying stale/ended sessions on boot.
  const existing = readAllRecords();
  lastTs = existing.length ? existing[existing.length - 1].ts : null;

  fs.watch(DATA_DIR, { persistent: true }, (evt, filename) => {
    if (!filename || !filename.includes("events.ndjson")) return;
    const events = readNewEvents();
    if (events.length && win) win.webContents.send("events", events);
  });

  // Poll as a fallback in case fs.watch misses events on some filesystems.
  setInterval(() => {
    const events = readNewEvents();
    if (events.length && win) win.webContents.send("events", events);
  }, 2000);
}

ipcMain.on("show-menu", (_e, repoKey) => {
  if (win) buildMenu(repoKey).popup({ window: win });
});

// Left-clicking a card's icon directly: just the icon choices, standalone,
// popped up at the current cursor position (Menu.popup's default).
ipcMain.on("show-icon-menu", (_e, repoKey) => {
  if (win) Menu.buildFromTemplate(buildIconMenuTemplate(repoKey)).popup({ window: win });
});

ipcMain.on("quit-app", () => app.quit());

ipcMain.on("focus-repo", (_e, repoName) => focusRepoWindow(repoName));

ipcMain.on("drag-window", (_e, { dx, dy }) => {
  if (!win) return;
  const [x, y] = win.getPosition();
  win.setPosition(x + dx, y + dy);
});

ipcMain.on("resize-window", (_e, { height }) => {
  if (!win) return;
  const { height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const newH = Math.max(60, Math.min(Math.round(height), screenH - 24));
  const b = win.getBounds();
  if (b.height === newH) return;
  // Keep the bottom edge fixed so the widget grows upward from its corner.
  win.setBounds({ x: b.x, y: b.y + b.height - newH, width: b.width, height: newH });
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  watchEvents();
});

app.on("window-all-closed", () => app.quit());
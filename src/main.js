const { app, BrowserWindow, ipcMain, Tray, Menu, screen, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const DATA_DIR = path.join(os.homedir(), ".claude-status-card");
const EVENTS_FILE = path.join(DATA_DIR, "events.ndjson");

let win = null;
let tray = null;
let lastSize = 0;

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
// the tray icon, which Windows often hides in the overflow.
function buildMenu() {
  return Menu.buildFromTemplate([
    { label: "Clear all cards", click: () => { if (win) win.webContents.send("clear"); } },
    { label: "Reset position", click: () => resetPosition() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
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

// Return only the lines appended since the last read. Tracking a byte
// offset (not "last 50 lines") is critical: re-sending old history would
// resurrect sessions the user dismissed with the ✕ button.
function readNewEvents() {
  try {
    const stat = fs.statSync(EVENTS_FILE);
    if (stat.size === lastSize) return [];
    // File shrank — the relay trimmed it to the last 500 lines. Re-anchor
    // to the new end and skip; we've already shown everything up to here.
    if (stat.size < lastSize) { lastSize = stat.size; return []; }

    const len = stat.size - lastSize;
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(EVENTS_FILE, "r");
    try { fs.readSync(fd, buf, 0, len, lastSize); }
    finally { fs.closeSync(fd); }
    lastSize = stat.size;

    return buf.toString("utf8").split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function watchEvents() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  try { if (!fs.existsSync(EVENTS_FILE)) fs.writeFileSync(EVENTS_FILE, ""); } catch {}

  // Start from the current end of the file: only show sessions that are
  // active from now on, rather than replaying stale/ended sessions on boot.
  try { lastSize = fs.statSync(EVENTS_FILE).size; } catch { lastSize = 0; }

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

ipcMain.on("show-menu", () => {
  if (win) buildMenu().popup({ window: win });
});

ipcMain.on("quit-app", () => app.quit());

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
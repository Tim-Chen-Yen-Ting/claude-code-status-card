const { app, BrowserWindow, ipcMain, Tray, Menu, screen, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const DATA_DIR = path.join(os.homedir(), ".claude-status-card");
const EVENTS_FILE = path.join(DATA_DIR, "events.ndjson");

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
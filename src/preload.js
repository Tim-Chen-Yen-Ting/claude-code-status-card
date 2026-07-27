const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Same DATA_DIR literal as main.js/hook-relay.cjs (see the "Renaming /
// moving the repo" section in the README for why it's duplicated rather
// than shared).
const DATA_DIR = path.join(os.homedir(), ".claude-status-card");
const ICON_MAP_FILE = path.join(DATA_DIR, "icon-map.json");

// { assignments: { repoKey: iconName }, nextIndex: number } — persisted so a
// repo keeps the same icon across widget restarts, and so a brand-new repo
// gets the next unused icon in sequence rather than a random/hashed one that
// could coincidentally collide with a repo you're already looking at. Also
// doubles as the manual-override entry point: hand-edit `assignments` to pin
// or swap icons (see "Repository icons" in the README).
function loadIconMap() {
  try {
    const raw = fs.readFileSync(ICON_MAP_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      assignments: parsed.assignments && typeof parsed.assignments === "object" ? parsed.assignments : {},
      nextIndex: Number.isInteger(parsed.nextIndex) ? parsed.nextIndex : 0,
    };
  } catch (_) {
    return { assignments: {}, nextIndex: 0 };
  }
}

function saveIconMap(map) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // Write-then-rename: same reasoning as the events file trim in
    // hook-relay.cjs — a direct writeFileSync truncates before writing, so a
    // crash or concurrent read mid-write could observe a corrupt/empty file.
    const tmpFile = ICON_MAP_FILE + ".tmp";
    fs.writeFileSync(tmpFile, JSON.stringify(map, null, 2));
    fs.renameSync(tmpFile, ICON_MAP_FILE);
  } catch (_) {
    // Best-effort — losing a persisted assignment just means that repo gets
    // re-assigned next launch, not a functional break.
  }
}

// Load the repository icon set (assets/icons/*.svg) once at preload time and
// expose the raw SVG markup so the renderer can inline it (needed for
// `currentColor` to take effect — an <img> can't inherit CSS color).
// Normalize a dropped-in SVG so it inlines cleanly and takes the card's
// colour: strip the XML prolog and rewrite hardcoded monochrome fills/strokes
// to `currentColor` (leaving `none` and gradients alone).
function sanitizeSvg(svg) {
  return svg
    .replace(/<\?xml[\s\S]*?\?>/i, "")
    .replace(/(fill|stroke)\s*=\s*"(#[0-9a-fA-F]{3,8}|black)"/gi, '$1="currentColor"')
    .replace(/(fill|stroke)\s*=\s*'(#[0-9a-fA-F]{3,8}|black)'/gi, "$1='currentColor'")
    .trim();
}

function loadIcons() {
  const icons = {};
  try {
    const dir = path.join(__dirname, "..", "assets", "icons");
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".svg")) continue;
      const name = file.replace(/\.svg$/i, "");
      icons[name] = sanitizeSvg(fs.readFileSync(path.join(dir, file), "utf8"));
    }
  } catch (_) {
    // No icons available — the renderer falls back to a generic glyph.
  }
  return icons;
}

contextBridge.exposeInMainWorld("pip", {
  icons: loadIcons(),
  iconMap: loadIconMap(),
  saveIconMap: (map) => saveIconMap(map),
  onEvents: (callback) => ipcRenderer.on("events", (_e, events) => callback(events)),
  onClear: (callback) => ipcRenderer.on("clear", () => callback()),
  // Fired when an icon choice is picked from either native menu (main.js's
  // buildIconMenuTemplate) — the renderer applies the assignment and
  // persists it via saveIconMap, since it's the sole writer of icon-map.json.
  onSetIcon: (callback) => ipcRenderer.on("set-icon", (_e, { repoKey, name }) => callback(repoKey, name)),
  resize: (height) => ipcRenderer.send("resize-window", { height }),
  drag: (dx, dy) => ipcRenderer.send("drag-window", { dx, dy }),
  // Full right-click menu (Clear all/Reset/Change icon submenu/Quit). Pass a
  // repoKey when the right-click landed on a card's icon so main.js adds the
  // "Change icon" submenu.
  showMenu: (repoKey) => ipcRenderer.send("show-menu", repoKey || null),
  // Standalone icon-choice menu for a direct left-click on a card's icon —
  // just the icon list, popped up at the cursor, no Clear/Reset/Quit items.
  showIconMenu: (repoKey) => ipcRenderer.send("show-icon-menu", repoKey),
  // Best-effort "jump to that repo's window" for a genuine (non-drag) click
  // on a card — see focusRepoWindow in main.js for what this actually does
  // and its reliability caveats.
  focusRepo: (repoName) => ipcRenderer.send("focus-repo", repoName),
  quit: () => ipcRenderer.send("quit-app"),
});

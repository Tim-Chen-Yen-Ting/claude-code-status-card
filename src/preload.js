const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Same DATA_DIR literal as main.js/hook-relay.cjs (see the "Renaming /
// moving the repo" section in the README for why it's duplicated rather
// than shared).
const DATA_DIR = path.join(os.homedir(), ".claude-status-card");
const ICON_MAP_FILE = path.join(DATA_DIR, "icon-map.json");
const VOLUME_FILE = path.join(DATA_DIR, "volume.json");

// { volume: 0-100 } — the audio-cue volume set via the always-visible
// slider in src/index.html (#volume-row). A separate small file rather than
// folded into icon-map.json: distinct concern (audio preference, not
// per-repo icon/color state), kept simple as its own single-purpose file
// like events.ndjson/icon-map.json each are.
function loadVolume() {
  try {
    const parsed = JSON.parse(fs.readFileSync(VOLUME_FILE, "utf8"));
    return Number.isFinite(parsed.volume) ? Math.max(0, Math.min(100, parsed.volume)) : 100;
  } catch (_) {
    return 100;
  }
}

function saveVolume(volume) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmpFile = VOLUME_FILE + ".tmp";
    fs.writeFileSync(tmpFile, JSON.stringify({ volume }));
    fs.renameSync(tmpFile, VOLUME_FILE);
  } catch (_) {
    // Best-effort — losing this just means the slider resets to 100% next
    // launch, not a functional break.
  }
}

// { assignments: { repoKey: iconName }, nextIndex: number, colors: { repoKey:
// hue } } — persisted so a repo keeps the same icon/color across widget
// restarts, and so a brand-new repo gets the next unused icon in sequence
// rather than a random/hashed one that could coincidentally collide with a
// repo you're already looking at. Also doubles as the manual-override entry
// point: hand-edit `assignments`/`colors` to pin or swap them (see
// "Repository icons" in the README). `colors` maps to a hue in degrees
// (0-360) only — saturation/lightness are fixed constants shared with the
// hash-based default (see iconColorFor in index.html and COLOR_HUES in
// main.js), so an override can't accidentally pick something that reads
// poorly on the dark card.
function loadIconMap() {
  try {
    const raw = fs.readFileSync(ICON_MAP_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      assignments: parsed.assignments && typeof parsed.assignments === "object" ? parsed.assignments : {},
      nextIndex: Number.isInteger(parsed.nextIndex) ? parsed.nextIndex : 0,
      colors: parsed.colors && typeof parsed.colors === "object" ? parsed.colors : {},
    };
  } catch (_) {
    return { assignments: {}, nextIndex: 0, colors: {} };
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
  volume: loadVolume(),
  saveVolume: (volume) => saveVolume(volume),
  onEvents: (callback) => ipcRenderer.on("events", (_e, events) => callback(events)),
  onClear: (callback) => ipcRenderer.on("clear", () => callback()),
  // Fired when an icon choice is picked from either native menu (main.js's
  // buildIconMenuTemplate) — the renderer applies the assignment and
  // persists it via saveIconMap, since it's the sole writer of icon-map.json.
  onSetIcon: (callback) => ipcRenderer.on("set-icon", (_e, { repoKey, name }) => callback(repoKey, name)),
  // Fired when a color choice is picked from the right-click "Change color"
  // submenu (main.js's buildColorMenuTemplate) — same convention as
  // onSetIcon: the renderer applies and persists it.
  onSetColor: (callback) => ipcRenderer.on("set-color", (_e, { repoKey, hue }) => callback(repoKey, hue)),
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

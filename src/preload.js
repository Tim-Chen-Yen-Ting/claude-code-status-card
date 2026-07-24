const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

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
  onEvents: (callback) => ipcRenderer.on("events", (_e, events) => callback(events)),
  onClear: (callback) => ipcRenderer.on("clear", () => callback()),
  resize: (height) => ipcRenderer.send("resize-window", { height }),
  drag: (dx, dy) => ipcRenderer.send("drag-window", { dx, dy }),
  showMenu: () => ipcRenderer.send("show-menu"),
  quit: () => ipcRenderer.send("quit-app"),
});

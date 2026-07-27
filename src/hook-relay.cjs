#!/usr/bin/env node
// Invoked by Claude Code hooks. Usage: node hook-relay.cjs <event-name>
// Reads the hook's JSON payload from stdin, normalizes it, and appends
// one line of JSON to the shared events file that the PiP widget tails.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const EVENT_NAME = process.argv[2] || "Unknown";
const DATA_DIR = path.join(os.homedir(), ".claude-status-card");
const EVENTS_FILE = path.join(DATA_DIR, "events.ndjson");
const MAX_LINES = 500;

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
    setTimeout(() => resolve(data), 2000);
  });
}

function shortCwd(cwd) {
  if (!cwd) return "";
  // Just normalize slashes — no segment truncation. An earlier version
  // anchored on the first two segments (drive + top-level folder) to dodge
  // a hook payload cwd that can point at a subdirectory the assistant is
  // currently working in, which changes depth turn to turn. That broke any
  // repo not sitting directly at a drive root (e.g. `C:\Users\...\Projects\
  // my-repo` truncated to `C:\Users`, never the actual repo name) — wrong
  // for icon assignment, the .cwd label, and window-navigation matching
  // alike. The real fix belongs in the renderer instead: pin each session to
  // its first-ever reported cwd (see applyEvent in src/index.html) rather
  // than truncating the path here at all.
  return cwd.split(/[\\/]/).filter(Boolean).join("/");
}

// Claude Code injects context blocks (e.g. <ide_opened_file>…</ide_opened_file>,
// <ide_selection>…, <system-reminder>…) into the prompt text before the user's
// actual message. Strip them so the widget names the card after what the user
// really typed, not the injected junk. <task-notification>…</task-notification>
// is the harness's own synthetic UserPromptSubmit when a background
// subagent/task finishes and control returns to you — not something you
// typed, so it's stripped the same way. If the whole "prompt" turns out to
// be nothing but wrapper tags, this returns null, and the widget keeps
// showing the last real prompt as the card name instead of overwriting it
// with the wrapper's raw text (see `existing.name` fallback in index.html).
function cleanPrompt(p) {
  if (!p) return null;
  let s = String(p);
  s = s.replace(/<ide_[a-z_]*>[\s\S]*?<\/ide_[a-z_]*>/gi, " ");
  s = s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, " ");
  s = s.replace(/<task-notification>[\s\S]*?<\/task-notification>/gi, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 80) : null;
}

(async () => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (_) {}

  let payload = {};
  try {
    const raw = await readStdin();
    if (raw) payload = JSON.parse(raw);
  } catch (_) {
    // Non-JSON or empty stdin is fine — record the bare event.
  }

  const record = {
    ts: new Date().toISOString(),
    event: EVENT_NAME,
    session_id: payload.session_id || null,
    cwd: shortCwd(payload.cwd),
    tool_name: payload.tool_name || null,
    message: payload.message || null,
    // Prompt text (context blocks stripped) — used by the widget as the
    // session's display name.
    prompt: cleanPrompt(payload.prompt),
    // Bash command text (PreToolUse only) — lets the widget recognize
    // Claude Code's own built-in read-only commands (ls, cat, pwd, …) and
    // skip the approval-hint escalation for them, since those never
    // actually prompt. Documented, stable field per
    // code.claude.com/docs/en/hooks. Truncated: only used for a keyword
    // check, never displayed.
    command: payload.tool_input && typeof payload.tool_input.command === "string"
      ? payload.tool_input.command.slice(0, 500)
      : null,
  };

  try {
    fs.appendFileSync(EVENTS_FILE, JSON.stringify(record) + "\n");

    // Keep the file bounded so it never grows unbounded across long sessions.
    const lines = fs.readFileSync(EVENTS_FILE, "utf8").split("\n").filter(Boolean);
    if (lines.length > MAX_LINES) {
      const trimmed = lines.slice(lines.length - MAX_LINES).join("\n") + "\n";
      // Write-then-rename instead of a direct writeFileSync: writeFileSync
      // truncates the file before writing, so a widget poll landing in that
      // gap sees a transient 0-byte file, misreads it as "already trimmed",
      // and resets its read offset to 0 — replaying the whole (now rewritten)
      // file as "new" on the next poll and resurrecting stale sessions.
      // rename() is atomic, so readers only ever see the old or new content.
      const tmpFile = EVENTS_FILE + ".tmp";
      fs.writeFileSync(tmpFile, trimmed);
      fs.renameSync(tmpFile, EVENTS_FILE);
    }
  } catch (_) {
    // Never let the relay fail the hook itself.
  }

  process.exit(0);
})();

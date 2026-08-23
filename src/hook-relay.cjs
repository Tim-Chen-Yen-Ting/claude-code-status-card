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
  // alike.
  return cwd.split(/[\\/]/).filter(Boolean).join("/");
}

// The renderer used to handle subdirectory drift by pinning each session to
// its first-ever-seen cwd (see applyEvent in src/index.html) — correct
// within one widget process's lifetime, but that pin lives only in memory,
// so it resets on every widget restart. A long-running Claude Code session
// doesn't restart alongside the widget, so if the widget happens to come
// back up while that session is mid-tool-call deep in a subdirectory, the
// *subdirectory* becomes the new "first-ever-seen root" — wrong, and
// persistent until the session's next real UserPromptSubmit (confirmed:
// corrupted both the repo-name label and the icon-identity key for a
// session that had been running for hours across a widget restart).
//
// The durable fix belongs here instead, at write time: for any event other
// than UserPromptSubmit, look back through this session's own history in
// the events file for its EARLIEST UserPromptSubmit and reuse *that* cwd —
// authoritative regardless of whether any widget process was even running
// to see it, since it's read fresh from disk on every hook invocation.
//
// Earliest, not most recent: per Claude Code's own Bash tool docs, a `cd`
// in the main session carries over to later Bash commands for the rest of
// the session (as long as it stays inside the project directory) — so a
// *later* UserPromptSubmit's own cwd can just as legitimately already be
// drifted to wherever an earlier `cd` left the session (confirmed: the real
// session that surfaced this bug had a later UserPromptSubmit whose cwd was
// already the same deep subdirectory a subsequent tool call reported — nothing
// wrong with the relay, that's genuinely where the session's shell cwd was
// by then). Only the *first* UserPromptSubmit is guaranteed to predate any
// `cd` at all.
//
// Falls back to the raw payload cwd if no UserPromptSubmit is found for
// this session in the current 500-line window — its very first-ever event,
// or a long enough session that even its first UserPromptSubmit has aged
// out. Best effort in that case: there's no more history left to consult.
function findSessionRootCwd(existingLines, sessionId) {
  if (!sessionId) return null;
  for (let i = 0; i < existingLines.length; i++) {
    let rec;
    try { rec = JSON.parse(existingLines[i]); } catch (_) { continue; }
    if (rec.session_id === sessionId && rec.event === "UserPromptSubmit" && rec.cwd) {
      return rec.cwd;
    }
  }
  return null;
}

// A session's own launch directory (from findSessionRootCwd above) is
// correct for THAT session, but multiple sessions launched from different
// subdirectories of the same real project (one `cd`'d into CORE/RF before
// starting, another into tools/door_toolkit, another straight into the
// project root) each get treated as a completely different "repo" for icon
// assignment — confirmed in practice: one real (non-git) project fragmented
// into 9 separately-icon'd entries in icon-map.json, purely because the
// sessions working on it happened to be launched from 9 different
// subdirectories, none of which is any more "the project" than another.
//
// Fix: walk up from the launch directory looking for the nearest ancestor
// that looks like a project root — a `.git` folder (standard for version
// control) or a `CLAUDE.md` file (Claude Code's own per-project
// instructions convention, and the most directly relevant marker for a
// tool built entirely around Claude Code sessions — confirmed as the
// actual marker present for the real project that surfaced this: no
// `.git`, but `CLAUDE.md` sitting exactly at the root the user considers
// "the project"). Stops at the *nearest* match walking upward, so a repo
// nested inside a non-project parent folder (e.g. a git repo inside a
// plain Downloads-style folder with no marker of its own) still gets its
// own identity rather than collapsing into an unrelated parent. Falls back
// to the original directory, unchanged, if no marker is found anywhere in
// the ancestry — same as today's behavior for a plain folder that isn't
// otherwise recognizable as a project.
function findProjectRoot(startCwd) {
  if (!startCwd) return startCwd;
  // startCwd is already slash-normalized (shortCwd); rebuild a native OS
  // path for fs calls, converting back only when returning.
  let dir = startCwd.split("/").join(path.sep);
  for (;;) {
    let isProjectRoot = false;
    try {
      isProjectRoot = fs.existsSync(path.join(dir, ".git")) || fs.existsSync(path.join(dir, "CLAUDE.md"));
    } catch (_) {
      break;
    }
    if (isProjectRoot) return dir.split(path.sep).join("/");
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
  return startCwd;
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

  let existingLines = [];
  try {
    existingLines = fs.readFileSync(EVENTS_FILE, "utf8").split("\n").filter(Boolean);
  } catch (_) {
    // First-ever write, or file briefly missing — findSessionRootCwd/trim
    // below both tolerate an empty history fine.
  }

  // UserPromptSubmit's own cwd always IS the session's root (nothing to
  // look back for); every other event prefers this session's last-known
  // root over whatever subdirectory the current tool call happens to be
  // operating in. Either way, findProjectRoot then walks that up to the
  // nearest recognizable project root, so multiple sessions launched from
  // different subdirectories of the same project converge on one identity
  // instead of each getting treated as a separate "repo".
  const sessionRootCwd = EVENT_NAME === "UserPromptSubmit"
    ? shortCwd(payload.cwd)
    : findSessionRootCwd(existingLines, payload.session_id) || shortCwd(payload.cwd);
  const rootCwd = findProjectRoot(sessionRootCwd);

  const record = {
    ts: new Date().toISOString(),
    event: EVENT_NAME,
    session_id: payload.session_id || null,
    cwd: rootCwd,
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

# claude-code-status-card

Always-on-top mini widget that shows live, **per-session** status for every
Claude Code session running on this machine (thinking / running a tool /
**needs your approval** / done), so you don't have to keep VSCode or a
terminal focused to notice when a session is stuck waiting on you.

Not tied to any one project — it works for any Claude Code session on this
machine, because it's fed by global Claude Code **hooks**, not by VSCode.

## How it works

1. Claude Code hooks (configured in `~/.claude/settings.json`) fire on
   `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`
   (permission needed), `Stop`, and `SubagentStop`.
2. Each hook runs `src/hook-relay.cjs`, a tiny script that reads the hook's
   JSON payload from stdin, normalizes it, and appends one line to
   `~/.claude-status-card/events.ndjson` (the file is trimmed to the last
   500 lines).
3. The Electron app (`src/main.js`) tails that file (via `fs.watch` plus a
   2s poll fallback) and pushes new events to the renderer.
4. The renderer (`src/index.html`) keeps one **card per session** and
   updates it live. The window auto-resizes to fit the cards and floats at
   the bottom-right corner, above all other windows, on every workspace.

## Architecture / file map

For someone (human or AI) picking this up:

- **`src/hook-relay.cjs`** — invoked by every hook as
  `node <path>/hook-relay.cjs <EventName>`. Reads hook JSON from stdin,
  writes a normalized record to `~/.claude-status-card/events.ndjson`. This
  is the only writer of that file. Pure Node, no deps.
- **`src/main.js`** — Electron main process. Creates the frameless,
  transparent, always-on-top window; builds the tray menu; tails the events
  file; forwards events to the renderer over IPC (`"events"`). Also handles
  IPC from the renderer: `"drag-window"`, `"resize-window"` (grow upward
  keeping the bottom-right corner fixed), and sends `"clear"` on the tray
  "Clear all cards" action.
- **`src/preload.js`** — contextIsolation bridge exposing `window.pip`:
  `icons` (map of icon-name → raw SVG markup, read from `assets/icons/`),
  `onEvents(cb)`, `onClear(cb)`, `resize(height)`, `drag(dx, dy)`. It
  `require`s Node builtins (`fs`/`path`) to load the icons, which is why the
  window sets **`sandbox: false`** (see the gotcha below).
- **`src/index.html`** — renderer. Holds a `Map` of `session_id → state`,
  applies each event to its session, renders the cards, and asks main to
  resize. All UI lives here; changing look/behavior is usually a
  renderer-only edit.
- **`assets/icons/*.svg`** — the repository icon set (one flat, monochrome,
  `currentColor` SVG per icon, shared `0 0 24 24` viewBox). See
  "Repository icons" below.
- **`~/.claude-status-card/events.ndjson`** — the shared event log (data dir
  is `~/.claude-status-card/`). Not in the repo; created at runtime.
- **`hooks-snippet.json`** — reference copy of the `"hooks"` block to merge
  into `~/.claude/settings.json`.
- **`start-pip.vbs`** — no-console-window launcher; delegates to
  `restart-pip.ps1`. See "Running it standalone / at startup" below.
- **`restart-pip.ps1`** — kills any already-running instance of this widget
  (matched by repo path in the process command line) before starting a
  fresh `npm start`, so every launch trigger ends up as exactly one,
  up-to-date instance instead of stacking duplicates.

### Electron sandbox gotcha

The window is created with `sandbox: false` in `webPreferences`
(`src/main.js`). This is **required**: `preload.js` uses `require("fs")` to
load the icon SVGs, and Electron's default sandboxed preload can't require
Node builtins — with the sandbox on, the preload fails to load entirely,
`window.pip` is never defined, and the widget silently stays on Idle
(symptom: `Unable to load preload script … module not found: fs`). It's safe
to disable here because the widget only ever loads local, trusted files (no
remote web content). If you re-enable the sandbox, move icon loading into the
main process and pass the SVGs to the renderer over IPC instead.

### Repository icons

Each **repository** (not session) gets one icon, assigned deterministically
so it's stable across restarts and shared by all sessions in that repo:

- `preload.js` reads every `assets/icons/*.svg` at startup into
  `window.pip.icons` (name → SVG string). The SVG is inlined into the DOM so
  `currentColor` works — an `<img>` can't inherit CSS color. Each file is
  **auto-normalized** on load (`sanitizeSvg`): the XML prolog is stripped and
  hardcoded monochrome fills/strokes (`#rrggbb`, `black`) are rewritten to
  `currentColor`. So you can drop in an icon that hardcodes black and it still
  picks up the card colour — no hand-editing needed.
- `src/index.html` hashes the session's `cwd` (FNV-1a) to pick both the icon
  (`iconSvgFor`: `hashStr("icon:"+cwd) % iconCount`) and the colour
  (`iconColorFor`: `hsl(hashStr("hue:"+cwd) % 360, 60%, 72%)`). The colour is
  **deterministic, not random** — the same repo always gets the same hue —
  and uses high lightness so it always reads clearly on the dark card.
- The icon set is whatever `*.svg` files are in `assets/icons/` at launch;
  the assignment adapts automatically to any number of icons. **To change the
  set:** add/rename/replace files (flat, monochrome, ideally a shared
  viewBox). Picked up on next launch — no code change.
- **Manual per-repo override** (pinning a specific icon to a repo) is not
  implemented yet — the assignment is one function (`iconSvgFor`) if you want
  to add it.

### Event record schema

Each line of `events.ndjson` is one JSON object:

| field        | meaning                                                        |
|--------------|----------------------------------------------------------------|
| `ts`         | ISO timestamp the relay wrote the record                       |
| `event`      | hook name (`UserPromptSubmit`, `PreToolUse`, …)                |
| `session_id` | Claude Code session id — the card key (falls back to `cwd:<cwd>`) |
| `cwd`        | first two path segments (drive + top-level repo folder) of the session's working dir |
| `tool_name`  | tool being run (on `PreToolUse`/`PostToolUse`)                 |
| `message`    | notification text (on `Notification`)                          |
| `prompt`     | the prompt text (on `UserPromptSubmit`), used as the card name |
| `command`    | Bash command text (on `PreToolUse` for the `Bash` tool), used to recognize known read-only commands |

## Setup

```
npm install     # pulls down Electron — needs network access to github.com
npm start
```

`npm install` downloads Electron's ~180 MB prebuilt binary from GitHub
Releases and can take a long while (or appear to hang) on a slow link — let
it finish. If it fails with `ETIMEDOUT` reaching an IP under `github.com`,
run it from a network/VPN that can reach github.com, or set an
`ELECTRON_MIRROR` env var pointing at an internal mirror, then retry.

The hooks live in `~/.claude/settings.json` under the `"hooks"` key (see
`hooks-snippet.json`). Config is re-read on each hook invocation, so you do
**not** need to restart running sessions after editing it.

### Hook path gotcha (Windows)

The hook `command` strings must point at wherever this repo actually lives,
and **must use forward slashes**, e.g.:

```
node D:/claude-code-status-card/src/hook-relay.cjs PreToolUse
```

Do **not** use backslashes (`D:\claude-code-status-card\src\...`). Claude
Code's hook layer strips backslashes when it invokes the command, so
`D:\claude-code-status-card\src\hook-relay.cjs` collapses to
`D:claude-code-status-cardsrchook-relay.cjs` and fails with `MODULE_NOT_FOUND`.
Symptom: `UserPromptSubmit hook error … Cannot find module` and the widget
never leaves Idle. Forward slashes work fine with `node` on Windows and
avoid the escaping entirely.

## The widget

One card per active session. Each card shows the repository icon, a status
indicator + label, the latest prompt as the session's **name** (refreshed
every turn — so the card reflects what that thread is doing right now), and
the repository folder name. Cards sort newest-activity first.

### Card states

There are three visible states (thinking and tool-running are intentionally
merged — you don't need to tell them apart):

| Indicator                | Label            | Meaning                            |
|--------------------------|------------------|------------------------------------|
| blue animated spinner    | `Working`        | thinking or running a tool         |
| red double-bang (pulsing)| `Needs Approval` | **needs your approval** — go check |
| green check              | `Done`           | turn finished, waiting for you     |

The status indicator is separate from the repository icon on the left: the
icon identifies *which repo*, the indicator shows *what state*.

- When there are no sessions, a single "Idle — no active sessions" pill
  shows instead.
- **Approvals are sticky:** a "Needs Approval" card never auto-clears (so you
  can't miss it). It's replaced when the session emits its next event.
- **Done cards auto-retire** ~5 min after `Stop` (see `RETIRE_AFTER_MS` in
  `src/index.html`), unless the session sends another event first.
- "Needs Approval" is often **inferred**, not signalled — see the limitation
  below on the `Notification` hook.

### Controls

- **Drag** the widget by clicking and holding anywhere on a card (or the
  idle pill).
- **✕** on a card removes just that session from the widget. Use this when
  you kill a terminal session (which fires no `Stop` hook, so its card would
  otherwise linger). If you prompt that thread again, the card reappears.
- **Right-click anywhere on the widget** (or the tray icon) for the full
  menu: "Clear all cards" (wipe all sessions from the widget), "Reset
  position", and "Quit". The right-click menu means you can always quit from
  the window itself — handy since Windows often hides the tray icon in the
  `^` overflow. To get the widget out of the way of something behind it, just
  drag it aside.
- **⏻** on the idle pill quits the widget (the idle state has no session
  cards, so this is its dedicated quit button).

Launching via `start-pip.vbs` always kills any already-running instance
first (see `restart-pip.ps1`), so you shouldn't normally end up with
duplicates that way. But running `npm start` directly (bypassing the VBS)
doesn't have that guard, and duplicates can still stack at the same corner
and look like one widget. Confirm via the tray (one icon per instance), or
kill them all from a terminal:
`Get-CimInstance Win32_Process -Filter "name='electron.exe'" | Where-Object { $_.CommandLine -like "*claude-code-status-card*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`
(this is exactly what `restart-pip.ps1` automates).

## Known limitations / non-goals

- **One-way only.** Hooks are an outbound channel; the widget cannot send a
  prompt back into a session. Typing into a running Claude Code session
  would require brittle OS-level keystroke automation and is intentionally
  out of scope.
- **Names come from prompts.** A session has no name until its first
  `UserPromptSubmit`; before that it shows only the `cwd`. The name is the
  latest prompt (refreshed each turn, truncated to 80 chars), not Claude
  Code's own summarized thread title (which hooks don't expose). The relay
  (`cleanPrompt` in `src/hook-relay.cjs`) strips context blocks Claude Code
  injects into the prompt — `<ide_opened_file>`, `<ide_selection>`,
  `<system-reminder>` — so the name reflects what you actually typed. If a
  new wrapper leaks through, add it there.
- **Approval status is inferred, not signalled.** In at least some Claude
  Code builds the `Notification` hook never fires for permission prompts, so
  the widget can't be told directly that a tool is waiting on you. Instead,
  when a "Running tool" card gets no follow-up event within a per-tool
  window (`APPROVAL_HINT_MS_BY_TOOL` / `APPROVAL_HINT_MS_DEFAULT`, in
  `src/index.html`) it escalates to the red "Needs you?" state. Per Claude
  Code's own permission model, `Bash` and `WebSearch` get a short 3.5s fuse:
  Bash approval is remembered permanently per repo + exact command (so any
  new command re-prompts), and `WebSearch` has no session-level "always
  allow" at all, so it can re-prompt on nearly every call. Every other tool
  gets a 15s fuse — `Edit`/`Write`/`NotebookEdit` approval lasts until session
  end and `WebFetch` only prompts on the first hit to a new domain, so after
  that they routinely run long on big files/pages without ever needing
  approval again. If `Notification` *does* fire, it takes precedence and
  shows red immediately. The Bash/WebSearch fuse can't go much shorter than
  3.5s: every hook spawns a fresh `node hook-relay.cjs` process, plus a
  PreToolUse -> tool runs -> PostToolUse round-trip through Claude Code
  itself, and cold Node process-spawn overhead on Windows (especially with
  several hooks firing back to back) can eat past a second on its own — a
  1.5s fuse was observed false-positiving an auto-approved, no-prompt `ls`.
  Trade-off: a genuinely slow Bash/WebSearch call (>3.5s) can still
  false-positive; a non-Bash/WebSearch tool that's actually gated on approval
  (rare, effectively first-use-only) takes up to 15s to show red.
- **Known-safe Bash commands skip the timer entirely.** Claude Code
  recognizes a fixed set of built-in read-only Bash commands that never
  prompt, in any permission mode
  (code.claude.com/docs/en/permissions#read-only-commands; the relay now
  captures the command text via the hook's documented `tool_input.command`
  field to check this). For a command matching one of `ls`, `cat`, `echo`,
  `pwd`, `head`, `tail`, `grep`, `wc`, `which`, `diff`, `stat`, `du`, `cd`
  with no chaining/substitution/redirection and no unquoted glob
  (`isKnownReadOnlyBash` in `src/index.html`), there's no approval to ever
  wait for, so the widget skips the hint timer instead of guessing a
  duration — no more false-positive red flashes on a slow `ls`. The match is
  intentionally conservative: `git` is excluded because read-only-ness
  depends on the subcommand, and `find` is excluded because destructive flags
  like `-delete`/`-exec` make it non-read-only with no glob involved at all —
  both too easy to get wrong from a command string alone. Anything not
  confidently matched just falls back to the normal per-tool timer above,
  same as before this existed.
- **Clearing `events.ndjson` doesn't retract on-screen cards** — the
  renderer keeps sessions in memory. Use ✕ / "Clear all cards", or restart.
- **The widget only tails new events; it never replays history.** `main.js`
  re-reads the whole (small, capped at 500 lines) events file on every
  `fs.watch`/poll tick and forwards only records whose `ts` is newer than the
  last one it delivered (re-sending old lines would resurrect ✕-dismissed
  sessions). It intentionally does **not** track a raw byte offset: the
  relay's trim rewrites the entire file (drops the oldest line, shifts every
  byte), which would invalidate an offset-based tail the moment a trim
  happens — a record could get skipped entirely or mis-read as garbled bytes.
  Comparing `ts` strings survives that rewrite regardless of how the file
  underneath gets rebuilt. On startup it anchors to the newest existing `ts`,
  so a session already mid-flight when the widget launches won't appear until
  its next hook fires — the deliberate cost of not resurrecting stale/killed
  sessions that never sent a `Stop`.

## Running it standalone / at startup

The widget is a plain Electron process — it does **not** depend on VSCode.
`npm start` only ties it to the terminal you launched it from (close that
terminal and the child process dies). To run it independently:

- **`start-pip.vbs`** (in the repo root) launches it with **no visible
  console window**. Double-click to run it now, without keeping a terminal
  open. It's **self-locating** — it invokes `restart-pip.ps1` from its own
  folder, so moving/renaming the repo doesn't break it (as long as you run
  the copy inside the repo). `restart-pip.ps1` in turn kills any instance of
  this widget that's already running (matched by repo path, so it never
  touches an unrelated Electron app) before starting a fresh `npm start` —
  so every trigger (double-click, or login via the Startup shortcut below)
  always converges to exactly one, up-to-date instance instead of stacking
  duplicates or leaving a stale process running after you've edited the
  code.
- **Auto-start at login:** put a **shortcut** to `start-pip.vbs` in your
  Startup folder — `Win+R` -> `shell:startup`. One is installed there as
  `claude-code-status-card.lnk`; delete it to disable auto-start. Use a
  shortcut, not a copy — a copy would self-locate to the Startup folder and
  fail. With this in place the widget runs from login and survives VSCode
  being closed, so you never touch `npm start` again.

Note: every launch starts from Idle and only shows sessions that fire an
event afterward (see the tail-only-new limitation above). The tray "Quit"
stops the widget cleanly.

For a true installable `.exe` (no `npm`/source folder needed), package it with
`electron-builder` or `electron-packager` — heavier setup, not required for
the VBS approach.

## Renaming / moving the repo

The data dir (`~/.claude-status-card/`) and icons (loaded relative to the
code) are independent of the folder name, so those are fine. But these hold
**absolute paths** and must be updated by hand after a rename/move:

1. **`~/.claude/settings.json`** — the 6 hook `command` paths. This is the
   critical one; if it's wrong the widget silently stays on Idle (see the
   "Hook path gotcha" above — use forward slashes, and **quote the path** if
   the new location contains spaces).
2. **The Startup shortcut** (`shell:startup\claude-code-status-card.lnk`) —
   repoint its target at the moved `start-pip.vbs`.

Optional / cosmetic (nothing breaks if you skip these):

3. **The data dir name** `~/.claude-status-card/` is a hardcoded literal
   (`DATA_DIR` in both `src/main.js` and `src/hook-relay.cjs`) — it is NOT
   derived from the folder name, so a rename doesn't touch it. If you want it
   renamed for consistency, change the literal in **both** files identically,
   and move the existing `events.ndjson` over if you want to keep history
   (otherwise it starts fresh).
4. **`package.json`** `name`/`description` — purely cosmetic; also determines
   Electron's user-data cache dir (`%APPDATA%\<name>`), which is harmless to
   change (fresh empty cache).

Tip: keep the folder name space-free to avoid path-quoting headaches; use a
spaced display name only in the README / `package.json` description.

## Uninstall

1. Remove the `"hooks"` key from `~/.claude/settings.json`.
2. Delete the Startup entry: `Win+R` -> `shell:startup` -> delete
   `claude-code-status-card.lnk`.
3. Delete this folder and `~/.claude-status-card/`.

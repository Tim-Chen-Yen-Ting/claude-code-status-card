# claude-code-status-card

## What it does

Always-on-top mini widget that shows live, **per-session** status for every
Claude Code session running on this machine (thinking / running a tool /
**needs your approval** / done), so you don't have to keep VSCode or a
terminal focused to notice when a session is stuck waiting on you.

Not tied to any one project — it works for any Claude Code session on this
machine, because it's fed by global Claude Code **hooks**, not by VSCode.

## How to use

### Install

#### Get the code

Two ways to get this repo onto the machine you want the widget on:

- **`git clone` (recommended)** — if git is installed:

  ```
  git clone https://github.com/Tim-Chen-Yen-Ting/claude-code-status-card.git
  ```

  Cleaner than a ZIP download (no extra nested folder — see below), and lets
  you `git pull` later for updates.

- **Download ZIP** — if you don't have git: go to the repo's GitHub page →
  the green **Code** button → **Download ZIP**, then extract it.

  **Watch out for a doubled folder.** GitHub ZIPs extract into a folder
  named `<repo>-main` (e.g. `claude-code-status-card-main`). If you then
  extract *that* into a folder of the same name, or your unzip tool nests it
  again, you can end up with
  `claude-code-status-card-main\claude-code-status-card-main` — the actual
  repo (with `install.bat`, `package.json`, etc. directly inside) is the
  *innermost* one. Make sure you're pointed at the folder that directly
  contains `install.bat`, not a folder that merely contains another folder
  that contains it.

#### One-click setup

Double-click **`install.bat`**, from inside whichever folder actually
contains it (see the doubled-folder note above if using a ZIP download). It
runs `npm install`, merges this repo's hooks into `~/.claude/settings.json`
(without touching your other settings or any other tool's hooks — see
below), sets up the Startup shortcut so the widget auto-starts at login, and
launches it — all in one go.

What to expect:

1. A console window opens and stays open (unlike the widget's own launcher,
   which hides itself for quiet daily use — this one deliberately stays
   visible so you actually see progress and any real error, instead of
   wondering whether it silently hung or failed).
2. `[1/3] Installing dependencies...` — this downloads Electron's ~180 MB
   prebuilt binary from GitHub Releases and **can take a long while, or
   appear to hang, on a slow link. Let it finish.** A line like `npm warn
   deprecated ...` partway through is harmless noise, not a failure — it's
   normal for `npm install` to print several of these regardless of whether
   the install ultimately succeeds.
3. `[2/3]` and `[3/3]` (hooks + Startup shortcut) are near-instant.
4. `== Setup complete! ==`, then the widget launches. The window pauses at
   the end (`press any key to close`) so you have time to read the final
   status before it closes.
5. **Confirm it worked:** look for the widget in the bottom-right corner of
   your screen — an "Idle — no active sessions" pill if no Claude Code
   session is currently running. Start (or continue) a Claude Code session
   and a card should appear for it on its next prompt.

If it fails, the visible console window will show why — most commonly
either `npm` not found (install Node.js from nodejs.org, which bundles npm)
or an `ETIMEDOUT` reaching `github.com` (network/VPN issue reaching GitHub
Releases; see the Electron-download note above).

`install.bat` just calls `install.ps1` (`powershell -ExecutionPolicy Bypass
-File install.ps1`) — run that directly if you'd rather not have a `.bat`
wrapper. It's **safe to re-run** any time, e.g. after moving/renaming the
repo: it updates its own hook entries in place (matched by any command
referencing `hook-relay.cjs`, regardless of the path in it) rather than
duplicating them, and never touches other settings keys or other tools'
hook entries for the same events.

#### Manual setup

If you'd rather do it by hand, or `install.bat` doesn't work for your setup:

```
npm install     # pulls down Electron — needs network access to github.com
npm start
```

`npm install` downloads Electron's ~180 MB prebuilt binary from GitHub
Releases and can take a long while (or appear to hang) on a slow link — let
it finish. If it fails with `ETIMEDOUT` reaching an IP under `github.com`,
run it from a network/VPN that can reach github.com, or set an
`ELECTRON_MIRROR` env var pointing at an internal mirror, then retry.

The hooks live in `~/.claude/settings.json` under the `"hooks"` key — merge
in the block from `hooks-snippet.json`, replacing
`/absolute/path/to/claude-code-status-card` with wherever this repo actually
lives (see the Windows gotcha right below — **use forward slashes**).
Config is re-read on each hook invocation, so you do **not** need to restart
running sessions after editing it.

#### Hook path gotcha (Windows)

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
avoid the escaping entirely. (`install.bat`/`install.ps1` handle this
automatically — this only matters for manual setup.)

### The widget

One card per active session. Each card shows the repository icon, a status
indicator + label, the latest prompt as the session's **name** (refreshed
every turn — so the card reflects what that thread is doing right now), and
the repository folder name. Cards sort newest-activity first.

#### Card states

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
  in "Things you should know" on the `Notification` hook.
- **`SubagentStop` is treated as still-`Working`, not `Done`.** A background
  subagent/Task finishing its own sub-conversation doesn't mean the overall
  session is done — the main turn is very likely still running (spawning
  more subagents, synthesizing results, continuing the workflow). Only a
  real `Stop` (the main turn actually ending, control returning to you)
  flips the card green. Treating them the same used to flip the card green
  — and play the finish sound — on *every individual subagent completion*
  during a multi-agent workflow, even while the session kept working in the
  background: misleading and, with several subagents, noisy.

#### Audio cues

Red and green states also play a sound — an audible companion to the visual
states so a card grabs attention even when you're not looking at the
screen. This lives entirely in `src/index.html` (`playTransitionSound`,
`SOUND_APPROVAL`/`SOUND_DONE`); it's just an `Audio` object played from the
renderer, **not** a Claude Code hook — no extra hook or PowerShell script
involved, unlike a plain `Stop`-hook-triggered sound would be. That matters
here because it fires on the widget's own inferred state, including the
timer-based "Needs you?" escalation (see "Approval status is inferred, not
signalled" in "Things you should know") — a hook on the real
`Stop`/`Notification` events alone couldn't do that, since the widget's own
approval inference doesn't correspond to any single hook firing.

- **`assets/sound/finish.mp3`** plays on transition into `Done`.
- **`assets/sound/approval.mp3`** plays on transition into `Needs Approval`
  (both the real `Notification` path and the inferred timeout escalation).
- Only fires on a genuine transition (comparing the session's previous
  `kind` to its new one) — not on every re-render of an already-red/green
  card, so it won't replay on the periodic retirement sweep or an unrelated
  event.
- `Audio.volume` is left at its default (`1.0`), which is a multiplier
  *relative to* the system's current output level, not an absolute value —
  this never assumes or overrides your actual volume setting.
- To disable: remove/empty those two files, or comment out the
  `playTransitionSound` calls in `applyEvent`/`escalateToApproval`. To swap
  a sound: replace the file at the same path (any format Chromium's
  `<audio>` supports — mp3/wav/ogg — works, since the extension is only
  used to pick a codec, not hardcoded elsewhere).

#### Controls

- **Click a card** (anywhere except its icon) to jump to that repo's window
  — see "Click-to-focus a repo's window" in "How it works" for the
  mechanism and its real limitations.
- **Drag** the widget by clicking and holding anywhere on a card (or the
  idle pill) and moving the cursor — except the repository icon itself,
  which opens the icon menu instead (see below). Click vs. drag is told
  apart by cursor movement, not how long you hold the button: if the cursor
  moves more than a few pixels between mousedown and mouseup it's a drag,
  otherwise it's a click-to-focus (`CLICK_MOVE_PX` in `src/index.html`).
- **Click a card's icon** to pop up a native menu listing every icon in the
  set at the cursor; picking one reassigns that repo's icon immediately (see
  "Repository icons" in "How it works").
- **✕** on a card removes just that session from the widget. Use this when
  you kill a terminal session (which fires no `Stop` hook, so its card would
  otherwise linger). If you prompt that thread again, the card reappears.
- **Right-click anywhere on the widget** (or the tray icon) for the full
  menu: "Clear all cards" (wipe all sessions from the widget), "Reset
  position", and "Quit". Right-clicking anywhere on a card also adds a
  "Change icon" submenu with the same choices as clicking the icon directly
  (not only when the click lands precisely on the small icon — that would be
  a fiddly target). The right-click menu means you can always quit from the
  window itself — handy since Windows often hides the tray icon in the `^`
  overflow. To get the widget out of the way of something behind it, just
  drag it aside.
- **⏻** on the idle pill quits the widget (the idle state has no session
  cards, so this is its dedicated quit button).

### Running it standalone / at startup

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
  being closed, so you never touch `npm start` again. (`install.bat` sets
  this up for you automatically.)

Note: every launch starts from Idle and only shows sessions that fire an
event afterward (see "The widget only tails new events" in "Things you
should know"). The tray "Quit" stops the widget cleanly.

For a true installable `.exe` (no `npm`/source folder needed), package it
with `electron-builder` or `electron-packager` — heavier setup, not required
for the VBS approach.

### Uninstall

1. Remove the `"hooks"` key from `~/.claude/settings.json`.
2. Delete the Startup entry: `Win+R` -> `shell:startup` -> delete
   `claude-code-status-card.lnk`.
3. Delete this folder and `~/.claude-status-card/`.

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

### Architecture / file map

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
- **`assets/sound/finish.mp3`** / **`assets/sound/approval.mp3`** — audio
  cues for the `Done`/`Needs Approval` states. See "Audio cues" above.
- **`~/.claude-status-card/events.ndjson`** — the shared event log (data dir
  is `~/.claude-status-card/`). Not in the repo; created at runtime.
- **`~/.claude-status-card/icon-map.json`** — persisted repo→icon
  assignments, written by `preload.js`. Not in the repo; created at runtime.
  See "Repository icons" below — this is also the manual-override entry
  point.
- **`hooks-snippet.json`** — reference copy of the `"hooks"` block to merge
  into `~/.claude/settings.json` by hand; see "Install" above. `install.ps1`
  builds the same structure natively rather than parsing this file, since
  it needs the real absolute path substituted in anyway.
- **`install.bat`** / **`install.ps1`** — one-click setup: `npm install`,
  merge hooks into `~/.claude/settings.json`, create the Startup shortcut,
  and launch the widget. See "Install" above.
- **`start-pip.vbs`** — no-console-window launcher; delegates to
  `restart-pip.ps1`. See "Running it standalone / at startup" above.
- **`restart-pip.ps1`** — kills any already-running instance of this widget
  (matched by repo path in the process command line) before starting a
  fresh `npm start`, so every launch trigger ends up as exactly one,
  up-to-date instance instead of stacking duplicates.

#### Electron sandbox gotcha

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

Each **repository** (not session) gets one icon, shared by all sessions in
that repo:

- `preload.js` reads every `assets/icons/*.svg` at startup into
  `window.pip.icons` (name → SVG string). The SVG is inlined into the DOM so
  `currentColor` works — an `<img>` can't inherit CSS color. Each file is
  **auto-normalized** on load (`sanitizeSvg`): the XML prolog is stripped and
  hardcoded monochrome fills/strokes (`#rrggbb`, `black`) are rewritten to
  `currentColor`. So you can drop in an icon that hardcodes black and it still
  picks up the card colour — no hand-editing needed.
- **Icon shape is sequential and persisted, not hashed.** The first repo the
  widget ever sees gets the first icon (alphabetically by filename), the
  second repo gets the second icon, and so on, only wrapping back to the
  first icon once every icon in the set has been used at least once — and a
  wrapped repo always lands on the *first* icon in the cycle, never
  whichever one the immediately-preceding repo just got. This guarantees no
  two repos share an icon until the pool is exhausted, which a hash could
  never promise (two arbitrary repo paths always had some chance of landing
  on the same icon, well before you had enough repos to fill the pool).
  `preload.js` persists the assignment to
  `~/.claude-status-card/icon-map.json` (`{ assignments: { repoKey:
  iconName }, nextIndex: number }`) so it survives widget restarts;
  `src/index.html`'s `iconNameFor` reads/writes it via
  `window.pip.iconMap`/`window.pip.saveIconMap`.
- **Manual override, from the widget itself, via native OS menus (not a
  custom popup):** left-click a card's icon to pop up a standalone menu of
  every icon in the set at the cursor, or right-click a card's icon for the
  full menu with "Change icon" as a nested submenu (only added when the
  click landed on an icon, not empty widget space). Either way, picking an
  entry reassigns that repo's icon immediately and persists it; the
  currently-assigned icon shows as the selected radio item. To swap two
  repos' icons, just open the menu on each and pick the other's icon. Since
  native menus are text-only, entries show the icon's filename plus a
  matching emoji (`ICON_EMOJI` in `src/main.js`) rather than the actual SVG.
  `main.js`'s `buildIconMenuTemplate(repoKey)` builds the shared template
  (used both standalone via `show-icon-menu` and nested in `buildMenu` via
  `show-menu`); it reads `icon-map.json` read-only just to mark the current
  selection — `src/index.html` remains the sole writer, applying and
  persisting whatever choice comes back over the `set-icon` IPC message. You
  can also still hand-edit `assignments` in `icon-map.json` directly
  (`repoKey: iconName`) — useful for scripting or bulk changes — and restart
  the widget to pick up a hand-edit.
- **Colour is still a hash**, independent of icon assignment: `src/index.html`
  hashes the repo key (FNV-1a) via `iconColorFor`:
  `hsl(hashStr("hue:"+cwd) % 360, 60%, 72%)`. Deterministic, not random — the
  same repo always gets the same hue — and uses high lightness so it always
  reads clearly on the dark card. Two repos can still coincidentally share a
  hue; that's fine, since the icon shape (now guaranteed unique below the
  pool size) and the repo-name label are the real disambiguators.
- The icon set is whatever `*.svg` files are in `assets/icons/` at launch;
  the assignment adapts automatically to any number of icons. **To change the
  set:** add/rename/replace files (flat, monochrome, ideally a shared
  viewBox). New files are only picked up as *new* repos are assigned — repos
  already persisted in `icon-map.json` keep their existing icon even if you
  add more to the set later.

### Event record schema

Each line of `events.ndjson` is one JSON object:

| field        | meaning                                                        |
|--------------|----------------------------------------------------------------|
| `ts`         | ISO timestamp the relay wrote the record                       |
| `event`      | hook name (`UserPromptSubmit`, `PreToolUse`, …)                |
| `session_id` | Claude Code session id — the card key (falls back to `cwd:<cwd>`) |
| `cwd`        | the session's working dir, slash-normalized (see the note below the table) |
| `tool_name`  | tool being run (on `PreToolUse`/`PostToolUse`)                 |
| `message`    | notification text (on `Notification`)                          |
| `prompt`     | the prompt text (on `UserPromptSubmit`), used as the card name |
| `command`    | Bash command text (on `PreToolUse` for the `Bash` tool), used to recognize known read-only commands |

`shortCwd` in `src/hook-relay.cjs` only normalizes slashes now — it does
**not** truncate the path. An earlier version anchored on just the first two
segments (drive + top-level folder) to dodge a hook payload `cwd` that can
point at a subdirectory a tool is currently working in, which changes depth
turn to turn. That broke any repo not sitting directly at a drive root (e.g.
`C:\Users\...\Projects\my-repo` truncated to `C:\Users`, never the actual
repo name) — wrong for icon assignment, the `.cwd` label, and
window-navigation matching (see "Click-to-focus a repo's window" below)
alike. The real fix lives in the renderer instead: `applyEvent` in
`src/index.html` pins each session to its **first-ever reported** `cwd`
(`existing.cwd || ev.cwd`, not the other way around) — typically from
`UserPromptSubmit`, which is always the session's real root — so a later
`PreToolUse`/`PostToolUse` reporting a deeper subdirectory can't silently
drift the repo identity mid-session.

### Click-to-focus a repo's window

Clicking a card (a genuine click, not a drag) activates the first open
window whose title contains that repo's folder name anywhere in it.
`focusRepoWindow` in `src/main.js` runs this through a hidden,
`-EncodedCommand`-based PowerShell call (avoids shell-quoting entirely, so
Unicode repo names work correctly); `src/preload.js` exposes it as
`window.pip.focusRepo`, called from the mouseup handler in `src/index.html`
once movement is confirmed to be under `CLICK_MOVE_PX`.

This does **not** use `WScript.Shell`'s `AppActivate`, despite that being the
obvious built-in choice for this — `AppActivate` only matches an exact title
or, failing that, a title that **starts with** the given string, never
"contains anywhere." VS Code's title is normally `filename — reponame -
Visual Studio Code` (the active file leads, not the repo folder), so an
`AppActivate` call against just the folder name reliably found nothing.
Instead, the script enumerates top-level windows directly via user32
(`EnumWindows`/`GetWindowText`) and does a real substring search, then
raises the match with `SetForegroundWindow`. Four non-obvious pitfalls came
up getting this right, worth knowing if you touch this code:

- **`GetWindowText` needs `CharSet = CharSet.Unicode`** on its `DllImport`
  explicitly — without it, P/Invoke can resolve to the ANSI entry point,
  which silently mangles non-ASCII titles (confirmed: every CJK window title
  came back as replacement-character garbage in testing, while ASCII ones
  were fine). Window text is always UTF-16 internally, so this isn't
  optional for repo names in Chinese/Japanese/etc.
- **`SetForegroundWindow` alone is unreliable** here: Windows generally only
  lets the current foreground process (or one that recently received input)
  steal focus, and this runs in a fresh `powershell.exe` process — not the
  Electron process that actually received your click. The standard
  workaround is temporarily attaching this thread's input state to the
  current foreground window's thread via `AttachThreadInput`, which grants
  the foreground-switch permission for the duration of the attachment. Doing
  that correctly requires the foreground window's **thread ID**, which is
  `GetWindowThreadProcessId`'s *return value* — not its `out` parameter,
  which is the process ID. Mixing those up (easy to do, and what happened
  during development) silently feeds a process ID into `AttachThreadInput`
  as if it were a thread ID, so the attach — and every subsequent
  `SetForegroundWindow` — fails every time, with no error.
- **`ShowWindow(hWnd, SW_RESTORE)` shouldn't run unconditionally** — it's
  needed to un-minimize a minimized window before it can be raised, but
  called on an already-maximized window it also forces that window back to
  its normal (non-maximized) size, which visibly un-maximizes a fullscreen
  editor for no reason. Gated behind `IsIconic($found)` so it only fires
  when the target window is actually minimized.
- **The widget's own window can match itself.** Electron defaults a
  window's title to the app name from `package.json`
  (`claude-code-status-card`) unless told otherwise, which collided with a
  repo of the same name — since the widget is always-on-top, `EnumWindows`
  likely enumerates it before the real VS Code window, so the substring
  search matched and re-focused the widget itself, which looks like nothing
  happened. Fixed two ways: `createWindow` in `src/main.js` now sets an
  explicit, distinctive `title` so this specific collision can't recur, and
  `focusRepoWindow` additionally excludes the widget's own window **by
  handle** (`win.getNativeWindowHandle()`, passed into the script as
  `$ownHwnd`) — precise regardless of title, in case some other repo ever
  coincidentally shares whatever the widget ends up titled.

**Even correctly implemented, this is a heuristic, not a guarantee**, and
it's worth understanding why before relying on it: Claude Code's hooks give
a session's `session_id` and `cwd`, never a window handle or PID, so there's
no reliable link from "this session" to "this OS window" — matching by
folder-name substring in the window title is the best available proxy.

- Works well for **VS Code**, whose title bar includes the workspace folder
  name — if you run one Claude Code session per VS Code window (a common
  setup), this reliably lands on the right window.
- Unreliable for a **plain terminal**: most shells don't put the cwd in the
  window title unless you've configured them to, so there may be no
  matching title to activate at all.
- **Ambiguous with multiple matching windows** — two VS Code windows on
  repos that happen to share a folder name, or several terminal tabs open to
  the same repo, can't be told apart from a title substring alone; this just
  activates whichever matching window `EnumWindows` happens to enumerate
  first.

## Things you should know

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
  `<system-reminder>`, `<task-notification>` (the harness's own synthetic
  `UserPromptSubmit` when a background subagent/task finishes and control
  returns to you) — so the name reflects what you actually typed, not
  injected/synthetic text. If the whole prompt turns out to be nothing but
  wrapper tags, `cleanPrompt` returns null and the card keeps its previous
  name instead of showing raw tag text. If a new wrapper leaks through, add
  it there.
- **Approval status is inferred, not signalled.** In at least some Claude
  Code builds the `Notification` hook never fires for permission prompts, so
  the widget can't be told directly that a tool is waiting on you. Instead,
  when a "Running tool" card gets no follow-up event within a per-tool
  window (`APPROVAL_HINT_MS_BY_TOOL` / `APPROVAL_HINT_MS_DEFAULT`, in
  `src/index.html`) it escalates to the red "Needs you?" state. Per Claude
  Code's own permission model, `Bash` and `WebSearch` get a short 3.5s fuse:
  Bash approval is remembered permanently per repo + exact command (so any
  new command re-prompts), and `WebSearch` has no session-level "always
  allow" at all, so it can re-prompt on nearly every call. `AskUserQuestion`
  gets an even shorter 800ms fuse — per Claude Code's own tools reference,
  it's the one tool where "Permission required" is actually "No," not
  because it skips confirmation but because it isn't gated by the permission
  system at all: it's *always* a direct, synchronous wait for your input the
  instant it's called, with no "resolved instantly without needing you" case
  to guard against by waiting longer. Every other tool gets a 15s fuse —
  `Edit`/`Write`/`NotebookEdit` approval lasts until session end and
  `WebFetch` only prompts on the first hit to a new domain, so after that
  they routinely run long on big files/pages without ever needing approval
  again. If `Notification` *does* fire, it takes precedence and shows red
  immediately. The Bash/WebSearch fuse can't go much shorter than 3.5s:
  every hook spawns a fresh `node hook-relay.cjs` process, plus a
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
- **Duplicate widgets.** Launching via `start-pip.vbs` always kills any
  already-running instance first (see `restart-pip.ps1`), so you shouldn't
  normally end up with duplicates that way. But running `npm start` directly
  (bypassing the VBS) doesn't have that guard, and duplicates can still stack
  at the same corner and look like one widget. Confirm via the tray (one
  icon per instance), or kill them all from a terminal:
  `Get-CimInstance Win32_Process -Filter "name='electron.exe'" | Where-Object { $_.CommandLine -like "*claude-code-status-card*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`
  (this is exactly what `restart-pip.ps1` automates).

### Renaming / moving the repo

The data dir (`~/.claude-status-card/`) and icons (loaded relative to the
code) are independent of the folder name, so those are fine. But these hold
**absolute paths** and must be updated after a rename/move — easiest way is
to just re-run **`install.bat`** from the new location: it updates the hook
paths and the Startup shortcut in place (see "Install" above), so you can
skip the manual steps below entirely unless you'd rather not run it:

1. **`~/.claude/settings.json`** — the 6 hook `command` paths. This is the
   critical one; if it's wrong the widget silently stays on Idle (see the
   "Hook path gotcha" above — use forward slashes, and **quote the path** if
   the new location contains spaces).
2. **The Startup shortcut** (`shell:startup\claude-code-status-card.lnk`) —
   repoint its target at the moved `start-pip.vbs`.

Optional / cosmetic (nothing breaks if you skip these):

3. **The data dir name** `~/.claude-status-card/` is a hardcoded literal
   (`DATA_DIR` in `src/main.js`, `src/hook-relay.cjs`, **and**
   `src/preload.js`) — it is NOT derived from the folder name, so a rename
   doesn't touch it. If you want it renamed for consistency, change the
   literal in **all three** files identically, and move the existing
   `events.ndjson`/`icon-map.json` over if you want to keep history/icon
   assignments (otherwise they start fresh).
4. **`package.json`** `name`/`description` — purely cosmetic; also determines
   Electron's user-data cache dir (`%APPDATA%\<name>`), which is harmless to
   change (fresh empty cache).

Tip: keep the folder name space-free to avoid path-quoting headaches; use a
spaced display name only in the README / `package.json` description.

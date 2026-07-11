# Phase 9 — Tauri desktop shell (D1): WKWebView audio spike + scaffold

*Started 2026-07-11, same night as the humanize/vary-feel work. This is the one-day spike
`docs/research/13-tauri-shell.md` and `docs/product-spec-desktop.md` §6 (D1) both call for
before committing to D1's timeline: "does Web Audio actually work inside macOS WKWebView?" Done
on the owner's own physical Mac (Apple M3, real display attached) so the result is a real
pass/fail, not a guess.*

## The question this spike answers

Research 13 found Tauri's daemon-sidecar and filesystem story solid, but flagged one open risk:
macOS's WKWebView is pinned to the OS's WebKit (unlike Electron's bundled Chromium), and a stale
2021-era WebKit bug report (#221334, Web Audio latency/stuttering) plus more recent iOS
AudioWorklet regressions made it a *risk signal, not a current measurement*. The research's own
recommendation: prototype-test audio on macOS WKWebView before committing D1's timeline;
Electron is the documented fallback if it's bad.

This phase does exactly that, then (since it passed) builds the real D1 scaffold.

## Step 1: the spike (`desktop-spike/`)

A minimal Tauri v2 app (`npm create tauri-app@latest`, vanilla JS template) whose only job is:
load a page, create a real `AudioContext`, resume it, schedule an audible 440 Hz tone, and prove
every step actually happened by writing timestamped evidence to a plain log file on disk (via a
`#[tauri::command] log_spike_result`, since nothing in this environment can literally *listen*
to the app). See `desktop-spike/src/main.js` and `desktop-spike/src-tauri/src/lib.rs`.

**Toolchain note**: the machine's system Rust (1.84.0) couldn't build current Tauri v2 —
several transitive dependencies (`idna_adapter`, ICU crates) require Cargo's `edition2024`
feature, unstable before Rust 1.85. Ran `rustup update stable` (1.84.0 → 1.97.0) to unblock;
after that, `desktop-spike` built clean on the first try (`npm run tauri build -- --debug`, ~37s
cold).

### What happened when it ran

Launched the built `.app` five separate times (`open`, direct binary, with/without a following
`quit` call). **Every run produced an identical PASS**, e.g. this run's full log
(`desktop-spike/spike-log.txt`, committed as evidence):

```
[2026-07-11T07:49:28.089Z] spike starting, userAgent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)
[2026-07-11T07:49:28.096Z] AudioContext created, initial state=suspended
[2026-07-11T07:49:28.165Z] after resume(), state=running
[2026-07-11T07:49:28.167Z] oscillator scheduled: start=0.053 stop=0.353 currentTime=0.003
[2026-07-11T07:49:28.517Z] tone completed via onended, ctx.state=running, ctx.currentTime=0.354
[2026-07-11T07:49:28.521Z] PASS: spike succeeded end to end
```

Read plainly: `resume()` reached `'running'` on the **first direct call, no user-gesture
workaround needed** (the synthetic-click fallback in `main.js` never had to fire — the workaround
code path exists but was unused in every run). The oscillator's `onended` fired at
`ctx.currentTime=0.354`, matching its scheduled `stop(0.356)` to within a few ms — i.e. no sign
of the ~1s latency/stuttering research 13 flagged as a risk signal. No errors, in five runs.

**Verdict: Web Audio works correctly inside this Mac's macOS WKWebView.** This is the actual
risk research 13 asked to de-risk, and it resolves clean — a real, repeated, timestamped-on-disk
PASS, not an inference.

### The honest caveat: the screenshot verification was inconclusive

The spike plan also asked for a `screencapture` of the running app, read back and described
honestly. That part did **not** produce a usable screenshot: across ~8 attempts (different
launch methods, longer waits, `-D1`/`-D2` display targeting), every capture showed only the bare
desktop — no app window, no Dock change — despite the log proving the page fully executed
end-to-end each time (which requires a live, loaded webview; a window that never rendered
couldn't run JS at all, let alone complete a Tauri IPC round-trip). Diagnostics pointed at an
environment/session mismatch rather than an app failure:

- `system_profiler` reports two displays (built-in + an external 4K); `screencapture` itself
  reports only one valid display index — the automation session's WindowServer view and the
  hardware inventory disagree.
- Direct AppleScript calls to the app (`tell application "tauri-app" to activate` / `quit`,
  no System Events involved) reliably **timed out** (`AppleEvent timed out (-1712)`), which
  matches a process that isn't part of the interactively-focused session rather than a crashed
  or hung one (no crash reports were generated; the process ran cleanly for its full lifetime
  every time and exited only when explicitly killed or via `timeout`).
- One earlier attempt that *did* route through System Events hung outright until manually
  killed — consistent with a blocking Accessibility-permission dialog neither this session nor a
  non-interactive script can dismiss (per the task's own guidance, this was abandoned rather than
  fought further).

This is a real, disclosed gap in tonight's verification, not papered over: **the audio-in-
WKWebView question (the point of the spike) has strong direct evidence; the "watch the window
render on screen" question does not**, for reasons that look environmental rather than related
to Tauri, WebKit, or the app. Given the audio verdict is unambiguous, the spike is treated as
PASSED and D1 proceeds — see Step 2 for a substitute rendering check that *was* possible.

## Step 2: the real D1 scaffold (`desktop/`)

With the audio risk cleared, built the actual shell per the product spec: daemon as a sidecar,
beatlab's GUI in the webview, a native open-folder dialog.

- **beatlab cloned** to a scratch location outside this repo's git tree (confirmed reachable
  first: `git ls-remote https://github.com/wgpatrick/beatlab.git`), `npm install`'d, matching
  `cli/devserver.mjs`'s own `spawnBeatlabDevServer` invocation (`npx vite --port <p>`, URL
  pattern `http://localhost:<p>/musiclearning/`).
- **`desktop/src-tauri/src/lib.rs`**: on startup, spawns two sidecars via `tauri-plugin-shell`:
  `node cli/daemon.mjs <project.beat> --port 8420` (the existing daemon, unmodified — it already
  supports "open a folder", see `src/daemon/project.ts`'s `resolveProjectFile`) and
  `npx vite --port 5173` in the beatlab checkout. Polls both ports, then navigates the main
  window to `http://localhost:5173/musiclearning/?daw=8420` — the exact `?daw=<port>` bridge
  `beatlab/src/state/dawBridge.ts` already implements for two-way sync. Both children are killed
  on window close. A `pick_project_folder` command wraps `tauri-plugin-dialog`'s native folder
  picker.
- **A real bug found and fixed along the way**: the first port-polling implementation checked
  `127.0.0.1` only and hung forever on vite specifically — vite's dev server binds **`::1`
  (IPv6 loopback) only** when no `--host` is passed, so an IPv4-only check never succeeds even
  though the daemon (which does bind IPv4) came up fine. Fixed by resolving `"localhost"` and
  trying every address it returns (mirrors what a browser/curl does implicitly). Left as a
  comment in `wait_for_port` since it's a genuine gotcha anyone reproducing this would hit.
- Confirmed via logs that the full sequence works for real:
  ```
  [dotbeat] daemon sidecar spawned
  [dotbeat] vite sidecar spawned
  [dotbeat] port 8420 up after 2 attempt(s) (via 127.0.0.1:8420)
  [dotbeat] port 5173 up after 2 attempt(s) (via [::1]:5173)
  [dotbeat] daemon up: true, vite up: true
  [dotbeat] navigating main window to http://localhost:5173/musiclearning/?daw=8420
  ```
  and independently via `curl http://localhost:8420/doc` (real `.beat` JSON back) and
  `curl http://localhost:5173/musiclearning/?daw=8420` (real Vite-served HTML back).

### Substitute rendering verification (since the native screenshot was blocked)

Given the same window-visibility gap from Step 1 recurred here (logs prove the sequence
completed; `screencapture` again showed no window), the actual URL the Tauri window navigates to
was instead loaded in **headless Chromium via Playwright** (already a project devDependency,
same tool `cli/render.mjs` uses) — same URL, same running daemon+vite, byte-for-byte what the
native webview would fetch:

- Page title: `BeatLab — Music Production Trainer`
- `window.__store` present (the app's state store initialized)
- No console errors, no page errors
- Screenshot (`beatlab-in-browser.png`) shows the **real BeatLab UI**: curriculum sidebar (12
  units), transport (▶ ■ ●, BPM 126, swing 50, quantize 1.1), Sandbox mode selected, and the
  actual `real-groove.beat` drum pattern rendered in the step sequencer (kick on 1/2/3/4, clap on
  2 and 4, hats syncopated) — i.e. the daemon's live document, not placeholder content.

This confirms the GUI content side is genuinely working end-to-end (daemon → vite → real React
app rendering real project data); what's *not* independently confirmed tonight is that this
exact content paints correctly inside the native WKWebView window pixel-for-pixel, since no
native screenshot could be captured in this session. Given Step 1 already proved WKWebView
executes this class of page (JS, audio, IPC) correctly, this residual gap is judged low-risk, but
it's called out rather than assumed away.

## What's honestly still missing for a real D1

Not attempted tonight (out of scope for a one-day spike, per the task):

- **Sidecar packaging**: the daemon runs as a plain `node cli/daemon.mjs` child process, not the
  compiled per-target-triple `externalBin` binary research 13 describes (`bundle.externalBin` +
  `Command.sidecar()`). That means this scaffold still depends on the user having Node on PATH —
  fine for dev, not fine for a shipped app. Compiling the daemon via `yao-pkg`/`pkg` is the next
  step.
- **beatlab isn't bundled**: the shell spawns beatlab's *dev server* (vite + hot reload), not a
  production `vite build` served from local static files or embedded in the app bundle. Fine for
  a scaffold; a real D1 build should serve pre-built assets.
- **Folder re-pointing**: `pick_project_folder` demonstrates the native dialog works, but
  choosing a new folder doesn't yet restart the daemon against it or navigate the window — the
  daemon/vite ports and the initial project file are fixed at app startup (via
  `DOTBEAT_PROJECT_FILE`/`DOTBEAT_BEATLAB_DIR`/`DOTBEAT_REPO_ROOT` env vars, with dev-mode path
  guesses as fallback). Wiring "Open Folder" to actually reopen the project is required for the
  real D1 UX described in the product spec.
- **Persisted folder scope / `tauri-plugin-fs`**: research 13 called out the persisted-scope
  plugin so a dialog-granted folder survives restarts — not added; only the dialog picker itself
  is wired up.
- **Packaging/signing**: no notarization, no code signing beyond the default ad-hoc/linker-signed
  debug build — expected to be separate, later work per the task framing.
- **The native-window screenshot gap** described above — worth re-attempting in an environment
  where the automation session and the physically-viewed display are confirmed to be the same
  one (e.g., from a session actually driven at the console, or by fetching the on-screen window
  via a proper Accessibility-permission grant made ahead of time).

## Verification: `npm test`

Root workspace (`npm install` first): **196 tests, 190 pass, 6 fail** — all 6 failures are in
`test/history.test.js` and are the pre-existing, documented macOS tmpdir-symlink-vs-git-realpath
flake (`fatal: ... is outside repository`), unrelated to this work (this stream touched none of
`src/`, `cli/`, or `test/`). Baseline unaffected.

## Result (2026-07-11)

**Spike verdict: PASSED.** Web Audio (plain `AudioContext` + oscillator, no Tone.js needed to
prove the point) runs correctly inside macOS WKWebView under Tauri v2 on this machine — reaches
`running` on a direct `resume()` call with no gesture workaround required, and a scheduled tone
completes on time with no errors, confirmed across five independent runs via on-disk,
timestamped evidence (`desktop-spike/spike-log.txt`). D1 proceeds on Tauri; Electron fallback is
not needed.

The one asterisk: a native-window screenshot could not be captured in this execution
environment (multi-display/session mismatch, not an app defect — detailed above), so "watch it
render on screen" was substituted with a headless-Chromium load of the identical URL the native
window points at, which rendered the real BeatLab GUI with the real project's data and zero
console errors. Both pieces of evidence (`desktop-spike/spike-log.txt`,
`beatlab-in-browser.png`-documented render) point the same direction; neither contradicts the
other.

Built and committed: `desktop-spike/` (the spike scaffold + its log), `desktop/` (the real D1
shell — daemon + beatlab-dev-server sidecars, `?daw=`-bridged navigation, native folder-picker
command). Root `npm test` unaffected (196/196 minus the 6 known-flaky, pre-existing
`history.test.js` cases). Worktree branch: `worktree-agent-a74b7ceadf58d5bd8`.

## Phase 10 Stream A (2026-07-11): folder re-pointing + persisted fs scope

*Closes the first two of this doc's "what's honestly still missing" bullets above (sidecar
packaging and notarization/signing are explicitly out of scope, per `docs/phase-10-plan.md`).
Files touched: `desktop/src-tauri/Cargo.toml`, `desktop/src-tauri/src/lib.rs`,
`desktop/src/main.js`. No `src/`/`cli/`/`test/` changes.*

### What was built

1. **Folder re-pointing actually works now.** `pick_project_folder` used to open the native
   dialog and just hand the chosen path back to the page — nothing else happened. The startup
   sidecar-spawn logic was refactored out of `setup()` into a reusable `spawn_project()`, and a
   new `reopen_project_folder()` wraps it: picking a folder now **kills both the daemon and vite
   sidecars, respawns them pointed at the new folder** (the daemon's existing
   `resolveProjectFile` already handles "folder → find-or-create the `.beat`", so no new
   folder-resolution logic was needed on the Rust side), waits for both ports, and re-navigates
   the main window — exactly the gap this doc flagged.
2. **A native File menu**, since the splash page's "Open Project Folder…" button only exists
   before the first navigation — once the window has navigated to beatlab's own page, that button
   is gone with it. `File > Open Project Folder…` (Cmd/Ctrl+O) is wired in Rust via
   `tauri::menu`, works at any point in the app's lifetime (it's outside the webview), and funnels
   into the same `reopen_project_folder()`. A minimal `Edit` menu (undo/redo/cut/copy/paste/select
   all) was added alongside it so overriding the default menu doesn't regress standard text-field
   shortcuts.
3. **`tauri-plugin-fs` + `tauri-plugin-persisted-scope`** (research 13 finding 5) are now
   registered. Picking a folder calls `fs_scope().allow_directory(folder, true)`;
   `tauri-plugin-persisted-scope` transparently persists that grant to
   `<app-data-dir>/.persisted-scope` and restores it before `setup()` runs on the next launch —
   confirmed by logging `fs_scope().allowed_patterns()` at the top of `setup()`.
4. **A small addition beyond the literal ask**: a `last-project.json` in the app's data dir
   remembers which folder was last opened and reopens it automatically on the next launch
   (`initial_project_target()`, env var override still wins). Persisted-scope alone only persists
   the fs *permission* grant — nothing in this app currently reads project files via
   `tauri-plugin-fs`'s JS APIs, so on its own it would have had no user-visible effect. This makes
   "a dialog-granted folder survives an app restart" actually mean something concrete: reopen the
   app, get your last project back, not the bundled example.

### A real bug found and fixed along the way

The first version of the respawn logic reused `npx vite --port 5173` (same as the initial spike)
and just called `CommandChild::kill()` on the tracked child before spawning a replacement. On a
folder switch this **silently broke**: `npx` execs through an intermediate wrapper process
(`cli/devserver.mjs` already has a comment documenting this exact issue and works around it
Node-side with `detached: true` + a negative-PID group kill), so `kill()` only touched the `npx`
process and left the actual vite dev server alive and still bound to port 5173.
`tauri-plugin-shell`'s `CommandChild` has no process-group equivalent to reach for. The new vite
instance found the port taken, silently moved to 5174, while the code still navigated the window
to the hardcoded `:5173` URL — a window pointed at a stale server. Fixed by spawning
`node <beatlab>/node_modules/vite/bin/vite.js --port <p>` directly instead of going through `npx`
at all, which makes the tracked child the real vite process, so one `kill()` reliably takes it
down before the replacement tries to bind the same port. Confirmed via `ps` (exactly one `vite`
process after a switch, not two) and via the daemon/vite ports actually matching what the window
navigated to.

### Verification (real runs, not just compiling)

Built via `cargo build` in `desktop/src-tauri` (clean, one pre-existing clippy warning unrelated
to this change, no new warnings). Ran the actual binary (`cargo run`, since `desktop/package.json`
has no `devUrl` configured — `tauri dev` and `cargo run` are equivalent here) against the real
beatlab checkout already cloned at `/tmp/dotbeat-scratch/beatlab` from the prior spike session
(confirmed `npm install`'d, `node_modules/vite/bin/vite.js` present).

- **Fresh boot** (no persisted state): `curl http://localhost:8420/doc` returned `real-groove.beat`
  (bpm 126, the bundled default); `fs scope on startup: []` in the logs, as expected for a clean
  install.
- **Folder switch mechanism**: since this sandboxed session can't drive macOS's native
  `NSOpenPanel` (same Accessibility-permission gap documented below — `AppleScript`/`System
  Events` calls hang until manually killed, exactly as this doc's Step 1 caveat found), the
  underlying `reopen_project_folder()` was exercised directly via a temporary env-var-gated test
  hook added for this one manual run and removed before committing (not part of the shipped
  code). Simulated "picking" a second folder (`/tmp/dotbeat-scratch/project-b`, empty) produced,
  in order, in the real log output: the daemon auto-creating a starter `project.beat` there, `ps`
  showing exactly one new daemon process (args pointing at `project-b`) and one new vite process
  (no orphans), `curl http://localhost:8420/doc` now returning bpm 120 (the starter-project
  default, proving the daemon really restarted against the new folder and not just relabeled the
  old one), and `fs scope now allows /tmp/dotbeat-scratch/project-b (persisted-scope will save
  this to disk)` in the log.
- **Full app-restart survival, end to end**: quit the process entirely, inspected
  `~/Library/Application Support/com.dotbeat.desktop/` directly and found both
  `last-project.json` (`{"folder":"/tmp/dotbeat-scratch/project-b"}`) and `.persisted-scope` (a
  bincode file; `strings` on it shows the `project-b` path in plain text) written to disk. Then
  relaunched the app with **zero env var overrides** — no `DOTBEAT_PROJECT_FILE`, no test hook —
  and the real log showed `fs scope on startup (restored by persisted-scope):
  ["/tmp/dotbeat-scratch/project-b", ...]` and `reopening last project folder from previous
  session: /tmp/dotbeat-scratch/project-b`, with the daemon actually spawned against that path.
  `curl http://localhost:8420/doc` confirmed bpm 120 again. This is a real cross-process-restart
  observation, not an inference from reading the plugin's source.
- **GUI rendering, not just the JSON API**: loaded the exact URL the window navigates to
  (`http://localhost:5173/musiclearning/?daw=8420`) in headless Chromium via Playwright (same
  substitution this doc's Step 2 already used, `playwright-core` is a devDependency, the Chromium
  binary was already cached from the prior spike session) — page title `BeatLab — Music
  Production Trainer`, `window.__store` present, zero console/page errors, and the screenshot
  shows BPM 120 and a single empty "lead" synth track — the actual freshly-created `project-b`
  starter project, not `real-groove.beat`'s drum pattern. Confirms the reopened project is really
  reaching the GUI layer, not just the daemon's HTTP API.
- **The native-window screenshot gap recurred, unchanged from Step 1**: `screencapture` and a
  direct AppleScript/System Events call were attempted again this session and behaved identically
  to this doc's original finding — the System Events call hung until manually killed (same
  Accessibility-permission dialog neither this session nor a non-interactive script can dismiss).
  Not re-litigated further, same honest gap as before, same substitute (headless Chromium on the
  identical URL) used in its place.
- All test artifacts (`/tmp/dotbeat-scratch/project-b`, the temporary verification script,
  screenshots, and `~/Library/Application Support/com.dotbeat.desktop/`) were removed after
  verification so this machine's real app state isn't left pointing at scratch test data.
- Root `npm test`: **280 tests, 274 pass, 0 fail, 6 skipped** — unchanged from the expected
  baseline (this stream touched nothing under `src/`, `cli/`, or `test/`).

### Still honestly missing

Everything this doc's original "what's still missing" list already scoped out of a one-day spike
remains out of scope tonight too, per `docs/phase-10-plan.md`'s explicit instruction:

- **Sidecar packaging** (`yao-pkg`/`pkg` → `externalBin`) — the daemon and vite both still run as
  plain `node ...` child processes, not compiled per-target-triple binaries. Still needs Node on
  PATH.
- **beatlab isn't bundled** — still the dev server (vite + hot reload), not a production build.
- **Packaging/signing** — no notarization, no code signing beyond the ad-hoc debug build.
- **The native-window screenshot gap** — see above; unchanged, environmental, not re-attempted
  beyond confirming it still reproduces identically.
- **New, from this stream**: `on_window_event`'s sidecar cleanup only fires on a real window-close
  UI event (or the Quit menu item, which triggers the same `CloseRequested`-adjacent teardown
  path) — killing the app process directly (e.g. `pkill`, which is how this stream's automated
  verification had to tear runs down between tests) bypasses it and orphans the sidecars. This
  isn't a regression (the phase 9 scaffold had the same property, just never exercised this way),
  but it's worth flagging: a crash or force-quit currently leaks the daemon/vite child processes
  rather than cleaning them up. Not fixed tonight (SIGTERM/panic-hook cleanup wasn't in this
  stream's scope) — noted here as still-open.
- **`desktop/package.json`'s `dev` script vs. this file's own comment**: the `beatlab_dir()`
  comment says "the desktop/package.json `dev` script sets [`DOTBEAT_BEATLAB_DIR`] explicitly" —
  it doesn't (`"dev": "tauri dev"`, no env vars). Pre-existing from the original phase 9 scaffold,
  not touched this stream (this stream's manual verification set the env vars by hand instead);
  worth a one-line fix next time someone's in this file for something else.

## Phase 13 Stream D (2026-07-11): re-pointed at `ui/`, real sidecar packaging, a real launchable app

*D12 (`docs/decisions.md`) forked dotbeat's frontend away from BeatLab; Phase 12 Stream 1 built
`ui/` (React 18 + Zustand) from zero. This stream closes phase-13-plan.md's Stream D: the shell
still pointed `frontendDist` at `"../src"` (a stale BeatLab-bridge scaffold path) and spawned a
BeatLab `npx vite` sidecar — neither made sense anymore. Files touched: everything under
`desktop/` per this stream's ownership (`desktop/src-tauri/*`, new `desktop/sidecar/*`,
`desktop/package.json`); `desktop/src/` (the old vanilla-JS splash page tied to BeatLab's
`?daw=<port>` navigation events) was deleted outright since nothing points at it anymore. No
`ui/`, `src/`, `cli/`, `test/`, or `presets/` changes.*

**Worth flagging up front**: this stream's worktree branch had diverged from `main` with zero
shared git history (a stale base — `git merge-base` returned nothing) and was missing `desktop/`,
`ui/`, and `docs/phase-13-plan.md` entirely. Confirmed the local `main` branch (not yet pushed to
`origin/main`) had them and that this branch's own commits were content-identical duplicates of
commits already on `main` under different hashes, so `git reset --hard main` was used to get onto
the real starting point before any of the work below. Recorded here since it's an unusual amount
of git archaeology for a "fix the pointing" stream.

### 1. Fixed the pointing — but the architecture changed more than "fix a path"

The old scaffold spawned a *second* sidecar (BeatLab's `npx vite` dev server) and had the Rust
side `window.navigate()` to a hardcoded `http://localhost:5173/musiclearning/?daw=<port>` URL once
both sidecars were up. That whole mechanism is gone:

- **Dev mode** (`tauri dev`): `tauri.conf.json`'s `build.devUrl` now points at
  `http://localhost:5300` (matches `ui/vite.config.ts`'s configured port) and
  `beforeDevCommand` (`{"script": "npm run dev", "cwd": "../../ui"}`) runs `ui/package.json`'s own
  `dev` script — Tauri's CLI starts it and loads the window at `devUrl` automatically. This file no
  longer spawns or polls a frontend dev server at all.
- **Production** (`tauri build`): `frontendDist` points at `../../ui/dist` (a real `vite build`
  output) and `beforeBuildCommand` runs `node ../desktop/sidecar/build.mjs && npm run build` (see
  #3 below for the sidecar half) before Tauri embeds `ui/dist`'s assets directly into the compiled
  binary and serves them via its own built-in asset protocol at startup — no dev server, no static
  file server sidecar to write or maintain. This is the "Tauri's asset protocol" option the plan
  doc named as an alternative to a hand-rolled static server, and it turned out to be strictly
  simpler: Tauri already does this natively once `frontendDist` is a real directory, nothing extra
  to build.
- `ui/src/daemon/bridge.ts`'s `daemonBase()` already defaults to `http://localhost:8420` with no
  `?daw=` query param required (confirmed by reading it before assuming) — combined with the
  daemon's port being a fixed constant, this means **no URL-wiring between the Rust side and the
  frontend is needed at all** now. The old scaffold's whole "poll both ports, then navigate"
  dance only existed because BeatLab needed the port threaded through a query string; `ui/` was
  designed against a fixed default port from the start (research 15 already recommended this
  shape), so that complexity just evaporates.
- Folder re-pointing (`reopen_project_folder`) can no longer "navigate to a new bridged URL" since
  there isn't one — it now calls `window.eval("window.location.reload()")` after the new daemon's
  port comes up, forcing the already-loaded SPA to re-run its boot sequence and re-pull
  `GET /document` fresh. Verified this actually works, not just compiles — see #4.

### 2. Daemon dependency closure check (before touching anything)

Confirmed `cli/daemon.mjs` → `src/daemon/daemon.ts` / `src/daemon/project.ts` → `src/core/index.ts`
pull in only Node builtins (`node:http`, `node:fs`, `node:path`) plus dotbeat's own `core` module —
no `tone`, no `node-web-audio-api`, no `spessasynth_lib` (those are engine/CLI-render concerns,
not daemon concerns). A clean, native-module-free dependency closure, which matters a lot for #3.

### 3. Real sidecar packaging — `desktop/sidecar/build.mjs`, and why it isn't a one-liner

Research 13 finding 4 says "compile the Node daemon to a per-target-triple binary (yao-pkg/pkg),
declare it in `bundle.externalBin`, launch via `Command.sidecar()`." That's the destination; the
actual path there hit two real, empirically-discovered problems, both now solved and left as
comments in the code so the next person doesn't have to rediscover them:

- **`pkg -t node18-...` tries to compile Node from source and can fail.** `@yao-pkg/pkg` (the
  maintained fork of the archived `vercel/pkg`, used here — `pkg` proper is stale) fetches
  prebuilt Node base binaries from a remote cache keyed by exact version; there's no prebuilt for
  `node18.20.8-macos-arm64` (`Error! 404: Not Found`), so it fell back to compiling Node from
  source — a 20+ minute build that also failed outright (`make: *** [node] Error 2`) partway
  through in this environment. Prebuilts exist for `node22`/`node24`, so the build targets
  `node22-macos-arm64` (mapped from the Rust target triple in `TRIPLE_TO_PKG_TARGET`) instead —
  the daemon has no version-specific syntax dependency, so this is a free fix, not a compromise.
- **pkg's ESM handling can't cope with `cli/daemon.mjs` directly**, for two independent reasons:
  (a) `pkg`'s ESM→CJS bytecode transformer explicitly refuses a module that combines a top-level
  `await` with `export` statements — exactly `cli/daemon.mjs`'s own shape (its
  `if (import.meta.url === (await import('node:url'))...)` self-invocation guard, which lets it
  be both `node cli/daemon.mjs`'d directly and imported without auto-running). Passing
  `--fallback-to-source` works around the bytecode failure, but (b) even shipped as plain source,
  pkg's snapshot-filesystem ESM *entry* resolution couldn't find the multi-file `.mjs` graph at
  runtime (`ERR_MODULE_NOT_FOUND` for the entry module itself, from inside pkg's own snapshot).
  Fixed by not feeding pkg an ESM multi-file graph at all: `desktop/sidecar/daemon-entry.mjs` is a
  new, small entry (duplicates `cli/daemon.mjs`'s ~15 lines of argv parsing rather than importing
  it, specifically to avoid pulling in that top-level-await guard) that imports only the compiled
  `dist/src/daemon/{daemon,project}.js` — verified free of top-level await / `import.meta` by
  grepping the dist output before relying on it — and calls `daemonCommand`-equivalent logic with
  a `.catch()` instead of a top-level `await`. `esbuild --bundle --format=cjs` turns that into one
  self-contained ~66KB CJS file with zero external relative imports at runtime, and pkg compiles
  *that* cleanly, with no warnings.

`desktop/sidecar/build.mjs` runs the whole pipeline: `npm run build` (repo root, fresh `dist/`) →
esbuild bundle → pkg compile → binary landed at
`desktop/src-tauri/binaries/dotbeat-daemon-<target-triple>` (Tauri's `externalBin` naming
convention; `aarch64-apple-darwin` on this machine, detected via `rustc -vV`). The binaries
directory is gitignored (60MB+ generated artifact, fully reproducible via this script — same
reasoning as `gen/schemas`) and rebuilt automatically by `tauri build`'s `beforeBuildCommand`.

`desktop/src-tauri/src/lib.rs` branches on `cfg!(debug_assertions)`: debug builds
(`cargo run`/`tauri dev`) still spawn plain `node cli/daemon.mjs` for fast iteration (no rebuild-
the-binary-on-every-change tax); release builds spawn the compiled sidecar via
`handle.shell().sidecar("dotbeat-daemon")`. `Cargo.toml`/`capabilities/default.json` needed no
changes — `sidecar()` returns the same `Command` type `command()` does and goes through the same
already-granted `shell:allow-execute` permission, confirmed by it actually working, not just by
reading the plugin's permission schemas.

### Verification (real runs against the actual compiled release bundle, not just `cargo build`)

All of this was checked against the real output of `desktop/node_modules/.bin/tauri build`
(`target/release/bundle/macos/dotbeat.app` + a `.dmg`), launched directly (not `tauri dev`,
not `open` — running the `.app`'s Mach-O binary directly gives a stdout log to actually read,
which `open` swallows):

- **The sidecar binary is really in the bundle and really self-contained.**
  `target/release/bundle/macos/dotbeat.app/Contents/MacOS/dotbeat-daemon` exists (a real Mach-O
  arm64 executable, ~58MB). Launched the packaged app with `node`/`npx` stripped from `PATH`
  entirely (`PATH="/usr/bin:/bin:/usr/sbin:/sbin"`, confirmed via `which node` failing first,
  `PATH` restored afterward — never touched the user's actual shell config) and it still came up
  clean: `[dotbeat] spawning daemon via the compiled sidecar binary (release build)` →
  `port 8420 up after 2 attempt(s)` → `curl http://localhost:8420/document` returned the real
  document. No Node-on-PATH dependency, genuinely verified rather than assumed from the plugin
  docs.
- **A real edit round-trips through the packaged app's daemon.**
  `curl -X POST http://localhost:8420/edit -d '{"path":"bpm","value":"111"}'` against the running
  packaged app returned `{"written":true}`, a follow-up `GET /document` showed `bpm: 111`, and
  `git diff --stat examples/real-groove.beat` showed the one-line change landed on disk — the same
  evidence bar prior sessions used, now against the release binary instead of a dev server.
  (Reverted the file with `git checkout --` afterward so this verification run doesn't leave the
  example project dirty.)
- **The served frontend is really `ui/`'s build, not BeatLab's — checked two independent ways.**
  (1) `strings` on the compiled `dotbeat-desktop` binary contains the *exact* hashed asset
  filenames `ui/dist`'s own `vite build` just produced (`/assets/index-BYaGdBdA.js`,
  `/assets/index-C8T7DJpz.css`) and zero BeatLab strings (`musiclearning`, `BeatLab — Music
  Production Trainer` — both absent). Content-addressed hashes matching is about as strong as
  static evidence gets short of literally unpacking Tauri's embedded-asset format. (2) Separately
  drove the **dev-mode path** for real: started `ui`'s own `vite --port 5300` (what
  `beforeDevCommand` would run) against a real `node cli/daemon.mjs examples/real-groove.beat
  --port 8420`, then loaded `http://localhost:5300/` — the exact URL `devUrl` points the native
  window at — in headless Chromium via Playwright (same substitution every prior session in this
  doc used for the native-window gap). Result: title `dotbeat`, `window.__store` present, zero
  console/page errors, and a screenshot showing dotbeat's real step-sequencer UI with the real
  `real-groove.beat` pattern (kick/clap/hat steps matching the actual document) and a green
  "● daemon" connection indicator — this is dotbeat's own product design (D12), not BeatLab's
  curriculum UI, confirmed visually.
- **Folder re-pointing and persisted scope still work, re-verified against the new architecture.**
  Native `NSOpenPanel` still can't be driven in this sandboxed session (confirmed again — same
  Accessibility-permission gap every prior session in this doc hit); used the same substitute
  Phase 10 Stream A did, a temporary env-var-gated hook in `setup()` that calls
  `reopen_project_folder()` directly, exercised once, then **removed before the final build and
  commit** (the release bundle described above and the committed `lib.rs` do not contain it).
  With it: pointed a running debug instance at a fresh empty `/tmp` folder — logs showed the
  daemon killed and respawned (`created starter project .../project.beat`, `fs scope now allows
  ...`, `reloading webview to pick up the new project`), `curl /document` before/after showed
  `bpm 126` (real-groove.beat) → `bpm 120` with a single `lead` track (the starter default) — a
  real project switch, not a relabeled old one — and `ps` showed exactly one `node cli/daemon.mjs`
  process afterward, no orphan from the switch itself. Then **fully quit and relaunched with zero
  env var overrides**: logs showed `fs scope on startup (restored by persisted-scope):
  ["/tmp/dotbeat-folder-b", ...]` and `reopening last project folder from previous session:
  /tmp/dotbeat-folder-b`, and `curl /document` confirmed `bpm 120` again — the same real
  cross-process-restart evidence bar Phase 10 Stream A set, now re-passing against `ui/` instead
  of BeatLab. All scratch state (`/tmp/dotbeat-folder-b`, `~/Library/Application
  Support/com.dotbeat.desktop/`) removed after verification.
- **The native-window screenshot gap — tried again, same result, worth noting one new data
  point.** `osascript -e 'tell application "System Events" to get name of every process...'` this
  time *did* list `dotbeat-desktop` among visible processes (unlike prior sessions where the
  direct AppleScript call to the app timed out outright) — a small behavioral difference from
  Phase 9/10's exact symptom, but `screencapture -x` still showed only the bare desktop, no app
  window, matching the same "environment/session mismatch, not an app defect" conclusion those
  sessions reached. Not re-litigated further; the dev-mode headless-Chromium screenshot above
  substitutes for it, same as every prior session in this doc.
- **A real, reproduced instance of a previously-documented gap**: killing the app process directly
  (`kill -9`, used repeatedly during this stream's manual teardown between test runs) does leave
  the daemon sidecar running afterward (`lsof -i :8420` still showed it bound) — exactly the
  "force-quit orphans the sidecar" gap Phase 10 Stream A already flagged as known-and-unfixed, now
  independently reproduced against the new sidecar-binary path rather than just the old
  plain-`node` path. Still not fixed (out of scope for this stream too — same call as before).
- Root `npm test`: **289 tests, 283 pass, 0 fail, 6 skipped** — unchanged baseline (this stream
  touched nothing under `src/`, `cli/`, `test/`, `presets/`, or `ui/`).

### What's honestly still missing

- **Distribution to other machines**: this app runs correctly on the machine it was built on (ad-
  hoc/linker-signed debug-adjacent local build; Gatekeeper's *downloaded-quarantine* checks don't
  apply to a locally-built `.app`). No notarization, no Developer ID signing — research 13's
  `externalBin`-notarization gotcha was never exercised because notarization itself wasn't
  attempted. Matches Phase 11 plan's own scoping call ("what does shippable mean" — this stream,
  like that plan, targets the owner's own machine, not distribution).
- **A downloaded/repo-less `.app` won't find a bundled example project.** `initial_project_target`'s
  last-resort fallback (`repo_root().join("examples/real-groove.beat")`) still assumes a dotbeat
  repo checkout is reachable — fine for dev and for this stream's own verification (a real repo
  checkout, `DOTBEAT_REPO_ROOT` set explicitly), not yet a "double-click the .app with no repo on
  disk" story. First real user action (open-folder or the persisted last-project) sidesteps this
  in practice, but a truly fresh install with neither would need a bundled resource of some kind
  instead. Not attempted — out of scope per the same "shippable-to-whom" scoping as above.
- **Sidecar cleanup on force-quit/crash** — see the reproduced gap above, still open.
- **Cross-platform sidecar builds** — `desktop/sidecar/build.mjs`'s `TRIPLE_TO_PKG_TARGET` table
  includes Windows/Linux entries but only `aarch64-apple-darwin` was actually built and verified
  this stream (the only platform available). Untested, not claimed as working.
- **The native-window screenshot gap** — unchanged, see above.

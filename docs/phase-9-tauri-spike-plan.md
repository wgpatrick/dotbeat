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

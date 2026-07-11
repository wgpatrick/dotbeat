# Research 13 — Tauri desktop shell feasibility (D1)

*2026-07-11. Deep-research pass (initial run's verification died on a Fable rate-limit; re-run
on Opus completed clean). Informs desktop milestone D1 (`docs/product-spec-desktop.md` §6).
Verdict: feasible, with one engine-specific audio risk to design around.*

## Verdict

Wrapping the existing React + Tone.js/Web Audio GUI in Tauri v2 is architecturally sound and the
Node-daemon-as-sidecar path is officially supported end-to-end. The one real risk is
**per-platform webview audio**, concentrated on macOS.

## Verified findings

1. **Three webviews, not one** *(high)*. Tauri renders in the OS webview: WebView2 (Chromium) on
   Windows, WKWebView (WebKit) on macOS, WebKitGTK on Linux — so Web Audio/AudioWorklet behavior
   varies per platform, unlike Electron's single bundled Chromium. Windows WebView2 is evergreen
   (tracks Chrome closely); macOS WKWebView is pinned to the user's OS WebKit and can't be
   upgraded by the app; Linux WebKitGTK varies by distro. *(Tauri v2 webview-versions reference.)*
2. **Autoplay policy differs by webview** *(high)*. Starting audio on load without a user gesture
   was blocked on Windows WebView2 (issue #9968) but worked on macOS; wry passes
   `--autoplay-policy=no-user-gesture-required` by default but it's not always reliable.
   Manageable for a DAW — audio should start on a user gesture (play button) anyway.
3. **macOS is the highest audio risk** *(medium)*. WebKit bug #221334 — ~1s Web Audio latency +
   stuttering/silent gaps — filed 2021, still NEW/Blocker as of late 2022; verifiers found the
   class of problem persists (iOS 17.4-17.5 regression, AudioWorklet gaps in WKWebView). Single
   aged data point, so treat as a *risk signal*, not a current measurement — but it's the engine
   the macOS build would depend on. **Mitigation**: prototype-test audio on macOS WKWebView
   early; if it's bad, the Tauri shell can host the *editor* while audio routes through the
   native engine (old M4) sooner on macOS, or fall back to Electron for the macOS build only.
4. **Node sidecar is officially supported** *(high)*. Compile the Node ESM daemon/CLI to a
   per-target-triple binary (yao-pkg/pkg or any JS→binary tool), place under
   `src-tauri/binaries/<name>-<triple>`, declare in `bundle.externalBin`, launch from the Rust
   core (`app.shell().sidecar()`) or the webview (`Command.sidecar()` behind a scoped
   `shell:allow-execute` capability). `externalBin` exists precisely so users don't install Node.
   Prior art: `tauri-plugin-js` (managed Node runtime + stdio RPC).
5. **Filesystem is strong for "open a project folder"** *(high)*. `tauri-plugin-fs` with
   `watch`/`watchImmediate`, glob + path-variable scopes, deny-over-allow precedence, and an
   official persisted-scope plugin so a dialog-granted folder survives restarts.
6. **Packaging pain is mostly macOS** *(high)*. Signing needs an Apple Developer account + Apple
   hardware; Developer-ID distribution needs notarization; known open bug where `externalBin`
   sidecars can fail notarization even when the main binary signs cleanly (manual codesign the
   sidecar). Windows/Linux CI builds are routine; Tauri has an official updater.

## What this decides for D1

- **Ship the shell; keep the audio backend swappable** — exactly the D3-roadmap stance. The
  daemon becomes a bundled sidecar (our daemon is already a standalone Node process), so almost
  no daemon rewrite. Open-a-folder maps onto `tauri-plugin-fs` + dialog + persisted scope.
- **De-risk macOS audio FIRST** — a one-day WKWebView spike (does the beatlab engine play a loop
  cleanly?) gates whether Tauri is the macOS story or whether macOS needs the native engine
  earlier / an Electron fallback. This is the single most important unknown; do it before
  committing D1's timeline.
- **Windows/Linux are low-risk**; the sidecar + fs + updater story is well-trodden.

## Open / carried forward

- No verified list of *shipped* audio apps on Tauri (the "who's done this" evidence is thin) —
  the macOS spike substitutes for it. Electron remains the conservative fallback for a
  single-Chromium audio guarantee at the cost of bundle size.

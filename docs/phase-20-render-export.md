# Phase 20 — Stream X: render/export from the GUI

*Executed 2026-07-11. Owner: Will Patrick. Co-authored with Claude.*

There was no way to get a WAV out of the app without dropping to the CLI (`beat render`). The live
engine (`ui/src/audio/engine.ts`) already had a real, working capture path (`recordWav`, the same
mechanism Phase 17 Stream L's `cli/render.mjs` drives headlessly). This stream exposes that exact
capability as an in-app "Export" button — no new DSP, no second capture implementation.

## What changed

- **`ui/src/components/ExportButton.tsx`** (new) — a topbar button that: computes render length the
  same way `engine.play()` and `cli/render.mjs` do (a `song` block's full timeline in bars, else one
  `loopBars` pass, converted to seconds from `bpm`); calls `engine.play()`; waits 250ms for the audio
  graph to settle (same delay `cli/render.mjs`/`verify-engine-parity.mjs` use); calls
  `engine.recordWav(seconds)`; and triggers a browser download of the resulting `Blob` via a
  `URL.createObjectURL` + `<a download>` click. Shows `Export` → `Rendering…` (with a small CSS
  spinner) → `Exported ✓` (settles back to idle after 2s) → `Export failed` on error, with the error
  message as the button's tooltip.
- **`ui/src/App.tsx`** — one import, one `<ExportButton />` mounted in `.topbar-actions` next to the
  existing Mixer/History buttons. No other structural change.
- **`ui/src/styles.css`** — a small additive block (`.export-btn`, `.export-spinner` + keyframes)
  following the existing `.topbar-btn` conventions; nothing else touched.
- **`ui/verify-phase20-render-export.mjs`** (new, verification harness, not shipped app code) — drives
  a real daemon + built `ui/` in headless Chromium, clicks the actual Export button, catches the
  resulting browser download, and compares its metrics against a `cli/render.mjs` reference render of
  the identical project. Same structure/conventions as `ui/verify-engine-parity.mjs`.

## Decision: browser download, not write-to-disk via a daemon route

The plan allowed either. **Chosen: browser download**, no daemon route added. Reasoning:

- **The button already runs inside the exact browser tab the user is looking at**, which already has
  a live, running instance of the one true engine (D15). Calling `engine.play()` +
  `engine.recordWav()` there *is* "reusing the real capture path" in the most direct sense possible —
  it's literally the same function call `cli/render.mjs` makes, just invoked in the user's own tab
  instead of a spawned headless one.
- **The write-to-disk alternative (`POST /render` reusing `cli/render.mjs`'s logic) would not reuse
  the same running engine — it would spin up a *second*, independent daemon + headless Chromium +
  vite-preview + engine instance as a subprocess**, entirely disconnected from the session the user
  is actively working in. That's not "the capture mechanism used once instead of twice" so much as
  "the capture mechanism run twice, just both times through `cli/render.mjs`'s code path." It also
  costs ~5-10s of browser/daemon/vite-preview cold-start on every click (see Phase 17's own note that
  `cli/render.mjs` "takes ~as long as the audio is long, plus a few seconds of daemon/browser/ui-build
  startup"), versus the in-tab path which only pays the audio's own real-time length.
- A daemon route is real added surface (new `/render` endpoint, request lifecycle, concurrent-render
  handling, error propagation back to the GUI) for a feature whose actual requirement — "get a WAV out
  of the app" — a plain browser download already satisfies with zero new server-side code. The task's
  own instruction ("don't reimplement the capture mechanism twice if one path can serve both") reads
  most literally as: don't build a second in-browser capture routine — which this avoids by calling
  the *existing* `recordWav` directly, not by adding a server round-trip.
- Downloads work identically whether `ui/` is loaded as a plain web page or inside the Tauri desktop
  shell's webview (Tauri's webview honors normal browser download behavior), so this doesn't paint the
  desktop shell into a corner; a native "Save As" / write-to-project-folder affordance is a reasonable
  future upgrade (swap the `<a download>` trigger for a Tauri save-dialog + `writeFile` invoke) but is
  out of scope here and not needed to satisfy "get a WAV out of the app."
- **Zero risk to `npm test`**: no `src/daemon/daemon.ts` or `src/core/edit.ts` change means the
  295+/292+/0/3-style test-count gate that applies to daemon/core streams doesn't apply to this one
  (confirmed anyway — see below).

If a write-to-project-folder mode is wanted later, the natural shape (not built here) is: keep this
button as-is for "download," and add a second, explicitly-labeled "Render to project folder" action
that *does* add the small additive `POST /render` daemon route, shelling out to `cli/render.mjs`
exactly as the plan describes — additive, not a replacement.

## Verification evidence

Live, `ui/verify-phase20-render-export.mjs`:

1. Rendered `examples/night-shift.beat` via the **unmodified CLI path** (`cli/render.mjs`) as the
   reference.
2. Booted a real daemon on a fresh git-backed copy of the same project, served a production build of
   `ui/`, loaded it in headless Chromium, waited for the store/engine to be ready, then **clicked the
   real `button[data-action="export-render"]`** — the same DOM node a human clicks — and captured the
   resulting browser `download` event (Playwright `page.waitForEvent('download')`), saving the bytes
   to disk.
3. Confirmed the Export button visibly passed through `rendering` → `done` (`.export-btn.done`) CSS
   states — real progress/completion UI, not an instant no-op.
4. Analyzed both WAVs with `src/metrics` (`beat metrics`'s own analyzer):

```
CLI (beat render)  LUFS -9.0  crest 9.6  centroid 312Hz  bands% sub 45.7 / bass 31.0 / mids 21.6 / pres 1.2 / air 0.5
GUI (Export btn)    LUFS -8.5  crest 9.2  centroid 308Hz  bands% sub 42.2 / bass 34.4 / mids 21.8 / pres 1.1 / air 0.5
```

Real, non-silent audio (`samplePeakDbfs > -40` asserted), low-end share (`sub+bass`) within ~2 points
of the CLI reference (76.7% vs 76.6%), spectral centroid within 2% (308Hz vs 312Hz) — the exact
"same ballpark" bar Stream L used for its own BeatLab-independence proof. Full run:
`node ui/verify-phase20-render-export.mjs` (repo root), exits 0 on pass.

## Test / typecheck

- `src/daemon/daemon.ts` and `src/core/edit.ts` were **not touched**, so the full `npm test` run is
  not required by the stream's own rule — run anyway as a sanity check before starting UI work:
  **292 / 292 / 0 / 0** (tests/pass/fail/skip), clean.
- `ui/` typechecks clean: `npx tsc --noEmit -p ui/tsconfig.json` — zero errors.

## Scope discipline

Touched only: `ui/src/components/ExportButton.tsx` (new), `ui/src/App.tsx` (2-line additive change:
one import, one mounted component), `ui/src/styles.css` (additive block), and
`ui/verify-phase20-render-export.mjs` (new verification harness). `ArrangementView.tsx`,
`NoteView.tsx`, and `ui/src/audio/engine.ts` were not modified — the button calls `engine.play()` /
`engine.recordWav()` exactly as they already existed.

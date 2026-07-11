# Phase 20 — table-stakes usability

*Kicked off 2026-07-11, following the owner's own systematic-gap-analysis request mid live
testing. A direct code audit (grep across `ui/src/components/*.tsx`) confirmed zero GUI support
for track add/delete/rename/recolor, render/export, or project/folder management — real,
severe gaps for basic usability, distinct from and more urgent than any further sound-design or
layout polish. The owner also confirmed BeatLab already has working UI for most of this — port
it (D12), don't rebuild from scratch. Runs alongside Streams U (piano roll keys) and V
(arrangement length), both already in flight from Phase 19.*

## Stream W — track and project management (port from BeatLab)

1. Clone BeatLab fresh (or reuse an idle scratch checkout — check `/tmp/dotbeat-scratch/beatlab`'s
   `git status` first since other work may be using it, prefer your own clone path if unsure) and
   read its real track-management UI: add-track, delete-track, rename-track, and track-color
   controls (check `TrackList.tsx`/`DevicePanel.tsx`/wherever BeatLab actually implements these —
   don't assume a filename, read the real source). Port and adapt the *pattern*, not
   BeatLab-specific code verbatim (different document shape, different daemon API) — same
   discipline every prior porting stream in this project has used.
2. Build in dotbeat's own `ArrangementView.tsx` (or a new small component it composes, your call):
   an "add track" affordance (choose kind: synth/drums/instrument), a delete-track control per
   track header (with a real confirmation — this is destructive), a rename-track control (inline
   edit on the track name), and a track-color picker. Wire through real primitives: `beat
   add-track`/`beat rm-track`'s underlying `src/core/edit.ts` functions — check whether the
   daemon's `/edit` primitive already covers track add/remove/rename/color, or whether (like
   Phase 13's note-grammar precedent) a small additive extension is needed. If you touch
   `src/core/edit.ts` or `src/daemon/daemon.ts`, run the FULL `npm test` afterward, confirm
   295+/292+/0/3.
3. **Project/folder management**: check what already exists at the Tauri level (Phase 10/13 built
   folder re-pointing/persisted scope for the desktop shell — read `desktop/src-tauri/src/lib.rs`)
   — if a "new project" / "open a different folder" affordance already exists at the app-chrome
   level but isn't reachable from `ui/`'s own UI, wire a button/menu entry that calls it (check
   `window.__TAURI__` invoke patterns already used elsewhere in `ui/`, if any). If nothing exists
   at either layer yet, build a minimal version: a "New Project" action that calls the CLI's real
   `beat init` logic (via a small additive daemon route, not reimplemented), and an "Open Folder"
   action wired to the existing Tauri folder-picker command if reachable from the web layer.

**Expect a real, small merge conflict against Stream V** — you both touch `ArrangementView.tsx`
(V adds length controls near the timeline/loop end, you add track-header controls) — different
areas of the same file, resolved at merge same as every prior phase's predicted overlaps.

Verify live (headless Chromium, established `ui/verify*.mjs` convention): add a track via the
GUI, confirm it's really in the `.beat` file with a clean diff. Delete one, confirm removal.
Rename one, confirm the name change persists. Change a color, confirm it persists. If you built
project/folder management, verify it actually switches the daemon to a different file/folder.

Owns: `ui/src/components/ArrangementView.tsx` (track-header additions), a new component if
cleaner, `src/core/edit.ts`/`src/daemon/daemon.ts` (additive only, if genuinely needed). Do not
touch `ui/src/components/NoteView.tsx` (Stream U) or engine internals.

Result in `docs/phase-20-track-project-management.md`.

## Stream X — render/export from the GUI

There is currently no way to get a WAV out of the app without dropping to the CLI (`beat
render`). The live engine (`ui/src/audio/engine.ts`) already has a real, working `recordWav`-style
capture path — Stream L's `cli/render.mjs` already uses exactly this mechanism via headless
Chromium. Read how that works first (`docs/phase-17-engine-consolidation.md`,
`ui/verify-engine-parity.mjs` for the capture pattern) — you're exposing the same real capability
as an in-app button, not building new DSP.

1. Add an "Export" / "Render" button (topbar, alongside the existing Mixer/History buttons in
   `App.tsx` is a reasonable location) that: plays the project through the live engine exactly as
   the CLI path does, captures the real output, and produces a downloadable/saved WAV file. Decide
   and document whether output goes to a browser download or is written directly to the project
   folder via a small additive daemon route (`POST /render` reusing `cli/render.mjs`'s actual
   logic if that's cleaner than duplicating the in-browser capture — your call, but don't
   reimplement the capture mechanism twice if one path can serve both).
2. Show real render progress/completion state (even minimal — a spinner + "done" is enough, this
   doesn't need to be elaborate).

Verify live: trigger an export from the GUI, confirm a real WAV file is produced, and confirm via
`src/metrics` that its content matches what `beat render` produces for the same project (same
evidence bar as Stream L's own BeatLab-independence proof).

Owns: a new `ui/src/components/ExportButton.tsx` (or similar), minimal additive changes to
`ui/src/App.tsx` to mount it, a small additive daemon route if you choose the write-to-disk
approach (run full `npm test` if touched). Do not touch `ArrangementView.tsx`, `NoteView.tsx`, or
engine internals beyond calling its existing capture capability.

Result in `docs/phase-20-render-export.md`.

## Stream Y — fix the Osc2 apply-chain bug

**Already diagnosed, don't re-derive**: a direct `curl -X POST http://localhost:<port>/edit` with
`{"path":"lead.osc2Level","value":"1.0"}` against a real daemon correctly updates the `.beat`
file (verified: `osc2Level 0.45` → `osc2Level 1` in the file). So `src/core/edit.ts`'s `setValue`
and the daemon's `/edit` route are NOT the bug. But driving the identical edit through the GUI
(via `ui/src/daemon/bridge.ts`'s `postEdit`, the same path every other knob uses) left the
in-browser store showing the OLD value (0.45) after the edit, and the resulting audio was
measurably unchanged (spectral centroid barely moved). The bug is specifically in the GUI-side
apply chain: either `bridge.ts`'s `applyLocalEdit` optimistic mirror mishandling this specific
path pattern, or `ui/src/audio/engine.ts`'s `sync()` not correctly re-applying `osc2Level`/
`osc2Detune` to the actual `chain.osc2Gain`/`chain.osc2` Tone.js nodes on every doc change.

1. Reproduce it directly (headless Chromium, real daemon) to confirm exactly where the value gets
   lost — instrument both `applyLocalEdit` and `engine.ts`'s osc2 application code with real
   before/after logging if needed to pin it down fast, don't guess.
2. Fix it. Given osc2 is fully wired elsewhere (Phase 13 Stream A's parity work), this is likely a
   narrow, specific bug — a missing case in a mirror function, or a stale-closure/dependency issue
   in the engine's sync — not a structural problem.
3. **While you're in there, check whether other less-obviously-tested SYNTH_FIELDS entries have
   the same class of bug** (the GUI mirror silently failing to apply a value that the daemon/file
   correctly accepts) — Osc2 specifically wasn't caught by any prior stream's verification because
   most verification checked "does the file update correctly" (it does) or "does the engine
   produce sound at all" (it does), not specifically "does adjusting THIS knob in the GUI actually
   change what you hear." If you find the same bug class elsewhere, fix those too and say so
   plainly; if Osc2 was an isolated case, confirm that with real spot-checks on a few neighboring
   fields (osc3, sub, unison) rather than just asserting it.

Verify live with real measurement (reuse the pattern already used to find this: post an edit via
the GUI's real `postEdit` path, confirm both the store AND a real audio measurement — spectral
centroid or similar — actually change, not just that the file on disk is correct).

Owns: `ui/src/daemon/bridge.ts` and/or `ui/src/audio/engine.ts` (whichever is the real root
cause — likely not both, but fix wherever the actual bug is). Do not touch `ArrangementView.tsx`,
`NoteView.tsx`, `SynthPanel.tsx`'s structure (only touch engine/bridge logic, not the panel's UI
unless the bug turns out to be there too — check).

Result in `docs/phase-20-osc2-fix.md`.

## Process

Streams U (Phase 19, `NoteView.tsx`) and V (Phase 19, `ArrangementView.tsx`) are already running.
W expects a small, predicted conflict with V on `ArrangementView.tsx` — resolved at merge, same
spirit as every prior phase's file-overlap calls. X and Y are disjoint from everything else. `npm
test` must stay green (295+/292+/0/3) for any stream touching `src/core`/`src/daemon`.

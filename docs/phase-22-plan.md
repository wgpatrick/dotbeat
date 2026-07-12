# Phase 22 — eight parallel streams against the product roadmap

*Plan only, written before dispatch. Result section added once streams land and merge.*

## Why these eight

Selected from `docs/product-roadmap.md`'s 61 not-started rows for a mix of (a) the
highest-leverage items the roadmap itself and the openDAW research flagged, and (b) enough
file-level independence that eight worktree-isolated streams can run genuinely concurrently
without every one colliding on the same three files (`document.ts`, `engine.ts`,
`ArrangementView.tsx`) the way Phase 20's V/W/Z did. Perfect independence isn't achievable —
core format/engine changes will still overlap — so streams are briefed to build additively
against current `main` and conflicts get resolved manually at merge time, same discipline as
Phase 20.

Each stream: research already done (cited below), build across whichever of core/CLI/GUI the
feature needs, verify live (not just typecheck), update its row(s) in
`scripts/roadmap-data.mjs` from `not-started` to `done`, regenerate `docs/product-roadmap.md`.

## The eight streams

**AA — Ordered, reorderable per-track effect chain** (`research/21-opendaw-devices-effects.md` §1.1
+ #1). The single most consequential item in the openDAW pass. Replace the fixed
EQ3→comp→distortion→bitcrush order (`ui/src/audio/engine.ts:659` `buildSynthChain()`) with a flat,
literal, ordered list of effect blocks per track — order in the file *is* chain order, no
pointer/index indirection. Format: new `effect <track>.<n> <type> <params...>`-style grammar
(design the exact shape — canonical order, stable per-instance IDs so reorder reads as a move not
delete+insert). Engine: rebuild `buildSynthChain()` to iterate the declared list. GUI: drag-to-reorder
in `SynthPanel.tsx`, each insert individually add/removable, real bypass toggle (not just `*Mix=0`).
Biggest single stream — take the time this needs.

**AB — Drum voice expansion + unified drum clip editor** (`research/19-drum-voice-expansion.md` +
`research/20-drum-clip-editor-redesign.md`, explicitly meant to land together). Replace the closed
`DrumLane` enum (`src/core/document.ts:46`) with an open per-track declared lane list; ship the
12-lane GM-aligned default kit (synth-backed 808/909 + SoundFont-backed realistic percussion,
hybrid by role per research 19 Part V); add the optional `duration?: number` field to
`BeatDrumHit` (`document.ts:58`); rewrite `engine.ts`'s hardcoded `DrumKit`/`triggerDrum`
(`engine.ts:377,983`) into a lane→backing dispatch table with choke-group handling for the hat
pair; extend `NoteView.tsx` with a row-axis adapter for named drum lanes (research 20 Part 5) and
retire `StepSequencer.tsx` as the primary drum editor. Second-biggest stream.

**AC — Extended FX arsenal: build-next-four** (`research/17-track-fx-arsenal.md` §5). Ping Pong
Delay (with cross-feedback + LFO wobble per research 21), Beat Repeat, exposing the existing
Chorus-Ensemble/Phaser-Flanger mod-send bus as a per-track insert, and Saturator. Build against
today's fixed-chain shape per research 17's own field sketches — reconciling against AA's
reordering work happens at merge time, don't block on AA landing first.

**AD — Note editing vocabulary bundle** (`research/22-opendaw-editing-workflow.md` +
`research/18-ableton-ui-architecture.md`). Four small, related additions to `BeatNote`
(`document.ts:149`) and note-editing operations: Pitch & Time operations as CLI/MCP edit
primitives (transpose, ×2/÷2, fit-to-scale, invert, humanize, reverse, legato — rewrite note lines,
produce a normal diff, same pattern as `beat quantize`); groove/shuffle as a reversible read-time
warp (two literal fields, applied via `warp()`/`unwarp()`, never baked into stored positions);
per-note `chance` (0-100, re-rolled RNG per playback pass); per-note ratchet/repeat (`play-count`
+ curve + a "consolidate" bake-back action, richer 3-field shape per research 22's note about
openDAW's own mid-refactor); per-note `cent` micro-tuning (±50, independent of semitone pitch).

**AE — Audio-region clip format foundation** (`research/16-audio-clip-editing.md` §8, sequence 1-4
as one slice per its own recommendation). The prerequisite for everything else in "Audio-region
clip editing": a new clip-content type (media ref + in-point + out-point + gain + `warp` enum +
optional markers), repitch-mode warping (a `playbackRate`-equivalent param, zero new library),
split-at-point (pure edit primitive, no DSP), clip gain (static field + automation lane, likely
reuses `BeatAutomationLane` unchanged). Do NOT build warp markers/Complex-mode stretch or
beats-mode slicing this wave — those need the signalsmith-stretch dependency, a separate,
bigger lift research 16 itself sequences as its own slice.

**AF — Track & project polish bundle**. Three independent, small-to-medium GUI+daemon features:
track grouping (fold N tracks into a collapsible group header — new, no format precedent, scope
the simplest version that doesn't need a full nested-hierarchy grammar); new-project-from-scratch
reachable from the GUI (today only `beat init` does this — wire a daemon route + a GUI entry point
next to the existing "Open Folder" in `ui/src/daemon/tauri.ts`); save-project-as-template
(`research/24-opendaw-roadmap-positioning.md` — "copy this file/folder as a new project," opening
a template never mutates the original).

**AG — Arrangement extras bundle**. Three related `ArrangementView.tsx`-touching features: drag
the rightmost loop boundary directly (today only +/- controls resize it); clip-level
loop/length/time-signature properties (`research/18-ableton-ui-architecture.md` — not currently in
the `clip <slug>` grammar, v0.4); overlapping-region resolution policy
(`research/22-opendaw-editing-workflow.md` §2.1 — clip/push-existing/keep-existing, push always
downward, never cascading). Expect this to conflict with AA/AB/AC's `ArrangementView.tsx` touches
at merge time (mixer-strip/header-adjacent, not timeline-adjacent, in most of those — should be
resolvable the same way Phase 20's concurrent `ArrangementView.tsx` edits were).

**AH — Content browser sidebar** (`research/18-ableton-ui-architecture.md` §8, "Browser/sidebar").
A left-sidebar panel over the existing preset/sample/kit data (`presets/factory.json`,
`presets/kit-*`, `beat preset(s) --category`, already-built taxonomy from Phase 18 Stream S) —
drag-drop a preset onto a track or a sample onto a drum lane, preview-before-load reusing the
existing Freesound-preview pattern (`scripts/freesound-cc0.mjs`). New component, minimal `App.tsx`
layout change (add a collapsible left rail next to the existing `ArrangementView`/`BottomPane`
structure) — the most file-isolated stream of the eight.

## Explicitly not in this wave

Everything with a `Skip` verdict in the openDAW research; live collaboration; undo/redo; real
wavetable synthesis; native audio recording/comping (M4-native-tier); the git-lfs GC/locking pair
and cloud-folder sync (infra, lower urgency, no user-facing surface yet); GUI spectrum
visualization (real tension with D2's "no GUI judgment surface" — needs an explicit decision
first, not a build); Rung-2 feel-variation GUI wiring (owner-deprioritized); persisted mute/solo
representation (a decision, not yet a build). All stay `not-started` in the roadmap.

## Known conflict risk, going in

AA, AB, and AC all touch `ui/src/audio/engine.ts` and `src/core/document.ts`. AA, AF, and AG all
touch `ArrangementView.tsx`. This is the same shape as Phase 20's V/W/Z merge — expect multi-way
manual conflict resolution, not clean auto-merges. Dispatch all eight against current `main`
regardless; resolve as they land, in roughly the order AA → AB → AC → AD → AE → AF → AG → AH so
the two structural streams (AA, AB) get first claim on the shared files and everything else
reconciles against them rather than the other way around.

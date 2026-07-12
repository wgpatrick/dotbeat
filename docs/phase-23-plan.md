# Phase 23 plan — GUI completion + FX arsenal remainder, dispatched as parallel streams

Follows Phase 22 (`docs/phase-22-plan.md`, 8 streams AA-AH, all merged — see `docs/product-roadmap.md`
for current status: 40 done / 7 in progress / 35 not started as of this writing). Two kinds of work
dispatched together: **build streams** (BA-BF, six of them) closing scoped, ready-to-build gaps, and
**research streams** (RA-RE, five of them) doing dedicated design passes on items that are either
unscoped (`research: null` in `scripts/roadmap-data.mjs`) or only mentioned in passing by an existing
research doc, not given their own concrete design pass yet.

## Why these streams, in this batch

The Phase 22 audit (owner-caught: "I'm noticing its a 'done' on status - but missing in the GUI")
surfaced 7 features shipped core+CLI/MCP-only in Phase 22 and left at status `done` despite an
incomplete GUI layer — reclassified to `progress` in the same commit as this plan. Streams BA-BC
close those 7 rows plus a few adjacent GUI-only gaps that were already `not-started` for the same
reason (core+CLI done, GUI missing). Streams BD-BF finish the FX arsenal research-17 scoped but Phase
22 Stream AC didn't build (AC shipped the top 4 of 10; 6 remain, tiered by research-17 §5's own
difficulty ranking).

## Build streams

### BA — Piano-roll GUI for the note-editing vocabulary (closes 4 in-progress rows)
Closes: Pitch & Time operations, Groove/shuffle, Per-note probability (chance), Note ratchet/repeat —
all core/CLI-MCP done (`src/core/pitchtime.ts`, `src/core/groove.ts`, `src/core/chance.ts`, Phase 22
Stream AD), GUI missing or partial. Scope:
- A Pitch & Time operations menu/panel reachable from a note-selection context (transpose, ×2/÷2,
  fit-to-scale, invert, reverse, legato) — one-shot ops that call the existing CLI-parity edit
  primitives via the daemon, same pattern `beat vary`'s GUI affordance already establishes.
- A per-track groove/shuffle knob pair (shuffleAmount, shuffleGrid) — lives wherever track-level synth
  params already surface (mixer strip or a track properties panel).
- Piano-roll visual indicators for chance (dimmed/dashed note per <100 chance) and ratchet (repeat-tick
  marks) — NOT just the existing per-note inspector fields (`NoteView.tsx`'s inspector already exposes
  chance/cent/ratchetCount/Curve/Length when one note is selected; this stream adds the missing
  at-a-glance visual layer plus a draw-across-notes gesture for chance).
Touches: `ui/src/components/NoteView.tsx`, likely a new small panel component, `ui/src/daemon/bridge.ts`
if new post-* wrappers are needed for the one-shot ops (check whether `beat_transpose` etc. already
have daemon routes before adding one — Stream AD's own note says "no daemon route, matching quantize's
own precedent," so this stream may need to ADD daemon routes, unlike AD which was CLI/MCP only).

### BB — GUI completion bundle (drum lanes, mixer, presets, vary)
Closes: Open per-track lane model's GUI gap (no per-lane synth param knob surface — author via kit
preset or hand-edit today) — add a lane-editing affordance to the drum clip editor (`NoteView.tsx`'s
row-axis adapter, Phase 22 Stream AB/AH territory) letting a user add/reorder/retype a lane and edit
its synth/sample/sf backing params without hand-editing the file. Also closes 3 already-`not-started`
GUI-only rows where core+CLI are done: **Mixer's persisted mute/solo representation** (decide whether
either becomes a real saved field — today UI-only per `ui/src/state/store.ts` — and wire it if so, or
document the decision to keep them transient if the research favors that), **Hot-swap preset browser
in Device View** (apply a preset's literal param edits from inside the synth panel, not just via CLI —
`ContentBrowser.tsx`'s existing drag-drop from Phase 22 Stream AH may already cover most of this;
check before rebuilding), **Rung-2 "feel" content variation wired into the GUI** (humanized
timing/velocity batches exist in core/CLI, `beat vary ... feel`; expose as a GUI affordance next to
the existing vary/score/suggest GUI loop).

### BC — Audio-region clip GUI polish (closes 1 in-progress row)
Closes: Audio-region clip format's GUI gap. Phase 22 Stream AE shipped `AudioClipInspector` in
`ArrangementView.tsx` (repitch/split/gain all GUI-done per the roadmap) but the format row itself is
still `gui: partial` — the missing piece is clip *creation*: dragging an audio file from the content
browser (`ContentBrowser.tsx`, Stream AH) onto an `audio`-kind track to create a clip, plus a basic
waveform render in the clip view so trim points are visually legible (today: numeric fields only, no
waveform). Scope explicitly excludes region-level fade handles (separate not-started row, its own
future stream) and anything beats/warp-marker related (deferred, gated on research streams below).

### BD — 7-band parametric EQ
New insert type, same field-set-device shape as EQ3/compressor: HP/LP with selectable slope + Q, 3
bell bands, 2 shelf bands, each independently enabled. Research-17 §1 flags EQ3 can't do a real
parametric bell cut; this is the natural next tier. Slots into Phase 22 Stream AA's `EffectType` enum
as a new type (`eq7` or similar) — read `docs/phase-22-stream-aa.md` and the current
`src/core/document.ts` `EFFECT_TYPES`/`EffectType` before starting; this is an ADDITIVE change to an
existing enum, not a new subsystem. GUI: a new panel in the effect-chain UI Stream AA built, same
insert-list pattern as eq3/comp/distortion/bitcrush already use.

### BE — Quick FX bundle: Auto Filter / Auto Pan / Tremolo + Utility + Redux downsampling
Per research-17 §5's "deferred, with reasons": all near-free via Tone.js built-ins (`Tone.AutoFilter`,
`Tone.AutoPanner`, `Tone.Tremolo`, `Tone.StereoWidener`) plus Redux's downsampling half (small custom
downsampler — Tone.js has no built-in Rate/Jitter node, bit-reduction already ships as part of
bitcrush). Four small effects, bundled into one stream because each is individually a quick Tone.js
wrap, same insert-chain pattern as Stream AC's build-next-four. Note research-17's caveat: Auto
Filter/Pan/Tremolo's sonic capability already exists via the shared `lfoDest`/`lfo2Dest` matrix — the
value here is Ableton-authentic naming/independent control, not new sound, so keep these lean.

### BF — Custom DSP FX bundle: Grain Delay, Vinyl Distortion, Resonators
Per research-17 §5: real DSP work, each buildable from Tone.js primitives (`GrainPlayer`+custom
capture, `WaveShaper`+`Noise`, a `Filter` bank respectively) but meaningfully bigger lifts than the
top-4 or the quick-bundle above. Explicitly excludes **Corpus** (research-17: "no Tone.js primitive
gets close; realistically AudioWorklet-tier custom DSP... lowest priority of everything researched") —
leave Corpus not-started; it's a candidate for its own research pass on the AudioWorklet approach
before any build stream touches it.

## Research streams (produce a `docs/research/NN-*.md` doc; no code changes)

Numbered from 25 (last existing: `docs/research/24-opendaw-roadmap-positioning.md`).

### RA (research/25) — Warp markers + Complex-mode stretch: signalsmith-stretch integration shape
`docs/research/16-audio-clip-editing.md` §8 flagged this as needing "the signalsmith-stretch
dependency, a deliberately separate future stream" but never scoped the integration itself: WASM
binding approach (hand-write bindings vs. an existing JS wrapper), how a stretch call fits into
`ui/src/audio/engine.ts`'s existing per-clip `Tone.Player` model (offline pre-processing vs. real-time
worklet), and the warp-marker format grammar itself (`BeatAudioRegion.markers`, currently reserved but
always `[]`, structurally an ordered `(sourceTime, timelineTime)` list per the format-spec's own note).

### RB (research/26) — Beats-mode transient slicing: onset-detection approach
Sequenced after warp markers per `docs/research/16-audio-clip-editing.md` §8. Needs a concrete
onset-detection algorithm choice (spectral flux vs. a simpler energy-based approach), how detected
transients become format-level slice points (likely reuses the warp-marker grammar RA researches,
worth cross-referencing), and whether detection runs client-side (Web Audio AnalyserNode) or needs a
small WASM library.

### RC (research/27) — Macro tooling layer: concrete design pass
`docs/research/18-ableton-ui-architecture.md` named this area but didn't design it. Needs: which
params are the highest-value macro targets across synth/drum/FX param space, how a macro's mapping
(one knob -> N params, each with its own range/curve) gets authored and stored (outside the file, like
presets — decisions.md's existing "presets are tooling, never in-file indirection" precedent should
extend here), and what the GUI surface looks like (a dedicated Macros panel vs. inline on the mixer
strip).

### RD (research/28) — Multi-level in-session undo/redo vs. the git-checkpoint history system
Currently fully unscoped (`research: null` in the roadmap). Real architecture question before any
build: dotbeat already has explicit git-backed checkpoint/history/pin/restore (Phase 15,
deliberately NOT automatic). Does in-session Ctrl+Z need its own separate undo stack (in-memory, doc
snapshots or inverse-edit replay), or should it compose with the existing history system somehow
(e.g. auto-checkpointing more granularly)? What's the interaction when a user undoes past a point
where they've already made a git checkpoint? Needs a clear recommendation, not just options.

### RE (research/29) — Instrument-track FX chain: does it reuse the v0.10 effect-chain grammar?
Currently unscoped. Phase 22 Stream AA built the ordered/reorderable `effect` line grammar for synth
tracks only (`docs/phase-22-stream-aa.md`: "drum tracks... and instrument tracks never carry `effect`
lines"). This research asks: should instrument tracks get the same `effects: BeatEffect[]` field and
grammar, or does SoundFont-track routing (via WorkletSynthesizer) impose different constraints that
need a different shape? Concrete recommendation on format/engine approach, not just a gap description.

## Process notes (carried forward from Phase 22)

- Dispatch all eleven against current `main`. Build streams BA/BB/BC all plausibly touch
  `ui/src/components/NoteView.tsx` and/or `ArrangementView.tsx`; BD/BE/BF all touch
  `ui/src/audio/engine.ts` and `src/core/document.ts`'s `EffectType` enum — expect cherry-pick
  conflicts, same as Phase 22, and resolve them the same way (see Phase 22's own merge notes for the
  established conflict-resolution taxonomy).
- Every stream must `git add -A && git commit` its own work before finishing — Phase 22 repeatedly
  found agents doing complete work and leaving it uncommitted.
- Every build stream ships its own live verification script (Playwright-driven, measuring real
  rendered/serialized output, not just unit tests) and updates its `scripts/roadmap-data.mjs` rows
  (status, layer values honestly — not `done` unless every applicable layer actually is).
- Research streams write ONLY a new `docs/research/NN-*.md` file — no code, no roadmap-data changes
  (the features they inform stay `not-started` with the new research doc linked, ready for a future
  build stream to pick up).

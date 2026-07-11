# Phase 12 Stream 1 — dotbeat's own frontend, first real slice

*Built 2026-07-11, immediately following Stream 0's research (`docs/research/15-desktop-frontend-
architecture.md`) and D12 (`docs/decisions.md`: dotbeat gets its own product design; lifting/adapting
BeatLab's actual MIT-licensed code is the encouraged default, not a rewrite-from-scratch). This is
the first slice of a large app — it meets M1's own proven exit bar (a knob/step edit → one-line
`git diff`; a file edit → live GUI update, no reload) on dotbeat's OWN frontend, replacing the
BeatLab bridge that once met it.*

## What it is

A new top-level `ui/` directory: a standalone React 18 + Zustand app in a plain Vite dev setup
(Tauri shell wiring is a later stream, per research 15's recommendation). It connects to a running
`beat daemon`, renders the real `.beat` document, and edits it back — track list, transport/BPM, a
drum step-sequencer over the full loop, a core-param knob panel, a read-only piano-roll note view,
and a live master scope. Honest Tone.js playback proves the loop is real.

Verified end-to-end against `examples/night-shift.beat` in headless Chrome (`ui/verify.mjs`, the
same playwright-core + system-Chrome pattern as `cli/render.mjs`/`scripts/verify-m1.mjs`).

## Stack & rendering discipline (per research 15)

- **React 18 + Zustand 5**, Vite 5. Same stack BeatLab uses; research 15 §3 closed the
  Svelte/Solid/native-Rust-GUI question for this app.
- **The enforced canvas rule** (research 15 §2): anything updating faster than the musical grid
  renders on `<canvas>` via a shared, throttled rAF driver fed by refs — never Zustand-per-frame.
  Only the master Scope needs it today; the driver (`ui/src/audio/animationFrame.ts`) is built
  ahead of the second continuous view, as instructed. Discrete/grid-quantized state (drum steps,
  transport, selection, the ≤16/bar playhead + master level) stays on React + Zustand.

## File-by-file: ported/adapted vs. written fresh vs. stubbed

### Ported and adapted from BeatLab (fresh checkout `/tmp/dotbeat-scratch/beatlab`, HEAD `ba29bee`)

- **`ui/src/components/Knob.tsx`** ← BeatLab `Knob.tsx`. Adapted: **stripped** the `ParamStatus`
  prop + `STATUS_COLOR` map (ear-training grading feedback, imported from `../lessons/framework`).
  Pure SVG arc knob, pointer-capture drag, log/linear scaling — kept verbatim otherwise.
- **`ui/src/components/StepSequencer.tsx`** ← BeatLab `StepSequencer.tsx`. Adapted: **removed** the
  `mode === 'sandbox'` clip-strip branch (no lesson tri-state), and **generalized** from a fixed
  16-step one-bar pattern to the whole `loop_bars × 16` grid over dotbeat's **free-timed absolute
  hits** — a cell is on iff a hit rounds to that absolute step; a toggle POSTs a single
  `<track>.pattern.<lane>[<step>]` edit primitive.
- **`ui/src/components/Scope.tsx`** ← BeatLab `Scope.tsx`. Ported nearly as-is (the canvas escape
  hatch), with the one change research 15 §2 asked for: it subscribes to the **shared** rAF driver
  instead of owning a private `requestAnimationFrame` loop. `masterLevel` still handed over via a
  ref, not a subscription.
- **`ui/src/components/TransportBar.tsx`** ← BeatLab `TransportBar.tsx`. Adapted: kept play/stop
  and the `Math.floor(step/16)+1` bar·beat readout; **stripped** lesson/mode navigation
  (`currentLessonId`/`loadLesson`/`goToTrackLab`), undo/redo, quantize-strength, MIDI-connect.
- **`ui/src/audio/engine.ts`** ← BeatLab `engine.ts` (1,513 lines). **Ported the patterns, not the
  whole DSP** (Stream 1 brief: honest playback, not full fidelity): the drum-voice construction
  (MembraneSynth kick, NoiseSynth snare/clap, MetalSynth hats), the transport tick
  (`scheduleRepeat('16n')`, `step = ticks/PPQ*4 mod loop_bars*16`), the `Tone.getDraw().schedule(()
  => setState({currentStep, masterLevel}))` grid-quantized handoff, and the master
  bus→limiter→destination chain with side-tapped meter + waveform/fft analysers.
- **`ui/src/daemon/bridge.ts`** ← BeatLab `state/dawBridge.ts`. Adapted: same SSE-hot-reload +
  debounced-POST shape, rewired to dotbeat's routes (`GET /document` + `POST /edit` instead of
  `GET /doc` + whole-document `POST /state` — see the daemon note below) and its raw event model.

### Written fresh (dotbeat's own document shape, no BeatLab equivalent)

- **`ui/src/types.ts`** — dotbeat's document model as the GUI reads it (`BeatDocument`/`BeatTrack`/
  `BeatDrumHit`/`BeatNote`, free-timed hits, `CORE_KNOBS` metadata). NOT BeatLab's `Track`/`types.ts`.
- **`ui/src/state/store.ts`** — a lean Zustand store (doc + transport + selection + grid playhead).
  BeatLab's `store.ts` is 1,186 lines saturated with the `mode: lesson|sandbox|tracklab` tri-state
  the research doc said explicitly not to port; dotbeat's store carries none of it.
- **`ui/src/audio/animationFrame.ts`** — the shared throttled rAF driver, **reimplemented** (not
  copied — openDAW is AGPL/LGPL) from openDAW's `frames.ts` ~50-line pattern per research 15 §2.
- **`ui/src/components/SynthPanel.tsx`** — the core-9 knob panel (the DevicePanel "metadata table →
  generic renderer" pattern, scoped to the core params for this slice).
- **`ui/src/components/NoteView.tsx`** — a minimal piano-roll note view (read-only this slice).
- **`ui/src/components/TrackList.tsx`**, **`App.tsx`**, **`main.tsx`**, **`styles.css`** — the shell.

### NOT carried over (per research 15 §4 — curriculum-coupled, no dotbeat equivalent)

`lessons/*`, `LessonPanel.tsx`, `LessonSidebar.tsx`, `TrackLab.tsx`, `sandboxPersistence.ts`, the
`mode` tri-state, and every `ParamStatus`/grading branch. None of it entered `ui/`.

### Honestly stubbed / simplified in the engine

One `PolySynth` + filter + volume + pan per synth track. **Not** wired: osc2/sub/noise/FM layers,
unison, LFOs, filter envelope, EQ/comp/distortion/bitcrush inserts, reverb/delay/mod sends,
sidechain ducking, and the per-lane drum-voice shaping params (`kickTune`, `kickDecay`, `hatTone`,
…). Off-grid hits/notes trigger at their fractional offset within the step but voices aren't
per-hit reshaped. This is "sound comes out on play," not parameter-for-parameter parity — exactly
the scope the brief set.

## Daemon change (additive only — `src/daemon/daemon.ts`)

Two small additive routes; existing routes untouched. Full `npm test` after: **286 / 280 / 0 / 6**
(unchanged baseline).

- **`GET /document`** → the raw `BeatDocument` JSON. The existing `GET /doc` returns the BeatLab-
  bridge projection where drums are collapsed to a 16-step, one-bar pattern (`hitsToPattern`,
  mod 16, max-wins). dotbeat's own frontend renders the free-timed event model directly, so it
  needs the absolute hits/notes that projection discards.
- **`POST /edit`** `{path, value}` → runs core's `setValue` (the exact `beat set` grammar) and
  writes one canonical line if it changed. **Why not the existing whole-document `POST /state`:**
  the format stores drums as free-timed hits absolute across `loop_bars`, and `/state` speaks the
  16-step one-bar pattern shape — so a single GUI step-toggle round-tripped through `/state` would
  `patternToHits`-tile across **every** bar (4 lines for a 4-bar loop, not one), breaking the
  one-line-diff exit bar. This is the finer-grained edit primitive research 15 §4 flagged; a
  path-scoped edit lands on exactly one hit. Reuses already-tested core code (`setValue` with the
  `pattern.<lane>[<step>]` path is the format's own step-toggle-over-events primitive).

A shared `writeIfChanged()` helper does the canonical-to-canonical comparison (identical music →
identical bytes → no write, no watcher echo) that `/state` already did inline.

## Verification evidence (`ui/verify.mjs`, headless system Chrome)

Boots the daemon on a temp git repo holding night-shift in **current canonical form** (so a toggle
is a clean one-line diff, not a v0.3→v0.9 format migration), serves the built `ui/`, drives it, and
asserts:

**[D] Real project data on screen** — `.track-name` in the live DOM: `["lead","drums","bass","pad"]`,
BPM 124, BARS 4. Screenshot `ui/verify-screenshot-1.png` read back: the lead track's synth panel
shows osc `square`, VOL −1.0, CUTOFF 5.2k, RES 1.1, ATTACK 10ms, DECAY 250ms, SUSTAIN 0.25, RELEASE
300ms, PAN R35 — matching `examples/night-shift.beat`'s `lead` block exactly — plus its 7 notes
(pitch 67–76) in the note view. Not placeholder/empty state.

**[A] GUI step-toggle → exactly one line changed.** Selected drums, committed (selection is itself
a one-line `selected_track` edit), then clicked kick step 1 (off in night-shift). Real `git diff`:

```
diff --git a/night-shift.beat b/night-shift.beat
@@ -54,0 +55 @@ track drums drums #56b6c2 drums
+  hit kick1 kick 1 0.8
```

Exactly **1 line added, 0 removed.**

**[B] File edit → live GUI update, no reload.** Hand-edited `bpm 124` → `bpm 141` on disk; the
daemon's SSE `doc` event drove a `/document` re-pull and the store's `bpm` became `141` with no
reload (transport uninterrupted). Screenshot `ui/verify-screenshot-2.png`: BPM field reads 141 and
the full 5-lane drum grid renders across all 4 bars with the toggled kick.

**[C] Audio actually plays.** Clicked Play: `currentStep` advanced (1 → 4, transport genuinely
running) and the side-tapped master meter read **−14.0 dB** while notes triggered — real output
through the ported engine, not silence.

Final repo suite: `npm test` → **286 / 280 / 0 / 6.**

## Honestly deferred (follow-up streams, not failures of this slice)

- **Full synth param surface** — the ~60-field `SYNTH_FIELDS` beyond the core 9 (layers, LFOs,
  filter env, EQ/comp/inserts, sends, ducking, drum-voice shaping), and wiring them in the engine.
- **Note/clip editing** — the piano roll is read-only; `addNote`/`removeNote`/drag round-trips are
  next (the edit-primitive route + optimistic-mirror pattern already generalizes to them).
- **Arrangement/song view, scenes, mixer** — the document already carries scenes/song; no UI yet.
- **Instrument (SoundFont) tracks** — shown in the list + note view; no playback/edit surface.
- **Media / lane samples** — the daemon serves `/media/*`; no sample-assignment UI.
- **Tauri shell wiring** — a later stream per research 15; `ui/` runs as a plain Vite app for now.
- **Selection (`GET`/`POST /selection`) integration** — the D2 pointing protocol isn't surfaced
  yet; track selection currently rides through `selected_track` in the document.
- **WebGL arrangement timeline** — deferred per research 15 §2's table until multi-track zoomed
  waveforms make canvas-2D the bottleneck.

# Research 15 — Desktop frontend architecture: what goes inside the Tauri shell

*2026-07-11. Stream 0 of `docs/phase-12-plan.md`, gating Stream 1 (the actual frontend build).
Answers whether D3's "web tech GUI, Tauri wraps it" (`docs/decisions.md`) still holds now that
dotbeat is building its own frontend from zero (D12), not wrapping BeatLab's. `docs/research/13-
tauri-shell.md` already covers the shell itself (sidecar, fs, packaging) — this is the pass for
what renders inside it. Current priority per owner is the Mac app specifically.*

> **Mid-research correction, folded in below (owner, via `docs/decisions.md` D12 refinement):**
> the hard-fork decision is about product design/identity, not code purity. Lifting BeatLab's
> actual code — `engine.ts`, `Knob.tsx`, the step-sequencer grid, whatever fits — into dotbeat's
> new frontend is the *encouraged* default, not something to avoid. This changes how §3 and §4
> below are weighted: the switching cost of leaving React now has to be justified against "we can
> reuse real, debugged, MIT-licensed code," not just against abstract framework benchmarks.

## Verdict

**Stay in Tauri's webview. Stay on React. Port BeatLab's `engine.ts` and its component patterns
rather than rewriting them. But adopt, as an explicit and enforced rule, the one architectural
discipline that BeatLab, openDAW, and WAM Studio all converge on independently: anything that
updates continuously during playback (waveform scrub, level meters, smooth playhead motion)
renders on `<canvas>`/WebGL through its own animation-frame loop, fed by refs/mutable buffers, and
never touches React state per frame.** Discrete, note-grid-granularity state (drum steps, track
selection, a playhead that ticks once per 16th note) stays exactly where BeatLab already puts it:
Zustand + ordinary component re-render. No SwiftUI-native rewrite for macOS — there is no sourced
evidence of a comparable production app that made that trade, dotbeat's own `research/13` already
proved the Tauri/WKWebView shell is viable pending one narrow, already-gated audio spike, and a
SwiftUI rewrite would throw away both that proven shell work and the entire BeatLab codebase D12
just cleared for reuse. Reasoning for each piece below.

---

## 1. Web-in-webview vs. native-toolkit vs. SwiftUI-native (Mac priority)

**Finding: no sourced production example of a standalone, webview-shelled real-time-audio
creation app choosing to abandon the webview for a native macOS shell — and no sourced production
example of a SwiftUI-native DAW either.** This question genuinely has thin evidence in both
directions; the honest answer is "no one has published the comparison," not "native clearly
wins" or "webview clearly wins." What *is* sourced:

- **The one concrete production data point for native-over-web in real-time audio UI is a plugin,
  not a standalone app, and the comparison isn't against web tech.** WesAudio (professional audio
  hardware/plugin manufacturer) rewrote its DAW *plugin* UIs in Slint (a Rust-native, GPU-backed
  GUI toolkit), moving off VSTGUI (C++, CPU-rendered). Their own stated reasons: "the main
  challenges are ensuring low CPU usage and updating the GUI rapidly" because "DAW plugins run in
  the main thread, where blocking causes audio artifacts," and VSTGUI's CPU-only rendering became
  a real limitation at higher-resolution assets. They explicitly did not evaluate JUCE/iPlug2
  (plugin-specific frameworks) or any web-based option — the comparison was native-CPU-rendered vs
  native-GPU-rendered, not web-vs-native. *(Source: `slint.dev/success/wesaudio-daw`.)* This is
  real evidence that GPU-accelerated native rendering matters for real-time-audio-adjacent UI, but
  it doesn't transfer cleanly to "should a standalone Mac app abandon Tauri" — a plugin has none of
  a standalone app's needs (window chrome, file dialogs, menu bar, packaging, updater), all of
  which `research/13` already found Tauri handles well and which Slint's case study doesn't
  address at all.
- **The macOS-specific webview audio risk `research/13` already flagged is real but narrower than
  it first reads.** WebKit bug #221334 (Web Audio delay/stutter on Safari/WKWebView) is confirmed
  still open, `NEW`/`Blocker`, with its last substantive activity in November 2022 — no 2026
  status update exists. But rereading the bug for this pass: the most reliable repro path
  specifically requires `getUserMedia()` microphone capture combined with Bluetooth (AirPods)
  output, not bare Web Audio synth/sample playback. dotbeat's v1 scope (per `docs/phase-12-
  plan.md` Stream 1) has no microphone input at all. This doesn't retire the risk — `research/13`'s
  mitigation (a WKWebView playback spike before committing macOS timeline, already scoped as D1
  Stream F) is still the right move — but it's a materially narrower risk than "any Web Audio
  playback may glitch on Mac," and shouldn't independently justify abandoning the webview.
- **Tauri's own documented gap — no shared memory / no built-in real-time audio IPC between the
  Rust core and the webview — turns out not to apply to dotbeat's architecture.** That gap matters
  for apps that want to *stream PCM from Rust into the browser audio graph*. dotbeat's audio has
  never worked that way: Tone.js/Web Audio runs entirely inside the webview's JS context (this is
  exactly what BeatLab's `engine.ts` already does, and exactly what `research/13-tauri-shell.md`
  already scoped — "the audio backend swappable behind `engine/`," daemon-as-sidecar, not
  audio-through-Rust). So this is a real Tauri limitation, correctly documented, but not one that
  bears on dotbeat's specific design.
- **No evidence found of a shipped, real-time-audio-production Tauri app** (as opposed to a music
  *player*, e.g. Musicat, which has no low-latency real-time requirement) — this matches
  `research/13`'s own "no verified list of shipped audio apps on Tauri" finding; still true a
  research pass later. Absence of counter-evidence either way, not evidence against Tauri
  specifically.
- **Rust-native GUI toolkits adjacent to Tauri (egui, Iced, Slint, Dioxus-desktop) exist and are
  real**, but adopting one for dotbeat's main window would forfeit the entire premise of this
  question's D12 correction: none of BeatLab's React/TypeScript UI code is reusable in any of
  them. Slint is the one with a genuine real-time-audio production precedent (above); egui/Iced
  skew toward tools/games/prototypes, not evidenced in shipped audio-production apps. If dotbeat
  ever ships a VST/AU *plugin* form factor — a different problem, a different host-embedding
  constraint, no filesystem/dialog/packaging needs — Slint would be worth a dedicated look then.
  It is not a fit for the main desktop app today.

**Conclusion for Q1:** the SwiftUI-native trade (lose cross-platform reach, lose the sidecar/fs/
packaging work `research/13` already did, lose the entire BeatLab codebase D12 just cleared for
reuse) has no sourced technical payoff to justify it — the only real evidence found (WesAudio/
Slint) is a plugin-UI decision under different constraints, and the one specific webview audio
risk is real but narrower than previously stated and already gated behind a spike. Stay in Tauri's
webview.

---

## 2. Real-time-audio-UI performance patterns — read from three real codebases

Per this repo's own convention (`docs/opendaw-notes.md`), source was read directly rather than
summarized from blog posts: BeatLab's own `engine.ts`/`store.ts`/components (existing checkout at
`/tmp/dotbeat-scratch/beatlab`), a fresh shallow clone of `andremichelle/opendaw`, and a fresh
shallow clone of `Brotherta/wam-studio` (the actual DAW-for-the-web the WAM-studio ACM paper
describes — the paper itself was unreachable, HTTP 403/anti-bot page on every mirror tried; the
repo is the primary source anyway, per this project's stated preference).

**All three independently arrive at the same split: discrete/coarse state goes through the normal
reactive-UI path; anything continuous bypasses it entirely via a raw render loop.**

### BeatLab (React + Zustand + Tone.js)

- The playhead is **not** updated at 60fps. `src/audio/engine.ts:1120` schedules a Tone.js
  `t.scheduleRepeat((time) => this.tick(time), '16n', 0)` — once per sixteenth note, not per
  frame. Inside `tick()`, `engine.ts:1423-1425`:
  ```
  Tone.getDraw().schedule(() => {
    useStore.setState({ currentStep: step, masterLevel: this.masterMeter?.getValue() as number | undefined })
  }, time)
  ```
  `Tone.getDraw()` is Tone.js's own mechanism for aligning a visual callback to the *audio* clock
  (via a lookahead-compensated `requestAnimationFrame`), not raw rAF. `PianoRoll.tsx:506-507` and
  `StepSequencer.tsx` both subscribe to `currentStep` via Zustand's selector API
  (`useStore((s) => s.currentStep)`) and render a plain absolutely-positioned `<div
  className="playhead">` — ordinary React re-render, gated to only the components that select
  that field. This works fine specifically *because* the update rate is grid-quantized (≤16
  updates/bar), not continuous — the exact discipline this research question is asking about,
  already present in the codebase D12 cleared for reuse.
- The one genuinely continuous-rate view, `Scope.tsx` (master oscilloscope/spectrum), does **not**
  go through Zustand/React render at all. It owns its own `requestAnimationFrame` loop inside a
  `useEffect` (`Scope.tsx:19-85`), reads `engine.getWaveformData()`/`getFftData()` (a Tone.js
  `Analyser` passive tap) directly each frame, and draws straight to a `<canvas>` 2D context. The
  one piece of reactive state it needs (`masterLevel`, for a glow-intensity color) is captured in
  a `useRef` (`levelRef.current = masterLevel`, line 16-17) specifically so reading it inside the
  rAF loop doesn't retrigger the effect or a re-render — "throw state over the wall" via a ref,
  not a subscription.
- `store.ts:1162-1164` even has a maintainer comment stating the design intent explicitly: a
  sandbox-autosave subscription guards on reference-equality "so this is a no-op on every other
  state change (e.g. masterLevel/currentStep tick once per playback step) without doing any real
  work" — i.e., the team already reasoned about the cost of the high-frequency store writes and
  designed the *rest* of the store around not reacting to them unnecessarily.

### openDAW (custom fine-grained reactive DOM, no framework at all)

The most surprising finding of this pass: openDAW's studio app (27 devices, a WASM audio engine,
the most feature-complete of anything read) **uses no component framework** — not React, not
Vue, not Svelte. `packages/app/studio/package.json` has zero framework dependency; the `.tsx`
files compile through openDAW's own `@opendaw/lib-jsx` (`packages/lib/jsx/src/create-element.ts`),
which does direct, imperative DOM-node creation — no virtual DOM, no diffing, no component
re-render concept.

- Fine-grained reactivity is hand-rolled via an `Inject` binding system
  (`packages/lib/jsx/src/inject.ts`): `Inject.value(x)` returns an object whose `.value` setter,
  on change, writes directly to the `Text.nodeValue` of every DOM node it's bound to (a
  `WeakRefSet<Text>` of targets) — one signal, N DOM writes, zero tree diffing. This is
  structurally the same idea as SolidJS's fine-grained signals, independently arrived at.
- All continuous UI (meters, canvas painters, "live stream readers" — 31+ subscribers per their
  own changelog) runs off **one shared, throttled `requestAnimationFrame` driver**, not N separate
  loops: `packages/lib/dom/src/frames.ts`'s `AnimationFrame` namespace is a singleton `add()`/
  `once()` fan-out over a single `requestAnimationFrame`, explicitly throttled to ~60fps
  (`if (timestamp - lastTimestamp < 16.0) return`) — added, per `docs/performance.md`, *because*
  running at a ProMotion Mac's native 120fps was "doubling UI rendering work for all 31+
  subscribers." This is a directly reusable lesson regardless of framework choice: a shared driver
  loop, not one rAF per meter/canvas.
- `PeakMeter.tsx` (`packages/app/studio/src/ui/components/PeakMeter.tsx:131-152`) is the clearest
  worked example: it's handed a live `Float32Array` reference (`peaks`) written to directly by the
  engine, and inside `AnimationFrame.add()` it mutates SVG `<rect>` attributes
  (`bar.height.baseVal.value = ...`) directly on the DOM node it already created once — no
  re-render, no diffing, no allocation per frame, reading the array by reference each tick.
- Not everything is canvas: openDAW uses **SVG** for editable/interactive views (meters, the loop
  region editor uses a `<canvas>` — `LoopAreaEditor.tsx` is the one canvas hit in `ui/timeline`)
  and reserves raw `<canvas>` for genuinely signal-shaped displays (waveshaper curves, neural-amp
  visualizations, tape timeline). SVG DOM nodes remain individually addressable for direct
  mutation *and* get free hit-testing/CSS for interaction — a reasonable split for dotbeat's own
  piano roll/arrangement (interactive, needs per-cell hit-testing) vs. its meters/scope (pure
  signal display, no interaction).

### WAM Studio (`Brotherta/wam-studio`, the DAW behind the ACM paper)

The whole editor/arrangement view is a **PixiJS (WebGL) application**, not DOM at all.
`public/package.json` depends on `pixi.js`, `@pixi/app`, `@pixi/core`, and `pixi-viewport` (pan/
zoom of a large 2D scene graph); `EditorView.ts` extends `PIXI.Application` and owns
`WaveformView`, `PlayheadView`, `GridView`, `LoopView` as Pixi display objects
(`public/src/Views/Editor/EditorView.ts:1-14`, `PlayheadView.ts`). Bootstrap/jQuery handle
ordinary chrome (menus, dialogs); the entire timeline — where waveforms, the playhead, and the
loop region actually get drawn and scrubbed — is WebGL, driven by `pixi.js`'s own ticker and raw
`requestAnimationFrame` calls (`EditorView.ts:248,302,321`), never a component tree. `VuMeterElement.ts`
is the simplest case: a bare `<canvas>` 2D context with `clearRect`/`fillRect` per `update(value)`
call, no framework involvement whatsoever.

**Why this matters for the WebGL-vs-canvas-2D question specifically**: WAM Studio reaches for
WebGL not because a single waveform needs it, but because its viewport has to pan/zoom
*many* simultaneous waveforms across a long, scrollable timeline — that's a scene-graph-at-scale
problem, which is what Pixi is for. openDAW, by contrast, uses plain 2D canvas for its
single-signal displays and doesn't reach for WebGL at all for its main timeline (verified: no
WebGL context found anywhere in `packages/app/studio/src/ui/timeline`). **Read as a matched pair,
this says the WebGL/Pixi investment is warranted by multi-track-timeline scale, not by "audio UI"
per se** — a useful de-risking for dotbeat's v1 scope, where the arrangement view starts small.

### What this means for dotbeat's dense/real-time views, concretely

| View | Update rate | Recommended approach | Precedent |
|---|---|---|---|
| Drum step grid, track list, transport controls | User-driven, discrete | React + Zustand, ordinary re-render | BeatLab `StepSequencer.tsx`/`TransportBar.tsx` as-is |
| Playhead in step sequencer / piano roll | Note-grid ticks (≤16/bar) | React + Zustand, **quantized to the grid tick, not a raw clock** | BeatLab `engine.ts` `Tone.getDraw()` pattern — port verbatim |
| Level meters, master scope/spectrum | Continuous, ~60fps | `<canvas>` 2D, own rAF loop, state via ref/mutable array, never through component state | BeatLab `Scope.tsx` (port directly) + openDAW `PeakMeter.tsx` pattern |
| Waveform scrub / zoomed sample view (single clip) | Continuous during drag, static otherwise | `<canvas>` 2D is sufficient at single-clip scale | openDAW's non-WebGL canvas views |
| Full multi-track arrangement/timeline, many waveforms, pan/zoom (later milestone, not v1) | Continuous during scroll/zoom | Revisit WebGL (Pixi or similar) if/when track count and zoomed-out waveform rendering makes canvas 2D redraw the bottleneck — not needed for v1's scope | WAM Studio `EditorView`/`pixi-viewport` |

And the one cross-cutting infrastructure piece worth adopting regardless of framework: **a single
shared, throttled rAF driver that all continuous views subscribe to**, rather than each
meter/scope/waveform owning its own `requestAnimationFrame` call — openDAW's `AnimationFrame`
namespace (`packages/lib/dom/src/frames.ts`) is a ~50-line, directly portable pattern (facts/ideas,
not copyrightable code — openDAW is AGPL/LGPL, so reimplement the ~50 lines rather than copy them,
same rule `docs/opendaw-notes.md` already established).

---

## 3. React vs. lighter alternatives — reweighted for code reuse

Framework-benchmark searches (SolidJS/Svelte vs. React) turned up the expected, already
well-known result: SolidJS's fine-grained-signal model measurably beats React's virtual-DOM
diffing on synthetic re-render-heavy benchmarks (commonly cited "~70% faster" figures), and
openDAW's own from-scratch reactive DOM library is independent, real-world corroboration that a
serious audio-UI team judged React's re-render model not worth adopting even once. That's a real
signal, not a priors-only claim.

**But per the D12 correction, this is no longer a decision made on that abstract benchmark
alone.** The concrete question is: does React's documented weakness (component-tree re-render
under high-frequency updates) actually bite *given how BeatLab already avoids it*, and is that
smaller cost worth paying to keep ~6,200 lines of already-working, MIT-licensed engine and
component code (`wc -l` across `engine.ts` + `components/` + `state/` in the BeatLab checkout)?

The answer, based on §2's finding: **no, it doesn't bite, because BeatLab already keeps
React/Zustand state at note-grid granularity and routes every continuous-rate value through a ref
+ raw canvas loop instead.** The "React re-render fighting the audio thread" failure mode this
research question was worried about is a failure mode BeatLab's own architecture already avoids —
not because BeatLab optimized for it deliberately at the top level, but because Tone.js's own
`Draw`/`scheduleRepeat` primitives naturally produce grid-quantized events, and `Scope.tsx`
already demonstrates the canvas-escape-hatch pattern for the one place that needed continuous
updates. Porting that pattern forward (and applying the same discipline to any *new* continuous
view — meters, a waveform view BeatLab doesn't currently have) costs nothing extra; it's already
the shape of the code being ported.

Switching to Solid/Svelte/vanilla-signals now would mean: rewriting `engine.ts` in a different
component paradigm (probably not necessary — the engine has no framework dependency, it's pure
Tone.js, so it would likely need no changes for a framework swap), but throwing away every
component (`Knob.tsx`, `StepSequencer.tsx`, `TransportBar.tsx`, `DevicePanel.tsx` — 1185 lines,
`PianoRoll.tsx` — 525 lines) and rewriting them from scratch in a new paradigm, for a performance
gain that only matters in exactly the place (continuous 60fps views) where BeatLab's code already
opts out of the framework entirely. That trade doesn't clear the bar D12 sets.

**Conclusion for Q3: stay on React 18 + Zustand** (BeatLab's actual stack —
`react@^18.3.1`/`zustand@^5.0.2`, `/tmp/dotbeat-scratch/beatlab/package.json`), porting components
directly. Enforce, as a written rule for Stream 1 and beyond (not just a suggestion): **any view
that needs to update faster than the musical grid (i.e., truly per-frame, not per-16th-note) must
render outside React's tree** — canvas/SVG + a shared rAF driver + ref-based state handoff, per
§2's table. This gets React's ergonomics and the reuse win where they're cheap, and both openDAW's
and WAM Studio's actual practice where React would genuinely be expensive.

---

## 4. What to port from BeatLab, concretely — code, not just patterns

Per the D12 correction, the bar is "port and adapt" wherever it fits, not "learn from and
reimplement." Read `/tmp/dotbeat-scratch/beatlab` fresh (clean working tree, `origin/
fix/clip-automation-units-and-timeline`, HEAD `ba29bee`) for this pass rather than relying on
prior-session notes.

### Port directly (adapt to dotbeat's document shape; strip curriculum coupling where present)

- **`src/audio/engine.ts`** (1,513 lines) — drum-voice synthesis, sidechain, filter envelopes,
  automation, the master bus/limiter/analyser chain. This is the biggest, highest-value port;
  `docs/decisions.md` D12 already names it explicitly, including that it carries Phase 10 Stream
  D's clip-automation fixes. No curriculum coupling found in this file (it's pure audio DSP glue,
  reads `Track`/`SynthParams` types, doesn't know about lessons).
- **`src/components/Knob.tsx`** (111 lines) — SVG arc knob with pointer-capture drag-to-value,
  log/linear scaling (`toNorm`/`fromNorm`), all clean, portable geometry. **Strip**: the `status?:
  ParamStatus` prop and its `STATUS_COLOR` map (lines 12, 18-22, 80, 105) — ear-training
  grading-feedback coloring, imported from `../lessons/framework`, has no meaning in dotbeat.
- **`src/components/StepSequencer.tsx`** (79 lines) — the click-to-cycle soft/med/hard/off
  velocity model, per-lane click-to-preview (`engine.previewDrum`), copy/paste/clear. **Strip**:
  the `mode === 'sandbox'` clip-strip branch (lines 30-41) is gated on BeatLab's three-way
  `mode` state; dotbeat's clips/scenes are already first-class in the document (D4 song view), so
  this should be generalized/always-on rather than ported as a conditional branch.
- **`src/components/Scope.tsx`** (103 lines) — port as-is; it's the concrete worked example for
  §2's canvas-escape-hatch rule. No curriculum coupling.
- **`src/components/TransportBar.tsx`** (211 lines) — bar/beat math from `currentStep`
  (`Math.floor(currentStep / 16) + 1`), undo/redo, quantize-strength control, MIDI-connect button.
  **Strip**: `currentLessonId`/`loadLesson` (line 24-25), `goToTrackLab` (line 23) — lesson/mode
  navigation has no dotbeat equivalent.
- **The `Tone.getDraw().schedule(...) → useStore.setState({currentStep, masterLevel})` pattern**
  in `engine.ts` (§2 above) — port the pattern (it's a few lines), not the surrounding
  1,186-line `store.ts` wholesale, which is heavily saturated with `mode: 'lesson' | 'sandbox' |
  'tracklab'` branching not relevant to dotbeat.
- **`src/state/dawBridge.ts`** (174 lines) — this is BeatLab's own dev-mode precursor to exactly
  what Stream 1 is asked to build: SSE-driven hot reload from the daemon (`file → GUI`) and a
  debounced POST-on-change back out (`GUI → file`), with an explicit design note (lines 11-16)
  that all reconciliation logic lives in one `applyDawState` action shared with headless use —
  the same "typed boundary, not shared objects" lesson `docs/opendaw-notes.md` already flagged.
  Worth reading in full before Stream 1 designs its own daemon-bridge module; the `POST /state`
  question the Stream 1 brief raises (whole-document push vs. finer-grained edit primitives) is
  exactly the tradeoff this file already made one way, with reasoning in the comments to reuse or
  revisit.
- **`ArrangementView.tsx`'s "energy mode" (tracks × sections matrix)** — lines 70-119, the
  toggle-which-tracks-play-in-which-section grid — is a generic song-arrangement pattern (closer
  to Ableton's Session View energy-curve idea than to teaching), not curriculum-specific. Distinct
  from the same file's "structure mode" (lines 20-68, `SECTION_COLORS`/`SECTION_BLURBS`,
  `arrangement.mode === 'structure'`), which exists to feed the Track Lab labeling *exercise* —
  don't port that half.
- **`DevicePanel.tsx`'s declarative-metadata-table pattern** (`WAVES`, `FILTER_TYPES`,
  `LFO_DESTS` arrays of `{type, label, hint}` driving generic control rendering, formatter
  functions like `hz`/`ms`/`pct`/`db`) — the *pattern* of parameter metadata as data feeding a
  generic renderer, not per-control hardcoded JSX, echoes openDAW's schema-driven knob metadata
  (`docs/opendaw-notes.md` §1) and is worth carrying forward even though the 1,185-line file
  itself is deep BeatLab-synth-specific and needs re-deriving against dotbeat's own
  `SYNTH_FIELDS` (`src/core/document.ts`), not ported wholesale. **Strip**: the `ParamStatus`
  import (line 8) and any grading-feedback color logic threaded through knob rendering.

### Do not carry over — curriculum-coupled, no dotbeat equivalent

- **`src/lessons/*`** (curriculum.ts, framework.ts, deconstruction.ts, genres.ts, rhythm.ts,
  serum.ts, sound.ts, theory.ts, arrangement.ts) — the entire curriculum/lesson-content system.
- **`src/components/LessonPanel.tsx`, `LessonSidebar.tsx`** — curriculum chrome (module/lesson
  tree, completion tracking, `MODULES`/`LESSONS` from `lessons/curriculum`).
- **`src/components/TrackLab.tsx`** (310 lines) — not what its name suggests; it's a "load a
  reference song, run local structure analysis, do the producer's-deconstruction labeling
  exercise" teaching feature (streams named CC-licensed tracks from the Internet Archive,
  imports `gradeStructureMap` from `lessons/deconstruction`). Entirely teaching-specific.
- **The `mode: 'lesson' | 'sandbox' | 'tracklab'` tri-state threaded through `store.ts`** — don't
  port this branching structure and disable two of three branches; take only the logic that lives
  under the `sandbox` branches (closest analog to dotbeat's always-on real-file editing) and drop
  the conditionals rather than carrying dead branches forward.
- **`src/state/sandboxPersistence.ts`** (localStorage autosave/debounce) — dotbeat's persistence
  is the `.beat` file plus the daemon (`GET /events`, `POST /state`), not browser localStorage;
  no equivalent need.
- **`status?: ParamStatus` / ear-training color feedback** wherever it appears (`Knob.tsx`,
  `DevicePanel.tsx`) — grading-specific, strip at every call site.

---

## Recommendation for Stream 1 (explicit, so a different engineer can start from this)

1. **Stack**: React 18 + Zustand, same as BeatLab (`react@^18`, `zustand@^5`), inside Tauri's
   webview. Do not evaluate Svelte/Solid/vanilla-signals or a native-Rust-GUI toolkit further —
   §1 and §3 both close that question for the current app; revisit only if dotbeat ever ships a
   VST/AU plugin form factor (different constraints entirely, Slint would be the first thing to
   look at then, per §1).
2. **Rendering rule, enforced from the first commit**: any UI element whose visual state changes
   faster than the musical grid (meters, scope, waveform scrub, smooth playhead motion once the
   arrangement view exists) renders on `<canvas>` via its own render loop fed by refs/mutable
   buffers — never via Zustand state read every frame. Anything that updates at note-grid
   granularity or on discrete user action (steps, selection, transport, knob values at rest)
   stays on React + Zustand, exactly as BeatLab already does. Build the shared, throttled
   animation-frame driver (§2's openDAW citation) as shared infrastructure before the second
   canvas view needs its own rAF loop, not after.
3. **Port, don't rewrite**: start Stream 1 by copying and adapting the "port directly" list in §4
   above (`engine.ts`, `Knob.tsx`, `StepSequencer.tsx`, `Scope.tsx`, `TransportBar.tsx`, the
   `dawBridge.ts` daemon-sync pattern, the energy-mode arrangement grid) into the new `ui/`
   directory, adapted to dotbeat's own document shape (`src/core/document.ts`) rather than
   BeatLab's `Track`/`types.ts`. Do not copy `src/lessons/*`, `LessonPanel.tsx`,
   `LessonSidebar.tsx`, `TrackLab.tsx`, `sandboxPersistence.ts`, or any `mode==='lesson'`/
   `ParamStatus` branch — strip these at the point of porting, don't carry them forward disabled.
4. **Native macOS shell: no.** Ship inside Tauri's WKWebView for all platforms, keep
   `research/13`'s D1 WKWebView audio-playback spike as the one thing that must be checked before
   the macOS build is trusted (its risk is real but narrower than previously stated — no
   microphone input in v1 means the specific WebKit #221334 repro path doesn't apply, though the
   bug itself remains unresolved and unmonitored since 2022). If that spike fails badly, the
   documented fallback is still what `research/13` already named (native engine sooner, or an
   Electron macOS build) — not a SwiftUI rewrite, which has no sourced precedent either way.

## Open / unresolved questions (honest gaps)

- **No fresh (2026) data point on WebKit bug #221334's real-world impact.** Neither this pass nor
  `research/13`'s found one; the D1 spike is the only way to get a current answer, and it should
  happen before macOS ships, not be inferred from a stale 2022 bug thread.
- **No sourced evidence either way on SwiftUI-native for a production DAW-adjacent app** — genuine
  absence of evidence, not evidence of absence. If the owner wants this de-risked further, the
  next step would be a short build-and-measure spike (a SwiftUI window driving Tone.js via a JS
  bridge vs. the same content in Tauri/WKWebView, compared on cold-start and interaction latency),
  not more search — this question doesn't have public writeups to find.
- **The WebGL/Pixi question for dotbeat's arrangement view is deferred, not answered**, per §2's
  table — right call for v1 scope, but should be revisited once the arrangement view needs to
  render many tracks' worth of zoomed waveforms simultaneously; WAM Studio's `pixi-viewport`
  usage is the concrete reference to return to then.
- **The WAM-Studio ACM paper itself (`dl.acm.org/doi/10.1145/3543873.3587987`) was unreachable**
  (403/anti-bot on every mirror tried, including the CNRS HAL copy). All WAM Studio findings above
  come from reading `Brotherta/wam-studio`'s actual source, which is the primary implementation
  anyway — but the paper might contain author-stated performance rationale (numbers, not just
  code shape) that source-reading alone can't surface. Not blocking; flagged for completeness.

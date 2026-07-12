# Research 69 — Master synthesis: Ableton Live 12 vs. dotbeat, 19 chapters consolidated

*2026-07-12. Synthesizes `docs/research/50-*` through `docs/research/68-*` (19 chapter-by-chapter
Ableton-vs-dotbeat comparisons, each with its own §1a/1b/1c + §2 prioritized table) into one backlog.
This is not a concatenation — items independently raised by multiple chapters are merged into one
row citing every source; priorities are re-sorted against the whole picture, not copied from
individual docs; and every row keeps a concrete dotbeat build recommendation (real files/modules),
not just a feature name. Cross-checked against `docs/product-roadmap.md` (92 features tracked, 64
done) and `ROADMAP.md` so nothing here re-opens a shipped feature or a settled decision.*

**How to use this doc**: read the two bugs below first — they're correctness regressions in shipped
code, not feature gaps, and rank above everything else. Then P0 (the actual next-phase shortlist),
then P1/P2 as a queue, then the Do-not-recreate register so nobody re-proposes those. Skip straight
to "What this doesn't cover" if you just want confirmation that Session View, launch-grid mechanics,
etc. are correctly ruled out.

---

## 0. Two correctness bugs — fix before any feature work below

These were found *during* this research effort, not proposed by it. Both are silent, both mean the
`.beat` file and what you hear have already diverged — a trust-breaking category for a project whose
premise is "the file is what you hear."

### Bug 1 — Reverb/delay sends are wired pre-fader, not post-fader

**Found in**: `docs/research/61-ableton-vs-dotbeat-mixing.md` (prompted by the owner's own report that
loud mixes "sound like blowing out the audio... coming in weirdly").

**Verified this pass** directly against `ui/src/audio/engine.ts`. In `buildSynthChain()`
(~lines 2216–2224):

```
panner.chain(vol, this.getMaster())
vol.connect(levelTap)
panner.connect(reverbSend)   // ← taps off panner, upstream of vol (the fader)
reverbSend.connect(reverb)
panner.connect(delaySend)    // ← same
delaySend.connect(delay)
```

and identically in `getDrumBus()` (~lines 1834–1842). Both `reverbSend`/`delaySend` tap the signal
**before** the track's own volume fader (`vol`), not after. Concretely: dragging a track's fader
down attenuates only the dry signal — the wet reverb/delay signal reaching the shared buses stays
exactly as loud as `sendReverb`/`sendDelay` say, completely unresponsive to the fader. Ableton's
documented default is the opposite: a return track's Pre/Post toggle defaults to **Post** — tapped
*after* pan/volume/track-active — with Pre named explicitly as the special case for an independent
monitor mix [manual p.387, cited in research 61]. Any dotbeat track using reverb/delay sends has had
its wet contribution to the master bus completely unresponsive to its own fader the whole time —
independently plausible as a second contributor to the "blowing out" symptom research 61 was
originally commissioned to investigate, on top of the headroom fix `docs/volume-fader-bugfix.md`
already shipped.

**Fix**: move both `reverbSend`/`delaySend` taps downstream of `vol` (but keep them downstream of
`muteGain` too, in both `buildSynthChain()` and `getDrumBus()`, so mute still silences the sends).
No format/UI change — `sendReverb`/`sendDelay` keep their current meaning, just correctly scaled by
the fader. Verify with the same measured-audio method `docs/volume-fader-bugfix.md` used: a track
with `sendReverb > 0` faded from +6dB to -60dB should show the wet signal's measured level tracking
the fader, not staying constant. If pre-fader turns out to have been deliberate (e.g. so riding a
fader doesn't yank a reverb tail out from under an already-triggered note), that must become a
written line in `docs/decisions.md`, not stay a silent, undocumented divergence from the DAW
convention dotbeat otherwise mirrors closely (fader range, floor behavior, headroom trim).

### Bug 2 — Clip automation and LFO modulation clobber each other on every shared parameter except `cutoff`

**Found independently by two docs**: `docs/research/47-ableton-clip-envelopes.md` (the primer, §6.1)
and re-confirmed independently by `docs/research/66-ableton-vs-dotbeat-clip-envelopes.md` (§3, an
independent re-read of the live code, not assumed from 47).

**Verified this pass** directly against `ui/src/audio/engine.ts` (~lines 3296–3387). Every tick,
the scheduler runs two passes over the same track's automatable parameters:

1. **`cutoff` (hand-written, correct)** — clip automation sets `baseCutoff` first; either LFO then
   multiplies *around* that base (`baseCutoff * Math.pow(2, p.lfoDepth * lfo)`); only if neither LFO
   targets cutoff does the plain automated value get written. This is the correct absolute-base/
   relative-offset composition rule — exactly what Ableton's manual describes as automation and
   modulation "working together in harmony" [manual p.498].
2. **Every other shared destination** (`resonance`, `pan`, `sendReverb`, `sendDelay`, `eqLow/Mid/
   High`, `compMix`, `distortionMix`, `bitcrushMix`) — a generic automation loop writes the
   interpolated value first (~line 3320), then `applyLfoAdditive()` (defined ~line 3362, called
   ~lines 3386–3387, i.e. **strictly later in the same tick**) computes `p.<key> + depth*lfo` —
   relative to the **static field value**, not to whatever automation just wrote. Because both call
   `linearRampToValueAtTime` on the identical `AudioParam` and the LFO write runs last, **the LFO
   silently wins**: on any tick where a clip-automation lane and an LFO target the same non-cutoff
   parameter, the drawn automation curve is discarded for that tick even though it's correctly
   stored in the `.beat` file.
3. **`volume` is a third, different case** — the LFO-amp branch runs *before* the generic automation
   loop, so for `volume` specifically automation wins over the LFO (the opposite bug from #2, though
   not silent data loss).

None of the three behaviors is documented or intentional — it falls out of code order, not design.

**Fix** (already scoped by research 47, one function, no format change): generalize
`applyLfoAdditive()` from `p.<key> + depth*lfo` to `(automated value if present, else p.<key>) +
depth*lfo` for every shared destination — the same pattern `baseCutoff` already proves works.
Add a regression check (style of `ui/verify-phase20-automation.mjs`) asserting a clip with both an
automation lane and an LFO on the same non-cutoff destination renders a value that *oscillates
around* the automated curve, not one that flatlines to the LFO's static-value-relative output.

---

## 1. P0 — the next-phase shortlist

Deliberately short. Many individual chapters called out 25+ items as "P0" in isolation; this list
keeps only the items that are (a) independently raised by more than one chapter, (b) already named
as a live gap in `docs/product-roadmap.md`/`ROADMAP.md` itself, or (c) cheap-and-complete (backend
exists, only the surface is missing) with clear everyday-use value. Everything else that individual
docs rated P0 has been re-sorted into P1 below, not dropped.

| # | Feature | Source docs | Build recommendation |
|---|---|---|---|
| 1 | **In-session multi-level undo/redo** — `Ctrl+Z` currently does nothing anywhere in the GUI | 52 (P0), referenced as a live blocker by 57, 58, 65 | Fully designed already: `docs/research/28-undo-redo-vs-checkpoint-history.md` — a session-only full-document-snapshot stack in the daemon, coalesced by user gesture (drag-end), kept deliberately separate from git checkpoint/history. Reuse the History panel's flat-list-with-jump-to-point UI for the new ephemeral stack rather than inventing a second interaction model. Already the row being actively sequenced per recent commit history (`scripts/roadmap-data.mjs`'s undo/redo row wiring). |
| 2 | **Instrument-track + drum-bus reorderable FX chain parity** — `BeatTrack.effects` is synth-tracks-only; instrument tracks stop at level/pan, drum tracks get a fixed insert order outside the reorderable list | 50 (P0), 64 (P1, generalizes the same constraint to drum tracks) | `reconcileEffectChain`/`buildEffectRuntime`/`EFFECT_TYPES` (`ui/src/audio/engine.ts`) are already fully generic — the type-level restriction in `src/core/document.ts` (`effects` field, ~lines 708-712) is the only thing narrowing it. Widen to instrument and drum tracks in one pass rather than fixing instrument tracks alone and leaving drum tracks asymmetric with no principled reason. Render via `InstrumentPanel.tsx` reusing `SynthPanel.tsx`'s `EffectChain` UI. |
| 3 | **Macro Controls (macro tooling layer)** | 63 and 64 *independently* call this "the single biggest scoped-but-unbuilt gap" surfaced by their whole comparison | Fully designed, zero more research needed: `docs/research/27-macro-tooling-layer.md` — `src/core/macro.ts` (`BeatMacro`/`MacroTarget`/`resolveMacro`/`applyMacro`, mirrors `src/core/preset.ts`), `presets/macros.json` (8-macro starter set), `GET /library` gains a `macros` array + `POST /library/apply-macro`, CLI `beat macro list/apply` + MCP tools, a Macros row in `SynthPanel.tsx`. Resolves to literal edits, no in-file indirection (D9). |
| 4 | **Level metering: per-effect chain-row meter + peak segment on the mixer's `TrackMeter`** | 61 (P0, mixer peak metering) and 63 (P0, per-device level meters) — same underlying need, two chapters | Add a peak segment (short-window max, e.g. last 100-300ms) alongside the existing RMS bar in `MixerView.tsx`'s `TrackMeter` (~lines 93-123), plus a sticky "went over 0dB" reset marker. Extend the same tap pattern to a per-effect level indicator on each `EffectRow` (`SynthPanel.tsx`, ~lines 94-163), keyed by `BeatEffect.id` off whatever node `reconcileEffectChain` spliced in. This is the direct fix for two independently-reported symptoms: "not clear if effects are doing anything" and a headroom bug that was invisible on an RMS-only meter. |
| 5 | **GUI Quantize** — a complete, tested backend (`quantizeNotes`, `src/core/edit.ts:390-466`) with zero GUI affordance anywhere in the piano roll | 57 (P0 — "single cheapest, highest-value item in this whole doc") | Add a Quantize control group to `PitchTimePanel` (`NoteView.tsx:1105-1223`): grid-size dropdown, amount slider (0-100%), starts/ends checkboxes, wired through the existing `POST /pitch-time` route. No new core primitive, no format change. |
| 6 | **Copy/duplicate notes (+ basic clipboard)** — no duplicate-in-place or clipboard concept anywhere in `src/core/edit.ts` | 57 (P0) | New `copyNotes`/`duplicateNotes` in `src/core/edit.ts` (thin wrapper on `addNote`, fresh ids, `start` offset). In `NoteView.tsx`, Alt/Cmd-held-at-drag-start commits via the duplicate primitive instead of `commitMove`; a plain `Cmd/Ctrl+C`/`+V` clipboard reuses the same primitive. |
| 7 | **Real wavetable oscillator** — `wtPos`/`wtTable` are live fields an LFO can even target, but `OscType` is sine/tri/saw/square only; `wtPos` is a dead knob | 68 (P0) — also independently named a v1-tier item in `ROADMAP.md` §9 and flagged in `docs/product-roadmap.md`'s Synth sound design row | A small table-per-category library matching the existing 4-value `wtTable` enum, linear-interpolated scan across `wtPos`, as a `PolySynth`-compatible custom oscillator (or an `AudioWorkletProcessor` if per-frame `PeriodicWave` regen proves too costly for live scanning). Land as a new `OscType` value so it inherits existing envelope/unison/LFO plumbing for free, rather than a parallel oscillator bank. |
| 8 | **Curved automation segments + exact numeric breakpoint entry (ship together)** | 65 (both P0, explicitly recommends shipping together since both touch the same component); also flagged by 50, 55, 66 | Add `interpolation?: 'linear' \| 'hold' \| 'curve'` to `BeatAutomationPoint` (`src/core/document.ts:442-446`), default `'linear'`, elided (D9 discipline) — closes the existing `docs/product-roadmap.md` "Curved segments" row. Alt/Option-drag on a segment in `AutomationLane` (`ArrangementView.tsx:900-1030`) bows it (quadratic bezier toward the drag point is a reasonable first cut); `'hold'` needs only a per-point toggle. Alongside it: a right-click numeric `<input>` on a breakpoint, and render the live drag value (`ArrangementView.tsx:1029` already computes `drag.value`, it's just never shown) — both essentially free given the data already exists. This is also the prerequisite every other curve-shaping automation feature (predefined shapes, stretch/skew, ADSR insertion) in P1/P2 below depends on. |
| 9 | **Insert Scene + Capture-and-Insert Scene** — appended song sections share one scene; editing one edits all of them; no way to snapshot live content into a *new* independent scene except once, internally, at loop→song conversion | 54 (both P0, explicitly bundled as one stream) | Directly closes an already-named `docs/product-roadmap.md` row ("Independent per-section scene editing," Not started). New `BeatScene` splice primitive (empty slots) for Insert Scene; generalize the existing internal `sceneFromLiveContent` (`src/daemon/daemon.ts:200`) into a repeatable, user-triggered action for Capture-and-Insert. Both building blocks already exist — this is wiring, not new capability. |
| 10 | **Drum-sampler voice type** — a real sample-backed drum lane (AHD envelope + one filter + a few playback effects), distinct from today's all-procedural-synth drum lanes | 68 (P0) — independently named in `docs/decisions.md`'s sound-quality Tier 2 strategy as "the biggest single 'video game music' tell left" | Add a `sample`-backed lane envelope/filter/playback-effect param set riding the existing `setLaneParam` primitive the v0.10 open lane model already uses for synth-backed lanes (`docs/product-roadmap.md`'s "Open per-track lane model" row). Scope to Drum Sampler's leaner surface (Start/Length/Gain, one AHD-ish envelope, one filter, a short playback-effect list), explicitly not Ableton's full multisampling Sampler stack. |
| 11 | **Per-parameter velocity/key modulation, generalized** — today exactly two hardcoded single-destination knobs (`velToFilterAmount`, `keytrackAmount`, both cutoff-only) | 68 (P0) | Extend the existing "flat enum of named destinations + one amount slider" pattern already proven twice for `LFO_DESTS` (`synthParams.ts:82-98,172-190`) to a `velDest`/`velAmount` and `keyDest`/`keyAmount` pair reusing the same destination list. Lands in the same per-note dispatch block that already computes `keytrackMult`/`velMult` (`engine.ts:~3049-3055`), generalized to a destination switch. |

---

## 2. P1 — priority, queued behind P0

Grouped by theme. Each row merges duplicate mentions across chapters where they occurred.

### Undo, versioning, files
| Feature | Source docs | Build note |
|---|---|---|
| Musical-language git-merge conflict narration (`beat merge --explain`) | 52 | Reuses D8's `DiffEntry` machinery unchanged, per the already-named `docs/product-roadmap.md` row. |
| Locating missing/moved media files + repair (`beat relink`) | 52 (demoted from doc's own P0) | Today a missing file is a silent 404 with no repair path. `beat relink [--search <dir>]`: sha256-match candidates against any 404'ing `BeatMediaSample` — unambiguous by construction, unlike Ableton's "several candidates, pick one." Pairs with the GC row below. |
| Finding unused media / reference-counted GC (`beat gc`) | 52 (demoted from P0) | Already a named, unstarted roadmap row ("Reference-counted git-lfs asset GC," research 23) — diff `media/` against the document's own media block. |
| `beat render --stems` (per-track solo-render loop) | 52 (demoted from P0) | Already floated in `ROADMAP.md` §5 as near-term but unbuilt (`cli/render.mjs` only takes `-o/--tail/--daemon-port/--preview-port`). Also directly feeds the D2 metrics/lint loop with per-stem signal. |
| MIDI file import/export (`.mid`) | 52 | `beat import-midi`/`beat export-midi`, bakes SMF into literal note lines per D1 (severs the source reference on import, matching Ableton's own precedent). |
| Live Clip export (clip + its track's full instrument/FX chain, as one portable asset) | 52 | `beat clip export`/`beat clip import` — near-free given `.beat` is already stable-ID text (D6). |
| Merging Sets / lift one track or clip from another project's file (`beat import-track`) | 52 | A well-defined text operation given both files share one grammar and stable slugs — more precise than Ableton's drag-target ambiguity. |
| File Reference List UI ("which tracks/clips use this media") | 52 | `beat media list` + `GET /media-refs` + a Media panel in `ContentBrowser.tsx`; pairs with the relink row above. |

### Note editing & MIDI tools
| Feature | Source docs | Build note |
|---|---|---|
| Scale Mode: persistent per-clip root+scale, Highlight/Fold-to-Scale, propagating into Pitch & Time ops | 50, 55, 57, 58 (dependency note in 4 chapters) | Already a named `docs/product-roadmap.md` row. Add `scale?: {root, name}` to `BeatClip`/`BeatTrack`, reuse `SCALES`/`nearestScaleTone` already in `src/core/pitchtime.ts:102-134`; shade in-scale rows in `NoteView.tsx`'s `buildPitchAxis`. |
| Generic Fold mode (fold piano roll to pitches in use) | 50, 57 | Cheap — a derived row list filtering `buildPitchAxis`'s full range to pitches with ≥1 note, no format change. Sequence before Fold-to-Scale. |
| Split/Chop/Join for MIDI notes | 57 | New `splitNoteAt`/`chopNotes`/`joinNotes` in `src/core/pitchtime.ts`; Chop reuses the existing `ratchetSlots` spacing math. |
| Clip-level time-structure ops (Crop/Duplicate/Delete/Insert Time, whole-clip shifts) | 53, 57 | Shift every `note.start`/`hit.start` past a cut point by the inserted/removed span; needs a `loopBars`-aware clamp. |
| Velocity Randomize/Ramp toolbar (Deviation can trail as its own field addition) | 57, 55 | Randomize/Ramp are pure functions over selected notes' `velocity`, no format change; Deviation needs a new field + per-pass reroll (same shape as `chance.ts`). |
| Deactivate/mute a note (third state, distinct from delete) | 57 | `active: boolean` on `BeatNote`, default true, elided; bind `0` key, reuse the existing `.chancy` dimmed-render CSS. |
| One-click Humanize inside the Pitch & Time panel | 55 | The primitive (`beat_humanize`) already exists — just needs a button next to Legato/Consolidate. |
| Live "Set Loop Position/Length" capture during audition + loop brace draggable on both edges + keyboard nudge | 55 (demoted from P0) | Read the live `currentStep` during audition, write through the same `postEdit(loop...)` the drag handle uses; render a second handle at the loop's *start* (today only the end is draggable). |
| Two independently-adjustable clip regions: Start/End (playable) vs. Loop (repeating) | 55 | Real format decision: a second `play: {start,end} | null` range on `BeatClip`, defaulting to the loop range when absent. |
| Clip rename (distinct from id) | 55 | One-line format add, `BeatClip.name?: string`, elided. |
| Consolidate naming collision — the piano-roll's ratchet-baking button is also called "Consolidate," colliding with Ableton's real multi-clip-fold meaning | 53 | Nearly free: rename to "Bake Ratchets" in UI copy before the real Ableton-style Consolidate is ever built. |
| Generative note tools: Euclidean rhythm generator, Seed-style random generator, Recombine-style permutation generator (`varyArrange`) | 58 (doc's own P0 batch — demoted here since it's new subsystem work, not a fix to something broken) | `src/core/generate.ts` (Bjorklund's algorithm for Euclidean; range-based random for Seed) plus a `varyArrange` sibling to rung-2 `varyFeel` in `src/vary/vary.ts` for Recombine — all three plug into the existing `beat vary`/`beat score` CLI/MCP/scoring flow with no GUI required to ship value. |
| Ornament (Flam, Grace Notes), Span articulation modes (Tenuto/Staccato + Offset/Variation) | 58 | Same file/shape as the six shipped Pitch & Time ops in `src/core/pitchtime.ts`. |
| Stacks-style chord/progression generator with diffable JSON chord banks | 58 | `generateStacks` in `src/core/generate.ts`, user-overridable chord bank JSON — Ableton's own Stacks device independently chose the same diffable-text shape [manual pp.310-311]. |
| Velocity Shaper (deterministic drawn-envelope velocity contour, distinct from humanize's randomness) | 58 | New breakpoint-envelope primitive + GUI widget — real, currently-unaddressed crescendo/accent use case. |
| Time Warp (1-3 breakpoint tempo-curve stretch, generalizing the existing ×2/÷2 buttons) | 58 | Generalize `timeScaleNotes`'s single factor to a breakpoint curve. |
| Rhythm generator (richer per-lane step pattern than Euclidean) | 58 | Sequence directly after Euclidean proves the generator pipeline. |
| Group Track slot shading (collapsed-group content summary in the arrangement) | 54 | `arr-group-lane` currently renders empty on collapse — add a filled/colored per-section indicator when any member track has an occurrence there. |
| Scene Tempo / Scene Time Signature overrides | 54 | Optional `tempo?: number` on `BeatSongSection`, absence = inherit `doc.bpm` — the one item in ch.7 that isn't actually a performance-surface artifact. |
| Segment-level splice into a composite (`beat` equivalent of copy-bars-from-take-2-into-take-1) | 62 (that doc's own top pick — "the single highest-leverage move," format-neutral, CLI/MCP-buildable today) | One new edit primitive sized like `splitAudioClip`, reads bars `[a,b)` from source clip X into destination clip Y; CLI/MCP first, no GUI required. |
| Groove extraction from real clips → named, reusable template | 59 | New `extractGroove`/`applyGroove` in `src/core/groove.ts`, same one-shot document→document shape as `humanize()`; stored via `presets/grooves.json` (D9 pattern). |
| Groove Commit — bake a live shuffled shape into literal note/hit positions | 59 | `beat groove bake`, reuses the already-exported, already-tested `warpStep()`; idempotent, resets `shuffleAmount`/`shuffleGrid` to defaults after. |
| Clip offset/nudge/scrub during audition | 60 | Stripped of live-performance framing, this is "jump into the middle of a currently-playing preview" — reuse the exact `engine.seek(bar)` click-to-seek pattern `ArrangementView.tsx` already ships, scoped to the audition's tiled loop range. |

### Mixer & routing
| Feature | Source docs | Build note |
|---|---|---|
| General-purpose Group Track / submix bus (real audio summing + shared FX, not just the visual fold `BeatGroup` already ships) | 61 | Generalize the drum bus's already-proven pattern (shared filter→EQ3→comp→dist→bitcrush→sends→fader) into a per-`BeatGroup` bus. |
| User-editable master-bus EQ/compression | 61 | Currently only a fixed, non-adjustable `Tone.Limiter(-1)`. Sequence as the first slice of the already-planned learned-auto-mix/master-bus-EQ-DRC work (`ROADMAP.md` §7, Diff-MST), scoped down to one always-present EQ3+comp on the master strip. |
| Track reorder by dragging | 53 | New `moveTrack` primitive mirroring `songMove`'s shape; drag handle on `.arr-track-header`. |
| Follow (auto-scroll to playhead during playback) | 53 | `followEnabled` in `ui/src/state/store.ts`; pause on any edit/manual scroll, resume on transport stop/restart. |
| Zoom-to-selection (`Z`/`X`) + zoom-history stack | 53 | Extend the existing `zoomIn`/`zoomOut`/`zoomFit` trio with a small array-backed undo stack. |
| Arrangement-level keyboard shortcuts (spacebar play/stop, `0` deselect, arrow-nudge, split/consolidate) | 53 | New keydown listener scoped to `ArrangementView`, same idiom `NoteView.tsx` already uses. |
| Ordinary clip Cut/Copy/Paste/Duplicate | 53 | New primitives alongside `saveClip`/`setScene`; clipboard lives in daemon/GUI state, not the file. |
| Split generalized to synth/drum clips (today `splitAudioClip` is audio-only) | 53 | New `splitClip` generalizing the existing pattern, including automation-point partitioning. |
| Region-level fade in/out handles + hard constraints (can't cross loop boundary, can't overlap) | 53 | Already a named, unbuilt roadmap row — this doc supplies concrete acceptance criteria from the manual. |

### Effects & devices
| Feature | Source docs | Build note |
|---|---|---|
| Gate | 67 (demoted from P0) — independently the "sharpest single finding" of two research passes (48 then 67) | New `EffectType: 'gate'`, built from `Tone.Follower` driving a `Tone.Gain` via threshold comparison. Self-sidechain-only v1 (real audio-triggered cross-track sidechain is a stretch goal). |
| Plain tempo-synced Delay insert (distinct from the existing Grain/Ping-Pong specialty delays) | 67 (demoted from P0) | `Tone.FeedbackDelay` as a genuine per-track insert (not the shared bus), `delayTime`/`delayFeedback`/`delayFilterFreq`/`delaySync`. |
| Compressor Knee | 67 (demoted from P0, but trivially cheap) | `DynamicsCompressorNode` already exposes `.knee` natively — one field, one wiring line. |
| Real per-track Reverb insert (replacing the single shared hardcoded bus) | 67 | New `EffectType: 'reverb'` using `Tone.Reverb`'s own `decay`/`preDelay` plus a simple input-tilt filter. |
| Device A/B compare | 63 | Best modeled as session-only UI state (same precedent as mute/solo/`BeatGroup.collapsed`), not a `.beat` field — an A/B toggle is a workflow aid, not a compositional fact. |
| Hot-swap-in-place (replace a chain member's type, keep its position) | 63 | `postEffectReplace(trackId, effectId, newType)` — remove+insert at the same index, same "one clean fact" shape as `songMove`. |
| Multiple independently-parameterized instances of the same effect type | 63 | Already a named, documented current-scope-cut in `docs/product-roadmap.md`. Real engineering lift (per-instance knob groups, not per-type) — sequence behind metering (master P0 #4). |
| Bass Mono on the existing Utility insert | 67 | `Tone.Filter` lowpass split + mono-sum below a cutoff, recombined with the already-widened highs. |
| Ring modulation (Shifter's ring-mod mode, as its own standalone effect) | 67 | `Tone.Gain` whose `.gain` is driven by an audio-rate `Tone.Oscillator` — true multiplicative ring mod, no dedicated Tone.js class needed. |

### Instruments & synth engine
| Feature | Source docs | Build note |
|---|---|---|
| Mono/Legato voice mode | 68 | `voiceMode` enum (`poly`/`mono`/`legato`); worth doing properly (real note-tracking suppression of envelope retrigger), not just capping `maxPolyphony`. Named the single most-requested-feeling patch-character gap. |
| Envelope loop modes (Loop/Trigger/Beat/Sync) | 68 | `envLoopMode` enum reusing the existing tempo-sync machinery already built for LFOs — mostly wiring, not new DSP. |
| FM fixed-frequency mode + FM self-feedback | 68 | `fmFixed`/`fmFixedFreq` for inharmonic/metallic FM; a small feedback gain patched into the FM layer's own modulator input. |
| Warp Markers (format + primitives) | 56 (demoted from P0) | Already fully scoped: `docs/research/25-audio-warp-markers-stretch.md` Slice 1 — `marker <id> <sourceTime> <timelineTime>` grammar, `addWarpMarker`/`moveWarpMarker`/etc. Format-only, zero DSP, unblocks everything below it. |
| Complex-mode stretch (the actual DSP) | 56 (demoted from P0) | `docs/research/25-...md` Slice 2 — `signalsmith-stretch` (MIT/WASM), batch-rendered and cached, gated behind `warp:'complex' && markers.length>0`. Sequence directly after Warp Markers. |
| Beats mode (transient slicing + Preserve/Loop Mode) | 56 | `docs/research/26-beats-mode-transient-slicing.md`'s dependency-free energy-based `detectTransients`, reusing the same `markers` list with `source:'auto'`. |
| Tempo/BPM estimation on import (×2/÷2 correction) | 56 | New `detectTempo` core primitive; returns a *suggestion*, never silently overwrites `doc.bpm`. |
| Quantize Audio (snap transients to grid, Amount blend) | 56 | `quantizeWarpMarkers`, directly modeled on the already-shipped `quantizeNotes`. |
| Interactive waveform editing (drag markers, drag-to-trim) | 56 | What makes Warp Markers actually usable day-to-day; a cheap `playbackRate` scalar preview during drag, debounced to an authoritative render on release. |
| Unlinked clip-envelope loop length (an automation lane's own loop period, independent of the clip's tiling) | 47, 66 | `loop: {start,end} | null` on `BeatAutomationLane`, same pattern as `BeatClipLoop`/`BeatTimeSignature`. Unlocks Ableton's two headline moves: long shape over short loop, short gating pattern over long clip. |
| Track/arrangement-scoped automation independent of any single clip (Lock Envelopes equivalent) | 50, 65 | The single biggest structural automation gap named by two chapters — needs its own design pass before building (attach automation at the scene/section slot-mapping level, not the clip object, per research 46's own scoping). Don't build shape-insertion/stretch-skew features against today's clip-only model without revisiting this first. |
| Cross-parameter automation copy/paste | 65 | Copy a lane's points normalized to its own min/max, re-denormalize into the target param's range on paste — deliberately don't gate by type compatibility (matches Ableton's own stance). |
| Automation discovery UI (badge for already-automated params in the picker) | 65 | Small dot/badge on picker `<option>`s with a non-empty lane; the underlying discoverability (already-automated params auto-surface as lanes) already ships. |
| Segment-level selection and drag on automation lanes | 65 | A "click near, not on, a point" hit-test tier selecting the two flanking points as a pair. |

---

## 3. P2 — nice to have

Compressed to one line each; grouped loosely by theme. Full reasoning lives in the cited source doc.

- **Browser/content library**: text search bar with AND-logic (51); Filter View chips over the existing `category` field (51); flat tag field on presets + filter integration (51, explicitly not Ableton's nested tag hierarchy); Collections/favoriting as `localStorage` state, not a format field (51); browser navigation history and saved-search labels, sequenced after search exists (51); User Library (cross-project preset save) as `presets/user/` (51, real gap, arguably underrated — revisit if it starts blocking sound-design workflow); User Folders (arbitrary disk scan) (51); "drag into empty space creates a track" for presets/kits, not just soundfonts (51, cheap — `addTrackOfKind` already exists); Analysis-file cache (waveform peaks, detected tempo) keyed by sha256 (52); Packing a project (`beat pack`/`unpack` as a thin `git bundle`/`git archive` wrapper) (52); "Save as Template" discoverability for a default-template config (52).
- **Arrangement/clip structure**: Overview strip/minimap + wall-clock ruler (53); Locators (lightweight named point markers, not full launch-quantization machinery) (53); Time-signature markers with real engine interpretation + fragmentary-bar reflow (53); Tempo ramps/automation over time (53, reuses the existing automation-lane grammar with `bpm` as a target); arrangement-wide Cut/Paste/Duplicate/Delete "…Time" commands (53); Reverse audio clip (53); Content-slide-within-fixed-boundary waveform drag (53); real Consolidate (multi-clip arrangement-level fold, distinct from the ratchet-baking button) (53); per-track row height/unfold + Optimize Height/Width (53); "Consolidate Time to New Scene" — snapshot a bar range across all tracks into fresh clips, needs a name that isn't already taken (54); Duplicate Loop (doubles a clip's loop length + content) (55); per-clip mute (Clip Activator) and per-clip color override, both gated on multi-clip-per-track landing first (55); Clip Groove pool (named per-clip groove templates, hot-swap, commit-to-envelope) (55, 59); "Set Length"/"Add Interval" ops in Pitch & Time (55); sample details readout (name/rate/bitdepth/channels) (55); non-destructive crop to a new physical file, distinct from `splitAudioClip`'s shared-media split (55); replace-the-sample gesture keeping other clip settings (55); scrub area + Follow-pause-on-edit during audition (55).
- **Automation**: same-row curve overlay instead of a dedicated sub-lane (50); log-scale y-axis for frequency params (50); automation manual-override suspends-not-erases + Re-Enable, parked until live automation recording exists (50); predefined automation shapes (sine/triangle/ADSR insertion), sequenced after curved segments (65); Simplify Envelope (geometric point-count reduction), low urgency until automation recording creates the breakpoint-explosion problem it solves (65); stretch/skew a time-selected automation range, needs a lane-local time-selection concept first (65); Draw Mode paint-a-run gesture, reuse the chance-lane paint pattern rather than porting Ableton's mode toggle (65, 47); Sample Offset ("beat scrambling") envelope, cheap once Beats-mode warping lands (47, 66).
- **Mixer**: multi-select "adjust one, adjust all, preserve offsets" (61); Split Stereo Pan Mode + reset gesture (61); resizable-mixer tick marks/dB scale (61); N user-creatable return tracks with hostable FX, beyond today's 2 fixed buses (50, 61); per-track Track Delay (ms), sequence after real recording latency work exists (61); per-track CPU/performance indicator (61); exclusive-solo-by-default convenience, a genuinely two-line change (61, worth doing even at P2 for the cheapness).
- **Effects**: EQ7 Adaptive Q and Stereo/L-R/M-S modes (67); Auto Filter envelope-follower section alongside its existing LFO (67, shares the `Tone.Follower` primitive Gate introduces); deeper per-track Limiter access (Auto Release, True-Peak), gated on real need (67); per-device fold/collapse presentation (63); expandable inline device sub-views (frequency curve, filter-sweep display), defer behind the general GUI-spectrum-visualization row (63); per-device context menu (rename/duplicate/save-as-default) (63); per-project/new-track default effect chain (63); chain-list/knob-wall single-row UI unification, once meters/A-B make the two-region split more obviously wrong (63).
- **Instruments**: Stereo voice mode (fixed hard-L/R, zero detune) (68); named unison algorithms beyond the current continuous voices/width (68); dual/parallel/split filter routing, bigger than the wavetable oscillator itself (68); multi-operator FM with selectable algorithms, sequence after the wavetable oscillator (68); full multisampling (key/velocity zones, Zone Editor) — the leaner one-shot-sampler roadmap row is the right-sized alternative, don't build Sampler's full stack (68); Round Robin sample playback, cheap once any sample-slot drum voice exists (68); per-voice analog-modeling randomization ("Drift" knob), cheap, seeded for reproducibility (68); MPE support, gated on real MPE-hardware demand and a MIDI-input capture path that doesn't exist yet (68, 58).
- **Racks/drums**: per-lane sends to a shared kit-level return bus, sequenced after per-lane volume/pan lands (64); per-voice mute/solo + auto-highlight the sounding lane (64); extract a drum lane to its own track (`beat extract-lane`) (64); rack/chain-level mixer strip once lanes have gain/pan/mute (64); macro randomization + per-macro exclude flag, sequenced strictly after Macro Controls ship (64).
- **Grooves**: browsable groove library in the content browser, once extraction exists (59); Hot-Swap live groove audition, reusing the existing preview-before-load pattern (59); Global Amount master groove-intensity dial, gated on multiple tracks actually sharing one extracted groove (59); Velocity-invert as a flag on `groove apply` (59).
- **Comping**: take lanes as a dedicated visual UI, a rendering layer on top of segment-splice — don't build before the primitive exists (62); per-take auto-randomized color, bundle with the lane UI (62); auto-crossfade at comp seams, blocked on region fade handles landing first (62).
- **Content**: MIDI Controller clip envelopes, blocked on MIDI import existing at all (47, 66).

---

## 4. Do-not-recreate register

Compact — feature + the one reason it doesn't get rebuilt. Grouped by why, not by chapter, so the
reasoning pattern is visible.

**Structurally excluded — presuppose a Session-View live-launch grid dotbeat doesn't have and won't build** (already-settled scope per `docs/research/18-ableton-ui-architecture.md` and `docs/research/30-ableton-clip-visualization.md`, reconfirmed by 54 and 60):
Session-grid/clip-slot launching itself; Scene/Clip Launch buttons + Stop All Clips; Select-Next-Scene-on-Launch + remote/MIDI/keyboard clip triggering; Follow Actions (all 10 action types); Track Status live-transport icon vocabulary; resizable Session track columns; Session↔Arrangement reconciliation (Arrangement Record, "Back to Arrangement," copy-vs-reference on drag); Second-Window mode; Gate/Repeat/Legato clip launch modes and Clip Launch Quantization (no held-input device, no concurrent clips to sync); Velocity Amount on clip trigger (no MIDI-velocity-sensitive trigger exists).

**Live-performance mechanics with no fit in a document-first, non-real-time tool**:
the DJ-style crossfader (50, 61); Cueing via a second audio-interface output (61); Clip tempo leader/follower, Tap tempo, Phase nudge — all three exist to sync against a live, non-tempo-locked source (56); Chase MIDI Notes (57); Preview-doubling-as-step-record while a track is "armed" (57, 58) — gated behind M4 native recording instead, not a toy version now; Automation Override/Re-Enable — dotbeat's undo/redo + checkpoint/history already covers "try something, revert" at a coarser, arguably more useful grain (65).

**Conflicts with a standing decision (D1/D9/D13)**:
"Save Default Clip" (auto-applied settings cache on sample drop) — conflicts with D9's "presets are tooling, never grammar" (55); Project-scoped preset storage — conflicts with D9 directly (52); Max-for-Live-style user-extensible tool plugin architecture — is a generator-code layer by another name, conflicts with D1 (58); Key/Velocity/Chain-Select Zones (Rack runtime-reactive stored filters) — real in-file indirection with no one-shot literal resolution, the first genuine breach of D1/D4/D7's literal-data thesis (64); Multi-clip property editing — `ClipPropertiesPanel.tsx`'s own comment already documents this as a deliberate v1 cut, revisit only once multi-clip-per-track ships (55); Clip Defaults + configurable Clip Update Rate — a live-quantized-edit concept with no analog in an edit-commits-immediately model (55).

**Ableton's answer to a problem dotbeat's architecture already solves better**:
Current-Project auto-backup (10-save cap) — dotbeat's git-backed checkpoint/history/pin is strictly stronger (51, 52); source highlighting for comp provenance — `git log -p`/`beat diff` on the destination clip is already a strictly more durable provenance record (62); return-track sends disabled-by-default — guards against return-to-return feedback loops that are structurally impossible in dotbeat's 2-fixed-bus model (61); recording-driven auto-take-lane creation — correctly gated on M4 recording existing at all, nothing to build yet (62).

**No hardware/infrastructure to attach to, or explicitly out of scope**:
Dedicated Ableton Push 1/2/3 support (50); MIDI Map Mode / Key Map Mode, gated on Tauri native MIDI I/O (50); External Audio Effect / External Instrument hardware routing (50, 68); Ableton Cloud / Push hardware sync (51); Pack download/install/update marketplace pipeline — conflicts with D13's local-machine-only distribution (51); Splice cloud marketplace + Search-with-Sound — needs hosted infrastructure D1/D13 both rule out; the narrow "local-only similar-sample search within my own presets/media" idea is a real, separate, future research item (51); Vocoder — needs cross-track simultaneous carrier/modulator audio routing dotbeat's per-track insert model doesn't support (67); Amp/Cabinet, Auto Shift, Looper, Tuner — no fit for a synth/drum-centric, non-live-input track model (67); physical-modeling instrument family (Analog/Collision/Electric/Tension) and Meld-style macro-oscillator engine — a different synthesis paradigm entirely, no incremental path from `SYNTH_FIELDS` (68); Roar-tier saturation depth (12 curves + mod matrix) — no forcing use case yet (67); Glissando/LFO MPE Transform tools — need a continuous per-note pitch-bend lane `BeatNote` doesn't have (58); device delay compensation and third-party plugin hosting UI conventions (Configure Mode, floating window sync) — nothing to compensate for or host until WAM2/CLAP lands (63).

**Real gap, but the underlying justification for the *original* Ableton mechanism doesn't transfer**:
Linked-track editing/comping — needs native multi-take recording, correctly gated behind M4 (53); dedicated mixer-only crossfader/per-track-delay controls (53); Waveform Vertical Zoom slider — dotbeat's waveform is deliberately a static min/max-per-pixel image, not an interactively resizable one (53); Group Tracks' Session-only slot-shading nuance beyond the P1 collapsed-summary row (54, covered); Multi-clip editing / Focus Mode in the note editor — needs a Session-grid concept that doesn't exist (57); Sound Similarity Search + Similar Sample Swapping — needs a large pre-analyzed content library dotbeat's 36-100-item catalog doesn't justify yet, revisit if the Tier 2 sample-ingestion plan ships (50); Racks' 128-pad grid UI + drag-to-map — the shipped Lanes panel already delivers the same capability via declaration instead of a grid (64); Macro Control Variations — once macros resolve to literal edits with no stored state, "save as a preset" already gives this for free (64); parallel device chains + recursive Rack nesting — no dotbeat use case for the fan-out/sum graph shape (64); MIDI Effect Racks / MIDI-effect device-ordering rule — dotbeat has no MIDI-effect device family yet for an ordering rule to apply to (64).

---

## 5. What this doesn't cover

So nobody has to re-read all 19 docs to confirm these calls:

- **Session View and every live clip-launching mechanic** (scenes, clip-slot grid, Follow Actions,
  launch quantization, the crossfader, cueing, MIDI/Push hardware control surfaces) — ruled
  structurally out of scope by `docs/research/18-ableton-ui-architecture.md` and
  `docs/research/30-ableton-clip-visualization.md` before this research effort started; docs 54 and
  60 independently re-confirm the ruling holds chapter by chapter rather than reopening it.
- **Native audio recording and everything downstream of it** (Arm/Session/Arrangement Record,
  multi-take auto-lanes, RAM-vs-disk-streaming, monitoring-latency toggles, per-track Track Delay,
  Chase MIDI Notes) — correctly gated behind the confirmed ~30ms web-audio latency wall and the
  M4/Tauri native tier (`docs/m4-native-engine-design.md`). Nothing above proposes pulling this
  forward.
- **Third-party plugin hosting** (VST/AU/WAM2 UI conventions, delay compensation, floating plugin
  windows) — explicit Tauri/M4-tier future work per `ROADMAP.md`; the audio-effect and instrument
  chapters (63, 67, 68) inventory what such hosting would need to support, not a near-term build.
- **Physical-modeling and macro-oscillator synthesis** (Ableton's Analog/Collision/Electric/Tension/
  Meld family) — architecturally a different bet (solved-differential-equation DSP vs. dotbeat's
  Tone.js additive-oscillator engine); no incremental path exists from `SYNTH_FIELDS`.
- **MPE (MIDI Polyphonic Expression)** — needs a continuous per-note pitch-bend/pressure/timbre
  channel model and real MIDI hardware input, neither of which exists; multiple chapters (57, 58,
  68) independently flag MPE-dependent features and independently decline to scope them ahead of
  real MPE-hardware demand.
- **A DAWproject-style external interchange or plugin-preset ecosystem** — out of scope for the same
  reason third-party hosting is; not raised as a gap by any of the 19 chapters.
- **Racks as Ableton implements them** (parallel device-chain fan-out/sum, recursive nesting, a
  128-pad drag-to-map grid UI) — the *capability* (a named voice bound to a trigger, freely backed by
  synth/sample/soundfont) already shipped via the Lanes panel; the specific graph shape and grid UI
  are deliberately not being ported, per research 64's own analysis.
- **A generator-code layer of any kind** (Max-for-Live-style user-authorable tools, a scripting SDK
  for third-party MIDI/audio tools) — would reopen D1's "document-only format for v1" decision;
  every chapter that touched this (58 most directly) declined to propose it.

---

## Sources

`docs/research/50-ableton-vs-dotbeat-live-concepts.md` through
`docs/research/68-ableton-vs-dotbeat-instrument-reference.md` (19 docs, read in full this pass), plus
`docs/research/47-ableton-clip-envelopes.md` (the sibling primer independently confirming Bug 2).
Cross-checked against `docs/product-roadmap.md`, `ROADMAP.md`, and `docs/decisions.md`. Both bugs
verified directly against `ui/src/audio/engine.ts` on `main` this pass (not assumed from the source
docs' own citations).

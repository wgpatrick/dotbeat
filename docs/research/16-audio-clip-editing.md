# Research 16 — Audio-clip editing: scoping M4 against Ableton's actual toolset

*2026-07-11. Stream O of `docs/phase-17-plan.md` — research + format-level scoping only, no engine
or CLI code this round (Stream L owns `ui/src/audio/engine.ts` and the CLI render paths
exclusively this phase). Owner's framing, verbatim: M4 is "the engine that modifies audio
samples... things like velocity; easy ways of cutting/splicing audio clips; also things like time
warp." This pass researches what Ableton Live actually does under each of those words, cross-
references it against `docs/format-spec.md`/`src/core/document.ts` (the real current format) and
`docs/m4-native-engine-design.md`/`docs/research/05-engine-architecture.md` (the already-verified
engine-architecture findings), and — the priority item — tries to close the Rubber Band vs.
signalsmith-stretch WASM-DSP-library question flagged unresolved twice (`ROADMAP.md` §6/§11,
`docs/research/05-engine-architecture.md`'s open questions, `docs/m4-native-engine-design.md`'s
open questions).*

## Verdict

**The Rubber Band vs. signalsmith-stretch question is now closed: use signalsmith-stretch.** It's
MIT-licensed (no conflict with this project's MIT posture, `docs/decisions.md`), ships an official
WASM/AudioWorklet web release today, and is real-time-capable — Rubber Band is GPLv2+/commercial
dual-licensed, which puts it in exactly the same bucket as Surge XT/Vital (`docs/decisions.md`:
"the GPL engine tier ... is CLOSED — no GPL code may be ported in") unless a commercial license is
purchased as a deliberate business decision, not a default technical option.

**Most of what the owner named is buildable in the current web engine, sooner than M4.** Per
`ROADMAP.md` §6's own ceiling table, warping/time-stretch is explicitly *not* one of the hard web
walls (recording latency and third-party plugin hosting are) — it's WASM-DSP-library-shaped, and
that library question is now answered. What's actually blocking any of this today isn't the DSP,
it's that **the format has no concept of an audio-region clip at all** — `BeatClip` carries notes,
drum hits, and automation, never a reference to a span of an audio file. That's the real gap, and
it's format-only work, not engine-tier work. See "The real blocker" below.

**Genuinely M4-native-tier**: recording audio at native latency (nothing to edit without a source,
and the ~30ms web latency wall is already confirmed, `research/02`); sample-accurate multi-take
comping and freeze/flatten/bounce with real disk streaming (the butler-thread architecture
`m4-native-engine-design.md` already scoped); and reference-grade formant-preserving stretch at
extreme ratios if signalsmith-stretch's quality proves insufficient in practice (Rubber Band is the
fallback there, gated behind an explicit commercial-license decision).

---

## 1. Ableton's warp modes — what each one actually does

Ableton's warp algorithm choice is a **pitch-independence and material-type decision**, not a
single "time-stretch" toggle. Five modes, each with a specific job:

- **Complex** — the general-purpose mode: transposes and time-stretches without slicing the
  audio, designed for material that mixes beats, tones, and texture at once (full mixes, complex
  multi-instrument material). Reasonable quality on anything, optimal on nothing specific.
- **Complex Pro** — Complex plus two extra parameters, **Formants** and **Envelope**, aimed at
  vocals and other formant-bearing material: Formants compensates for the pitch-shift-induced
  formant shift that otherwise makes transposed vocals sound artificially chipmunk'd or
  cave-voiced; Envelope adjusts spectral-envelope handling. This is the highest-quality, most
  expensive mode.
- **Repitch** — the simplest possible mode: literally a variable-speed playback (turntable
  model). Speeding up raises pitch, slowing down lowers it — pitch and tempo are **not**
  independent in this mode. This is a resampling operation, not a DSP time-stretch algorithm at
  all; it needs no phase-vocoder or granular library, just a playback-rate parameter.
- **Texture** — built around a **Grain Size** parameter (from Ableton's Tones/Texture DSP family)
  plus a **Flux** parameter controlling grain-position randomization; aimed at pads, ambient
  textures, and non-pitched or non-rhythmic material where transient precision doesn't matter.
- **Beats** — built for drum loops: detects transients, slices the audio at each detected
  transient (functionally similar to Live's "Slice to New MIDI Track"), and stretches by moving
  the slices rather than stretching the waveform continuously. Has its own **Transient Envelope**
  parameter (see §3) controlling the fade shape at each slice boundary.

**What this means for a library choice**: Repitch needs zero DSP library (a `playbackRate`
parameter on an `AudioBufferSourceNode`/Tone.js equivalent). Complex/Complex Pro/Texture are all,
at their core, phase-vocoder-family pitch-independent time-stretch — exactly the problem
Rubber Band and signalsmith-stretch both solve. Beats mode needs transient/onset detection *in
addition to* a stretch algorithm (or in Ableton's case, instead of one — it stretches by
repositioning slices, not by continuously time-stretching each slice).

Sources: [Ableton warp modes overview, Mario Giancini](https://mariogiancini.com/overview-of-ableton-live-warp-modes), [PCAudioLabs: Complex Pro walkthrough](https://pcaudiolabs.com/ableton-live-warping-part-8-how-to-use-complex-pro-warp-mode-in-ableton-live/), [PausePlayRepeat: warp modes explained](https://sounds.pauseplayrepeat.com/blogs/ableton/ableton-s-warp-modes-explained), [Ableton manual: Audio Clips, Tempo, and Warping (v12)](https://www.ableton.com/en/manual/audio-clips-tempo-and-warping/). Cross-checked across four independent sources; consistent on all five modes' core mechanism, so treated as reliable even though these are practitioner/blog sources rather than an adversarially-verified research pass (no deep-research harness run this round — time was prioritized on the Rubber Band/signalsmith gap per the phase-17 brief).

---

## 2. Clip splitting/splicing — the split-at-playhead gesture and its consequences

- **Split**: `Cmd/Ctrl+E` at the playhead position splits one clip into two independent clips at
  that point. This is a pure edit operation on clip boundaries — no new audio is generated,
  both resulting clips still reference the same underlying sample, just with different
  start/end offsets into it.
- **Warp markers survive a split, attached to whichever segment they fall in** — each new clip
  keeps its own warp-marker subset and its own warping stays intact after the cut. This confirms
  warp markers are clip-scoped state, not global per-file state (a clip's timing map is part of
  the clip, not a property of the source media).
- **Consolidate** (merging clips, or baking warp into a fixed file) renders a *new* audio file
  from the track's actual output at that point — "these samples are essentially recordings of the
  time-warping engine's audio output, prior to processing in the track's effects chain and mixer,"
  so the new file has the in-clip attenuation, time-warp, pitch-shift, and clip-envelope effects
  baked in as raw samples. This is the same idea as this project's own `beat render`/bounce
  concept, just scoped to one clip.

**Consequence for the format**: splitting only makes sense if a clip can already express "a
region within a media file" — an in-point/out-point pair into a referenced sample, not "the whole
file." Splitting a clip that references the whole file at offset 0 with no length concept isn't
representable yet (see §5). Once that region concept exists, split-at-point is just: replace one
clip with two clips, same media reference, adjusted in/out points, warp markers partitioned by
which segment they fall in — a pure edit-primitive operation with no DSP or engine involvement,
exactly the shape of this project's other edit primitives (`addNote`/`splitClip` would sit next to
`addAutomationPoint` in `src/core/edit.ts`, format permitting).

Sources: [Sonic Bloom: Splitting and Consolidating Clips](https://sonicbloom.net/ableton-live-workflow-tips-part-4-splitting-and-consolidating-clips/), [Ableton Forum: split clip with warp markers into separate parts](https://forum.ableton.com/viewtopic.php?f=2&t=140825), [Ableton manual: Arrangement View](https://www.ableton.com/en/manual/arrangement-view/).

---

## 3. "Velocity" on audio clips — precise, and deliberately not conflated with note velocity

The owner's word was "velocity" applied to audio. Getting this precise matters because the format
**already has** MIDI-style note velocity (`BeatNote.velocity`, `BeatDrumHit.velocity`) — that's a
different, already-solved concept, and conflating the two would be a real design mistake.

Three genuinely distinct things live under "velocity-ish" territory in Ableton, and they map to
three different levers:

1. **Clip Gain** — a single static level slider per clip. The audio-clip analog of a mixer fader,
   not of note velocity. Maps to a single scalar field on a future audio-clip content type
   (`gainDb`, same shape as this format's existing `BeatLaneSample.gainDb`).
2. **Gain clip envelope** — a *time-varying* volume shape drawn across the clip (breakpoints or
   step-drawn), output interpreted as a relative percentage of the static Clip Gain, can attenuate
   to silence but never exceed the static ceiling. This is functionally identical to what this
   format's v0.9 `BeatAutomationLane` mechanism already does for synth params — a clip-scoped lane
   of `(time, value)` points. If an audio clip gained a `gain` field, it would very likely just
   plug into the *existing* automation-lane machinery rather than needing new grammar.
3. **Transient Envelope** (Beats mode only) — controls the fade applied at each detected-transient
   slice boundary: at 100 no fade, at 0 a hard decay per segment, tunable for anything from
   click-smoothing to rhythmic gating. This is a genuinely different concept from either gain
   above — it's per-slice attack/decay shaping, coupled to the Beats warp algorithm's slicing, not
   a track-wide or clip-wide level.

**The one place Ableton itself literally uses the word "velocity" for audio** is Simpler/Sampler's
**Vel > Vol** (Simpler) / **Vol < Vel** (Sampler) parameter: a 0–100% knob controlling how much a
*triggered one-shot sample's* MIDI note velocity affects its output level (0% = velocity ignored,
100% = full dynamic range; default 35%). This is real MIDI-note velocity, applied to a
sampler-triggered audio sample — mechanically identical to standard synth velocity-to-amplitude
mapping, just for a sampled voice instead of an oscillator. **This is the same concept dotbeat
already has, already shipped, for drum-lane samples**: `docs/format-spec.md`'s v0.5 section states
plainly that a `BeatLaneSample`'s `gainDb` "multiplies per-hit velocity" — i.e. dotbeat's drum
lanes already do exactly what Simpler's Vel>Vol does, because drum-lane samples are triggered
one-shots with a velocity per hit, the same shape as a sampler note.

Also notable: Ableton's own "commit a groove to an audio clip" feature **converts velocity data
into a volume clip envelope** — i.e. Ableton's own engineers treat "note velocity" and "clip gain
envelope" as two representations of the same underlying fact, convertible into each other at
render/commit time. That's a useful design precedent if dotbeat ever wants a similar
"bake this track's note velocities into an audio-clip gain envelope" operation later.

**Bottom line for scoping**: if the owner is picturing per-hit dynamics on triggered samples
("hit this drum sample harder/softer"), **that's already solved** — it's the existing
`BeatLaneSample.gainDb` × hit-velocity mechanism, not new M4 work. If the owner is picturing
continuous audio-clip level shaping over time, that's Clip Gain + a gain automation lane — a small,
mostly-already-modeled format extension once audio-region clips exist at all (§5), not a new
concept. Transient Envelope is the one piece that's genuinely new and genuinely coupled to
Beats-mode slicing specifically — worth scoping separately, lower priority.

Sources: [Ableton manual: Clip Envelopes (v12)](https://www.ableton.com/en/manual/clip-envelopes/), [Sound on Sound: Using Clip Envelopes In Ableton Live](https://www.soundonsound.com/techniques/using-clip-envelopes-ableton-live), [Ableton Forum: Implement Velocity Sensitivity the correct way in Simpler/Sampler](https://forum.ableton.com/viewtopic.php?t=233793), `docs/format-spec.md` v0.5 section (this repo), `src/core/document.ts` `BeatLaneSample` (this repo).

---

## 4. Warp markers — what they require of the format and engine

Warp markers anchor a specific point in the audio (usually a transient) to a specific position on
the musical timeline. Mechanically:

- Live seeds a few markers automatically on import (from its own transient/tempo analysis), and
  lets the user add/move/delete more — double-click in the sample editor, or the "Warp From Here"
  family of commands that re-runs auto-warp analysis from a chosen point forward.
- Between two adjacent markers, playback rate is whatever's needed to make the audio between them
  span exactly the musical time between their timeline positions — i.e. **time-varying playback
  rate within a single clip**, not a single constant stretch ratio for the whole clip. A clip with
  three warp markers has (at least) two independently-stretched segments.
- Markers are clip-scoped (confirmed by §2's split behavior — they partition cleanly across a
  split), so a shared source file used by two different clips can be warped completely
  differently in each.

**Format requirement**: an audio clip needs an ordered list of `(sourceTime, timelineTime)` marker
pairs — the smallest new grammar surface this whole research pass points at. Something in the
shape of `docs/format-spec.md`'s existing `point <id> <time> <value>` automation-point line would
generalize cleanly (a warp marker is structurally a 2D point: sample-time in, timeline-time out).

**Engine requirement**: the playback node for an audio clip needs a piecewise time map instead of
a single stretch ratio — feed the underlying stretch algorithm (signalsmith-stretch, §6) a
continuously-updating rate/ratio parameter derived from interpolating between the surrounding
marker pair, rather than one fixed setting per clip. This is a per-clip-chain parameter-automation
problem, not a topology or threading problem — it fits inside the existing engine architecture
(research 05's compiled-node-list model) as one more automatable parameter on one more node type,
which is exactly the kind of thing that doesn't need M4's engine to exist first (§7).

Sources: [Ableton manual: Audio Clips, Tempo, and Warping (v12)](https://www.ableton.com/en/manual/audio-clips-tempo-and-warping/), [Sound on Sound: Ableton Live Warping Revisited](https://www.soundonsound.com/techniques/ableton-live-warping-revisited).

---

## 5. The real blocker: the format has no audio-region-clip concept at all

Read in full: `docs/format-spec.md` and `src/core/document.ts` (the real, current, implemented
grammar — not the aspirational "Future" sketch at the bottom of format-spec.md).

**Finding, unambiguous from reading the type definitions directly**:

```ts
export interface BeatClip {
  id: string
  notes: BeatNote[]        // synth tracks only
  hits: BeatDrumHit[]      // drum tracks only
  automation: BeatAutomationLane[]
}
```

`BeatClip` has exactly two kinds of playable content — notes and drum hits — plus automation.
There is **no third variant that references a media sample as a region with in/out points**.
The two places the format *does* reference audio media today are both structurally unsuited to
being "an audio clip":

- **`BeatLaneSample`** (v0.5) — one sample assigned to one drum lane, triggered as a fixed
  one-shot on every hit in that lane. No in/out point, no clip boundaries, no warping — it always
  plays the whole sample from the start, at a fixed gain/tune, once per hit.
- **`BeatInstrument`** (v0.6) — a SoundFont *program* reference for a whole track (via `.sf2`
  program-number addressing, not a specific sample file/region) — a different axis entirely
  (instrument voice selection, not clip-level audio editing).

Neither is "a span of a specific audio file, placed on a timeline, with its own in/out points,
warp mode, and marker list" — the actual object every piece of Ableton behavior researched above
(§1–§4) operates on. **This is the finding the phase-17 plan asked to flag explicitly rather than
implement**: before any of Complex/Repitch/Beats warping, splitting, clip gain, or warp markers
can be built — in the web tier *or* M4 — the format needs a new concept, roughly:

```
  clip solo-take
    audio smp_drumloop 0 32 gain=-3 warp=repitch    # media-id, in-point, out-point, gain, warp mode
      marker m1 0 0                                  # sourceTime, timelineTime
      marker m2 16 15.5
```

This is a genuine, non-trivial format decision (new clip-content variant, new top-level statement
kind, a `warp` enum, a marker sub-block) — sized similarly to v0.9's clip-automation addition,
not a one-line tweak. **Flagged as a finding per the phase-17 brief's explicit instruction, not
implemented this round.**

---

## 6. Closing the gap: Rubber Band vs. signalsmith-stretch, for real this time

This question has been carried as open since `docs/research/05-engine-architecture.md` (flagged
twice: once in that report's own open questions, once again in `docs/m4-native-engine-design.md`'s
open questions — "Needs its own pass before M4.2's warping cousin gets scoped... no warping in any
M4 stage above — it's the least-evidenced item in the whole plan"). Direct comparison:

| | **Rubber Band Library** | **signalsmith-stretch** |
|---|---|---|
| License | **GPLv2-or-later**, dual-licensed with a paid commercial option (Breakfast Quay / Particular Programs Ltd, author Chris Cannam) | **MIT** |
| Fits this project's license posture? | **No, not for free** — `docs/decisions.md` already closed the GPL-engine door for exactly this class of dependency ("the GPL engine tier (Surge XT / Vital engines) is CLOSED — no GPL code may be ported in"). Usable only via a paid commercial license, an explicit business decision. | **Yes**, same bucket as spessasynth_lib/Dexed's msfa core — the permissive path this project has already committed to. |
| WASM/web release | Exists only as **third-party ports** (`Daninet/rubberband-wasm`, `@echogarden/rubberband-wasm`, `delude88/rubberband-web`) — none authored by the library maintainer. `Daninet/rubberband-wasm`: 15 commits, 49 stars, no releases published — early-stage/hobbyist, not battle-tested. All inherit Rubber Band's GPL. | **Official web release** in the library's own `web/` directory, published on NPM as `signalsmith-stretch`, WASM + AudioWorklet, maintained by the same author as the C++ core. |
| Maturity/reputation | Long-established (Chris Cannam), widely regarded as reference-quality, used across pro audio tooling on Linux/desktop; explicitly cited by Ardour/Audacity-adjacent communities as the high-quality option people reach for. No direct 2026 benchmark found comparing it to signalsmith-stretch. | 516 stars / 53 forks / 114 commits — smaller but real community; author (Signalsmith Audio) also publishes the well-regarded ADC22 "Four Ways To Write A Pitch-Shifter" talk this library implements. Self-documented sweet spot: "time-stretching sounds best for more modest changes (between 0.75x and 1.5x)" — narrower stated envelope than Rubber Band's reputation for extreme ratios. |
| Real-time capable? | Yes (that's its primary design point — used in DAWs for live warped playback). | Yes — explicitly a streaming `.process()` API with reported input/output latency, designed for continuous processing, not just offline batch. |
| Quality ceiling | Generally considered the higher bar, especially at extreme stretch ratios and for formant-sensitive material (the closest real analog to Complex Pro). | Good at moderate ratios (the Complex/Repitch-replacement range most music production actually uses); own docs are honest that it doesn't claim Rubber Band's extreme-ratio ceiling. |

**Resolution**: for dotbeat specifically, **signalsmith-stretch is the practical choice, not a
close call** — it's the only option that's (a) license-compatible with this project's MIT posture
without a purchase decision, and (b) has an official, maintainer-shipped WASM/AudioWorklet build
rather than a thin third-party wrapper of a GPL library. Rubber Band remains on the table as a
**deliberate, paid, M4-tier decision** if real usage shows signalsmith-stretch's quality ceiling is
audibly insufficient (e.g. extreme-ratio or formant-critical Complex-Pro-equivalent work) — that's
a product/budget call for later, not a blocker now.

Sources: [breakfastquay.com/rubberband/license.html](https://breakfastquay.com/rubberband/license.html), [breakfastquay/rubberband (GitHub mirror)](https://github.com/breakfastquay/rubberband), [Signalsmith-Audio/signalsmith-stretch (GitHub)](https://github.com/Signalsmith-Audio/signalsmith-stretch), [signalsmith-audio.co.uk/code/stretch/](https://signalsmith-audio.co.uk/code/stretch/), [Daninet/rubberband-wasm (GitHub)](https://github.com/Daninet/rubberband-wasm), `docs/decisions.md` (this repo, GPL-engine-tier-closed decision).

---

## 7. Cross-reference against the verified engine architecture (research 05)

`docs/research/05-engine-architecture.md` already established, fully verified: production engines
converge on a compiled, topologically-ordered node list executed by a lock-free multi-threaded
player (M4-native shape), while all Web Audio implementations — including the web tier dotbeat
ships today — inherit a single-render-thread architecture with no per-cycle multicore
parallelism. That finding is about **graph-wide scheduling and threading**, and it doesn't change
the answer here: warping is a **per-node DSP problem** (one clip's playback node gets fed a
time-varying rate/ratio, computed from its warp markers), not a graph-topology or
multi-threading problem. Nothing about warping specifically requires M4's compiled-node-list/
lock-free-player architecture — a signalsmith-stretch AudioWorklet node slots into the existing
single-threaded Web Audio graph exactly like any other WASM DSP node (the same WAM2/Emscripten
pattern `ROADMAP.md` §6 already confirms works for stock FX). This is the concrete basis for
`ROADMAP.md` §6's own table entry — "Warping / time-stretch: ⚠️ WASM libs, unproven at quality" —
being listed as a *web-tier* row with a *native* fallback, not a native-only feature. This pass
resolves the "unproven at quality" qualifier only partially: signalsmith-stretch is real and
real-time-capable, but no direct listening/quality test against dotbeat's own material has been
run (see Open Questions).

What *does* stay M4-tier, per the same report: anything that needs the butler-thread disk-
streaming model (`m4-native-engine-design.md`'s M4.2 stage) — i.e., recording new audio and
comping across long, disk-resident takes — because that's a genuinely different problem
(non-real-time file I/O feeding the real-time path without glitching) that the web tier's
single-thread model isn't designed for regardless of which stretch library is picked.

---

## 8. Recommendation — the line between "buildable soon" and "M4-native-only"

### Buildable in the current web engine, once Stream L's engine consolidation lands (candidate Phase 18 scope)

1. **Format: an audio-region clip content type** — media reference + in-point + out-point + gain
   + a `warp` enum (`off | repitch | complex`) + an optional marker list. This is the actual
   prerequisite for everything else in this list; without it there's nothing to split, warp, or
   gain-shape. Sized like the v0.9 clip-automation addition — a real format-spec version bump,
   not a footnote.
2. **Repitch-mode warping** — needs zero new library, just a `playbackRate`-equivalent parameter;
   the cheapest, most immediately buildable warp mode, and a reasonable first exit test for the
   whole audio-clip feature (play a clip back at a different tempo, verify pitch moves with it).
3. **Split-at-point** — a pure edit-primitive operation on the new clip-content shape (§2); no DSP,
   no engine change beyond consuming the new format field.
4. **Clip gain (static) and a gain automation lane** — the static field is trivial; the
   time-varying case very likely reuses the *existing* `BeatAutomationLane` machinery (§3) rather
   than inventing new grammar.
5. **Warp markers + Complex-mode-equivalent stretch via signalsmith-stretch** — the marker list is
   a format addition structurally similar to automation points (§4); the DSP is the newly-resolved
   MIT/WASM library (§6). This is real work — a stretch algorithm integration, not a trivial
   feature — but it's web-tier work per `ROADMAP.md` §6, not gated on M4.
6. **Beats-mode-equivalent transient slicing + Transient Envelope** — lower priority; needs onset/
   transient detection (not researched this pass — see Open Questions) in addition to the stretch
   library. Reasonable to sequence after 1–5 prove the audio-clip format shape out.

### Genuinely M4-native-tier

1. **Recording audio at all** — there's currently no capture path in dotbeat; native latency
   recording is explicitly Tauri/M4 scope (`m4-native-engine-design.md` M4.2), gated behind the
   confirmed ~30ms web latency wall (`research/02`). Importing existing audio files for the
   web-tier features above needs no recording — that's a separate, much smaller "add media via
   file picker" feature, already compatible with the existing content-addressed `media/` block.
2. **Sample-accurate multi-take comping, freeze/flatten/bounce with defined signal-path
   semantics** — needs the butler-thread disk-streaming architecture `m4-native-engine-design.md`
   already scoped for M4.2; this is a different problem from single-clip warping (§7).
3. **Rubber-Band-grade reference stretch quality**, conditionally — only if real use shows
   signalsmith-stretch's quality ceiling is insufficient (extreme ratios, formant-critical vocal
   material). At that point it's a deliberate, budgeted commercial-license decision, evaluated
   against actual signalsmith-stretch output rather than assumed in advance.

### Concrete next step for Phase 18

Sequence 1→4 above as a single slice (format-only + trivial engine work, no new DSP dependency) to
prove the audio-clip format shape and get real files splitting/gain-shaping in the GUI; sequence 5
as its own slice once the shape is validated (that's where signalsmith-stretch actually gets
integrated); leave 6 and the whole M4-native list explicitly out of scope until real use asks for
them, consistent with `m4-native-engine-design.md`'s own stance that M4 is "a bet-sizing decision,
not a scheduling decision."

---

## Open questions (honest gaps, not resolved by this pass)

- **No direct listening/quality comparison run** between signalsmith-stretch and Rubber Band on
  material representative of dotbeat's own content (drum loops, full mixes, vocals) — the
  recommendation in §6 rests on license fit and WASM-release maturity, which is decisive on its
  own, but the *quality* comparison itself is sourced from each project's own documentation and
  general reputation, not a controlled test. Worth doing before committing to signalsmith-stretch
  for Complex-Pro-equivalent vocal work specifically.
- **No research pass run on transient/onset-detection algorithms** for a Beats-mode equivalent
  (spectral flux, complex-domain onset detection, or whatever a WASM library might offer) — flagged
  as needed before scoping item 6 above, not attempted this round.
- **Exact warp-marker/audio-clip grammar is illustrative, not designed** — §5's sketch shows the
  shape of the gap, not a finalized syntax; a real format-spec update needs its own pass through
  the canonical-ordering/elision discipline `docs/format-spec.md` already establishes for other
  clip content types.
- **This pass used ordinary web search, not the project's deep-research harness** (fan-out search →
  fetch → extract → 3-vote adversarial verify used in `docs/research/01-09`) — the phase-17 brief
  prioritized closing the Rubber Band/signalsmith gap and getting a scoping line drawn over running
  a full adversarial pass. Findings here are cross-checked across multiple independent sources
  where noted, but do not carry the same "3-0 vote" confidence marking as `01-09`/`05`. If this
  area becomes load-bearing for an actual build decision (not just scoping), a proper verified pass
  would be worth running, especially on the licensing/GPL-compatibility conclusion in §6 given how
  consequential it is.

# Research 26 — Beats-mode transient slicing: onset-detection approach

*2026-07-11. Stream RB of `docs/phase-23-plan.md` — research only, no code changes. Sequenced
after RA (`docs/research/25-audio-warp-markers-stretch.md`, warp markers + Complex-mode stretch)
per `docs/research/16-audio-clip-editing.md` §8's own ordering. **RA had not landed at the time
this pass was written** — `docs/research/25-audio-warp-markers-stretch.md` does not exist yet in
the repo. This doc therefore designs its own recommendation independently rather than blocking on
RA, and flags every point where it should reconcile with RA's actual output once that lands (see
"Dependency on RA" below each relevant section). Reads `docs/research/16-audio-clip-editing.md`
§§1-4 (Ableton's Beats warp mode, warp markers), `docs/research/18-ableton-ui-architecture.md`
(checked for prior Beats-mode coverage — it has none beyond one passing mention of Simpler's
"Classic/1-Shot/Slice mode" selector, §"The Drum Rack pad grid"), `docs/research/22-opendaw-
editing-workflow.md` §2.4 (openDAW's `TransientPlayMode` enum, directly relevant to research
question 4), `src/core/document.ts`'s `BeatAudioRegion`/`BeatAudioWarpMarker` types (Phase 22
Stream AE), and `docs/format-spec.md`'s v0.10 audio-region section.*

## Verdict

**Onset detection is a small, dependency-free, pure-TypeScript problem for dotbeat's target
material — no WASM library needed at all.** The two credible WASM onset-detection libraries
(aubio, essentia.js) are both GPL-family licensed and land in the same "closed" bucket
`docs/decisions.md`'s License decision already drew around the GPL engine tier ("no GPL code may
be ported in") and research 16 §6 already applied to Rubber Band. A permissively-licensed,
zero-dependency prior-art library (`audiojs/beat`, MIT) already implements exactly the two
algorithm families this doc considered — energy-based and spectral-flux — in plain JS with no
WASM step at all, which resolves the plan brief's own framing ("AnalyserNode vs. WASM library") in
favor of neither literally: this is offline array-domain analysis on an already-decoded buffer,
not a real-time `AnalyserNode` visualization problem and not WASM-DSP-library-shaped at all.

**Detected transients should NOT get their own grammar.** They should populate exactly the
grammar RA is scoping: `BeatAudioRegion.markers` (`BeatAudioWarpMarker[]`, currently reserved,
always `[]` — verified directly in `src/core/document.ts`). Ableton's own Beats mode is not a
structurally distinct mechanism from warp markers in the first place — research 16 §4 already
found Live "seeds a few markers automatically on import (from its own transient/tempo analysis)."
Beats-mode transient slicing, in this framing, is just **the algorithm that populates the marker
list densely and automatically**, as opposed to a user manually placing one or two markers by
hand. One grammar, two ways to fill it in.

**Detection should be a re-runnable, tunable core primitive (`detectTransients`), not a
one-time import-time bake.** The output (the marker list) is what's persisted and diffed; the
sensitivity threshold that produced it is a tool-only input, never a stored file field — the same
"presets are tooling, never grammar" posture `docs/decisions.md` D9 already established for a
structurally identical problem (a parameter that shapes an edit but shouldn't itself live in the
document).

**Recommended MVP scope decouples detection from stretch entirely.** Detecting transients and
writing markers is useful — and shippable — with zero dependency on RA's stretch-engine work:
markers alone already enable a legible waveform overlay and a "split at nearest transient"
convenience wrapper around the already-shipped `splitAudioClip` primitive. True independently-
stretched Beats-mode playback (each slice its own stretch ratio) is real work gated on RA's
piecewise time-map engine landing, and should be sequenced as its own later slice, not bundled
into the first cut.

---

## 1. Onset-detection algorithm choice

### 1.1 What the target material actually needs

The owner's framing (`docs/phase-23-plan.md` RB) is explicit that dotbeat's Beats-mode use case is
**rhythmic material — drum loops, breaks** — not legato or subtly-attacked material (bowed
strings, pads, sustained vocal phrases, the material that makes general-purpose onset detection
genuinely hard). This matters for the algorithm choice: drum hits are large, fast, broadband
amplitude events, usually well separated in time relative to the ~10-20ms analysis window any
onset detector needs. That's close to the easiest case in the onset-detection literature, not the
hardest — worth stating plainly before reaching for a heavier algorithm than the material demands.

Two families are the real candidates:

- **Energy-based (amplitude-envelope) onset detection** — track short-time RMS or peak energy in
  fixed hops, flag an onset wherever energy rises sharply above a local adaptive threshold. No FFT
  at all. Cheapest possible implementation (a rolling window and a peak-picker), and the textbook
  first thing anyone reaches for percussive material specifically, because a drum hit *is*, almost
  by definition, a sudden energy spike. Weak point: two events close together with similar
  broadband energy (a closely-spaced hi-hat 16th pattern, a kick immediately followed by a
  low-passed snare) can smear into one detected onset if their combined energy envelope doesn't
  dip enough between them.
- **Spectral flux** — STFT the signal, take the frame-to-frame *positive* change in magnitude per
  frequency bin, sum across bins, peak-pick the resulting onset-detection function against an
  adaptive threshold. "Arguably the most widely used onset detection method" across the MIR
  literature ([spectral flux tutorial/comparison](https://asmp-eurasipjournals.springeropen.com/articles/10.1186/s13636-021-00214-7)),
  because a spectral-domain change catches onsets energy alone misses (a new note that redistributes
  energy across frequencies without necessarily raising total energy — e.g. two hits at similar
  loudness but different timbre in close succession). Costs an FFT per hop (real but small —
  offline, not real-time, over a file that's already decoded and cached), and one more parameter
  (window/hop size) to reason about.

For dotbeat's stated target material, energy-based detection is very likely *sufficient* on its
own, and is dramatically simpler to implement, test, and reason about (no FFT, no window function,
one signal — a rolling RMS curve — instead of a spectrogram). The plan brief's own framing already
anticipates this: "spectral flux vs. a simpler energy/amplitude-envelope-based approach... weigh
accuracy vs. complexity." Recommendation: **build energy-based detection first as the v1** (it's
the correct match for the stated material and the cheaper build), **document spectral flux as the
documented upgrade path** if real test loops show a false-negative/false-positive rate that
matters in practice (dense hi-hat patterns are the likely failure case worth testing against
first). This mirrors research 16's own resolution pattern for the stretch-library question — ship
the simpler, sufficient option first; escalate only if real use proves it insufficient, not in
advance of evidence.

### 1.2 Library options, and why none of them get pulled in

| | **aubio** | **essentia.js** | **audiojs/beat** | **Hand-rolled (recommended)** |
|---|---|---|---|---|
| License | **GPLv3-or-later** ([aubio.org](https://aubio.org/), [COPYING](https://github.com/aubio/aubio/blob/master/COPYING)) | **AGPL, dual-licensed with a paid commercial option** ([essentia.upf.edu/licensing](https://essentia.upf.edu/licensing_information.html)) | **MIT** | MIT (this project) |
| Runtime shape | C library, `aubiojs` npm package compiles it to WASM via Emscripten ([qiuxiang/aubiojs](https://github.com/qiuxiang/aubiojs)) | C++ core, official WASM/Emscripten build, "as small as 2.5MB" ([ISMIR 2021 paper](https://transactions.ismir.net/articles/10.5334/tismir.111)) | Pure JS, **zero dependencies, no WASM** — operates directly on `Float32Array`/`Float64Array` PCM, works in Node and browser alike ([audiojs/beat](https://github.com/audiojs/beat)) | Pure TS, no dependency |
| Algorithms offered | Onset detection, pitch tracking, beat/tempo tracking, phase vocoder | `SuperFluxExtractor` (a refined spectral-flux variant) plus a very large general MIR algorithm surface | Four onset methods: spectral flux, **energy onsets** ("fastest option for percussive material" — the library's own framing), phase deviation, multi-band flux; plus tempo estimation (autocorrelation + comb-filter) and two beat-tracking modes | Whichever of the above two families is chosen |
| Fits this project's license posture? | **No** — same bucket `docs/decisions.md` already closed for Rubber Band/Surge XT/Vital: "the GPL engine tier ... is CLOSED — no GPL code may be ported in," usable only via a paid commercial license as a deliberate business decision, not a default technical option. | **No, more restrictive than aubio** — AGPL adds a network-use clause on top of GPL's copyleft; the commercial-license escape hatch is the vendor's explicit monetization model here, so treating it as "free to use" would misread the project's own posture. | **Yes** — same permissive bucket as spessasynth_lib/Dexed's msfa core, the path this project has already committed to. | Yes, trivially — first-party code. |
| Verdict | Closed | Closed | **Open — genuinely usable as-is or as a reference implementation** | **Recommended** |

Two other prior-art data points, useful as reference but not adoption candidates: **Keavon/Web-
Onset** ([GitHub](https://github.com/Keavon/Web-Onset)) is a GPL-3.0-licensed spectral-flux
prototype built directly on the Web Audio API — closed by license, and separately the project's
own README calls its onset-frequency display "mathematically flawed" and explicitly unfinished, so
it wouldn't be a credible reference even under a compatible license. Essentia.js's
`SuperFluxExtractor` demo ([live demo](https://mtg.github.io/essentia.js/examples/demos/onsets/public/))
is a useful sanity check on what a mature spectral-flux-family detector's output looks like on
real audio, but again closed by license for actual adoption.

**Net read**: dotbeat doesn't need to add a runtime dependency for this feature at all. Either
(a) implement a small energy-based (and later, optionally, spectral-flux) onset detector directly
in `src/core/` — well-documented, textbook algorithms, the same "reimplement the published math,
cite the source" tradition the project already used for openDAW's Möbius-ease groove curve
(`docs/research/22-opendaw-editing-workflow.md` §3.2, `src/core/groove.ts`), or (b) take
`audiojs/beat`'s MIT-licensed, dependency-free implementation directly as a small library
dependency, since it already implements the exact "energy onsets, fastest for percussive material"
detector this doc recommends starting with. Either path avoids WASM entirely and avoids the two
GPL-family libraries that would otherwise be the "proper" MIR-library answer.

### 1.3 Dependency on RA

None for this section — the algorithm/library choice is independent of how RA scopes the
warp-marker grammar or the stretch engine.

---

## 2. Client-side implementation shape — not `AnalyserNode`, direct array analysis

The plan brief frames the implementation choice as "Web Audio `AnalyserNode` + custom JS" vs. a
WASM library. Having looked at the actual shape of the problem, that framing needs one correction:
**`AnalyserNode` is the wrong tool for this, regardless of the algorithm choice.**

`AnalyserNode` is designed for real-time visualization of a live, connected audio graph — you pull
`getFloatFrequencyData()`/`getFloatTimeDomainData()` on an animation-frame cadence while audio is
actively playing through the node. Transient detection for Beats-mode slicing is not a real-time
problem at all: it runs once (or on-demand, on a sensitivity re-tune) over a **file that's already
fully decoded and sitting in memory** — Phase 22 Stream AE's engine already maintains "a
content-addressed decoded-buffer cache shared across clips referencing the same media"
(`docs/format-spec.md`'s v0.10 audio-region section, verified directly). Once a `Float32Array` of
PCM samples is in hand, the natural implementation is a plain offline loop over that array —
compute short-time energy or an STFT in fixed hops directly on the array, no live audio graph, no
node connection, no render-thread timing concerns at all. This is strictly simpler than wiring up
an `AnalyserNode` (which would require constructing a throwaway `OfflineAudioContext`/graph just to
get access to data you already have as a plain array) and gives full control over hop size and
windowing, which matters for getting transient timing accurate to better than an `AnalyserNode`'s
frame-boundary granularity.

Concretely, for the energy-based v1: a rolling RMS or peak-energy value computed every N samples
(a hop of ~256-512 samples at 44.1kHz, ~6-12ms — small enough to place a slice point accurately
relative to a drum transient's actual attack, which is itself only a few milliseconds), then a
local adaptive-threshold peak-picker (a point counts as an onset if it's a local maximum over a
short window *and* exceeds `mean + k * stddev` of a surrounding sliding window of recent energy
values) — the `k` multiplier is exactly the "sensitivity" the plan brief asks about (§4 below). For
the spectral-flux upgrade path, same hop-based loop, but each hop runs a small FFT (a textbook
radix-2 Cooley-Tukey over a window of ~1024-2048 samples is standard for this purpose and easy to
hand-write or vendor as a tiny, dependency-free utility) instead of just an RMS sum.

### Dependency on RA

None — this is purely an implementation-shape finding about how to read PCM data, independent of
the marker-grammar or stretch-engine decisions RA owns.

---

## 3. How detected transients become format-level slice points

### 3.1 Recommendation: reuse `BeatAudioRegion.markers` — no new grammar

`src/core/document.ts` (read directly) already reserves exactly the right shape:

```ts
export interface BeatAudioWarpMarker {
  id: string
  sourceTime: number   // seconds into the source media
  timelineTime: number // 16th steps from the clip's own start
}
```

A detected transient is, structurally, precisely this: a point in the source audio (the onset
time, in seconds) anchored to a point on the clip's musical timeline (the position, in 16th
steps, that onset should land on so the loop stays in time). This is not a coincidence — it's the
same finding research 16 §4 already made about Ableton's own Beats mode: Live "seeds a few
markers automatically on import (from its own transient/tempo analysis)," and Beats mode's own
mechanism (research 16 §1) is described as detecting transients and slicing "functionally similar
to Live's 'Slice to New MIDI Track'" — i.e., Ableton's Beats-mode slice points *are* warp markers,
just densely and automatically placed, with a per-region play-mode flag layered on top (§4 below).
There is no separate "slice point" concept in Ableton's own data model to import as prior art, and
there's no reason for dotbeat to invent one where Ableton itself didn't.

Concretely, for a freshly-detected transient at sample-domain onset time `t_source` (seconds) in a
region whose current warp is `off` or `repitch` (rate `r`, in-point `in`), the corresponding
`timelineTime` is:

```
timelineTime = (t_source - in) / r / stepSeconds     // stepSeconds = 60 / doc.bpm / 4, one 16th note
```

— the exact same `stepSeconds` conversion `splitAudioClip` already performs (`src/core/edit.ts`,
read directly: `const stepSeconds = 60 / doc.bpm / 4`). This is a straight, un-warped 1:1 mapping
at detection time (each marker starts life implying no stretch at all, since nothing has stretched
yet) — RA's stretch engine is what later turns "adjust a marker's `timelineTime`" into an actual
audible tempo change by interpolating playback rate between adjacent markers (research 16 §4). RB
only needs to get the *initial*, straight mapping right; RA's engine work handles everything that
happens once a marker is moved off its straight-line position.

### 3.2 Why not a separate "slice" representation

A structurally distinct `slices: BeatAudioSlice[]` field (in/out sample ranges, one per detected
segment) was considered and rejected. Two reasons:

1. **It would duplicate the warp-marker list's information.** A slice boundary and a warp marker
   both express the same fact — "this musical position corresponds to this point in the source
   audio" — a marker list already fully implies a set of slices (the audio between any two adjacent
   markers *is* a slice, by construction). A second field storing the same boundaries under a
   different name is the kind of "two representations of one fact" the format has deliberately
   avoided elsewhere (`docs/decisions.md` D4's single-canonical-form discipline).
2. **It would fragment RA's and RB's work into two format concepts that need to stay in sync.**
   Reusing one field means detection (RB) and stretch playback (RA) are two algorithms that operate
   on the *same* stored state, not two coupled-but-separate schemas. Splitting them into
   `markers` (manually placed) and `slices` (auto-detected) would also raise an awkward question —
   what happens when a user manually adjusts an auto-detected slice boundary? Does it migrate from
   one list to the other? — that a single list with an optional provenance tag (below) sidesteps
   entirely.

The one piece of extra information genuinely worth adding to `BeatAudioWarpMarker` for this
feature — not present in the type today — is a lightweight **provenance tag**, e.g. an optional
`source: 'auto' | 'manual'` field, so a re-run of `detectTransients` (§4) can distinguish "markers
I placed automatically, safe to replace" from "markers the user dragged or added by hand, don't
silently discard." This is a small, additive field on the existing reserved type, not a new
top-level concept.

### 3.3 Dependency on RA — where this needs to reconcile

This section assumes `BeatAudioRegion.markers` remains the single, shared marker list RA is
scoping. If RA's actual design instead splits warp markers into something structurally different
(e.g., a marker that's *always* meaningful only under `warp = complex`, with a separate lighter-
weight "reference point" concept for anything not yet driving a real stretch), this section's
recommendation should be revisited to slot transient-detection output into whichever of RA's
concepts is closer to "a point, not yet stretched, informational until acted on." The core claim
that should survive any reconciliation is narrower and should hold regardless: **detected
transients are markers, not a new grammar**, and the provenance tag (`source: 'auto' | 'manual'`)
is worth keeping wherever the marker type ends up living. If RA settles on a per-marker or
per-region play-mode field (§4 below is exactly this question, addressed independently here since
RA hadn't landed), that field is also the natural home for the provenance tag — both are per-marker
metadata orthogonal to the `(sourceTime, timelineTime)` pair itself.

---

## 4. Detection timing — a re-runnable, tunable core primitive

### 4.1 Not baked once at import

Baking transient positions once at import time and never revisiting them would be the simpler
implementation, but it's the wrong choice for this specific feature, for a reason specific to
onset detection: **the "right" answer is threshold-dependent, and the threshold has no universally
correct value.** The adaptive-threshold multiplier (`k` in §2) trades false positives (extra
slices on a loop's natural volume swells or bleed) against false negatives (missed genuine hits,
especially quieter ghost notes or closely-spaced hi-hats) — different source material wants
different values, and even the same material might want re-tuning once a user actually looks at
the sliced result and sees it's over- or under-segmented. A one-shot, unrevisitable detection pass
would leave no recourse but hand-editing markers one at a time to fix a systematically wrong
threshold.

### 4.2 The primitive shape

Recommend a core edit primitive, `detectTransients`, matching the existing signature discipline
`src/core/edit.ts` already establishes for comparable region-scoped operations (`splitAudioClip`'s
own signature, read directly: `(doc, trackId, clipId, atSteps, opts) => { doc, first, second }`):

```ts
export function detectTransients(
  doc: BeatDocument,
  trackId: string,
  clipId: string,
  opts: { sensitivity?: number; algorithm?: 'energy' | 'flux' } = {},
): { doc: BeatDocument; markers: BeatAudioWarpMarker[] }
```

- `sensitivity` (recommend a normalized `0..1` or similar, translated internally to the adaptive-
  threshold `k`) is a **tool-only input, never a stored file field** — the same "presets are
  tooling, never grammar" posture `docs/decisions.md` D9 already committed to for a structurally
  identical case (a value that shapes an edit, not a fact about the resulting sound). What's
  diffed and persisted is the *output* — the marker list — not the parameters that produced it,
  exactly as a `beat preset` application diffs as ordinary field edits, never a preset reference.
- `algorithm` defaults to `'energy'` per §1's recommendation, with `'flux'` available once the
  spectral-flux upgrade path (§1.1) is implemented — again a tool argument, not a file field; the
  document has no memory of which algorithm produced its markers, only the markers themselves.
- Calling it replaces `clip.audio.markers` — recommend a straightforward **full-replace policy for
  `v1`**: `detectTransients` overwrites every existing `source: 'auto'` marker and leaves any
  `source: 'manual'` marker untouched (§3.2's provenance tag exists specifically to make this
  policy possible). This is simple enough to implement and reason about, and defers a harder
  question — "what if a user's manual marker now falls suspiciously close to a freshly re-detected
  auto marker, are these the same marker?" — as an explicit, honestly-flagged open question (§6)
  rather than something this pass invents a heuristic for without evidence it's needed.
- CLI/MCP surface, following the existing `beat audio-split`/`beat_audio_split` naming precedent:
  `beat detect-transients <file> <track> <clip> [--sensitivity N] [--algorithm energy|flux]` /
  `beat_detect_transients`.

### 4.3 When it runs

Two trigger points, both calling the same primitive:

1. **On import** — run once automatically with a sensible default sensitivity when an audio file
   is first dropped onto an `audio`-kind track (Stream BC's clip-creation gesture, per
   `docs/phase-23-plan.md`), so a freshly imported drum loop shows plausible slice markers
   immediately, matching Ableton's own "Live seeds a few markers automatically on import" behavior
   (research 16 §4) as closely as dotbeat's simpler marker model allows.
2. **On demand** — a re-detect action (a button next to a sensitivity slider, in whatever future
   GUI stream builds the waveform view Stream BC scopes) that calls the same primitive again with
   a user-adjusted `sensitivity`, for the material where the default guess over- or
   under-segments.

Both are the *same* core primitive; the only difference is who supplies `opts.sensitivity` and
when.

### Dependency on RA

None structurally — `detectTransients` writes into the marker list regardless of what RA decides
about the stretch engine's consumption side. The one soft dependency: if RA's grammar work adds
fields to `BeatAudioWarpMarker` beyond `(id, sourceTime, timelineTime)` (e.g. a per-marker
play-mode, §5), `detectTransients` needs to populate sensible defaults for those fields too when
it writes a fresh auto-detected marker — a small reconciliation, not a redesign.

---

## 5. Playback scope — what happens to slices at different tempos/warp settings

### 5.1 The real scope question: detection and stretch are separable

The plan brief's question 4 asks whether each slice should be independently stretched (true
Beats-mode) or just repositioned (a simpler first cut). Investigating this surfaced a scope point
worth stating explicitly, because it changes what's buildable *and when*: **detecting transients
and writing markers requires zero dependency on any stretch engine at all.** A marker list is
useful on its own, even if the engine does nothing with it beyond what it already does today
(`warp = off` or `repitch`, a single rate for the whole region):

- **A waveform view (Stream BC's own scope, per the plan) can render tick marks at each marker's
  `sourceTime`** — a legible, informative overlay, no engine change needed.
- **"Split at nearest transient"** is a thin convenience wrapper around the already-shipped
  `splitAudioClip` primitive (`src/core/edit.ts`, verified working per Phase 22 Stream AE's
  verification script) — find the marker closest to a requested split point, call
  `splitAudioClip` at that position. Zero new engine or DSP work; this alone gives a genuinely
  useful "chop this loop into its hits as separate clips" workflow today, with no stretch engine
  in the picture at all.

This means RB's most valuable near-term deliverable — detect transients, show them, let a user
split cleanly on them — doesn't actually need to wait on RA's stretch-engine landing, even though
the plan brief sequences RB's research *after* RA's. The research sequencing (design the marker
grammar first, then the algorithm that populates it) makes sense; the *build* sequencing doesn't
need to inherit the same dependency once markers exist as a reserved, structurally-ready field.

### 5.2 Two scope tiers

**Tier 1 — MVP (recommended first build target, decoupled from stretch)**

- `detectTransients` populates markers (§3, §4).
- Markers render as an overlay on the (separately-scoped) waveform view.
- "Split at nearest marker" convenience wraps `splitAudioClip`.
- Playback is **unchanged** — the region still plays back as a single unit under whatever `warp`
  mode is set (`off` or `repitch`, both shipped). Markers are informational/edit-aid metadata at
  this tier, not yet driving independent per-slice playback. No new DSP, no stretch dependency, no
  `TransientPlayMode`-equivalent field needed yet.
- This is a genuinely useful, shippable feature on its own — "see where the hits are, cut cleanly
  on them" — and a reasonable exit test: detect transients on a real drum loop, verify markers land
  within a few milliseconds of the loop's actual hits, verify split-at-marker produces clean,
  correctly-timed clip boundaries.

**Tier 2 — Full Ableton-parity Beats mode (later, gated on RA's stretch engine)**

- Each pair of adjacent markers becomes an independently-stretched segment — RA's piecewise
  time-map engine work (research 16 §4: "the playback node for an audio clip needs a piecewise
  time map instead of a single stretch ratio... interpolating between the surrounding marker
  pair"), reused verbatim, not reinvented by RB. This is the point at which "Beats mode" becomes
  audibly real: move a marker's `timelineTime` (or change the document's `bpm`) and each slice
  individually re-times to keep every hit landing on the correct musical position, rather than the
  whole region uniformly speeding up or slowing down.
- **Adopt openDAW's `TransientPlayMode` vocabulary** (`Once | Repeat | Pingpong`,
  `docs/research/22-opendaw-editing-workflow.md` §2.4, confirmed by direct source read of
  `packages/studio/enums/src/TransientPlayMode.ts`) as the "what happens to a percussive hit
  between two markers" control, rather than Ableton's own broader 5-way named-warp-mode system.
  Research 22 already flagged this as "smaller and more implementable than Ableton's 5-way
  named-warp-mode system" for the general warp case; the same reasoning applies here specifically
  — a per-region (or, if RA's design ends up per-marker-pair-granular, per-segment) 3-value enum
  is a proportionate, literal field, not a mode-name system requiring five different DSP behaviors.
  Concretely: `Once` plays the slice through once and lets silence fill any remaining time before
  the next marker (or truncates if the slice is longer than the gap); `Repeat` loops the slice to
  fill the gap (the classic "stutter" Beats-mode artifact at extreme tempo increases); `Pingpong`
  loops it forward-backward. This is a small, literal field addition (`BeatAudioRegion.transientPlayMode`
  or similar), not new architecture — same shape as `warp`/`rate` already are on the same type.
- **Transient Envelope** (the per-slice-boundary fade/decay shaping Ableton's own Beats mode has,
  research 16 §3) is the lowest-priority piece of this whole feature — recommend deferring it past
  even the rest of Tier 2, consistent with research 16 §3's own "worth scoping separately, lower
  priority" verdict. It's a real, independently-addable field (a 0-100 fade-shape knob per region)
  once Tier 2's slicing is real, not a blocker for anything else here.

### 5.3 Dependency on RA

This is the section most directly coupled to RA's output. Tier 2 assumes RA's stretch engine
consumes the same `BeatAudioRegion.markers` list this doc recommends populating (§3) and exposes
some form of piecewise rate interpolation between adjacent markers (research 16 §4's already-
established requirement). If RA's actual design changes the engine-consumption shape — e.g., an
AudioWorklet-resident stretch node with a different update cadence than the main-thread document
model implies, or a decision to gate Complex-mode stretch behind an explicit opt-in separate from
`warp = complex`'s current single enum value — Tier 2's engine-side recommendation should be
revisited against RA's real design. Tier 1 has no such dependency and can be built and shipped
regardless of RA's timeline.

---

## 6. Open questions (honest gaps, not resolved by this pass)

- **No accuracy test run against real dotbeat drum-loop material.** The energy-vs-spectral-flux
  recommendation (§1.1) is reasoned from the general MIR literature and the stated character of
  dotbeat's target material, not from an actual test of either algorithm against real loops in this
  project's own sample library (`docs/research/09-sample-source-licenses.md`'s cleared kits would
  be the natural test set). Worth doing before committing to energy-only detection — the specific
  risk flagged in §1.1 (closely-spaced hi-hat patterns) is a real, testable failure mode, not a
  hypothetical.
- **The `source: 'auto' | 'manual'` provenance tag and its re-detection replace-policy (§3.2, §4.2)
  are this doc's own proposal, not verified against any prior-art system.** Ableton's own behavior
  when re-running auto-warp analysis over manually-adjusted markers ("Warp From Here" family of
  commands, research 16 §4) wasn't investigated deeply enough in this pass to confirm whether it
  follows the same "preserve manual, replace auto" policy or something more nuanced (e.g., asking
  the user, or only replacing markers past the re-analysis start point). Worth a closer look at
  Ableton's actual behavior here before implementation, not just this doc's own reasoning.
  Continuation on RA's dependency: if RA's grammar doesn't include a provenance-tag-shaped field at
  all, this policy has no way to be implemented as described and needs to be revisited.
- **This pass used ordinary web search, not the project's deep-research harness** (fan-out search →
  fetch → extract → 3-vote adversarial verify used in `docs/research/01-09`) — same posture research
  16 and 21 already flagged for the same reason (time prioritized on reaching a concrete scoping
  recommendation). The license findings (aubio GPLv3+, essentia.js AGPL/commercial) are drawn
  directly from each project's own licensing pages and are low-risk to rely on as-is; the algorithm-
  choice reasoning (§1.1) and the timing parameters suggested in §2 (hop sizes, threshold shape) are
  standard/textbook but not verified against dotbeat's own material, per the point above.
- **RA had not landed when this pass was written**, per the framing note at the top of this doc —
  every "Dependency on RA" subsection above is this doc's best independent design, not a confirmed
  reconciliation. Whoever builds RB for real should re-read RA's actual output first and treat every
  such subsection as a checklist of points to verify, not settled fact.

---

## 7. Recommendation — concrete next step

Sequence as two build slices, matching Tier 1/Tier 2 above:

1. **First buildable slice** (no dependency on RA landing): `detectTransients` core primitive
   (energy-based, §1.1/§4.2), populating `BeatAudioRegion.markers` with a `source: 'auto'`
   provenance tag; CLI/MCP surface; a waveform-overlay render of the resulting markers (natural
   pairing with Stream BC's own waveform-view scope, `docs/phase-23-plan.md`); a "split at nearest
   marker" convenience wrapper around the existing `splitAudioClip`. Exit test: detect transients on
   a real cleared drum loop from the project's own sample library, verify marker timing against
   the loop's actual hits (within a few ms), verify split-at-marker produces correctly-bounded
   clips.
2. **Second slice, gated on RA** (Tier 2, §5.2): wire markers into RA's piecewise-stretch playback
   path once it exists; add the `TransientPlayMode`-style enum (`Once | Repeat | Pingpong`,
   openDAW-derived, research 22); defer Transient Envelope past even this slice.

---

## Sources

[aubio.org](https://aubio.org/), [aubio/aubio COPYING](https://github.com/aubio/aubio/blob/master/COPYING),
[qiuxiang/aubiojs](https://github.com/qiuxiang/aubiojs), [essentia.js licensing](https://essentia.upf.edu/licensing_information.html),
[Essentia.js ISMIR/TISMIR paper](https://transactions.ismir.net/articles/10.5334/tismir.111),
[essentia.js onsets demo](https://mtg.github.io/essentia.js/examples/demos/onsets/public/),
[audiojs/beat](https://github.com/audiojs/beat), [Keavon/Web-Onset](https://github.com/Keavon/Web-Onset),
[Musical note onset detection based on a spectral sparsity measure, EURASIP JASMP](https://asmp-eurasipjournals.springeropen.com/articles/10.1186/s13636-021-00214-7),
[MDN: AnalyserNode](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode),
`src/core/document.ts` (`BeatAudioRegion`, `BeatAudioWarpMarker`, this repo, direct read),
`src/core/edit.ts` (`splitAudioClip`, this repo, direct read), `docs/format-spec.md` v0.10 audio-
region section (this repo), `docs/decisions.md` (License decision / GPL-engine-tier-closed, D9
presets-are-tooling, this repo), `docs/research/16-audio-clip-editing.md` §§1, 3, 4, 8 (this repo),
`docs/research/18-ableton-ui-architecture.md` (checked, no prior Beats-mode coverage beyond one
passing mention, this repo), `docs/research/22-opendaw-editing-workflow.md` §2.4 (`TransientPlayMode`,
this repo), `docs/phase-22-stream-ae.md` (this repo), `docs/phase-23-plan.md` (this repo).

# Research 25 — Warp markers + Complex-mode stretch: signalsmith-stretch integration shape

*2026-07-11. Stream RA of `docs/phase-23-plan.md`'s research batch. `docs/research/16-audio-clip-
editing.md` §8 named signalsmith-stretch as "the signalsmith-stretch dependency, a deliberately
separate future stream" and closed the Rubber Band vs. signalsmith-stretch license question, but
never scoped the integration itself — no WASM-binding shape, no engine wiring, no marker grammar.
Phase 22 Stream AE (`docs/phase-22-stream-ae.md`) then shipped the actual prerequisite: `warp:
'off' | 'repitch' | 'complex'` is real, parsed, validated grammar in `src/core/document.ts` today,
`'complex'` is a legal value the engine plays back unwarped (identical to `'off'`), and
`BeatAudioRegion.markers: BeatAudioWarpMarker[]` is reserved on the type but always `[]` — no
`marker` line grammar, no edit primitives, no engine consumption. This pass designs the concrete
grammar, edit primitives, and engine integration that turn `'complex'` from a reserved placeholder
into a real feature, re-verifies the signalsmith-stretch license/maintenance/WASM-availability
claim against current (2026-07) sources rather than trusting the 2026-07-11-dated research 16 pass
at face value, and gives a build-sequencing recommendation for the eventual build stream.*

## Verdict

**signalsmith-stretch remains the right choice, re-verified independently this pass** — MIT
license unchanged, an official first-party WASM/AudioWorklet web release (`web/` in the repo,
published on NPM as `signalsmith-stretch`, currently at `1.3.2`), and *active* maintenance (commits
as recent as January 2026, most other activity through 2025 — this is not an abandoned project).
Rubber Band's status is also unchanged: still GPLv2-or-later with a paid commercial dual-license,
still no first-party WASM build (third-party wrappers exist — `Daninet/rubberband-wasm`,
`delude88/rubberband-web` — and remain small/stale; `rubberband-web`'s last npm release was several
years ago with ~124 weekly downloads, not a maintained option). Nothing has changed since research
16 §6 that would flip the recommendation. See §1 for the full re-verification, including a real
2026 production data point (ACE-Step DAW's April 2026 integration of signalsmith-stretch via
AudioWorklet for real-time preview) that research 16 didn't have available.

**The integration shape is: use the *raw WASM stretch class* in an offline batch pass, not the
library's own AudioWorklet wrapper, and cache the result exactly where the engine already caches
decoded audio.** dotbeat's `ui/src/audio/engine.ts` is not built around continuous per-sample
worklet processing for audio-region playback — it's built around swapping a fully-decoded
`Tone.ToneAudioBuffer` into a `Tone.Player` at `contentStep === 0` (`buildAudioTrackVoice`,
`syncAudioTracks`, the `track.kind === 'audio'` branch in `tick()`). A warped region is,
structurally, just another decoded buffer — computed once (per `(media, in, out, markers)`
combination, not per playback), cached alongside the existing `audioBuffers` map, and played back
through the exact same `player.start(time, offset, duration)` call that already handles `off` and
`repitch`. signalsmith-stretch's real-time-streaming AudioWorklet wrapper is aimed at continuous
live playback with an operator turning a knob (e.g. ACE-Step's stated "real-time preview" use
case); dotbeat doesn't have that use case for the *committed, playing* clip today — its warp state
is edit-time data in a text file, not a live-turned knob. Real-time worklet processing becomes
worth adding later, specifically for an interactive *drag-a-marker* preview loop, but even there
the recommended default is a cheap uniform-rate approximation during the drag with a debounced
authoritative re-render on release, not a persistent worklet in the playback graph. See §3.

**The marker grammar is a direct structural sibling of the v0.9 automation point, with one
necessary addition automation doesn't need: an implicit start anchor, so a clip is never in an
underspecified warp state.** `marker <id> <sourceTime> <timelineTime>`, nested under the `audio`
line exactly where `auto`/`point` nests under `clip`, sorted canonically by `timelineTime`, legal
only when `warp === 'complex'`, validated for strict monotonicity on both axes. `region.in` at
`timelineTime = 0` is always the implicit first anchor (never itself a stored `marker` line) — this
single design choice is what makes `splitAudioClip` fall out with almost no new logic (§4.4) and
what makes 0 explicit markers a well-defined, harmless state (plays exactly like `off`, matching
the engine's current placeholder behavior exactly — no regression). See §4 for the full grammar,
validation rules, edit primitives, and the split-interaction subtlety that needs a deliberate rule
(hold the final segment's local rate past the last marker) to stay correct.

**Recommended build-stream scope**: split into two sequential slices, not one. Slice 1 is
format-only (grammar + edit primitives + parse/serialize/diff), gated behind `warp === 'complex'`,
zero new dependencies, zero DSP — this alone lets the GUI start building marker-add/move/remove
affordances against real data while the format shape gets proven, the same sequencing discipline
Stream AE itself used (audio-region format landed before repitch was wired, and repitch before
warp markers). Slice 2 adds the actual signalsmith-stretch dependency and the offline-render+cache
engine wiring, consuming the grammar Slice 1 already shipped. See §5 for the full sequencing
argument and what stays deliberately out of scope (a real-time worklet, Complex-Pro-equivalent
formant preservation, the `TransientPlayMode` three-way vocabulary research 22 found in openDAW,
Rubber Band as a quality fallback).

---

## 1. Re-verifying signalsmith-stretch, live, this pass

Research 16 §6 closed the Rubber Band vs. signalsmith-stretch question in favor of signalsmith-
stretch on license grounds (MIT vs. GPL/commercial) and web-release maturity (official first-party
WASM/AudioWorklet vs. third-party wrappers of a GPL library), current as of that pass. The task
brief for this stream explicitly asked not to assume that's still accurate — a library's license,
maintenance status, and ecosystem position are all things that can change. Re-checked directly
against the repo and package registry this pass, not re-derived from the prior doc:

| | Research 16 (prior pass) | This pass (re-verified) |
|---|---|---|
| License | MIT | **MIT, unchanged** — confirmed directly against `LICENSE.txt` in the repo |
| Stars/forks | 516 / 53 | **516 / 53** — essentially unchanged, consistent with a stable rather than viral project |
| Maintenance | "114 commits," no recency claim | **Active** — most recent commits dated January 24, 2026 (type-conversion/warning cleanup, a Linear-dependency version bump), with real feature commits (`outputSeek()` reflected pre-roll, `.flush()` behavior) as recently as August 2025. Not dormant. |
| Web/WASM release | "Official web release in the library's own `web/` directory... published on NPM" | **Confirmed directly**: `web/` contains a Makefile, `index.html`, `web-wrapper.js`, an `emscripten/` build dir, and a `release/` dist dir; NPM package `signalsmith-stretch` is real, currently **v1.3.2** |
| Production usage evidence | None found/cited | **New this pass**: ACE-Step DAW (`ace-step/ACE-Step-DAW`) integrated signalsmith-stretch for real-time preview via AudioWorklet, per an April 2026 GitHub issue thread — a second, independent, 2026-dated project actually shipping this library in a browser DAW context, not just documentation claims |
| Streaming API shape | Not detailed | **Confirmed**: `process(inputBuffers, inputSamples, outputBuffers, outputSamples)`, with `inputLatency()`/`outputLatency()` reported by the library itself rather than fixed constants — "you should be supplying input samples slightly ahead of the processing time... and you'll receive output samples slightly behind that." Configurable via `presetDefault()`/`presetCheaper()` or manual `.configure(channels, blockSamples, intervalSamples)` |

**Alternatives, re-checked rather than assumed absent:**

- **Rubber Band** — unchanged: still GPLv2-or-later with a paid commercial dual-license
  (`breakfastquay.com/rubberband/license.html`, re-fetched this pass, same terms). Still no
  first-party WASM build. `Daninet/rubberband-wasm` (third-party) remains small/unreleased;
  `delude88/rubberband-web` (a "ready-to-use AudioWorklet and WebWorker" wrapper) has a last npm
  publish years old (v0.2.1) and ~124 weekly downloads — a real package that exists, but not one
  with the maintenance signal signalsmith-stretch has. No change to research 16's conclusion here.
- **SoundTouchJS** (`@soundtouchjs/audio-worklet` and siblings) — genuinely new information this
  pass, not covered by research 16 at all. A pure-JavaScript (no WASM/Emscripten step) port of the
  classic SoundTouch WSOLA algorithm, with real published AudioWorklet packages; license moved from
  LGPL to **MPL-2.0** for the JS ports specifically (the upstream C++ SoundTouch itself is still
  LGPL-2.1). MPL-2.0 is weaker copyleft than LGPL (file-level, not link-level) and wouldn't be a
  hard blocker the way GPL is, but it's still a real license constraint dotbeat's MIT posture would
  have to explicitly accept, unlike signalsmith-stretch's MIT which needs no accommodation. More
  importantly: WSOLA is a time-domain algorithm, generally regarded as adequate for monophonic/
  percussive material but audibly worse than phase-vocoder-family algorithms (what signalsmith-
  stretch and Rubber Band both are) on complex/polyphonic full-mix material — exactly the "full
  mixes, complex multi-instrument material" case research 16 §1 identifies as Ableton's Complex
  mode's actual target. Worth knowing this option exists (a pure-JS path needs no WASM toolchain at
  all, which is a real simplicity win if quality ever proves insufficient elsewhere), but not a
  reason to change the recommendation — it's a fallback-of-a-fallback, one tier below Rubber Band
  in the "if signalsmith-stretch's quality proves insufficient" contingency research 16 §6 already
  scoped, not a replacement for it.
- **Hand-rolled phase vocoder** — not re-investigated in depth this pass; research 16 didn't
  seriously consider it either, and nothing found this pass changes that calculus. A production-
  quality phase vocoder with transient preservation is a multi-month DSP project on its own (it's
  the exact problem signalsmith-stretch, Rubber Band, and SoundTouch all already solve); building
  one from scratch to avoid a permissively-licensed, actively-maintained, first-party-WASM
  dependency has no justification here.

**Conclusion: no change to the library choice.** signalsmith-stretch, MIT, `npm install
signalsmith-stretch` (currently `1.3.2`), official WASM/AudioWorklet web release.

Sources: [Signalsmith-Audio/signalsmith-stretch (GitHub)](https://github.com/Signalsmith-Audio/signalsmith-stretch), [signalsmith-stretch README](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/README.md), [signalsmith-stretch commit history](https://github.com/Signalsmith-Audio/signalsmith-stretch/commits/main), [signalsmith-stretch on npm via jsDelivr](https://www.jsdelivr.com/package/npm/signalsmith-stretch), [signalsmith-stretch `web/` directory](https://github.com/Signalsmith-Audio/signalsmith-stretch/tree/main/web), [breakfastquay.com/rubberband/license.html](https://breakfastquay.com/rubberband/license.html), [Daninet/rubberband-wasm](https://github.com/Daninet/rubberband-wasm), [delude88/rubberband-web](https://github.com/delude88/rubberband-web), [rubberband-web on npm](https://www.npmjs.com/package/rubberband-web), [ACE-Step-DAW issue #1667 — dual-engine time-stretch, signalsmith-stretch real-time preview via AudioWorklet](https://github.com/ace-step/ACE-Step-DAW/issues/1667), [SoundTouchJS](https://github.com/cutterbl/SoundTouchJS), [@soundtouchjs/audio-worklet (npm)](https://www.npmjs.com/package/@soundtouchjs/audio-worklet), `docs/research/16-audio-clip-editing.md` §6 (prior pass, cross-checked against, not superseded).

---

## 2. WASM binding approach: use the official package directly, follow the codebase's own existing worklet-integration precedent

**Hand-writing bindings is not the right call here, and dotbeat doesn't need to decide this in a
vacuum — it already has a working, shipped precedent for integrating a WASM/AudioWorklet-based
audio engine, and signalsmith-stretch should follow the exact same pattern.**

`ui/src/audio/engine.ts` already runs `spessasynth_lib`'s `WorkletSynthesizer` for instrument
(SoundFont) tracks (Phase 14 Stream F). Read directly, the pattern is:

```ts
import { WorkletSynthesizer } from 'spessasynth_lib'
// Vite serves the AudioWorklet processor as a static, hashed-URL asset via the `?url` import:
import spessaWorkletUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url'
```

— a module-load promise cached once per `AudioContext` (`ensureAudioWorklet()`-shaped helper,
`ctx.audioWorklet.addModule(spessaWorkletUrl)`), and a hard requirement that every Tone.js node in
the graph share one **native** `AudioContext` (not Tone 15's `standardized-audio-context`-wrapped
one, whose `rawContext` isn't accepted by a real `AudioWorkletNode` constructor) — `engine.ts`'s
own comment states this explicitly: "Tone 15 wraps its context in standardized-audio-context, whose
`rawContext` is NOT a native `BaseAudioContext` — so we run Tone itself on a native `AudioContext`
that both engines share," pinned once via `ensureNativeContext()` before any node is created.

signalsmith-stretch's npm package ships the equivalent shape: a WASM binary plus JS glue (ESM/CJS)
in its distributed files, importable the same way spessasynth's processor script is — a bundler-
served static asset URL, loaded once, cached. **No hand-written bindings are needed or advisable**:
the library's own maintainer publishes the JS↔WASM boundary already (the "higher-level API" the
README describes, kept in sync with the C++ core); hand-writing Emscripten bindings from the raw
C++ header would mean re-deriving exactly what the npm package already ships, with no dotbeat-
specific advantage — the C++ API (`process(inputBuffers, inputSamples, outputBuffers,
outputSamples)`, `configure()`, `inputLatency()`/`outputLatency()`) is a plain streaming DSP
interface, not something requiring dotbeat-side customization to bind.

**One deliberate divergence from the spessasynth precedent, and why**: spessasynth's
`WorkletSynthesizer` is used *as* an `AudioWorkletNode` in the live graph, because MIDI synthesis
genuinely is continuous, indefinite real-time processing (notes can be held arbitrarily long,
driven by live scheduling). signalsmith-stretch, for dotbeat's actual use case (§3), should be
invoked as a **batch WASM call, not a live worklet node** — the stretch class runs synchronously
(or on a Worker, off the main thread) over a bounded, known-length buffer (the region's `in`-to-
`out` span) to produce one warped output buffer, then that buffer plays back through the existing
`Tone.Player`-based pipeline exactly like an unwarped region does today. This still needs the WASM
module load (`fetch` + `WebAssembly.instantiate`, or the npm package's own loader) and ideally the
same "load once, cache the promise" discipline `workletModulePromise` already establishes — but it
does **not** need `ctx.audioWorklet.addModule()` or a native-context requirement at all, because
nothing about a batch WASM call touches the live audio graph. This is a real simplification
relative to the spessasynth integration, not an oversight: only pick up the native-`AudioContext`/
`addModule()` machinery if/when a real-time worklet path is added later (§3's deferred case).

**Concrete integration shape**, extending the existing `AudioTrackVoice`/`audioBuffers` machinery
in `ui/src/audio/engine.ts` (not new architecture, an extension of what Stream AE already built):

```ts
import loadStretch from 'signalsmith-stretch' // exact export shape TBD at build time — the
// package's own npm README/dist should be read directly by whoever picks this up; the point here
// is the call shape, not the literal import line.

// Parallel to the existing `audioBuffers = Map<mediaId, ToneAudioBuffer>` content-addressed cache
// (Stream AE), keyed by a hash of everything that affects the warped output — NOT just mediaId,
// since the same source sample warped two different ways must not collide:
private warpedBuffers = new Map<string, Tone.ToneAudioBuffer>() // key: `${mediaId}:${in}:${out}:${markersHash}`
private warpedBufferPending = new Set<string>()

private async renderWarpedBuffer(mediaId: string, region: BeatAudioRegion, key: string): Promise<void> {
  const source = this.audioBuffers.get(mediaId) // already-decoded, from the existing loadAudioBuffer path
  if (!source) return // not loaded yet; syncAudioTracks() will retry once it is
  const stretch = await this.ensureStretchModule() // load-once-cache-the-promise, same discipline as workletModulePromise
  const warpMap = buildWarpMap(region) // §4's piecewise-linear (sourceTime -> timelineTime) function, inverted for rendering
  const outSamples = timelineStepsToSamples(warpMap.totalTimelineLength, this.ctx.sampleRate, doc.bpm)
  const output = renderThroughStretch(stretch, source, warpMap, outSamples) // batch process() loop, ch-by-ch
  this.warpedBuffers.set(key, new Tone.ToneAudioBuffer(output))
  this.warpedBufferPending.delete(key)
}
```

`tick()`'s existing `track.kind === 'audio'` branch needs exactly one new condition: when
`region.warp === 'complex'` **and** `region.markers.length > 0`, resolve the playback buffer from
`warpedBuffers` (keyed as above) instead of `audioBuffers`, kicking off `renderWarpedBuffer` the
same fire-and-forget way `loadAudioBuffer` already works if the key isn't cached yet (silently
playing nothing, or optionally falling back to the unwarped buffer while rendering, for that one
retrigger — a UX polish decision for the build stream, not a correctness one). `warp === 'complex'`
with **zero** markers keeps today's exact behavior (unwarped, using `audioBuffers` directly) —
free, by construction, no special-casing needed.

---

## 3. Real-time worklet vs. offline pre-stretch: offline, for the reasons the existing engine already establishes

This is the load-bearing architectural call, and dotbeat's own existing engine design answers it
more decisively than a from-scratch analysis would.

**dotbeat's audio-region playback model is fundamentally buffer-swap, not stream-process.**
`buildAudioTrackVoice()` creates one `Tone.Player` per audio-kind track; `tick()`'s audio-kind
branch, at `contentStep === 0` (the loop-wrap signal every content type tiles on), does `if
(voice.player.buffer !== buf) voice.player.buffer = buf` then `player.start(time, region.in,
duration)` — this is playing a **fixed, fully-decoded buffer** via the native
`AudioBufferSourceNode.start(when, offset, duration)` semantics Tone.Player wraps. There is no
per-sample real-time DSP happening on audio-region content today (`repitch` mode is a
`playbackRate` scalar on the same node, not a stream processor). Grafting a persistent, continuous
AudioWorklet stretch node onto this model means either (a) replacing `Tone.Player` with a custom
`AudioWorkletNode`-based player specifically for `complex`-warped regions — a second, structurally
different playback path existing alongside the first for every other warp mode, doubling the
surface the loop-retrigger/mute/solo/level-tap logic has to handle correctly — or (b) feeding the
worklet a continuous sample stream keyed to the same `contentStep === 0` retrigger logic, which
reintroduces exactly the buffering/latency bookkeeping (`inputLatency()`/`outputLatency()`,
"supply input slightly ahead, receive output slightly behind") signalsmith-stretch's own README
flags as real-time-specific overhead that a batch call sidesteps entirely.

**Offline pre-stretch avoids all of that, and fits the existing cache-by-content-address idiom the
engine already established for `audioBuffers` itself.** A warped region's output is fully
determined by four things: the source samples (`media` → already decoded once, cached), the
in/out bounds, and the marker list — none of which change *during* playback (they're edited, then
committed to the document; playback just reads whatever's current). That's exactly a cacheable,
content-addressed computation, the same shape `audioBuffers` already is for the un-warped decode
step. Render once (async, off the render-tick critical path, the same "fire-and-forget, pick up the
result next time it's needed" discipline `loadAudioBuffer`/`instrumentPending` already use for
their own async loads), cache the result, then let every other part of the existing playback
pipeline (loop-wrap retrigger, mute/solo gain, level-tap metering, gain automation ramps) work
completely unchanged — a warped buffer is just another buffer.

**Latency/CPU tradeoff, stated plainly**: real-time worklet processing pays signalsmith-stretch's
processing cost on every playback pass and introduces its own input/output latency into the signal
path (unquantified exactly by this pass — the library reports it via `inputLatency()`/
`outputLatency()` rather than publishing a fixed number, and no independent benchmark was run this
round; flagged as an open question, §6). Offline pre-stretch pays that same cost exactly once per
edit (when a marker moves, in/out changes, or the source media changes) and then plays back at
**zero** additional runtime cost or latency — it's a pre-decoded buffer indistinguishable, from the
playback engine's perspective, from an unwarped one. For a DAW whose format is edit-then-play
(edits happen in the document, playback reads the committed document), not perform-live-while-
recording, this tradeoff strongly favors offline rendering. It would favor a real-time worklet only
if dotbeat needed the warp ratio to change *during* a single continuous playback pass in response
to something the engine can't precompute — e.g. a live tempo-automation curve warping audio in real
time. dotbeat's engine is explicitly constant-tempo today (`format-spec.md`: "the playback engine
is still constant-tempo 4/4 only... NOT yet interpreted by the audio engine," Phase 22 Stream AG's
own scoping note on `BeatTimeSignature`) — there is no live-changing-warp-ratio use case to design
for yet, so there's no forcing function toward the real-time path.

**The one place a worklet-shaped (or at least continuous-feeling) real-time path earns its keep is
interactive marker-drag preview** — a user dragging a warp marker in the GUI wants to hear the
result move smoothly, not wait for a full offline re-render on every mouse-move frame. The
recommended answer there is *not* "stand up a persistent AudioWorklet stretch node" but a cheaper
two-tier approach: during the drag, approximate with the existing `playbackRate`-scalar mechanism
`repitch` mode already has (compute a single uniform rate implied by the marker's live position,
apply it via `player.playbackRate` the same way `repitch` already does — cheap, already-built,
audibly "close enough" for a drag preview) and debounce a real `renderWarpedBuffer` call to replace
it with the authoritative piecewise-warped buffer once the drag settles (pointer-up, or a short
idle timeout). This reuses two mechanisms the engine already has (`playbackRate` scalar,
async-cache-and-swap) instead of adding a third (persistent real-time worklet), and only the
build stream that actually implements marker-drag GUI needs to build it — it's cleanly separable
from the core marker-format + offline-render slice (§5).

---

## 4. The warp-marker format grammar

### 4.1 The line itself

Nested under the `audio` line, at the same indent level `auto`/`point` lanes already use, legal
**only** when the enclosing region's `warp` is `complex`:

```
track solo Solo #e5c07b audio
  clip take-a
    audio smp_drumloop 0 8 0 complex 1
      marker m1 2.0 1.5
      marker m2 5.0 4.0
    auto solo.gain
      point p1 0 -3
```

- **`marker <id> <sourceTime> <timelineTime>`** — stable id (D6, same slug discipline as `point`
  ids), `sourceTime` in seconds into the **source media** (same axis `BeatAudioRegion.in`/`out`
  already use — a marker's `sourceTime` must be checked against those bounds, not against the
  document's tempo), `timelineTime` in fractional 16th steps from the **clip's own start** (the
  same unit/origin `BeatAutomationPoint.time` already establishes — this is *why* the reserved
  type comment calls markers "structurally the same shape a v0.9 automation point already
  establishes": both fields directly reuse existing axes the format already has vocabulary for,
  nothing new is invented at the primitive-type level, only at the grammar/validation level).
- **The implicit start anchor**: `(sourceTime = region.in, timelineTime = 0)` always exists and is
  never itself a `marker` line — it's derived from fields the region already carries. This is the
  one place this grammar deliberately does NOT mirror automation points (which have no implicit
  first point; a lane's value before its first point is undefined/held). An audio region's warp
  map cannot have that gap: `region.in` unambiguously plays at the clip's `timelineTime = 0` in
  every warp mode today (`off`, `repitch`), so `complex` inherits the same guarantee rather than
  requiring the user to place a redundant marker exactly at the region's own start every time.
- **Zero markers is a fully legal, common state**: an audio-track clip freshly switched to
  `warp = complex` has `markers: []`. This degenerates to unwarped native-rate playback —
  identical, byte-for-byte in output, to today's already-shipped placeholder behavior for
  `complex` ("the engine plays it back unwarped ... until that stream lands," Stream AE's doc
  comment). Building the marker grammar changes nothing about existing documents or the
  already-documented fallback; it only adds a NEW legal state (`markers.length > 0`) that actually
  engages the stretch DSP.

### 4.2 Ordering and canonical form

- **Canonical ordering: by `timelineTime` ascending, `id` tiebreak** — the same convention
  automation points use for their own `time` field (v0.9's "points within a lane serialize sorted
  by `(time, id)` ascending"), because `timelineTime` is the axis a human reading the file
  top-to-bottom experiences as "reading order" (the order the clip plays them in), matching how
  notes/hits/automation points are already ordered by their own playback-time axis, not by
  creation order or source-file position.
- **Monotonicity is a hard validation rule, not just a convention**: both `sourceTime` and
  `timelineTime` must be **strictly increasing** across the implicit start anchor plus every
  explicit marker, in canonical (`timelineTime`-sorted) order. A marker list that isn't strictly
  monotonic on both axes doesn't describe a playable warp map (audio can't play backwards or skip
  within this mode — reversed/frozen playback, if ever wanted, is a different, explicitly-named
  feature, not an emergent property of a malformed marker list) — reject at parse and edit time,
  same "fail loud, one canonical form per state" discipline (D4) the `rate`-must-be-1 rule already
  established for this exact type.
- **Bounds validation**: every marker's `sourceTime` must be strictly between `region.in` and
  `region.out` (not equal to either — the implicit start anchor already owns `region.in`, and
  `region.out` is never an anchor point at all, see §4.3's extrapolation rule). A marker outside
  the region's own trimmed span, or coincident with `region.in`, is a parse/edit-time error with a
  message naming the actual bound violated (matching the existing `validateAudioRegionFields`
  error-message style in `src/core/edit.ts`).
- **Markers only legal when `warp === 'complex'`**: mirrors the existing `rate`-must-be-1-unless-
  `repitch` canonical-form rule exactly. `setClipAudioRegion` switching `warp` away from
  `'complex'` must clear `markers` to `[]` (same "one canonical form per state, applied
  automatically" move the existing `rate` reset already makes) — a document can never be in the
  state "warp is `off`/`repitch` but markers is non-empty."
- **Canonical elision**: no `marker` lines at all when `markers.length === 0` (the common/initial
  case) — same discipline as v0.9's empty-automation-lane elision, just simpler here since there's
  no wrapping `auto`-style header line to elide along with it; `marker` lines sit directly under
  `audio`, so zero markers is simply zero lines, and every pre-this-stream file (where `markers` is
  always `[]`) parses completely unchanged.

### 4.3 What happens past the last marker

Between two consecutive anchors (the implicit start, then each explicit marker in canonical order),
the local playback rate is whatever's needed to make that segment's source-time span exactly fill
that segment's timeline-time span — this is the actual definition of "warp," matching research 16
§4's description of Ableton's own behavior ("time-varying playback rate within a single clip... a
clip with three warp markers has at least two independently-stretched segments") and openDAW's
independently-arrived-at `WarpMarkerBox` model (research 22 §2.4: "a single musical-time↔real-time
pair per marker... interpolation between markers is presumably linear"). **Past the last explicit
marker (or past the implicit start anchor, if there are zero markers), the local rate of the FINAL
segment holds constant** until `region.out` is reached, at which point playback stops (identical
stop semantics to `off`/`repitch` today — `region.out` is where the region always ends, regardless
of warp mode). This is a deliberate, necessary rule (not an arbitrary convenience): it's what makes
`splitAudioClip` correct with no new marker-synthesis logic, worked through concretely next.

### 4.4 Split-at-point interaction

`splitAudioClip` (`src/core/edit.ts`) already partitions gain-automation points by time and retimes
the second half relative to its own new start (Phase 22 Stream AE's implementation). Warp markers
need the identical treatment, plus one subtlety the automation case doesn't have:

- **Partition by `timelineTime` against `atSteps`** (the same split-position parameter the
  existing automation partition already uses): markers with `timelineTime < atSteps` go to the
  first half unchanged; markers with `timelineTime >= atSteps` go to the second half, retimed via
  `timelineTime - atSteps` (identical shape to `partitionAutomation`'s `p.time - atSteps` for the
  "after" case).
- **The second half's implicit start anchor is correct for free.** Splitting already sets the
  second half's `region.in = sourceSplit` (the source-time equivalent of `atSteps`, computed via
  the region's warp map the same way today's non-warped split computes `sourceSplit = in + atSteps
  × stepSeconds × rate`, just generalized to invert the piecewise-linear warp map instead of a
  single `rate` scalar). Since the implicit start anchor is *defined* as `(region.in, 0)`, and the
  second half's `region.in` is now exactly the split point, its implicit anchor automatically lands
  exactly where playback was at the moment of the cut — no synthetic marker needs inserting.
- **The first half needs one synthetic marker inserted, UNLESS the split point already coincides
  with an existing marker or falls in the trailing-extrapolation region past the last marker.**
  This is the one real subtlety: if the split point falls strictly *inside* an interior segment
  (between two explicit markers, or between the implicit start and the first marker), §4.3's
  "extrapolate the FINAL segment's rate" rule would otherwise use the wrong segment's rate for the
  truncated first half (its new final segment, after truncation, would end at whatever marker
  preceded the split — the wrong boundary, carrying the wrong local rate). The fix: compute the
  split point's exact `(sourceSplit, atSteps)` pair via the pre-split warp map (an ordinary linear
  interpolation within whichever segment brackets `atSteps` — no different in kind from computing
  an interpolated automation value between two points, just on the marker axis) and insert it as
  the first half's new trailing marker (a no-op if a marker already exists exactly there). This
  keeps the first half's final segment identical in slope to whatever was actually playing at the
  instant of the cut, so playback across a split is audibly seamless — the same "warp markers
  survive a split, attached to whichever segment they fall in" property research 16 §2 established
  for Ableton, made concrete for dotbeat's two-independent-clips split model.

### 4.5 Edit primitives

Four primitives, directly parallel to `addAutomationPoint`/`moveAutomationPoint`/
`removeAutomationPoint`/`setAutomationPoint` in `src/core/edit.ts`, each requiring
`clip.audio.warp === 'complex'` (a `checkWarpMarkersAllowed`-shaped guard, same role
`checkAutomatableParam` plays for automation):

- **`addWarpMarker(doc, trackId, clipId, { sourceTime, timelineTime, id? })`** — mints the next
  free `m<n>` id if omitted (same minting convention `addAutomationPoint` uses for `p<n>`),
  validates monotonicity against the full canonical-ordered list (not just adjacent neighbors —
  inserting between two existing markers must still satisfy strict ordering against both), and
  bounds-checks `sourceTime` against `region.in`/`region.out`.
- **`moveWarpMarker(doc, trackId, clipId, markerId, { sourceTime?, timelineTime? })`** — updates
  one or both fields on an existing marker, re-validating monotonicity against the marker's new
  neighbors post-move (a move that would cross an adjacent marker on either axis is rejected, the
  same "fail loud rather than silently produce an invalid state" stance as everything else in this
  format).
- **`removeWarpMarker(doc, trackId, clipId, markerId)`** — unlike automation's "removing the last
  point drops the lane," there's no equivalent lane to drop here (markers live directly on the
  region, and zero markers is already a fully valid state per §4.1) — this is a strictly simpler
  primitive than `removeAutomationPoint`.
- **`setWarpMarker`** — add-or-move by id, mirroring `setAutomationPoint`'s ergonomics for the CLI/
  GUI drag-handle caller that doesn't want to know in advance which case it's in.

**`setValue` path**: `<track>.clip.<id>.audio.marker.<marker-id>.sourceTime` /
`....timelineTime`, extending the existing `<track>.clip.<id>.audio.<field>` trim-field pattern one
level deeper (mirrors how `<track>.note.<id>.<field>` already addresses one note's fields). **CLI/
MCP**: `beat warp-marker <file> <track> <clip> <source-time> <timeline-time> [--id m1]` /
`beat_warp_marker` (add-or-move by id, exact shape of `beat automate`/`beat_automate`); `beat
warp-marker-remove <file> <track> <clip> <marker-id>` / `beat_warp_marker_remove`.

### 4.6 Diff

Itemized per-marker, matched by id — the same "a knob move mid-clip is a specific musical fact
worth naming, not noise" reasoning v0.9 automation points already established, applied to the new
axis: `solo: clip "take-a" warp marker added m2 (source 5.0s, timeline step 4.0)`, `... marker m1
timelineTime 1.5 -> 2.0`, `... marker m2 removed (source 5.0s, timeline step 4.0)`. A marker move is
exactly as diff-worthy as an automation-point move — both are "the user reshaped how this clip
plays over time," the format's existing stance on why automation gets itemized rather than
re-snapshotted.

---

## 5. Build sequencing recommendation

**Two sequential slices, not one combined stream** — mirroring how Stream AE itself sequenced the
audio-region format ahead of repitch, and repitch ahead of (deferred) warp markers, rather than
shipping everything in one pass.

### Slice 1 — format only (no new dependency, no DSP, no code touching the audio graph)

Scope: `BeatAudioWarpMarker`'s grammar (§4.1-4.2), the four edit primitives (§4.5), parse/
serialize/diff (§4.6), and `splitAudioClip`'s marker-partition update (§4.4) — all pure
`src/core/` work, zero `ui/src/audio/engine.ts` changes beyond nothing (markers with `warp ===
'complex'` still play unwarped exactly as they do today, since no engine consumption is wired yet).
This is genuinely low-risk, format-shaped work the same size class as v0.9's automation-point
addition, and it unblocks the GUI to start building marker-add/move/remove/drag affordances against
real, persisted data (numeric inspector fields first, same MVP-honesty stance Stream AE took for
trim — "numeric fields only, no waveform" was an accepted v1 gap there too) well before the DSP
dependency lands. Verification: format round-trip + edit-primitive tests, same shape as
`test/format-v10-audio.test.ts` — no live-audio verification needed yet, since nothing audible
changes.

### Slice 2 — signalsmith-stretch integration (the real DSP work)

Scope: the npm dependency, the WASM-module-load-once-cache discipline (§2), `renderWarpedBuffer`
and the `warpedBuffers` cache (§2's concrete shape), `tick()`'s one new buffer-resolution branch,
and (separable, GUI-owned, can slip independently) the drag-preview two-tier approach (§3's
uniform-rate-during-drag / debounced-authoritative-render-on-release). This is where the actual
stretch-quality risk and CPU-cost risk live, and where live verification (rendered-audio spectral/
timing checks, the same discipline `ui/verify-phase22-audio-region.mjs` already established for
repitch/trim/split/gain) actually matters — a piecewise warp is a strictly harder thing to verify
than a single constant-rate repitch, and deserves its own dedicated live-verification pass rather
than reusing Stream AE's script unmodified.

### Explicitly deferred past this stream (not this stream's job to build)

- **A real-time AudioWorklet playback path** — only justified by a live-changing-warp-ratio use
  case dotbeat doesn't have yet (constant-tempo engine); the interactive-drag-preview need is
  better served by the cheap two-tier approximation in §3, which doesn't require it at all.
- **Complex-Pro-equivalent formant preservation** — signalsmith-stretch's own documented sweet spot
  is "modest changes (0.75x-1.5x)"; formant-critical vocal-grade stretch is exactly the case
  research 16 §6 already flagged as the deliberate, budgeted, paid Rubber Band fallback if real use
  demonstrates a real gap — not a default assumption, and not this stream's job to pre-empt.
- **The `TransientPlayMode` three-way vocabulary (`Once`/`Repeat`/`Pingpong`)** research 22 §2.4
  found in openDAW's `AudioTimeStretchBox` — genuinely relevant future context (it answers "what
  happens to a percussive hit that falls between two warp markers when the segment gets
  compressed/stretched"), but that's squarely `docs/phase-23-plan.md`'s own RB stream (research/26,
  "Beats-mode transient slicing"), sequenced explicitly *after* this one in the plan. Worth the RB
  researcher reading §4 of this doc before starting, since the marker grammar it'll build on is
  now concretely specified here — but not something this stream should reach into and build early.
- **Rubber Band as a fallback** — no new decision needed; research 16 §6's existing framing
  ("a deliberate, paid, M4-tier decision if real usage shows signalsmith-stretch's quality ceiling
  is audibly insufficient") still holds and doesn't need re-litigating until there's real evidence.
- **Tape-emulation knobs** (flutter/wow/noise/saturation baked into the audio-clip player) — a
  separate, already-tracked roadmap row (`research/21-opendaw-devices-effects.md`), unrelated to
  warping specifically.

---

## 6. Open questions (honest gaps, not resolved by this pass)

- **No independently-run latency/CPU benchmark of signalsmith-stretch in a browser context.** This
  pass confirms the library reports `inputLatency()`/`outputLatency()` and offers `presetDefault()`/
  `presetCheaper()` tradeoffs, but no concrete millisecond or CPU-percentage figures were measured
  against dotbeat's own material (or any material) this round — the offline-rendering
  recommendation in §3 makes this less urgent than it would be for a real-time path (a slower
  render just means a longer async wait before the warped buffer is ready, not a playback glitch),
  but the eventual build stream (Slice 2) should measure real render time for representative clip
  lengths before shipping, to decide whether re-render needs to move off the main thread (a Web
  Worker) or is fast enough to run inline.
- **The exact shape of signalsmith-stretch's npm package export surface** (function/class names,
  whether it's a default export or named exports, exact TypeScript types if any) was not read
  file-by-file this pass — confirmed the package exists, is versioned, and contains WASM + JS glue,
  but the literal `import` line and call signature in §2's code sketch is illustrative, not
  verified against the actual package source. Whoever builds Slice 2 should read the installed
  package directly before writing the integration code.
- **Whether `region.out` should ever itself be reachable as an implicit END anchor** (symmetric to
  `region.in`'s implicit start anchor) was considered and deliberately rejected in favor of the
  "extrapolate the final segment's rate past the last marker" rule (§4.3), because an implicit end
  anchor would force every `complex`-warped clip to fully define its timeline duration up front
  (via where `region.out` "lands" on the timeline), which doesn't compose cleanly with editing
  `out` after markers already exist (every trim would need to rescale the trailing segment's rate,
  a much less predictable edit than "trimming just changes when it stops"). Flagged as a real
  design choice, not researched against Ableton/openDAW behavior in exhaustive detail — worth a
  second look if the build stream's live verification surfaces an unintuitive result at the tail
  of a warped clip.
- **This pass used ordinary web search and direct GitHub/npm page fetches, not the project's deep-
  research harness** (fan-out search → fetch → extract → 3-vote adversarial verify used in
  `docs/research/01-09`). Findings here are drawn from primary sources (the library's own repo,
  license page, npm listing, commit history) rather than secondhand summaries, which is a stronger
  basis than research 16's own admitted "ordinary web search... practitioner/blog sources" caveat
  for its warp-mode survey, but this pass does not carry the "3-0 vote" confidence marking either.
  If the license/maintenance conclusion becomes load-bearing for an actual purchase/commit decision
  (e.g. if Rubber Band's commercial license is ever seriously considered), re-verify directly
  against the source rather than this document at that time.

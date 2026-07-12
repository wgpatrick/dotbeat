# Phase 23 Stream BE — Quick FX bundle: Auto Filter / Auto Pan / Tremolo + Utility + Redux downsampling

*2026-07-11.* Builds `docs/research/17-track-fx-arsenal.md` §5's "deferred, with reasons" quick
bundle: four near-free Tone.js-built-in wraps (Auto Filter, Auto Pan, Tremolo, Utility) plus
Redux's downsampling half (a small hand-built decimator — Tone.js has no built-in Rate/Jitter
node). Built against `main` after Phase 22 Stream AA (the ordered/reorderable per-track effect
chain, `docs/phase-22-stream-aa.md`) and Stream AC (the first four extended-arsenal inserts,
`docs/phase-22-stream-ac.md`) had already merged and reconciled — this stream's four new types are
ADDITIVE entries in Stream AA's reorderable `EffectType` mechanism directly, not a new parallel
mechanism, and deliberately does NOT repeat Stream AC's fixed-tail shape (see "Two possible shapes"
below).

## Two possible shapes, and why this stream took the other one

By the time this stream started, the codebase already had two different "how does a new insert
type get added" precedents living side by side in `ui/src/audio/engine.ts`:

1. **Stream AA's reorderable chain** — `EffectType`/`EFFECT_TYPES`/`BeatEffect` in
   `src/core/document.ts`, one `effect <id> <type> [bypassed]` line per instance, an
   `EffectRuntime` map keyed by id, built/reconciled lazily by `reconcileEffectChain()` whenever the
   track's declared list changes shape. Real per-instance bypass (spliced out of the graph
   entirely), real reordering, real add/remove.
2. **Stream AC's fixed tail** — `saturator -> chorus -> phaser -> pingPong`, wired unconditionally
   in `buildSynthChain()`/`getDrumBus()` for every synth AND drum track, entirely outside the
   `effects` list. Stream AC's own doc is explicit that this was a scope choice forced by
   sequencing (it was built against `main` at `d6b9aac`, *before* Stream AA's rework landed, per
   its own note: "reconciling the four new stages into sibling Stream AA's reorderable-effect-chain
   rework is explicit merge-time work, not scoped here"), and `SynthChain`'s own field comment
   (pre-existing, in `engine.ts`) names the gap directly: *"a real follow-up: extending EffectType
   would let them join the reorderable chain too."*

This stream is exactly that follow-up, for its own four types. Auto Filter, Auto Pan, Tremolo, and
Utility are added as new `EffectType` members (`autoFilter`/`autoPan`/`tremolo`/`utility`),
reachable through `addEffect`/`removeEffect`/`moveEffect`/`setEffectEnabled` — the same primitives
`eq3`/`comp`/`distortion`/`bitcrush` already use, with zero new CLI/MCP verbs and zero new daemon
routes (the four existing `/effect-*` routes and `beat effect-add` already generically accept any
`EFFECT_TYPES` member). Two consequences of picking this shape over Stream AC's:

- **Synth-tracks-only, honestly.** Stream AA's `effects` field is synth-tracks-only by design
  (`BeatTrack.effects`'s own comment: "drum-bus insert ordering is out of this stream's scope").
  Since these four ride that exact mechanism, they are ALSO synth-tracks-only — no drum-bus wiring
  was added for them (unlike Stream AC's saturator/chorus/phaser/pingPong, which Stream AC
  deliberately wired to both `SynthChain` and `DrumBus` to keep the two track kinds consistent with
  each other). The four new `PARAM_GROUPS` panels this stream adds are `kinds: ['synth']` only, not
  `['synth', 'drums']`, to avoid showing decorative knobs with no engine wiring behind them on a
  drum track.
- **A track only gets one of the four new types by an explicit add.** They are not part of
  `defaultEffectChain()` — see the next section for why that had to be a deliberate, verified
  correctness fix rather than an accident waiting to happen.

## The `defaultEffectChain()` correctness trap, and how it was avoided

Before this stream, `EFFECT_TYPES` (every legal type a `.beat` file may declare) and the four types
`defaultEffectChain()` returns (the migration target for every pre-v0.10 file, and the canonical-
elision baseline for every synth track that's never touched its chain) were the SAME four values —
`defaultEffectChain()` was implemented as `EFFECT_TYPES.map(type => ({id: type, type, enabled:
true}))`. Widening `EFFECT_TYPES` to eight without also touching `defaultEffectChain()` would have
silently widened the default chain too: every existing `.beat` file in the repo, every test
fixture, and every freshly-created track would suddenly gain `autoFilter`/`autoPan`/`tremolo`/
`utility` entries on next parse/serialize — exactly the kind of silent format-wide behavior change
`docs/phase-22-stream-aa.md`'s whole migration section was built to prevent.

Fixed by introducing a separate, explicitly frozen `DEFAULT_EFFECT_TYPES` constant (`src/core/
document.ts`, not exported) holding exactly the original four, with `defaultEffectChain()` mapping
over that instead of the now-widened `EFFECT_TYPES`. `EFFECT_TYPES` is "every legal type"; the new
constant is "what an untouched track's chain looks like" — two different things that happened to
coincide before this stream and no longer do. Verified directly:
`test/format-v10-stream-be-effects.test.ts`'s first test asserts `EFFECT_TYPES` has 8 members while
`defaultEffectChain()` still returns exactly the original 4, and a second test confirms a freshly
created synth track still emits zero `effect` lines (the widened enum changed nothing about what
"default" serializes to).

## Auto Filter / Auto Pan / Tremolo — thin, deliberately lean wrappers

Research 17 §5's own framing: these three's *sonic capability* already exists via the shared
`lfoDest`/`lfo2Dest` modulation matrix (`cutoff`/`pan`/`amp` destinations on LFO1/LFO2) — the value
of a dedicated device is Ableton-authentic naming and control **independent of the two shared
LFOs** (a third, fourth, and fifth modulation source, each with its own rate/depth, addressable
without stealing LFO1 or LFO2 from whatever else a patch is already using them for), not new sound.
Built accordingly — one Tone.js effect class each, `entry === exit` (like `eq3`/`distortion`, no
internal dry/wet fan-in node pair needed since each Tone class already owns its own `wet` Signal):

| Effect | Tone.js class | New fields | Notes |
|---|---|---|---|
| Auto Filter | `Tone.AutoFilter` | `autoFilterRate` (Hz), `autoFilterDepth` (0-1), `autoFilterOctaves`, `autoFilterBaseFrequency` (Hz), `autoFilterType` (lowpass\|bandpass\|highpass — reuses the synth's own `filterType` enum values), `autoFilterMix` | `.start()` required (LFOEffect base) |
| Auto Pan | `Tone.AutoPanner` | `autoPanRate` (Hz), `autoPanDepth` (0-1), `autoPanMix` | `.start()` required |
| Tremolo | `Tone.Tremolo` | `tremoloRate` (Hz), `tremoloDepth` (0-1), `tremoloSpread` (degrees, 0-180), `tremoloMix` | `.start()` required; STEREO effect — `spread=180` (the default) puts the L and R channel LFOs in exactly opposite phase (`Tremolo.ts`'s own `spread` setter: `lfoL.phase = 90 - spread/2`, `lfoR.phase = spread/2 + 90`) |

All three follow the same `*Mix = 0` insert-bypassed convention every other insert in dotbeat
uses (defaults to 0, so adding one of these to a chain is inert until a user explicitly raises
its Mix — consistent with `compMix`/`distortionMix`/`bitcrushMix`/Stream AC's four). No LFO-shape
or sync options were added (Tone.js's `AutoFilter`/`AutoPanner`/`Tremolo` classes don't expose a
`type` beyond the base sine/square/etc. waveform choice their LFOEffect/StereoEffect base already
carries as `type`, and this stream didn't add a field for it — keeping these lean per the brief's
explicit instruction, and matching the "no LFO-destination additions" scope cut Stream AC made for
its own four new inserts).

## Utility — `Tone.StereoWidener` + a static gain trim, no Mix field

`utilityWidth` (0 = all mid/mono, 1 = all side/max stereo, **0.5 = neutral/no-change**, the
canonical default) wraps `Tone.StereoWidener` directly; `utilityGain` is a static dB trim via
`Tone.Volume` chained after it. Deliberately **no Mix field** — like `eq3`, this insert has no
wet/dry knob of its own (its two params ARE the effect, not something to blend against a dry
signal), so the chain's per-instance `enabled`/bypass token (Stream AA's real routing bypass) is
its only "off". `0.5`/`0` (width/gain) is chosen as the canonical elided default specifically
because `0.5` is `Tone.StereoWidener`'s own documented neutral point ("0 = 100% mid, 1 = 100% side,
0.5 = no change" — `node_modules/tone/Tone/effect/StereoWidener.ts`), not an arbitrary dotbeat
convention layered on top; the format already has precedent for a non-zero canonical default
(`pingPongCrossFeed`'s default is `1`, not `0` — see `docs/phase-22-stream-ac.md`), so this doesn't
break the elision discipline, just uses the value that's actually neutral for this DSP.

**A genuinely mono source has nothing for Utility to widen** — this is documented, expected DSP
behavior (real DAWs behave identically), not a bug. `docs/product-roadmap.md`'s own live
verification (below) deliberately uses a wide-unison patch (`unisonVoices`/`unisonWidth`, which pan
osc2/osc3/the unison pairs across L/R independently of the main voice) so there's real pre-existing
stereo content for the widener to act on.

## Redux: a field on `bitcrush`, not a fifth new `EffectType`

This was the one open design question the brief flagged explicitly: does Redux's downsampling half
become a new `EffectType`, or a new field on the existing `bitcrush` type? **Decision: a new field
(`bitcrushRate`) on the existing `bitcrush` type.** Reasoning:

- **Ableton's own Redux is one device with two dimensions**, not two devices — "Bit Depth" and
  "Sample Rate" (its actual UI labels) sit on the same panel with one shared Dry/Wet knob. Modeling
  it as two independently-addable, independently-bypassable dotbeat insert TYPES would invent a
  distinction the real device this is modeled on doesn't have, and would let a user add
  `bitcrushRate`-only or `bitcrushBits`-only instances that don't correspond to anything Ableton's
  Redux (or any real hardware bitcrusher/sample-rate-reducer this research is grounded in) actually
  offers as separable devices.
- **dotbeat's `bitcrush` type already owns the bit-depth half** (`bitcrushBits`, `bitcrushMix`) —
  adding a sibling `bitcrushRate` field to the SAME type is the smaller, more honest change, and it
  means every existing `.beat` file with a `bitcrush` insert already has a coherent place for the
  new field to live (no migration, no new grammar line, just one more optional `SYNTH_FIELDS` row —
  the exact same "one table, many consumers" pattern every other optional field in the format
  already uses).
- **A new `EffectType` would need its own id/bypass/reorder position independent of `bitcrush`'s**,
  which is exactly the two-devices-with-independent-Dry/Wet shape the previous bullet argues
  against. Keeping it a field sidesteps that entirely: bit-depth and rate reduction share one
  chain-position, one id, one bypass flag, and — per the next point — one Dry/Wet knob.

**`bitcrushRate` is gated by the SAME `bitcrushMix` as bit-depth reduction**, not a second Mix
field. Implemented via a redesign of `bitcrush`'s `EffectRuntime` (`ui/src/audio/engine.ts`):
previously `bitcrush.wet` (the `Tone.BitCrusher`'s own internal dry/wet Signal) was driven directly
by `bitcrushMix`; now an OUTER dry/wet Gain pair (`bitcrushDry`/`bitcrushWet`, the same convention
`comp`'s `compDry`/`compWet` already established) wraps BOTH the downsampler stage and the
`BitCrusher` together, with `bitcrush.wet` itself forced to `1` (always fully wet internally) so
the outer pair is the only blend that matters:

```
inN --dry----------------------------> out
inN --> [downsampler] --> BitCrusher --wet--> out
```

This means `bitcrushRate` set to a non-1 value with `bitcrushMix` still at its default `0` is
correctly, honestly inert — matching every other insert's "0 = off" contract, now covering both
dimensions of this one device instead of just one.

### The downsampler itself: a raw `ScriptProcessorNode`, not a custom `AudioWorklet`

Research 17 §5.6 flagged that Tone.js has no built-in Rate/Jitter node, so this needed a small
hand-built downsampler. Two real options existed: a custom `AudioWorkletProcessor` (the modern,
non-deprecated approach — and the one `Tone.BitCrusher` itself uses internally for bit-depth
reduction, via Tone.js's own internal, NOT publicly exported, `ToneAudioWorklet` base class and a
blob-URL module-registration dance), or a `ScriptProcessorNode` (deprecated, but still implemented
by every browser this project targets, and — the deciding factor — **synchronous to construct**,
with no `addModule()`/blob-URL registration race to handle. `Tone.BitCrusher`'s own worklet has a
real async-readiness window (the node isn't wired into the graph until its `addAudioWorkletModule`
promise resolves); replicating that machinery by hand for one small decimator would have been
meaningfully more code and a second copy of an async-readiness bug class already proven tricky
once. `buildDownsampler()` (`ui/src/audio/engine.ts`) is ~25 lines: a stereo (2-in/2-out)
`ScriptProcessorNode` whose `onaudioprocess` holds each channel's last sample for `hold` consecutive
input samples before taking a new one — a sample-and-hold decimator, the textbook technique real
hardware/software sample-rate reducers use, and the SAME mechanism that produces audible aliasing
when the effective rate drops below the signal's bandwidth (verified live below). `hold` (the
`bitcrushRate` field, 1 = off/passthrough) is pushed in on every `applyEffectParams` call via a
closure-captured mutable variable — the same "periodic JS value push, not sample-accurate
`AudioParam` automation" convention Stream AC's `pingPongWobbleRate`/`applyPingPong` already
established for its own hand-built nodes.

**Deliberately excluded: Jitter.** Ableton's real Redux also has a "Jitter" knob (adds small random
timing jitter to the downsampling clock, a dirtier/less pitched-alias character). The brief scoped
this stream to "Redux's downsampling half" — the Rate dimension — and research 17 §5.6 named Rate,
not Jitter, as the concrete gap; Jitter is a real, documented future addition to the same
`bitcrushRate`-adjacent field group, not built here.

**Disposal**: the raw `ScriptProcessorNode` has no `.dispose()` (unlike every other node in this
codebase). `EffectRuntime` gained an optional `raw?: AudioNode[]` field for exactly this case,
checked (as `.disconnect()`, not `.dispose()`) at the two places an effect's nodes get torn down
(`reconcileEffectChain`'s removal loop, `disposeChain`) — four lines total, not a widening of the
existing `nodes: Tone.ToneAudioNode[]` array's type for one case.

## Format (`src/core/document.ts`, `docs/format-spec.md`)

- `EffectType`/`EFFECT_TYPES` widened to 8; `DEFAULT_EFFECT_TYPES` (new, not exported) frozen at
  the original 4 for `defaultEffectChain()` — see above.
- 15 new `SYNTH_FIELDS` rows: `bitcrushRate` (default `1`), `autoFilterRate`/`Depth`/`Octaves`/
  `BaseFrequency`/`Type`/`Mix`, `autoPanRate`/`Depth`/`Mix`, `tremoloRate`/`Depth`/`Spread`/`Mix`,
  `utilityWidth`/`Gain`. All follow the standard canonical-elision contract (present-at-default =>
  no line); all fourteen numeric ones are automation-lane-capable for free
  (`AUTOMATABLE_SYNTH_PARAMS` auto-derives from every `kind: 'number'` row — no extra format work).
- No `LFO_DESTS` additions (same explicit scope cut Stream AC made for its own four new
  `*Mix` fields).
- Parser/serializer/edit/diff/convert needed **zero new code** — every one of them is already
  data-driven off `SYNTH_FIELDS`/`EFFECT_TYPES` (`SYNTH_FIELD_BY_KEY.get(keyword)` in the parser,
  `for (const def of SYNTH_FIELDS)` in the serializer, `EFFECT_TYPES.includes(type)` in `addEffect`,
  etc.) — this is the entire point of that "one table, many consumers" architecture, confirmed
  again by this stream needing no new `switch`/`if` branches anywhere in `src/core/`.

## Engine (`ui/src/audio/engine.ts`)

- `EffectRuntime` gained `autoFilter?`/`autoPan?`/`tremolo?`/`utility?` (the last a `{widener,
  gainTrim}` pair) fields, plus `bitcrushDry?`/`bitcrushWet?`/`downsampler?`/`raw?` for the
  redesigned `bitcrush` case.
- `buildEffectRuntime()`'s `switch` gained four new cases (`autoFilter`/`autoPan`/`tremolo`/
  `utility`) alongside the redesigned `bitcrush` case — no changes needed to `reconcileEffectChain`
  itself (the spine-wiring logic is fully generic over whatever `EffectRuntime`s exist) or to
  `applyParams`'s call site (`for (const runtime of chain.effects.values()) applyEffectParams(runtime,
  p)` already iterates every declared effect regardless of type).
- `applyEffectParams()` gained four new `if` blocks (plus the redesigned `bitcrush` block) — the
  only engine-side branching this stream needed.
- `EngineSynth`/`coerce()` gained the 15 new fields, mirroring `SYNTH_FIELDS`' defaults exactly
  (same hand-mirror convention every prior stream's `ui/`-side additions use, since `ui/` is a
  standalone Vite app with no build-time dependency on `src/core`).
- **No `DrumBus`/`getDrumBus()` changes** — these four types are synth-tracks-only, per the "two
  possible shapes" section above.

## GUI (`ui/src/components/synthParams.ts`, `MixerView.tsx`, `ui/src/types.ts`)

- `EFFECT_TYPES`/`EFFECT_LABELS` widened in `ui/src/types.ts` — the "Effect Chain" panel and its
  add-effect type picker (`SynthPanel.tsx`) needed **zero changes**; both are fully generic over
  `EFFECT_TYPES`/`EFFECT_LABELS` already (confirmed by reading `SynthPanel.tsx` before starting —
  it maps `EFFECT_TYPES` directly into the `<select>` options).
- Four new `PARAM_GROUPS` entries (`autofilter`/`autopan`/`tremolo`/`utility`, `kinds: ['synth']`,
  closed by default like every other non-essential group), plus one new knob (`bitcrushRate`,
  labeled "Redux") appended to the existing `inserts` group.
- `MixerView.tsx`'s `FxBadges` gained four more badges (`AFlt`/`APan`/`Trem`/`Util`), same `*Mix >
  0` heuristic the existing eight badges use (Utility's badge instead checks `width !== 0.5 || gain
  !== 0`, since it has no Mix field).

## CLI/MCP/daemon

Zero new verbs, zero new daemon routes — `beat effect-add <file> <track> <type>` and
`beat_effect_add`/`POST /effect-add` already generically validate `type` against `EFFECT_TYPES`
(`addEffect` in `src/core/edit.ts`). Only docstrings/help text updated to list the four new type
names (`cli/beat.mjs` ×2, `src/mcp/server.ts`, `src/daemon/daemon.ts`).

## Tests — `test/format-v10-stream-be-effects.test.ts`

Same discipline as `test/format-v10-effects.test.ts`. 12 new tests: the `EFFECT_TYPES`-widened/
`defaultEffectChain()`-unchanged correctness property (the trap described above, tested directly);
a fresh synth track still elides every effect line; each of the four new types round-trips through
`addEffect`/parse/serialize/idempotent-reserialize; remove/bypass/diff work identically to the
original four (no per-type special-casing); `addEffect` rejects an unknown type and non-synth
tracks; every new field's canonical-elision contract (touched fields serialize, untouched fields at
default stay elided); Redux's field-not-type shape (chain stays 4 entries, `bitcrushRate` round-
trips as a plain field); all 15 new numeric fields appear in `AUTOMATABLE_SYNTH_PARAMS`; `beat
inspect` shows the widened chain correctly.

## Live verification — `ui/verify-phase23-stream-be.mjs`

Drives the real GUI engine over headless Chromium, adds each effect to a track's chain through
`window.__bridge.postEffectAdd` (the exact function the GUI's "Effect Chain" add button calls —
chain MEMBERSHIP had to be set through this route, unlike Stream AC's verify script, since these
four effects don't exist in the audio graph at all until actually added to the reorderable chain),
sets params through `window.__bridge.postEdit` (same as Stream AC's script), records real audio
(`engine.recordWav`), and measures it with `src/metrics`' `analyze()` plus a few new measurement
helpers (Pearson correlation of two envelope series, a `(L-R)/(L+R)` pan-position series, a
frequency-fold-back predictor). All five checks pass, rerun clean:

- **Auto Filter** — held sawtooth, `autoFilterMix` 0→1 (rate 3Hz, depth 1, octaves 4): spectral-
  centroid CV (the same technique Stream AC's chorus/phaser checks use) **0.012 → 0.22-0.32** across
  runs, a clear order-of-magnitude increase.
- **Auto Pan** — held tone, `autoPanMix` 0→1 (rate 1.2Hz, depth 1): per-window `(L-R)/(L+R)` pan-
  position range **0.004-0.012 → 1.990** (out of a max possible 2.0, hard-L to hard-R) — a real,
  near-maximal alternating stereo position, not a level change.
- **Tremolo** — held tone, `tremoloMix` 0→1 (rate 6Hz, depth 1, spread 180): per-channel envelope
  coefficient of variation **0.056 → 0.69-0.71** (real periodic amplitude modulation), AND the L/R
  envelope Pearson correlation swings **+1.000 → -0.98 to -0.99** (spread=180's predicted phase
  inversion, confirmed to within 2% of the theoretical -1.0). A genuinely mono-summed measurement
  of the same signal shows almost no CV change (0.056 → 0.068) — expected and documented in the
  script's own comments: perfectly anti-phase L/R amplitude modulation exactly cancels in a mono
  sum, which is why the per-channel (not summed) envelope is the correct measurement.
- **Utility** — a wide-unison patch, `utilityWidth` 0→1: recorded stereo correlation (`analyze()`'s
  `stereo.correlation`) swings **+1.000 → -1.000**, its full possible range, between the two
  extremes.
- **Redux** — a held pure 7000 Hz sine, off vs `bitcrushRate=12` (`bitcrushMix=1`, `bitcrushBits=16`
  to isolate the rate dimension from bit-depth): Goertzel-measured energy at the fold-back-predicted
  alias frequency (computed from the ACTUAL recorded sample rate at runtime, e.g. 1000 Hz for a
  48000 Hz recording with hold=12) rises from **2.5e-6 (negligible, ~0.02% of the fundamental) to
  2.3e-2 (a full order of magnitude above the fundamental's own OFF-take level)** — a real,
  predicted-frequency aliasing artifact appearing where the fold-back math says it should, not a
  generic loudness or tone change.

Two real measurement subtleties surfaced and got fixed *in the test harness* while building this
(both are genuine DSP facts, not engine bugs — recorded here for a future reader hitting a similar
symptom):

1. Tremolo's OVERALL (mono-summed) envelope barely moves even with the effect fully engaged at
   `spread=180`, because L and R are modulated in exactly opposite phase and a mono sum of two
   perfectly anti-phase amplitude-modulated signals is (to first order) constant — the modulation
   cancels. The fix was measuring PER-CHANNEL envelope CV instead of the mono sum, which is also
   the more musically honest measurement (that's what a listener with stereo speakers actually
   hears).
2. The verify script's own headless-Chromium harness (not the DSP) showed transient
   `ERR_CONNECTION_REFUSED` failures on some runs when many browser/daemon cycles ran back-to-back
   under heavy concurrent system load (this repo had several other Phase 23 streams' own verify
   scripts and stray headless Chrome processes running at the same time during development) — every
   check that got a clean run against the real preview server passed with consistent, repeatable
   numbers; the flakiness was isolated to the harness's dev-server/browser plumbing under contention,
   not the audio graph.

## Result

`npm test`: all passing (490 pre-existing + 12 new `test/format-v10-stream-be-effects.test.ts` =
502/502). Root `tsc --noEmit` and `ui/`'s `tsc --noEmit` both clean. `npm run build` (root + `ui/`)
clean. Live verification: `node ui/verify-phase23-stream-be.mjs` — all five checks pass.
`scripts/roadmap-data.mjs`'s three affected rows (`Auto Filter / Auto Pan / Tremolo`, `Redux
(downsampling half)`, `Utility (stereo width / gain trim)`) moved from `not-started` (core/cli/gui
all `missing`) to `done` (core/cli/gui all `done`), `plan` pointed at this doc;
`docs/product-roadmap.md` regenerated (`node scripts/gen-product-roadmap.mjs`).

## Files touched

Core: `src/core/document.ts`. Docs: `docs/format-spec.md`, `scripts/roadmap-data.mjs`,
`docs/product-roadmap.md` (regenerated), this file. Engine: `ui/src/audio/engine.ts`. GUI:
`ui/src/components/synthParams.ts`, `ui/src/components/MixerView.tsx`, `ui/src/types.ts`. Vary:
`src/vary/vary.ts` (the new `*Mix`/`bitcrushRate` fields added to the existing `fx` mutation group,
same "bounded bypassable insert" shape as Stream AC's own four). CLI: `cli/beat.mjs`. MCP:
`src/mcp/server.ts`. Daemon: `src/daemon/daemon.ts`. Tests:
`test/format-v10-stream-be-effects.test.ts` (new). Verify script:
`ui/verify-phase23-stream-be.mjs` (new).

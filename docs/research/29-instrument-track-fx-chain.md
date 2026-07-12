# Research 29 — Instrument-track FX chain: does it reuse the v0.10 effect-chain grammar?

*2026-07-11. Answers Phase 23 research stream RE. Reads `docs/phase-22-stream-aa.md` (the ordered/
reorderable per-track effect chain AA built for synth tracks), `docs/phase-14-instrument-tracks.md`
(SoundFont-backed instrument-track playback), `docs/format-spec.md`'s v0.10 effect-chain section,
and the actual current source — `src/core/document.ts`, `src/core/parse.ts`, `src/core/serialize.ts`,
`src/core/edit.ts`, `ui/src/audio/engine.ts`, `ui/src/components/SynthPanel.tsx`,
`ui/src/components/InstrumentPanel.tsx` — directly, not just their prose descriptions. The product
roadmap's own framing (`docs/product-roadmap.md`, "Instrument-track FX chain" row): "EQ/compression/
sends per instrument track — today it's level/pan only," `research: null`. This is that research
pass, with a concrete recommendation.*

---

## 1. The question, precisely

Phase 22 Stream AA gave synth tracks an ordered, reorderable, per-instance-bypassable insert-effect
list — `effect <id> <type> [bypassed]` lines, `BeatTrack.effects: BeatEffect[]`,
`EffectType = 'eq3' | 'comp' | 'distortion' | 'bitcrush'`. AA's own doc states this was built "synth
tracks only" and that "drum tracks... and instrument tracks never carry `effect` lines"
(`docs/phase-22-stream-aa.md`, `docs/format-spec.md:495-498`). Phase 14 built real SoundFont
playback for instrument tracks but explicitly deferred FX: "Instrument tracks get level/pan into the
master bus, but **not** the synth insert chain... `BeatInstrument` carries no such fields today
anyway (by design: 'the 55 synth params mostly don't apply to sampled instruments'); wiring
instrument tracks through a shared insert/send chain is a clean next increment"
(`docs/phase-14-instrument-tracks.md`, "Honestly deferred").

Two questions bundled into one: (1) is the **grammar** (the `effect` line, the `BeatEffect` type,
canonical elision, migration discipline) reusable as-is, and (2) is the **engine wiring**
(`WorkletSynthesizer`'s output routing) compatible with the same splice-point mechanism
`reconcileEffectChain` uses for synth tracks, or does SoundFont-channel playback impose a real
constraint that forces a different shape. Both were investigated directly against the current
source, not assumed from the prose in AA's or Phase 14's own docs (which — reasonably, since neither
stream needed to answer this — describe the CURRENT boundary but don't investigate crossing it).

## 2. What exists today, read directly

### 2.1 Format: `BeatTrack.effects` is already a track-level field; the gate is four call sites, not the type

The type itself is not synth-scoped. `BeatTrack` (`src/core/document.ts:525-558`) declares
`effects: BeatEffect[]` as a plain field alongside `notes`/`hits`/`clips` — there is no
`SynthTrack extends BeatTrack` split anywhere in the schema; every track kind (`'synth' | 'drums' |
'instrument' | 'audio'`, `TRACK_KINDS`, `document.ts:8,769`) carries the same `BeatTrack` shape. The
"synth tracks only" rule is enforced entirely at the edges, and it turns out to be exactly four
narrow gates, each a single kind check:

| Layer | File:line | Gate |
|---|---|---|
| Parser | `src/core/parse.ts:554` | `if (currentTrack.kind !== 'synth') throw new BeatParseError('"effect"/"effects" lines only belong on synth tracks...')` |
| Parser migration | `src/core/parse.ts:165` | `if (currentTrack.kind === 'synth' && !effectsSeen.has(currentTrack)) currentTrack.effects = defaultEffectChain()` |
| Serializer | `src/core/serialize.ts:160` | `if (t.kind === 'synth') lines.push(...serializeEffectLines(t.effects, '  '))` |
| Edit primitive | `src/core/edit.ts:487` | `if (track.kind !== 'synth') throw new BeatEditError('...effect chains only belong on synth tracks')` (in `addEffect`; `removeEffect`/`moveEffect`/`setEffectEnabled` don't re-check kind, they just operate on whatever `effects` already holds) |
| Track creation | `src/core/edit.ts:586` | `effects: kind === 'synth' ? defaultEffectChain() : []` (inside `addTrack`) |

`diffDocuments`' effect diffing (`src/core/diff.ts:195`, `diffEffects(id, ta.effects, tb.effects,
out)`) and `describeDocument`'s inspect output (`src/core/inspect.ts:50-52`,
`if (t.kind === 'synth') { ...list the chain... }`) are the only other two places that know about
`effects` at all, and both are already trivially kind-agnostic in their inner logic — `diffEffects`
runs unconditionally today (a no-op for instrument tracks since both sides are always `[]`);
`inspect.ts` has its own `kind === 'synth'` display gate that would need the same widening as the
parser/serializer.

This matters for the recommendation below: there is no type migration to design. The field already
exists, already round-trips, already diffs, already has edit primitives. The work is relaxing five
kind checks and one migration-default rule, not inventing new schema.

### 2.2 Engine: `WorkletSynthesizer`'s output is a single per-track node, not a per-voice one

This is the crux question the phase-23 brief flags directly: does SoundFont-channel routing (voices
inside the worklet, potentially "per-note not per-track" processing) make a shared insert chain
architecturally wrong for instrument tracks? Read `ui/src/audio/engine.ts`'s actual instrument
plumbing (not just Phase 14's prose) to answer this rather than assume it.

`buildInstrument()` (`ui/src/audio/engine.ts:1728-1765`) constructs one `WorkletSynthesizer` per
instrument track and wires it as:

```
synth (WorkletSynthesizer, an AudioWorkletNode)
  → entry (native GainNode, plain passthrough)
  → muteGain (Tone.Gain)
  → vol (Tone.Volume)
  → pan (Tone.Panner)
  → master bus
```

(`engine.ts:1749-1756`: `const entry = ctx.createGain(); synth.connect(entry); ... Tone.connect(entry,
muteGain); muteGain.chain(vol, pan, this.getMaster())`). The `InstrumentVoice` interface's own doc
comment (`engine.ts:930-938`) confirms this is deliberate and singular: *"its output feeds `entry` (a
native passthrough) → `muteGain` → `vol` → `pan` → master."* One node, one signal path, per track —
the same shape as `SynthChain.filter`, which is where every one of a synth track's internal voices
(`PolySynth`, `osc2`, `osc3`, four unison pairs, `sub`, `noise`, `fm` — `engine.ts:781-796`) already
converges into a single point before anything downstream (filter, then the AA effect chain, then the
Stream AC fixed tail) ever runs.

The polyphony/voice-management the brief worried about is real, but it happens **entirely inside**
the `AudioWorkletNode` (spessasynth's internal channel/voice mixing — see `docs/phase-14-instrument-
tracks.md`'s own research notes on `WorkletSynthesizer`'s design), the same way a `Tone.PolySynth`'s
internal voice-stealing and per-note envelope instances happen entirely inside that node before its
single audio output reaches `filter`. An `AudioWorkletNode` by construction exposes one summed stereo
output pin regardless of how many voices it manages internally — Web Audio doesn't have a concept of
"per-note graph fan-out" at the node-connection level, and `WorkletSynthesizer` doesn't expose one
either (`synth.connect(entry)` is a single `.connect()` call, not a loop over voices). There is no
per-note or per-voice processing boundary an insert-chain splice would have to cross; the insert
point is downstream of exactly the same kind of "all voices already summed" node a synth track's
`filter` already is.

**Conclusion: no, SoundFont-channel routing does not impose an architectural constraint against a
shared insert chain.** The worry the brief raised (multi-voice polyphony inside the worklet making
per-track inserts wrong) does not hold up against the actual code — it would only be a real issue if
inserts needed to run *per note* (e.g. a per-voice filter with note-tracked cutoff), which none of
the four AA effect types are (`eq3`/`comp`/`distortion`/`bitcrush` are all track-level, post-mix
processors on both the synth and drum-bus chains today — see §2.1 of `docs/phase-22-stream-aa.md` and
the `wireInsertChain`/`getDrumBus` code it built on).

## 3. Recommendation: yes, shared grammar — same field, same line grammar, new splice point, kind-aware defaults

### 3.1 Type-level change

**`BeatTrack.effects: BeatEffect[]` needs no change at all** — see §2.1. `EffectType`/`BeatEffect`/
`defaultEffectChain()`/`isDefaultEffectChain()` (`document.ts:499-523`) are already kind-agnostic
types; nothing about them assumes synth. `BeatInstrument` does **not** need its own `effects` field
or its own differently-shaped effect type — that would duplicate a mechanism that already exists and
already works, for no benefit.

The one real type-level decision is **where the four effect types' own PARAMETERS live** for an
instrument track. Today `eqLow`/`eqMid`/`eqHigh`, `compThreshold`/`compRatio`/`compAttack`/
`compRelease`/`compMix`, `distortionAmount`/`distortionMix`, `bitcrushBits`/`bitcrushMix` — 12 fields
total (`document.ts:700-711`) — are part of `SYNTH_FIELDS`, i.e. they live on `BeatTrack.synth:
BeatSynth`. `BeatInstrument` (`document.ts:476-481`) deliberately does not carry the 55-field synth
block ("the 55 synth params mostly don't apply to sampled instruments... volume/pan are the small bus
subset that does apply" — the type's own comment). Two options:

- **(a) Duplicate the 12 fields onto `BeatInstrument`** as their own flat fields (same names,
  defaults, semantics as the `SYNTH_FIELDS` subset) — a new, independent copy.
- **(b) Reuse `BeatTrack.synth`'s existing storage.** `src/core/parse.ts:427-429` already gives
  every instrument (and audio) track a full `{ ...INIT_SYNTH }` object at parse/create time —
  *"Instrument and audio tracks never serialize a synth block — they carry the canonical INIT copy so
  `parse(serialize(x))` deep-equals documents built via `addTrack`."* That object already holds
  correctly-defaulted `eqLow`/`compMix`/etc. slots in memory today; they're simply never read or
  serialized for non-synth kinds. Widening the specific 12 `SYNTH_FIELDS` rows that back `eq3`/
  `comp`/`distortion`/`bitcrush` to also serialize for `kind === 'instrument'` (while the other ~43
  rows — oscillator, filter envelope, LFOs, unison, FM, ping-pong, beat-repeat — stay synth-only,
  exactly as today) reuses storage, the existing `SYNTH_FIELDS` table/parser/serializer/edit-`setValue`
  machinery, and the existing `applyEffectParams`/`buildEffectRuntime` engine code (§3.3) without a
  new type.

**Recommendation: (b).** It's less new surface (one added dimension on 12 existing table rows —
e.g. a `tracks: readonly TrackKind[]` marker per `SynthFieldDef`, defaulting to `['synth', 'drums']`
today and widened to include `'instrument'` on exactly those 12 rows — versus a whole new duplicate
field set), it makes the "these 12 fields are pure post-signal audio processors, not synthesis
params" distinction explicit in the schema for the first time (arguably a real bug-prevention win:
today nothing stops someone from *thinking* `eqLow` is synthesis-specific), and it means `beat set
<instrument-track>.eqLow=3` becomes valid for free via the exact same `setValue` path
(`<track>.<field>=value`) synth tracks already use — no new CLI/MCP/daemon surface beyond widening the
same track-kind check the effect-chain edit primitives need anyway. The cost is that `SynthFieldDef`
needs a `tracks` (or `kinds`) dimension it doesn't have today (currently every row implicitly applies
to every track whose `synth` block gets serialized at all) — a small, mechanical addition, not a
redesign.

### 3.2 Migration / canonical elision

This must NOT reuse synth's `defaultEffectChain()` as the instrument-track default. Synth tracks
migrate an absent declaration to the historical hardcoded chain (`eq3, comp, distortion, bitcrush`,
all enabled) because that chain is what every pre-v0.10 synth track's engine *already played*
(`docs/phase-22-stream-aa.md`'s "Migration decision" section — lossless because it matches prior
behavior exactly). Instrument tracks have no such prior behavior: today, and for every file that
predates this change, an instrument track has **zero** insert processing of any kind
(`docs/phase-14-instrument-tracks.md`'s "Honestly deferred" section confirms level/pan only). So the
instrument-track canonical default is the **empty chain**, not the four-effect default — an untouched
instrument track must keep emitting zero `effect` lines and sounding identical to before this stream,
same discipline AA itself established, just anchored to a different canonical shape per kind.

Concretely: `isDefaultEffectChain(effects)` and the serializer's whole-chain elision check
(`serialize.ts:5-14`, `serializeEffectLines`) both need to become kind-aware — compare against
`defaultEffectChain()` for `kind === 'synth'`, against `[]` for `kind === 'instrument'` — rather than
hardcoding the synth default as the only canonical shape. `parse.ts:165`'s migration line
(`if (currentTrack.kind === 'synth' && !effectsSeen.has(currentTrack)) currentTrack.effects =
defaultEffectChain()`) simply should not add an `=== 'instrument'` branch at all — instrument tracks
should be left at their existing `effects: []` initial value (`parse.ts:437`) when no `effect` line is
seen, which is already exactly correct and requires no new code. Net effect: **every existing
`.beat` file with instrument tracks needs zero migration** — this is a pure widening of what an
instrument track is *allowed* to declare, not a change to what one *must* declare, so it's a no-op
for every file that doesn't touch the new capability. Same "one canonical form per state" guarantee
AA's own migration story relied on, just with two per-kind canonical baselines instead of one
global one.

### 3.3 Engine splice point

Insert the reorderable chain between `entry` and `muteGain` in `InstrumentVoice`, the exact
structural equivalent of synth's `filter -> [effects] -> ... -> muteGain`:

```
synth (WorkletSynthesizer) → entry → [ordered, enabled effects] → muteGain → vol → pan → master
```

`reconcileEffectChain` (`engine.ts:1525-1557`) is already written generically against a `SynthChain`-
shaped record (`effects: Map<string, EffectRuntime>`, `effectOrder`, `effectsSig`, plus an `entry`-ish
anchor node it rewires from and an `exit`-ish node it rewires to) — extending `InstrumentVoice` with
the same three bookkeeping fields (`effects`, `effectOrder`, `effectsSig`) and either (a) generalizing
`reconcileEffectChain`'s signature to take explicit `(anchorIn: ToneAudioNode, anchorOut:
ToneAudioNode)` instead of assuming a `SynthChain`, or (b) writing a thin `reconcileInstrumentEffects`
sibling that calls the same `buildEffectRuntime`/`applyEffectParams` helpers (`engine.ts:399-426,436+`)
— both work; (a) is less duplication and matches how `wireInsertChain`/`wireFxTail` are already
shared helper functions between `buildSynthChain()` and `getDrumBus()` (`engine.ts:1081-1105`), so a
third shared caller is consistent with the existing pattern, not a new one. `buildEffectRuntime`
itself needs no change — it builds Tone nodes with no assumption about what's upstream (`entry` is a
native `GainNode`, but `Tone.connect()` — already used at `engine.ts:1755` to bridge `entry` into the
Tone graph — bridges native ↔ Tone nodes transparently, so wiring `entry.connect(effectRuntime.entry)`
or `Tone.connect(entry, effectRuntime.entry)` is no different from any other cross-boundary connection
this file already makes).

`applyEffectParams(runtime, p)` (`engine.ts:436+`) currently takes `p: EngineSynth` — the synth
track's full param bag — because that's the only caller today. For instrument tracks the 12 relevant
params live on `inst` (`BeatInstrument`, once widened per §3.1) rather than a full `EngineSynth`; the
function's real dependency is just the 12 fields, so either narrow its parameter type to a small
interface both `EngineSynth` and the widened `BeatInstrument` satisfy structurally, or pass the 12
values explicitly. Small, mechanical, no architecture change.

`syncInstruments()` (`engine.ts:1786-1820`) is the natural place to call the new reconcile — it
already runs every tick alongside the existing cheap `programChange`/volume/pan updates
(`engine.ts:1813-1818`), so adding "reconcile this voice's effect chain, then apply its 12 effect
params" there follows the exact same per-tick cadence synth tracks already use via `applyParams`.

## 4. Which effect types make sense on an instrument track first

**All four of AA's existing types (`eq3`, `comp`, `distortion`, `bitcrush`) — ship them together, not
staged.** They are not synthesis-domain effects; they are generic post-signal audio processors
(`wireInsertChain`, `engine.ts:1077-1095`, wires the identical four nodes for the *drum bus* too,
which is exactly as "not a synthesizer" as an instrument track is). There is no capability among the
four that only makes sense with an oscillator-based source: EQ and compression are obviously useful
on a sampled piano/flute/trumpet; distortion and bitcrush are common, deliberate colorations on
sampled/pre-recorded instrument material in real production (lo-fi'd piano, crushed brass, etc.) —
arguably more idiomatically applied to a "real" instrument timbre than to a synth patch, where players
already reach for oscillator/filter shaping instead. Gating the MVP to only EQ+comp and deferring
distortion/bitcrush would reintroduce exactly the kind of "two independently-parameterized subsets of
one already-built mechanism" asymmetry AA itself chose to avoid within synth tracks (its own
documented scope cut was about multi-instance-per-type, not about which types apply) — there's no
comparable proportionate reason to split the four here.

**Explicitly NOT included in this reuse: Stream AC's fixed FX tail** (saturator → chorus → phaser →
ping-pong delay, plus beat-repeat) **is a different mechanism, not part of `EffectType`/`BeatEffect`
at all.** `EFFECT_TYPES` is still exactly `['eq3', 'comp', 'distortion', 'bitcrush']`
(`document.ts:500`) — Ping Pong Delay and Beat Repeat are plain `SYNTH_FIELDS` rows
(`pingPongTime`/`beatRepeatGrid`/etc., `document.ts:713-721`) wired as a **fixed**, non-reorderable
tail after the AA chain (`wireFxTail`, `engine.ts:1097-1105`, shared verbatim by `buildSynthChain()`
and `getDrumBus()` — its own comment at `engine.ts:806-813` notes this asymmetry is deliberate: "the
format's `EffectType` enum doesn't cover these four yet — a real follow-up"). So the phase-23 brief's
framing ("do any of Phase 22's other new effect types, e.g. Beat Repeat or Ping Pong Delay, make sense
there too") is answered by first correcting the premise: those aren't reorderable-chain effect types
today for *any* track kind, synth included — extending them to instrument tracks is a strictly later,
separate question (generalize the fixed tail to instrument voices, itself gated behind AC's own
already-flagged follow-up of promoting them into `EffectType` at all) and shouldn't block or be
bundled with this stream.

## 5. MVP scope cut and integration checklist

**In scope for the MVP build stream** (should follow AA's/AC's established pattern almost exactly,
per the investigation above):

- **Format**: widen the 4 gates in §2.1 (`parse.ts:554`, `parse.ts:165`, `serialize.ts:160`,
  `edit.ts:487`, `edit.ts:586`) from `kind === 'synth'`/`kind !== 'synth'` to also admit
  `'instrument'`; make `isDefaultEffectChain`/`serializeEffectLines`/the parser's migration branch
  kind-aware per §3.2 (empty-chain default for instrument, not the synth 4-chain default); widen
  `inspect.ts:50`'s display gate the same way.
- **`SynthFieldDef`**: add a `tracks`/`kinds` dimension (default `['synth', 'drums']` for most rows,
  matching current behavior) and set it to include `'instrument'` on exactly the 12 eq3/comp/
  distortion/bitcrush rows (`document.ts:700-711`). Verify `SYNTH_PARAM_ORDER`'s "required core 9"
  (`document.ts:648-658`) is untouched — those stay synth-only, this doesn't touch them.
- **Engine**: extend `InstrumentVoice` with `effects`/`effectOrder`/`effectsSig`; generalize (or
  clone) `reconcileEffectChain` to splice between `entry` and `muteGain` per §3.3; call it (plus
  `applyEffectParams`) from `syncInstruments()`.
- **CLI/MCP/daemon**: `beat effect-add`/`-rm`/`-move`/`-bypass` and their MCP/daemon equivalents
  (`docs/phase-22-stream-aa.md`'s "CLI/MCP/daemon" section) call into `edit.ts`'s primitives directly
  — once those accept `kind === 'instrument'`, the CLI/MCP/daemon layer needs no changes at all (same
  reason `diffEffects` already needs none, §2.1).
- **GUI**: `EffectChain`/`EffectRow` (`ui/src/components/SynthPanel.tsx:110-191`) take only
  `{ track }` and read `track.effects`/`track.id` — no synth-specific internals were found in the
  investigation. Recommend extracting them into a shared component (or exporting as-is from
  `SynthPanel.tsx`) and rendering from `InstrumentPanel.tsx` (`ui/src/components/
  InstrumentPanel.tsx`, currently just program/volume/pan) — likely a near-verbatim reuse, not a
  rewrite. `InstrumentPanel` would also need EQ/comp/distortion/bitcrush knobs (mirroring
  `SynthPanel`'s existing "Inserts" `Group`) once §3.1's field widening lands.
- **Tests**: extend `test/format-v10-effects.test.ts`'s pattern (migration/elision/reorder/add/
  remove/bypass round-trips) with an instrument-track variant per case, verifying the empty-default
  (not four-effect-default) migration baseline specifically — this is the one place instrument
  tracks' behavior *must* differ from synth tracks' and deserves its own explicit test, not just
  parametrizing the existing synth cases over track kind.
- **Verification**: follow `ui/verify-phase22-stream-aa.mjs`'s pattern (real daemon + built GUI +
  headless Chromium + `recordWav`/`analyze()` measured audio) — an instrument-track-specific bypass
  check analogous to AA3 (extreme bitcrush settings, measure crest factor / spectral centroid with
  and without bypass) would directly confirm the splice point in §3.3 is a real routing change on the
  `WorkletSynthesizer` path specifically, not just reused code that happens to compile.

**Out of scope / explicit follow-ons, not blocking this stream:**

- Stream AC's fixed tail (saturator/chorus/phaser/ping-pong/beat-repeat) on instrument tracks — a
  separate mechanism, itself gated behind promoting those into `EffectType` for any track kind first
  (§4).
- Reverb/delay sends, LFO/filter-envelope modulation of instrument tracks — `docs/phase-14-
  instrument-tracks.md`'s "Honestly deferred" list also named sends; sends are a simpler, orthogonal
  addition (a `reverbSend`/`delaySend` gain pair off the same `entry`/`muteGain` splice point, no
  reorderable-chain complexity) worth scoping in the same build stream if time allows, but is a
  distinct format/engine surface from the insert-effect grammar this research pass was scoped to.
- Multi-instance-per-type independent parameterization — AA's own documented scope cut
  (`docs/phase-22-stream-aa.md`, "Deliberate scope cut" section); nothing about extending to
  instrument tracks changes that calculus, so it stays deferred identically for both kinds.
- LFO/clip-automation destinations targeting `eqLow`/`compMix`/`distortionMix`/`bitcrushMix`
  (`LFO_DESTS`, `document.ts:595-611`) are synth-only today (driven by a synth track's own LFO
  fields, which instrument tracks don't have) — widening the *effect* fields per §3.1 does not imply
  instrument tracks gain LFO modulation of them; that would require instrument tracks to grow their
  own LFO surface, a materially bigger and unrelated ask.

## Sources

Direct reads (line numbers as of this pass): `docs/phase-23-plan.md` (RE's brief),
`docs/phase-22-stream-aa.md` (full), `docs/phase-14-instrument-tracks.md` (full),
`docs/format-spec.md:452-508` (v0.10 effect-chain section), `docs/product-roadmap.md` (Instrument-
track FX chain row). `src/core/document.ts:8,476-558,499-523,586-769` (TrackKind, BeatInstrument,
EffectType/BeatEffect/defaultEffectChain/isDefaultEffectChain, BeatTrack, SYNTH_FIELDS).
`src/core/parse.ts:165,395-450,548-571` (track creation, migration, effect-line parsing).
`src/core/serialize.ts:1-14,157-160` (serializeEffectLines, kind gate). `src/core/edit.ts:485-590`
(addEffect/removeEffect/moveEffect/setEffectEnabled/addTrack). `src/core/diff.ts:195` (diffEffects
call site). `src/core/inspect.ts:50-52` (describeDocument's effects display).
`ui/src/audio/engine.ts:370-434` (EffectType/EffectRuntime/buildEffectRuntime, engine-local, distinct
from but mirroring document.ts's), `:781-961` (SynthChain, InstrumentVoice, AudioTrackVoice
interfaces), `:1077-1150` (wireInsertChain/wireFxTail/getDrumBus), `:1442-1557` (buildSynthChain,
reconcileEffectChain), `:1728-1820` (buildInstrument, disposeInstrument, syncInstruments).
`ui/src/components/SynthPanel.tsx:110-230` (EffectRow/EffectChain/SynthPanel, kind gate at line 224).
`ui/src/components/InstrumentPanel.tsx` (full — current program/volume/pan-only panel).

# Phase 22 Stream AC — Extended FX arsenal: build-next-four

*2026-07-11. Builds `docs/research/17-track-fx-arsenal.md` §5's four recommended effects, in its
own build order: Ping Pong Delay, Beat Repeat, exposing the existing Chorus-Ensemble/Phaser-Flanger
mod-send bus as a per-track insert, Saturator. Built against `main` at `d6b9aac` (before sibling
Stream AA's reorderable-effect-chain rework lands) — per the stream brief, wired into today's fixed
insert-chain shape; reconciling into AA's new architecture happens at merge time.*

## What shipped

Four new insert/scheduling features, twenty new `SYNTH_FIELDS` (net of one retired — `sendMod`),
zero new CLI verbs (every field is generic `beat set`/MCP `beat_set` surface, same as every other
`SYNTH_FIELDS` row), four new `SynthPanel.tsx` param groups, and one retired subsystem (the shared,
project-global, un-configurable `chorusBus`/`phaserBus`/`sendMod` mod-send machinery in
`ui/src/audio/engine.ts`'s old `getBuses()`).

| Effect | New fields | Engine wiring |
|---|---|---|
| Ping Pong Delay | `pingPongTime`, `pingPongFeedback`, `pingPongCrossFeed`, `pingPongWobbleRate`, `pingPongWobbleDepth`, `pingPongMix` | Hand-built two-delay-line network (`PingPongNodes`/`buildPingPong()`/`applyPingPong()`), not the plain `Tone.PingPongDelay` built-in |
| Beat Repeat | `beatRepeatGrid`, `beatRepeatGate`, `beatRepeatChance`, `beatRepeatMode` | Scheduling-layer note/hit re-triggering inside `tick()` (`resolveBeatRepeat()`), not an audio-graph node |
| Chorus-Ensemble / Phaser-Flanger | `chorusMode`, `chorusRate`, `chorusDepth`, `chorusMix`, `phaserRate`, `phaserDepth`, `phaserMix` | Per-track `Tone.Chorus`/`Tone.Phaser` instances, replacing the retired shared bus |
| Saturator | `saturatorCurve`, `saturatorDrive`, `saturatorMix` | `Tone.WaveShaper` + authored curve tables (`buildSaturatorCurve()`), `SaturatorNodes`/`buildSaturator()`/`applySaturator()` |

Fixed insert order (both `buildSynthChain()` and `getDrumBus()`, duplicated per the existing
convention): `filter → eq3 → comp(parallel) → distortion → bitcrush → saturator → chorus → phaser →
pingPong → muteGain → panner → (vol / reverbSend / delaySend)`.

## Format additions (`src/core/document.ts`)

All twenty fields follow `SYNTH_FIELDS`' existing conventions exactly: camelCase keys, canonical
elision (a "0"/"off" default that emits no line), grouped in the optional-field table right after
`bitcrushMix`. New enum types `BeatRepeatMode`, `ChorusMode`, `SaturatorCurve` (+
`BEAT_REPEAT_MODES`/`CHORUS_MODES`/`SATURATOR_CURVES` exported constants, mirrored by hand in
`ui/src/audio/engine.ts` and `ui/src/components/synthParams.ts` per the existing `LFO_DESTS`
convention). Because `AUTOMATABLE_SYNTH_PARAMS` auto-derives from every `kind: 'number'` row, all
fourteen numeric fields (everything but the three mode/curve enums) are automation-lane-capable for
free — no extra format work needed.

### Retiring `sendMod`

The old shared mod-send bus (`chorusBus`/`phaserBus`, reachable only via the generic project-global
`sendMod` field) is gone — Chorus/Phaser are now real per-track inserts, consistent with every other
configurable effect in dotbeat (EQ3, compressor, distortion, bitcrush are all already
one-instance-per-track; research 17 §4.2). `sendMod` was checked for dependents before deletion and
found in: `document.ts` (`LfoDestination`/`LFO_DESTS`), `engine.ts` (the retired bus + `EngineSynth`/
`coerce()`), `synthParams.ts` (LFO dest list + a "Sends" knob), `ArrangementView.tsx` (a mixer-strip
send chip), `src/vary/vary.ts` (a vary range), `src/mcp/server.ts` (a docstring mention), and two
factory presets (`presets/factory.json`'s `e-piano`/`organ-keys`, both using `sendMod` for "chorus
send" character) — all updated. `sendMod` was added to `src/core/convert.ts`'s
`DELIBERATELY_UNMODELED` list so a beatlab payload carrying it still converts cleanly (reported as
dropped, honestly, rather than erroring) — this is a real behavior change for any `.beat` file that
had a nonzero `sendMod` line: it will now fail to parse with "unknown synth param" (same fail-loud
contract every other retired/renamed field gets). No `.beat` fixture or example file in the repo had
one; the two presets that did were migrated to the equivalent `chorusMode`/`chorusMix` instead
(`e-piano` → `chorusMode: chorus`, `organ-keys` → `chorusMode: ensemble`, both matching their
original "chorus/Leslie" character descriptions more literally than the old opaque `sendMod` number
ever did).

## Design decisions the format sketch left open

Research 17 §5 and research 21 row 4/5 specified the *fields*; three real design decisions were
needed to actually wire them, documented here (and in code comments at the point of decision) rather
than guessed silently.

**Ping Pong Delay's cross-feed topology.** `Tone.PingPongDelay` (the Tone.js built-in) hardwires
100% left↔right cross-feedback via its `StereoXFeedbackEffect` base class — there's no dial. Since
the brief requires a *continuously-variable* `pingPongCrossFeed` (research 21 row 4: "not a binary
ping-pong toggle... lets you dial any amount of left/right bleed"), this is hand-built from
primitives instead: two `Tone.Delay` lines, four feedback `Gain`s (`feedLL`/`feedLR`/`feedRR`/
`feedRL`), and a shared `Tone.LFO` driving both delay times' full value (wobble). The input taps
`delayL` only — the classic topology where the first echo is always on the left. `pingPongCrossFeed`
splits each delay's feedback between self (`feedLL`/`feedRR`) and cross (`feedLR`/`feedRL`): at 1
(the default), it's the classic full alternation; at 0, each channel's tail feeds only itself, and
since only `delayL` ever receives the direct input, the right channel then goes silent — the honest,
intentional result of "zero bleed," not a bug.

**Beat Repeat's gate-window placement and repeat cadence.** The scoped-down format sketch has no
"Interval" field (Ableton's real device does) and no notion of "when the effect engages" (a live
gesture in Ableton; nothing here). `resolveBeatRepeat()` in `engine.ts` picks: the gate window
recurs once per **bar**, positioned as the **last** `beatRepeatGate` 16th-steps of the bar (the
classic "stutter/fill into the next section" placement); repeats fire on **absolute** grid-aligned
16th-step boundaries (`contentStep % grid === 0`) while active, not relative to when the gate
happened to open; the repeated content is captured **once** per gate-window engagement (the
`beatRepeatGrid`-sized slice immediately preceding the window) and held for every repeat within it —
matching real Beat Repeat's "capture on engage, loop that buffer" behavior. `tick()` itself only
runs once per 16th-step (`Tone.getTransport().scheduleRepeat(..., '16n', 0)` in `play()`), so
`beatRepeatGrid` values below 1 (e.g. 0.5 for a 32nd-note slice) still shrink the *captured slice's
size* but can't make repeats fire faster than one per 16th-step — the same quantization every other
note/hit trigger in `tick()` already uses. Ableton's own no-op rule carries over unchanged: `Gate <
Grid` disables the effect entirely.

**`beatRepeatMode`'s three values**, matching Ableton's exactly: `mix` (original always plays,
repeats layer on top), `insert` (original muted only while a repeat is active, default), `gate`
(original *never* plays, only repeats ever sound — an intentional, extreme mode; only engages when
`beatRepeatGate > 0`, so the default `beatRepeatMode: 'insert'` + `beatRepeatGate: 0` combination is
inert, matching every other insert's "0 = off" canonical-elision contract).

**Beat Repeat's chance roll is per-note-position-seeded**, per research 21 row 5 ("Velocity device's
random-seed + note position reseed pattern... so re-rendering the same document is bit-for-bit
reproducible"). `seededRoll(trackId, step, itemId)` (`engine.ts`) is a pure FNV-1a-style hash of
those three values feeding one mulberry32-style mix step — no persisted RNG state, no
document-level seed field, and the *same* document always rolls the *same* outcome at the *same*
repeat. This is a different mechanism from `src/vary/vary.ts`'s/`src/core/humanize.ts`'s
`makeRng(seed)` (a single seeded stream advanced sequentially) precisely because a global stream
would make the Nth repeat's outcome depend on how many repeats fired *before* it in the render —
brittle under partial re-renders or reordering. Per-position hashing has no such dependency.

**Chorus's `vibrato` mode ignores `chorusMix`.** Research 17 §5.3: "`chorusMode: 'vibrato'` reuses
`Tone.Chorus` at `wet: 1` fixed with only the pitch-modulated signal reaching the output (no dry
blend) — matches Ableton's Vibrato mode's actual behavior." Implemented literally:
`chorus.wet.value = mode === 'off' ? 0 : mode === 'vibrato' ? 1 : chorusMix`. This is a deliberate,
documented exception to the "`*Mix` = 0 always bypasses" convention every other insert in dotbeat
follows — it only fires when a track explicitly opts into `chorusMode: vibrato` (default `'off'`),
so it can't surprise anyone using defaults. `chorus.spread` (stereo LFO spread) also varies by mode
(`ensemble` → 180°, `vibrato` → 0°, `chorus` → 90°) as the cheapest available approximation of
Ableton's 2-voice-vs-3-voice-vs-pitch-only distinction from `Tone.Chorus`'s actual exposed
parameters — there's no dedicated 3-voice mode in the underlying class.

**Saturator's curve is authored once per curve-type change, not per drive change.** `saturatorDrive`
only scales a pre-gain feeding a *fixed* `Tone.WaveShaper` curve (`preGain.gain.value = 1 + drive *
9`); the curve array itself (`buildSaturatorCurve()`, four closed-form functions — tanh soft clip for
`analog`, an asymmetric tanh for `warm`, a 3x hard clip for `clip`, a `sin()` fold for `fold`) is only
rebuilt when `saturatorCurve` changes type (cached via `SaturatorNodes.lastCurve`), matching the
research doc's explicit instruction and keeping `sync()`'s every-tick re-apply cheap.

## GUI (`ui/src/components/synthParams.ts` / `SynthPanel.tsx`)

`SynthPanel.tsx` needed no changes — it's a fully generic renderer driven by `PARAM_GROUPS`. Four
new groups added (`pingpong`, `beatrepeat`, `chorusphaser`, `saturator`), each `kinds: ['synth',
'drums']` matching the existing `inserts`/`sends` groups, closed by default like every other
non-essential group. `MixerView.tsx`'s `FxBadges` (the mixer-strip "which inserts are active" chip
row, previously EQ/Comp/Dist/Crush only) got four more badges (`Sat`/`Cho`/`Pha`/`PP`/`BR`) using the
same `*Mix > 0` heuristic, for consistency with the existing four. `ArrangementView.tsx`'s
mixer-strip `SEND_KEYS` dropped its `sendMod` chip (no longer a "send" concept — Chorus/Phaser are
inserts now).

## Verification — `ui/verify-phase22-stream-ac.mjs`

Live: drives the real GUI engine over headless Chromium, sets every param through
`window.__bridge.postEdit` (the exact function every `SynthPanel.tsx` knob's `onChange` calls,
itself POSTing to the daemon's real `/edit` route) rather than an in-page `setDoc()` or a raw Node
`fetch` to `/edit` — the latter was tried first and doesn't work here: the daemon deliberately never
SSE-broadcasts its own `/edit` writes back to a page that didn't initiate them (`daemon.ts`'s "echo
of our own write" guard), so a page that didn't itself call `postEdit` has no way to learn a raw curl
happened. Records real audio (`engine.recordWav`) and measures it — all four effects pass:

- **Ping Pong Delay**: a single blip, off (`pingPongMix=0`) vs. on (`mix=1`, `crossFeed=1`,
  `time=0.3s`). Measured: both channels' peaks land well above the pre-note silence floor (>8x), and
  the right channel's peak trails the left's by **0.30s** — matching `pingPongTime` exactly. A real
  alternating stereo bounce, not simultaneous L+R.
- **Beat Repeat**: one kick hit, off (`gate=0`, 1 onset) vs. on (`grid=1`, `gate=4`, 5 onsets).
  Measured: exactly 5 onsets, each **0.124-0.126s** apart — matching the 16th-step grid cadence
  (0.125s @ 120bpm) to within 2ms.
- **Chorus / Phaser**: a held sawtooth, off vs. each insert engaged. Measured spectral-centroid CV
  (coefficient of variation over sliding windows, `src/metrics`' `analyze()`): Chorus 0.005 → 0.16-0.20,
  Phaser 0.005-0.006 → 0.07-0.11 — both a clear order-of-magnitude increase in spectral movement.
- **Saturator**: a quiet held pure sine (A3, 220Hz), drive=0 vs. drive=1. Measured harmonic-to-
  fundamental energy ratio (Goertzel single-bin magnitude estimates at the fundamental and its 2nd-
  5th harmonics — a THD-style proxy computed directly, no full FFT needed): **0.12 → 0.38**, roughly
  a 3x increase — real added harmonic content from a near-pure tone, not a level change.

Two real timing subtleties surfaced and got fixed *in the test harness* (not the engine — verified
correct independently, see below) while building this:

1. `engine.recordWav()` only captures audio from the moment it's called, not from note-trigger; the
   harness's `play() → sleep(250ms) → recordWav()` flow means a note (and any short-delay echoes)
   scheduled at loop position 0 can finish entirely *before* capture starts. Fixed by starting the
   Ping Pong Delay test's blip at `t=1.0s` into a long (4-bar) loop instead of `t=0`, with every
   downstream measurement window computed relative to the empirically-detected note onset rather
   than an assumed fixed offset.
2. Beat Repeat's onset counter initially used first-threshold-crossing time as each hit's "onset,"
   which smears when a repeat train's decay tails overlap the next hit's rising edge (the default
   `kickDecay` used elsewhere is longer than one 16th-step). Fixed two ways: the onset detector now
   peak-picks within each above-threshold region instead of using the crossing point, and the test's
   `kickDecay` is set short enough (0.05s) that five consecutive 16th-step kicks never overlap.

Before landing on the `t=1.0s` fix above, a raw (non-opus, `AudioContext.createAnalyser` direct-tap)
measurement was used by hand to confirm the ping-pong engine itself was never the problem — at a
delay time comfortably longer than the harness's 250ms pre-roll, L-then-R alternation with the
correct time offset and amplitude decay showed up cleanly on the first try, with or without the
lossy `recordWav()` capture path. Recorded here so a future reader hitting a similar "channels seem
swapped" symptom in a *short*-delay-time ping-pong measurement checks the harness's capture-start
timing before suspecting the DSP.

## What this stream did NOT do

- **No reordering.** Built against today's fixed insert-chain shape (per the brief); reconciling the
  four new stages into sibling Stream AA's reorderable-effect-chain rework is explicit merge-time
  work, not scoped here.
- **No Auto Filter / Auto Pan / Tremolo / Redux downsampling / Utility** — all explicitly deferred by
  research 17 §5's "Deferred, with reasons" list; unchanged by this stream.
- **No LFO-destination additions.** `chorusMix`/`phaserMix`/etc. are automatable via clip automation
  (free, per `AUTOMATABLE_SYNTH_PARAMS`) but were not added to the curated `LFO_DESTS`/
  `LfoDestination` enum — that's a separate, smaller follow-up if wanted, not required by the brief.
- **No `Variation`/per-repeat `Pitch` for Beat Repeat** — research 17 §5.2 named these explicit
  follow-ups outside this first cut; unchanged.

## Verification bar

`npm run build` (root + `ui/`) and `npm test` — 298/298 passing, no regressions. `ui/` `tsc --noEmit`
clean. Live audio verification: `node ui/verify-phase22-stream-ac.mjs` — all five checks pass
(rerun twice to confirm not flaky).

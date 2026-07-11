# Phase 18 — Stream R: LFO depth (widened destinations + tempo-sync)

*Executed 2026-07-11. Owner: Will Patrick. Co-authored with Claude.*

Executes Stream R of `docs/phase-18-plan.md`, following `docs/research/18-ableton-ui-
architecture.md`'s LFO/modulation recommendation: **keep the literal, enumerated-destination
model — no free-routing matrix — and invest in coverage** (wider destination enum, tempo-sync).
No `App.tsx`/`ArrangementView.tsx` touched (Stream Q's territory); no `presets/`/`cli/` touched
(Stream S's territory).

## What was there before

`src/core/document.ts`'s `SYNTH_FIELDS` already had a fixed two-LFO model (`lfoRate/lfoDepth/
lfoDest/lfoShape`, `lfo2Rate/lfo2Depth/lfo2Dest`), each an *enum* destination (`LFO_DESTS`, not
exported), and `ui/src/audio/engine.ts` wired them into the live Tone.js graph. Two real gaps,
confirmed by reading the actual code (not assumed from the plan doc's premise) before touching
anything:

1. **`lfoSync`/`lfoSyncRate` did not exist anywhere** — not for drum voices, not for the main
   synth LFOs. They were listed in `src/core/convert.ts`'s `DELIBERATELY_UNMODELED` (a real
   BeatLab field the format never modeled), confirmed against `test/fixtures/real-sandbox.
   beatlab.json`, which carries `lfoSync`/`lfoSyncRate`/`lfo2Sync`/`lfo2SyncRate` on real exported
   tracks (all `false`/`"1/4"` in that fixture). The phase-18 plan's premise ("Phase 13's
   engine-parity doc mentioned lfoSync/lfoSyncRate were already ported for drum voices") did not
   hold up against the actual code — the plan doc itself flags this as worth verifying, and it
   didn't check out, so the design here starts from a clean slate rather than "extending" a
   pattern that wasn't there.
2. **A real, live bug in the destination enum.** `document.ts`'s `LFO_DESTS` was `['off',
   'pitch', 'cutoff', 'amp', 'wtPos']`, shared by both `lfoDest` and `lfo2Dest`. But `ui/src/
   audio/engine.ts` had **already been written** to switch `lfo2Dest` on a *different* set —
   `'pan'/'sendReverb'/'sendDelay'/'sendMod'/'eqLow'/'eqMid'/'eqHigh'/'distortionMix'` — none of
   which the document schema allowed for `lfo2Dest`. No `.beat` file could legally set
   `lfo2Dest: pan`; the engine branches that handled it were dead code. This is exactly the
   "LFO1 can't reach pan" gap research 18 called out, except worse: LFO2 couldn't legally reach
   it either, through the actual format.

## What changed

### `src/core/document.ts` (additive `SYNTH_FIELDS`, widened shared enum)

- **`LFO_DESTS` widened from 5 to 16 values** (`LfoDestination` type), now exported: `off, pitch,
  cutoff, resonance, amp, pan, wtPos, sendReverb, sendDelay, sendMod, eqLow, eqMid, eqHigh,
  compMix, distortionMix, bitcrushMix`. Still **one shared array for both `lfoDest` and
  `lfo2Dest`** (the existing convention — both fields already pointed at the same `LFO_DESTS`
  constant), which both widens *and* fixes the LFO2 dead-code bug: every destination the engine
  already knew how to apply is now schema-legal for both LFOs. New destinations
  (`resonance`, `compMix`, `bitcrushMix`) close the gap the plan asked about directly: all three
  are already reachable via clip automation (`AUTOMATABLE_SYNTH_PARAMS`, and already had live
  ramp code in `engine.ts`'s clip-automation switch) but had never been LFO targets.
- **`lfoSync: boolean` / `lfoSyncRate: LfoSyncRate`** added right after `lfoDest` (matching
  BeatLab's real field order from the fixture), and the same pair for LFO2 (`lfo2Sync`/
  `lfo2SyncRate`) after `lfo2Dest` — promoted out of `DELIBERATELY_UNMODELED`.
- **`LfoSyncRate`** = `'1/1' | '1/2' | '1/4' | '1/8' | '1/16' | '1/32' | '1/4t' | '1/8t' |
  '1/16t' | '1/4d' | '1/8d' | '1/16d'` (`t` = triplet, `d` = dotted — Ableton's convention).
  `LFO_SYNC_RATES` is the exported array; defaults are `'1/4'` for LFO1, `'1/8'` for LFO2.
- **`lfoSyncDivisionSeconds(bpm, division)` / `lfoSyncRateHz(bpm, division)`**: pure functions
  converting a division token to seconds-per-cycle / Hz at a given bpm (`"1/4"` = one quarter
  note = `60/bpm` seconds; triplet = 2/3 length; dotted = 1.5x length). Exported so both the
  engine (mirrored, see below) and any future consumer share one formula.
- `src/core/convert.ts`: removed `lfoSync`/`lfoSyncRate`/`lfo2Sync`/`lfo2SyncRate` from
  `DELIBERATELY_UNMODELED` — `toBeatSynth`'s generic `SYNTH_FIELDS` loop now carries them across
  a BeatLab-payload conversion automatically (verified against the real fixture, see below).
- `docs/format-spec.md` updated to match (optional-field count, the unmodeled list, a note on the
  now-shared/widened `LFO_DESTS`).

Nothing else in `src/core` referenced `LFO_DESTS`/LFO fields by name (`inspect.ts`, `cli/
beat.mjs`, `src/mcp/server.ts` all derive their field lists from `SYNTH_FIELDS` generically), so
no other file needed changes for the new fields to work end-to-end through `beat set`/`beat
inspect`/diff/CLI.

### `ui/src/audio/engine.ts` (additive LFO wiring)

`ui/` is a standalone Vite app with no build-time dependency on `src/core` (confirmed: no imports
across that boundary anywhere in `ui/src`), so its LFO destination/sync-rate constants are a
hand-kept mirror of `document.ts`'s, the same convention `OSC_SET` etc. already used.

- `LfoDest` widened to the same 16-value union; `Lfo2Dest`'s separate (previously mismatched)
  type removed — both LFOs now share one `LfoDest` type, matching the schema.
- `lfoSyncDivisionSeconds`/`lfoSyncRateHz` mirrored verbatim.
- `EngineSynth` gained `lfoSync`/`lfoSyncRate`/`lfo2Sync`/`lfo2SyncRate`; `coerce()` parses/
  validates them (falls back to `off`/`false`/`'1/4'`/`'1/8'` the same way every other field
  does).
- **Real tempo-tracking**: `tick()` now computes `lfoRateHz = p.lfoSync ? lfoSyncRateHz(doc.bpm,
  p.lfoSyncRate) : p.lfoRate` (and the LFO2 equivalent) **every tick**, reading the live
  `doc.bpm` from the store — not a value cached at note-on or at doc-load. A BPM edit changes the
  LFO's actual period on the very next scheduled 16th-note step. Applied to the main synth-track
  LFOs *and* the drum-bus LFO (`lfoDest`/`lfoDepth` already drove drum-bus cutoff/amp — it gets
  the same sync treatment for free since it reads the same synth-block fields).
- **Destination coverage**: cutoff/amp/pitch keep their existing special-cased handling (log-
  domain cutoff sweep around the automation base, dB-domain amp, per-note pitch multiplier) but
  now run for *either* LFO (previously LFO1-only). A new `applyLfoAdditive(dest, depth, lfoVal)`
  closure — one function, called once per LFO — handles the remaining 10 destinations
  (`resonance, pan, sendReverb, sendDelay, sendMod, eqLow, eqMid, eqHigh, compMix,
  distortionMix, bitcrushMix`... `wtPos` stays a deliberate no-op, wavetable oscillators aren't
  ported), reusing the exact same scaling the old LFO2-only code used for the destinations it
  already handled (pan ±1 clamped, sends `+d*0.5` clamped 0..1, EQ `±12dB`, mix params `+d*0.5`
  clamped 0..1) and extending the same shape to the three new ones (resonance `+d*8`, compMix/
  bitcrushMix same 0..1-clamped pattern as the sends).

### `ui/src/components/synthParams.ts` / `SynthPanel.tsx` (additive metadata + one new control kind)

- `synthParams.ts`'s local `LFO_DESTS` mirror widened to the same 16 values; added `LFO_SYNC_RATES`
  and a `b()` spec-builder for the new `'bool'` `ParamKind`. The `lfo` param group gained four
  entries: `lfoSync`/`lfoSyncRate` (labeled `Sync1`/`Rate1`) and `lfo2Sync`/`lfo2SyncRate`
  (`Sync2`/`Rate2`), placed right after their respective `Dest` control.
- `SynthPanel.tsx` gained a `kind === 'bool'` branch in `Control` — a checkbox, `postEdit`ing the
  literal strings `"true"`/`"false"` (matching `edit.ts`'s `'bool'` `SYNTH_FIELD` parsing exactly).

## Verification

### Real format round-trip (not just types)

```
$ node cli/beat.mjs set test.beat lead.lfoSync true
lead: lfoSync false -> true
$ node cli/beat.mjs set test.beat lead.lfoSyncRate 1/16t
lead: lfoSyncRate 1/4 -> 1/16t
$ node cli/beat.mjs set test.beat lead.lfoDest bitcrushMix
lead: lfoDest off -> bitcrushMix
```
`lfoSyncRateHz(120,'1/4')=2` (quarter note at 120bpm = 2Hz), `(240,'1/4')=4`, `(120,'1/4t')=3`
(triplet, 2/3 length), `(120,'1/4d')=1.333` (dotted, 1.5x length) — all match the hand-derived
theoretical values.

Real-fixture conversion (`test/fixtures/real-sandbox.beatlab.json`, actual BeatLab-shaped data):
before this change, `lfoSync`/`lfoSyncRate`/`lfo2Sync`/`lfo2SyncRate` were reported as
`droppedSynthParams`; after, `sandboxPayloadToBeatDocument` carries them through with zero
drops and the converted track reads back `lfoSync=false, lfoSyncRate='1/4', lfo2Sync=false,
lfo2SyncRate='1/4'` — matching the source exactly.

`ui/verify-p18-panel-check` (ad hoc, not committed): loaded the real live app, opened a synth
track's LFO group, confirmed `Sync1/Rate1/Sync2/Rate2` render alongside the existing controls,
clicked the Sync1 checkbox, and confirmed `doc.tracks[…].synth.lfoSync` flipped to `true` in the
live store via the real `POST /edit` path (not a mocked handler).

### Live engine verification: `ui/verify-phase18-lfo-depth.mjs`

Same harness/convention as `ui/verify-engine-parity.mjs` — headless Chromium drives the real
`ui/src/audio/engine.ts` over the real daemon, `engine.recordWav()` captures actual audio, and
`src/metrics` analyzes it. Three checks, all against **recorded audio**, not "the code path ran":

**TEMPO-SYNC** — one synth track holds a single long note, `lfoDest=amp, lfoDepth=1, lfoSync=true,
lfoSyncRate='1/4'`. Recorded 4s at bpm=90 and again at bpm=180 (same document, same LFO setting,
only bpm changed). Measured the amplitude-envelope's actual modulation frequency off the decoded
WAV (RMS envelope, smoothed to remove the note's own ~110Hz oscillator ripple, modulation
frequency estimated by counting mean-crossings over the steady-state middle 80%):

| bpm | measured | theoretical (bpm/60) |
|-----|----------|----------------------|
| 90  | 1.21 Hz  | 1.50 Hz |
| 180 | 3.02 Hz  | 3.00 Hz |

Ratio 2.50x for a 2x bpm change (same sync setting) — the LFO's *real* period, measured from
recorded audio, changes with tempo. This is the load-bearing claim Stream R had to prove: not a
fixed Hz, not "the code path executed," but an actually-recorded, actually-doubling modulation
rate driven by the engine's real tick/scheduling reading live `doc.bpm`.

**LFO1→PAN** (previously schema-illegal for LFO1 — the dead-code bug above): recorded a
static-pan take and an LFO1-pan take (`lfoDest='pan', lfoDepth=0.9, lfoRate=2.5Hz`) of the same
note, measured per-window left/right RMS balance. Stereo-balance coefficient of variation: static
**0.000** → LFO1-pan **0.35–0.39** (across repeated runs). LFO1 measurably swings the stereo
image, which was previously impossible through the format.

**LFO2→RESONANCE** (never an LFO destination before, on either LFO): recorded a static-resonance
take (`resonance=0.7` constant) and an LFO2-resonance take (`lfo2Dest='resonance', lfo2Depth=1,
lfo2Rate=2.5Hz`, same base 0.7) of the same filtered note. A resonance sweep boosts/cuts a narrow
band at a fixed cutoff rather than moving broadband loudness, so this measures per-window
spectral centroid (`src/metrics`' `analyze()`, the same tool every prior engine stream's
verification uses) rather than RMS. Spectral-centroid coefficient of variation: static
**0.004** (essentially flat, as expected for a steady tone) → LFO2-resonance **0.13** — a ~30x
increase. Raw per-window centroid trace for the swept take visibly cycles roughly every 400ms
(matching the 2.5Hz LFO rate) between ~210Hz and ~360Hz as the resonant peak grows and shrinks.

All three checks + the full three-group script pass reproducibly (run twice; TEMPO-SYNC's
measured Hz were bit-identical between runs, the CV numbers varied only in the third decimal).
One methodology note worth recording: the first version of this script ran all three test groups
in one browser page/engine instance and got a **backwards** result on LFO2→RESONANCE (static
looked more "modulated" than the swept take) — the engine keeps its Tone.js audio graph alive
across `setDoc()` calls by design (so live knob edits are heard on the next tick), which meant a
scheduled-but-not-fully-elapsed automation ramp from the *previous* test (a continuous pan sweep)
was still influencing the *next* recording. Giving each test group its own fresh page (fresh Tone
context) fixed it. Recorded here because it's a real thing to know about the engine, not a
one-off script bug: sequential `recordWav()` calls on the same long-lived engine instance can
carry state across takes if a prior take left long-running automation scheduled.

### `npm test`

287 tests / 287 pass / 0 fail / 0 skipped (root `npm test`, unchanged from the Phase 17
baseline — Stream R's `document.ts`/`convert.ts` changes are additive and didn't move this
number). `ui/` `tsc --noEmit` is clean.

## What's deferred

- **`wtPos` stays a no-op destination** on both LFOs, same as before this stream — wavetable
  oscillators were never ported to `ui/src/audio/engine.ts` (a Phase 13 Stream A scope decision,
  unrelated to LFO routing), so there's nothing for an LFO to modulate yet.
- **`lfoShape` stays sine-only** (`'custom'` is accepted by the schema but not rendered
  differently by the engine) — drawn/stepped LFO shapes are a separate, larger feature
  (`lfoSteps` is still in `DELIBERATELY_UNMODELED`) and out of this stream's scope.
- **A free-routing modulation matrix** was deliberately NOT built, per research 18's explicit
  recommendation — if dotbeat ever wants true per-parameter multi-target LFO routing, that's a
  dedicated future grammar pass (a `mod` block with explicit `source → target` rows), not an
  incremental widening of `lfoDest`/`lfo2Dest`.
- **A third/fourth LFO slot** (research 18's other suggested lever for closing the "LFO1 can't
  reach pan" gap) wasn't added — the shared-enum widening closed that specific gap without
  needing more LFO slots; more slots remain a reasonable future addition if the widened set turns
  out not to be enough in practice.
- **Drum-voice-specific LFO destinations** (e.g. modulating `kickTune`/`hatDecay` directly) stay
  out of scope — the drum bus LFO still only reaches `cutoff`/`amp` on the shared bus, same as
  before this stream; only its rate gained tempo-sync.

# Volume fader bugfix

*Investigated and fixed 2026-07-11. Owner: Will Patrick. Co-authored with Claude.*

The owner reported, while listening to the live app: *"Volume controls don't seem to work... at
-inf I can still hear the music very clearly... at high volumes, it sounds like I'm blowing out
the audio and its coming in weirdly."* This required real, measured audio, not just reading code —
see `ui/verify-volume-fader-bugfix.mjs` for the live evidence. Both symptoms turned out to be real,
independent bugs in `ui/src/audio/engine.ts`.

## Symptom 1 — "-∞" wasn't actually silent

`ui/src/components/MixerView.tsx` defines `VOL_MIN = -60` (dB); the fader's `fmtDb` label shows
`"-∞"` for anything at or below `VOL_MIN`, but the `Fader`'s `onChange` only ever **wrote** `-60`
(a plain finite number — `VOL_MIN + norm * (VOL_MAX - VOL_MIN)` clamped at `norm=0`). The engine
then applied that `-60` literally: `chain.vol.volume.value = p.volume`.

**Root cause: the label promised silence the document/engine never delivered.** -60dB is quiet,
but it is not silence — measured live (a single sustained synth note, real fader drag, real
recording): **peak -64.3dBFS, clearly audible**, not the near-total-silence a "-∞" label implies.
There was no override-race bug: none of the per-tick LFO-amp/automation/duck ramps investigated
(`chain.vol.volume.linearRampToValueAtTime(p.volume + ...)` for LFO-amp, the automation-lane
`'volume'` case, and the sidechain-duck ramps) were fighting a fresh fader write with a stale
cached value — `p.volume` is re-read from the live document every tick (`coerce(track.synth)`
inside `tick()`), so it was always current. The bug was simpler and squarely in the write path:
-60dB was simply the wrong floor for what "-∞" promises.

### The fix

`-Infinity` can never be **persisted** in a `.beat` file — `src/core/parse.ts`'s
`parseFloatStrict` explicitly rejects non-finite numbers (`!Number.isFinite(n)` throws), by
design, so the document's `volume` field stays a normal finite number and the fader keeps writing
`-60` exactly as before. Instead, `ui/src/audio/engine.ts` now floors the value **at the point
it's applied to the live audio graph**:

```ts
const VOLUME_SILENCE_FLOOR_DB = -60
function applyVolumeFloor(db: number): number {
  return db <= VOLUME_SILENCE_FLOOR_DB ? -Infinity : db
}
```

Tone.js's `Param` (units `"decibels"`) converts through `dbToGain()` before scheduling any native
`AudioParam` automation, and `dbToGain(-Infinity) === 0` (a finite number), so `-Infinity` dB is a
fully Tone-native way to express **exact zero gain** — no exceptions, no special-casing needed in
the ramp/ ramp-to-value call sites.

Applied at every place a track's volume reaches the audio graph:
- `coerce()` — the single conversion point `EngineSynth.volume` is built from, so every synth-chain
  and drum-bus read (`sync()`, the per-tick LFO-amp ramps, the automation `'volume'` case, the
  sidechain-duck ramps) gets the floor for free, closing the "could an override race reintroduce
  sound" question from the investigation as a side effect: `-Infinity + <anything finite>` stays
  `-Infinity`.
- The two instrument-track (SoundFont) call sites that read `inst.volume` directly, bypassing
  `coerce()` (`buildInstrument`'s initial `Tone.Volume(...)` and `syncInstruments`'s per-tick
  apply) — these needed the same `applyVolumeFloor()` call explicitly.

### A second bug this surfaced: an audible "click" at the transition

While verifying the silence fix, recording *immediately* after a fader-drag-to-bottom sometimes
caught a brief non-silent transient. Two separate things were going on:

1. `chain.vol.volume.value = p.volume` (and the equivalent line in `applyDrumBusParams`/
   `syncInstruments`) was an **instantaneous jump**, not a ramp — every other continuously-tweaked
   param in the same function (`chain.filter.frequency.rampTo(p.cutoff, 0.02)`) was already
   ramped specifically to avoid zipper noise; volume was a pre-existing inconsistency. Fixed: both
   now use `.linearRampTo(p.volume, 0.02)` (linear, not the dB-oriented `.rampTo()`, which goes
   exponential and floors at a small epsilon instead of reaching exact 0 — a linear ramp on a
   `-Infinity` dB target still lands at true zero gain, verified live).
2. The bigger contributor: the ENGINE only re-syncs its live audio graph from the document once
   per 16th-note tick (`tick()`'s own header comment — *"Re-sync each tick so live knob/step edits
   are heard on the next step... BeatLab does the same"*), up to ~125ms of latency at 120bpm. A
   test that polls the **document** store and records immediately can catch that intentional,
   documented catch-up window. This isn't a bug — it's the documented per-tick architecture — so
   the verify script gives it a couple of ticks' margin before recording, same as a real listener
   wouldn't judge "is it silent yet" from the literal millisecond they released the mouse.

## Symptom 2 — high volumes "blowing out weirdly"

The master bus already has a real limiter (`Tone.Limiter(-1)` in `getMaster()`) between the mix
and the destination, so there was no hard brick-wall digital clipping to find. But measuring real
rendered audio across the fader's range (single plain synth voice, default patch, `VOL_MIN=-60` to
`VOL_MAX=+6`, matching Ableton Live's own -∞..+6dB channel-fader convention) found real, audible
degradation well within normal fader travel — **before** the fader's own extremes come into play:

| track `volume` | peak (pre-fix) | crest factor (pre-fix) |
|---|---|---|
| -10dB (schema default) | -7.5 dBFS | 8.1 dB (clean) |
| 0dB | 0.0 dBFS | 3.9 dB (heavily squashed) |
| +6dB (fader max) | 0.0 dBFS | 1.3–1.8 dB (brick-walled/pumping) |

Crest factor (peak minus RMS) collapsing from ~8dB to ~1-2dB is the textbook signature of a
limiter squashing hard, not "loud but clean" — that pumping/dynamics-loss character is exactly
what "blowing out... coming in weirdly" sounds like.

**Root cause: no headroom compensation on the additive synth voice bank.** `buildSynthChain()`
sums the primary oscillator, `osc2`, `osc3`, four unison pairs, `sub`, `noise`, and `fm` directly
into `filter` at raw, unscaled unity gain. Even a **single held note on the bare primary voice
alone** — no unison, no extra oscillator layers — already peaked near 0dBFS at just 0dB fader
(no boost at all), leaving almost no real headroom before the master limiter had to work hard. By
contrast, the drum bus's individual voices already carry hand-tuned per-voice `.volume` trims
(kick -2dB, snare -8dB, hat -18dB, openhat -20dB) — exactly the kind of gain-staging discipline
the synth voice bank was missing. This was confirmed as the drum-specific case, not a general
engine issue: a drum pattern pushed to the same `+6dB` bus volume measured **18.7dB crest factor**
— clean, healthy, no fix needed there.

### The fix

A fixed -9dB headroom trim (`Tone.Gain(Tone.dbToGain(-9))`), inserted between the additive voice
sum (`filter`'s output) and the insert chain (EQ/comp/distortion/bitcrush), synth tracks only:

```ts
const headroom = new Tone.Gain(Tone.dbToGain(-9))
// ...
filter.connect(headroom)
this.wireInsertChain(headroom, eq3, compIn, compOut, distortion, bitcrush, muteGain)
```

This does not change what the `volume` dB field *means* (0dB is still "no additional boost/cut on
top of the patch's own headroom-compensated level") — it just gives the voice bank the same kind
of sane pre-fader level the drum kit's voices already had. Measured after the fix:

| track `volume` | peak (post-fix) | crest factor (post-fix) |
|---|---|---|
| -10dB (schema default) | -15.0 dBFS | 10.2 dB |
| 0dB | -6.1 dBFS | 8.0 dB |
| +6dB (fader max) | -0.0 dBFS | 4.6 dB |
| +6dB, every additive layer maxed on purpose (unison=7, osc2/sub/noise/fm=1) | 0.0 dBFS | 4.4 dB |

The extreme top of the range (`+6dB` on an already-hot patch) still reaches the master limiter's
ceiling — **that is by design**, the same way a real channel-strip fader's boost range is meant to
let you push a quiet source hard, at the cost of some compression if the source is already loud.
The difference from the pre-fix bug is that it's now *clean* limiting (crest factor still 4-6dB,
true-peak overs under 1.5dBTP) instead of the pre-fix *collapse* into a flat, pumping waveform
(crest factor 1.3-1.8dB). Deliberately maxing every additive layer AND pushing the fader to its
ceiling still produces mild, expected compression — not the "blown out and weird" character the
owner reported.

Default patches now sit a few dB lower in the level meter at their schema-default `-10dB` (peak
around -15dBFS instead of -7.5dBFS) — this is intentional: real headroom for chords, multiple
simultaneous voices, and multiple tracks summing, which is what the fader's own `+6dB` of boost
range is for.

## What was NOT a bug

- **The fader's own 0..1-to-dB mapping** (`VOL_MIN + norm * (VOL_MAX - VOL_MIN)`, linear over the
  dB range) — this is standard, DAW-conventional fader curve math (matches Ableton Live's own
  -∞..+6dB channel-fader range exactly). No accidental double-application of gain, no dB-treated-
  as-linear-gain bug, no duplicate volume stage found anywhere in the synth or drum signal chains.
- **The master limiter** — already present, already correctly positioned (post-sum, pre-
  destination), already protecting against hard digital overs. It just had almost nothing (the
  synth voice bank's missing headroom) to protect against until it was driven far too hard by
  ordinary use.
- **The drum bus** — already well headroomed via per-voice `.volume` trims; measured clean
  (18.7dB crest factor) at the same `+6dB` bus volume that squashed the synth chain to 1.3dB
  pre-fix. Left untouched.
- **Instrument (SoundFont) track loudness** — not flagged by the investigation and not touched
  beyond the silence-floor fix (SoundFont samples are pre-mixed and were not observed clipping).

## Verification

`ui/verify-volume-fader-bugfix.mjs` drives the **real** mixer fader in the real GUI — a Playwright
pointer drag on the actual `.mixer-fader` element (not `window.__store.setDoc()`) — lets the
resulting `postEdit` round-trip through the real daemon exactly like a human drag would, and
records/measures real audio off the engine (`window.__engine.recordWav()` + `src/metrics`'
`analyze()`, the same evidence bar every `ui/verify-*.mjs` script in this repo uses):

1. Drags the fader to its exact minimum → asserts the *label* reads `"-∞"` **and** the recorded
   audio is genuinely silent (peak < -90dBFS; measured exactly `-Infinity` dBFS in practice).
2. Drags to the middle and to the maximum → asserts a real, measured, **monotonic** RMS increase
   across all three positions.
3. At the maximum, asserts the label reads `"+6.0"` and that any limiting present stays *clean*:
   crest factor > 4dB (not the pre-fix ~1.3dB collapse) and true peak < 3dBTP (no wild
   uncontrolled overs past the master limiter's threshold).

Confirmed the test is meaningful, not trivially passing: temporarily reverting the `engine.ts` fix
and re-running reproduces the exact original bug (`peak -64.3dBFS` at the fader's labeled `"-∞"`
minimum — quiet, not silent) and fails the `[MIN]` check as expected.

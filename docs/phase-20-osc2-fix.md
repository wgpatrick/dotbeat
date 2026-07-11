# Phase 20 Stream Y — Osc2 apply-chain: investigation result

**Outcome: no code bug found. The Osc2 GUI apply-chain is correct.** Driving `lead.osc2Level`
(and `osc2Detune`/`osc2Type`) through the GUI's real `postEdit` path updates the in-browser store
*and* measurably changes the live audio. Both hypotheses named in the Stream Y brief were tested
directly against the running app and both are false. The original "spectral centroid barely moved"
observation is real and reproducible — but it is a **measurement artifact of the night-shift lead
patch**, not a broken apply chain. Details and evidence below.

This is reported as a "no-op fix" deliberately and with evidence, per the brief's instruction:
*"if Osc2 was an isolated case, confirm that with real spot-checks … rather than just asserting it."*
The honest finding is stronger than that: Osc2 was not broken at all.

## What the brief said to check, and what the code actually does

The brief flagged two candidate root causes:

1. **`ui/src/daemon/bridge.ts` `applyLocalEdit` mishandling the generic synth-param path.**
   Checked in full. `osc2Level`/`osc2Detune` are numbers, `osc2Type` is a string; none match the
   earlier branches (pattern / instrument-block / note grammar), so they fall through to the generic
   synth-param mirror at the end of the function:

   ```ts
   const num = Number(value)
   let nextVal: number | string | null
   if (rest === 'duckSource') nextVal = value === 'none' ? null : value
   else if (value.trim() === '' || Number.isNaN(num)) nextVal = value
   else nextVal = canon(num)
   const tracks = doc.tracks.map((t, i) => (i === idx ? { ...t, synth: { ...t.synth, [rest]: nextVal } } : t))
   return { ...doc, tracks }
   ```

   For `lead.osc2Level = "1.0"` this returns a new doc with `synth.osc2Level = 1` (number). It never
   returns `null` for a valid synth-track path, so `postEdit` always calls `setDoc` optimistically —
   the store updates synchronously, before the daemon round-trip. This path has existed unchanged
   since Phase 13 Stream B (`git log -L` on those lines confirms no later edit), so there was never a
   regression here to fix.

2. **`ui/src/audio/engine.ts` `sync()`/`applyParams` not re-applying osc2 on every doc change.**
   Checked in full and instrumented at runtime. `sync()` runs every 16th-note tick (`tick()` calls
   `this.sync(doc)` with the *current* store doc), and `applyParams` unconditionally re-writes
   `chain.osc2Gain.gain.value = p.osc2Level` and re-`set`s the osc2 oscillator type every call. A
   temporary `window.__osc2dbg`/`__osc2trig` trace confirmed, during live playback with
   `osc2Level = 1`: `osc2GainVal = 1`, `osc2Type = "sawtooth"`, osc2 `triggerAttackRelease` firing at
   the correct detuned frequency. osc2 is *not* applied only at chain-build time — it is re-synced
   every tick. (The trace was removed after diagnosis; `engine.ts` is unchanged from `main`.)

Neither file needed a change. `git diff` against `main` for both `bridge.ts` and `engine.ts` is empty.

## Reproduction and evidence (headless Chromium + real daemon + the real `postEdit` path)

All measurements captured from the live GUI engine (`engine.recordWav`, the same MediaRecorder →
opus → decode path the engine-parity harness uses) and analyzed with the repo's own `src/metrics`.
Edits driven through `window.__bridge.postEdit` — the exact function every knob's `onChange` fires,
*not* a raw daemon curl. Harnesses: `ui/verify-osc2-fix.mjs`, `ui/probe-osc2c.mjs`,
`ui/probe-nightshift.mjs`.

### A. The exact reported scenario — night-shift lead, `postEdit('lead.osc2Level', '1.0')`

Recording the full 4-bar loop (the lead's notes start at step 20, so a short capture is silence),
lead soloed:

| metric | before (0.45) | after (1.0) | delta |
|---|---|---|---|
| store `osc2Level` | **0.45** | **1** | updated correctly |
| spectral centroid | 1709 Hz | 1685 Hz | **−24 Hz (barely moved)** |
| integrated LUFS | −15.1 | −13.9 | **+1.2 dB (louder)** |

This reproduces the brief's "centroid barely moved" symptom exactly — **and explains it**. The
store updates fine (0.45 → 1; the "store shows the OLD value" half of the diagnosis does not
reproduce). The audio *does* change: it gets ~1.2 dB louder. The centroid stays flat because
night-shift's lead has **`osc2Detune 14`** (14 cents — essentially unison) on the **same square
waveform** as the base oscillator. Raising a near-unison same-waveform layer's level adds
**loudness, not brightness**, so spectral centroid is the wrong probe for *this* patch. Nothing is
lost in the apply chain.

### B. Clean isolation — is osc2 audibly applied at all? (`probe-osc2c.mjs` / `probe-osc2b.mjs`)

Controlled patch (sine base, cutoff wide open, osc2 = sawtooth): `postEdit` osc2Level 0 → 1 vs. a
direct `setDoc` of the same value, so any GUI-path-specific loss would show as a mismatch:

```
baseline (file osc2Level 0)   store=0   centroid 110 Hz
via postEdit -> 1             store=1   centroid 262 Hz   (dCentroid +152 Hz)
via setDoc   -> 1             store=1   centroid 262 Hz
postEdit vs setDoc delta:     centroid 0 Hz, LUFS 0.00
```

The real `postEdit` path delivers osc2 **identically** to a direct `setDoc` (0 Hz difference), and
osc2Level 0 → 1 shifts the centroid **+152 Hz** — a large, unambiguous change. Isolation sweep
(`probe-osc2b`) confirms osc2 contributes real energy and brightness: adding the osc2 saw raised
loudness by +2.9 LUFS (over a sine base) to +4.8 LUFS (over a saw base), and an octave-shifted osc2
moved the centroid 110 → 260 Hz. osc2 works.

## Spot-check — same bug class on neighboring SYNTH_FIELDS? (`verify-osc2-fix.mjs`)

Each field driven 0/low → high through the real `postEdit` path; store value AND live audio
measured before/after. "audio moved" = |Δcentroid| > 150 Hz or |ΔLUFS| > 1.5.

| field | store reflected? | Δcentroid | ΔLUFS | audio moved? |
|---|---|---|---|---|
| osc2Level (0.05→1.0) | ✅ (after=1) | +103 Hz | +0.6 | modest* |
| osc2Detune (0→1200) | ✅ (after=1200) | +39 Hz | −1.3 | modest* |
| subLevel (0→1.0) | ✅ (after=1) | −34 Hz | +1.8 | ✅ |
| noiseLevel (0→1.0) | ✅ (after=1) | +1531 Hz | +2.4 | ✅ |
| unisonVoices (1→7) | ✅ (after=7) | +281 Hz | −1.6 | ✅ |

**The store updates for every field** (the mirror never silently drops a value). subLevel /
noiseLevel / unisonVoices move the audio strongly. osc2 (`*`) moves it less *in this particular
sweep config* because the sweep uses two loud base-sine notes and a 0.05 low anchor, so a single
detuned saw is a smaller relative contribution — exactly the same "wrong-probe / base-dominates"
effect as scenario A, not a lost value (scenario B proves osc2 moves +152 Hz when isolated). No
field exhibits the "GUI mirror silently fails to apply" bug the brief was hunting for.

Note: `osc3` is not an independent field — it is driven by `unisonVoices >= 3` gated on `osc2Level`
(see `engine.ts applyParams`/`tick`), so the `unisonVoices` row exercises the osc3 path too.

## Why the original diagnosis read as a bug

The most likely origin of the report: the investigator adjusted `osc2Level` on **night-shift's
lead** and measured **spectral centroid**. Because that patch's osc2 is a 14-cent near-unison square
(loudness layer, not a timbral one), the centroid genuinely does not move — reproduced here as
−24 Hz. Pairing that with a mistaken read of the store value ("still 0.45") produced the
"apply-chain is broken" conclusion. Under real measurement the store updates (0.45 → 1) and the
audio changes (+1.2 dB), so the apply chain is sound.

## Verification status

- `ui/` typechecks clean (`tsc --noEmit`, exit 0).
- Root `npm test`: **298 tests, 295 pass, 0 fail, 3 skipped** — unchanged (no `src/` touched).
- Source changes: none to `bridge.ts` or `engine.ts`. The only product-source change is a one-line
  harness export in `ui/src/main.tsx` exposing the bridge module on `window.__bridge` (mirroring the
  existing `window.__store`/`window.__engine` convention), so the verification harness can drive the
  real `postEdit` path instead of a raw daemon curl. Verification harnesses added under `ui/`:
  `verify-osc2-fix.mjs`, `probe-osc2c.mjs`, `probe-nightshift.mjs`.

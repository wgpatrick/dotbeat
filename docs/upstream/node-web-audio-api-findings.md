# Upstream findings: node-web-audio-api 2.0.0 (ircam-ismm)

Two behavioral divergences from Chromium's Web Audio implementation, found while running
BeatLab's real Tone.js engine offline (Phase 4, 2026-07-10), each isolated to a minimal repro.
Kept here so they can be filed upstream and so our runner's workarounds
(`cli/render-offline.mjs`) can be deleted when fixed. A third item is a spec-conformance
difference where the Rust engine is arguably *right* and Chromium is lenient.

## 1. OscillatorNode + PeriodicWave explodes under FM through zero frequency (bug)

An oscillator using `setPeriodicWave` whose `frequency` AudioParam is audio-rate-modulated to
negative values produces unbounded output (observed peaks 1e5-8.5e6). Chromium renders the same
graph at normal amplitude (the spec allows negative frequency — phase runs backward). Sine-type
oscillators are unaffected; the blowup scales with how far the excursion crosses zero.

```js
// repro: peak should be ~1.0; prints ~1.18e5
import 'node-web-audio-api/polyfill.js'
const Tone = await import('tone')
const off = new Tone.OfflineContext(1, 0.5, 44100)
Tone.setContext(off)
const fm = new Tone.FMOscillator({ frequency: 200, harmonicity: 5.1, modulationIndex: 32, type: 'square' })
fm.toDestination(); fm.start(0)
const buf = await off.render(false)
let peak = 0
for (const v of buf.getChannelData(0)) if (Number.isFinite(v)) peak = Math.max(peak, Math.abs(v))
console.log(peak) // sine type -> 1.0; square (PeriodicWave) -> ~1.18e5
```

Data points: `modulationIndex 0.4` (swing ±80 Hz around 200 Hz, stays positive) → peak 1.0;
`2` (±400, crosses zero) → 2.5e3; `32` (±6400) → 1.2e5. Practical impact: `Tone.MetalSynth`
(hi-hats/cymbals in many Tone.js projects) is square-carrier FM at index 32 — unusable.
Our workaround: sine carriers for those instruments in offline mode only.

## 2. DynamicsCompressorNode auto-makeup differs from Chromium (divergence)

Both implementations apply automatic makeup gain, but with different formulas: a -20 dBFS
440 Hz sine through `{threshold: -24, ratio: 12, knee: 30}` comes out at ~-15.3 dBFS here vs
~-13 dBFS in Chromium (~2 dB per stage). Stacked stages (master limiter + bus compressor in a
typical project) accumulate a constant offset — we measured 9.5 LU on a real 4-track project.
The offset is pure gain (LUFS and peak offsets agree within 0.8 dB), so relative measurements
are unaffected; absolute loudness comparisons across implementations are not possible. The spec
describes makeup only loosely, so this may be "both conformant, both different" — worth an
upstream conversation rather than a bug report per se.

## 3. WaveShaperNode.curve is write-once here, lenient in Chromium (spec conformance)

The spec says re-assigning a non-null `curve` throws `InvalidStateError`; this implementation
enforces it ("cannot assign curve twice"), Chromium allows re-assignment. Real-world libraries
rely on the leniency — Tone.js's `Distortion.distortion` setter re-assigns the curve on every
parameter change. Not an upstream bug (arguably upstream is the conformant one); noted because
any Tone.js-on-Node user will hit it. Our workaround: a `createWaveShaper` wrapper with stable
gain endpoints and a swappable inner shaper, preserving true curve updates.

## Also relevant: worklet support exists natively but not through standardized-audio-context

`OfflineAudioContext.audioWorklet` is present on the native context here, but
`standardized-audio-context` (Tone's wrapper layer) does not detect/wire worklet support in
Node, so `Tone.BitCrusher` et al. can never construct their processors. That's an integration
gap between the two libraries rather than a bug in either; our workaround parks the worklet
module load so effects degrade to their dry path instead of crashing.

## Performance note (not a bug, a measurement)

Full-graph offline rendering of a ~120-node Tone.js project (PolySynth voice pools, per-track
filter/EQ/compressor chains, sends, 6-oscillator MetalSynths) runs at ~0.73× realtime on this
implementation (Linux x64 container, single render thread), while a ~10-node graph renders at
22× realtime. We have not profiled where the time goes; noting it as the motivating question
for engine-architecture research, not as a complaint.

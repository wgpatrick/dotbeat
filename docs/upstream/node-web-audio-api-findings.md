# Upstream findings: node-web-audio-api / web-audio-api-rs

> **Revised 2026-07-10 (second pass).** The first version of this document attributed the
> oscillator explosion to PeriodicWave. Deeper bisection — raw polyfill vs standardized-audio-
> context vs Tone, per oscillator type, then reading the crate's git history — corrected the
> attribution and materially changed what "upstream fixes" means. Old claims are struck through
> rather than deleted; this project's habit of leaving corrections visible applies to itself.

Context: `node-web-audio-api` (npm) is a thin napi-rs binding; the actual DSP engine is the
separate Rust crate `orottier/web-audio-api-rs` (confirmed in `research/05`). npm 2.0.0 pins the
crate's **1.6.0 release**.

## 1. Native square/sawtooth oscillators explode under FM through zero — FIXED UPSTREAM, UNRELEASED

~~PeriodicWave oscillators explode when FM-modulated to negative frequencies~~ — **wrong on
both counts**: PeriodicWave (custom-wavetable) oscillators handle negative-frequency FM fine at
any partial count, and the explosion is in the **built-in `square` and `sawtooth` types**
(peaks 8.5e6 / 9.3e6; `triangle` mildly misbehaves at 7.5; `sine` clean). Tone.js's "square" uses
the native type — hence Tone.MetalSynth (hi-hats in countless Tone projects) rendering as a wall
of clipping noise.

```js
// repro against npm node-web-audio-api@2.0.0 — peak should be ~1.0, prints ~8.5e6
import { OfflineAudioContext } from 'node-web-audio-api'
const ctx = new OfflineAudioContext(1, 22050, 44100)
const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 200
const mod = ctx.createOscillator(); mod.frequency.value = 1020
const g = ctx.createGain(); g.gain.value = 6400 // swings frequency to -6200..6600
mod.connect(g); g.connect(o.frequency)
o.connect(ctx.destination); o.start(0); mod.start(0)
const d = (await ctx.startRendering()).getChannelData(0)
console.log(Math.max(...d.map(Math.abs)))
```

**The crate's main branch already fixes this** — commits after the `v1.6.0` tag
(`8b9bc95 "OscillatorNode: also guard for negative nquist freqs"`,
`4fa7bf5 "avoid a panic when re-entering audible range"`, and follow-ups). Verified directly:
the binding rebuilt against main (`scripts/build-patched-webaudio.sh`, crate rev `4522d99`)
renders all types at peak 1.00 under the same FM, and the full-project fidelity check now
matches the Chromium reference's high-band energy to 0.01%.

**Upstream action: not a bug report — a release request.** Ask `orottier/web-audio-api-rs` to
cut a post-1.6.0 release and `ircam-ismm/node-web-audio-api` to rebuild against it. Our build
script is the stopgap; delete it (and the `file:` dependency) when those releases exist.

Minor residual (still true on main, low priority): a *constant* negative `frequency.value` on a
PeriodicWave oscillator renders near-silence (~-38 dBFS) where Chromium plays the waveform
backward per spec — only reachable via param automation since the param clamps at the API layer.

## 2. DynamicsCompressor level offset — NOT an upstream bug; Chromium-vs-spec divergence

~~The Rust engine's auto-makeup formula should be patched to match Chromium's~~ — **withdrawn
after reading the crate's source**: `dynamics_compressor.rs` implements the WebAudio *spec's*
makeup formula verbatim (`(1/db_to_lin(threshold·(1−1/ratio)))^0.6`). The measured ~2 dB/stage
difference (stacking to a constant 9.5 LU on beatlab's chain) is Chromium deviating from the
simplified spec model — or knee-curve implementation differences inside the spec's latitude. A
"match Chromium" patch would rightly be rejected as a spec regression.

**Resolution: calibrate, don't patch.** The offset is pure linear gain (LUFS and peak offsets
agree within 0.8 dB), so within-path arithmetic is exact (+3 dB asked → +3.00 LU measured);
cross-path absolute loudness targets use the Chromium reference per decision D5, mapped through
the measured offset. Worth an upstream *conversation* (both projects may want a compat note),
not a bug report.

## 3. WaveShaperNode.curve write-once — upstream is spec-conformant, Chromium is lenient

Unchanged from the first pass: the spec says re-assigning a non-null curve throws; the Rust
engine enforces it, Chromium doesn't, and Tone.js relies on the leniency (Distortion re-assigns
per parameter change). Our runner's stable-endpoints/swappable-shaper wrapper handles it with
full fidelity (and enabled the bitcrusher stand-in below). A compatibility note upstream would
save the next Tone-on-Node user a night of debugging.

## 4. Worklet support gap — routed around entirely

`standardized-audio-context` (Tone's wrapper) doesn't wire Node worklet support even though the
native context has it. Originally we parked the worklet load (bitcrush wet path silent); now the
runner substitutes a **WaveShaper-backed stand-in** for Tone's bitcrusher (its DSP is pure
memoryless quantization — exactly a stepped curve), verified to produce real quantization
harmonics. The gap itself is an integration issue between `standardized-audio-context` and
non-browser environments; still worth reporting there, but nothing here depends on it anymore.

## Performance note (unchanged, now research-backed)

Full-graph offline rendering runs ~0.73× realtime; `research/05-engine-architecture.md`
verified the likely cause upstream (maintainer profiling: `Graph::order_nodes` at 58% of
execution under many-node/topology-churn workloads, issue open) — and Tone's node-per-note
voice model is churn-maximizing. The upstream issue is the right place to engage; a
graph-churn-reducing change on the Tone/engine side is the lever we control.

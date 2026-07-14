# Render determinism — measured run-to-run variance of `beat render`

Phase 34 Stream NC (2026-07-13). Prior data points: docs/phase-5-plan.md's Result measured
±0.4 LU / ±4 band pts / ±2 dB width on the pre-D15 offline renderer; docs/research/96 (CLI vary
pilot) observed a ~0.9 dB true-peak swing between two back-to-back renders of an unchanged file
on the current engine. This stream measured the current path properly, diagnosed the source, and
encoded the honest tolerance.

## How the render path works (why it can vary at all)

Since D15, `beat render` is a **real-time capture**: it boots the daemon + a production ui/ build
in headless Chromium, calls `engine.play()`, waits 250 ms for the graph to settle, then
`engine.recordWav(seconds)` — a MediaRecorder on the live post-limiter master bus
(webm/opus → decode → WAV). Nothing in that pipeline is an offline deterministic bounce.

## Measurements (scripts/measure-render-determinism.mjs)

N renders of the same unchanged .beat, sequential, same machine, headless Chromium
(`CHROME_PATH` set). Spread = max − min across runs. "Trimmed" re-runs the identical comparison
after cutting each capture to its first frame above −60 dBFS and truncating all runs to the
shortest trimmed length — i.e. with any capture-start alignment difference removed.

### examples/real-groove.beat — N=8 (7.74 s captures)

| metric | untrimmed spread | trimmed spread |
|---|---|---|
| LUFS integrated | 0.038 LU | 0.041 LU |
| true peak | 0.587 dB | 0.587 dB |
| sample peak | 0.587 dB | 0.587 dB |
| crest | 0.603 dB | 0.603 dB |
| RMS | 0.033 dB | 0.033 dB |
| band shares (worst: bass) | 0.36 pt | 0.39 pt |
| centroid | 8.1 Hz | 4.0 Hz |
| stereo width | 0.747 dB | 0.747 dB |

Capture framing was **byte-identical across all 8 runs**: same byte length (1,365,376), same
frame count (341,333), leading "silence" 315–319 frames (7.1–7.2 ms — that's the opus decoder's
priming, not jitter; spread 0.1 ms ≈ 4 samples).

### examples/night-shift-song.beat — N=5 (64.0 s captures, 33-bar song, hits the limiter)

| metric | untrimmed spread | trimmed spread |
|---|---|---|
| LUFS integrated | 0.153 LU | 0.166 LU |
| true peak | 0.080 dB | 0.080 dB |
| sample peak | 0.000 dB (pinned at 0 dBFS by the limiter) | 0.000 dB |
| crest / RMS | 0.169 dB | 0.173 dB |
| band shares (worst: sub) | 1.61 pt | 1.63 pt |
| centroid | 7.7 Hz | 7.8 Hz |
| stereo correlation | 0.014 | 0.014 |
| stereo width | 1.317 dB | 1.317 dB |

Capture length fell in two groups 60 ms apart (MediaRecorder stop timing quantized to opus
frames — tail-only, after the musical content); leading silence 5.2–6.0 ms (spread 0.8 ms).

## Diagnosis: DSP variance, not capture alignment

The alignment hypothesis (capture starting at a jittery offset relative to transport start) is
**refuted** on both projects:

- Leading-edge alignment is essentially deterministic — leading-silence spread was 0.1 ms and
  0.8 ms, and real-groove's captures were byte-length-identical.
- Trimming to the first non-silent sample changes **nothing**: every metric's spread survives
  trimming essentially unchanged (width 1.317 dB both ways, sub band 1.6 pt both ways). If
  alignment dominated, the trimmed spreads would collapse.

What remains is genuine engine run-to-run variance, consistent with the phase-5 attribution: the
transport starts at an arbitrary phase within the audio context's 128-sample render quantum, so
scheduled note-ons/LFOs quantize onto different quanta each run and voice **phase relationships**
differ. That is exactly the signature in the numbers: energy metrics (LUFS, RMS) are nearly
deterministic (≤0.17 LU) because phase doesn't move energy, while phase-sensitive metrics move —
peak summation (true peak/crest ~0.6 dB on the unlimited mix), L/R phase relations (width up to
1.3 dB), and low-frequency bin energy under a 4096-FFT (sub/bass shares up to 1.6 pt).

Also note the current engine is far better than the phase-5-era numbers suggest: ±0.4 LU then vs
≤0.17 LU now. Research/96's "~1 dB between identical re-renders" was a **true-peak** swing, not
LUFS — reproduced here (0.59 dB spread at N=8; a 2-sample estimate can easily see 0.9 dB).

## What was fixed

Nothing in `cli/render.mjs` — by the plan's own criterion (fix only if alignment dominates and
the fix is fidelity-neutral), there is nothing safe to fix there: the variance is in the DSP, and
an amplitude-based trim would risk eating musical leading silence while changing no metric that
matters (trimming demonstrably does not reduce the spread). The tolerance is encoded instead.

## Tolerance consumers should assume

Constants in `src/metrics/variance.ts` (exported from `src/metrics`), set to the measured
cross-project max spread rounded up:

| constant | value | measured max |
|---|---|---|
| `RENDER_RUN_VARIANCE_LU` | 0.25 LU | 0.17 LU |
| `RENDER_RUN_VARIANCE_PEAK_DB` | 1.0 dB | 0.59 dB (0.9 dB in research/96) |
| `RENDER_RUN_VARIANCE_BAND_PCT` | 2.0 pt | 1.6 pt |
| `RENDER_RUN_VARIANCE_WIDTH_DB` | 1.5 dB | 1.32 dB |

Wired in:

- **`beat lint`** pads every threshold by the matching constant (src/metrics/lint.ts), so a
  finding only fires when the measurement is outside the render noise floor — re-rendering an
  unchanged file can't flip a finding for a mix sitting at a nominal threshold (where real mixes
  cluster: limiters aim at −1 dBTP, normalization at the LUFS target). Findings report the
  effective (padded) threshold.
- **`beat metrics --json`** and MCP **`beat_metrics`** attach a `meta.renderRunVariance` block
  (single definition: `RENDER_RUN_VARIANCE_META`) so machine consumers know the noise floor.
- **vary batches**: the manifest-writer comment in `src/vary/batch.ts` cites the numbers — only
  compare renders from the same batch, and treat metric deltas inside these bounds as ties.

Practical reading for humans and agents: a LUFS delta under ~0.25 LU, a peak/crest delta under
~1 dB, a band-share delta under ~2 pt, or a width delta under ~1.5 dB between two renders is
**not evidence of a real audio difference**.

## Re-running the measurement

```sh
npm run build          # dist/src/metrics must exist
CHROME_PATH=/path/to/chromium \
  node scripts/measure-render-determinism.mjs examples/real-groove.beat 8 --trimmed
node scripts/measure-render-determinism.mjs examples/night-shift-song.beat 5 --trimmed
```

Defaults: `examples/real-groove.beat`, N=8, wavs kept in
`<tmpdir>/render-determinism-<name>/run-N.wav`. `--out-dir <dir>` to choose where; `--reuse` to
re-analyze existing wavs without re-rendering; `--threshold-db` to move the −60 dBFS silence
threshold. Exits nonzero only on render/decode failure — variance is a measurement, not an error.

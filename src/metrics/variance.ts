// Phase 34 Stream NC — measured run-to-run variance of `beat render`'s real-time capture.
//
// `beat render` drives dotbeat's own engine in headless Chromium (D15) and captures the live
// master output in real time. Two renders of the SAME unchanged .beat therefore differ slightly:
// the transport starts at an arbitrary phase within the audio context's 128-sample render
// quantum, so voice/LFO phase relationships differ run to run, which moves PEAK-domain numbers
// (true peak, sample peak, crest, stereo width) while leaving ENERGY-domain numbers (LUFS, RMS)
// almost untouched. Measured with scripts/measure-render-determinism.mjs (N=8 on
// examples/real-groove.beat, N=5 on examples/night-shift-song.beat, 2026-07-13); trimming each
// capture to its first non-silent sample did NOT shrink the spread, so this is genuine DSP
// variance, not capture-start alignment jitter. Full numbers + method: docs/render-determinism.md.
//
// The constants below are the observed cross-project max spreads, rounded UP (honestly — they are
// tolerances, not precision claims). Consumers:
//   - src/metrics/lint.ts pads every threshold by the matching constant, so a finding only fires
//     when the measurement is outside the render noise floor — re-rendering the same file can't
//     flip a finding on/off for a mix sitting exactly at a nominal threshold.
//   - `beat metrics --json` / MCP `beat_metrics` report them as `renderRunVariance` metadata.
//   - the vary batch manifest comment (src/vary/batch.ts) cites them: only compare renders from
//     the same batch, and treat deltas inside these bounds as noise.

/** Integrated-loudness (LUFS) run-to-run spread between identical renders. Energy metrics are the
 * stable ones: measured max spread 0.04 LU (real-groove, N=8) / 0.17 LU (night-shift-song, N=5). */
export const RENDER_RUN_VARIANCE_LU = 0.25

/** Peak-domain (true peak / sample peak / crest, dB) run-to-run spread. The dominant variance on
 * an unlimited mix: phase relationships between voices re-align differently each run (measured up
 * to 0.59 dB on real-groove; docs/research/96 observed a 0.9 dB true-peak swing). */
export const RENDER_RUN_VARIANCE_PEAK_DB = 1.0

/** Spectral band-share (percentage points) run-to-run spread — measured up to 1.6 pt (sub band,
 * night-shift-song). */
export const RENDER_RUN_VARIANCE_BAND_PCT = 2.0

/** Stereo width (dB, side/mid ratio) run-to-run spread — measured up to 1.32 dB (night-shift-song). */
export const RENDER_RUN_VARIANCE_WIDTH_DB = 1.5

/** The `renderRunVariance` metadata block both JSON metric surfaces (`beat metrics --json` and
 * MCP `beat_metrics`) attach under `meta` — one definition so the two can't drift. */
export const RENDER_RUN_VARIANCE_META = {
  renderRunVariance: {
    lufs: RENDER_RUN_VARIANCE_LU,
    peakDb: RENDER_RUN_VARIANCE_PEAK_DB,
    bandPct: RENDER_RUN_VARIANCE_BAND_PCT,
    widthDb: RENDER_RUN_VARIANCE_WIDTH_DB,
    note: 'run-to-run variance of identical renders (docs/render-determinism.md) — deltas within these bounds are render noise, not real audio differences',
  },
} as const

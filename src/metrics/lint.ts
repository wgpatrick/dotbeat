// Deterministic mix-lint rules over the measured metrics — docs/phase-3-plan.md §3.3 and
// docs/decisions.md D2: every judgment here is a threshold on a DSP measurement; no model,
// no vibes. Where the .beat format can express the fix, the finding says which edit to try
// (the Diff-MST lesson: analysis must map to editable parameters, not to opaque advice).

import type { MixMetrics, SpectralBands } from './analyze.js'
import type { MixProfile } from './profile.js'
import { RENDER_RUN_VARIANCE_LU, RENDER_RUN_VARIANCE_PEAK_DB, RENDER_RUN_VARIANCE_BAND_PCT, RENDER_RUN_VARIANCE_WIDTH_DB } from './variance.js'

export interface LintFinding {
  rule: string
  level: 'warn' | 'info'
  message: string
  /** The measured value the rule fired on, for machine consumers. */
  measured: number
  threshold: number
  /** A concrete edit to try, in `beat set` path terms, when one is expressible. */
  suggestion?: string
}

/** Phase 33 Stream MD item 2 (research/98): a track's own solo-rendered metrics, when the caller
 * has them available. Lets each finding's suggestion name the actual offending track instead of a
 * generic fix pattern with no target — pilot 98's concrete repro applied lint's literal "lower
 * track volumes" advice to `bass` (a reasonable-looking guess) and it did nothing, because the
 * real offender was a different track. */
export interface TrackContribution {
  id: string
  name?: string
  metrics: MixMetrics
}

export interface LintOptions {
  /** Loudness target in LUFS. Default -14: the most common streaming normalization point. */
  targetLufs?: number
  /** Per-track solo-rendered metrics. Omitted (default): suggestions stay generic, exactly as
   * before this item — naming a real offender requires real per-track audio, which the caller
   * (`beat lint --doc <file.beat>`) opts into rather than this module rendering anything itself. */
  trackMetrics?: TrackContribution[]
  /** Phase 35 Stream OD: a reference mix profile (`beat metrics <ref.wav> --save-profile`). When
   * set, the TASTE comparisons (loudness, band shares, width, crest) are made against the
   * reference's measured numbers instead of absolute targets — the SAFETY rules (true-peak
   * clipping, phase cancellation) stay absolute, since a reference that clips doesn't make
   * clipping fine. Mutually exclusive with targetLufs: pick one comparison frame.
   * Honest limits: the profile is full-mix statics — this comparison cannot hear arrangement,
   * sections, or masking, only gross static differences. */
  ref?: MixProfile
}

const fmt = (x: number, digits = 1) => (Number.isFinite(x) ? x.toFixed(digits) : String(x))

// Phase 34 Stream NC (docs/render-determinism.md): every threshold below is padded by the measured
// run-to-run render variance for its metric family, so a finding only fires when the measurement
// is outside the render noise floor — re-rendering the same unchanged .beat can't flip a finding
// on/off for a mix sitting exactly at a nominal threshold (which is where real mixes cluster:
// limiters aim at -1 dBTP, normalization aims at the LUFS target). The `threshold` field on each
// finding reports the EFFECTIVE (padded) value the rule actually compared against.

/** The track whose own solo metrics score highest by `score` (ties keep the first). `score`
 * returning `null` excludes that track (e.g. a mono track has no `stereo` to score). Returns
 * `undefined` when no per-track metrics were supplied, or none score. */
function worstTrack(tracks: TrackContribution[] | undefined, score: (m: MixMetrics) => number | null): TrackContribution | undefined {
  if (!tracks) return undefined
  let best: TrackContribution | undefined
  let bestScore = -Infinity
  for (const t of tracks) {
    const s = score(t.metrics)
    if (s === null || !Number.isFinite(s)) continue
    if (s > bestScore) {
      bestScore = s
      best = t
    }
  }
  return best
}

const trackLabel = (t: TrackContribution) => (t.name ? `${t.id} ("${t.name}")` : t.id)

// ---- Phase 35 Stream OD: reference-profile comparisons -------------------------------------
// Nominal tolerances before variance padding: a delta smaller than these is not worth a finding
// even if it were perfectly measurable (two masters of the SAME song differ by this much), and
// each is then padded by the matching RENDER_RUN_VARIANCE_* constant so re-rendering an unchanged
// .beat can't flip a finding on/off (Phase 34 NC, docs/render-determinism.md).
const REF_LUFS_TOLERANCE_LU = 1.5 // same nominal window the absolute loudness rule uses
const REF_BAND_TOLERANCE_PCT = 5
const REF_WIDTH_TOLERANCE_DB = 3
const REF_CREST_TOLERANCE_DB = 2

/** Per-band .beat edits to try when a band share is above/below the reference's. */
const BAND_EDITS: Record<keyof SpectralBands, { above: string; below: string }> = {
  sub: {
    above: 'reduce sub energy: lower the bass/kick track volume (beat set song.beat <track>.volume <dB>) or raise its cutoff (beat set song.beat <track>.cutoff <Hz>)',
    below: 'add sub weight: raise the bass/kick track volume (beat set song.beat <track>.volume <dB>) or lower its cutoff (beat set song.beat <track>.cutoff <Hz>)',
  },
  bass: {
    above: 'reduce bass energy: lower bass-range track volume (beat set song.beat <track>.volume <dB>) or raise its cutoff (beat set song.beat <track>.cutoff <Hz>)',
    below: 'add bass energy: raise bass-range track volume (beat set song.beat <track>.volume <dB>) or lower its cutoff (beat set song.beat <track>.cutoff <Hz>)',
  },
  mids: {
    above: 'thin the midrange: lower chord/lead track volume (beat set song.beat <track>.volume <dB>)',
    below: 'fill the midrange: raise chord/lead track volume (beat set song.beat <track>.volume <dB>)',
  },
  presence: {
    above: 'soften the presence range: lower cutoff on lead/hat tracks (beat set song.beat <track>.cutoff <Hz>)',
    below: 'add presence: open filters on lead/hat tracks (beat set song.beat <track>.cutoff <Hz>)',
  },
  air: {
    above: 'tame the top end: lower cutoff on hat/noise tracks (beat set song.beat <track>.cutoff <Hz>)',
    below: 'add air: open filters on hat/noise tracks (beat set song.beat <track>.cutoff <Hz>), or brighten with a brighter voice/sample',
  },
}

/** The taste comparisons in ref mode: measured vs the profile's numbers, padded by the measured
 * render-run variance. Every finding names the reference value, the measured value, and a .beat
 * edit to try — the same actionable-finding discipline as the absolute rules. All level 'info':
 * distance from a reference is taste information, not a defect. */
function refFindings(m: MixMetrics, ref: MixProfile, trackMetrics?: TrackContribution[]): LintFinding[] {
  const out: LintFinding[] = []
  const r = ref.metrics
  const refName = ref.source

  const lufsThreshold = REF_LUFS_TOLERANCE_LU + RENDER_RUN_VARIANCE_LU
  const lufsDelta = m.integratedLufs - r.integratedLufs
  if (Number.isFinite(m.integratedLufs) && Number.isFinite(r.integratedLufs) && Math.abs(lufsDelta) > lufsThreshold) {
    const louder = lufsDelta > 0
    const offender = worstTrack(trackMetrics, (x) => (louder ? x.integratedLufs : -x.integratedLufs))
    out.push({
      rule: 'ref-loudness',
      level: 'info',
      measured: m.integratedLufs,
      threshold: lufsThreshold,
      message: `integrated loudness ${fmt(m.integratedLufs)} LUFS is ${fmt(Math.abs(lufsDelta))} LU ${louder ? 'louder' : 'quieter'} than the reference (${refName}: ${fmt(r.integratedLufs)} LUFS)`,
      suggestion: offender
        ? `${trackLabel(offender)} is the ${louder ? 'loudest' : 'quietest'} track (${fmt(offender.metrics.integratedLufs)} LUFS solo) — ${louder ? 'lower' : 'raise'} its volume first (beat set song.beat ${offender.id}.volume <dB>), then re-check against the reference`
        : `${louder ? 'lower' : 'raise'} all track volumes by ~${fmt(Math.abs(lufsDelta))} dB (beat set song.beat <track>.volume <dB> per track)`,
    })
  }

  const bandThreshold = REF_BAND_TOLERANCE_PCT + RENDER_RUN_VARIANCE_BAND_PCT
  for (const band of Object.keys(BAND_EDITS) as (keyof SpectralBands)[]) {
    const measured = m.spectral.bandsPct[band]
    const reference = r.spectral.bandsPct[band]
    const delta = measured - reference
    if (Math.abs(delta) <= bandThreshold) continue
    const above = delta > 0
    out.push({
      rule: `ref-band-${band}`,
      level: 'info',
      measured,
      threshold: bandThreshold,
      message: `${band} band carries ${fmt(measured, 0)}% of spectral energy vs the reference's ${fmt(reference, 0)}% (${refName}) — ${fmt(Math.abs(delta), 0)} points ${above ? 'more' : 'less'}`,
      suggestion: BAND_EDITS[band][above ? 'above' : 'below'],
    })
  }

  const widthThreshold = REF_WIDTH_TOLERANCE_DB + RENDER_RUN_VARIANCE_WIDTH_DB
  if (m.stereo && r.stereo) {
    const widthDelta = m.stereo.widthDb - r.stereo.widthDb
    // -Infinity width (a dual-mono file) on either side is still an honest comparison: the delta
    // is infinite, which is certainly outside the tolerance.
    if (!Number.isNaN(widthDelta) && Math.abs(widthDelta) > widthThreshold) {
      const narrower = widthDelta < 0
      out.push({
        rule: 'ref-width',
        level: 'info',
        measured: m.stereo.widthDb,
        threshold: widthThreshold,
        message: `stereo width ${fmt(m.stereo.widthDb)} dB vs the reference's ${fmt(r.stereo.widthDb)} dB (${refName}) — the mix is ${narrower ? 'narrower' : 'wider'} than the reference`,
        suggestion: narrower
          ? 'pan tracks apart (beat set song.beat <track>.pan <-1..1>)'
          : 'pull panned tracks toward center (beat set song.beat <track>.pan <-1..1>)',
      })
    }
  }

  const crestThreshold = REF_CREST_TOLERANCE_DB + RENDER_RUN_VARIANCE_PEAK_DB
  const crestDelta = m.crestDb - r.crestDb
  if (Number.isFinite(m.crestDb) && Number.isFinite(r.crestDb) && Math.abs(crestDelta) > crestThreshold) {
    const squashed = crestDelta < 0
    out.push({
      rule: 'ref-crest',
      level: 'info',
      measured: m.crestDb,
      threshold: crestThreshold,
      message: `crest factor ${fmt(m.crestDb)} dB vs the reference's ${fmt(r.crestDb)} dB (${refName}) — the mix is ${squashed ? 'more squashed' : 'more dynamic'} than the reference`,
      suggestion: squashed
        ? 'restore dynamic contrast: lower sustained track volumes (beat set song.beat <track>.volume <dB>) or vary hit velocities (beat humanize song.beat <track> --velocity 0.1)'
        : 'even out dynamics: raise quiet elements (beat set song.beat <track>.volume <dB>) or reduce velocity spread (beat quantize / lower --velocity on beat humanize)',
    })
  }

  return out
}

export function lint(m: MixMetrics, opts: LintOptions = {}): LintFinding[] {
  if (opts.ref && opts.targetLufs !== undefined) {
    throw new Error('pick one comparison frame: a reference profile (ref / --ref) or an absolute loudness target (targetLufs / --target) — not both')
  }
  const target = opts.targetLufs ?? -14
  const out: LintFinding[] = []

  const truePeakThreshold = -1 + RENDER_RUN_VARIANCE_PEAK_DB
  if (m.truePeakDbtp > truePeakThreshold) {
    const offender = worstTrack(opts.trackMetrics, (x) => x.truePeakDbtp)
    out.push({
      rule: 'true-peak-clipping',
      level: 'warn',
      measured: m.truePeakDbtp,
      threshold: truePeakThreshold,
      message: `true peak ${fmt(m.truePeakDbtp)} dBTP is above -1 dBTP — inter-sample clipping risk on lossy encoders`,
      suggestion: offender
        ? `${trackLabel(offender)} is the loudest contributor (true peak ${fmt(offender.metrics.truePeakDbtp)} dBTP solo) — lower its volume first (beat set song.beat ${offender.id}.volume <dB>) until the mix's true peak sits below -1 dBTP`
        : 'lower track volumes (e.g. beat set song.beat <track>.volume <dB>) until true peak sits below -1 dBTP',
    })
  }

  // Ref mode swaps the four TASTE comparisons (loudness / bands / width / crest) for deltas
  // against the reference profile; the absolute versions below are all `!opts.ref`-guarded.
  if (opts.ref) out.push(...refFindings(m, opts.ref, opts.trackMetrics))

  const lufsDelta = m.integratedLufs - target
  if (!opts.ref && Number.isFinite(m.integratedLufs) && Math.abs(lufsDelta) > 1.5 + RENDER_RUN_VARIANCE_LU) {
    const tooLoud = lufsDelta > 0
    const offender = worstTrack(opts.trackMetrics, (x) => (tooLoud ? x.integratedLufs : -x.integratedLufs))
    out.push({
      rule: 'loudness-vs-target',
      level: 'info',
      measured: m.integratedLufs,
      threshold: target,
      message: `integrated loudness ${fmt(m.integratedLufs)} LUFS is ${fmt(Math.abs(lufsDelta))} LU ${lufsDelta > 0 ? 'above' : 'below'} the ${fmt(target)} LUFS target`,
      suggestion: offender
        ? `${trackLabel(offender)} is the ${tooLoud ? 'loudest' : 'quietest'} track (${fmt(offender.metrics.integratedLufs)} LUFS solo) — ${tooLoud ? 'lower' : 'raise'} its volume first (beat set song.beat ${offender.id}.volume <dB>), then re-check the mix`
        : `${lufsDelta > 0 ? 'lower' : 'raise'} all track volumes by ~${fmt(Math.abs(lufsDelta))} dB (beat set song.beat <track>.volume <dB> per track)`,
    })
  }

  const crestThreshold = 6 - RENDER_RUN_VARIANCE_PEAK_DB
  if (!opts.ref && Number.isFinite(m.crestDb) && m.crestDb < crestThreshold) {
    out.push({
      rule: 'over-compressed',
      level: 'warn',
      measured: m.crestDb,
      threshold: crestThreshold,
      message: `crest factor ${fmt(m.crestDb)} dB is under 6 dB — the mix has very little dynamic range left`,
    })
  }

  const lowShare = m.spectral.bandsPct.sub + m.spectral.bandsPct.bass
  const lowShareThreshold = 70 + RENDER_RUN_VARIANCE_BAND_PCT
  if (!opts.ref && lowShare > lowShareThreshold) {
    const offender = worstTrack(opts.trackMetrics, (x) => x.spectral.bandsPct.sub + x.spectral.bandsPct.bass)
    out.push({
      rule: 'low-end-heavy',
      level: 'info',
      measured: lowShare,
      threshold: lowShareThreshold,
      message: `${fmt(lowShare, 0)}% of spectral energy sits below 250 Hz — the mix likely reads as muddy on small speakers`,
      suggestion: offender
        ? `${trackLabel(offender)} carries the most low end (${fmt(offender.metrics.spectral.bandsPct.sub + offender.metrics.spectral.bandsPct.bass, 0)}% sub+bass solo) — raise its cutoff or reduce its volume first (beat set song.beat ${offender.id}.cutoff <Hz>)`
        : 'raise cutoff / reduce volume on bass-range tracks, or brighten leads (beat set song.beat <track>.cutoff <Hz>)',
    })
  }
  const highShare = m.spectral.bandsPct.presence + m.spectral.bandsPct.air
  const highShareThreshold = 3 - RENDER_RUN_VARIANCE_BAND_PCT
  if (!opts.ref && highShare < highShareThreshold) {
    const offender = worstTrack(opts.trackMetrics, (x) => -(x.spectral.bandsPct.presence + x.spectral.bandsPct.air))
    out.push({
      rule: 'dull-top-end',
      level: 'info',
      measured: highShare,
      threshold: highShareThreshold,
      message: `only ${fmt(highShare, 1)}% of spectral energy sits above 2 kHz — the mix likely reads as dull/dark`,
      suggestion: offender
        ? `${trackLabel(offender)} contributes the least top end (${fmt(offender.metrics.spectral.bandsPct.presence + offender.metrics.spectral.bandsPct.air, 1)}% presence+air solo) — try opening its filter first (beat set song.beat ${offender.id}.cutoff <Hz>)`
        : 'open filters on lead/hat tracks (beat set song.beat <track>.cutoff <Hz>)',
    })
  }

  if (m.stereo) {
    if (m.stereo.correlation < 0) {
      out.push({
        rule: 'phase-cancellation-risk',
        level: 'warn',
        measured: m.stereo.correlation,
        threshold: 0,
        message: `stereo correlation ${fmt(m.stereo.correlation, 2)} is negative — parts of the mix will cancel on mono playback`,
      })
    } else if (!opts.ref && m.stereo.correlation > 0.995 && m.stereo.widthDb < -30 - RENDER_RUN_VARIANCE_WIDTH_DB) {
      const offender = worstTrack(opts.trackMetrics, (x) => (x.stereo ? -x.stereo.widthDb : null))
      out.push({
        rule: 'effectively-mono',
        level: 'info',
        measured: m.stereo.widthDb,
        threshold: -30 - RENDER_RUN_VARIANCE_WIDTH_DB,
        message: `stereo width ${fmt(m.stereo.widthDb)} dB (correlation ${fmt(m.stereo.correlation, 3)}) — the mix is effectively mono`,
        suggestion: offender
          ? `${trackLabel(offender)} is the narrowest track (width ${fmt(offender.metrics.stereo?.widthDb ?? NaN)} dB solo) — try panning it first (beat set song.beat ${offender.id}.pan <-1..1>)`
          : 'pan tracks apart (beat set song.beat <track>.pan <-1..1>)',
      })
    }
  }

  return out
}

export function formatLint(findings: LintFinding[]): string {
  if (findings.length === 0) return 'no findings — all lint rules pass\n'
  return findings.map((f) => `${f.level.toUpperCase().padEnd(4)} [${f.rule}] ${f.message}${f.suggestion ? `\n     fix: ${f.suggestion}` : ''}`).join('\n') + '\n'
}

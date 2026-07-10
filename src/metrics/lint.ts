// Deterministic mix-lint rules over the measured metrics — docs/phase-3-plan.md §3.3 and
// docs/decisions.md D2: every judgment here is a threshold on a DSP measurement; no model,
// no vibes. Where the .beat format can express the fix, the finding says which edit to try
// (the Diff-MST lesson: analysis must map to editable parameters, not to opaque advice).

import type { MixMetrics } from './analyze.js'

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

export interface LintOptions {
  /** Loudness target in LUFS. Default -14: the most common streaming normalization point. */
  targetLufs?: number
}

const fmt = (x: number, digits = 1) => (Number.isFinite(x) ? x.toFixed(digits) : String(x))

export function lint(m: MixMetrics, opts: LintOptions = {}): LintFinding[] {
  const target = opts.targetLufs ?? -14
  const out: LintFinding[] = []

  if (m.truePeakDbtp > -1) {
    out.push({
      rule: 'true-peak-clipping',
      level: 'warn',
      measured: m.truePeakDbtp,
      threshold: -1,
      message: `true peak ${fmt(m.truePeakDbtp)} dBTP is above -1 dBTP — inter-sample clipping risk on lossy encoders`,
      suggestion: 'lower track volumes (e.g. beat set song.beat <track>.volume <dB>) until true peak sits below -1 dBTP',
    })
  }

  const lufsDelta = m.integratedLufs - target
  if (Number.isFinite(m.integratedLufs) && Math.abs(lufsDelta) > 1.5) {
    out.push({
      rule: 'loudness-vs-target',
      level: 'info',
      measured: m.integratedLufs,
      threshold: target,
      message: `integrated loudness ${fmt(m.integratedLufs)} LUFS is ${fmt(Math.abs(lufsDelta))} LU ${lufsDelta > 0 ? 'above' : 'below'} the ${fmt(target)} LUFS target`,
      suggestion: `${lufsDelta > 0 ? 'lower' : 'raise'} all track volumes by ~${fmt(Math.abs(lufsDelta))} dB (beat set song.beat <track>.volume <dB> per track)`,
    })
  }

  if (Number.isFinite(m.crestDb) && m.crestDb < 6) {
    out.push({
      rule: 'over-compressed',
      level: 'warn',
      measured: m.crestDb,
      threshold: 6,
      message: `crest factor ${fmt(m.crestDb)} dB is under 6 dB — the mix has very little dynamic range left`,
    })
  }

  const lowShare = m.spectral.bandsPct.sub + m.spectral.bandsPct.bass
  if (lowShare > 70) {
    out.push({
      rule: 'low-end-heavy',
      level: 'info',
      measured: lowShare,
      threshold: 70,
      message: `${fmt(lowShare, 0)}% of spectral energy sits below 250 Hz — the mix likely reads as muddy on small speakers`,
      suggestion: 'raise cutoff / reduce volume on bass-range tracks, or brighten leads (beat set song.beat <track>.cutoff <Hz>)',
    })
  }
  const highShare = m.spectral.bandsPct.presence + m.spectral.bandsPct.air
  if (highShare < 3) {
    out.push({
      rule: 'dull-top-end',
      level: 'info',
      measured: highShare,
      threshold: 3,
      message: `only ${fmt(highShare, 1)}% of spectral energy sits above 2 kHz — the mix likely reads as dull/dark`,
      suggestion: 'open filters on lead/hat tracks (beat set song.beat <track>.cutoff <Hz>)',
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
    } else if (m.stereo.correlation > 0.995 && m.stereo.widthDb < -30) {
      out.push({
        rule: 'effectively-mono',
        level: 'info',
        measured: m.stereo.widthDb,
        threshold: -30,
        message: `stereo width ${fmt(m.stereo.widthDb)} dB (correlation ${fmt(m.stereo.correlation, 3)}) — the mix is effectively mono`,
        suggestion: 'pan tracks apart (beat set song.beat <track>.pan <-1..1>)',
      })
    }
  }

  return out
}

export function formatLint(findings: LintFinding[]): string {
  if (findings.length === 0) return 'no findings — all lint rules pass\n'
  return findings.map((f) => `${f.level.toUpperCase().padEnd(4)} [${f.rule}] ${f.message}${f.suggestion ? `\n     fix: ${f.suggestion}` : ''}`).join('\n') + '\n'
}

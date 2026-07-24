// Audio pathology screens — a standing suite of deterministic DSP checks for KNOWN failure
// classes, so no render with a pathology we can already measure reaches the owner's ears unflagged.
//
// Motivation (docs/research/122 §1, §4.2): two owner-flagged failures had the data to catch them
// but no rule that FIRED — a full mix whose per-section loudness was nearly constant ("everything
// on all the time"), and a grindy/rough bass. The lesson generalized: for every pathology we can
// measure, ship a screen that turns the number into a flag. These are safety/pathology screens
// (does this render have a DEFECT), distinct from the taste comparisons in lint.ts (is this render
// far from a target/reference).
//
// Every screen emits the SAME finding shape (PathologyFinding), so a future `beat listen` can merge
// LLM critics into one severity-ranked, optionally-time-stamped stream (research 122 §7). Times are
// present only where the pathology is localizable; band only where it is spectral.
//
// Calibration discipline (research 122 §2 case N1): thresholds are set for ≈0 false positives on
// the commercial ref pools (refs-packs / refs-cc0), and the arrangement pair (sandstorm-serious.wav
// must FLAG flatness, sandstorm-serious-final.wav must PASS). Every threshold is padded by the
// measured render-run variance floor (variance.ts) where a render-domain metric is involved, so
// re-rendering an unchanged .beat can't flip a finding.

import { analyze, fft, type MixMetrics } from './analyze.js'
import type { SectionSpec } from './sections.js'
import { samplesPerBar } from './sections.js'
import { RENDER_RUN_VARIANCE_LU } from './variance.js'

/** One pathology finding — the unified shape shared by every screen (and, later, by LLM critics
 * over `beat listen`). `start`/`end` are seconds and present only when the pathology is localizable;
 * `band` is a human frequency range and present only for spectral findings. `measured`/`threshold`
 * are for machine consumers (the value the rule fired on, and the effective variance-padded bar it
 * cleared). */
export interface PathologyFinding {
  kind: string // rule id, e.g. 'arrangement-flatness', 'click', 'dc-offset'
  severity: number // 1 (subtle) .. 5 (egregious)
  source: string // the detector, e.g. 'flatness-screen' — parallels research 122's `source` field
  detail: string // plain-language description, with the numbers that fired it
  start?: number // seconds — omitted when not localizable
  end?: number // seconds
  band?: string // e.g. '250-500 Hz' — omitted when not spectral
  measured?: number
  threshold?: number
}

export interface ScreenOptions {
  /** Song section map (bar counts + labels) + bpm — enables the arrangement-flatness screen and
   * lets the dead-air screen name which section a dropout lands in. Omitted: those screens that
   * need section context are skipped (noted, never silently). */
  sections?: SectionSpec[]
  bpm?: number
  /** Whole-mix metrics, if the caller already computed them (avoids a second analyze()). */
  metrics?: MixMetrics
}

// ---- shared DSP helpers ---------------------------------------------------------------------

/** Channel-mean (mono) view of the mix. */
function toMono(channels: Float64Array[]): Float64Array {
  const n = channels[0]?.length ?? 0
  const mono = new Float64Array(n)
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i]! += ch[i]! / channels.length
  return mono
}

const dbfs = (lin: number) => (lin <= 0 ? -Infinity : 20 * Math.log10(lin))

/** Map a measured value to a 1..5 severity by two anchors: `mild` (severity 1) and `severe`
 * (severity 5), linearly clamped. Direction is inferred (severe may be above or below mild). */
function severityFrom(value: number, mild: number, severe: number): number {
  const t = (value - mild) / (severe - mild)
  return Math.max(1, Math.min(5, Math.round(1 + 4 * t)))
}

/** Averaged magnitude-squared spectrum of `mono`, Hann-windowed, N=4096 / 50% hop. Returns the
 * power per rfft bin plus binHz, so every spectral screen shares one FFT pass. */
function powerSpectrum(mono: Float64Array, sampleRate: number): { power: Float64Array; binHz: number } | null {
  const N = 4096
  const hop = 2048
  if (mono.length < N) return null
  const hann = new Float64Array(N)
  for (let i = 0; i < N; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)))
  const acc = new Float64Array(N / 2)
  let frames = 0
  for (let start = 0; start + N <= mono.length; start += hop) {
    const re = new Float64Array(N)
    const im = new Float64Array(N)
    for (let i = 0; i < N; i++) re[i] = mono[start + i]! * hann[i]!
    fft(re, im)
    for (let k = 0; k < N / 2; k++) acc[k]! += re[k]! * re[k]! + im[k]! * im[k]!
    frames++
  }
  if (frames === 0) return null
  for (let k = 0; k < N / 2; k++) acc[k]! /= frames
  return { power: acc, binHz: sampleRate / N }
}

/** Fraction of total spectral energy (excluding DC) that falls in [lo, hi) Hz. */
function bandShare(spec: { power: Float64Array; binHz: number }, lo: number, hi: number): number {
  let total = 0
  let band = 0
  for (let k = 1; k < spec.power.length; k++) {
    const f = k * spec.binHz
    const e = spec.power[k]!
    total += e
    if (f >= lo && f < hi) band += e
  }
  return total > 0 ? band / total : 0
}

// ---- thresholds (calibrated: refs ≈0 FP, sandstorm pair separates) --------------------------
// Each is padded by render-run variance where a render-domain quantity is involved.

// 1. arrangement-flatness: interior per-section RMS must show a real arc. Interior = sections
//    excluding the first (intro entrance) and last (outro) and any < MIN_SECTION_BARS (designed
//    1-bar silence gaps / stingers). Calibrated on RMS dBFS (NOT gated LUFS — gating misreads
//    sparse sections like the exposed-bass `strip` as a false dip; see the branch report). Flag
//    flat when the interior span < FLAT_SPAN_DB AND no adjacent step reaches FLAT_ARC_STEP_DB.
const FLAT_MIN_SECTION_BARS = 2
const FLAT_MIN_INTERIOR = 3 // fewer interior sections than this = too short to judge arrangement
const FLAT_SPAN_DB = 6.0 + RENDER_RUN_VARIANCE_LU // sandstorm-serious interior span 4.7 → flag; final 10.5 → pass
const FLAT_ARC_STEP_DB = 4.0 // a real section-to-section drop/breakdown; serious max 2.2, final 9.0

// 2. clicks/pops: an isolated inter-sample discontinuity — a single-sample jump far above the
//    signal's own p99.9 jump AND audibly large in absolute terms.
const CLICK_ABS_MIN = 0.08 // ignore tiny glitches below ~ -22 dB step
const CLICK_RATIO = 14 // worst jump this many × the 99.9th-percentile jump = a splice/click, not program
// (a hard drum-transient loop peaked at ratio 8.8 in the ref pool → 14 clears it with margin)

// 3. DC offset — ref-pool max |mean| 0.0086, dotbeat renders carry a benign ~0.015 (-36 dBFS) DC;
const DC_ABS = 0.02

// 4. mono-collapse / phase cancellation. Ref pool floors at correlation -0.785 (a genuinely
//    anti-phase wide loop); -0.6 keeps only that real mono-fold-down risk.
const NEG_CORR = -0.6

// 5. sustained narrow resonance 2–5 kHz (ring.ts generalized to a wider, lower band). This band
//    is full of legitimate musical fundamentals on solo leads/chords, so two guards beyond ring.ts:
//    a higher ratio, and the peak must be a SECONDARY spike (>= RES_MIN_UNDER dB below the spectrum
//    max) — a parasitic ring under the content, not the note itself.
const RES_LO_HZ = 2000
const RES_HI_HZ = 5500
const RES_RATIO = 20 // a bin > 15× its ±~300 Hz neighborhood median = a narrow tonal spike
const RES_MIN_UNDER = 6 // must sit at least 6 dB below the spectrum peak (else it's the fundamental)
const RES_MAX_UNDER = 22 // ...but within 22 dB (a resonance that inaudible-quiet isn't worth a flag)

// 6. mud: 250–500 Hz low-mid dominance. Guarded to a full-mix context (needs a real top end) so a
//    solo bass/sine that simply lives in that octave isn't miscalled muddy.
const MUD_SHARE = 0.72 // > 60% of energy in one low-mid octave
const MUD_MIN_HIGH = 0.03 // ...only when >2 kHz carries ≥3% (i.e. a broadband mix, not a lone tone)

// 7. crest collapse / over-compression. Ref stems floor at crest 4.10; 4.0 flags only genuinely
//    squashed material (the milder crest<5 taste nudge stays in lint.ts's `over-compressed`).
const CREST_MILD = 4.0
const CREST_SEVERE = 2.0

// 8. dropouts / dead air mid-song
const DEAD_WIN_S = 0.3 // window for the RMS envelope
const DEAD_FLOOR_DBFS = -60 // near-silent
const DEAD_MIN_S = 0.7 // shortest interior gap worth flagging
const DEAD_SURROUND_DB = 35 // gap must be this far below the surrounding program level

// 9. sub rumble: energy below ~30 Hz. A designed deep-sub loop reached 15.6% below 30 Hz; 0.20
//    flags only clearly-infrasonic buildup.
const RUMBLE_HI_HZ = 30
const RUMBLE_SHARE = 0.2

// ---- individual screens ---------------------------------------------------------------------

function screenFlatness(channels: Float64Array[], sampleRate: number, opts: ScreenOptions): PathologyFinding[] {
  const { sections, bpm } = opts
  if (!sections || sections.length === 0 || !bpm) return []
  const spb = samplesPerBar(sampleRate, bpm)
  const total = channels[0]?.length ?? 0
  // per-section RMS dBFS
  let cum = 0
  const secs = sections.map((s, i) => {
    const start = Math.min(Math.round(cum * spb), total)
    cum += s.bars
    const end = i === sections.length - 1 ? total : Math.min(Math.round(cum * spb), total)
    let sum = 0
    let n = 0
    for (const ch of channels) {
      for (let j = start; j < end; j++) sum += ch[j]! * ch[j]!
      n += end - start
    }
    return { i, bars: s.bars, label: s.name ?? s.scene ?? `section ${i + 1}`, rms: dbfs(n > 0 ? Math.sqrt(sum / n) : 0) }
  })
  // interior = drop first + last (intro/outro framing) and any short designed gap
  const interior = secs.filter((s, i) => i !== 0 && i !== secs.length - 1 && s.bars >= FLAT_MIN_SECTION_BARS && Number.isFinite(s.rms))
  if (interior.length < FLAT_MIN_INTERIOR) return []
  const levels = interior.map((s) => s.rms)
  const span = Math.max(...levels) - Math.min(...levels)
  let maxStep = 0
  for (let i = 1; i < levels.length; i++) maxStep = Math.max(maxStep, Math.abs(levels[i]! - levels[i - 1]!))
  if (span < FLAT_SPAN_DB && maxStep < FLAT_ARC_STEP_DB) {
    // severity: how far below the "has an arc" bar (span 6 dB) it sits
    const severity = severityFrom(span, FLAT_SPAN_DB, 1.5)
    return [
      {
        kind: 'arrangement-flatness',
        severity,
        source: 'flatness-screen',
        detail:
          `interior sections sit within ${span.toFixed(1)} dB RMS (biggest section-to-section step ${maxStep.toFixed(1)} dB) — ` +
          `no dynamic arc: the drop does not lift above the groove ("everything on all the time"). ` +
          `Add contrast: strip a breakdown section back, or step the body sections up into the drop.`,
        measured: span,
        threshold: FLAT_SPAN_DB,
      },
    ]
  }
  return []
}

function screenClicks(mono: Float64Array, sampleRate: number): PathologyFinding[] {
  const n = mono.length
  if (n < 8) return []
  // first-difference magnitude and its worst value + location
  let worst = 0
  let worstIdx = 0
  const diffs = new Float64Array(n - 1)
  for (let i = 1; i < n; i++) {
    const d = Math.abs(mono[i]! - mono[i - 1]!)
    diffs[i - 1] = d
    if (d > worst) {
      worst = d
      worstIdx = i
    }
  }
  if (worst < CLICK_ABS_MIN) return []
  // p99.9 of the jump distribution — program material's legitimate slew ceiling
  const sorted = Float64Array.prototype.slice.call(diffs).sort((a, b) => a - b)
  const p999 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.999))]! + 1e-9
  const ratio = worst / p999
  // isolation: a click is a single-sample spike — its immediate neighbors are ordinary jumps
  const neighbor = Math.max(worstIdx >= 2 ? diffs[worstIdx - 2]! : 0, worstIdx < diffs.length ? diffs[worstIdx]! : 0)
  const isolated = worst > 3 * (neighbor + 1e-9)
  if (ratio >= CLICK_RATIO && isolated) {
    const t = worstIdx / sampleRate
    const severity = severityFrom(ratio, CLICK_RATIO, CLICK_RATIO * 4)
    return [
      {
        kind: 'click',
        severity,
        source: 'clicks-screen',
        detail: `inter-sample discontinuity: a ${worst.toFixed(3)} single-sample jump, ${ratio.toFixed(1)}× the program's 99.9th-percentile slew — a click/pop (often a clip or section splice). Crossfade the boundary or check for a truncated one-shot.`,
        start: t,
        end: t,
        measured: ratio,
        threshold: CLICK_RATIO,
      },
    ]
  }
  return []
}

function screenDc(channels: Float64Array[]): PathologyFinding[] {
  // one finding for the mix, on the worst-offending channel (per-channel lines were just noise)
  let worst = 0
  let worstCh = 0
  channels.forEach((ch, c) => {
    let sum = 0
    for (let i = 0; i < ch.length; i++) sum += ch[i]!
    const mean = ch.length ? sum / ch.length : 0
    if (Math.abs(mean) > Math.abs(worst)) {
      worst = mean
      worstCh = c
    }
  })
  if (Math.abs(worst) > DC_ABS) {
    const chLabel = channels.length > 1 ? ` (worst on channel ${worstCh})` : ''
    return [
      {
        kind: 'dc-offset',
        severity: severityFrom(Math.abs(worst), DC_ABS, 0.05),
        source: 'dc-screen',
        detail: `a ${worst.toFixed(4)} DC offset${chLabel} (${dbfs(Math.abs(worst)).toFixed(1)} dBFS) — wastes headroom and can click on edits. High-pass the offending track or add a DC blocker.`,
        measured: worst,
        threshold: DC_ABS,
      },
    ]
  }
  return []
}

function screenPhase(metrics: MixMetrics): PathologyFinding[] {
  if (!metrics.stereo) return []
  const corr = metrics.stereo.correlation
  if (corr < NEG_CORR) {
    return [
      {
        kind: 'mono-collapse',
        severity: severityFrom(corr, NEG_CORR, -0.8),
        source: 'phase-screen',
        detail: `stereo correlation ${corr.toFixed(2)} is strongly negative — L and R are out of phase and will cancel/thin badly on a mono fold-down. Check for an inverted channel or an over-wide (out-of-polarity) stereo effect.`,
        measured: corr,
        threshold: NEG_CORR,
      },
    ]
  }
  return []
}

/** Median of a copied slice. */
function median(xs: Float64Array, lo: number, hi: number): number {
  const s = Array.prototype.slice.call(xs, lo, hi) as number[]
  s.sort((a, b) => a - b)
  const m = s.length
  return m === 0 ? 0 : m % 2 ? s[(m - 1) / 2]! : (s[m / 2 - 1]! + s[m / 2]!) / 2
}

function screenResonance(spec: { power: Float64Array; binHz: number } | null): PathologyFinding[] {
  if (!spec) return []
  const { power, binHz } = spec
  // magnitude, and the band as a compact array (mirrors ring.ts's slice-then-window neighborhood)
  const mag = new Float64Array(power.length)
  let smax = 1e-18
  for (let k = 0; k < power.length; k++) {
    mag[k] = Math.sqrt(power[k]!)
    if (mag[k]! > smax) smax = mag[k]!
  }
  const loBin = Math.max(1, Math.ceil(RES_LO_HZ / binHz))
  const hiBin = Math.min(power.length - 1, Math.floor(RES_HI_HZ / binHz))
  const band = mag.slice(loBin, hiBin + 1)
  const neighBins = Math.max(4, Math.round(300 / binHz)) // ±~300 Hz
  let worstDb = -Infinity
  let worstHz = 0
  for (let i = 0; i < band.length; i++) {
    const neigh = median(band, Math.max(0, i - neighBins), Math.min(band.length, i + neighBins)) + 1e-15
    if (band[i]! > RES_RATIO * neigh) {
      const dbv = 20 * Math.log10(band[i]! / smax)
      // a resonance is a parasitic secondary spike: below the peak by RES_MIN_UNDER but not so far
      // down it's inaudible. worstHz tracks the strongest qualifying spike in that window.
      if (dbv <= -RES_MIN_UNDER && dbv >= -RES_MAX_UNDER && dbv > worstDb) {
        worstDb = dbv
        worstHz = (loBin + i) * binHz
      }
    }
  }
  if (Number.isFinite(worstDb) && worstDb >= -RES_MAX_UNDER) {
    return [
      {
        kind: 'resonance',
        severity: severityFrom(worstDb, -RES_MAX_UNDER, -RES_MIN_UNDER),
        source: 'resonance-screen',
        detail: `a narrow sustained resonance near ${Math.round(worstHz)} Hz sits ${worstDb.toFixed(1)} dB under the spectrum peak and towers over its neighbourhood — a ringing/harsh tone. Notch it (a narrow EQ cut) or lower the offending track's resonance.`,
        band: `${Math.round(worstHz)} Hz`,
        measured: worstDb,
        threshold: -RES_MIN_UNDER,
      },
    ]
  }
  return []
}

function screenMud(spec: { power: Float64Array; binHz: number } | null): PathologyFinding[] {
  if (!spec) return []
  const share = bandShare(spec, 250, 500)
  const highShare = bandShare(spec, 2000, Infinity)
  if (share > MUD_SHARE && highShare >= MUD_MIN_HIGH) {
    return [
      {
        kind: 'mud',
        severity: severityFrom(share, MUD_SHARE, 0.8),
        source: 'mud-screen',
        detail: `${(share * 100).toFixed(0)}% of spectral energy is concentrated in 250–500 Hz — a boxy/muddy low-mid buildup. Dip that octave on the busiest track, or thin overlapping mid parts.`,
        band: '250-500 Hz',
        measured: share,
        threshold: MUD_SHARE,
      },
    ]
  }
  return []
}

function screenCrest(metrics: MixMetrics): PathologyFinding[] {
  const c = metrics.crestDb
  if (Number.isFinite(c) && c < CREST_MILD) {
    return [
      {
        kind: 'crest-collapse',
        severity: severityFrom(c, CREST_MILD, CREST_SEVERE),
        source: 'crest-screen',
        detail: `crest factor ${c.toFixed(1)} dB — the peaks barely rise above the RMS, so the mix is over-compressed/limited with little transient life left. Back off the master limiter or per-track compression.`,
        measured: c,
        threshold: CREST_MILD,
      },
    ]
  }
  return []
}

function screenDeadAir(mono: Float64Array, sampleRate: number, opts: ScreenOptions): PathologyFinding[] {
  const win = Math.max(1, Math.round(DEAD_WIN_S * sampleRate))
  const n = mono.length
  if (n < win * 4) return []
  // windowed RMS envelope (non-overlapping)
  const env: number[] = []
  for (let start = 0; start + win <= n; start += win) {
    let sum = 0
    for (let i = start; i < start + win; i++) sum += mono[i]! * mono[i]!
    env.push(dbfs(Math.sqrt(sum / win)))
  }
  if (env.length < 5) return []
  // program level = median of the loud half (robust to the quiet gaps themselves)
  const sortedEnv = env.filter(Number.isFinite).slice().sort((a, b) => a - b)
  if (sortedEnv.length === 0) return []
  const programLevel = sortedEnv[Math.floor(sortedEnv.length * 0.75)]!
  // find the first/last non-silent window — interior is strictly between them (skip lead/tail silence)
  let firstSig = -1
  let lastSig = -1
  for (let i = 0; i < env.length; i++) {
    if (env[i]! > programLevel - DEAD_SURROUND_DB) {
      if (firstSig === -1) firstSig = i
      lastSig = i
    }
  }
  if (firstSig === -1 || lastSig <= firstSig) return []
  // scan interior for a run of windows below the dead floor AND far below program
  const out: PathologyFinding[] = []
  let runStart = -1
  const minWins = Math.ceil(DEAD_MIN_S / DEAD_WIN_S)
  const flush = (endExcl: number) => {
    if (runStart === -1) return
    const wins = endExcl - runStart
    if (wins >= minWins) {
      const t0 = (runStart * win) / sampleRate
      const t1 = (endExcl * win) / sampleRate
      out.push({
        kind: 'dead-air',
        severity: severityFrom(wins * DEAD_WIN_S, DEAD_MIN_S, 2),
        source: 'deadair-screen',
        detail: `a ${(t1 - t0).toFixed(2)}s near-silent gap mid-song (${DEAD_FLOOR_DBFS} dBFS floor, ${DEAD_SURROUND_DB}+ dB below the surrounding program) — a dropout or a section that went fully empty. If unintended, check the arrangement/clip placement here.`,
        start: t0,
        end: t1,
        measured: t1 - t0,
        threshold: DEAD_MIN_S,
      })
    }
    runStart = -1
  }
  for (let i = firstSig + 1; i < lastSig; i++) {
    const dead = env[i]! < DEAD_FLOOR_DBFS && env[i]! < programLevel - DEAD_SURROUND_DB
    if (dead) {
      if (runStart === -1) runStart = i
    } else {
      flush(i)
    }
  }
  flush(lastSig)
  return out
}

function screenRumble(spec: { power: Float64Array; binHz: number } | null): PathologyFinding[] {
  if (!spec) return []
  const share = bandShare(spec, 0, RUMBLE_HI_HZ)
  if (share > RUMBLE_SHARE) {
    return [
      {
        kind: 'sub-rumble',
        severity: severityFrom(share, RUMBLE_SHARE, 0.25),
        source: 'rumble-screen',
        detail: `${(share * 100).toFixed(1)}% of energy sits below ${RUMBLE_HI_HZ} Hz — mostly-inaudible infrasonic rumble eating headroom and limiter action. High-pass the mix (or the bass/kick) around 30 Hz.`,
        band: `<${RUMBLE_HI_HZ} Hz`,
        measured: share,
        threshold: RUMBLE_SHARE,
      },
    ]
  }
  return []
}

/** Run every pathology screen over one decoded mix. Findings are returned highest-severity first.
 * Screens needing a section map (arrangement-flatness) are skipped when none is supplied. */
export function screen(channels: Float64Array[], sampleRate: number, opts: ScreenOptions = {}): PathologyFinding[] {
  const mono = toMono(channels)
  const metrics = opts.metrics ?? analyze(channels, sampleRate)
  const spec = powerSpectrum(mono, sampleRate)
  const findings: PathologyFinding[] = [
    ...screenFlatness(channels, sampleRate, opts),
    ...screenClicks(mono, sampleRate),
    ...screenDc(channels),
    ...screenPhase(metrics),
    ...screenResonance(spec),
    ...screenMud(spec),
    ...screenCrest(metrics),
    ...screenDeadAir(mono, sampleRate, opts),
    ...screenRumble(spec),
  ]
  return findings.sort((a, b) => b.severity - a.severity)
}

/** Human-readable screen report — one line per finding, severity-ranked, with time/band when
 * present. `title` names the audio being screened. */
export function formatScreens(findings: PathologyFinding[], title?: string): string {
  const head = title ? `pathology screens: ${title}` : 'pathology screens'
  if (findings.length === 0) return `${head}\n  no pathologies detected — all screens pass\n`
  const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
  const lines = findings.map((f) => {
    const loc = f.start !== undefined ? (f.end !== undefined && f.end - f.start > 0.05 ? ` @${mmss(f.start)}–${mmss(f.end)}` : ` @${mmss(f.start)}`) : ''
    const band = f.band ? ` [${f.band}]` : ''
    return `  S${f.severity} [${f.kind}]${loc}${band} ${f.detail}`
  })
  return `${head}\n${lines.join('\n')}\n`
}

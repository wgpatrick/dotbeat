// The `beat match` search space (taste-loop T6): which engine parameters CMA-ES may move, over
// what ranges, and how a genome in [0,1]^n becomes an ordinary `beat set` edit list on a one-note
// candidate project.
//
// Design rules, all from research/107 §2.3 / INSTRUMENTAL:
//   - continuous params only in the genome; DISCRETE choices (osc type, filter type) are
//     enumerated as separate short runs by the harness, never relaxed to a float,
//   - STAGED search: stage 1 = source params (oscillators/filter/envelopes), stage 2 = insert
//     effects on top of the frozen stage-1 winner,
//   - ranges CLAMPED to the musical region (same Dahlstedt discipline as vary's VARY_GROUPS —
//     past ~30 dims the optimizer exploits extremes instead of matching, so each stage stays
//     well under that and every range bounds the useful region, not the legal one),
//   - pitch and level are NOT in the space: pitch is frozen from f0 detection before the search,
//     level is neutralized by loudness normalization in the loss.
//
// The genome<->params mapping is the same log/linear scheme vary uses; values pass through
// formatNumber so a genome, its edit list, and the serialized candidate agree byte-for-byte
// (which is what makes the eval cache and the emitted patch honest).

import { createHash } from 'node:crypto'
import { parse, serialize, setValue } from '../core/index.js'
import { formatNumber } from '../core/format.js'

export type MatchTrackKind = 'synth' | 'drum-sampler'

export interface MatchParamDef {
  /** `beat set` path on the candidate project, e.g. "match.cutoff" or "match.lane.chop.decay". */
  path: string
  min: number
  max: number
  scale: 'linear' | 'log'
  integer?: boolean
  /** Genome position [0,1] that maps to this param's INITIAL value (spectral-analysis init and
   * screening evals start here). Default 0.5. */
  init?: number
}

export interface DiscreteChoice {
  /** e.g. { "match.osc": "sawtooth", "match.filterType": "lowpass" } */
  edits: Record<string, string>
  label: string
}

export interface MatchSpace {
  trackKind: MatchTrackKind
  trackId: string
  stage1: MatchParamDef[]
  stage2: MatchParamDef[]
  /** Cartesian enumeration of the discrete params — one short screening run each. */
  discreteChoices: DiscreteChoice[]
}

export const MATCH_TRACK_ID = 'match'

const p = (
  path: string,
  min: number,
  max: number,
  scale: 'linear' | 'log',
  extra: { integer?: boolean; init?: number } = {},
): MatchParamDef => ({ path, min, max, scale, ...extra })

/** Stage 1 — source params for a synth track. 20 dims (incl. the note-gate fraction). Ranges
 * follow vary's VARY_GROUPS where a group exists, widened where matching (not variation around a
 * good patch) needs the full musical span. */
const SYNTH_STAGE1: MatchParamDef[] = [
  p('match.cutoff', 150, 16000, 'log', { init: 0.8 }),
  p('match.resonance', 0.2, 3.5, 'log', { init: 0.3 }),
  p('match.attack', 0.002, 0.8, 'log', { init: 0.2 }),
  p('match.decay', 0.02, 1.5, 'log'),
  p('match.sustain', 0, 1, 'linear'),
  p('match.release', 0.02, 1.8, 'log'),
  p('match.osc2Level', 0, 0.9, 'linear', { init: 0 }),
  p('match.osc2Detune', 0, 1200, 'linear', { init: 0.01 }),
  p('match.subLevel', 0, 0.9, 'linear', { init: 0 }),
  p('match.noiseLevel', 0, 0.5, 'linear', { init: 0 }),
  p('match.unisonVoices', 1, 7, 'linear', { integer: true, init: 0 }),
  p('match.unisonWidth', 0, 1, 'linear', { init: 0 }),
  p('match.fmLevel', 0, 0.8, 'linear', { init: 0 }),
  p('match.fmHarmonicity', 0.25, 8, 'log', { init: 0.4 }),
  p('match.fmModIndex', 0.5, 12, 'log', { init: 0.5 }),
  p('match.filterEnvAmount', 0, 0.8, 'linear', { init: 0 }),
  p('match.filterEnvAttack', 0.002, 0.5, 'log'),
  p('match.filterEnvDecay', 0.03, 0.8, 'log'),
  p('match.filterEnvSustain', 0, 0.8, 'linear'),
  // The note's gate: how much of the loop the key is held (release begins at the gate). A source
  // param in every sense — a plucked target needs a short gate, a pad a long one.
  p('gate', 0.1, 0.95, 'linear', { init: 0.7 }),
]

/** Stage 2 — insert effects on the synth track's chain, searched with stage 1 frozen. 12 dims.
 * Inits map to "effect off" so stage 2 starts from the stage-1 winner's sound exactly. */
const SYNTH_STAGE2: MatchParamDef[] = [
  p('match.distortionAmount', 0, 0.7, 'linear', { init: 0.1 }),
  p('match.distortionMix', 0, 0.8, 'linear', { init: 0 }),
  p('match.bitcrushMix', 0, 0.6, 'linear', { init: 0 }),
  p('match.bitcrushRate', 1, 8, 'log', { init: 0 }),
  p('match.compMix', 0, 1, 'linear', { init: 0 }),
  p('match.compThreshold', -38, -8, 'linear', { init: 0.5 }),
  p('match.compRatio', 1.5, 10, 'log', { init: 0.4 }),
  p('match.eqLow', -6, 6, 'linear', { init: 0.5 }),
  p('match.eqMid', -6, 6, 'linear', { init: 0.5 }),
  p('match.eqHigh', -6, 6, 'linear', { init: 0.5 }),
  p('match.chorusMix', 0, 0.7, 'linear', { init: 0 }),
  p('match.saturatorMix', 0, 0.7, 'linear', { init: 0 }),
]

/** The synth track's discrete axes: main osc type x filter type. wavetable is included (wtPos is
 * a stage-1 continuous param only when it matters — harmless otherwise). 5 x 3 = 15 combos. */
const OSC_TYPES = ['sine', 'triangle', 'sawtooth', 'square', 'wavetable'] as const
const FILTER_TYPES = ['lowpass', 'bandpass', 'highpass'] as const

/** Drum-sampler stage 1 — the Phase 26 lean drum-sampler surface over the target chop itself
 * registered as the lane's sample (auto-preset-from-reference for the sampler). */
const DRUM_SAMPLER_STAGE1: MatchParamDef[] = [
  p('match.lane.chop.start', 0, 0.4, 'linear', { init: 0 }),
  p('match.lane.chop.length', 0, 2, 'linear', { init: 0 }),
  p('match.lane.chop.attack', 0.001, 0.2, 'log', { init: 0 }),
  p('match.lane.chop.hold', 0, 1, 'linear', { init: 0.5 }),
  p('match.lane.chop.decay', 0, 1.5, 'linear', { init: 0 }),
  p('match.lane.chop.cutoff', 150, 18000, 'log', { init: 1 }),
  p('match.lane.chop.resonance', 0.2, 3.5, 'log', { init: 0.3 }),
]

/** Drum-sampler stage 2 — the same track-level insert chain as synth (drums tracks carry the
 * identical fx surface). */
const DRUM_SAMPLER_STAGE2: MatchParamDef[] = SYNTH_STAGE2

/** wtPos only shapes sound for osc 'wavetable'; keeping it in every run costs one dim. It stays
 * in stage 1 unconditionally for simplicity — a dead dim for non-wavetable combos, and CMA-ES
 * treats it as noise (flat direction), which costs little at these budgets. */
export function buildMatchSpace(trackKind: MatchTrackKind): MatchSpace {
  if (trackKind === 'synth') {
    const discreteChoices: DiscreteChoice[] = []
    for (const osc of OSC_TYPES) {
      for (const filt of FILTER_TYPES) {
        discreteChoices.push({
          edits: { 'match.osc': osc, 'match.filterType': filt },
          label: `${osc}/${filt}`,
        })
      }
    }
    const stage1 = [...SYNTH_STAGE1, p('match.wtPos', 0, 1, 'linear')]
    return { trackKind, trackId: MATCH_TRACK_ID, stage1, stage2: SYNTH_STAGE2, discreteChoices }
  }
  return {
    trackKind,
    trackId: MATCH_TRACK_ID,
    stage1: DRUM_SAMPLER_STAGE1,
    stage2: DRUM_SAMPLER_STAGE2,
    discreteChoices: [{ edits: {}, label: 'sampler' }],
  }
}

// ---- genome <-> values ------------------------------------------------------------------------

export function denormalizeParam(def: MatchParamDef, unit: number): number {
  const u = Math.min(1, Math.max(0, unit))
  let v: number
  if (def.scale === 'log') v = def.min * Math.pow(def.max / def.min, u)
  else v = def.min + (def.max - def.min) * u
  if (def.integer) v = Math.round(v)
  return v
}

export function normalizeParam(def: MatchParamDef, value: number): number {
  const v = Math.min(def.max, Math.max(def.min, value))
  const u = def.scale === 'log' ? Math.log(v / def.min) / Math.log(def.max / def.min) : (v - def.min) / (def.max - def.min)
  return Math.min(1, Math.max(0, u))
}

/** The genome's starting point: each param's declared init (default 0.5). */
export function initGenome(defs: MatchParamDef[]): number[] {
  return defs.map((d) => d.init ?? 0.5)
}

/** Spectral-analysis initialization (research/107 §2.3: it accelerates convergence — and the
 * first real self-match showed WHY it is needed: with a fixed bright cutoff init, the discrete
 * screen ranks every osc/filter combo in a region of param space far from the target, and picks
 * the wrong combo). Currently one measurement: the filter cutoff starts near 2x the target's
 * spectral centroid (a lowpass at ~2x centroid passes the bulk of the measured spectrum) instead
 * of a fixed bright default. Returns a NEW def list; non-cutoff params keep their declared init. */
export function applySpectralInit(defs: MatchParamDef[], targetCentroidHz: number): MatchParamDef[] {
  if (!(targetCentroidHz > 0)) return defs
  return defs.map((d) => {
    if (!d.path.endsWith('.cutoff')) return d
    return { ...d, init: normalizeParam(d, targetCentroidHz * 2) }
  })
}

/** Genome -> ordered `beat set` edits ("path value" pairs, formatNumber-canonical). The `gate`
 * pseudo-param is returned separately — it edits the note, not a synth field. */
export function genomeToEdits(
  defs: MatchParamDef[],
  genome: number[],
): { edits: { path: string; value: string }[]; gate: number | null } {
  if (genome.length !== defs.length) throw new Error(`genome has ${genome.length} dims, space has ${defs.length}`)
  const edits: { path: string; value: string }[] = []
  let gate: number | null = null
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i]!
    const value = denormalizeParam(def, genome[i]!)
    if (def.path === 'gate') gate = value
    else edits.push({ path: def.path, value: formatNumber(value) })
  }
  return { edits, gate }
}

// ---- candidate documents ----------------------------------------------------------------------

export interface BaseDocOptions {
  trackKind: MatchTrackKind
  midi: number
  /** target chop length, seconds — the render length is matched to it (>=). */
  durationSeconds: number
  /** for drum-sampler: sha256 of the target wav registered as the lane's sample. */
  targetSha256?: string
}

export interface BaseDoc {
  /** canonical serialized text of the base (all-defaults) candidate */
  text: string
  bpm: number
  loopBars: number
  /** seconds one render of this doc produces ((bars*240)/bpm — cli/render.mjs's own math) */
  renderSeconds: number
}

/** One-note (or one-hit) candidate project sized so a single loop pass renders at least the
 * target's duration: loop_bars 1 and bpm = 240/duration, clamped to a sane tempo range with bars
 * added when the clamp runs out. */
export function buildBaseDoc(opts: BaseDocOptions): BaseDoc {
  const dur = Math.max(0.25, opts.durationSeconds)
  let bpm = Math.round(Math.min(300, Math.max(40, 240 / dur)))
  let loopBars = Math.ceil((dur * bpm) / 240 - 1e-9)
  loopBars = Math.min(8, Math.max(1, loopBars))
  const renderSeconds = (loopBars * 240) / bpm
  const lines: string[] = ['format_version 0.10', `bpm ${bpm}`, `loop_bars ${loopBars}`, `selected_track ${MATCH_TRACK_ID}`, '']
  if (opts.trackKind === 'drum-sampler') {
    if (!opts.targetSha256) throw new Error('drum-sampler match needs the target sha256 for media registration')
    lines.push(
      'media',
      `  sample target sha256:${opts.targetSha256} media/target.wav`,
      '',
      `track ${MATCH_TRACK_ID} Match #e06c75 drums`,
      '  synth',
      '    osc sawtooth',
      '    volume -6',
      '    cutoff 18000',
      '    resonance 0.7',
      '    attack 0.001',
      '    decay 0.2',
      '    sustain 1',
      '    release 0.2',
      '    pan 0',
      '  lane chop sample target 0 0',
      '  hit h1 chop 0 0.9',
    )
  } else {
    lines.push(
      `track ${MATCH_TRACK_ID} Match #e06c75 synth`,
      '  synth',
      '    osc sawtooth',
      '    volume -6',
      '    cutoff 18000',
      '    resonance 0.7',
      '    attack 0.01',
      '    decay 0.2',
      '    sustain 0.7',
      '    release 0.3',
      '    pan 0',
      `  note n1 ${opts.midi} 0 ${formatNumber(loopBars * 16 * 0.7)} 0.85`,
    )
  }
  const text = serialize(parse(lines.join('\n') + '\n')) // canonicalize through the real parser
  return { text, bpm, loopBars, renderSeconds }
}

/** Apply a candidate's discrete + continuous edits (and gate) to the base doc. Returns canonical
 * text plus the full replayable edit list (`beat set` pairs, discrete first). `frozenGate` is the
 * stage-1 winner's gate for later stages whose own defs don't include the gate pseudo-param —
 * without it a staged run would silently revert the note length to the base default (a measured
 * bug: the first real self-match's inserts stage scored WORSE than its own starting point). */
export function buildCandidateDoc(
  base: BaseDoc,
  space: MatchSpace,
  discrete: DiscreteChoice,
  defs: MatchParamDef[],
  genome: number[],
  frozenEdits: { path: string; value: string }[] = [],
  frozenGate: number | null = null,
): { text: string; edits: { path: string; value: string }[]; gate: number | null } {
  const fromGenome = genomeToEdits(defs, genome)
  const edits = fromGenome.edits
  const gate = fromGenome.gate ?? frozenGate
  const allEdits: { path: string; value: string }[] = [
    ...Object.entries(discrete.edits).map(([path, value]) => ({ path, value })),
    ...frozenEdits,
    ...edits,
  ]
  let doc = parse(base.text)
  for (const e of allEdits) doc = setValue(doc, e.path, e.value)
  if (gate !== null && space.trackKind === 'synth') {
    const steps = Math.max(0.25, Math.round(base.loopBars * 16 * gate * 4) / 4)
    const track = doc.tracks.find((t) => t.id === space.trackId)
    if (track) {
      const notes = track.notes.map((n) => (n.id === 'n1' ? { ...n, duration: steps } : n))
      doc = { ...doc, tracks: doc.tracks.map((t) => (t.id === space.trackId ? { ...t, notes } : t)) }
    }
  }
  return { text: serialize(doc), edits: allEdits, gate }
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

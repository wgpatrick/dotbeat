// The retarget search space: which engine synth fields a preset retarget may move, how far, and
// how a genome in [0,1]^n becomes a param bag.
//
// THE CRITICAL DIFFERENCE FROM src/match/space.ts: match searches for a patch from scratch, so its
// genome starts at a declared per-param init and roams the whole musical range. Retargeting starts
// FROM a preset — a human-designed known-good point — so every param's genome starts at the
// PRESET'S OWN VALUE and a per-param TRUST RADIUS bounds how far it may travel. That box is the
// hard half of the trust region (loss.ts's `drift` term is the soft half). It is the whole reason
// this is a different problem from the T5 scaling gate (research/117, docs/pilot.md), where
// critic-guided search over a big patch space LOST to random controls: there is no big space here.
//
// FIELD CHOICE: the ~20 continuous synth fields that plausibly move the axes in targets.ts, split
// into the levers research/138 §2 names explicitly (subLevel, osc2Detune, envelope attacks,
// compMix parallel compression, EQ tilt) plus the timbre fields around them. Deliberately absent:
//   - `volume` and `pan` — features are loudness-normalized and the engine renders mono,
//   - discrete fields (osc/osc2Type/filterType/lfoDest) — changing a preset's oscillator is not a
//     retarget of that preset, it is a different preset,
//   - LFO rate/depth — 131 P3's motion lever, but the match harness excluded LFOs for a measured
//     reason (temporal-phase misalignment makes spectral objectives noisy on them) and the same
//     applies to frame-statistic targets. Flagged in the report as unexplored, not as done.
//   - sends (reverb/delay) — bus tails the fixed render window truncates ambiguously.

import { SYNTH_FIELDS, INIT_SYNTH } from '../core/document.js'

export interface RetargetParamDef {
  /** synth field name, e.g. "cutoff" — becomes `<trackId>.<field>` in a `beat set` edit. */
  field: string
  min: number
  max: number
  scale: 'linear' | 'log'
  integer?: boolean
  /** hard trust radius, in genome units (fraction of the full [min,max] range) the value may move
   * from the preset's own starting point. */
  trust: number
  /** why this field is in the space, and why its trust radius is what it is. */
  note: string
}

const p = (
  field: string,
  min: number,
  max: number,
  scale: 'linear' | 'log',
  trust: number,
  note: string,
  extra: { integer?: boolean } = {},
): RetargetParamDef => ({ field, min, max, scale, trust, note, ...extra })

/** Shared pitched-role space, 20 dims. Ranges bound the MUSICAL region (the same Dahlstedt
 * discipline vary's VARY_GROUPS and match's space use), trust radii bound the DISTANCE FROM THE
 * PRESET. A radius is quoted in the unit that matters for that field (octaves for log fields). */
const PITCHED_SPACE: RetargetParamDef[] = [
  // --- source / filter -------------------------------------------------------------------------
  p('cutoff', 80, 16000, 'log', 0.18, 'centroid/mids-share/tilt. Range is 7.6 octaves, so 0.18 = ~1.4 octaves of travel — enough to move a bright pad into the ref band, not enough to make it a different patch.'),
  p('resonance', 0.2, 3, 'log', 0.3, 'presence-band crest and flatness. Capped at 3 (seeds.ts caps 0.85 to dodge self-oscillation whine; matching needs more headroom than rolling does).'),
  // --- amp envelope ----------------------------------------------------------------------------
  p('attack', 0.001, 0.5, 'log', 0.3, '131 §7 P2: attackP25Ms <= 12 ms chords / <= 8 ms lead. 0.3 of a 9-octave log range = ~2.7 octaves — a 30 ms attack can reach 5 ms.'),
  p('decay', 0.02, 1.5, 'log', 0.25, 'transient shape and per-band steadiness.'),
  p('sustain', 0, 1, 'linear', 0.3, 'sustainPct / envelope steadiness (131 §6: refs are STEADIER at band scale).'),
  p('release', 0.02, 1.8, 'log', 0.25, 'tail density between notes — the other half of band-energy steadiness.'),
  // --- layers (the register levers 138 §2 rows 1 and 3 name) -----------------------------------
  p('subLevel', 0, 0.9, 'linear', 0.7, '138 §2 row 1: "subLevel 0 -> 0.5", the single named lever for bandSubPct 0.2% -> >=30%. Wide trust ON PURPOSE — this is the retarget, not a nudge.'),
  p('osc2Level', 0, 0.9, 'linear', 0.5, '138 §2 row 3: the octave-body layer that takes bandMidsPct 99 -> <=90.'),
  p('osc2Detune', -1200, 1200, 'linear', 0.6, '138 §2 row 3: "osc2Detune -1200" (an octave down = body) vs engineplus\'s +10 cents (a width move). Trust must span the full octave-down reach.'),
  p('noiseLevel', 0, 0.35, 'linear', 0.4, '131 §7 P4 texture: the only in-band noise source the engine has. Capped low — gen\'s measured failure mode is overshoot into hiss (131 §3.3).'),
  // --- filter envelope (movement) --------------------------------------------------------------
  p('filterEnvAmount', 0, 0.9, 'linear', 0.45, '131 §7 P3 movement: "filter-env/LFO depth so notes evolve". fluxMean is a +1.06 d axis and this is the engine\'s per-note motion source.'),
  p('filterEnvAttack', 0.002, 0.5, 'log', 0.35, 'shapes the filter sweep\'s leading edge — attack statistics see it.'),
  p('filterEnvDecay', 0.03, 0.8, 'log', 0.35, 'how long each note keeps moving.'),
  p('filterEnvSustain', 0, 0.8, 'linear', 0.35, 'where the sweep settles.'),
  // --- inserts ---------------------------------------------------------------------------------
  p('saturatorDrive', 0, 0.9, 'linear', 0.4, '131 §7 P4: harmonics into the 2-8 kHz band (flatnessHiDb).'),
  p('saturatorMix', 0, 0.7, 'linear', 0.4, 'the saturator\'s dry/wet — texture without losing the fundamental.'),
  p('compThreshold', -38, -8, 'linear', 0.4, '138 §2 row 4 parallel compression: threshold -32.'),
  p('compRatio', 1.5, 10, 'log', 0.4, '138 §2 row 4: ratio 8.'),
  p('compMix', 0, 1, 'linear', 0.5, '138 §2 row 4: "compMix ships at 0, untouched by every profile and trick — a true dry/wet fan sitting unused". Target 0.3-0.4. This is the density lever that does NOT cost crest.'),
  p('eqLow', -8, 8, 'linear', 0.35, 'register/tilt trim (slopeDbPerOct, bandBassPct).'),
  p('eqMid', -8, 8, 'linear', 0.35, 'bandMidsPct — the 99%-mids occupancy 133/131 §6 both measured.'),
  p('eqHigh', -8, 8, 'linear', 0.35, 'air/presence tilt (slopeDbPerOct band).'),
]

/** The role's search space. All three pitched roles share one space — 131 §5's point is that the
 * TARGETS differ per role with opposite signs, not that different knobs exist per role. */
export function retargetSpace(role: string): RetargetParamDef[] {
  if (role !== 'bassline' && role !== 'chords' && role !== 'lead') {
    throw new Error(`no retarget space for role "${role}" (pitched roles only: bassline, chords, lead)`)
  }
  return PITCHED_SPACE.map((d) => ({ ...d }))
}

// ---- genome <-> values --------------------------------------------------------------------------

export function denormalize(def: RetargetParamDef, unit: number): number {
  const u = Math.min(1, Math.max(0, unit))
  let v: number
  if (def.scale === 'log') {
    // log fields may legitimately start at or below 0 in the format (none do today) — guard anyway
    const lo = Math.max(1e-9, def.min)
    v = lo * Math.pow(def.max / lo, u)
  } else {
    v = def.min + (def.max - def.min) * u
  }
  return def.integer ? Math.round(v) : v
}

export function normalize(def: RetargetParamDef, value: number): number {
  const v = Math.min(def.max, Math.max(def.min, value))
  const u =
    def.scale === 'log'
      ? Math.log(v / Math.max(1e-9, def.min)) / Math.log(def.max / Math.max(1e-9, def.min))
      : (v - def.min) / (def.max - def.min)
  return Math.min(1, Math.max(0, u))
}

const FIELD_DEFAULTS: Record<string, number> = (() => {
  const out: Record<string, number> = {}
  for (const f of SYNTH_FIELDS) if (typeof f.default === 'number') out[f.key] = f.default
  for (const [k, v] of Object.entries(INIT_SYNTH)) if (typeof v === 'number') out[k] ??= v
  return out
})()

/** The engine's own default for a synth field (what a preset that doesn't mention it renders as). */
export function fieldDefault(field: string): number {
  const v = FIELD_DEFAULTS[field]
  if (v === undefined) throw new Error(`"${field}" is not a numeric engine synth field`)
  return v
}

/** The genome the search STARTS at: each param at the preset's own value, or the engine default
 * where the preset is silent. This is the whole thesis in one function — the optimizer opens at a
 * human-designed known-good point rather than anywhere in a huge space. */
export function presetGenome(defs: readonly RetargetParamDef[], params: Record<string, unknown>): number[] {
  return defs.map((d) => {
    const raw = params[d.field]
    const value = typeof raw === 'number' ? raw : fieldDefault(d.field)
    return normalize(d, value)
  })
}

/** Per-param [lo, hi] genome bounds: the preset's start +/- its trust radius, clipped to [0,1]. */
export function trustBounds(defs: readonly RetargetParamDef[], start: readonly number[]): { lower: number[]; upper: number[] } {
  const lower: number[] = []
  const upper: number[] = []
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i]!
    const s = start[i] ?? 0.5
    lower.push(Math.max(0, s - d.trust))
    upper.push(Math.min(1, s + d.trust))
  }
  return { lower, upper }
}

/** Genome -> the param bag a preset row carries (rounded the way factory.json rounds). */
export function genomeToParams(defs: readonly RetargetParamDef[], genome: readonly number[]): Record<string, number> {
  if (genome.length !== defs.length) throw new Error(`genome has ${genome.length} dims, space has ${defs.length}`)
  const out: Record<string, number> = {}
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i]!
    out[d.field] = roundParam(denormalize(d, genome[i]!))
  }
  return out
}

/** 4 significant-ish decimals, matching how factory.json / engine-curated.json store params. */
export function roundParam(v: number): number {
  if (!Number.isFinite(v)) return 0
  const abs = Math.abs(v)
  const dp = abs >= 100 ? 0 : abs >= 10 ? 2 : abs >= 1 ? 3 : 4
  return Number(v.toFixed(dp))
}

export interface ParamMove {
  field: string
  from: number
  to: number
  /** movement as a fraction of the param's full range (signed) — comparable across fields. */
  rangeFraction: number
  /** movement as a fraction of the param's trust radius (0..1 by construction). */
  trustFraction: number
}

/** Which params actually moved, biggest first — the retarget's diff. Fields whose genome moved
 * less than `epsilon` are omitted. */
export function paramDiff(
  defs: readonly RetargetParamDef[],
  start: readonly number[],
  end: readonly number[],
  epsilon = 0.005,
): ParamMove[] {
  const moves: ParamMove[] = []
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i]!
    const a = start[i] ?? 0
    const b = end[i] ?? 0
    if (Math.abs(b - a) < epsilon) continue
    moves.push({
      field: d.field,
      from: roundParam(denormalize(d, a)),
      to: roundParam(denormalize(d, b)),
      rangeFraction: Number((b - a).toFixed(4)),
      trustFraction: d.trust > 0 ? Number(((b - a) / d.trust).toFixed(4)) : 0,
    })
  }
  return moves.sort((x, y) => Math.abs(y.rangeFraction) - Math.abs(x.rangeFraction))
}

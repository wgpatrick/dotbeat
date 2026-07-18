// `beat gen-kit` — the pure half of the gen-kit pipeline (docs/gen-kit-pipeline.md).
//
// The command composes a playable .beat project entirely from GENERATED sounds: per-role candidate
// batches (deferred registration, Phase 40 VB), a measurable default pick per role, keymapped
// tonal instruments (Phase 40 VA), and simple seeded starter patterns. This module owns everything
// about that which is a pure function — role vocabulary, per-candidate style prompts, the pick
// heuristics, the keymap span arithmetic, and the pattern plans — so all of it is unit-testable
// with no generation, no audio files and no I/O. The orchestration (generate → measure → adopt →
// build the document) lives in cli/beat.mjs's genKitCmd, which is a thin loop over these.
//
// Two design rules, stated once:
//   - Every choice is DETERMINISTIC in the run's --seed. A gen-kit project is reproducible the
//     same way a stub gen batch is: same seed, same backend, same bytes.
//   - The pick heuristics are a DEFAULT, not a judgement. All N candidates stay behind as an
//     ordinary rateable batch (group `genkit:<role>`), so the owner — or, later, the trained
//     critic — re-picks through the same score/adopt loop everything else uses. The heuristic's
//     only job is to make the first render sound plausible, measurably (a kick whose spectral
//     centroid sits at 6 kHz is not a kick — the same centroid comparison that picked the
//     recipe-song's snare by hand on 2026-07-14).

import { mulberry32 } from '../taste/eval.js'
import { stylePromptsFor } from '../taste/seeds.js'
import { hzToMidi, midiToNote } from '../core/keymap.js'
import { PITCH_CONFIDENCE_MEDIUM, type PitchDetection } from './pitch.js'

export class BeatGenKitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatGenKitError'
  }
}

export interface GenKitRoleSpec {
  role: string
  kind: 'drum' | 'tonal'
  /** The subject half of every candidate prompt — style treatments come from the shared
   * GEN_STYLES bank (stylePromptsFor), so gen-kit batches speak the taste loop's prompt
   * vocabulary. Tonal subjects say "single sustained note" on purpose: the winner gets
   * pitch-detected and keymapped, and a chord or a riff has no single root to detect. */
  subject: string
  seconds: number
  /** drum roles: where this role's spectral centroid should roughly sit (Hz). The pick minimizes
   * log-distance to it — kicks live in the sub/low band, hats in the air band. */
  targetCentroidHz?: number
  /** lane gain when the picked sample is wired into the project (the recipe-song's balances). */
  laneGainDb: number
}

/** In build order. Drum roles land as lanes on one "kit" track; tonal roles each get their own
 * keymapped track. */
export const GENKIT_ROLES: readonly GenKitRoleSpec[] = [
  { role: 'kick', kind: 'drum', subject: 'a punchy kick drum one-shot', seconds: 1, targetCentroidHz: 150, laneGainDb: 0 },
  { role: 'snare', kind: 'drum', subject: 'a tight snare drum one-shot', seconds: 1, targetCentroidHz: 1800, laneGainDb: -2 },
  { role: 'hats', kind: 'drum', subject: 'a crisp closed hi-hat one-shot', seconds: 1, targetCentroidHz: 6000, laneGainDb: -6 },
  { role: 'perc', kind: 'drum', subject: 'a resonant percussion hit one-shot', seconds: 1, targetCentroidHz: 2500, laneGainDb: -4 },
  { role: 'bass', kind: 'tonal', subject: 'a deep sustained synth bass, one single note', seconds: 2, laneGainDb: -3 },
  { role: 'lead', kind: 'tonal', subject: 'a melodic synth pluck, one single sustained note', seconds: 2, laneGainDb: -4 },
]

/** Parse `--roles kick,snare,bass` into specs, preserving GENKIT_ROLES build order regardless of
 * how the flag was ordered. Unknown names error naming the vocabulary. */
export function parseGenKitRoles(csv?: string): GenKitRoleSpec[] {
  if (csv === undefined || csv.trim() === '') return [...GENKIT_ROLES]
  const wanted = csv.split(',').map((r) => r.trim()).filter((r) => r !== '')
  if (wanted.length === 0) throw new BeatGenKitError('--roles needs at least one role')
  const known = new Set(GENKIT_ROLES.map((s) => s.role))
  for (const r of wanted) {
    if (!known.has(r)) throw new BeatGenKitError(`unknown role "${r}" — roles are: ${GENKIT_ROLES.map((s) => s.role).join(', ')}`)
  }
  const set = new Set(wanted)
  return GENKIT_ROLES.filter((s) => set.has(s.role))
}

/** The N distinct-style candidate prompts for one role — taste-collect's style-contrast
 * convention, verbatim (one subject × N style treatments, not N seeds of one prompt). */
export function genkitPrompts(spec: GenKitRoleSpec, count: number, seed: number): string[] {
  return stylePromptsFor(spec.subject, count, seed)
}

export interface GenKitPick {
  /** 0-based candidate index (candidate i is vN.wav with N = index + 1). */
  index: number
  /** One printed line saying WHY — a heuristic that can't explain itself can't be re-judged. */
  reason: string
}

/** Drum pick: the candidate whose spectral centroid sits closest (in octaves, i.e. log distance —
 * spectral judgments are ratio judgments) to the role's target. Unmeasurable candidates (silence,
 * undecodable) never win; if nothing is measurable the first candidate wins by position, and the
 * reason says so honestly. This is exactly the by-hand snare pick from examples/recipe-song,
 * automated. */
export function pickDrumCandidate(spec: GenKitRoleSpec, centroidsHz: (number | null)[]): GenKitPick {
  if (centroidsHz.length === 0) throw new BeatGenKitError(`no candidates to pick for ${spec.role}`)
  const target = spec.targetCentroidHz ?? 1000
  let best = -1
  let bestDist = Infinity
  for (let i = 0; i < centroidsHz.length; i++) {
    const c = centroidsHz[i]
    if (c === null || c === undefined || !(c > 0)) continue
    const dist = Math.abs(Math.log2(c / target))
    if (dist < bestDist) {
      best = i
      bestDist = dist
    }
  }
  if (best === -1) return { index: 0, reason: 'no candidate had a measurable spectral centroid — defaulted to v1' }
  return {
    index: best,
    reason: `centroid ${centroidsHz[best]!.toFixed(0)} Hz, nearest the ~${target} Hz a ${spec.role} wants (${bestDist.toFixed(2)} octaves off)`,
  }
}

export interface GenKitTonalPick extends GenKitPick {
  /** The root the keymap is built on (fractional MIDI — a generated note rarely lands on a
   * semitone, and the fractional tune is what makes the keymap right anyway). */
  rootMidi: number
  /** 'detected' = a medium+/confident f0; 'suggested' = low confidence everywhere, rooted on the
   * winner's lowest strong partial instead (the --root path, taken for the user, and said so). */
  rootSource: 'detected' | 'suggested'
}

/** Tonal pick: the candidate with the most CONFIDENT single detected pitch — a keymap built on a
 * wrong root is worse than none (Phase 40 VA), so pitch-detection confidence IS the quality axis
 * here. When no candidate reaches medium confidence, the best one still wins but its root comes
 * from its lowest strong partial (detectPitch's suggestedRootHz — the same value `beat keymap`'s
 * refusal message offers as a ready-to-paste --root), and the reason says which path was taken. */
export function pickTonalCandidate(pitches: PitchDetection[]): GenKitTonalPick {
  if (pitches.length === 0) throw new BeatGenKitError('no candidates to pick')
  let best = -1
  let bestConf = -1
  for (let i = 0; i < pitches.length; i++) {
    const p = pitches[i]!
    if (p.hz === null && p.suggestedRootHz === null) continue
    if (p.confidence > bestConf) {
      best = i
      bestConf = p.confidence
    }
  }
  if (best === -1) {
    throw new BeatGenKitError(
      'no candidate produced any pitch reading at all (no f0, no prominent partial) — nothing to keymap. Re-run with more candidates or a different prompt',
    )
  }
  const p = pitches[best]!
  if (p.hz !== null && p.midi !== null && p.confidence >= PITCH_CONFIDENCE_MEDIUM) {
    return {
      index: best,
      rootMidi: p.midi,
      rootSource: 'detected',
      reason: `detected ${p.hz.toFixed(1)} Hz = ${p.note} at ${p.level} confidence ${p.confidence.toFixed(2)} — the most confident single pitch in the batch`,
    }
  }
  // Low confidence everywhere: root on the winner's lowest strong partial rather than refusing —
  // gen-kit's contract is a playable starting point, and the batch stays scoreable for a re-pick.
  const rootHz = p.suggestedRootHz ?? p.hz
  if (rootHz === null) throw new BeatGenKitError('winning candidate has no usable root — cannot keymap')
  return {
    index: best,
    rootMidi: hzToMidi(rootHz),
    rootSource: 'suggested',
    reason: `no candidate reached medium pitch confidence (best ${p.confidence.toFixed(2)}) — rooted on the winner's lowest strong partial, ${rootHz.toFixed(1)} Hz = ${midiToNote(hzToMidi(rootHz))} (the same call beat keymap's --root hint makes)`,
  }
}

/** The one-octave keymap span for a sample root in a given key: from the key's root note NEAREST
 * the sample's own root, up one octave. Anchoring the octave to the sample instead of to an
 * absolute register keeps every tune well inside the ±24-semitone lane clamp (worst case ±6 to
 * reach the nearest key root, +12 to the top of the octave) no matter where generation landed —
 * the key contributes its pitch CLASS, the sample contributes its register. */
export function keymapSpanForRoot(rootMidi: number, keyPitchClass: number): { fromMidi: number; toMidi: number } {
  if (!Number.isInteger(keyPitchClass) || keyPitchClass < 0 || keyPitchClass > 11) {
    throw new BeatGenKitError(`key pitch class must be an integer 0-11, got ${keyPitchClass}`)
  }
  const nearest = Math.round((rootMidi - keyPitchClass) / 12) * 12 + keyPitchClass
  // Keep the whole octave inside MIDI range (a 20 Hz bass root sits near the floor).
  const fromMidi = Math.min(Math.max(nearest, 0), 115)
  return { fromMidi, toMidi: fromMidi + 12 }
}

export interface PlannedHit {
  lane: string
  /** fractional 16th steps from the loop start — the unit add-hit speaks. */
  start: number
  velocity: number
  duration?: number
}

const round2 = (x: number) => Math.round(x * 100) / 100

/** A straightforward seeded groove across whichever drum roles are present: four-on-the-floor
 * kick, backbeat snare, eighth-note hats with one seeded extra sixteenth per bar, two seeded
 * offbeat perc hits per bar. Deliberately a STARTING POINT, not a composer — `beat vary <kit>
 * feel` and the lane vary groups are the tools that make it yours (that loop is the product). */
export function planDrumHits(roleIds: string[], bars: number, seed: number): PlannedHit[] {
  const rng = mulberry32(seed)
  const have = new Set(roleIds)
  const hits: PlannedHit[] = []
  for (let bar = 0; bar < bars; bar++) {
    const base = bar * 16
    if (have.has('kick')) {
      for (const s of [0, 4, 8, 12]) hits.push({ lane: 'kick', start: base + s, velocity: s === 0 ? 0.9 : 0.85 })
      // an occasional pickup into the next bar keeps it from marching
      if (rng() < 0.4) hits.push({ lane: 'kick', start: base + 14, velocity: 0.5 })
    }
    if (have.has('snare')) {
      hits.push({ lane: 'snare', start: base + 4, velocity: 0.8 })
      hits.push({ lane: 'snare', start: base + 12, velocity: 0.8 })
      if (bar === bars - 1 && rng() < 0.6) hits.push({ lane: 'snare', start: base + 15, velocity: 0.35 })
    }
    if (have.has('hats')) {
      for (let s = 0; s < 16; s += 2) hits.push({ lane: 'hats', start: base + s, velocity: s % 4 === 0 ? 0.6 : 0.38 })
      const extra = [7, 11, 15][Math.floor(rng() * 3)]!
      hits.push({ lane: 'hats', start: base + extra, velocity: 0.28 })
    }
    if (have.has('perc')) {
      const spots = [3, 6, 10, 13, 15]
      const first = spots.splice(Math.floor(rng() * spots.length), 1)[0]!
      const second = spots.splice(Math.floor(rng() * spots.length), 1)[0]!
      for (const s of [first, second].sort((a, b) => a - b)) {
        hits.push({ lane: 'perc', start: base + s, velocity: round2(0.4 + rng() * 0.2) })
      }
    }
  }
  return hits
}

/** A simple in-key bass phrase over the keymap's lanes (low→high order): root-heavy, one seeded
 * color tone per bar from the lower half of the scale, held long enough to read as a bassline.
 * Lane names ARE pitches here (a keymapped track's lanes are named by note), so the plan is
 * key-correct by construction — every lane it can pick is a scale tone. */
export function planBassHits(laneNames: string[], bars: number, seed: number): PlannedHit[] {
  if (laneNames.length === 0) throw new BeatGenKitError('planBassHits needs at least one lane')
  const rng = mulberry32(seed)
  const root = laneNames[0]!
  const colors = laneNames.slice(1, Math.max(2, Math.ceil(laneNames.length / 2)))
  const hits: PlannedHit[] = []
  for (let bar = 0; bar < bars; bar++) {
    const base = bar * 16
    const color = colors.length > 0 ? colors[Math.floor(rng() * colors.length)]! : root
    hits.push({ lane: root, start: base, velocity: 0.8, duration: 3 })
    hits.push({ lane: root, start: base + 6, velocity: 0.55, duration: 1.5 })
    hits.push({ lane: rng() < 0.7 ? color : root, start: base + 10, velocity: 0.7, duration: 2 })
    if (rng() < 0.5) hits.push({ lane: root, start: base + 14, velocity: 0.5, duration: 1.5 })
  }
  return hits
}

/** A sparse seeded melodic walk over the keymap's lanes: four notes per bar on a light offbeat
 * grid, each step moving at most two scale degrees — melodic motion without a melody generator's
 * pretensions. Same honesty as planDrumHits: this exists to be varied, not admired. */
export function planLeadHits(laneNames: string[], bars: number, seed: number): PlannedHit[] {
  if (laneNames.length === 0) throw new BeatGenKitError('planLeadHits needs at least one lane')
  const rng = mulberry32(seed)
  const hits: PlannedHit[] = []
  let idx = Math.floor(laneNames.length / 2)
  for (let bar = 0; bar < bars; bar++) {
    const base = bar * 16
    const grid = [0, 3, 6, 10, 12, 14]
    // pick 4 of the 6 grid spots, keeping time order
    const spots: number[] = []
    const pool = [...grid]
    while (spots.length < 4) spots.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!)
    spots.sort((a, b) => a - b)
    for (const s of spots) {
      idx = Math.min(laneNames.length - 1, Math.max(0, idx + (Math.floor(rng() * 5) - 2)))
      hits.push({ lane: laneNames[idx]!, start: base + s, velocity: round2(0.5 + rng() * 0.25), duration: 1.5 })
    }
  }
  return hits
}

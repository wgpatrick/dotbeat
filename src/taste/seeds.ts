// Synthetic seed songs for the taste data-collection system (owner decision 2026-07-17: collect
// T1 preference data through a dedicated generate→vary→render→rate pipeline instead of only
// riding organic music-making). Each seed is a small, VALID .beat project sampled from a
// deterministic seeded space — different tempos, keys, progressions, palettes, drum feels — so
// the scored batches cover many aesthetics instead of one song's. The generator emits format
// text directly and every emitted file is round-tripped through parse() by the caller (a seed
// that doesn't parse is a bug, not a variant).

import { mulberry32 } from './eval.js'

interface SeedSpec {
  bpm: number
  root: number // midi root of the key
  minor: boolean
  progression: number[][] // chords as semitone offsets from root
  style: string
}

const PROGRESSIONS: { name: string; minor: boolean; chords: number[][] }[] = [
  { name: 'I-V-vi-IV', minor: false, chords: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]] },
  { name: 'vi-IV-I-V', minor: false, chords: [[9, 12, 16], [5, 9, 12], [0, 4, 7], [7, 11, 14]] },
  { name: 'i-VI-III-VII', minor: true, chords: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]] },
  { name: 'i-iv-VI-v', minor: true, chords: [[0, 3, 7], [5, 8, 12], [8, 12, 15], [7, 10, 14]] },
  { name: 'I-iii-IV-iv', minor: false, chords: [[0, 4, 7], [4, 7, 11], [5, 9, 12], [5, 8, 12]] },
  { name: 'i-VII-VI-VII', minor: true, chords: [[0, 3, 7], [10, 14, 17], [8, 12, 15], [10, 14, 17]] },
]

const OSCS = ['sawtooth', 'square', 'triangle'] as const

const pick = <T,>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!
const range = (rng: () => number, lo: number, hi: number): number => lo + rng() * (hi - lo)
const round = (v: number, dp = 2): number => Number(v.toFixed(dp))

function synthBlock(rng: () => number, opts: { osc?: string; volume: number; cutoff: number; resonance?: number; attack: number; decay: number; sustain: number; release: number; pan?: number }): string {
  return [
    '  synth',
    `    osc ${opts.osc ?? pick(rng, OSCS)}`,
    `    volume ${round(opts.volume, 1)}`,
    `    cutoff ${Math.round(opts.cutoff)}`,
    `    resonance ${round(opts.resonance ?? range(rng, 0.2, 1.2))}`,
    `    attack ${round(opts.attack, 3)}`,
    `    decay ${round(opts.decay, 2)}`,
    `    sustain ${round(opts.sustain, 2)}`,
    `    release ${round(opts.release, 2)}`,
    `    pan ${round(opts.pan ?? 0, 2)}`,
  ].join('\n')
}

/** One synthetic seed project as .beat text. Deterministic in (seed). 2 bars, 3-5 tracks. */
export function generateSeedBeat(seed: number): { text: string; description: string } {
  const rng = mulberry32(seed)
  const prog = pick(rng, PROGRESSIONS)
  const spec: SeedSpec = {
    bpm: Math.round(range(rng, 90, 160) / 2) * 2,
    root: 48 + Math.floor(rng() * 12),
    minor: prog.minor,
    progression: prog.chords,
    style: prog.name,
  }
  const lines: string[] = ['format_version 0.11', `bpm ${spec.bpm}`, 'loop_bars 2', 'selected_track chords', '']
  let uid = 100

  // chords: one voicing per half bar (8 steps), sustained
  const chordNotes: string[] = []
  spec.progression.forEach((chord, ci) => {
    for (const iv of chord) chordNotes.push(`  note u${uid++} ${spec.root + 12 + iv} ${ci * 8} 8 ${round(range(rng, 0.5, 0.75))}`)
  })
  lines.push('track chords Chords #98c379 synth')
  lines.push(synthBlock(rng, { volume: range(rng, -16, -10), cutoff: range(rng, 900, 4000), attack: range(rng, 0.01, 0.4), decay: range(rng, 0.1, 0.5), sustain: range(rng, 0.4, 0.8), release: range(rng, 0.2, 1.2) }))
  lines.push(...chordNotes, '')

  // bass: root notes on a rhythm (every 4 or offbeat 8ths)
  const bassEighths = rng() < 0.5
  lines.push('track bass Bass #f7c948 synth')
  lines.push(synthBlock(rng, { osc: pick(rng, ['sawtooth', 'square'] as const), volume: range(rng, -14, -8), cutoff: range(rng, 200, 900), attack: 0.005, decay: range(rng, 0.1, 0.3), sustain: range(rng, 0.2, 0.6), release: range(rng, 0.05, 0.25) }))
  spec.progression.forEach((chord, ci) => {
    const rootNote = spec.root - 12 + chord[0]!
    if (bassEighths) {
      for (let s = 0; s < 8; s += 2) lines.push(`  note u${uid++} ${rootNote} ${ci * 8 + s} 2 ${round(range(rng, 0.6, 0.85))}`)
    } else {
      lines.push(`  note u${uid++} ${rootNote} ${ci * 8} 4 ${round(range(rng, 0.7, 0.9))}`)
      lines.push(`  note u${uid++} ${rootNote} ${ci * 8 + 4} 3 ${round(range(rng, 0.5, 0.75))}`)
    }
  })
  lines.push('')

  // optional arp: chord tones as 16ths
  if (rng() < 0.7) {
    lines.push('track arp Arp #e06c75 synth')
    lines.push(synthBlock(rng, { volume: range(rng, -18, -12), cutoff: range(rng, 1500, 6000), attack: 0.003, decay: range(rng, 0.05, 0.2), sustain: range(rng, 0.0, 0.3), release: range(rng, 0.05, 0.2) }))
    const order = pick(rng, [[0, 1, 2, 1], [0, 2, 1, 2], [2, 1, 0, 1]] as const)
    spec.progression.forEach((chord, ci) => {
      for (let s = 0; s < 8; s++) {
        if (rng() < 0.15) continue // seeded rests
        const iv = chord[order[s % 4]!]!
        lines.push(`  note u${uid++} ${spec.root + 24 + iv} ${ci * 8 + s} 1 ${round(range(rng, 0.35, 0.6))}`)
      }
    })
    lines.push('')
  }

  // drums: legacy 5-lane kit, one of a few feels
  const feel = pick(rng, ['four', 'half', 'break'] as const)
  lines.push('track drums Drums #56b6c2 drums')
  lines.push(synthBlock(rng, { volume: range(rng, -12, -7), cutoff: 8000, attack: 0.001, decay: 0.2, sustain: 0.5, release: 0.2 }))
  let hid = 1
  const hit = (lane: string, step: number, vel: number) => lines.push(`  hit h${hid++} ${lane} ${step} ${round(vel)}`)
  for (let bar = 0; bar < 2; bar++) {
    const o = bar * 16
    if (feel === 'four') {
      for (let s = 0; s < 16; s += 4) hit('kick', o + s, range(rng, 0.8, 0.95))
      hit('snare', o + 4, range(rng, 0.7, 0.85))
      hit('snare', o + 12, range(rng, 0.7, 0.85))
      for (let s = 2; s < 16; s += 4) hit('hat', o + s, range(rng, 0.3, 0.55))
    } else if (feel === 'half') {
      hit('kick', o, range(rng, 0.85, 0.95))
      hit('kick', o + 10, range(rng, 0.6, 0.8))
      hit('snare', o + 8, range(rng, 0.75, 0.9))
      for (let s = 0; s < 16; s += 2) hit('hat', o + s, range(rng, 0.25, 0.5))
    } else {
      hit('kick', o, range(rng, 0.85, 0.95))
      hit('kick', o + 6, range(rng, 0.6, 0.8))
      hit('kick', o + 10, range(rng, 0.65, 0.85))
      hit('snare', o + 4, range(rng, 0.75, 0.9))
      hit('snare', o + 12, range(rng, 0.75, 0.9))
      for (let s = 1; s < 16; s += 2) if (rng() < 0.7) hit('hat', o + s, range(rng, 0.25, 0.5))
    }
  }
  lines.push('')

  const description = `${spec.style} in ${spec.minor ? 'minor' : 'major'} @ ${spec.bpm}bpm, ${feel} drums${lines.some((l) => l.startsWith('track arp')) ? ', arp' : ''}`
  return { text: lines.join('\n'), description }
}

// ---- Generation prompt bank -------------------------------------------------------------------
// Owner call (2026-07-17): "a lot of generation using fal as part of it — those generated sounds
// are some of the most interesting thus far." A seeded, category-stratified prompt space so gen
// batches cover the sound-design axes (what kind of sound) x style axes (what treatment), and
// the scores log's per-type splits can answer where generated taste signal actually lives.

const GEN_SUBJECTS: { id: string; subject: string; seconds: number }[] = [
  { id: 'kick', subject: 'a punchy kick drum one-shot', seconds: 1 },
  { id: 'snare', subject: 'a tight snare drum one-shot', seconds: 1 },
  { id: 'clap', subject: 'a layered hand clap one-shot', seconds: 1 },
  { id: 'hat', subject: 'a crisp closed hi-hat one-shot', seconds: 1 },
  { id: 'perc', subject: 'a resonant percussion hit', seconds: 1 },
  { id: 'bass', subject: 'a deep bass stab one-shot', seconds: 2 },
  { id: 'pluck', subject: 'a melodic synth pluck one-shot', seconds: 2 },
  { id: 'stab', subject: 'a wide chord stab one-shot', seconds: 2 },
  { id: 'pad', subject: 'an evolving ambient pad texture', seconds: 4 },
  { id: 'texture', subject: 'an atmospheric noise texture loop', seconds: 4 },
  { id: 'vox', subject: 'a short wordless vocal chop, sung vowel', seconds: 2 },
  { id: 'riser', subject: 'a rising sweep transition effect', seconds: 3 },
  { id: 'impact', subject: 'a cinematic impact hit with a tail', seconds: 3 },
]
const GEN_STYLES = [
  'analog warmth, tape saturation',
  'clean and modern, club-ready',
  'lo-fi, dusty, vinyl character',
  'dark and cavernous, heavy reverb',
  'bright and glassy, digital sheen',
  'organic and acoustic-leaning',
  'gritty distorted electronic',
  'soft, intimate, close-mic feel',
]

export interface GenPromptSpec {
  /** media-id-safe slug, unique within one collect run */
  id: string
  prompt: string
  seconds: number
}

/** `count` seeded prompts, stratified across subjects before styles repeat. */
export function generateGenPrompts(seed: number, count: number): GenPromptSpec[] {
  const rng = mulberry32(seed)
  const subjects = [...GEN_SUBJECTS].sort(() => rng() - 0.5)
  const out: GenPromptSpec[] = []
  for (let i = 0; i < count; i++) {
    const s = subjects[i % subjects.length]!
    const style = pick(rng, GEN_STYLES)
    out.push({ id: `${s.id}${Math.floor(i / subjects.length) + 1}`, prompt: `${s.subject}, ${style}`, seconds: s.seconds })
  }
  return out
}

// `beat humanize` — turn a stiff, on-grid part into one that feels played (docs/product-spec-
// desktop.md §5.5; the generative-feel half of the variation loop). Nudges note/hit START and
// VELOCITY by seeded jitter, optionally with constant drag (behind-the-beat, the J Dilla move)
// and swing (offbeat push). Pure document -> document, deterministic under a seed, scoped to a
// selection's ids when given — so "humanize the hi-hats" is one call over the selection.
//
// This is quantize's opposite number: v0.7/v0.8 store arbitrary timing, quantize snaps TO the
// grid, humanize walks AWAY from it musically. Neither is a storage default — both are edits.

import type { BeatDocument, BeatTrack } from './document.js'
import { formatNumber } from './format.js'

export class BeatHumanizeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatHumanizeError'
  }
}

const canon = (n: number): number => Number(formatNumber(n))

/** mulberry32 — the same tiny deterministic PRNG the vary loop uses (kept local so core carries
 * no dependency on the vary module). */
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One standard-normal sample (Box-Muller), so jitter clusters near zero — most events move a
 * little, few move a lot, which is what reads as "human" rather than "randomized". */
function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12)
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

export interface HumanizeOptions {
  /** Std-dev of the start-time jitter, in 16th steps. Default 0.15 (~26 ms at 90 bpm). */
  timing?: number
  /** Std-dev of the velocity jitter, 0..1. Default 0.06. */
  velocity?: number
  /** Constant drag pushing every event later, in steps — the behind-the-beat feel. Default 0. */
  pushLate?: number
  /** Swing 0..1: events on odd 16ths get pushed toward the next even step by swing*0.5 steps
   *  (MPC-style offbeat push). Default 0. */
  swing?: number
  /** Seed for reproducibility — the same (doc, track, opts, seed) always yields the same result. */
  seed?: number
  /** Restrict to these note/hit ids (a selection's resolved ids). Omitted = every event. */
  ids?: string[]
}

/** Humanizes a track's notes (synth/instrument) or hits (drums). Deterministic under the seed.
 * Starts stay >= 0; velocities clamp to (0,1] for hits and [0,1] for notes; all values snap to
 * canonical precision so the result round-trips. Returns the count of events actually moved. */
export function humanize(doc: BeatDocument, trackId: string, opts: HumanizeOptions = {}): { doc: BeatDocument; changed: number } {
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track) throw new BeatHumanizeError(`no track "${trackId}" (have: ${doc.tracks.map((t) => t.id).join(', ')})`)
  const timing = opts.timing ?? 0.15
  const velocity = opts.velocity ?? 0.06
  const pushLate = opts.pushLate ?? 0
  const swing = opts.swing ?? 0
  if (timing < 0) throw new BeatHumanizeError(`timing must be >= 0, got ${timing}`)
  if (velocity < 0) throw new BeatHumanizeError(`velocity must be >= 0, got ${velocity}`)
  if (swing < 0 || swing > 1) throw new BeatHumanizeError(`swing must be 0..1, got ${swing}`)
  if (timing === 0 && velocity === 0 && pushLate === 0 && swing === 0) throw new BeatHumanizeError('nothing to humanize: set timing, velocity, pushLate, or swing')

  const wanted = opts.ids ? new Set(opts.ids) : null
  const rng = makeRng(opts.seed ?? 1)
  let changed = 0

  // Applies the jitter to one event's (start, velocity), given the velocity floor.
  const nudge = (start: number, vel: number, velFloor: number): { start: number; velocity: number } => {
    let s = start + gaussian(rng) * timing + pushLate
    if (swing > 0 && Math.round(start) % 2 === 1) s += swing * 0.5
    s = canon(Math.max(0, s))
    let v = canon(Math.min(1, Math.max(velFloor, vel + gaussian(rng) * velocity)))
    return { start: s, velocity: v }
  }

  if (track.kind === 'drums') {
    const hits = track.hits.map((h) => {
      if (wanted && !wanted.has(h.id)) return h
      const n = nudge(h.start, h.velocity, 0.02) // hits keep a minimum audible velocity
      if (n.start === h.start && n.velocity === h.velocity) return h
      changed++
      return { ...h, start: n.start, velocity: n.velocity }
    })
    return { doc: replaceTrack(doc, { ...track, hits }), changed }
  }

  const notes = track.notes.map((nt) => {
    if (wanted && !wanted.has(nt.id)) return nt
    const n = nudge(nt.start, nt.velocity, 0)
    if (n.start === nt.start && n.velocity === nt.velocity) return nt
    changed++
    return { ...nt, start: n.start, velocity: n.velocity }
  })
  return { doc: replaceTrack(doc, { ...track, notes }), changed }
}

function replaceTrack(doc: BeatDocument, next: BeatTrack): BeatDocument {
  return { ...doc, tracks: doc.tracks.map((t) => (t.id === next.id ? next : t)) }
}

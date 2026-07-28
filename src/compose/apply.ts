// The two document-shaped halves of composing: writing a composed figure INTO a document, and
// reading a document's KEY back out of it.
//
// Both used to live in src/taste/showdown.ts. They moved here on 2026-07-27 when `beat compose`
// needed them, because showdown.ts is the taste program (blind ranking, WAV codec, reporting) and
// the DAW may not import the taste program (D8 / research/136 §4, enforced by
// test/import-boundary.test.ts). These two are not taste: neither ranks anything, and both speak
// pure document vocabulary. showdown.ts imports and re-exports them, so every existing caller —
// including cli/beat.mjs's `showdown.applyComposedPhrase` / `showdown.inferSeedKey` — is unchanged.

import type { BeatDocument } from '../core/document.js'
import { NOTE_FIELD_DEFAULTS } from '../core/index.js'
import { BeatBatchError } from '../vary/batch.js'
import { MAJOR_SCALE, NATURAL_MINOR_SCALE, type ComposedPhrase, type PhraseKey } from './phrase.js'

/** Replace `trackId`'s notes with the composed figure (ids cp1.., v0.10 fields at canonical
 * defaults). The engine clip solos this doc and the keymap clip reads the phrase back off it
 * (phraseFromSeed), so same-batch note parity holds by construction. */
export function applyComposedPhrase(doc: BeatDocument, trackId: string, phrase: ComposedPhrase): BeatDocument {
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track || track.kind !== 'synth') throw new BeatBatchError(`composed phrase needs synth track "${trackId}" (have: ${doc.tracks.map((t) => `${t.id}(${t.kind})`).join(', ')})`)
  if (phrase.notes.length === 0) throw new BeatBatchError('a composed phrase needs at least one note')
  const notes = phrase.notes.map((n, i) => ({ id: `cp${i + 1}`, pitch: n.pitch, start: n.start, duration: n.duration, velocity: n.velocity, ...NOTE_FIELD_DEFAULTS }))
  return { ...doc, tracks: doc.tracks.map((t) => (t.id === trackId && t.kind === 'synth' ? { ...t, notes } : t)) }
}

/** Best-fit key of a seed doc: score every (root, mode) candidate by how many synth-note pitch
 * classes fall inside its diatonic scale, with a small bonus for rooting on the bass's opening
 * note (breaks the relative-major/minor pitch-class tie toward the pitch the loop actually
 * centers on). Deterministic; tolerant of a borrowed chord or two. */
export function inferSeedKey(doc: BeatDocument): PhraseKey {
  const counts = new Array<number>(12).fill(0)
  for (const t of doc.tracks) {
    if (t.kind !== 'synth') continue
    for (const n of t.notes) counts[((n.pitch % 12) + 12) % 12]! += 1
  }
  if (counts.every((c) => c === 0)) throw new BeatBatchError('cannot infer a key: the seed has no synth notes')
  const bass = doc.tracks.find((t) => t.id === 'bass' && t.kind === 'synth')
  const opening = bass && bass.kind === 'synth' ? [...bass.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch)[0] : undefined
  const anchorPc = opening ? ((opening.pitch % 12) + 12) % 12 : -1
  let best: { root: number; minor: boolean; score: number } | null = null
  for (let root = 0; root < 12; root++) {
    for (const minor of [false, true]) {
      const scale = minor ? NATURAL_MINOR_SCALE : MAJOR_SCALE
      let score = 0
      for (let pc = 0; pc < 12; pc++) if (scale.includes((((pc - root) % 12) + 12) % 12)) score += counts[pc]!
      if (root === anchorPc) score += 2
      if (best === null || score > best.score) best = { root, minor, score }
    }
  }
  return { root: 48 + best!.root, minor: best!.minor }
}

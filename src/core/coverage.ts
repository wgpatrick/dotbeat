// Phase 39 Stream UA — orphaned-content detector (docs/phase-39-plan.md §UA item 1).
//
// The silent-render trap (pilot 105 HIGH): in SONG mode a document plays its `song` timeline —
// section after section, each playing one scene's placed clips. A track can hold real sounding
// content (live notes/hits, or a clip carrying notes/hits/audio) yet be placed in NO scene that the
// song ever visits. It then renders completely silent, with nothing anywhere warning the author that
// the part they wrote will not be heard. This module detects exactly that case so `beat inspect` and
// `beat render` can warn.
//
// LOOP mode (`doc.song === null`) plays the live track content directly, so there is no such trap —
// unplacedContentTracks returns [] and callers emit nothing. The "placed" test mirrors the
// resolution pattern in src/analysis/structure.ts: a track is referenced by a scene iff
// firstPlacementClip(scene.slots, trackId) resolves — a non-empty placement list — and only scenes
// actually named in `doc.song` count.

import type { BeatDocument, BeatClip, BeatTrack, TrackKind } from './document.js'
import { firstPlacementClip } from './document.js'

/** One track that HAS sounding content but is placed in no scene the song plays — so song mode won't
 * play it. `noteCount`/`hitCount` are the track's LIVE note/hit counts; `clipCount` is the number of
 * the track's clips that themselves carry sounding content (notes, hits, or an audio region). */
export interface UnplacedContentTrack {
  trackId: string
  kind: TrackKind
  noteCount: number
  hitCount: number
  clipCount: number
}

/** Does this clip carry anything that would sound — symbolic notes/hits, or an audio region? */
function clipHasContent(clip: BeatClip): boolean {
  return clip.notes.length > 0 || clip.hits.length > 0 || clip.audio !== undefined
}

/** How many of a track's clips carry sounding content. */
function contentClipCount(track: BeatTrack): number {
  return track.clips.filter(clipHasContent).length
}

/** In SONG mode only, the tracks that have sounding content (live notes/hits, or a content-bearing
 * clip) but are referenced by no scene the song plays — the silent-render trap. Returns [] in loop
 * mode (`doc.song === null`), since loop mode plays live content directly. Document track order. */
export function unplacedContentTracks(doc: BeatDocument): UnplacedContentTrack[] {
  if (!doc.song) return []

  // The scenes the song actually visits, resolved by id (a section naming a missing scene simply
  // contributes no references — same non-throwing stance as structure.ts).
  const sceneById = new Map(doc.scenes.map((s) => [s.id, s]))

  // A track is "referenced" iff some song-visited scene has a non-empty placement list for it —
  // firstPlacementClip resolving is exactly that test (the pattern structure.ts uses per section).
  const referenced = new Set<string>()
  for (const section of doc.song) {
    const scene = sceneById.get(section.scene)
    if (!scene) continue
    for (const track of doc.tracks) {
      if (firstPlacementClip(scene.slots, track.id)) referenced.add(track.id)
    }
  }

  const out: UnplacedContentTrack[] = []
  for (const track of doc.tracks) {
    if (referenced.has(track.id)) continue
    const noteCount = track.notes.length
    const hitCount = track.hits.length
    const clipCount = contentClipCount(track)
    if (noteCount === 0 && hitCount === 0 && clipCount === 0) continue // nothing to lose — no warning
    out.push({ trackId: track.id, kind: track.kind, noteCount, hitCount, clipCount })
  }
  return out
}

/** How the track's content reads in a warning: live hits/notes when present, else "content in N
 * clip(s)" (the audio-track / clip-only case). */
function contentPhrase(t: UnplacedContentTrack): string {
  if (t.hitCount > 0) return `${t.hitCount} hit${t.hitCount === 1 ? '' : 's'}`
  if (t.noteCount > 0) return `${t.noteCount} note${t.noteCount === 1 ? '' : 's'}`
  return `content in ${t.clipCount} clip${t.clipCount === 1 ? '' : 's'}`
}

/** The one-line human warning for a silent track — shared verbatim by `beat inspect` and
 * `beat render` so the two surfaces can never drift. When the track already has a clip, the only
 * missing step is placement, so the fix hint drops the `beat clip` snapshot step (pilot 106 L1). */
export function unplacedContentWarning(t: UnplacedContentTrack): string {
  const fix = t.clipCount > 0
    ? 'place a clip in a scene (beat scene / beat place)'
    : 'snapshot with beat clip, then beat scene / beat place'
  return `⚠ track '${t.trackId}' has ${contentPhrase(t)} but is placed in no scene — song mode won't play it (${fix})`
}

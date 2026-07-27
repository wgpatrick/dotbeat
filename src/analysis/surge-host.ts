// The ONE implementation of "a surge track's audio, and the drums-kind sample host that plays it"
// (Track 1a / D31's surgeplus hosting mechanism), shared by every surface that needs it:
//
//   - `beat render` and friends, through cli/surge-render-prep.mjs (which is now the file-IO shell
//     around prepareSurgeDocument: parse, rewrite, write the scratch .beat, delete it after)
//   - the daemon's GUI playback companion (src/daemon/daemon.ts), which needs the SAME render and
//     the SAME host shape but as an extra track in a served document rather than a replacement in
//     a scratch file
//
// It lives here, once, rather than being copied into the daemon, because copying it is exactly the
// failure CLAUDE.md's parity guardrail names: the cache key, the patch-name collision rules, the
// provenance sidecar and the neutral host voice are all things two copies would drift on, and the
// drift would be silent (a second copy with a different key just re-renders forever, or worse,
// serves a stale WAV that `beat render` disagrees with).
//
// Determinism/provenance is unchanged from the CLI original: the WAV is cached next to the project
// under media/ with a `.json` sidecar, keyed by a content hash of (patch, sorted overrides, notes,
// sampleRate, tempo); a matching hash skips the sidecar entirely. GPL stays out-of-process —
// nothing here links Surge, it spawns the sidecar exactly like the eval path.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BeatDocument, BeatMediaSample, BeatNote, BeatTrack } from '../core/document.js'
import type { SurgeNote } from '../taste/showdown.js'
import { BeatSurgeError, listSurgePatches, runSurgeRender, type SurgeCataloguePatch } from './surge.js'

const round4 = (x: number): number => Math.round(x * 10000) / 10000

/** BeatNote[] (pitch / step start / step duration / 0..1 velocity) -> the sidecar's absolute-time
 * note list, the exact math src/taste/showdown.ts composedPhraseToSurgeNotes uses. Sorted so the
 * content hash is stable regardless of the document's note order. */
export function notesToSurge(notes: readonly BeatNote[], bpm: number): SurgeNote[] {
  const sps = 60 / bpm / 4
  return notes
    .map((n) => ({
      midi: n.pitch,
      startSeconds: round4(n.start * sps),
      durationSeconds: round4(Math.max(1, n.duration) * sps),
      velocity: Math.min(127, Math.max(1, Math.round(n.velocity * 127))),
    }))
    .sort((a, b) => a.startSeconds - b.startSeconds || a.midi - b.midi)
}

/** The neutral voice-shaping the drums-kind sample host needs so the FULL multi-second surge render
 * plays through, gated only by the buffer end (a flat amp envelope + wide-open filter) — exactly
 * surgeSampleHostText's values. Everything else on the surge track's synth block (volume, pan,
 * sends, eq/comp/saturator/… — the production the format's synth block carries) is preserved. */
export const NEUTRAL_HOST_VOICE = { osc: 'triangle', cutoff: 18000, resonance: 0, attack: 0.001, decay: 0, sustain: 1, release: 0.05 } as const

/** Resolves a `.beat` patch NAME to a factory/third-party .fxp path, with the collision rules the
 * 3,559-patch library needs. Bare names COLLIDE (88 names are carried by more than one patch), so
 * they stay legal and resolve deterministically to the first by (category, bank, name) — the order
 * listSurgePatches returns — but a collision is WARNED about rather than resolved in silence, and a
 * qualified name disambiguates it:
 *     patch "Reese 2"                  -> first match, warns if ambiguous
 *     patch "Basses/Reese 2"           -> category-qualified
 *     patch "Lopyt/Basses/Reese 2"     -> bank+category-qualified (always unique) */
export interface SurgePatchResolver {
  /** the resolved .fxp path; throws (with near-miss suggestions) on an unknown name */
  resolve(name: string): string
  /** ambiguity warnings raised so far, in resolve() order — surfaced by the caller, never swallowed */
  warnings: string[]
  catalogueSize: number
}

// The catalogue is a 3,559-entry filesystem walk through the sidecar (~160 ms measured), and it
// cannot change while a process runs unless the user installs patches mid-session. One promise per
// process: the CLI pays it once, and the daemon — which resolves a patch on every re-render — pays
// it once per session instead of once per keystroke.
let cataloguePromise: Promise<SurgeCataloguePatch[]> | null = null

/** Test/daemon seam: drop the memoized catalogue (a patch install mid-session, or a test that
 * wants the spawn to happen again). */
export function resetSurgePatchCatalogue(): void {
  cataloguePromise = null
}

export async function surgePatchResolver(): Promise<SurgePatchResolver> {
  if (cataloguePromise === null) cataloguePromise = listSurgePatches()
  let catalogue: SurgeCataloguePatch[]
  try {
    catalogue = await cataloguePromise
  } catch (err) {
    cataloguePromise = null // a failed probe must not be cached — surgepy may appear later
    const msg = err instanceof BeatSurgeError ? err.message : String(err instanceof Error ? err.message : err)
    throw new BeatSurgeError(`surge render prep failed (cannot list Surge factory patches): ${msg}`)
  }
  const byName = new Map<string, SurgeCataloguePatch[]>()
  const qualified = new Map<string, SurgeCataloguePatch>()
  for (const p of catalogue) {
    const key = p.name.toLowerCase()
    const bucket = byName.get(key)
    if (bucket) bucket.push(p)
    else byName.set(key, [p])
    qualified.set(`${p.category}/${p.name}`.toLowerCase(), p)
    qualified.set(`${p.bank}/${p.category}/${p.name}`.toLowerCase(), p)
  }
  const warnings: string[] = []
  return {
    warnings,
    catalogueSize: catalogue.length,
    resolve(name: string): string {
      const q = qualified.get(String(name).toLowerCase())
      if (q) return q.path
      const matches = byName.get(String(name).toLowerCase()) ?? []
      if (matches.length > 1) {
        warnings.push(
          `surge: patch name "${name}" is carried by ${matches.length} patches (${matches
            .slice(0, 3)
            .map((m) => `${m.bank}/${m.category}`)
            .join(', ')}${matches.length > 3 ? ', …' : ''}) — using ${matches[0]!.bank}/${matches[0]!.category}. Qualify it as "<Bank>/<Category>/${name}" to pin one.`,
        )
      }
      const hit = matches[0]?.path
      if (hit === undefined) {
        const near = catalogue
          .map((p) => p.name)
          .filter((n) => n.toLowerCase().includes(name.toLowerCase()))
          .slice(0, 5)
        throw new BeatSurgeError(
          `surge render prep: patch "${name}" not found in the patch catalogue (${catalogue.length} patches across the factory + third-party pools)` +
            `${near.length ? `; did you mean: ${near.join(', ')}` : ''}. List names with \`beat surge patches\`.`,
        )
      }
      return hit
    },
  }
}

export function sanitizeSurgeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_')
}

/** What one surge track's audio IS, once rendered or found in the cache. `null` notes → see
 * renderSurgeTrack's `null` return (a track with nothing to synthesize). */
export interface SurgeTrackRender {
  trackId: string
  /** the media id the host lane references — `surge_<trackId>_<hash12>` */
  sampleId: string
  /** project-relative (`media/…`), the form a BeatMediaSample.path takes */
  relPath: string
  /** absolute path on disk */
  wavPath: string
  sha256: string
  /** the full content hash of (patch, overrides, notes, sampleRate, tempo) — the cache key */
  hash: string
  /** true when the cached WAV was reused and the sidecar never ran */
  cached: boolean
  seconds: number
  /** one human line for the caller to print/log */
  note: string
}

/** The cache key for a surge track's audio: everything that changes the samples. D6 — the doc's
 * bpm belongs here, not just in the note timing, because every tempo-synced LFO/delay/arp in the
 * patch locks to it, so changing the tempo must invalidate the WAV exactly like changing a note. */
export function surgeRenderHash(track: BeatTrack, doc: BeatDocument): { hash: string; surgeNotes: SurgeNote[]; overrides: { param: string; value: number }[] } | null {
  const surge = track.surge
  if (!surge) return null
  const surgeNotes = notesToSurge(track.notes, doc.bpm)
  if (surgeNotes.length === 0) return null
  const overrides = [...surge.overrides].sort((a, b) => a.param.localeCompare(b.param)).map((o) => ({ param: o.param, value: o.value }))
  const keyObj = { patch: surge.patch, overrides, notes: surgeNotes, sampleRate: surge.sampleRate, tempo: doc.bpm }
  return { hash: createHash('sha256').update(JSON.stringify(keyObj)).digest('hex'), surgeNotes, overrides }
}

/**
 * Render (or reuse the cached) audio for ONE surge track. Returns `null` for a track with no notes
 * — there is nothing to synthesize, and the caller decides what silence looks like on its surface.
 * Throws BeatSurgeError when surgepy or the patch is unavailable: the fail-loudly-at-render
 * contract, never a silent skip.
 *
 * `getResolver` is a THUNK, not a resolver, and that is load-bearing: resolving a patch name means
 * a sidecar spawn and a 3,559-entry catalogue walk, and a cache HIT needs neither. Taking it lazily
 * is what lets a fully-cached project (the daemon's steady state, and any `beat render` of an
 * unchanged document) work on a machine with no surgepy build at all.
 */
export async function renderSurgeTrack(track: BeatTrack, doc: BeatDocument, projectDir: string, getResolver: () => Promise<SurgePatchResolver>): Promise<SurgeTrackRender | null> {
  const key = surgeRenderHash(track, doc)
  if (key === null) return null
  const surge = track.surge!
  const mediaDir = join(projectDir, 'media')
  const short = key.hash.slice(0, 12)
  const sampleId = `surge_${sanitizeSurgeId(track.id)}_${short}`
  const wavName = `${sampleId}.wav`
  const wavPath = join(mediaDir, wavName)
  const provPath = `${wavPath}.json`
  const relPath = `media/${wavName}`

  let cached = false
  let seconds = 0
  if (existsSync(wavPath) && existsSync(provPath)) {
    try {
      const prov = JSON.parse(readFileSync(provPath, 'utf8')) as { hash?: string; seconds?: number }
      if (prov.hash === key.hash) {
        cached = true
        seconds = typeof prov.seconds === 'number' ? prov.seconds : 0
      }
    } catch {
      /* unreadable sidecar -> re-render */
    }
  }

  if (!cached) {
    mkdirSync(mediaDir, { recursive: true })
    const resolver = await getResolver()
    const { meta } = await runSurgeRender({
      patch: resolver.resolve(surge.patch),
      notes: key.surgeNotes,
      sampleRate: surge.sampleRate,
      outPath: wavPath,
      overrides: key.overrides,
      tempo: doc.bpm,
    })
    seconds = meta.seconds
    writeFileSync(
      provPath,
      JSON.stringify(
        {
          generator: 'surge-render (Track 1a)',
          track: track.id,
          patch: surge.patch,
          resolvedPatch: meta.patch,
          appliedOverrides: meta.overrides,
          overrides: key.overrides,
          sampleRate: surge.sampleRate,
          tempo: meta.tempo,
          tempoApplied: meta.tempoApplied,
          notes: key.surgeNotes.length,
          seconds: meta.seconds,
          hash: key.hash,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
    )
  }

  return {
    trackId: track.id,
    sampleId,
    relPath,
    wavPath,
    sha256: createHash('sha256').update(readFileSync(wavPath)).digest('hex'),
    hash: key.hash,
    cached,
    seconds,
    note: cached
      ? `surge track "${track.id}": cache hit "${surge.patch}" -> ${relPath}`
      : `surge track "${track.id}": rendered "${surge.patch}" -> ${relPath} (${seconds}s)`,
  }
}

/** The drums-kind sample host: the surge track's production (synth block + effects + groove) with a
 * neutral voice envelope/filter, one sample lane backed by the render, and one hit at step 0.
 * `overrides` lets a caller re-identify the host (the daemon names its GUI companion differently
 * from the track it shadows). */
export function surgeSampleHostTrack(track: BeatTrack, sampleId: string, overrides: Partial<Pick<BeatTrack, 'id' | 'name'>> = {}): BeatTrack {
  return {
    ...track,
    ...overrides,
    kind: 'drums',
    surge: undefined,
    synth: { ...track.synth, ...NEUTRAL_HOST_VOICE },
    laneSamples: {},
    lanes: [{ name: 'surge', backing: { type: 'sample', sample: sampleId, gainDb: 0, tune: 0, params: {}, filterType: 'lowpass', effects: [] } }],
    clips: [],
    notes: [],
    hits: [{ id: 'h1', lane: 'surge', start: 0, velocity: 0.9 }],
  }
}

/** A surge track with no notes -> a silent drums host (loads, carries no audio). */
export function silentSurgeHostTrack(track: BeatTrack, overrides: Partial<Pick<BeatTrack, 'id' | 'name'>> = {}): BeatTrack {
  return { ...track, ...overrides, kind: 'drums', surge: undefined, synth: { ...track.synth, ...NEUTRAL_HOST_VOICE }, laneSamples: {}, lanes: [], clips: [], notes: [], hits: [] }
}

export interface PreparedSurgeDocument {
  /** the rewritten document: every surge track replaced by its drums-kind sample host */
  doc: BeatDocument
  /** one entry per surge track that had notes (in document order) */
  renders: SurgeTrackRender[]
  /** human-readable prep notes — renders, cache hits, patch-name ambiguity warnings */
  notes: string[]
  /** false when the document has no surge tracks at all (doc is returned unchanged) */
  isSurge: boolean
}

/**
 * The whole render-prep rewrite, in memory: render each surge track and replace it with the
 * drums-kind sample host that plays the result. `projectDir` is the directory the document's
 * relative media paths resolve against (i.e. the .beat file's own directory).
 */
export async function prepareSurgeDocument(doc: BeatDocument, projectDir: string): Promise<PreparedSurgeDocument> {
  const surgeTracks = doc.tracks.filter((t) => t.kind === 'surge')
  if (surgeTracks.length === 0) return { doc, renders: [], notes: [], isSurge: false }

  // Lazy, and memoized across the tracks in this document: a fully-cached project never touches the
  // sidecar, and a document with three surge tracks that all miss pays for the catalogue once.
  const held: { resolver: SurgePatchResolver | null } = { resolver: null }
  const getResolver = async (): Promise<SurgePatchResolver> => {
    if (held.resolver === null) held.resolver = await surgePatchResolver()
    return held.resolver
  }
  const notes: string[] = []
  const renders: SurgeTrackRender[] = []
  const media: BeatMediaSample[] = [...doc.media]
  const tracks: BeatTrack[] = []
  for (const track of doc.tracks) {
    if (track.kind !== 'surge') {
      tracks.push(track)
      continue
    }
    const render = await renderSurgeTrack(track, doc, projectDir, getResolver)
    if (render === null) {
      // No notes -> nothing to synthesize. Desugar to a silent drums host (no lane/hit) so the doc
      // still loads and the render simply carries no surge audio for this track.
      notes.push(`surge track "${track.id}": no notes — rendered silent`)
      tracks.push(silentSurgeHostTrack(track))
      continue
    }
    renders.push(render)
    notes.push(render.note)
    if (!media.some((m) => m.id === render.sampleId)) media.push({ id: render.sampleId, sha256: render.sha256, path: render.relPath })
    tracks.push(surgeSampleHostTrack(track, render.sampleId))
  }
  notes.unshift(...(held.resolver?.warnings ?? []))
  return { doc: { ...doc, media, tracks }, renders, notes, isSurge: true }
}

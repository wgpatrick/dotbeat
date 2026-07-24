// Track 1a: the surge render prep step — turns a .beat with `surge` tracks into one the engine can
// play, BEFORE the engine boots (cli/render.mjs calls this from bootRenderSession). Per surge
// track: convert its notes to the sidecar note-list, render (or reuse a cached) WAV through
// python/surge_render.py keyed by a content hash of (patch, overrides, notes, sampleRate), and
// rewrite the track in-memory as a drums-kind SAMPLE host that plays that WAV through the track's
// own synth production block + effect/send chain (the surgeplus hosting mechanism, promoted from
// eval trick to engine feature — see src/taste/showdown.ts buildSurgeSampleHost and D23).
//
// Determinism/provenance (the `beat regen` discipline): same doc -> same audio. The WAV is cached
// next to the project under media/ with a `.json` provenance sidecar (patch, overrides, hash,
// sampleRate, notes); a cache hit (matching hash) skips the sidecar entirely. GPL stays
// out-of-process: nothing here links Surge — it spawns the sidecar exactly like the eval path.
//
// v1 honest limitations (docs/surge-track.md): only TRACK-LEVEL notes render (a surge track's
// clips/scenes/song arrangement is deferred); the host plays the whole rendered phrase once per
// loop; a knob edit re-renders on the next render (no live re-synthesis).

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const round4 = (x) => Math.round(x * 10000) / 10000

// BeatNote[] (pitch / step start / step duration / 0..1 velocity) -> the sidecar's absolute-time
// note list, the exact math src/taste/showdown.ts composedPhraseToSurgeNotes uses. Sorted so the
// content hash is stable regardless of the document's note order.
function notesToSurge(notes, bpm) {
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

// The neutral voice-shaping the drums-kind sample host needs so the FULL multi-second surge render
// plays through, gated only by the buffer end (a flat amp envelope + wide-open filter) — exactly
// surgeSampleHostText's values. Everything else on the surge track's synth block (volume, pan,
// sends, eq/comp/saturator/... — the production the format's synth block carries) is preserved.
const NEUTRAL_HOST_VOICE = { osc: 'triangle', cutoff: 18000, resonance: 0, attack: 0.001, decay: 0, sustain: 1, release: 0.05 }

/** Resolve the repo root from this file (cli/ -> repo root is one up). */
const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..')

/**
 * If `beatPath` has any `surge` tracks, render each and return a rewritten scratch .beat path the
 * engine can play (drums-kind sample hosts); otherwise return the original path unchanged. Throws
 * on a surge render failure (surgepy/patch unavailable) — the fail-loudly-at-render contract.
 *
 * Returns { beatPath, isSurge, cleanup, info } — `cleanup()` removes the scratch (best-effort),
 * `info` is a short human summary of what rendered/cached (printed by the caller on stderr).
 */
export async function prepareSurgeTracks(beatPath) {
  const { parse, serialize } = await import(pathToFileURL(join(repoRoot, 'dist/src/core/index.js')).href)
  const originalText = readFileSync(beatPath, 'utf8')
  const doc = parse(originalText)
  const surgeTracks = doc.tracks.filter((t) => t.kind === 'surge')
  if (surgeTracks.length === 0) return { beatPath, isSurge: false, cleanup: () => {}, info: null }

  const { runSurgeRender, listSurgePatches, BeatSurgeError } = await import(pathToFileURL(join(repoRoot, 'dist/src/analysis/surge.js')).href)

  // Resolve every surge track's patch NAME to a factory .fxp path via the catalogue (the sidecar's
  // render request wants a path). This is the render-time surgepy/patch check: listSurgePatches
  // throws BeatSurgeError when surgepy is missing, and an unknown patch name is a loud error here —
  // exactly the "fails loudly when surgepy/patch unavailable AT RENDER, not at parse" contract.
  let catalogue
  try {
    catalogue = await listSurgePatches()
  } catch (err) {
    const msg = err instanceof BeatSurgeError ? err.message : String(err && err.message ? err.message : err)
    throw new Error(`surge render prep failed (cannot list Surge factory patches): ${msg}`)
  }
  const byName = new Map()
  for (const p of catalogue) {
    const key = p.name.toLowerCase()
    // deterministic on name collisions across categories: keep the first by (category, name) —
    // listSurgePatches already returns them sorted that way.
    if (!byName.has(key)) byName.set(key, p.path)
  }
  const resolvePatchPath = (name) => {
    const hit = byName.get(name.toLowerCase())
    if (!hit) {
      const near = catalogue.map((p) => p.name).filter((n) => n.toLowerCase().includes(name.toLowerCase())).slice(0, 5)
      throw new Error(`surge render prep: patch "${name}" not found in the factory catalogue (${catalogue.length} patches)${near.length ? `; did you mean: ${near.join(', ')}` : ''}. List names with \`beat surge patches\`.`)
    }
    return hit
  }

  const projectDir = dirname(beatPath)
  const mediaDir = join(projectDir, 'media')
  const notes = []

  // Build the rewritten doc: extra media entries + each surge track replaced by its drums host.
  const media = [...doc.media]
  const tracks = []
  for (const track of doc.tracks) {
    if (track.kind !== 'surge') {
      tracks.push(track)
      continue
    }
    const surge = track.surge
    const surgeNotes = notesToSurge(track.notes, doc.bpm)
    if (surgeNotes.length === 0) {
      // No notes -> nothing to synthesize. Desugar to a silent drums host (no lane/hit) so the doc
      // still loads and the render simply carries no surge audio for this track.
      notes.push(`surge track "${track.id}": no notes — rendered silent`)
      tracks.push(silentHost(track))
      continue
    }
    const overrides = [...surge.overrides].sort((a, b) => a.param.localeCompare(b.param)).map((o) => ({ param: o.param, value: o.value }))
    const keyObj = { patch: surge.patch, overrides, notes: surgeNotes, sampleRate: surge.sampleRate }
    const hash = createHash('sha256').update(JSON.stringify(keyObj)).digest('hex')
    const short = hash.slice(0, 12)
    const sampleId = `surge_${sanitizeId(track.id)}_${short}`
    const wavName = `${sampleId}.wav`
    const wavPath = join(mediaDir, wavName)
    const provPath = `${wavPath}.json`
    const relPath = `media/${wavName}`

    let cached = false
    if (existsSync(wavPath) && existsSync(provPath)) {
      try {
        const prov = JSON.parse(readFileSync(provPath, 'utf8'))
        if (prov.hash === hash) cached = true
      } catch {
        /* unreadable sidecar -> re-render */
      }
    }

    if (!cached) {
      mkdirSync(mediaDir, { recursive: true })
      const { meta } = await runSurgeRender({ patch: resolvePatchPath(surge.patch), notes: surgeNotes, sampleRate: surge.sampleRate, outPath: wavPath, overrides })
      const prov = {
        generator: 'surge-render (Track 1a)',
        track: track.id,
        patch: surge.patch,
        resolvedPatch: meta.patch,
        appliedOverrides: meta.overrides,
        overrides,
        sampleRate: surge.sampleRate,
        notes: surgeNotes.length,
        seconds: meta.seconds,
        hash,
        generatedAt: new Date().toISOString(),
      }
      writeFileSync(provPath, JSON.stringify(prov, null, 2) + '\n')
      notes.push(`surge track "${track.id}": rendered "${surge.patch}" -> ${relPath} (${meta.seconds}s${meta.overrides.length ? `, overrides: ${meta.overrides.join(', ')}` : ''})`)
    } else {
      notes.push(`surge track "${track.id}": cache hit "${surge.patch}" -> ${relPath}`)
    }

    const sha256 = createHash('sha256').update(readFileSync(wavPath)).digest('hex')
    if (!media.some((m) => m.id === sampleId)) media.push({ id: sampleId, sha256, path: relPath })
    tracks.push(sampleHost(track, sampleId))
  }

  const rewritten = { ...doc, media, tracks }
  const scratchPath = join(projectDir, `.render-surge.${basename(beatPath)}`)
  writeFileSync(scratchPath, serialize(rewritten))
  return {
    beatPath: scratchPath,
    isSurge: true,
    cleanup: () => {
      try { if (existsSync(scratchPath)) rmSync(scratchPath) } catch { /* best-effort */ }
    },
    info: notes.join('\n'),
  }
}

function sanitizeId(id) {
  return id.replace(/[^A-Za-z0-9_-]/g, '_')
}

// The drums-kind sample host: the surge track's production (synth block + effects + groove) with a
// neutral voice envelope/filter, one sample lane backed by the render, and one hit at step 0.
function sampleHost(track, sampleId) {
  return {
    ...track,
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

// A surge track with no notes -> a silent drums host (loads, carries no audio).
function silentHost(track) {
  return { ...track, kind: 'drums', surge: undefined, synth: { ...track.synth, ...NEUTRAL_HOST_VOICE }, laneSamples: {}, lanes: [], clips: [], notes: [], hits: [] }
}

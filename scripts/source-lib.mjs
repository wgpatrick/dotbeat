// `beat source` backend (Phase 37 Stream RD, docs/phase-37-plan.md §RD).
//
// Wires the Freesound CC0 pipeline + the shared one-shot prep into the taste loop as first-class
// `beat source search` / `beat source add` operations (and their beat_source_* MCP twins). One
// library, imported by BOTH the .mjs CLI and the compiled MCP server via runtime dynamic import,
// so there is exactly one implementation of "find/ingest a real sound and register it as media".
//
// Two paths, deliberately split by licensing and by network reality:
//   - OFFLINE (always available): addLocalSource() ingests a file you already have — prep it
//     through the same trim/fade/normalize pipeline as every bundled one-shot, register it into
//     the .beat media block, and write an ENFORCED provenance sidecar. Default license is
//     "unspecified" (you assert the license, we don't guess it).
//   - GATED (needs FREESOUND_API_KEY + network egress to freesound.org): freesoundSearchCC0() and
//     addFreesoundSource() reach the Freesound APIv2, HARD-FILTERED to Creative Commons 0 (the
//     only redistributable subset, research 07). The "CC0-1.0" license label is applied ONLY on
//     this path. If the key is missing OR egress is blocked, both fail with an actionable,
//     stack-trace-free SourceError telling you exactly which and what to do instead.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
// Core edit primitives — same compiled module the CLI and MCP already import, resolved relative to
// THIS file so both callers get the identical implementation regardless of their own cwd.
const { parse, serialize, setMediaSample } = await import(pathToFileURL(join(scriptsDir, '..', 'dist', 'src', 'core', 'index.js')).href)
const { decodeWav } = await import(pathToFileURL(join(scriptsDir, '..', 'dist', 'src', 'metrics', 'index.js')).href)
const { prepOneshot, PrepError, decodeViaWebAudio } = await import(pathToFileURL(join(scriptsDir, 'prep-oneshot-lib.mjs')).href)
// Phase 39 Stream UB: the generative sidecar wrapper (spawns python/gen.py). Same dist-relative
// import shape as core above, so the CLI and MCP get the identical compiled implementation.
const { runGen } = await import(pathToFileURL(join(scriptsDir, '..', 'dist', 'src', 'analysis', 'index.js')).href)

// Offline decode strategy: a local .wav is decoded by the pure-JS metrics decoder (16-bit PCM /
// 32-bit float, zero deps — always available), so ingesting audio you already have never needs the
// native node-web-audio-api decoder. Any other container (mp3/flac/aiff — e.g. a Freesound preview)
// falls back to node-web-audio-api, which the gated network path implies anyway.
async function decodeSource(inPath) {
  if (/\.wav$/i.test(inPath)) {
    const { sampleRate, channels } = decodeWav(readFileSync(inPath))
    return { sampleRate, channels }
  }
  return decodeViaWebAudio(inPath)
}

const CC0_URL = 'http://creativecommons.org/publicdomain/zero/1.0/'

export class SourceError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SourceError'
  }
}

const NO_KEY_MSG =
  'Freesound needs an API key: set FREESOUND_API_KEY in the environment ' +
  '(get one free at freesound.org/apiv2/apply). Only CC0 (public-domain) sounds are ever fetched. ' +
  'To ingest a file you already have instead, use: beat source add <file.beat> <id> <local-audio-file>'

const egressMsg = (err) =>
  `Freesound is unreachable from this environment — network egress to freesound.org appears to be ` +
  `blocked (${err instanceof Error ? err.message : String(err)}). The offline path still works: ` +
  `beat source add <file.beat> <id> <local-audio-file> ingests a file you already have.`

/** Search Freesound APIv2, hard-filtered to CC0, sorted by rating. GATED: throws SourceError if
 * the key is missing (checked first) or egress is blocked. Returns a normalized result list —
 * download is a separate step (addFreesoundSource). `fetchImpl` is injectable for testing. */
export async function freesoundSearchCC0({ query, max = 10, durMin = 0.05, durMax = 5, key = process.env.FREESOUND_API_KEY, fetchImpl = fetch } = {}) {
  if (!query || typeof query !== 'string') throw new SourceError('source search needs a <query>, e.g. beat source search "vinyl crackle"')
  if (!key) throw new SourceError(NO_KEY_MSG)
  const filter = `license:"Creative Commons 0" duration:[${durMin} TO ${durMax}]`
  const fields = 'id,name,username,license,duration,type,avg_rating,num_ratings,previews,url'
  const url =
    `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(query)}` +
    `&filter=${encodeURIComponent(filter)}&fields=${fields}&sort=rating_desc&page_size=${Math.min(Math.max(max, 1) * 3, 50)}&token=${key}`
  let res
  try {
    res = await fetchImpl(url)
  } catch (err) {
    throw new SourceError(egressMsg(err))
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new SourceError(`Freesound search failed: HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}`)
  }
  const data = await res.json()
  const results = []
  for (const s of data.results ?? []) {
    if (results.length >= max) break
    // never trust the filter alone — re-verify the exact CC0 URL on each hit
    if (s.license !== CC0_URL) continue
    results.push({ id: s.id, name: s.name, by: s.username, duration: s.duration, rating: s.avg_rating, numRatings: s.num_ratings, url: s.url, previewUrl: s.previews?.['preview-hq-mp3'] ?? null })
  }
  return { query, filter, total: data.count ?? results.length, results }
}

/** Optional auditioning step for `beat source search --out-dir`: download each result's HQ mp3
 * preview into outDir (no prep — raw audition material). GATED (needs egress); throws an actionable
 * SourceError if a fetch fails. Returns the list of saved file paths. */
export async function downloadPreviews({ results, outDir, fetchImpl = fetch }) {
  mkdirSync(outDir, { recursive: true })
  const saved = []
  for (const r of results) {
    if (!r.previewUrl) continue
    const dest = join(outDir, `fs${r.id}.mp3`)
    try {
      const res = await fetchImpl(r.previewUrl)
      if (!res.ok) throw new SourceError(`preview fetch for #${r.id} failed: HTTP ${res.status}`)
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
    } catch (err) {
      if (err instanceof SourceError) throw err
      throw new SourceError(egressMsg(err))
    }
    saved.push(dest)
  }
  return saved
}

/** Resolve + validate the target .beat file and prepare the media/ dir beside it. */
function resolveTarget(beatFile, id) {
  if (!beatFile) throw new SourceError('source add needs a <file.beat>')
  if (!id) throw new SourceError('source add needs a <sample-id>')
  if (!existsSync(beatFile)) throw new SourceError(`no .beat file at ${beatFile}`)
  const beatDir = dirname(resolve(beatFile))
  const mediaDir = join(beatDir, 'media')
  const relPath = `media/${id}.wav`
  const outPath = join(mediaDir, `${id}.wav`)
  return { beatDir, mediaDir, relPath, outPath }
}

/** Prep an already-decoded/downloaded local file, write the ENFORCED sidecar, and register it into
 * the .beat media block. Shared tail of both the offline and Freesound paths. */
async function ingest({ beatFile, id, inPath, license, source, query, extra }) {
  const { mediaDir, relPath, outPath } = resolveTarget(beatFile, id)
  mkdirSync(mediaDir, { recursive: true })
  let sha256, durationSeconds
  try {
    ;({ sha256, durationSeconds } = await prepOneshot({ inPath, outPath, license, source, writeSidecar: false, decode: decodeSource }))
  } catch (err) {
    if (err instanceof PrepError) throw new SourceError(err.message)
    throw err
  }
  // ENFORCED provenance sidecar — media/<id>.wav.json. addLocalSource is contractually not
  // "done" unless this lands, so a failure to write it is a hard SourceError (not a warning).
  const sidecarPath = outPath + '.json'
  const sidecar = { source, license, query: query ?? null, sha256, preparedAt: new Date().toISOString(), durationSeconds, ...(extra ?? {}) }
  try {
    writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n')
  } catch (err) {
    // roll back the prepped WAV so we never register media without its enforced provenance
    try { rmSync(outPath) } catch { /* best-effort */ }
    throw new SourceError(`could not write the required provenance sidecar ${sidecarPath}: ${err instanceof Error ? err.message : String(err)}`)
  }
  let before, doc
  try {
    before = parse(readFileSync(beatFile, 'utf8'))
  } catch (err) {
    throw new SourceError(`could not parse ${beatFile}: ${err instanceof Error ? err.message : String(err)}`)
  }
  // Re-registration note: registering an id already present in the media block silently REPLACES
  // it (setMediaSample is an upsert). Pilot 104 flagged that silence as surprising — surface it.
  // Detected BEFORE the upsert, reported through the return value so each surface (CLI stdout, MCP
  // result string) can print it without this shared library ever writing to stdout (which would
  // corrupt the MCP stdio JSON-RPC channel).
  const existing = before.media.find((m) => m.id === id)
  const reregistered = existing
    ? { changed: existing.sha256 !== sha256, previousSha256: existing.sha256 }
    : null
  doc = setMediaSample(before, id, sha256, relPath)
  writeFileSync(beatFile, serialize(doc))
  return { id, sha256, relPath, sidecarPath, durationSeconds, license, source, reregistered }
}

/** OFFLINE path: ingest a local audio file you already have. License defaults to "unspecified"
 * (the caller asserts a real license via --license; we never guess). Always available — no key,
 * no network. */
export async function addLocalSource({ beatFile, id, audioFile, license = 'unspecified', note } = {}) {
  if (!audioFile) throw new SourceError('source add needs a <local-audio-file> (or --freesound <id> for the gated Freesound path)')
  if (!existsSync(audioFile)) throw new SourceError(`no audio file at ${audioFile}`)
  const source = note ? `local file ${basename(audioFile)} — ${note}` : `local file ${basename(audioFile)}`
  return ingest({ beatFile, id, inPath: audioFile, license, source, query: null, extra: note ? { note } : undefined })
}

// ==== Phase 39 Stream UB begin ====
/** GENERATIVE path: text-to-audio one-shot via the Stable Audio Open sidecar (python/gen.py),
 * prepped + registered through the exact same `ingest()` tail as the offline/Freesound paths — so
 * normalization, sha256/duration, media registration, the ENFORCED provenance sidecar
 * media/<id>.wav.json, and rollback-on-failure all come for free. Generates to a temp
 * media/.<id>.gen.wav, ingests it, and removes the temp file in a finally. The default `stableaudio`
 * backend needs torch + the model owner-side; `stub` runs everywhere (deterministic tone bed).
 * Wraps gen failures as SourceError, matching the PrepError→SourceError pattern in ingest(). */
export async function addGeneratedSource({ beatFile, id, prompt, seconds = 2, seed, backend = 'stableaudio', provider = 'stable-audio-open', model, license } = {}) {
  if (!prompt || typeof prompt !== 'string') throw new SourceError('source gen needs a <prompt>, e.g. beat source gen song.beat pad "warm analog pad"')
  const { mediaDir } = resolveTarget(beatFile, id)
  mkdirSync(mediaDir, { recursive: true })
  // A seed is required for reproducible provenance; default to a deterministic value if unset so the
  // stub path (and the recorded seed) are stable, but let callers pin their own.
  const effectiveSeed = seed ?? 0
  const tempWav = join(mediaDir, `.${id}.gen.wav`)
  try {
    let meta
    try {
      ;({ meta } = await runGen({ prompt, seconds, seed: effectiveSeed, backend, outPath: tempWav }))
    } catch (err) {
      // BeatGenError (or anything the sidecar wrapper throws) → a clean, stack-trace-free SourceError.
      throw new SourceError(err instanceof Error ? err.message : String(err))
    }
    const resolvedProvider = meta?.provider || provider
    const resolvedModel = model ?? meta?.model ?? null
    return await ingest({
      beatFile,
      id,
      inPath: tempWav,
      license: license ?? 'Stability-AI-Community',
      source: `generated:${resolvedProvider}`,
      query: prompt,
      extra: {
        generated: {
          provider: resolvedProvider,
          model: resolvedModel,
          backend: meta?.backend ?? backend,
          prompt,
          seconds,
          seed: effectiveSeed,
          licenseUrl: 'https://stability.ai/community-license-agreement',
        },
      },
    })
  } finally {
    try { rmSync(tempWav) } catch { /* best-effort */ }
  }
}
// ==== Phase 39 Stream UB end ====

/** GATED path: fetch a specific CC0 sound from Freesound by id, prep it, and register it with the
 * "CC0-1.0" license label. Throws an actionable SourceError if the key is missing or egress is
 * blocked. `fetchImpl` is injectable for testing. */
export async function addFreesoundSource({ beatFile, id, freesoundId, note, key = process.env.FREESOUND_API_KEY, fetchImpl = fetch } = {}) {
  if (!freesoundId) throw new SourceError('--freesound needs a Freesound sound id')
  if (!key) throw new SourceError(NO_KEY_MSG)
  const fields = 'id,name,username,license,duration,type,previews,url'
  const metaUrl = `https://freesound.org/apiv2/sounds/${encodeURIComponent(freesoundId)}/?fields=${fields}&token=${key}`
  let meta
  try {
    const res = await fetchImpl(metaUrl)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new SourceError(`Freesound lookup of #${freesoundId} failed: HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}`)
    }
    meta = await res.json()
  } catch (err) {
    if (err instanceof SourceError) throw err
    throw new SourceError(egressMsg(err))
  }
  if (meta.license !== CC0_URL) {
    throw new SourceError(`Freesound #${freesoundId} is not CC0 (license: ${meta.license}). Only public-domain CC0 sounds are ingestable — pick a CC0 result from beat source search.`)
  }
  const preview = meta.previews?.['preview-hq-mp3']
  if (!preview) throw new SourceError(`Freesound #${freesoundId} has no preview to fetch`)
  const { mediaDir } = resolveTarget(beatFile, id)
  mkdirSync(mediaDir, { recursive: true })
  const rawPath = join(mediaDir, `.${id}.download.mp3`)
  try {
    const audio = await fetchImpl(preview)
    if (!audio.ok) throw new SourceError(`Freesound preview fetch for #${freesoundId} failed: HTTP ${audio.status}`)
    writeFileSync(rawPath, Buffer.from(await audio.arrayBuffer()))
  } catch (err) {
    if (err instanceof SourceError) throw err
    throw new SourceError(egressMsg(err))
  }
  try {
    const source =
      `Freesound #${meta.id} "${meta.name}" by ${meta.username} (${meta.url}); license verified ${meta.license}; ` +
      `preview-hq-mp3 quality tier${note ? ` — ${note}` : ''}`
    return await ingest({
      beatFile,
      id,
      inPath: rawPath,
      license: 'CC0-1.0',
      source,
      query: `freesound:${meta.id}`,
      extra: { freesound: { id: meta.id, name: meta.name, username: meta.username, url: meta.url, licenseUrl: meta.license, qualityTier: 'preview-hq-mp3' } },
    })
  } finally {
    try { rmSync(rawPath) } catch { /* best-effort */ }
  }
}

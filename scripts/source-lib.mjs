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

const scriptsDir = dirname(fileURLToPath(import.meta.url))
// Compiled modules — the same ones the CLI and MCP already import, resolved relative to THIS file
// so both callers get the identical implementation regardless of their own cwd.
const { decodeWav } = await import(pathToFileURL(join(scriptsDir, '..', 'dist', 'src', 'metrics', 'index.js')).href)
// Phase 40 Stream VB: the REGISTER half of what used to be this file's private ingest() now lives
// in src/vary/batch.ts, because `beat adopt` is its second caller (a gen batch defers registration
// until a candidate wins) and adopt must stay synchronous on both surfaces. Importing it back here
// keeps ONE registration implementation — the split was meant to defer it, not to fork it.
const { registerPreppedMedia, writeGenBatch, defaultGenBatchDir } = await import(pathToFileURL(join(scriptsDir, '..', 'dist', 'src', 'vary', 'batch.js')).href)
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

/** Resolve + validate the target .beat file and prepare the media/ dir beside it. `outPath` must
 * stay in step with registerPreppedMedia's own media/<id>.wav convention (src/vary/batch.ts) —
 * ingest() passes this path in and relies on the two agreeing so the copy is skipped. */
function resolveTarget(beatFile, id) {
  if (!beatFile) throw new SourceError('source add needs a <file.beat>')
  if (!id) throw new SourceError('source add needs a <sample-id>')
  if (!existsSync(beatFile)) throw new SourceError(`no .beat file at ${beatFile}`)
  const beatDir = dirname(resolve(beatFile))
  const mediaDir = join(beatDir, 'media')
  const outPath = join(mediaDir, `${id}.wav`)
  return { beatDir, mediaDir, outPath }
}

// ---- the ingest split (Phase 40 Stream VB) ----------------------------------------------------
// ingest() used to be one indivisible step: prep the audio AND register it into the .beat. That
// made `beat source gen` register every sound it generated the instant it existed — which is how
// examples/recipe-song ended up carrying two LOSING snare candidates in its media block forever,
// with no record that an audition ever happened. Generation's natural workflow is "same prompt, N
// seeds, rank them, adopt the winner", and that requires the two halves to happen at DIFFERENT
// TIMES:
//
//   prepCandidate()      -- at BATCH time, once per candidate. Trim/fade/normalize to a real wav
//                           and hash it. Candidates are auditioned exactly as they will sound,
//                           because these are the exact bytes adopt will register (prep is NOT
//                           idempotent — re-prepping a prepped file re-trims and re-fades it — so
//                           the winner is COPIED at adopt, never re-prepped).
//   registerPreppedMedia -- at ADOPT time, on the winner ALONE (src/vary/batch.ts, imported above).
//
// The single-shot paths (source add / source gen without --count) simply do both back-to-back, in
// ingest() below, and are unchanged in behavior. Losing candidates leave no trace outside the
// batch dir.

/** PREP half: trim/fade/peak-normalize `inPath` to `outPath` and return the provenance facts.
 * Writes no sidecar and touches no .beat — that is registerPreppedMedia's job, whenever it runs. */
async function prepCandidate({ inPath, outPath, license, source, query, extra }) {
  let sha256, durationSeconds
  try {
    ;({ sha256, durationSeconds } = await prepOneshot({ inPath, outPath, license, source, writeSidecar: false, decode: decodeSource }))
  } catch (err) {
    if (err instanceof PrepError) throw new SourceError(err.message)
    throw err
  }
  // The ENFORCED provenance sidecar's content — media/<id>.wav.json. Built here, next to the prep
  // that produced the facts it records, and written by registerPreppedMedia; for a batch candidate
  // it rides in the manifest until (and only if) that candidate wins.
  const sidecar = { source, license, query: query ?? null, sha256, preparedAt: new Date().toISOString(), durationSeconds, ...(extra ?? {}) }
  return { sha256, durationSeconds, sidecar }
}

/** Prep an already-decoded/downloaded local file, write the ENFORCED sidecar, and register it into
 * the .beat media block. Shared tail of the offline, Freesound, and single-shot generative paths:
 * the two halves above, run back-to-back, prepping straight into media/<id>.wav. */
async function ingest({ beatFile, id, inPath, license, source, query, extra }) {
  const { mediaDir, outPath } = resolveTarget(beatFile, id)
  mkdirSync(mediaDir, { recursive: true })
  const { sha256, durationSeconds, sidecar } = await prepCandidate({ inPath, outPath, license, source, query, extra })
  try {
    // outPath IS media/<id>.wav, so registerPreppedMedia skips its copy and this stays exactly the
    // sequence (sidecar-then-upsert, rollback on a failed sidecar) that ingest always ran.
    return registerPreppedMedia(beatFile, outPath, { id, sha256, durationSeconds, license, source, sidecar })
  } catch (err) {
    // BeatBatchError (or anything registration throws) -> a clean, stack-trace-free SourceError,
    // matching the PrepError->SourceError mapping above; the messages themselves are unchanged.
    if (err instanceof SourceError) throw err
    throw new SourceError(err instanceof Error ? err.message : String(err))
  }
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
  // A seed is required for reproducible provenance. When the caller doesn't pin one, DERIVE it from
  // the prompt (pilot 106 M1: a fixed default meant two different prompts produced byte-identical
  // output — a kit of one sound). A prompt-hash default keeps determinism (same prompt → same seed)
  // while making distinct prompts sound distinct out of the box; an explicit --seed still overrides.
  // (genSourceBatch defaults its --seed-from the same way, for the same reason.)
  const effectiveSeed = seed ?? promptSeed(prompt)
  const tempWav = join(mediaDir, `.${id}.gen.wav`)
  try {
    const { license: effectiveLicense, source, extra } = await generateRaw({ prompt, seconds, seed: effectiveSeed, backend, provider, model, license, outPath: tempWav })
    return await ingest({ beatFile, id, inPath: tempWav, license: effectiveLicense, source, query: prompt, extra })
  } finally {
    try { rmSync(tempWav) } catch { /* best-effort */ }
  }
}

/** Run the generator once into `outPath` and derive the provenance facts every gen path records.
 * Shared by the single-shot addGeneratedSource above and the batch below, so a candidate's
 * provenance is the same shape (and the same honest licensing call) either way. */
async function generateRaw({ prompt, seconds, seed, backend, provider, model, license, outPath }) {
  let meta
  try {
    ;({ meta } = await runGen({ prompt, seconds, seed, backend, provider, outPath }))
  } catch (err) {
    // BeatGenError (or anything the sidecar wrapper throws) → a clean, stack-trace-free SourceError.
    throw new SourceError(err instanceof Error ? err.message : String(err))
  }
  const resolvedProvider = meta?.provider || provider
  const resolvedModel = model ?? meta?.model ?? null
  // Honest licensing (pilot 106 M2): the stub is a stdlib tone no Stability model ever touched, so
  // it must NOT carry the Stability AI Community License or its URL — otherwise a tool keying off
  // the `license` field would treat a placeholder as licensed model output. Only a real model run
  // gets the Stability license (unless the caller asserted one explicitly).
  const resolvedBackend = meta?.backend ?? backend
  const isStub = resolvedBackend === 'stub'
  // Same honest-licensing rule, one more case: Stable Audio 2.5 over the fal API is governed by
  // Stability's platform/API terms, not the open-weights Community License — label it as such so
  // the sidecar never claims a license the audio doesn't have. fal's default provider is Stable
  // Audio OPEN (the same model the local backend runs), which keeps the Community License.
  const isPlatformModel = typeof resolvedProvider === 'string' && resolvedProvider.includes('stable-audio-25')
  return {
    license: license ?? (isStub ? 'stub-placeholder' : isPlatformModel ? 'Stability-Platform-Terms' : 'Stability-AI-Community'),
    source: `generated:${resolvedProvider}`,
    extra: {
      generated: {
        provider: resolvedProvider,
        model: resolvedModel,
        backend: resolvedBackend,
        prompt,
        seconds,
        seed,
        licenseUrl: isStub ? null : isPlatformModel ? 'https://stability.ai/terms-of-use' : 'https://stability.ai/community-license-agreement',
      },
    },
  }
}
// ==== Phase 39 Stream UB end ====

// ==== Phase 40 Stream VB begin ====
/** GENERATIVE BATCH: one prompt, N seeds, N candidates — the natural generative workflow, routed
 * into the taste loop (`beat score` / `beat adopt`) instead of around it.
 *
 * The whole point is what this does NOT do: it never touches `beatFile`. Each candidate is
 * generated to the batch dir, PREPPED there (so an audition hears exactly the bytes that would be
 * registered), and recorded in a manifest.json of the one shape `beat score`/`beat adopt` already
 * read (D21). Nothing enters the media block until `beat adopt <dir> <pick>` registers the winner —
 * ALONE. Losing candidates leave no trace outside the batch dir; deleting it forgets them.
 *
 * Seeds are `seedFrom .. seedFrom+count-1` — contiguous and recorded per candidate, so a winner is
 * reproducible from its provenance sidecar exactly like a single-shot generation is. */
export async function genSourceBatch({ beatFile, id, prompt, seconds = 2, seedFrom, count = 3, backend = 'stableaudio', provider = 'stable-audio-open', model, license, outDir, onProgress } = {}) {
  if (!prompt || typeof prompt !== 'string') throw new SourceError('source gen needs a <prompt>, e.g. beat source gen song.beat snare "tight acoustic snare" --count 3')
  if (!Number.isInteger(count) || count < 1) throw new SourceError(`source gen --count must be a positive integer, got ${count}`)
  if (count > 16) throw new SourceError(`source gen --count is capped at 16 (asked for ${count}) — ranking more candidates adds fatigue, not signal (the same Edisyn reasoning that caps score at 3 picks)`)
  // Validates the .beat exists and is reachable BEFORE spending minutes generating — but note it
  // deliberately does not mkdir media/: a batch that nobody adopts must leave the project alone.
  resolveTarget(beatFile, id)
  const parentText = readFileSync(beatFile, 'utf8')
  const baseSeed = seedFrom ?? promptSeed(prompt)
  if (!Number.isInteger(baseSeed)) throw new SourceError(`source gen --seed-from must be an integer, got ${seedFrom}`)
  const dir = outDir ?? defaultGenBatchDir(beatFile, id, baseSeed)
  mkdirSync(dir, { recursive: true })

  const variants = []
  for (let i = 0; i < count; i++) {
    const seed = baseSeed + i
    onProgress?.(i + 1, count, seed)
    const rawWav = join(dir, `.v${i + 1}.gen.wav`)
    const candidateWav = join(dir, `v${i + 1}.wav`)
    try {
      const { license: effectiveLicense, source, extra } = await generateRaw({ prompt, seconds, seed, backend, provider, model, license, outPath: rawWav })
      const { sha256, durationSeconds, sidecar } = await prepCandidate({ inPath: rawWav, outPath: candidateWav, license: effectiveLicense, source, query: prompt, extra })
      variants.push({ media: { id, sha256, durationSeconds, license: effectiveLicense, source, seed, sidecar } })
    } finally {
      try { rmSync(rawWav) } catch { /* best-effort */ }
    }
  }
  const manifest = writeGenBatch({ parentPath: beatFile, parentText, id, prompt, seed: baseSeed, outDir: dir, variants })
  return { dir, manifest, seedFrom: baseSeed, candidates: variants.map((v, i) => ({ variant: `v${i + 1}`, wav: join(dir, `v${i + 1}.wav`), ...v.media })) }
}
// ==== Phase 40 Stream VB end ====

// ==== Phase 39 Stream UB begin ====

/** Deterministic non-negative 31-bit seed derived from a prompt (djb2), so an unpinned
 * `beat source gen` varies by prompt instead of collapsing to one default sound. */
function promptSeed(prompt) {
  let h = 5381
  for (let i = 0; i < prompt.length; i++) h = (((h << 5) + h) ^ prompt.charCodeAt(i)) | 0
  return Math.abs(h)
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

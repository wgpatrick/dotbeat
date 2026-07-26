// `beat resample` — bounce ONE track's own output back into the project as a registered sample
// (research 142 §3.1, build item 4).
//
// WHY THIS IS THE MASTER KEY. The mined practitioner corpus ranks resampling #1 unprompted, across
// three independently sourced chains, and its reason is a definition rather than a technique:
// "the resample step is what converts 'a recording' into 'an instrument'." Two consequences the
// corpus states outright and dotbeat could not previously act on:
//
//   - "You can always shorten notes... but you can't lengthen them any further than the duration
//     of the original sample." Bounce LONG, trim short later; the other direction does not exist.
//   - A degradation chain (convolution -> tape -> vinyl -> bitcrush) is run BEFORE the bounce
//     specifically so it "can't be un-done or re-balanced later," and the result is then re-chopped.
//     Resample -> degrade -> re-chop -> re-play is presented as ONE pipeline, not three techniques.
//
// It is also the way OUT of the audio-track processing gap from the other direction: you cannot
// (well, now you can — see AUDIO_TRACK_FIELDS) process on the way out, but you can always process
// on the way IN, then commit.
//
// WHAT THIS MODULE IS. Glue between two things that already work, kept in `src/` rather than in
// `cli/beat.mjs` for the reason D21 states: the render itself lives in cli/render.mjs (it needs a
// browser), so this owns everything AROUND it — id minting, provenance, and the registration call
// — as one function any surface can import. The caller injects the render, so this file stays pure
// and testable with no harness (test/resample.test.ts drives it with a stub renderer).
//
// HONEST COST. A render is a ~10-15 s harness boot plus roughly realtime capture. Resampling is a
// deliberate act, not an inner-loop operation. "Nearly free" describes the code, not the clock.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { BeatDocument, BeatTrack } from '../core/index.js'
import { parse } from '../core/index.js'
import { BeatBatchError, registerPreppedMedia, type RegisterMediaResult, type VariantMedia } from './batch.js'

/** The provenance a bounce must record to be reproducible: WHAT was bounced, from WHICH document
 * state, and through WHICH chain. `beat regen`'s posture is the precedent — "a generated project
 * is a recipe, and the sidecar is the recipe" — so a resample sidecar records enough that you can
 * tell, months later, whether the .beat in front of you would still produce these bytes. */
export interface ResampleProvenance {
  /** The .beat this was bounced from, as given. */
  file: string
  /** sha256 of that file's BYTES at bounce time. The document is the recipe; this pins it. */
  docSha256: string
  trackId: string
  trackKind: string
  /** The track's ordered insert chain at bounce time — the corpus's whole point about committing
   * a degradation stack is that this list stops being editable, so it is recorded verbatim. */
  chain: { id: string; type: string; enabled: boolean }[]
  /** Render length in seconds (the whole project — dotbeat cannot render a range; `beat excerpt`
   * is the documented workaround, and it produces a different .beat, which this would then pin). */
  seconds: number
  renderedAt: string
  /** 'solo-render' today. Named so a future offline/range bounce is distinguishable in old
   * sidecars rather than silently conflated with this one. */
  method: 'solo-render'
}

export interface ResampleSidecar extends Record<string, unknown> {
  source: string
  license: string
  sha256: string
  preparedAt: string
  durationSeconds: number
  resampledFrom: ResampleProvenance
}

/** Render length of a whole project in seconds, the SAME rule cli/render.mjs uses (song bars when
 * there is a song block, else loopBars; 16 steps per bar at 4 steps per beat). Restated here so
 * the sidecar can record it without a second render. */
export function projectRenderSeconds(doc: BeatDocument): number {
  const bars = doc.song && doc.song.length > 0 ? doc.song.reduce((sum, s) => sum + s.bars, 0) : doc.loopBars
  return (bars * 16 * 60) / doc.bpm / 4
}

const SLUG_RE = /^[a-zA-Z0-9_-]+$/

/** Mint a free media id for a bounce of `trackId`: `<track>-resample`, then `-2`, `-3`, … The
 * default never silently REPLACES an existing sample — a second bounce of the same track is a new
 * take, not an overwrite. An explicit `--out <id>` may re-register (reported honestly by
 * registerPreppedMedia's `reregistered` field); that is the caller asking for it. */
export function mintResampleId(doc: BeatDocument, trackId: string): string {
  const base = `${trackId}-resample`
  if (!doc.media.some((m) => m.id === base)) return base
  let n = 2
  while (doc.media.some((m) => m.id === `${base}-${n}`)) n++
  return `${base}-${n}`
}

export interface ResampleOptions {
  /** Explicit media id for the result. Omitted = minted (see mintResampleId). */
  as?: string
  /** Asserted licence for the sidecar. Defaults to `unspecified`, the same "you assert it, we
   * don't guess it" posture as every other ingest path — though for a resample the honest reading
   * is usually "inherits whatever the source material's licence was," which is exactly why the
   * provenance names the document it came from. */
  license?: string
  /** ISO timestamp, injectable so tests are deterministic. */
  now?: string
}

/** Everything about a bounce EXCEPT the render itself, which the caller performs and passes in as
 * WAV bytes (see this file's header for why the split). Writes the wav + its enforced provenance
 * sidecar and registers the id in the document's media block, via the SAME `registerPreppedMedia`
 * primitive `beat source add` and `beat adopt` use — so a resample can never end up registered
 * without provenance (that rollback invariant is enforced there, not re-implemented here). */
export function registerResample(args: {
  beatFilePath: string
  trackId: string
  /** The rendered solo WAV bytes for `trackId`. */
  wavBytes: Uint8Array
  /** Where those bytes currently sit on disk (a scratch path is fine — it is copied in). */
  wavPath: string
  durationSeconds: number
  opts?: ResampleOptions
}): RegisterMediaResult & { id: string; provenance: ResampleProvenance } {
  const { beatFilePath, trackId, wavBytes, wavPath, durationSeconds } = args
  const opts = args.opts ?? {}

  const fileBytes = readFileSync(beatFilePath)
  const docSha256 = createHash('sha256').update(fileBytes).digest('hex')
  const doc = parse(fileBytes.toString('utf8'))
  const track: BeatTrack | undefined = doc.tracks.find((t) => t.id === trackId)
  if (!track) {
    throw new BeatBatchError(`no track "${trackId}" in ${beatFilePath} (have: ${doc.tracks.map((t) => t.id).join(', ') || 'none'})`)
  }

  const id = opts.as ?? mintResampleId(doc, trackId)
  if (!SLUG_RE.test(id)) throw new BeatBatchError(`sample ids are single alphanumeric/_/- tokens, got "${id}"`)

  const now = opts.now ?? new Date().toISOString()
  const provenance: ResampleProvenance = {
    file: beatFilePath,
    docSha256,
    trackId,
    trackKind: track.kind,
    chain: track.effects.map((e) => ({ id: e.id, type: e.type, enabled: e.enabled })),
    seconds: Number(projectRenderSeconds(doc).toFixed(4)),
    renderedAt: now,
    method: 'solo-render',
  }
  const sidecar: ResampleSidecar = {
    source: `resample of track "${trackId}" in ${beatFilePath} @ doc ${docSha256.slice(0, 12)}`,
    license: opts.license ?? 'unspecified',
    sha256: createHash('sha256').update(wavBytes).digest('hex'),
    preparedAt: now,
    durationSeconds: Number(durationSeconds.toFixed(6)),
    resampledFrom: provenance,
  }
  const media: VariantMedia = {
    id,
    sha256: sidecar.sha256,
    durationSeconds: sidecar.durationSeconds,
    license: sidecar.license,
    source: sidecar.source,
    sidecar,
  }
  return { ...registerPreppedMedia(beatFilePath, wavPath, media), id, provenance }
}

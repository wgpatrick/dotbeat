// The HOSTED generative backend (`--backend fal`) — the same `beat source gen` contract as the
// local stableaudio sidecar, but the model runs on fal.ai's GPUs instead of the owner's machine
// (research/107 Part 4 / the owner's ask: local generation is minutes per one-shot on CPU; the
// hosted path is seconds, a few cents each). Pure TS, no Python: one POST to fal's synchronous
// run endpoint, one download of the audio it returns.
//
// Provider = the fal model path. The default is Stable Audio 3 MEDIUM (the owner's "use a bigger
// model" ask, 2026-07-17): 1.4B params, up to ~6-minute stereo, trained on fully licensed data,
// outputs owned under the Stability Community License — the same licensing posture as the local
// Stable Audio Open backend, from a strictly stronger model. Alternatives via --provider:
// fal-ai/stable-audio (Stable Audio Open — the exact model the local backend runs) and
// fal-ai/stable-audio-25/text-to-audio (Stability 2.5; platform terms, not Community License —
// source-lib labels it honestly).
//
// Transport is injectable and defaults to curl: unlike Node's fetch, curl honors
// HTTPS_PROXY/CA-bundle env everywhere this runs (proxied agent containers AND the owner's
// machine), and tests inject a mock instead of the network.

import { readFileSync, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { BeatGenError, type GenMeta } from './gen.js'

export const FAL_DEFAULT_PROVIDER = 'fal-ai/stable-audio-3/medium/text-to-audio'

const FAL_KEY_HINT =
  'the fal backend needs an API key: export FAL_KEY=... (create one at https://fal.ai/dashboard/keys). ' +
  'Local alternative: --backend stableaudio (owner-side venv) or --backend stub'

const CURL_TIMEOUT_SECONDS = 300 // fal's sync endpoint can queue + generate for tens of seconds

/** One HTTP exchange the backend needs. `outPath` set → binary download to that path (bodyText
 * empty); otherwise bodyText carries the response body. Tests inject their own. */
export type FalTransport = (req: {
  method: 'POST' | 'GET'
  url: string
  headers: Record<string, string>
  body?: string
  outPath?: string
}) => Promise<{ status: number; bodyText: string }>

const curlTransport: FalTransport = (req) =>
  new Promise((resolvePromise, rejectPromise) => {
    const args = ['-sS', '--max-time', String(CURL_TIMEOUT_SECONDS), '-X', req.method, '-w', '\n%{http_code}']
    for (const [k, v] of Object.entries(req.headers)) args.push('-H', `${k}: ${v}`)
    if (req.body !== undefined) args.push('--data-binary', req.body)
    if (req.outPath !== undefined) args.push('-o', req.outPath)
    args.push(req.url)
    execFile('curl', args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) {
        rejectPromise(new BeatGenError(`fal request failed before an HTTP response: ${err.message.split('\n')[0]}`))
        return
      }
      // -w appends the status code as the final line; with -o the body went to disk and stdout is
      // just that trailer.
      const lines = String(stdout).split('\n')
      const status = Number(lines[lines.length - 1]!.trim() || '0')
      resolvePromise({ status, bodyText: lines.slice(0, -1).join('\n') })
    })
  })

/** Fish the generated-audio URL out of fal's response JSON — the field name varies by model
 * (audio_file for stable-audio, audio for some others), so accept the known shapes and fail
 * loudly with the JSON head when none match. */
export function extractAudioUrl(response: Record<string, unknown>): string | null {
  const candidates = [
    (response.audio_file as { url?: unknown } | undefined)?.url,
    (response.audio as { url?: unknown } | undefined)?.url,
    typeof response.audio === 'string' ? response.audio : undefined,
    response.audio_url,
    (response.output as { url?: unknown } | undefined)?.url,
  ]
  for (const c of candidates) if (typeof c === 'string' && c.startsWith('http')) return c
  return null
}

export interface RunGenFalOptions {
  prompt: string
  seconds: number
  seed: number
  provider?: string
  outPath: string
  transport?: FalTransport
  /** test hook — defaults to process.env.FAL_KEY / FAL_API_KEY */
  apiKey?: string
}

/** Generate one audio file via fal.ai into outPath and return the same GenMeta shape the local
 * sidecar produces, so scripts/source-lib.mjs's provenance/prep pipeline runs unchanged. */
export async function runGenFal(opts: RunGenFalOptions): Promise<GenMeta> {
  const provider = opts.provider ?? FAL_DEFAULT_PROVIDER
  const transport = opts.transport ?? curlTransport
  const apiKey = opts.apiKey ?? process.env.FAL_KEY ?? process.env.FAL_API_KEY
  if (!apiKey) throw new BeatGenError(FAL_KEY_HINT)
  if (!/^[\w-]+(\/[\w.-]+)+$/.test(provider)) {
    throw new BeatGenError(`--provider must be a fal model path like "${FAL_DEFAULT_PROVIDER}" or "fal-ai/stable-audio-25/text-to-audio", got "${provider}"`)
  }

  // Duration field names vary across the stable-audio family's fal endpoints: Open-era and 2.5
  // (fal-ai/stable-audio, fal-ai/stable-audio-25/...) take `seconds_total`; stable-audio-3/medium
  // takes `duration`. Critically, 3/medium SILENTLY IGNORES an unknown `seconds_total` (returns 200,
  // not 422) and falls back to its 30s default — so the old "seconds_total first, retry on 422"
  // logic never corrected it and every 3/medium one-shot came out ~30s (a 1s "kick" was 28s).
  // So choose the primary field by provider, and keep the 422 retry with the alias as a safety net
  // for any endpoint whose shape we guessed wrong.
  const primaryField: 'seconds_total' | 'duration' = /stable-audio-3/.test(provider) ? 'duration' : 'seconds_total'
  const aliasField: 'seconds_total' | 'duration' = primaryField === 'duration' ? 'seconds_total' : 'duration'
  //
  // output_format: "wav" — REQUEST WAV EXPLICITLY. The stable-audio-3/medium endpoint defaults to
  // mp3 (output_format accepts mp3/wav/flac/ogg/opus/m4a/aac), and dotbeat's prep pipeline only has
  // a zero-dep decoder for WAV (MP3 needs the native node-web-audio-api, absent in some checkouts).
  // WAV is lossless and universally decodable here, and prep normalizes to 16-bit WAV anyway, so we
  // always ask the source for WAV rather than round-tripping through a compressed container.
  // Endpoints that don't accept output_format ignore an unknown field (or 422, caught below).
  const postBody = (durationField: 'seconds_total' | 'duration') =>
    JSON.stringify({ prompt: opts.prompt, [durationField]: opts.seconds, seed: opts.seed, output_format: 'wav' })
  const postOnce = (body: string) =>
    transport({
      method: 'POST',
      url: `https://fal.run/${provider}`,
      headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
      body,
    })
  let post = await postOnce(postBody(primaryField))
  if (post.status === 422) {
    const retry = await postOnce(postBody(aliasField))
    if (retry.status !== 422) post = retry
  }
  if (post.status === 401 || post.status === 403) {
    throw new BeatGenError(`fal rejected the API key (HTTP ${post.status}) — check FAL_KEY. ${post.bodyText.slice(0, 200)}`)
  }
  if (post.status !== 200) {
    throw new BeatGenError(`fal ${provider} returned HTTP ${post.status}: ${post.bodyText.slice(0, 300) || '(no body)'}`)
  }
  let response: Record<string, unknown>
  try {
    response = JSON.parse(post.bodyText) as Record<string, unknown>
  } catch {
    throw new BeatGenError(`fal ${provider} returned non-JSON: ${post.bodyText.slice(0, 200)}`)
  }
  const audioUrl = extractAudioUrl(response)
  if (audioUrl === null) {
    throw new BeatGenError(`fal ${provider} response carried no audio URL — got keys [${Object.keys(response).join(', ')}]: ${post.bodyText.slice(0, 300)}`)
  }

  const download = await transport({ method: 'GET', url: audioUrl, headers: {}, outPath: opts.outPath })
  if (download.status !== 200 || !existsSync(opts.outPath)) {
    throw new BeatGenError(`downloading the generated audio failed (HTTP ${download.status}) from ${audioUrl}`)
  }
  // The download can be any container the prep pipeline can decode. dotbeat's prep decoder
  // (scripts/prep-oneshot-lib.mjs decodeViaWebAudio, via node-web-audio-api) handles WAV, AIFF,
  // FLAC and MP3 and resamples — and fal's stable-audio endpoints return MP3 — so we do NOT
  // require WAV here: prep re-decodes the download and normalizes it to a 16-bit 44.1kHz WAV a
  // step later, sniffing the real container from the bytes regardless of this file's name. Only
  // read a sample rate straight from a WAV header when the bytes actually are WAV; for anything
  // else, report the 44.1kHz rate prep normalizes every registered one-shot to.
  const head = readFileSync(opts.outPath).subarray(0, 12)
  const isWav = head.length >= 12 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WAVE'
  const sampleRate = isWav ? readFileSync(opts.outPath).readUInt32LE(24) : 44100

  return {
    backend: 'fal',
    provider,
    model: provider,
    seconds: opts.seconds,
    seed: opts.seed,
    sampleRate,
  }
}

/** Doctor fragment for `beat source gen --doctor`: is the hosted backend ready to use? Never
 * throws, never performs network I/O — key presence is the only local fact worth reporting. */
export function falDoctor(): Record<string, unknown> {
  const keyPresent = Boolean(process.env.FAL_KEY ?? process.env.FAL_API_KEY)
  return {
    fal: {
      available: keyPresent,
      keyPresent,
      defaultProvider: FAL_DEFAULT_PROVIDER,
      ...(keyPresent ? {} : { hint: FAL_KEY_HINT }),
    },
  }
}

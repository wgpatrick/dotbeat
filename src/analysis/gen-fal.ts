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

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { BeatGenError, type GenMeta } from './gen.js'
import { decodeWav } from '../metrics/wav.js'
import { downbeatAlignedTrim, encodeWav16 } from './gen-trim.js'

export const FAL_DEFAULT_PROVIDER = 'fal-ai/stable-audio-3/medium/text-to-audio'

// ---- Per-provider request/response adapter table (research/127 §4.2) --------------------------
// The stable-audio family speaks {prompt, duration|seconds_total, seed, output_format}. The three
// bake-off backends each want a DIFFERENT body — a leaderboard-model integration is a body mapping,
// not a new transport. Each adapter also carries the doc's rights verdict (watermark + whether the
// ToS bans training on outputs), which flows into GenMeta → the provenance sidecar → the taste
// holdout. `extractAudioUrl` already handles every response shape these return, so adapters only
// shape the REQUEST. Bodies use the EXACT fields documented in research/127; unknown fields 422 on
// fal, so we send only what each model's schema accepts.

interface ProviderAdapter {
  id: string
  match: (provider: string) => boolean
  /** Build the POST body. `durationField` is only consulted by the stable-audio adapter (the one
   * backend with a duration param whose field name varies + needs the 422 alias retry). */
  body: (o: { prompt: string; seconds: number; seed: number; negativePrompt?: string }, durationField: 'seconds_total' | 'duration') => Record<string, unknown>
  /** stable-audio only: retry once swapping duration↔seconds_total on a 422 schema rejection. */
  durationAliasRetry: boolean
  /** inaudible-but-mandatory mark documented for this provider (Google Lyria = SynthID). */
  watermark?: string
  /** provider ToS bans using outputs to train ML models → the taste-training holdout marker.
   * ElevenLabs categorical; MiniMax unknown-treat-as-banned (research/127 §3). */
  trainingExcluded?: boolean
}

/** research/127 §4.2 request shapes. Order matters: the stable-audio fallback matches last. */
const PROVIDER_ADAPTERS: ProviderAdapter[] = [
  {
    id: 'lyria2',
    match: (p) => /(^|\/)lyria2(\/|$)/.test(p),
    // Instrumental-by-design, native 48 kHz WAV, fixed ~30 s (no duration param). seed + optional
    // negative_prompt only. SynthID-watermarked (mandatory), trainable per the doc.
    body: (o) => ({ prompt: o.prompt, seed: o.seed, ...(o.negativePrompt ? { negative_prompt: o.negativePrompt } : {}) }),
    durationAliasRetry: false,
    watermark: 'synthid',
  },
  {
    id: 'minimax-music',
    match: (p) => /minimax-music/.test(p),
    // is_instrumental drops the lyrics requirement; audio_setting requests 44.1 kHz WAV. No
    // duration/seed param — output is a full track we downbeat-trim. API-tier ToS unverifiable →
    // treat training as banned (holdout tag) until read.
    body: (o) => ({ prompt: o.prompt, is_instrumental: true, audio_setting: { format: 'wav', sample_rate: 44100 } }),
    durationAliasRetry: false,
    trainingExcluded: true,
  },
  {
    id: 'elevenlabs-music',
    match: (p) => /elevenlabs\/music/.test(p),
    // The only native short-duration control in the field: music_length_ms with a 3000 ms FLOOR.
    // force_instrumental drops vocals. Categorical training ban → holdout tag mandatory.
    body: (o) => ({ prompt: o.prompt, music_length_ms: Math.max(3000, Math.round(o.seconds * 1000)), force_instrumental: true }),
    durationAliasRetry: false,
    trainingExcluded: true,
  },
  {
    id: 'stable-audio',
    match: () => true, // the incumbent + fallback: any unrecognized fal model path
    body: (o, durationField) => ({ prompt: o.prompt, [durationField]: o.seconds, seed: o.seed, output_format: 'wav' }),
    durationAliasRetry: true,
  },
]

export function providerAdapter(provider: string): ProviderAdapter {
  return PROVIDER_ADAPTERS.find((a) => a.match(provider))!
}

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
  /** lyria2 negative_prompt (ignored by the other adapters) */
  negativePrompt?: string
  /** When set with `bars`, and the download decodes as WAV, downbeat-align-trim the generation to
   * `bars` bars at this BPM (research/127 §4.2). The trimmed clip lands at outPath; the raw
   * untrimmed download is preserved at `rawOutPath` (or `<outPath>.raw.wav`). Off by default so
   * the existing one-shot/gen-batch callers are byte-unchanged — prep does its own duration match. */
  bpm?: number
  bars?: number
  rawOutPath?: string
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

  // Pick the provider adapter (research/127 §4.2). Its `body()` shapes the request; only the
  // stable-audio adapter carries a duration field (whose name varies) + the 422 alias retry.
  const adapter = providerAdapter(provider)
  //
  // Duration field names vary across the stable-audio family's fal endpoints: Open-era and 2.5
  // (fal-ai/stable-audio, fal-ai/stable-audio-25/...) take `seconds_total`; stable-audio-3/medium
  // takes `duration`. Critically, 3/medium SILENTLY IGNORES an unknown `seconds_total` (returns 200,
  // not 422) and falls back to its 30s default — so the old "seconds_total first, retry on 422"
  // logic never corrected it and every 3/medium one-shot came out ~30s (a 1s "kick" was 28s).
  // So choose the primary field by provider, and keep the 422 retry with the alias as a safety net
  // for any endpoint whose shape we guessed wrong.
  //
  // output_format: "wav" — the stable-audio adapter requests WAV explicitly (its endpoint defaults
  // to mp3, and dotbeat's zero-dep decoder only reads WAV). lyria2 emits WAV natively; minimax asks
  // for WAV via audio_setting; elevenlabs returns its default container (prep decodes it downstream).
  const primaryField: 'seconds_total' | 'duration' = /stable-audio-3/.test(provider) ? 'duration' : 'seconds_total'
  const aliasField: 'seconds_total' | 'duration' = primaryField === 'duration' ? 'seconds_total' : 'duration'
  const buildBody = (durationField: 'seconds_total' | 'duration') =>
    JSON.stringify(adapter.body({ prompt: opts.prompt, seconds: opts.seconds, seed: opts.seed, ...(opts.negativePrompt ? { negativePrompt: opts.negativePrompt } : {}) }, durationField))
  const postOnce = (body: string) =>
    transport({
      method: 'POST',
      url: `https://fal.run/${provider}`,
      headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
      body,
    })
  let post = await postOnce(buildBody(primaryField))
  if (post.status === 422 && adapter.durationAliasRetry) {
    const retry = await postOnce(buildBody(aliasField))
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
  let sampleRate = isWav ? readFileSync(opts.outPath).readUInt32LE(24) : 44100

  // Downbeat-aligned trim (research/127 §4.2, Part A2): when the caller asked for a bar-count trim
  // and the download is decodable WAV, cut it to `bars` bars at the prompted BPM starting on a
  // detected downbeat — Lyria's fixed 30 s and MiniMax's multi-minute track become a 4-bar loop
  // that begins on a strong beat, not a head-trimmed intro. The RAW download is preserved so the
  // decision is auditable and reversible. Non-WAV downloads (e.g. an mp3) skip trimming and fall
  // through to prep's own duration match, exactly as before.
  const trim: Pick<GenMeta, 'rawOutPath' | 'trimOffsetSeconds' | 'trimmedSeconds'> = {}
  if (isWav && opts.bpm !== undefined && opts.bars !== undefined) {
    try {
      const decoded = decodeWav(readFileSync(opts.outPath))
      const trimmed = downbeatAlignedTrim({ channels: decoded.channels, sampleRate: decoded.sampleRate }, { bpm: opts.bpm, bars: opts.bars })
      const rawOutPath = opts.rawOutPath ?? `${opts.outPath}.raw.wav`
      writeFileSync(rawOutPath, readFileSync(opts.outPath))
      writeFileSync(opts.outPath, encodeWav16(trimmed.channels, decoded.sampleRate))
      sampleRate = decoded.sampleRate
      trim.rawOutPath = rawOutPath
      trim.trimOffsetSeconds = Number(trimmed.offsetSeconds.toFixed(4))
      trim.trimmedSeconds = Number(trimmed.lengthSeconds.toFixed(4))
    } catch {
      /* undecodable / unexpected shape → leave the raw download in place, prep will handle it */
    }
  }

  return {
    backend: 'fal',
    provider,
    model: provider,
    seconds: opts.seconds,
    seed: opts.seed,
    sampleRate,
    ...(adapter.watermark !== undefined ? { watermark: adapter.watermark } : {}),
    ...(adapter.trainingExcluded ? { trainingExcluded: true } : {}),
    ...trim,
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

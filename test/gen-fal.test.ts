// The hosted (fal.ai) generative backend — transport is injected, so every branch runs without
// network: happy path (POST -> audio URL -> WAV download -> GenMeta), missing key, HTTP errors,
// non-JSON, missing audio URL, and the non-WAV guard the prep pipeline depends on.

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runGenFal, extractAudioUrl, falDoctor, FAL_DEFAULT_PROVIDER, type FalTransport } from '../src/analysis/gen-fal.js'
import { BeatGenError } from '../src/analysis/gen.js'

function tinyWav(sampleRate = 44100): Buffer {
  const frames = 64
  const data = Buffer.alloc(frames * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8, 'ascii')
  h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36, 'ascii'); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

/** A scripted transport: first call answers the POST, second serves the download. */
function mockTransport(opts: { postStatus?: number; postBody?: string; wav?: Buffer; downloadStatus?: number }): { transport: FalTransport; calls: { method: string; url: string; body?: string }[] } {
  const calls: { method: string; url: string; body?: string }[] = []
  const transport: FalTransport = async (req) => {
    calls.push({ method: req.method, url: req.url, body: req.body })
    if (req.method === 'POST') {
      return { status: opts.postStatus ?? 200, bodyText: opts.postBody ?? JSON.stringify({ audio_file: { url: 'https://cdn.fal.example/out.wav' } }) }
    }
    if ((opts.downloadStatus ?? 200) === 200 && req.outPath !== undefined) writeFileSync(req.outPath, opts.wav ?? tinyWav())
    return { status: opts.downloadStatus ?? 200, bodyText: '' }
  }
  return { transport, calls }
}

test('runGenFal happy path: POST body, download, WAV check, GenMeta contract', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fal-'))
  const out = join(dir, 'v1.wav')
  const { transport, calls } = mockTransport({ wav: tinyWav(48000) })
  const meta = await runGenFal({ prompt: 'a dusty snare', seconds: 2, seed: 7, outPath: out, transport, apiKey: 'k' })
  assert.equal(calls[0]!.method, 'POST')
  assert.equal(calls[0]!.url, `https://fal.run/${FAL_DEFAULT_PROVIDER}`)
  // stable-audio-3/medium (the default provider) takes `duration`, not `seconds_total` — sending
  // the wrong field is silently ignored by that endpoint and yields its 30s default (the one-shot
  // duration bug). The primary field is chosen by provider; see runGenFal.
  assert.deepEqual(JSON.parse(calls[0]!.body!), { prompt: 'a dusty snare', duration: 2, seed: 7, output_format: 'wav' })
  assert.equal(calls[1]!.method, 'GET')
  assert.deepEqual(meta, { backend: 'fal', provider: FAL_DEFAULT_PROVIDER, model: FAL_DEFAULT_PROVIDER, seconds: 2, seed: 7, sampleRate: 48000 })
})

test('runGenFal without a key fails with the FAL_KEY hint, before any network call', async () => {
  const { transport, calls } = mockTransport({})
  const saved = { key: process.env.FAL_KEY, alt: process.env.FAL_API_KEY }
  delete process.env.FAL_KEY
  delete process.env.FAL_API_KEY
  try {
    await assert.rejects(
      runGenFal({ prompt: 'x', seconds: 1, seed: 1, outPath: '/tmp/never.wav', transport }),
      /FAL_KEY/,
    )
  } finally {
    if (saved.key !== undefined) process.env.FAL_KEY = saved.key
    if (saved.alt !== undefined) process.env.FAL_API_KEY = saved.alt
  }
  assert.equal(calls.length, 0, 'no request went out without a key')
})

test('runGenFal surfaces HTTP errors, bad JSON, and missing audio URLs with the response head', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fal-err-'))
  const out = join(dir, 'v1.wav')
  await assert.rejects(
    runGenFal({ prompt: 'x', seconds: 1, seed: 1, outPath: out, transport: mockTransport({ postStatus: 403, postBody: 'nope' }).transport, apiKey: 'bad' }),
    /rejected the API key \(HTTP 403\)/,
  )
  await assert.rejects(
    runGenFal({ prompt: 'x', seconds: 1, seed: 1, outPath: out, transport: mockTransport({ postStatus: 422, postBody: '{"detail":"seconds_total too large"}' }).transport, apiKey: 'k' }),
    /HTTP 422.*seconds_total too large/s,
  )
  await assert.rejects(
    runGenFal({ prompt: 'x', seconds: 1, seed: 1, outPath: out, transport: mockTransport({ postBody: '<html>gateway</html>' }).transport, apiKey: 'k' }),
    /non-JSON/,
  )
  await assert.rejects(
    runGenFal({ prompt: 'x', seconds: 1, seed: 1, outPath: out, transport: mockTransport({ postBody: '{"queue_position": 3}' }).transport, apiKey: 'k' }),
    /no audio URL.*queue_position/s,
  )
})

test('runGenFal accepts a non-WAV (mp3) download — prep decodes it downstream — and reports 44.1kHz', async () => {
  // fal's stable-audio endpoints return MP3; the prep pipeline (node-web-audio-api) decodes it, so
  // runGenFal must pass the bytes through rather than reject them. It reports the 44.1kHz rate prep
  // normalizes every registered one-shot to, since a non-WAV header carries no readable rate here.
  const dir = mkdtempSync(join(tmpdir(), 'fal-mp3-'))
  const out = join(dir, 'v1.wav')
  const mp3ish = Buffer.from('ID3\x04not a wav at all, definitely an mp3 file')
  const { transport } = mockTransport({ wav: mp3ish })
  const meta = await runGenFal({ prompt: 'x', seconds: 1, seed: 1, outPath: out, transport, apiKey: 'k' })
  assert.equal(meta.sampleRate, 44100)
  assert.deepEqual(readFileSync(out), mp3ish) // the raw download is preserved for prep to decode
})

test('runGenFal validates provider shape and honors an explicit fal model path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fal-prov-'))
  const out = join(dir, 'v1.wav')
  await assert.rejects(
    runGenFal({ prompt: 'x', seconds: 1, seed: 1, provider: 'stable audio!!', outPath: out, transport: mockTransport({}).transport, apiKey: 'k' }),
    BeatGenError,
  )
  const { transport, calls } = mockTransport({})
  await runGenFal({ prompt: 'x', seconds: 1, seed: 1, provider: 'fal-ai/stable-audio-25/text-to-audio', outPath: out, transport, apiKey: 'k' })
  assert.equal(calls[0]!.url, 'https://fal.run/fal-ai/stable-audio-25/text-to-audio')
})

test('runGenFal retries a 422 schema rejection once with the alias duration field', async () => {
  // The default provider (stable-audio-3/medium) sends `duration` as its primary field. If that
  // endpoint 422s on it, runGenFal must retry ONCE with the alias (`seconds_total`) before failing.
  const dir = mkdtempSync(join(tmpdir(), 'fal-422-'))
  const out = join(dir, 'v1.wav')
  const calls: { body?: string; url: string }[] = []
  const transport: FalTransport = async (req) => {
    calls.push({ body: req.body, url: req.url })
    if (req.method === 'POST') {
      const body = JSON.parse(req.body!) as Record<string, unknown>
      if (body.duration !== undefined) return { status: 422, bodyText: '{"detail":[{"msg":"extra fields not permitted: duration"}]}' }
      return { status: 200, bodyText: JSON.stringify({ audio_file: { url: 'https://cdn.fal.example/out.wav' } }) }
    }
    if (req.outPath !== undefined) writeFileSync(req.outPath, tinyWav())
    return { status: 200, bodyText: '' }
  }
  const meta = await runGenFal({ prompt: 'x', seconds: 4, seed: 3, outPath: out, transport, apiKey: 'k' })
  assert.equal(meta.seconds, 4)
  assert.equal(calls.length, 3, 'POST, retry POST, download')
  assert.deepEqual(JSON.parse(calls[0]!.body!), { prompt: 'x', duration: 4, seed: 3, output_format: 'wav' }, 'primary field is duration for stable-audio-3')
  assert.deepEqual(JSON.parse(calls[1]!.body!), { prompt: 'x', seconds_total: 4, seed: 3, output_format: 'wav' }, 'retry swapped to the seconds_total alias')
})

test('runGenFal surfaces the API validation text when both duration shapes are rejected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fal-422x2-'))
  const { transport } = mockTransport({ postStatus: 422, postBody: '{"detail":"prompt too long"}' })
  await assert.rejects(
    runGenFal({ prompt: 'x', seconds: 1, seed: 1, outPath: join(dir, 'v1.wav'), transport, apiKey: 'k' }),
    /HTTP 422.*prompt too long/s,
  )
})

test('extractAudioUrl accepts the known response shapes and rejects junk', () => {
  assert.equal(extractAudioUrl({ audio_file: { url: 'https://a/x.wav' } }), 'https://a/x.wav')
  assert.equal(extractAudioUrl({ audio: { url: 'https://a/y.wav' } }), 'https://a/y.wav')
  assert.equal(extractAudioUrl({ audio: 'https://a/z.wav' }), 'https://a/z.wav')
  assert.equal(extractAudioUrl({ audio_url: 'https://a/q.wav' }), 'https://a/q.wav')
  assert.equal(extractAudioUrl({ output: { url: 'https://a/o.wav' } }), 'https://a/o.wav')
  assert.equal(extractAudioUrl({ status: 'ok' }), null)
  assert.equal(extractAudioUrl({ audio: 'not-a-url' }), null)
})

// ---- Per-provider adapter request shapes (research/127 §4.2, Part A1) --------------------------

test('lyria2 adapter: {prompt, seed} body, no duration/output_format, synthid watermark, trainable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fal-lyria-'))
  const out = join(dir, 'v1.wav')
  const { transport, calls } = mockTransport({ postBody: JSON.stringify({ audio: { url: 'https://cdn.fal.example/lyria.wav' } }) })
  const meta = await runGenFal({ prompt: 'a rolling deep house bassline, solo bassline only', seconds: 8, seed: 12, provider: 'fal-ai/lyria2', outPath: out, transport, apiKey: 'k' })
  assert.equal(calls[0]!.url, 'https://fal.run/fal-ai/lyria2')
  assert.deepEqual(JSON.parse(calls[0]!.body!), { prompt: 'a rolling deep house bassline, solo bassline only', seed: 12 })
  assert.equal(meta.watermark, 'synthid')
  assert.equal(meta.trainingExcluded, undefined) // Lyria stays trainable per the doc
})

test('lyria2 adapter includes negative_prompt only when provided', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fal-lyria-neg-'))
  const { transport, calls } = mockTransport({ postBody: JSON.stringify({ audio: { url: 'https://a/x.wav' } }) })
  await runGenFal({ prompt: 'p', seconds: 8, seed: 1, provider: 'fal-ai/lyria2', negativePrompt: 'no drums', outPath: join(dir, 'v.wav'), transport, apiKey: 'k' })
  assert.deepEqual(JSON.parse(calls[0]!.body!), { prompt: 'p', seed: 1, negative_prompt: 'no drums' })
})

test('minimax v2.6 adapter: is_instrumental + wav audio_setting, no duration/seed, training-excluded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fal-mmx-'))
  const out = join(dir, 'v1.wav')
  const { transport, calls } = mockTransport({ postBody: JSON.stringify({ audio: { url: 'https://cdn.fal.example/mmx.wav' } }) })
  const meta = await runGenFal({ prompt: 'a dark techno sub bassline, solo bassline only', seconds: 8, seed: 5, provider: 'fal-ai/minimax-music/v2.6', outPath: out, transport, apiKey: 'k' })
  assert.equal(calls[0]!.url, 'https://fal.run/fal-ai/minimax-music/v2.6')
  assert.deepEqual(JSON.parse(calls[0]!.body!), { prompt: 'a dark techno sub bassline, solo bassline only', is_instrumental: true, audio_setting: { format: 'wav', sample_rate: 44100 } })
  assert.equal(meta.trainingExcluded, true)
  assert.equal(meta.watermark, undefined)
})

test('elevenlabs/music adapter: music_length_ms (3s floor) + force_instrumental, training-excluded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fal-11-'))
  const { transport, calls } = mockTransport({ postBody: JSON.stringify({ audio: { url: 'https://a/e.wav' } }) })
  // 8 s -> 8000 ms
  const meta = await runGenFal({ prompt: 'a funky disco bassline, solo bassline only', seconds: 8, seed: 9, provider: 'fal-ai/elevenlabs/music', outPath: join(dir, 'v1.wav'), transport, apiKey: 'k' })
  assert.deepEqual(JSON.parse(calls[0]!.body!), { prompt: 'a funky disco bassline, solo bassline only', music_length_ms: 8000, force_instrumental: true })
  assert.equal(meta.trainingExcluded, true)
  // 1 s clamps UP to the 3000 ms floor
  const { transport: t2, calls: c2 } = mockTransport({ postBody: JSON.stringify({ audio: { url: 'https://a/e.wav' } }) })
  await runGenFal({ prompt: 'p', seconds: 1, seed: 9, provider: 'fal-ai/elevenlabs/music', outPath: join(dir, 'v2.wav'), transport: t2, apiKey: 'k' })
  assert.equal(JSON.parse(c2[0]!.body!).music_length_ms, 3000)
})

test('non-stable-audio adapters do NOT trigger the duration-alias 422 retry', async () => {
  // The alias retry swaps duration<->seconds_total, which is meaningless for lyria/minimax/11labs.
  // A 422 from those must surface immediately, not spawn a second POST.
  const dir = mkdtempSync(join(tmpdir(), 'fal-noretry-'))
  const { transport, calls } = mockTransport({ postStatus: 422, postBody: '{"detail":"bad prompt"}' })
  await assert.rejects(
    runGenFal({ prompt: 'p', seconds: 8, seed: 1, provider: 'fal-ai/lyria2', outPath: join(dir, 'v.wav'), transport, apiKey: 'k' }),
    /HTTP 422.*bad prompt/s,
  )
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1, 'exactly one POST — no alias retry')
})

test('runGenFal downbeat-trims a WAV when bpm+bars given, preserving the raw download', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fal-trim-'))
  const out = join(dir, 'v1.wav')
  // a 4 s 48 kHz mono WAV with a transient at ~0.5 s
  const sr = 48000, frames = 4 * sr
  const chData = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i++) {
    let s = Math.sin(i * 0.01) * 0.0005
    const rel = i - Math.round(0.5 * sr)
    if (rel >= 0 && rel < 200) s = 0.9 * Math.exp(-rel / 40)
    chData.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + chData.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(chData.length, 40)
  const bigWav = Buffer.concat([h, chData])
  const { transport } = mockTransport({ wav: bigWav })
  const meta = await runGenFal({ prompt: 'p', seconds: 2, seed: 1, provider: 'fal-ai/lyria2', bpm: 120, bars: 1, outPath: out, transport, apiKey: 'k' })
  // 1 bar @120 = 2 s of the original 4 s, trimmed at the transient
  assert.ok(meta.trimmedSeconds !== undefined && Math.abs(meta.trimmedSeconds - 2) < 0.02, `trimmed ~2s, got ${meta.trimmedSeconds}`)
  assert.ok(meta.trimOffsetSeconds !== undefined && Math.abs(meta.trimOffsetSeconds - 0.5) < 0.02, `offset ~0.5s, got ${meta.trimOffsetSeconds}`)
  assert.equal(meta.rawOutPath, `${out}.raw.wav`)
  const trimmedDur = readFileSync(out).readUInt32LE(40) / (sr * 2)
  assert.ok(Math.abs(trimmedDur - 2) < 0.02, 'the written file is the ~2s trimmed clip')
  const rawDur = readFileSync(`${out}.raw.wav`).readUInt32LE(40) / (sr * 2)
  assert.ok(Math.abs(rawDur - 4) < 0.02, 'the raw 4s download is preserved alongside')
})

test('falDoctor reports key presence without touching the network', () => {
  const saved = { key: process.env.FAL_KEY, alt: process.env.FAL_API_KEY }
  try {
    delete process.env.FAL_KEY
    delete process.env.FAL_API_KEY
    const absent = falDoctor().fal as Record<string, unknown>
    assert.equal(absent.available, false)
    assert.match(String(absent.hint), /FAL_KEY/)
    process.env.FAL_KEY = 'k'
    const present = falDoctor().fal as Record<string, unknown>
    assert.equal(present.available, true)
    assert.equal(present.defaultProvider, FAL_DEFAULT_PROVIDER)
  } finally {
    if (saved.key !== undefined) process.env.FAL_KEY = saved.key
    else delete process.env.FAL_KEY
    if (saved.alt !== undefined) process.env.FAL_API_KEY = saved.alt
  }
})

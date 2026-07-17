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
  assert.deepEqual(JSON.parse(calls[0]!.body!), { prompt: 'a dusty snare', seconds_total: 2, seed: 7, output_format: 'wav' })
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

test('runGenFal retries a 422 schema rejection once with the duration alias', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fal-422-'))
  const out = join(dir, 'v1.wav')
  const calls: { body?: string; url: string }[] = []
  const transport: FalTransport = async (req) => {
    calls.push({ body: req.body, url: req.url })
    if (req.method === 'POST') {
      const body = JSON.parse(req.body!) as Record<string, unknown>
      if (body.seconds_total !== undefined) return { status: 422, bodyText: '{"detail":[{"msg":"extra fields not permitted: seconds_total"}]}' }
      return { status: 200, bodyText: JSON.stringify({ audio_file: { url: 'https://cdn.fal.example/out.wav' } }) }
    }
    if (req.outPath !== undefined) writeFileSync(req.outPath, tinyWav())
    return { status: 200, bodyText: '' }
  }
  const meta = await runGenFal({ prompt: 'x', seconds: 4, seed: 3, outPath: out, transport, apiKey: 'k' })
  assert.equal(meta.seconds, 4)
  assert.equal(calls.length, 3, 'POST, retry POST, download')
  assert.deepEqual(JSON.parse(calls[1]!.body!), { prompt: 'x', duration: 4, seed: 3, output_format: 'wav' }, 'retry swapped the duration field, keeping output_format')
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

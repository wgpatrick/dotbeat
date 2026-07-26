// Demucs stem isolation (src/analysis/stems.ts + python/stem_extract.py) and its threading through
// the fal gen path.
//
// Two tiers, the same split roughness.test.ts uses:
//   - Everything except the last test runs EVERYWHERE, on a STUBBED extractor injected into
//     runGenFal (the `stemExtractImpl` seam) or on stubbed sidecar JSON. Those cover the contract,
//     the option threading, the ordering against the downbeat trim, and the failure stance.
//   - ONE synthetic integration test spawns the real sidecar and is GATED on demucs being
//     installed: it mixes a bass tone with hat clicks, extracts `bass`, and asserts the tone
//     survived while the clicks did not. Skips cleanly with no venv.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseStemResult,
  resolveStemPython,
  isStemName,
  stemDoctor,
  extractStem,
  STEM_NAMES,
  BeatStemError,
  type StemExtractResult,
  type StemExtractor,
} from '../src/analysis/stems.js'
import { runGenFal, type FalTransport } from '../src/analysis/gen-fal.js'
import { genStemForRole, showdownRole, GEN_STEM_BY_SUBJECT } from '../src/taste/showdown.js'
import { decodeWav } from '../src/metrics/wav.js'

// ---- helpers ----------------------------------------------------------------------------------

/** A 16-bit PCM WAV from per-sample float callbacks (mono unless `channels` says otherwise). */
function writeWav(path: string, samples: Float64Array, sampleRate = 44100, channels = 1): void {
  const frames = samples.length / channels
  const bytes = samples.length * 2
  const buf = Buffer.alloc(44 + bytes)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + bytes, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2 * channels, 28)
  buf.writeUInt16LE(2 * channels, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(bytes, 40)
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), 44 + i * 2)
  }
  writeFileSync(path, buf)
  void frames
}

/** A sidecar result with the given levels — the shape the stub extractor hands back. */
function stubResult(over: Partial<StemExtractResult> = {}): StemExtractResult {
  return {
    backend: 'stem-extract', version: '1.0.0', model: 'htdemucs', device: 'cpu',
    stem: 'bass', stemUsed: 'bass', fallback: null, outPath: '/tmp/x.wav',
    sampleRate: 44100, durationSeconds: 4, mixRmsDb: -16, keptRmsDb: -17, residualRmsDb: -27,
    stemsRmsDb: { drums: -27, bass: -17, other: -43, vocals: -49 }, silenceMarginDb: 25,
    ...over,
  }
}

/** A 4 s 48 kHz mono WAV with a transient at 0.5 s — the same shape gen-fal's trim test uses, so a
 * stem-extract + trim run can be checked for BOTH effects at once. */
function longWav(): Buffer {
  const sr = 48000, frames = 4 * sr
  const data = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i++) {
    let s = Math.sin(i * 0.01) * 0.0005
    const rel = i - Math.round(0.5 * sr)
    if (rel >= 0 && rel < 200) s = 0.9 * Math.exp(-rel / 40)
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

function mockTransport(wav: Buffer): FalTransport {
  return async (req) => {
    if (req.method === 'POST') return { status: 200, bodyText: JSON.stringify({ audio_file: { url: 'https://cdn.fal.example/out.wav' } }) }
    if (req.outPath !== undefined) writeFileSync(req.outPath, wav)
    return { status: 200, bodyText: '' }
  }
}

// ---- the sidecar contract (pure) ---------------------------------------------------------------

test('parseStemResult accepts the sidecar contract and rejects malformed/non-JSON output', () => {
  const ok = parseStemResult(JSON.stringify(stubResult({ fallback: 'guard note' })))
  assert.equal(ok.stem, 'bass')
  assert.equal(ok.stemUsed, 'bass')
  assert.equal(ok.fallback, 'guard note')
  assert.equal(ok.residualRmsDb, -27)
  assert.throws(() => parseStemResult('not json'), (e: unknown) => e instanceof BeatStemError && /non-JSON/.test((e as Error).message))
  assert.throws(() => parseStemResult('{"stem":"bass"}'), (e: unknown) => e instanceof BeatStemError && /malformed/.test((e as Error).message))
  // an unknown stem name is malformed, not silently coerced — a drifted sidecar must fail loudly
  assert.throws(() => parseStemResult(JSON.stringify({ ...stubResult(), stemUsed: 'guitar' })), BeatStemError)
})

test('isStemName / STEM_NAMES are the htdemucs four', () => {
  assert.deepEqual(STEM_NAMES, ['bass', 'other', 'drums', 'vocals'])
  for (const s of STEM_NAMES) assert.equal(isStemName(s), true)
  assert.equal(isStemName('guitar'), false)
  assert.equal(isStemName(undefined), false)
})

test('resolveStemPython prefers $BEAT_STEM_PYTHON, then $BEAT_PYTHON', () => {
  const saved = { stem: process.env.BEAT_STEM_PYTHON, shared: process.env.BEAT_PYTHON }
  try {
    process.env.BEAT_STEM_PYTHON = '/tmp/stem-python'
    process.env.BEAT_PYTHON = '/tmp/shared-python'
    assert.equal(resolveStemPython(), '/tmp/stem-python')
    delete process.env.BEAT_STEM_PYTHON
    assert.equal(resolveStemPython(), '/tmp/shared-python')
  } finally {
    if (saved.stem === undefined) delete process.env.BEAT_STEM_PYTHON; else process.env.BEAT_STEM_PYTHON = saved.stem
    if (saved.shared === undefined) delete process.env.BEAT_PYTHON; else process.env.BEAT_PYTHON = saved.shared
  }
})

test('extractStem rejects a bad stem name and a missing input before spawning anything', async () => {
  await assert.rejects(
    extractStem({ input: '/tmp/whatever.wav', stem: 'guitar' as never, outPath: '/tmp/out.wav' }),
    (e: unknown) => e instanceof BeatStemError && /bass\|other\|drums\|vocals/.test((e as Error).message),
  )
  await assert.rejects(
    extractStem({ input: '/tmp/definitely-not-here-9137.wav', stem: 'bass', outPath: '/tmp/out.wav' }),
    (e: unknown) => e instanceof BeatStemError && /no audio to separate/.test((e as Error).message),
  )
})

// ---- role -> stem mapping ----------------------------------------------------------------------

test('showdown role -> demucs stem: bassline->bass, chords/lead->other, drum-loop->drums', () => {
  assert.equal(genStemForRole(showdownRole('bassline')), 'bass')
  assert.equal(genStemForRole(showdownRole('chords')), 'other')
  assert.equal(genStemForRole(showdownRole('lead')), 'other')
  assert.equal(genStemForRole(showdownRole('drum-loop')), 'drums')
  // every mapped target is a real htdemucs stem
  for (const stem of Object.values(GEN_STEM_BY_SUBJECT)) assert.equal(isStemName(stem), true)
})

// ---- threading through the fal gen path (stubbed extractor) -------------------------------------

test('runGenFal does NOT extract unless asked — the default path is untouched', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stem-off-'))
  const out = join(dir, 'v1.wav')
  let called = 0
  const impl: StemExtractor = async () => { called++; return stubResult() }
  const meta = await runGenFal({ prompt: 'p', seconds: 2, seed: 1, provider: 'fal-ai/lyria2', outPath: out, transport: mockTransport(longWav()), stemExtractImpl: impl, apiKey: 'k' })
  assert.equal(called, 0, 'no stemExtract option → the extractor is never invoked')
  assert.equal(meta.stemExtract, undefined)
  assert.equal(existsSync(`${out}.mix.wav`), false, 'no mix copy is left behind')
})

test('runGenFal extracts the requested stem and records the levels in GenMeta', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stem-on-'))
  const out = join(dir, 'v1.wav')
  const seen: { input: string; stem: string; outPath: string }[] = []
  const impl: StemExtractor = async (o) => {
    seen.push({ input: o.input, stem: o.stem, outPath: o.outPath })
    // stand in for demucs: write a distinguishable "stem" over the mix
    writeWav(o.outPath, new Float64Array(44100).fill(0.1))
    return stubResult({ stem: o.stem, stemUsed: o.stem, outPath: o.outPath })
  }
  const meta = await runGenFal({ prompt: 'p', seconds: 2, seed: 1, provider: 'fal-ai/lyria2', stemExtract: 'bass', outPath: out, transport: mockTransport(longWav()), stemExtractImpl: impl, apiKey: 'k' })
  assert.equal(seen.length, 1)
  assert.equal(seen[0]!.stem, 'bass')
  assert.equal(seen[0]!.input, `${out}.mix.wav`, 'demucs reads the preserved full mix')
  assert.equal(seen[0]!.outPath, out, 'the stem replaces the registered clip')
  assert.deepEqual(meta.stemExtract, {
    stem: 'bass', stemUsed: 'bass', model: 'htdemucs', device: 'cpu',
    mixRmsDb: -16, keptRmsDb: -17, residualRmsDb: -27, fallback: null, mixPath: `${out}.mix.wav`,
  })
  // the full mix survives beside the stem: the decision is auditable and reversible
  const mixDur = readFileSync(`${out}.mix.wav`).readUInt32LE(40) / (48000 * 2)
  assert.ok(Math.abs(mixDur - 4) < 0.02, `the preserved mix is the whole 4s download, got ${mixDur}`)
})

test('extraction runs BEFORE the downbeat trim — demucs sees the whole generation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stem-order-'))
  const out = join(dir, 'v1.wav')
  let inputSeconds = 0
  const impl: StemExtractor = async (o) => {
    const decoded = decodeWav(readFileSync(o.input))
    inputSeconds = decoded.channels[0]!.length / decoded.sampleRate
    // hand back a 4 s stem carrying the same transient at 0.5 s, so the trim still has a downbeat
    writeFileSync(o.outPath, longWav())
    return stubResult({ stem: o.stem, stemUsed: o.stem, outPath: o.outPath, sampleRate: 48000 })
  }
  const meta = await runGenFal({ prompt: 'p', seconds: 2, seed: 1, provider: 'fal-ai/lyria2', stemExtract: 'bass', bpm: 120, bars: 1, outPath: out, transport: mockTransport(longWav()), stemExtractImpl: impl, apiKey: 'k' })
  assert.ok(Math.abs(inputSeconds - 4) < 0.02, `demucs got the full 4s generation, not a trimmed excerpt (got ${inputSeconds}s)`)
  // ...and the trim then ran ON the stem: 1 bar @120 BPM = 2 s, snapped to the 0.5 s transient
  assert.ok(meta.trimmedSeconds !== undefined && Math.abs(meta.trimmedSeconds - 2) < 0.02, `trimmed to ~2s, got ${meta.trimmedSeconds}`)
  assert.ok(meta.trimOffsetSeconds !== undefined && Math.abs(meta.trimOffsetSeconds - 0.5) < 0.02)
  assert.equal(meta.stemExtract?.stemUsed, 'bass')
  assert.equal(meta.rawOutPath, `${out}.raw.wav`, 'the untrimmed STEM is preserved by the trim step')
})

test('the near-silence guard is reported all the way up: stemUsed != stem, with the reason', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stem-guard-'))
  const out = join(dir, 'v1.wav')
  const impl: StemExtractor = async (o) => {
    writeWav(o.outPath, new Float64Array(44100).fill(0.1))
    return stubResult({
      stem: o.stem, stemUsed: 'other', outPath: o.outPath, keptRmsDb: -18, mixRmsDb: -16,
      fallback: 'bass is 41.0 dB below the mix (> 25.0 dB); fell back to other',
    })
  }
  const meta = await runGenFal({ prompt: 'p', seconds: 2, seed: 1, provider: 'fal-ai/lyria2', stemExtract: 'bass', outPath: out, transport: mockTransport(longWav()), stemExtractImpl: impl, apiKey: 'k' })
  assert.equal(meta.stemExtract?.stem, 'bass')
  assert.equal(meta.stemExtract?.stemUsed, 'other', 'what actually shipped, not what was asked for')
  assert.match(String(meta.stemExtract?.fallback), /fell back to other/)
})

test('an extraction failure FAILS the generation — it never silently ships the full mix', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stem-fail-'))
  const out = join(dir, 'v1.wav')
  const impl: StemExtractor = async () => { throw new BeatStemError('stem-extract sidecar dependency missing: demucs') }
  await assert.rejects(
    runGenFal({ prompt: 'p', seconds: 2, seed: 1, provider: 'fal-ai/lyria2', stemExtract: 'bass', outPath: out, transport: mockTransport(longWav()), stemExtractImpl: impl, apiKey: 'k' }),
    /dependency missing/,
  )
})

// ---- the real sidecar (gated) -------------------------------------------------------------------

const doctorReport = (await stemDoctor()).stemExtract as { available?: boolean } | undefined
const sidecarAvailable = doctorReport?.available === true

test('stemDoctor reports honestly and never throws', async () => {
  const report = await stemDoctor()
  assert.ok(typeof report.stemInterpreter === 'string' && report.stemInterpreter.length > 0)
  assert.ok(report.stemExtract !== undefined)
})

test(
  'synthetic mix: extracting `bass` keeps the tone and drops the hats (real demucs)',
  { skip: !sidecarAvailable && 'demucs not installed — python/.venv/bin/pip install -r python/requirements-demucs.txt' },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stem-real-'))
    const mix = join(dir, 'mix.wav')
    const out = join(dir, 'bass.wav')
    const sr = 44100, secs = 4, n = sr * secs
    // a plucked 55 Hz bass on every half second, plus bright noise clicks on every eighth — two
    // sources with NO spectral overlap, so "did the clicks survive?" is a clean question.
    const samples = new Float64Array(n)
    let state = 0x9e3779b9 | 0
    const noise = (): number => {
      state = (state + 0x6d2b79f5) | 0
      let t = Math.imul(state ^ (state >>> 15), 1 | state)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1
    }
    for (let i = 0; i < n; i++) {
      const t = i / sr
      const bassPhase = t % 0.5
      const env = Math.exp(-bassPhase * 6)
      let s = env * (0.6 * Math.sin(2 * Math.PI * 55 * t) + 0.25 * Math.sin(2 * Math.PI * 110 * t))
      const hatPhase = t % 0.25
      if (hatPhase < 0.03) s += Math.exp(-hatPhase * 180) * noise() * 0.5
      samples[i] = s * 0.8
    }
    writeWav(mix, samples, sr)

    const res = await extractStem({ input: mix, stem: 'bass', outPath: out })
    assert.equal(res.stemUsed, 'bass', 'the guard did not need to fire on an obvious bass')
    assert.equal(res.fallback, null)
    assert.ok(existsSync(out))

    // Band shares, not raw levels: what "the drums are gone" means is that the high band is gone.
    // Two cascaded one-pole low-passes at 4 kHz; `hi` is the energy share of what they reject.
    // Zero deps and plenty sharp for a question this lopsided (measured 2.1% -> 0.06%).
    const highShare = (path: string): number => {
      const d = decodeWav(readFileSync(path))
      const ch = d.channels[0]!
      const a = Math.exp((-2 * Math.PI * 4000) / d.sampleRate)
      let lp1 = 0, lp2 = 0, hiE = 0, loE = 0
      for (let i = 0; i < ch.length; i++) {
        lp1 = (1 - a) * ch[i]! + a * lp1
        lp2 = (1 - a) * lp1 + a * lp2
        loE += lp2 * lp2
        hiE += (ch[i]! - lp2) ** 2
      }
      return hiE / (hiE + loE || 1)
    }
    const before = highShare(mix)
    const after = highShare(out)
    assert.ok(before > 0.01, `the mix really does carry hats (>4kHz share ${(before * 100).toFixed(2)}%)`)
    assert.ok(after < before / 10, `the extracted bass dropped the hats: ${(before * 100).toFixed(2)}% -> ${(after * 100).toFixed(2)}%`)
    assert.ok(res.keptRmsDb > res.mixRmsDb - 10, `the bass survived at full level (kept ${res.keptRmsDb} vs mix ${res.mixRmsDb} dBFS)`)
    assert.ok(res.residualRmsDb < res.keptRmsDb, 'what was discarded is quieter than what was kept')
  },
)

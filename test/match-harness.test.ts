// End-to-end harness test with a FAKE engine: a pure-TS synthesizer that reads the same candidate
// .beat documents the real engine would (through the real parser) and renders them with a crude
// but param-responsive model. This exercises the whole search loop — staged CMA-ES, discrete
// screening, budget accounting, caching, outputs — deterministically and browser-free. The real-
// engine self-match (same command, real renders) is the owner-side smoke run documented in
// docs/t6-sound-matching.md; this test is what keeps the loop honest in CI.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from '../src/core/index.js'
import { runMatch, formatMatchReport, type MatchRenderSession } from '../src/match/harness.js'
import { buildMatchSpace, buildBaseDoc, buildCandidateDoc, initGenome } from '../src/match/space.js'
import { SeededRandom } from '../src/match/cmaes.js'
import { decodeWav } from '../src/metrics/wav.js'

const FAKE_RATE = 44100

/** 16-bit mono PCM WAV encoder (the canonical 44-byte header). */
function encodeWav(mono: Float64Array, sampleRate: number): Uint8Array {
  const out = Buffer.alloc(44 + mono.length * 2)
  out.write('RIFF', 0, 'ascii')
  out.writeUInt32LE(36 + mono.length * 2, 4)
  out.write('WAVE', 8, 'ascii')
  out.write('fmt ', 12, 'ascii')
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)
  out.writeUInt16LE(1, 22)
  out.writeUInt32LE(sampleRate, 24)
  out.writeUInt32LE(sampleRate * 2, 28)
  out.writeUInt16LE(2, 32)
  out.writeUInt16LE(16, 34)
  out.write('data', 36, 'ascii')
  out.writeUInt32LE(mono.length * 2, 40)
  for (let i = 0; i < mono.length; i++) {
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(mono[i]! * 32767))), 44 + i * 2)
  }
  return new Uint8Array(out)
}

/** The fake engine: parse the candidate doc, synthesize its one note (osc mix + ADSR + one-pole
 * lowpass + distortion-ish saturation for stage 2). Deterministic (seeded noise). */
function fakeRender(beatText: string, seconds: number): Float64Array {
  const doc = parse(beatText)
  const track = doc.tracks.find((t) => t.id === 'match')
  if (!track || track.kind !== 'synth') throw new Error('fake engine only speaks synth match docs')
  const s = track.synth
  const note = track.notes[0]!
  const stepSeconds = 60 / doc.bpm / 4
  const gateSeconds = note.duration * stepSeconds
  const freq = 440 * Math.pow(2, (note.pitch - 69) / 12)
  const n = Math.round(seconds * FAKE_RATE)
  const out = new Float64Array(n)
  const rng = new SeededRandom(7)
  const wave = (phase: number, type: string): number => {
    const p = phase - Math.floor(phase)
    switch (type) {
      case 'sine':
        return Math.sin(2 * Math.PI * p)
      case 'triangle':
        return 4 * Math.abs(p - 0.5) - 1
      case 'square':
        return p < 0.5 ? 1 : -1
      case 'wavetable': // distinct from sawtooth so the discrete screen has a unique optimum
        return 0.5 * (2 * p - 1) + 0.5 * Math.sin(4 * Math.PI * p)
      default:
        return 2 * p - 1 // sawtooth
    }
  }
  const attack = Math.max(0.001, s.attack)
  const decay = Math.max(0.005, s.decay)
  const release = Math.max(0.005, s.release)
  for (let i = 0; i < n; i++) {
    const t = i / FAKE_RATE
    let env: number
    if (t < attack) env = t / attack
    else if (t < attack + decay) env = 1 - (1 - s.sustain) * ((t - attack) / decay)
    else env = s.sustain
    if (t > gateSeconds) env *= Math.exp(-(t - gateSeconds) / release)
    const phase = freq * t
    let v = wave(phase, s.osc)
    v += s.osc2Level * wave(phase * Math.pow(2, s.osc2Detune / 1200), s.osc2Type)
    v += s.subLevel * wave(phase / 2, 'sine')
    v += s.noiseLevel * (rng.uniform() * 2 - 1)
    out[i] = 0.4 * env * v
  }
  // one-pole lowpass at cutoff; highpass = residual; bandpass = lowpass(cutoff) minus
  // lowpass(cutoff/4) — crude but DISTINCT from plain lowpass, so each filter type sounds
  // different and the discrete screen has a unique optimum.
  const alphaFor = (hz: number) => {
    const rc = 1 / (2 * Math.PI * Math.max(50, hz))
    return 1 / FAKE_RATE / (rc + 1 / FAKE_RATE)
  }
  const alpha = alphaFor(s.cutoff)
  const alphaLow = alphaFor(s.cutoff / 4)
  let acc = 0
  let acc2 = 0
  for (let i = 0; i < n; i++) {
    acc += alpha * (out[i]! - acc)
    acc2 += alphaLow * (out[i]! - acc2)
    out[i] = s.filterType === 'highpass' ? out[i]! - acc : s.filterType === 'bandpass' ? acc - acc2 : acc
  }
  // stage-2 audibility: distortion mix as a soft clip blend
  if (s.distortionMix > 0) {
    for (let i = 0; i < n; i++) {
      const dry = out[i]!
      const wet = Math.tanh(dry * (1 + 8 * s.distortionAmount))
      out[i] = dry * (1 - s.distortionMix) + wet * s.distortionMix
    }
  }
  return out
}

function fakeSessionFactory(): (projectDir: string, initialText: string) => Promise<MatchRenderSession> {
  return async () => ({
    render: async (beatText: string, seconds: number) => encodeWav(fakeRender(beatText, seconds), FAKE_RATE),
    close: async () => {},
  })
}

test('self-match through the fake engine: the harness recovers a known patch, respects budget, writes every artifact', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-match-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  // The ground truth: a known genome rendered by the same fake engine (so loss 0 is reachable).
  const space = buildMatchSpace('synth')
  const base = buildBaseDoc({ trackKind: 'synth', midi: 69, durationSeconds: 1.0 })
  const truth = initGenome(space.stage1)
  const at = (path: string, v: number) => {
    truth[space.stage1.findIndex((d) => d.path === path)] = v
  }
  at('match.cutoff', 0.55) // ~2 kHz
  at('match.attack', 0.1)
  at('match.decay', 0.5)
  at('match.sustain', 0.4)
  at('gate', 0.5)
  const combo = space.discreteChoices.find((c) => c.label === 'sawtooth/lowpass')!
  const truthDoc = buildCandidateDoc(base, space, combo, space.stage1, truth)
  const targetPath = join(dir, 'target.wav')
  const targetAudio = fakeRender(truthDoc.text, base.renderSeconds)
  const fs = await import('node:fs')
  fs.writeFileSync(targetPath, encodeWav(targetAudio, FAKE_RATE))

  const outDir = join(dir, 'match-out')
  const result = await runMatch({
    targetWavPath: targetPath,
    outDir,
    sessionFactory: fakeSessionFactory(),
    trackKind: 'synth',
    budget: 320,
    population: 12,
    seed: 41,
    clap: false,
  })

  const r = result.report
  // Budget respected, all stages ran.
  assert.ok(r.renders <= 320, `renders ${r.renders} > budget`)
  assert.ok(r.renders >= 100, `suspiciously few renders: ${r.renders}`)
  assert.deepEqual(r.stages.map((s) => s.name), ['screen', 'source', 'inserts'])
  // Pitch was frozen from f0: the target is A4 = 440 Hz = MIDI 69.
  assert.equal(r.target.pitch!.frozenMidi, 69)
  // The search actually searched: best beats the screening initialization meaningfully.
  const first = result.lossCurve[0]!
  assert.ok(r.best.loss.total < first.loss * 0.55, `best ${r.best.loss.total} vs first ${first.loss}`)
  // Stage handoff is lossless: the inserts stage starts from an effects-off anchor that
  // reproduces the stage-1 winner (incl. the frozen note gate), so its best can never be worse
  // than the earlier stages' best (regression guard for the measured gate-drop bug).
  const stageBest = (name: string) => r.stages.find((s) => s.name === name)!.bestLoss
  const earlierBest = Math.min(stageBest('screen') ?? Infinity, stageBest('source') ?? Infinity)
  assert.ok(stageBest('inserts') !== null && stageBest('inserts')! <= earlierBest + 1e-9, `inserts ${stageBest('inserts')} > earlier ${earlierBest}`)
  // The discrete screen found the true osc/filter combo.
  assert.equal(r.best.discrete, 'sawtooth/lowpass')
  // best-curve is monotonically non-increasing.
  for (let i = 1; i < result.lossCurve.length; i++) {
    assert.ok(result.lossCurve[i]!.best <= result.lossCurve[i - 1]!.best + 1e-12)
  }
  // Artifacts on disk.
  for (const p of [result.bestBeatPath, result.bestWavPath, result.patchPath, result.lossCurvePath, result.reportPath]) {
    assert.ok(existsSync(p), `missing artifact ${p}`)
  }
  // The patch is replayable and matches the best doc's params.
  const patchLines = readFileSync(result.patchPath, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
  assert.ok(patchLines.length >= space.stage1.length, 'patch should carry the full edit list')
  const bestDoc = parse(readFileSync(result.bestBeatPath, 'utf8'))
  assert.equal(bestDoc.tracks[0]!.synth.osc, 'sawtooth')
  // Param recovery on the dominant dim: cutoff within an octave of the truth (~2 kHz).
  const cutoff = bestDoc.tracks[0]!.synth.cutoff
  assert.ok(cutoff > 1000 && cutoff < 4200, `recovered cutoff ${cutoff} not within an octave of 2081`)
  // The render actually decodes.
  const bestWav = decodeWav(readFileSync(result.bestWavPath))
  assert.ok(bestWav.channels[0]!.length > 0)
  // CLAP off => a named reason, not a crash.
  assert.equal(r.ceiling.clapCosine, null)
  assert.ok(typeof formatMatchReport(r) === 'string' && formatMatchReport(r).includes('MFCC distance'))

  // ---- resume: a second run over the same out-dir reuses the cache ----------------------------
  const rerun = await runMatch({
    targetWavPath: targetPath,
    outDir,
    sessionFactory: fakeSessionFactory(),
    trackKind: 'synth',
    budget: 320,
    population: 12,
    seed: 41,
    clap: false,
  })
  assert.ok(rerun.report.cacheHits > 0, 'identical re-run should hit the eval cache')
  assert.ok(rerun.report.renders === 0, `identical seeded re-run should be all cache hits, rendered ${rerun.report.renders}`)
  assert.ok(rerun.report.best.loss.total <= r.best.loss.total + 1e-12)
})

test('runMatch refuses a too-long target and a too-small budget with named errors', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-match-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const fs = await import('node:fs')
  const long = new Float64Array(FAKE_RATE * 11)
  const longPath = join(dir, 'long.wav')
  fs.writeFileSync(longPath, encodeWav(long, FAKE_RATE))
  await assert.rejects(
    runMatch({ targetWavPath: longPath, outDir: join(dir, 'o1'), sessionFactory: fakeSessionFactory(), budget: 50 }),
    /1-2s chop/,
  )
  const okPath = join(dir, 'ok.wav')
  fs.writeFileSync(okPath, encodeWav(new Float64Array(FAKE_RATE), FAKE_RATE))
  await assert.rejects(
    runMatch({ targetWavPath: okPath, outDir: join(dir, 'o2'), sessionFactory: fakeSessionFactory(), budget: 5 }),
    /budget 5/,
  )
})

// Pair-relative roughness tests (src/metrics/roughness.ts). The threshold/schema tests run
// everywhere on STUBBED sidecar results (roughnessFindings is a pure function of two RoughnessResult
// objects). One integration test spawns the real MoSQITo sidecar and is GATED on it being available
// (skips cleanly otherwise, exactly like surge-sidecar.test.ts).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  roughnessFindings,
  roughnessCompare,
  parseRoughnessResult,
  roughnessDoctor,
  BeatRoughnessError,
  type RoughnessResult,
  type RoughnessBin,
} from '../src/metrics/roughness.js'

/** A RoughnessResult with the given per-bin asper values (3s bins from 0). */
function result(vals: number[]): RoughnessResult {
  const bins: RoughnessBin[] = vals.map((roughness, i) => ({ index: i, start: i * 3, end: (i + 1) * 3, roughness }))
  const arr = vals.slice().sort((a, b) => a - b)
  return {
    backend: 'roughness',
    version: '1.0.0',
    model: 'mosqito-daniel-weber-roughness',
    binSeconds: 3,
    sampleRate: 44100,
    durationSeconds: vals.length * 3,
    mean: vals.reduce((a, b) => a + b, 0) / (vals.length || 1),
    p95: arr[Math.min(arr.length - 1, Math.floor(arr.length * 0.95))] ?? 0,
    bins,
  }
}

test('roughnessFindings: flags a bin that rises past BOTH +15% and +0.2 asper', () => {
  const base = result([1.5, 1.5])
  const cand = result([1.5, 2.0]) // bin 1: +0.5 abs, +33% → flag
  const fs = roughnessFindings(base, cand)
  assert.equal(fs.length, 1)
  const f = fs[0]!
  assert.equal(f.kind, 'roughness-rise')
  assert.equal(f.source, 'roughness-dw')
  assert.equal(f.band, 'full-band')
  assert.equal(f.start, 3)
  assert.equal(f.end, 6)
  assert.equal(f.measured, 2.0)
  assert.ok(typeof f.threshold === 'number' && f.threshold > 1.5, 'threshold reports the effective bar cleared')
})

test('roughnessFindings: a +15% rise on a near-zero bin is NOT flagged (abs guard)', () => {
  // +50% but only +0.1 asper — below the +0.2 absolute floor → no finding (the AND matters)
  const fs = roughnessFindings(result([0.2]), result([0.3]))
  assert.equal(fs.length, 0)
})

test('roughnessFindings: a +0.3 asper rise that is only +10% is NOT flagged (pct guard)', () => {
  // +0.3 abs clears the absolute floor, but 3.0→3.3 is +10% → below +15% → no finding
  const fs = roughnessFindings(result([3.0]), result([3.3]))
  assert.equal(fs.length, 0)
})

test('roughnessFindings: severity scales with the rise (3 at +25%, 4-5 beyond +50%)', () => {
  const sev = (basev: number, candv: number) => roughnessFindings(result([basev]), result([candv]))[0]?.severity
  assert.equal(sev(2.0, 2.44), 2, '+22% is a mild sev 2')
  assert.equal(sev(1.0, 1.25), 3, '+25% (owner-flagged level) is sev 3')
  assert.equal(sev(1.0, 1.6), 4, '+60% is sev 4')
  assert.equal(sev(1.0, 1.9), 5, '+90% is sev 5')
})

test('roughnessFindings: the reverse direction (candidate quieter) flags nothing', () => {
  assert.deepEqual(roughnessFindings(result([2.0, 2.5]), result([1.5, 1.7])), [])
})

test('roughnessFindings: matches bins by index over the shorter length', () => {
  const fs = roughnessFindings(result([1.5, 1.5, 1.5]), result([2.0, 2.0]))
  assert.equal(fs.length, 2, 'only the overlapping bins are compared')
})

test('parseRoughnessResult: shapes valid sidecar JSON and rejects malformed', () => {
  const good = JSON.stringify(result([1.1, 1.2]))
  const r = parseRoughnessResult(good)
  assert.equal(r.bins.length, 2)
  assert.equal(r.bins[0]!.roughness, 1.1)
  assert.throws(() => parseRoughnessResult('not json'), BeatRoughnessError)
  assert.throws(() => parseRoughnessResult(JSON.stringify({ mean: 1 })), BeatRoughnessError)
})

// ---- gated integration: the real MoSQITo sidecar --------------------------------------------

let sidecarAvailable = false
try {
  const report = await roughnessDoctor()
  sidecarAvailable = report.available === true
} catch {
  sidecarAvailable = false
}

/** Minimal 16-bit PCM mono WAV encoder (no reusable encoder is exported repo-side). */
function writePcm16(path: string, samples: Float64Array, sampleRate: number): void {
  const n = samples.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!))
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  writeFileSync(path, buf)
}

test('roughnessCompare: rough candidate flags vs smooth baseline; reverse does not (real sidecar)', { skip: !sidecarAvailable }, async () => {
  const FS = 44100
  const secs = 6
  const n = FS * secs
  const smooth = new Float64Array(n)
  const rough = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / FS
    smooth[i] = 0.5 * Math.sin(2 * Math.PI * 500 * t)
    // strong ~70 Hz amplitude modulation of a 1 kHz carrier = high Daniel-Weber roughness
    rough[i] = 0.5 * (1 + 0.95 * Math.sin(2 * Math.PI * 70 * t)) * Math.sin(2 * Math.PI * 1000 * t)
  }
  const dir = mkdtempSync(join(tmpdir(), 'beat-roughness-'))
  try {
    const smoothPath = join(dir, 'smooth.wav')
    const roughPath = join(dir, 'rough.wav')
    writePcm16(smoothPath, smooth, FS)
    writePcm16(roughPath, rough, FS)

    const fwd = await roughnessCompare(smoothPath, roughPath) // candidate=rough → should flag
    assert.ok(fwd.findings.length > 0, 'the rough candidate flags at least one bin vs the smooth baseline')
    assert.ok(fwd.findings.every((f) => f.kind === 'roughness-rise' && f.source === 'roughness-dw'))
    assert.ok(fwd.candidate.mean > fwd.baseline.mean, 'the rough clip measures a higher mean roughness')

    const rev = await roughnessCompare(roughPath, smoothPath) // candidate=smooth → must NOT flag
    assert.equal(rev.findings.length, 0, 'a smoother candidate never flags a grind regression')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// D6, the tempo bug: `python/surge_render.py` contained ZERO tempo references and upstream surgepy
// hard-codes `time_data.tempo = 120` in createSurge(), so EVERY surge clip ever blind-rated rendered
// its tempo-synced LFOs, delays and envelopes at 120 BPM regardless of the batch tempo (research
// 132 §2.3, 140 D6). The fix is python/surge-patches/0001-surgepy-expose-host-tempo.patch (a
// setTempo/getTempo binding) plus the sidecar actually calling it.
//
// THE PROOF IN THIS FILE is deliberately physical rather than byte-wise. Surge's oscillators start
// on a random phase, so two renders of the same patch at the same tempo do NOT produce identical
// bytes (measured 2026-07-26: rms(diff)/rms ≈ 0.80 run-to-run on `Sequences/One Key Wonder`) — a
// "the files differ" assertion would pass on nondeterminism alone and prove nothing. Instead we
// render a tempo-synced patch at two tempos and measure the PERIOD of its amplitude modulation by
// envelope autocorrelation: a synced LFO's period must come out at a constant number of BEATS. On
// `Sequences/Bell Seq` that number is 2 beats, stable to ±1% across tempos and reruns (measured
// 60/90/120/160 BPM × 2 runs: 1.997, 2.003, 1.997, 2.012 beats). Before the fix the period would be
// pinned to wall-clock seconds instead and the beat count would scale with tempo.
//
// GATED: surgepy is a source build of Surge XT with no PyPI wheel, and the tempo binding is a local
// patch on top of it. Each gate skips with a named reason (CLAUDE.md: only env-gated dependencies
// may skip) and the pure contract tests below always run.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { surgeDoctor, surgeAvailable, listSurgePatches, runSurgeRender, BeatSurgeError } from '../src/analysis/surge.js'
import { resolvePython } from '../src/analysis/spawn-sidecar.js'

const repoRoot = new URL('../../', import.meta.url).pathname
const SIDECAR = join(repoRoot, 'python', 'surge_render.py')

let hasPython = false
try {
  execFileSync(resolvePython(), ['--version'], { stdio: 'ignore' })
  hasPython = true
} catch {
  hasPython = false
}

let doctorReport: Record<string, unknown> = {}
let hasSurgepy = false
if (hasPython) {
  try {
    doctorReport = await surgeDoctor()
    hasSurgepy = surgeAvailable(doctorReport)
  } catch {
    hasSurgepy = false
  }
}
const hasTempoBinding = hasSurgepy && doctorReport.tempoBinding === true

// ---- pure contract: the sidecar refuses to fake a tempo it cannot deliver ----------------------

/** Run a snippet against the sidecar module itself. Returns stdout; throws on a non-zero exit. */
function runPython(snippet: string): string {
  return execFileSync(resolvePython(), ['-c', snippet], { cwd: repoRoot, encoding: 'utf8' })
}

test('surge_render._apply_tempo: a build without setTempo is a LOUD failure, never a silent 120', { skip: !hasPython ? 'no python interpreter' : false }, () => {
  const out = runPython(`
import importlib.util, sys
spec = importlib.util.spec_from_file_location("sr", ${JSON.stringify(SIDECAR)})
sr = importlib.util.module_from_spec(spec); spec.loader.exec_module(sr)

class NoTempo:  # a pre-patch surgepy instance: no setTempo member at all
    pass

# asked for a specific tempo -> RenderError (exit 4 on the wire), naming the fix
try:
    sr._apply_tempo(NoTempo(), 128.0, True)
    print("FAIL: no error raised")
except sr.RenderError as e:
    assert "128" in str(e), str(e)
    assert "surge-patches" in str(e), str(e)
    print("loud-ok")

# asked for nothing -> degrades to Surge's own 120 and REPORTS that it did
applied, bpm = sr._apply_tempo(NoTempo(), sr.DEFAULT_TEMPO_BPM, False)
assert applied is False and bpm == 120.0, (applied, bpm)
print("degrade-ok")

# a patched build: the tempo goes on and is read back
class WithTempo:
    def __init__(self): self.t = 120.0
    def setTempo(self, t): self.t = float(t)
    def getTempo(self): return self.t
w = WithTempo()
applied, bpm = sr._apply_tempo(w, 174.0, True)
assert applied is True and bpm == 174.0 and w.t == 174.0, (applied, bpm, w.t)
print("apply-ok")

# a build whose setter silently doesn't stick is ALSO a loud failure
class Liar(WithTempo):
    def setTempo(self, t): pass
try:
    sr._apply_tempo(Liar(), 174.0, True)
    print("FAIL: liar accepted")
except sr.RenderError as e:
    assert "did not take" in str(e), str(e)
    print("liar-ok")

# out-of-range tempo is a usage error before anything is touched
for bad in (0, -1, 5000):
    try:
        sr._apply_tempo(WithTempo(), bad, True); print("FAIL: accepted", bad)
    except sr.UsageError:
        pass
print("range-ok")
`)
  assert.match(out, /loud-ok/)
  assert.match(out, /degrade-ok/)
  assert.match(out, /apply-ok/)
  assert.match(out, /liar-ok/)
  assert.match(out, /range-ok/)
})

test('surge render request: a non-numeric tempo is rejected before the synth is constructed', { skip: !hasPython ? 'no python interpreter' : false }, () => {
  const out = runPython(`
import importlib.util
spec = importlib.util.spec_from_file_location("sr", ${JSON.stringify(SIDECAR)})
sr = importlib.util.module_from_spec(spec); spec.loader.exec_module(sr)
try:
    sr.render({"patch": "/nope.fxp", "notes": [{"midi": 48, "startSeconds": 0, "durationSeconds": 1, "velocity": 100}],
               "tempo": "fast", "output": "/tmp/nope.wav"})
    print("FAIL")
except sr.UsageError as e:
    assert "tempo" in str(e), str(e)
    print("reject-ok")
`)
  assert.match(out, /reject-ok/)
})

// ---- the physical proof -------------------------------------------------------------------------

/** Minimal 16-bit PCM WAV reader — enough for the sidecar's own stdlib `wave` output. */
function readPcm16(path: string): { samples: Int16Array; sampleRate: number; channels: number } {
  const buf = readFileSync(path)
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF', `${path} is not a RIFF file`)
  let pos = 12
  let sampleRate = 0
  let channels = 0
  let samples: Int16Array | null = null
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    const body = pos + 8
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2)
      sampleRate = buf.readUInt32LE(body + 4)
      assert.equal(buf.readUInt16LE(body + 14), 16, 'expected 16-bit PCM')
    } else if (id === 'data') {
      const n = Math.floor(size / 2)
      const out = new Int16Array(n)
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(body + i * 2)
      samples = out
    }
    pos = body + size + (size % 2)
  }
  assert.ok(samples && sampleRate > 0 && channels > 0, `${path} had no fmt/data chunk`)
  return { samples: samples!, sampleRate, channels }
}

/** Rectified, hop-averaged amplitude envelope of channel 0. */
function envelope(path: string, hop = 512): { env: number[]; fps: number } {
  const { samples, sampleRate, channels } = readPcm16(path)
  const mono: number[] = []
  for (let i = 0; i < samples.length; i += channels) mono.push(Math.abs(samples[i]!))
  const env: number[] = []
  for (let i = 0; i + hop <= mono.length; i += hop) {
    let s = 0
    for (let k = 0; k < hop; k++) s += mono[i + k]!
    env.push(s / hop)
  }
  return { env, fps: sampleRate / hop }
}

/** Period (seconds) of the strongest amplitude modulation between `lo` and `hi` seconds. */
function dominantPeriodSeconds(env: number[], fps: number, lo = 0.05, hi = 4.0): number {
  const mean = env.reduce((a, b) => a + b, 0) / env.length
  const x = env.map((v) => v - mean)
  let bestScore = -Infinity
  let bestPeriod = 0
  const maxLag = Math.min(Math.floor(hi * fps), Math.floor(x.length / 2))
  for (let lag = Math.floor(lo * fps); lag < maxLag; lag++) {
    let s = 0
    for (let i = 0; i + lag < x.length; i++) s += x[i]! * x[i + lag]!
    s /= x.length - lag
    if (s > bestScore) {
      bestScore = s
      bestPeriod = lag / fps
    }
  }
  return bestPeriod
}

// The reference patch: a factory Sequences patch driven by a tempo-synced LFO. Named explicitly so
// a content change that removes it FAILS the lookup loudly rather than skipping.
const SYNCED_PATCH = { category: 'Sequences', name: 'Bell Seq' }
const EXPECTED_BEATS = 2 // measured 2026-07-26 at 60/90/120/160 BPM: 1.997/2.003/1.997/2.012

test(
  'D6: a tempo-synced patch renders on the BEAT grid — its modulation period tracks the tempo',
  { skip: !hasTempoBinding ? 'needs surgepy built WITH python/surge-patches/0001-surgepy-expose-host-tempo.patch (see `beat showdown --surge-doctor`)' : false },
  async (t) => {
    const patches = await listSurgePatches()
    const patch = patches.find((p) => p.category === SYNCED_PATCH.category && p.name === SYNCED_PATCH.name)
    assert.ok(
      patch,
      `factory patch "${SYNCED_PATCH.category}/${SYNCED_PATCH.name}" is missing from the catalogue (${patches.length} patches enumerated) — this test needs a known tempo-synced patch; pick another one that reports temposync="1" and re-measure EXPECTED_BEATS`,
    )
    const dir = mkdtempSync(join(tmpdir(), 'surge-tempo-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))

    const notes = [{ midi: 48, startSeconds: 0, durationSeconds: 6, velocity: 100 }]
    const measured: { bpm: number; seconds: number; beats: number }[] = []
    for (const bpm of [60, 120]) {
      const out = join(dir, `bell-${bpm}.wav`)
      const { meta } = await runSurgeRender({ patch: patch!.path, notes, sampleRate: 44100, outPath: out, tempo: bpm })
      assert.equal(meta.tempoApplied, true, `the sidecar must report it actually applied ${bpm} BPM`)
      assert.equal(meta.tempo, bpm)
      const { env, fps } = envelope(out)
      const seconds = dominantPeriodSeconds(env, fps)
      measured.push({ bpm, seconds, beats: (seconds * bpm) / 60 })
    }

    const slow = measured[0]!
    const fast = measured[1]!
    // (a) the same musical period at both tempos — this is what "tempo-synced" MEANS
    for (const m of measured) {
      assert.ok(
        Math.abs(m.beats - EXPECTED_BEATS) < 0.1,
        `at ${m.bpm} BPM the modulation period was ${m.seconds.toFixed(3)} s = ${m.beats.toFixed(3)} beats, expected ~${EXPECTED_BEATS}`,
      )
    }
    // (b) and therefore a DIFFERENT wall-clock period — the thing the 120 BPM hard-code destroyed.
    //     Halving the tempo must double the period; a pre-fix build gives a ratio of 1.0.
    const ratio = slow.seconds / fast.seconds
    assert.ok(
      Math.abs(ratio - 2) < 0.1,
      `60 BPM period ${slow.seconds.toFixed(3)} s vs 120 BPM period ${fast.seconds.toFixed(3)} s = ratio ${ratio.toFixed(3)}; expected 2.0 (a ratio of 1.0 means the render is still pinned to 120 BPM)`,
    )
  },
)

test(
  'D6: an explicit tempo on a build without the binding fails the whole render, loudly',
  { skip: !hasSurgepy ? 'needs a surgepy build' : hasTempoBinding ? 'this build HAS the tempo binding, so the degrade path cannot fire here' : false },
  async () => {
    await assert.rejects(
      () => runSurgeRender({ patch: '/nonexistent.fxp', notes: [{ midi: 48, startSeconds: 0, durationSeconds: 1, velocity: 100 }], sampleRate: 44100, outPath: join(tmpdir(), 'x.wav'), tempo: 128 }),
      BeatSurgeError,
    )
  },
)

// ---- the patch pools are explicit and testable ---------------------------------------------------

test('patch_roots / enumerate_pool: both pools are declared, and provenance comes back per patch', { skip: !hasPython ? 'no python interpreter' : false }, (t) => {
  // A synthetic content tree, so this runs with no Surge install at all.
  const dir = mkdtempSync(join(tmpdir(), 'surge-pools-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'patches_factory', 'Leads'), { recursive: true })
  mkdirSync(join(dir, 'patches_factory', 'Chords'), { recursive: true })
  mkdirSync(join(dir, 'patches_3rdparty', 'Vospi', 'Basses'), { recursive: true })
  mkdirSync(join(dir, 'patches_3rdparty', 'Kuniklo', 'Polysynths'), { recursive: true })
  writeFileSync(join(dir, 'patches_factory', 'Leads', 'Photon.fxp'), '')
  writeFileSync(join(dir, 'patches_factory', 'Chords', 'Stack.fxp'), '')
  writeFileSync(join(dir, 'patches_3rdparty', 'Vospi', 'Basses', 'Deep.fxp'), '')
  writeFileSync(join(dir, 'patches_3rdparty', 'Kuniklo', 'Polysynths', 'Wide.fxp'), '')

  const out = runPython(`
import importlib.util, json
spec = importlib.util.spec_from_file_location("sr", ${JSON.stringify(SIDECAR)})
sr = importlib.util.module_from_spec(spec); spec.loader.exec_module(sr)
roots = sr.patch_roots(${JSON.stringify(dir)})
print(json.dumps({
  "pools": [r["pool"] for r in roots],
  "exists": [r["exists"] for r in roots],
  "patches": sr.enumerate_patches(${JSON.stringify(dir)}),
}))
`)
  const parsed = JSON.parse(out) as { pools: string[]; exists: boolean[]; patches: { name: string; category: string; path: string; pool: string; bank: string }[] }
  assert.deepEqual(parsed.pools, ['factory', 'thirdparty'], 'both pools are declared, in order')
  assert.deepEqual(parsed.exists, [true, true])
  const byName = new Map(parsed.patches.map((p) => [p.name, p]))
  assert.equal(parsed.patches.length, 4, 'the third-party pool is enumerated too — this is the 639→3,559 fix')
  const photon = byName.get('Photon')!
  assert.deepEqual({ ...photon }, { name: 'Photon', category: 'Leads', pool: 'factory', bank: 'Surge XT Factory', path: photon.path })
  assert.equal(byName.get('Deep')?.category, 'Basses')
  assert.equal(byName.get('Deep')?.bank, 'Vospi', 'third-party provenance records WHICH bank the patch came from')
  assert.equal(byName.get('Deep')?.pool, 'thirdparty')
  assert.equal(byName.get('Wide')?.bank, 'Kuniklo')
  assert.equal(byName.get('Wide')?.category, 'Polysynths')
  // resolution is tolerant of a path pointing INTO a pool (the legacy shape callers used to pass)
  const legacy = runPython(`
import importlib.util, json
spec = importlib.util.spec_from_file_location("sr", ${JSON.stringify(SIDECAR)})
sr = importlib.util.module_from_spec(spec); spec.loader.exec_module(sr)
print(json.dumps(len(sr.enumerate_patches(${JSON.stringify(join(dir, 'patches_factory'))}))))
`)
  assert.equal(JSON.parse(legacy), 4, 'a legacy patches_factory path still resolves the whole library')
})

test('the installed library really is both pools (doctor)', { skip: !hasSurgepy ? 'needs a surgepy build' : false }, () => {
  const pools = doctorReport.pools as { pool: string; exists: boolean; patchCount: number }[] | null
  assert.ok(Array.isArray(pools), 'the doctor reports per-pool counts so a missing pool is visible')
  assert.deepEqual(pools.map((p) => p.pool), ['factory', 'thirdparty'])
  const total = pools.reduce((a, p) => a + p.patchCount, 0)
  assert.equal(doctorReport.patchCount, total)
  const factory = pools[0]!
  const thirdparty = pools[1]!
  if (thirdparty.exists) {
    assert.ok(thirdparty.patchCount > 0, 'patches_3rdparty exists on disk but enumerated zero patches')
    assert.ok(total > factory.patchCount, 'the visible pool must now be larger than patches_factory alone')
  }
})

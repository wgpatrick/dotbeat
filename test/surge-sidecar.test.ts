// Surge-as-sound-factory probe (research 114 §7): the spawn half of the surge showdown source —
// surge.ts driving python/surge_render.py. GATED on python3 like gen-sidecar.test.ts. The whole
// POINT of these is the DEGRADE path: surgepy is a source-build of Surge XT with no PyPI wheel, so
// in CI (and on any machine that hasn't built it) the sidecar reports unavailable and the showdown
// must skip the surge clip gracefully rather than break the batch. The pure surgeAvailable() logic
// runs everywhere; the sidecar spawn tests skip when python3 is absent.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { surgeAvailable, listSurgePatches, runSurgeRender, BeatSurgeError, surgeDoctor } from '../src/analysis/surge.js'

let hasPython = false
try {
  execFileSync('python3', ['--version'], { stdio: 'ignore' })
  hasPython = true
} catch {
  hasPython = false
}

// Whether surgepy is actually built in this environment (it usually is NOT — no wheel). When it IS
// present the degrade tests can't fire, so they skip, exactly like gen-sidecar's hasStableaudio.
let hasSurgepy = false
if (hasPython) {
  try {
    const report = await surgeDoctor()
    hasSurgepy = surgeAvailable(report)
  } catch {
    hasSurgepy = false
  }
}

test('surgeAvailable: reads the doctor report defensively', () => {
  assert.equal(surgeAvailable({ surgepy: { available: true } }), true)
  assert.equal(surgeAvailable({ surgepy: { available: false } }), false)
  assert.equal(surgeAvailable({ surgepy: {} }), false)
  assert.equal(surgeAvailable({}), false, 'no surgepy key → unavailable')
  assert.equal(surgeAvailable({ surgepy: null as unknown as object }), false)
})

test('surgeDoctor: reports honestly, never throws', { skip: !hasPython }, async () => {
  const report = await surgeDoctor()
  assert.equal(report.backend, 'surge')
  assert.equal(report.pythonFound, true)
  assert.ok(typeof report.surgepy === 'object' && report.surgepy !== null)
  if (!hasSurgepy) {
    // the graceful-skip signal the CLI keys on: available:false + a build fix, not a stack trace
    assert.equal(surgeAvailable(report), false)
    const surgepy = report.surgepy as { available?: boolean; fix?: string }
    assert.equal(surgepy.available, false)
    assert.match(String(surgepy.fix ?? ''), /surge/i, 'the doctor names how to get surgepy')
  } else {
    // where surgepy IS built, the doctor surfaces the factory path + a patch count
    assert.equal(surgeAvailable(report), true)
    assert.ok((report.patchCount as number) >= 0)
  }
})

test('listSurgePatches: throws BeatSurgeError when surgepy is unavailable (CLI catches → skip)', { skip: !hasPython || hasSurgepy }, async () => {
  await assert.rejects(() => listSurgePatches(), (err) => {
    assert.ok(err instanceof BeatSurgeError, `expected BeatSurgeError, got ${err}`)
    return true
  })
})

test('runSurgeRender: throws BeatSurgeError when surgepy is unavailable (CLI catches → skip)', { skip: !hasPython || hasSurgepy }, async () => {
  await assert.rejects(
    () => runSurgeRender({ patch: '/nonexistent/patch.fxp', notes: [{ midi: 48, startSeconds: 0, durationSeconds: 0.5, velocity: 100 }], sampleRate: 44100, outPath: '/tmp/surge-test-should-not-exist.wav' }),
    (err) => {
      assert.ok(err instanceof BeatSurgeError, `expected BeatSurgeError, got ${err}`)
      return true
    },
  )
})

test('runSurgeRender: validates its request before spawning anything', async () => {
  await assert.rejects(() => runSurgeRender({ patch: '', notes: [], sampleRate: 44100, outPath: '/tmp/x.wav' }), BeatSurgeError)
  await assert.rejects(() => runSurgeRender({ patch: '/p.fxp', notes: [], sampleRate: 44100, outPath: '/tmp/x.wav' }), /at least one note/)
  await assert.rejects(() => runSurgeRender({ patch: '/p.fxp', notes: [{ midi: 48, startSeconds: 0, durationSeconds: 1, velocity: 100 }], sampleRate: 0, outPath: '/tmp/x.wav' }), /sampleRate/)
})

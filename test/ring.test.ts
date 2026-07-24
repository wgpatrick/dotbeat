// The narrow-HF ring metric (src/metrics/ring.ts) — the TS port of python/surge_render.py _ring_db
// that the engine curation (docs/engine-presets.md E2) gates on. Synthetic signals with a KNOWN
// answer: a pure HF sine is a textbook narrow peak (rings), broadband noise and low-only tones do not.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ringDb } from '../src/metrics/ring.js'
import { passesGates } from '../src/taste/surgeCuration.js'

const SR = 44100
const N = SR // 1 s — several 8192 frames

function sine(freq: number, amp: number, n = N): Float64Array {
  const y = new Float64Array(n)
  for (let i = 0; i < n; i++) y[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR)
  return y
}
function addNoise(y: Float64Array, amp: number, seed = 1): Float64Array {
  let s = seed >>> 0
  const out = Float64Array.from(y)
  for (let i = 0; i < out.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    out[i]! += amp * ((s / 0xffffffff) * 2 - 1)
  }
  return out
}

test('ring: a pure 6 kHz sine is a narrow peak in-band → rings (ringDb well above -32)', () => {
  const r = ringDb([sine(6000, 0.5)], SR)
  assert.ok(r > -32, `6 kHz sine rings, got ${r}`)
  assert.equal(passesGates({ ringDb: r, activeFraction: 1, ce: 0, cu: 0, pc: 0, pq: 0, criticPessimistic: 0 }), false, 'a ringy render is gated out')
})

test('ring: silence and a low-only tone do not ring (nothing narrow in the 4–14 kHz band)', () => {
  assert.equal(ringDb([new Float64Array(N)], SR), -120, 'silence → floor')
  // a 200 Hz sine: its only spectral energy is far below the 4 kHz band floor
  const r = ringDb([sine(200, 0.6)], SR)
  assert.ok(r <= -32, `low tone has no HF ring, got ${r}`)
  assert.equal(passesGates({ ringDb: r, activeFraction: 0.8, ce: 0, cu: 0, pc: 0, pq: 0, criticPessimistic: 0 }), true, 'a clean render clears the ring gate')
})

test('ring: broadband noise has no single towering bin → does not ring', () => {
  const r = ringDb([addNoise(new Float64Array(N), 0.3)], SR)
  assert.ok(r <= -32, `flat broadband noise does not ring, got ${r}`)
})

test('ring: worst across channels wins (a ring in one channel counts)', () => {
  const clean = sine(200, 0.5)
  const ringy = sine(7000, 0.5)
  assert.ok(ringDb([clean, ringy], SR) > -32, 'a hard-panned HF ring in one channel is caught')
})

test('ring: a short (< one FFT frame) buffer degrades to the floor, never throws', () => {
  assert.equal(ringDb([sine(6000, 0.5, 1000)], SR), -120)
})

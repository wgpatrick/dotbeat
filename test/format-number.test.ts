// src/core/format.ts's `formatNumber` — first direct tests. Wave-0 gate W0.7(c) (review R2 §6.1).
//
// `formatNumber` is the lynchpin of D4's byte-identical round-trip guarantee: it is the ONE place
// floating-point noise could break `serialize(parse(x)) === x`. Its own docstring asserts an
// idempotence property —
//
//     formatNumber(Number(formatNumber(n))) === formatNumber(n)
//
// — and until this file, nothing verified it: the function was exercised only transitively through
// serialize/parse round-trips, which can only ever test the handful of values a fixture happens to
// contain. That is exactly the wrong shape of coverage for a numeric canonicalizer, whose failure
// mode is a rare value, not a rare code path. The property test below hammers it with thousands of
// values from the ranges the format actually carries (dB, Hz, seconds, steps, velocities, cents).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatNumber } from '../src/core/index.js'
// Deliberately reuses the repo's one EXPORTED PRNG rather than adding an N+1th copy of mulberry32
// (see test/rng.test.ts, which pins every copy to this one). Seeded, so a failure is reproducible.
import { mulberry32 } from '../src/taste/eval.js'

/** The documented property, as a single named predicate so every call site reads the same. */
const idempotent = (n: number) => formatNumber(Number(formatNumber(n))) === formatNumber(n)

test('formatNumber: the canonical-form table (integers bare, 4dp max, no trailing zeros)', () => {
  const cases: [number, string][] = [
    [0, '0'],
    [-0, '0'], // negative zero canonicalizes to "0" — there is one spelling per value (D4)
    [4500, '4500'],
    [-3, '-3'],
    [0.5, '0.5'],
    [0.8, '0.8'],
    [0.80001, '0.8'], // rounds to 4dp, then the trailing zeros go
    [1.00005, '1.0001'],
    [-60, '-60'],
    [-0.00001, '0'], // rounds INTO zero, and never prints as "-0"
    [-0.00006, '-0.0001'],
    [0.1 + 0.2, '0.3'], // the classic float artefact, canonicalized away
    [1 / 3, '0.3333'],
    [-1 / 3, '-0.3333'],
    [12000, '12000'],
    [32.7, '32.7'],
    [0.0001, '0.0001'],
    [0.00004, '0'],
    [123.456789, '123.4568'],
  ]
  for (const [n, want] of cases) assert.equal(formatNumber(n), want, `formatNumber(${n})`)
})

test('formatNumber: output shape — no trailing zeros, no bare trailing dot, no "-0"', () => {
  const rng = mulberry32(20260725)
  for (let i = 0; i < 20000; i++) {
    // Values across the ranges the .beat format actually carries: dB (-60..6), Hz (20..20000),
    // seconds (0..10), 16th steps (0..64), velocities/mixes (0..1), cents (-100..100).
    const scale = [60, 20000, 10, 64, 1, 100][i % 6]!
    const n = (rng() * 2 - 1) * scale
    const s = formatNumber(n)
    assert.ok(!/^-0$/.test(s), `formatNumber(${n}) produced "-0"`)
    assert.ok(!/\.$/.test(s), `formatNumber(${n}) left a bare trailing dot: "${s}"`)
    assert.ok(!/\.\d*0$/.test(s), `formatNumber(${n}) left a trailing zero: "${s}"`)
    assert.ok(!/[eE]/.test(s), `formatNumber(${n}) used exponent notation: "${s}"`)
    const dot = s.indexOf('.')
    if (dot !== -1) assert.ok(s.length - dot - 1 <= 4, `formatNumber(${n}) kept more than 4 decimals: "${s}"`)
    assert.ok(Number.isFinite(Number(s)), `formatNumber(${n}) is not re-readable as a number: "${s}"`)
  }
})

test('formatNumber: idempotence property — parse(format(x)) formats to the same string (D4)', () => {
  const rng = mulberry32(4242)
  for (let i = 0; i < 50000; i++) {
    const scale = [1, 64, 100, 1000, 20000, 1e6][i % 6]!
    const n = (rng() * 2 - 1) * scale
    assert.ok(idempotent(n), `not idempotent for ${n}: ${formatNumber(n)} -> ${formatNumber(Number(formatNumber(n)))}`)
  }
  // Values chosen to sit exactly on the 4dp rounding boundary, where a naive implementation loops.
  for (let k = -200000; k <= 200000; k += 1) {
    const n = k / 20000 // half-steps of the 4th decimal: …, 0.00005, 0.0001, 0.00015, …
    assert.ok(idempotent(n), `not idempotent at rounding boundary ${n}: ${formatNumber(n)} -> ${formatNumber(Number(formatNumber(n)))}`)
  }
})

test('formatNumber: idempotence holds for the edge values too', () => {
  const edges = [
    0, -0, 1, -1, 0.5, -0.5, 1e-7, -1e-7, 0.00005, -0.00005, 0.000049999, 0.99995, -0.99995,
    Number.EPSILON, -Number.EPSILON, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER,
    0.1 + 0.2, 1 / 3, 2 / 3, Math.PI, Math.E, 1e15, 1e-15, 1e20,
  ]
  for (const n of edges) assert.ok(idempotent(n), `not idempotent for ${n}: "${formatNumber(n)}" -> "${formatNumber(Number(formatNumber(n)))}"`)
})

test('formatNumber: FIXED-POINT property — formatting is stable under repeated re-reads', () => {
  // Stronger than idempotence-in-one-step: iterate format->Number->format and assert it reaches a
  // fixed point immediately and stays there, which is what a file surviving N save cycles needs.
  const rng = mulberry32(7)
  for (let i = 0; i < 10000; i++) {
    const n = (rng() * 2 - 1) * [1, 100, 20000][i % 3]!
    const first = formatNumber(n)
    let cur = first
    for (let k = 0; k < 5; k++) {
      const next = formatNumber(Number(cur))
      assert.equal(next, cur, `formatNumber drifted on re-read ${k + 1} of ${n}: "${cur}" -> "${next}"`)
      cur = next
    }
  }
})

test('formatNumber: documented limits — exponent notation for very large/small magnitudes', () => {
  // Honest pin rather than a claim of safety: outside the ranges the format carries, String()'s
  // exponent form leaks through. These values cannot appear in a .beat file (every numeric field
  // is range-checked far below 1e21), but the behaviour is recorded so a future change to this
  // function is a deliberate one. Note idempotence still holds here.
  assert.equal(formatNumber(1e21), '1e+21')
  assert.ok(idempotent(1e21))
  assert.equal(formatNumber(-1e21), '-1e+21')
  // Sub-4dp magnitudes collapse to "0" rather than going exponential — the case that matters.
  assert.equal(formatNumber(1e-21), '0')
  assert.equal(formatNumber(Number.MIN_VALUE), '0')
})

test('formatNumber: non-finite inputs are passed through as JS spells them (no throw)', () => {
  // Not a recommendation — a pin. `formatNumber` has no guard, so a NaN reaching serialize()
  // writes "NaN" into a .beat file rather than failing. Recorded so that if a future change adds
  // a guard, this test is the visible place the behaviour changed.
  assert.equal(formatNumber(NaN), 'NaN')
  assert.equal(formatNumber(Infinity), 'Infinity')
  assert.equal(formatNumber(-Infinity), '-Infinity')
})

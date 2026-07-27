// Known-answer tests for src/core/automation-simplify.ts — the pure breakpoint reducer behind the
// GUI's paint-a-run gesture (Phase 41 Stream C). Everything here is deliberately hand-checkable:
// the deviation measure is vertical distance in the param's own units, so every expectation below
// can be read off the numbers without running the code.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { simplifyAutomationPoints, AutomationSimplifyError, type SimplifiablePoint } from '../src/core/automation-simplify.js'

const pt = (time: number, value: number, interpolation?: string): SimplifiablePoint => (interpolation === undefined ? { time, value } : { time, value, interpolation })

test('a perfectly straight run collapses to its two endpoints', () => {
  // 0,10,20,…,100 across t=0..10 — every interior point sits exactly on the chord (deviation 0).
  const line = Array.from({ length: 11 }, (_, i) => pt(i, i * 10))
  const out = simplifyAutomationPoints(line, { tolerance: 0.5 })
  assert.deepEqual(out, [pt(0, 0), pt(10, 100)])
})

test('a real corner survives; jitter below tolerance around it does not', () => {
  // A V: down to (4, 0) then back up. The corner deviates 50 from the 100->100 chord, far above
  // tolerance; the ±1 wobble on the way down is below it.
  const v = [pt(0, 100), pt(1, 74), pt(2, 51), pt(3, 24), pt(4, 0), pt(5, 25), pt(6, 50), pt(7, 75), pt(8, 100)]
  const out = simplifyAutomationPoints(v, { tolerance: 2 })
  assert.deepEqual(out, [pt(0, 100), pt(4, 0), pt(8, 100)])
})

test('tolerance is in value units: raising it past a feature erases that feature', () => {
  const bump = [pt(0, 0), pt(1, 0), pt(2, 5), pt(3, 0), pt(4, 0)]
  // The bump peaks 5 above the flat chord.
  assert.equal(simplifyAutomationPoints(bump, { tolerance: 4.9 }).length, 3, 'tolerance just under the bump height keeps it')
  assert.deepEqual(simplifyAutomationPoints(bump, { tolerance: 5 }), [pt(0, 0), pt(4, 0)], 'tolerance at the bump height flattens it')
})

test('the survivors are the ORIGINAL objects, never re-averaged approximations', () => {
  const input = [pt(0, 0), pt(1, 1), pt(2, 2), pt(3, 90), pt(4, 0)]
  const out = simplifyAutomationPoints(input, { tolerance: 3 })
  for (const p of out) assert.ok(input.includes(p), `simplify returned a point that is not one of the inputs: ${JSON.stringify(p)}`)
})

test('first and last always survive, so the curve span never shrinks', () => {
  // A flat run: geometry says every interior point is redundant AND so are the ends, relative to
  // each other — but dropping the ends would silently shorten the automation.
  const flat = Array.from({ length: 20 }, (_, i) => pt(i * 3, 42))
  const out = simplifyAutomationPoints(flat, { tolerance: 1 })
  assert.deepEqual(out, [pt(0, 42), pt(57, 42)])
})

test('an authored hold/curve flag is never dropped, however redundant its geometry', () => {
  // (2, 20) and (4, 40) both sit exactly on the 0->60 chord, so pure geometry deletes both. The
  // 'hold' flag is authored intent no vertical measurement can recover, so that one stays.
  const run = [pt(0, 0), pt(2, 20), pt(4, 40, 'hold'), pt(6, 60)]
  const out = simplifyAutomationPoints(run, { tolerance: 5 })
  assert.deepEqual(out, [pt(0, 0), pt(4, 40, 'hold'), pt(6, 60)])
})

test("an explicit 'linear' flag is treated as the default it is, not as authored intent", () => {
  const run = [pt(0, 0), pt(2, 20, 'linear'), pt(4, 40), pt(6, 60)]
  assert.deepEqual(simplifyAutomationPoints(run, { tolerance: 5 }), [pt(0, 0), pt(6, 60)])
})

test('a sampled sine keeps its shape: far fewer points, and no point moves more than tolerance', () => {
  // The real workload — 64 samples of one cycle over a 0..4000 Hz cutoff range, as the paint
  // gesture produces across a 4-bar clip.
  const dense = Array.from({ length: 64 }, (_, i) => {
    const p = i / 63
    return pt(i, 2000 - 2000 * Math.cos(2 * Math.PI * p))
  })
  const tolerance = 40 // Hz — 1% of the range
  const out = simplifyAutomationPoints(dense, { tolerance })
  assert.ok(out.length < 24, `expected a big reduction from 64 points, got ${out.length}`)
  assert.ok(out.length >= 5, `a full sine cycle cannot be described by ${out.length} points`)

  // The guarantee that matters: reading the SIMPLIFIED curve at every original time is within
  // tolerance of the original value. This is the property the ear cares about, and it is checked
  // against the reduced polyline rather than re-deriving the algorithm's own internal claim.
  const readAt = (t: number) => {
    if (t <= out[0]!.time) return out[0]!.value
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i]!
      const b = out[i + 1]!
      if (t >= a.time && t <= b.time) return a.value + ((b.value - a.value) * (t - a.time)) / (b.time - a.time || 1)
    }
    return out[out.length - 1]!.value
  }
  for (const p of dense) {
    const err = Math.abs(readAt(p.time) - p.value)
    assert.ok(err <= tolerance + 1e-9, `simplified curve is off by ${err.toFixed(2)} at t=${p.time} (tolerance ${tolerance})`)
  }
})

test('degenerate inputs pass through instead of surprising the caller', () => {
  assert.deepEqual(simplifyAutomationPoints([], { tolerance: 1 }), [])
  assert.deepEqual(simplifyAutomationPoints([pt(0, 1)], { tolerance: 1 }), [pt(0, 1)])
  assert.deepEqual(simplifyAutomationPoints([pt(0, 1), pt(1, 9)], { tolerance: 1 }), [pt(0, 1), pt(1, 9)])
  const three = [pt(0, 0), pt(1, 50), pt(2, 0)]
  assert.deepEqual(simplifyAutomationPoints(three, { tolerance: 0 }), three, 'tolerance 0 is a no-op, not a full collapse')
  assert.deepEqual(simplifyAutomationPoints(three, { tolerance: -5 }), three)
})

test('two points at the same time still reduce, and unsorted input fails loudly', () => {
  const stacked = [pt(0, 0), pt(5, 10), pt(5, 10), pt(10, 20)]
  assert.deepEqual(simplifyAutomationPoints(stacked, { tolerance: 1 }), [pt(0, 0), pt(10, 20)])
  assert.throws(() => simplifyAutomationPoints([pt(0, 0), pt(5, 1), pt(2, 2)], { tolerance: 1 }), /sorted by time/)
  assert.throws(() => simplifyAutomationPoints([pt(0, 0), pt(1, 1), pt(2, 2)], { tolerance: NaN }), AutomationSimplifyError)
})

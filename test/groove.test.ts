// Groove/shuffle warp tests (Phase 22 Stream AD; docs/research/22-opendaw-editing-workflow.md
// §3.2). Under test: warpStep is the identity at amount=0 (the format's canonical "off" default),
// unwarpStep is the EXACT inverse of warpStep for the same (amount, grid) — the verification bar's
// "exact round-trip" requirement — and a sanity check on direction (positive amount pushes the
// off-beat cell later, the classic shuffle feel).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { moebiusEase, warpStep, unwarpStep } from '../src/core/index.js'

test('warpStep is the identity when amount is 0 (the canonical "no groove" default)', () => {
  for (const step of [0, 0.5, 1, 1.9999, 4, 7.25, 100.3]) {
    assert.equal(warpStep(step, 0, 1), step)
    assert.equal(unwarpStep(step, 0, 1), step)
  }
})

test('warpStep is the identity when grid is non-positive (defensive no-op)', () => {
  assert.equal(warpStep(3.5, 0.6, 0), 3.5)
  assert.equal(warpStep(3.5, 0.6, -1), 3.5)
})

test('unwarpStep is the EXACT inverse of warpStep for the same (amount, grid)', () => {
  const amounts = [0.05, 0.2, 0.5, 0.6, 0.75, 1]
  const grids = [1, 2, 4, 0.5]
  const steps = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3.3, 4, 7.9, 16, 63.125]
  for (const amount of amounts) {
    for (const grid of grids) {
      for (const step of steps) {
        const warped = warpStep(step, amount, grid)
        const back = unwarpStep(warped, amount, grid)
        assert.ok(Math.abs(back - step) < 1e-9, `unwarp(warp(${step}, ${amount}, ${grid})) = ${back}, expected ${step}`)
      }
    }
  }
})

test('warpStep keeps cell boundaries fixed (a note exactly on the beat never moves)', () => {
  // Cells are [0,2),[2,4),... for grid=1 (cell = grid*2); boundaries are where x=0 or x=1.
  for (const amount of [0.1, 0.5, 0.9]) {
    for (const boundary of [0, 2, 4, 6, 100]) {
      assert.equal(warpStep(boundary, amount, 1), boundary)
    }
  }
})

test('positive amount pushes the off-beat position later (the classic shuffle push)', () => {
  // Within cell [0,2) (grid=1), the "off-beat" 16th sits at x=0.5 (step 1). A positive shuffle
  // amount should delay it (move it toward step 2), never advance it earlier.
  const straight = 1 // exactly halfway through the cell
  for (const amount of [0.1, 0.4, 0.8, 1]) {
    const warped = warpStep(straight, amount, 1)
    assert.ok(warped > straight, `amount ${amount}: expected the off-beat to push later (got ${warped})`)
    assert.ok(warped < 2, `amount ${amount}: must stay within its own cell (got ${warped})`)
  }
})

test('moebiusEase(0.5, h) === h (the documented "midpoint lands at h" property)', () => {
  for (const h of [0.5, 0.6, 0.75, 0.9]) {
    assert.ok(Math.abs(moebiusEase(0.5, h) - h) < 1e-12)
  }
})

test('moebiusEase preserves the [0,1] endpoints for any h', () => {
  for (const h of [0.5, 0.6, 0.99]) {
    assert.equal(moebiusEase(0, h), 0)
    assert.ok(Math.abs(moebiusEase(1, h) - 1) < 1e-12)
  }
})

test('warpStep handles multi-cell absolute positions (later bars shuffle the same way as bar 1)', () => {
  // step 33 is 1 into the cell starting at 32 (grid=1 -> cell size 2, cellIndex 16). Same relative
  // offset as step 1 (cell starting at 0) should warp by the same delta.
  const amount = 0.6
  const deltaBar1 = warpStep(1, amount, 1) - 1
  const deltaBar17 = warpStep(33, amount, 1) - 33
  assert.ok(Math.abs(deltaBar1 - deltaBar17) < 1e-9)
})

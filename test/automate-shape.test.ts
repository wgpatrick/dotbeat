// Phase 37 Stream RC — predefined automation SHAPES. Two layers under test:
//   (1) automationShapePoints — the PURE sampler: known-answer point counts and values for each
//       of the five shapes (ramp|sine|triangle|exp|adsr), plus its validation guards.
//   (2) applyAutomationShape — the edit primitive: span resolution (--bars / clip.loop / doc
//       loopBars), lane REPLACEMENT (a shape is the whole lane, not an addition), and the same
//       track-kind automatable-param gate every automation edit uses.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  automationShapePoints,
  AUTOMATION_SHAPES,
  AutomationShapeError,
  applyAutomationShape,
  addNote,
  saveClip,
  setClipLoop,
  initDocument,
  BeatEditError,
} from '../src/core/index.js'

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `expected ${a} ~= ${b}`)
const values = (pts: { time: number; value: number }[]) => pts.map((p) => p.value)
const times = (pts: { time: number; value: number }[]) => pts.map((p) => p.time)

// ---- (1) pure sampler: known answers ----

test('every shape emits exactly `points` points, first at time 0 and last at spanSteps', () => {
  for (const shape of AUTOMATION_SHAPES) {
    const pts = automationShapePoints(shape, { from: 0, to: 100, points: 12, spanSteps: 48 })
    assert.equal(pts.length, 12, `${shape} count`)
    close(pts[0]!.time, 0)
    close(pts[pts.length - 1]!.time, 48)
    // uniformly spaced
    for (let i = 0; i < pts.length; i++) close(pts[i]!.time, (48 * i) / 11)
  }
})

test('ramp is linear from->to', () => {
  const pts = automationShapePoints('ramp', { from: 0, to: 100, points: 5, spanSteps: 16 })
  assert.deepEqual(times(pts), [0, 4, 8, 12, 16])
  assert.deepEqual(values(pts), [0, 25, 50, 75, 100])
})

test('sine: one cycle starts at from, peaks at to at the quarter, returns to from', () => {
  const pts = automationShapePoints('sine', { from: 0, to: 100, cycles: 1, points: 5, spanSteps: 16 })
  const v = values(pts)
  close(v[0]!, 0)
  close(v[1]!, 50)
  close(v[2]!, 100) // half-cycle -> peak
  close(v[3]!, 50)
  close(v[4]!, 0) // full cycle -> back to from
})

test('triangle: linear up-then-down, peak at to', () => {
  const pts = automationShapePoints('triangle', { from: 0, to: 100, cycles: 1, points: 5, spanSteps: 16 })
  const v = values(pts)
  close(v[0]!, 0)
  close(v[1]!, 50)
  close(v[2]!, 100)
  close(v[3]!, 50)
  close(v[4]!, 0)
  // two cycles: peaks land at 1/4 and 3/4 of the span
  const two = values(automationShapePoints('triangle', { from: 0, to: 100, cycles: 2, points: 9, spanSteps: 32 }))
  close(two[0]!, 0)
  close(two[2]!, 100) // p=0.25 -> first peak
  close(two[4]!, 0) // p=0.5 -> trough
  close(two[6]!, 100) // p=0.75 -> second peak
  close(two[8]!, 0)
})

test('exp: eased, exact at both endpoints, monotonic between', () => {
  const pts = automationShapePoints('exp', { from: 200, to: 4000, points: 8, spanSteps: 32 })
  const v = values(pts)
  close(v[0]!, 200)
  close(v[v.length - 1]!, 4000)
  for (let i = 1; i < v.length; i++) assert.ok(v[i]! > v[i - 1]!, 'exp is monotonic increasing for to>from')
  // eased: rises SLOWER than linear early (below the linear midpoint at the halfway sample)
  const mid = v[Math.floor(v.length / 2)]!
  assert.ok(mid < (200 + 4000) / 2, 'exp curve sits below the linear ramp at the midpoint')
})

test('adsr: attack to peak, decay to sustain, hold, release to floor', () => {
  const v = values(automationShapePoints('adsr', { from: 0, to: 100, points: 11, spanSteps: 40 }))
  assert.equal(v.length, 11)
  close(v[0]!, 0) // p=0.0 start
  close(v[1]!, 50) // p=0.1 mid-attack
  close(v[2]!, 100) // p=0.2 peak (attack end)
  close(v[3]!, 80) // p=0.3 mid-decay toward sustain 60
  close(v[4]!, 60) // p=0.4 sustain level
  close(v[5]!, 60) // p=0.5 sustain hold
  close(v[7]!, 60) // p=0.7 still holding
  close(v[8]!, 60) // p=0.8 release start
  close(v[9]!, 30) // p=0.9 mid-release
  close(v[10]!, 0) // p=1.0 back to floor
})

test('sampler validation guards', () => {
  assert.throws(() => automationShapePoints('nope' as never, { from: 0, to: 1, spanSteps: 16 }), AutomationShapeError)
  assert.throws(() => automationShapePoints('ramp', { from: 0, to: 1, points: 1, spanSteps: 16 }), /points must be an integer >= 2/)
  assert.throws(() => automationShapePoints('ramp', { from: 0, to: 1, points: 4, spanSteps: 0 }), /spanSteps must be > 0/)
  assert.throws(() => automationShapePoints('sine', { from: 0, to: 1, cycles: 0, points: 4, spanSteps: 16 }), /cycles must be > 0/)
  assert.throws(() => automationShapePoints('ramp', { from: NaN, to: 1, points: 4, spanSteps: 16 }), /finite/)
})

// ---- (2) applyAutomationShape ----

function synthWithClip(loopBars = 2) {
  let doc = initDocument({ trackId: 'lead', loopBars })
  doc = addNote(doc, 'lead', { pitch: 60, start: 0, duration: 4, velocity: 0.8, id: 'n1' }).doc
  doc = addNote(doc, 'lead', { pitch: 64, start: 8, duration: 4, velocity: 0.8, id: 'n2' }).doc
  doc = saveClip(doc, 'lead', 'c1').doc
  return doc
}

test('applyAutomationShape writes a full lane and resolves span from doc loopBars', () => {
  const doc = synthWithClip(2)
  const { doc: next, spanSteps, points } = applyAutomationShape(doc, 'lead', 'c1', 'cutoff', 'ramp', { from: 200, to: 4000 })
  assert.equal(spanSteps, 32) // 2 bars * 16
  assert.equal(points.length, 16) // default points
  const lane = next.tracks.find((t) => t.id === 'lead')!.clips.find((c) => c.id === 'c1')!.automation.find((l) => l.param === 'cutoff')!
  assert.ok(lane, 'cutoff lane exists')
  assert.equal(lane.points.length, 16)
  close(lane.points[0]!.value, 200)
  close(lane.points[lane.points.length - 1]!.value, 4000)
  close(lane.points[0]!.time, 0)
  close(lane.points[lane.points.length - 1]!.time, 32)
})

test('--bars overrides the span', () => {
  const doc = synthWithClip(4)
  const { spanSteps, points } = applyAutomationShape(doc, 'lead', 'c1', 'cutoff', 'sine', { from: 300, to: 6000, cycles: 2, points: 24, bars: 1 })
  assert.equal(spanSteps, 16) // 1 bar override, not the doc's 4
  assert.equal(points.length, 24)
})

test("a clip's own loop range drives the span when present", () => {
  let doc = synthWithClip(2)
  doc = setClipLoop(doc, 'lead', 'c1', { start: 0, end: 4 })
  const { spanSteps } = applyAutomationShape(doc, 'lead', 'c1', 'cutoff', 'ramp', { from: 0, to: 1, points: 4 })
  assert.equal(spanSteps, 64) // (4-0) bars * 16
})

test('a shape REPLACES any existing lane for that param (not appends)', () => {
  const doc = synthWithClip(2)
  const once = applyAutomationShape(doc, 'lead', 'c1', 'cutoff', 'ramp', { from: 200, to: 4000, points: 16 }).doc
  const twice = applyAutomationShape(once, 'lead', 'c1', 'cutoff', 'triangle', { from: 500, to: 3000, points: 8 }).doc
  const lane = twice.tracks.find((t) => t.id === 'lead')!.clips.find((c) => c.id === 'c1')!.automation.find((l) => l.param === 'cutoff')!
  assert.equal(lane.points.length, 8, 'replaced, not 16+8')
  close(lane.points[0]!.value, 500)
  // ids mint cleanly on the cleared lane
  assert.equal(lane.points[0]!.id, 'p1')
})

test('gate: rejects a non-automatable param', () => {
  const doc = synthWithClip(2)
  assert.throws(() => applyAutomationShape(doc, 'lead', 'c1', 'osc', 'ramp', { from: 0, to: 1 }), BeatEditError)
  assert.throws(() => applyAutomationShape(doc, 'lead', 'nope', 'cutoff', 'ramp', { from: 0, to: 1 }), /no clip "nope"/)
})

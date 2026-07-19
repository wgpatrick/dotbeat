// CMA-ES verified on standard test functions with known optima BEFORE it ever touches audio
// (the same tested-against-ground-truth discipline as test/metrics.test.ts) — if these numbers
// hold, the optimizer half of `beat match` is correct and any matching failure is the loss,
// the search space, or the engine.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CmaEs, SeededRandom, jacobiEigen, minimize } from '../src/match/cmaes.js'

const sphere = (x: number[]) => x.reduce((a, v) => a + v * v, 0)
const rosenbrock = (x: number[]) => {
  let sum = 0
  for (let i = 0; i < x.length - 1; i++) {
    sum += 100 * (x[i + 1]! - x[i]! * x[i]!) ** 2 + (1 - x[i]!) ** 2
  }
  return sum
}

test('SeededRandom is deterministic and roughly standard-normal', () => {
  const a = new SeededRandom(7)
  const b = new SeededRandom(7)
  const seqA = Array.from({ length: 100 }, () => a.gaussian())
  const seqB = Array.from({ length: 100 }, () => b.gaussian())
  assert.deepEqual(seqA, seqB)
  const big = new SeededRandom(1)
  const n = 20000
  let mean = 0
  let sq = 0
  for (let i = 0; i < n; i++) {
    const v = big.gaussian()
    mean += v / n
    sq += (v * v) / n
  }
  assert.ok(Math.abs(mean) < 0.03, `gaussian mean ${mean}`)
  assert.ok(Math.abs(sq - 1) < 0.05, `gaussian variance ${sq}`)
})

test('jacobiEigen recovers a known symmetric decomposition', () => {
  // A = [[2,1],[1,2]] has eigenvalues 1 and 3.
  const { values, vectors } = jacobiEigen([
    [2, 1],
    [1, 2],
  ])
  const sorted = [...values].sort((a, b) => a - b)
  assert.ok(Math.abs(sorted[0]! - 1) < 1e-10)
  assert.ok(Math.abs(sorted[1]! - 3) < 1e-10)
  // Reconstruct A = V diag(values) V^T
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      let sum = 0
      for (let k = 0; k < 2; k++) sum += vectors[i]![k]! * values[k]! * vectors[j]![k]!
      const expect = i === j ? 2 : 1
      assert.ok(Math.abs(sum - expect) < 1e-10, `reconstruction [${i}][${j}] = ${sum}`)
    }
  }
})

test('CMA-ES solves 8-dim sphere to 1e-8', () => {
  const best = minimize(sphere, new Array(8).fill(3), 1.0, { seed: 41, maxEvaluations: 4000 })
  assert.ok(best.value < 1e-8, `sphere best ${best.value} after ${best.evals} evals`)
})

test('CMA-ES solves 5-dim rosenbrock to 1e-4 (the banana valley, where plain gradient descent crawls)', () => {
  const best = minimize(rosenbrock, new Array(5).fill(0), 0.5, { seed: 41, maxEvaluations: 30000 })
  assert.ok(best.value < 1e-4, `rosenbrock best ${best.value} after ${best.evals} evals`)
  for (const v of best.x) assert.ok(Math.abs(v - 1) < 0.05, `rosenbrock x ${best.x.join(',')}`)
})

test('CMA-ES respects box bounds and still finds an interior optimum ([0,1]^6, optimum at 0.7)', () => {
  const shifted = (x: number[]) => x.reduce((a, v) => a + (v - 0.7) * (v - 0.7), 0)
  const es = new CmaEs(new Array(6).fill(0.5), 0.3, {
    seed: 41,
    populationSize: 12,
    lowerBounds: new Array(6).fill(0),
    upperBounds: new Array(6).fill(1),
  })
  for (let g = 0; g < 200; g++) {
    const pts = es.ask()
    for (const p of pts) for (const v of p) assert.ok(v >= 0 && v <= 1, `out-of-bounds sample ${v}`)
    es.tell(pts, pts.map(shifted))
  }
  assert.ok(es.best !== null && es.best.value < 1e-8, `bounded best ${es.best?.value}`)
})

test('CMA-ES finds a boundary optimum without escaping the box (optimum at the 1.0 edge)', () => {
  const edge = (x: number[]) => x.reduce((a, v) => a + (v - 1.2) * (v - 1.2), 0) // unconstrained optimum outside the box
  const es = new CmaEs(new Array(4).fill(0.3), 0.3, {
    seed: 41,
    populationSize: 10,
    lowerBounds: new Array(4).fill(0),
    upperBounds: new Array(4).fill(1),
  })
  for (let g = 0; g < 120; g++) {
    const pts = es.ask()
    es.tell(pts, pts.map(edge))
  }
  assert.ok(es.best !== null)
  for (const v of es.best!.x) assert.ok(v > 0.97 && v <= 1, `boundary x ${es.best!.x.join(',')}`)
})

test('CMA-ES is deterministic under a seed', () => {
  const run = () => minimize(sphere, [2, 2, 2], 1.0, { seed: 99, maxEvaluations: 500 })
  const a = run()
  const b = run()
  assert.deepEqual(a.x, b.x)
  assert.equal(a.value, b.value)
})

test('ask/tell contract: tell rejects mismatched batch sizes', () => {
  const es = new CmaEs([0, 0], 0.5, { seed: 1, populationSize: 6 })
  const pts = es.ask()
  assert.throws(() => es.tell(pts.slice(1), pts.slice(1).map(sphere)))
})

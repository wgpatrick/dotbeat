// Per-note chance tests (Phase 22 Stream AD; docs/research/22-opendaw-editing-workflow.md §3.3).
// Under test: the canonical elision short-circuits (chance>=100 always fires, chance<=0 never
// fires, without touching the RNG), determinism (same pass/track/note always draws the same way),
// independence (different notes/tracks/passes draw differently), and — the verification bar's
// statistical check — chance=50 fires roughly half of many passes. This exercises the RNG logic
// directly (fast, exact) rather than rendering audio repeatedly, per the task's own suggested
// alternative to a slow render-100-times check.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chanceFires } from '../src/core/index.js'

test('chance >= 100 always fires (the pre-v0.10 default behavior)', () => {
  for (let pass = 0; pass < 50; pass++) {
    assert.equal(chanceFires(100, pass, 'lead', 'n1'), true)
    assert.equal(chanceFires(150, pass, 'lead', 'n1'), true) // defensively >100 too
  }
})

test('chance <= 0 never fires', () => {
  for (let pass = 0; pass < 50; pass++) {
    assert.equal(chanceFires(0, pass, 'lead', 'n1'), false)
  }
})

test('the same (chance, pass, track, note) always draws the same result (reproducible)', () => {
  const a = chanceFires(50, 7, 'lead', 'n42')
  const b = chanceFires(50, 7, 'lead', 'n42')
  assert.equal(a, b)
})

test('different notes draw independently within the same pass (not all-or-nothing)', () => {
  const results = new Set<boolean>()
  for (let i = 0; i < 30; i++) results.add(chanceFires(50, 3, 'lead', `n${i}`))
  assert.equal(results.size, 2, 'a 30-note spread at chance=50 should include both true and false')
})

test('the same note draws independently across different passes (re-rolled per pass, not baked once)', () => {
  const results = new Set<boolean>()
  for (let pass = 0; pass < 40; pass++) results.add(chanceFires(50, pass, 'lead', 'n1'))
  assert.equal(results.size, 2, 'a 40-pass run at chance=50 should include both true and false')
})

test('a different track scopes the draw independently from the same note id on another track', () => {
  // Not asserting a specific relationship (that would be testing the hash's exact bits) — just
  // that trackId is actually folded into the seed, i.e. two tracks don't always agree.
  let sameCount = 0
  const total = 60
  for (let pass = 0; pass < total; pass++) {
    if (chanceFires(50, pass, 'trackA', 'n1') === chanceFires(50, pass, 'trackB', 'n1')) sameCount++
  }
  assert.ok(sameCount < total, 'two tracks must not always draw identically')
})

test('statistical: chance=50 fires roughly half of many playback passes', () => {
  const passes = 2000
  let fired = 0
  for (let pass = 0; pass < passes; pass++) {
    if (chanceFires(50, pass, 'lead', 'kick0')) fired++
  }
  const rate = fired / passes
  assert.ok(rate > 0.4 && rate < 0.6, `expected ~50% over ${passes} passes, got ${(rate * 100).toFixed(1)}%`)
})

test('statistical: chance=70 fires roughly 70% of many playback passes', () => {
  const passes = 2000
  let fired = 0
  for (let pass = 0; pass < passes; pass++) {
    if (chanceFires(70, pass, 'lead', 'hat3')) fired++
  }
  const rate = fired / passes
  assert.ok(rate > 0.6 && rate < 0.8, `expected ~70% over ${passes} passes, got ${(rate * 100).toFixed(1)}%`)
})

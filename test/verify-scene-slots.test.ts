// A headless guard on the ui/verify-*.mjs scripts' hand-built documents.
//
// Phase 30 diagnosis. `npm run verify:engine` reported ui/verify-phase26-stream-da.mjs failing with
// "time-vs-balance correlation of exactly 0.000" on a left→right pan automation ramp. The engine
// was fine: an offline render of the equivalent fixture (cli/render.mjs --offline, the
// test/fixtures/clip-automation path) measures corr(time, balance) = -0.915 with a real 5.5:1 L/R
// split. The script's own document was stale — it wrote the pre-v0.11 scene-slot shape
//
//     scenes: [{ id: 'main', slots: { t1: 'verse' } }]          // a bare clip id
//
// where v0.11 (Phase 36 / D16) made a slot an ARRAY OF PLACEMENTS:
//
//     scenes: [{ id: 'main', slots: { t1: [{ clip: 'verse', at: 0 }] } }]
//
// ui/src/types.ts's firstPlacementClip spreads the value and sortPlacements sorts it, so a string
// became its own characters and `a.clip.localeCompare` threw — the track resolved NO content and
// both takes recorded digital silence. The measurement then laundered that into a number: the
// script's panSeries() emits exactly 0 for a silent window and its corr() returns exactly 0 on a
// zero-variance series through its `|| 1e-12` guard. "0.000" read like a measurement; it was the
// absence of one.
//
// These scripts need a browser, a daemon and a vite preview, so `node --test` cannot RUN them —
// but it can read them, and the stale shape is exactly the kind of silent staleness that survives
// precisely because nobody re-reads a passing-looking script. This test costs milliseconds.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const uiDir = join(repoRoot, 'ui')

/**
 * Scripts still carrying the pre-v0.11 shape as of 2026-07-26, each in a NON-engine verify tier
 * (`node scripts/verify-run.mjs --tier engine --list` does not select any of them). Listed rather
 * than silently excluded so they stay visible: each needs the same one-line change plus a real run
 * to confirm what it starts asserting once its document actually plays. Delete an entry as it is
 * fixed; this list must only ever shrink.
 */
const KNOWN_STALE = new Set([
  'verify-phase24-stream-ch.mjs',
  'verify-phase24-stream-cj.mjs',
  'verify-phase27-stream-ef.mjs',
  'verify-phase28-stream-fd.mjs',
])

/** A script's code with line comments stripped — the fix's own explanatory comment quotes the
 * broken shape verbatim, and a scanner that can't tell code from prose is a scanner nobody trusts. */
const code = (name: string) =>
  readFileSync(join(uiDir, name), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')

/** `slots: { <track>: '<clipId>' }` — a bare clip id where a BeatPlacement[] belongs. The
 * `[^}[\]]` run keeps the scan from stepping into a correctly-shaped `[{ clip: '…' }]` array,
 * whose inner `clip:` would otherwise look like the bug. */
const STALE_SLOT = /slots:\s*\{[^}[\]]*?[\w$]+\s*:\s*['"]/

test('no engine-tier verify script hands setDoc a pre-v0.11 scene-slot shape', () => {
  const scripts = readdirSync(uiDir).filter((f) => f.startsWith('verify-') && f.endsWith('.mjs'))
  assert.ok(scripts.length > 10, 'expected to find the ui/verify-*.mjs suite')
  const offenders = scripts.filter((f) => !KNOWN_STALE.has(f) && STALE_SLOT.test(code(f)))
  assert.deepEqual(
    offenders,
    [],
    `these scripts map a scene slot to a bare clip id; since v0.11 a slot is a BeatPlacement[]:\n` +
      `  slots: { t1: 'verse' }   ->   slots: { t1: [{ clip: 'verse', at: 0 }] }\n` +
      `firstPlacementClip/sortPlacements (ui/src/types.ts) throw on the old shape, the track plays ` +
      `nothing, and any audio assertion over the silence measures nothing.`,
  )
})

test('the KNOWN_STALE list only shrinks — every entry still has the stale shape', () => {
  for (const name of KNOWN_STALE) {
    const src = code(name)
    assert.ok(
      STALE_SLOT.test(src),
      `${name} no longer carries the pre-v0.11 slot shape — remove it from KNOWN_STALE in this test`,
    )
  }
})

test('the pan-automation check refuses to score a silent or mono take', () => {
  // The tripwire added alongside the fix: the failure mode that hid this bug was a silent recording
  // scored as a number. A take with no audio must fail as "nothing played", never as a correlation.
  const src = readFileSync(join(uiDir, 'verify-phase26-stream-da.mjs'), 'utf8')
  assert.match(src, /recorded silence/, 'the silence tripwire must run before any balance maths')
  assert.match(src, /is mono \(identical L\/R\)/, 'and a mono take must be refused too')
  assert.ok(
    src.indexOf('recorded silence') < src.indexOf('const rampCorr'),
    'the tripwire must come BEFORE the correlation is computed, not after',
  )
})

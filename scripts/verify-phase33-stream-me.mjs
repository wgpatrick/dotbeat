#!/usr/bin/env node
// Phase 33 Stream ME verification (docs/phase-33-plan.md "ME — Macro curve fix + small CLI UX
// papercuts", docs/research/100-usability-pilot-cli-macro-effects.md,
// docs/research/96-usability-pilot-cli-vary-loop.md). Real `beat` CLI invocations (execFileSync,
// no mocking) against a disposable /tmp scratch project — matching the CLI/MCP pilot verification
// discipline docs/usability-testing.md establishes. examples/night-shift-song.beat is never
// touched.
//
// ITEM 1  Macro curve "exp" was implemented as a plain quadratic (`min+(max-min)*t^2`), not a true
//         exponential/log curve, despite its name (research/100, reverse-engineered from
//         filter-sweep's cutoff target). Chosen fix: OPTION (b), rename the curve types to honest
//         labels ('quadIn'/'quadOut') rather than switch to a real log-space curve — a genuine
//         exponential needs a strictly-positive `min` (breaks for grit's `distortionAmount`,
//         min 0) and would keep that macro's resolved value within a hair of 0 for roughly the
//         first three-quarters of the knob's travel, a real regression, not a correctness fix. So
//         this check confirms: (1) the resolved NUMERIC VALUE for filter-sweep's cutoff at knob=70
//         is UNCHANGED from research/100's own directly-observed value (8860.8 — no silent
//         re-tuning of existing macros), (2) `beat macro list --json` now reports the honest label
//         "quadIn" instead of "exp", and (3) the raw .beat file still shows zero indirection (the
//         resolved value sits as a plain literal, matching research/100's own "no indirection"
//         check).
// ITEM 2  `beat score` used to accept only bare integer picks ("1"), even though variants are
//         always DISPLAYED as "v1"/"v2" everywhere else (research/96). Now accepts either form.
//         Checks: "v1" and "1" both score the SAME variant with the SAME log entry; the existing
//         bare-integer form still works exactly as before; an out-of-range "vN" still errors
//         clearly.
// ITEM 3  `effect-move`'s musical diff used to print one "moved from X to Y" line per effect whose
//         POSITION NUMBER shifted (4 lines for a mid-chain move), even though only one effect
//         conceptually moved — chattier than the 2-line raw file diff for the same edit
//         (research/98). Checks: moving one effect in a multi-effect chain now prints exactly ONE
//         "moved from X to Y" line.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const beatCli = join(repoRoot, 'cli', 'beat.mjs')

function beat(args, opts = {}) {
  return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8', cwd: scratch, ...opts })
}

function beatFails(args, opts = {}) {
  try {
    beat(args, opts)
    throw new Error(`expected "beat ${args.join(' ')}" to fail, but it succeeded`)
  } catch (err) {
    if (err.status === undefined) throw err // our own thrown Error above, not an execFileSync failure
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

// vary's default --out-dir is relative to CWD, not the project file — beat() above runs every
// invocation with cwd=scratch so batch dirs land next to song.beat, not in the repo root.
const scratch = mkdtempSync(join(tmpdir(), 'dotbeat-phase33-me-'))
const projFile = join(scratch, 'song.beat')
console.log(`scratch project: ${scratch}`)

try {
  // ---- setup: a small real project ----------------------------------------------------------
  beat(['init', projFile, '--bpm', '120']) // init already creates a starter synth track called "lead"

  // ============================================================================================
  // ITEM 1 — macro curve rename, not a silent behavior change
  // ============================================================================================
  console.log('\n=== ITEM 1: macro curve exp -> quadIn (label fix, values unchanged) ===')

  const macroListJson = JSON.parse(beat(['macro', 'list', '--json']))
  const filterSweep = macroListJson.find((m) => m.name === 'filter-sweep')
  assert.ok(filterSweep, 'factory library must still have filter-sweep')
  const cutoffTarget = filterSweep.targets.find((t) => t.param === 'cutoff')
  assert.equal(cutoffTarget.curve, 'quadIn', `[1] BUG: expected the honest label "quadIn", got "${cutoffTarget.curve}"`)
  assert.notEqual(cutoffTarget.curve, 'exp', '[1] BUG: "exp" should no longer appear anywhere in the factory library')
  console.log(`[1] PASS: macro list --json reports curve "${cutoffTarget.curve}" (not "exp")`)

  const applyOut = beat(['macro', 'apply', projFile, 'lead', 'filter-sweep', '70'])
  console.log(`[1] apply output: ${applyOut.trim()}`)
  // research/100's own directly-observed value for this exact target/knob before this fix:
  // min 80, max 18000, t=0.7 -> 80 + 17920*0.49 = 8860.8. Confirming this is UNCHANGED is the
  // whole point of choosing the rename (option b) over a real log-space curve (option a) — no
  // existing macro's resolved sound silently changes.
  const expectedCutoff = 80 + (18000 - 80) * 0.7 * 0.7
  assert.ok(Math.abs(expectedCutoff - 8860.8) < 1e-9, `sanity: expected formula should reproduce research/100's 8860.8, got ${expectedCutoff}`)

  const rawText = readFileSync(projFile, 'utf8')
  const cutoffLineMatch = rawText.match(/^\s*cutoff\s+([\d.]+)\s*$/m)
  assert.ok(cutoffLineMatch, '[1] BUG: no literal "cutoff <value>" line found in the raw .beat file')
  const actualCutoff = Number(cutoffLineMatch[1])
  assert.ok(Math.abs(actualCutoff - expectedCutoff) < 1e-6, `[1] BUG: resolved cutoff ${actualCutoff} does not match expected quadIn value ${expectedCutoff} — a macro's resolved sound changed silently`)
  console.log(`[1] PASS: resolved cutoff = ${actualCutoff} (matches research/100's directly-observed 8860.8, byte-for-byte-equivalent formula, no re-tuning)`)

  // no-indirection check, mirroring research/100's own ground-truth read
  assert.ok(!/macro/i.test(rawText), '[1] BUG: raw file must contain no trace of the macro name/identity')
  console.log('[1] PASS: no macro indirection left in the file (grep for "macro" finds nothing)')

  // A macro library that still uses the OLD "exp"/"log" curve names must be rejected with a clear
  // error (not silently accepted as some other meaning) — confirms the validation was updated
  // alongside the resolver, not just the shipped presets/macros.json content.
  const staleMacros = JSON.stringify({
    version: 1,
    macros: [{ name: 'stale', kind: 'synth', category: 'tone', description: 'd', targets: [{ param: 'cutoff', min: 80, max: 18000, curve: 'exp' }] }],
  })
  const staleMacrosPath = join(scratch, 'stale-macros.json')
  writeFileSync(staleMacrosPath, staleMacros)
  const staleResult = beatFails(['macro', 'list'], { env: { ...process.env, BEAT_MACROS: staleMacrosPath } })
  assert.equal(staleResult.status, 2, `[1] BUG: a library using the old "exp" curve name should fail with exit 2, got ${staleResult.status}`)
  assert.match(staleResult.stderr, /invalid curve/, `[1] BUG: expected a clear "invalid curve" error, got: ${staleResult.stderr}`)
  console.log('[1] PASS: a macro library still using the old "exp"/"log" names is rejected with a clear error, not silently reinterpreted')

  // ============================================================================================
  // ITEM 2 — beat score accepts v1 AND 1
  // ============================================================================================
  console.log('\n=== ITEM 2: beat score accepts "v1" or "1" ===')

  beat(['add-note', projFile, 'lead', '60', '0', '4', '0.8'])
  const varyOut = beat(['vary', projFile, 'lead', 'filter', '--count', '3', '--amount', '0.3', '--seed', '42'])
  const batchDir = join(scratch, 'vary-filter-42') // vary's default --out-dir shape: vary-<group>-<seed>
  const manifestPath = join(batchDir, 'manifest.json')
  assert.ok(readFileSync(manifestPath, 'utf8').length > 0, `[2] setup: expected a manifest at ${manifestPath}; vary output was:\n${varyOut}`)

  const scoreLog = join(scratch, 'scores-v1-form.jsonl')
  const vFormOut = beat(['score', batchDir, 'v1', '--log', scoreLog])
  assert.match(vFormOut, /scored .*: v1 ->/, `[2] BUG: "v1"-form pick did not score cleanly: ${vFormOut}`)
  console.log(`[2] PASS: "beat score <dir> v1" works — ${vFormOut.trim()}`)

  const scoreLog2 = join(scratch, 'scores-bare-form.jsonl')
  const bareFormOut = beat(['score', batchDir, '1', '--log', scoreLog2])
  assert.match(bareFormOut, /scored .*: v1 ->/, `[2] BUG: bare-integer pick regressed: ${bareFormOut}`)
  console.log(`[2] PASS: "beat score <dir> 1" (bare integer, pre-existing form) still works unchanged — ${bareFormOut.trim()}`)

  // both forms must have logged an IDENTICAL entry (same variant, same edits) — confirms
  // normalization, not two different code paths that happen to both "succeed".
  const entry1 = JSON.parse(readFileSync(scoreLog, 'utf8').trim())
  const entry2 = JSON.parse(readFileSync(scoreLog2, 'utf8').trim())
  assert.deepEqual(entry1.picks, entry2.picks, '[2] BUG: "v1" and "1" picks produced different logged entries — not truly equivalent')
  console.log('[2] PASS: "v1" and "1" normalize to the identical scored entry')

  // mixed multi-pick form
  const mixedLog = join(scratch, 'scores-mixed.jsonl')
  const mixedOut = beat(['score', batchDir, 'v2', '1', 'v3', '--log', mixedLog])
  assert.match(mixedOut, /scored .*: v2 > v1 > v3 ->/, `[2] BUG: mixed v-prefixed/bare picks did not score correctly: ${mixedOut}`)
  console.log(`[2] PASS: mixed "v2 1 v3" picks all resolve correctly — ${mixedOut.trim()}`)

  // out-of-range v-form still errors clearly, exit 2, and mentions both accepted forms
  const badPick = beatFails(['score', batchDir, 'v99'])
  assert.equal(badPick.status, 2, `[2] BUG: out-of-range "v99" pick should exit 2, got ${badPick.status}`)
  assert.match(badPick.stderr, /not a variant number 1-3/, `[2] BUG: unexpected error text: ${badPick.stderr}`)
  console.log(`[2] PASS: out-of-range "v99" still errors cleanly: ${badPick.stderr.trim()}`)

  // ============================================================================================
  // ITEM 3 — effect-move's diff is proportionate to the edit (one line, not one per shifted index)
  // ============================================================================================
  console.log('\n=== ITEM 3: effect-move prints one "moved" line, not one per shifted effect ===')

  // lead already has the 4 default effects (eq3, comp, distortion, bitcrush) from add-track.
  beat(['effect-add', projFile, 'lead', 'autoPan', '--id', 'ap1'])
  const moveOut = beat(['effect-move', projFile, 'lead', 'ap1', '0'])
  const movedLines = moveOut.split('\n').filter((l) => / moved from position \d+ to \d+/.test(l))
  console.log(`[3] effect-move output:\n${moveOut}`)
  assert.equal(movedLines.length, 1, `[3] BUG: expected exactly 1 "moved from X to Y" line for a single-effect reorder, got ${movedLines.length}:\n${moveOut}`)
  assert.match(movedLines[0], /^lead: effect ap1 moved from position 4 to 0$/, `[3] BUG: unexpected moved-line text: ${movedLines[0]}`)
  console.log(`[3] PASS: exactly one "moved" line for a single-effect reorder — "${movedLines[0]}"`)

  console.log('\n================ ALL PHASE 33 STREAM ME CHECKS PASSED ================')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

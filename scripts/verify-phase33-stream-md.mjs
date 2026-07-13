#!/usr/bin/env node
// Live, CLI-level verification for Phase 33 Stream MD (`beat inspect`/`lint`/`quantize`
// correctness — docs/phase-33-plan.md's MD section, sourced from research/98). Drives the REAL
// `beat` CLI end-to-end against disposable scratch projects under the OS tmpdir (never touches
// examples/night-shift-song.beat), exactly the way an agent following the `dotbeat` skill would.
//
// Covers all 3 items:
//   1. `beat inspect`'s plain-text view now shows track groups (it silently omitted them before).
//   2. `beat lint --doc <file.beat>` names the actual offending track in a finding's suggestion,
//      via a real per-track solo render/analyze pass (not a declared-param guess) — item 2 is the
//      slow one (drives cli/render.mjs's headless-Chromium pipeline for real audio).
//   3. `beat quantize` now warns on stdout when it pushes a note past the clip's own loop boundary,
//      instead of doing so silently.
//
// Usage: npm run build && node scripts/verify-phase33-stream-md.mjs
// (needs `ui/` built too for item 2 — `cd ui && npm run build` — since it drives cli/render.mjs)

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const beat = join(repoRoot, 'cli', 'beat.mjs')
const dir = mkdtempSync(join(tmpdir(), 'dotbeat-verify-md-'))

let checks = 0
function ok(label) {
  checks++
  console.log(`  ok — ${label}`)
}

/** Runs `beat <args>`, throwing on a non-zero exit (the common case: most commands here are
 * expected to succeed cleanly). */
function run(...args) {
  return execFileSync(process.execPath, [beat, ...args], { encoding: 'utf8', cwd: dir })
}

/** Runs `beat <args>` but tolerates a non-zero exit (lint's own contract: it sets exit code 1
 * when a warn-level finding fires — expected and desired in the item-2 scenario below, which
 * deliberately engineers a true-peak/low-end finding). Returns stdout either way. */
function runLenient(...args) {
  try {
    return execFileSync(process.execPath, [beat, ...args], { encoding: 'utf8', cwd: dir })
  } catch (e) {
    return e.stdout ?? ''
  }
}

try {
  // ================================================================================
  // Item 1 — `beat inspect`'s plain-text view showing track groups
  // ================================================================================
  console.log('1. inspect plain-text view shows track groups')
  const file1 = join(dir, 'groups.beat')
  run('init', file1, '--bpm', '120', '--bars', '2')
  run('add-track', file1, 'bass', 'synth')
  run('add-track', file1, 'drums', 'drums')

  const beforeGroup = run('inspect', file1)
  assert.ok(!/group/i.test(beforeGroup), 'ungrouped project: plain inspect mentions no groups at all')
  ok('a fresh, ungrouped project shows no group text in plain inspect (sanity baseline)')

  const groupOut = run('group', file1, 'rhythm', 'bass', 'drums', '--name', 'RhythmSection')
  assert.match(groupOut, /group added/i, 'group command itself reports success')

  const afterGroup = run('inspect', file1)
  assert.match(afterGroup, /group rhythm: "RhythmSection"/, 'a top-level groups section names the group and its display name')
  assert.match(afterGroup, /group rhythm:.*bass.*drums|group rhythm:.*drums.*bass/, "the group's section lists both member tracks")
  assert.match(afterGroup, /^bass\s+"bass"\s+synth\s+#\w+\s+group: rhythm \("RhythmSection"\)/m, "bass's own track line carries a per-track group membership marker")
  assert.match(afterGroup, /^drums\s+"drums"\s+drums\s+#\w+\s+group: rhythm \("RhythmSection"\)/m, "drums' own track line carries a per-track group membership marker")
  ok('after grouping, plain inspect shows BOTH a groups section AND per-track membership markers (research/98\'s exact gap)')

  // --json and diff --git already worked per research/98 — confirm inspect --json still does (no
  // regression from the plain-text change) and that the two views agree on membership.
  const jsonAfterGroup = JSON.parse(run('inspect', file1, '--json'))
  assert.deepEqual(jsonAfterGroup.groups[0].tracks.sort(), ['bass', 'drums'], '--json still correctly reports group membership')
  ok('--json view unaffected (still correct) — plain-text was the only gap, and it\'s now fixed')

  run('rm-group', file1, 'rhythm')
  const afterUngroup = run('inspect', file1)
  assert.ok(!/group/i.test(afterUngroup), 'after rm-group, plain inspect mentions no groups again (member tracks left ungrouped, untouched)')
  ok('rm-group cleanly removes the group section and both tracks\' membership markers from plain inspect')

  // ================================================================================
  // Item 3 — `beat quantize` warns when it pushes a note past the loop's own boundary
  // ================================================================================
  console.log('2. quantize warns on a note pushed past the loop boundary')
  const file3 = join(dir, 'quantize.beat')
  run('init', file3, '--bpm', '120', '--bars', '4') // 4 bars = 64 steps, valid steps 0-63 — same shape as research/98's repro
  // Mirrors research/98's exact repro: a note at step 62 (not on a quarter-note/grid-4 boundary),
  // duration 2, quantized to grid 4 -> rounds to step 64, one step past the loop's own end.
  run('add-note', file3, 'lead', '76', '62', '2', '0.5')
  const quantizeOut = run('quantize', file3, 'lead', '--grid', '4')
  assert.match(quantizeOut, /warning:.*past this 64-step loop's own boundary/, 'quantize prints a clear warning naming the loop length')
  assert.match(quantizeOut, /at step 66/, 'the warning names the actual step the note now ends at (64 start + 2 duration)')
  ok('quantizing a note from step 62 to step 64 in a 64-step loop prints a boundary warning (research/98\'s exact repro, now caught)')

  const inspectAfterOverflow = run('inspect', file3)
  assert.match(inspectAfterOverflow, /steps 64-64 of 64/, 'inspect independently confirms the note now sits at/past the loop\'s own boundary')

  // Negative check: a quantize that stays safely in-bounds prints no boundary warning (no false positives).
  const file3b = join(dir, 'quantize-safe.beat')
  run('init', file3b, '--bpm', '120', '--bars', '4')
  run('add-note', file3b, 'lead', '76', '30', '2', '0.5')
  const safeOut = run('quantize', file3b, 'lead', '--grid', '4')
  assert.ok(!/warning:/.test(safeOut), 'a quantize that stays in-bounds (step 30 -> 32) prints no spurious boundary warning')
  ok('an in-bounds quantize (step 30 -> 32, well under 64) prints no warning — no false positives')

  // ================================================================================
  // Item 2 — `beat lint --doc` names the actual offending track (real per-track audio)
  // ================================================================================
  console.log('3. lint --doc names the actual offending track (real per-track solo render/analyze)')
  const file2 = join(dir, 'mix.beat')
  run('init', file2, '--bpm', '120', '--bars', '1') // short: minimizes render time (2s of audio)
  run('add-track', file2, 'sub', 'synth', '--name', 'Sub')
  // "lead" (the default starter track) stays quiet and bright — should NOT be named as the
  // offender for either rule. "sub" is cranked hot and heavily low-pass filtered — the real,
  // measurable offender for both true-peak-clipping and low-end-heavy.
  run('set', file2, 'lead.volume', '-24', 'sub.volume', '12', 'sub.cutoff', '150')
  run('add-note', file2, 'lead', '72', '0', '4', '0.3')
  run('add-note', file2, 'sub', '36', '0', '4', '1')

  const wavFile = join(dir, 'mix.wav')
  run('render', file2, '-o', wavFile)

  // Baseline: no --doc -> suggestions stay exactly as generic as before this item (regression check).
  const baselineJson = JSON.parse(runLenient('lint', wavFile, '--json'))
  assert.ok(baselineJson.length > 0, 'the deliberately hot/bass-heavy mix trips at least one lint finding')
  const baselineWithSuggestion = baselineJson.filter((f) => f.suggestion)
  assert.ok(baselineWithSuggestion.length > 0, 'at least one finding carries a suggestion')
  for (const f of baselineWithSuggestion) {
    // Only check for the "sub" track id, not "lead" — "lead" is both a real track id in this
    // project AND a pre-existing, unrelated word in the dull-top-end rule's generic hardcoded
    // text ("open filters on lead/hat tracks"), so it can't reliably signal a wrongly-injected
    // track name.
    assert.ok(!/\bsub\b/.test(f.suggestion), `without --doc, suggestion for "${f.rule}" stays generic (no track named): ${f.suggestion}`)
  }
  ok('without --doc, suggestions are unchanged from before this item — generic, no track named (backward compatible)')

  // With --doc: real per-track solo renders happen, and the suggestion for the rule(s) that fired
  // should name "sub" specifically — the actually-engineered offender, not a guess.
  const withDocJson = JSON.parse(runLenient('lint', wavFile, '--doc', file2, '--json'))
  assert.deepEqual(
    withDocJson.map((f) => f.rule).sort(),
    baselineJson.map((f) => f.rule).sort(),
    '--doc does not change WHICH rules fire, only enriches their suggestions',
  )
  const namedFindings = withDocJson.filter((f) => f.suggestion)
  assert.ok(namedFindings.length > 0, 'at least one finding still carries a suggestion with --doc')
  // "sub" was deliberately engineered (loud + heavily low-passed) to be the unambiguous real
  // offender for these specific rules — assert it's named exactly, and "lead" (quiet + bright)
  // never wrongly is. Rules NOT tied to volume/spectral balance (e.g. effectively-mono, which
  // depends on incidental stereo width — neither track was deliberately engineered there) may
  // legitimately point at either track; only check those are well-formed, not which track they name.
  const engineeredRules = new Set(['true-peak-clipping', 'low-end-heavy', 'dull-top-end', 'loudness-vs-target'])
  let namedSub = 0
  for (const f of namedFindings) {
    if (engineeredRules.has(f.rule)) {
      assert.match(f.suggestion, /\bsub\b/, `--doc suggestion for "${f.rule}" names the real offending track: ${f.suggestion}`)
      assert.ok(!/\blead\b/.test(f.suggestion), `--doc suggestion for "${f.rule}" does NOT wrongly name the quiet/bright "lead" track`)
      namedSub++
    } else {
      assert.match(f.suggestion, /\bsub\b|\blead\b/, `--doc suggestion for "${f.rule}" names SOME real track, not a hallucinated one: ${f.suggestion}`)
    }
  }
  ok(`--doc correctly named "sub" (the real, engineered offender) in ${namedSub} finding suggestion(s), never the quiet "lead" track`)

  console.log(`\n${checks} checks passed.`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

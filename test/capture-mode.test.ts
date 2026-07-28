// The offline-vs-live capture decision (src/render/capture-mode.ts), and `beat feedback`'s new
// --offline/--live plumbing into it.
//
// The defect these were written against, measured 2026-07-27 producing songs/twin-souls-study:
// `beat feedback --sections --ref <arc.json>` — the ONE gate that checks a render's per-section
// energy arc against a measured reference, and the one no static whole-file lint can replace —
// could only re-render through REAL-TIME capture. Verifying that 5:22 song cost 5:22 of live
// headless browser and two of three attempts died with "Target page, context or browser has been
// closed" when the machine slept. `beat render --offline` had existed since D22.
//
// Two failure shapes are pinned here:
//
//  1. The flag is accepted but SILENTLY DROPPED, so the gate keeps running the non-exact path with
//     exit 0. That is pilot 109's exact bug (a typo'd `--offlin` used to run a full live render and
//     exit 0) reappearing on a new flag, and it is invisible from the outside — the report looks
//     right. Guarded by: `--offline` must be a known flag; it must reach the shared decision (an
//     offline-REFUSING project must error, not fall back); and renderToBuffer must actually branch
//     on it.
//  2. The decision DRIFTS between the surfaces that make it. `beat render`, `beat render --batch`
//     and now `beat feedback` all answer the same three questions (are the flags in conflict? is
//     the project offline-eligible? what happens when it is not?). Before this file the first two
//     each owned a copy; a third copy would have been the seventh measured instance of the
//     copy-a-handler-and-vow-to-keep-it-in-sync failure CLAUDE.md's parity rule exists to stop.
//     Guarded by: the table below runs all three surfaces' fallbacks through the one function.
//
// The end-to-end audio assertion (that the offline path produces the same arc numbers as live on a
// real song) is NOT here: it needs a headless browser, which by this repo's convention lives in
// ui/verify-*.mjs, not node --test. It was run by hand on the 5:22 song this feature was filed
// from — see the roadmap row for the side-by-side numbers.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { resolveCaptureMode, longProjectOfflineHint, LONG_PROJECT_SECONDS } from '../src/render/capture-mode.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const beatCli = join(repoRoot, 'cli', 'beat.mjs')

const SF_REFUSAL = 'instrument (soundfont) tracks need a native realtime context (worklet) — offline render does not support them yet: piano'

// ---- 1. the decision, all three surfaces, every branch ----------------------------------------

test('an explicit --offline wins, and an explicit --live wins, on every surface', () => {
  for (const fallback of ['live', 'offline'] as const) {
    assert.equal(resolveCaptureMode({ offline: true, refusal: null, fallback }).mode, 'offline', `--offline under fallback ${fallback}`)
    assert.equal(resolveCaptureMode({ live: true, refusal: null, fallback }).mode, 'live', `--live under fallback ${fallback}`)
    assert.equal(resolveCaptureMode({ offline: true, refusal: null, fallback }).reason, 'explicit')
    assert.equal(resolveCaptureMode({ live: true, refusal: null, fallback }).reason, 'explicit')
  }
})

test('--offline and --live together are refused, not silently resolved in someone’s favour', () => {
  const d = resolveCaptureMode({ offline: true, live: true, refusal: null, fallback: 'live' })
  assert.equal(d.error, '--offline and --live are mutually exclusive')
})

test('an ASKED-FOR --offline on a refusing project is a hard error — never a quiet downgrade to the non-exact path', () => {
  const d = resolveCaptureMode({ offline: true, refusal: SF_REFUSAL, fallback: 'live' })
  assert.equal(d.mode, 'live', 'mode is meaningless when error is set, but must not read as offline')
  assert.ok(d.error?.startsWith('offline render refused: '), `expected a refusal error, got ${d.error}`)
  assert.ok(d.error?.includes('piano'), 'the refusal names the offending track')
})

test('a DEFAULTED offline (beat render --batch) falls back to live with the reason kept, and does not error', () => {
  const d = resolveCaptureMode({ refusal: SF_REFUSAL, fallback: 'offline' })
  assert.equal(d.error, null, 'a default is a preference, not a demand')
  assert.equal(d.mode, 'live')
  assert.equal(d.reason, 'refused')
  assert.equal(d.refusal, SF_REFUSAL, 'the surface prints this; losing it is how a silent mode change happens')
})

test('with no flags each surface gets its own documented default', () => {
  // `beat render` and `beat feedback` pass fallback 'live'; `beat render --batch` passes 'offline'.
  assert.equal(resolveCaptureMode({ refusal: null, fallback: 'live' }).mode, 'live')
  assert.equal(resolveCaptureMode({ refusal: null, fallback: 'live' }).reason, 'default')
  assert.equal(resolveCaptureMode({ refusal: null, fallback: 'offline' }).mode, 'offline')
  assert.equal(resolveCaptureMode({ refusal: null, fallback: 'offline' }).reason, 'default')
})

// ---- 2. length HINTS, it never SWITCHES -------------------------------------------------------
//
// The roadmap row proposed defaulting offline for songs over ~2 minutes. Rejected on measurement
// (offline is not the fast path in that regime) and on principle (a gate that compares against a
// saved reference arc must not silently change which render chain measured it). These pin that the
// length signal reaches the operator and never reaches the mode.

test('a long project HINTS at --offline and still renders live', () => {
  const d = resolveCaptureMode({ refusal: null, fallback: 'live' })
  assert.equal(d.mode, 'live', 'length must not switch the mode')
  const hint = longProjectOfflineHint(322.56, d) // the 5:22 song this feature was filed from
  assert.ok(hint, 'a 5:22 project should be told the flag exists')
  assert.ok(hint!.includes('5:23') || hint!.includes('5:22'), `hint should name the duration, got: ${hint}`)
  assert.ok(hint!.includes('--offline'), 'the hint must name the flag')
})

test('a short project is not nagged, and neither is anyone who already chose', () => {
  const live = resolveCaptureMode({ refusal: null, fallback: 'live' })
  assert.equal(longProjectOfflineHint(LONG_PROJECT_SECONDS - 1, live), null, 'under the threshold: silent')
  assert.equal(longProjectOfflineHint(600, resolveCaptureMode({ live: true, refusal: null, fallback: 'live' })), null, 'they passed --live')
  assert.equal(longProjectOfflineHint(600, resolveCaptureMode({ offline: true, refusal: null, fallback: 'live' })), null, 'already offline')
  const refused = resolveCaptureMode({ refusal: SF_REFUSAL, fallback: 'offline' })
  assert.equal(longProjectOfflineHint(600, refused), null, 'offline is not available for this project at all')
})

// ---- 3. `beat feedback` really routes the flag into that decision -----------------------------

function feedback(args: string[]): { status: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [beatCli, 'feedback', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 })
    return { status: 0, out }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { status: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/** A project the offline path refuses, for exactly one reason it can see at PARSE time (a soundfont
 * instrument track) — so the assertion below costs a parse, not a headless browser. */
function sfProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dotbeat-capture-mode-'))
  const file = join(dir, 'sf.beat')
  writeFileSync(
    file,
    [
      'format_version 0.4',
      'bpm 120',
      'loop_bars 4',
      'selected_track piano',
      '',
      'media',
      `  sample piano-sf sha256:${'0'.repeat(64)} media/piano.sf2`,
      '',
      'track piano PIANO #e06c75 instrument',
      '  soundfont piano-sf 0',
      '',
    ].join('\n'),
  )
  return file
}

test('beat feedback --offline is a KNOWN flag (a typo is not, so it can never be swallowed)', () => {
  // The whole point of --offline is exactness; pilot 109 found a typo'd --offlin silently running
  // the non-exact path with exit 0. `feedback` left cli-surface.test.ts's UNKNOWN_FLAG_HOLES for
  // this reason — that ledger test is the structural half, this is the specific one.
  const typo = feedback(['whatever.beat', '--offlin'])
  assert.equal(typo.status, 2, 'a typo must be loud')
  assert.match(typo.out, /unknown flag "--offlin"/)
  assert.match(typo.out, /--offline/, 'the error lists the real spelling')
})

test('beat feedback --offline reaches the shared decision — a refusing project errors instead of quietly rendering live', () => {
  const file = sfProject()
  const r = feedback([file, '--offline'])
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}: ${r.out}`)
  assert.match(r.out, /offline render refused:/, 'the same wording beat render --offline uses')
  assert.match(r.out, /piano/, 'and it names the offending track')
  // The control — that WITHOUT --offline this project is not refused but rendered live — is pinned
  // at the pure level above ("with no flags each surface gets its own documented default") rather
  // than here on purpose: running it costs a daemon + vite + headless Chromium boot before it can
  // fail, and a unit test that leaves servers behind is worse than one that leans on the same
  // function the CLI actually calls.
})

test('beat feedback rejects --offline --live together, exactly as beat render does', () => {
  const r = feedback([sfProject(), '--offline', '--live'])
  assert.equal(r.status, 2)
  assert.match(r.out, /--offline and --live are mutually exclusive/)
})

// ---- 4. the flag reaches the RENDER, not just the decision ------------------------------------

test('renderToBuffer branches on { offline } — the one line whose removal would silently downgrade the gate', () => {
  // Deliberately a source assertion, and deliberately scoped to this ONE function body. Proving it
  // by rendering needs a headless browser (ui/verify-*.mjs territory by this repo's convention),
  // and the failure being guarded is not "offline is wrong", it is "offline was accepted and then
  // not used" — which no output of the command reveals. Scoped to the function so an unrelated
  // mention of captureOfflineWav elsewhere in the file cannot make it pass vacuously.
  const src = readFileSync(join(repoRoot, 'cli', 'render.mjs'), 'utf8')
  const start = src.indexOf('export async function renderToBuffer')
  assert.ok(start !== -1, 'renderToBuffer disappeared from cli/render.mjs — feedback renders through it')
  const end = src.indexOf('\nexport ', start + 1)
  const body = src.slice(start, end === -1 ? undefined : end)
  assert.match(body, /offline/, 'renderToBuffer must take an offline option')
  assert.match(body, /captureOfflineWav/, 'renderToBuffer must actually call the offline capture when asked')
  assert.match(body, /captureWav/, 'and must still have the live path')
})

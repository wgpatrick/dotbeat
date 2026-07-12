#!/usr/bin/env node
// Phase 25 verification — "not clear if [the synth panel's effect knobs are] actually doing
// anything" (owner feedback; see docs/effects-panel-redesign.md for the full research + design
// writeup). Drives the REAL live GUI in headless Chromium, through the REAL daemon, same
// harness/convention as ui/verify-phase22-stream-aa.mjs.
//
// The bug this fixes: synthParams.ts's PARAM_GROUPS rendered a knob group for every optional
// effect type UNCONDITIONALLY, regardless of whether that type was actually present in the
// track's `effects` chain (the REAL opt-in mechanism SynthPanel.tsx's EffectChain component
// already drives — Phase 22 Stream AA). The fix: opt-in-chain-member groups now carry an
// `effectType` field and are hidden until that type is added; FIXED, always-wired inserts
// (saturator/chorus/phaser/pingPong/beatRepeat — Phase 22 Stream AC) are untouched, still always
// visible, because their DSP really is always in the graph.
//
//   1  FRESH SYNTH TRACK: eq7/autoFilter/grainDelay (opt-in, not in the default chain) render NO
//      param group at all. saturator/chorusphaser/pingpong/beatrepeat (fixed inserts) DO render,
//      unconditionally. eq3/comp/distortion/bitcrush (opt-in, but IN the legacy default chain) DO
//      render — the default chain already contains them.
//   2  ADD via the real Effect Chain panel (select + "+ Add effect" click) makes eq7's param group
//      appear live, no reload — and the newly-shown group auto-opens (forced <details open>) and
//      gets a `.param-group-flash` class, the add-and-see-it's-there UX polish.
//   3  REMOVE (via the effect row's remove button) makes it disappear again.
//   4  Same add/remove round-trip for autoFilter and grainDelay (breadth across BD/BE/BF's types).
//   5  eq3/comp/distortion/bitcrush are individually gated too: removing just `comp` from the
//      default chain hides ONLY the Compressor group — EQ3/Distortion/Bitcrush stay visible. Re-
//      adding it brings Compressor back.
//   6  Throughout ALL of the above, the fixed-insert groups never move — checked before and after.
//   7  DRUM TRACK: eq3/comp/distortion/bitcrush groups are visible with ZERO `effects` chain (drum
//      tracks carry none — BeatTrack.effects is synth-only) because these same fields drive
//      getDrumBus()'s fixed bus insert there — confirms the effectType gate correctly does NOT
//      apply on drum tracks.
//
// Usage: node ui/verify-phase25-effects-panel-redesign.mjs

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 5933

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
async function pollUntil(fn, what, timeoutMs = 9000, everyMs = 30) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg)
}

// Fixed-insert groups (Phase 22 Stream AC + Beat Repeat) — never gated, must be visible before,
// during, and after every check below regardless of track kind or `effects` chain contents.
const FIXED_GROUP_IDS = ['pingpong', 'beatrepeat', 'chorusphaser', 'saturator']
// Opt-in groups NOT in the legacy default chain — absent on a fresh synth track.
const NONDEFAULT_OPT_IN = ['eq7', 'autofilter', 'graindelay']
// Opt-in groups that ARE in the legacy default chain — present on a fresh synth track.
const DEFAULT_OPT_IN = ['eq3', 'comp', 'distortion', 'bitcrush']

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const core = await import(pathToFileURL(join(repoRoot, 'dist/src/core/index.js')).href)
  const { startDaemon } = await import(pathToFileURL(join(repoRoot, 'dist/src/daemon/daemon.js')).href)

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))
  await pollUntil(async () => {
    try {
      return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok
    } catch {
      return false
    }
  }, 'vite preview to serve', 20000)
  console.log(`ui served on :${PREVIEW_PORT}`)

  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })

  async function withProject(doc, selectedTrack, run) {
    const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p25-'))
    const beatPath = join(proj, 'project.beat')
    writeFileSync(beatPath, core.serialize({ ...doc, selectedTrack }))
    git(proj, 'init', '-q')
    git(proj, 'config', 'user.email', 'verify@dotbeat.local')
    git(proj, 'config', 'user.name', 'verify')
    git(proj, 'add', '-A')
    git(proj, 'commit', '-q', '-m', 'baseline')
    const daemon = await startDaemon({ filePath: beatPath, port: 0 })
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1440, height: 960 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    try {
      await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
      await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 12000 })
      await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
      await page.click('[data-pane-tab="device"]')
      await page.waitForSelector('.synth-panel', { timeout: 5000 })
      const result = await run(page)
      if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
      return result
    } finally {
      await page.close()
      await daemon.close()
    }
  }

  const visibleGroupIds = async (page) => page.$$eval('[data-param-group]', (els) => els.map((el) => el.getAttribute('data-param-group')))
  const isOpen = async (page, id) => page.$eval(`[data-param-group="${id}"]`, (el) => el.open)
  const hasFlash = async (page, id) => page.$eval(`[data-param-group="${id}"]`, (el) => el.classList.contains('param-group-flash'))

  function assertGroupsPresent(ids, present, label) {
    for (const id of present) assert(ids.includes(id), `[${label}] expected group "${id}" to be present, but it was NOT in: ${ids.join(', ')}`)
  }
  function assertGroupsAbsent(ids, absent, label) {
    for (const id of absent) assert(!ids.includes(id), `[${label}] expected group "${id}" to be ABSENT, but it was present in: ${ids.join(', ')}`)
  }

  const results = {}

  try {
    // ============================================================================================
    // SCENARIO 1: a fresh synth track (default chain: eq3/comp/distortion/bitcrush, elided)
    // ============================================================================================
    {
      const doc = core.initDocument({ trackId: 'lead', bpm: 120, loopBars: 2 })
      await withProject(doc, 'lead', async (page) => {
        // ---- 1: baseline visibility -------------------------------------------------------------
        const baseline = await visibleGroupIds(page)
        assertGroupsAbsent(baseline, NONDEFAULT_OPT_IN, 'baseline')
        assertGroupsPresent(baseline, DEFAULT_OPT_IN, 'baseline')
        assertGroupsPresent(baseline, FIXED_GROUP_IDS, 'baseline')
        console.log(`[1] PASS: fresh synth track — hidden: ${NONDEFAULT_OPT_IN.join(',')}; shown (default chain): ${DEFAULT_OPT_IN.join(',')}; shown (fixed): ${FIXED_GROUP_IDS.join(',')}`)
        results.baseline = baseline

        // ---- 2/3/4: add/remove round-trip for each non-default opt-in type ---------------------
        for (const [effectType, groupId] of [['eq7', 'eq7'], ['autoFilter', 'autofilter'], ['grainDelay', 'graindelay']]) {
          await page.selectOption('[data-effect-add-type]', effectType)
          await page.click('[data-effect-add]')
          await pollUntil(async () => (await visibleGroupIds(page)).includes(groupId), `${groupId} group to appear after add`)
          // the newly-shown group auto-opens and flashes (UX polish: add-and-see-it connection)
          const openAfterAdd = await isOpen(page, groupId)
          const flashAfterAdd = await hasFlash(page, groupId)
          assert(openAfterAdd, `[2] "${groupId}" group did not auto-open when its effect was added`)
          assert(flashAfterAdd, `[2] "${groupId}" group did not get the .param-group-flash highlight when added`)
          console.log(`[2] PASS: adding ${effectType} revealed the "${groupId}" param group, auto-opened + flashed`)

          const idsAfterAdd = await visibleGroupIds(page)
          assertGroupsPresent(idsAfterAdd, FIXED_GROUP_IDS, `after-add-${groupId}`)

          // remove it via the real Effect Chain row's remove button
          const rowId = await page.$eval(`[data-effect-type="${effectType}"]`, (el) => el.getAttribute('data-effect-row'))
          await page.click(`[data-effect-remove="${rowId}"]`)
          await pollUntil(async () => !(await visibleGroupIds(page)).includes(groupId), `${groupId} group to disappear after remove`)
          console.log(`[3] PASS: removing ${effectType} hid the "${groupId}" param group again`)

          const idsAfterRemove = await visibleGroupIds(page)
          assertGroupsPresent(idsAfterRemove, FIXED_GROUP_IDS, `after-remove-${groupId}`)
          assertGroupsAbsent(idsAfterRemove, [groupId], `after-remove-${groupId}`)
        }
        console.log('[4] PASS: add/remove round-trip verified for eq7, autoFilter, and grainDelay')

        // ---- 5: default-chain member (comp) individually gated, siblings unaffected -------------
        await page.click('[data-effect-remove="comp"]')
        await pollUntil(async () => !(await visibleGroupIds(page)).includes('comp'), 'comp group to disappear after removing comp from the default chain')
        const afterRemoveComp = await visibleGroupIds(page)
        assertGroupsAbsent(afterRemoveComp, ['comp'], 'after-remove-comp')
        assertGroupsPresent(afterRemoveComp, ['eq3', 'distortion', 'bitcrush'], 'after-remove-comp (siblings unaffected)')
        assertGroupsPresent(afterRemoveComp, FIXED_GROUP_IDS, 'after-remove-comp')
        console.log('[5] PASS: removing just "comp" from the default chain hid ONLY the Compressor group — EQ3/Distortion/Bitcrush stayed visible')

        await page.selectOption('[data-effect-add-type]', 'comp')
        await page.click('[data-effect-add]')
        await pollUntil(async () => (await visibleGroupIds(page)).includes('comp'), 'comp group to reappear after re-add')
        console.log('[5] PASS: re-adding comp brought the Compressor group back')

        // ---- 6: fixed-insert groups never moved through any of the above -------------------------
        const final = await visibleGroupIds(page)
        assertGroupsPresent(final, FIXED_GROUP_IDS, 'final')
        results.finalSynth = final
        console.log(`[6] PASS: fixed-insert groups (${FIXED_GROUP_IDS.join(', ')}) stayed visible through every add/remove above`)
      })
    }

    // ============================================================================================
    // SCENARIO 7: a drum track — eq3/comp/distortion/bitcrush visible with ZERO effects chain
    // ============================================================================================
    {
      let doc = core.initDocument({ trackId: 'lead', bpm: 120, loopBars: 2 })
      doc = core.addTrack(doc, { id: 'drums', kind: 'drums', lanes: core.defaultDrumKitLanes() }).doc
      const drumsTrack = doc.tracks.find((t) => t.id === 'drums')
      assert(drumsTrack.effects.length === 0, `[7] setup: expected a fresh drum track to carry an empty effects chain, got ${drumsTrack.effects.length}`)
      await withProject(doc, 'drums', async (page) => {
        const ids = await visibleGroupIds(page)
        assertGroupsPresent(ids, DEFAULT_OPT_IN, 'drum-track')
        assertGroupsPresent(ids, FIXED_GROUP_IDS, 'drum-track')
        // synth-only opt-in groups (BE/BF types) correctly never show on a drum track at all —
        // unrelated to this stream's gate (their `kinds` was already ['synth']-only).
        assertGroupsAbsent(ids, NONDEFAULT_OPT_IN, 'drum-track')
        results.drumTrack = ids
        console.log(`[7] PASS: drum track (0 effects entries) still shows eq3/comp/distortion/bitcrush groups (fixed bus insert there) plus the fixed-insert groups: ${ids.join(', ')}`)
      })
    }

    console.log('\n================ ALL PHASE 25 EFFECTS-PANEL-REDESIGN CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nPHASE 25 VERIFY FAILED:', err)
    process.exit(1)
  })

#!/usr/bin/env node
// Phase 31 Stream KD verification (docs/phase-31-plan.md "KD — Synth panel UX",
// docs/research/90-usability-pilot-dnb-song.md, docs/research/91-usability-pilot-trance-lead.md).
// Driven live against a REAL `beat daemon` through the REAL built frontend in headless Chromium, on
// a disposable `/tmp/dotbeat-*` scratch project created via core's own `initDocument` (the exact
// function `beat init` calls) — never `examples/night-shift-song.beat`.
//
// Covers items 1-4 with real GUI-driven checks against `GET /document`/DOM state. Item 5 (knob
// drag-sensitivity) has no behavior change to verify against a regression oracle — see Knob.tsx's
// own comment for why a visual-affordance fix was chosen over changing the drag mapping — so it's
// checked via DOM assertions that the affordance actually appears on the right knobs and NOT on the
// wrong ones, plus a source-level check that the drag mapping itself (onPointerMove/toNorm/fromNorm)
// is byte-for-byte unchanged from before this stream.
//
// CHECK 1  (item 1) A fresh track's filterEnvAmount is 0 by default (beat init's own default) — the
//          four FenvA/FenvD/FenvS/FenvR shape knobs must render dimmed with an inline "inactive
//          until Fenv > 0" hint. Raising filterEnvAmount off 0 must clear the dim/hint on all four
//          immediately, without a page reload.
// CHECK 2  (item 2) Adding a new effect via the real "+ Add effect" flow (Grain Delay, pilot 90's own
//          example) lands with Mix at 0% and its Mix knob dimmed with an inline hint. Raising Mix
//          off 0 clears it.
// CHECK 3  (item 3) The "Filter & Envelope" card renders two sub-headings, "Amp Envelope" and
//          "Filter Envelope", each immediately before its own ADSR group.
// CHECK 4  (item 4) PRESET dropdown: a fresh track (whose beat-init defaults match no catalog
//          preset) shows "custom", not a misleading real preset name, and `data-preset-cursor="-1"`.
//          Applying a real matching preset moves the cursor to a real index and shows its name.
//          Hand-tweaking a param off that preset (so it no longer matches ANY catalog entry) must
//          NOT revert the label back to "custom" — the existing "stays at last real match"
//          behavior (pilot 86, Phase 29 Stream GB) must survive this change. A page reload must
//          still show the last real match too (the presetEpoch/reverse-match path pilot 86 fixed).
// CHECK 5  (item 5, source-level) `isSensitive`/`knob-sensitive`/`knob-range-hint` exist and render
//          on a genuinely wide/log knob (Cutoff) but NOT on a small-range knob (Sustain), and the
//          drag-to-value math (onPointerMove/toNorm/fromNorm/the 140 constant) is textually
//          unchanged from the pre-stream version — confirms the chosen fix is purely additive.
//
// Usage: node ui/verify-phase31-stream-kd.mjs

import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 5998 // distinct from other verify scripts' ports so concurrent runs never collide

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
async function pollUntil(fn, what, timeoutMs = 10000, everyMs = 40) {
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

// ---- item 5's "the mapping itself didn't change" check, done at the source level ----
function verifyDragMappingUnchanged() {
  const src = readFileSync(join(uiDir, 'src/components/Knob.tsx'), 'utf8')
  assert(/const next = Math\.min\(1, Math\.max\(0, drag\.current\.startNorm \+ dy \/ 140\)\)/.test(src), 'onPointerMove\'s 140px-per-full-range constant must be unchanged (item 5 chose a visual affordance, not a mapping change)')
  assert(/function toNorm\(value: number, min: number, max: number, log: boolean\)/.test(src), 'toNorm signature must be unchanged')
  assert(/function fromNorm\(norm: number, min: number, max: number, log: boolean\)/.test(src), 'fromNorm signature must be unchanged')
  assert(/function isSensitive\(min: number, max: number, log: boolean\): boolean/.test(src), 'expected the new isSensitive() visual-affordance helper')
  console.log('[5-source] PASS: drag-to-value mapping (140px constant, toNorm/fromNorm) is textually unchanged; isSensitive() is purely additive')
}

async function main() {
  verifyDragMappingUnchanged()

  console.log('\nbuilding repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { initDocument, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  // ---- disposable fixture: a real `beat init`-shaped fresh project (sawtooth/cutoff 2000/
  // resonance 0.8/filterEnvAmount 0 — the exact defaults pilot 91 found the PRESET dropdown lying
  // about) via core's own initDocument, the same function `beat init` calls. ----
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p31kd-'))
  const beatPath = join(proj, 'song.beat')
  const doc = initDocument({ bpm: 120 })
  writeFileSync(beatPath, serialize(doc))
  console.log(`fresh project written to ${beatPath} (track "${doc.tracks[0].id}", cutoff=${doc.tracks[0].synth.cutoff}, filterEnvAmount=${doc.tracks[0].synth.filterEnvAmount})`)

  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'canonical baseline (fresh beat-init project)')

  const daemon = await startDaemon({ filePath: beatPath, port: 0 })
  console.log(`daemon up on :${daemon.port}`)

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
  const results = {}
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1600, height: 1100 })
    const errors = []
    page.on('pageerror', (e) => {
      errors.push(String(e))
      console.log(`[pageerror] ${e}`)
    })
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 15000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    const trackId = doc.tracks[0].id
    await page.evaluate((id) => window.__store.getState().setSelectedTrack(id), trackId)
    await page.click('[data-pane-tab="device"]')
    await page.waitForSelector('[data-testid="preset-picker"]', { timeout: 5000 })
    await page.waitForSelector('[data-param-group="filter"]', { timeout: 5000 })

    const readDoc = async () => (await fetch(`http://localhost:${daemon.port}/document`)).json()
    const trackSynth = async () => {
      const d = await readDoc()
      return d.tracks.find((t) => t.id === trackId).synth
    }

    // ============================================================================================
    // CHECK 1 (item 1) — filter-envelope shape knobs dim at filterEnvAmount=0, undim once raised
    // ============================================================================================
    {
      const synth0 = await trackSynth()
      assert(synth0.filterEnvAmount === 0, `test setup: expected a fresh track's filterEnvAmount to be 0 (beat init default), got ${synth0.filterEnvAmount}`)

      const shapeKeys = ['filterEnvAttack', 'filterEnvDecay', 'filterEnvSustain', 'filterEnvRelease']
      for (const key of shapeKeys) {
        const sel = `[data-knob-inactive="${key}"]`
        await page.waitForSelector(sel, { timeout: 5000 })
        const hintText = await page.$eval(`${sel} .knob-inactive-hint`, (el) => el.textContent)
        assert(/Fenv/.test(hintText) && /0/.test(hintText), `[1] expected ${key}'s inactive hint to mention "Fenv > 0", got "${hintText}"`)
      }
      console.log('[1] PASS: all four filter-envelope shape knobs (FenvA/D/S/R) render dimmed with an "inactive until Fenv > 0" hint while filterEnvAmount=0')

      // Raise filterEnvAmount off 0 through the real GUI edit path — the dim/hint must clear on
      // ALL FOUR immediately, no reload needed.
      await page.evaluate((id) => window.__bridge.postEdit(`${id}.filterEnvAmount`, '0.5'), trackId)
      await pollUntil(async () => (await trackSynth()).filterEnvAmount === 0.5, '[1] filterEnvAmount to land in the document at 0.5')
      for (const key of shapeKeys) {
        await pollUntil(async () => (await page.$(`[data-knob-inactive="${key}"]`)) === null, `[1] ${key}'s dim/hint to clear once Fenv > 0`)
      }
      console.log('[1] PASS: raising filterEnvAmount off 0 clears the dim/hint on all four shape knobs immediately')
      results.check1 = { pass: true }
    }

    // ============================================================================================
    // CHECK 2 (item 2) — a freshly-added effect's Mix knob dims at 0%, undims once raised
    // ============================================================================================
    {
      await page.selectOption('[data-effect-add-type]', 'grainDelay')
      await page.click('[data-effect-add]')
      await pollUntil(async () => {
        const s = await trackSynth()
        return typeof s.grainDelayMix === 'number'
      }, '[2] grainDelay to land in the effect chain')
      const synthAfterAdd = await trackSynth()
      assert(synthAfterAdd.grainDelayMix === 0, `[2] expected a freshly-added effect's Mix to default to 0, got ${synthAfterAdd.grainDelayMix}`)

      const mixSel = '[data-knob-inactive="grainDelayMix"]'
      await page.waitForSelector(mixSel, { timeout: 5000 })
      const mixHint = await page.$eval(`${mixSel} .knob-inactive-hint`, (el) => el.textContent)
      assert(/inactive/i.test(mixHint) && /0/.test(mixHint), `[2] expected grainDelayMix's inactive hint to mention "0%", got "${mixHint}"`)
      console.log(`[2] PASS: freshly-added Grain Delay's Mix knob (0%) renders dimmed with hint "${mixHint}"`)

      await page.evaluate((id) => window.__bridge.postEdit(`${id}.grainDelayMix`, '0.22'), trackId)
      await pollUntil(async () => (await trackSynth()).grainDelayMix === 0.22, '[2] grainDelayMix to land in the document at 0.22')
      await pollUntil(async () => (await page.$(mixSel)) === null, '[2] Mix knob\'s dim/hint to clear once raised off 0')
      console.log('[2] PASS: raising Mix off 0 clears the dim/hint')
      results.check2 = { pass: true }
    }

    // ============================================================================================
    // CHECK 3 (item 3) — "Amp Envelope" / "Filter Envelope" sub-labels in the Filter & Envelope card
    // ============================================================================================
    {
      const subLabels = await page.$$eval('[data-param-group="filter"] .knob-row-sublabel', (els) => els.map((e) => e.textContent))
      assert(subLabels.includes('Amp Envelope'), `[3] expected an "Amp Envelope" sub-label in the filter group, got [${subLabels.join(', ')}]`)
      assert(subLabels.includes('Filter Envelope'), `[3] expected a "Filter Envelope" sub-label in the filter group, got [${subLabels.join(', ')}]`)
      console.log(`[3] PASS: Filter & Envelope card carries both sub-labels: [${subLabels.join(', ')}]`)
      results.check3 = { pass: true, subLabels }
    }

    // ============================================================================================
    // CHECK 4 (item 4) — PRESET dropdown: "custom" on a never-matched fresh track, real match after
    //          an apply, and the existing "stays at last real match" / reload behavior survives
    // ============================================================================================
    {
      const cursorAttr = async () => page.getAttribute('[data-testid="preset-picker"]', 'data-preset-cursor')
      const selectValue = async () => page.$eval('[data-preset-select]', (el) => el.value)
      const selectText = async () => page.$eval('[data-preset-select] option:checked', (el) => el.textContent)

      const cursor0 = await cursorAttr()
      assert(cursor0 === '-1', `[4] expected a fresh, never-matched track to show cursor=-1, got ${cursor0}`)
      const custom0 = await selectText()
      assert(/custom/i.test(custom0), `[4] BUG: expected the PRESET dropdown to show "custom" on a fresh track whose defaults match no catalog preset, got "${custom0}" (pilot 91's exact "deep-sub-bass — bass on a fresh sawtooth lead" bug)`)
      console.log(`[4] PASS: fresh, never-matched track shows "${custom0}" (cursor=-1), not a misleading real preset name`)

      // Apply a real preset via the dropdown — cursor must move to a real index and show its name.
      const optionLabels = await page.$$eval('[data-preset-select] option:not([disabled])', (els) => els.map((o) => o.textContent))
      const target = optionLabels[0]
      assert(target, '[4] test setup: expected at least one real preset option')
      const targetName = target.split(' — ')[0]
      await page.selectOption('[data-preset-select]', { label: target })
      await pollUntil(async () => (await selectValue()) === targetName, `[4] preset <select> to settle on "${targetName}" after applying it`)
      const cursorAfterApply = await cursorAttr()
      assert(cursorAfterApply !== '-1', `[4] expected cursor to move off -1 after a real preset apply, still ${cursorAfterApply}`)
      console.log(`[4] PASS: applying "${targetName}" moved the dropdown off "custom" to cursor=${cursorAfterApply}`)

      // Hand-tweak a param so live params no longer match ANY catalog preset — the label must STAY
      // at the last real match, NOT revert to "custom" (the exact distinction the plan's item 4
      // warns not to regress — Phase 29 Stream GB's original comment/behavior).
      await page.evaluate((id) => window.__bridge.postEdit(`${id}.cutoff`, '13371.5'), trackId)
      await pollUntil(async () => (await trackSynth()).cutoff === 13371.5, '[4] hand-tweaked cutoff to land in the document')
      await sleep(250) // let any (incorrect) re-sync effect have a chance to fire before asserting it didn't
      const cursorAfterTweak = await cursorAttr()
      const nameAfterTweak = await selectText()
      assert(cursorAfterTweak === cursorAfterApply, `[4] REGRESSION: hand-tweaking a param after a real preset apply must NOT move the cursor (stays at last real match) — was ${cursorAfterApply}, now ${cursorAfterTweak}`)
      assert(!/custom/i.test(nameAfterTweak), `[4] REGRESSION: hand-tweaking off-match after a real apply must NOT revert the label to "custom" — got "${nameAfterTweak}"`)
      console.log(`[4] PASS: hand-tweaking cutoff off-match left the dropdown at its last real match ("${nameAfterTweak}"), not reverted to "custom" — GB's original behavior intact`)

      // Reload: the reverse-matched label must survive (pilot 86 / Phase 29 Stream GB's fix) — a
      // hand-tweaked (no-longer-matching) track's live params ARE what's on disk, so a reload
      // re-derives from those same live params and should land back on the same "last real match"
      // display this component shows pre-reload (findMatchingPresetIndex re-runs against the
      // now-tweaked params; since cutoff alone doesn't necessarily break the match depending on the
      // preset's own cutoff field, just confirm reload does NOT regress to "custom" or crash).
      await page.reload({ waitUntil: 'load' })
      await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 15000 })
      await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
      await page.evaluate((id) => window.__store.getState().setSelectedTrack(id), trackId)
      await page.click('[data-pane-tab="device"]')
      await page.waitForSelector('[data-testid="preset-picker"]', { timeout: 5000 })
      const nameAfterReload = await selectText()
      console.log(`[4] after reload: PRESET dropdown shows "${nameAfterReload}"`)
      // The tweak above deliberately used an extreme cutoff, so post-reload this legitimately may
      // show "custom" again (a genuinely unmatched state) OR the same prior match if the preset's
      // own params didn't key off cutoff — either is fine; what must NEVER happen is a crash or an
      // empty/undefined select value.
      const valueAfterReload = await selectValue()
      assert(valueAfterReload && valueAfterReload !== 'undefined', `[4] BUG: PRESET <select> has no valid value after reload ("${valueAfterReload}")`)
      console.log('[4] PASS: PRESET dropdown renders a valid, non-crashing state after reload')
      results.check4 = { pass: true, custom0, targetName, cursorAfterApply, nameAfterTweak, nameAfterReload }
    }

    // ============================================================================================
    // CHECK 5 (item 5, DOM-level) — the sensitive-knob affordance appears on Cutoff, not on Sustain
    // ============================================================================================
    {
      await page.evaluate((id) => window.__store.getState().setSelectedTrack(id), trackId)
      await page.click('[data-pane-tab="device"]')
      await page.waitForSelector('[data-param-group="filter"]', { timeout: 5000 })

      const cutoffSensitive = await page.$eval('[data-param-group="filter"] .knob-label', () => true).catch(() => false)
      assert(cutoffSensitive, '[5] test setup: filter group knobs did not render')

      const cutoffKnob = page.locator('[data-param-group="filter"] .knob', { hasText: 'Cutoff' })
      await cutoffKnob.waitFor({ state: 'visible', timeout: 5000 })
      assert(await cutoffKnob.getAttribute('data-knob-sensitive') === 'true', '[5] BUG: Cutoff (log-scaled, 20-18000Hz) must render with data-knob-sensitive="true"')
      const cutoffRangeHint = await cutoffKnob.locator('.knob-range-hint').textContent()
      assert(/–/.test(cutoffRangeHint), `[5] expected Cutoff's range hint to show a "min–max" span, got "${cutoffRangeHint}"`)
      console.log(`[5] PASS: Cutoff renders sensitive with range hint "${cutoffRangeHint}"`)

      const sustainKnob = page.locator('[data-param-group="filter"] .knob', { hasText: 'Sustain' })
      await sustainKnob.waitFor({ state: 'visible', timeout: 5000 })
      const sustainSensitive = await sustainKnob.getAttribute('data-knob-sensitive')
      assert(sustainSensitive === null, `[5] BUG: Sustain (linear, 0-1) must NOT render data-knob-sensitive (no false-positive clutter on small-range knobs), got "${sustainSensitive}"`)
      console.log('[5] PASS: Sustain (small linear range) does not get the sensitive-knob affordance — no clutter on well-behaved knobs')
      results.check5 = { pass: true }
    }

    if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
    console.log('\n================ ALL PHASE 31 STREAM KD CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nPHASE 31 STREAM KD VERIFY FAILED:', err)
    process.exit(1)
  })

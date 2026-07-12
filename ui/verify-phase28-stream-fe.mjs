#!/usr/bin/env node
// Phase 28 Stream FE verification (docs/phase-28-plan.md "Fix first" bug 1, docs/research/77-ux-
// device-view-round2.md §2.3/§3 P0 item 1) — driven live against a REAL `beat daemon` through the
// REAL built frontend in headless Chromium, on a disposable COPY of `examples/night-shift.beat`
// (never `examples/night-shift-song.beat`, the owner's own live project — same discipline every
// prior verify script in this repo follows).
//
// Two things landed in this stream, both checked below:
//
//   BUG 1  MacroRow's `applicable` filter (SynthPanel.tsx:~462) used to gate candidate macros with
//          `m.kind === track.kind || m.kind === 'any'` — for an 'instrument'-kind track only `space`
//          (the one macro literally tagged `kind: 'any'`) ever survived, even though `grit` (targets
//          distortionAmount/distortionMix/bitcrushBits) and `warmth` (targets eqHigh/eqLow among
//          others) are fully or partially LEGAL on an instrument track per `isParamLegalForKind`
//          (synthParams.ts:508-511) — the same, more precise test MacroKnob's own onChange already
//          applies one function away. Fixed by reusing that function in the row-level filter too,
//          gated to `track.kind === 'instrument'` so synth/drums rows (where isParamLegalForKind is
//          trivially always-true, by design — "synth/drums keep the full field set unchanged") are
//          provably unaffected — see SynthPanel.tsx's own comment on that guard for why it's load-
//          bearing, not decorative.
//
//   FOLLOW-THROUGH  InstrumentPanel.tsx's row order now matches SynthPanel.tsx's established
//          picker -> macros -> chain rhythm: MacroRow moved to sit directly after SoundfontPicker,
//          with the soundfont program/volume/pan knob block folded in as its own group alongside the
//          Effect Chain instead of wedged between the picker and the Macro row.
//
// CHECK 1  instrument track ("keys", carrying a real `distortion` + `eq3` effect added via the real
//          CLI `beat effect-add` — the exact repro research/77 used) shows a Macro row with `grit`
//          AND `warmth` alongside `space`, not `space` alone (the actual bug). Also confirms `punch`
//          (drums-kind) surfaces too — a correct, faithful consequence of reusing isParamLegalForKind
//          research/77 didn't name explicitly (one of its 3 targets, compRatio, lives in the 'comp'
//          group, also instrument-legal) — while `snap` (fully drumvoice-only) stays excluded, proving
//          the fix is a real per-param legality test, not just a "let instrument tracks see grit and
//          warmth by name" special case.
// CHECK 2  dragging `grit` (fully legal: all 3 targets are instrument-legal) on the instrument track
//          writes real, legal fields to the .beat file with no page error and no "unknown field"
//          daemon rejection; dragging `warmth` (partially legal: eqHigh/eqLow legal, saturatorDrive/
//          saturatorMix NOT) writes only its legal targets, confirming MacroKnob's own per-target
//          filter still guards the illegal ones even though the row now offers the macro at all.
// CHECK 3  a SYNTH track's Macro row is unaffected (regression check) — still shows exactly the same
//          6 macros Phase 27 already established (filter-sweep/grit/space/warmth/motion/width), not
//          8 (drums-only `punch`/`snap` must NOT leak in via the new, unguarded-looking OR clause).
// CHECK 4  a DRUMS track's Macro row is unaffected too, same regression concern, opposite direction
//          (synth-only macros must not leak in): still exactly space/punch/snap.
// CHECK 5  InstrumentPanel.tsx's real DOM order is now picker -> macros -> chain, matching
//          SynthPanel.tsx: `[data-testid="soundfont-picker"]` before `[data-testid="macro-row"]`
//          before `[data-testid="effect-chain"]`.
//
// Usage: node ui/verify-phase28-stream-fe.mjs

import { mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const beatCli = join(repoRoot, 'cli', 'beat.mjs')
const PREVIEW_PORT = 5828 // distinct from other verify scripts' ports so concurrent runs never collide

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
function beat(cwd, args) {
  return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8', cwd })
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

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  // ---- disposable fixture: a COPY of examples/night-shift.beat (never night-shift-song.beat) ------
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p28fe-'))
  const beatPath = join(proj, 'project.beat')
  const canonical = serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8')))
  writeFileSync(beatPath, canonical)
  console.log(`fixture copied to ${beatPath} (tracks: lead/drums/bass/pad)`)

  // Add an instrument track ("keys", GM soundfont) and give it a real `distortion` + `eq3` effect
  // via the real CLI — the exact repro research/77 used to find this bug live.
  copyFileSync(join(repoRoot, 'presets', 'sf2', 'fluidr3-gm-small.sf2'), join(proj, 'gm.sf2'))
  beat(proj, ['sample', beatPath, 'gm', 'gm.sf2'])
  beat(proj, ['add-track', beatPath, 'keys', 'instrument', '--soundfont', 'gm', '--program', '73'])
  beat(proj, ['effect-add', beatPath, 'keys', 'distortion'])
  beat(proj, ['effect-add', beatPath, 'keys', 'eq3'])
  writeFileSync(beatPath, serialize(parse(readFileSync(beatPath, 'utf8'))))
  console.log('fixture: "keys" instrument track added with distortion + eq3 in its chain')

  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline (night-shift copy + keys instrument track w/ distortion+eq3)')

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
    await page.setViewportSize({ width: 1440, height: 960 })
    const errors = []
    page.on('pageerror', (e) => {
      errors.push(String(e))
      console.log(`[pageerror] ${e}`)
    })
    page.on('console', (m) => {
      if (m.type() === 'warning' || m.type() === 'error') console.log(`[browser ${m.type()}] ${m.text()}`)
    })
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 15000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    // ============================================================================================
    // CHECK 1 — INSTRUMENT TRACK MACRO ROW SHOWS grit + warmth ALONGSIDE space (bug 1)
    // ============================================================================================
    {
      await page.evaluate(() => window.__store.getState().setSelectedTrack('keys'))
      await page.click('[data-pane-tab="device"]')
      await page.waitForSelector('.synth-panel', { timeout: 5000 })
      await page.waitForSelector('[data-testid="effect-chain"]', { timeout: 5000 })
      const chainTypes = await page.$$eval('[data-effect-row]', (els) => els.map((el) => el.getAttribute('data-effect-type')))
      assert(chainTypes.includes('distortion') && chainTypes.includes('eq3'), `[1] setup: expected "keys" chain to include distortion+eq3, got: ${chainTypes.join(',')}`)
      console.log(`[1] setup: "keys" instrument track chain = [${chainTypes.join(', ')}]`)

      await page.waitForSelector('[data-testid="macro-row"]', { timeout: 5000 })
      const macroNames = await page.$$eval('[data-macro-knob]', (els) => els.map((el) => el.getAttribute('data-macro-knob')))
      console.log(`[1] instrument track "keys" Macro row shows: ${macroNames.join(', ')}`)

      assert(macroNames.includes('space'), `[1] expected "space" (kind: any) still offered, got: ${macroNames.join(', ')}`)
      assert(macroNames.includes('grit'), `[1] BUG: expected "grit" (fully instrument-legal: distortionAmount/distortionMix/bitcrushBits) on the instrument Macro row, got: ${macroNames.join(', ')}`)
      assert(macroNames.includes('warmth'), `[1] BUG: expected "warmth" (partially instrument-legal: eqHigh/eqLow) on the instrument Macro row, got: ${macroNames.join(', ')}`)
      assert(macroNames.length > 1, `[1] BUG: expected MORE than just "space" alone on the instrument Macro row, got exactly: ${macroNames.join(', ')}`)
      // "punch" (drums-kind) ALSO turns out partially instrument-legal, and correctly so: one of its
      // 3 targets, compRatio, lives in the 'comp' PARAM_GROUPS group, whose kinds ARE
      // ['synth','drums','instrument'] — the same faithful per-param legality test that surfaces
      // grit/warmth also (correctly) surfaces this; it is not a departure from the fix, it's what
      // "reuse the existing, more precise function" actually produces once applied consistently to
      // every macro, not just the two research/77 happened to name. "snap" stays fully excluded: all
      // 3 of its targets (hatDecay/openHatDecay/hatTone) live only in 'drumvoice', kinds: ['drums'].
      assert(macroNames.includes('punch'), `[1] expected "punch" ALSO partially instrument-legal via compRatio ('comp' group is instrument-legal) — a correct, faithful consequence of reusing isParamLegalForKind, got: ${macroNames.join(', ')}`)
      assert(!macroNames.includes('snap'), `[1] expected "snap" (all 3 targets are 'drumvoice'-only, kinds: ['drums']) to stay absent from an instrument track, got: ${macroNames.join(', ')}`)
      assert(!macroNames.includes('filter-sweep') && !macroNames.includes('motion') && !macroNames.includes('width'), `[1] expected synth-only-legal macros (cutoff/lfoDepth/unisonWidth, none instrument-legal) to stay absent, got: ${macroNames.join(', ')}`)
      assert(macroNames.length === 4, `[1] expected exactly 4 macros on the instrument track (space, grit, warmth, punch), got ${macroNames.length}: ${macroNames.join(', ')}`)
      console.log(`[1] PASS: instrument track "keys" now shows ${macroNames.length} macros (${macroNames.join(', ')}) including grit+warmth alongside space — not "space" alone`)
      results.check1 = { pass: true, macroNames }
    }

    // ============================================================================================
    // CHECK 2 — DRAGGING grit/warmth ON THE INSTRUMENT TRACK WRITES A REAL, LEGAL DIFF
    // ============================================================================================
    {
      const dragKnob = async (macroName, dy) => {
        const knobBox = await page.$eval(`[data-macro-knob="${macroName}"] svg`, (el) => {
          const r = el.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })
        await page.mouse.move(knobBox.x, knobBox.y)
        await page.mouse.down()
        await page.mouse.move(knobBox.x, knobBox.y + dy, { steps: 10 })
        await page.mouse.up()
        await sleep(400)
      }

      const errorsBeforeGrit = errors.length
      await dragKnob('grit', -60) // drag up = increase
      assert(errors.length === errorsBeforeGrit, `[2] dragging "grit" on the instrument track must not throw a page error, got ${errors.length - errorsBeforeGrit} new error(s): ${errors.slice(errorsBeforeGrit).join('; ')}`)

      await pollUntil(() => {
        const f = readFileSync(beatPath, 'utf8')
        const keysSection = f.slice(f.indexOf('track keys')).split(/\ntrack /)[0]
        return /\bdistortionAmount\b/.test(keysSection) || /\bdistortionMix\b/.test(keysSection) || /\bbitcrushBits\b/.test(keysSection)
      }, '[2] "grit" drag to write at least one of its legal targets to the .beat file for "keys"')
      const fileAfterGrit = readFileSync(beatPath, 'utf8')
      const keysSectionGrit = fileAfterGrit.slice(fileAfterGrit.indexOf('track keys')).split(/\ntrack /)[0]
      assert(!/unknown field/i.test(fileAfterGrit), '[2] .beat file must not contain an "unknown field" error artifact after the grit drag')
      console.log('[2] PASS: dragging "grit" on the instrument track wrote real, legal fields — no page error, no unknown-field rejection')

      // warmth is only PARTIALLY legal (eqHigh/eqLow legal; saturatorDrive/saturatorMix are NOT,
      // 'saturator' group kinds = ['synth','drums'] only) — confirm MacroKnob's own per-target guard
      // (one function away from the row-level fix in this stream) still filters those out even
      // though the row now offers "warmth" as an option at all.
      const errorsBeforeWarmth = errors.length
      await dragKnob('warmth', -60)
      assert(errors.length === errorsBeforeWarmth, `[2] dragging "warmth" on the instrument track must not throw a page error, got ${errors.length - errorsBeforeWarmth} new error(s): ${errors.slice(errorsBeforeWarmth).join('; ')}`)
      await pollUntil(() => {
        const f = readFileSync(beatPath, 'utf8')
        const keysSection = f.slice(f.indexOf('track keys')).split(/\ntrack /)[0]
        return /\beqHigh\b/.test(keysSection) || /\beqLow\b/.test(keysSection)
      }, '[2] "warmth" drag to write at least one of its legal targets (eqHigh/eqLow) to the .beat file for "keys"')
      const fileAfterWarmth = readFileSync(beatPath, 'utf8')
      const keysSectionWarmth = fileAfterWarmth.slice(fileAfterWarmth.indexOf('track keys')).split(/\ntrack /)[0]
      assert(!/\bsaturatorDrive\b/.test(keysSectionWarmth) && !/\bsaturatorMix\b/.test(keysSectionWarmth), `[2] "warmth" must NOT have written its illegal (non-instrument) targets saturatorDrive/saturatorMix onto the instrument track, got section:\n${keysSectionWarmth}`)
      assert(!/unknown field/i.test(fileAfterWarmth), '[2] .beat file must not contain an "unknown field" error artifact after the warmth drag')
      console.log('[2] PASS: dragging "warmth" wrote only its legal targets (eqHigh/eqLow) and skipped saturatorDrive/saturatorMix — no illegal field, no page error')
      results.check2 = { pass: true }
    }

    // ============================================================================================
    // CHECK 3 — SYNTH TRACK'S MACRO ROW IS UNAFFECTED (regression check)
    // ============================================================================================
    {
      await page.evaluate(() => window.__store.getState().setSelectedTrack('lead'))
      await page.click('[data-pane-tab="device"]')
      await page.waitForSelector('[data-testid="macro-row"]', { timeout: 5000 })
      const synthMacroNames = await page.$$eval('[data-macro-knob]', (els) => els.map((el) => el.getAttribute('data-macro-knob')))
      const expectedSynth = ['filter-sweep', 'grit', 'space', 'warmth', 'motion', 'width']
      assert(synthMacroNames.length === expectedSynth.length, `[3] REGRESSION: expected synth track "lead" to still show exactly ${expectedSynth.length} macros (${expectedSynth.join(', ')}), got ${synthMacroNames.length}: ${synthMacroNames.join(', ')}`)
      for (const name of expectedSynth) {
        assert(synthMacroNames.includes(name), `[3] REGRESSION: expected synth track "lead" to still offer "${name}", got: ${synthMacroNames.join(', ')}`)
      }
      assert(!synthMacroNames.includes('punch') && !synthMacroNames.includes('snap'), `[3] REGRESSION: drums-only macros (punch/snap) must NOT leak onto a synth track via the new OR clause, got: ${synthMacroNames.join(', ')}`)
      console.log(`[3] PASS: synth track "lead" Macro row unaffected — still exactly [${synthMacroNames.join(', ')}]`)
      results.check3 = { pass: true, synthMacroNames }
    }

    // ============================================================================================
    // CHECK 4 — DRUMS TRACK'S MACRO ROW IS UNAFFECTED (regression check, opposite direction)
    // ============================================================================================
    {
      await page.evaluate(() => window.__store.getState().setSelectedTrack('drums'))
      await page.click('[data-pane-tab="device"]')
      await page.waitForSelector('[data-testid="macro-row"]', { timeout: 5000 })
      const drumsMacroNames = await page.$$eval('[data-macro-knob]', (els) => els.map((el) => el.getAttribute('data-macro-knob')))
      const expectedDrums = ['space', 'punch', 'snap']
      assert(drumsMacroNames.length === expectedDrums.length, `[4] REGRESSION: expected drums track to still show exactly ${expectedDrums.length} macros (${expectedDrums.join(', ')}), got ${drumsMacroNames.length}: ${drumsMacroNames.join(', ')}`)
      for (const name of expectedDrums) {
        assert(drumsMacroNames.includes(name), `[4] REGRESSION: expected drums track to still offer "${name}", got: ${drumsMacroNames.join(', ')}`)
      }
      assert(!drumsMacroNames.some((n) => ['filter-sweep', 'grit', 'warmth', 'motion', 'width'].includes(n)), `[4] REGRESSION: synth-only macros must NOT leak onto a drums track via the new OR clause, got: ${drumsMacroNames.join(', ')}`)
      console.log(`[4] PASS: drums track Macro row unaffected — still exactly [${drumsMacroNames.join(', ')}]`)
      results.check4 = { pass: true, drumsMacroNames }
    }

    // ============================================================================================
    // CHECK 5 — InstrumentPanel.tsx DOM ORDER IS NOW picker -> macros -> chain
    // ============================================================================================
    {
      await page.evaluate(() => window.__store.getState().setSelectedTrack('keys'))
      await page.click('[data-pane-tab="device"]')
      await page.waitForSelector('[data-testid="soundfont-picker"]', { timeout: 5000 })
      await page.waitForSelector('[data-testid="macro-row"]', { timeout: 5000 })
      await page.waitForSelector('[data-testid="effect-chain"]', { timeout: 5000 })

      const order = await page.evaluate(() => {
        const panel = document.querySelector('.synth-panel')
        const all = Array.from(panel.querySelectorAll('[data-testid]'))
        return all.map((el) => el.getAttribute('data-testid')).filter((t) => ['soundfont-picker', 'macro-row', 'effect-chain'].includes(t))
      })
      console.log(`[5] InstrumentPanel.tsx DOM order of key sections: [${order.join(' -> ')}]`)
      assert(order.length === 3, `[5] expected to find all 3 landmark sections (soundfont-picker, macro-row, effect-chain), got: ${order.join(', ')}`)
      assert(order[0] === 'soundfont-picker', `[5] expected "soundfont-picker" (picker) first, got order: ${order.join(' -> ')}`)
      assert(order[1] === 'macro-row', `[5] BUG: expected "macro-row" (macros) SECOND — directly after the picker, not after the soundfont knob block — got order: ${order.join(' -> ')}`)
      assert(order[2] === 'effect-chain', `[5] expected "effect-chain" (chain) LAST, got order: ${order.join(' -> ')}`)
      console.log('[5] PASS: InstrumentPanel.tsx now renders picker -> macros -> chain, matching SynthPanel.tsx\'s rhythm')
      results.check5 = { pass: true, order }
    }

    if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
    console.log('\n================ ALL PHASE 28 STREAM FE CHECKS PASSED ================')
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
    console.error('\nPHASE 28 STREAM FE VERIFY FAILED:', err)
    process.exit(1)
  })

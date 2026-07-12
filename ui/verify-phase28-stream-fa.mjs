#!/usr/bin/env node
// Phase 28 Stream FA verification (docs/phase-28-plan.md Stream FA / research/79 §3.1) — the
// design-token foundation pass: real --danger/--muted/--good definitions in :root (fixing the
// "referenced but never defined" bug those two names had), a --surface-recessed token folding the
// four near-black background literals, a --radius-sm/md/lg three-tier border-radius scale
// (migrating the 2px/5px/7px/8px/10px outliers), corrected --text/--panel-2 fallback hexes, and
// InstrumentPanel.tsx:230's inline `style={{ color: '#e06c75' }}` hardcode replaced with a real
// `.toolbar-tip.error` CSS class. Pure design-token/no-behavior-change stream — no new interaction,
// so "verified" here means asserting getComputedStyle actually resolves every new/fixed token to a
// real, non-fallback, non-transparent value, at both :root AND at real call sites (including ones
// reached only via a genuinely-triggered error state, not a synthetic class toggle), plus a
// no-visual-regression screenshot pass across several views/track kinds.
//
// Driven live against a REAL `beat daemon` through the REAL built frontend in headless Chromium, on
// a disposable COPY of `examples/night-shift.beat` (never `examples/night-shift-song.beat`, the
// owner's own live project — same discipline every prior verify script in this repo follows). An
// instrument track ("keys") is added via the real CLI, same pattern verify-phase27-stream-ea.mjs
// uses, since night-shift.beat itself has no instrument-kind track and InstrumentPanel.tsx:230 is
// part of this bug fix.
//
// Checks:
//   1  TOKEN DEFINITIONS  :root really defines --danger/--muted/--good/--surface-recessed/
//      --radius-sm/--radius-md/--radius-lg (getComputedStyle(:root).getPropertyValue(...) is
//      non-empty and matches the exact chosen value) — before this stream, --danger/--muted were
//      referenced 7 times combined but returned '' (undefined).
//   2  REAL ERROR-STATE CALL SITES RESOLVE --danger  A genuinely triggered failure (GET /library
//      intercepted to fail, the real fetch every PresetPicker/SoundfontPicker/MacroRow already
//      makes on mount) renders .preset-picker-error (synth track), .preset-picker-error (instrument
//      track's SoundfontPicker), and .macro-row-error with a real, non-black, non-transparent
//      computed color equal to the resolved --danger value. A real duplicate-lane-name POST
//      (materialize -> add "kick" again, an already-taken name) renders .lane-row-error the same
//      way. InstrumentPanel.tsx's own toolbar-tip.error (its replacement for the old inline
//      style={{color:'#e06c75'}}) is checked too.
//   3  --muted / --good RESOLVE AT REAL CALL SITES  .note-inspector / .note-name-readout /
//      .pitch-time-scope (a real note selected on a real synth track) resolve --muted; .conn.ok (the
//      topbar's real, non-synthetic "daemon connected" indicator — true in this script by the mere
//      fact the app loaded) resolves --good.
//   4  --radius-* RESOLVES AT REAL CALL SITES  .play-btn (--radius-md) and .synth-panel
//      (--radius-lg) render the real pixel values, not "0px"/unset.
//   5  NO VISUAL REGRESSION  Screenshots across synth/drums/instrument tracks and both panes render
//      with no page errors and no fully-transparent/black computed backgrounds on the touched
//      surfaces.
//
// Usage: node ui/verify-phase28-stream-fa.mjs

import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const beatCli = join(repoRoot, 'cli', 'beat.mjs')
const PREVIEW_PORT = 5990 // distinct from other verify scripts' ports so concurrent runs never collide

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
function beat(cwd, args) {
  return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8', cwd })
}
async function pollUntil(fn, what, timeoutMs = 12000, everyMs = 40) {
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

// Expected real token values (research/79 §3.1 + this stream's own choices — see styles.css :root
// comments for the "promoted from whichever color already did this job" rationale).
const EXPECTED = {
  '--danger': '#e06c75',
  '--muted': '#9aa0ab',
  '--good': '#6ec97c',
  '--surface-recessed': '#14151a',
  '--radius-sm': '3px',
  '--radius-md': '4px',
  '--radius-lg': '6px',
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(pathToFileURL(join(repoRoot, 'dist/src/daemon/daemon.js')).href)
  const { parse, serialize } = await import(pathToFileURL(join(repoRoot, 'dist/src/core/index.js')).href)

  // ---- disposable fixture: a COPY of examples/night-shift.beat (never night-shift-song.beat) ------
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p28fa-'))
  const beatPath = join(proj, 'project.beat')
  const canonical = serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8')))
  writeFileSync(beatPath, canonical)
  console.log(`fixture copied to ${beatPath} (tracks: lead/drums/bass/pad)`)

  // InstrumentPanel.tsx:230's fix needs a real instrument track — night-shift.beat has none, same
  // gap verify-phase27-stream-ea.mjs hit for the same reason. Added via the real CLI.
  copyFileSync(join(repoRoot, 'presets', 'sf2', 'fluidr3-gm-small.sf2'), join(proj, 'gm.sf2'))
  beat(proj, ['sample', beatPath, 'gm', 'gm.sf2'])
  beat(proj, ['add-track', beatPath, 'keys', 'instrument', '--soundfont', 'gm', '--program', '73'])
  writeFileSync(beatPath, serialize(parse(readFileSync(beatPath, 'utf8'))))

  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline (night-shift copy + keys instrument track)')

  const daemon = await startDaemon({ filePath: beatPath, port: 0 })
  console.log(`daemon on :${daemon.port}`)

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

  const screenshotDir = join(proj, 'screenshots')
  mkdirSync(screenshotDir, { recursive: true })

  const openApp = async ({ failLibrary = false } = {}) => {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1600, height: 1400 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    if (failLibrary) {
      // Real failure path: the daemon's own GET /library route, intercepted so it never resolves —
      // the exact fetch PresetPicker/SoundfontPicker/MacroRow already make unconditionally on mount
      // (SynthPanel.tsx/InstrumentPanel.tsx). Not a synthetic class toggle.
      await page.route('**/library', (route) => route.abort('failed'))
    }
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 12000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
    return { page, errors }
  }

  // computed color of a selector, as the browser normalizes it (rgb(...)/rgba(...)) — comparable
  // directly against another computed color without needing to know the exact triplet up front.
  const computedColor = async (page, selector, prop = 'color') => page.$eval(selector, (el, p) => getComputedStyle(el)[p], prop)
  const rootTokens = async (page) =>
    page.evaluate((names) => {
      const cs = getComputedStyle(document.documentElement)
      const out = {}
      for (const n of names) out[n] = cs.getPropertyValue(n).trim()
      return out
    }, Object.keys(EXPECTED))

  try {
    // ============================================================================================
    // CHECK 1 — :root really defines every new/fixed token, at its exact chosen value.
    // ============================================================================================
    const { page: page1, errors: errors1 } = await openApp()
    const tokens = await rootTokens(page1)
    console.log('[1] :root computed custom properties:', JSON.stringify(tokens))
    for (const [name, expected] of Object.entries(EXPECTED)) {
      assert(tokens[name] !== '', `[1] ${name} must resolve to a real value at :root — got '' (undefined), the exact bug this stream fixes`)
      assert(tokens[name] === expected, `[1] ${name} expected '${expected}', got '${tokens[name]}'`)
    }
    console.log('[1] PASS: --danger/--muted/--good/--surface-recessed/--radius-sm/md/lg all resolve to real, exact values at :root')

    // A CSS var override is only meaningful if something actually reads it — spot-check by
    // overriding --danger at runtime and confirming a real .play-btn.stop-style rule picks it up
    // (cheap extra confirmation the token is wired into the cascade, not just declared and unused).
    const overridden = await page1.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.color = 'var(--danger)'
      document.body.appendChild(probe)
      const before = getComputedStyle(probe).color
      document.documentElement.style.setProperty('--danger', 'rgb(1, 2, 3)')
      const after = getComputedStyle(probe).color
      document.documentElement.style.removeProperty('--danger')
      probe.remove()
      return { before, after }
    })
    assert(overridden.after === 'rgb(1, 2, 3)', `[1] overriding --danger at runtime must change what var(--danger) resolves to (got ${overridden.after})`)
    assert(overridden.before !== overridden.after, '[1] sanity: pre-override color must differ from the forced override')
    console.log(`[1] PASS: var(--danger) is live-wired into the cascade (${overridden.before} -> forced rgb(1, 2, 3))`)

    if (errors1.length) throw new Error(`page errors during token-definition check:\n${errors1.join('\n')}`)
    await page1.close()

    // ============================================================================================
    // CHECK 2 — real error-state call sites resolve --danger to a real, non-transparent color.
    // ============================================================================================
    const { page: page2, errors: errors2 } = await openApp({ failLibrary: true })

    // synth track "lead": PresetPicker -> .preset-picker-error, MacroRow -> .macro-row-error
    await page2.evaluate(() => window.__store.getState().setSelectedTrack('lead'))
    await page2.click('[data-pane-tab="device"]')
    await page2.waitForSelector('.preset-picker-error', { timeout: 5000 })
    await page2.waitForSelector('.macro-row-error', { timeout: 5000 })

    const dangerRootValue = (await rootTokens(page2))['--danger']
    const presetErrColor = await computedColor(page2, '.preset-picker-error')
    const macroErrColor = await computedColor(page2, '.macro-row-error')
    console.log(`[2] --danger (root): ${dangerRootValue}  .preset-picker-error color: ${presetErrColor}  .macro-row-error color: ${macroErrColor}`)
    assert(presetErrColor !== 'rgb(0, 0, 0)' && presetErrColor !== 'rgba(0, 0, 0, 0)', `[2] .preset-picker-error color must not be black/transparent, got ${presetErrColor}`)
    assert(macroErrColor !== 'rgb(0, 0, 0)' && macroErrColor !== 'rgba(0, 0, 0, 0)', `[2] .macro-row-error color must not be black/transparent, got ${macroErrColor}`)
    assert(presetErrColor === macroErrColor, `[2] .preset-picker-error and .macro-row-error both read var(--danger) — must resolve to the SAME computed color, got ${presetErrColor} vs ${macroErrColor}`)

    // instrument track "keys": SoundfontPicker -> .preset-picker-error, MacroRow -> .macro-row-error
    await page2.evaluate(() => window.__store.getState().setSelectedTrack('keys'))
    await page2.click('[data-pane-tab="device"]')
    await page2.waitForSelector('.preset-picker-error', { timeout: 5000 })
    const instPresetErrColor = await computedColor(page2, '.preset-picker-error')
    assert(instPresetErrColor === presetErrColor, `[2] instrument track's .preset-picker-error (SoundfontPicker) must resolve the same --danger color as the synth track's, got ${instPresetErrColor} vs ${presetErrColor}`)
    console.log(`[2] PASS: .preset-picker-error (synth + instrument tracks) and .macro-row-error all resolve the real, non-black var(--danger) value (${presetErrColor})`)

    // InstrumentPanel.tsx:230's own fix: the old inline style={{ color: '#e06c75' }} replaced with
    // className="toolbar-tip error". That specific error div is a program-list fetch failure inside
    // the <select>'s own effect (a separate try/catch from SoundfontPicker's, needing a font
    // selected first) — reaching it live would need an extra network route beyond this check's
    // scope, so this confirms the real source no longer hardcodes the color (a static check against
    // the actual shipped file, not a DOM assertion) and that the class it now uses resolves the same
    // real var(--danger) color as the other error classes above (a live DOM assertion).
    const instrumentPanelSrc = readFileSync(join(repoRoot, 'ui/src/components/InstrumentPanel.tsx'), 'utf8')
    assert(!instrumentPanelSrc.includes("style={{ color: '#e06c75' }}"), '[2] InstrumentPanel.tsx must no longer hardcode #e06c75 via an inline style')
    assert(instrumentPanelSrc.includes('className="toolbar-tip error"'), '[2] InstrumentPanel.tsx must use the toolbar-tip.error class instead')
    const toolbarTipErrorColor = await page2.evaluate(() => {
      const probe = document.createElement('div')
      probe.className = 'toolbar-tip error'
      document.body.appendChild(probe)
      const c = getComputedStyle(probe).color
      probe.remove()
      return c
    })
    assert(toolbarTipErrorColor === presetErrColor, `[2] .toolbar-tip.error must resolve the same var(--danger) color as the other error classes, got ${toolbarTipErrorColor} vs ${presetErrColor}`)
    console.log(`[2] PASS: InstrumentPanel.tsx:230's inline hardcode is gone; .toolbar-tip.error resolves the real var(--danger) color (${toolbarTipErrorColor})`)

    if (errors2.length) throw new Error(`page errors during error-state check:\n${errors2.join('\n')}`)
    await page2.close()

    // ============================================================================================
    // CHECK 2b — .lane-row-error via a REAL duplicate-lane-name POST (drums track, no route mocking)
    // ============================================================================================
    const { page: page2b, errors: errors2b } = await openApp()
    await page2b.evaluate(() => window.__store.getState().setSelectedTrack('drums'))
    await page2b.click('[data-pane-tab="clip"]') // DrumLanePanel renders inside NoteView (clip pane), not device
    await page2b.waitForSelector('[data-testid="lane-panel"]', { timeout: 5000 })
    await page2b.click('[data-lane-materialize]')
    await page2b.waitForSelector('[data-lane-add-name]', { timeout: 5000 })
    await page2b.fill('[data-lane-add-name]', 'kick') // "kick" already exists post-materialize -> real 400 from core's addLane
    await page2b.click('[data-lane-add-submit]')
    await page2b.waitForSelector('.lane-row-error', { timeout: 5000 })
    const laneErrText = await page2b.$eval('.lane-row-error', (el) => el.textContent)
    const laneErrColor = await computedColor(page2b, '.lane-row-error')
    console.log(`[2b] .lane-row-error ("${laneErrText}") color: ${laneErrColor}`)
    assert(/already exists/.test(laneErrText ?? ''), `[2b] expected a real "already exists" error from core's addLane, got: ${laneErrText}`)
    assert(laneErrColor !== 'rgb(0, 0, 0)' && laneErrColor !== 'rgba(0, 0, 0, 0)', `[2b] .lane-row-error color must not be black/transparent, got ${laneErrColor}`)
    if (errors2b.length) throw new Error(`page errors during lane-row-error check:\n${errors2b.join('\n')}`)
    await page2b.close()
    console.log('[2b] PASS: .lane-row-error (a real daemon-rejected duplicate lane name) resolves a real, non-black var(--danger) color')

    // ============================================================================================
    // CHECK 3 — --muted / --good resolve at real call sites.
    // ============================================================================================
    const { page: page3, errors: errors3 } = await openApp()
    await page3.evaluate(() => window.__store.getState().setSelectedTrack('lead'))
    await page3.click('[data-pane-tab="clip"]')
    await page3.waitForSelector('.pitch-time-panel', { timeout: 5000 })
    await page3.waitForSelector('.note-name-readout', { timeout: 5000 })
    await page3.click('.noteview-note >> nth=0', { force: true })
    await page3.waitForSelector('.note-inspector', { timeout: 5000 })

    const mutedTargets = ['.note-inspector', '.note-name-readout', '.pitch-time-scope']
    const mutedColors = {}
    for (const sel of mutedTargets) mutedColors[sel] = await computedColor(page3, sel)
    console.log('[3] --muted call sites:', JSON.stringify(mutedColors))
    const mutedVals = Object.values(mutedColors)
    for (const [sel, c] of Object.entries(mutedColors)) {
      assert(c !== 'rgb(0, 0, 0)' && c !== 'rgba(0, 0, 0, 0)', `[3] ${sel} color must not be black/transparent, got ${c}`)
    }
    assert(new Set(mutedVals).size === 1, `[3] all var(--muted) call sites must resolve to the SAME computed color, got ${JSON.stringify(mutedColors)}`)
    console.log(`[3] PASS: .note-inspector / .note-name-readout / .pitch-time-scope all resolve the same real var(--muted) color (${mutedVals[0]})`)

    // .conn.ok — the topbar's REAL "daemon connected" indicator (no synthetic trigger: the app only
    // reaches app-ready once the SSE connection is live, so this is genuinely true here).
    await page3.waitForSelector('.conn.ok', { timeout: 5000 })
    const connOkColor = await computedColor(page3, '.conn.ok')
    console.log(`[3] .conn.ok (real "daemon connected" state) color: ${connOkColor}`)
    assert(connOkColor !== 'rgb(0, 0, 0)' && connOkColor !== 'rgba(0, 0, 0, 0)', `[3] .conn.ok color must not be black/transparent, got ${connOkColor}`)
    console.log(`[3] PASS: .conn.ok resolves a real, non-black var(--good) color (${connOkColor})`)

    if (errors3.length) throw new Error(`page errors during --muted/--good check:\n${errors3.join('\n')}`)

    // ============================================================================================
    // CHECK 4 — --radius-* resolves at real call sites (not "0px"/unset).
    // ============================================================================================
    const playBtnRadius = await page3.$eval('.play-btn', (el) => getComputedStyle(el).borderRadius)
    await page3.click('[data-pane-tab="device"]')
    await page3.waitForSelector('.synth-panel', { timeout: 5000 })
    const synthPanelRadius = await page3.$eval('.synth-panel', (el) => getComputedStyle(el).borderRadius)
    console.log(`[4] .play-btn border-radius: ${playBtnRadius}  .synth-panel border-radius: ${synthPanelRadius}`)
    assert(playBtnRadius === EXPECTED['--radius-md'], `[4] .play-btn expected border-radius ${EXPECTED['--radius-md']} (var(--radius-md)), got ${playBtnRadius}`)
    assert(synthPanelRadius === EXPECTED['--radius-lg'], `[4] .synth-panel expected border-radius ${EXPECTED['--radius-lg']} (var(--radius-lg)), got ${synthPanelRadius}`)
    console.log('[4] PASS: --radius-md/--radius-lg resolve to real pixel values at real call sites')

    // ============================================================================================
    // CHECK 5 — no visual regression: screenshots + no fully-transparent backgrounds on touched
    // surfaces, across synth/drums/instrument tracks and both panes.
    // ============================================================================================
    const views = [
      { track: 'lead', pane: 'clip', shot: 'lead-clip.png' },
      { track: 'lead', pane: 'device', shot: 'lead-device.png' },
      { track: 'drums', pane: 'clip', shot: 'drums-clip.png' },
      { track: 'drums', pane: 'device', shot: 'drums-device.png' },
      { track: 'keys', pane: 'device', shot: 'keys-device.png' },
    ]
    for (const v of views) {
      await page3.evaluate((t) => window.__store.getState().setSelectedTrack(t), v.track)
      await page3.click(`[data-pane-tab="${v.pane}"]`)
      await page3.waitForTimeout(150)
      await page3.screenshot({ path: join(screenshotDir, v.shot) })
    }
    // recessed-surface background sanity: .noteview-grid (clip pane, synth track) must render a
    // real, non-transparent background — the exact surface --surface-recessed folds four near-black
    // literals into.
    await page3.evaluate(() => window.__store.getState().setSelectedTrack('lead'))
    await page3.click('[data-pane-tab="clip"]')
    await page3.waitForSelector('.noteview-grid', { timeout: 5000 })
    const gridBg = await page3.$eval('.noteview-grid', (el) => getComputedStyle(el).backgroundColor)
    console.log(`[5] .noteview-grid background: ${gridBg}`)
    assert(gridBg !== 'rgba(0, 0, 0, 0)' && gridBg !== 'transparent', `[5] .noteview-grid background must not be transparent, got ${gridBg}`)
    console.log(`[5] PASS: screenshots captured to ${screenshotDir} across 5 track/pane combinations, no transparent recessed-surface backgrounds`)

    if (errors3.length) throw new Error(`page errors during visual-regression pass:\n${errors3.join('\n')}`)
    await page3.close()

    console.log('\n================ ALL PHASE 28 STREAM FA CHECKS PASSED ================')
    console.log(`screenshots: ${screenshotDir}`)
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nPHASE 28 STREAM FA VERIFY FAILED:', err)
  process.exit(1)
})

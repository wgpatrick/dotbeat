#!/usr/bin/env node
// Phase 27 Stream EJ verification — content-browser row polish (docs/phase-27-plan.md Stream EJ,
// docs/research/73-ux-browser.md §4 items 1-2). Drives the REAL frontend headlessly against a REAL
// `beat daemon` on a disposable copy of examples/night-shift.beat (never examples/night-shift-song.
// beat, the owner's own live project — same discipline as verify-phase22-content-browser.mjs, whose
// daemon/preview-server harness this script reuses).
//
// Two things are asserted on REAL rendered DOM/CSS state, not "the code path ran":
//
//   EJ1  Every row in ContentBrowser.tsx now carries a `<svg class="lib-type-icon" data-type-icon=
//        "...">` distinct per content type (preset-synth / preset-drums / kit / kit-lane /
//        soundfont) — before this stream every row's only "icon" was the identical round preview
//        button regardless of type. Checked two ways: (a) the `data-type-icon` attribute differs
//        across 5 different row kinds (all pairwise distinct, not just "not literally the same
//        button"), and (b) the actual SVG markup (the <path>/<rect>/<circle> content) differs
//        between two of them — a renamed attribute on an otherwise-identical icon would fail this.
//   EJ2  Clicking a row's preview button gives the ROW ITSELF (not just the button) a real
//        in-place "currently previewing" visual state (`.lib-row-previewing`, a running CSS pulse
//        animation, confirmed via getComputedStyle) that (a) appears promptly after the click, (b)
//        clears on its own once that preview's approximate audible duration has elapsed, and (c)
//        clears IMMEDIATELY — before its own duration elapses — the instant a different row starts
//        previewing, since ContentBrowser.tsx's `playingKey` state is exclusive to one row at a
//        time. At no point should more than one row carry `.lib-row-previewing` simultaneously.
//
// Usage: node ui/verify-phase27-stream-ej.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8541
const PREVIEW_PORT = 5361

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
async function pollUntil(fn, what, timeoutMs = 9000, everyMs = 25) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}

const count = (page, sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel)
const hasClass = (page, sel, cls) =>
  page.evaluate(({ sel, cls }) => !!document.querySelector(sel)?.classList.contains(cls), { sel, cls })

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  // Disposable copy of examples/night-shift.beat in a temp dir — NEVER the owner's own live
  // examples/night-shift-song.beat. Round-tripped through parse/serialize the same way
  // verify-phase22-content-browser.mjs does, purely to normalize formatting.
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p27-ej-'))
  const beatPath = join(proj, 'night-shift.beat')
  writeFileSync(beatPath, serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8'))))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline night-shift (disposable copy)')

  const daemon = await startDaemon({ filePath: beatPath, port: PORT })
  console.log(`daemon up on :${daemon.port}, project ${beatPath}`)

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  preview.stdout.on('data', () => {})
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))
  await pollUntil(
    async () => {
      try {
        return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok
      } catch {
        return false
      }
    },
    'vite preview to serve',
    15000,
  )
  console.log(`ui served on :${PREVIEW_PORT}`)

  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const results = {}
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1600, height: 980 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    await page.click('[data-action="toggle-library"]')
    await page.waitForSelector('[data-testid="content-browser"]', { timeout: 5000 })
    await pollUntil(async () => (await count(page, '.lib-row')) > 0, 'library catalog to load rows')

    // ============ EJ1: distinct per-row type icon ============
    // every rendered row must carry exactly one type icon (no row silently reverted to "no icon at
    // all" or "two icons").
    const rowCount = await count(page, '.lib-row')
    const iconCount = await count(page, 'svg.lib-type-icon')
    if (rowCount !== iconCount) throw new Error(`[EJ1] expected exactly one .lib-type-icon per .lib-row (${rowCount} rows), got ${iconCount} icons`)
    console.log(`[EJ1] every one of the ${rowCount} rendered rows carries exactly one type icon`)

    const iconInfo = await page.evaluate(() => {
      const info = (sel) => {
        const svg = document.querySelector(sel)?.querySelector('svg.lib-type-icon')
        return svg ? { type: svg.getAttribute('data-type-icon'), markup: svg.innerHTML.replace(/\s+/g, ' ').trim() } : null
      }
      return {
        synthPreset: info('[data-preset="deep-sub-bass"]'),
        drumPreset: info('[data-preset="techno-kit"]'),
        kitHead: info('.lib-kit-head[data-kit="kit-init"]'),
        kitLane: info('[data-kit="kit-init"][data-lane="kick"]'),
        soundfont: info('[data-soundfont="upright-piano-kw-small.sf2"]'),
      }
    })
    console.log('[EJ1] icon types found:', JSON.stringify(Object.fromEntries(Object.entries(iconInfo).map(([k, v]) => [k, v?.type]))))
    for (const [k, v] of Object.entries(iconInfo)) {
      if (!v || !v.type) throw new Error(`[EJ1] row "${k}" has no type icon at all`)
    }
    const types = Object.values(iconInfo).map((v) => v.type)
    const distinctTypes = new Set(types)
    if (distinctTypes.size !== types.length) {
      throw new Error(`[EJ1] expected all ${types.length} content-type rows to render DISTINCT type icons, got only ${distinctTypes.size} distinct values: ${types.join(', ')}`)
    }
    // Also confirm the actual SVG path/shape markup differs, not just a renamed attribute on
    // otherwise-identical markup — pick two that must clearly differ (a synth-preset wave vs. a
    // soundfont's note glyph).
    if (iconInfo.synthPreset.markup === iconInfo.soundfont.markup) {
      throw new Error('[EJ1] synth-preset and soundfont rows render identical SVG markup despite different data-type-icon values')
    }
    if (iconInfo.kitHead.markup === iconInfo.kitLane.markup) {
      throw new Error('[EJ1] kit-head and kit-lane rows render identical SVG markup — the whole-kit row and a single one-shot lane must look different')
    }
    console.log(`[EJ1] PASS: ${distinctTypes.size} distinct type icons across preset-synth/preset-drums/kit/kit-lane/soundfont rows, with genuinely different SVG markup`)
    results.ej1 = { rowCount, iconCount, distinctTypeCount: distinctTypes.size, types }
    await page.screenshot({ path: join(uiDir, 'verify-p27-ej-icons.png') })

    // ============ EJ2: in-place row-level "currently previewing" indicator ============
    const previewingBefore = await count(page, '.lib-row-previewing')
    if (previewingBefore !== 0) throw new Error(`[EJ2] expected no row to be in a previewing state before any preview click, found ${previewingBefore}`)

    const acidBassRow = '[data-preset="acid-bass"]'
    await page.click(`${acidBassRow} [data-action="preview"]`)
    await pollUntil(() => hasClass(page, acidBassRow, 'lib-row-previewing'), '[EJ2] acid-bass row to show the previewing state', 1200)
    const animName = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).animationName, acidBassRow)
    if (!animName || animName === 'none') throw new Error(`[EJ2] expected a running CSS animation on the previewing row, got animation-name="${animName}"`)
    const btnActive = await hasClass(page, `${acidBassRow} [data-action="preview"]`, 'lib-preview-btn-active')
    if (!btnActive) throw new Error('[EJ2] expected the preview button itself to also carry the active/playing state')
    console.log(`[EJ2a] PASS: clicking acid-bass's preview gives the ROW a real in-place previewing state (animation-name="${animName}"), not just the button`)

    // it must clear on its own once the (synth-preset) preview's approximate duration has elapsed —
    // ContentBrowser.tsx uses ~1800ms for a synth preset.
    await pollUntil(() => hasClass(page, acidBassRow, 'lib-row-previewing').then((v) => !v), '[EJ2] acid-bass row previewing state to clear on its own', 4000)
    console.log('[EJ2b] PASS: the previewing state clears on its own once the preview finishes, with no other row ever having started')
    results.ej2_selfClear = true

    // ============ EJ3: starting a DIFFERENT preview clears the previous row immediately ============
    await page.click(`${acidBassRow} [data-action="preview"]`)
    await pollUntil(() => hasClass(page, acidBassRow, 'lib-row-previewing'), '[EJ3] acid-bass row to show previewing again', 1200)

    const kickLaneRow = '[data-kit="kit-init"][data-lane="kick"]'
    await page.click(`${kickLaneRow} [data-action="preview"]`)
    // the switch should be immediate — well inside acid-bass's own ~1800ms window, so this can only
    // pass if playingKey is genuinely exclusive, not "both rows happen to clear around the same time."
    await pollUntil(
      () =>
        page.evaluate(
          ({ a, b }) => !document.querySelector(a).classList.contains('lib-row-previewing') && document.querySelector(b).classList.contains('lib-row-previewing'),
          { a: acidBassRow, b: kickLaneRow },
        ),
      '[EJ3] previewing a different row to immediately hand off the indicator',
      800,
    )
    const simultaneousCount = await count(page, '.lib-row-previewing')
    if (simultaneousCount !== 1) throw new Error(`[EJ3] expected exactly one row previewing at a time, found ${simultaneousCount}`)
    console.log('[EJ3] PASS: previewing kit-init/kick immediately cleared acid-bass\'s indicator and took it over — never two rows previewing at once')
    results.ej3 = { simultaneousCount }

    // let the kick-lane preview's own (shorter, ~900ms) window finish so the daemon/page can close cleanly.
    await pollUntil(() => hasClass(page, kickLaneRow, 'lib-row-previewing').then((v) => !v), '[EJ3] kick-lane row previewing state to clear', 3000)

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ ALL PHASE 27 STREAM EJ CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nPHASE 27 STREAM EJ VERIFY FAILED:', err)
  process.exit(1)
})

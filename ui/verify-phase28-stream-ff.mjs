#!/usr/bin/env node
// Phase 28 Stream FF verification — Content Browser calibration (docs/phase-28-plan.md Stream FF,
// docs/research/78-ux-browser-round2.md §3 items 1-3). Drives the REAL frontend headlessly against
// a REAL `beat daemon` on a disposable copy of examples/night-shift.beat (never examples/
// night-shift-song.beat, the owner's own live project — same discipline as
// verify-phase27-stream-ej.mjs, whose daemon/preview-server harness this script reuses; this file
// is fully isolated to ContentBrowser.tsx, same as EJ was, so there's no merge-order dependency).
//
// Three things calibrated live (research/78 §3 items 1-3), each asserted on REAL computed
// styles/DOM, not "the code changed":
//
//   FF1  `.lib-type-icon`'s rest-state color used to be identical to `var(--text-dim)` (the same
//        gray as the row's dim meta text), so Phase 27's per-type-icon differentiation only
//        actually popped on hover/preview. Asserts the REST-state computed color now differs
//        MEANINGFULLY from --text-dim's computed color — both a WCAG contrast-ratio check between
//        the two colors and a raw RGB hex-distance check, not just "the strings differ" (a 1-unit
//        RGB nudge would technically differ but not read as different) — while still stopping
//        clearly short of the hover/active accent color (keeps the "quiet, not loud" rest state).
//   FF2  The preview-pulse's peak alpha is sampled from the REAL animated computed
//        `background-color` on a `.lib-row-previewing` row (not just read as a string out of the
//        CSS source) across a full ~1.1s animation cycle, and asserted to land at the recalibrated
//        value chosen after live-viewing both the old (0.24, solid fill) and new (0.15, soft wash)
//        renders with Playwright screenshots. Cross-checked against the literal value in
//        styles.css's `@keyframes lib-row-pulse` so the source and the rendered behavior agree.
//   FF3  The active preview button now renders a real `<svg data-icon="pause-active">` with two
//        distinguishable, non-overlapping `<rect>` bars (checked via each rect's x/width so they
//        provably don't visually merge into one blob) instead of the Unicode `❚❚` glyph — asserts
//        the DOM node is actually an SVG with real path/rect geometry, not a text node relying on
//        font-glyph rendering at a size the font wasn't hinted for.
//
// Usage: node ui/verify-phase28-stream-ff.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8542
const PREVIEW_PORT = 5362

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

// ---- color math (WCAG relative luminance / contrast ratio + raw RGB distance) ----
function parseRgb(cssColor) {
  const m = cssColor.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/)
  if (!m) throw new Error(`could not parse CSS color: ${cssColor}`)
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] }
}
function relLuminance({ r, g, b }) {
  const lin = (c) => {
    const cs = c / 255
    return cs <= 0.03928 ? cs / 12.92 : ((cs + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
function contrastRatio(c1, c2) {
  const l1 = relLuminance(c1)
  const l2 = relLuminance(c2)
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}
function rgbDistance(c1, c2) {
  return Math.sqrt((c1.r - c2.r) ** 2 + (c1.g - c2.g) ** 2 + (c1.b - c2.b) ** 2)
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  // Disposable copy of examples/night-shift.beat in a temp dir — NEVER the owner's own live
  // examples/night-shift-song.beat.
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p28-ff-'))
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

    // ============ FF1: type-icon rest-state contrast vs. --text-dim ============
    const restColors = await page.evaluate(() => {
      const icon = document.querySelector('.lib-type-icon')
      const meta = document.querySelector('.lib-row-meta')
      const root = getComputedStyle(document.documentElement)
      return {
        iconColor: getComputedStyle(icon).color,
        metaColor: getComputedStyle(meta).color,
        textDimVar: root.getPropertyValue('--text-dim').trim(),
      }
    })
    console.log('[FF1] rest-state colors:', JSON.stringify(restColors))
    // sanity: the row's dim meta text (unchanged by this stream) really does render as --text-dim,
    // confirming our baseline for "identical to --text-dim" is the right one to diff against.
    const metaRgb = parseRgb(restColors.metaColor)
    const iconRgb = parseRgb(restColors.iconColor)
    // --text-dim is #8a8f9a -> rgb(138,143,154)
    const textDimRgb = { r: 138, g: 143, b: 154 }
    const metaVsTextDim = rgbDistance(metaRgb, textDimRgb)
    if (metaVsTextDim > 4) {
      throw new Error(`[FF1] expected .lib-row-meta to still render as --text-dim (rgb-distance ${metaVsTextDim.toFixed(1)}), baseline assumption broken`)
    }

    const iconVsTextDimRatio = contrastRatio(iconRgb, textDimRgb)
    const iconVsTextDimDist = rgbDistance(iconRgb, textDimRgb)
    console.log(`[FF1] icon vs --text-dim: contrast ratio ${iconVsTextDimRatio.toFixed(2)}:1, rgb-distance ${iconVsTextDimDist.toFixed(1)}`)
    if (iconVsTextDimRatio < 1.3) {
      throw new Error(`[FF1] type-icon rest color is not meaningfully different from --text-dim: contrast ratio only ${iconVsTextDimRatio.toFixed(2)}:1`)
    }
    if (iconVsTextDimDist < 20) {
      throw new Error(`[FF1] type-icon rest color is not meaningfully different from --text-dim: rgb-distance only ${iconVsTextDimDist.toFixed(1)}`)
    }
    // it should also still have real idle contrast against the row background itself.
    const bg = { r: 0x16, g: 0x17, b: 0x1b } // --bg
    const iconVsBgRatio = contrastRatio(iconRgb, bg)
    console.log(`[FF1] icon vs --bg: contrast ratio ${iconVsBgRatio.toFixed(2)}:1`)
    if (iconVsBgRatio < 4.5) {
      throw new Error(`[FF1] type-icon rest color has insufficient contrast against the row background: ${iconVsBgRatio.toFixed(2)}:1`)
    }
    // ...but should stop short of the loud hover/active accent color (#e0a13c), keeping the "quiet,
    // not loud" rest state the plan calls for.
    const accentRgb = { r: 0xe0, g: 0xa1, b: 0x3c }
    const iconVsAccentDist = rgbDistance(iconRgb, accentRgb)
    if (iconVsAccentDist < 40) {
      throw new Error(`[FF1] type-icon rest color reads too close to the hover/active accent color (rgb-distance ${iconVsAccentDist.toFixed(1)}) — should be quieter at rest`)
    }
    console.log('[FF1] PASS: type-icon rest-state color has real idle contrast against both --text-dim and the row background, while staying clearly short of the hover/active accent')
    results.ff1 = { iconColor: restColors.iconColor, textDimContrastRatio: iconVsTextDimRatio, textDimRgbDistance: iconVsTextDimDist, bgContrastRatio: iconVsBgRatio }

    // ============ FF2: preview-pulse peak alpha ============
    const acidBassRow = '[data-preset="acid-bass"]'
    await page.click(`${acidBassRow} [data-action="preview"]`)
    await pollUntil(() => hasClass(page, acidBassRow, 'lib-row-previewing'), '[FF2] acid-bass row to show the previewing state', 1200)

    const alphas = []
    const t0 = Date.now()
    while (Date.now() - t0 < 1300) {
      const bgColor = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).backgroundColor, acidBassRow)
      alphas.push(parseRgb(bgColor).a)
      await sleep(40)
    }
    const peakAlpha = Math.max(...alphas)
    const troughAlpha = Math.min(...alphas)
    console.log(`[FF2] sampled ${alphas.length} frames over one pulse cycle: trough=${troughAlpha.toFixed(3)}, peak=${peakAlpha.toFixed(3)}`)
    if (peakAlpha >= 0.2) {
      throw new Error(`[FF2] preview-pulse peak alpha (${peakAlpha.toFixed(3)}) still reads as a solid fill, not a soft wash`)
    }
    if (peakAlpha < 0.1) {
      throw new Error(`[FF2] preview-pulse peak alpha (${peakAlpha.toFixed(3)}) is unexpectedly low — indicator may have become too faint to notice`)
    }

    // cross-check the rendered peak against the literal value in the CSS source, so the source and
    // the live-rendered behavior can't silently drift apart.
    const cssSrc = readFileSync(join(uiDir, 'src/styles.css'), 'utf8')
    const keyframeMatch = cssSrc.match(/@keyframes lib-row-pulse[\s\S]*?50%\s*\{\s*background:\s*rgba\(\s*224,\s*161,\s*60,\s*([\d.]+)\s*\)/)
    if (!keyframeMatch) throw new Error('[FF2] could not find lib-row-pulse keyframe peak alpha in styles.css source')
    const sourcePeakAlpha = +keyframeMatch[1]
    console.log(`[FF2] styles.css source peak alpha: ${sourcePeakAlpha}`)
    if (Math.abs(sourcePeakAlpha - peakAlpha) > 0.02) {
      throw new Error(`[FF2] rendered peak alpha (${peakAlpha.toFixed(3)}) doesn't match CSS source peak alpha (${sourcePeakAlpha}) — source/behavior drift`)
    }
    if (sourcePeakAlpha >= 0.2) {
      throw new Error(`[FF2] CSS source peak alpha (${sourcePeakAlpha}) still reads as a solid fill, not recalibrated toward a soft wash`)
    }
    console.log(`[FF2] PASS: preview-pulse peak alpha recalibrated to ${sourcePeakAlpha} (was 0.24), confirmed both in the live-rendered computed style and the CSS source, and reads as a soft wash (< 0.2) not a solid fill`)
    results.ff2 = { peakAlpha, troughAlpha, sourcePeakAlpha }

    // ============ FF3: active preview-button glyph is real, legible SVG geometry ============
    const btnActive = await hasClass(page, `${acidBassRow} [data-action="preview"]`, 'lib-preview-btn-active')
    if (!btnActive) throw new Error('[FF3] expected the acid-bass preview button to be in its active state')

    const glyphInfo = await page.evaluate((sel) => {
      const btn = document.querySelector(`${sel} [data-action="preview"]`)
      const svg = btn.querySelector('svg[data-icon="pause-active"]')
      if (!svg) return { hasSvg: false, textContent: btn.textContent }
      const rects = Array.from(svg.querySelectorAll('rect')).map((r) => ({
        x: +r.getAttribute('x'),
        width: +r.getAttribute('width'),
        height: +r.getAttribute('height'),
      }))
      const cs = getComputedStyle(svg)
      return { hasSvg: true, rects, width: svg.getAttribute('width'), height: svg.getAttribute('height'), displayed: cs.display !== 'none' }
    }, acidBassRow)
    console.log('[FF3] active-button glyph info:', JSON.stringify(glyphInfo))
    if (!glyphInfo.hasSvg) {
      throw new Error(`[FF3] active preview button does not render an SVG icon — still relying on a text glyph ("${glyphInfo.textContent}")`)
    }
    if (glyphInfo.rects.length !== 2) {
      throw new Error(`[FF3] expected exactly 2 <rect> bars in the pause icon, found ${glyphInfo.rects.length}`)
    }
    const [barA, barB] = glyphInfo.rects
    // the two bars must be real, non-overlapping geometry — a genuine gap between them, not just
    // two rects stacked on top of each other pretending to be "two bars."
    const [left, right] = barA.x <= barB.x ? [barA, barB] : [barB, barA]
    const gap = right.x - (left.x + left.width)
    console.log(`[FF3] bar geometry: left x=${left.x} w=${left.width}, right x=${right.x} w=${right.width}, gap=${gap}`)
    if (gap <= 0) {
      throw new Error(`[FF3] the two pause-icon bars overlap or touch (gap=${gap}) — would render as a single blob, exactly the bug being fixed`)
    }
    if (left.height < 4 || right.height < 4) {
      throw new Error('[FF3] pause-icon bars are too short to read as distinct vertical bars')
    }
    console.log('[FF3] PASS: active preview button renders a real 2-rect SVG pause icon with a genuine visible gap between the bars, not a Unicode glyph relying on font hinting')
    results.ff3 = glyphInfo

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ ALL PHASE 28 STREAM FF CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nPHASE 28 STREAM FF VERIFY FAILED:', err)
  process.exit(1)
})

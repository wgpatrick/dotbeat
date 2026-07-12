#!/usr/bin/env node
// Phase 27 Stream EG verification — "visually differentiate the five stacked NoteView bottom
// panels" (docs/phase-27-plan.md Stream EG / docs/research/71-ux-clip-view-midi-editing.md §2.8,
// §2.9, P0 item 5). Before this stream, ClipPropertiesPanel (.clip-props), PitchTimePanel
// (.pitch-time-panel), NoteNameReadout (.note-name-readout), and NoteInspector (.note-inspector)
// shared byte-identical CSS (#14151a background, 1px solid var(--line) border, 4px radius, 11px
// font) — confirmed live via Playwright screenshots during this stream's own research pass
// (/tmp/dotbeat-p27-eg-look/*.png, not committed) before writing any fix. DrumLanePanel
// (.lane-panel) already had a distinct collapsible-header treatment, but the plan called for
// picking ONE approach uniformly after looking at both live. Collapsing the other four panels by
// default was rejected: NoteInspector/PitchTimePanel/NoteNameReadout need to stay glanceable while
// editing (NoteInspector in particular remounts fresh, via `key={sel[0]}`, every time the selected
// note changes — a "starts collapsed" default would force a re-expand click on every single-note
// selection). So the fix is a 3px left-border accent per panel, reusing the SAME small hue palette
// the track list already uses to color-code track KIND (.kind-drums/.kind-synth/.kind-instrument/
// .kind-audio, styles.css:308-318) rather than inventing new colors:
//
//   .clip-props        amber  (var(--accent), #e0a13c) — the app's own accent; first/primary panel
//   .pitch-time-panel   blue  (#61afef) — one-shot operations panel
//   .note-name-readout green  (#98c379) — read-only info readout
//   .note-inspector     gray  (#6b7280) — deepest per-note detail, deliberately the quietest accent
//   .lane-panel         cyan  (#56b6c2) — SAME hue as .kind-drums, since this panel is drums-only
//
// Drives the REAL live GUI in headless Chromium against a REAL daemon + built frontend, on a
// disposable copy of examples/night-shift.beat in a temp dir (examples/night-shift-song.beat, the
// owner's own live project, is never touched or read). Asserts on ACTUAL COMPUTED STYLES
// (getComputedStyle border-left-color/-width), not just DOM presence:
//
//   1  SYNTH TRACK ("lead"): .clip-props, .pitch-time-panel, .note-name-readout are all visible
//      with a 3px left border, and their three border colors are pairwise distinct from each other
//      and from the shared 1px var(--line) top/right/bottom border color.
//   2  Selecting a single note reveals .note-inspector with its OWN 3px left border, distinct from
//      all three of the above.
//   3  DRUM TRACK ("drums"): .clip-props (still present, drums also get clip properties) and
//      .lane-panel are both visible with distinct 3px left borders; .pitch-time-panel/
//      .note-name-readout/.note-inspector are correctly ABSENT (drum tracks don't render them —
//      existing, unchanged gating).
//   4  All five panel colors observed across both track selections are pairwise distinct — one
//      unique hue per panel role, not just per-track-visible-set.
//   5  Colors are the SAME on reload (a fresh page load) — confirms the accents are fixed CSS, not
//      anything randomized or session-dependent ("consistent across sessions" per the task).
//
// Usage: node ui/verify-phase27-stream-eg.mjs

import { mkdtempSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 5942

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
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

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(pathToFileURL(join(repoRoot, 'dist/src/daemon/daemon.js')).href)

  // Disposable copy of the fixture project, never the owner's own night-shift-song.beat.
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p27-eg-'))
  const beatPath = join(proj, 'song.beat')
  copyFileSync(join(repoRoot, 'examples/night-shift.beat'), beatPath)
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline')

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

  const openApp = async () => {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1600, height: 1400 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 12000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
    // Tall bottom pane so every stacked panel is actually rendered on-screen (not required for
    // getComputedStyle, which works on off-screen elements too, but keeps this debuggable via
    // screenshots if it ever fails).
    await page.evaluate(() => window.__store.getState().setBottomPaneHeight(1100))
    return { page, errors }
  }

  // border-left-color/-width for a selector; throws if the element isn't present.
  const borderLeft = async (page, selector) =>
    page.$eval(selector, (el) => {
      const cs = getComputedStyle(el)
      return { color: cs.borderLeftColor, width: cs.borderLeftWidth }
    })
  const lineColor = async (page, selector) => page.$eval(selector, (el) => getComputedStyle(el).borderRightColor)
  const isVisible = async (page, selector) => (await page.$(selector)) !== null

  try {
    // ============================================================================================
    // SYNTH TRACK ("lead"): clip-props / pitch-time-panel / note-name-readout, then note-inspector
    // ============================================================================================
    const { page: pageA, errors: errorsA } = await openApp()
    await pageA.evaluate(() => window.__store.getState().setSelectedTrack('lead'))
    await pageA.click('[data-pane-tab="clip"]')
    await pageA.waitForSelector('.clip-props', { timeout: 5000 })
    await pageA.waitForSelector('.pitch-time-panel', { timeout: 5000 })
    await pageA.waitForSelector('.note-name-readout', { timeout: 5000 })

    assert(!(await isVisible(pageA, '.lane-panel')), '[SYNTH] .lane-panel (drum-only) must NOT render on a synth track')
    assert(!(await isVisible(pageA, '.note-inspector')), '[SYNTH] .note-inspector must NOT render before any note is selected')

    const clipProps1 = await borderLeft(pageA, '.clip-props')
    const pitchTime1 = await borderLeft(pageA, '.pitch-time-panel')
    const nameReadout1 = await borderLeft(pageA, '.note-name-readout')
    const lineRef = await lineColor(pageA, '.clip-props') // the shared var(--line) color on the OTHER three edges, for contrast

    console.log(`[SYNTH] .clip-props        border-left: ${clipProps1.width} ${clipProps1.color}`)
    console.log(`[SYNTH] .pitch-time-panel  border-left: ${pitchTime1.width} ${pitchTime1.color}`)
    console.log(`[SYNTH] .note-name-readout border-left: ${nameReadout1.width} ${nameReadout1.color}`)
    console.log(`[SYNTH] shared var(--line) reference (right edge): ${lineRef}`)

    for (const [label, b] of [['.clip-props', clipProps1], ['.pitch-time-panel', pitchTime1], ['.note-name-readout', nameReadout1]]) {
      assert(parseFloat(b.width) >= 3, `[SYNTH] ${label} border-left-width expected >= 3px, got ${b.width}`)
      assert(b.color !== lineRef, `[SYNTH] ${label} border-left-color (${b.color}) must differ from the plain var(--line) border color (${lineRef}) — it needs to read as a deliberate accent, not just the default panel border`)
    }
    assert(clipProps1.color !== pitchTime1.color, `[SYNTH] .clip-props and .pitch-time-panel must have DISTINCT accent colors, both were ${clipProps1.color}`)
    assert(clipProps1.color !== nameReadout1.color, `[SYNTH] .clip-props and .note-name-readout must have DISTINCT accent colors, both were ${clipProps1.color}`)
    assert(pitchTime1.color !== nameReadout1.color, `[SYNTH] .pitch-time-panel and .note-name-readout must have DISTINCT accent colors, both were ${pitchTime1.color}`)
    console.log('[SYNTH] PASS: clip-props/pitch-time-panel/note-name-readout each have a distinct, deliberate (>=3px, non-var(--line)) left-border accent')

    // select a single note -> NoteInspector should mount with its own distinct accent
    await pageA.click('.noteview-note >> nth=0', { force: true })
    await pageA.waitForSelector('.note-inspector', { timeout: 5000 })
    const inspector1 = await borderLeft(pageA, '.note-inspector')
    console.log(`[SYNTH] .note-inspector    border-left: ${inspector1.width} ${inspector1.color}`)
    assert(parseFloat(inspector1.width) >= 3, `[SYNTH] .note-inspector border-left-width expected >= 3px, got ${inspector1.width}`)
    assert(inspector1.color !== lineRef, `[SYNTH] .note-inspector border-left-color (${inspector1.color}) must differ from the plain var(--line) border color`)
    assert(inspector1.color !== clipProps1.color, `[SYNTH] .note-inspector and .clip-props must have DISTINCT accent colors`)
    assert(inspector1.color !== pitchTime1.color, `[SYNTH] .note-inspector and .pitch-time-panel must have DISTINCT accent colors`)
    assert(inspector1.color !== nameReadout1.color, `[SYNTH] .note-inspector and .note-name-readout must have DISTINCT accent colors`)
    console.log('[SYNTH] PASS: .note-inspector (visible only once a note is selected) has its own distinct accent, different from all three always-visible panels')

    if (errorsA.length) throw new Error(`page errors during synth-track run:\n${errorsA.join('\n')}`)
    await pageA.close()

    // ============================================================================================
    // DRUM TRACK ("drums"): clip-props + lane-panel; pitch-time/note-name/note-inspector absent
    // ============================================================================================
    const { page: pageB, errors: errorsB } = await openApp()
    await pageB.evaluate(() => window.__store.getState().setSelectedTrack('drums'))
    await pageB.click('[data-pane-tab="clip"]')
    await pageB.waitForSelector('.clip-props', { timeout: 5000 })
    await pageB.waitForSelector('[data-testid="lane-panel"]', { timeout: 5000 })

    assert(!(await isVisible(pageB, '.pitch-time-panel')), '[DRUMS] .pitch-time-panel (melodic-only) must NOT render on a drum track')
    assert(!(await isVisible(pageB, '.note-name-readout')), '[DRUMS] .note-name-readout (melodic-only) must NOT render on a drum track')
    assert(!(await isVisible(pageB, '.note-inspector')), '[DRUMS] .note-inspector (melodic-note-only) must NOT render on a drum track')

    const clipProps2 = await borderLeft(pageB, '.clip-props')
    const lanePanel = await borderLeft(pageB, '.lane-panel')
    console.log(`[DRUMS] .clip-props  border-left: ${clipProps2.width} ${clipProps2.color}`)
    console.log(`[DRUMS] .lane-panel  border-left: ${lanePanel.width} ${lanePanel.color}`)

    assert(parseFloat(lanePanel.width) >= 3, `[DRUMS] .lane-panel border-left-width expected >= 3px, got ${lanePanel.width}`)
    assert(lanePanel.color !== lineRef, `[DRUMS] .lane-panel border-left-color (${lanePanel.color}) must differ from the plain var(--line) border color`)
    assert(lanePanel.color !== clipProps2.color, `[DRUMS] .lane-panel and .clip-props must have DISTINCT accent colors, both were ${lanePanel.color}`)
    assert(clipProps2.color === clipProps1.color, `[DRUMS] .clip-props' accent color must be the SAME on a drum track as on a synth track (one fixed color per panel ROLE, not per track), got ${clipProps2.color} vs synth's ${clipProps1.color}`)
    console.log('[DRUMS] PASS: .clip-props (same color as on the synth track) and .lane-panel (its own distinct accent) both render; the three melodic-only panels correctly stay absent')

    if (errorsB.length) throw new Error(`page errors during drum-track run:\n${errorsB.join('\n')}`)
    await pageB.close()

    // ============================================================================================
    // Cross-check: all five distinct panel-role colors observed across both track kinds are
    // pairwise unique — one hue per role, not an accidental coincidence of only 2-3 hues reused.
    // ============================================================================================
    const allColors = {
      'clip-props': clipProps1.color,
      'pitch-time-panel': pitchTime1.color,
      'note-name-readout': nameReadout1.color,
      'note-inspector': inspector1.color,
      'lane-panel': lanePanel.color,
    }
    const entries = Object.entries(allColors)
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        assert(entries[i][1] !== entries[j][1], `all five panel accent colors must be pairwise distinct: ${entries[i][0]} and ${entries[j][0]} are both ${entries[i][1]}`)
      }
    }
    console.log(`[ALL] PASS: all five panel-role accent colors are pairwise distinct: ${JSON.stringify(allColors)}`)

    // ============================================================================================
    // Reload check: colors are fixed CSS, consistent across a fresh page load / session.
    // ============================================================================================
    const { page: pageC, errors: errorsC } = await openApp()
    await pageC.evaluate(() => window.__store.getState().setSelectedTrack('lead'))
    await pageC.click('[data-pane-tab="clip"]')
    await pageC.waitForSelector('.clip-props', { timeout: 5000 })
    const clipProps3 = await borderLeft(pageC, '.clip-props')
    const pitchTime3 = await borderLeft(pageC, '.pitch-time-panel')
    assert(clipProps3.color === clipProps1.color, `[RELOAD] .clip-props accent color must be identical across a fresh page load: ${clipProps3.color} vs ${clipProps1.color}`)
    assert(pitchTime3.color === pitchTime1.color, `[RELOAD] .pitch-time-panel accent color must be identical across a fresh page load: ${pitchTime3.color} vs ${pitchTime1.color}`)
    console.log('[RELOAD] PASS: panel accent colors are byte-identical across a fresh page load — fixed CSS, not session-random')
    if (errorsC.length) throw new Error(`page errors during reload check:\n${errorsC.join('\n')}`)
    await pageC.close()

    console.log('\n================ ALL PHASE 27 STREAM EG CHECKS PASSED ================')
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nPHASE 27 STREAM EG VERIFY FAILED:', err)
  process.exit(1)
})

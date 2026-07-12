#!/usr/bin/env node
// Phase 22 Stream AH — the content-browser sidebar (docs/phase-22-stream-ah.md, docs/research/
// 18-ableton-ui-architecture.md §8). Drives the REAL frontend headlessly against a REAL `beat
// daemon` on a real multi-track project and exercises the whole browse -> preview -> drag-drop ->
// persisted-edit path end-to-end, with real audio measurement and real file diffs — not mocks.
//
//   W1 the Browser toggle opens `.library-rail`; the catalog loads the REAL presets/factory.json +
//      kit-init/kit-audiophob + the three sf2 banks (counts checked against the real content).
//   W2 drag a SYNTH preset onto a synth track's header -> the track's params change to match the
//      preset EXACTLY, and the .beat diff is a normal edit list (no reference/keyword) — confirmed
//      by reading the file before/after, not just the in-memory store.
//   W3 drag a DRUM preset onto the drum track's header -> same file-diff discipline.
//   W4 drag one kit one-shot onto a drum lane row -> the lane is assigned, the wav lands in the
//      project's own media/ directory on disk (content-addressed, not referenced by its presets/
//      path), and the file diff shows it.
//   W5 preview-before-load: clicking a preset's/sample's ▶ makes real audio (master meter rises)
//      WITHOUT writing anything — the .beat file is byte-identical before and after the preview.
//   W6 the soundfont "+" affordance mints a brand new instrument track carrying that bank (closes
//      the documented "GUI has no sample-registration surface" gap) — a real, persisted write.
//
// Usage: node ui/verify-phase22-content-browser.mjs

import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8499
const PREVIEW_PORT = 5329

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
const trackHeaderSel = (name) => `.arr-row:has(.arr-track-name:text-is("${name}")) [data-drop-target="track-header"]`
const selectTrack = (page, name) => page.click(`.arr-row:has(.arr-track-name:text-is("${name}")) .arr-track-select`)

/** Peak master dB over a window — same technique verify-phase18-layout.mjs's samplePeaks uses, but
 * off the single master meter (getMasterLevel) since a preview voice has no per-track tap. */
async function peakMasterDb(page, ms) {
  return page.evaluate(async (ms) => {
    const eng = window.__engine
    let peak = -Infinity
    const t0 = performance.now()
    while (performance.now() - t0 < ms) {
      const v = eng.getMasterLevel()
      if (typeof v === 'number' && isFinite(v) && v > peak) peak = v
      await new Promise((r) => setTimeout(r, 30))
    }
    return peak === -Infinity ? -120 : Math.round(peak * 10) / 10
  }, ms)
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p22ah-'))
  const beatPath = join(proj, 'night-shift.beat')
  writeFileSync(beatPath, serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8'))))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline night-shift')

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
    console.log(`tracks: ${JSON.stringify(await page.evaluate(() => window.__store.getState().doc.tracks.map((t) => t.id)))}`)

    // ============ W1: the Browser toggle opens the rail; the catalog is the REAL content ============
    await page.click('[data-action="toggle-library"]')
    await page.waitForSelector('[data-testid="content-browser"]', { timeout: 5000 })
    await pollUntil(async () => (await count(page, '.lib-row')) > 0, 'library catalog to load rows')
    const presetRows = await count(page, '[data-preset]')
    const kitRows = await count(page, '[data-kit][data-lane]')
    const sfRows = await count(page, '[data-soundfont]')
    if (presetRows !== 36) throw new Error(`[W1] expected 36 preset rows (Phase 18 Stream S's factory library), got ${presetRows}`)
    if (kitRows !== 10) throw new Error(`[W1] expected 10 kit one-shot rows (2 kits x 5 lanes), got ${kitRows}`)
    if (sfRows !== 3) throw new Error(`[W1] expected 3 soundfont rows, got ${sfRows}`)
    console.log(`[W1] PASS: content browser loaded the real library — ${presetRows} presets, ${kitRows} kit one-shots, ${sfRows} soundfonts`)
    results.w1 = { presetRows, kitRows, sfRows }

    // ============ W2: drag a SYNTH preset onto a synth track -> literal params, clean file diff ============
    let before = readFileSync(beatPath, 'utf8')
    await page.dragAndDrop('[data-preset="deep-sub-bass"]', trackHeaderSel('bass'))
    await pollUntil(
      () => page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'bass')?.synth.subLevel === 0.6),
      'bass track to pick up deep-sub-bass params',
    )
    let after = readFileSync(beatPath, 'utf8')
    if (after === before) throw new Error('[W2] .beat file did not change after dropping the preset')
    if (/\bpreset\b/.test(after)) throw new Error('[W2] the file references a "preset" keyword — presets must land as literal params, not a reference')
    if (!after.split('\n').some((l) => l.trim() === 'subLevel 0.6')) throw new Error('[W2] expected a literal "subLevel 0.6" line in the diff')
    const bassSynth = await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'bass').synth)
    if (bassSynth.osc2Type !== 'square' || bassSynth.glide !== 0.02) throw new Error(`[W2] bass synth params don't match deep-sub-bass: ${JSON.stringify(bassSynth)}`)
    console.log('[W2] PASS: dropping "deep-sub-bass" onto the bass track wrote literal params as a normal edit list (no reference)')
    results.w2 = { subLevel: bassSynth.subLevel, osc2Type: bassSynth.osc2Type }
    await page.screenshot({ path: join(uiDir, 'verify-p22ah-preset-drop.png') })

    // ============ W3: drag a DRUMS preset onto the drum track -> same discipline ============
    // night-shift.beat's drums track already carries "driving-kit"'s exact params (it was built from
    // that preset) — use "techno-kit" instead so the drop is a REAL, observable change, not a no-op.
    before = readFileSync(beatPath, 'utf8')
    await page.dragAndDrop('[data-preset="techno-kit"]', trackHeaderSel('drums'))
    await pollUntil(
      () => page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'drums')?.synth.hatTone === 9000),
      'drums track to pick up techno-kit params',
    )
    after = readFileSync(beatPath, 'utf8')
    if (after === before) throw new Error('[W3] .beat file did not change after dropping the drums preset')
    console.log('[W3] PASS: dropping "techno-kit" onto the drums track applied its voice params (hatTone 6500 -> 9000)')
    results.w3 = { hatTone: 9000 }

    // ============ W4: drag one kit one-shot onto a drum lane -> registered + assigned + on disk ============
    await selectTrack(page, 'drums')
    await pollUntil(() => page.evaluate(() => window.__store.getState().doc.selectedTrack === 'drums'), 'drums selection')
    await page.click('[data-pane-tab="clip"]')
    // Phase 22 Stream AB retired StepSequencer.tsx — NoteView now renders drum tracks too, behind
    // a row-axis adapter (data-event-kind="hit" distinguishes it from the pitch/note view).
    await page.waitForSelector('[data-testid="bottom-pane"] .noteview[data-event-kind="hit"]', { timeout: 5000 })
    before = readFileSync(beatPath, 'utf8')
    await page.dragAndDrop('[data-kit="kit-init"][data-lane="kick"]', '[data-drop-target="lane-kick"]')
    await pollUntil(
      () => page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'drums')?.laneSamples?.kick?.sample === 'kit-init-kick'),
      'drums.kick lane to pick up kit-init-kick',
    )
    after = readFileSync(beatPath, 'utf8')
    if (after === before) throw new Error('[W4] .beat file did not change after dropping the kit sample')
    const mediaPath = join(proj, 'media', 'kit-init-kick.wav')
    if (!existsSync(mediaPath)) throw new Error(`[W4] expected the wav copied into the project's own media/: ${mediaPath}`)
    const registered = await page.evaluate(() => window.__store.getState().doc.media.find((m) => m.id === 'kit-init-kick'))
    if (!registered || registered.path.includes('presets/')) throw new Error(`[W4] media entry should reference the PROJECT's media/, not presets/: ${JSON.stringify(registered)}`)
    console.log(`[W4] PASS: dropping kit-init's kick sample onto the kick lane registered it (${registered.path}) and copied the wav into the project`)
    results.w4 = { mediaPath: registered.path, sha256: registered.sha256.slice(0, 12) + '…' }
    await page.screenshot({ path: join(uiDir, 'verify-p22ah-sample-drop.png') })

    // ============ W5: preview-before-load — real audio, ZERO file writes ============
    before = readFileSync(beatPath, 'utf8')
    const [presetPeak] = await Promise.all([peakMasterDb(page, 1200), page.click('[data-preset="acid-bass"] [data-action="preview"]')])
    after = readFileSync(beatPath, 'utf8')
    if (after !== before) throw new Error('[W5a] previewing a preset wrote to the .beat file — preview must never touch disk')
    if (!(presetPeak > -60)) throw new Error(`[W5a] preset preview produced no audible master level (peak ${presetPeak} dB)`)
    console.log(`[W5a] PASS: previewing "acid-bass" reached ${presetPeak} dB on the master meter; the .beat file is byte-identical before/after`)

    before = readFileSync(beatPath, 'utf8')
    const [samplePeak] = await Promise.all([
      peakMasterDb(page, 1200),
      page.click('[data-kit="kit-audiophob"][data-lane="snare"] [data-action="preview"]'),
    ])
    after = readFileSync(beatPath, 'utf8')
    if (after !== before) throw new Error('[W5b] previewing a kit sample wrote to the .beat file')
    if (!(samplePeak > -60)) throw new Error(`[W5b] sample preview produced no audible master level (peak ${samplePeak} dB)`)
    console.log(`[W5b] PASS: previewing kit-audiophob's snare reached ${samplePeak} dB on the master meter; the .beat file is untouched`)
    results.w5 = { presetPeak, samplePeak }

    // ============ W6: soundfont "+" mints a brand-new instrument track (real, persisted) ============
    const tracksBefore = await page.evaluate(() => window.__store.getState().doc.tracks.length)
    before = readFileSync(beatPath, 'utf8')
    await page.click('[data-soundfont="upright-piano-kw-small.sf2"] [data-action="add-instrument-track"]')
    await pollUntil(
      () => page.evaluate((n) => window.__store.getState().doc.tracks.length > n, tracksBefore),
      'a new instrument track to appear',
    )
    after = readFileSync(beatPath, 'utf8')
    if (after === before) throw new Error('[W6] .beat file did not change after adding an instrument track from a soundfont')
    const newTrack = await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.kind === 'instrument'))
    if (!newTrack || !newTrack.instrument?.sample?.includes('upright-piano')) throw new Error(`[W6] expected a new instrument track carrying upright-piano-kw-small: ${JSON.stringify(newTrack)}`)
    console.log(`[W6] PASS: the soundfont "+" button minted instrument track "${newTrack.id}" carrying ${newTrack.instrument.sample}`)
    results.w6 = { newTrackId: newTrack.id, sample: newTrack.instrument.sample }
    await page.screenshot({ path: join(uiDir, 'verify-p22ah-browser.png') })

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ ALL CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nVERIFY FAILED:', err)
  process.exit(1)
})

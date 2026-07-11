#!/usr/bin/env node
// Phase 13 Stream C end-to-end verification — the arrangement/song view + mixer, driven live
// against a real daemon loaded with a real MULTI-SCENE .beat project, in headless Chrome. Mirrors
// ui/verify.mjs's boot pattern (daemon on a git-tracked canonical .beat + vite preview of ui/dist +
// system Chrome via playwright-core). Checks:
//
//   E. Arrangement view shows REAL per-section track data (not blank): the song's four section
//      labels render (intro/build/drop/intro), and canvas pixels prove the scene→clip slot maps —
//      `lead` is empty through intro+build and painted only inside `drop`; `pad` is painted from
//      bar 0 (it plays in every scene). Screenshot saved.
//   F. Drag-select a bar range on the ruler → the daemon actually received it, confirmed by running
//      `beat selection --port <p>` on the CLI side against the SAME running daemon (a real round
//      trip through POST /selection, the channel `beat vary --scope selection` reads).
//   G. Mixer: drag a track's level fader in the GUI → the .beat file diff is exactly the expected
//      one-line volume change for that track.
//
// Usage: node ui/verify-phase13.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { chromium } from 'playwright-core'

// The daemon runs in THIS process; a synchronous execFileSync would freeze its event loop so it
// can't answer the CLI child's HTTP read. Await the CLI async instead, keeping the daemon live.
const execFileAsync = promisify(execFile)

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8461
const PREVIEW_PORT = 5317

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
async function pollUntil(fn, what, timeoutMs = 8000, everyMs = 25) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  // Temp git project holding the MULTI-SCENE song in CURRENT canonical form (so a later fader
  // change is a clean one-line diff, not a v0.4→v0.9 format migration).
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p13-verify-'))
  const beatPath = join(proj, 'night-shift-song.beat')
  const canonical = serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift-song.beat'), 'utf8')))
  writeFileSync(beatPath, canonical)
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'canonical night-shift-song baseline')
  console.log(`\nproject: ${beatPath} (committed canonical multi-scene baseline)`)

  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  console.log(`daemon on :${daemon.port} — song sections: ${daemon.getDoc().song.map((s) => `${s.scene}(${s.bars})`).join(' ')}`)

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
    await page.setViewportSize({ width: 1280, height: 800 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    // ---- E: arrangement view, real per-section data ----
    await page.click('.view-tab[data-view="arrangement"]')
    await page.waitForSelector('.arr-canvas', { timeout: 5000 })
    await sleep(300) // let ResizeObserver settle the canvas widths + first paint

    const sectionLabels = await page.$$eval('.arr-section-name', (els) => els.map((e) => e.textContent))
    console.log(`\n[E] section labels: ${JSON.stringify(sectionLabels)}`)
    results.sections = sectionLabels
    if (JSON.stringify(sectionLabels) !== JSON.stringify(['intro', 'build', 'drop', 'intro'])) {
      throw new Error(`[E] expected [intro,build,drop,intro], got ${JSON.stringify(sectionLabels)}`)
    }

    // Per-row painted-pixel analysis. Canvases render in track order (lead, drums, bass, pad).
    // Threshold alpha > 60 counts real note/density marks and ignores the faint backdrop, gridlines
    // and section dividers (all << 60). intro+build = bars 0..8 of 20 = the left 40% of the width;
    // drop = bars 8..16 = 40%..80%.
    const paint = await page.evaluate(() => {
      const trackIds = window.__store.getState().doc.tracks.map((t) => t.id)
      const canvases = [...document.querySelectorAll('.arr-canvas')]
      return canvases.map((c, i) => {
        const ctx = c.getContext('2d')
        const { width, height } = c
        const img = ctx.getImageData(0, 0, width, height).data
        let left = 0
        let drop = 0
        let right = 0
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const a = img[(y * width + x) * 4 + 3]
            if (a <= 60) continue
            const f = x / width
            if (f < 0.4) left++
            else if (f < 0.8) drop++
            else right++
          }
        }
        return { track: trackIds[i], left, drop, right }
      })
    })
    console.log('[E] painted pixels per row (left=intro+build, drop, right=outro):')
    for (const p of paint) console.log(`      ${p.track.padEnd(6)} left=${p.left} drop=${p.drop} right=${p.right}`)
    results.paint = paint
    const lead = paint.find((p) => p.track === 'lead')
    const pad = paint.find((p) => p.track === 'pad')
    // lead plays ONLY in drop: empty through intro+build, painted inside drop.
    if (!(lead.left === 0 && lead.drop > 0)) throw new Error(`[E] lead should be empty in intro+build and painted in drop, got ${JSON.stringify(lead)}`)
    // pad plays in every scene: painted in the left region too.
    if (!(pad.left > 0)) throw new Error(`[E] pad should be painted from the first section, got ${JSON.stringify(pad)}`)
    await page.screenshot({ path: join(uiDir, 'verify-p13-arrangement.png') })
    console.log('[E] PASS: real per-section slot maps on screen -> ui/verify-p13-arrangement.png')

    // ---- F: drag a bar range on the ruler -> daemon receives it (confirmed via the CLI) ----
    const ruler = await page.$('.arr-ruler')
    const rb = await ruler.boundingBox()
    const pxPerBar = rb.width / 20 // fixture is a 20-bar song
    const y = rb.y + rb.height / 2
    // Drag from inside bar 0 to inside bar 3 -> selection bars {start:0, end:4}.
    await page.mouse.move(rb.x + pxPerBar * 0 + 6, y)
    await page.mouse.down()
    await page.mouse.move(rb.x + pxPerBar * 3 + 6, y, { steps: 8 })
    await page.mouse.up()
    await pollUntil(() => Object.keys(daemon.getSelection()).length > 0, 'daemon to receive the drag selection', 6000)
    const cliOut = (await execFileAsync('node', [join(repoRoot, 'cli/beat.mjs'), 'selection', '--port', String(daemon.port)], { encoding: 'utf8' })).stdout
    console.log('\n[F] `beat selection --port ' + daemon.port + '`:\n' + cliOut.split('\n').map((l) => '      ' + l).join('\n'))
    results.selectionCli = cliOut.trim()
    const sel = daemon.getSelection()
    if (!sel.bars || !(sel.bars.start < sel.bars.end)) throw new Error(`[F] daemon did not receive a valid bars selection: ${JSON.stringify(sel)}`)
    if (!/bars\s+0\s+4/.test(cliOut)) throw new Error(`[F] CLI did not report bars 0 4:\n${cliOut}`)
    console.log('[F] PASS: GUI ruler drag round-tripped through POST /selection to the CLI')

    // Also confirm a track-header click narrows to that track (the tracks axis).
    await page.click('.arr-track-header:has(.arr-track-name:text-is("bass"))')
    await pollUntil(() => (daemon.getSelection().tracks || []).includes('bass'), 'daemon to receive the track-header selection', 4000)
    console.log('[F] header click -> selection tracks: ' + JSON.stringify(daemon.getSelection().tracks))

    // The header click also wrote selected_track to the file; commit so [G]'s diff isolates volume.
    await sleep(200)
    git(proj, 'commit', '-q', '-am', 'select bass via arrangement header')

    // ---- G: mixer fader drag -> one-line volume diff ----
    await page.click('.view-tab[data-view="mixer"]')
    await page.waitForSelector('.mixer-strip', { timeout: 5000 })
    // lead is the first strip; drag its fader DOWN to lower the level.
    const strips = await page.$$('.mixer-strip')
    const fader = await strips[0].$('.mixer-fader')
    const fb = await fader.boundingBox()
    await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height * 0.3)
    await page.mouse.down()
    await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height * 0.7, { steps: 10 })
    await page.mouse.up()
    await pollUntil(() => daemon.getDoc().tracks.find((t) => t.id === 'lead').synth.volume !== -1, 'daemon to record the new lead volume', 6000)
    await sleep(200)
    const newVol = daemon.getDoc().tracks.find((t) => t.id === 'lead').synth.volume
    const diff = git(proj, 'diff', '--unified=0', 'night-shift-song.beat')
    const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    const removed = diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'))
    console.log(`\n[G] lead volume now ${newVol} dB (was -1). git diff (unified=0):\n` + diff)
    results.mixerDiff = { added, removed, newVol }
    if (added.length !== 1 || removed.length !== 1) throw new Error(`[G] expected exactly 1 changed line, got +${added.length} -${removed.length}`)
    if (!/^\+\s*volume\s/.test(added[0])) throw new Error(`[G] the changed line is not the volume field: ${JSON.stringify(added[0])}`)
    console.log('[G] PASS: mixer fader drag produced exactly the expected one-line volume diff')

    // Mute/solo are GUI-only state — confirm the toggle reaches the store (audio gating deferred).
    await strips[1].$('.mixer-btn.mute').then((b) => b.click())
    const muted = await page.evaluate(() => window.__store.getState().mutes)
    console.log('[G] mute toggle -> store.mutes: ' + JSON.stringify(muted))
    results.mutes = muted
    await page.screenshot({ path: join(uiDir, 'verify-p13-mixer.png') })
    console.log('[G] screenshot -> ui/verify-p13-mixer.png')

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

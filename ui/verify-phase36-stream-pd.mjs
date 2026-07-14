#!/usr/bin/env node
// Phase 36 Stream PD verification — multi-region audio placement in the daemon + GUI (v0.11,
// decisions.md D16, docs/multi-region-audio-design.md Option A, docs/phase-36-plan.md §PD).
//
// Fixture: a real two-placement project built through dist/src/core's own edit primitives (the
// same calls `beat scene`/`beat place` wrap) — audio track "fx" with two 1-second clips ("hit",
// "riser"; 1s = 8 sixteenth-steps at 120bpm) placed at step 0 and step 32 of one 4-bar (64-step)
// section, plus an ordinary synth track "lead" as the single-placement control. Drives the REAL
// frontend headlessly against a REAL `beat daemon`.
//
// What this checks:
//   P1  The audio row renders TWO clip blocks — one per placement, not one per section — at
//       DISTINCT x positions: the riser block sits exactly 32 steps (2 bars) right of the hit
//       block, and each block's width is the region's own timeline length (8 steps = half a bar),
//       both measured against the ruler's live px/bar. The synth row still renders exactly ONE
//       full-section block (non-audio slots are single-placement by v0.11 validation).
//   P2  Clip-editor targeting: clicking the riser's block opens THAT placement's clip in the
//       bottom pane (store.selectedPlacement = fx/riser@32; ClipPropertiesPanel names "riser"),
//       and clicking the hit's block retargets to "hit" — selecting a block targets the right
//       placement, not blindly the at-0/first one.
//   P3  Placement-granular Delete: right-click the riser block -> Delete removes ONLY the at-32
//       placement (daemon doc: fx slot becomes exactly [hit@0]; the riser block unmounts, the hit
//       block survives) — the pre-PD behavior would have cleared the whole slot.
//
// A full-page screenshot of the two-placement arrangement is saved to
// ui/verify-p36-pd-placements.png before the delete.
//
// Usage: CHROME_PATH=/opt/pw-browsers/chromium node ui/verify-phase36-stream-pd.mjs

import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 6238 // distinct from other verify scripts' ports so concurrent runs never collide

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

/** A real 16-bit PCM mono wav (44100 Hz, `seconds` of a 440 Hz sine) — the engine and the
 * bottom-pane waveform loader both decode the media file for real, so it must be a valid wav. */
function makeWav(seconds) {
  const sampleRate = 44100
  const frames = Math.round(sampleRate * seconds)
  const dataBytes = frames * 2
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < frames; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000), 44 + i * 2)
  }
  return buf
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const core = await import(join(repoRoot, 'dist/src/core/index.js'))
  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))

  // ---- fixture: two placements of two different clips on one audio track, one 4-bar section ----
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p36pd-'))
  mkdirSync(join(proj, 'media'))
  const wav = makeWav(1.0) // 1s = 8 sixteenth-steps at 120bpm
  writeFileSync(join(proj, 'media', 'smp.wav'), wav)
  const sha = createHash('sha256').update(wav).digest('hex')

  let doc = core.initDocument({ trackId: 'lead', bpm: 120, loopBars: 4 })
  doc = core.addTrack(doc, { id: 'fx', kind: 'audio' }).doc
  doc = core.setMediaSample(doc, 'smp', sha, 'media/smp.wav')
  doc = core.addAudioClip(doc, 'fx', 'hit', { media: 'smp', in: 0, out: 1 }).doc
  doc = core.addAudioClip(doc, 'fx', 'riser', { media: 'smp', in: 0, out: 1 }).doc
  doc = core.addNote(doc, 'lead', { pitch: 60, start: 0, duration: 4, velocity: 0.9 }).doc
  doc = core.saveClip(doc, 'lead', 'leadClip').doc
  doc = core.setScene(doc, 'a', {
    lead: 'leadClip',
    fx: [
      { clip: 'hit', at: 0 },
      { clip: 'riser', at: 32 },
    ],
  })
  doc = core.setSong(doc, [{ scene: 'a', bars: 4 }])
  const beatPath = join(proj, 'placements.beat')
  writeFileSync(beatPath, core.serialize(doc))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline two-placement project')

  const daemon = await startDaemon({ filePath: beatPath, port: 0 })
  console.log(`daemon up on :${daemon.port}, project ${beatPath}`)
  const fxSlot = () => {
    const d = daemon.getDoc()
    return d.scenes.find((s) => s.id === d.song[0].scene).slots.fx
  }

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
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
    await page.setViewportSize({ width: 1600, height: 1000 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('dialog', (d) => {
      errors.push(`unexpected native dialog: "${d.message()}"`)
      d.dismiss().catch(() => {})
    })

    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    // ==============================================================================================
    // P1 — one block PER PLACEMENT, x-offset and width proportional to `at` / the region's length
    // ==============================================================================================
    console.log('\n[P1] the audio row draws one block per placement at proportional x/width')
    const hitBlock = page.locator('[data-clip-block="fx::0"]')
    const riserBlock = page.locator('[data-clip-block="fx::0::32"]')
    await hitBlock.waitFor({ state: 'visible', timeout: 5000 })
    await riserBlock.waitFor({ state: 'visible', timeout: 5000 })
    assert((await page.locator('[data-clip-block^="fx::"]').count()) === 2, '[P1] the fx row must render exactly 2 clip blocks (one per placement)')
    assert((await riserBlock.getAttribute('data-clip-id')) === 'riser', '[P1] the at-32 block must be the riser placement')
    assert((await riserBlock.getAttribute('data-placement-at')) === '32', '[P1] the riser block must carry data-placement-at=32')

    const pxPerBar = Number(await page.locator('.arr-ruler').getAttribute('data-pxperbar'))
    assert(Number.isFinite(pxPerBar) && pxPerBar > 0, `[P1] readable px/bar from the ruler, got ${pxPerBar}`)
    const hitBox = await hitBlock.boundingBox()
    const riserBox = await riserBlock.boundingBox()
    assert(hitBox && riserBox, '[P1] both blocks must have bounding boxes')
    const expectedDx = (32 / 16) * pxPerBar // 32 steps = 2 bars
    const dx = riserBox.x - hitBox.x
    console.log(`  px/bar ${pxPerBar.toFixed(2)} · hit.x ${hitBox.x.toFixed(1)} w ${hitBox.width.toFixed(1)} · riser.x ${riserBox.x.toFixed(1)} w ${riserBox.width.toFixed(1)} · dx ${dx.toFixed(1)} (expect ${expectedDx.toFixed(1)})`)
    assert(Math.abs(dx - expectedDx) < 3, `[P1] the riser block must sit ${expectedDx.toFixed(1)}px (2 bars) right of the hit block, measured ${dx.toFixed(1)}px`)
    const expectedW = (8 / 16) * pxPerBar // the region's timeline length: 1s @120bpm = 8 steps = half a bar
    for (const [name, box] of [
      ['hit', hitBox],
      ['riser', riserBox],
    ]) {
      assert(Math.abs(box.width - expectedW) < 3, `[P1] the ${name} block's width must be the region's own ${expectedW.toFixed(1)}px (8 steps), measured ${box.width.toFixed(1)}px`)
    }
    // The synth control row: still exactly one full-section block.
    assert((await page.locator('[data-clip-block^="lead::"]').count()) === 1, '[P1] the synth row must still render exactly ONE block')
    const leadBox = await page.locator('[data-clip-block="lead::0"]').boundingBox()
    assert(Math.abs(leadBox.width - 4 * pxPerBar) < 3, `[P1] the synth block still spans its whole 4-bar section (${(4 * pxPerBar).toFixed(1)}px), measured ${leadBox.width.toFixed(1)}px`)
    await page.screenshot({ path: join(uiDir, 'verify-p36-pd-placements.png'), fullPage: true })
    console.log('  [P1] PASS: two placement blocks at proportional x/width (screenshot: verify-p36-pd-placements.png)')
    results.p1 = { pxPerBar, dx, expectedDx, hitWidth: hitBox.width, riserWidth: riserBox.width, expectedW }

    // ==============================================================================================
    // P2 — clicking a block targets THAT placement's clip in the bottom-pane editor
    // ==============================================================================================
    console.log('\n[P2] clicking a placement block opens THAT placement\'s clip')
    await riserBlock.click()
    await pollUntil(async () => {
      const sp = await page.evaluate(() => window.__store.getState().selectedPlacement)
      return sp && sp.track === 'fx' && sp.clip === 'riser' && sp.at === 32
    }, '[P2] store.selectedPlacement to point at fx/riser@32', 4000)
    await page.locator('[data-clip-props="riser"]').waitFor({ state: 'visible', timeout: 4000 })
    assert((await page.evaluate(() => window.__store.getState().selectedTrackId)) === 'fx', '[P2] clicking the block also selects the fx track')
    console.log('  clicked riser@32 -> clip properties strip shows clip "riser"')
    await hitBlock.click()
    await pollUntil(async () => {
      const sp = await page.evaluate(() => window.__store.getState().selectedPlacement)
      return sp && sp.track === 'fx' && sp.clip === 'hit' && sp.at === 0
    }, '[P2] store.selectedPlacement to retarget to fx/hit@0', 4000)
    await page.locator('[data-clip-props="hit"]').waitFor({ state: 'visible', timeout: 4000 })
    console.log('  [P2] PASS: block clicks target the clicked placement\'s clip, not blindly the first')

    // ==============================================================================================
    // P3 — placement-granular Delete: only the right-clicked placement dies
    // ==============================================================================================
    console.log('\n[P3] Delete on the riser block removes ONLY the at-32 placement')
    assert(JSON.stringify(fxSlot()) === JSON.stringify([{ clip: 'hit', at: 0 }, { clip: 'riser', at: 32 }]), '[P3] fixture sanity: both placements present before delete')
    const box = await riserBlock.boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
    const menu = page.locator('[data-ctx-menu="fx.clip.0"]')
    await menu.waitFor({ state: 'visible', timeout: 4000 })
    await menu.locator('[data-ctx-item="delete"]').click()
    await pollUntil(() => JSON.stringify(fxSlot()) === JSON.stringify([{ clip: 'hit', at: 0 }]), '[P3] the daemon doc to keep hit@0 and drop ONLY riser@32', 4000)
    await pollUntil(async () => (await riserBlock.count()) === 0, '[P3] the riser block to unmount', 4000)
    assert((await hitBlock.count()) === 1, '[P3] the hit block must survive its sibling\'s delete')
    console.log('  [P3] PASS: fx slot is now exactly [hit@0]; the sibling placement survived')
    results.p3 = { fxSlotAfterDelete: fxSlot() }

    if (errors.length) throw new Error(`[FAIL] uncaught page errors / unexpected dialogs during the run:\n${errors.join('\n')}`)

    console.log('\nALL PASS — Phase 36 Stream PD: per-placement arrangement blocks, placement-targeted clip editing, and placement-granular delete verified end-to-end.')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill()
    await daemon.close()
  }
}

main()
  .then(() => process.exit(0)) // chromium pipes keep the loop alive after browser.close() — same exit pattern as verify-phase35-stream-of.mjs
  .catch((err) => {
    console.error(err.stack ?? String(err))
    process.exit(1)
  })

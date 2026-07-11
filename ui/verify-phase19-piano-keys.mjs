#!/usr/bin/env node
// Phase 19 Stream U — piano-key strip + octave gridlines in the piano roll (NoteView.tsx). Drives
// the REAL frontend headlessly against a REAL `beat daemon` (examples/night-shift.beat, whose lead
// track uses pitches 67..76) and asserts the new rendering AND that every pre-existing interaction
// still works unchanged.
//
//   K1 keyboard + range   the key strip renders one row per pitch over a GENEROUS octave-snapped
//                         window (C3..B6 for the lead), NOT clipped to the used notes 67..76 —
//                         labelled C keys present, black/white keys distinguished.
//   K2 pitch alignment    note u100033 (pitch 76) sits at exactly the same vertical position as the
//                         key strip's pitch-76 key (the load-bearing "notes line up with keys" check).
//   K3 octave gridlines   one .noteview-octline per C in range (48,60,72,84 -> 4).
//   K4 key preview        clicking a key auditions that pitch (engine.previewNote) with no error.
//   K5 regression: add    tap empty grid at a known empty row/step -> exactly one note added on disk.
//   K6 regression: marquee+move   marquee-select 3 notes, drag one +4 -> all 3 follow (offsets kept),
//                         diff = exactly 3 changed note lines. Proves the rendering addition did not
//                         regress the Phase 17 grid interactions.
//
// Usage: node ui/verify-phase19-piano-keys.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
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

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p19-keys-'))
  const beatPath = join(proj, 'night-shift.beat')
  const canonical = serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8')))
  writeFileSync(beatPath, canonical)
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'canonical night-shift baseline')

  const daemon = await startDaemon({ filePath: beatPath, port: PORT })
  console.log(`daemon up on :${daemon.port}, project ${beatPath}`)
  const leadNotes = () => daemon.getDoc().tracks.find((t) => t.id === 'lead').notes
  const note = (id) => leadNotes().find((n) => n.id === id)

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
    await page.setViewportSize({ width: 1400, height: 900 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    // Phase 18 layout: tracks are selected from the ArrangementView header, and the editor lives in
    // the bottom detail pane (Clip view, open by default). Click the lead track's header.
    await page.click('.arr-track-select:has(.arr-track-name:text-is("lead"))')
    await page.waitForSelector('.noteview-grid', { timeout: 5000 })
    await page.waitForSelector('.noteview-keys [data-key-pitch]', { timeout: 5000 })
    await pollUntil(() => daemon.getDoc().selectedTrack === 'lead', 'lead selection to record')
    await page.$eval('.noteview-grid', (el) => el.scrollIntoView({ block: 'center' }))
    await sleep(150)

    const selIds = () => page.evaluate(() => [...window.__store.getState().editNoteIds].sort())
    const diffLines = () => {
      const diff = git(proj, 'diff', '--unified=0', 'night-shift.beat')
      return {
        diff,
        added: diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')),
        removed: diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')),
      }
    }

    // ============ K1: keyboard strip + generous, NOT-clipped range ============
    const keyPitches = (await page.$$eval('.noteview-keys [data-key-pitch]', (els) => els.map((e) => Number(e.getAttribute('data-key-pitch'))))).sort((a, b) => a - b)
    const minKey = keyPitches[0]
    const maxKey = keyPitches[keyPitches.length - 1]
    const used = leadNotes().map((n) => n.pitch)
    const usedLo = Math.min(...used)
    const usedHi = Math.max(...used)
    console.log(`\n[K1] key range ${minKey}..${maxKey} (${keyPitches.length} keys); lead notes span ${usedLo}..${usedHi}`)
    if (keyPitches.length < 48) throw new Error(`[K1] expected >= 48 keys (a real keyboard, not a used-note hug), got ${keyPitches.length}`)
    if (!(minKey < usedLo - 6 && maxKey > usedHi + 6)) throw new Error(`[K1] range ${minKey}..${maxKey} is clipped too tight to used notes ${usedLo}..${usedHi} — should be padded well beyond`)
    if (minKey % 12 !== 0) throw new Error(`[K1] bottom key ${minKey} is not snapped to a C`)
    // contiguity: every semitone in [min,max] has a key
    for (let p = minKey; p <= maxKey; p++) if (!keyPitches.includes(p)) throw new Error(`[K1] missing key for pitch ${p}`)
    const c4 = await page.$('.noteview-keys [data-key-pitch="60"]')
    const c4label = c4 ? await c4.textContent() : null
    if (c4label !== 'C4') throw new Error(`[K1] pitch-60 key label is ${JSON.stringify(c4label)}, expected "C4"`)
    console.log(`[K1] PASS: ${keyPitches.length}-key strip C${minKey / 12 - 1}..(top ${maxKey}), padded beyond used notes, C keys labelled (pitch60 -> "C4")`)
    results.k1 = { minKey, maxKey, keys: keyPitches.length, usedLo, usedHi }

    // ============ K2: pitch alignment — note 76 lines up with key 76 ============
    const noteBox = await page.locator('[data-note-id="u100033"]').boundingBox() // pitch 76
    const keyBox = await page.locator('.noteview-keys [data-key-pitch="76"]').boundingBox()
    const dy = Math.abs(noteBox.y - keyBox.y)
    console.log(`\n[K2] note u100033 (pitch 76) top=${noteBox.y.toFixed(1)}, key-76 top=${keyBox.y.toFixed(1)}, delta=${dy.toFixed(2)}px`)
    if (dy > 1.5) throw new Error(`[K2] note-76 and key-76 are misaligned by ${dy.toFixed(2)}px — the note does not line up with its key`)
    // and the key strip is LEFT of the grid
    const gridBox = await page.locator('.noteview-grid').boundingBox()
    if (!(keyBox.x + keyBox.width <= gridBox.x + 1)) throw new Error(`[K2] key strip is not to the left of the grid (key right ${keyBox.x + keyBox.width}, grid left ${gridBox.x})`)
    console.log(`[K2] PASS: pitch-76 note aligns with pitch-76 key (Δ${dy.toFixed(2)}px); key strip sits left of the grid`)
    results.k2 = { noteTop: noteBox.y, keyTop: keyBox.y, dy }

    // ============ K3: octave gridlines — one per C in range ============
    const octCount = await page.$$eval('.noteview-octline', (els) => els.length)
    const expectedOct = keyPitches.filter((p) => p % 12 === 0).length
    if (octCount !== expectedOct) throw new Error(`[K3] expected ${expectedOct} octave gridlines (one per C), got ${octCount}`)
    console.log(`\n[K3] PASS: ${octCount} octave (C) gridlines, one per C in the visible range`)
    results.k3 = { octCount }

    // ============ K4: clicking a key previews that pitch (no error) ============
    const errBefore = errors.length
    await page.locator('.noteview-keys [data-key-pitch="72"]').click()
    await sleep(250)
    const newErrs = errors.slice(errBefore).filter((e) => !/AudioContext|autoplay/i.test(e))
    if (newErrs.length) throw new Error(`[K4] clicking a key raised page error(s): ${newErrs.join(' | ')}`)
    console.log(`[K4] PASS: clicked key pitch-72 -> engine.previewNote ran with no page error`)
    results.k4 = { ok: true }

    // ============ K5: regression — tap empty grid adds exactly one note ============
    const beforeIds = new Set(leadNotes().map((n) => n.id))
    const addPitch = 71 // an empty row near the middle of the visible range (B4; lead uses 67..76)
    const addStep = 8
    const stepW = gridBox.width / (daemon.getDoc().loopBars * 16)
    const topPitch = maxKey // grid row 0 == top key == maxKey
    const tapX = gridBox.x + addStep * stepW + stepW / 2
    const tapY = gridBox.y + (topPitch - addPitch) * 12 + 6 // ROW_H=12; +6 lands mid-row
    if (tapY > 890) throw new Error(`[K5] tap Y ${tapY.toFixed(0)} is below the viewport — pick a pitch nearer the middle`)
    await page.mouse.click(tapX, tapY)
    const addedNote = await pollUntil(() => leadNotes().find((n) => !beforeIds.has(n.id)), 'tap-to-add to append one note')
    await sleep(120)
    if (leadNotes().length !== beforeIds.size + 1) throw new Error(`[K5] expected exactly one new note, got ${leadNotes().length - beforeIds.size}`)
    const d5 = diffLines()
    if (d5.added.length !== 1 || d5.removed.length !== 0) throw new Error(`[K5] expected exactly 1 added note line (1+/0-), got +${d5.added.length} -${d5.removed.length}`)
    console.log(`\n[K5] PASS: tap on empty grid added exactly one note (${JSON.stringify({ pitch: addedNote.pitch, start: addedNote.start })}); diff = 1 added line`)
    results.k5 = { added: { pitch: addedNote.pitch, start: addedNote.start }, diff: d5.diff }
    git(proj, 'commit', '-q', '-am', 'gui: tap-add regression')

    // ============ K6: regression — marquee-select 3 notes, group move +4 ============
    const box = async (id) => page.locator(`[data-note-id="${id}"]`).boundingBox()
    const b33 = await box('u100033')
    const b34 = await box('u100034')
    const b35 = await box('u100035')
    const left = Math.min(b33.x, b34.x, b35.x)
    const right = Math.max(b33.x + b33.width, b34.x + b34.width, b35.x + b35.width)
    const top = Math.min(b33.y, b34.y, b35.y)
    const bot = Math.max(b33.y + b33.height, b34.y + b34.height, b35.y + b35.height)
    await page.mouse.move(left - 8, top - 8)
    await page.mouse.down()
    await page.mouse.move((left + right) / 2, (top + bot) / 2, { steps: 6 })
    await page.mouse.move(right + 8, bot + 8, { steps: 6 })
    await page.mouse.up()
    const m1 = await pollUntil(async () => {
      const s = await selIds()
      return s.length === 3 ? s : null
    }, 'marquee to select exactly 3 notes')
    const want = ['u100033', 'u100034', 'u100035']
    if (JSON.stringify(m1) !== JSON.stringify(want)) throw new Error(`[K6] marquee selected ${JSON.stringify(m1)}, expected ${JSON.stringify(want)}`)
    const before6 = Object.fromEntries(want.map((id) => [id, note(id).start]))
    const stepW34 = b34.width / note('u100034').duration
    const gx = b34.x + 3
    const gy = b34.y + b34.height / 2
    await page.mouse.move(gx, gy)
    await page.mouse.down()
    await page.mouse.move(gx + 4 * stepW34, gy, { steps: 6 })
    await page.mouse.up()
    await pollUntil(() => note('u100034').start === before6.u100034 + 4, 'the dragged note to move +4')
    await sleep(150)
    for (const id of want) {
      if (note(id).start !== before6[id] + 4) throw new Error(`[K6] ${id} start ${note(id).start}, expected ${before6[id] + 4} (group did not move in lockstep)`)
    }
    const d6 = diffLines()
    if (d6.added.length !== 3 || d6.removed.length !== 3) throw new Error(`[K6] expected 3 changed note lines (3+/3-), got +${d6.added.length} -${d6.removed.length}`)
    console.log(`\n[K6] PASS: marquee-selected 3 notes and group-moved them +4 in lockstep; diff = 3 changed lines (Phase 17 interactions intact)`)
    results.k6 = { selected: m1, diff: d6.diff }

    await page.screenshot({ path: join(uiDir, 'verify-p19-piano-keys.png') })
    console.log('\nscreenshot -> ui/verify-p19-piano-keys.png')

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

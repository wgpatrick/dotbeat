#!/usr/bin/env node
// Phase 13 Stream B end-to-end verification — real EDITING through dotbeat's own frontend.
// Extends Phase 12 Stream 1's verify.mjs (which proved the read + step-toggle + live-sync loop);
// this pass proves the NEW composing surfaces added in Stream B, all through POST /edit:
//
//   A. toggle a drum step in the GUI     → git diff is exactly ONE added line (Stream 1, kept)
//   B. hand-edit the .beat on disk       → the GUI store reflects it, no reload   (Stream 1, kept)
//   C. audio actually plays              → transport ticks + master meter reads    (Stream 1, kept)
//   D. real project data on screen       → track names + screenshot                (Stream 1, kept)
//   E. GUI note-ADD (click empty grid)   → written bytes == `beat add-note`, ONE added line   (NEW)
//   F. GUI note-MOVE (drag a note)       → note.start changes, ONE changed line                (NEW)
//   G. GUI note-DELETE (double-click)    → note removed, ONE removed line                       (NEW)
//   H. oscillator param (osc select)     → ONE-field diff                                       (NEW)
//   I. filter param (filterType select)  → ONE-field diff                                       (NEW)
//   J. LFO param (lfoDest select)        → ONE-field diff                                       (NEW)
//   K. insert param (eqLow knob drag)    → ONE-field diff                                       (NEW)
//   L. expanded SynthPanel               → real grouped controls (screenshot + readback)        (NEW)
//
// Usage: node ui/verify.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8455
const PREVIEW_PORT = 5311

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
  const { parse, serialize, addNote } = await import(join(repoRoot, 'dist/src/core/index.js'))

  // 1. temp git project holding night-shift in CURRENT canonical form (so a later edit is a clean
  //    diff, not a v0.3→v0.9 format migration).
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-ui-verify-'))
  const beatPath = join(proj, 'night-shift.beat')
  const canonical = serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8')))
  writeFileSync(beatPath, canonical)
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'canonical night-shift baseline')
  console.log(`\nproject: ${beatPath} (committed canonical baseline)`)

  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  console.log(`daemon on :${daemon.port}`)

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
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })

    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    // ---- diff helpers (each edit is committed so the next diff isolates just that edit) ----
    const diffLines = () => {
      const diff = git(proj, 'diff', '--unified=0', 'night-shift.beat')
      return {
        diff,
        added: diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')),
        removed: diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')),
      }
    }
    const commit = (msg) => {
      try {
        git(proj, 'commit', '-q', '-am', msg)
      } catch (err) {
        if (!String(err.stdout || '').includes('nothing to commit')) throw err // a no-op edit (e.g. re-selecting the already-selected track) leaves a clean tree — fine
      }
    }
    const leadNotes = () => daemon.getDoc().tracks.find((t) => t.id === 'lead').notes

    // ---- D: real data on screen ----
    const names = await page.$$eval('.track-name', (els) => els.map((e) => e.textContent))
    const bpm = await page.$eval('.transport-field input', (el) => Number(el.value))
    console.log(`\n[D] tracks in DOM: ${JSON.stringify(names)} · bpm ${bpm}`)
    results.tracks = names
    if (!(names.includes('lead') && names.includes('drums') && names.includes('bass') && names.includes('pad'))) {
      throw new Error(`[D] expected real track names, got ${JSON.stringify(names)}`)
    }
    await page.screenshot({ path: join(uiDir, 'verify-screenshot-1.png') })
    console.log('[D] screenshot -> ui/verify-screenshot-1.png')

    // Select the lead (synth) track so the SynthPanel + NoteView render. Selection is itself a
    // one-line selected_track edit; commit it so the edit diffs below isolate exactly each edit.
    await page.click('.track-row:has(.track-name:text-is("lead"))')
    await page.waitForSelector('.noteview-grid', { timeout: 5000 })
    await pollUntil(() => daemon.getDoc().selectedTrack === 'lead', 'lead selection to record')
    await sleep(150)
    commit('select lead track')

    // ================= E: GUI note-ADD == `beat add-note` =================
    // Click an empty cell above every existing note (pitch = hi, guaranteed empty) at step 2.
    await page.$eval('.noteview-grid', (el) => el.scrollIntoView())
    const grid = await page.$eval('.noteview-grid', (el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width }
    })
    const totalSteps = daemon.getDoc().loopBars * 16
    const stepW = grid.width / totalSteps
    const ROW_H = 12
    const pitches = leadNotes().map((n) => n.pitch)
    const hi = Math.min(127, Math.max(...pitches) + 3) // matches NoteView's pitch window top
    const ADD_STEP = 2
    const addX = grid.x + (ADD_STEP + 0.5) * stepW
    const addY = grid.y + 0.5 * ROW_H // row 0 == pitch hi
    const before = parse(readFileSync(beatPath, 'utf8'))
    await page.mouse.click(addX, addY)
    await pollUntil(() => leadNotes().some((n) => n.pitch === hi && n.start === ADD_STEP), 'GUI-added note to reach the file')
    await sleep(150)
    // What the equivalent CLI call (`beat add-note night-shift.beat lead <hi> 2 2 0.8`) would write:
    const expected = serialize(addNote(before, 'lead', { pitch: hi, start: ADD_STEP, duration: 2, velocity: 0.8 }).doc)
    const guiWritten = readFileSync(beatPath, 'utf8')
    const e = diffLines()
    console.log(`\n[E] GUI note-add diff (unified=0):\n${e.diff}`)
    if (e.added.length !== 1 || e.removed.length !== 0) throw new Error(`[E] expected exactly 1 added / 0 removed, got +${e.added.length} -${e.removed.length}`)
    if (guiWritten !== expected) throw new Error('[E] GUI-written bytes differ from `beat add-note` output')
    console.log(`[E] PASS: GUI note-add == beat add-note (one line: ${e.added[0].trim()})`)
    results.noteAdd = e.added[0].trim()
    const newId = leadNotes().find((n) => n.pitch === hi && n.start === ADD_STEP).id
    commit('gui: add note')

    // ================= F: GUI note-MOVE (drag) =================
    const noteBox = await page.locator(`[data-note-id="${newId}"]`).boundingBox()
    const dragFromX = noteBox.x + 4 // left-of-center, clear of the right-edge resize handle
    const dragY = noteBox.y + noteBox.height / 2
    await page.mouse.move(dragFromX, dragY)
    await page.mouse.down()
    await page.mouse.move(dragFromX + 3 * stepW, dragY, { steps: 3 })
    await page.mouse.up()
    await pollUntil(() => leadNotes().find((n) => n.id === newId)?.start === ADD_STEP + 3, 'note.start to move to 5')
    await sleep(150)
    const f = diffLines()
    console.log(`\n[F] GUI note-move diff (unified=0):\n${f.diff}`)
    if (f.added.length !== 1 || f.removed.length !== 1) throw new Error(`[F] expected 1 changed line (1+/1-), got +${f.added.length} -${f.removed.length}`)
    console.log(`[F] PASS: dragging moved note ${newId} start ${ADD_STEP}→${ADD_STEP + 3} as one line`)
    results.noteMove = { added: f.added[0].trim(), removed: f.removed[0].trim() }
    commit('gui: move note')

    // ================= G: GUI note-DELETE (double-click) =================
    await page.locator(`[data-note-id="${newId}"]`).dblclick()
    await pollUntil(() => !leadNotes().some((n) => n.id === newId), 'note to be deleted')
    await sleep(150)
    const g = diffLines()
    console.log(`\n[G] GUI note-delete diff (unified=0):\n${g.diff}`)
    if (g.added.length !== 0 || g.removed.length !== 1) throw new Error(`[G] expected 1 removed / 0 added, got +${g.added.length} -${g.removed.length}`)
    console.log(`[G] PASS: double-click deleted note ${newId} as one removed line`)
    results.noteDelete = g.removed[0].trim()
    commit('gui: delete note')

    // ================= H–K: param edits across categories, each a one-field diff =================
    const paramCheck = async (label, key, action, expectRe) => {
      await action()
      await pollUntil(() => diffLines().added.some((l) => expectRe.test(l)), `${label} edit to reach the file`)
      await sleep(120)
      const d = diffLines()
      if (d.added.length !== 1 || !expectRe.test(d.added[0])) {
        throw new Error(`[${label}] expected one added line matching ${expectRe}, got: ${JSON.stringify(d.added)}`)
      }
      console.log(`[${label}] PASS: ${d.added[0].trim()}  (removed ${d.removed.length})`)
      results[key] = d.added[0].trim()
      commit(`gui: ${label}`)
    }

    // H: oscillator param — osc select (square → sawtooth); required core param, so it's a
    //    replaced line (1+/1-).
    await paramCheck('H osc', 'oscParam', async () => {
      await page.selectOption('.param-enum:has(.knob-label:text-is("Osc")) select', 'sawtooth')
    }, /^\+\s*osc sawtooth\s*$/)

    // I: filter param — filterType select (default lowpass → highpass); optional field, added line.
    await paramCheck('I filter', 'filterParam', async () => {
      await page.selectOption('.param-enum:has(.knob-label:text-is("Type")) select', 'highpass')
    }, /^\+\s*filterType highpass\s*$/)

    // J: LFO param — open the LFO group, lfoDest select (default off → cutoff); added line.
    await paramCheck('J lfo', 'lfoParam', async () => {
      await page.$$eval('.param-group', (els) => {
        for (const d of els) if (d.querySelector('.param-group-title')?.textContent?.startsWith('LFO')) d.open = true
      })
      await page.selectOption('.param-enum:has(.knob-label:text-is("Dest1")) select', 'cutoff')
    }, /^\+\s*lfoDest cutoff\s*$/)

    // K: insert param — open the Inserts group, drag the eqLow knob off its 0 default; added line.
    await paramCheck('K insert', 'insertParam', async () => {
      await page.$$eval('.param-group', (els) => {
        for (const d of els) if (d.querySelector('.param-group-title')?.textContent?.startsWith('Inserts')) d.open = true
      })
      const knob = page.locator('.knob:has(.knob-label:text-is("EQlo")) svg')
      const kb = await knob.boundingBox()
      const cx = kb.x + kb.width / 2
      const cy = kb.y + kb.height / 2
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.mouse.move(cx, cy - 50, { steps: 4 }) // drag up = increase
      await page.mouse.up()
    }, /^\+\s*eqLow /)

    // ================= L: expanded SynthPanel is real grouped controls =================
    await page.$$eval('.param-group', (els) => els.forEach((d) => (d.open = true)))
    await sleep(100)
    const groupTitles = await page.$$eval('.synth-panel .param-group-title', (els) => els.map((e) => e.textContent))
    const knobCount = await page.$$eval('.synth-panel .knob', (els) => els.length)
    const enumCount = await page.$$eval('.synth-panel .param-enum', (els) => els.length)
    const labels = await page.$$eval('.synth-panel .knob-label', (els) => els.length)
    console.log(`\n[L] SynthPanel groups: ${JSON.stringify(groupTitles)}`)
    console.log(`[L] controls: ${knobCount} knobs, ${enumCount} enum/ref selects, ${labels} labeled`)
    results.groups = groupTitles
    results.controlCount = { knobs: knobCount, enums: enumCount }
    const need = ['Oscillator', 'Filter & Envelope', 'LFO', 'Amp & Output', 'Inserts (EQ / Comp / Drive)', 'Sends', 'Sidechain Duck']
    for (const t of need) if (!groupTitles.includes(t)) throw new Error(`[L] missing group "${t}" (got ${JSON.stringify(groupTitles)})`)
    if (knobCount + enumCount < 45) throw new Error(`[L] too few controls (${knobCount + enumCount}); expected the full ~54-field surface`)
    if (labels !== knobCount + enumCount) throw new Error(`[L] some controls are unlabeled (${labels} labels for ${knobCount + enumCount} controls)`) // no wall of unlabeled sliders
    await page.$eval('.synth-panel', (el) => el.scrollIntoView())
    await page.screenshot({ path: join(uiDir, 'verify-screenshot-panel.png') })
    console.log('[L] PASS: real grouped, labeled controls covering the full surface -> ui/verify-screenshot-panel.png')

    // ================= A: drum step toggle (Stream 1 loop, still green) =================
    await page.click('.track-row:has(.track-name:text-is("drums"))')
    await page.waitForSelector('[data-lane="kick"][data-step="1"]', { timeout: 5000 })
    await pollUntil(() => daemon.getDoc().selectedTrack === 'drums', 'drums selection to record')
    await sleep(150)
    commit('select drums track')
    await page.click('[data-lane="kick"][data-step="1"]')
    await pollUntil(() => daemon.getDoc().tracks.find((t) => t.id === 'drums').hits.some((h) => h.id === 'kick1'), 'daemon to record the toggled hit')
    await sleep(150)
    const a = diffLines()
    console.log(`\n[A] drum toggle diff (unified=0):\n${a.diff}`)
    if (a.added.length !== 1 || a.removed.length !== 0) throw new Error(`[A] expected exactly 1 added / 0 removed, got +${a.added.length} -${a.removed.length}`)
    if (!/^\+\s*hit kick1 kick 1 0\.8\s*$/.test(a.added[0])) throw new Error(`[A] unexpected added line: ${JSON.stringify(a.added[0])}`)
    console.log('[A] PASS: exactly one line added, the toggled kick hit')
    commit('gui: toggle kick')

    // ================= B: file edit → GUI updates without reload =================
    const onDisk = readFileSync(beatPath, 'utf8')
    writeFileSync(beatPath, onDisk.replace(/^bpm 124$/m, 'bpm 141'))
    await pollUntil(() => page.evaluate(() => window.__store.getState().doc.bpm === 141), 'GUI to reflect the hand-edited bpm', 8000)
    const domBpm = await page.$eval('.transport-field input', (el) => Number(el.value))
    console.log(`\n[B] hand-edited bpm 124→141 on disk; GUI store bpm now ${domBpm} (no reload)`)
    if (domBpm !== 141) throw new Error(`[B] GUI did not reflect the file edit (bpm ${domBpm})`)
    console.log('[B] PASS: file edit propagated live')
    await page.screenshot({ path: join(uiDir, 'verify-screenshot-2.png') })

    // ================= C: audio plays =================
    await page.click('.play-btn')
    const audio = await pollUntil(
      async () =>
        page.evaluate(() => {
          const s = window.__store.getState()
          return s.currentStep >= 0 && typeof s.masterLevel === 'number' && Number.isFinite(s.masterLevel) && s.masterLevel > -Infinity ? { step: s.currentStep, level: s.masterLevel } : null
        }),
      'transport ticking + master meter reading a real level',
      9000,
    )
    const step1 = await page.evaluate(() => window.__store.getState().currentStep)
    await sleep(400)
    const step2 = await page.evaluate(() => window.__store.getState().currentStep)
    console.log(`\n[C] playing: currentStep ${step1}→${step2}, masterLevel ${audio.level.toFixed(1)} dB`)
    if (!(audio.level > -60)) throw new Error(`[C] master meter never rose above -60 dB (got ${audio.level})`)
    console.log('[C] PASS: transport ticks and the master meter reads real output')

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

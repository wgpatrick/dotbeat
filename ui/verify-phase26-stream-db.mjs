#!/usr/bin/env node
// Phase 26 Stream DB verification — in-session multi-level undo/redo (docs/research/28-undo-redo-
// vs-checkpoint-history.md), a session-only, ephemeral full-document-snapshot stack living in the
// daemon (src/daemon/daemon.ts's undoStack/redoStack), deliberately separate from the git-backed
// checkpoint/History system (src/history/history.ts, untouched by this stream). Drives a REAL
// `beat daemon` + the built frontend through Playwright — no mocked assertions; every document-state
// check reads the daemon's own state (its in-process `getDoc()`/`getUndoDepth()`/`getRedoDepth()`
// test hooks, cross-checked against the new GET /document and GET /undo-state HTTP routes), never
// just GUI appearance.
//
// Fixture: examples/night-shift.beat (unmodified — bpm 124, 4 tracks lead/drums/bass/pad, note
// "u100033" at start=20 on the lead track, an otherwise-empty "snare" lane on drums,
// lead.synth.cutoff=5200). Loaded fresh into a temp dir per run.
//
//   [A] SEVERAL DISTINCT REAL EDITS, driven through the actual GUI surfaces (not raw daemon calls):
//         1. BPM field (TransportBar) — 124 -> 140
//         2. Drag the existing note "u100033" sideways in NoteView, on the already-selected "lead"
//            track (a real move gesture — commits ONCE, on pointer-up, same as the codebase's other
//            drag primitives)
//         3. Click the "drums" track header (selects it — a real document edit: `selected_track`)
//         4. Click an empty cell on the "snare" lane (adds a new hit — the `<track>.hit` grammar)
//         5. Click the "lead" track header (selects it back — another `selected_track` edit)
//         6. Toggle Clip -> Device (UI-only local state; MUST NOT touch the undo stack)
//         7. DRAG the "Cutoff" knob (SynthPanel) through several ticks with >60ms gaps between them
//            (each gap exceeds the CLIENT's own postEdit debounce, so this genuinely produces
//            multiple distinct POST /edit calls to the SAME daemon-side gesture) — this is
//            research/28 §5.3's concrete case: the daemon must coalesce this into exactly ONE undo
//            step, not one per tick.
//     After each numbered action, poll the daemon's own undo depth (getUndoDepth()) and, IF it grew,
//     record the resulting document as a checkpoint — this makes the test robust to exactly how many
//     of the seven actions are real document mutations (action 6 must NOT add a checkpoint; action 7
//     must add exactly ONE despite several intermediate network calls).
//   [B] UNDO ONE STEP AT A TIME, confirming after EACH pop that the daemon's live document (GET
//       /document, and getDoc()) exactly equals the checkpoint immediately prior — not just that
//       *something* changed. Confirms popping past the last checkpoint (back to the original file) is
//       a clean no-op (undone:false, canUndo:false).
//   [C] REDO forward through every step, confirming the exact same document at each point, then
//       confirms redoing past the top is a no-op (canRedo already false).
//   [D] A NEW EDIT after a partial undo clears the redo stack — undo twice, make one fresh edit, then
//       verify GET /undo-state reports canRedo:false and a further POST /redo is a genuine no-op
//       (does NOT resurrect the discarded redo branch), while undo from the new state still lands
//       exactly on the pre-new-edit checkpoint.
//   [E] AN EXTERNAL FILE CHANGE (a hand-edit landing on disk from outside the daemon — the same
//       channel `beat set`/a text editor would use) clears the in-session stack entirely
//       (research/28 §3's named edge case) — confirmed via GET /undo-state before/after.
//
// Usage: node ui/verify-phase26-stream-db.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 5926

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pollUntil(fn, what, timeoutMs = 8000, everyMs = 40) {
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
  const { serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))
  // Canonical-serialization equality (exactly what the daemon's own writeIfChanged uses to decide
  // "did anything change") rather than raw JSON.stringify — a re-parsed document can legitimately
  // have different JS object-key insertion order than a document that was never re-serialized, which
  // would make a naive JSON.stringify comparison report a false mismatch on two musically identical
  // documents.
  const deepEqual = (a, b) => serialize(a) === serialize(b)

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p26db-'))
  const beatPath = join(proj, 'project.beat')
  const fixtureSrc = readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8')
  writeFileSync(beatPath, fixtureSrc)

  const daemon = await startDaemon({ filePath: beatPath, port: 0 })
  const base = `http://localhost:${daemon.port}`
  console.log(`daemon on :${daemon.port}, project at ${beatPath}`)

  // Fixture assumptions this script's assertions rely on — fail loudly and early if the example
  // file ever changes shape under us, rather than producing a confusing downstream failure.
  const d0 = daemon.getDoc()
  assert(d0.bpm === 124, `fixture assumption broken: expected bpm 124, got ${d0.bpm}`)
  assert(d0.tracks.map((t) => t.id).join(',') === 'lead,drums,bass,pad', `fixture assumption broken: track ids changed`)
  assert(d0.tracks.find((t) => t.id === 'lead').synth.cutoff === 5200, `fixture assumption broken: lead.cutoff changed`)
  const drumsHits0 = d0.tracks.find((t) => t.id === 'drums').hits
  assert(!drumsHits0.some((h) => h.lane === 'snare'), `fixture assumption broken: snare lane already has a hit`)
  const noteU1000330 = d0.tracks.find((t) => t.id === 'lead').notes.find((n) => n.id === 'u100033')
  assert(noteU1000330 && noteU1000330.start === 20, `fixture assumption broken: note u100033 missing or not at start=20`)
  assert(daemon.getUndoDepth() === 0 && daemon.getRedoDepth() === 0, `daemon should boot with empty undo/redo stacks`)
  console.log('[setup] fixture assumptions hold; daemon boots with empty undo/redo stacks')

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))
  await pollUntil(async () => {
    try {
      return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok
    } catch {
      return false
    }
  }, 'vite preview to serve')
  console.log(`ui served on :${PREVIEW_PORT}`)

  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const errors = []
  const page = await browser.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.setViewportSize({ width: 1400, height: 1200 })

  try {
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 12000 })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 12000 })
    await sleep(150)

    // ================================================================================================
    // PART A — several distinct real edits, driven through the actual GUI
    // ================================================================================================
    console.log('\n[A] driving several distinct edits through the real GUI...')

    const checkpoints = [structuredClone(daemon.getDoc())] // checkpoints[0] = the untouched baseline
    let prevUndoDepth = daemon.getUndoDepth()

    /** Runs `action`, then polls the daemon's OWN undo depth (not the GUI) for a bit; if it grew,
     * records the new document as a checkpoint. Returns how much the depth grew (0, 1, or more — a
     * >1 growth is itself informative: it means the action was more than one real primitive edit,
     * which several of these GUI actions legitimately are, e.g. add-track also reassigns selection). */
    async function step(label, action) {
      await action()
      // Settle: the client debounces /edit by up to 60ms and the daemon's own writes are
      // synchronous, so a short generous poll window comfortably covers any in-flight request.
      let depth = daemon.getUndoDepth()
      const t0 = Date.now()
      while (Date.now() - t0 < 3000) {
        await sleep(50)
        const d = daemon.getUndoDepth()
        if (d !== depth) {
          depth = d
          await sleep(150) // give a possible SECOND quick edit (e.g. select+reassign) time to land too
          depth = daemon.getUndoDepth()
        } else if (Date.now() - t0 > 400) {
          break // stable for a while — nothing more is coming
        }
      }
      const grew = depth - prevUndoDepth
      if (grew > 0) {
        for (let i = 0; i < grew; i++) checkpoints.push(null) // placeholder; filled in below with the FINAL doc
        checkpoints[checkpoints.length - 1] = structuredClone(daemon.getDoc())
        // Intermediate placeholders (when grew > 1) can't be individually recovered after the fact —
        // that's fine, this test only needs each CONSECUTIVE undo to land on some real prior daemon
        // state, and part B/C below independently re-derives exact per-step expectations for the
        // single-primitive actions (1,3,4,7) rather than relying on these placeholders for those.
      }
      console.log(`  [A] ${label}: undo depth ${prevUndoDepth} -> ${depth} (+${grew})`)
      prevUndoDepth = depth
      return grew
    }

    // 1. BPM 124 -> 140
    const growBpm = await step('BPM 124 -> 140', async () => {
      await page.fill('.transport input[type="number"]', '140')
      await page.keyboard.press('Tab')
    })
    assert(growBpm === 1, `BPM edit should be exactly one undo step, grew by ${growBpm}`)
    assert(daemon.getDoc().bpm === 140, 'bpm did not actually change to 140')
    const afterBpm = structuredClone(daemon.getDoc())

    // 2. Move the existing "u100033" note sideways, on the already-selected "lead" track (one drag
    // gesture, commits once on pointer-up). A NOTE (not a durationless drum hit/marker) on purpose:
    // a marker is only MARKER_W=7px wide with a 5px resize handle at its right edge (styles.css
    // .noteview-resize), leaving too thin a margin to reliably click-and-drag its BODY (not the
    // handle) via synthetic pointer coordinates. A 2-step note is `2*14 - 1 = 27px` wide, giving a
    // wide, safe left-hand click zone.
    const growMove = await step('drag note u100033 sideways', async () => {
      const noteEl = page.locator('[data-note-id="u100033"]')
      await noteEl.waitFor({ state: 'visible', timeout: 5000 })
      await noteEl.scrollIntoViewIfNeeded()
      const box = await noteEl.boundingBox()
      const cx = box.x + 3 // near the LEFT edge — clear of the 5px resize handle at the right edge
      // NOT the exact vertical center: that sits precisely on NoteView's row-rounding boundary
      // (Math.round((clientY - rowTop) / ROW_H)) and Math.round(0.5) rounds UP, flipping the row by
      // one and posting an unwanted `.pitch` edit alongside `.start`. A few px off-center stays
      // safely inside the "same row" bucket.
      const cy = box.y + 3
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.mouse.move(cx + 40, cy, { steps: 8 }) // same row (cy unchanged) — start-only move
      await page.mouse.up()
    })
    assert(growMove === 1, `dragging one note should be exactly one undo step, grew by ${growMove}`)
    const movedNote = daemon
      .getDoc()
      .tracks.find((t) => t.id === 'lead')
      .notes.find((n) => n.id === 'u100033')
    assert(movedNote.start !== 20, `u100033 should have moved off step 20, still at ${movedNote.start}`)
    assert(movedNote.pitch === 76, `u100033's pitch should be untouched by a same-row drag, got ${movedNote.pitch}`)
    console.log(`  [A2] note u100033 moved 20 -> ${movedNote.start}`)
    const afterMove = structuredClone(daemon.getDoc())

    // 3. Select the "drums" track (a real `selected_track` document edit)
    await step('select drums track', async () => {
      await page.locator('.arr-track-select', { hasText: 'drums' }).click()
    })
    assert(daemon.getDoc().selectedTrack === 'drums', 'selecting the drums track did not update doc.selectedTrack')

    // 4. Add a hit on the empty "snare" lane (the `<track>.hit` ADD grammar)
    const growAdd = await step('add a hit on the snare lane', async () => {
      const rowEl = page.locator('[data-row-value="snare"]')
      await rowEl.waitFor({ state: 'visible', timeout: 5000 })
      await rowEl.scrollIntoViewIfNeeded()
      const rowBox = await rowEl.boundingBox()
      const gridEl = page.locator('.noteview-grid')
      const gridBox = await gridEl.boundingBox()
      const totalSteps = 4 * 16 // loop_bars 4
      const targetStep = 20
      const x = gridBox.x + ((targetStep + 0.5) / totalSteps) * gridBox.width
      const y = rowBox.y + rowBox.height / 2
      await page.mouse.click(x, y)
    })
    assert(growAdd === 1, `adding one hit should be exactly one undo step, grew by ${growAdd}`)
    const snareHits = daemon
      .getDoc()
      .tracks.find((t) => t.id === 'drums')
      .hits.filter((h) => h.lane === 'snare')
    assert(snareHits.length === 1, `expected exactly one new snare hit, found ${snareHits.length}`)
    console.log(`  [A4] added snare hit ${snareHits[0].id} at step ${snareHits[0].start}`)
    const afterAdd = structuredClone(daemon.getDoc())

    // 5. Select "lead" back (another `selected_track` edit)
    await step('select lead track', async () => {
      await page.locator('.arr-track-select', { hasText: 'lead' }).click()
    })
    assert(daemon.getDoc().selectedTrack === 'lead', 'selecting the lead track did not update doc.selectedTrack')
    const afterSelectLead = structuredClone(daemon.getDoc())

    // 6. Toggle Clip -> Device: UI-ONLY local state. Must NOT touch the document or the undo stack.
    const depthBeforeDeviceToggle = daemon.getUndoDepth()
    await page.locator('[data-pane-tab="device"]').click()
    await page.waitForSelector('.knob', { timeout: 5000 })
    await sleep(200)
    assert(daemon.getUndoDepth() === depthBeforeDeviceToggle, 'Clip -> Device pane toggle must not push an undo step (it is pure UI state)')
    assert(deepEqual(daemon.getDoc(), afterSelectLead), 'Clip -> Device pane toggle must not touch the document at all')
    console.log('  [A6] Clip -> Device toggle confirmed UI-only (no doc mutation, no undo push)')

    // 7. Drag the Cutoff knob through several ticks with >60ms gaps — must coalesce into ONE step
    const cutoffBefore = daemon.getDoc().tracks.find((t) => t.id === 'lead').synth.cutoff
    assert(cutoffBefore === 5200, `expected lead.cutoff still 5200 before the knob drag, got ${cutoffBefore}`)
    const growKnob = await step('drag the Cutoff knob (several ticks, >60ms apart)', async () => {
      const knobSvg = page.locator('.knob', { hasText: 'Cutoff' }).locator('svg')
      await knobSvg.waitFor({ state: 'visible', timeout: 5000 })
      await knobSvg.scrollIntoViewIfNeeded()
      const box = await knobSvg.boundingBox()
      const cx = box.x + box.width / 2
      const cy = box.y + box.height / 2
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      for (let i = 1; i <= 4; i++) {
        await page.mouse.move(cx, cy - i * 12, { steps: 3 }) // drag upward = increase value
        await sleep(120) // > the CLIENT's own 60ms postEdit debounce — forces a distinct POST /edit
      }
      await page.mouse.up()
      await sleep(250) // let the final debounced POST land
    })
    assert(growKnob === 1, `a single continuous knob drag (even with several distinct network calls) must be exactly ONE undo step, grew by ${growKnob}`)
    const cutoffAfter = daemon.getDoc().tracks.find((t) => t.id === 'lead').synth.cutoff
    assert(cutoffAfter !== cutoffBefore, `cutoff did not change after the drag (still ${cutoffAfter})`)
    console.log(`  [A7] PASS: cutoff ${cutoffBefore} -> ${cutoffAfter} across a multi-tick drag, coalesced into exactly one undo step`)
    const afterKnob = structuredClone(daemon.getDoc())

    assert(checkpoints.length === 7, `expected 7 checkpoints (baseline + 6 distinct edits), got ${checkpoints.length}`)
    assert(deepEqual(checkpoints[1], afterBpm), 'checkpoint 1 should be the post-bpm document')
    assert(deepEqual(checkpoints[2], afterMove), 'checkpoint 2 should be the post-move document')
    assert(deepEqual(checkpoints[4], afterAdd), 'checkpoint 4 should be the post-add document')
    assert(deepEqual(checkpoints[6], afterKnob), 'checkpoint 6 (final) should be the post-knob-drag document')
    console.log(`[A] PASS: ${checkpoints.length - 1} distinct edits landed as ${checkpoints.length - 1} separate undo steps (undo depth = ${daemon.getUndoDepth()})`)

    // ================================================================================================
    // PART B — undo one step at a time; the daemon's OWN document must exactly match, every time
    // ================================================================================================
    console.log('\n[B] undoing one step at a time, checking the daemon-served document at each step...')

    async function undoOnceViaKeyboard() {
      const before = daemon.getUndoDepth()
      await page.keyboard.press('Control+z')
      await pollUntil(() => daemon.getUndoDepth() === before - 1, `undo depth to drop from ${before}`, 4000)
    }

    for (let i = checkpoints.length - 1; i >= 1; i--) {
      await undoOnceViaKeyboard()
      const expected = checkpoints[i - 1]
      const got = daemon.getDoc()
      if (!deepEqual(got, expected)) {
        const { diffDocuments, formatDiff } = await import(join(repoRoot, 'dist/src/core/index.js'))
        console.log('  [DEBUG] diff (expected -> got):', formatDiff(diffDocuments(expected, got)))
      }
      assert(deepEqual(got, expected), `after undo #${checkpoints.length - i}, daemon document does not match checkpoint ${i - 1}`)
      // Cross-check the actual NEW HTTP surface too, not just the in-process test hook.
      const httpDoc = await (await fetch(`${base}/document`)).json()
      assert(deepEqual(httpDoc, expected), `GET /document disagrees with getDoc() after undo #${checkpoints.length - i}`)
      console.log(`  [B] undo #${checkpoints.length - i}: document exactly matches checkpoint ${i - 1} (verified via getDoc() AND GET /document)`)
    }
    assert(daemon.getUndoDepth() === 0, 'undo stack should be fully drained')
    assert(daemon.getRedoDepth() === checkpoints.length - 1, `redo stack should hold all ${checkpoints.length - 1} steps, has ${daemon.getRedoDepth()}`)
    assert(deepEqual(daemon.getDoc(), checkpoints[0]), 'fully undone document should exactly match the original baseline')

    // One more undo past the bottom must be a genuine no-op.
    const undoStateBefore = await (await fetch(`${base}/undo-state`)).json()
    assert(undoStateBefore.canUndo === false, 'GET /undo-state should report canUndo:false when the stack is empty')
    const noopUndo = await (await fetch(`${base}/undo`, { method: 'POST' })).json()
    assert(noopUndo.undone === false, 'POST /undo on an empty stack should report undone:false, not pop anything')
    assert(deepEqual(noopUndo.doc, checkpoints[0]), 'a no-op /undo must not alter the document')
    assert(daemon.getRedoDepth() === checkpoints.length - 1, 'a no-op /undo must not touch the redo stack either')
    console.log('[B] PASS: every undo step reverted the document exactly, and undoing past the bottom is a clean no-op')

    // TransportBar's Undo button should now read disabled — the small visual affordance research/28
    // §5.6 recommends (greyed out when the stack is empty), cross-checked against real DOM state.
    // Poll rather than assert instantly: the daemon's own depth (what undoOnceViaKeyboard polls on)
    // updates synchronously inside the HTTP handler, strictly BEFORE the browser's fetch() promise
    // resolves and React re-renders the button — a real, if narrow, round-trip gap.
    await pollUntil(async () => page.locator('[data-action="undo"]').isDisabled(), 'Undo button to become disabled', 3000)
    assert(!(await page.locator('[data-action="redo"]').isDisabled()), 'Redo button should be enabled once there is a redo branch')
    console.log('[B] PASS: TransportBar Undo/Redo buttons reflect the real stack state')

    // ================================================================================================
    // PART C — redo forward through every step
    // ================================================================================================
    console.log('\n[C] redoing forward through every step...')

    async function redoOnceViaButton() {
      const before = daemon.getRedoDepth()
      await page.locator('[data-action="redo"]').click()
      await pollUntil(() => daemon.getRedoDepth() === before - 1, `redo depth to drop from ${before}`, 4000)
    }

    for (let i = 1; i < checkpoints.length; i++) {
      await redoOnceViaButton()
      const got = daemon.getDoc()
      assert(deepEqual(got, checkpoints[i]), `after redo #${i}, daemon document does not match checkpoint ${i}`)
      console.log(`  [C] redo #${i}: document exactly matches checkpoint ${i}`)
    }
    assert(daemon.getRedoDepth() === 0, 'redo stack should be fully drained')
    assert(daemon.getUndoDepth() === checkpoints.length - 1, 'undo stack should hold every step again after full redo')
    assert(deepEqual(daemon.getDoc(), checkpoints[checkpoints.length - 1]), 'fully redone document should match the final edit exactly')

    const noopRedo = await (await fetch(`${base}/redo`, { method: 'POST' })).json()
    assert(noopRedo.redone === false, 'POST /redo on an empty redo stack should report redone:false')
    console.log('[C] PASS: every redo step reproduced the document exactly, and redoing past the top is a clean no-op')

    // ================================================================================================
    // PART D — a NEW edit after a partial undo clears the redo stack
    // ================================================================================================
    console.log('\n[D] a new edit after undo must clear the redo stack...')

    await undoOnceViaKeyboard() // back to checkpoints[5] (undoes the knob drag)
    await undoOnceViaKeyboard() // back to checkpoints[4] (undoes "select lead")
    assert(deepEqual(daemon.getDoc(), checkpoints[4]), 'should be sitting on checkpoint 4 before the new edit')
    assert(daemon.getRedoDepth() === 2, `should have a 2-deep redo branch banked before the new edit, has ${daemon.getRedoDepth()}`)

    // A brand-new edit from here (BPM 140 -> 150) should commit normally AND wipe the 2-deep redo
    // branch that was sitting above it.
    await page.fill('.transport input[type="number"]', '150')
    await page.keyboard.press('Tab')
    await pollUntil(() => daemon.getDoc().bpm === 150, 'bpm to commit to 150')
    await sleep(150)
    assert(daemon.getRedoDepth() === 0, `a new edit after undo must clear the redo stack, still has depth ${daemon.getRedoDepth()}`)
    const undoStateAfterNewEdit = await (await fetch(`${base}/undo-state`)).json()
    assert(undoStateAfterNewEdit.canRedo === false, 'GET /undo-state should report canRedo:false right after the redo-clearing edit')
    await pollUntil(async () => page.locator('[data-action="redo"]').isDisabled(), 'Redo button to go back to disabled', 5000)

    // Confirm the discarded branch is REALLY gone, not just hidden: redo must stay a no-op.
    const stillNoopRedo = await (await fetch(`${base}/redo`, { method: 'POST' })).json()
    assert(stillNoopRedo.redone === false, 'the discarded redo branch must not be resurrected')

    // And undo from the new state must land exactly back on checkpoint 4 — proves the redo-clearing
    // edit's own undo entry is intact even though the branch above it was discarded.
    await undoOnceViaKeyboard()
    assert(deepEqual(daemon.getDoc(), checkpoints[4]), 'undoing the redo-clearing edit should land exactly back on checkpoint 4')
    console.log('[D] PASS: a new edit after undo cleared the redo stack, and the undo chain below it stayed intact')

    // ================================================================================================
    // PART E — an external file change (a hand-edit landing on disk, not through the daemon's own
    // routes) clears the in-session stack entirely (research/28 §3's named edge case)
    // ================================================================================================
    console.log('\n[E] an external file change should clear the undo/redo stacks...')
    assert(daemon.getUndoDepth() > 0, 'should have undo history banked going into part E')
    const beforeExternal = await (await fetch(`${base}/undo-state`)).json()
    assert(beforeExternal.canUndo === true, 'expected a non-empty undo stack before the external edit')

    const { parse: parseDoc, serialize: serializeDoc } = await import(join(repoRoot, 'dist/src/core/index.js'))
    const externalDoc = { ...daemon.getDoc(), bpm: 200 } // simulate a hand-edit / `beat set` from outside the daemon
    writeFileSync(beatPath, serializeDoc(parseDoc(serializeDoc(externalDoc))))

    await pollUntil(() => daemon.getDoc().bpm === 200, 'the daemon to pick up the external file change via its watcher', 5000)
    await sleep(100)
    assert(daemon.getUndoDepth() === 0 && daemon.getRedoDepth() === 0, 'an external file change should fully clear both stacks')
    const afterExternal = await (await fetch(`${base}/undo-state`)).json()
    assert(afterExternal.canUndo === false && afterExternal.canRedo === false, 'GET /undo-state should report both stacks empty after an external change')
    console.log('[E] PASS: an external file change cleared the in-session undo/redo stacks entirely')

    console.log('\nno browser console/page errors: ' + (errors.length === 0 ? 'confirmed' : `FAILED — ${errors.length} error(s): ${errors.join('; ')}`))
    assert(errors.length === 0, `page errors occurred: ${errors.join('; ')}`)

    console.log('\n=== PHASE 26 STREAM DB: ALL CHECKS PASSED ===')
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
    preview.kill()
    await daemon.close().catch(() => {})
  }
}

main().catch((err) => {
  console.error('\nVERIFICATION FAILED:', err)
  process.exit(1)
})

#!/usr/bin/env node
// Phase 29 Stream GA — scene/clip-editor targeting (docs/phase-29-plan.md's GA section). The single
// highest-impact finding across the usability pilots (docs/research/83, 84, 86): once a song has
// more than one section, there was no way — from the GUI — to view or edit any section's clip
// content except the first. Root cause: `primaryClipFor` (ClipPropertiesPanel.tsx) always scanned
// `doc.song` from index 0, and `placeInArrangement` (NoteView.tsx) hardcoded `doc.song[0]`; neither
// had any notion of "which section is the user currently looking at." This drives the REAL frontend
// headlessly against a REAL `beat daemon`, reading the daemon's own live document — not mocks.
//
//   T1  Clicking a clip block in a LATER section (not the first) actually retargets the bottom note
//       editor: the grid now shows THAT section's clip's notes, not the first section's — the exact
//       symptom pilot 84 reproduced via precise `data-clip-block` targeting.
//   T2  The clip-properties strip (`clip "<id>"`) updates to name the newly-selected section's clip,
//       not the first section's — same targeting bug, second surface.
//   T3  "Place in Arrangement" after selecting a later section writes into THAT section's scene (via
//       the daemon's live document), not always `doc.song[0]` — pilot 86's exact reproduction.
//   T4  Switching back to the FIRST section's clip block restores the first section's content in the
//       editor — proving this is real bidirectional targeting, not a one-way ratchet.
//   T5  With nothing explicitly selected (a fresh page load), the old first-occurrence fallback
//       still holds — this fix is additive, not a behavior change for the untouched case.
//   T6  Shared-scene visual cue: two sections that share a scene id (the "+ section" duplicate
//       case) both render the "linked" badge; an independent section does not.
//   T7  Deleting a section prunes its now-orphaned scene from doc.scenes, but leaves a scene alone
//       when another surviving section still references it.
//
// Usage: node ui/verify-phase29-stream-ga.mjs

import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8971
const PREVIEW_PORT = 5981

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function pollUntil(fn, what, timeoutMs = 12000, everyMs = 40) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}

const noteKey = (n) => `${n.pitch}:${n.start}:${n.duration}`
const sortedKeys = (list) => list.map(noteKey).sort()

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { initDocument, addNote, saveClip, setScene, setSong, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  // A fresh, disposable project (NOT examples/night-shift-song.beat) with a "bass" track carrying
  // TWO independent song sections, each backed by its own scene/clip with distinctly different
  // notes — the exact shape docs/phase-29-plan.md's own verify instructions ask for. The track's
  // LIVE buffer is left mirroring clipA's content (docs/research/83's own description of the real
  // starting state: "the note editor always edits the track's live note buffer, which starts out
  // mirroring s1's content") — clipB is built and grafted on via a SEPARATE branch so minting it
  // never disturbs the live buffer, which is what makes T1/T4 below a genuine, observable swap
  // rather than a coincidence of how the fixture happened to be built.
  let doc = initDocument({ trackId: 'bass' })
  doc = addNote(doc, 'bass', { pitch: 45, start: 0, duration: 4, velocity: 0.8 }).doc // A2
  doc = addNote(doc, 'bass', { pitch: 48, start: 4, duration: 4, velocity: 0.8 }).doc // C3
  doc = saveClip(doc, 'bass', 'clipA').doc // live buffer now == clipA's notes
  doc = setScene(doc, 'sceneA', { bass: 'clipA' })
  const clipANotes = doc.tracks[0].clips.find((c) => c.id === 'clipA').notes

  let building = { ...doc, tracks: doc.tracks.map((t) => (t.id === 'bass' ? { ...t, notes: [] } : t)) }
  building = addNote(building, 'bass', { pitch: 57, start: 8, duration: 2, velocity: 0.7 }).doc // A3
  building = addNote(building, 'bass', { pitch: 60, start: 12, duration: 2, velocity: 0.7 }).doc // C4
  building = saveClip(building, 'bass', 'clipB').doc
  building = setScene(building, 'sceneB', { bass: 'clipB' })
  const clipBClip = building.tracks[0].clips.find((c) => c.id === 'clipB')
  const clipBNotes = clipBClip.notes
  if (JSON.stringify(sortedKeys(clipANotes)) === JSON.stringify(sortedKeys(clipBNotes))) {
    throw new Error('[setup] clipA and clipB ended up with identical notes — the test fixture needs them to differ')
  }

  // Graft clipB + sceneB onto the ORIGINAL doc, whose "bass" live buffer still mirrors clipA.
  doc = {
    ...doc,
    tracks: doc.tracks.map((t) => (t.id === 'bass' ? { ...t, clips: [...t.clips, clipBClip] } : t)),
    scenes: [...doc.scenes, building.scenes.find((s) => s.id === 'sceneB')],
  }
  doc = setSong(doc, [
    { scene: 'sceneA', bars: 4 },
    { scene: 'sceneB', bars: 4 },
  ])

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p29ga-'))
  const beatPath = join(proj, 'song.beat')
  writeFileSync(beatPath, serialize(doc))
  console.log(`[setup] scratch project at ${beatPath}: section 0 -> "sceneA"/"clipA" (${clipANotes.length} notes), section 1 -> "sceneB"/"clipB" (${clipBNotes.length} notes)`)

  const daemon = await startDaemon({ filePath: beatPath, port: PORT })
  console.log(`daemon up on :${daemon.port}`)

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
    await page.setViewportSize({ width: 1600, height: 1000 })
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    // No native dialog is expected anywhere in this flow (both clip swaps below stay content-backed,
    // so the live-buffer sync effect's confirm-guard never fires) — dismiss defensively and surface
    // in the final report if one ever does, rather than letting an unexpected alert dangle silently.
    const alerts = []
    page.on('dialog', async (d) => {
      alerts.push(d.message())
      await d.dismiss()
    })

    const daemonDocNow = async () => (await fetch(`http://localhost:${daemon.port}/document`)).json()
    const docNow = () => page.evaluate(() => window.__store.getState().doc)
    const editorNotes = () =>
      page.evaluate(() => {
        const st = window.__store.getState()
        const track = st.doc.tracks.find((t) => t.id === (st.selectedTrackId ?? st.doc.selectedTrack))
        return track.notes.map((n) => ({ pitch: n.pitch, start: n.start, duration: n.duration }))
      })
    const clipPropsLabel = () => page.locator('[data-clip-props]').getAttribute('data-clip-props')

    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    // Select the "bass" track (single track in this fixture, but be explicit and robust).
    await page.click('.arr-track-select:has(.arr-track-name:text-is("bass"))')
    await page.waitForSelector('.noteview-grid', { timeout: 5000 })

    // ============ T5 (checked first): nothing selected yet -> old first-occurrence fallback ============
    const selectedSectionInitially = await page.evaluate(() => window.__store.getState().selectedSectionIndex)
    if (selectedSectionInitially !== null) throw new Error(`[T5] expected selectedSectionIndex to start null, got ${selectedSectionInitially}`)
    const openInitially = await editorNotes()
    if (JSON.stringify(sortedKeys(openInitially)) !== JSON.stringify(sortedKeys(clipANotes))) {
      throw new Error(`[T5] expected the untouched live buffer to still show clipA's notes on load, got ${JSON.stringify(openInitially)}`)
    }
    const labelInitially = await clipPropsLabel()
    if (labelInitially !== 'clipA') throw new Error(`[T5] expected the clip-properties strip to fall back to the first-occurrence clip "clipA", got "${labelInitially}"`)
    console.log('[T5] PASS: with nothing explicitly selected, both the editor and the properties strip fall back to the first section\'s clip (old behavior unchanged)')
    results.t5 = { ok: true }

    // ============ T1/T2: click section 1's clip block -> editor + properties strip retarget ============
    const blockSel = (sectionIndex) => `[data-clip-block="bass::${sectionIndex}"]`
    await page.waitForSelector(blockSel(1), { timeout: 5000 })
    await page.click(blockSel(1))
    await pollUntil(async () => (await page.evaluate(() => window.__store.getState().selectedSectionIndex)) === 1, 'selectedSectionIndex to become 1 after clicking section 1\'s clip block')

    await pollUntil(async () => {
      const notes = await editorNotes()
      return JSON.stringify(sortedKeys(notes)) === JSON.stringify(sortedKeys(clipBNotes))
    }, 'the note editor to show clipB\'s notes after clicking section 1\'s clip block')
    const editorAfterClickB = await editorNotes()
    console.log(`[T1] PASS: clicking section 1's clip block retargeted the note editor to clipB's ${editorAfterClickB.length} notes (was clipA's ${openInitially.length})`)
    results.t1 = { notes: editorAfterClickB }

    await pollUntil(async () => (await clipPropsLabel()) === 'clipB', 'the clip-properties strip to label "clipB"')
    console.log('[T2] PASS: clip-properties strip now reads clip "clipB", matching the retargeted editor')
    results.t2 = { ok: true }

    // ============ T3: Place in Arrangement writes into the SELECTED section's scene ============
    // Author one more real note via a grid click so the placed content is an observable change.
    await page.$eval('.bottom-pane-body', (el) => {
      el.scrollTop = 0
      el.scrollLeft = 0
    })
    await sleep(120)
    const loopBars = (await docNow()).loopBars
    const gridBox = await page.locator('.noteview-grid').boundingBox()
    const stepW = gridBox.width / (loopBars * 16)
    const x = gridBox.x + 2 * stepW + stepW / 2
    const y = gridBox.y + 6 * 12 + 6
    const countBefore = (await editorNotes()).length
    await page.mouse.click(x, y)
    await pollUntil(async () => (await editorNotes()).length === countBefore + 1, 'the extra authored note to land in the live buffer (client)')
    // bridge.ts debounces /edit per-path (~60ms) — the CLIENT store updates optimistically/instantly,
    // but "Place in Arrangement" triggers a DAEMON-side saveClip that snapshots the SERVER's live
    // notes. Wait for the daemon's own copy to catch up too, or the place click below can race ahead
    // of the debounced write and snapshot stale (pre-click) content — same discipline
    // verify-phase24-stream-ci.mjs's own comment on this exact race documents.
    await pollUntil(
      async () => (await daemonDocNow()).tracks.find((t) => t.id === 'bass').notes.length === countBefore + 1,
      'the extra authored note to land in the live buffer (daemon)',
    )

    await page.click('[data-place-clip="bass"]')
    await pollUntil(async () => {
      const d = await daemonDocNow()
      const clip = d.tracks.find((t) => t.id === 'bass').clips.find((c) => c.id === 'clipB')
      return clip && clip.notes.length === countBefore + 1
    }, '"Place in Arrangement" to re-save into clipB (section 1\'s scene), not doc.song[0]')
    const docAfterPlace = await daemonDocNow()
    const sceneA = docAfterPlace.scenes.find((s) => s.id === 'sceneA')
    if (sceneA.slots.bass !== 'clipA') throw new Error(`[T3] expected section 0's scene "sceneA" untouched (still slotting "clipA"), got "${sceneA.slots.bass}"`)
    const clipAUnchanged = docAfterPlace.tracks.find((t) => t.id === 'bass').clips.find((c) => c.id === 'clipA')
    if (JSON.stringify(sortedKeys(clipAUnchanged.notes)) !== JSON.stringify(sortedKeys(clipANotes))) {
      throw new Error('[T3] "Place in Arrangement" mutated clipA even though section 1 (clipB) was selected')
    }
    console.log('[T3] PASS: "Place in Arrangement" wrote into the SELECTED section\'s scene (sceneB/clipB); section 0\'s sceneA/clipA is byte-identical')
    results.t3 = { ok: true }

    // ============ T4: switching back to section 0's clip block restores clipA's content ============
    await page.click(blockSel(0))
    await pollUntil(async () => (await page.evaluate(() => window.__store.getState().selectedSectionIndex)) === 0, 'selectedSectionIndex to become 0 after clicking section 0\'s clip block')
    await pollUntil(async () => {
      const notes = await editorNotes()
      return JSON.stringify(sortedKeys(notes)) === JSON.stringify(sortedKeys(clipANotes))
    }, 'the note editor to show clipA\'s notes again after clicking section 0\'s clip block')
    console.log('[T4] PASS: clicking back to section 0 restored clipA\'s content — real bidirectional targeting')
    results.t4 = { ok: true }

    // ============ T6: shared-scene visual cue ============
    // "+ section" duplicates by REUSING the previous section's scene — append one, which should
    // share section 1's scene ("sceneB") and both should now carry the "linked" badge.
    const beforeAppendLen = (await daemonDocNow()).song.length
    await page.click('[data-add-section="1"]')
    await pollUntil(async () => (await daemonDocNow()).song.length === beforeAppendLen + 1, 'a duplicated (shared-scene) section to appear after "+ section"')
    const docAfterAppend = await daemonDocNow()
    if (docAfterAppend.song[2].scene !== docAfterAppend.song[1].scene) {
      throw new Error(`[T6] expected "+ section" to reuse section 1's scene, got "${docAfterAppend.song[2].scene}" vs "${docAfterAppend.song[1].scene}"`)
    }
    await pollUntil(async () => (await page.locator('[data-linked-scene]').count()) >= 2, 'at least 2 "linked scene" badges to render after a shared-scene duplicate')
    const linkedCount = await page.locator('[data-linked-scene]').count()
    // Section 0's chip ("sceneA", genuinely independent) must NOT carry the badge.
    const section0Chip = page.locator('[data-section-chip="0"]')
    const section0HasBadge = await section0Chip.locator('[data-linked-scene]').count()
    if (section0HasBadge !== 0) throw new Error('[T6] section 0 (an independent scene) unexpectedly rendered the "linked" badge')
    console.log(`[T6] PASS: ${linkedCount} "linked scene" badges rendered for the shared-scene pair; section 0's independent scene carries none`)
    results.t6 = { linkedCount }

    // ============ T7: deleting a section prunes its orphaned scene, keeps a still-shared one ============
    // Delete the newly-appended section (index 2) — it shares "sceneB" with section 1, so sceneB
    // must SURVIVE (section 1 still references it).
    await page.click('[data-section-delete="2"]')
    await pollUntil(async () => (await daemonDocNow()).song.length === beforeAppendLen, 'the appended section to be removed')
    const docAfterDelete1 = await daemonDocNow()
    if (!docAfterDelete1.scenes.some((s) => s.id === 'sceneB')) throw new Error('[T7] "sceneB" was pruned even though section 1 still references it')
    console.log('[T7a] PASS: deleting the shared-scene duplicate left "sceneB" intact (section 1 still references it)')

    // Now delete section 1 itself (the only remaining reference to "sceneB") — sceneB must be pruned.
    await page.click('[data-section-delete="1"]')
    await pollUntil(async () => (await daemonDocNow()).song.length === beforeAppendLen - 1, 'section 1 to be removed')
    const docAfterDelete2 = await daemonDocNow()
    if (docAfterDelete2.scenes.some((s) => s.id === 'sceneB')) throw new Error('[T7] "sceneB" was NOT pruned after its only remaining referrer was deleted')
    if (!docAfterDelete2.scenes.some((s) => s.id === 'sceneA')) throw new Error('[T7] "sceneA" (still referenced by the surviving section 0) was incorrectly pruned')
    console.log('[T7b] PASS: deleting sceneB\'s last referring section pruned it from doc.scenes; sceneA (still referenced) survives')
    results.t7 = { ok: true }

    if (alerts.length) throw new Error(`unexpected native dialog(s) fired during the flow: ${JSON.stringify(alerts)}`)
    if (pageErrors.length) console.log('\n(page errors, non-fatal):\n' + pageErrors.join('\n'))
    console.log('\n================ ALL CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    if (daemon) await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nVERIFY FAILED:', err)
  process.exit(1)
})

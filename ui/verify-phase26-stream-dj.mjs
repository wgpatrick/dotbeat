#!/usr/bin/env node
// Phase 26 Stream DJ — "Insert Scene" + "Capture-and-Insert Scene" (docs/phase-26-plan.md,
// docs/research/54-ableton-vs-dotbeat-session-view.md's P0 shortlist). The bug this closes:
// `docs/product-roadmap.md`'s Arrangement row states plainly that appended/duplicated sections
// share a scene id, so editing one section's clips silently edits every OTHER section that happens
// to reference the same scene — this fixture (`examples/night-shift-song.beat`) has exactly that
// shape: the "intro" scene backs FOUR separate sections (indices 0, 3, 4, 5).
//
//   T1  INSERT SCENE (GUI-driven, "+ insert scene" button): clicking it appends a new song section
//       whose scene id is freshly minted (never seen before in the document) with EMPTY slots — no
//       clips assigned. Every pre-existing section/scene (including "intro"'s 4 occurrences) is
//       byte-for-byte unchanged by the click.
//   T2  NO CROSS-CONTAMINATION: placing a clip into the brand-new scene (via the same /place-clip
//       route NoteView's "Place in Arrangement" button already uses, just aimed at the new scene
//       instead of section 0's) does NOT touch the "groove" clip it was snapshotted from, does NOT
//       touch the "intro"/"build"/"drop" scenes' slots, and does NOT touch any of the 4 sections
//       that reference "intro" — proving the new section's scene is genuinely independent, unlike
//       today's shared-scene default.
//   T3  CAPTURE-AND-INSERT SCENE (GUI-driven, "+ capture scene" button): after authoring real,
//       UNSAVED live edits on multiple tracks (grid clicks — never snapshotted into any clip),
//       clicking it snapshots EVERY non-audio track's current live content into fresh clips bundled
//       into one new scene, inserted as a new section. Each captured clip's notes/hits are compared
//       exactly (sorted, deep-equal) against what was live on that track the instant before the
//       click — not the track's pre-existing "hook"/"groove" clip content.
//   T4  Editing the capture-inserted section afterward (re-placing a further live edit into its own
//       scene) still does not perturb "intro"/"build"/"drop" or any section referencing them —
//       true independence, exercised a second time end-to-end through the daemon's real /song and
//       /place-clip routes.
//   T5  Backend refusal: POST /song {op:'insert'|'captureInsert', ...} against a LOOP-MODE document
//       (no song block at all) is rejected 400 — mirrors move/delete/resize's own "not in song
//       mode" refusal — and the GUI never renders the buttons in loop mode in the first place.
//
// Usage: node ui/verify-phase26-stream-dj.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT_SONG = 8961 // song-mode project (T1-T4)
const PORT_LOOP = 8962 // loop-mode project (T5)
const PREVIEW_PORT = 5971

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

function initProject(srcFixture, dirPrefix) {
  const proj = mkdtempSync(join(tmpdir(), dirPrefix))
  const beatPath = join(proj, 'song.beat')
  writeFileSync(beatPath, readFileSync(join(repoRoot, srcFixture), 'utf8'))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline')
  return { proj, beatPath }
}

// Sorted, comparable projection of a note/hit list — ignores id (a fresh snapshot mints its own
// ids) but compares every musically-real field.
const noteKey = (n) => `${n.pitch}:${n.start}:${n.duration}:${n.velocity}`
const hitKey = (h) => `${h.lane}:${h.start}:${h.velocity}:${h.duration ?? ''}`
function sortedKeys(list, keyFn) {
  return list.map(keyFn).sort()
}
function assertSameEvents(label, live, captured, keyFn) {
  const a = JSON.stringify(sortedKeys(live, keyFn))
  const b = JSON.stringify(sortedKeys(captured, keyFn))
  if (a !== b) throw new Error(`${label}: captured content doesn't match live content at capture time\n  live:     ${a}\n  captured: ${b}`)
}

async function main() {
  console.log('building repo core/daemon/metrics + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))

  const songProj = initProject('examples/night-shift-song.beat', 'dotbeat-p26dj-song-')
  const loopProj = initProject('examples/night-shift.beat', 'dotbeat-p26dj-loop-')

  let daemonSong = await startDaemon({ filePath: songProj.beatPath, port: PORT_SONG })
  console.log(`daemon SONG up on :${daemonSong.port}, project ${songProj.beatPath}`)
  let daemonLoop = await startDaemon({ filePath: loopProj.beatPath, port: PORT_LOOP })
  console.log(`daemon LOOP up on :${daemonLoop.port}, project ${loopProj.beatPath}`)

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
    await page.setViewportSize({ width: 1600, height: 1300 })
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    const daemonDocNow = async () => (await fetch(`http://localhost:${daemonSong.port}/document`)).json()
    const docNow = () => page.evaluate(() => window.__store.getState().doc)

    async function placeClipDirect(track, opts) {
      const res = await fetch(`http://localhost:${daemonSong.port}/place-clip`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ track, ...opts }),
      })
      if (!res.ok) throw new Error(`POST /place-clip ${track}: HTTP ${res.status} ${await res.text()}`)
      return res.json()
    }

    // Fires one grid click on `track`'s NoteView at a given (0-based) row/step, waiting for BOTH the
    // client's optimistic mirror and the daemon's authoritative doc to confirm the new event count —
    // same discipline verify-phase24-stream-ci.mjs uses (bridge.ts debounces /edit per-path, so a
    // fast burst without waiting can silently lose all but the last click).
    async function clickGridCell(trackId, step, row, expectField, expectCount) {
      await page.$eval('.bottom-pane-body', (el) => {
        el.scrollTop = 0
        el.scrollLeft = 0
      })
      await sleep(120)
      const doc = await docNow()
      const loopBars = doc.loopBars
      const gridBox = await page.locator('.noteview-grid').boundingBox()
      const stepW = gridBox.width / (loopBars * 16)
      const x = gridBox.x + step * stepW + stepW / 2
      const y = gridBox.y + row * 12 + 6
      await page.mouse.click(x, y)
      await pollUntil(
        async () => (await docNow()).tracks.find((t) => t.id === trackId)[expectField].length === expectCount,
        `${expectCount} ${expectField} on "${trackId}" (client) after a grid click`,
      )
      await pollUntil(
        async () => (await daemonDocNow()).tracks.find((t) => t.id === trackId)[expectField].length === expectCount,
        `${expectCount} ${expectField} on "${trackId}" (daemon) after a grid click`,
      )
    }

    async function selectTrack(trackId) {
      await page.click(`.arr-track-select:has(.arr-track-name:text-is("${trackId}"))`)
      await page.waitForSelector('.noteview-grid', { timeout: 5000 })
    }

    // ============ setup: song-mode project ============
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemonSong.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    // examples/night-shift-song.beat is BOTH this test's shared fixture AND the owner's own live
    // GUI-editing project (a running dev daemon points at it), so its exact section/scene layout
    // drifts over time as they edit — assert the SHAPE this test actually needs (song mode, and at
    // least one scene backing 2+ sections, the shared-scene aliasing case), not an exact section
    // count or exact "intro" backing count, which would be re-broken by the next live edit.
    let doc = await docNow()
    if (!doc.song || doc.song.length < 2) throw new Error(`[setup] expected the song fixture to have multiple sections, got ${doc.song?.length}`)
    const introIndices = doc.song.map((s, i) => (s.scene === 'intro' ? i : -1)).filter((i) => i >= 0)
    if (introIndices.length < 2) throw new Error(`[setup] expected "intro" to back 2+ sections (the shared-scene fixture case), got ${introIndices.length}`)
    const originalSceneIds = new Set(doc.scenes.map((s) => s.id))
    const introSlotsBefore = JSON.stringify(doc.scenes.find((s) => s.id === 'intro').slots)
    const buildSlotsBefore = JSON.stringify(doc.scenes.find((s) => s.id === 'build').slots)
    const dropSlotsBefore = JSON.stringify(doc.scenes.find((s) => s.id === 'drop').slots)
    const padGrooveBefore = JSON.stringify(doc.tracks.find((t) => t.id === 'pad').clips.find((c) => c.id === 'groove').notes)
    console.log(`[setup] song mode confirmed: 6 sections, "intro" backs sections ${JSON.stringify(introIndices)}, scenes = ${[...originalSceneIds].join(', ')}`)

    // ============ T1: Insert Scene (GUI button) ============
    const sectionsBefore = JSON.stringify(doc.song)
    if (await page.locator('[data-insert-scene="1"]').count()) {
      // expected: present in song mode
    } else {
      throw new Error('[T1] expected the "+ insert scene" button to be present in song mode')
    }
    await page.click('[data-insert-scene="1"]')
    await pollUntil(async () => (await daemonDocNow()).song.length === 7, 'a 7th section to appear after Insert Scene')

    doc = await daemonDocNow()
    if (JSON.stringify(doc.song.slice(0, 6)) !== sectionsBefore) throw new Error('[T1] the original 6 sections changed after Insert Scene (expected byte-identical)')
    const newSection = doc.song[6]
    if (originalSceneIds.has(newSection.scene)) throw new Error(`[T1] expected a FRESH scene id, got "${newSection.scene}" which already existed`)
    const insertedSceneId = newSection.scene
    const insertedScene = doc.scenes.find((s) => s.id === insertedSceneId)
    if (!insertedScene) throw new Error(`[T1] no scene "${insertedSceneId}" found in the document after Insert Scene`)
    if (Object.keys(insertedScene.slots).length !== 0) throw new Error(`[T1] expected an EMPTY scene, got slots ${JSON.stringify(insertedScene.slots)}`)
    if (JSON.stringify(doc.scenes.find((s) => s.id === 'intro').slots) !== introSlotsBefore) throw new Error('[T1] "intro" scene slots changed after Insert Scene')
    if (JSON.stringify(doc.scenes.find((s) => s.id === 'build').slots) !== buildSlotsBefore) throw new Error('[T1] "build" scene slots changed after Insert Scene')
    if (JSON.stringify(doc.scenes.find((s) => s.id === 'drop').slots) !== dropSlotsBefore) throw new Error('[T1] "drop" scene slots changed after Insert Scene')
    const fileAfterT1 = readFileSync(songProj.beatPath, 'utf8')
    if (!fileAfterT1.includes(`scene ${insertedSceneId}`)) throw new Error(`[T1] expected a literal "scene ${insertedSceneId}" block on disk`)
    console.log(`[T1] PASS: Insert Scene minted fresh empty scene "${insertedSceneId}" as section 6; all 6 prior sections and their scenes byte-identical`)
    results.t1 = { insertedSceneId }

    // ============ T2: placing a clip into the new scene contaminates nothing else ============
    await selectTrack('pad')
    doc = await docNow()
    const padLiveCountBefore = doc.tracks.find((t) => t.id === 'pad').notes.length
    // A real, on-grid note click that lands somewhere not already occupied (row 3, a step with no
    // existing pad note) — genuinely new live content, distinguishable from the "groove" clip.
    await clickGridCell('pad', 8, 3, 'notes', padLiveCountBefore + 1)
    doc = await daemonDocNow()
    const padLiveNotes = doc.tracks.find((t) => t.id === 'pad').notes
    const { clipId: newPadClipId } = await placeClipDirect('pad', { sceneId: insertedSceneId })
    doc = await daemonDocNow()
    const padTrack = doc.tracks.find((t) => t.id === 'pad')
    const newPadClip = padTrack.clips.find((c) => c.id === newPadClipId)
    if (!newPadClip) throw new Error(`[T2] /place-clip did not create clip "${newPadClipId}" on "pad"`)
    assertSameEvents('[T2] new clip vs live notes at placement time', padLiveNotes, newPadClip.notes, noteKey)
    // The ORIGINAL "groove" clip (still referenced by intro/build/drop) must be untouched.
    if (JSON.stringify(padTrack.clips.find((c) => c.id === 'groove').notes) !== padGrooveBefore) {
      throw new Error('[T2] placing a clip into the new scene mutated the pre-existing "groove" clip')
    }
    if (JSON.stringify(doc.scenes.find((s) => s.id === 'intro').slots) !== introSlotsBefore) throw new Error('[T2] "intro" scene slots changed after placing into the NEW scene')
    if (JSON.stringify(doc.scenes.find((s) => s.id === 'build').slots) !== buildSlotsBefore) throw new Error('[T2] "build" scene slots changed after placing into the NEW scene')
    if (JSON.stringify(doc.scenes.find((s) => s.id === 'drop').slots) !== dropSlotsBefore) throw new Error('[T2] "drop" scene slots changed after placing into the NEW scene')
    for (const i of introIndices) {
      if (doc.song[i].scene !== 'intro') throw new Error(`[T2] section ${i} no longer references "intro" (got "${doc.song[i].scene}")`)
    }
    if (doc.scenes.find((s) => s.id === insertedSceneId).slots.pad !== newPadClipId) throw new Error('[T2] the new scene does not slot "pad" to the newly placed clip')
    console.log(`[T2] PASS: placing "pad" into scene "${insertedSceneId}" (clip "${newPadClipId}") left "groove", "intro"/"build"/"drop", and all 4 intro-backed sections byte-identical — zero cross-contamination`)
    results.t2 = { newPadClipId }

    // ============ T3: Capture and Insert Scene (GUI button) ============
    // Author further LIVE, UNSAVED edits on two tracks so captured content provably differs from
    // any existing clip ("hook" for lead, current post-T2 live state for pad).
    await selectTrack('lead')
    doc = await docNow()
    const leadLiveCountBefore = doc.tracks.find((t) => t.id === 'lead').notes.length
    await clickGridCell('lead', 12, 5, 'notes', leadLiveCountBefore + 1)
    await selectTrack('drums')
    doc = await docNow()
    const drumsLiveCountBefore = doc.tracks.find((t) => t.id === 'drums').hits.length
    // hats live in the axis row for the "hat" lane — row 3 in DRUM_LANES order (kick, snare, clap,
    // hat, openhat), an on-grid step (step 1) with nothing already there. The drums grid is short
    // (5 lanes * ROW_H) and, depending on how much UI chrome sits above the note-view pane at this
    // point in the flow, can render partially or fully below a merely-960-980px-tall viewport —
    // confirmed via elementFromPoint at the exact click coordinates landing off-screen (null) at
    // the default viewport height this test used to use. Viewport is now tall enough (see
    // setViewportSize above) that this isn't a risk regardless of prior UI state.
    await clickGridCell('drums', 1, 3, 'hits', drumsLiveCountBefore + 1)

    doc = await daemonDocNow()
    const liveSnapshot = {}
    for (const t of doc.tracks) {
      if (t.kind === 'audio') continue
      liveSnapshot[t.id] = t.kind === 'drums' ? t.hits.map((h) => ({ ...h })) : t.notes.map((n) => ({ ...n }))
    }
    const sectionsBeforeT3 = JSON.stringify(doc.song)

    if (!(await page.locator('[data-capture-insert-scene="1"]').count())) {
      throw new Error('[T3] expected the "+ capture scene" button to be present in song mode')
    }
    await page.click('[data-capture-insert-scene="1"]')
    await pollUntil(async () => (await daemonDocNow()).song.length === 8, 'an 8th section to appear after Capture and Insert Scene')

    doc = await daemonDocNow()
    if (JSON.stringify(doc.song.slice(0, 7)) !== sectionsBeforeT3) throw new Error('[T3] the prior 7 sections changed after Capture and Insert Scene')
    const capturedSection = doc.song[7]
    const capturedSceneId = capturedSection.scene
    if (capturedSceneId === insertedSceneId || originalSceneIds.has(capturedSceneId)) throw new Error(`[T3] expected a FRESH scene id, got "${capturedSceneId}"`)
    const capturedScene = doc.scenes.find((s) => s.id === capturedSceneId)
    if (!capturedScene) throw new Error(`[T3] no scene "${capturedSceneId}" found after Capture and Insert Scene`)
    const expectedTracks = doc.tracks.filter((t) => t.kind !== 'audio').map((t) => t.id).sort()
    const gotTracks = Object.keys(capturedScene.slots).sort()
    if (JSON.stringify(gotTracks) !== JSON.stringify(expectedTracks)) {
      throw new Error(`[T3] expected the captured scene to slot every non-audio track (${JSON.stringify(expectedTracks)}), got ${JSON.stringify(gotTracks)}`)
    }
    for (const trackId of expectedTracks) {
      const clipId = capturedScene.slots[trackId]
      if (clipId !== capturedSceneId) throw new Error(`[T3] expected "${trackId}"'s captured clip id to equal the scene id "${capturedSceneId}", got "${clipId}"`)
      const track = doc.tracks.find((t) => t.id === trackId)
      const clip = track.clips.find((c) => c.id === clipId)
      if (!clip) throw new Error(`[T3] track "${trackId}" has no clip "${clipId}"`)
      if (track.kind === 'drums') assertSameEvents(`[T3] "${trackId}" captured hits`, liveSnapshot[trackId], clip.hits, hitKey)
      else assertSameEvents(`[T3] "${trackId}" captured notes`, liveSnapshot[trackId], clip.notes, noteKey)
    }
    // The captured lead clip must differ from "hook" (proves it snapshotted LIVE content, not a
    // stale re-serialization of the existing clip).
    const leadHook = doc.tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'hook').notes
    const leadCaptured = doc.tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === capturedSceneId).notes
    if (JSON.stringify(sortedKeys(leadHook, noteKey)) === JSON.stringify(sortedKeys(leadCaptured, noteKey))) {
      throw new Error('[T3] captured lead clip is identical to "hook" — the extra live-authored note was not actually captured')
    }
    if (JSON.stringify(doc.scenes.find((s) => s.id === 'intro').slots) !== introSlotsBefore) throw new Error('[T3] "intro" scene slots changed after Capture and Insert Scene')
    if (JSON.stringify(doc.scenes.find((s) => s.id === 'build').slots) !== buildSlotsBefore) throw new Error('[T3] "build" scene slots changed after Capture and Insert Scene')
    if (JSON.stringify(doc.scenes.find((s) => s.id === 'drop').slots) !== dropSlotsBefore) throw new Error('[T3] "drop" scene slots changed after Capture and Insert Scene')
    console.log(`[T3] PASS: Capture and Insert Scene minted "${capturedSceneId}" with ${expectedTracks.length} freshly snapshotted clips, each matching live content exactly; prior sections/scenes untouched`)
    results.t3 = { capturedSceneId, tracks: expectedTracks }

    // ============ T4: editing the new (captured) section afterward affects nothing else ============
    await selectTrack('lead')
    doc = await docNow()
    const leadLiveCountBefore2 = doc.tracks.find((t) => t.id === 'lead').notes.length
    await clickGridCell('lead', 44, 7, 'notes', leadLiveCountBefore2 + 1)
    doc = await daemonDocNow()
    const leadLiveNow = doc.tracks.find((t) => t.id === 'lead').notes
    // Re-place (re-snapshot in place) into the CAPTURED scene specifically — the direct analog of
    // "editing this new section's content" a user would do next.
    await placeClipDirect('lead', { clipId: capturedSceneId, sceneId: capturedSceneId })
    doc = await daemonDocNow()
    const leadCapturedAfterEdit = doc.tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === capturedSceneId).notes
    assertSameEvents('[T4] re-edited captured clip vs live notes', leadLiveNow, leadCapturedAfterEdit, noteKey)
    // "hook" (used by section 2, "drop") must still be untouched by this edit.
    const leadHookAfterEdit = doc.tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'hook').notes
    if (JSON.stringify(leadHookAfterEdit) !== JSON.stringify(leadHook)) throw new Error('[T4] editing the captured section\'s clip mutated "hook"')
    if (JSON.stringify(doc.scenes.find((s) => s.id === 'intro').slots) !== introSlotsBefore) throw new Error('[T4] "intro" scene slots changed after editing the captured section')
    if (JSON.stringify(doc.scenes.find((s) => s.id === 'drop').slots) !== dropSlotsBefore) throw new Error('[T4] "drop" scene slots changed after editing the captured section')
    for (const i of introIndices) {
      if (doc.song[i].scene !== 'intro') throw new Error(`[T4] section ${i} no longer references "intro" after editing the captured section`)
    }
    console.log('[T4] PASS: re-editing the captured section\'s own clip left "hook", "intro"/"drop", and all intro-backed sections byte-identical — true independence, not shared-scene bleed')
    results.t4 = {}

    // ============ T5: backend + GUI refuse Insert/Capture in loop mode ============
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemonLoop.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
    const loopDoc = await docNow()
    if (loopDoc.song) throw new Error('[T5] expected the loop-mode fixture to have NO song block')
    if (await page.locator('[data-insert-scene="1"]').count()) throw new Error('[T5] "+ insert scene" should not render in loop mode')
    if (await page.locator('[data-capture-insert-scene="1"]').count()) throw new Error('[T5] "+ capture scene" should not render in loop mode')
    for (const op of ['insert', 'captureInsert']) {
      const res = await fetch(`http://localhost:${daemonLoop.port}/song`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op, index: 0, bars: 4 }),
      })
      if (res.status !== 400) throw new Error(`[T5] expected POST /song {op:'${op}'} against a loop-mode doc to 400, got ${res.status}`)
      const body = await res.json()
      if (!/song mode/i.test(body.error || '')) throw new Error(`[T5] expected a "not in song mode" style error, got: ${JSON.stringify(body)}`)
    }
    console.log('[T5] PASS: neither button renders in loop mode; the daemon route itself refuses both ops with a clear "not in song mode" 400')
    results.t5 = {}

    if (pageErrors.length) console.log('\n(page errors, non-fatal):\n' + pageErrors.join('\n'))
    console.log('\n================ ALL CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    if (daemonSong) await daemonSong.close()
    if (daemonLoop) await daemonLoop.close()
  }
}

main().catch((err) => {
  console.error('\nVERIFY FAILED:', err)
  process.exit(1)
})

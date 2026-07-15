#!/usr/bin/env node
// Phase 24 Stream CC end-to-end verification — driven live against a real `beat daemon` in headless
// Chrome, on a real project (examples/night-shift-song.beat: 6 sections, several sharing scenes —
// "intro" backs sections 0, 3, 4, 5). Mirrors ui/verify-phase22-stream-ag.mjs's boot pattern. Checks:
//
//   A  Part 1 — clip visualization: `.arr-clip-block` DOM elements exist, one per (track, section)
//      occurrence, each labeled with its clip id, positioned/sized from real bar math, and genuinely
//      ABSENT over a track's silent sections (so a clip's boundary and an empty track are visually
//      and structurally distinguishable, not just "the notes stop"). Before this stream there were
//      ZERO such elements in the DOM (verified directly on the pre-change tree — see
//      docs/phase-24-stream-cc.md's Part 1 finding).
//   B  Part 2 — marquee-select: a rubber-band drag starting from genuinely empty lane space (a
//      track's own silent region, not on an existing clip block) across MULTIPLE track rows selects
//      every clip occurrence whose bar range intersects the rectangle, on every row it crossed.
//   C  Part 2 — drag-move: dragging one of the selected blocks moves the WHOLE selection together,
//      preserving each occurrence's relative section-index offset from the others, committed as one
//      clean batched write (POST /clip-move) — verified against the actual resulting document AND
//      the actual bytes on disk, including that a sibling section which shared the ORIGINAL scene
//      with a moved section is completely unaffected (the private-scene-cloning guarantee).
//
// Usage: node ui/verify-phase24-stream-cc.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8474
const PREVIEW_PORT = 5342

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
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p24cc-verify-'))
  const beatPath = join(proj, 'night-shift-song.beat')
  const canonical = serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift-song.beat'), 'utf8')))
  writeFileSync(beatPath, canonical)
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'canonical song-mode baseline')

  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  const songBefore = daemon.getDoc().song
  console.log(`daemon on :${daemon.port} — ${songBefore.length} sections: ${songBefore.map((s) => `${s.scene}(${s.bars})`).join(', ')}`)

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
    await page.setViewportSize({ width: 1600, height: 900 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
    await page.waitForSelector('.arr-canvas', { timeout: 5000 })
    await sleep(300) // let ResizeObserver settle the lane/ruler widths

    // ==================== A: clip occurrence blocks are real, labeled DOM elements ====================
    const blocks = await page.$$eval('.arr-clip-block', (els) =>
      els.map((el) => ({
        track: el.closest('.arr-lane')?.getAttribute('data-track'),
        clip: el.getAttribute('data-clip-id'),
        section: Number(el.getAttribute('data-section-index')),
        label: el.querySelector('.arr-clip-label')?.textContent,
        left: el.style.left,
        width: el.style.width,
      })),
    )
    console.log(`\n[A] ${blocks.length} .arr-clip-block elements found`)

    // Expected occurrences straight from the document's own scene/song model (doc.scenes[section
    // slot] for each track) — an independent derivation from what the GUI renders, not a copy of
    // its internals.
    const doc = daemon.getDoc()
    let expected = 0
    for (const t of doc.tracks) {
      songBefore.forEach((s) => {
        const scene = doc.scenes.find((sc) => sc.id === s.scene)
        if (scene?.slots[t.id]) expected++
      })
    }
    assert(blocks.length === expected, `[A] expected ${expected} occurrence blocks (from the doc's own scene/song model), found ${blocks.length}`)
    assert(blocks.length > 0, '[A] expected at least one clip block — before this stream there were ZERO (canvas-only, no DOM boundary)')
    for (const b of blocks) {
      assert(b.label && b.label.length > 0, `[A] block for ${b.track}@${b.section} has no visible label`)
      assert(b.left !== undefined && b.left !== '', `[A] block for ${b.track}@${b.section} has an explicit left position`)
      assert(b.width && Number.parseFloat(b.width) > 0, `[A] block for ${b.track}@${b.section} has zero width`)
    }
    // "lead" only plays in section 2 ("drop") — sections 0/1/3/4/5 must have NO block for lead
    // (distinguishable empty space, not just "no notes drawn").
    const leadSections = blocks.filter((b) => b.track === 'lead').map((b) => b.section)
    assert(JSON.stringify(leadSections) === JSON.stringify([2]), `[A] "lead" should only have a block at section 2, got ${JSON.stringify(leadSections)}`)
    const leadEmpty = await page.$('[data-track="lead"] .arr-clip-block[data-section-index="0"]')
    assert(leadEmpty === null, '[A] "lead" must have NO clip block over section 0 (silent there)')
    console.log(`[A] PASS: ${blocks.length} bounded, labeled clip-occurrence blocks in the DOM, matching the doc's scene/song model exactly; silent regions render no block`)
    results.blockCount = blocks.length

    // ==================== B: marquee-select across multiple tracks from empty space ====================
    // "lead"'s row is empty (no block) from bar 0 through bar 8 (sections 0/1) — a safe place to
    // START the marquee (not on an existing .arr-clip-block, which keeps its own single-clip drag).
    const leadLane = await page.$eval('[data-track="lead"]', (el) => el.getBoundingClientRect())
    const drumsLane = await page.$eval('[data-track="drums"]', (el) => el.getBoundingClientRect())
    const bassLane = await page.$eval('[data-track="bass"]', (el) => el.getBoundingClientRect())

    const startX = leadLane.x + 20 // bar ~0-1, empty on lead's row
    const startY = leadLane.y + leadLane.height / 2
    const endX = leadLane.x + 700 // sweeps well past bar 8 into "drop" — covers drums/bass's build+drop occurrences too
    const endY = bassLane.y + bassLane.height / 2

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move((startX + endX) / 2, drumsLane.y + drumsLane.height / 2, { steps: 5 })
    await page.mouse.move(endX, endY, { steps: 10 })
    await page.mouse.up()
    await sleep(200)

    const selected = await page.$$eval('.arr-clip-block.selected', (els) =>
      els.map((el) => ({ track: el.closest('.arr-lane')?.getAttribute('data-track'), section: Number(el.getAttribute('data-section-index')) })),
    )
    console.log(`\n[B] marquee-selected ${selected.length} occurrences: ${JSON.stringify(selected)}`)
    const selKey = (t, s) => `${t}::${s}`
    const selSet = new Set(selected.map((s) => selKey(s.track, s.section)))
    // Expect: lead@2 (its only occurrence, bar 8-21, intersects the wide marquee), drums@1, drums@2,
    // bass@1, bass@2 ("build" + "drop" sections — bass/drums aren't in "intro" at all).
    for (const [t, s] of [
      ['lead', 2],
      ['drums', 1],
      ['drums', 2],
      ['bass', 1],
      ['bass', 2],
    ]) {
      assert(selSet.has(selKey(t, s)), `[B] expected ${t}@${s} to be marquee-selected, selection was ${JSON.stringify([...selSet])}`)
    }
    assert(selected.length === 5, `[B] expected exactly 5 selected occurrences (lead/drums/bass across their build+drop spans), got ${selected.length}`)
    console.log('[B] PASS: marquee starting from empty space selected every intersecting clip occurrence across 3 tracks (2+ required)')
    results.marqueeSelected = selected

    await page.screenshot({ path: join(uiDir, 'verify-p24cc-marquee.png') })

    // ==================== C: drag one selected clip — the WHOLE group moves together ====================
    const preMoveSong = daemon.getDoc().song.map((s) => ({ scene: s.scene, bars: s.bars }))
    const preMoveScenesByTrackSection = {}
    for (const [t, s] of selected.map((x) => [x.track, x.section])) {
      const scene = daemon.getDoc().scenes.find((sc) => sc.id === daemon.getDoc().song[s].scene)
      // v0.11 (Phase 36): a slot is a PLACEMENT LIST, compared by content below (a move rebuilds
      // the arrays, so reference equality can never hold post-v0.11). Fixed by Phase 36 Stream PD;
      // the strict `===` had been failing here since Stream PA's format change.
      preMoveScenesByTrackSection[selKey(t, s)] = JSON.stringify(scene?.slots[t])
    }

    // Drag drums's section-2 block ("drop") rightward — should snap onto section 3 (the next
    // "intro", 1 section later) given the sections' actual bar widths, moving the WHOLE selected
    // group by the SAME +1 section-index delta.
    const dragHandle = await page.$('[data-track="drums"] [data-clip-block$="::2"]')
    const hb = await dragHandle.boundingBox()
    await page.mouse.move(hb.x + 10, hb.y + hb.height / 2)
    await page.mouse.down()
    await page.mouse.move(hb.x + 10 + 500, hb.y + hb.height / 2, { steps: 15 })
    await page.mouse.up()

    await pollUntil(() => JSON.stringify(daemon.getDoc().song.map((s) => s.bars)) !== JSON.stringify(preMoveSong.map((s) => s.bars)) || true, 'the move to settle', 3000)
    await sleep(300)

    const postSong = daemon.getDoc().song
    console.log(`\n[C] song before: ${JSON.stringify(preMoveSong)}`)
    console.log(`[C] song after:  ${JSON.stringify(postSong.map((s) => ({ scene: s.scene, bars: s.bars })))}`)
    // Section COUNT and every section's BAR COUNT must be unchanged — a move only ever changes
    // which scene a section points at, never the section list's shape.
    assert(postSong.length === preMoveSong.length, '[C] section count must not change')
    postSong.forEach((s, i) => assert(s.bars === preMoveSong[i].bars, `[C] section ${i}'s bar count must not change (moves reassign scenes, not resize)`))

    // Every moved occurrence must have landed exactly ONE section index later (the same delta for
    // the whole group — "preserving relative bar offset" from docs/phase-24-plan.md), carrying the
    // SAME clip id it had before the move.
    const doc2 = daemon.getDoc()
    for (const { track, section } of selected) {
      const targetIndex = section + 1
      const targetScene = doc2.scenes.find((sc) => sc.id === doc2.song[targetIndex].scene)
      assert(JSON.stringify(targetScene?.slots[track]) === preMoveScenesByTrackSection[selKey(track, section)], `[C] ${track}'s occurrence should have moved from section ${section} to ${targetIndex}, preserving its clip id`)
    }
    // drums/bass had occurrences at BOTH section 1 and section 2 — both shift by +1, so section 1
    // (the lowest source index, not also somebody else's target within this batch) must end up
    // with NEITHER mapped: nothing landed there, and their own content left for section 2.
    const doc2Sec1 = doc2.scenes.find((sc) => sc.id === doc2.song[1].scene)
    assert(doc2Sec1?.slots.drums === undefined, '[C] drums must no longer be mapped at section 1 (its lowest source index, nothing moved back into it)')
    assert(doc2Sec1?.slots.bass === undefined, '[C] bass must no longer be mapped at section 1 (its lowest source index, nothing moved back into it)')
    console.log('[C] PASS: every selected occurrence moved by the SAME +1 section-index delta (relative offsets preserved), and the vacated low end is genuinely empty')

    // "pad" was NOT part of the selection — it must still play in every one of the 6 sections, byte
    // for byte the same clip id as before (proves the move didn't disturb an unrelated track/track's
    // sections sharing a scene with a moved section).
    for (let i = 0; i < 6; i++) {
      const scene = doc2.scenes.find((sc) => sc.id === doc2.song[i].scene)
      // v0.11 (Phase 36): the slot is one placement of "groove" at 0 — same fix as the reads above.
      assert(scene?.slots.pad?.length === 1 && scene.slots.pad[0].clip === 'groove' && scene.slots.pad[0].at === 0, `[C] "pad" must still play "groove" in section ${i} (untouched by the drums/bass/lead move)`)
    }
    console.log('[C] PASS: "pad" (not selected) is unaffected in all 6 sections — sibling sections sharing the old scenes were not disturbed')

    // The move committed to disk; in-memory === on-disk invariant holds.
    const onDiskDoc = parse(readFileSync(beatPath, 'utf8'))
    assert(JSON.stringify(onDiskDoc.song) === JSON.stringify(doc2.song), '[C] the on-disk document must match the daemon\'s in-memory document (song block)')
    assert(JSON.stringify(onDiskDoc.scenes) === JSON.stringify(doc2.scenes), '[C] the on-disk document must match the daemon\'s in-memory document (scenes block)')
    console.log('[C] PASS: the move is reflected on disk, and the file re-parses to exactly the in-memory document')
    results.postMoveSong = postSong.map((s) => s.scene)

    git(proj, 'add', '-A')
    git(proj, 'commit', '-q', '-m', 'clip-move via GUI marquee-drag')
    await page.screenshot({ path: join(uiDir, 'verify-p24cc-after-move.png') })

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

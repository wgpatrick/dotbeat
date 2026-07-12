#!/usr/bin/env node
// Phase 23 Stream BB — "GUI completion bundle: drum lanes, mixer, presets, vary" — end-to-end,
// driven headlessly against a REAL `beat daemon` on a real git-backed project. Every check reads
// the actual .beat file on disk (not just in-memory store state), same discipline as the Phase 15/
// 22 verify scripts this one is modeled on.
//
//   L1  Lanes panel: a legacy drum track (no `lanes` declared) shows "implicit 5-lane kit"; clicking
//       "Enable lane editing" (materializeLanes) writes 5 real `lane <name> synth:...` lines.
//   L2  Add Lane: a brand-new declared lane ("extra1", synth:noise) writes a `lane extra1 synth:noise`
//       line and gets its own row/gutter entry in the Clip View.
//   L3  Move: the ▲ button reorders the declared lane list — the file's `lane` line ORDER changes.
//   L4  Per-param edit: typing into the kick lane's "tune" field writes `lane kick synth:membrane
//       tune=<x>` (a fine-grained edit, not a whole-kit replace).
//   L5  A sample registered into the project via the Phase 22 content-browser drag (kit-init's kick,
//       proven mechanism) becomes selectable in the NEW lane's retype-to-sample control — retyping
//       "extra1" to that sample writes `lane extra1 sample kit-init-kick <gain> <tune>`. This is the
//       real, honest composition of the two features (dragging a one-shot straight onto a brand-new
//       custom lane isn't wired — see the phase doc's honest-gaps section).
//   L6  Remove: the lane disappears from the file and the Clip View gutter.
//   L7  Hot-swap preset browser (Device View, SynthPanel): applying a preset from the in-panel
//       picker changes the track's live params and writes literal param lines (no "preset" keyword).
//   L8  Hot-swap soundfont browser (Device View, InstrumentPanel): swapping banks from the in-panel
//       picker reassigns instrument.sample and writes a real, persisted diff.
//   L9  Rung-2 "feel" vary/audition: selecting the drums track reveals "≈ vary feel"; auditioning
//       previews humanized (off-grid) hit timings live; Keep writes exactly the audited variant.
//   L10 Mixer mute/solo stays transient by design: toggling mute changes store/engine state but
//       leaves the .beat file byte-identical — proving the phase-23-stream-bb.md decision is honored.
//
// Usage: node ui/verify-phase23-bb.mjs

import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8823
const PREVIEW_PORT = 5951

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
const selectTrack = (page, name) => page.click(`.arr-row:has(.arr-track-name:text-is("${name}")) .arr-track-select`)
const trackHeaderSel = (name) => `.arr-row:has(.arr-track-name:text-is("${name}")) [data-drop-target="track-header"]`
const laneLine = (text, name) => text.split('\n').find((l) => l.trim().startsWith(`lane ${name} `))

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p23bb-'))
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

    // Open the drums track's Clip View — the Lanes panel lives at the top of NoteView for drum tracks.
    await selectTrack(page, 'drums')
    await pollUntil(() => page.evaluate(() => window.__store.getState().doc.selectedTrack === 'drums'), 'drums selection')
    await page.click('[data-pane-tab="clip"]')
    await page.waitForSelector('[data-testid="lane-panel"]', { timeout: 5000 })

    // ============ L1: materialize a legacy 5-lane kit into the open lane model ============
    let before = readFileSync(beatPath, 'utf8')
    const lanesBefore = await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'drums').lanes.length)
    if (lanesBefore !== 0) throw new Error(`[L1] expected night-shift's drums track to start legacy (lanes: []), got ${lanesBefore}`)
    await page.click('[data-lane-materialize]')
    await pollUntil(
      () => page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'drums').lanes.length === 5),
      'materializeLanes to land 5 declared lanes',
    )
    let after = readFileSync(beatPath, 'utf8')
    if (after === before) throw new Error('[L1] .beat file did not change after materializing lanes')
    for (const name of ['kick', 'snare', 'clap', 'hat', 'openhat']) {
      if (!laneLine(after, name)) throw new Error(`[L1] expected a "lane ${name} ..." line, file:\n${after}`)
    }
    console.log('[L1] PASS: "Enable lane editing" wrote 5 real `lane <name> synth:...` declarations')
    results.l1 = { lanesWritten: 5 }

    // ============ L2: add a brand-new declared lane ============
    before = readFileSync(beatPath, 'utf8')
    await page.fill('[data-lane-add-name]', 'extra1')
    await page.selectOption('[data-lane-add-voice]', 'noise')
    await page.click('[data-lane-add-submit]')
    await pollUntil(
      () => page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'drums').lanes.some((l) => l.name === 'extra1')),
      '"extra1" lane to appear',
    )
    after = readFileSync(beatPath, 'utf8')
    const l2Line = laneLine(after, 'extra1')
    if (!l2Line || !l2Line.includes('synth:noise')) throw new Error(`[L2] expected "lane extra1 synth:noise", got: ${l2Line}`)
    await page.waitForSelector('[data-row-value="extra1"]', { timeout: 5000 }) // a real gutter row in the note editor
    console.log(`[L2] PASS: Add Lane wrote "${l2Line.trim()}" and the Clip View gained an "extra1" row`)
    results.l2 = { line: l2Line.trim() }

    // ============ L3: reorder — move extra1 to the top ============
    before = readFileSync(beatPath, 'utf8')
    const orderBefore = before.split('\n').filter((l) => l.trim().startsWith('lane ')).map((l) => l.trim().split(/\s+/)[1])
    await page.click('[data-lane-move-up="extra1"]')
    await pollUntil(
      () => page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'drums').lanes[4].name === 'extra1'),
      'extra1 to move up one slot (index 5 -> 4)',
    )
    after = readFileSync(beatPath, 'utf8')
    const orderAfter = after.split('\n').filter((l) => l.trim().startsWith('lane ')).map((l) => l.trim().split(/\s+/)[1])
    if (JSON.stringify(orderAfter) === JSON.stringify(orderBefore)) throw new Error('[L3] lane declaration order did not change in the file')
    if (orderAfter[4] !== 'extra1' || orderAfter[5] !== 'openhat') throw new Error(`[L3] expected extra1 before openhat, got order: ${orderAfter}`)
    console.log(`[L3] PASS: moving extra1 up changed the file's own \`lane\` line order: ${orderBefore.join(',')} -> ${orderAfter.join(',')}`)
    results.l3 = { before: orderBefore, after: orderAfter }

    // ============ L4: fine-grained per-param edit on an existing lane ============
    await page.click('[data-lane-edit-toggle="kick"]')
    await page.waitForSelector('[data-lane-param="kick.tune"]', { timeout: 3000 })
    before = readFileSync(beatPath, 'utf8')
    await page.fill('[data-lane-param="kick.tune"]', '55')
    await page.locator('[data-lane-param="kick.tune"]').blur()
    await pollUntil(
      () => page.evaluate(() => {
        const kick = window.__store.getState().doc.tracks.find((t) => t.id === 'drums').lanes.find((l) => l.name === 'kick')
        return kick.backing.params.tune === 55
      }),
      'kick lane tune to update to 55',
    )
    after = readFileSync(beatPath, 'utf8')
    const kickLine = laneLine(after, 'kick')
    if (!/tune=55/.test(kickLine)) throw new Error(`[L4] expected "tune=55" on the kick lane line, got: ${kickLine}`)
    console.log(`[L4] PASS: editing the kick lane's tune field wrote "${kickLine.trim()}" (a fine-grained param edit, not a whole-kit replace)`)
    results.l4 = { line: kickLine.trim() }

    // ============ L5: register a sample via the (already-verified, Phase 22) content-browser drag,
    // then point the NEW custom lane at it via the retype-to-sample control ============
    await page.click('[data-action="toggle-library"]')
    await page.waitForSelector('[data-testid="content-browser"]', { timeout: 5000 })
    await pollUntil(async () => (await count(page, '.lib-row')) > 0, 'library catalog to load')
    before = readFileSync(beatPath, 'utf8')
    await page.dragAndDrop('[data-kit="kit-init"][data-lane="kick"]', '[data-drop-target="lane-kick"]')
    await pollUntil(
      () => page.evaluate(() => window.__store.getState().doc.media.some((m) => m.id === 'kit-init-kick')),
      'kit-init-kick to register into the project media',
    )
    after = readFileSync(beatPath, 'utf8')
    if (after === before) throw new Error('[L5a] .beat file did not change after registering the kit sample')
    console.log('[L5a] setup: kit-init-kick is now a registered sample in this project (reusing Phase 22 Stream AH\'s drag mechanism)')

    await page.click('[data-action="toggle-library"]') // close the rail so it doesn't cover the panel
    await page.click('[data-lane-edit-toggle="extra1"]')
    await page.waitForSelector('[data-lane-retype="extra1"]', { timeout: 3000 })
    before = readFileSync(beatPath, 'utf8')
    await page.selectOption('[data-lane-retype="extra1"]', 'sample')
    await pollUntil(
      () => page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'drums').lanes.find((l) => l.name === 'extra1').backing.type === 'sample'),
      'extra1 to retype to a sample backing',
    )
    await page.waitForSelector('[data-lane-sample="extra1"]', { timeout: 3000 })
    await page.selectOption('[data-lane-sample="extra1"]', 'kit-init-kick')
    await pollUntil(
      () => page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'drums').lanes.find((l) => l.name === 'extra1').backing.sample === 'kit-init-kick'),
      'extra1 to point at kit-init-kick',
    )
    after = readFileSync(beatPath, 'utf8')
    const l5Line = laneLine(after, 'extra1')
    if (!l5Line || !l5Line.includes('sample kit-init-kick')) throw new Error(`[L5b] expected "lane extra1 sample kit-init-kick ...", got: ${l5Line}`)
    console.log(`[L5b] PASS: retyping "extra1" to a sample backing and picking kit-init-kick wrote "${l5Line.trim()}"`)
    results.l5 = { line: l5Line.trim() }

    // ============ L6: remove the custom lane ============
    before = readFileSync(beatPath, 'utf8')
    await page.click('[data-lane-remove="extra1"]')
    await pollUntil(
      () => page.evaluate(() => !window.__store.getState().doc.tracks.find((t) => t.id === 'drums').lanes.some((l) => l.name === 'extra1')),
      'extra1 to be removed',
    )
    after = readFileSync(beatPath, 'utf8')
    if (after === before) throw new Error('[L6] .beat file did not change after removing the lane')
    if (laneLine(after, 'extra1')) throw new Error('[L6] "lane extra1 ..." line still present after removal')
    if ((await count(page, '[data-row-value="extra1"]')) !== 0) throw new Error('[L6] extra1 row still present in the Clip View gutter')
    console.log('[L6] PASS: removing the lane dropped its file line and its Clip View row')
    results.l6 = 'removed'

    // ============ L7: hot-swap preset browser INSIDE Device View (SynthPanel) ============
    await selectTrack(page, 'bass')
    await pollUntil(() => page.evaluate(() => window.__store.getState().doc.selectedTrack === 'bass'), 'bass selection')
    await page.click('[data-pane-tab="device"]')
    await page.waitForSelector('[data-testid="preset-picker"]', { timeout: 5000 })
    await pollUntil(async () => (await page.$('[data-preset-select] option')) !== null, 'preset picker to load options')
    before = readFileSync(beatPath, 'utf8')
    await page.selectOption('[data-preset-select]', 'deep-sub-bass')
    await pollUntil(
      () => page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'bass')?.synth.subLevel === 0.6),
      'bass to pick up deep-sub-bass params via the in-panel picker',
    )
    after = readFileSync(beatPath, 'utf8')
    if (after === before) throw new Error('[L7] .beat file did not change after applying a preset from the Device View picker')
    if (/\bpreset\b/.test(after)) throw new Error('[L7] file references a "preset" keyword — must land as literal params')
    if (!after.split('\n').some((l) => l.trim() === 'subLevel 0.6')) throw new Error('[L7] expected a literal "subLevel 0.6" line')
    console.log('[L7] PASS: applying "deep-sub-bass" from INSIDE the SynthPanel wrote literal params, no leaving Device View')
    results.l7 = { subLevel: 0.6 }

    // ============ L8: hot-swap soundfont browser INSIDE Device View (InstrumentPanel) ============
    // Mint an instrument track first (Phase 22 Stream AH's own "+" mechanism), then swap its bank
    // from inside InstrumentPanel — the NEW affordance this stream adds.
    await page.click('[data-action="toggle-library"]')
    await page.waitForSelector('[data-testid="content-browser"]', { timeout: 5000 })
    const tracksBefore = await page.evaluate(() => window.__store.getState().doc.tracks.length)
    await page.click('[data-soundfont="upright-piano-kw-small.sf2"] [data-action="add-instrument-track"]')
    await pollUntil(
      () => page.evaluate((n) => window.__store.getState().doc.tracks.length > n, tracksBefore),
      'a new instrument track to appear',
    )
    const instTrackId = await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.kind === 'instrument').id)
    await page.click('[data-action="toggle-library"]')
    await selectTrack(page, instTrackId)
    await pollUntil(() => page.evaluate((id) => window.__store.getState().doc.selectedTrack === id, instTrackId), 'new instrument track selection')
    await page.click('[data-pane-tab="device"]')
    await page.waitForSelector('[data-testid="soundfont-picker"]', { timeout: 5000 })
    await pollUntil(async () => (await count(page, '[data-soundfont-select] option')) >= 2, 'soundfont picker to load >= 2 banks')
    before = readFileSync(beatPath, 'utf8')
    await page.selectOption('[data-soundfont-select]', 'fluidr3-gm-small.sf2')
    await pollUntil(
      () => page.evaluate((id) => window.__store.getState().doc.tracks.find((t) => t.id === id)?.instrument?.sample === 'fluidr3-gm-small', instTrackId),
      'instrument track to pick up the swapped bank',
    )
    after = readFileSync(beatPath, 'utf8')
    if (after === before) throw new Error('[L8] .beat file did not change after swapping the soundfont from the Device View picker')
    console.log(`[L8] PASS: swapping "${instTrackId}"'s bank from INSIDE InstrumentPanel wrote a real, persisted change`)
    results.l8 = { track: instTrackId, sample: 'fluidr3-gm-small' }

    // ============ L9: rung-2 "feel" vary/audition (VaryAffordance.tsx) ============
    // clickHeader (bound to .arr-track-select's onClick) sets BOTH the bottom-pane selection and the
    // D2 pointing selection VaryAffordance reads — selectTrack() alone covers both.
    await selectTrack(page, 'drums')
    await pollUntil(() => page.evaluate(() => window.__store.getState().selection.tracks?.includes('drums')), 'drums pointing selection to post')
    await page.waitForSelector('.vary-btn.trigger:has-text("vary feel")', { timeout: 5000 })
    const gridOriginal = await page.evaluate(() =>
      window.__store.getState().doc.tracks.find((t) => t.id === 'drums').hits.every((h) => Number.isInteger(h.start)),
    )
    if (!gridOriginal) throw new Error('[L9] expected the original drums hits to be on-grid integers before varying')
    await page.click('.vary-btn.trigger:has-text("vary feel")')
    await page.waitForSelector('.vary-bar.auditioning', { timeout: 8000 })
    const auditioned = await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'drums').hits.some((h) => !Number.isInteger(h.start)))
    if (!auditioned) throw new Error('[L9] feel variant did not humanize any hit off-grid — not genuinely applied')
    console.log('[L9a] PASS: "≈ vary feel" auditions a genuinely humanized (off-grid) variant, live')
    await page.click('.vary-btn:has-text("Next")')
    // Sort by id before comparing: the in-memory (store) array keeps humanize's own order, while a
    // written-then-reparsed doc comes back in serialize.ts's canonical (start, lane, id) order — same
    // hits, legitimately different array order (see test/daemon.test.ts's withSortedHits).
    const byId = (hits) => hits.map((h) => `${h.id}:${h.start}`).sort().join('|')
    const auditedById = await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'drums').hits.map((h) => `${h.id}:${h.start}`).sort().join('|'))
    before = readFileSync(beatPath, 'utf8')
    await page.click('.vary-btn.keep')
    await pollUntil(() => readFileSync(beatPath, 'utf8') !== before, 'Keep to write the feel variant to disk')
    after = readFileSync(beatPath, 'utf8')
    const diskById = byId(parse(after).tracks.find((t) => t.id === 'drums').hits)
    if (diskById !== auditedById) throw new Error(`[L9b] disk hits != the audited variant's hits\n  disk: ${diskById}\n  audited: ${auditedById}`)
    if (!after.split('\n').some((l) => l.trim().startsWith('hit ') && !/^hit \S+ \S+ \d+ /.test(l.trim())))
      throw new Error('[L9b] expected at least one hit line with a non-integer start on disk')
    console.log('[L9b] PASS: Keep wrote EXACTLY the audited feel variant to disk (humanized starts match, byte for byte)')
    results.l9 = { keptHitsSample: diskById.split('|').slice(0, 6) }

    // ============ L10: mixer mute/solo — confirmed transient, never touches the file ============
    before = readFileSync(beatPath, 'utf8')
    await page.click('[data-mute="bass"]')
    await pollUntil(() => page.evaluate(() => window.__store.getState().mutes.bass === true), 'bass mute to flip on in the store')
    await sleep(150) // give any (incorrect) write a moment to land, if one existed
    after = readFileSync(beatPath, 'utf8')
    if (after !== before) throw new Error('[L10] toggling mute wrote to the .beat file — mute/solo must stay transient by design')
    console.log('[L10] PASS: toggling mute updates store/engine state and leaves the .beat file byte-identical (the deliberate decision, honored)')
    results.l10 = 'transient, confirmed'

    await page.screenshot({ path: join(uiDir, 'verify-p23bb.png') })
    console.log('screenshot -> ui/verify-p23bb.png')

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

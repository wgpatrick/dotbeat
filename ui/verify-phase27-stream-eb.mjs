#!/usr/bin/env node
// Phase 27 Stream EB — shared drag-state / drop-highlight primitive (docs/phase-27-plan.md, docs/
// research/74-ux-drag-and-drop.md). Drives the REAL frontend headlessly against a REAL `beat
// daemon` on a disposable copy of examples/night-shift.beat (never the owner's own
// examples/night-shift-song.beat) and asserts on real rendered DOM/CSS state — computed styles,
// class presence, not just that a postEdit fired.
//
//   EB1 THE ACTUAL BUG FIX (research/74 §3.1, phase-27-plan.md bug 5): ArrangementView.tsx's
//       track-header drop-target highlight used to flicker off the instant the cursor crossed from
//       the header's own background onto ANY of its densely packed interactive children (mute/solo/
//       vol/pan controls, swatch, rename/delete buttons) because `onDragLeave` was a bare boolean
//       with no `relatedTarget` check. Simulates that exact sequence — dragover the header, then
//       dragleave-with-relatedTarget=child for five different real children in turn — and asserts
//       the `.drop-target-hover` class survives every single crossing, only clearing on a genuine
//       exit. Then completes a real drop and confirms it actually applied (a real .beat file diff).
//   EB2 The SAME `.drop-target-hover` class (not a hardcoded `#2f5d3a` inline fill) now lights up
//       NoteView.tsx's drum-lane drop target too — one shared class name across two independent
//       components, not two independent inventions of the same idea.
//   EB3 The piano-roll note/hit drag — research/74 §3.2's "zero visual distinction between static
//       and dragging" finding — now gets a real `.dragging` class mid-gesture, with a real
//       accent-colored outline a live `getComputedStyle` can see, clearing again on release.
//   EB4 CSSOM inspection: `.dragging` and `.drop-target-hover` are each defined ONCE in the
//       stylesheet; every other drag surface (`.effect-row.dragging`, `.arr-section-chip.dragging`,
//       `.arr-clip-block.dragging`) composes with that one shared rule (no redeclared `opacity`) —
//       and `.noteview-note` has no bespoke `.dragging` override at all, meaning the piano roll's
//       new dragging state is a pure reuse of the primitive, not a fifth one-off treatment.
//
// Usage: node ui/verify-phase27-stream-eb.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8501
const PREVIEW_PORT = 5331
const MIME = 'application/x-dotbeat-library-item'

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

const trackHeaderSel = (name) => `.arr-row:has(.arr-track-name:text-is("${name}")) [data-drop-target="track-header"]`
const selectTrack = (page, name) => page.click(`.arr-row:has(.arr-track-name:text-is("${name}")) .arr-track-select`)

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p27eb-'))
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

    // ============ EB1: track-header dragleave-on-child-crossing bug is fixed ============
    await page.waitForSelector(trackHeaderSel('bass'), { timeout: 5000 })
    const headerSel = trackHeaderSel('bass')
    const crossingSteps = await page.$eval(
      headerSel,
      async (header, { mime, childSelectors }) => {
        const dt = new DataTransfer()
        dt.setData(mime, JSON.stringify({ type: 'preset', name: 'deep-sub-bass', kind: 'synth' }))
        // React 18 treats drag events as "continuous" priority, so a state update they trigger
        // isn't guaranteed to be committed to the DOM synchronously the instant dispatchEvent()
        // returns — yield a real animation frame after each dispatch before reading classList, so
        // this test observes what actually renders, not a stale pre-flush snapshot.
        const tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        const fire = async (type, target, related) => {
          target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, relatedTarget: related ?? null }))
          await tick()
        }

        const steps = []
        // Enter the header itself first (bare background, the ~200px^2 sliver research/74 found).
        await fire('dragover', header, null)
        steps.push({ step: 'dragover header background', hasClass: header.classList.contains('drop-target-hover') })

        // Cross onto each of several real, densely packed interactive children in turn — this is
        // EXACTLY the research/74 §3.1 scenario: a cursor arriving at the header from below crosses
        // the InlineStrip's mute/solo controls, the color swatch, etc. before settling.
        for (const sel of childSelectors) {
          const child = header.querySelector(sel)
          if (!child) {
            steps.push({ step: `(missing child ${sel})`, hasClass: null })
            continue
          }
          // The browser fires dragleave on the previously-hovered element (header) with
          // relatedTarget = the element now being entered (the child) when the cursor moves from
          // the header's own background onto a nested child.
          await fire('dragleave', header, child)
          steps.push({ step: `dragleave header -> ${sel}`, hasClass: header.classList.contains('drop-target-hover') })
          // Then dragenter/dragover the child itself (bubbles up through header too).
          await fire('dragover', child, null)
          steps.push({ step: `dragover ${sel}`, hasClass: header.classList.contains('drop-target-hover') })
        }

        // Sanity check the OTHER direction still works: actually leaving the header entirely (to
        // something outside it) DOES clear the highlight — the fix isn't "never clears."
        await fire('dragleave', header, document.body)
        steps.push({ step: 'dragleave header -> document.body (real exit)', hasClass: header.classList.contains('drop-target-hover') })

        return steps
      },
      { mime: MIME, childSelectors: ['.arr-track-swatch', '[data-mute]', '[data-solo]', '[data-vol]', '[data-pan]', '.arr-track-del'] },
    )
    console.log('[EB1] crossing sequence:\n' + crossingSteps.map((s) => `  ${s.hasClass === true ? 'HELD ' : s.hasClass === false ? 'CLEAR' : '  ?  '} — ${s.step}`).join('\n'))
    const missingChild = crossingSteps.find((s) => s.step.startsWith('(missing child'))
    if (missingChild) throw new Error(`[EB1] test setup problem, not the bug under test: ${missingChild.step} — fix the selector`)
    const flickered = crossingSteps.slice(0, -1).some((s) => s.hasClass === false)
    if (flickered) throw new Error(`[EB1] the drop-target highlight flickered off while crossing a child — the bug is NOT fixed:\n${JSON.stringify(crossingSteps, null, 2)}`)
    if (crossingSteps[crossingSteps.length - 1].hasClass !== false) throw new Error('[EB1] a genuine exit (relatedTarget outside the header) should still clear the highlight')
    console.log('[EB1] PASS: the drop-target highlight survives crossing 5 real interactive children (swatch, mute, solo, vol, pan, delete) and only clears on a real exit')

    // Complete a real drop on the same header and confirm it actually applied (not just visual).
    const before = readFileSync(beatPath, 'utf8')
    await page.$eval(
      headerSel,
      (header, mime) => {
        const dt = new DataTransfer()
        dt.setData(mime, JSON.stringify({ type: 'preset', name: 'deep-sub-bass', kind: 'synth' }))
        header.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
        header.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
      },
      MIME,
    )
    await pollUntil(
      () => page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'bass')?.synth.subLevel === 0.6),
      'bass track to pick up deep-sub-bass params after the simulated drop',
    )
    const after = readFileSync(beatPath, 'utf8')
    if (after === before) throw new Error('[EB1] the simulated drop did not write to the .beat file — the drop handler itself broke')
    const headerHasClassAfterDrop = await page.$eval(headerSel, (h) => h.classList.contains('drop-target-hover'))
    if (headerHasClassAfterDrop) throw new Error('[EB1] the highlight should clear once the drop completes')
    console.log('[EB1] PASS: the drop itself still works (bass track picked up deep-sub-bass params, real .beat diff) and the highlight clears on drop')
    results.eb1 = { crossingSteps: crossingSteps.length, dropApplied: true }

    // ============ EB2: NoteView's drum-lane row shares the SAME .drop-target-hover class ============
    await selectTrack(page, 'drums')
    await pollUntil(() => page.evaluate(() => window.__store.getState().doc.selectedTrack === 'drums'), 'drums selection')
    await page.click('[data-pane-tab="clip"]')
    await page.waitForSelector('[data-testid="bottom-pane"] .noteview[data-event-kind="hit"]', { timeout: 5000 })
    await page.waitForSelector('[data-drop-target="lane-kick"]', { timeout: 5000 })
    const laneResult = await page.$eval(
      '[data-drop-target="lane-kick"]',
      async (row, mime) => {
        const tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        const dt = new DataTransfer()
        dt.setData(mime, JSON.stringify({ type: 'kit-lane', kit: 'kit-init', lane: 'kick' }))
        row.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
        await tick()
        const duringHover = { hasClass: row.classList.contains('drop-target-hover'), outlineStyle: getComputedStyle(row).outlineStyle }
        row.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, dataTransfer: dt, relatedTarget: document.body }))
        await tick()
        const afterLeave = { hasClass: row.classList.contains('drop-target-hover') }
        return { duringHover, afterLeave }
      },
      MIME,
    )
    if (!laneResult.duringHover.hasClass) throw new Error(`[EB2] drum-lane row should get .drop-target-hover during a valid dragover: ${JSON.stringify(laneResult)}`)
    if (laneResult.duringHover.outlineStyle !== 'dashed') throw new Error(`[EB2] expected the shared dashed-outline treatment, got outlineStyle=${laneResult.duringHover.outlineStyle}`)
    if (laneResult.afterLeave.hasClass) throw new Error('[EB2] the highlight should clear once the drag genuinely leaves the row')
    console.log('[EB2] PASS: NoteView\'s drum-lane row now uses the SAME .drop-target-hover class ArrangementView\'s track header uses (was a hardcoded #2f5d3a inline fill)')
    results.eb2 = laneResult

    // ============ EB3: piano-roll note/hit drag now has a real "currently dragging" visual ============
    // Melodic notes (not drum-hit markers): a marker is only MARKER_W=7px wide with a 5px-wide
    // `.noteview-resize` handle pinned to its right edge, leaving almost no safe "grab the body, not
    // the resize handle" area to click. A real note (has a duration) renders many pixels wide, so
    // there's plenty of room to click near its left edge and reliably get the MOVE gesture.
    await selectTrack(page, 'bass')
    await pollUntil(() => page.evaluate(() => window.__store.getState().doc.selectedTrack === 'bass'), 'bass selection')
    await page.click('[data-pane-tab="clip"]')
    await page.waitForSelector('[data-testid="bottom-pane"] .noteview[data-event-kind="note"]', { timeout: 5000 })
    const firstHit = await page.$eval('.noteview-note[data-note-id]:not(.marker)', (el) => el.getAttribute('data-note-id'))
    const noteSel = `.noteview-note[data-note-id="${firstHit}"]`
    await page.locator(noteSel).scrollIntoViewIfNeeded()
    const box = await page.locator(noteSel).boundingBox()
    if (!box) throw new Error('[EB3] could not locate a note element to drag')
    const classBefore = await page.$eval(noteSel, (el) => el.className)
    if (classBefore.includes('dragging')) throw new Error('[EB3] a note should not carry .dragging before any gesture starts')
    const startBefore = await page.evaluate(
      (id) => window.__store.getState().doc.tracks.find((t) => t.id === 'bass')?.notes.find((n) => n.id === id)?.start,
      firstHit,
    )

    // Click near the left edge (well clear of the resize handle at the right edge) and drag right.
    await page.mouse.move(box.x + 3, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 3 + 70, box.y + box.height / 2, { steps: 8 })
    const midDrag = await page.$eval(noteSel, (el) => {
      const cs = getComputedStyle(el)
      return { className: el.className, boxShadow: cs.boxShadow }
    })
    await page.mouse.up()
    const classAfter = await page.$eval(noteSel, (el) => el.className)

    if (!midDrag.className.includes('dragging')) throw new Error(`[EB3] the dragged note should carry .dragging mid-gesture, got className="${midDrag.className}"`)
    // startGesture selects an unselected note before dragging it, so THIS is also the realistic
    // "selected AND dragging" case — the exact combination that exposed a real bug while building
    // this test: .noteview-note.selected's own `outline: 1px solid #fff` has higher CSS specificity
    // than a bare `.dragging` class and would silently mask an outline-based signal, leaving a
    // dragged note with NO visible cue at all. The shared .dragging rule signals via `box-shadow`
    // instead specifically so it survives that combination.
    if (!midDrag.className.includes('selected')) throw new Error(`[EB3] test setup problem: expected startGesture to auto-select the note, got className="${midDrag.className}"`)
    if (!midDrag.boxShadow.includes('224, 161, 60')) throw new Error(`[EB3] expected the shared .dragging box-shadow (accent #e0a13c = rgb(224, 161, 60)) to render even while also .selected, got boxShadow="${midDrag.boxShadow}"`)
    if (classAfter.includes('dragging')) throw new Error(`[EB3] .dragging should clear once the gesture commits, got className="${classAfter}"`)
    console.log(`[EB3] PASS: research/74 §3.2 found ZERO visual distinction for a dragged note — it now carries .dragging mid-gesture with a real accent box-shadow even while selected (${JSON.stringify(midDrag)}), clearing on release`)
    results.eb3 = midDrag

    const startAfter = await pollUntil(
      async () => {
        const v = await page.evaluate(
          (id) => window.__store.getState().doc.tracks.find((t) => t.id === 'bass')?.notes.find((n) => n.id === id)?.start,
          firstHit,
        )
        return v !== startBefore ? v : undefined
      },
      `note "${firstHit}" to actually move (start !== ${startBefore})`,
      3000,
    )
    console.log(`[EB3] PASS: note "${firstHit}" start moved ${startBefore} -> ${startAfter} — the gesture itself still works, not just the visual`)

    // ============ EB4: CSSOM — the primitive is defined ONCE, every surface composes with it ============
    const cssAudit = await page.evaluate(() => {
      const rules = []
      for (const sheet of document.styleSheets) {
        let list
        try {
          list = sheet.cssRules
        } catch {
          continue
        }
        for (const r of list) {
          if (r.selectorText && /\.dragging\b|drop-target-hover/.test(r.selectorText)) {
            rules.push({ sel: r.selectorText, opacity: r.style.opacity, boxShadow: r.style.boxShadow, outline: r.style.outline, background: r.style.background })
          }
        }
      }
      return rules
    })
    console.log('[EB4] matching CSS rules:\n' + cssAudit.map((r) => `  ${r.sel}  {opacity:${r.opacity || '(inherit)'}}`).join('\n'))
    const baseDragging = cssAudit.filter((r) => r.sel === '.dragging')
    const baseDropHover = cssAudit.filter((r) => r.sel === '.drop-target-hover')
    if (baseDragging.length !== 1) throw new Error(`[EB4] expected exactly ONE bare ".dragging" rule (the shared primitive), found ${baseDragging.length}`)
    if (baseDropHover.length !== 1) throw new Error(`[EB4] expected exactly ONE bare ".drop-target-hover" rule (the shared primitive), found ${baseDropHover.length}`)
    if (!baseDragging[0].opacity) throw new Error('[EB4] the shared .dragging rule should declare the canonical opacity')
    // .effect-row (reorder source) and .arr-section-chip (reorder source) used to each redeclare
    // their own "opacity: 0.4" — now they have NO rule of their own at all, pure inheritance from
    // the shared .dragging class. .arr-clip-block still layers genuine extras (dashed border,
    // grabbing cursor, elevated z-index — a pointer-dragged clip needs to visually lift above
    // siblings), so IT still has a compound rule, but must not redeclare opacity either.
    const pureInheritance = ['.effect-row.dragging', '.arr-section-chip.dragging', '.noteview-note.dragging']
    for (const sel of pureInheritance) {
      const rule = cssAudit.find((r) => r.sel === sel)
      if (rule) throw new Error(`[EB4] ${sel} should have NO rule of its own (pure reuse of the shared .dragging class) — found one with opacity="${rule.opacity}", that's the old one-off-per-surface pattern this stream was supposed to remove`)
    }
    const clipBlockRule = cssAudit.find((r) => r.sel === '.arr-clip-block.dragging')
    if (!clipBlockRule) throw new Error('[EB4] expected .arr-clip-block.dragging to still exist for its genuine surface-specific extras (dashed border/cursor/z-index)')
    if (clipBlockRule.opacity) throw new Error(`[EB4] .arr-clip-block.dragging redeclares opacity ("${clipBlockRule.opacity}") instead of inheriting the shared 0.4 — it used to be an independently-invented 0.65`)
    console.log(`[EB4] PASS: .dragging/.drop-target-hover are each defined exactly once; ${pureInheritance.join(', ')} have NO rule of their own (pure inheritance); .arr-clip-block.dragging keeps only its genuine extras, no redeclared opacity`)
    results.eb4 = { rules: cssAudit.length, pureInheritance: pureInheritance.length, clipBlockExtrasOnly: true }

    await page.screenshot({ path: join(uiDir, 'verify-p27eb-final.png') })

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

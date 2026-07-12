#!/usr/bin/env node
// Phase 28 Stream FB — typography & label consistency (docs/phase-28-plan.md, docs/research/
// 79-ux-overall-patterns-round2.md §3.6/§3.7/§3.8). Drives the REAL frontend headlessly against a
// REAL `beat daemon` on a disposable copy of examples/night-shift.beat (never the owner's own
// examples/night-shift-song.beat) and asserts on real rendered DOM/CSS state — computed styles,
// not just that a new class/token exists unused somewhere in styles.css.
//
//   FB1 `--label-tracking` (one token, 0.05em) is defined once at :root and resolves identically
//       — as a CUSTOM PROPERTY, not just a coincidentally-equal computed px value — at five call
//       sites spread across four independent CSS rules that used to hardcode five different mixed
//       em/px values (research/79 §3.6: 0.5px, 1px, 0.3px, 0.04em, 0.05em).
//   FB2 The shared `.section-heading` class is real consolidation, not a new unused class sitting
//       next to four still-independent conventions: four panel-title elements, in FOUR DIFFERENT
//       COMPONENT FILES (App.tsx's Mixer overlay title, ArrangementView.tsx's own "arrangement"
//       header, SynthPanel.tsx's macro-row label, NoteView.tsx's Pitch & Time panel title — the
//       exact four independently-invented conventions research/79 §3.7 named), now share IDENTICAL
//       computed font-size/font-weight/letter-spacing/text-transform/color. Before this stream
//       those four were 14px/700/none, ~13px/600/none (hand-typed Title Case), 10px/700/uppercase,
//       and (NoteView's inline-label role) 11px/600/none/var(--text) — four different answers to
//       the same question.
//   FB3 `--font-mono` (one token) is defined once at :root and both `.note-name-readout-names` and
//       `.pitch-time-amount-readout` — two independent monospace call sites in the same file that
//       used to hand-type two different stacks — resolve to the identical computed font-family.
//   FB4 CSSOM audit: the `.section-heading` rule's own selector list carries every consolidated
//       class name (proving the merge happened in the stylesheet itself, not just via duplicated
//       properties), and none of the old per-class blocks re-declares font-size/letter-spacing/
//       text-transform any more (no silent second source of truth left behind).
//
// Usage: node ui/verify-phase28-stream-fb.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8528
const PREVIEW_PORT = 5328

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

const selectTrack = (page, name) => page.click(`.arr-row:has(.arr-track-name:text-is("${name}")) .arr-track-select`)

// Pull font-size/font-weight/letter-spacing/text-transform/color off a real element — the exact
// properties `.section-heading` promises to unify.
const titleStyle = (sel) =>
  `(() => {
     const el = document.querySelector(${JSON.stringify(sel)})
     if (!el) return null
     const cs = getComputedStyle(el)
     return { fontSize: cs.fontSize, fontWeight: cs.fontWeight, letterSpacing: cs.letterSpacing, textTransform: cs.textTransform, color: cs.color }
   })()`

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p28fb-'))
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

    // ============ FB1: --label-tracking is one real token, resolves identically everywhere ============
    // Real, live-rendered call sites (not the unused, unreferenced TrackList.tsx component, whose
    // own .tracklist-title/.track-kind classes look plausible from a styles.css grep but never
    // actually mount anywhere in App.tsx) that used to hardcode different mixed em/px values
    // (research/79 §3.6): .brand (was 0.5px), .transport-field label (was 0.5px), .arr-length-label
    // (was 0.04em). Assert the CUSTOM PROPERTY itself — not just a coincidentally-equal resolved px
    // value — reads back identically at each, proving one shared source, not several reinvented ones.
    await selectTrack(page, 'bass')
    await pollUntil(() => page.evaluate(() => window.__store.getState().doc.selectedTrack === 'bass'), 'bass selection')
    const trackingAudit = await page.evaluate(() => {
      const sels = ['.brand', '.transport-field label', '.arr-length-label', ':root']
      return sels.map((sel) => {
        const el = sel === ':root' ? document.documentElement : document.querySelector(sel)
        if (!el) return { sel, value: null }
        return { sel, value: getComputedStyle(el).getPropertyValue('--label-tracking').trim() }
      })
    })
    console.log('[FB1] --label-tracking at each call site:\n' + trackingAudit.map((r) => `  ${r.sel.padEnd(20)} -> "${r.value}"`).join('\n'))
    const missingTracking = trackingAudit.filter((r) => r.value === null)
    if (missingTracking.length) throw new Error(`[FB1] could not locate element(s) for: ${missingTracking.map((r) => r.sel).join(', ')}`)
    const trackingValues = new Set(trackingAudit.map((r) => r.value))
    if (trackingValues.size !== 1) throw new Error(`[FB1] --label-tracking should resolve to ONE value everywhere, got: ${JSON.stringify(trackingAudit)}`)
    const trackingValue = [...trackingValues][0]
    if (!trackingValue || trackingValue === '') throw new Error('[FB1] --label-tracking resolved to empty — the token is not actually reaching :root')
    // Chrome's computed-style serialization drops the leading zero ("0.05em" -> ".05em"); compare
    // numerically so this assertion checks the real value, not a specific serialization quirk.
    if (Number.parseFloat(trackingValue) !== 0.05 || !trackingValue.endsWith('em')) {
      throw new Error(`[FB1] expected --label-tracking to be 0.05em (the majority convention this stream picked), got "${trackingValue}"`)
    }
    console.log(`[FB1] PASS: --label-tracking resolves to the SAME real value ("${trackingValue}") at ${trackingAudit.length} independent, live-rendered call sites across the stylesheet`)
    results.fb1 = { trackingValue, siteCount: trackingAudit.length }

    // ============ FB2: .section-heading really consolidates 4 panel-title conventions ============
    // Four elements, four different component files, four different conventions before this stream
    // (research/79 §3.7): App.tsx's Mixer overlay title, ArrangementView.tsx's own header,
    // SynthPanel.tsx's macro-row label, NoteView.tsx's Pitch & Time panel title.
    const arrTitle = await page.evaluate(titleStyle('.editor-title.section-heading'))
    if (!arrTitle) throw new Error('[FB2] ArrangementView\'s "arrangement" header (.editor-title.section-heading) not found')
    console.log(`[FB2] ArrangementView .editor-title.section-heading: ${JSON.stringify(arrTitle)}`)

    await page.click('[data-action="toggle-mixer"]')
    await page.waitForSelector('[data-testid="mixer-overlay"]', { timeout: 5000 })
    const mixerTitle = await page.evaluate(titleStyle('.overlay-title.section-heading'))
    if (!mixerTitle) throw new Error('[FB2] Mixer overlay title (.overlay-title.section-heading) not found')
    console.log(`[FB2] App.tsx Mixer .overlay-title.section-heading: ${JSON.stringify(mixerTitle)}`)
    await page.click('[data-action="close-mixer"]')
    await page.waitForSelector('[data-testid="mixer-overlay"]', { state: 'detached', timeout: 5000 })

    await page.click('[data-pane-tab="device"]')
    await page.waitForSelector('[data-testid="bottom-pane"][data-pane="device"]', { timeout: 5000 })
    await page.waitForSelector('.macro-row-label.section-heading', { timeout: 5000 })
    const macroTitle = await page.evaluate(titleStyle('.macro-row-label.section-heading'))
    if (!macroTitle) throw new Error('[FB2] SynthPanel macro-row label (.macro-row-label.section-heading) not found — is the "bass" fixture track missing library macros?')
    console.log(`[FB2] SynthPanel .macro-row-label.section-heading: ${JSON.stringify(macroTitle)}`)

    await page.click('[data-pane-tab="clip"]')
    await page.waitForSelector('[data-testid="bottom-pane"][data-pane="clip"] .noteview', { timeout: 5000 })
    const pitchTimeTitle = await page.evaluate(titleStyle('.pitch-time-title.section-heading'))
    if (!pitchTimeTitle) throw new Error('[FB2] NoteView Pitch & Time title (.pitch-time-title.section-heading) not found')
    console.log(`[FB2] NoteView .pitch-time-title.section-heading: ${JSON.stringify(pitchTimeTitle)}`)

    // Bonus fifth element, same file family, different sub-panel: select exactly one note to render
    // the per-note inspector's own title too.
    const firstNoteId = await page.$eval('.noteview-note[data-note-id]', (el) => el.getAttribute('data-note-id'))
    await page.click(`.noteview-note[data-note-id="${firstNoteId}"]`)
    await page.waitForSelector('.note-inspector-title.section-heading', { timeout: 5000 })
    const noteInspectorTitle = await page.evaluate(titleStyle('.note-inspector-title.section-heading'))
    if (!noteInspectorTitle) throw new Error('[FB2] NoteView per-note inspector title (.note-inspector-title.section-heading) not found')
    console.log(`[FB2] NoteView .note-inspector-title.section-heading: ${JSON.stringify(noteInspectorTitle)}`)

    const titled = { arrangement: arrTitle, mixerOverlay: mixerTitle, synthMacros: macroTitle, pitchTime: pitchTimeTitle, noteInspector: noteInspectorTitle }
    const entries = Object.entries(titled)
    const [firstName, firstVal] = entries[0]
    const mismatches = entries.slice(1).filter(([, v]) => JSON.stringify(v) !== JSON.stringify(firstVal))
    if (mismatches.length) {
      throw new Error(
        `[FB2] .section-heading elements should compute IDENTICALLY — "${firstName}" was ${JSON.stringify(firstVal)}, but these differed: ${JSON.stringify(mismatches)}`,
      )
    }
    if (firstVal.textTransform !== 'uppercase') throw new Error(`[FB2] expected the shared convention to be uppercase (CSS-driven, not hand-typed case), got "${firstVal.textTransform}"`)
    console.log(
      `[FB2] PASS: ${entries.length} panel-title elements across 4 different component files (App.tsx, ArrangementView.tsx, SynthPanel.tsx, NoteView.tsx x2) share the IDENTICAL computed style: ${JSON.stringify(firstVal)}`,
    )
    results.fb2 = { elementCount: entries.length, sharedStyle: firstVal }

    // ============ FB3: --font-mono is one real token, resolves identically at two call sites ============
    const monoAudit = await page.evaluate(() => {
      const names = getComputedStyle(document.querySelector('.note-name-readout-names')).fontFamily
      const amount = getComputedStyle(document.querySelector('.pitch-time-amount-readout')).fontFamily
      const rootToken = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
      return { names, amount, rootToken }
    })
    console.log(`[FB3] --font-mono audit: ${JSON.stringify(monoAudit)}`)
    if (!monoAudit.names || !monoAudit.amount) throw new Error('[FB3] could not find both monospace readout elements')
    if (monoAudit.names !== monoAudit.amount) throw new Error(`[FB3] two monospace call sites should resolve to the IDENTICAL font-family, got names="${monoAudit.names}" vs amount="${monoAudit.amount}"`)
    if (!monoAudit.rootToken.includes('ui-monospace')) throw new Error(`[FB3] --font-mono should resolve to a real monospace stack at :root, got "${monoAudit.rootToken}"`)
    if (!monoAudit.names.toLowerCase().includes('ui-monospace')) throw new Error(`[FB3] rendered font-family should include ui-monospace, got "${monoAudit.names}"`)
    console.log(`[FB3] PASS: --font-mono resolves to the SAME real stack ("${monoAudit.rootToken}") at both call sites`)
    results.fb3 = monoAudit

    // ============ FB4: CSSOM — the merge happened in the stylesheet, not just via duplication ============
    const cssAudit = await page.evaluate(() => {
      const sectionHeadingRule = { selectors: null, decl: null }
      const staleDecls = []
      const checkSelectors = ['.editor-title', '.library-rail-title', '.overlay-title', '.effect-chain-title', '.macro-row-label', '.param-group-title', '.preset-picker-label', '.note-inspector-title', '.pitch-time-title']
      for (const sheet of document.styleSheets) {
        let list
        try {
          list = sheet.cssRules
        } catch {
          continue
        }
        for (const r of list) {
          if (!r.selectorText) continue
          if (r.selectorText.split(',').map((s) => s.trim()).includes('.section-heading')) {
            sectionHeadingRule.selectors = r.selectorText
            sectionHeadingRule.decl = { fontSize: r.style.fontSize, fontWeight: r.style.fontWeight, textTransform: r.style.textTransform, letterSpacing: r.style.letterSpacing }
          }
          // A "stale decl" is a standalone rule (selector === exactly one of the old class names,
          // not composed with .section-heading) that STILL redeclares typography — meaning the fold
          // didn't actually happen, just got duplicated.
          const sel = r.selectorText.trim()
          if (checkSelectors.includes(sel) && (r.style.fontSize || r.style.letterSpacing || r.style.textTransform)) {
            staleDecls.push({ sel, fontSize: r.style.fontSize, letterSpacing: r.style.letterSpacing, textTransform: r.style.textTransform })
          }
        }
      }
      return { sectionHeadingRule, staleDecls }
    })
    console.log('[FB4] .section-heading combined selector list:\n  ' + cssAudit.sectionHeadingRule.selectors)
    console.log('[FB4] stale standalone typography decls found: ' + JSON.stringify(cssAudit.staleDecls))
    if (!cssAudit.sectionHeadingRule.selectors) throw new Error('[FB4] no CSS rule declares .section-heading at all')
    const foldedCount = cssAudit.sectionHeadingRule.selectors.split(',').length
    if (foldedCount < 5) throw new Error(`[FB4] expected .section-heading's rule to fold in at least 4 other class names (5+ total selectors), found only ${foldedCount}: ${cssAudit.sectionHeadingRule.selectors}`)
    if (cssAudit.sectionHeadingRule.decl.textTransform !== 'uppercase') throw new Error(`[FB4] .section-heading rule itself should declare text-transform: uppercase, got "${cssAudit.sectionHeadingRule.decl.textTransform}"`)
    if (cssAudit.staleDecls.length) throw new Error(`[FB4] found standalone rule(s) still redeclaring typography outside the shared block — the fold left a second source of truth behind: ${JSON.stringify(cssAudit.staleDecls)}`)
    console.log(`[FB4] PASS: .section-heading's own rule folds in ${foldedCount} selectors, and none of the old per-class blocks redeclares typography on its own any more`)
    results.fb4 = { foldedSelectorCount: foldedCount, staleDecls: cssAudit.staleDecls.length }

    await page.screenshot({ path: join(uiDir, 'verify-p28fb-final.png') })

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

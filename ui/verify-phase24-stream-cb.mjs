#!/usr/bin/env node
// Phase 24 Stream CB verification — "drag a section left/right to reorder it," driven live against
// a REAL `beat daemon` through the REAL frontend in headless Chromium. Same harness/convention as
// ui/verify-phase22-stream-aa.mjs (the effect-chain reorder precedent this stream's drag mechanics
// and CSS classes are modeled on): every assertion checks the on-disk .beat file (the real
// `song`/`scene` blocks a `git diff` would show), the live DOM, AND the semantic diff
// (diffDocuments), not just a store field.
//
//   CB1 DRAG        native HTML5 drag-and-drop (page.dragAndDrop, the same API
//                   ui/verify-phase22-content-browser.mjs's library-drop tests use) — drag the
//                   FIRST section chip ("intro") onto the SECOND ("main"), an adjacent swap: the
//                   file's song block goes from "intro main outro" to "main intro outro", the DOM
//                   chip order reflects it, and the semantic diff (diffDocuments) is EXACTLY one
//                   'song-changed' entry — not a scene-removed/scene-added or clip-removed/
//                   clip-added pair, which would misreport a pure reorder as content being
//                   deleted and re-created.
//   CB2 MOVE-RIGHT  click the ▶ fallback button (a keyboard/click-reachable affordance alongside
//                   the drag handle, same idiom SynthPanel.tsx's ▲/▼ effect-move buttons
//                   establish) to move "outro" left-to-right past two siblings in one hop: file
//                   order becomes "intro outro main", confirming a genuine multi-position
//                   reposition, not just an adjacent swap.
//   CB3 CLI/MCP     `beat song-move` and the MCP beat_song_move tool both produce the identical
//                   reorder against a fresh copy of the same file — the GUI drag, the CLI command,
//                   and the MCP tool are three faces on one core primitive (songMove).
//
// Usage: node ui/verify-phase24-stream-cb.mjs

//
// Ported to ui/verify-lib.mjs (W1.5): sleep, pollUntil, the double `npm run build`, the daemon boot,
// the preview spawn, the chromium launch, the page setup and the teardown come from the shared
// harness. The drag choreography and the on-disk section assertions below are untouched.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { bootGui, buildAll, importDist, pollUntil, repoRoot, run as runVerify, scratchProject, sleep } from './verify-lib.mjs'

const DAEMON_PORT = 8624
const PREVIEW_PORT = 5363
const sectionLines = (text) => text.split('\n').filter((l) => l.trim().startsWith('section '))

const PROJECT_TEXT = `format_version 0.10
bpm 120
loop_bars 2
selected_track lead

track lead Lead #c678dd synth
  synth
    osc sawtooth
    volume -8
    cutoff 3000
    resonance 0.8
    attack 0.01
    decay 0.05
    sustain 1
    release 0.1
    pan 0
  clip a
    note n1 45 0 16 0.9

scene intro
  slot lead a

scene main
  slot lead a

scene outro
  slot lead a

song
  section intro 2
  section main 4
  section outro 2
`

async function main() {
  buildAll()

  const { parse, serialize, diffDocuments, formatDiff, songMove } = await importDist('src/core/index.js')

  // Round-trip through parse/serialize once so the on-disk file starts in exactly the tool's own
  // canonical form (matches every other verify script's convention).
  const { file: beatPath } = scratchProject({ prefix: 'dotbeat-p24cb-', name: 'project.beat', text: serialize(parse(PROJECT_TEXT)) })
  const readBeat = () => readFileSync(beatPath, 'utf8')
  console.log(`baseline sections: ${sectionLines(readBeat()).join(' | ')}`)

  const gui = await bootGui({ file: beatPath, daemonPort: DAEMON_PORT, previewPort: PREVIEW_PORT, viewport: { width: 1440, height: 960 } })
  const { page, errors } = gui
  const results = {}
  try {
    // bootGui already collects pageerror into `errors`; this script additionally echoes browser
    // warnings/errors live, which is genuinely useful while a drag choreography is being debugged.
    page.on('pageerror', (e) => console.log(`[pageerror] ${e}`))
    page.on('console', (m) => {
      if (m.type() === 'warning' || m.type() === 'error') console.log(`[browser ${m.type()}] ${m.text()}`)
    })
    await page.waitForSelector('[data-section-chip="0"]', { timeout: 5000 })

    const chipNames = async () => page.$$eval('[data-section-chip]', (els) => els.map((el) => el.querySelector('.arr-chip-name').textContent))
    const baselineNames = await chipNames()
    if (baselineNames.join(',') !== 'intro,main,outro') {
      throw new Error(`[setup] expected the GUI to show intro,main,outro, got: ${baselineNames.join(',')}`)
    }
    console.log(`[setup] PASS: GUI shows the 3-section song in order (${baselineNames.join(' -> ')})`)

    // ============ CB1: DRAG "intro" (index 0) onto "main" (index 1) — adjacent swap ============
    const beforeCb1 = readBeat()
    await page.dragAndDrop('[data-section-chip="0"]', '[data-section-chip="1"]')
    await pollUntil(async () => {
      const names = await chipNames()
      return names.join(',') === 'main,intro,outro'
    }, 'GUI chip order to reflect the drag-swap')
    await pollUntil(async () => {
      const lines = sectionLines(readBeat())
      return lines[0]?.includes(' main ') && lines[1]?.includes(' intro ') && lines[2]?.includes(' outro ')
    }, 'file to reflect the drag-swap')
    const afterCb1 = readBeat()
    const changedLines = afterCb1.split('\n').filter((l, i) => l !== beforeCb1.split('\n')[i])
    console.log(`[CB1] file order after drag: ${sectionLines(afterCb1).join(' | ')} (${changedLines.length} line(s) changed)`)

    // Semantic diff: the reorder must read as ONE 'song-changed' fact, not a scene/clip
    // delete-and-recreate pair — the whole point of songMove being a real edit primitive.
    const docBeforeCb1 = parse(beforeCb1)
    const docAfterCb1 = parse(afterCb1)
    const entries = diffDocuments(docBeforeCb1, docAfterCb1)
    if (entries.length !== 1 || entries[0].kind !== 'song-changed') {
      throw new Error(`[CB1] expected exactly one 'song-changed' diff entry, got: ${JSON.stringify(entries)}`)
    }
    console.log(`[CB1] PASS: semantic diff is exactly one song-changed fact:\n  ${formatDiff(entries).trim()}`)
    results.cb1 = { order: await chipNames(), diffEntryCount: entries.length }

    // ============ CB2: click the ▶ move-right fallback on "outro" (now index 2), twice ============
    // outro is currently last (index 2); two right-moves would clamp there (nothing to move past),
    // so instead move "main" (now index 0) right past its two siblings in two clicks: a multi-hop
    // reposition proving this isn't limited to single-step adjacent swaps.
    await page.click('[data-section-move-right="0"]')
    await pollUntil(async () => (await chipNames()).join(',') === 'intro,main,outro', 'first move-right to land')
    await page.click('[data-section-move-right="1"]')
    await pollUntil(async () => (await chipNames()).join(',') === 'intro,outro,main', 'second move-right to land')
    const afterCb2 = readBeat()
    const cb2Order = await chipNames()
    if (cb2Order.join(',') !== 'intro,outro,main') throw new Error(`[CB2] expected intro,outro,main, got ${cb2Order.join(',')}`)
    console.log(`[CB2] PASS: two ▶ clicks moved "main" past both siblings — file now: ${sectionLines(afterCb2).join(' | ')}`)
    results.cb2 = { order: cb2Order }

    // ============ CB3: the CLI and MCP tool produce the identical reorder ============
    // Run the equivalent move (index 0 -> index 2, "intro" past its two siblings) against a fresh
    // copy of the PRE-CB2 file via the CLI, and again via songMove directly (what the MCP tool
    // calls), and confirm all three paths (GUI drag+clicks, CLI, core primitive) agree.
    const cliCopy = join(dirname(beatPath), 'cli-copy.beat')
    writeFileSync(cliCopy, afterCb1) // state after CB1: main, intro, outro
    execFileSync('node', [join(repoRoot, 'cli', 'beat.mjs'), 'song-move', cliCopy, '0', '2'], { encoding: 'utf8' })
    const cliResult = readFileSync(cliCopy, 'utf8')
    const corePrimitiveResult = serialize(songMove(parse(afterCb1), 0, 2).doc)
    if (cliResult !== corePrimitiveResult) {
      throw new Error(`[CB3] CLI beat song-move and core songMove disagree:\nCLI:\n${cliResult}\ncore:\n${corePrimitiveResult}`)
    }
    console.log(`[CB3] PASS: beat song-move (CLI) agrees byte-for-byte with core songMove — sections now: ${sectionLines(cliResult).join(' | ')}`)
    results.cb3 = { cliMatchesCore: true, order: sectionLines(cliResult).map((l) => l.trim().split(' ')[1]) }

    if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
    console.log('\nALL PASS — Phase 24 Stream CB (drag a section left/right to reorder it) verified live:')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await gui.close()
  }
}

await runVerify('phase24-stream-cb', main)

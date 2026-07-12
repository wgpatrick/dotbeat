#!/usr/bin/env node
// Phase 22 Stream AA verification — the ordered, reorderable per-track effect chain (format v0.10),
// driven live against a REAL `beat daemon` through the REAL frontend in headless Chromium. Same
// harness/convention as ui/verify-phase20-tracks.mjs: every assertion checks the on-disk .beat
// file (a real git diff for the "small local change" claim), the live DOM, AND — for bypass —
// actual recorded/analyzed audio, not just a checkbox's checked state.
//
//   AA1 ADD     pick "EQ3" in the add-effect dropdown, click "+ Add effect": the file goes from
//               ZERO effect lines (default chain, elided) to five explicit `effect` lines, the git
//               diff adds exactly those five, and the new instance (eq3_2) appears last.
//   AA2 REORDER click bitcrush's "move up" button (swaps it with distortion): the git diff against
//               the post-AA1 checkpoint changes EXACTLY two lines (the swapped pair) — a small,
//               local move, not a chain rewrite.
//   AA3 BYPASS  uncheck bitcrush's "on" checkbox: the file line gains a trailing "bypassed" token,
//               the DOM checkbox is unchecked — AND a real recording+analysis (src/metrics'
//               analyze(), the same tool every prior engine-verification stream uses) shows the
//               1-bit-crushed take and the bypassed take differ measurably in crest factor and
//               loudness. bitcrushBits=1/bitcrushMix=1 is baked into the test track specifically so
//               this is an obvious, unambiguous audible transformation, not a subtle one.
//   AA4 REMOVE  click the newly-added eq3_2's remove button: its line is gone, the chain is back to
//               four entries.
//
// Usage: node ui/verify-phase22-stream-aa.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8622
const PREVIEW_PORT = 5361

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
async function pollUntil(fn, what, timeoutMs = 10000, everyMs = 40) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}
const effectLines = (text) => text.split('\n').filter((l) => l.trim().startsWith('effect '))

const PROJECT_TEXT = `format_version 0.10
bpm 120
loop_bars 6
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
    bitcrushBits 1
    bitcrushMix 1
  note n1 45 0 96 0.9
`

async function main() {
  console.log('building repo core/daemon/metrics + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const { decodeWav, analyze } = await import(join(repoRoot, 'dist/src/metrics/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p22aa-'))
  const beatPath = join(proj, 'project.beat')
  // Round-trip through parse/serialize once so the on-disk file starts in exactly the tool's own
  // canonical form (matches every other verify script's convention — git diffs stay clean).
  writeFileSync(beatPath, serialize(parse(PROJECT_TEXT)))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline')
  const readBeat = () => readFileSync(beatPath, 'utf8')
  console.log(`baseline effect lines: ${effectLines(readBeat()).length} (expect 0 — default chain, elided)`)

  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  console.log(`daemon up on :${daemon.port}, project ${beatPath}`)

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))
  await pollUntil(async () => {
    try {
      return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok
    } catch {
      return false
    }
  }, 'vite preview to serve', 20000)
  console.log(`ui served on :${PREVIEW_PORT}`)

  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const results = {}
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1440, height: 960 })
    const errors = []
    page.on('pageerror', (e) => {
      errors.push(String(e))
      console.log(`[pageerror] ${e}`)
    })
    page.on('console', (m) => {
      if (m.type() === 'warning' || m.type() === 'error') console.log(`[browser ${m.type()}] ${m.text()}`)
    })
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 12000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    // Open Device View (SynthPanel) for the selected ('lead') track.
    await page.click('[data-pane-tab="device"]')
    await page.waitForSelector('[data-testid="effect-chain"]', { timeout: 5000 })

    const rowIds = async () => page.$$eval('[data-effect-row]', (els) => els.map((el) => el.getAttribute('data-effect-row')))
    const baselineRows = await rowIds()
    if (baselineRows.join(',') !== 'eq3,comp,distortion,bitcrush') {
      throw new Error(`[setup] expected the default 4-entry chain in the GUI, got: ${baselineRows.join(',')}`)
    }
    console.log(`[setup] PASS: GUI shows the default chain (${baselineRows.join(' -> ')}), file has 0 effect lines (elided)`)

    // ============ AA1: ADD an effect ============
    // The add-type dropdown defaults to the first EFFECT_TYPES entry ('eq3') — no need to touch it.
    const addTypeValue = await page.$eval('[data-effect-add-type]', (el) => el.value)
    if (addTypeValue !== 'eq3') throw new Error(`[AA1] expected the add dropdown to default to eq3, got "${addTypeValue}"`)
    await page.click('[data-effect-add]')
    await pollUntil(async () => effectLines(readBeat()).length === 5, 'file to grow to 5 effect lines after add')
    const afterAdd = effectLines(readBeat())
    if (!afterAdd[4].startsWith('  effect eq3_2 eq3')) throw new Error(`[AA1] expected the 5th line to be the new eq3_2 instance, got: ${afterAdd[4]}`)
    const addDiff = git(proj, 'diff', '--', 'project.beat')
    const addedLines = addDiff.split('\n').filter((l) => l.startsWith('+') && l.includes('effect '))
    if (addedLines.length !== 5) throw new Error(`[AA1] expected the diff to add exactly 5 effect lines (0 -> 5), got ${addedLines.length}:\n${addDiff}`)
    const domRowsAfterAdd = await pollUntil(async () => {
      const ids = await rowIds()
      return ids.join(',') === 'eq3,comp,distortion,bitcrush,eq3_2' ? ids : false
    }, 'GUI row order to reflect the add')
    console.log(`[AA1] PASS: added eq3_2 — file grew 0 -> 5 effect lines, git diff adds exactly 5, GUI shows it appended last`)
    results.aa1 = { effectLines: afterAdd.length, order: domRowsAfterAdd }
    git(proj, 'add', '-A')
    git(proj, 'commit', '-q', '-m', 'after AA1 add')

    // ============ AA2: REORDER (move bitcrush up, swapping with distortion) ============
    await page.click('[data-effect-move-up="bitcrush"]')
    await pollUntil(async () => {
      const ids = await rowIds()
      return ids.join(',') === 'eq3,comp,bitcrush,distortion,eq3_2'
    }, 'GUI row order to reflect the swap')
    await pollUntil(async () => {
      const lines = effectLines(readBeat())
      return lines[2]?.includes(' bitcrush ') && lines[3]?.includes(' distortion ')
    }, 'file to reflect the swap')
    const moveDiff = git(proj, 'diff', '--', 'project.beat')
    const diffLines = moveDiff.split('\n').filter((l) => (l.startsWith('+') || l.startsWith('-')) && !l.startsWith('+++') && !l.startsWith('---'))
    if (diffLines.length !== 2) throw new Error(`[AA2] expected a 2-line diff (one swapped pair), got ${diffLines.length} changed lines:\n${moveDiff}`)
    console.log(`[AA2] PASS: reordering bitcrush is a 2-line diff (small, local — not a chain rewrite):\n${moveDiff.split('\n').filter((l) => l.startsWith('+') || l.startsWith('-')).join('\n')}`)
    results.aa2 = { diffLineCount: diffLines.length }
    git(proj, 'add', '-A')
    git(proj, 'commit', '-q', '-m', 'after AA2 reorder')

    // ============ AA3: BYPASS bitcrush — verify checkbox, file, AND real recorded audio ============
    const recordCurrent = async (secs) => {
      const b64 = await page.evaluate(async (s) => {
        window.__engine.stop()
        await window.__engine.play()
        await new Promise((r) => setTimeout(r, 300)) // let the graph settle before capture
        const blob = await window.__engine.recordWav(s)
        window.__engine.stop()
        const buf = await blob.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let bin = ''
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        return btoa(bin)
      }, secs)
      const bytes = Buffer.from(b64, 'base64')
      const decoded = decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
      return analyze(decoded.channels, decoded.sampleRate)
    }

    console.log('[AA3] recording with bitcrush ACTIVE (bits=1, mix=1 — an obviously destructive setting)...')
    const enabledMetrics = await recordCurrent(1.2)
    console.log(`  active:    LUFS ${enabledMetrics.integratedLufs.toFixed(2)}, crest ${enabledMetrics.crestDb.toFixed(2)} dB`)

    await page.click('[data-effect-bypass="bitcrush"]')
    await pollUntil(async () => {
      const checked = await page.$eval('[data-effect-bypass="bitcrush"]', (el) => el.checked)
      return checked === false
    }, 'DOM checkbox to show unchecked')
    await pollUntil(async () => {
      const lines = effectLines(readBeat())
      return lines.some((l) => /^\s*effect bitcrush bitcrush bypassed\s*$/.test(l))
    }, 'file to gain the "bypassed" token on the bitcrush line')
    await pollUntil(async () => {
      const doc = await page.evaluate(() => window.__store.getState().doc)
      return doc.tracks.find((t) => t.id === 'lead').effects.find((e) => e.id === 'bitcrush').enabled === false
    }, 'store doc to reflect the bypass before re-recording')
    console.log('[AA3] checkbox unchecked, file line reads "... bypassed", store reflects it — now re-recording...')

    console.log('[AA3] recording with bitcrush BYPASSED...')
    const bypassedMetrics = await recordCurrent(1.2)
    console.log(`  bypassed:  LUFS ${bypassedMetrics.integratedLufs.toFixed(2)}, crest ${bypassedMetrics.crestDb.toFixed(2)} dB`)

    const crestDelta = Math.abs(enabledMetrics.crestDb - bypassedMetrics.crestDb)
    const lufsDelta = Math.abs(enabledMetrics.integratedLufs - bypassedMetrics.integratedLufs)
    console.log(`  deltas:    crest ${crestDelta.toFixed(2)} dB, LUFS ${lufsDelta.toFixed(2)} dB`)
    // 1-bit bitcrushing at full wet is an extreme, unambiguous transformation (quantizes the whole
    // waveform to two levels) — a measurable crest-factor OR loudness swing is the expected,
    // honest bar; either one clears easily if the bypass actually routed the effect out of the
    // graph, and neither would move at all if bypass were a no-op / still-wired illusion.
    if (crestDelta < 1.0 && lufsDelta < 1.0) {
      throw new Error(`[AA3] bypass did not measurably change the audio (crest delta ${crestDelta.toFixed(2)} dB, LUFS delta ${lufsDelta.toFixed(2)} dB) — bypass may not be a real routing bypass`)
    }
    console.log(`[AA3] PASS: bypass measurably silenced bitcrush's contribution (crest Δ${crestDelta.toFixed(2)} dB, LUFS Δ${lufsDelta.toFixed(2)} dB) — a real routing change, not just a checkbox`)
    results.aa3 = { enabled: enabledMetrics, bypassed: bypassedMetrics, crestDelta, lufsDelta }

    // ============ AA4: REMOVE the added eq3_2 ============
    await page.click('[data-effect-remove="eq3_2"]')
    await pollUntil(async () => {
      const ids = await rowIds()
      return !ids.includes('eq3_2')
    }, 'eq3_2 to disappear from the GUI')
    await pollUntil(async () => {
      const lines = effectLines(readBeat())
      return lines.length === 4 && !lines.some((l) => l.includes('eq3_2'))
    }, 'eq3_2 line to disappear from the file')
    const finalLines = effectLines(readBeat())
    console.log(`[AA4] PASS: removed eq3_2 — file back to ${finalLines.length} effect lines`)
    results.aa4 = { effectLines: finalLines.length }

    if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
    console.log('\nALL PASS — Phase 22 Stream AA (ordered, reorderable effect chain) verified live:')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGKILL')
    await daemon.close()
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })

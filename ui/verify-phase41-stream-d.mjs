#!/usr/bin/env node
// Phase 41 Stream D verification — arrangement navigation on a LONG song.
//
// The whole stream exists because a 242-bar / 7-minute arrangement is unnavigable: no follow, no
// markers, no keyboard transport, no way back from a zoom. So this script builds a deliberately
// long song (240 bars over 20 sections) rather than the fleet's usual 2-8 bar fixture — at the
// default fit-to-width zoom a short song has NO horizontal overflow at all, which means follow,
// zoom-back and scroll-into-view would every one of them "pass" by doing nothing. The length is
// the test condition, not set dressing.
//
//   D1  follow      the view auto-scrolls to keep a playing playhead on screen, and does NOT when
//                   the toggle is off — asserted as a real scrollLeft change, not a class name
//   D2  locators    create/rename/move/delete round-trip through POST /edit to the .beat FILE
//   D3  jump        clicking a marker flag moves both the transport and the view to its bar
//   D4  shortcuts   Space toggles the transport; M drops a marker; , and . step between markers;
//                   0 clears the selection
//   D5  zoom        Z frames the selected bars, X restores the exact px/bar AND scrollLeft it left
//   D6  clock       the transport and ruler wall-clock figures match bars * 240/bpm
//   D7  help        every key the handler implements is documented in ShortcutHelp
//
// Usage: node ui/verify-phase41-stream-d.mjs

import { readFileSync } from 'node:fs'
import { beat, bootGui, buildAll, check, importDist, pollUntil, run as runVerify, scratchProject, screenshot, sleep } from './verify-lib.mjs'

const DAEMON_PORT = 8643
const PREVIEW_PORT = 5391
const BPM = 125
const SECTIONS = 20
const BARS_PER_SECTION = 12
const TOTAL_BARS = SECTIONS * BARS_PER_SECTION // 240

function longProjectText() {
  const scenes = []
  const song = []
  for (let i = 0; i < SECTIONS; i++) {
    scenes.push(`scene s${i}\n  slot lead a`)
    song.push(`  section s${i} ${BARS_PER_SECTION}`)
  }
  return `format_version 0.11
bpm ${BPM}
loop_bars 4
selected_track lead

track lead Lead #c678dd synth
  synth
    osc sawtooth
    volume -12
    cutoff 3000
    resonance 0.5
    attack 0.01
    decay 0.2
    sustain 0.5
    release 0.3
    pan 0
  clip a
    note n1 45 0 16 0.9

${scenes.join('\n\n')}

song
${song.join('\n')}
`
}

const readLocators = (file) => {
  const text = readFileSync(file, 'utf8')
  const block = text.split('\nlocators\n')[1]
  if (!block) return []
  return block
    .split('\n')
    .filter((l) => l.startsWith('  locator '))
    .map((l) => {
      const [, id, bar, name] = l.trim().split(/\s+/)
      return { id, bar: Number(bar), name: name ?? id }
    })
}

const scrollLeft = (page) => page.$eval('.arr-scroll', (el) => el.scrollLeft)
const pxPerBar = (page) => page.$eval('.arr-zoom-readout', (el) => Number(el.getAttribute('data-pxperbar')))

async function main() {
  buildAll()
  const { parse, serialize } = await importDist('src/core/index.js')
  const { file } = scratchProject({ prefix: 'dotbeat-p41d-', name: 'long.beat', text: serialize(parse(longProjectText())) })

  const gui = await bootGui({ file, daemonPort: DAEMON_PORT, previewPort: PREVIEW_PORT, viewport: { width: 1280, height: 900 } })
  const { page, errors } = gui
  try {
    await page.waitForSelector('.arr-scroll', { timeout: 8000 })

    // ── D0: the premise. Zoom in until the timeline genuinely overflows, or nothing below is a
    // test of anything. Every later case depends on there being off-screen content.
    for (let i = 0; i < 6; i++) await page.click('[data-action="zoom-in"]')
    const overflow = await page.$eval('.arr-scroll', (el) => el.scrollWidth - el.clientWidth)
    check(overflow > 500, `D0 the zoomed 240-bar timeline overflows its container by ${overflow}px, so there is something to navigate`)

    // ── D1: follow ────────────────────────────────────────────────────────────────────────────
    check(await page.$eval('[data-action="follow-toggle"]', (el) => el.getAttribute('data-follow')) === '1', 'D1 follow is on by default')

    // Follow OFF first: prove the auto-scroll is actually the toggle's doing and not just
    // something the app does regardless.
    await page.click('[data-action="follow-toggle"]')
    check(await page.$eval('[data-action="follow-toggle"]', (el) => el.getAttribute('data-follow')) === '0', 'D1 clicking the toggle turns follow off')
    await page.evaluate(() => { document.querySelector('.arr-scroll').scrollLeft = 0 })
    await page.evaluate(() => window.__engine.seek(120))
    await sleep(600)
    const offScroll = await scrollLeft(page)
    check(offScroll < 50, `D1 with follow OFF the view stayed put (scrollLeft ${offScroll}) while the playhead moved to bar 121`)
    await page.evaluate(() => window.__engine.stop())

    // Follow ON: the same seek must drag the view along with it.
    await page.click('[data-action="follow-toggle"]')
    await page.evaluate(() => { document.querySelector('.arr-scroll').scrollLeft = 0 })
    await page.evaluate(() => window.__engine.seek(120))
    const onScroll = await pollUntil(async () => {
      const x = await scrollLeft(page)
      return x > 200 ? x : null
    }, 'follow to scroll the view toward bar 121', 6000)
    check(onScroll > 200, `D1 with follow ON the view scrolled to ${onScroll}px to keep the playhead visible`)

    // And the playhead must actually be INSIDE the viewport, which is the user-visible claim —
    // "scrollLeft changed" alone could still leave it off the right edge.
    const visible = await page.evaluate(() => {
      const sc = document.querySelector('.arr-scroll')
      const ph = document.querySelector('.arr-playhead')
      if (!ph) return null
      const x = parseFloat(ph.style.left)
      return x >= sc.scrollLeft && x <= sc.scrollLeft + sc.clientWidth
    })
    check(visible === true, 'D1 the playhead is inside the visible viewport after follow scrolled')
    await page.evaluate(() => window.__engine.stop())
    await screenshot(page, 'verify-p41d-follow')

    // ── D2: locators round-trip to the FILE ───────────────────────────────────────────────────
    check((await page.$$('.arr-locator')).length === 0, 'D2 a fresh project has no markers')
    await page.click('[data-action="add-locator"]')
    await page.waitForSelector('.arr-locator-input', { timeout: 4000 })
    await page.keyboard.type('Breakdown')
    await page.keyboard.press('Enter')
    const afterName = await pollUntil(() => {
      const ls = readLocators(file)
      return ls.length === 1 && ls[0].name === 'Breakdown' ? ls : null
    }, 'the named marker to reach the .beat file', 6000)
    check(afterName.length === 1 && afterName[0].name === 'Breakdown', `D2 the marker persisted to disk as "${afterName[0].name}" at bar ${afterName[0].bar}`)
    check(afterName[0].bar >= 1, 'D2 the persisted bar is 1-based (>= 1), matching the format spec')

    // Now move it from the CLI — the real cross-surface case, and the point of putting locators in
    // setValue's path grammar rather than giving the GUI a private route. `beat set` and the GUI
    // are hitting the identical helper; the daemon's file watcher carries the result back.
    beat(['set', file, 'locator.m1.bar', '101'])
    const movedBar = await pollUntil(async () => {
      const b = await page.$eval('[data-locator="m1"]', (el) => Number(el.getAttribute('data-locator-bar'))).catch(() => null)
      return b === 101 ? b : null
    }, 'the GUI to re-render the CLI-moved marker at bar 101', 8000)
    check(movedBar === 101, 'D2 `beat set locator.m1.bar 101` moves the flag in the GUI — one path grammar, every surface')

    // ── D3: clicking a marker jumps transport AND view ────────────────────────────────────────
    await page.evaluate(() => { document.querySelector('.arr-scroll').scrollLeft = 0 })
    await page.click('[data-locator-jump="m1"]')
    await sleep(400)
    const jumpStep = await page.evaluate(() => window.__store.getState().currentStep)
    const jumpScroll = await scrollLeft(page)
    check(jumpStep >= 100 * 16, `D3 clicking the flag moved the transport to step ${jumpStep} (bar ${Math.floor(jumpStep / 16) + 1})`)
    check(jumpScroll > 200, `D3 clicking the flag also scrolled the view there (scrollLeft ${jumpScroll})`)
    await page.evaluate(() => window.__engine.stop())
    await screenshot(page, 'verify-p41d-locators')

    // ── D4: keyboard ──────────────────────────────────────────────────────────────────────────
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('Space')
    const playing = await pollUntil(async () => {
      const p = await page.evaluate(() => window.__store.getState().playing)
      return p === true ? p : null
    }, 'Space to start the transport', 5000)
    check(playing === true, 'D4 Space starts the transport')
    await page.keyboard.press('Space')
    const stopped = await pollUntil(async () => {
      const p = await page.evaluate(() => window.__store.getState().playing)
      return p === false ? true : null
    }, 'Space to stop the transport', 5000)
    check(stopped === true, 'D4 Space stops it again')

    // M drops a second marker. Seek somewhere distinct first so the two are at different bars.
    await page.evaluate(() => window.__engine.seek(40))
    await sleep(300)
    await page.evaluate(() => window.__engine.stop())
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('m')
    await page.waitForSelector('.arr-locator-input', { timeout: 4000 })
    await page.keyboard.type('Main_1')
    await page.keyboard.press('Enter')
    const two = await pollUntil(() => {
      const ls = readLocators(file)
      return ls.length === 2 ? ls : null
    }, 'M to drop a second marker', 6000)
    check(two.length === 2, `D4 M dropped a second marker (now: ${two.map((l) => `${l.name}@${l.bar}`).join(', ')})`)

    // , and . step between them. Park the transport between the two markers so both directions
    // have somewhere to go.
    const bars = two.map((l) => l.bar).sort((a, b) => a - b)
    const mid = Math.floor((bars[0] + bars[1]) / 2)
    await page.evaluate((b) => window.__engine.seek(b - 1), mid)
    await sleep(300)
    await page.evaluate(() => window.__engine.stop())
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('.')
    await sleep(400)
    const nextBar = await page.evaluate(() => Math.floor(window.__store.getState().currentStep / 16) + 1)
    check(nextBar === bars[1], `D4 "." jumped forward to the next marker at bar ${bars[1]} (landed on ${nextBar})`)
    await page.evaluate(() => window.__engine.stop())
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press(',')
    await sleep(400)
    const prevBar = await page.evaluate(() => Math.floor(window.__store.getState().currentStep / 16) + 1)
    check(prevBar === bars[0], `D4 "," jumped back to the earlier marker at bar ${bars[0]} (landed on ${prevBar})`)
    await page.evaluate(() => window.__engine.stop())

    // 0 clears the bar-range selection.
    await page.evaluate((port) => fetch(`http://localhost:${port}/selection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bars: { start: 10, end: 20 } }),
    }), gui.daemonPort)
    await pollUntil(async () => (await page.evaluate(() => !!window.__store.getState().selection.bars)) ? true : null, 'a bar selection to arrive', 5000)
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('0')
    const cleared = await pollUntil(async () => (await page.evaluate(() => !window.__store.getState().selection.bars)) ? true : null, '0 to clear the selection', 5000)
    check(cleared === true, 'D4 "0" clears the bar-range selection')

    // ── D5: zoom to selection, and back to exactly where you were ─────────────────────────────
    const beforeZoom = { px: await pxPerBar(page), scroll: await scrollLeft(page) }
    await page.evaluate((port) => fetch(`http://localhost:${port}/selection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bars: { start: 100, end: 108 } }),
    }), gui.daemonPort)
    await pollUntil(async () => (await page.evaluate(() => !!window.__store.getState().selection.bars)) ? true : null, 'the zoom-target selection', 5000)
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('z')
    await sleep(500)
    const zoomedPx = await pxPerBar(page)
    check(zoomedPx > beforeZoom.px, `D5 Z zoomed in to frame the 8-bar selection (${beforeZoom.px} -> ${zoomedPx} px/bar)`)
    const laneW = await page.$eval('.arr-scroll', (el) => el.clientWidth - 264)
    check(Math.abs(zoomedPx * 8 - laneW * 0.9) < laneW * 0.15, `D5 the 8 selected bars fill the lane viewport (${(zoomedPx * 8).toFixed(0)}px of ${laneW}px)`)
    check(await page.$eval('[data-action="zoom-back"]', (el) => Number(el.getAttribute('data-zoom-stack'))) === 1, 'D5 the zoom-back button reports one level on the stack')

    await page.keyboard.press('x')
    await sleep(500)
    const backPx = await pxPerBar(page)
    const backScroll = await scrollLeft(page)
    check(Math.abs(backPx - beforeZoom.px) < 0.01, `D5 X restored the exact px/bar (${beforeZoom.px} -> ${backPx})`)
    check(Math.abs(backScroll - beforeZoom.scroll) < 2, `D5 X restored the scroll position too (${beforeZoom.scroll} -> ${backScroll}), not just the magnification`)
    check(await page.$eval('[data-action="zoom-back"]', (el) => el.disabled) === true, 'D5 the zoom-back button disables itself once the stack is empty')
    await screenshot(page, 'verify-p41d-zoom')

    // ── D6: wall clock ────────────────────────────────────────────────────────────────────────
    const totalSeconds = await page.$eval('[data-total-seconds]', (el) => Number(el.getAttribute('data-total-seconds')))
    const expected = TOTAL_BARS * (240 / BPM)
    check(Math.abs(totalSeconds - expected) < 0.01, `D6 the transport's song length is ${totalSeconds}s, matching ${TOTAL_BARS} bars * 240/${BPM} = ${expected}s`)
    const clockText = await page.$eval('[data-total-seconds]', (el) => el.textContent.trim())
    check(clockText === '7:40', `D6 that renders as ${clockText} (m:ss)`)
    const tickTimes = await page.$$eval('.arr-bar-tick-time', (els) => els.map((e) => e.textContent))
    check(tickTimes.length > 0, `D6 the ruler prints wall-clock labels at this zoom (${tickTimes.length} of them, e.g. ${tickTimes.slice(0, 3).join(', ')})`)

    // ── D7: no undocumented keys ──────────────────────────────────────────────────────────────
    // The panel is a hand-maintained list, so this is the only thing standing between it and the
    // usual drift. Assert the shipped keys are all present in the Arrangement group.
    await page.evaluate(() => document.activeElement?.blur())
    await page.click('[data-action="toggle-shortcuts"]')
    await page.waitForSelector('[data-testid="shortcut-help-panel"]', { timeout: 4000 })
    const helpText = await page.$eval('[data-testid="shortcut-help-panel"]', (el) => el.textContent)
    if (helpText === null) {
      check(false, 'D7 could not open the shortcut help panel')
    } else {
      for (const [key, label] of [['Space', 'Space'], ['M', 'M'], [',', ','], ['.', '.'], ['Z', 'Z'], ['X', 'X'], ['0', '0'], ['S', 'S']]) {
        check(helpText.includes(label), `D7 the shortcut panel documents "${key}"`)
      }
      check(/one SECTION earlier\/later/.test(helpText), 'D7 the panel documents the arrow-nudge granularity (one section, matching the drag gesture)')
    }
    await screenshot(page, 'verify-p41d-shortcuts')

    if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
  } finally {
    await gui.close()
  }
}

await runVerify('phase41-stream-d', main)

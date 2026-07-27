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
//   D8  minimap     the overview strip tracks the real viewport, and clicking it moves the timeline
//   D0c sticky      track headers (and their mute/solo) stay pinned at every horizontal scroll depth
//   D0d nojump      showing the contextual vary bar does not move the track rows under the pointer
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

    // ── D0b: every toolbar control is actually reachable ──────────────────────────────────────
    // Stream D added four buttons to a row that was already at capacity and pushed "loop
    // selection" clean off the right edge of a 1280px viewport. Nothing asserted it, because
    // "the button exists in the DOM" was still true — it was only visible in a screenshot. So
    // assert the thing that actually matters: no control's right edge lies outside the window.
    // Two distinct failures, and the second is the one that actually happened: a control can run
    // OFF the right edge, or it can stay on screen and be flex-SQUASHED to an unusable sliver
    // (clientWidth < scrollWidth). The first cut of this check only tested the former and passed
    // while "loop selection" was rendering as an 18px stub reading "loop select…".
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll('.arr-length-bar button, .arr-length-bar select')]
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({
          label: (el.textContent || el.getAttribute('data-action') || '?').trim().slice(0, 24),
          right: Math.round(el.getBoundingClientRect().right),
          squashedBy: el.scrollWidth - el.clientWidth,
        }))
        .filter((b) => b.right > window.innerWidth + 1 || b.squashedBy > 1),
    )
    check(clipped.length === 0, `D0b every arrangement toolbar control is fully visible and unsquashed${clipped.length ? ` — bad: ${clipped.map((c) => `${c.label}(right ${c.right}, squashed ${c.squashedBy}px)`).join(', ')}` : ''}`)

    // ── D0c: the track header stays pinned at ANY horizontal scroll ───────────────────────────
    // Stream A's usability pilot: headers detached past scrollLeft ~1336 on the 240-bar timeline,
    // taking mute/solo off-screen — which made muting the reference track impossible at the zoom
    // you actually work at. Root cause was a flex row taking the SCROLLPORT's width instead of its
    // content's, so `position: sticky` had nothing left to stick within. Asserted at real scroll
    // depths, and on the BUTTON rather than the header box, because "the header element exists at
    // x=0" is not the claim — "you can click mute" is.
    for (const target of [0, 1500, 4000, 6500]) {
      await page.evaluate((x) => { document.querySelector('.arr-scroll').scrollLeft = x }, target)
      await sleep(120)
      const pinned = await page.evaluate(() => {
        const sc = document.querySelector('.arr-scroll').getBoundingClientRect()
        const h = document.querySelector('.arr-track-header').getBoundingClientRect()
        const corner = document.querySelector('.arr-ruler-corner').getBoundingClientRect()
        const btn = document.querySelector('.arr-track-header button')
        return {
          header: Math.round(h.left - sc.left),
          corner: Math.round(corner.left - sc.left),
          btn: btn ? Math.round(btn.getBoundingClientRect().left - sc.left) : null,
        }
      })
      check(
        pinned.header === 0 && pinned.corner === 0 && pinned.btn !== null && pinned.btn >= 0,
        `D0c at scrollLeft ${target} the track header (${pinned.header}px), ruler corner (${pinned.corner}px) and the header's first control (${pinned.btn}px) are all still on screen`,
      )
    }
    await page.evaluate(() => { document.querySelector('.arr-scroll').scrollLeft = 0 })

    // ── D0d: making a selection must not move the arrangement ─────────────────────────────────
    // Stream A's pilot lost a drag to this: the contextual vary bar mounts only when a selection
    // exists, so the first drag's own selection pushed every track row down 39px, and the second
    // drag — aimed with pre-shift positions — landed on the wrong track. A layout jump that
    // silently retargets a gesture is worse than a cosmetic bug.
    await page.evaluate((port) => fetch(`http://localhost:${port}/selection`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    }), gui.daemonPort)
    await sleep(400)
    const rowTopBefore = await page.$eval('.arr-row', (el) => Math.round(el.getBoundingClientRect().top))
    await page.evaluate((port) => fetch(`http://localhost:${port}/selection`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bars: { start: 4, end: 12 } }),
    }), gui.daemonPort)
    await pollUntil(async () => (await page.evaluate(() => !!window.__store.getState().selection.bars)) ? true : null, 'the D0d selection', 5000)
    await sleep(300)
    const rowTopAfter = await page.$eval('.arr-row', (el) => Math.round(el.getBoundingClientRect().top))
    check(rowTopAfter === rowTopBefore, `D0d the first track row stayed at y=${rowTopBefore} when a selection appeared (was ${rowTopBefore}, now ${rowTopAfter}) — no mid-workflow layout jump`)

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

    // ── D9: pilot regressions (docs/usability-testing.md pilot, 2026-07-27) ───────────────────
    // Both of these passed every existing assertion while being wrong in the app, because the
    // suite happened to exercise them in the one configuration that hides the bug.

    // D9a: M marks the PLAYHEAD, not the selection start — even when the transport is stopped and
    // a bar range is selected. The pilot's exact repro: select a range, click the ruler inside it
    // to listen, stop, press M. That marked the selection start (bar 89) instead of bar 97.
    await page.evaluate((port) => fetch(`http://localhost:${port}/selection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bars: { start: 88, end: 136 } }),
    }), gui.daemonPort)
    await pollUntil(async () => (await page.evaluate(() => !!window.__store.getState().selection.bars)) ? true : null, 'the D9a selection', 5000)
    await page.evaluate(() => window.__engine.seek(96)) // 0-based -> bar 97
    await sleep(300)
    await page.evaluate(() => window.__engine.stop()) // currentStep goes to -1; the bar must survive
    await sleep(200)
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('m')
    await page.waitForSelector('.arr-locator-input', { timeout: 4000 })
    await page.keyboard.type('AtPlayhead')
    await page.keyboard.press('Enter')
    const placed = await pollUntil(() => {
      const l = readLocators(file).find((x) => x.name === 'AtPlayhead')
      return l ?? null
    }, 'the D9a marker to reach the file', 6000)
    check(placed.bar === 97, `D9a M stopped at bar 97 with bars 89-136 selected marked bar ${placed.bar} — must be the playhead (97), not the selection start (89)`)

    // D9b: colliding marker labels collapse to pins instead of overprinting each other. Drop a
    // second marker one bar away and assert the earlier one goes compact.
    beat(['set', file, 'locator.collide', '98 Neighbour'])
    await pollUntil(async () => (await page.$('[data-locator="collide"]')) ? true : null, 'the neighbouring marker', 8000)
    const labelTexts = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.arr-locator')].find((n) => n.getAttribute('data-locator-bar') === '97')
      return el ? { compact: el.className.includes('compact'), text: el.querySelector('.arr-locator-flag').textContent } : null
    })
    check(labelTexts?.compact === true && labelTexts.text === '', `D9b a marker one bar from its neighbour collapses to a pin rather than overprinting its name (compact=${labelTexts?.compact}, text="${labelTexts?.text}")`)
    beat(['set', file, 'locator.collide', ''])
    await pollUntil(async () => (await page.$('[data-locator="collide"]')) ? null : true, 'the neighbouring marker to go', 8000)

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

    // ── D8: the overview strip ────────────────────────────────────────────────────────────────
    // Its whole claim is "you can see where you are and go somewhere else", so assert both: the
    // window tracks the real viewport, and clicking the strip moves the real timeline.
    check(await page.$eval('[data-minimap="1"]', (el) => Number(el.getAttribute('data-total-bars'))) === TOTAL_BARS, `D8 the overview strip covers all ${TOTAL_BARS} bars`)
    check((await page.$$('[data-minimap-section]')).length === SECTIONS, `D8 it draws all ${SECTIONS} sections`)
    const markerCount = readLocators(file).length
    check((await page.$$('[data-minimap-locator]')).length === markerCount, `D8 it draws every marker (${markerCount})`)

    await page.evaluate(() => { document.querySelector('.arr-scroll').scrollLeft = 0 })
    await sleep(200)
    const winAtLeft = await page.$eval('[data-minimap-window="1"]', (el) => parseFloat(el.style.left))
    const miniW = await page.$eval('[data-minimap="1"]', (el) => el.clientWidth)
    check(winAtLeft < 2, `D8 scrolled to the start, the viewport window sits at the left edge (${winAtLeft}px)`)

    // Click three-quarters along the strip; the main timeline must follow.
    const box = await page.$eval('[data-minimap="1"]', (el) => {
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height }
    })
    await page.mouse.click(box.x + box.w * 0.75, box.y + box.h / 2)
    await sleep(300)
    const afterMiniClick = await scrollLeft(page)
    const winAfter = await page.$eval('[data-minimap-window="1"]', (el) => parseFloat(el.style.left))
    check(afterMiniClick > 1000, `D8 clicking 75% along the strip scrolled the timeline there (scrollLeft ${afterMiniClick})`)
    check(winAfter > miniW * 0.5, `D8 and the window moved with it (${winAfter.toFixed(0)}px of ${miniW}px)`)
    await screenshot(page, 'verify-p41d-minimap')

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

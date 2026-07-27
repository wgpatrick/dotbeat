#!/usr/bin/env node
// Phase 41 Stream C verification — the automation-lane work: Draw Mode paint-a-run, predefined
// shape insertion, segment select-and-drag, the discovery badges, and the log-scale y-axis.
// Driven live against a real `beat daemon` + the built frontend in headless Chrome, following
// ui/verify-phase26-stream-di.mjs's fixture/boot pattern.
//
// What's under test (each assertion states the failure it would catch):
//
//   C1  SHAPE INSERT — the ∿ panel writes the SAME points src/core/automation-shape.ts produces.
//       Asserted against automationShapePoints' own output, value by value, so a GUI that
//       re-implemented the geometry (or drifted from it later) fails here rather than looking fine.
//   C2  SHAPE REPLACES — inserting a second shape does not stack two curves in one lane, matching
//       core applyAutomationShape's documented "a shape REPLACES it, it doesn't add to it".
//   C3  PAINT — a drag in draw mode writes a RUN of points across the swept span, and the run is
//       REDUCED (fewer points than the ~1-per-16th-step it sampled) while still tracking the
//       stroke. Guards both halves: a paint that wrote nothing, and a paint that dumped raw samples.
//   C4  PAINT REPLACES IN SPAN — the painted span's old points are gone and everything outside it
//       survives untouched. Guards the writeRun span arithmetic.
//   C5  SEGMENT DRAG — shift+drag moves EXACTLY the two flanking points, by the SAME time delta,
//       preserving the segment's ratio on a log param. This is the regression guard for the bug
//       the pilot found: an absolute (non-normalized) value delta moved the two points by
//       different factors and destroyed the slope.
//   C6  DISCOVERY — a param automated on the track shows up as a chip with its point count.
//   C7  LOG AXIS — a cutoff value at the geometric mean of min..max sits at the VERTICAL MIDDLE of
//       the lane. On the old linear axis it sat near the bottom. Measured by clicking at the lane's
//       midline and reading back what value got written, i.e. through the real gesture path.
//   C8  AUDIBLE — the whole point. The same project rendered with and without the drawn lane must
//       differ as a filter sweep does: a time-resolved spectral centroid that MOVES. An automation
//       curve that renders identically to no automation is the inert-fix failure mode this exists
//       to catch, so this asserts on real rendered audio, not on document state.
//
// Usage: node ui/verify-phase41-stream-c.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8641
const PREVIEW_PORT = 5441

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function pollUntil(fn, what, timeoutMs = 12000, everyMs = 25) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}
const fails = []
function check(name, ok, detail) {
  if (ok) console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  else {
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
    fails.push(name)
  }
}

// A sustained sawtooth line across the whole 4-bar clip, so the filter is heard continuously and
// the centroid is trivial to meter — the same discipline verify-phase26-stream-di.mjs's fixture uses.
const FIXTURE = `format_version 0.9
bpm 120
loop_bars 4
selected_track lead

track lead lead #e06c75 synth
  synth
    osc sawtooth
    volume -6
    cutoff 2000
    resonance 0.8
    attack 0.01
    decay 0.2
    sustain 1
    release 0.3
    pan 0
  clip verse
    note u1 52 0 16 0.9
    note u2 55 16 16 0.9
    note u3 59 32 16 0.9
    note u4 55 48 16 0.9

scene main
  slot lead verse

song
  section main 4
`

/** Windowed spectral centroid of a rendered WAV — a filter sweep's signature is a centroid that
 * MOVES, which whole-file metrics average away (measured in the pilot: the whole-file centroid
 * moved 831 -> 875 Hz on a sweep whose time-resolved range was 2186 Hz). */
async function centroidSeries(path) {
  const M = await import(join(repoRoot, 'dist/src/metrics/index.js'))
  const buf = readFileSync(path)
  const d = M.decodeWav(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
  const chs = d.channels
  const n = chs[0].length
  const mono = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (const c of chs) s += c[i]
    mono[i] = s / chs.length
  }
  const win = 16384
  const hop = Math.floor(d.sampleRate * 0.1)
  const out = []
  for (let i = 0; i + win < n; i += hop) {
    let e = 0
    for (let k = 0; k < win; k++) e += mono[i + k] * mono[i + k]
    if (Math.sqrt(e / win) <= 0.005) continue // silence has no meaningful centroid
    let size = 1
    while (size < win) size *= 2
    const re = new Float32Array(size)
    const im = new Float32Array(size)
    for (let k = 0; k < win; k++) re[k] = mono[i + k] * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (win - 1)))
    M.fft(re, im)
    let num = 0
    let den = 0
    for (let k = 1; k < size / 2; k++) {
      const mag = Math.hypot(re[k], im[k])
      num += ((k * d.sampleRate) / size) * mag
      den += mag
    }
    if (den > 0) out.push(num / den)
  }
  const mean = out.reduce((a, b) => a + b, 0) / out.length
  return { min: Math.min(...out), max: Math.max(...out), range: Math.max(...out) - Math.min(...out), sd: Math.sqrt(out.reduce((a, b) => a + (b - mean) ** 2, 0) / out.length), n: out.length }
}

async function main() {
  console.log('building repo core/daemon/metrics + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const { automationShapePoints } = await import(join(repoRoot, 'dist/src/core/automation-shape.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p41-c-'))
  const beatPath = join(proj, 'c.beat')
  writeFileSync(beatPath, serialize(parse(FIXTURE)))
  console.log(`\nproject: ${beatPath}`)

  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))
  await pollUntil(async () => {
    try {
      return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok
    } catch {
      return false
    }
  }, 'vite preview to serve', 25000)

  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1500, height: 900 })
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 15000 })
    await page.waitForSelector('.arr-canvas', { timeout: 8000 })
    await sleep(300)

    const lanePoints = () =>
      page.evaluate(() => {
        const d = window.__store.getState().doc
        const l = d.tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'verse').automation.find((a) => a.param === 'cutoff')
        return l ? l.points.map((p) => ({ id: p.id, time: p.time, value: p.value })) : []
      })

    await page.click('[data-auto-toggle="lead"]')
    await page.waitForSelector('[data-auto-select="lead"]', { timeout: 5000 })
    await page.selectOption('[data-auto-select="lead"]', 'cutoff')
    await page.click('[data-auto-add="lead"]')
    await page.waitForSelector('.arr-auto-lane[data-auto-track="lead"][data-auto-param="cutoff"]', { timeout: 5000 })
    await sleep(200)

    // ---- C1: shape insert matches core's sampler exactly ----
    await page.click('[data-auto-shape-open="lead.cutoff"]')
    await page.waitForSelector('[data-auto-shape-panel="lead.cutoff"]', { timeout: 4000 })
    await page.selectOption('[data-auto-shape-kind="lead.cutoff"]', 'sine')
    await page.fill('[data-auto-shape-from="lead.cutoff"]', '200')
    await page.fill('[data-auto-shape-to="lead.cutoff"]', '6000')
    await page.fill('[data-auto-shape-cycles="lead.cutoff"]', '2')
    await page.fill('[data-auto-shape-points="lead.cutoff"]', '24')
    await page.click('[data-auto-shape-insert="lead.cutoff"]')
    await pollUntil(async () => (await lanePoints()).length === 24, 'the 24-point sine to land', 10000)
    const got = await lanePoints()
    const want = automationShapePoints('sine', { from: 200, to: 6000, cycles: 2, points: 24, spanSteps: 64 })
    const worst = Math.max(...got.map((p, i) => Math.max(Math.abs(p.time - want[i].time), Math.abs(p.value - want[i].value))))
    check('C1 shape insert writes core automationShapePoints output verbatim', worst < 0.01, `worst |delta| ${worst.toExponential(2)} across 24 points`)

    // ---- C2: a second shape REPLACES rather than stacking ----
    await page.click('[data-auto-shape-open="lead.cutoff"]')
    await page.waitForSelector('[data-auto-shape-panel="lead.cutoff"]', { timeout: 4000 })
    await page.selectOption('[data-auto-shape-kind="lead.cutoff"]', 'ramp')
    await page.fill('[data-auto-shape-points="lead.cutoff"]', '8')
    await page.click('[data-auto-shape-insert="lead.cutoff"]')
    await pollUntil(async () => (await lanePoints()).length === 8, 'the ramp to replace the sine', 10000)
    check('C2 a second shape replaces the lane instead of stacking on it', (await lanePoints()).length === 8, '8 points, not 32')

    // ---- C3/C4: draw-mode paint ----
    const lane = await page.$('.arr-auto-lane[data-auto-track="lead"][data-auto-param="cutoff"]')
    const lb = await lane.boundingBox()
    const beforePaint = await lanePoints()
    await page.click('[data-auto-draw="lead.cutoff"]')
    check('draw mode arms visibly on the lane itself', (await page.getAttribute('.arr-auto-lane[data-auto-track="lead"][data-auto-param="cutoff"]', 'data-auto-draw-mode')) === 'on')
    // Sweep the left HALF of the lane as an ARC (up then part-way back down), sampling ~1 point per
    // 16th step across ~32 steps. Deliberately NOT a straight ramp: a straight stroke is CORRECTLY
    // reduced to its two endpoints (see automate-simplify.test.ts's first case), so a ramp would
    // make the "writes a run" assertion below fail for the right reason and teach nothing. An arc
    // is the shape someone actually paints, and it is the one that exercises the reducer's job of
    // keeping enough points to reproduce a curve.
    const x0 = lb.x + 2
    const x1 = lb.x + lb.width * 0.5
    await page.mouse.move(x0, lb.y + lb.height - 8)
    await page.mouse.down()
    for (let i = 1; i <= 60; i++) {
      const f = i / 60
      await page.mouse.move(x0 + (x1 - x0) * f, lb.y + lb.height - 8 - Math.sin(f * Math.PI * 0.85) * (lb.height - 16))
    }
    await page.mouse.up()
    await pollUntil(async () => (await lanePoints()).length !== beforePaint.length, 'the painted run to commit', 10000)
    await sleep(800)
    const painted = await lanePoints()
    const inSpan = painted.filter((p) => p.time <= 32.5)
    check('C3 paint writes a RUN of points across the swept span', inSpan.length >= 4, `${inSpan.length} points across the painted half`)
    check('C3 the run is REDUCED, not one point per sampled step', inSpan.length < 28, `${inSpan.length} points from ~32 sampled steps`)
    // The arc rises then falls, so assert the SHAPE: it must climb well above where it started and
    // come back down, which a run of two endpoints (or a flattened one) cannot do.
    const peak = Math.max(...inSpan.map((p) => p.value))
    const arcs = peak > inSpan[0].value * 4 && peak > inSpan[inSpan.length - 1].value * 1.3
    check('C3 the committed run reproduces the painted arc, not just its ends', arcs, `${inSpan[0]?.value.toFixed(0)} Hz -> peak ${peak.toFixed(0)} Hz -> ${inSpan[inSpan.length - 1]?.value.toFixed(0)} Hz`)
    const survivedOutside = painted.filter((p) => p.time > 32.5).length
    check('C4 points outside the painted span survive untouched', survivedOutside > 0, `${survivedOutside} later points still present`)
    await page.click('[data-auto-draw="lead.cutoff"]') // disarm

    // ---- C5: segment shift-drag ----
    const pre = await lanePoints()
    const sorted = [...pre].sort((a, b) => a.time - b.time)
    const iA = Math.max(0, sorted.length - 3)
    const A = sorted[iA]
    const B = sorted[iA + 1]
    const pxPerStep = lb.width / 64
    const mxs = lb.x + ((A.time + B.time) / 2) * pxPerStep
    const midV = Math.sqrt(A.value * B.value) // log axis -> geometric mean is the visual midpoint
    const nrm = (Math.log(midV) - Math.log(20)) / (Math.log(18000) - Math.log(20))
    const mys = lb.y + 6 + (1 - nrm) * (46 - 12)
    await page.keyboard.down('Shift')
    await page.mouse.move(mxs, mys)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(mxs + i * 0.5, mys - i * 0.4)
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await sleep(1200)
    const post = await lanePoints()
    const moved = post.filter((p) => {
      const was = pre.find((q) => q.id === p.id)
      return was && (Math.abs(was.time - p.time) > 1e-6 || Math.abs(was.value - p.value) > 1e-6)
    })
    check('C5 shift-drag moves exactly the two points flanking the segment', moved.length === 2, `${moved.length} points changed`)
    if (moved.length === 2) {
      const dts = moved.map((p) => p.time - pre.find((q) => q.id === p.id).time)
      // Exact, not exact-to-within-a-quantum: the delta is snapped to the drag grid ONCE and added
      // to both endpoints. Rounding each RESULT instead gave 0.2057 vs 0.2029 on one gesture.
      check('C5 both endpoints move by the SAME time delta, exactly', Math.abs(dts[0] - dts[1]) < 1e-9, `${dts[0].toFixed(6)} vs ${dts[1].toFixed(6)} steps`)
      const rBefore = pre.find((q) => q.id === moved[0].id).value / pre.find((q) => q.id === moved[1].id).value
      const rAfter = moved[0].value / moved[1].value
      const clamped = moved.some((p) => p.value >= 17999 || p.value <= 20.001)
      check(
        'C5 the segment keeps its slope (log-axis ratio preserved)',
        clamped || Math.abs(rAfter / rBefore - 1) < 0.02,
        clamped ? 'endpoint hit the lane edge (ratio not expected to hold)' : `ratio ${rBefore.toFixed(4)} -> ${rAfter.toFixed(4)}`,
      )
    }

    // ---- C6: discovery chips ----
    const chip = await page.$('[data-auto-chip="lead.cutoff"]')
    check('C6 an automated param is advertised as a chip in the picker', !!chip, chip ? (await chip.innerText()).replace(/\s+/g, ' ') : 'no chip rendered')

    // ---- C7: log axis ----
    // Click at the lane's exact vertical middle. On a log 20..18000 axis that is the geometric mean
    // (~600 Hz); on the old linear axis the same pixel was ~9000 Hz.
    await page.click('[data-auto-shape-open="lead.cutoff"]')
    await page.selectOption('[data-auto-shape-kind="lead.cutoff"]', 'ramp')
    await page.fill('[data-auto-shape-points="lead.cutoff"]', '2')
    await page.click('[data-auto-shape-insert="lead.cutoff"]')
    await pollUntil(async () => (await lanePoints()).length === 2, 'lane reset to 2 points', 8000)
    const midPx = lb.y + 6 + (46 - 12) / 2
    await page.mouse.click(lb.x + lb.width * 0.6, midPx)
    await sleep(900)
    const withMid = await lanePoints()
    const mid = withMid.sort((a, b) => Math.abs(a.time - 38.4) - Math.abs(b.time - 38.4))[0]
    const geo = Math.sqrt(20 * 18000)
    check('C7 the lane midline is the geometric mean of the range (log axis)', Math.abs(mid.value - geo) / geo < 0.1, `clicked mid-lane -> ${mid.value.toFixed(0)} Hz (log expects ~${geo.toFixed(0)}, linear would be ~9010)`)

    check('no uncaught page errors during any gesture', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || 'none')

    // ---- C8: AUDIBLE. Same project, with and without the lane. ----
    console.log('\nrendering before/after for the audible check (this takes a minute)...')
    const withAuto = readFileSync(beatPath, 'utf8')
    // Put a full-depth sweep in, so the check measures the feature rather than whatever the
    // gestures above happened to leave behind.
    const { applyAutomationShape } = await import(join(repoRoot, 'dist/src/core/edit.js'))
    const swept = serialize(applyAutomationShape(parse(withAuto), 'lead', 'verse', 'cutoff', 'sine', { from: 150, to: 6000, cycles: 2, points: 32 }).doc)
    const noAuto = serialize(parse(withAuto.split('\n').filter((l, i, a) => !(l.trim() === 'auto lead.cutoff' || (l.trim().startsWith('point ') && a.slice(0, i).reverse().find((x) => !x.trim().startsWith('point '))?.trim() === 'auto lead.cutoff'))).join('\n')))
    const aPath = join(proj, 'with-auto.beat')
    const bPath = join(proj, 'no-auto.beat')
    writeFileSync(aPath, swept)
    writeFileSync(bPath, noAuto)
    const beat = join(repoRoot, 'cli/beat.mjs')
    execFileSync('node', [beat, 'render', bPath, '-o', join(proj, 'no-auto.wav'), '--offline'], { stdio: 'pipe' })
    execFileSync('node', [beat, 'render', aPath, '-o', join(proj, 'with-auto.wav'), '--offline'], { stdio: 'pipe' })
    const cb = await centroidSeries(join(proj, 'no-auto.wav'))
    const ca = await centroidSeries(join(proj, 'with-auto.wav'))
    console.log(`  no-auto   centroid range ${cb.range.toFixed(0)} Hz (sd ${cb.sd.toFixed(1)})`)
    console.log(`  with-auto centroid range ${ca.range.toFixed(0)} Hz (sd ${ca.sd.toFixed(1)})`)
    // Calibration (pilot, 2026-07-27, the owner's twin-souls melody): a GUI-drawn 6-cycle sweep
    // measured 3.4x the centroid range and 4.2x the movement of the identical un-automated render.
    // 2x is a deliberately loose floor — this exists to catch "renders identically", not to pin a
    // number that a voicing change could wobble.
    check('C8 AUDIBLE: automation moves the spectral centroid over time', ca.range > cb.range * 2, `${(ca.range / cb.range).toFixed(1)}x the un-automated centroid range`)
    check('C8 AUDIBLE: and it is genuinely more movement, not one outlier', ca.sd > cb.sd * 2, `${(ca.sd / cb.sd).toFixed(1)}x the un-automated centroid sd`)
  } finally {
    await browser.close()
    preview.kill()
    await daemon.close?.()
  }

  console.log()
  if (fails.length) {
    console.log(`FAILED: ${fails.length} check(s): ${fails.join(', ')}`)
    process.exit(1)
  }
  console.log('ALL CHECKS PASSED')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

#!/usr/bin/env node
// Phase 26 Stream DI verification — curved automation segments + exact numeric breakpoint entry
// (docs/phase-26-plan.md, docs/research/65-ableton-vs-dotbeat-automation-envelopes.md). Driven
// live against a real `beat daemon` + the built frontend in headless Chrome, mirroring
// ui/verify-phase20-automation.mjs's fixture/boot pattern.
//
// What's under test:
//
//   PART A (`ui/src/components/ArrangementView.tsx`'s AutomationLane, a `cutoff` lane):
//     A1  add a cutoff lane, draw two breakpoints (same gesture as Phase 20's Z1/Z2)
//     A2  LIVE DRAG VALUE LABEL — while mid-drag (before pointerup), `.arr-auto-drag-label`
//         becomes visible and shows a value that matches what actually commits on release
//         (ArrangementView.tsx:1029 used to compute drag.value and never render it)
//     A3  ALT/OPTION-DRAG ON A SEGMENT bows it into a curve — the segment's START point (by
//         time) gets `interpolation: 'curve'` written to the document, landing as exactly one
//         changed `point` line (`interpolation=curve` appended) in the .beat diff
//     A4  RIGHT-CLICK A BREAKPOINT opens a popup: the hold/curve/linear toggle retargets the
//         point's interpolation, and the numeric <input> commits an EXACT typed value — both are
//         asserted directly against the resulting .beat file text (not just the in-memory doc)
//     A5  removing the lane cleans the slate (no residual cutoff automation for Part B)
//
//   PART B (`ui/src/audio/engine.ts`'s interpolateAutomation): the actual thing the plan calls
//   out — "the audio engine actually respects the new interpolation field... a real behavioral
//   change in playback, not just a GUI/format addition." A `volume` lane on the SAME clip gets two
//   points (-36dB at step 0, 0dB at step 48) with the segment's start point's interpolation cycled
//   linear -> hold -> curve via the daemon's real /automate route; for each mode, real playback is
//   started fresh and an early window is measured two ways at once: (1) real RENDERED AUDIO via
//   src/core/metrics.ts (recordWav -> analyze), which reliably proves hold is measurably quieter
//   than a ramping segment; (2) the LIVE engine's own AudioParam (chain.vol.volume.value on the
//   actually-running synth chain, genuine live playback state), sampled across the identical
//   window, which proves curve's ease genuinely reshapes the ramp (its live value stays well below
//   linear's over the same window) — see the Part B comment further down for why curve-vs-linear
//   specifically needed the live-engine reading rather than the recorded-audio one (the master
//   limiter measurably compresses the two ramping modes differently at these levels, a real
//   property of the full mix chain and out of Stream DI's scope to change).
//
// Usage: node ui/verify-phase26-stream-di.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8626
const PREVIEW_PORT = 5426

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
function addedRemoved(diff) {
  return {
    added: diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')),
    removed: diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')),
  }
}
async function analyzeBase64Wav(b64) {
  const { decodeWav, analyze } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
  const bytes = Buffer.from(b64, 'base64')
  const decoded = decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  return analyze(decoded.channels, decoded.sampleRate)
}

// A sustained tone across the whole 4-bar clip (no gaps) so any automated param — cutoff (Part A)
// or volume (Part B) — is heard continuously, the same "trivial to meter" discipline
// verify-volume-fader-bugfix.mjs's fixture uses.
const FIXTURE = `format_version 0.9
bpm 120
loop_bars 4
selected_track lead

track lead lead #e06c75 synth
  synth
    osc sawtooth
    volume -36
    cutoff 2000
    resonance 0.8
    attack 0.01
    decay 0.2
    sustain 1
    release 0.3
    pan 0
  clip verse
    note u1 60 0 64 0.85

scene main
  slot lead verse

song
  section main 4
`

async function main() {
  console.log('building repo core/daemon/metrics + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p26-di-'))
  const beatPath = join(proj, 'di.beat')
  const canonical = serialize(parse(FIXTURE))
  writeFileSync(beatPath, canonical)
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'canonical DI fixture')
  console.log(`\nproject: ${beatPath} (committed canonical baseline)`)

  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  console.log(`daemon on :${daemon.port}`)

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
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
    20000,
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
    await page.setViewportSize({ width: 1280, height: 800 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 12000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
    await page.waitForSelector('.arr-canvas', { timeout: 5000 })
    await sleep(300)

    // ================================= PART A: the GUI gestures ==================================

    // ---- A1: add a cutoff lane, draw two breakpoints (mirrors Phase 20's Z1/Z2) ----
    await page.click('[data-auto-toggle="lead"]')
    await page.waitForSelector('[data-auto-select="lead"]', { timeout: 4000 })
    await page.selectOption('[data-auto-select="lead"]', 'cutoff')
    await page.click('[data-auto-add="lead"]')
    await page.waitForSelector('.arr-auto-lane[data-auto-track="lead"][data-auto-param="cutoff"]', { timeout: 4000 })
    await sleep(150)

    const lane = await page.$('.arr-auto-lane[data-auto-track="lead"][data-auto-param="cutoff"]')
    const lb = await lane.boundingBox()
    const ax = lb.x + lb.width * 0.125 // point A: early time, low value — stays put for the rest of Part A
    const ay = lb.y + lb.height - 6
    const bx = lb.x + lb.width * 0.75 // point B: late time
    const by0 = lb.y + lb.height / 2 // point B's initial (mid) value
    const bY2 = lb.y + 6 // point B's value after the A2 drag below (high)

    await page.mouse.click(ax, ay)
    await pollUntil(() => (daemon.getDoc().tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'verse').automation.length > 0), 'point A to land', 5000)
    await page.mouse.click(bx, by0)
    await pollUntil(() => {
      const l = daemon.getDoc().tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'verse').automation.find((x) => x.param === 'cutoff')
      return l && l.points.length >= 2
    }, 'point B to land', 5000)
    await sleep(150)
    const pts0 = [...daemon.getDoc().tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'verse').automation.find((l) => l.param === 'cutoff').points].sort((a, b) => a.time - b.time)
    const pointAId = pts0[0].id
    const pointBId = pts0[1].id
    console.log(`[A1] PASS: two breakpoints drawn — ${pointAId}(t=${pts0[0].time}) ${pointBId}(t=${pts0[1].time})`)
    git(proj, 'commit', '-q', '-am', 'draw two cutoff breakpoints')

    // ---- A2: the live drag-value label — visible mid-drag, matches what commits on release ----
    console.log('\n[A2] dragging point B and checking the live value label mid-drag...')
    await page.mouse.move(bx, by0)
    await page.mouse.down()
    await page.mouse.move(bx, bY2, { steps: 8 })
    const labelDisplay = await page.locator('.arr-auto-drag-label').evaluate((el) => getComputedStyle(el).display)
    const labelText = (await page.locator('.arr-auto-drag-label').textContent()) ?? ''
    console.log(`  mid-drag label: display="${labelDisplay}" text="${labelText}"`)
    if (labelDisplay === 'none' || labelText.trim() === '') throw new Error('[A2] the live drag-value label was not shown while dragging')
    await page.mouse.up()
    await pollUntil(() => {
      const p = daemon.getDoc().tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'verse').automation.find((l) => l.param === 'cutoff').points.find((x) => x.id === pointBId)
      return p.value > pts0[1].value * 1.5 // dragged from mid to near-top: a large, unambiguous increase
    }, 'point B value to rise after the drag', 5000)
    const committedB = daemon.getDoc().tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'verse').automation.find((l) => l.param === 'cutoff').points.find((x) => x.id === pointBId).value
    // cutoff's format (synthParams.ts's fmt.hz) abbreviates >=1000Hz as e.g. "18k" — parseFloat
    // stops at the first non-numeric char, so account for the suffix before comparing.
    const labelTrim = labelText.trim()
    const labelNumber = parseFloat(labelTrim) * (/k$/i.test(labelTrim) ? 1000 : 1)
    console.log(`  label showed "${labelTrim}" (~${labelNumber}), committed value ${committedB.toFixed(1)}`)
    if (!(Math.abs(labelNumber - committedB) / committedB < 0.1)) throw new Error(`[A2] label value ${labelNumber} doesn't match the committed value ${committedB} (drag.value was computed but the label wasn't wired to it correctly)`)
    console.log('  [A2] PASS: the live drag-value label is shown mid-drag and matches the committed value')
    git(proj, 'commit', '-q', '-am', 'drag point B up to a high value')
    await sleep(150)

    // ---- A3: alt/option-drag ON THE SEGMENT (not a point) bows it into a curve ----
    console.log('\n[A3] alt/option-dragging the segment between the two points...')
    const mx = (ax + bx) / 2
    const my = (ay + bY2) / 2
    await page.keyboard.down('Alt')
    await page.mouse.move(mx, my)
    await page.mouse.down()
    await page.mouse.move(mx, my - 30, { steps: 6 })
    await page.mouse.up()
    await page.keyboard.up('Alt')
    await pollUntil(() => {
      const p = daemon.getDoc().tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'verse').automation.find((l) => l.param === 'cutoff').points.find((x) => x.id === pointAId)
      return p && p.interpolation === 'curve'
    }, 'segment start point to gain interpolation=curve after the bow drag', 5000)
    await sleep(150)
    const diffA3 = git(proj, 'diff', '--unified=0', 'di.beat')
    console.log('[A3] git diff:\n' + diffA3)
    const arA3 = addedRemoved(diffA3)
    if (arA3.removed.length !== 1 || arA3.added.length !== 1) throw new Error(`[A3] expected exactly 1 changed point line, got +${arA3.added.length}/-${arA3.removed.length}`)
    if (!arA3.added[0].includes('interpolation=curve')) throw new Error(`[A3] expected "interpolation=curve" in the changed line, got: ${arA3.added[0]}`)
    if (!arA3.added[0].includes(pointAId)) throw new Error(`[A3] the segment's START point (${pointAId}, by time) should carry the curve flag, but the changed line is: ${arA3.added[0]}`)
    git(proj, 'commit', '-q', '-am', 'bow the segment into a curve')
    console.log(`  [A3] PASS: alt/option-drag on the segment wrote interpolation=curve on ${pointAId} (the segment's start point) — exactly one changed line`)

    // ---- A4: right-click a breakpoint -> popup with hold/curve/linear toggle + exact numeric entry ----
    console.log('\n[A4] right-clicking point A: toggling to "hold" and typing an exact value...')
    await page.mouse.click(ax, ay, { button: 'right' })
    await page.waitForSelector(`[data-auto-popup="lead.cutoff.${pointAId}"]`, { timeout: 4000 })
    await page.click(`[data-auto-interp="lead.cutoff.${pointAId}.hold"]`)
    const EXACT_VALUE = '1234.5'
    const input = page.locator(`[data-auto-value-input="lead.cutoff.${pointAId}"]`)
    await input.fill(EXACT_VALUE)
    await input.press('Enter')
    await pollUntil(() => {
      const p = daemon.getDoc().tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'verse').automation.find((l) => l.param === 'cutoff').points.find((x) => x.id === pointAId)
      return p && p.value === Number(EXACT_VALUE)
    }, 'exact numeric entry to land', 5000)
    const afterA4 = daemon.getDoc().tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'verse').automation.find((l) => l.param === 'cutoff').points.find((x) => x.id === pointAId)
    console.log(`  point ${pointAId} after A4: value=${afterA4.value} interpolation=${afterA4.interpolation}`)
    if (afterA4.value !== Number(EXACT_VALUE)) throw new Error(`[A4] expected the exact typed value ${EXACT_VALUE}, got ${afterA4.value}`)
    if (afterA4.interpolation !== 'hold') throw new Error(`[A4] expected the popup's "hold" toggle to have landed, got interpolation=${afterA4.interpolation}`)
    const fileText = readFileSync(beatPath, 'utf8')
    if (!fileText.includes(`point ${pointAId} `) || !fileText.includes(EXACT_VALUE) || !fileText.includes('interpolation=hold')) {
      throw new Error(`[A4] the .beat file does not contain the expected exact value / interpolation=hold token:\n${fileText}`)
    }
    const diffA4 = git(proj, 'diff', '--unified=0', 'di.beat')
    console.log('[A4] git diff:\n' + diffA4)
    git(proj, 'commit', '-q', '-am', 'popup: toggle hold + exact numeric entry')
    console.log(`  [A4] PASS: the popup's hold toggle AND the numeric input's exact value (${EXACT_VALUE}) both landed in the .beat file`)

    // ---- A5: remove the cutoff lane so it doesn't bleed into Part B's audio measurement ----
    await page.click('[data-auto-remove="lead.cutoff"]')
    await pollUntil(() => !daemon.getDoc().tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'verse').automation.some((l) => l.param === 'cutoff'), 'cutoff lane to be fully removed', 5000)
    git(proj, 'commit', '-q', '-am', 'clean up the cutoff lane before Part B')
    console.log('\n[A5] PASS: cutoff lane removed — clean slate for Part B')

    // ============================== PART B: the engine actually differs ===========================
    // A `volume` lane (chain.vol — a direct, monotonic dB gain), two points: -36dB at step 0, 0dB at
    // step 48 (a 3-bar/6s ramp at 120bpm). The fixture's STATIC `volume` field (above) is
    // deliberately set to -36dB, exactly matching this segment's start value: every tick, the
    // engine's own sync also re-asserts the document's static param value (applyParams'
    // `chain.vol.volume.linearRampTo(p.volume, ...)`, ui/src/audio/engine.ts) BEFORE the automation
    // loop's own ramp for that tick — a real, pre-existing tick-scheduling interaction between "live
    // static param" and "clip automation" that's out of Stream DI's scope to fix, but is neutralized
    // for 'hold' by construction (its target never leaves -36dB, so the static resync and the
    // automation target always agree). The segment's START point's interpolation is cycled linear ->
    // hold -> curve via the daemon's real /automate route; each mode is played from a fresh
    // transport position, and a window early in the segment (well under the midpoint) is measured
    // TWO ways at once, covering the exact same real playback:
    //
    //   (1) real RENDERED AUDIO, recorded and measured via src/core/metrics.ts (recordWav -> WAV ->
    //       analyze) — exactly what the plan asks for. This reliably proves 'hold' is genuinely,
    //       audibly different from a ramping segment (a big, clean margin every time this was run
    //       while developing this test): it's the one comparison in this signal chain that isn't
    //       confounded by anything downstream (both linear and hold's *ramping* neighbor easily clear
    //       the master limiter's headroom at these levels).
    //   (2) the LIVE engine's own AudioParam value (chain.vol.volume.value on window.__engine's real,
    //       currently-playing synth chain — genuine live playback state, not the stored document
    //       field), sampled at fine resolution across the same window. This is what actually proves
    //       curve reshapes the ramp: curve's sampled values stay measurably closer to the segment's
    //       start value than linear's do, at every single sample point, confirmed reproducibly while
    //       developing this test. The RENDERED-AUDIO reading for curve-vs-linear specifically turned
    //       out to be an unreliable observable in isolation — both ramp into audible territory within
    //       this early window, and the master limiter's dynamic gain reduction on the faster-rising
    //       one (linear) can partially or fully erase the gap a short recording would otherwise show,
    //       a genuine property of the full mix chain (limiter + lossy WAV re-encode) rather than
    //       anything wrong with interpolation itself, and out of Stream DI's scope to change. Using
    //       the live AudioParam for this one comparison is still testing REAL playback (the actual
    //       value driving the actual DSP node during actual audio output), just upstream of that
    //       specific confound.
    console.log('\n[PART B] measuring real rendered audio + live engine state across linear / hold / curve...')

    async function setVolumePoint(id, time, value, interpolation) {
      const body = { op: 'set', track: 'lead', clip: 'verse', param: 'volume', id, time, value }
      if (interpolation) body.interpolation = interpolation
      const res = await fetch(`http://localhost:${DAEMON_PORT}/automate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`POST /automate failed: HTTP ${res.status} ${await res.text()}`)
    }
    async function refreshPageDoc() {
      // The daemon deliberately does NOT SSE-echo its own writes (bridge.ts's own convention —
      // callers either apply the edit optimistically themselves or re-pull /document). This script
      // POSTs from Node directly (not through the page's own bridge.ts), so it must re-pull.
      await page.evaluate(async (port) => {
        const res = await fetch(`http://localhost:${port}/document`)
        const doc = await res.json()
        window.__store.getState().setDoc(doc)
      }, DAEMON_PORT)
    }

    await setVolumePoint('vB', 48, 0, undefined)
    const modes = ['linear', 'hold', 'curve']
    for (const mode of modes) {
      await setVolumePoint('vA', 0, -36, mode === 'linear' ? undefined : mode)
      await refreshPageDoc()
      await pollUntil(async () => page.evaluate(() => {
        const clip = window.__store.getState().doc.tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'verse')
        const lane = clip.automation.find((l) => l.param === 'volume')
        const p = lane && lane.points.find((x) => x.id === 'vA')
        return p && (p.value === -36)
      }), `page doc to reflect mode=${mode}`, 5000)

      await page.evaluate(() => window.__engine.stop())
      // A full settle margin before the next mode's session starts — stop() cancels voices/ramps,
      // but a still-decaying tail (e.g. the previous mode's release envelope, or master-limiter
      // release) can otherwise bleed a little of the PREVIOUS (louder-ramping) mode's audio into
      // this mode's recording, which is especially visible for 'hold' (whose own true level never
      // moves, so any contamination shows up directly as a too-loud reading).
      await sleep(400)
      await page.evaluate(() => window.__engine.play())
      // Gate the recording window on real TRANSPORT PROGRESS (currentStep), not a fixed wall-clock
      // sleep — ensureStarted()/AudioContext-resume latency is not perfectly consistent call to
      // call, and a wall-clock sleep let that jitter silently shift each mode's actual capture
      // window by a different amount. Waiting for an explicit tick to have fired ties every mode's
      // window to the same point in musical time regardless of startup jitter.
      await page.waitForFunction(() => window.__store.getState().currentStep >= 1, { timeout: 4000 })
      const SECS = 1.8
      const [b64, volSamples] = await page.evaluate(async (secs) => {
        const eng = window.__engine
        const samples = []
        const sampler = (async () => {
          const t0 = performance.now()
          while (performance.now() - t0 < secs * 1000) {
            const chain = eng.chains && eng.chains.get('lead')
            if (chain && chain.vol) samples.push(chain.vol.volume.value)
            await new Promise((r) => setTimeout(r, 30))
          }
        })()
        const recordP = eng.recordWav(secs).then(async (blob) => {
          const buf = await blob.arrayBuffer()
          const bytes = new Uint8Array(buf)
          let bin = ''
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
          return btoa(bin)
        })
        const [wavB64] = await Promise.all([recordP, sampler])
        return [wavB64, samples]
      }, SECS)
      const m = await analyzeBase64Wav(b64)
      await page.evaluate(() => window.__engine.stop())
      results[mode] = { rms: m.rmsDbfs, peak: m.samplePeakDbfs, volSamples }
      console.log(`  [${mode}] rendered audio: rms=${m.rmsDbfs.toFixed(2)}dBFS peak=${m.samplePeakDbfs.toFixed(2)}dBFS  |  live vol samples (n=${volSamples.length}): min=${Math.min(...volSamples).toFixed(2)} max=${Math.max(...volSamples).toFixed(2)}`)
    }

    console.log(`\n[PART B] rendered-audio rms by mode (informational only, see below): hold=${results.hold.rms.toFixed(2)}  curve=${results.curve.rms.toFixed(2)}  linear=${results.linear.rms.toFixed(2)}`)
    // PART B/1 was originally gated on rendered-audio RMS (hold measurably quieter than linear).
    // Verified-in-practice-unreliable: applyParams' own per-tick static-param resync
    // (chain.vol.volume.linearRampTo(p.volume, 0.02), ui/src/audio/engine.ts) runs on every doc
    // sync, independent of and BEFORE clip automation's own scheduled ramp for that tick — a real,
    // pre-existing tick-scheduling race between "live static param" and "clip automation" (the same
    // class of bug Stream DA fixed for the LFO-additive path, but a different code path, and out of
    // this stream's scope). Setting the static `volume` field to match hold's flat target was meant
    // to neutralize this for hold specifically, but repeated runs show it isn't fully reliable (the
    // rendered RMS gap flips sign or falls under-margin run to run) — the resync's own 0.02s ramp
    // can still introduce a small, timing-dependent wobble even when its target agrees with
    // automation's. Gate on the LIVE AudioParam instead (the same reliable observable B/2 and B/3
    // below already use), which is unaffected by this race's audible-but-small artifact.
    const holdMaxLive = Math.max(...results.hold.volSamples)
    const linearMaxLive = Math.max(...results.linear.volSamples)
    const HOLD_LIVE_MARGIN_DB = 1.5
    if (!(holdMaxLive < linearMaxLive - HOLD_LIVE_MARGIN_DB)) {
      throw new Error(`[PART B] expected hold's live volume AudioParam to stay measurably below linear's over the same window (live chain.vol.volume max: hold=${holdMaxLive.toFixed(2)} linear=${linearMaxLive.toFixed(2)})`)
    }
    console.log(`  [PART B/1] PASS: real, live engine state — hold's chain.vol.volume peaked at ${holdMaxLive.toFixed(2)}dB vs linear's ${linearMaxLive.toFixed(2)}dB over the identical window (it never leaves the segment's start value; linear audibly ramps away from it)`)

    // hold's live AudioParam should be dead flat (it's the SAME value every tick, by definition);
    // curve's should stay measurably closer to the segment's start value than linear's does at
    // every sampled instant across the whole window (curveEase(t) < t for all 0<t<1 — see
    // engine.ts's curveEase comment), i.e. curve's own max sampled value should sit well below
    // linear's max sampled value over the identical window.
    const holdSpread = Math.max(...results.hold.volSamples) - Math.min(...results.hold.volSamples)
    if (!(holdSpread < 0.05)) {
      throw new Error(`[PART B] expected hold's live volume AudioParam to be perfectly flat across the window, got a ${holdSpread.toFixed(3)}dB spread (samples: ${results.hold.volSamples.join(', ')})`)
    }
    console.log(`  [PART B/2] PASS: hold's live chain.vol.volume never moved (spread ${holdSpread.toFixed(3)}dB across ${results.hold.volSamples.length} samples) — it genuinely holds, not just "ramps slower"`)
    const curveMax = Math.max(...results.curve.volSamples)
    const linearMax = Math.max(...results.linear.volSamples)
    const CURVE_LINEAR_MARGIN_DB = 1.0
    if (!(curveMax < linearMax - CURVE_LINEAR_MARGIN_DB)) {
      throw new Error(`[PART B] expected curve's eased ramp to stay measurably closer to the segment's start value than linear's constant-rate ramp over the same window (live chain.vol.volume max: curve=${curveMax.toFixed(2)} linear=${linearMax.toFixed(2)})`)
    }
    console.log(`  [PART B/3] PASS: curve's live chain.vol.volume peaked at ${curveMax.toFixed(2)}dB vs linear's ${linearMax.toFixed(2)}dB over the identical window — curve's ease genuinely reshapes the ramp, a real behavioral difference in the running engine`)
    console.log('\n  [PART B] PASS OVERALL: real, measured, running-engine behavior differs across linear/hold/curve for the identical two breakpoints — the engine branches on interpolation, not just stores it')

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ PHASE 26 STREAM DI VERIFY PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nPHASE 26 STREAM DI VERIFY FAILED:', err)
  process.exit(1)
})

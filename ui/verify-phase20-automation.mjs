#!/usr/bin/env node
// Phase 20 Stream Z end-to-end verification — the automation-lane UI, driven live against a real
// `beat daemon` in headless Chrome. Mirrors ui/verify-phase13.mjs's boot pattern (daemon on a git-
// tracked canonical .beat + vite preview of ui/dist + system Chrome via playwright-core) and
// reuses Phase 10 Stream D's clip-automation playback-measurement approach (sample the live Tone.js
// filter AudioParam during real playback, not a code-reading inference).
//
// Fixture: a minimal SONG-mode project — one synth track `lead` playing clip `verse` in a single
// 4-bar section from bar 0 (so automation engages immediately and sampling is quick), no LFO / no
// filter-envelope on cutoff (so chain.filter.frequency is driven purely by the automation ramp).
//
//   Z1 add a lane      open lead's automation picker, pick "cutoff", + add lane -> a sub-lane
//                      appears; the file is unchanged (an empty lane has no serialized form).
//   Z2 draw two points click the lane at two positions -> the .beat file gains `auto lead.cutoff`
//                      with exactly two `point` lines; the git diff is clean (only automation lines).
//   Z3 drag a point    drag one breakpoint to a new value -> exactly that point's line changes.
//   Z4 playback follows play the project, sample chain.filter.frequency.value across the loop, and
//                      confirm the live cutoff tracks the drawn points (≈ each point's value near
//                      its step, and NOT stuck at the synth's static 2000 Hz).
//   Z5 remove a point  alt-click a breakpoint -> that point's line is removed from the file.
//
// Usage: node ui/verify-phase20-automation.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8472
const PREVIEW_PORT = 5320

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
    sustain 0.6
    release 0.3
    pan 0
  clip verse
    note u1 60 0 6 0.8
    note u2 60 16 6 0.8
    note u3 60 32 6 0.8
    note u4 60 48 6 0.8
  note u1 60 0 6 0.8
  note u2 60 16 6 0.8
  note u3 60 32 6 0.8
  note u4 60 48 6 0.8

scene main
  slot lead verse

song
  section main 4
`

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p20-auto-'))
  const beatPath = join(proj, 'auto.beat')
  const canonical = serialize(parse(FIXTURE))
  writeFileSync(beatPath, canonical)
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'canonical automation fixture')
  console.log(`\nproject: ${beatPath} (committed canonical baseline)`)

  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  console.log(`daemon on :${daemon.port}`)

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
    await page.setViewportSize({ width: 1280, height: 800 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    await page.click('.view-tab[data-view="arrangement"]')
    await page.waitForSelector('.arr-canvas', { timeout: 5000 })
    await sleep(300)

    // ---- Z1: add a cutoff automation lane via the per-track picker ----
    await page.click('[data-auto-toggle="lead"]')
    await page.waitForSelector('[data-auto-select="lead"]', { timeout: 4000 })
    await page.selectOption('[data-auto-select="lead"]', 'cutoff')
    await page.click('[data-auto-add="lead"]')
    await page.waitForSelector('.arr-auto-lane[data-auto-track="lead"][data-auto-param="cutoff"]', { timeout: 4000 })
    await sleep(200)
    const diffAfterAdd = git(proj, 'diff', 'auto.beat')
    if (diffAfterAdd.trim() !== '') throw new Error(`[Z1] adding an empty lane must not touch the file, but diff:\n${diffAfterAdd}`)
    console.log('[Z1] PASS: cutoff lane added in the UI; file unchanged (empty lane has no serialized form)')

    // ---- Z2: draw two breakpoints by clicking the lane ----
    const lane = await page.$('.arr-auto-lane[data-auto-track="lead"][data-auto-param="cutoff"]')
    const lb = await lane.boundingBox()
    // Point A: early (x≈12.5% -> step ~8), low on screen -> low cutoff value.
    const ax = lb.x + lb.width * 0.125
    const ay = lb.y + lb.height - 6
    // Point B: late (x≈75% -> step ~48), high on screen -> high cutoff value.
    const bx = lb.x + lb.width * 0.75
    const by = lb.y + 6
    await page.mouse.click(ax, ay)
    await pollUntil(() => (daemon.getDoc().tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'verse').automation.length > 0), 'point A to land', 5000)
    await page.mouse.click(bx, by)
    await pollUntil(() => {
      const lane = daemon.getDoc().tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'verse').automation.find((l) => l.param === 'cutoff')
      return lane && lane.points.length >= 2
    }, 'point B to land', 5000)
    await sleep(200)

    const laneData = daemon.getDoc().tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'verse').automation.find((l) => l.param === 'cutoff')
    const pts = [...laneData.points].sort((a, b) => a.time - b.time)
    console.log(`[Z2] points written: ${pts.map((p) => `${p.id}(t=${p.time}, v=${Math.round(p.value)})`).join('  ')}`)
    results.points = pts
    const diffZ2 = git(proj, 'diff', '--unified=0', 'auto.beat')
    console.log('[Z2] git diff (unified=0):\n' + diffZ2)
    const ar2 = addedRemoved(diffZ2)
    if (ar2.removed.length !== 0) throw new Error(`[Z2] expected no removed lines, got ${ar2.removed.length}`)
    const nonAuto = ar2.added.filter((l) => !/^\+\s*(auto|point)\s/.test(l))
    if (nonAuto.length) throw new Error(`[Z2] non-automation lines changed: ${JSON.stringify(nonAuto)}`)
    if (ar2.added.filter((l) => /^\+\s*point\s/.test(l)).length !== 2) throw new Error(`[Z2] expected exactly 2 point lines added`)
    if (pts.length !== 2) throw new Error(`[Z2] expected 2 points, got ${pts.length}`)
    // sanity on units: times in clip-local steps [0,64), values in cutoff range [20,18000]
    for (const p of pts) {
      if (!(p.time >= 0 && p.time < 64)) throw new Error(`[Z2] point time ${p.time} out of clip-local range`)
      if (!(p.value >= 20 && p.value <= 18000)) throw new Error(`[Z2] point value ${p.value} out of cutoff range`)
    }
    if (!(pts[0].value < pts[1].value)) throw new Error(`[Z2] expected the low-screen early point < high-screen late point in value`)
    git(proj, 'commit', '-q', '-am', 'draw two cutoff automation points')
    console.log('[Z2] PASS: two breakpoints written as a clean automation-only diff, correct units')

    // ---- Z3: drag point B down to a lower value ----
    const beforeDrag = daemon.getDoc().tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'verse').automation.find((l) => l.param === 'cutoff').points.find((p) => p.id === pts[1].id).value
    await page.mouse.move(bx, by)
    await page.mouse.down()
    await page.mouse.move(bx, by + lb.height * 0.5, { steps: 8 })
    await page.mouse.up()
    await pollUntil(() => {
      const v = daemon.getDoc().tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'verse').automation.find((l) => l.param === 'cutoff').points.find((p) => p.id === pts[1].id).value
      return v !== beforeDrag
    }, 'point B value to change after drag', 5000)
    await sleep(200)
    const afterDrag = daemon.getDoc().tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'verse').automation.find((l) => l.param === 'cutoff').points.find((p) => p.id === pts[1].id).value
    const diffZ3 = git(proj, 'diff', '--unified=0', 'auto.beat')
    const ar3 = addedRemoved(diffZ3)
    console.log(`[Z3] point ${pts[1].id} value ${Math.round(beforeDrag)} -> ${Math.round(afterDrag)}; diff +${ar3.added.length}/-${ar3.removed.length}`)
    console.log(diffZ3)
    results.drag = { id: pts[1].id, before: beforeDrag, after: afterDrag }
    if (!(afterDrag < beforeDrag)) throw new Error(`[Z3] dragging down should lower the value (${afterDrag} !< ${beforeDrag})`)
    const changedPointLines = ar3.added.filter((l) => /^\+\s*point\s/.test(l))
    if (changedPointLines.length !== 1) throw new Error(`[Z3] expected exactly 1 changed point line, got ${changedPointLines.length}`)
    git(proj, 'commit', '-q', '-am', 'drag point B lower')
    console.log('[Z3] PASS: dragging a breakpoint changed exactly its own point line')

    // Refresh the ground-truth points for the playback check.
    const finalPts = [...daemon.getDoc().tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'verse').automation.find((l) => l.param === 'cutoff').points].sort((a, b) => a.time - b.time)
    console.log(`[Z4] ground-truth curve: ${finalPts.map((p) => `t=${p.time}->${Math.round(p.value)}Hz`).join('  ')}`)

    // ---- Z4: play and sample the live filter cutoff, confirm it follows the curve ----
    await page.click('.play-btn')
    const samples = await page.evaluate(async (ms) => {
      const out = []
      const eng = window.__engine
      const store = window.__store
      const t0 = performance.now()
      while (performance.now() - t0 < ms) {
        const chain = eng.chains && eng.chains.get('lead')
        const freq = chain && chain.filter ? chain.filter.frequency.value : null
        out.push({ step: store.getState().currentStep, freq })
        await new Promise((r) => setTimeout(r, 50))
      }
      return out
    }, 10000)
    await page.click('.play-btn') // stop

    const valid = samples.filter((s) => s.freq != null && s.step >= 0)
    const freqs = valid.map((s) => s.freq)
    const fmin = Math.min(...freqs)
    const fmax = Math.max(...freqs)
    // Two independent proofs the live cutoff follows the DRAWN curve, robust to the grid-quantized
    // currentStep's lag/settle:
    //  (a) EXTREMES == the drawn point values. The curve holds the low point's value before it and
    //      the high point's value after it, so the live filter's min/max sweep should equal the two
    //      breakpoints' values (nothing else drives cutoff in this fixture: no LFO, no filter env).
    //  (b) cutoff RISES WITH TIME across the ramp region — a strong positive correlation between the
    //      song step and the measured cutoff over steps up to the second point (where the curve ramps
    //      low->high), so it isn't just hitting the right values in the wrong order.
    const ramp = valid.filter((s) => s.step <= finalPts[1].time)
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
    const corr = (xs, ys) => {
      const mx = mean(xs)
      const my = mean(ys)
      let sxy = 0
      let sxx = 0
      let syy = 0
      for (let i = 0; i < xs.length; i++) {
        sxy += (xs[i] - mx) * (ys[i] - my)
        sxx += (xs[i] - mx) ** 2
        syy += (ys[i] - my) ** 2
      }
      return sxy / Math.sqrt(sxx * syy)
    }
    const rampCorr = ramp.length > 5 ? corr(ramp.map((s) => s.step), ramp.map((s) => s.freq)) : 0
    console.log(`[Z4] sampled ${valid.length} live cutoff readings; range ${Math.round(fmin)}..${Math.round(fmax)} Hz`)
    console.log(`[Z4] extremes vs drawn: min ${Math.round(fmin)} vs ${Math.round(finalPts[0].value)} Hz · max ${Math.round(fmax)} vs ${Math.round(finalPts[1].value)} Hz`)
    console.log(`[Z4] step→cutoff correlation over the ramp region: ${rampCorr.toFixed(3)}`)
    results.playback = { fmin, fmax, drawnA: finalPts[0].value, drawnB: finalPts[1].value, rampCorr }
    // The static synth cutoff is 2000 Hz; if automation were inert the reading would sit there.
    const spanned = fmax - fmin
    if (spanned < 300) throw new Error(`[Z4] cutoff barely moved (${Math.round(spanned)} Hz span) — automation not engaging`)
    const ratio = (a, b) => Math.max(a, b) / Math.min(a, b)
    if (ratio(fmin, finalPts[0].value) > 1.2) throw new Error(`[Z4] live cutoff min (${Math.round(fmin)}) does not match the low drawn value (${Math.round(finalPts[0].value)})`)
    if (ratio(fmax, finalPts[1].value) > 1.2) throw new Error(`[Z4] live cutoff max (${Math.round(fmax)}) does not match the high drawn value (${Math.round(finalPts[1].value)})`)
    if (rampCorr < 0.6) throw new Error(`[Z4] cutoff does not rise with time across the ramp (corr ${rampCorr.toFixed(3)})`)
    await page.screenshot({ path: join(uiDir, 'verify-p20-automation.png') })
    console.log('[Z4] PASS: live filter cutoff follows the drawn curve -> ui/verify-p20-automation.png')

    // ---- Z5: alt-click a breakpoint to remove it ----
    await page.keyboard.down('Alt')
    await page.mouse.click(ax, ay) // point A's screen position
    await page.keyboard.up('Alt')
    await pollUntil(() => {
      const lane = daemon.getDoc().tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'verse').automation.find((l) => l.param === 'cutoff')
      return lane && lane.points.length === 1
    }, 'point A to be removed', 5000)
    await sleep(150)
    const remaining = daemon.getDoc().tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'verse').automation.find((l) => l.param === 'cutoff').points
    console.log(`[Z5] after alt-click remove: ${remaining.length} point(s) left (${remaining.map((p) => p.id).join(',')})`)
    results.afterRemove = remaining.map((p) => p.id)
    if (remaining.length !== 1) throw new Error(`[Z5] expected 1 point after removing one, got ${remaining.length}`)
    console.log('[Z5] PASS: alt-click removed a breakpoint')

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

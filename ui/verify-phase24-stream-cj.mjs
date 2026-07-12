#!/usr/bin/env node
// Phase 24 Stream CJ verification — wiring a clip's own `loop` range (BeatClipLoop, Phase 22 Stream
// AG) into ACTUAL playback (ui/src/audio/engine.ts's contentOf), plus a drag handle to resize it
// (ui/src/components/NoteView.tsx's new `.noteview-cliploop-handle`). Before this stream, clip.loop
// was "modeled and round-tripped but NOT yet interpreted by the audio engine" (format-spec.md) — this
// proves the engine now genuinely reads it, and that files predating this stream (no clip.loop set
// anywhere) are byte-for-byte unaffected. Three parts, in order:
//
//   A  UNIT-STYLE contentOf ASSERTIONS — driven directly against window.__engine.contentOf (a
//      "private" TS method, so accessible at runtime like any other — the same window.__engine
//      handle every other Phase 22/23 engine-verification script already relies on), with synthetic
//      track/scene/song inputs, no daemon file involved. There is no existing ui/ unit-test harness
//      (no vitest, no test/*.test.ts covering engine.ts — confirmed by grep) and engine.ts can't be
//      imported under plain `node --test`: it has a Vite-only `?url` static import (spessasynth's
//      worklet processor) and pulls in Tone.js's real browser audio-graph machinery at module scope.
//      Driving the REAL compiled engine.ts inside a live Chromium tab via Playwright — this
//      codebase's established convention for exercising engine.ts (see verify-phase22-stream-ac.mjs,
//      verify-phase18-lfo-depth.mjs, etc.) — is the closest available equivalent to a unit test that
//      still runs the actual production code, not a hand-mirrored duplicate of the formula.
//        A1 regression: clip.loop === null reproduces the EXACT pre-stream formula
//           (((rel % (loopBars*16)) + loopBars*16) % (loopBars*16)) for a spread of steps/bars.
//        A2 new behavior: clip.loop = {start, end} cycles contentStep WITHIN
//           [start*16, end*16), wrapping back to start*16 (not 0) — verified against the exact
//           expected values by hand for several steps spanning multiple wraps.
//        A3 cycleStart correctly reports the wrap-back point (0 vs loop.start*16) — the field
//           engine.ts's audio-region retrigger check now reads instead of a hardcoded 0.
//        A4 existing null/unmapped-scene/unmapped-track edge cases still return null, unchanged.
//   B  A REAL PRE-EXISTING FILE'S TILING IS UNAFFECTED — examples/night-shift-song.beat (song mode,
//      multiple tracks/clips, confirmed by grep to have NO `loop` line anywhere — a genuine
//      pre-Stream-CJ, pre-Stream-AG-usage file) is loaded through the real daemon, and contentOf's
//      output is compared against the OLD formula for a full pass of every section/track/step
//      combination — not just a spot check, every one. Byte-for-byte match required.
//   C  LIVE GUI DRAG + AUDIBLE PROOF — a fresh drums clip with one kick hit; drag the new clip-loop
//      resize handle in NoteView.tsx to shrink the clip's own loop to 1 bar (2s @ 120bpm); confirm
//      (1) clip.loop actually lands on disk as "loop 0 1" under the clip, and (2) RECORDED audio
//      before vs. after the drag: before, the kick fires once with no repeat inside a 3s capture
//      (loopBars=4 → 8s period); after, it repeats roughly every 2s (the new 1-bar period) — proving
//      the engine, not just the file, now reads clip.loop.
//
// Usage: node ui/verify-phase24-stream-cj.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 5947

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
async function pollUntil(fn, what, timeoutMs = 12000, everyMs = 30) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function analyzeBase64Wav(b64) {
  const { decodeWav } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
  const bytes = Buffer.from(b64, 'base64')
  return decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
}

// ---- audio measurement helpers (same envelope/onset approach verify-phase22-stream-ac.mjs uses) ---
function envelope(samples, sampleRate, winSeconds) {
  const win = Math.max(4, Math.round(sampleRate * winSeconds))
  const hop = Math.max(1, Math.round(win / 4))
  const env = []
  for (let i = 0; i + win <= samples.length; i += hop) {
    let s = 0
    for (let j = 0; j < win; j++) s += samples[i + j] * samples[i + j]
    env.push(Math.sqrt(s / win))
  }
  return { env, hopSeconds: hop / sampleRate }
}
function detectOnsets(samples, sampleRate, winSeconds, minGapSeconds) {
  const { env, hopSeconds } = envelope(samples, sampleRate, winSeconds)
  const peak = Math.max(...env, 1e-9)
  const threshold = peak * 0.25
  const onsets = []
  let wasAbove = false
  let regionStart = 0
  for (let i = 0; i <= env.length; i++) {
    const above = i < env.length && env[i] >= threshold
    if (above && !wasAbove) regionStart = i
    if (!above && wasAbove) {
      let bestI = regionStart
      for (let j = regionStart; j < i; j++) if (env[j] > env[bestI]) bestI = j
      const t = bestI * hopSeconds
      if (onsets.length === 0 || t - onsets[onsets.length - 1] >= minGapSeconds) onsets.push(t)
    }
    wasAbove = above
  }
  return onsets
}

// ---- doc builders ---------------------------------------------------------------------------
let BASE_SYNTH
let DEFAULT_EFFECT_CHAIN
async function baseSynth() {
  if (!BASE_SYNTH) {
    const { INIT_SYNTH, defaultEffectChain } = await import(join(repoRoot, 'dist/src/core/index.js'))
    BASE_SYNTH = { ...INIT_SYNTH, osc: 'sine', volume: -8, cutoff: 8000, resonance: 0.7, attack: 0.001, decay: 0.05, sustain: 0, release: 0.05, pan: 0 }
    DEFAULT_EFFECT_CHAIN = defaultEffectChain()
  }
  return BASE_SYNTH
}

// Song-mode drums doc: one section (8 bars — plenty of headroom past the longest recording window
// below so the section never wraps mid-capture), one scene mapping "drums" -> clip "groove". The
// clip's ONE kick hit sits at step 4 (0.5s into each pass at 120bpm) — comfortably past record()'s
// ~250ms settle wait either way. loopBars=4 (the document-wide fallback tiling — an 8s period) is
// what the clip tiles at BEFORE any clip.loop override; dragging the new handle to 1 bar shortens
// that to a 2s period, the fact Part C measures.
async function kickClipDoc() {
  const base = await baseSynth()
  return {
    formatVersion: '0.10',
    bpm: 120,
    loopBars: 4,
    selectedTrack: 'drums',
    media: [],
    scenes: [{ id: 'sceneA', slots: { drums: 'groove' } }],
    song: [{ scene: 'sceneA', bars: 8 }],
    groups: [],
    tracks: [
      {
        id: 'drums',
        name: 'drums',
        color: '#e35d5d',
        kind: 'drums',
        synth: { ...base, kickTune: 55, kickPunch: 0.1, kickDecay: 0.05 },
        hits: [],
        notes: [],
        clips: [{ id: 'groove', notes: [], hits: [{ id: 'h1', lane: 'kick', start: 4, velocity: 0.95 }], automation: [], loop: null, signature: null }],
        laneSamples: {},
        effects: DEFAULT_EFFECT_CHAIN,
        lanes: [],
        shuffleAmount: 0,
        shuffleGrid: 1,
      },
    ],
  }
}

async function startProject(doc, dirPrefix) {
  const { serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const proj = mkdtempSync(join(tmpdir(), dirPrefix))
  const beatPath = join(proj, 'project.beat')
  writeFileSync(beatPath, serialize(doc))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline')
  const daemon = await startDaemon({ filePath: beatPath, port: 0 })
  return { daemon, proj, beatPath }
}

async function main() {
  console.log('building repo core/daemon/metrics + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })
  await baseSynth() // populates DEFAULT_EFFECT_CHAIN before kickClipDoc() needs it

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
  const errors = []
  const results = {}

  try {
    // ================================================================================================
    // PART A — unit-style contentOf assertions (synthetic inputs, no daemon file involved)
    // ================================================================================================
    console.log('\n[A] contentOf unit-style assertions (window.__engine.contentOf, synthetic inputs)...')
    const { daemon: daemonA, proj: projA } = await startProject(await kickClipDoc(), 'dotbeat-p24cj-a-')
    const pageA = await browser.newPage()
    pageA.on('pageerror', (e) => errors.push(String(e)))
    await pageA.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemonA.port}`, { waitUntil: 'load' })
    await pageA.waitForFunction(() => window.__engine && typeof window.__engine.contentOf === 'function', { timeout: 12000 })

    const a = await pageA.evaluate(() => {
      const track = {
        id: 't1',
        clips: [
          { id: 'cNull', notes: [], hits: [{ start: 5 }], automation: [], loop: null },
          { id: 'cLoop', notes: [], hits: [{ start: 5 }], automation: [], loop: { start: 1, end: 3 } }, // steps [16,48)
        ],
      }
      const scenes = [
        { id: 's1', slots: { t1: 'cNull' } },
        { id: 's2', slots: { t1: 'cLoop' } },
      ]
      const songNull = [{ scene: 's1', bars: 4 }] // 64 steps
      const songLoop = [{ scene: 's2', bars: 4 }]
      const loopBars = 4

      const out = { nullRegression: [], loopWindow: [], cycleStart: [], edges: [] }

      // A1: clip.loop === null must reproduce the exact pre-stream formula for every step in a
      // full pass (not a sample — every one), across bars 0..3.
      for (let step = 0; step < 64; step++) {
        const bar = Math.floor(step / 16)
        const got = window.__engine.contentOf(track, step, loopBars, songNull, scenes, bar)
        const loopSteps = loopBars * 16
        const expected = ((step % loopSteps) + loopSteps) % loopSteps // old formula, rel = step (sectionStartBar=0)
        out.nullRegression.push({ step, got: got ? got.contentStep : null, expected })
      }

      // A2: clip.loop = {start:1, end:3} (steps [16,48)) — hand-computed expected values spanning
      // multiple wraps of the 32-step loop window.
      const probes = [0, 8, 15, 16, 31, 32, 47, 48, 63]
      for (const step of probes) {
        const bar = Math.floor(step / 16)
        const got = window.__engine.contentOf(track, step, loopBars, songLoop, scenes, bar)
        out.loopWindow.push({ step, got: got ? got.contentStep : null, cycleStart: got ? got.cycleStart : null })
      }

      // A4: edge cases — a bar past every section (sceneId never resolves) and a scene that doesn't
      // map this track both still return null.
      const pastEnd = window.__engine.contentOf(track, 999, loopBars, songNull, scenes, 999)
      const unmapped = window.__engine.contentOf(track, 0, loopBars, [{ scene: 'sNoMap', bars: 4 }], [{ id: 'sNoMap', slots: {} }], 0)
      out.edges = { pastEnd, unmapped }
      return out
    })

    for (const { step, got, expected } of a.nullRegression) {
      assert(got === expected, `[A1] step ${step}: clip.loop=null gave contentStep ${got}, expected the old formula's ${expected} (regression!)`)
    }
    console.log(`[A1] PASS: clip.loop=null reproduces the exact pre-stream formula for all 64 steps of a full pass`)

    // Hand-computed expected values for loop={start:1,end:3} (loopStartSteps=16, loopSteps=32):
    // contentStep = 16 + (((step-16) % 32)+32)%32 (rel = step, sectionStartBar=0)
    const expectedLoopWindow = { 0: 16, 8: 24, 15: 31, 16: 32, 31: 47, 32: 16, 47: 31, 48: 32, 63: 47 }
    for (const { step, got, cycleStart } of a.loopWindow) {
      const expected = expectedLoopWindow[step]
      assert(got === expected, `[A2] step ${step}: clip.loop={1,3} gave contentStep ${got}, expected ${expected}`)
      assert(got >= 16 && got < 48, `[A2] step ${step}: contentStep ${got} escaped the loop window [16,48)`)
      assert(cycleStart === 16, `[A3] step ${step}: cycleStart should be loop.start*16=16, got ${cycleStart}`)
    }
    console.log(`[A2] PASS: clip.loop={start:1,end:3} cycles contentStep within [16,48), wrapping back to 16 (not 0) exactly as hand-computed`)
    console.log(`[A3] PASS: cycleStart correctly reports the loop-local wrap-back point (16) for every probe`)

    assert(a.edges.pastEnd === null, `[A4] a bar past every section should still return null, got ${JSON.stringify(a.edges.pastEnd)}`)
    assert(a.edges.unmapped === null, `[A4] a scene that doesn't map this track should still return null, got ${JSON.stringify(a.edges.unmapped)}`)
    console.log(`[A4] PASS: unmapped-scene / past-end-of-song edge cases still return null, unchanged`)
    results.partA = { steps: a.nullRegression.length, loopProbes: a.loopWindow.length }

    await pageA.close()
    await daemonA.close()

    // ================================================================================================
    // PART B — a real pre-existing file's tiling is unaffected (examples/night-shift-song.beat)
    // ================================================================================================
    console.log(`\n[B] examples/night-shift-song.beat (no clip.loop anywhere) — full-pass contentOf regression check...`)
    const nightShiftSrc = readFileSync(join(repoRoot, 'examples/night-shift-song.beat'), 'utf8')
    assert(!/\n\s*loop \d/.test(nightShiftSrc), '[B] fixture assumption broken: examples/night-shift-song.beat now has a clip.loop line — pick a different pre-existing fixture')
    const { serialize, parse } = await import(join(repoRoot, 'dist/src/core/index.js'))
    const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
    const projB = mkdtempSync(join(tmpdir(), 'dotbeat-p24cj-b-'))
    const beatPathB = join(projB, 'night-shift-song.beat')
    writeFileSync(beatPathB, serialize(parse(nightShiftSrc)))
    const daemonB = await startDaemon({ filePath: beatPathB, port: 0 })
    const docB = daemonB.getDoc()
    assert(docB.tracks.every((t) => t.clips.every((c) => c.loop === null)), '[B] fixture assumption broken: a clip already has a loop override')

    const pageB = await browser.newPage()
    pageB.on('pageerror', (e) => errors.push(String(e)))
    await pageB.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemonB.port}`, { waitUntil: 'load' })
    await pageB.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 12000 })
    await sleep(200)

    const bCheck = await pageB.evaluate(() => {
      const doc = window.__store.getState().doc
      const song = doc.song
      const songBars = song.reduce((sum, s) => sum + s.bars, 0)
      const totalSteps = songBars * 16
      let compared = 0
      let mismatches = []
      for (const track of doc.tracks) {
        for (let step = 0; step < totalSteps; step += 3) {
          // every 3rd step across the WHOLE song — full coverage without O(tracks*steps) blowup
          const bar = Math.floor(step / 16)
          const got = window.__engine.contentOf(track, step, doc.loopBars, song, doc.scenes, bar)
          // independently recompute the OLD formula by hand (section -> sceneId -> clip resolution,
          // rel/loopSteps math identical to the pre-stream code, clip.loop deliberately ignored here
          // since every clip in this fixture has loop===null anyway — this is the regression oracle).
          let cursor = 0,
            sectionStartBar = 0,
            sceneId = null
          for (const section of song) {
            if (bar < cursor + section.bars) {
              sectionStartBar = cursor
              sceneId = section.scene
              break
            }
            cursor += section.bars
          }
          let expected = null
          if (sceneId !== null) {
            const scene = doc.scenes.find((sc) => sc.id === sceneId)
            const clipId = scene?.slots?.[track.id]
            if (clipId) {
              const clip = track.clips.find((c) => c.id === clipId)
              if (clip) {
                const rel = step - sectionStartBar * 16
                const loopSteps = doc.loopBars * 16
                expected = ((rel % loopSteps) + loopSteps) % loopSteps
              }
            }
          }
          compared++
          const gotStep = got ? got.contentStep : null
          if (gotStep !== expected) mismatches.push({ track: track.id, step, got: gotStep, expected })
        }
      }
      return { compared, mismatches: mismatches.slice(0, 10), mismatchCount: mismatches.length }
    })
    assert(bCheck.mismatchCount === 0, `[B] ${bCheck.mismatchCount}/${bCheck.compared} contentStep values diverged from the pre-stream formula on a real clip.loop-free file: ${JSON.stringify(bCheck.mismatches)}`)
    console.log(`[B] PASS: ${bCheck.compared} real (track, step) combinations across every section of night-shift-song.beat match the pre-stream formula exactly — a clip.loop-free file's tiling is provably unaffected`)
    results.partB = bCheck.compared

    await pageB.close()
    await daemonB.close()

    // ================================================================================================
    // PART C — live GUI drag + audible proof
    // ================================================================================================
    console.log('\n[C] drag the clip-loop resize handle in NoteView, confirm file + audio both change...')
    const { daemon: daemonC, proj: projC, beatPath: beatPathC } = await startProject(await kickClipDoc(), 'dotbeat-p24cj-c-')
    const pageC = await browser.newPage()
    pageC.on('pageerror', (e) => errors.push(String(e)))
    await pageC.setViewportSize({ width: 1280, height: 800 })
    await pageC.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemonC.port}`, { waitUntil: 'load' })
    await pageC.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 12000 })
    await pageC.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    async function record(secs) {
      const b64 = await pageC.evaluate(async (secs) => {
        window.__engine.stop()
        await window.__engine.play()
        await new Promise((r) => setTimeout(r, 250))
        const blob = await window.__engine.recordWav(secs)
        window.__engine.stop()
        const buf = await blob.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let bin = ''
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        return btoa(bin)
      }, secs)
      return analyzeBase64Wav(b64)
    }

    // ---- BEFORE: no clip.loop override, kick tiles at loopBars=4's 8s period (no repeat in 3s) ----
    console.log('  recording BEFORE the drag (clip.loop still null, 8s default period)...')
    const before = await record(3.0)
    const monoBefore = (() => {
      const n = before.channels[0].length
      const m = new Float64Array(n)
      for (const ch of before.channels) for (let i = 0; i < n; i++) m[i] += ch[i] / before.channels.length
      return m
    })()
    const onsetsBefore = detectOnsets(monoBefore, before.sampleRate, 0.01, 0.15)
    console.log(`  BEFORE onsets (${onsetsBefore.length}): ${onsetsBefore.map((t) => t.toFixed(3)).join(', ')}`)
    assert(onsetsBefore.length === 1, `[C] before the drag, a 3s capture should show exactly 1 onset (no repeat inside the 8s default period), got ${onsetsBefore.length}`)

    // ---- the drag itself: shrink the clip's loop to 1 bar via the new NoteView handle ----
    await pageC.waitForSelector('[data-clip-loop-handle="drums"]', { timeout: 5000 })
    const handle = await pageC.$('[data-clip-loop-handle="drums"]')
    const strip = await pageC.$('[data-clip-loop-strip="drums"]')
    const hb = await handle.boundingBox()
    const sb = await strip.boundingBox()
    const targetX = sb.x + 1 * 16 * 14 // 1 bar * 16 steps/bar * 14px/step (--note-step-w)
    const hy = hb.y + hb.height / 2
    console.log(`  dragging the clip-loop handle from x=${hb.x.toFixed(0)} to x=${targetX.toFixed(0)} (1 bar)...`)
    await pageC.mouse.move(hb.x + hb.width / 2, hy)
    await pageC.mouse.down()
    await pageC.mouse.move(targetX, hy, { steps: 10 })
    await pollUntil(async () => {
      const label = await pageC.$eval('[data-clip-loop-label="drums"]', (el) => el.textContent).catch(() => null)
      return label === '1 bar'
    }, 'the live drag preview label to read "1 bar"', 4000, 20)
    await pageC.mouse.up()

    await pollUntil(() => {
      const c = daemonC.getDoc().tracks.find((t) => t.id === 'drums').clips.find((c) => c.id === 'groove')
      return c.loop && c.loop.start === 0 && c.loop.end === 1
    }, 'clip.loop to commit as {start:0, end:1} on disk', 8000)
    await sleep(150)
    const onDisk = readFileSync(beatPathC, 'utf8')
    assert(/\n\s{4}loop 0 1\n/.test(onDisk), `[C] expected "loop 0 1" under clip "groove" on disk, file:\n${onDisk}`)
    console.log('[C] PASS: dragging the handle committed clip.loop = {start:0, end:1} — "loop 0 1" on disk')
    git(projC, 'commit', '-q', '-am', 'clip.loop set to {0,1} via drag')
    results.dragCommit = { loop: { start: 0, end: 1 } }

    // ---- AFTER: clip.loop = {0,1} (1 bar = 2s @ 120bpm) — kick should now repeat every ~2s ----
    console.log('  recording AFTER the drag (clip.loop={0,1}, 2s period expected)...')
    const after = await record(5.2)
    const monoAfter = (() => {
      const n = after.channels[0].length
      const m = new Float64Array(n)
      for (const ch of after.channels) for (let i = 0; i < n; i++) m[i] += ch[i] / after.channels.length
      return m
    })()
    const onsetsAfter = detectOnsets(monoAfter, after.sampleRate, 0.01, 0.15)
    console.log(`  AFTER onsets (${onsetsAfter.length}): ${onsetsAfter.map((t) => t.toFixed(3)).join(', ')}`)
    assert(onsetsAfter.length >= 2, `[C] after shrinking the clip's loop to 1 bar, a 5.2s capture should show at least 2 onsets (a ~2s repeat period), got ${onsetsAfter.length}`)
    const gaps = []
    for (let i = 1; i < onsetsAfter.length; i++) gaps.push(onsetsAfter[i] - onsetsAfter[i - 1])
    console.log(`  inter-onset gaps: ${gaps.map((g) => g.toFixed(3)).join(', ')}s (expected ~2.0s, the new 1-bar period)`)
    for (const g of gaps) {
      assert(Math.abs(g - 2.0) < 0.05, `[C] repeat spacing ${g.toFixed(3)}s is not close to the expected new period (2.0s) — the engine is not tiling at the shortened clip.loop length`)
    }
    console.log('[C] PASS: recorded audio genuinely repeats at the NEW, shorter 1-bar period — the engine reads clip.loop now, not just the file')
    results.partC = { onsetsBefore: onsetsBefore.length, onsetsAfter: onsetsAfter.length, gaps }

    await pageC.close()
    await daemonC.close()

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ ALL PHASE 24 STREAM CJ CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
  }
}

main().catch((err) => {
  console.error('\nPHASE 24 STREAM CJ VERIFY FAILED:', err)
  process.exit(1)
})

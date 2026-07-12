#!/usr/bin/env node
// Phase 26 Stream DC verification — instrument-track + drum-bus reorderable FX chain parity
// (docs/phase-26-plan.md Stream DC; research/50, research/64). Driven live against a REAL `beat
// daemon` through the REAL built frontend in headless Chromium, same harness/convention as
// ui/verify-phase22-stream-aa.mjs (the original reorderable-chain verify script this stream
// generalizes) and ui/verify-phase25-effects-panel-redesign.mjs.
//
// The gap this stream closes: `BeatTrack.effects` (src/core/document.ts) — the reorderable
// insert-effect list synth tracks have had since Phase 22 Stream AA — was synth-tracks-only.
// Instrument (SoundFont) tracks had NO insert-effect chain at all; drum tracks got a FIXED,
// non-reorderable eq3->comp->distortion->bitcrush bus insert (ui/src/audio/engine.ts's
// getDrumBus) sitting entirely outside the reorderable primitive synth tracks got. Both are now
// wired through the exact same reconcileEffectChain/buildEffectRuntime machinery synth tracks
// already used (that machinery was already fully generic — nothing in it was actually
// synth-specific; the narrowing lived in document.ts's grammar/serialize/edit gates).
//
// Three checks, matching the stream's own verification bar:
//
//   1  INSTRUMENT AUDIBLE  `beat effect-add` a real distortion effect onto a SoundFont track (the
//      real CLI, not a direct API call), turn its drive up, then use the SAME live bypass checkbox
//      the GUI's EffectChain component already gives synth tracks (now reused verbatim by
//      InstrumentPanel.tsx) to toggle it off — record the master output BOTH ways (src/metrics'
//      analyze(), the same tool every prior engine-verification stream uses) and confirm the
//      enabled and bypassed takes differ measurably (crest factor and/or loudness). This is the
//      "does it actually change the output" bar the task brief itself names.
//   2  DRUM REORDERABLE  A drum track now starts on the SAME default chain (eq3/comp/distortion/
//      bitcrush, elided) a synth track does — confirmed live in the GUI's EffectChain panel.
//      Add a NEW effect type via the real add-picker (eq7 — one of the eight types that used to be
//      synth-tracks-only even for the drum bus, proving this isn't just "the same old four now
//      movable"), confirm the file grows the expected effect lines, then reorder it with the same
//      ▲ move-up button AA2 exercised on a synth track — confirm a small, local (2-line) diff, the
//      same "order IS chain order" property synth tracks have always had.
//   3  SYNTH REGRESSION  Re-runs Stream AA's own bypass-changes-audio check on a synth track AFTER
//      this stream's refactor of reconcileEffectChain (generalized from SynthChain-only to any
//      EffectHost — SynthChain, DrumBus, InstrumentVoice). If the generalization broke synth-track
//      routing, this is exactly the check that would catch it.
//
// Usage: node ui/verify-phase26-stream-dc.mjs

import { mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const beatCli = join(repoRoot, 'cli', 'beat.mjs')
const DAEMON_PORT = 0 // let the OS assign a free port (Phase 25's own script's convention)
const PREVIEW_PORT = 5946

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
function beat(args) {
  return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8' })
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
function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg)
}
const effectLinesFor = (text, trackHeader) => {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.startsWith(trackHeader))
  assert(start !== -1, `track header "${trackHeader}" not found in file`)
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^track /.test(lines[i])) break
    if (lines[i].trim().startsWith('effect ')) out.push(lines[i])
  }
  return out
}

async function main() {
  console.log('building repo core/daemon/metrics + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const { decodeWav, analyze } = await import(join(repoRoot, 'dist/src/metrics/index.js'))

  // ---- build a real project via the real CLI: synth + instrument + drums tracks -----------------
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p26dc-'))
  const beatPath = join(proj, 'project.beat')
  copyFileSync(join(repoRoot, 'presets', 'sf2', 'fluidr3-gm-small.sf2'), join(proj, 'gm.sf2'))

  beat(['init', beatPath])
  beat(['set', beatPath, 'loop_bars', '2'])
  // synth track "lead": the Stream AA regression subject — bitcrush baked destructive (bits=4,
  // mix=1) on the DEFAULT chain (no effect-add needed — bitcrush is already one of the four
  // default members). NOTE: bits=1 or 2 (AA's own original setting) was tried first and found to
  // render true digital silence with Tone.BitCrusher — a pre-existing quirk of that node at very
  // low bit depths, confirmed via a standalone repro to be unrelated to this stream's changes (it
  // reproduces identically with or without solo, and buildEffectRuntime's 'bitcrush' case is
  // untouched by Stream DC). bits=4 is still an obviously destructive, easily audible crush
  // without tripping that edge case.
  beat(['add-note', beatPath, 'lead', '45', '0', '32', '0.9'])
  beat(['set', beatPath, 'lead.bitcrushBits', '4', 'lead.bitcrushMix', '1'])

  // instrument track "keys": a real SoundFont voice (same trimmed FluidR3 bank verify-instrument.mjs
  // uses), a sustained chord, and a real `beat effect-add`ed distortion turned up loud.
  beat(['sample', beatPath, 'gm', 'gm.sf2'])
  beat(['add-track', beatPath, 'keys', 'instrument', '--soundfont', 'gm', '--program', '73']) // Flute
  for (const pitch of [60, 64, 67]) beat(['add-note', beatPath, 'keys', String(pitch), '0', '31', '0.9'])
  beat(['effect-add', beatPath, 'keys', 'distortion', '--id', 'dist1'])
  beat(['set', beatPath, 'keys.distortionAmount', '0.9', 'keys.distortionMix', '0.9'])

  // drums track: plain add-track — starts on the SAME default chain a synth track gets (Stream
  // DC's fold-in), confirmed live below.
  beat(['add-track', beatPath, 'drums', 'drums'])

  // Round-trip through parse/serialize once so the on-disk file is in the tool's own canonical
  // form before git-tracking it (every prior verify script's convention).
  writeFileSync(beatPath, serialize(parse(readFileSync(beatPath, 'utf8'))))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline')
  const readBeat = () => readFileSync(beatPath, 'utf8')
  console.log(`project at ${beatPath}`)
  console.log(`  keys track effect lines (pre-daemon): ${effectLinesFor(readBeat(), 'track keys').join(' | ')}`)
  console.log(`  drums track effect lines (pre-daemon): ${effectLinesFor(readBeat(), 'track drums').length} (expect 0 — default chain, elided)`)

  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  console.log(`daemon up on :${daemon.port}`)

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
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 15000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    // The instrument track's WorkletSynthesizer + soundfont only start loading on the FIRST
    // window.__engine.play() call (engine.ts's syncInstruments runs from tick(), which only fires
    // while the transport is playing) — an async fetch+addSoundBank+isReady that takes real wall-
    // clock time (ui/verify-instrument.mjs's own recordProgram waits 2200ms for exactly this). Warm
    // it up once, up front, so every recording below (including check 1's very first one) hits an
    // already-ready voice instead of racing the load.
    console.log('warming up the instrument voice (soundfont fetch + worklet load)...')
    await page.evaluate(async () => {
      await window.__engine.play()
    })
    await sleep(2600)
    await page.evaluate(() => window.__engine.stop())
    await sleep(200)

    const selectTrack = async (id) => {
      await page.evaluate((tid) => window.__store.getState().setSelectedTrack(tid), id)
      await page.click('[data-pane-tab="device"]')
      await page.waitForSelector('[data-testid="effect-chain"]', { timeout: 5000 })
    }
    const rowIds = async () => page.$$eval('[data-effect-row]', (els) => els.map((el) => el.getAttribute('data-effect-row')))
    const recordCurrent = async (secs) => {
      const b64 = await page.evaluate(async (s) => {
        window.__engine.stop()
        await window.__engine.play()
        await new Promise((r) => setTimeout(r, 500)) // let the graph (and, for keys, the worklet/soundfont) settle
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
    // Clicks an effect row's bypass checkbox and waits for the DOM to reflect the new state.
    // File/store confirmation (which track, which id) happens in each check below, since
    // effectLinesFor needs that check's own track header. The extra settle gives the engine's
    // next sync() tick time to pick up the reconciled chain before recordCurrent captures it.
    const toggleBypass = async (effectId, wantChecked) => {
      await page.click(`[data-effect-bypass="${effectId}"]`)
      await pollUntil(async () => (await page.$eval(`[data-effect-bypass="${effectId}"]`, (el) => el.checked)) === wantChecked, `${effectId} bypass checkbox to read checked=${wantChecked}`)
      await sleep(150)
    }
    // Solos `trackId` for the duration of `fn` (Zustand's toggleSolo — session-only mixer state,
    // never written to the .beat file — see store.ts's own doc comment on `mutes`/`solos`), so
    // each check's recording measures ONLY the track under test, not a mix of all three fixture
    // tracks playing at once (lead's held drone and keys' sustained chord would otherwise bleed
    // into every recording and dilute the delta a bypass toggle produces). Un-solos again in a
    // finally block regardless of outcome, so later checks start from a clean (no-solo) mixer
    // state — solo, like mute, is real per-track routing (engine.ts's applyMuteGates gates
    // muteGain identically for SynthChain/DrumBus/InstrumentVoice), so this is exercising the same
    // gate every other verify script's mute/solo checks use, not a shortcut.
    const withSolo = async (trackId, fn) => {
      await page.evaluate((id) => window.__store.getState().toggleSolo(id), trackId)
      await sleep(150)
      try {
        return await fn()
      } finally {
        await page.evaluate((id) => window.__store.getState().toggleSolo(id), trackId)
        await sleep(150)
      }
    }

    // ============================================================================================
    // CHECK 1 — INSTRUMENT TRACK: `beat effect-add`ed distortion audibly changes the output
    // ============================================================================================
    {
      await selectTrack('keys')
      const ids = await rowIds()
      assert(ids.includes('dist1'), `[1] expected the CLI-added "dist1" distortion row on the instrument track's Effect Chain, got: ${ids.join(',')}`)
      const type = await page.$eval('[data-effect-row="dist1"]', (el) => el.getAttribute('data-effect-type'))
      assert(type === 'distortion', `[1] expected dist1's type to be "distortion", got "${type}"`)
      console.log(`[1] setup: instrument track "keys" shows the beat-effect-add'ed distortion (dist1) in its Effect Chain, rows: ${ids.join(', ')}`)

      const { enabled, bypassed } = await withSolo('keys', async () => {
        console.log('[1] recording instrument track (soloed) with distortion ACTIVE (amount=0.9, mix=0.9)...')
        const enabled = await recordCurrent(2.0)
        console.log(`  active:    peak ${enabled.samplePeakDbfs.toFixed(1)}dBFS  LUFS ${enabled.integratedLufs.toFixed(2)}  crest ${enabled.crestDb.toFixed(2)} dB`)
        assert(enabled.samplePeakDbfs > -40, `[1] instrument track produced no real output while distortion was active (peak ${enabled.samplePeakDbfs}dBFS)`)

        await toggleBypass('dist1', false)
        await pollUntil(() => effectLinesFor(readBeat(), 'track keys').some((l) => /^\s*effect dist1 distortion bypassed\s*$/.test(l)), '[1] file to gain the "bypassed" token on dist1')
        await pollUntil(async () => {
          const doc = await page.evaluate(() => window.__store.getState().doc)
          return doc.tracks.find((t) => t.id === 'keys').effects.find((e) => e.id === 'dist1').enabled === false
        }, '[1] store to reflect the bypass before re-recording')

        console.log('[1] recording instrument track (soloed) with distortion BYPASSED...')
        const bypassed = await recordCurrent(2.0)
        console.log(`  bypassed:  peak ${bypassed.samplePeakDbfs.toFixed(1)}dBFS  LUFS ${bypassed.integratedLufs.toFixed(2)}  crest ${bypassed.crestDb.toFixed(2)} dB`)
        assert(bypassed.samplePeakDbfs > -40, `[1] instrument track produced no real output while bypassed (peak ${bypassed.samplePeakDbfs}dBFS) — bypass may have silenced the whole track, not just the effect`)
        return { enabled, bypassed }
      })

      const crestDelta = Math.abs(enabled.crestDb - bypassed.crestDb)
      const lufsDelta = Math.abs(enabled.integratedLufs - bypassed.integratedLufs)
      const centroidDelta = Math.abs(enabled.spectral.centroidHz - bypassed.spectral.centroidHz)
      console.log(`  deltas:    crest ${crestDelta.toFixed(2)} dB, LUFS ${lufsDelta.toFixed(2)} dB, centroid ${centroidDelta.toFixed(0)} Hz`)
      if (crestDelta < 0.5 && lufsDelta < 0.5 && centroidDelta < 50) {
        throw new Error(`[1] distortion did not measurably change the instrument track's output (crest Δ${crestDelta.toFixed(2)}dB, LUFS Δ${lufsDelta.toFixed(2)}dB, centroid Δ${centroidDelta.toFixed(0)}Hz) — the reorderable chain may not be wired into instrument-track playback`)
      }
      console.log(`[1] PASS: distortion added via "beat effect-add" measurably changes an instrument track's output (crest Δ${crestDelta.toFixed(2)}dB, LUFS Δ${lufsDelta.toFixed(2)}dB, centroid Δ${centroidDelta.toFixed(0)}Hz) — real routing, not a no-op`)
      results.instrument = { enabled, bypassed, crestDelta, lufsDelta, centroidDelta }

      // leave dist1 re-enabled so it doesn't leak into later checks' file-diff assumptions
      await page.click('[data-effect-bypass="dist1"]')
      await pollUntil(async () => (await page.$eval('[data-effect-bypass="dist1"]', (el) => el.checked)) === true, '[1] dist1 bypass checkbox to read re-enabled')
    }

    // ============================================================================================
    // CHECK 2 — DRUM TRACK: the same reorderable-chain primitive synth tracks use
    // ============================================================================================
    {
      await selectTrack('drums')
      const baselineRows = await rowIds()
      assert(baselineRows.join(',') === 'eq3,comp,distortion,bitcrush', `[2] expected a fresh drum track's GUI to show the same default 4-entry chain a synth track gets, got: ${baselineRows.join(',')}`)
      assert(effectLinesFor(readBeat(), 'track drums').length === 0, '[2] expected the drum track\'s default chain to stay elided on disk (0 effect lines) — same canonical-elision contract as synth')
      console.log(`[2] setup: drum track shows the SAME default chain (${baselineRows.join(' -> ')}) as a synth track, elided on disk — folded from the old fixed bus insert`)

      // ADD a type that used to be synth-tracks-only even for the drum bus (eq7) — real parity,
      // not just "the same old four are now movable".
      await page.selectOption('[data-effect-add-type]', 'eq7')
      await page.click('[data-effect-add]')
      await pollUntil(async () => (await rowIds()).join(',') === 'eq3,comp,distortion,bitcrush,eq7', '[2] drums GUI row order to grow to 5 after adding eq7')
      await pollUntil(() => effectLinesFor(readBeat(), 'track drums').length === 5, '[2] file to grow to 5 effect lines under the drums track')
      const afterAdd = effectLinesFor(readBeat(), 'track drums')
      assert(afterAdd[4].trim().startsWith('effect eq7 eq7'), `[2] expected the 5th line to be the new eq7 instance, got: ${afterAdd[4]}`)
      console.log(`[2] PASS: added "eq7" (previously synth-tracks-only even for the drum bus) to the drum track via the real Effect Chain add-picker — file now has 5 effect lines under drums`)
      git(proj, 'add', '-A')
      git(proj, 'commit', '-q', '-m', 'after drums eq7 add')

      // REORDER: move eq7 up one slot (from index 4 to 3, swapping with bitcrush) — same ▲ button,
      // same small-diff property AA2 exercised on a synth track.
      await page.click('[data-effect-move-up="eq7"]')
      await pollUntil(async () => (await rowIds()).join(',') === 'eq3,comp,distortion,eq7,bitcrush', '[2] drums GUI row order to reflect the swap (eq7 <-> bitcrush)')
      await pollUntil(() => {
        const lines = effectLinesFor(readBeat(), 'track drums')
        return lines[3]?.includes(' eq7 ') && lines[4]?.includes(' bitcrush ')
      }, '[2] file to reflect the reordered drums chain')
      const moveDiff = git(proj, 'diff', '--', 'project.beat')
      const diffLines = moveDiff.split('\n').filter((l) => (l.startsWith('+') || l.startsWith('-')) && !l.startsWith('+++') && !l.startsWith('---'))
      assert(diffLines.length === 2, `[2] expected reordering one drum-track effect to be a 2-line diff (a real move, not a chain rewrite), got ${diffLines.length} changed lines:\n${moveDiff}`)
      console.log(`[2] PASS: reordering "eq7" on the drum track is a small, local 2-line diff — the same "order IS chain order" primitive synth tracks use:\n${moveDiff.split('\n').filter((l) => l.startsWith('+') || l.startsWith('-')).join('\n')}`)
      results.drums = { addedRows: afterAdd.length, reorderDiffLines: diffLines.length }
      git(proj, 'add', '-A')
      git(proj, 'commit', '-q', '-m', 'after drums eq7 reorder')

      // cleanup: remove eq7 so it doesn't leak into later assumptions
      await page.click('[data-effect-remove="eq7"]')
      await pollUntil(async () => !(await rowIds()).includes('eq7'), '[2] eq7 to disappear from the drums GUI after remove')
    }

    // ============================================================================================
    // CHECK 3 — SYNTH REGRESSION: bypass still measurably changes a synth track's output
    // ============================================================================================
    {
      await selectTrack('lead')
      const baselineRows = await rowIds()
      assert(baselineRows.join(',') === 'eq3,comp,distortion,bitcrush', `[3] expected the synth track's default chain unchanged after this stream's reconcileEffectChain refactor, got: ${baselineRows.join(',')}`)
      console.log(`[3] setup: synth track "lead" still shows the untouched default chain (${baselineRows.join(' -> ')})`)

      const { enabled, bypassed } = await withSolo('lead', async () => {
        console.log('[3] recording synth track (soloed) with bitcrush ACTIVE (bits=4, mix=1)...')
        const enabled = await recordCurrent(2.0)
        console.log(`  active:    LUFS ${enabled.integratedLufs.toFixed(2)}, crest ${enabled.crestDb.toFixed(2)} dB, centroid ${enabled.spectral.centroidHz.toFixed(0)} Hz`)

        await toggleBypass('bitcrush', false)
        await pollUntil(() => effectLinesFor(readBeat(), 'track lead').some((l) => /^\s*effect bitcrush bitcrush bypassed\s*$/.test(l)), '[3] file to gain the "bypassed" token on bitcrush')
        await pollUntil(async () => {
          const doc = await page.evaluate(() => window.__store.getState().doc)
          return doc.tracks.find((t) => t.id === 'lead').effects.find((e) => e.id === 'bitcrush').enabled === false
        }, '[3] store to reflect the bypass before re-recording')

        console.log('[3] recording synth track (soloed) with bitcrush BYPASSED...')
        const bypassed = await recordCurrent(2.0)
        console.log(`  bypassed:  LUFS ${bypassed.integratedLufs.toFixed(2)}, crest ${bypassed.crestDb.toFixed(2)} dB, centroid ${bypassed.spectral.centroidHz.toFixed(0)} Hz`)
        return { enabled, bypassed }
      })

      const crestDelta = Math.abs(enabled.crestDb - bypassed.crestDb)
      const lufsDelta = Math.abs(enabled.integratedLufs - bypassed.integratedLufs)
      const centroidDelta = Math.abs(enabled.spectral.centroidHz - bypassed.spectral.centroidHz)
      console.log(`  deltas:    crest ${crestDelta.toFixed(2)} dB, LUFS ${lufsDelta.toFixed(2)} dB, centroid ${centroidDelta.toFixed(0)} Hz`)
      // Same three-way OR as check 1 — any ONE of these clearing its bar is enough evidence the
      // bypass toggle made a real, audible difference; requiring all three would make the check
      // fragile to which portion of the loop a given recording window happens to capture.
      if (crestDelta < 1.0 && lufsDelta < 1.0 && centroidDelta < 50) {
        throw new Error(`[3] REGRESSION: bypass no longer measurably changes a synth track's audio after this stream's reconcileEffectChain refactor (crest Δ${crestDelta.toFixed(2)}dB, LUFS Δ${lufsDelta.toFixed(2)}dB, centroid Δ${centroidDelta.toFixed(0)}Hz)`)
      }
      console.log(`[3] PASS: existing synth-track effect behavior is unchanged — bypass still measurably routes bitcrush out of the graph (crest Δ${crestDelta.toFixed(2)}dB, LUFS Δ${lufsDelta.toFixed(2)}dB, centroid Δ${centroidDelta.toFixed(0)}Hz)`)
      results.synthRegression = { enabled, bypassed, crestDelta, lufsDelta, centroidDelta }
    }

    if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
    console.log('\n================ ALL PHASE 26 STREAM DC CHECKS PASSED ================')
    console.log(JSON.stringify(results, (_k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v), 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nPHASE 26 STREAM DC VERIFY FAILED:', err)
    process.exit(1)
  })

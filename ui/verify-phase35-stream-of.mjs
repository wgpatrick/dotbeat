#!/usr/bin/env node
// Phase 35 Stream OF — multi-drums-track engine support, verified against REAL rendered audio
// (docs/phase-35-plan.md §OF). The bug this stream fixes: the engine bound exactly ONE drums-kind
// track (one global drumLanes map, one bus, one drumTrackId), so a second drums track parsed,
// serialized, edited, and inspected perfectly — and was pure silence at playback. This is the
// exact proof that would have caught it: a two-drums-track project where BOTH tracks must
// measurably sound.
//
//   Project: two drums tracks, spectrally disjoint by construction —
//     "kit"   membrane-voiced kick lane, hits on steps 0/4/8/12 (four-on-the-floor lows)
//     "chops" metal-voiced lane, hits on the offbeats 2/6/10/14 (pure highs)
//   Renders (all through `beat render`'s real engine path — headless Chromium driving the live
//   ui/src/audio/engine.ts, real-time capture off the master bus):
//     1. the full mix                    (renderCommand)
//     2. each track soloed              (renderTrackSolosCommand — the mixer's own solo mechanism)
//   Asserts (measured with src/metrics analyze(): integrated LUFS + spectral band shares):
//     A  both solo renders are NON-SILENT — the second drums track actually sounds
//     B  the solos are SPECTRALLY DISTINCT — kit is low-band-dominated, chops high-band-dominated,
//        so each solo is genuinely its own track's voice, not the other leaking through
//     C  the MIX contains both — its high-band share is far above the kit solo's own (only the
//        chops track can put it there) and its low-band share far above the chops solo's own
//        (only the kick can), plus audible onset energy at every one of the 8 hit times
//
// Usage: CHROME_PATH=/opt/pw-browsers/chromium node ui/verify-phase35-stream-of.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg)
}
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(1) : String(x))

async function main() {
  const core = await import(pathToFileURL(join(repoRoot, 'dist/src/core/index.js')).href)
  const { decodeWav, analyze } = await import(pathToFileURL(join(repoRoot, 'dist/src/metrics/index.js')).href)
  const { renderCommand, renderTrackSolosCommand } = await import(pathToFileURL(join(repoRoot, 'cli/render.mjs')).href)

  // ---- build the two-drums-track project --------------------------------------------------------
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p35of-'))
  const beatPath = join(proj, 'two-kits.beat')
  let doc = core.initDocument({ trackId: 'lead', bpm: 120, loopBars: 1 })
  doc = core.addTrack(doc, {
    id: 'kit',
    kind: 'drums',
    lanes: [{ name: 'kick', backing: { type: 'synth', voice: 'membrane', params: {} } }],
  }).doc
  doc = core.addTrack(doc, {
    id: 'chops',
    kind: 'drums',
    lanes: [{ name: 'chime', backing: { type: 'synth', voice: 'metal', params: { decay: 0.15 } } }],
  }).doc
  for (const s of [0, 4, 8, 12]) doc = core.addHit(doc, 'kit', { lane: 'kick', start: s, velocity: 1 }).doc
  for (const s of [2, 6, 10, 14]) doc = core.addHit(doc, 'chops', { lane: 'chime', start: s, velocity: 1 }).doc
  writeFileSync(beatPath, core.serialize(doc))
  console.log(`project: ${beatPath} (kit=membrane kick @ 0/4/8/12, chops=metal @ 2/6/10/14, 1 bar @ 120bpm)`)

  // ---- render: full mix + each track soloed ------------------------------------------------------
  const mixPath = join(proj, 'mix.wav')
  console.log('\nrendering the FULL MIX (real engine, headless)...')
  await renderCommand([beatPath, '-o', mixPath, '--tail', '0.6', '--daemon-port', '8641', '--preview-port', '5641'])

  console.log('rendering each drums track SOLOED (the mixer’s own solo mechanism)...')
  const solos = await renderTrackSolosCommand(beatPath, ['kit', 'chops'], { tail: 0.6, daemonPort: 8642, previewPort: 5642 })

  const metricsOf = (bytes) => {
    const wav = decodeWav(bytes)
    return analyze(wav.channels, wav.sampleRate)
  }
  const mix = metricsOf(readFileSync(mixPath))
  const kit = metricsOf(solos.get('kit'))
  const chops = metricsOf(solos.get('chops'))

  const low = (m) => m.spectral.bandsPct.sub + m.spectral.bandsPct.bass // < 250 Hz share
  const high = (m) => m.spectral.bandsPct.presence + m.spectral.bandsPct.air // > 2 kHz share
  const report = (name, m) =>
    console.log(
      `  ${name.padEnd(10)} LUFS ${fmt(m.integratedLufs).padStart(6)}  rms ${fmt(m.rmsDbfs).padStart(6)} dBFS  ` +
        `low(<250Hz) ${fmt(low(m)).padStart(5)}%  high(>2kHz) ${fmt(high(m)).padStart(5)}%  centroid ${Math.round(m.spectral.centroidHz)} Hz`,
    )
  console.log('\nmeasured:')
  report('kit solo', kit)
  report('chops solo', chops)
  report('mix', mix)

  // ---- A: both solos are non-silent (the exact assertion the old engine failed) ------------------
  assert(kit.integratedLufs > -50, `[A] kit solo should be clearly audible, got ${fmt(kit.integratedLufs)} LUFS`)
  assert(chops.integratedLufs > -50, `[A] chops (SECOND drums track) solo should be clearly audible — this is the multi-drums-track bug — got ${fmt(chops.integratedLufs)} LUFS`)
  console.log('[A] PASS: both drums tracks are non-silent when soloed')

  // ---- B: the solos are spectrally distinct ------------------------------------------------------
  assert(low(kit) > 60, `[B] kit solo should be low-band dominated (membrane kick), got low share ${fmt(low(kit))}%`)
  assert(high(kit) < 15, `[B] kit solo should carry almost no >2kHz energy, got ${fmt(high(kit))}%`)
  assert(high(chops) > 40, `[B] chops solo should be high-band dominated (metal voice), got high share ${fmt(high(chops))}%`)
  assert(low(chops) < 20, `[B] chops solo should carry little <250Hz energy, got ${fmt(low(chops))}%`)
  assert(low(kit) - low(chops) > 40, `[B] the two solos' low-band shares should be far apart (${fmt(low(kit))}% vs ${fmt(low(chops))}%)`)
  assert(high(chops) - high(kit) > 30, `[B] the two solos' high-band shares should be far apart (${fmt(high(chops))}% vs ${fmt(high(kit))}%)`)
  console.log('[B] PASS: the two solos are spectrally distinct (each is its own track’s voice)')

  // ---- C: the mix contains BOTH tracks -----------------------------------------------------------
  // High-band energy in the mix can only come from the chops track (the kit solo proves the kick
  // puts almost nothing >2kHz); low-band energy can only come from the kick.
  assert(high(mix) > high(kit) + 10, `[C] mix high-band share ${fmt(high(mix))}% should far exceed the kit solo's own ${fmt(high(kit))}% — the second drums track must be IN the mix`)
  assert(low(mix) > low(chops) + 10, `[C] mix low-band share ${fmt(low(mix))}% should far exceed the chops solo's own ${fmt(low(chops))}% — the kick must be IN the mix`)

  // Onset check: audible energy right after every one of the 8 hit times (mix starts at the step-0
  // kick because render trims leading silence; steps are 0.125s @ 120bpm).
  const wav = decodeWav(readFileSync(mixPath))
  const rmsWindow = (fromSec, toSec) => {
    const ch = wav.channels[0]
    const lo = Math.max(0, Math.round(fromSec * wav.sampleRate))
    const hi = Math.min(ch.length, Math.round(toSec * wav.sampleRate))
    let sum = 0
    for (let i = lo; i < hi; i++) sum += ch[i] * ch[i]
    return Math.sqrt(sum / Math.max(1, hi - lo))
  }
  const stepSec = 60 / 120 / 4
  const onsets = []
  for (const s of [0, 2, 4, 6, 8, 10, 12, 14]) {
    const t = s * stepSec
    const r = rmsWindow(t + 0.005, t + 0.05)
    onsets.push({ step: s, rms: r })
    assert(r > 0.01, `[C] expected audible energy right after step ${s} (t=${t.toFixed(2)}s) in the mix, got RMS ${r.toFixed(5)}`)
  }
  console.log('  mix onsets: ' + onsets.map((o) => `s${o.step}=${o.rms.toFixed(3)}`).join(' '))
  console.log('[C] PASS: the mix contains both tracks (band shares + all 8 hit onsets audible)')

  console.log('\n=== Phase 35 Stream OF verification: ALL PASS ===')
  console.log(
    JSON.stringify(
      {
        kitSolo: { lufs: kit.integratedLufs, lowPct: low(kit), highPct: high(kit), centroidHz: kit.spectral.centroidHz },
        chopsSolo: { lufs: chops.integratedLufs, lowPct: low(chops), highPct: high(chops), centroidHz: chops.spectral.centroidHz },
        mix: { lufs: mix.integratedLufs, lowPct: low(mix), highPct: high(mix), centroidHz: mix.spectral.centroidHz },
      },
      null,
      2,
    ),
  )
}

main()
  .then(() => process.exit(0)) // chromium pipes/esbuild keep the loop alive — same exit pattern as cli/render.mjs
  .catch((err) => {
    console.error(err.stack ?? String(err))
    process.exit(1)
  })

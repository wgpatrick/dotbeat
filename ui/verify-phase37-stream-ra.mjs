#!/usr/bin/env node
// Phase 37 Stream RA — section-aware feedback, verified against REAL rendered audio
// (docs/phase-37-plan.md §RA). `beat feedback --sections` renders a song ONCE, slices the capture
// at the section boundaries, and reports the per-section energy arc. This proof builds a song whose
// two sections differ AUDIBLY by construction and asserts the REPORTED per-section numbers pick that
// contrast up.
//
//   Project: two synth tracks, each placed in exactly one section, so each section is that one
//   track alone —
//     section 1 "intro" (2 bars): track "dark"   — low cutoff (350 Hz), low volume (-22 dB),
//                                                    low pitch, low velocity  => quiet + dark
//     section 2 "drop"  (2 bars): track "bright"  — open cutoff (9 kHz), loud (-6 dB), high pitch,
//                                                    full velocity            => loud + bright
//   Both tracks are sawtooth (rich harmonics) so the cutoff difference maps straight to brightness.
//
//   Runs `beat feedback <file> --sections --json` (the shipped CLI, its own real-time render through
//   dotbeat's engine in headless Chromium) and asserts on the reported per-section metrics:
//     A  section 2 is measurably LOUDER than section 1 (intended loudness arc)
//     B  section 2 is measurably BRIGHTER than section 1 — both by spectral centroid AND by
//        >2 kHz band share (intended brightness arc)
//     C  the movement clears the render-run variance floor (a real audible change, not render noise)
//   Then runs the same command WITHOUT --json to capture a real human-readable sample.
//
// Usage: CHROME_PATH=/opt/pw-browsers/chromium node ui/verify-phase37-stream-ra.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg)
}
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(1) : String(x))
const beatCli = join(repoRoot, 'cli', 'beat.mjs')

async function main() {
  const core = await import(pathToFileURL(join(repoRoot, 'dist/src/core/index.js')).href)
  // Same render-run variance floors `beat feedback` flags movement against.
  const { RENDER_RUN_VARIANCE_LU, RENDER_RUN_VARIANCE_BAND_PCT } = await import(pathToFileURL(join(repoRoot, 'dist/src/metrics/index.js')).href)

  // ---- build the two-section song ---------------------------------------------------------------
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p37ra-'))
  const beatPath = join(proj, 'arc.beat')
  let doc = core.initDocument({ trackId: 'dark', bpm: 120, loopBars: 2 })

  // "dark" track: sawtooth, low cutoff, quiet, no filter-env sweep muddying the static brightness.
  doc = core.setValue(doc, 'dark.osc', 'sawtooth')
  doc = core.setValue(doc, 'dark.cutoff', '350')
  doc = core.setValue(doc, 'dark.volume', '-22')
  doc = core.setValue(doc, 'dark.sustain', '1')
  doc = core.setValue(doc, 'dark.filterEnvAmount', '0')

  // "bright" track: sawtooth, wide-open cutoff, loud.
  doc = core.addTrack(doc, { id: 'bright', kind: 'synth' }).doc
  doc = core.setValue(doc, 'bright.osc', 'sawtooth')
  doc = core.setValue(doc, 'bright.cutoff', '9000')
  doc = core.setValue(doc, 'bright.volume', '-6')
  doc = core.setValue(doc, 'bright.sustain', '1')
  doc = core.setValue(doc, 'bright.filterEnvAmount', '0')

  // Two bars = 32 sixteenth-steps; a sustained note per quarter so each section has continuous
  // energy. Dark: low pitch (MIDI 40 ≈ E2), low velocity. Bright: high pitch (MIDI 76 ≈ E5), full.
  for (let s = 0; s < 32; s += 4) {
    doc = core.addNote(doc, 'dark', { pitch: 40, start: s, duration: 4, velocity: 0.35 }).doc
    doc = core.addNote(doc, 'bright', { pitch: 76, start: s, duration: 4, velocity: 1.0 }).doc
  }

  // Snapshot each track's content into a clip, then a scene per section slotting ONE track — so
  // section 1 is dark-only and section 2 is bright-only in the render.
  doc = core.saveClip(doc, 'dark', 'darkClip').doc
  doc = core.saveClip(doc, 'bright', 'brightClip').doc
  doc = core.setScene(doc, 'intro', { dark: 'darkClip' })
  doc = core.setScene(doc, 'drop', { bright: 'brightClip' })
  doc = core.setSong(doc, [
    { scene: 'intro', bars: 2 },
    { scene: 'drop', bars: 2 },
  ])
  writeFileSync(beatPath, core.serialize(doc))
  console.log(`project: ${beatPath}`)
  console.log('  section 1 "intro" (2 bars): dark  saw, cutoff 350 Hz, vol -22 dB, pitch 40, vel 0.35')
  console.log('  section 2 "drop"  (2 bars): bright saw, cutoff 9 kHz, vol  -6 dB, pitch 76, vel 1.0')

  // ---- run the shipped CLI: beat feedback --sections --json (renders through the real engine) ----
  console.log('\nrunning `beat feedback arc.beat --sections --json` (real engine, headless)...')
  const jsonOut = execFileSync(process.execPath, [beatCli, 'feedback', beatPath, '--sections', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'], // render logs -> our stderr; JSON on stdout
    maxBuffer: 64 * 1024 * 1024,
  })
  const parsed = JSON.parse(jsonOut)
  const sections = parsed.sections
  assert(Array.isArray(sections) && sections.length === 2, `expected 2 sections in the report, got ${sections?.length}`)

  const s1 = sections[0]
  const s2 = sections[1]
  const high = (m) => m.spectral.bandsPct.presence + m.spectral.bandsPct.air
  const report = (s) =>
    console.log(
      `  [${s.index + 1}] ${String(s.label).padEnd(6)} ${s.bars} bars  ` +
        `LUFS ${fmt(s.metrics.integratedLufs).padStart(6)}  centroid ${Math.round(s.metrics.spectral.centroidHz)
          .toString()
          .padStart(5)} Hz  high(>2kHz) ${fmt(high(s.metrics)).padStart(5)}%  crest ${fmt(s.metrics.crestDb)} dB`,
    )
  console.log('\nreported per-section metrics:')
  report(s1)
  report(s2)

  const lufsDelta = s2.metrics.integratedLufs - s1.metrics.integratedLufs
  const centroidDelta = s2.metrics.spectral.centroidHz - s1.metrics.spectral.centroidHz
  const highDelta = high(s2.metrics) - high(s1.metrics)

  // ---- A: loudness arc --------------------------------------------------------------------------
  assert(lufsDelta > RENDER_RUN_VARIANCE_LU, `[A] section 2 should be measurably LOUDER than section 1 (LU delta ${fmt(lufsDelta)} must clear the ${RENDER_RUN_VARIANCE_LU} LU render-run floor)`)
  assert(lufsDelta > 5, `[A] the intended loudness contrast is large (~16 dB of track gain); expected >5 LU, got ${fmt(lufsDelta)}`)
  console.log(`[A] PASS: section 2 is ${fmt(lufsDelta)} LU louder than section 1`)

  // ---- B: brightness arc (centroid AND >2kHz share) ---------------------------------------------
  assert(centroidDelta > 1000, `[B] section 2 should be far BRIGHTER by spectral centroid, expected +>1000 Hz, got ${fmt(centroidDelta)} Hz (${Math.round(s1.metrics.spectral.centroidHz)} -> ${Math.round(s2.metrics.spectral.centroidHz)})`)
  assert(highDelta > RENDER_RUN_VARIANCE_BAND_PCT, `[B] section 2's >2kHz share should clear the ${RENDER_RUN_VARIANCE_BAND_PCT}pt band floor above section 1's, got +${fmt(highDelta)}pt`)
  console.log(`[B] PASS: section 2 is brighter (+${Math.round(centroidDelta)} Hz centroid, +${fmt(highDelta)}pt high-band share)`)

  // ---- C: the movement is a real audible change, not render noise --------------------------------
  assert(lufsDelta > RENDER_RUN_VARIANCE_LU && highDelta > RENDER_RUN_VARIANCE_BAND_PCT, '[C] both loudness and brightness moves clear their variance floors')
  console.log('[C] PASS: the reported section-to-section movement is above the render-run variance floor')

  // ---- capture a real human-readable sample -----------------------------------------------------
  console.log('\nrunning `beat feedback arc.beat --sections` (human report) for a sample...')
  const humanOut = execFileSync(process.execPath, [beatCli, 'feedback', beatPath, '--sections'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  })
  console.log('\n----- beat feedback --sections (sample output) -----')
  console.log(humanOut.trimEnd())
  console.log('----------------------------------------------------')

  console.log('\n=== Phase 37 Stream RA verification: ALL PASS ===')
  console.log(
    JSON.stringify(
      {
        section1: { label: s1.label, lufs: s1.metrics.integratedLufs, centroidHz: s1.metrics.spectral.centroidHz, highPct: high(s1.metrics), crestDb: s1.metrics.crestDb },
        section2: { label: s2.label, lufs: s2.metrics.integratedLufs, centroidHz: s2.metrics.spectral.centroidHz, highPct: high(s2.metrics), crestDb: s2.metrics.crestDb },
        deltas: { lufs: lufsDelta, centroidHz: centroidDelta, highPct: highDelta },
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

#!/usr/bin/env node
// Fetch FreePats MuldjordKit (docs/phase-10-plan.md Stream B; docs/research/09-sample-source-
// licenses.md bundle-today shortlist item 2: CC-BY 4.0). Deferred in Phase 7
// (docs/phase-7-plan.md: "blocked on GitHub-release proxy access") — Phase 9 Stream F confirmed
// GitHub release assets ARE reachable from this machine now, so this fetch is no longer blocked;
// verified live 2026-07-11 (github.com/freepats/muldjordkit/releases/... 302-redirects to a
// working release-assets.githubusercontent.com URL, downloads fine).
//
// Uses the SF2 release variant (not .h2drumkit) so it drops into the exact same
// presets/sf2/ + instrument-track + SoundBankLoader path already proven for the FluidR3 GM and
// piano fixtures — no new loader/format work needed. The full kit is a single preset (a drum kit
// has no "programs" to select between) at ~209MB raw (480 samples: multi-mic, multi-velocity,
// round-robin); trimmed here to 2 velocity layers per key via spessasynth_core's own
// trim()/writeSF2(), the same "small variant for repo size" move as fetch-fluidr3-gm.mjs and the
// original upright-piano-kw-small.sf2 fixture. NOTE: this bundles the raw multi-mic kit as one
// playable SF2 preset — it is NOT yet broken out into per-lane one-shots
// (presets/kit-init/kit-audiophob's kick.wav/snare.wav/... convention); that's a follow-up
// content-curation pass (picking which of the kit's 13 pieces maps to which of dotbeat's 5 drum
// lanes is a judgment call, not a fetch step), noted in docs/phase-7-plan.md's Stream B update.
//
// Requires `7z` (or `7za`) on PATH to extract the release's .7z archive (present via Homebrew's
// p7zip on this machine; not universally available — this script fails loudly with a clear
// message if missing rather than silently skipping).
//
//   node scripts/fetch-muldjordkit.mjs [--out presets/sf2/muldjordkit-small.sf2]

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] : dflt
}
const outPath = resolve(repoRoot, flag('--out', 'presets/sf2/muldjordkit-small.sf2'))

const RELEASE_URL = 'https://github.com/freepats/muldjordkit/releases/download/2020-10-18/MuldjordKit-SF2-20201018.7z'
const SOURCE_NOTE =
  'FreePats MuldjordKit, SF2 release (https://freepats.zenvoid.org/Percussion/acoustic-drum-kit.html#MuldjordKit), ' +
  `downloaded from ${RELEASE_URL}; original kit by Lars Muldjord for DrumGizmo (www.muldjord.com, www.drumgizmo.org), ` +
  'assembled into this SF2/FreePats form by roberto@zenvoid.org for the FreePats project'

let sevenZip = null
for (const candidate of ['7z', '7za', '7zr']) {
  try {
    execFileSync(candidate, ['--help'], { stdio: 'ignore' })
    sevenZip = candidate
    break
  } catch {
    // try next
  }
}
if (!sevenZip) {
  console.error('fetch-muldjordkit.mjs: no `7z`/`7za`/`7zr` on PATH — cannot extract the release archive.')
  console.error('Install p7zip (e.g. `brew install p7zip`) and re-run. Not bundling anything.')
  process.exit(1)
}

const scratch = mkdtempSync(join(tmpdir(), 'muldjordkit-fetch-'))
try {
  console.error(`fetching ${RELEASE_URL}`)
  const archivePath = join(scratch, 'MuldjordKit-SF2.7z')
  execFileSync('curl', ['-sL', '--fail', '--max-time', '180', '-o', archivePath, RELEASE_URL], { stdio: 'inherit' })

  console.error(`extracting (${sevenZip})`)
  execFileSync(sevenZip, ['x', archivePath], { cwd: scratch, stdio: 'inherit' })

  const extractedDir = readdirSync(scratch).find((d) => d !== 'MuldjordKit-SF2.7z')
  if (!extractedDir) throw new Error('extraction produced no directory')
  const dirPath = join(scratch, extractedDir)
  const files = readdirSync(dirPath)
  const sf2Name = files.find((f) => f.toLowerCase().endsWith('.sf2'))
  const licenseName = files.find((f) => /^license/i.test(f))
  const readmeName = files.find((f) => /^readme/i.test(f))
  if (!sf2Name || !licenseName) throw new Error(`expected .sf2 + LICENSE in archive, got: ${files.join(', ')}`)

  const licenseText = readFileSync(join(dirPath, licenseName), 'utf8')
  if (!/Creative Commons Attribution 4\.0 International Public License/i.test(licenseText)) {
    throw new Error('LICENSE.txt does not read as CC-BY 4.0 — refusing to bundle, license mismatch from research 09\'s audit')
  }
  const readmeText = readmeName ? readFileSync(join(dirPath, readmeName), 'utf8') : ''
  if (!/Muldjord/i.test(readmeText)) {
    console.error('warning: README does not mention "Muldjord" as expected — proceeding, but double-check provenance')
  }

  console.error('loading full bank + trimming to 2 velocity layers/key (spessasynth_core)')
  const { SoundBankLoader } = await import('spessasynth_core')
  const fullSf2Path = join(dirPath, sf2Name)
  const fullBytes = readFileSync(fullSf2Path)
  const bank = SoundBankLoader.fromArrayBuffer(fullBytes.buffer.slice(fullBytes.byteOffset, fullBytes.byteOffset + fullBytes.byteLength))
  if (bank.presets.length !== 1) throw new Error(`expected exactly 1 preset (a drum kit), got ${bank.presets.length} — upstream kit structure changed?`)
  const preset = bank.presets[0]

  // Keep 2 velocity layers (soft/hard) per key — cuts the round-robin/velocity-layer sample
  // count way down (480 -> ~80 samples) while keeping some dynamic range, matching the
  // "small variant for repo size" convention used for the piano and FluidR3 GM fixtures.
  const VELOCITY_LAYERS = [64, 110]
  const keyMap = new Map()
  for (let key = 0; key < 128; key++) keyMap.set(key, new Set(VELOCITY_LAYERS))
  bank.trim(new Map([[preset, keyMap]]))

  const outBytes = Buffer.from(bank.writeSF2())
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, outBytes)

  const sha256 = createHash('sha256').update(outBytes).digest('hex')
  const sidecar = {
    source: SOURCE_NOTE,
    license: 'CC-BY-4.0',
    retrievedAt: new Date().toISOString().slice(0, 10),
    sha256,
    bytes: outBytes.byteLength,
    credit:
      'Lars Muldjord (original MuldjordKit for DrumGizmo, 2010/2018, www.muldjord.com) — ' +
      'assembled for FreePats by roberto@zenvoid.org (https://freepats.zenvoid.org/Percussion/acoustic-drum-kit.html#MuldjordKit); ' +
      'upstream DrumGizmo project asks that reuses also credit "Drum samples provided by DrumGizmo.org"',
    verifiedAudit: 'docs/research/09-sample-source-licenses.md, bundle-today shortlist item 2 — CC-BY 4.0, fully documented chain',
    notes:
      'Trimmed from the full ~209MB MuldjordKit 20201018.sf2 (1 preset, 480 samples across 13 kit pieces, multi-mic, ' +
      `multiple velocity layers + round-robin) to ${bank.samples.length} samples (2 velocity layers per key: ${VELOCITY_LAYERS.join(', ')}) ` +
      'via spessasynth_core BasicSoundBank.trim()/writeSF2(). Bundled as a single playable SF2 preset (loads via the same ' +
      'instrument-track + SoundBankLoader path as fluidr3-gm-small.sf2/upright-piano-kw-small.sf2) — NOT yet broken out into ' +
      'per-lane one-shots (presets/kit-init/kit-audiophob convention); that mapping (13 kit pieces -> 5 dotbeat drum lanes) is a ' +
      'follow-up curation pass, not a fetch step. Full-quality full-kit .sf2 and the original 16-channel DrumGizmo/.h2drumkit ' +
      'release available upstream (see "source").',
  }
  writeFileSync(`${outPath}.json`, JSON.stringify(sidecar, null, 2) + '\n')

  console.error(`wrote ${outPath} (${outBytes.byteLength} bytes, ${bank.samples.length} samples) + sidecar`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

#!/usr/bin/env node
// Fetch FluidR3 GM (docs/phase-10-plan.md Stream B; docs/research/09-sample-source-licenses.md
// bundle-today-shortlist item 4: MIT, Frank Wen 2000-2013). Full FluidR3_GM.sf2 is ~148MB — well
// past what's sane to bundle in this repo (GitHub's own hard limit is 100MB/file) — so this
// script trims it in place to a small, representative preset set using spessasynth_core's own
// trim()/writeSF2() (the same library `beat inspect` reads .sf2 files with, so anything it can
// write back out is guaranteed round-trippable), the same "small variant for repo size" move
// research 09 + Phase 7 already made for the piano fixture
// (presets/sf2/upright-piano-kw-small.sf2.json: "Small variant chosen for repo size").
//
// Source: the Debian `fluid-soundfont-gm` package — a straight repack of the upstream
// musescore.org fluid-soundfont.tar.gz, MIT-licensed per its own copyright file AND per the
// license comment embedded in the .sf2's own INFO chunk ("Licensed under the MIT License.",
// engineer "Frank Wen") — belt and suspenders, matches research 09's audit exactly (self-attested
// MIT chain, "accepted by Debian/Fedora/MuseScore legal review").
//
// Requires `ar` and `tar` on PATH (standard on macOS/Linux; this script does not attempt to
// support Windows).
//
//   node scripts/fetch-fluidr3-gm.mjs [--out presets/sf2/fluidr3-gm-small.sf2]

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] : dflt
}
const outPath = resolve(repoRoot, flag('--out', 'presets/sf2/fluidr3-gm-small.sf2'))

const DEB_URL = 'http://ftp.debian.org/debian/pool/main/f/fluid-soundfont/fluid-soundfont-gm_3.1-5.3_all.deb'
const SOURCE_NOTE =
  'Debian package fluid-soundfont-gm 3.1-5.3 (http://ftp.debian.org/debian/pool/main/f/fluid-soundfont/), ' +
  'itself downloaded from http://www.musescore.org/download/fluid-soundfont.tar.gz per the package copyright ' +
  'file; upstream author Frank Wen <getfrank@gmail.com>; trimmed to a small preset subset here — ' +
  'full-quality full-bank .sf2 available upstream'

// A curated GM program set for a small, useful demo bank: a spread of melodic instruments plus
// the classic "Standard" GM drum kit — enough to exercise multi-preset listing
// (cli/beat.mjs's instrumentPresetInfo, docs/phase-9-* Stream C) against real, named GM content.
// (program, exact preset name, isGMGSDrum) triples pin the exact preset — FluidR3 reuses program
// numbers between the melodic bank and drum kits (this is normal GM: a drum kit only activates on
// MIDI channel 10), so name + drum-flag disambiguates.
const WANTED_PRESETS = [
  { program: 0, name: 'Yamaha Grand Piano', drum: false },
  { program: 24, name: 'Nylon String Guitar', drum: false },
  { program: 32, name: 'Acoustic Bass', drum: false },
  { program: 40, name: 'Violin', drum: false },
  { program: 56, name: 'Trumpet', drum: false },
  { program: 73, name: 'Flute', drum: false },
  { program: 118, name: 'Synth Drum', drum: false },
  { program: 0, name: 'Standard', drum: true },
]

const scratch = mkdtempSync(join(tmpdir(), 'fluidr3-fetch-'))
try {
  console.error(`fetching ${DEB_URL}`)
  const debPath = join(scratch, 'fluid-soundfont-gm.deb')
  execFileSync('curl', ['-sL', '--fail', '--max-time', '180', '-o', debPath, DEB_URL], { stdio: 'inherit' })

  console.error('extracting .deb (ar) -> data.tar.xz -> .sf2 (tar)')
  execFileSync('ar', ['x', 'fluid-soundfont-gm.deb'], { cwd: scratch })
  const sf2Rel = './usr/share/sounds/sf2/FluidR3_GM.sf2'
  const copyrightRel = './usr/share/doc/fluid-soundfont-gm/copyright'
  execFileSync('tar', ['xJf', 'data.tar.xz', sf2Rel, copyrightRel], { cwd: scratch })

  const fullSf2Path = join(scratch, 'usr/share/sounds/sf2/FluidR3_GM.sf2')
  const copyrightPath = join(scratch, 'usr/share/doc/fluid-soundfont-gm/copyright')
  const copyrightText = readFileSync(copyrightPath, 'utf8')
  if (!/MIT license/i.test(copyrightText)) {
    throw new Error('Debian copyright file does not mention the MIT license as expected — refusing to bundle, license mismatch from research 09\'s audit')
  }

  console.error('loading full bank + trimming to the curated preset set (spessasynth_core)')
  const { SoundBankLoader } = await import('spessasynth_core')
  const fullBytes = readFileSync(fullSf2Path)
  const bank = SoundBankLoader.fromArrayBuffer(fullBytes.buffer.slice(fullBytes.byteOffset, fullBytes.byteOffset + fullBytes.byteLength))

  // Belt-and-suspenders: the license is also embedded in the sf2's own INFO chunk.
  if (!/MIT License/i.test(bank.soundBankInfo?.comment ?? '')) {
    throw new Error(`sf2 INFO comment does not confirm MIT license (got: ${JSON.stringify(bank.soundBankInfo?.comment)}) — refusing to bundle`)
  }

  const selected = WANTED_PRESETS.map((w) => {
    const p = bank.presets.find((p) => p.program === w.program && p.name === w.name && !!p.isGMGSDrum === w.drum)
    if (!p) throw new Error(`expected preset not found in FluidR3_GM.sf2: ${JSON.stringify(w)} (upstream bank contents changed?)`)
    return p
  })

  // Keep every key/velocity combination for each selected preset — this trims *presets* (and the
  // instruments/samples only reachable through discarded presets), not sample quality or range.
  const trimMap = new Map()
  for (const p of selected) {
    const keyMap = new Map()
    for (let key = 0; key < 128; key++) keyMap.set(key, new Set(Array.from({ length: 128 }, (_, v) => v)))
    trimMap.set(p, keyMap)
  }
  bank.trim(trimMap)

  const outBytes = Buffer.from(bank.writeSF2())
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, outBytes)

  const sha256 = createHash('sha256').update(outBytes).digest('hex')
  const sidecar = {
    source: `FluidR3 GM (Frank Wen, 2000-2013) — ${SOURCE_NOTE}`,
    license: 'MIT',
    retrievedAt: new Date().toISOString().slice(0, 10),
    sha256,
    bytes: outBytes.byteLength,
    credit: 'Frank Wen (FluidR3 GM), packaged for Debian by Toby Smithe',
    verifiedAudit: 'docs/research/09-sample-source-licenses.md, bundle-today shortlist item 4 — MIT, self-attested chain accepted by Debian/Fedora/MuseScore legal review',
    notes:
      `Trimmed from the full 148MB FluidR3_GM.sf2 to ${selected.length} presets ` +
      `(${selected.map((p) => `program ${p.program}${p.isGMGSDrum ? ' [drum]' : ''} "${p.name}"`).join(', ')}) ` +
      'via spessasynth_core BasicSoundBank.trim()/writeSF2() — full key/velocity range preserved per kept preset, ' +
      'only unused presets/instruments/samples dropped. Full-quality full-bank .sf2 available upstream ' +
      '(see "source").',
  }
  writeFileSync(`${outPath}.json`, JSON.stringify(sidecar, null, 2) + '\n')

  console.error(`wrote ${outPath} (${outBytes.byteLength} bytes, ${selected.length} presets) + sidecar`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

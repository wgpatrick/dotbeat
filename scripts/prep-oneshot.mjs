#!/usr/bin/env node
// One-shot sample prep (docs/phase-7-plan.md §7.4): trim leading/trailing silence, short
// fade-out against clicks, peak-normalize with headroom, write 16-bit PCM WAV + a provenance
// sidecar. Defaults are sensible conventions pending research-09's prep checklist; every
// prepped file records the exact settings used.
//
//   node scripts/prep-oneshot.mjs <in.wav> <out.wav> --license <text> --source <text> [--peak-db -6]
//
// Phase 37 Stream RD: the prep core now lives in scripts/prep-oneshot-lib.mjs so `beat source`
// shares the exact same pipeline; this file is a byte-identical-behavior thin wrapper (same args,
// same files written, same stdout line).

import { prepOneshot, PrepError } from './prep-oneshot-lib.mjs'

const [inPath, outPath, ...rest] = process.argv.slice(2)
if (!inPath || !outPath) {
  console.error('usage: prep-oneshot.mjs <in.wav> <out.wav> --license <text> --source <text> [--peak-db -6]')
  process.exit(2)
}
const flag = (name, dflt) => {
  const i = rest.indexOf(name)
  return i !== -1 ? rest[i + 1] : dflt
}
const peakDb = Number(flag('--peak-db', '-6'))
const license = flag('--license', 'UNKNOWN')
const source = flag('--source', 'UNKNOWN')

try {
  const { len, sampleRate, sha256 } = await prepOneshot({ inPath, outPath, peakDb, license, source })
  console.log(`${outPath}: ${(len / sampleRate).toFixed(3)}s, peak -> ${peakDb} dBFS, sha256 ${sha256.slice(0, 12)}...`)
} catch (err) {
  if (err instanceof PrepError) {
    console.error(err.message)
    process.exit(2)
  }
  throw err
}

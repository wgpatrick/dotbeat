#!/usr/bin/env node
// Throwaway diagnostic: dump the built layered architectures for the nine rated seeds so the
// waveform / highpass / send / envelope facts can be checked against docs/priors/layering.md.
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { layeredArchitecture } = await import(`${repo}/dist/src/taste/layered.js`)
const SEEDS = { bassline: [41, 1050, 2059], chords: [138, 1147, 2156], lead: [235, 1244, 2253] }
for (const [role, seeds] of Object.entries(SEEDS)) {
  for (const s of seeds) {
    const a = layeredArchitecture(role, s)
    console.log(`\n=== ${role} seed ${s} [${a.draw.family}] ${a.layers.length} layers`)
    for (const l of a.layers) {
      console.log(
        `   ${l.id.padEnd(7)} ${String(l.patch.osc).padEnd(9)} osc2=${String(l.patch.osc2Type ?? '-')}@${l.patch.osc2Detune ?? '-'}c lvl${l.patch.osc2Level ?? 0} noise=${l.patch.noiseLevel ?? 0}` +
          ` | ${l.band.mode} ${l.band.cutoffHz}Hz restLP=${l.patch.eq7LpOn === true ? l.patch.eq7LpFreq : '-'} ${l.figure.transpose > 0 ? '+' : ''}${l.figure.transpose}st | ${l.gainDb}dB | mono=${l.mono}` +
          ` | rev=${l.patch.sendReverb ?? 'unset'} del=${l.patch.sendDelay ?? 'unset'} | eqHigh=${l.patch.eqHigh ?? 0}` +
          ` | sus=${l.patch.sustain} dec=${l.patch.decay} rel=${l.patch.release} | maxDur=${l.figure.maxDurationSteps ?? '-'} pick=${l.figure.pick}`,
      )
    }
  }
}

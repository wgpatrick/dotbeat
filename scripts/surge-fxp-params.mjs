// Read a Surge XT `.fxp` preset's stored parameters WITHOUT running Surge.
//
// `.fxp` is a VST2 preset container whose chunk is Surge's own patch dump as a UTF-8 XML document
// (`<patch revision="N"><meta …/><parameters><a_env1_attack type="2" value="-8.0" />…`). Nothing
// about reading it needs surgepy, which is what makes target-aware curation over 3,559 patches take
// seconds instead of an afternoon of renders.
//
// The conversions and their sources are research 141 §2, which verified them against Surge itself
// on a 500-patch sample (cutoff 500/500, resonance 500/500, sustain 500/500, unison detune 419/419;
// every envelope-time mismatch was the same known display-floor convention, never a conversion
// error). Restated here so this file is checkable on its own:
//
//   envelope times  seconds = 2^raw, raw in [-8, 5]  ->  3.906 ms … 32 s   (Parameter.cpp ct_envtime)
//   filter cutoff   Hz      = 440 · 2^(raw/12)       ->  13.75 Hz … 25 kHz (Parameter.cpp:646)
//   sustain/levels  0…1 as stored                                          (SurgePatch.cpp ct_percent)
//
// TWO DECODING TRAPS, both of which a naive parse gets silently wrong (141 §2):
//   1. `env1_*` is the AMP envelope and `env2_*` is the FILTER envelope, not the other way round.
//   2. Old streaming revisions write FLOAT parameters with `type="0"`; `pdata` is a union, so the
//      stored integer is the value's IEEE-754 BIT PATTERN, not the number. 22 streaming revisions
//      appear in the installed corpus, so this affects a large minority of third-party patches.
//
// Read the SOUNDING scene: `scene_active` names it and 32 factory patches point at scene B, so
// reading scene A blindly mis-measures them. Dual/split patches also sound scene B, which this
// (like 141) does not measure — a known, reported blind spot.

import { readFileSync } from 'node:fs'

/** Surge's minimum envelope time: 2^-8 s. The UI prints "0.00 s" here; the digital envelope really
 * does ramp over 3.906 ms, so "at the floor" means "the designer asked for zero". */
export const ENV_FLOOR_MS = 3.90625

const bits = new DataView(new ArrayBuffer(4))

/** Reinterpret a streamed value as the float Surge's DSP will read. `type` is the XML valtype:
 * 2 = float, anything else on a float-valued param = the IEEE-754 bit pattern of that float. */
function asFloat(type, raw) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  if (type === 2) return n
  bits.setInt32(0, Math.trunc(n), true)
  return bits.getFloat32(0, true)
}

/** Extract the XML patch document out of the .fxp container. */
export function patchXml(fxpPath) {
  const buf = readFileSync(fxpPath)
  const at = buf.indexOf('<patch')
  if (at < 0) return null
  return buf.toString('utf8', at)
}

function field(xml, name) {
  const m = new RegExp(`<${name} type="(-?\\d+)" value="(-?[\\d.eE+]+)"`).exec(xml)
  return m ? { type: Number(m[1]), raw: m[2] } : null
}
function floatOf(xml, name) {
  const f = field(xml, name)
  return f === null ? null : asFloat(f.type, f.raw)
}
function intOf(xml, name) {
  const f = field(xml, name)
  return f === null ? null : Math.trunc(Number(f.raw))
}

const envMs = (raw) => (raw === null ? null : 2 ** raw * 1000)
const cutoffHz = (raw) => (raw === null ? null : 440 * 2 ** (raw / 12))

/**
 * Parse one `.fxp` into the parameters curation scores on. Returns null when the file is not a
 * readable Surge patch. Every time is in ms, every level in 0…1, every frequency in Hz.
 */
export function readFxpParams(fxpPath) {
  const xml = patchXml(fxpPath)
  if (xml === null) return null

  const revision = Number(/<patch revision="(\d+)"/.exec(xml)?.[1] ?? 0)
  const sceneMode = intOf(xml, 'scenemode') ?? 0
  // scene_active names the sounding scene in single mode; dual (1) and split (2) sound BOTH, and we
  // measure only the active one — the same 16.8% blind spot research 141 reports.
  const sc = (intOf(xml, 'scene_active') ?? 0) >= 1 ? 'b' : 'a'

  const oscLevels = [1, 2, 3].map((i) => floatOf(xml, `${sc}_level_o${i}`) ?? 0)
  const oscMuted = [1, 2, 3].map((i) => (intOf(xml, `${sc}_mute_o${i}`) ?? 0) >= 1)
  const oscOctaves = [1, 2, 3].map((i) => intOf(xml, `${sc}_osc${i}_octave`) ?? 0)
  const active = [0, 1, 2].filter((i) => oscLevels[i] > 0.001 && !oscMuted[i])
  const activeOctaves = new Set(active.map((i) => oscOctaves[i]))

  const f1type = intOf(xml, `${sc}_filter1_type`) ?? 0
  const f2type = intOf(xml, `${sc}_filter2_type`) ?? 0

  return {
    revision,
    sceneMode, // 0 single, 1 dual, 2 split
    scene: sc,
    ampEnv: {
      attackMs: envMs(floatOf(xml, `${sc}_env1_attack`)),
      decayMs: envMs(floatOf(xml, `${sc}_env1_decay`)),
      sustain: floatOf(xml, `${sc}_env1_sustain`),
      releaseMs: envMs(floatOf(xml, `${sc}_env1_release`)),
    },
    filterEnv: {
      attackMs: envMs(floatOf(xml, `${sc}_env2_attack`)),
      decayMs: envMs(floatOf(xml, `${sc}_env2_decay`)),
      sustain: floatOf(xml, `${sc}_env2_sustain`),
      releaseMs: envMs(floatOf(xml, `${sc}_env2_release`)),
    },
    filter: {
      cutoffHz: cutoffHz(floatOf(xml, `${sc}_filter1_cutoff`)),
      resonance: floatOf(xml, `${sc}_filter1_resonance`),
      envModSemitones: floatOf(xml, `${sc}_filter1_envmod`),
      filter1On: f1type !== 0,
      filter2On: f2type !== 0,
    },
    oscillators: {
      activeCount: active.length,
      octaveSplit: activeOctaves.size >= 2,
      noiseLevel: floatOf(xml, `${sc}_level_noise`) ?? 0,
    },
    // fx_bypass/fx_disable are NOT applied here (same caveat 141 §9 records): this counts slots
    // that carry a non-"off" effect type, which is presence, not audibility.
    effectSlots: [...xml.matchAll(/<fx(\d+)_type type="-?\d+" value="(-?\d+)"/g)].filter((m) => Number(m[2]) > 0).length,
  }
}

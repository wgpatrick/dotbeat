// Downbeat-aligned trimming for hosted generations (research/127 §4.2, Part A2).
//
// Lyria (fixed ~30 s) and MiniMax (a full ~2:30-4:30 track) emit far more than the 4-bar loop the
// showdown wants, and the batch duration-matcher trims from the HEAD — for a full track the head is
// an intro, not a bar boundary. This module cuts a generation down to the requested bar count
// starting at a detected DOWNBEAT so the loop begins on a strong beat rather than mid-phrase.
//
// The method is deliberately dependency-free (no Python/beatthis round-trip in the hot path — this
// runs inside gen-fal.ts's pure-TS transport): an ENERGY-ONSET detector over the known BPM grid.
//   1. bar length in seconds is exact from (bpm, beatsPerBar): targetSec = bars·beatsPerBar·60/bpm.
//   2. build a coarse onset-strength envelope: per-hop RMS of the mono sum, then its positive
//      first-difference (rectified energy flux) — a cheap, robust kick/transient detector.
//   3. the DOWNBEAT is the strongest onset inside the first bar's search window; snap the cut start
//      to it. No onset clears the noise floor (a pad/texture with no transient) → start at 0.
//   4. take targetSec from that start (or to end if the generation is shorter), with a short
//      equal-power-ish linear fade in/out so the loop point doesn't click.
// It is exact on tempo (the grid is given, not estimated) and only ESTIMATES the phase (which beat
// is beat 1). That is enough for a loop that will be LUFS/duration-matched again downstream; a
// pad with no clear downbeat degrades gracefully to a head trim, same as the old behavior.

/** One decoded generation: per-channel float samples in -1..1 at sampleRate. */
export interface TrimInput {
  channels: Float64Array[]
  sampleRate: number
}

export interface TrimResult {
  channels: Float64Array[]
  /** where the cut started in the source, seconds */
  offsetSeconds: number
  /** length of the returned clip, seconds */
  lengthSeconds: number
  /** true when a downbeat onset was found and the cut snapped to it (vs a head trim fallback) */
  snapped: boolean
}

export interface TrimOptions {
  bpm: number
  /** bars to keep (default 4 — the phrase tier's length) */
  bars?: number
  /** beats per bar (default 4 — the showdown's material is all 4/4) */
  beatsPerBar?: number
  /** fade in/out applied to the cut, seconds (default 5 ms) */
  fadeSeconds?: number
}

const HOP = 256 // onset-envelope hop in samples — ~5.8 ms at 44.1 kHz, fine enough for a downbeat

/** Trim a decoded generation to `bars` bars at `bpm`, starting at the first detected downbeat.
 * Pure and deterministic. bars/beatsPerBar default to a 4-bar 4/4 phrase. */
export function downbeatAlignedTrim(input: TrimInput, opts: TrimOptions): TrimResult {
  const { channels, sampleRate } = input
  const bars = opts.bars ?? 4
  const beatsPerBar = opts.beatsPerBar ?? 4
  const fadeSeconds = opts.fadeSeconds ?? 0.005
  if (!(opts.bpm > 0)) throw new Error(`downbeatAlignedTrim: bpm must be positive, got ${opts.bpm}`)
  const frames = channels[0]?.length ?? 0
  const targetSamples = Math.round((bars * beatsPerBar * 60) / opts.bpm * sampleRate)
  if (frames === 0 || targetSamples <= 0) {
    return { channels, offsetSeconds: 0, lengthSeconds: frames / sampleRate, snapped: false }
  }

  // mono sum for the onset envelope
  const mono = new Float64Array(frames)
  for (const ch of channels) for (let i = 0; i < frames; i++) mono[i] = mono[i]! + ch[i]! / channels.length

  // per-hop RMS, then rectified first-difference (onset flux)
  const hops = Math.floor(frames / HOP)
  const rms = new Float64Array(hops)
  for (let h = 0; h < hops; h++) {
    let sum = 0
    const base = h * HOP
    for (let i = 0; i < HOP; i++) { const s = mono[base + i]!; sum += s * s }
    rms[h] = Math.sqrt(sum / HOP)
  }
  const flux = new Float64Array(hops)
  for (let h = 1; h < hops; h++) flux[h] = Math.max(0, rms[h]! - rms[h - 1]!)

  // search the first bar for the strongest onset — that's our downbeat estimate. A generation with
  // a pickup/anacrusis still usually lands its first heavy hit on beat 1; if not, a bar's worth of
  // search still finds a real transient to lock to.
  const barSamples = Math.round((beatsPerBar * 60) / opts.bpm * sampleRate)
  const searchHops = Math.min(hops, Math.max(1, Math.floor(barSamples / HOP)))
  let bestHop = 0
  let bestFlux = 0
  let fluxSum = 0
  for (let h = 0; h < searchHops; h++) { fluxSum += flux[h]!; if (flux[h]! > bestFlux) { bestFlux = flux[h]!; bestHop = h } }
  const meanFlux = fluxSum / Math.max(1, searchHops)
  let maxRms = 0
  for (let h = 0; h < hops; h++) if (rms[h]! > maxRms) maxRms = rms[h]!
  // A real downbeat is a transient: the onset must (a) stand clearly above the window's mean flux
  // AND (b) be a MEANINGFUL fraction of the clip's peak level — the second test rejects the tiny
  // hop-to-hop RMS wobble of a sustained pad/texture (which has no true onset), where a head trim
  // is the honest choice. A kick/pluck attack clears both easily.
  const snapped = bestFlux > meanFlux * 3 && bestFlux > 0.2 * maxRms && bestFlux > 1e-4
  let start = snapped ? bestHop * HOP : 0
  // never overrun: if the chosen downbeat leaves less than the target, back off to fit the whole
  // window (a downbeat near the end would otherwise return a stub).
  if (start + targetSamples > frames) start = Math.max(0, frames - targetSamples)

  const length = Math.min(targetSamples, frames - start)
  const fadeSamples = Math.min(Math.floor(fadeSeconds * sampleRate), Math.floor(length / 2))
  const out = channels.map((ch) => {
    const dst = new Float64Array(length)
    for (let i = 0; i < length; i++) {
      let g = 1
      if (i < fadeSamples) g = i / fadeSamples
      else if (i >= length - fadeSamples) g = (length - i) / fadeSamples
      dst[i] = ch[start + i]! * g
    }
    return dst
  })
  return { channels: out, offsetSeconds: start / sampleRate, lengthSeconds: length / sampleRate, snapped }
}

/** Encode channels (float -1..1) as a 16-bit PCM WAV. Interleaved, little-endian — the container
 * every downstream decoder here reads, and what prep normalizes anyway. */
export function encodeWav16(channels: Float64Array[], sampleRate: number): Buffer {
  const numCh = Math.max(1, channels.length)
  const frames = channels[0]?.length ?? 0
  const dataLen = frames * numCh * 2
  const buf = Buffer.alloc(44 + dataLen)
  buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(numCh, 22)
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * numCh * 2, 28); buf.writeUInt16LE(numCh * 2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii'); buf.writeUInt32LE(dataLen, 40)
  let p = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]![i]!))
      buf.writeInt16LE(Math.round(s * 32767), p)
      p += 2
    }
  }
  return buf
}

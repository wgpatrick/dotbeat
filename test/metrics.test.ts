// The metrics engine tested against synthetic signals whose correct values are known a priori
// (docs/phase-3-plan.md §3.2) — not against itself. The LUFS reference point (full-scale 997 Hz
// stereo sine = -0.69 LUFS) is the ITU-R BS.1770 calibration case.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { integratedLoudness } from '../src/metrics/loudness.js'
import { analyze } from '../src/metrics/analyze.js'
import { lint } from '../src/metrics/lint.js'
import { buildProfile, serializeProfile, parseProfile, BeatProfileError, PROFILE_FORMAT } from '../src/metrics/profile.js'
import { RENDER_RUN_VARIANCE_PEAK_DB } from '../src/metrics/variance.js'
import { decodeWav } from '../src/metrics/wav.js'

const FS = 44100

function sine(freq: number, seconds: number, amplitude: number): Float64Array {
  const out = new Float64Array(Math.round(seconds * FS))
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / FS)
  return out
}

function silence(seconds: number): Float64Array {
  return new Float64Array(Math.round(seconds * FS))
}

test('BS.1770 reference: full-scale 997 Hz stereo sine measures 0.0 LUFS, single-channel -3.01 (±0.5)', () => {
  // The spec's calibration case: 0 dBFS 997 Hz in ONE channel = -3.01 LKFS; in both = 0.0.
  // (The -0.691 constant in the formula exists exactly to cancel the K-filter's gain at 997 Hz.)
  const ch = sine(997, 3, 1.0)
  const stereo = integratedLoudness([ch, ch.slice()], FS).integratedLufs
  assert.ok(Math.abs(stereo - 0) < 0.5, `stereo got ${stereo}`)
  const single = integratedLoudness([ch.slice(), silence(3)], FS).integratedLufs
  assert.ok(Math.abs(single - -3.01) < 0.5, `single-channel got ${single}`)
})

test('LUFS tracks level linearly: -20 dBFS stereo sine measures ≈ -20.0 LUFS', () => {
  const amp = Math.pow(10, -20 / 20)
  const ch = sine(997, 3, amp)
  const { integratedLufs } = integratedLoudness([ch, ch.slice()], FS)
  assert.ok(Math.abs(integratedLufs - -20) < 0.5, `got ${integratedLufs}`)
})

test('K-weighting attenuates deep sub: 20 Hz sine reads much quieter than 997 Hz at equal level', () => {
  // the RLB high-pass corner is ~38 Hz — 20 Hz sits well below it, 997 Hz well above
  const a = integratedLoudness([sine(997, 3, 0.5), sine(997, 3, 0.5)], FS).integratedLufs
  const b = integratedLoudness([sine(20, 3, 0.5), sine(20, 3, 0.5)], FS).integratedLufs
  assert.ok(a - b > 6, `997 Hz ${a} vs 20 Hz ${b} — expected >6 LU apart`)
})

test('gating: silence returns -Infinity, and leading silence does not drag loudness down', () => {
  assert.equal(integratedLoudness([silence(3), silence(3)], FS).integratedLufs, -Infinity)
  const tone = sine(997, 2, 0.5)
  const withSilence = new Float64Array(silence(2).length + tone.length)
  withSilence.set(tone, silence(2).length)
  const pure = integratedLoudness([tone, tone.slice()], FS).integratedLufs
  const padded = integratedLoudness([withSilence, withSilence.slice()], FS).integratedLufs
  assert.ok(Math.abs(pure - padded) < 0.5, `pure ${pure} vs padded ${padded} — gating should exclude the silence`)
})

test('crest factor: sine = 3.01 dB, square = 0 dB (±0.1)', () => {
  const s = analyze([sine(997, 1, 0.5), sine(997, 1, 0.5)], FS)
  assert.ok(Math.abs(s.crestDb - 3.01) < 0.1, `sine crest ${s.crestDb}`)
  const sq = new Float64Array(FS)
  for (let i = 0; i < sq.length; i++) sq[i] = Math.sign(Math.sin((2 * Math.PI * 200 * i) / FS)) * 0.5 || 0.5
  const q = analyze([sq, sq.slice()], FS)
  assert.ok(Math.abs(q.crestDb - 0) < 0.1, `square crest ${q.crestDb}`)
})

test('sample peak and true peak: -6 dBFS sine reads -6 dBFS (±0.05), true peak >= sample peak', () => {
  const m = analyze([sine(997, 1, 0.5), sine(997, 1, 0.5)], FS)
  assert.ok(Math.abs(m.samplePeakDbfs - -6.02) < 0.05, `sample peak ${m.samplePeakDbfs}`)
  assert.ok(m.truePeakDbtp >= m.samplePeakDbfs - 0.01, `true peak ${m.truePeakDbtp} vs sample ${m.samplePeakDbfs}`)
  assert.ok(m.truePeakDbtp < m.samplePeakDbfs + 1, 'true peak of a plain sine should not exceed sample peak by ~1 dB')
})

test('spectral bands: energy lands where the tone is', () => {
  const low = analyze([sine(100, 2, 0.5), sine(100, 2, 0.5)], FS)
  assert.ok(low.spectral.bandsPct.bass > 90, `100 Hz tone: bass share ${low.spectral.bandsPct.bass}`)
  const high = analyze([sine(8000, 2, 0.5), sine(8000, 2, 0.5)], FS)
  assert.ok(high.spectral.bandsPct.air > 90, `8 kHz tone: air share ${high.spectral.bandsPct.air}`)
  assert.ok(Math.abs(high.spectral.centroidHz - 8000) < 400, `centroid ${high.spectral.centroidHz} for an 8 kHz tone`)
})

test('stereo: identical channels correlate ~1 and are effectively mono; inverted correlate ~-1', () => {
  const ch = sine(997, 1, 0.5)
  const mono = analyze([ch, ch.slice()], FS)
  assert.ok(mono.stereo!.correlation > 0.999)
  assert.ok(mono.stereo!.widthDb < -60, `width ${mono.stereo!.widthDb}`)
  const inv = ch.slice()
  for (let i = 0; i < inv.length; i++) inv[i] = -inv[i]!
  const flipped = analyze([ch, inv], FS)
  assert.ok(flipped.stereo!.correlation < -0.999)
})

test('lint: fires the right rules on engineered pathologies, stays quiet on a sane mix', () => {
  // pathological: full-scale (clipping-risk), mono, square wave (crest 0)
  const loudSquare = new Float64Array(FS * 2)
  for (let i = 0; i < loudSquare.length; i++) loudSquare[i] = Math.sign(Math.sin((2 * Math.PI * 100 * i) / FS)) || 1
  const bad = lint(analyze([loudSquare, loudSquare.slice()], FS))
  const rules = bad.map((f) => f.rule)
  assert.ok(rules.includes('true-peak-clipping'), `rules: ${rules.join(',')}`)
  assert.ok(rules.includes('over-compressed'))
  assert.ok(rules.includes('low-end-heavy'))
  assert.ok(rules.includes('effectively-mono'))

  // sane-ish: mid-level pulsed tones (25% duty cycle -> crest ~9 dB, like a groove, unlike a
  // steady sine whose 3 dB crest legitimately reads as over-compressed), different L/R content
  const pulsed = (freq: number, amp: number) => {
    const out = sine(freq, 3, amp)
    for (let i = 0; i < out.length; i++) if (i % FS >= FS / 4) out[i] = 0
    return out
  }
  const okFindings = lint(analyze([pulsed(997, 0.3), pulsed(1400, 0.28)], FS), { targetLufs: -14 })
  assert.ok(!okFindings.some((f) => f.rule === 'true-peak-clipping'))
  assert.ok(!okFindings.some((f) => f.rule === 'over-compressed'))
})

test('lint thresholds are padded by the measured render run variance (Phase 34 NC)', () => {
  // A value between the NOMINAL threshold and the padded one must NOT fire: re-rendering the
  // same .beat moves peak-domain metrics by up to RENDER_RUN_VARIANCE_PEAK_DB, so a finding
  // there would flip on/off between identical renders (docs/render-determinism.md).

  // true peak at -0.5 dBTP: above the nominal -1, inside the padded -1 + variance zone -> silent
  const nearCeiling = sine(997, 2, Math.pow(10, -0.5 / 20))
  const near = lint(analyze([nearCeiling, nearCeiling.slice()], FS))
  assert.ok(!near.some((f) => f.rule === 'true-peak-clipping'), `rules: ${near.map((f) => f.rule).join(',')}`)

  // crest ~5.5 dB: under the nominal 6, above the padded 6 - variance -> silent.
  // Square wave with 71.8% of samples zeroed: crest = -10*log10(0.282) = 5.5 dB exactly.
  const gated = new Float64Array(FS * 2)
  for (let i = 0; i < gated.length; i++) gated[i] = i % 1000 < 718 ? 0 : Math.sign(Math.sin((2 * Math.PI * 100 * i) / FS)) * 0.5 || 0.5
  const gm = analyze([gated, gated.slice()], FS)
  assert.ok(gm.crestDb > 6 - RENDER_RUN_VARIANCE_PEAK_DB && gm.crestDb < 6, `crest ${gm.crestDb} should sit inside the padding zone`)
  assert.ok(!lint(gm).some((f) => f.rule === 'over-compressed'))

  // A firing finding reports the EFFECTIVE (padded) threshold it compared against.
  const loudSquare = new Float64Array(FS * 2)
  for (let i = 0; i < loudSquare.length; i++) loudSquare[i] = Math.sign(Math.sin((2 * Math.PI * 100 * i) / FS)) || 1
  const clip = lint(analyze([loudSquare, loudSquare.slice()], FS)).find((f) => f.rule === 'true-peak-clipping')
  assert.ok(clip, 'full-scale square must still fire true-peak-clipping')
  assert.equal(clip!.threshold, -1 + RENDER_RUN_VARIANCE_PEAK_DB)
})

// ---- Phase 35 Stream OD: reference mix profile ---------------------------------------------

/** 25% duty-cycle pulsed tone — the same "sane groove" shape the lint test above uses: crest
 * ~9 dB, so scaling it only moves energy metrics, keeping known-answer deltas clean. */
function pulsedTone(freq: number, amp: number): Float64Array {
  const out = sine(freq, 3, amp)
  for (let i = 0; i < out.length; i++) if (i % FS >= FS / 4) out[i] = 0
  return out
}

test('mix profile round-trips through JSON, including non-finite values (Phase 35 OD)', () => {
  const ch = sine(997, 2, 0.5)
  const m = analyze([ch, ch.slice()], FS)
  // dual-mono: widthDb is exactly -Infinity — the value plain JSON.stringify would destroy
  assert.equal(m.stereo!.widthDb, -Infinity)
  const profile = buildProfile(m, 'ref.wav')
  const back = parseProfile(serializeProfile(profile))
  assert.deepEqual(back, profile)
  assert.equal(back.format, PROFILE_FORMAT)
  assert.equal(back.source, 'ref.wav')
  assert.ok(!Number.isNaN(Date.parse(back.createdAt)), `createdAt "${back.createdAt}" should be an ISO date`)
  assert.equal(back.metrics.stereo!.widthDb, -Infinity)
})

test('parseProfile rejects non-profiles with actionable errors', () => {
  assert.throws(() => parseProfile('not json at all'), BeatProfileError)
  assert.throws(() => parseProfile('{"some":"json"}'), /not a dotbeat mix profile/)
  const good = buildProfile(analyze([sine(997, 1, 0.5), sine(997, 1, 0.5)], FS), 'ref.wav')
  assert.throws(() => parseProfile(serializeProfile({ ...good, version: 99 })), /version 99/)
  assert.throws(() => parseProfile(JSON.stringify({ ...good, metrics: {} })), /missing measured metrics/)
})

test('ref-mode lint: a 6 dB quieter mix fires ref-loudness naming both values; identical spectrum stays quiet', () => {
  const ref = buildProfile(analyze([pulsedTone(997, 0.4), pulsedTone(997, 0.4)], FS), 'ref.wav')
  const findings = lint(analyze([pulsedTone(997, 0.2), pulsedTone(997, 0.2)], FS), { ref })
  const loud = findings.find((f) => f.rule === 'ref-loudness')
  assert.ok(loud, `rules: ${findings.map((f) => f.rule).join(',')}`)
  assert.match(loud!.message, /6\.0 LU quieter than the reference \(ref\.wav: -\d+\.\d LUFS\)/)
  assert.match(loud!.suggestion!, /raise all track volumes by ~6\.0 dB \(beat set song\.beat <track>\.volume <dB> per track\)/)
  // same signal shape: band shares and crest match the reference — no delta findings there,
  // and the ABSOLUTE taste rules are off in ref mode (this mix is 20 LU under the -14 target)
  assert.ok(!findings.some((f) => f.rule.startsWith('ref-band-')), `rules: ${findings.map((f) => f.rule).join(',')}`)
  assert.ok(!findings.some((f) => f.rule === 'ref-crest'))
  assert.ok(!findings.some((f) => f.rule === 'loudness-vs-target'))
})

test('ref-mode lint: band-share deltas fire per band with direction (bass-heavy ref vs bright mix)', () => {
  const ref = buildProfile(analyze([sine(100, 2, 0.5), sine(100, 2, 0.5)], FS), 'bassy.wav')
  const findings = lint(analyze([sine(8000, 2, 0.5), sine(8000, 2, 0.5)], FS), { ref })
  const bass = findings.find((f) => f.rule === 'ref-band-bass')
  const air = findings.find((f) => f.rule === 'ref-band-air')
  assert.ok(bass && air, `rules: ${findings.map((f) => f.rule).join(',')}`)
  assert.match(bass!.message, /vs the reference's \d+% \(bassy\.wav\) — \d+ points less/)
  assert.match(bass!.suggestion!, /add bass energy/)
  assert.match(air!.message, /points more/)
  assert.match(air!.suggestion!, /tame the top end/)
  // absolute spectral rules stay out of ref mode
  assert.ok(!findings.some((f) => f.rule === 'low-end-heavy' || f.rule === 'dull-top-end'))
})

test('ref-mode lint: a much narrower mix than the reference fires ref-width', () => {
  // reference: fully decorrelated L/R (width ~0 dB); mix: R = 0.9 L + 0.1 other (~-23 dB)
  const s = sine(997, 2, 0.4)
  const t = sine(1400, 2, 0.4)
  const ref = buildProfile(analyze([s, t], FS), 'wide.wav')
  const narrowR = new Float64Array(s.length)
  for (let i = 0; i < s.length; i++) narrowR[i] = 0.9 * s[i]! + 0.1 * t[i]!
  const findings = lint(analyze([s.slice(), narrowR], FS), { ref: ref })
  const width = findings.find((f) => f.rule === 'ref-width')
  assert.ok(width, `rules: ${findings.map((f) => f.rule).join(',')}`)
  assert.match(width!.message, /narrower than the reference/)
  assert.match(width!.suggestion!, /pan tracks apart/)
})

test('ref-mode thresholds are padded by the render run variance, and --ref/--target is a hard conflict', () => {
  const ref = buildProfile(analyze([pulsedTone(997, 0.4), pulsedTone(997, 0.4)], FS), 'ref.wav')
  // 1.6 LU quieter: outside the nominal 1.5 LU tolerance, inside the variance-padded 1.75 —
  // must stay silent, or re-rendering an unchanged .beat could flip the finding on/off
  const amp = 0.4 * Math.pow(10, -1.6 / 20)
  const nearMiss = lint(analyze([pulsedTone(997, amp), pulsedTone(997, amp)], FS), { ref })
  assert.ok(!nearMiss.some((f) => f.rule === 'ref-loudness'), `rules: ${nearMiss.map((f) => f.rule).join(',')}`)

  // the SAFETY rules stay absolute in ref mode: clipping vs a reference is still clipping
  const loudSquare = new Float64Array(FS * 2)
  for (let i = 0; i < loudSquare.length; i++) loudSquare[i] = Math.sign(Math.sin((2 * Math.PI * 100 * i) / FS)) || 1
  const clipping = lint(analyze([loudSquare, loudSquare.slice()], FS), { ref })
  assert.ok(clipping.some((f) => f.rule === 'true-peak-clipping'))

  // one comparison frame at a time
  const m = analyze([pulsedTone(997, 0.2), pulsedTone(997, 0.2)], FS)
  assert.throws(() => lint(m, { ref, targetLufs: -14 }), /one comparison frame/)
})

test('wav decode round-trips a synthesized 16-bit PCM file', () => {
  // build a tiny wav in-memory (same header layout the render path writes)
  const samples = sine(440, 0.1, 0.25)
  const ch = 2
  const dataSize = samples.length * ch * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(ch, 22)
  buf.writeUInt32LE(FS, 24); buf.writeUInt32LE(FS * ch * 2, 28); buf.writeUInt16LE(ch * 2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40)
  let o = 44
  for (let i = 0; i < samples.length; i++) for (let c = 0; c < ch; c++) { buf.writeInt16LE(Math.round(samples[i]! * 32767), o); o += 2 }

  const decoded = decodeWav(new Uint8Array(buf))
  assert.equal(decoded.sampleRate, FS)
  assert.equal(decoded.channels.length, 2)
  assert.ok(Math.abs(decoded.durationSeconds - 0.1) < 0.001)
  // amplitude survives within quantization error
  let peak = 0
  for (const v of decoded.channels[0]!) peak = Math.max(peak, Math.abs(v))
  assert.ok(Math.abs(peak - 0.25) < 0.001, `peak ${peak}`)
})

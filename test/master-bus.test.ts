// Master-bus routing fix (docs/phase-8-plan.md's "Remaining": instrument audio offline "currently
// bypasses the limiter"). Root cause and fix are documented in cli/render-offline.mjs's
// `attachSharedMasterBus` — this test exercises that function directly against a real
// node-web-audio-api OfflineAudioContext (no Tone, no beatlab bundle needed: the function only
// touches the raw context), and uses src/metrics to prove the effect on real rendered audio, the
// same way test/metrics.test.ts verifies other DSP properties against known-shape signals.
//
// node-web-audio-api is a devDependency pointing at a local patched build (file:../upstream/...)
// that isn't always present in every checkout (see cli/render-offline.mjs's own npm-fallback
// warning) — these tests feature-detect it and skip cleanly rather than failing red when it's
// unavailable, matching this repo's stance that the offline render path degrades gracefully
// when its native binding isn't built.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { analyze } from '../src/metrics/analyze.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

async function loadWebAudio(): Promise<{ OfflineAudioContext: any } | null> {
  try {
    // @ts-expect-error node-web-audio-api's .d.ts isn't a proper module shape (TS2306) — this
    // devDependency points at a local patched native build that may not be present in every
    // checkout anyway (see cli/render-offline.mjs's npm-fallback warning); we only need it at
    // runtime, feature-detected below.
    await import('node-web-audio-api/polyfill.js')
    const mod = await import('node-web-audio-api')
    return { OfflineAudioContext: (mod as any).OfflineAudioContext }
  } catch {
    return null
  }
}

async function loadAttachSharedMasterBus(): Promise<((rawContext: any, opts?: any) => any) | null> {
  try {
    const mod = await import(pathToFileURL(join(repoRoot, 'cli', 'render-offline.mjs')).href)
    return (mod as any).attachSharedMasterBus
  } catch {
    return null
  }
}

const RATE = 44100

function sineBuffer(ctx: any, freq: number, seconds: number, amplitude: number) {
  const n = Math.round(seconds * RATE)
  const buf = ctx.createBuffer(2, n, RATE)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < n; i++) data[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / RATE)
  }
  return buf
}

function toFloat64(buf: any): Float64Array[] {
  const out: Float64Array[] = []
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch) as Float32Array
    out.push(Float64Array.from(src))
  }
  return out
}

test('attachSharedMasterBus: two loud sources summed at the shared bus are limited before the true destination', async (t) => {
  const webAudio = await loadWebAudio()
  const attachSharedMasterBus = await loadAttachSharedMasterBus()
  if (!webAudio || !attachSharedMasterBus) {
    t.skip('node-web-audio-api not available in this environment (no local patched build) — skipping')
    return
  }
  const { OfflineAudioContext } = webAudio
  const seconds = 1
  const ctx = new OfflineAudioContext(2, seconds * RATE, RATE)
  attachSharedMasterBus(ctx)

  // Two "tracks" — e.g. the Tone graph's final output and an instrument buffer — both reaching
  // for `ctx.destination` (unchanged call site, exactly like render-offline.mjs's instrument
  // buffer source): post-patch this resolves to the shared bus input, not the raw destination.
  const a = ctx.createBufferSource()
  a.buffer = sineBuffer(ctx, 220, seconds, 0.9)
  a.connect(ctx.destination)
  a.start(0)
  const b = ctx.createBufferSource()
  b.buffer = sineBuffer(ctx, 220, seconds, 0.9) // in phase with `a` — sums to ~1.8 unlimited
  b.connect(ctx.destination)
  b.start(0)

  const rendered = await ctx.startRendering()
  const metrics = analyze(toFloat64(rendered), RATE)

  // Two in-phase 0.9-amplitude sines sum to ~1.8 (+5.1 dBFS) if unlimited — a real, audible
  // over. The shared limiter (Tone.Limiter's own defaults: ratio 20, threshold -12 dB) must keep
  // the true peak from ever reaching that: this is the "instrument audio joins the master bus
  // before the limiter" contract, verified on real rendered samples.
  assert.ok(metrics.truePeakDbtp < 0.5, `expected the limiter to hold true peak near/under 0 dBFS, got ${metrics.truePeakDbtp.toFixed(2)} dBTP`)
  // Both sources must actually be heard (summed, not one clobbering the other): RMS with both
  // playing must exceed either one alone.
  assert.ok(metrics.rmsDbfs > -6, `expected audible combined signal, got ${metrics.rmsDbfs.toFixed(2)} dBFS RMS`)
})

test('attachSharedMasterBus: control — the same two sources UNLIMITED (bypassing the shared bus) clip harder', async (t) => {
  const webAudio = await loadWebAudio()
  const attachSharedMasterBus = await loadAttachSharedMasterBus()
  if (!webAudio || !attachSharedMasterBus) {
    t.skip('node-web-audio-api not available in this environment (no local patched build) — skipping')
    return
  }
  const { OfflineAudioContext } = webAudio
  const seconds = 1
  const ctx = new OfflineAudioContext(2, seconds * RATE, RATE)
  const { trueDestination } = attachSharedMasterBus(ctx)

  // Same two sources, but connected straight to the TRUE destination — reproducing the old,
  // pre-fix bypass (what render-offline.mjs did before this fix existed) — to show the limiter
  // is actually doing something, not a no-op.
  const a = ctx.createBufferSource()
  a.buffer = sineBuffer(ctx, 220, seconds, 0.9)
  a.connect(trueDestination)
  a.start(0)
  const b = ctx.createBufferSource()
  b.buffer = sineBuffer(ctx, 220, seconds, 0.9)
  b.connect(trueDestination)
  b.start(0)

  const rendered = await ctx.startRendering()
  const metrics = analyze(toFloat64(rendered), RATE)
  assert.ok(metrics.truePeakDbtp > 3, `expected an unlimited over (~+5 dBTP), got ${metrics.truePeakDbtp.toFixed(2)} dBTP`)
})

test('attachSharedMasterBus: the limiter responds monotonically — a much quieter source measures quieter out', async (t) => {
  const webAudio = await loadWebAudio()
  const attachSharedMasterBusMaybe = await loadAttachSharedMasterBus()
  if (!webAudio || !attachSharedMasterBusMaybe) {
    t.skip('node-web-audio-api not available in this environment (no local patched build) — skipping')
    return
  }
  const attachSharedMasterBus: (rawContext: any, opts?: any) => any = attachSharedMasterBusMaybe
  const { OfflineAudioContext } = webAudio
  const seconds = 1
  // A real DynamicsCompressorNode (per the Web Audio spec) applies makeup gain even to
  // below-threshold signals, so "quiet in -> byte-identical quiet out" isn't the right
  // transparency check here. What must hold is monotonicity: a much quieter source still
  // measures much quieter after the shared bus (the limiter tracks level, it doesn't normalize
  // everything to one loudness) — a basic sanity check that this is a real compressor/limiter
  // reacting to level, not a fixed makeup-gain stage.
  async function peakFor(amplitude: number): Promise<number> {
    const ctx = new OfflineAudioContext(2, seconds * RATE, RATE)
    attachSharedMasterBus(ctx)
    const src = ctx.createBufferSource()
    src.buffer = sineBuffer(ctx, 440, seconds, amplitude)
    src.connect(ctx.destination)
    src.start(0)
    const rendered = await ctx.startRendering()
    return analyze(toFloat64(rendered), RATE).samplePeakDbfs
  }
  const loud = await peakFor(0.9) // -0.9 dBFS in — well over the -12 dB threshold
  const quiet = await peakFor(0.02) // -34 dBFS in — well under it
  assert.ok(quiet < loud - 10, `expected the quiet source to measure noticeably quieter out (loud ${loud.toFixed(2)}, quiet ${quiet.toFixed(2)})`)
})

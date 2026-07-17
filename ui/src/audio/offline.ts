// Offline rendering (renderer slice 2; decisions.md D15's "fast batch render" closing note):
// compute a project's audio through dotbeat's OWN engine as fast as the CPU allows, instead of
// capturing the realtime clock. Tone's global context is swapped for an OfflineContext while the
// graph is built (the same dance Tone.Offline() does — see renderOfflineWav for why the wrapper
// itself isn't used); a FRESH Engine instance built during the swap therefore binds every
// node/bus/voice to the offline context — the exact same engine code the GUI plays through
// (D15's one-canonical-engine rule survives: this is the same class, not a port).
//
// Deliberate v1 limits, each refused loudly rather than degraded silently:
// - instrument (soundfont) tracks and sf-backed drum lanes: spessasynth's WorkletSynthesizer
//   requires a NATIVE realtime context (see Engine.ensureNativeContext) — offline support for
//   soundfonts is future work.
// - media referenced by the doc that the LIVE engine hasn't decoded yet: the offline instance
//   can't fetch (a render that silently skipped a sample would be a lie); callers should wait
//   for media the way cli/render.mjs's boot already does.
// One caveat is degraded, not refused: bitcrushRate (the Redux decimator) is a ScriptProcessorNode,
// which the offline context doesn't implement — it renders as passthrough (its own off state).
// The caveats list names every track that actually uses it, so the caller can choose live capture.
//
// PERFORMANCE ENVELOPE (measured 2026-07-17, 4-core container): compute time is CPU-bound and
// grows SUPERLINEARLY with song length × note density. Tone's offline architecture schedules the
// entire song before a single startRendering() pass, so no one-shot source can ever be disposed
// mid-render (its audio hasn't rendered yet — OneShotSource._onended deliberately skips dispose
// in offline contexts); every note's spent oscillator+gain stays in the graph to the end, and the
// render pass processes all of them every quantum. Small graphs/short clips beat realtime easily
// (1-track smoke project: 3.4x); a dense 8-track 96s song measured 0.32x at 10s and 0.12x at 30s
// on the same box — slower than live capture there. The output is exact either way; `beat render
// --offline` prints the measured ratio plus a heads-up when it comes out below 1x. Fixing the
// scaling honestly means a schedule-window + dispose-behind-the-frontier render loop driven by
// OfflineAudioContext.suspend() — a real project, tracked in the roadmap, not smuggled in here.

import * as Tone from 'tone'
import { Engine, engine, OFFLINE_RENDER_PREROLL_SECONDS } from './engine'
import { audioBufferToWav } from './wavEncode'
import { useStore } from '../state/store'

export interface OfflineRenderResult {
  blob: Blob
  /** honest deviations from the live path (currently: bitcrushRate passthrough), empty when none */
  caveats: string[]
  /** wall-clock milliseconds the offline computation took (the speedup receipt) */
  renderMs: number
}

/** Why this document cannot render offline, or null when it can. */
export function offlineRefusalReason(): string | null {
  const doc = useStore.getState().doc
  if (!doc) return 'no document loaded'
  const instrumentTracks = doc.tracks.filter((t) => t.kind === 'instrument').map((t) => t.id)
  if (instrumentTracks.length > 0) {
    return `instrument (soundfont) tracks need a native realtime context (worklet) — offline render does not support them yet: ${instrumentTracks.join(', ')}`
  }
  const sfLanes: string[] = []
  const missingMedia = new Set<string>()
  const have = engine.exportAudioBuffers()
  for (const t of doc.tracks) {
    for (const lane of t.lanes ?? []) {
      const backing = lane.backing as { type?: string; sample?: string }
      if (backing?.type === 'sf') sfLanes.push(`${t.id}.${lane.name}`)
      if (backing?.type === 'sample' && backing.sample !== undefined && !have.has(backing.sample)) missingMedia.add(backing.sample)
    }
    for (const clip of t.clips ?? []) {
      const region = (clip as { audio?: { media?: string } }).audio
      if (region?.media !== undefined && !have.has(region.media)) missingMedia.add(region.media)
    }
  }
  if (sfLanes.length > 0) return `sf-backed drum lanes need a native realtime context (worklet) — offline render does not support them yet: ${sfLanes.join(', ')}`
  if (missingMedia.size > 0) return `media not decoded yet (wait for the live engine's media load first): ${[...missingMedia].join(', ')}`
  return null
}

/** Tracks whose bitcrushRate is actually in use — the one degraded (passthrough) path offline. */
function bitcrushRateCaveats(): string[] {
  const doc = useStore.getState().doc
  if (!doc) return []
  return doc.tracks
    .filter((t) => {
      const rate = (t.synth as Record<string, unknown>)?.bitcrushRate
      const mix = (t.synth as Record<string, unknown>)?.bitcrushMix
      return typeof rate === 'number' && rate > 1 && typeof mix === 'number' && mix > 0
    })
    .map((t) => `${t.id}: bitcrushRate renders as passthrough offline (ScriptProcessorNode is realtime-only)`)
}

/**
 * Render `seconds` of the current document offline and return a 16-bit WAV blob. Same
 * mute/solo/doc state as the live path (both read the page store); playback position always
 * starts at bar 0, exactly like captureWav's play().
 */
export async function renderOfflineWav(seconds: number): Promise<OfflineRenderResult> {
  // The live engine only starts decoding media as a side effect of playing — and an offline
  // render never plays it. Kick the loads explicitly and wait them out (bounded), otherwise the
  // refusal below reports "media not decoded" for a project that simply hasn't been played yet.
  await engine.warmMediaLoads()
  const mediaDeadline = performance.now() + 30_000
  while (engine.pendingMediaCount() > 0 && performance.now() < mediaDeadline) {
    await new Promise((r) => setTimeout(r, 100))
  }
  const refusal = offlineRefusalReason()
  if (refusal !== null) throw new Error(`offline render refused: ${refusal}`)
  const caveats = bitcrushRateCaveats()
  const seedBuffers = engine.exportAudioBuffers()
  const started = performance.now()
  // The transport starts OFFLINE_RENDER_PREROLL_SECONDS into the offline timeline (see the
  // constant's doc comment in engine.ts — a t=0 attack renders wrong), so render that much extra
  // and trim exactly that much back off below. Deterministic sample math, not threshold trimming.
  // Tone.Offline() is NOT used here, deliberately — its render loop yields to a setTimeout once
  // per second of audio, and a hidden headless page's timer throttling (Chromium intensive
  // wake-up throttling; the anti-throttling launch flags don't cover it) parks each of those
  // yields for up to a minute: a 96s song stalled indefinitely at ~0% CPU. This is the same
  // context-swap dance Tone.Offline performs (set offline context -> build/schedule -> restore
  // -> render), except the final render(false) runs the clock loop SYNCHRONOUSLY — no timers to
  // throttle, the whole point of an offline render page. Blocking the page's main thread for the
  // duration is fine: this page exists to render.
  const originalContext = Tone.getContext()
  // Suspend the LIVE realtime context for the duration of the compute: the warm-up above built
  // the live engine's full graph, and an idle realtime context still renders silence through
  // every node ~344 times a second on a realtime-priority audio thread — measured competing for
  // whole cores against the offline compute on a loaded container. Nothing needs the live
  // context while the offline buffer is being computed; resume puts the GUI back exactly as it
  // was.
  const liveRaw = originalContext.rawContext as AudioContext
  const resumeLive = liveRaw.state === 'running'
  if (resumeLive) await liveRaw.suspend()
  let toneBuffer: Tone.ToneAudioBuffer
  try {
    const offlineCtx = new Tone.OfflineContext(2, seconds + OFFLINE_RENDER_PREROLL_SECONDS, 44100)
    Tone.setContext(offlineCtx)
    try {
      const offline = new Engine({ offline: true, seedBuffers })
      await offline.play()
    } finally {
      // Restore BEFORE rendering, exactly like Tone.Offline: the render loop below must not run
      // with the offline context still installed as the app-wide global (tick-time code resolves
      // its transport through Engine.boundContext, never through the global — see engine.ts).
      Tone.setContext(originalContext)
    }
    toneBuffer = await offlineCtx.render(false)
  } finally {
    if (resumeLive) await liveRaw.resume()
  }
  const renderMs = performance.now() - started
  // play() flips the store's playing flag for the GUI; an offline compute is not "the song
  // playing", so put it back the moment the render resolves.
  useStore.getState().setPlaying(false)
  const audioBuffer = toneBuffer.get()
  if (!audioBuffer) throw new Error('offline render produced no audio buffer')
  const prerollFrames = Math.round(OFFLINE_RENDER_PREROLL_SECONDS * audioBuffer.sampleRate)
  const trimmed = new AudioBuffer({
    numberOfChannels: audioBuffer.numberOfChannels,
    length: audioBuffer.length - prerollFrames,
    sampleRate: audioBuffer.sampleRate,
  })
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) trimmed.copyToChannel(audioBuffer.getChannelData(c).subarray(prerollFrames), c)
  return { blob: audioBufferToWav(trimmed), caveats, renderMs }
}

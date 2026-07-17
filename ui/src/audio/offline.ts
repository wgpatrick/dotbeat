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
// DETERMINISM, precisely (pilot 109 measured it): metrics are repeatable run-to-run, and pure
// oscillator content is repeatable to ~1 LSB of int16 — but NOT byte-exact, and noise-based
// voices (Tone.Noise picks a random buffer offset per start — the default kit's snare/clap/hats)
// produce genuinely different waveforms each run, offline and live alike. "Offline" buys the
// exact post-limiter graph output with no MediaRecorder/opus loss; it does not seed the engine's
// noise sources.
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

// ---- Windowed rendering: schedule a window ahead, dispose behind the frontier ------------------
//
// Tone's own offline architecture (OfflineContext.render) advances its JS clock over the WHOLE
// song — scheduling every note into the native graph — and only then calls startRendering() once.
// Nothing can ever be disposed during that clock pass (its audio hasn't rendered yet), so every
// note's spent one-shot oscillator+gain survives to the end and the single native pass processes
// all of them every 128-sample quantum: compute grows QUADRATICALLY with song length × note
// density (D22's measured 0.32x at 10s vs 0.12x at 30s on first-light).
//
// This driver interleaves the two instead, using the native OfflineAudioContext's own
// suspend(time)/resume(): the JS clock runs exactly one window ahead of the native render
// frontier, and at each suspension point every one-shot source whose stop time (plus margin) the
// frontier has PASSED — i.e. whose audio is actually rendered — is disposed. Per-quantum cost
// becomes O(currently-sounding nodes) instead of O(every note so far): linear scaling.
//
// It hooks three internals, each checked at runtime by windowedInternals() with a loud caveat +
// one-pass fallback if a dependency upgrade moves them:
//   1. OfflineContext._currentTime/emit('tick') — the exact body of Tone's _renderClock loop,
//      run in window-sized chunks instead of all at once (same ticks, same order, same timing).
//   2. rawContext._nativeOfflineAudioContext — standardized-audio-context implements no
//      suspend(); the true native context underneath does (Chromium).
//   3. OneShotSource.prototype._onended (reached via ToneBufferSource, which extends it) — the
//      one place every spent one-shot (oscillator AND buffer source) announces itself. Tone
//      deliberately skips dispose there for offline contexts because under schedule-then-render
//      nothing has rendered yet; under this driver "rendered yet" is knowable, so disposal moves
//      here, gated on the frontier.

/** ≈2s of audio per window at 44.1k, in whole 128-frame render quanta (suspend() times must land
 * on quantum boundaries). Small enough that within-window accumulation stays negligible, large
 * enough that suspend/resume round-trips are noise. */
const RENDER_WINDOW_QUANTA = 690
/** A source is disposed only once the render frontier is this far past its _stopTime — covers
 * the exponential-fade tail allowance (2x fadeOut) and any sub-block scheduling fuzz. */
const DISPOSE_MARGIN_SECONDS = 1

interface WindowedInternals {
  clock: { _currentTime: number; emit: (event: 'tick') => void }
  workletsReady: () => Promise<unknown>
  oneShotProto: { _onended: () => void }
}

/** Locate the two hooked Tone internals, or null (→ one-pass fallback) if any moved. */
function windowedInternals(offlineCtx: Tone.OfflineContext): WindowedInternals | null {
  const ctx = offlineCtx as unknown as { _currentTime?: unknown; emit?: unknown; workletsAreReady?: unknown }
  const oneShotProto = Object.getPrototypeOf(Tone.ToneBufferSource.prototype) as { _onended?: unknown }
  if (typeof ctx._currentTime !== 'number' || typeof ctx.emit !== 'function' || typeof ctx.workletsAreReady !== 'function' || typeof oneShotProto._onended !== 'function') {
    return null
  }
  return {
    clock: ctx as WindowedInternals['clock'],
    workletsReady: () => (ctx.workletsAreReady as () => Promise<unknown>).call(offlineCtx),
    oneShotProto: oneShotProto as WindowedInternals['oneShotProto'],
  }
}

async function renderWindowed(offlineCtx: Tone.OfflineContext, native: OfflineAudioContext, internals: WindowedInternals, durationSeconds: number): Promise<Tone.ToneAudioBuffer> {
  const { clock, workletsReady, oneShotProto } = internals
  const blockSeconds = 128 / offlineCtx.sampleRate
  const windowSeconds = (RENDER_WINDOW_QUANTA * 128) / offlineCtx.sampleRate
  // Advance Tone's clock to `target` — the exact loop body of OfflineContext._renderClock, in a
  // bounded chunk. `endInclusive` mirrors _renderClock's `duration - currentTime >= 0` (one tick
  // AT the final time), used only for the last window.
  const advanceClockTo = (target: number, endInclusive: boolean): void => {
    while (endInclusive ? durationSeconds - clock._currentTime >= 0 : clock._currentTime < target) {
      clock.emit('tick')
      clock._currentTime += blockSeconds
    }
  }

  // Every spent one-shot announces itself through the patched _onended; disposal waits until the
  // native frontier has rendered past its stop time.
  const spent: { src: { dispose(): void }; endAt: number }[] = []
  const original = oneShotProto._onended
  ;(oneShotProto as { _onended: () => void })._onended = function (this: { context: unknown; _stopTime?: number; dispose(): void }) {
    original.call(this)
    if (this.context === offlineCtx) {
      spent.push({ src: this, endAt: typeof this._stopTime === 'number' && this._stopTime >= 0 ? this._stopTime : clock._currentTime })
    }
  }
  const disposeBehind = (frontier: number): void => {
    const keep: typeof spent = []
    for (const entry of spent) {
      if (entry.endAt + DISPOSE_MARGIN_SECONDS < frontier) {
        try {
          entry.src.dispose()
        } catch {
          // best-effort — a node a wrapper already disposed itself is fine to skip
        }
      } else keep.push(entry)
    }
    spent.length = 0
    spent.push(...keep)
  }

  try {
    await workletsReady()
    // All suspension points must be scheduled before rendering reaches them — set up the whole
    // ladder up front. Each rung: pause at `frontier`, schedule the NEXT window of the song,
    // dispose everything the frontier has rendered past, resume. resume() sits in a finally so a
    // throwing tick callback can never leave the native render suspended forever (the error
    // still propagates through Promise.all below).
    const suspensions: Promise<void>[] = []
    for (let frontier = windowSeconds; frontier < durationSeconds; frontier += windowSeconds) {
      const at = frontier
      suspensions.push(
        native.suspend(at).then(() => {
          try {
            const next = at + windowSeconds
            advanceClockTo(Math.min(next, durationSeconds), next >= durationSeconds)
            disposeBehind(at)
          } finally {
            void native.resume()
          }
        }),
      )
    }
    // First window is scheduled before rendering starts (the clock must lead the frontier).
    advanceClockTo(Math.min(windowSeconds, durationSeconds), windowSeconds >= durationSeconds)
    const [buffer] = await Promise.all([native.startRendering(), ...suspensions])
    return new Tone.ToneAudioBuffer(buffer)
  } finally {
    ;(oneShotProto as { _onended: () => void })._onended = original
  }
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
    const renderSeconds = seconds + OFFLINE_RENDER_PREROLL_SECONDS
    // A RAW NATIVE OfflineAudioContext, handed to Tone's wrapper via its context overload — the
    // same raw-native pinning the live engine does (ensureNativeContext). Deliberately NOT the
    // (channels, duration, sampleRate) form: that builds on standardized-audio-context, which
    // reconstructs the whole native graph as a SNAPSHOT inside startRendering() — anything
    // scheduled after rendering begins never reaches the audio (measured: every post-window-1
    // note silent, 7 parity failures), which forecloses windowed rendering entirely. On the
    // native context, scheduling while suspended is exactly what the suspend() API is for.
    const nativeOffline = new OfflineAudioContext(2, Math.ceil(renderSeconds * 44100), 44100)
    // Tone's context overload is typed against standardized-audio-context's OfflineAudioContext,
    // but its runtime check (isAnyOfflineAudioContext) explicitly accepts a native one too.
    const offlineCtx = new (Tone.OfflineContext as unknown as new (ctx: OfflineAudioContext) => Tone.OfflineContext)(nativeOffline)
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
    const internals = windowedInternals(offlineCtx)
    if (internals === null) {
      caveats.push('windowed rendering unavailable (a Tone upgrade moved the internals it hooks) — one-pass fallback, compute grows quadratically with song length')
      toneBuffer = await offlineCtx.render(false)
    } else {
      toneBuffer = await renderWindowed(offlineCtx, nativeOffline, internals, renderSeconds)
    }
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

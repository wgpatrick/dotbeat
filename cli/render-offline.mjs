#!/usr/bin/env node
// beat render --offline — BeatLab's REAL engine rendering a .beat file with no browser and no
// dev server, via node-web-audio-api + Tone.OfflineContext (docs/phase-4-plan.md §4.2).
//
// Order of operations matters and each step exists for a reason:
//   1. polyfill first (patches globalThis with AudioContext/OfflineAudioContext)
//   2. shims: localStorage (store's debounced autosave), requestAnimationFrame (Tone.getDraw's
//      UI-sync callbacks inside the engine tick)
//   3. Tone.setContext(new Tone.OfflineContext(...)) BEFORE importing the engine bundle — every
//      Tone node the engine lazily builds must land on the offline context
//   4. seed the real store (mode sandbox + applyDawState, the same one apply path every other
//      consumer uses) and call the engine's own play() — the same sequencer, same tick, same
//      swing/automation handling users hear
//   5. context.render() → WAV via beatlab's own audioBufferToWav

import 'node-web-audio-api/polyfill.js'
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as Tone from 'tone'
import { parse, beatDocumentToPartialTracks } from '../dist/src/core/index.js'
import { buildHeadlessEngine } from '../scripts/build-headless-engine.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// shims the bundle expects a browser to have provided
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} }
globalThis.requestAnimationFrame ??= (cb) => setTimeout(() => cb(performance.now()), 16)
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id)

// node-web-audio-api enforces the WebAudio spec's write-once rule for WaveShaperNode.curve
// ("cannot assign curve twice") — Chromium is lenient, and beatlab's engine re-assigns curves
// when distortion params sync (Tone.Distortion's setter). Found by running, of course. The fix
// preserves real curve updates (no fidelity lie): createWaveShaper returns a node with stable
// gain endpoints and a swappable native shaper in the middle — re-assigning `curve` builds a
// fresh native node and splices it in. Unity gains, sonically transparent.
function patchWaveShaperReassignment(ContextClass) {
  const original = ContextClass.prototype.createWaveShaper
  ContextClass.prototype.createWaveShaper = function () {
    const ctx = this
    const input = ctx.createGain() // stable identity others connect() TO — always neutral
    const output = ctx.createGain() // stable identity outgoing connect()s leave FROM
    const inputConnect = input.connect.bind(input)
    const inputDisconnect = input.disconnect.bind(input)
    let shaper = null // the current native write-once WaveShaperNode, spliced between the gains
    let oversample = 'none'
    inputConnect(output)
    Object.defineProperties(input, {
      curve: {
        configurable: true,
        get: () => shaper?.curve ?? null,
        set: (v) => {
          if (v === null) return
          const fresh = original.call(ctx)
          fresh.curve = v
          fresh.oversample = oversample
          if (shaper) {
            inputDisconnect(shaper)
            shaper.disconnect(output)
          } else {
            inputDisconnect(output)
          }
          inputConnect(fresh)
          fresh.connect(output)
          shaper = fresh
        },
      },
      oversample: {
        configurable: true,
        get: () => oversample,
        set: (v) => {
          oversample = v
          if (shaper) shaper.oversample = v
        },
      },
    })
    input.connect = output.connect.bind(output)
    input.disconnect = (...args) => (args.length === 0 ? output.disconnect() : output.disconnect(...args))
    return input
  }
}

// patch both context flavors before any Tone node is created
const { AudioContext: PolyAudioContext, OfflineAudioContext: PolyOfflineAudioContext } = await import('node-web-audio-api')
patchWaveShaperReassignment(PolyAudioContext)
patchWaveShaperReassignment(PolyOfflineAudioContext)

// AudioWorklets: the polyfill supports them natively, but standardized-audio-context (Tone's
// wrapper layer) doesn't wire that support up in Node, so Tone.BitCrusher's worklet can never
// come up. Instead of faking a worklet node, park the module load forever (ToneAudioWorklet
// then never constructs its node — no crash, wet branch stays silent) and let render() proceed.
// KNOWN, DOCUMENTED LIMITATION: bitcrush's WET path is silent offline. Tone effects crossfade
// wet/dry, and beatlab drives wet from bitcrushMix (default 0) — so any project not using
// bitcrush renders exactly; one using it loses that one effect in --offline mode.
// (docs/phase-4-plan.md; the D5 metric comparison quantifies this on real projects.)
Tone.Context.prototype.addAudioWorkletModule = () => new Promise(() => {})
Tone.Context.prototype.workletsAreReady = async () => {}

export async function renderOffline({ beatPath, outPath, beatlabDir, tailSeconds = 0 }) {
  const doc = parse(readFileSync(beatPath, 'utf8'))
  const loopSeconds = (doc.loopBars * 16 * 60) / doc.bpm / 4 // same math as beatlab's exportSandboxWav
  const seconds = loopSeconds + tailSeconds

  // (re)build the engine bundle when missing or older than the beatlab sources' newest edit
  const bundlePath = join(repoRoot, 'dist-headless', 'engine.mjs')
  if (!existsSync(bundlePath)) {
    if (!beatlabDir) throw new Error('engine bundle missing — pass --beatlab-dir (or set BEATLAB_DIR) so it can be built')
    console.log('building headless engine bundle from beatlab sources...')
    buildHeadlessEngine({ beatlabDir })
  }

  const stages = {}
  let mark = performance.now()
  const stamp = (name) => {
    stages[name] = Math.round(performance.now() - mark)
    mark = performance.now()
  }
  const t0 = performance.now()
  const offline = new Tone.OfflineContext(2, seconds, 44100)
  Tone.setContext(offline)
  stamp('context')

  const { useStore, engine } = await import(pathToFileURL(bundlePath).href)
  stamp('import')

  // Seed the real store: sandbox mode, then the one shared apply path (applyDawState creates
  // tracks from the file, merges the synth partials onto DEFAULT_SYNTH — file is the document).
  useStore.setState({ mode: 'sandbox', tracks: [] })
  useStore.getState().applyDawState(beatDocumentToPartialTracks(doc))
  stamp('graph-build')

  await engine.play() // the engine's own transport wiring + per-16th tick — the real sequencer

  // KNOWN, DOCUMENTED DIVERGENCE (upstream bug, isolated by bisection — docs/phase-4-plan.md):
  // node-web-audio-api 2.0.0's OscillatorNode explodes (peaks up to 1e5+) when a PeriodicWave
  // oscillator's frequency is FM-modulated through zero into negative values; Chromium handles
  // negative frequency per spec. Tone.MetalSynth (beatlab's hat/openhat) is exactly that: square
  // carriers under modulationIndex 32. Mitigation: sine carriers for those two instruments only —
  // stable under identical deep FM, still a dense inharmonic stack behind the same 4-7 kHz
  // highpass. The hats stay present; their timbre differs slightly from the browser reference,
  // and verify-m4.mjs quantifies exactly how much. Remove when the upstream bug is fixed.
  for (const name of ['hat', 'openhat']) {
    const metal = engine.drums?.[name]
    if (metal?._oscillators) for (const osc of metal._oscillators) osc.type = 'sine'
  }
  stamp('engine-play')
  // render(false) = synchronous clock: no setTimeout yield between scheduling blocks — in a CLI
  // there is no main thread to keep responsive.
  const buffer = await offline.render(false)
  stamp('render')
  const renderMs = performance.now() - t0

  // beatlab's own encoder (bundled) — Blob in Node is global since 18
  const blob = engine && (await import(pathToFileURL(bundlePath).href)).audioBufferToWav(buffer.get ? buffer.get() : buffer)
  const bytes = Buffer.from(await blob.arrayBuffer())
  writeFileSync(outPath, bytes)

  return { seconds, renderMs, bytes: bytes.length, stages }
}

// direct invocation: node cli/render-offline.mjs <file.beat> -o out.wav [--beatlab-dir <p>] [--tail 0.5]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  let beatPath, outPath, tail = 0
  let beatlabDir = process.env.BEATLAB_DIR
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-o' || argv[i] === '--out') outPath = argv[++i]
    else if (argv[i] === '--beatlab-dir') beatlabDir = argv[++i]
    else if (argv[i] === '--tail') tail = Number(argv[++i])
    else beatPath = argv[i]
  }
  if (!beatPath) {
    console.error('usage: node cli/render-offline.mjs <file.beat> -o <out.wav> [--beatlab-dir <path>] [--tail <seconds>]')
    process.exit(1)
  }
  outPath ??= beatPath.replace(/\.beat$/, '') + '.wav'
  renderOffline({ beatPath, outPath, beatlabDir, tailSeconds: tail })
    .then(({ seconds, renderMs, bytes, stages }) => {
      console.log(`stages: ${Object.entries(stages).map(([k, v]) => `${k} ${v}ms`).join(', ')}`)
      console.log(`wrote ${outPath} (${bytes} bytes, ${seconds.toFixed(2)}s of audio in ${Math.round(renderMs)}ms — ${(seconds * 1000 / renderMs).toFixed(1)}x realtime)`)
      process.exit(0) // Tone.js has no clean Node teardown — planned for (opendaw-notes §9)
    })
    .catch((err) => {
      console.error(err.stack ?? String(err))
      process.exit(1)
    })
}

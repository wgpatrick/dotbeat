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
// wrapper layer) doesn't wire that support up in Node, so Tone's worklet nodes can never come
// up through the normal path. Tone's only worklet beatlab uses is BitCrusher, whose DSP is pure
// memoryless quantization (BitCrusher.worklet.js: step = 0.5^(bits-1); out = step*floor(in/step
// + 0.5)) — exactly expressible as a WaveShaper curve. So: resolve the module load, and hand
// ToneAudioWorklet a WaveShaper-backed stand-in whose "bits" parameter is a real, connectable
// AudioParam (Tone's Param.setParam does input.connect(param), so a plain fake object won't do —
// we lend it a spare ConstantSource's offset param and hook its setters to regenerate the curve).
// Fidelity note: a 32769-point curve resolves the quantization staircase exactly for bits <= ~14
// (beatlab's range is 1-16, typical 4-12); WaveShaper lerp between curve points softens step
// edges microscopically beyond that. Unknown worklet names degrade to a unity gain (none are
// used by beatlab's engine). Delete all of this if standardized-audio-context ever wires Node
// worklet support (docs/upstream/node-web-audio-api-findings.md §4).
Tone.Context.prototype.addAudioWorkletModule = async () => {}
Tone.Context.prototype.workletsAreReady = async () => {}

function bitCrusherCurve(bits) {
  const N = 32769
  const curve = new Float32Array(N)
  const step = Math.pow(0.5, bits - 1) // Tone's own formula, verbatim
  for (let i = 0; i < N; i++) {
    const x = -1 + (2 * i) / (N - 1)
    curve[i] = step * Math.floor(x / step + 0.5)
  }
  return curve
}

Tone.Context.prototype.createAudioWorkletNode = function (name, _options) {
  if (name !== 'bit-crusher') {
    // no other worklets exist in beatlab's graph; unity-gain passthrough keeps the chain alive
    const g = this.rawContext.createGain()
    g.parameters = new Map()
    g.port = { postMessage: () => {} }
    return g
  }
  const shaper = this.rawContext.createWaveShaper() // stdized wrapper -> connectable in Tone graphs
  shaper.curve = bitCrusherCurve(12) // Tone's BitCrusherWorklet default until setParam applies
  shaper.port = { postMessage: () => {} }
  // the connect target Tone.Param requires, with instance-level hooks to observe value changes
  const paramDonor = this.rawContext.createConstantSource()
  const bitsParam = paramDonor.offset
  const applyBits = (v) => {
    if (Number.isFinite(v) && v >= 1 && v <= 16) shaper.curve = bitCrusherCurve(v)
  }
  for (const method of ['setValueAtTime', 'setTargetAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime']) {
    const orig = bitsParam[method].bind(bitsParam)
    bitsParam[method] = (v, ...rest) => {
      applyBits(v)
      return orig(v, ...rest)
    }
  }
  const valueDesc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(bitsParam), 'value')
  Object.defineProperty(bitsParam, 'value', {
    get: () => valueDesc.get.call(bitsParam),
    set: (v) => {
      applyBits(v)
      valueDesc.set.call(bitsParam, v)
    },
  })
  shaper.parameters = new Map([['bits', bitsParam]])
  return shaper
}

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

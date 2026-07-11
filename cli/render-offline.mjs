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

// Local builds of node-web-audio-api (scripts/build-patched-webaudio.sh) carry a build-release
// artifact; the npm 2.0.0 package doesn't. On the npm version, hats (MetalSynth: square-carrier
// FM through zero) explode — warn loudly rather than render garbage silently.
if (!existsSync(join(repoRoot, 'node_modules', 'node-web-audio-api', 'node-web-audio-api.build-release.node'))) {
  console.warn(
    'WARNING: node-web-audio-api resolves to the npm release, whose oscillators explode under ' +
      'FM through zero (drum hats). Run scripts/build-patched-webaudio.sh for the fixed build.',
  )
}

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
  // v0.4: a song block sets the render length (sum of section bars); otherwise one loop pass.
  const renderBars = doc.song ? doc.song.reduce((sum, s) => sum + s.bars, 0) : doc.loopBars
  const loopSeconds = (renderBars * 16 * 60) / doc.bpm / 4 // same math as beatlab's exportSandboxWav
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

  // v0.8: in loop mode, drum tracks render from their true free-timed hits (scheduled after
  // play(), below). The GUI-facing partial projected those hits onto a 16-step grid; zero that
  // grid in the store so the engine's per-16th tick doesn't ALSO trigger them (quantized and
  // doubled). Song mode keeps the tick/pattern path (off-grid drums in songs are a later slice).
  if (doc.song === null) {
    const st = useStore.getState()
    useStore.setState({
      tracks: st.tracks.map((tr) =>
        tr.kind === 'drums' && tr.pattern
          ? { ...tr, pattern: Object.fromEntries(Object.entries(tr.pattern).map(([lane, steps]) => [lane, steps.map(() => 0)])) }
          : tr,
      ),
    })
  }

  // v0.5 media: resolve each lane sample relative to the .beat file, verify content hash
  // (fail loudly — a wrong-bytes sample is a corrupt project, not a soft warning), decode, and
  // hand the buffer to the engine's per-lane one-shot loader.
  if (doc.media.length > 0) {
    const { createHash } = await import('node:crypto')
    const { dirname: pathDirname, resolve: pathResolve } = await import('node:path')
    const beatDir = pathDirname(pathResolve(beatPath))
    // which media ids are audio one-shots (decode) vs soundfonts (raw bytes for spessasynth)?
    const laneIds = new Set()
    const sfIds = new Set()
    for (const t of doc.tracks) {
      for (const ls of Object.values(t.laneSamples)) if (ls) laneIds.add(ls.sample)
      if (t.kind === 'instrument' && t.instrument) sfIds.add(t.instrument.sample)
    }
    const buffers = new Map()
    const rawMedia = new Map()
    for (const m of doc.media) {
      const filePath = pathResolve(beatDir, m.path)
      if (!existsSync(filePath)) throw new Error(`media sample "${m.id}": file not found: ${m.path} (relative to ${beatDir})`)
      const bytes = readFileSync(filePath)
      const hash = createHash('sha256').update(bytes).digest('hex')
      if (hash !== m.sha256) throw new Error(`media sample "${m.id}": sha256 mismatch for ${m.path} (file ${hash.slice(0, 12)}..., document expects ${m.sha256.slice(0, 12)}...)`)
      if (sfIds.has(m.id)) rawMedia.set(m.id, bytes)
      if (laneIds.has(m.id)) {
        const audioBuf = await offline.rawContext.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
        buffers.set(m.id, audioBuf)
      }
    }
    for (const t of doc.tracks) {
      for (const [lane, ls] of Object.entries(t.laneSamples)) {
        if (!ls) continue
        engine.loadLaneOneShot(lane, buffers.get(ls.sample), ls.sample, { gainDb: ls.gainDb, tune: ls.tune })
        if (process.env.BEAT_ONESHOT_PROBE) {
          const p = engine.getLaneOneShots?.()
          const buf = buffers.get(ls.sample)
          console.error(`[probe] lane ${lane}: buffer ${buf ? `${buf.duration.toFixed(3)}s ch${buf.numberOfChannels} rate${buf.sampleRate}` : 'MISSING'} meta=${JSON.stringify(p?.[lane])}`)
          const orig = engine.triggerDrum.bind(engine)
          engine.triggerDrum = (ln, vel, t) => {
            try {
              orig(ln, vel, t)
              console.error(`[probe] triggerDrum ${ln} vel=${vel} t=${t} OK`)
            } catch (e) {
              console.error(`[probe] triggerDrum ${ln} vel=${vel} t=${t} THREW: ${e.message}`)
            }
          }
        }
      }
    }

    // v0.6 instrument tracks: rendered by spessasynth_core OUTSIDE the Tone graph (29x realtime
    // vs 0.2-0.7x through it — docs/phase-8-plan.md), sequenced here by sample position, then
    // injected into the offline mix as a plain buffer source. Notes loop every loopBars across
    // the render length, same as synth tracks. Volume/pan baked in (constant-power pan). Known
    // limitation: bypasses the master limiter; instrument tracks join the master bus in the
    // browser-leg slice.
    const instrumentTracks = doc.tracks.filter((t) => t.kind === 'instrument')
    if (instrumentTracks.length > 0) {
      // the web-audio polyfill defines `window`, which flips spessasynth's embedded WASM loader
      // into browser mode where it probes document.currentScript — a bare stub satisfies it
      globalThis.document ??= { currentScript: undefined }
      const { SpessaSynthProcessor, SoundBankLoader } = await import('spessasynth_core')
      const rate = 44100
      const totalSamples = Math.floor(seconds * rate)
      const stepSeconds = 60 / doc.bpm / 4
      const loopSteps = doc.loopBars * 16
      const renderSteps = Math.ceil(seconds / stepSeconds)
      for (const t of instrumentTracks) {
        const bytes = rawMedia.get(t.instrument.sample)
        const proc = new SpessaSynthProcessor(rate)
        await proc.processorInitialized
        proc.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), 'main')
        proc.createMIDIChannel()
        proc.programChange(0, t.instrument.program)
        // event list: sample-indexed noteOn/noteOff, notes looping every loopBars
        const events = []
        for (let base = 0; base < renderSteps; base += loopSteps) {
          for (const n of t.notes) {
            const on = Math.floor((base + n.start) * stepSeconds * rate)
            const off = Math.floor((base + n.start + n.duration) * stepSeconds * rate)
            if (on < totalSamples) {
              events.push({ at: on, on: true, pitch: n.pitch, vel: Math.round(n.velocity * 127) })
              events.push({ at: Math.min(off, totalSamples - 1), on: false, pitch: n.pitch })
            }
          }
        }
        events.sort((a, b) => a.at - b.at)
        const L = new Float32Array(totalSamples)
        const R = new Float32Array(totalSamples)
        let cursor = 0
        let ev = 0
        const BLOCK = 128
        while (cursor < totalSamples) {
          while (ev < events.length && events[ev].at <= cursor) {
            const e = events[ev++]
            if (e.on) proc.noteOn(0, e.pitch, e.vel)
            else proc.noteOff(0, e.pitch)
          }
          const n = Math.min(BLOCK, totalSamples - cursor, ev < events.length ? events[ev].at - cursor : Infinity)
          proc.process(L.subarray(cursor, cursor + n), R.subarray(cursor, cursor + n))
          cursor += n
        }
        // bake volume + constant-power pan, inject into the offline mix
        const gain = Math.pow(10, t.instrument.volume / 20)
        const theta = ((t.instrument.pan + 1) / 2) * (Math.PI / 2)
        const gl = gain * Math.cos(theta) * Math.SQRT2 * 0.5 * 2
        const gr = gain * Math.sin(theta) * Math.SQRT2 * 0.5 * 2
        const buf = offline.rawContext.createBuffer(2, totalSamples, rate)
        const outL = buf.getChannelData(0)
        const outR = buf.getChannelData(1)
        for (let i = 0; i < totalSamples; i++) {
          outL[i] = L[i] * gl
          outR[i] = R[i] * gr
        }
        const src = offline.rawContext.createBufferSource()
        src.buffer = buf
        src.connect(offline.rawContext.destination)
        src.start(0)
        console.log(`instrument "${t.id}": ${t.notes.length} notes via soundfont "${t.instrument.sample}" program ${t.instrument.program}`)
      }
    }
  }
  stamp('graph-build')

  await engine.play() // the engine's own transport wiring + per-16th tick — the real sequencer
  // (A sine-carrier mitigation for MetalSynth used to live here: npm's node-web-audio-api 2.0.0
  // — pinned to the web-audio-api crate 1.6.0 release — explodes when native square/sawtooth
  // oscillators are FM-modulated through zero into negative frequency. Upstream main already
  // fixed it ("also guard for negative nyquist freqs" et seq., unreleased); we build the binding
  // against that — scripts/build-patched-webaudio.sh — so the hats render with their true
  // square carriers. See docs/upstream/node-web-audio-api-findings.md for the full story.)
  // v0.8: schedule free-timed drum hits through the drum bus at their true fractional times
  // (loop mode). engine.triggerDrum(lane, velocity, timeSec) routes through the lane one-shots /
  // synth voices + drum bus — the same path the tick uses, but at arbitrary times instead of
  // grid steps. This is what makes off-grid drums (the J Dilla feel) actually render.
  if (doc.song === null) {
    const stepSeconds = 60 / doc.bpm / 4
    let scheduled = 0
    for (const t of doc.tracks) {
      if (t.kind !== 'drums') continue
      for (const h of t.hits) {
        const at = h.start * stepSeconds
        if (at < loopSeconds) {
          engine.triggerDrum(h.lane, at, h.velocity) // beatlab signature: (lane, time, velocity)
          scheduled++
        }
      }
    }
    if (scheduled) console.log(`drums: scheduled ${scheduled} free-timed hit(s)`)
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

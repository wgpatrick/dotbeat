// dotbeat's audio engine — Phase 13 Stream A "engine parity" pass. Ported and adapted from
// BeatLab's src/audio/engine.ts (fresh checkout of origin/fix/clip-automation-units-and-timeline,
// HEAD ba29bee — the branch carrying Phase-10 Stream D's clip-automation bug fixes, still an open
// PR at wgpatrick/beatlab#5 as of this port, so ported from the FIXED branch rather than main).
// Cross-checked against cli/render.mjs's Tone.js graph (the D5 reference the CLI already renders
// from). Adapted to dotbeat's OWN document model (src/core/document.ts: free-timed BeatDrumHit
// events, BeatNote, the full SYNTH_FIELDS synth block, clip-scoped BeatAutomationLane) rather than
// BeatLab's Track/pattern/AutomationMap shape.
//
// This closes the gap docs/phase-12-frontend.md flagged: Stream 1 shipped one PolySynth+filter+
// vol+pan per track and stubbed everything else; the GUI could not make a track sound like what
// `beat render` produces from the same .beat file. Now ported in (feature parity list —
// docs/phase-13-engine-parity.md):
//   - per-lane drum-voice synthesis (kickTune/kickPunch/kickDecay, snareTone/snareDecay,
//     hatDecay/openHatDecay/hatTone) + a drum bus (filter/EQ/comp/distortion/bitcrush/sends)
//   - the full synth oscillator bank (osc2, osc3 + outer unison pairs with stereo width, sub,
//     noise, 2-op FM) into a shared filter
//   - filter envelope (+ keytracking / velocity-to-cutoff), glide
//   - LFO 1 (pitch/cutoff/amp) + LFO 2 (pan/sends/EQ/distortion), sampled once per 16th step
//   - insert chain (EQ3 -> parallel compressor -> distortion -> bitcrusher) + reverb/delay/mod
//     sends into shared return buses
//   - scheduled sidechain duck (duckSource/duckAmount), adapted to dotbeat's free-timed kick hits
//   - clip automation playback in song/timeline mode (dotbeat units: point.time is 16th steps
//     from clip start, point.value is raw param units — NOT BeatLab's 0..1 fraction, so the
//     "units mismatch" half of beatlab#5 is designed away here; the "timeline automation never
//     switched per clip" half is fixed by reading automation from the currently-playing clip)
//   - master bus -> limiter -> destination with side-tapped meter + waveform/fft analysers
//     (carried forward from Stream 1)
//
// Phase 14 Stream F ADDED instrument/SoundFont-track playback: a per-instrument-track
// spessasynth_lib WorkletSynthesizer (the browser/real-time variant of the spessasynth_core
// SpessaSynthProcessor cli/render-offline.mjs uses offline), scheduled sample-accurately from the
// same tick loop and mixed into the shared master bus with the track's own volume/pan. See
// syncInstruments()/tick()'s instrument branch and docs/phase-14-instrument-tracks.md.
//
// Deliberately NOT ported (out of Stream A scope — see the parity doc): wavetable oscillators
// (dotbeat's osc is only sine/tri/saw/square), tempo-synced LFO rates + drawn LFO shapes,
// reorderable insert order, the arpeggiator, sample-slicing / per-lane one-shots (v0.5 media),
// and live-MIDI monitoring. Instrument tracks get level/pan into the master bus but NOT the synth
// FX chain (EQ/comp/sends/sidechain) — full instrument FX parity is a later stream (Stream F doc).

import * as Tone from 'tone'
import { WorkletSynthesizer } from 'spessasynth_lib'
// The AudioWorklet processor is a static asset Vite serves at a hashed URL; addModule() needs a
// real URL, so import it via ?url rather than bundling it as code.
import spessaWorkletUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url'
import { useStore, isEffectivelyMuted } from '../state/store'
import { daemonBase } from '../daemon/bridge'
import { audioBufferToWav } from './wavEncode'
import type { BeatDocument, BeatDrumHit, BeatInstrument, BeatNote, BeatSynth, BeatTrack, DrumLane, OscType } from '../types'

type LfoDest = 'off' | 'pitch' | 'cutoff' | 'amp' | 'wtPos'
type Lfo2Dest = 'off' | 'pan' | 'sendReverb' | 'sendDelay' | 'sendMod' | 'eqLow' | 'eqMid' | 'eqHigh' | 'distortionMix'
type FilterType = 'lowpass' | 'bandpass' | 'highpass'

// The permissive BeatSynth from the daemon types every non-core field as `number | string |
// boolean | null` (types.ts index signature). EngineSynth is the strictly-typed view the DSP
// code below reads — coerce() reads the raw block and fills the SYNTH_FIELDS defaults for any
// field the document elided (the daemon's parse fills defaults, but the fallbacks keep this honest
// if a partial ever reaches the engine). Defaults mirror src/core/document.ts SYNTH_FIELDS exactly.
interface EngineSynth {
  osc: OscType
  volume: number
  cutoff: number
  resonance: number
  filterType: FilterType
  attack: number
  decay: number
  sustain: number
  release: number
  pan: number
  osc2Type: OscType
  osc2Level: number
  osc2Detune: number
  subLevel: number
  noiseLevel: number
  fmLevel: number
  fmHarmonicity: number
  fmModIndex: number
  unisonVoices: number
  unisonWidth: number
  filterEnvAmount: number
  filterEnvAttack: number
  filterEnvDecay: number
  filterEnvSustain: number
  filterEnvRelease: number
  lfoRate: number
  lfoDepth: number
  lfoDest: LfoDest
  lfo2Rate: number
  lfo2Depth: number
  lfo2Dest: Lfo2Dest
  glide: number
  keytrackAmount: number
  velToFilterAmount: number
  eqLow: number
  eqMid: number
  eqHigh: number
  compThreshold: number
  compRatio: number
  compAttack: number
  compRelease: number
  compMix: number
  distortionAmount: number
  distortionMix: number
  bitcrushBits: number
  bitcrushMix: number
  sendReverb: number
  sendDelay: number
  sendMod: number
  duckSource: string | null
  duckAmount: number
  kickTune: number
  kickPunch: number
  kickDecay: number
  snareTone: number
  snareDecay: number
  hatDecay: number
  openHatDecay: number
  hatTone: number
}

const OSC_SET: readonly OscType[] = ['sine', 'triangle', 'sawtooth', 'square']

function coerce(p: BeatSynth): EngineSynth {
  const num = (v: unknown, d: number): number => {
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? n : d
  }
  const osc = (v: unknown, d: OscType): OscType => (typeof v === 'string' && OSC_SET.includes(v as OscType) ? (v as OscType) : d)
  return {
    osc: osc(p.osc, 'sawtooth'),
    volume: num(p.volume, -10),
    cutoff: num(p.cutoff, 2000),
    resonance: num(p.resonance, 0.8),
    filterType: (['lowpass', 'bandpass', 'highpass'].includes(String(p.filterType)) ? p.filterType : 'lowpass') as FilterType,
    attack: num(p.attack, 0.01),
    decay: num(p.decay, 0.2),
    sustain: num(p.sustain, 0.6),
    release: num(p.release, 0.3),
    pan: num(p.pan, 0),
    osc2Type: osc(p.osc2Type, 'sawtooth'),
    osc2Level: num(p.osc2Level, 0),
    osc2Detune: num(p.osc2Detune, 12),
    subLevel: num(p.subLevel, 0),
    noiseLevel: num(p.noiseLevel, 0),
    fmLevel: num(p.fmLevel, 0),
    fmHarmonicity: num(p.fmHarmonicity, 1),
    fmModIndex: num(p.fmModIndex, 5),
    unisonVoices: num(p.unisonVoices, 1),
    unisonWidth: num(p.unisonWidth, 0),
    filterEnvAmount: num(p.filterEnvAmount, 0),
    filterEnvAttack: num(p.filterEnvAttack, 0.01),
    filterEnvDecay: num(p.filterEnvDecay, 0.2),
    filterEnvSustain: num(p.filterEnvSustain, 0.3),
    filterEnvRelease: num(p.filterEnvRelease, 0.2),
    lfoRate: num(p.lfoRate, 4),
    lfoDepth: num(p.lfoDepth, 0),
    lfoDest: (['off', 'pitch', 'cutoff', 'amp', 'wtPos'].includes(String(p.lfoDest)) ? p.lfoDest : 'off') as LfoDest,
    lfo2Rate: num(p.lfo2Rate, 3),
    lfo2Depth: num(p.lfo2Depth, 0),
    lfo2Dest: (['off', 'pan', 'sendReverb', 'sendDelay', 'sendMod', 'eqLow', 'eqMid', 'eqHigh', 'distortionMix'].includes(String(p.lfo2Dest)) ? p.lfo2Dest : 'off') as Lfo2Dest,
    glide: num(p.glide, 0),
    keytrackAmount: num(p.keytrackAmount, 0),
    velToFilterAmount: num(p.velToFilterAmount, 0),
    eqLow: num(p.eqLow, 0),
    eqMid: num(p.eqMid, 0),
    eqHigh: num(p.eqHigh, 0),
    compThreshold: num(p.compThreshold, -24),
    compRatio: num(p.compRatio, 4),
    compAttack: num(p.compAttack, 0.02),
    compRelease: num(p.compRelease, 0.25),
    compMix: num(p.compMix, 0),
    distortionAmount: num(p.distortionAmount, 0),
    distortionMix: num(p.distortionMix, 0),
    bitcrushBits: num(p.bitcrushBits, 8),
    bitcrushMix: num(p.bitcrushMix, 0),
    sendReverb: num(p.sendReverb, 0),
    sendDelay: num(p.sendDelay, 0),
    sendMod: num(p.sendMod, 0),
    duckSource: typeof p.duckSource === 'string' && p.duckSource && p.duckSource !== 'none' ? p.duckSource : null,
    duckAmount: num(p.duckAmount, 0),
    kickTune: num(p.kickTune, 32.7),
    kickPunch: num(p.kickPunch, 0.05),
    kickDecay: num(p.kickDecay, 0.4),
    snareTone: num(p.snareTone, 0),
    snareDecay: num(p.snareDecay, 0.13),
    hatDecay: num(p.hatDecay, 0.05),
    openHatDecay: num(p.openHatDecay, 0.35),
    hatTone: num(p.hatTone, 4000),
  }
}

// Bipolar -1..1 LFO value at time t. dotbeat has no drawn-LFO step data or tempo sync, so this is
// a plain sine (BeatLab's lfoWaveValue minus the custom-shape / synced-rate branches).
function lfoValueAt(rateHz: number, t: number): number {
  return Math.sin(2 * Math.PI * rateHz * t)
}

// Interpolate breakpoint automation. dotbeat units: `time` is in 16th steps from clip start, so
// `posSteps` (contentStep) is directly comparable — NO 0..1 rescale (that was the BeatLab units
// bug beatlab#5 fixed). `value` is already the param's raw unit. `log` compares in log-space
// (cutoff only — frequency perception is logarithmic). No per-point curve field in dotbeat
// (deferred), so every segment ramps linearly.
function interpolateAutomation(points: { time: number; value: number }[], posSteps: number, log: boolean): number {
  const pts = [...points].sort((a, b) => a.time - b.time)
  if (pts.length === 0) return 0
  if (posSteps <= pts[0].time) return pts[0].value
  if (posSteps >= pts[pts.length - 1].time) return pts[pts.length - 1].value
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (posSteps >= a.time && posSteps <= b.time) {
      const t = (posSteps - a.time) / (b.time - a.time || 1)
      return log && a.value > 0 && b.value > 0 ? a.value * Math.pow(b.value / a.value, t) : a.value + (b.value - a.value) * t
    }
  }
  return pts[pts.length - 1].value
}

interface SynthChain {
  synth: Tone.PolySynth<Tone.Synth>
  osc2: Tone.PolySynth<Tone.Synth>
  osc2Gain: Tone.Gain
  osc2Pan: Tone.Panner
  osc3: Tone.PolySynth<Tone.Synth>
  osc3Gain: Tone.Gain
  osc3Pan: Tone.Panner
  uniPairs: { poly: Tone.PolySynth<Tone.Synth>; pan: Tone.Panner; gain: Tone.Gain; mul: number; minVoices: number; level: number }[]
  sub: Tone.PolySynth<Tone.Synth>
  subGain: Tone.Gain
  noise: Tone.NoiseSynth
  noiseGain: Tone.Gain
  fm: Tone.PolySynth<Tone.FMSynth>
  fmGain: Tone.Gain
  filter: Tone.Filter
  eq3: Tone.EQ3
  compIn: Tone.Gain
  compDry: Tone.Gain
  compressor: Tone.Compressor
  compWet: Tone.Gain
  compOut: Tone.Gain
  distortion: Tone.Distortion
  bitcrush: Tone.BitCrusher
  // muteGain sits BEFORE the panner fan-out, so gating it to 0 silences both the dry path
  // (panner->vol->master) AND the reverb/delay/mod sends (panner->*Send->return bus) — a mute that
  // only touched vol would leave the wet sends audible. It's a dedicated gate, separate from vol, so
  // the per-tick volume/duck ramps that write chain.vol never fight the mute state.
  muteGain: Tone.Gain
  // Post-fader side-tap for this track's own channel-strip meter (reads post-mute + post-volume, so
  // it reflects exactly what the fader and the mute button do). A waveform Analyser, not a
  // Tone.Meter: getTrackLevel computes RMS straight from the raw samples, which reads TRUE silence
  // the instant the mute gate closes (a Tone.Meter peak-holds and decays only ~0.8 per read, so it
  // lags to silence and its rate depends on how often it's polled — wrong for both the UI and tests).
  levelTap: Tone.Analyser
  panner: Tone.Panner
  vol: Tone.Volume
  reverbSend: Tone.Gain
  delaySend: Tone.Gain
  modSend: Tone.Gain
  lastOsc: OscType | null
}

interface DrumBus {
  filter: Tone.Filter
  eq3: Tone.EQ3
  compIn: Tone.Gain
  compDry: Tone.Gain
  compressor: Tone.Compressor
  compWet: Tone.Gain
  compOut: Tone.Gain
  distortion: Tone.Distortion
  bitcrush: Tone.BitCrusher
  muteGain: Tone.Gain // gate before the panner fan-out (see SynthChain.muteGain)
  levelTap: Tone.Analyser // post-fader waveform tap for the drums track's channel strip (see SynthChain.levelTap)
  panner: Tone.Panner
  vol: Tone.Volume
  reverbSend: Tone.Gain
  delaySend: Tone.Gain
  modSend: Tone.Gain
}

interface DrumKit {
  kick: Tone.MembraneSynth
  snare: Tone.NoiseSynth
  snareTone: Tone.MembraneSynth
  snareToneGain: Tone.Gain
  clap: Tone.NoiseSynth
  hat: Tone.MetalSynth
  openhat: Tone.MetalSynth
}

/** Resolved playable content for one track this tick (loop vs. song mode). contentStep is the step
 * WITHIN that content (absolute in loop mode; section-relative, cycling every loopBars, in song
 * mode). In song mode a track unmapped by the active scene is silent (contentOf returns null). */
interface Content {
  notes: BeatNote[]
  hits: BeatDrumHit[]
  automation: Map<string, { time: number; value: number }[]>
  contentStep: number
}

/** One live instrument (SoundFont) track. `synth` is a spessasynth_lib WorkletSynthesizer running
 * on Tone's raw AudioContext; its output feeds `entry` (a native passthrough) → `vol` → `pan` →
 * master. `sample`/`program` are the currently-loaded values, so syncInstruments() can tell a
 * cheap programChange from a full soundbank reload. */
interface InstrumentVoice {
  synth: WorkletSynthesizer
  entry: GainNode
  vol: Tone.Volume
  pan: Tone.Panner
  sample: string
  program: number
}

class Engine {
  private chains = new Map<string, SynthChain>()
  private drums: DrumKit | null = null
  private drumTrackId: string | null = null
  private kickTuneHz = 32.7
  private repeatId: number | null = null
  private started = false
  private lastLaneTriggerTime: Partial<Record<DrumLane, number>> = {}

  // Instrument (SoundFont) tracks. `instruments` holds READY voices; `instrumentPending` guards
  // the async build (fetch soundfont + addSoundBank + isReady) so sync() — called every tick —
  // never kicks off a second load for the same track while the first is in flight.
  private instruments = new Map<string, InstrumentVoice>()
  private instrumentPending = new Set<string>()
  private workletModulePromise: Promise<void> | null = null
  // spessasynth_lib's WorkletSynthesizer constructs a native AudioWorkletNode, which requires a
  // real (native) BaseAudioContext. Tone 15 wraps its context in standardized-audio-context, whose
  // rawContext is NOT a native BaseAudioContext — so we run Tone itself on a native AudioContext
  // that both engines share. Set once, before any Tone node is created (see ensureNativeContext).
  private nativeCtx: AudioContext | null = null

  /** Pin Tone (and thus every node the engine builds) to a native AudioContext, so the shared
   * master bus, the recorder tap, AND the spessasynth worklet all live on the same native context.
   * Idempotent; must run before the first Tone node is created (called at the top of getMaster and
   * ensureStarted, the only entry points that build nodes). */
  private ensureNativeContext(): AudioContext {
    if (!this.nativeCtx) {
      this.nativeCtx = new AudioContext()
      Tone.setContext(this.nativeCtx)
    }
    return this.nativeCtx
  }

  private reverbBus: Tone.Reverb | null = null
  private delayBus: Tone.FeedbackDelay | null = null
  private chorusBus: Tone.Chorus | null = null
  private phaserBus: Tone.Phaser | null = null
  private drumBus: DrumBus | null = null

  private masterBus: Tone.Gain | null = null
  private masterLimiter: Tone.Limiter | null = null
  private masterMeter: Tone.Meter | null = null
  private waveformAnalyser: Tone.Analyser | null = null
  private fftAnalyser: Tone.Analyser | null = null
  private recordingDest: MediaStreamAudioDestinationNode | null = null

  private getMaster(): Tone.Gain {
    if (!this.masterBus) {
      this.ensureNativeContext() // must precede the first node creation
      this.masterBus = new Tone.Gain(1)
      this.masterLimiter = new Tone.Limiter(-1)
      this.masterMeter = new Tone.Meter({ smoothing: 0.8 })
      this.waveformAnalyser = new Tone.Analyser('waveform', 1024)
      this.fftAnalyser = new Tone.Analyser('fft', 256)
      // The meter/analysers are side-taps, not in-chain hops (BeatLab's reasoning: a metering node
      // in the path can impose its own channel count downstream).
      this.masterBus.chain(this.masterLimiter, Tone.getDestination())
      this.masterLimiter.connect(this.masterMeter)
      this.masterLimiter.connect(this.waveformAnalyser)
      this.masterLimiter.connect(this.fftAnalyser)
    }
    return this.masterBus
  }

  /** Live time-domain samples (-1..1) of the master output; null before anything ever played. */
  getWaveformData(): Float32Array | null {
    this.getMaster()
    return this.waveformAnalyser!.getValue() as Float32Array
  }

  /** Live frequency-bin magnitudes (dB) of the master output. */
  getFftData(): Float32Array | null {
    this.getMaster()
    return this.fftAnalyser!.getValue() as Float32Array
  }

  /** Live master loudness in dB (the same value pushed to the store once per step). null before
   * the master meter exists. Exposed for the parity harness's per-frame level sampling. */
  getMasterLevel(): number | null {
    if (!this.masterMeter) return null
    const v = this.masterMeter.getValue()
    return typeof v === 'number' ? v : null
  }

  // ---- shared return buses (lazy: Tone nodes can be built before the context starts) ----
  private getBuses() {
    if (!this.reverbBus) {
      this.reverbBus = new Tone.Reverb({ decay: 2.2, wet: 1 }).connect(this.getMaster())
      this.delayBus = new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.3, wet: 1 }).connect(this.getMaster())
      // series: chorus -> phaser, only the phaser reaches master (a parallel split would double the
      // dry-chorus signal alongside the phased one).
      this.chorusBus = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.7, wet: 1 }).start()
      this.phaserBus = new Tone.Phaser({ frequency: 0.5, octaves: 3, baseFrequency: 1000, wet: 1 }).connect(this.getMaster())
      this.chorusBus.connect(this.phaserBus)
    }
    return { reverb: this.reverbBus, delay: this.delayBus!, mod: this.chorusBus! }
  }

  // filter -> EQ3 -> parallel comp -> distortion -> bitcrush -> (panner). dotbeat has no
  // insertOrder field, so the order is fixed at BeatLab's default (['eq','comp','dist']); every
  // insert is transparent at its default params (EQ 0 dB, compMix 0 = fully dry, distortion/
  // bitcrush wet 0), so an unedited track's signal path is uncolored.
  private wireInsertChain(
    filter: Tone.ToneAudioNode,
    eq3: Tone.EQ3,
    compIn: Tone.Gain,
    compOut: Tone.Gain,
    distortion: Tone.Distortion,
    bitcrush: Tone.BitCrusher,
    panner: Tone.ToneAudioNode,
  ) {
    filter.connect(eq3)
    eq3.connect(compIn)
    compOut.connect(distortion)
    distortion.connect(bitcrush)
    bitcrush.connect(panner)
  }

  private getDrumBus(): DrumBus {
    if (!this.drumBus) {
      const { reverb, delay, mod } = this.getBuses()
      const filter = new Tone.Filter(12000, 'lowpass')
      const eq3 = new Tone.EQ3()
      const compIn = new Tone.Gain()
      const compDry = new Tone.Gain(1)
      const compressor = new Tone.Compressor()
      const compWet = new Tone.Gain(0)
      const compOut = new Tone.Gain()
      const distortion = new Tone.Distortion({ distortion: 0, wet: 0 })
      const bitcrush = new Tone.BitCrusher(8)
      const muteGain = new Tone.Gain(1)
      const levelTap = new Tone.Analyser('waveform', 256)
      const panner = new Tone.Panner({ pan: 0, channelCount: 2 })
      const vol = new Tone.Volume(0)
      const reverbSend = new Tone.Gain(0)
      const delaySend = new Tone.Gain(0)
      const modSend = new Tone.Gain(0)

      compIn.fan(compDry, compressor)
      compressor.connect(compWet)
      compDry.connect(compOut)
      compWet.connect(compOut)
      // ...bitcrush -> muteGain -> panner: the mute gate is upstream of the fan-out so it catches
      // the sends too.
      this.wireInsertChain(filter, eq3, compIn, compOut, distortion, bitcrush, muteGain)
      muteGain.connect(panner)

      panner.chain(vol, this.getMaster())
      vol.connect(levelTap) // post-fader side-tap (not in the audible path)
      panner.connect(reverbSend)
      reverbSend.connect(reverb)
      panner.connect(delaySend)
      delaySend.connect(delay)
      panner.connect(modSend)
      modSend.connect(mod)

      this.drumBus = { filter, eq3, compIn, compDry, compressor, compWet, compOut, distortion, bitcrush, muteGain, levelTap, panner, vol, reverbSend, delaySend, modSend }
    }
    return this.drumBus
  }

  private applyDrumBusParams(p: EngineSynth) {
    const bus = this.getDrumBus()
    bus.filter.frequency.value = p.cutoff
    bus.filter.Q.value = p.resonance
    bus.filter.type = p.filterType
    bus.panner.pan.value = p.pan
    bus.vol.volume.value = p.volume
    bus.reverbSend.gain.value = p.sendReverb
    bus.delaySend.gain.value = p.sendDelay
    bus.modSend.gain.value = p.sendMod
    bus.eq3.low.value = p.eqLow
    bus.eq3.mid.value = p.eqMid
    bus.eq3.high.value = p.eqHigh
    bus.compressor.threshold.value = p.compThreshold
    bus.compressor.ratio.value = p.compRatio
    bus.compressor.attack.value = p.compAttack
    bus.compressor.release.value = p.compRelease
    bus.compWet.gain.value = p.compMix
    bus.compDry.gain.value = 1 - p.compMix
    bus.distortion.distortion = p.distortionAmount
    bus.distortion.wet.value = p.distortionMix
    bus.bitcrush.bits.value = Math.round(p.bitcrushBits)
    bus.bitcrush.wet.value = p.bitcrushMix
  }

  private applyDrumVoiceParams(p: EngineSynth) {
    if (!this.drums) return
    this.kickTuneHz = p.kickTune
    this.drums.kick.set({ pitchDecay: p.kickPunch, envelope: { decay: p.kickDecay } })
    this.drums.snare.set({ envelope: { decay: p.snareDecay } })
    this.drums.snareTone.set({ envelope: { decay: p.snareDecay } })
    this.drums.snareToneGain.gain.value = p.snareTone
    this.drums.hat.set({ envelope: { decay: p.hatDecay }, resonance: p.hatTone })
    this.drums.openhat.set({ envelope: { decay: p.openHatDecay }, resonance: p.hatTone })
  }

  private buildDrums(): void {
    // Every voice feeds the drum bus's filter (not master directly), so the bus's filter/EQ/comp/
    // distortion/sends apply to the whole kit — same as BeatLab.
    const busIn = this.getDrumBus().filter
    const kick = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 7, envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.1 } }).connect(busIn)
    kick.volume.value = -2

    const snareFilter = new Tone.Filter(1800, 'highpass').connect(busIn)
    const snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.13, sustain: 0 } }).connect(snareFilter)
    snare.volume.value = -8

    // Tonal "shell" layer blended under the snare noise — silent (gain 0) at the default snareTone 0.
    const snareToneGain = new Tone.Gain(0).connect(busIn)
    const snareTone = new Tone.MembraneSynth({ pitchDecay: 0.02, octaves: 4, envelope: { attack: 0.001, decay: 0.13, sustain: 0, release: 0.05 } }).connect(snareToneGain)

    const clapFilter = new Tone.Filter(1100, 'bandpass').connect(busIn)
    clapFilter.Q.value = 1.2
    const clap = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.004, decay: 0.2, sustain: 0 } }).connect(clapFilter)
    clap.volume.value = -2

    const hat = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.05, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5 }).connect(busIn)
    hat.volume.value = -18

    const openhat = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.35, release: 0.05 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5 }).connect(busIn)
    openhat.volume.value = -20

    this.drums = { kick, snare, snareTone, snareToneGain, clap, hat, openhat }
  }

  async ensureStarted(): Promise<void> {
    if (this.started) return
    this.ensureNativeContext() // pin Tone to a native context before Tone.start()/node creation
    await Tone.start()
    this.buildDrums()
    // Re-apply the drums track's params in case they were adjusted before this first start.
    const doc = useStore.getState().doc
    const drumsTrack = doc?.tracks.find((t) => t.kind === 'drums')
    if (drumsTrack) {
      const p = coerce(drumsTrack.synth)
      this.applyDrumVoiceParams(p)
      this.applyDrumBusParams(p)
    }
    this.started = true
  }

  private buildSynthChain(): SynthChain {
    const { reverb, delay, mod } = this.getBuses()
    const filter = new Tone.Filter(2000, 'lowpass')
    // channelCount 2 so the unison stack's stereo image (osc2Pan/osc3Pan/uniPairs) survives the
    // panner instead of being folded to mono.
    const panner = new Tone.Panner({ pan: 0, channelCount: 2 })
    const vol = new Tone.Volume(0)
    const reverbSend = new Tone.Gain(0)
    const delaySend = new Tone.Gain(0)
    const modSend = new Tone.Gain(0)

    const synth = new Tone.PolySynth(Tone.Synth)
    const osc2 = new Tone.PolySynth(Tone.Synth)
    const osc2Gain = new Tone.Gain(0)
    const osc2Pan = new Tone.Panner(0)
    const osc3 = new Tone.PolySynth(Tone.Synth)
    const osc3Gain = new Tone.Gain(0)
    const osc3Pan = new Tone.Panner(0)
    const uniPairs = [
      { mul: 1.6, minVoices: 5, level: 0.7 },
      { mul: -1.6, minVoices: 5, level: 0.7 },
      { mul: 2.4, minVoices: 7, level: 0.55 },
      { mul: -2.4, minVoices: 7, level: 0.55 },
    ].map((d) => ({ ...d, poly: new Tone.PolySynth(Tone.Synth), pan: new Tone.Panner(0), gain: new Tone.Gain(0) }))
    const sub = new Tone.PolySynth(Tone.Synth)
    const subGain = new Tone.Gain(0)
    const noise = new Tone.NoiseSynth({ noise: { type: 'white' } })
    const noiseGain = new Tone.Gain(0)
    const fm = new Tone.PolySynth(Tone.FMSynth)
    const fmGain = new Tone.Gain(0)

    const eq3 = new Tone.EQ3()
    const compIn = new Tone.Gain()
    const compDry = new Tone.Gain(1)
    const compressor = new Tone.Compressor()
    const compWet = new Tone.Gain(0)
    const compOut = new Tone.Gain()
    const distortion = new Tone.Distortion({ distortion: 0, wet: 0 })
    const bitcrush = new Tone.BitCrusher(8)
    const muteGain = new Tone.Gain(1)
    const levelTap = new Tone.Analyser('waveform', 256)

    synth.connect(filter)
    osc2.chain(osc2Pan, osc2Gain, filter)
    osc3.chain(osc3Pan, osc3Gain, filter)
    for (const u of uniPairs) u.poly.chain(u.pan, u.gain, filter)
    sub.chain(subGain, filter)
    noise.chain(noiseGain, filter)
    fm.chain(fmGain, filter)

    compIn.fan(compDry, compressor)
    compressor.connect(compWet)
    compDry.connect(compOut)
    compWet.connect(compOut)
    // ...bitcrush -> muteGain -> panner: gate before the fan-out so mute silences the sends too.
    this.wireInsertChain(filter, eq3, compIn, compOut, distortion, bitcrush, muteGain)
    muteGain.connect(panner)

    panner.chain(vol, this.getMaster())
    vol.connect(levelTap) // post-fader side-tap for this track's meter (not in the audible path)
    panner.connect(reverbSend)
    reverbSend.connect(reverb)
    panner.connect(delaySend)
    delaySend.connect(delay)
    panner.connect(modSend)
    modSend.connect(mod)

    return {
      synth, osc2, osc2Gain, osc2Pan, osc3, osc3Gain, osc3Pan, uniPairs, sub, subGain, noise, noiseGain, fm, fmGain,
      filter, eq3, compIn, compDry, compressor, compWet, compOut, distortion, bitcrush, muteGain, levelTap, panner, vol, reverbSend, delaySend, modSend, lastOsc: null,
    }
  }

  private applyParams(chain: SynthChain, p: EngineSynth): void {
    const env = { attack: p.attack, decay: p.decay, sustain: p.sustain, release: p.release }
    chain.synth.set({ envelope: env, portamento: p.glide })
    if (chain.lastOsc !== p.osc) {
      chain.synth.set({ oscillator: { type: p.osc } })
      chain.lastOsc = p.osc
    }
    chain.osc2.set({ oscillator: { type: p.osc2Type }, envelope: env, portamento: p.glide })
    chain.osc3.set({ oscillator: { type: p.osc2Type }, envelope: env, portamento: p.glide })
    const width = p.unisonVoices >= 3 ? p.unisonWidth : 0
    chain.osc2Pan.pan.value = width * 0.5
    chain.osc3Pan.pan.value = -width * 0.5
    for (const u of chain.uniPairs) {
      u.poly.set({ oscillator: { type: p.osc2Type }, envelope: env, portamento: p.glide })
      u.gain.gain.value = p.unisonVoices >= u.minVoices ? p.osc2Level * u.level : 0
      u.pan.pan.value = Math.sign(u.mul) * width * (u.minVoices === 5 ? 0.8 : 1)
    }
    chain.sub.set({ oscillator: { type: 'sine' }, envelope: env, portamento: p.glide })
    chain.noise.set({ envelope: env })
    chain.fm.set({ envelope: env, harmonicity: p.fmHarmonicity, modulationIndex: p.fmModIndex })
    chain.osc2Gain.gain.value = p.osc2Level
    chain.osc3Gain.gain.value = p.unisonVoices >= 3 ? p.osc2Level : 0
    chain.subGain.gain.value = p.subLevel
    chain.noiseGain.gain.value = p.noiseLevel
    chain.fmGain.gain.value = p.fmLevel
    chain.filter.type = p.filterType
    chain.filter.frequency.rampTo(p.cutoff, 0.02)
    chain.filter.Q.value = p.resonance
    chain.panner.pan.value = p.pan
    chain.vol.volume.value = p.volume
    chain.reverbSend.gain.value = p.sendReverb
    chain.delaySend.gain.value = p.sendDelay
    chain.modSend.gain.value = p.sendMod
    chain.eq3.low.value = p.eqLow
    chain.eq3.mid.value = p.eqMid
    chain.eq3.high.value = p.eqHigh
    chain.compressor.threshold.value = p.compThreshold
    chain.compressor.ratio.value = p.compRatio
    chain.compressor.attack.value = p.compAttack
    chain.compressor.release.value = p.compRelease
    chain.compDry.gain.value = 1 - p.compMix
    chain.compWet.gain.value = p.compMix
    chain.distortion.distortion = p.distortionAmount
    chain.distortion.wet.value = p.distortionMix
    chain.bitcrush.bits.value = Math.round(p.bitcrushBits)
    chain.bitcrush.wet.value = p.bitcrushMix
  }

  private disposeChain(chain: SynthChain): void {
    const nodes: Tone.ToneAudioNode[] = [
      chain.synth, chain.osc2, chain.osc2Gain, chain.osc2Pan, chain.osc3, chain.osc3Gain, chain.osc3Pan,
      chain.sub, chain.subGain, chain.noise, chain.noiseGain, chain.fm, chain.fmGain, chain.filter, chain.eq3,
      chain.compIn, chain.compDry, chain.compressor, chain.compWet, chain.compOut, chain.distortion, chain.bitcrush,
      chain.muteGain, chain.levelTap, chain.panner, chain.vol, chain.reverbSend, chain.delaySend, chain.modSend,
    ]
    for (const u of chain.uniPairs) nodes.push(u.poly, u.pan, u.gain)
    for (const n of nodes) n.dispose()
  }

  /** Reconcile live voices with the document: build chains for new synth tracks, update params on
   * existing ones, dispose vanished ones; apply the drums track's bus + voice params. */
  private sync(doc: BeatDocument): void {
    const synthTracks = doc.tracks.filter((t) => t.kind === 'synth')
    const wanted = new Set(synthTracks.map((t) => t.id))
    for (const [id, chain] of [...this.chains]) {
      if (!wanted.has(id)) {
        this.disposeChain(chain)
        this.chains.delete(id)
      }
    }
    for (const track of synthTracks) {
      let chain = this.chains.get(track.id)
      if (!chain) {
        chain = this.buildSynthChain()
        this.chains.set(track.id, chain)
      }
      this.applyParams(chain, coerce(track.synth))
    }
    const drumsTrack = doc.tracks.find((t) => t.kind === 'drums')
    this.drumTrackId = drumsTrack?.id ?? null
    if (drumsTrack) {
      const p = coerce(drumsTrack.synth)
      this.applyDrumBusParams(p)
      this.applyDrumVoiceParams(p)
    }
    // Per-tick read of the mixer's mute/solo state -> real audio gating. sync() already runs every
    // 16th tick, so a mute toggled mid-playback takes effect on the next step (well under a beat).
    this.applyMuteGates()
    this.syncInstruments(doc)
  }

  /** Gate each track's output to 0 or 1 from the store's effective mute/solo state (mute wins; if
   * anything is soloed only soloed tracks pass). Gated at muteGain (upstream of the panner fan-out)
   * so the dry path AND the reverb/delay/mod sends are silenced together. Idempotent + cheap; safe
   * to call every tick. */
  private applyMuteGates(): void {
    const state = useStore.getState()
    for (const [id, chain] of this.chains) {
      chain.muteGain.gain.value = isEffectivelyMuted(state, id) ? 0 : 1
    }
    if (this.drumBus && this.drumTrackId) {
      this.drumBus.muteGain.gain.value = isEffectivelyMuted(state, this.drumTrackId) ? 0 : 1
    }
  }

  /** RMS (in dB) of a waveform-analyser buffer. -Infinity for a silent (all-zero) buffer — which is
   * exactly what a muted track's post-gate tap produces, with no smoothing lag. */
  private static rmsDb(buf: Float32Array): number {
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!
    const rms = Math.sqrt(sum / buf.length)
    return rms > 0 ? 20 * Math.log10(rms) : -Infinity
  }

  /** Live post-fader loudness (dB) of one track's own channel, for its mixer meter — read per-frame
   * off the shared rAF driver, never through Zustand state. Computed as true RMS of the track's
   * post-mute/post-fader tap, so a muted track reads -Infinity immediately. null for tracks with no
   * meter tap wired up yet (instrument/SoundFont tracks got live playback in Phase 14 Stream F but
   * not yet a meter tap — wiring it up is free once needed, see that stream's doc). */
  getTrackLevel(trackId: string): number | null {
    const chain = this.chains.get(trackId)
    if (chain) return Engine.rmsDb(chain.levelTap.getValue() as Float32Array)
    if (this.drumBus && trackId === this.drumTrackId) return Engine.rmsDb(this.drumBus.levelTap.getValue() as Float32Array)
    return null
  }

  /** True RMS (dB) of the live master output, decay-free (raw samples off the master waveform
   * analyser) — for measurement code that needs an artifact-free master level. */
  getMasterRms(): number | null {
    const data = this.getWaveformData()
    return data ? Engine.rmsDb(data) : null
  }

  // ---- instrument (SoundFont) tracks -------------------------------------------------------
  // The AudioWorklet processor module only needs registering once per AudioContext; cache the
  // promise so every voice awaits the same registration.
  private ensureWorkletModule(): Promise<void> {
    if (!this.workletModulePromise) {
      const ctx = this.ensureNativeContext()
      this.workletModulePromise = ctx.audioWorklet.addModule(spessaWorkletUrl).catch((err) => {
        // Reset so a later sync() can retry (e.g. transient asset 404 during dev reload).
        this.workletModulePromise = null
        throw err
      })
    }
    return this.workletModulePromise
  }

  /** Build a WorkletSynthesizer for one instrument track: register the worklet, fetch the
   * soundfont bytes from the daemon (the same `/media/<path>` route the drum one-shots use),
   * load the bank, and wire output → volume → pan → master. Fire-and-forget from sync(); on
   * completion the ready voice lands in `this.instruments` and the tick starts scheduling it. */
  private async buildInstrument(trackId: string, inst: BeatInstrument, mediaPath: string): Promise<void> {
    try {
      await this.ensureWorkletModule()
      const res = await fetch(`${daemonBase()}/media/${mediaPath}`)
      if (!res.ok) throw new Error(`fetch soundfont "${mediaPath}": HTTP ${res.status}`)
      const bytes = await res.arrayBuffer()
      const ctx = this.ensureNativeContext()
      const synth = new WorkletSynthesizer(ctx)
      await synth.soundBankManager.addSoundBank(bytes, 'main')
      await synth.isReady
      // If the track vanished or its sample changed while we loaded, drop this build silently —
      // the next sync() reconciles the current state.
      const current = useStore.getState().doc?.tracks.find((t) => t.id === trackId)
      if (!current || current.kind !== 'instrument' || current.instrument?.sample !== inst.sample) {
        synth.destroy()
        return
      }
      const entry = ctx.createGain()
      synth.connect(entry)
      const vol = new Tone.Volume(inst.volume)
      const pan = new Tone.Panner(inst.pan)
      Tone.connect(entry, vol)
      vol.chain(pan, this.getMaster())
      synth.programChange(0, inst.program)
      this.instruments.set(trackId, { synth, entry, vol, pan, sample: inst.sample, program: inst.program })
    } catch (err) {
      console.warn(`[engine] instrument "${trackId}" failed to load:`, err)
    } finally {
      this.instrumentPending.delete(trackId)
    }
  }

  private disposeInstrument(voice: InstrumentVoice): void {
    try {
      voice.synth.stopAll(true)
      voice.synth.disconnect()
      voice.synth.destroy()
    } catch {
      // best-effort teardown
    }
    voice.entry.disconnect()
    voice.vol.dispose()
    voice.pan.dispose()
  }

  /** Reconcile live instrument voices with the document: dispose vanished tracks, (re)build new or
   * sample-changed ones, apply program/volume/pan on existing ones. Cheap program changes and
   * level/pan updates are synchronous; a new track or a changed soundfont triggers an async
   * (re)build. */
  private syncInstruments(doc: BeatDocument): void {
    const wanted = new Set(doc.tracks.filter((t) => t.kind === 'instrument' && t.instrument).map((t) => t.id))
    for (const [id, voice] of [...this.instruments]) {
      if (!wanted.has(id)) {
        this.disposeInstrument(voice)
        this.instruments.delete(id)
      }
    }
    for (const track of doc.tracks) {
      if (track.kind !== 'instrument' || !track.instrument) continue
      const inst = track.instrument
      // doc.media is typed permissively (unknown[]) in the UI model; the engine reads the narrow
      // { id, path } view it needs, same inline-cast pattern used for song/scenes above.
      const media = (doc.media as { id: string; path: string }[]).find((m) => m.id === inst.sample)
      if (!media) continue // sample not registered — nothing to load (reported elsewhere)
      const voice = this.instruments.get(track.id)
      if (!voice || voice.sample !== inst.sample) {
        if (voice) {
          this.disposeInstrument(voice)
          this.instruments.delete(track.id)
        }
        if (!this.instrumentPending.has(track.id)) {
          this.instrumentPending.add(track.id)
          void this.buildInstrument(track.id, inst, media.path)
        }
        continue
      }
      if (voice.program !== inst.program) {
        voice.synth.programChange(0, inst.program)
        voice.program = inst.program
      }
      voice.vol.volume.value = inst.volume
      voice.pan.pan.value = inst.pan
    }
  }

  triggerDrum(lane: DrumLane, time: number, velocity = 1): void {
    if (!this.drums) return
    // Per-lane monotonic guard: the single-instance drum voices reject a start at/before the last
    // one (Tone.js's strictly-increasing-start rule). Nudge any non-increasing trigger 5ms forward.
    let t = time
    const last = this.lastLaneTriggerTime[lane]
    if (last !== undefined && t <= last) t = last + 0.005
    this.lastLaneTriggerTime[lane] = t
    switch (lane) {
      case 'kick':
        this.drums.kick.triggerAttackRelease(this.kickTuneHz, '8n', t, velocity)
        break
      case 'snare':
        this.drums.snare.triggerAttackRelease('8n', t, velocity)
        this.drums.snareTone.triggerAttackRelease('A2', '8n', t, velocity) // silent unless snareTone > 0
        break
      case 'clap':
        this.drums.clap.triggerAttackRelease('8n', t, velocity)
        break
      case 'hat':
        this.drums.hat.triggerAttackRelease(300, '32n', t, velocity)
        break
      case 'openhat':
        this.drums.openhat.triggerAttackRelease(300, '16n', t, velocity)
        break
    }
  }

  async previewDrum(lane: DrumLane, velocity = 1): Promise<void> {
    await this.ensureStarted()
    this.triggerDrum(lane, Math.max(Tone.now(), (this.lastLaneTriggerTime[lane] ?? 0) + 0.005), velocity)
  }

  async play(): Promise<void> {
    await this.ensureStarted()
    const doc = useStore.getState().doc
    if (!doc) return
    this.sync(doc)
    const t = Tone.getTransport()
    t.bpm.value = doc.bpm
    t.loop = true
    t.loopStart = 0
    const songBars = doc.song && doc.song.length > 0 ? (doc.song as { scene: string; bars: number }[]).reduce((sum, s) => sum + s.bars, 0) : doc.loopBars
    t.loopEnd = `${songBars}m`
    if (this.repeatId !== null) t.clear(this.repeatId)
    this.repeatId = t.scheduleRepeat((time) => this.tick(time), '16n', 0)
    t.position = 0
    t.start()
    useStore.getState().setPlaying(true)
  }

  stop(): void {
    const t = Tone.getTransport()
    t.stop()
    if (this.repeatId !== null) {
      t.clear(this.repeatId)
      this.repeatId = null
    }
    this.lastLaneTriggerTime = {}
    for (const voice of this.instruments.values()) {
      try {
        voice.synth.stopAll(true)
      } catch {
        // best-effort: a not-yet-ready voice may reject stopAll
      }
    }
    useStore.getState().setPlaying(false)
    useStore.setState({ currentStep: -1 })
  }

  setBpm(bpm: number): void {
    Tone.getTransport().bpm.value = bpm
  }

  // Resolve a track's playable content this tick (loop vs. song mode). Pure read — playback never
  // mutates the document. In song mode a track unmapped by the active scene is silent (null).
  private contentOf(
    track: BeatTrack,
    step: number,
    loopBars: number,
    song: { scene: string; bars: number }[] | null,
    scenes: BeatDocument['scenes'],
    bar: number,
  ): Content | null {
    const autoOf = (lanes: { param: string; points: { time: number; value: number }[] }[]): Map<string, { time: number; value: number }[]> => {
      const m = new Map<string, { time: number; value: number }[]>()
      for (const l of lanes) m.set(l.param, l.points)
      return m
    }
    if (!song || song.length === 0) {
      return { notes: track.notes, hits: track.hits, automation: new Map(), contentStep: step }
    }
    // Resolve (bar -> section -> scene -> this track's clip).
    let cursor = 0
    let sectionStartBar = 0
    let sceneId: string | null = null
    for (const section of song) {
      if (bar < cursor + section.bars) {
        sectionStartBar = cursor
        sceneId = section.scene
        break
      }
      cursor += section.bars
    }
    if (sceneId === null) return null
    const scene = (scenes as { id: string; slots: Record<string, string> }[]).find((sc) => sc.id === sceneId)
    const clipId = scene?.slots?.[track.id]
    if (!clipId) return null
    const clip = (track.clips as { id: string; notes: BeatNote[]; hits: BeatDrumHit[]; automation: { param: string; points: { time: number; value: number }[] }[] }[]).find((c) => c.id === clipId)
    if (!clip) return null
    const rel = step - sectionStartBar * 16
    const loopSteps = loopBars * 16
    return { notes: clip.notes, hits: clip.hits, automation: autoOf(clip.automation ?? []), contentStep: ((rel % loopSteps) + loopSteps) % loopSteps }
  }

  private tick(time: number): void {
    const doc = useStore.getState().doc
    if (!doc) return
    // Re-sync each tick so live knob/step edits are heard on the next step (BeatLab does the same).
    this.sync(doc)
    const transport = Tone.getTransport()
    const song = doc.song && doc.song.length > 0 ? (doc.song as { scene: string; bars: number }[]) : null
    const songBars = song ? song.reduce((sum, s) => sum + s.bars, 0) : doc.loopBars
    const totalSteps = songBars * 16
    const ticksPerStep = transport.PPQ / 4
    const step = Math.round(transport.getTicksAtTime(time) / ticksPerStep) % totalSteps
    const bar = Math.floor(step / 16)
    const stepSeconds = Tone.Time('16n').toSeconds()

    for (const track of doc.tracks) {
      const content = this.contentOf(track, step, doc.loopBars, song, doc.scenes, bar)
      if (!content) continue // song mode: this track is silent this section

      if (track.kind === 'drums') {
        const p = coerce(track.synth)
        // Filter-sweep / amp LFO on the drum bus (the one continuously-moving value; static bus
        // params are applied reactively in sync()).
        if ((p.lfoDest === 'cutoff' || p.lfoDest === 'amp') && p.lfoDepth > 0) {
          const lfo = lfoValueAt(p.lfoRate, time)
          const bus = this.getDrumBus()
          if (p.lfoDest === 'cutoff') {
            bus.filter.frequency.linearRampToValueAtTime(p.cutoff * Math.pow(2, p.lfoDepth * lfo), time + stepSeconds)
          } else {
            bus.vol.volume.linearRampToValueAtTime(p.volume + p.lfoDepth * lfo * 12, time + stepSeconds)
          }
        }
        for (const h of content.hits) {
          if (Math.floor(h.start) === content.contentStep) {
            const frac = h.start - Math.floor(h.start)
            this.triggerDrum(h.lane, time + frac * stepSeconds, h.velocity)
          }
        }
        continue
      }

      if (track.kind === 'instrument') {
        // Instrument tracks: schedule this step's notes on the track's WorkletSynthesizer (channel
        // 0), sample-accurately via spessasynth's `{ time }` option (absolute AudioContext seconds,
        // the same clock `time` is in). No LFO/automation/filter env — those are synth-chain only.
        const voice = this.instruments.get(track.id)
        if (!voice) continue // still loading, or sample unresolved
        for (const n of content.notes) {
          if (Math.floor(n.start) !== content.contentStep) continue
          const noteTime = time + (n.start - content.contentStep) * stepSeconds
          const dur = Math.max(n.duration * stepSeconds * 0.9, 0.05)
          const midi = Math.round(n.pitch)
          const vel = Math.max(1, Math.min(127, Math.round(n.velocity * 127)))
          voice.synth.noteOn(0, midi, vel, { time: noteTime })
          voice.synth.noteOff(0, midi, { time: noteTime + dur })
        }
        continue
      }

      if (track.kind !== 'synth') continue // any other kind: nothing to schedule
      const chain = this.chains.get(track.id)
      if (!chain) continue
      const p = coerce(track.synth)
      const rampTime = time + stepSeconds

      const lfoOn = p.lfoDest !== 'off' && p.lfoDepth > 0
      const lfo = lfoOn ? lfoValueAt(p.lfoRate, time) : 0

      // Cutoff: automation (log interp) forms the base, LFO modulates around it.
      const cutoffAuto = content.automation.get('cutoff')
      let baseCutoff = p.cutoff
      if (cutoffAuto && cutoffAuto.length) baseCutoff = interpolateAutomation(cutoffAuto, content.contentStep, true)
      if (p.lfoDest === 'cutoff' && lfoOn) {
        chain.filter.frequency.linearRampToValueAtTime(Math.max(baseCutoff * Math.pow(2, p.lfoDepth * lfo), 20), rampTime)
      } else if (cutoffAuto && cutoffAuto.length) {
        chain.filter.frequency.linearRampToValueAtTime(baseCutoff, rampTime)
      }
      if (p.lfoDest === 'amp' && lfoOn) {
        chain.vol.volume.linearRampToValueAtTime(p.volume + p.lfoDepth * lfo * 12, rampTime)
      }

      // Generic clip automation for the remaining live-rampable params (cutoff handled above,
      // duckAmount handled with the duck below). Last write wins within a tick if a param is also
      // driven by an LFO — a documented step-resolution tradeoff, same as BeatLab.
      for (const [key, points] of content.automation) {
        if (key === 'cutoff' || key === 'duckAmount' || !points.length) continue
        const val = interpolateAutomation(points, content.contentStep, false)
        switch (key) {
          case 'resonance': chain.filter.Q.linearRampToValueAtTime(val, rampTime); break
          case 'volume': chain.vol.volume.linearRampToValueAtTime(val, rampTime); break
          case 'pan': chain.panner.pan.linearRampToValueAtTime(val, rampTime); break
          case 'sendReverb': chain.reverbSend.gain.linearRampToValueAtTime(val, rampTime); break
          case 'sendDelay': chain.delaySend.gain.linearRampToValueAtTime(val, rampTime); break
          case 'sendMod': chain.modSend.gain.linearRampToValueAtTime(val, rampTime); break
          case 'eqLow': chain.eq3.low.linearRampToValueAtTime(val, rampTime); break
          case 'eqMid': chain.eq3.mid.linearRampToValueAtTime(val, rampTime); break
          case 'eqHigh': chain.eq3.high.linearRampToValueAtTime(val, rampTime); break
          case 'compMix':
            chain.compDry.gain.linearRampToValueAtTime(1 - val, rampTime)
            chain.compWet.gain.linearRampToValueAtTime(val, rampTime)
            break
          case 'distortionMix': chain.distortion.wet.linearRampToValueAtTime(val, rampTime); break
          case 'bitcrushMix': chain.bitcrush.wet.linearRampToValueAtTime(val, rampTime); break
        }
      }

      // LFO 2 — independent route to a disjoint destination set, additive on the static value.
      if (p.lfo2Dest !== 'off' && p.lfo2Depth > 0) {
        const lfo2 = Math.sin(2 * Math.PI * p.lfo2Rate * time)
        const d = p.lfo2Depth * lfo2
        const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
        switch (p.lfo2Dest) {
          case 'pan': chain.panner.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, p.pan + d)), rampTime); break
          case 'sendReverb': chain.reverbSend.gain.linearRampToValueAtTime(clamp01(p.sendReverb + d * 0.5), rampTime); break
          case 'sendDelay': chain.delaySend.gain.linearRampToValueAtTime(clamp01(p.sendDelay + d * 0.5), rampTime); break
          case 'sendMod': chain.modSend.gain.linearRampToValueAtTime(clamp01(p.sendMod + d * 0.5), rampTime); break
          case 'eqLow': chain.eq3.low.linearRampToValueAtTime(p.eqLow + d * 12, rampTime); break
          case 'eqMid': chain.eq3.mid.linearRampToValueAtTime(p.eqMid + d * 12, rampTime); break
          case 'eqHigh': chain.eq3.high.linearRampToValueAtTime(p.eqHigh + d * 12, rampTime); break
          case 'distortionMix': chain.distortion.wet.linearRampToValueAtTime(clamp01(p.distortionMix + d * 0.5), rampTime); break
        }
      }

      // Scheduled sidechain duck: not an audio-analysis sidechain — it dips this track's volume
      // whenever duckSource's kick lane has a hit at this step. Adapted to dotbeat's free-timed
      // hits (BeatLab reads a 16-step pattern cell). duckAmount can itself be automated.
      if (p.duckSource) {
        const duckAuto = content.automation.get('duckAmount')
        const duckAmt = duckAuto && duckAuto.length ? interpolateAutomation(duckAuto, content.contentStep, false) : p.duckAmount
        if (duckAmt > 0) {
          const source = doc.tracks.find((x) => x.id === p.duckSource)
          const srcContent = source ? this.contentOf(source, step, doc.loopBars, song, doc.scenes, bar) : null
          const kickHit = source?.kind === 'drums' && srcContent
            ? srcContent.hits.some((h) => h.lane === 'kick' && Math.floor(h.start) === srcContent.contentStep)
            : false
          if (kickHit) {
            const dipDb = duckAmt * 24
            chain.vol.volume.cancelScheduledValues(time)
            chain.vol.volume.setValueAtTime(p.volume, time)
            chain.vol.volume.linearRampToValueAtTime(p.volume - dipDb, time + 0.005)
            chain.vol.volume.linearRampToValueAtTime(p.volume, time + 0.16)
          }
        }
      }

      // Trigger notes due this step across the whole oscillator bank.
      for (const n of content.notes) {
        if (Math.floor(n.start) !== content.contentStep) continue
        const noteTime = time + (n.start - content.contentStep) * stepSeconds
        const dur = Math.max(n.duration * stepSeconds * 0.9, 0.05)
        let freq = Tone.Frequency(n.pitch, 'midi').toFrequency()
        if (p.lfoDest === 'pitch' && lfoOn) freq *= Math.pow(2, (p.lfoDepth * lfo * 100) / 1200)
        chain.synth.triggerAttackRelease(freq, dur, noteTime, n.velocity)
        if (p.osc2Level > 0) chain.osc2.triggerAttackRelease(freq * Math.pow(2, p.osc2Detune / 1200), dur, noteTime, n.velocity)
        if (p.unisonVoices >= 3 && p.osc2Level > 0) chain.osc3.triggerAttackRelease(freq * Math.pow(2, -p.osc2Detune / 1200), dur, noteTime, n.velocity)
        for (const u of chain.uniPairs) {
          if (p.unisonVoices >= u.minVoices && p.osc2Level > 0) u.poly.triggerAttackRelease(freq * Math.pow(2, (u.mul * p.osc2Detune) / 1200), dur, noteTime, n.velocity)
        }
        if (p.subLevel > 0) chain.sub.triggerAttackRelease(freq / 2, dur, noteTime, n.velocity)
        if (p.noiseLevel > 0) chain.noise.triggerAttackRelease(dur, noteTime, n.velocity)
        if (p.fmLevel > 0) chain.fm.triggerAttackRelease(freq, dur, noteTime, n.velocity)
        if (p.filterEnvAmount > 0 || p.keytrackAmount > 0 || p.velToFilterAmount > 0) {
          // Keytracking/velocity shift this note's cutoff at note-on; the filter envelope then
          // sweeps relative to that shifted value.
          const keytrackMult = Math.pow(2, (p.keytrackAmount * (n.pitch - 60)) / 12)
          const velMult = Math.pow(2, p.velToFilterAmount * (n.velocity - 0.5) * 4)
          const noteCutoff = Math.max(baseCutoff * keytrackMult * velMult, 20)
          const peak = Math.max(noteCutoff * Math.pow(2, p.filterEnvAmount * 4), 20)
          const sustainHz = Math.max(noteCutoff * Math.pow(2, p.filterEnvAmount * 4 * p.filterEnvSustain), 20)
          chain.filter.frequency.cancelScheduledValues(noteTime)
          chain.filter.frequency.setValueAtTime(noteCutoff, noteTime)
          chain.filter.frequency.exponentialRampToValueAtTime(peak, noteTime + Math.max(p.filterEnvAttack, 0.001))
          chain.filter.frequency.exponentialRampToValueAtTime(sustainHz, noteTime + Math.max(p.filterEnvAttack, 0.001) + Math.max(p.filterEnvDecay, 0.001))
          chain.filter.frequency.exponentialRampToValueAtTime(noteCutoff, noteTime + dur + Math.max(p.filterEnvRelease, 0.001))
        }
      }
    }

    // Grid-quantized reactive-state handoff, aligned to the audio clock (BeatLab engine.ts:1423).
    Tone.getDraw().schedule(() => {
      useStore.setState({ currentStep: step, masterLevel: this.masterMeter?.getValue() as number | undefined })
    }, time)
  }

  /** Records `seconds` of the live master output (post-limiter — exactly what plays) as a WAV blob.
   * Playback must already be running or the capture is silence. Ported from BeatLab's recordWav:
   * MediaRecorder can only record a lossy codec, so decode the webm/opus back to raw samples and
   * re-encode as WAV (the format the CLI metrics path can load). Used by the parity harness. */
  async recordWav(seconds: number): Promise<Blob> {
    this.getMaster()
    if (!this.recordingDest) {
      const ctx = Tone.getContext().rawContext as AudioContext
      this.recordingDest = ctx.createMediaStreamDestination()
      this.masterLimiter!.connect(this.recordingDest)
    }
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t))
    const recorder = new MediaRecorder(this.recordingDest.stream, mimeType ? { mimeType } : undefined)
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
    })
    recorder.start()
    await new Promise((r) => setTimeout(r, Math.ceil(seconds * 1000) + 150))
    recorder.stop()
    await stopped
    const captured = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
    const arrayBuf = await captured.arrayBuffer()
    const decoded = await Tone.getContext().rawContext.decodeAudioData(arrayBuf)
    return audioBufferToWav(decoded)
  }
}

export const engine = new Engine()

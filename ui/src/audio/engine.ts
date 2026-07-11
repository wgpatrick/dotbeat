// dotbeat's audio engine, first slice. Adapted from BeatLab's src/audio/engine.ts (docs/research/
// 15 §4 clears porting it) but deliberately COMPACT and honest, per the Stream 1 brief: simple
// Tone.js playback that proves the loop is real and something plays — NOT parameter-for-parameter
// fidelity with all ~60 SYNTH_FIELDS. What's wired vs. stubbed is spelled out in
// docs/phase-12-frontend.md.
//
// What's faithfully ported from BeatLab:
//   - the drum-voice construction (MembraneSynth kick, NoiseSynth snare/clap, MetalSynth hats)
//   - the transport tick: Tone.getTransport().scheduleRepeat(tick, '16n'), step = ticks/PPQ*4,
//     wrapped over loop_bars*16 (engine.ts:1109-1124, :1139-1145)
//   - the Tone.getDraw().schedule(() => setState({currentStep, masterLevel})) handoff — the
//     grid-quantized (≤16/bar) reactive-state update, NOT a per-frame one (engine.ts:1423-1425)
//   - the master bus → limiter → destination chain with side-tapped meter + waveform/fft
//     analysers (engine.ts:199-214), read by Scope through the shared rAF driver
//
// What's stubbed / simplified vs. BeatLab: one PolySynth+filter+volume+pan per synth track (no
// osc2/sub/noise/fm layers, no LFOs, no filter envelope, no sends/inserts/sidechain), fixed drum
// voices (kickTune/decay/etc. not applied), and off-grid hits/notes are triggered at their
// fractional offset within the step but voices are not per-hit reshaped.

import * as Tone from 'tone'
import { useStore } from '../state/store'
import type { BeatDocument, BeatTrack, DrumLane, OscType } from '../types'

interface SynthChain {
  synth: Tone.PolySynth<Tone.Synth>
  filter: Tone.Filter
  vol: Tone.Volume
  panner: Tone.Panner
  osc: OscType
}

interface DrumVoices {
  kick: Tone.MembraneSynth
  snare: Tone.NoiseSynth
  clap: Tone.NoiseSynth
  hat: Tone.MetalSynth
  openhat: Tone.MetalSynth
}

class Engine {
  private chains = new Map<string, SynthChain>()
  private drums: DrumVoices | null = null
  private repeatId: number | null = null
  private started = false

  private masterBus: Tone.Gain | null = null
  private masterLimiter: Tone.Limiter | null = null
  private masterMeter: Tone.Meter | null = null
  private waveformAnalyser: Tone.Analyser | null = null
  private fftAnalyser: Tone.Analyser | null = null

  private getMaster(): Tone.Gain {
    if (!this.masterBus) {
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
    if (!this.waveformAnalyser) return null
    return this.waveformAnalyser.getValue() as Float32Array
  }

  /** Live frequency-bin magnitudes (dB) of the master output. */
  getFftData(): Float32Array | null {
    if (!this.fftAnalyser) return null
    return this.fftAnalyser.getValue() as Float32Array
  }

  async ensureStarted(): Promise<void> {
    if (this.started) return
    await Tone.start()
    this.buildDrums()
    this.started = true
  }

  private buildDrums(): void {
    const out = this.getMaster()
    const kick = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 7, envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.1 } }).connect(out)
    kick.volume.value = -2

    const snareFilter = new Tone.Filter(1800, 'highpass').connect(out)
    const snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.13, sustain: 0 } }).connect(snareFilter)
    snare.volume.value = -8

    const clapFilter = new Tone.Filter(1100, 'bandpass').connect(out)
    clapFilter.Q.value = 1.2
    const clap = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.004, decay: 0.2, sustain: 0 } }).connect(clapFilter)
    clap.volume.value = -2

    const hat = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.05, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5 }).connect(out)
    hat.volume.value = -18

    const openhat = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.35, release: 0.05 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5 }).connect(out)
    openhat.volume.value = -20

    this.drums = { kick, snare, clap, hat, openhat }
  }

  private buildSynthChain(track: BeatTrack): SynthChain {
    const out = this.getMaster()
    const panner = new Tone.Panner(0).connect(out)
    const vol = new Tone.Volume(0).connect(panner)
    const filter = new Tone.Filter(2000, 'lowpass').connect(vol)
    const synth = new Tone.PolySynth(Tone.Synth).connect(filter)
    const chain: SynthChain = { synth, filter, vol, panner, osc: 'sawtooth' }
    this.applySynthParams(chain, track)
    return chain
  }

  private applySynthParams(chain: SynthChain, track: BeatTrack): void {
    const p = track.synth
    if (chain.osc !== p.osc) {
      chain.synth.set({ oscillator: { type: p.osc as OscType } })
      chain.osc = p.osc as OscType
    }
    chain.synth.set({ envelope: { attack: Number(p.attack), decay: Number(p.decay), sustain: Number(p.sustain), release: Number(p.release) } })
    chain.filter.frequency.value = Number(p.cutoff)
    chain.filter.Q.value = Number(p.resonance)
    chain.vol.volume.value = Number(p.volume)
    chain.panner.pan.value = Number(p.pan)
  }

  /** Reconcile live voices with the document: create chains for new synth tracks, update params on
   * existing ones, dispose ones whose track vanished. Drums share the one fixed kit. */
  private sync(doc: BeatDocument): void {
    const synthTracks = doc.tracks.filter((t) => t.kind === 'synth')
    const wanted = new Set(synthTracks.map((t) => t.id))
    for (const [id, chain] of [...this.chains]) {
      if (!wanted.has(id)) {
        chain.synth.dispose()
        chain.filter.dispose()
        chain.vol.dispose()
        chain.panner.dispose()
        this.chains.delete(id)
      }
    }
    for (const track of synthTracks) {
      const existing = this.chains.get(track.id)
      if (existing) this.applySynthParams(existing, track)
      else this.chains.set(track.id, this.buildSynthChain(track))
    }
  }

  triggerDrum(lane: DrumLane, time: number, velocity = 1): void {
    if (!this.drums) return
    const t = time
    switch (lane) {
      case 'kick':
        this.drums.kick.triggerAttackRelease('C1', '8n', t, velocity)
        break
      case 'snare':
        this.drums.snare.triggerAttackRelease('8n', t, velocity)
        break
      case 'clap':
        this.drums.clap.triggerAttackRelease('8n', t, velocity)
        break
      case 'hat':
        this.drums.hat.triggerAttackRelease('32n', t, velocity)
        break
      case 'openhat':
        this.drums.openhat.triggerAttackRelease('16n', t, velocity)
        break
    }
  }

  async previewDrum(lane: DrumLane, velocity = 1): Promise<void> {
    await this.ensureStarted()
    this.triggerDrum(lane, Tone.now(), velocity)
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
    t.loopEnd = `${doc.loopBars}m`
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
    useStore.getState().setPlaying(false)
    useStore.setState({ currentStep: -1 })
  }

  setBpm(bpm: number): void {
    Tone.getTransport().bpm.value = bpm
  }

  private tick(time: number): void {
    const doc = useStore.getState().doc
    if (!doc) return
    // Re-sync each tick so live knob/step edits are heard on the next step (BeatLab does the same:
    // playback reads current store state, never a snapshot).
    this.sync(doc)
    const transport = Tone.getTransport()
    const totalSteps = doc.loopBars * 16
    const ticksPerStep = transport.PPQ / 4
    const step = Math.round(transport.getTicksAtTime(time) / ticksPerStep) % totalSteps
    const stepSeconds = Tone.Time('16n').toSeconds()

    for (const track of doc.tracks) {
      if (track.kind === 'drums') {
        for (const h of track.hits) {
          if (Math.floor(h.start) === step) {
            const frac = h.start - Math.floor(h.start)
            this.triggerDrum(h.lane, time + frac * stepSeconds, h.velocity)
          }
        }
      } else if (track.kind === 'synth') {
        const chain = this.chains.get(track.id)
        if (!chain) continue
        for (const n of track.notes) {
          if (Math.floor(n.start) === step) {
            const frac = n.start - Math.floor(n.start)
            const freq = Tone.Frequency(n.pitch, 'midi').toFrequency()
            const dur = Math.max(0.02, n.duration * stepSeconds)
            chain.synth.triggerAttackRelease(freq, dur, time + frac * stepSeconds, n.velocity)
          }
        }
      }
    }

    // Grid-quantized reactive-state handoff, aligned to the audio clock (BeatLab engine.ts:1423).
    Tone.getDraw().schedule(() => {
      useStore.setState({ currentStep: step, masterLevel: this.masterMeter?.getValue() as number | undefined })
    }, time)
  }
}

export const engine = new Engine()

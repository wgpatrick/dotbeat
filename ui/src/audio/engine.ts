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
// Phase 16 Stream K CLOSED that stream's two deferred items: instrument voices now carry their own
// muteGain (gated by applyMuteGates() exactly like synth chains/the drum bus) and levelTap (read by
// getTrackLevel() for the mixer meter) — see InstrumentVoice, buildInstrument(), applyMuteGates().
//
// Deliberately NOT ported (out of Stream A scope — see the parity doc): wavetable oscillators
// (dotbeat's osc is only sine/tri/saw/square), drawn LFO shapes (lfoShape stays sine-only),
// reorderable insert order, the arpeggiator, sample-slicing / per-lane one-shots (v0.5 media),
// and live-MIDI monitoring. Instrument tracks get level/pan/mute into the master bus but NOT the
// synth FX chain (EQ/comp/sends/sidechain) — full instrument FX parity remains a later stream.
//
// Phase 18 Stream R ADDED tempo-synced LFO rates (lfoSync/lfoSyncRate, lfo2Sync/lfo2SyncRate — a
// note division instead of free Hz, resolved against the live doc.bpm every tick) and widened
// lfoDest/lfo2Dest onto one shared, larger enumerated destination set (resonance/pan/sends/EQ/
// compMix/distortionMix/bitcrushMix newly or now-actually reachable by both LFOs — see LFO_DESTS's
// comment for a pre-existing dead-code bug this also fixes). Kept the flat-enum model, no
// free-routing matrix — see docs/research/18-ableton-ui-architecture.md's LFO-depth section and
// docs/phase-18-lfo-depth.md.

import * as Tone from 'tone'
import { WorkletSynthesizer } from 'spessasynth_lib'
// The AudioWorklet processor is a static asset Vite serves at a hashed URL; addModule() needs a
// real URL, so import it via ?url rather than bundling it as code.
import spessaWorkletUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url'
import { useStore, isEffectivelyMuted } from '../state/store'
import { daemonBase } from '../daemon/bridge'
import { audioBufferToWav } from './wavEncode'
import type { BeatAudioRegion, BeatDocument, BeatDrumHit, BeatDrumLaneDecl, BeatEffect, BeatInstrument, BeatNote, BeatSynth, BeatTrack, DrumVoiceType, OscType } from '../types'
import { DRUM_VOICE_PARAM_DEFAULTS } from '../types'

// Phase 18 Stream R: ONE shared, widened destination set for both LFO1 and LFO2 — mirrors
// src/core/document.ts's LFO_DESTS/LfoDestination exactly (ui/ is a standalone Vite app with no
// build-time dependency on src/core — see the file-header comment — so this is a hand-kept
// mirror, same convention as OSC_SET below). Widened from the original {off,pitch,cutoff,amp,
// wtPos}; this ALSO fixes a real bug: LFO2 used to switch on 'pan'/sends/EQ/'distortionMix' but
// the document schema only allowed the original 5 values for lfo2Dest, so those destinations were
// unreachable dead code (no document could legally set lfo2Dest to 'pan'). Now both LFOs share one
// enum and both branches below are live for both LFOs — see docs/research/18-ableton-ui-
// architecture.md's LFO-depth section for why this stays a flat enum, not a free-routing matrix.
type LfoDest =
  | 'off'
  | 'pitch'
  | 'cutoff'
  | 'resonance'
  | 'amp'
  | 'pan'
  | 'wtPos'
  | 'sendReverb'
  | 'sendDelay'
  | 'eqLow'
  | 'eqMid'
  | 'eqHigh'
  | 'compMix'
  | 'distortionMix'
  | 'bitcrushMix'
const LFO_DESTS: readonly LfoDest[] = [
  'off',
  'pitch',
  'cutoff',
  'resonance',
  'amp',
  'pan',
  'wtPos',
  'sendReverb',
  'sendDelay',
  'eqLow',
  'eqMid',
  'eqHigh',
  'compMix',
  'distortionMix',
  'bitcrushMix',
]

// Phase 22 Stream AC: hand-kept mirrors of document.ts's BeatRepeatMode/ChorusMode/SaturatorCurve
// + BEAT_REPEAT_MODES/CHORUS_MODES/SATURATOR_CURVES (same convention as LfoDest/LFO_DESTS above —
// ui/ is a standalone Vite app with no build-time dependency on src/core).
type BeatRepeatMode = 'mix' | 'insert' | 'gate'
const BEAT_REPEAT_MODES: readonly BeatRepeatMode[] = ['mix', 'insert', 'gate']
type ChorusMode = 'off' | 'chorus' | 'ensemble' | 'vibrato'
const CHORUS_MODES: readonly ChorusMode[] = ['off', 'chorus', 'ensemble', 'vibrato']
type SaturatorCurve = 'analog' | 'warm' | 'clip' | 'fold'
const SATURATOR_CURVES: readonly SaturatorCurve[] = ['analog', 'warm', 'clip', 'fold']

// Phase 23 Stream BF: hand-kept mirror of document.ts's ResonatorChord/RESONATOR_CHORDS (same
// convention as the Stream AC mirrors just above).
type ResonatorChord = 'fifths' | 'major' | 'minor' | 'octaves' | 'harmonic'
const RESONATOR_CHORDS: readonly ResonatorChord[] = ['fifths', 'major', 'minor', 'octaves', 'harmonic']
// Semitone offsets (from resonatorFreq) for each of the bank's up to 5 tuned bandpass filters —
// 'fifths'/'octaves'/'harmonic' approximate a plucked-string/tube's own overtone series at
// different densities (harmonic = literal harmonic-series semitone approximations for partials
// 1-5: 0, 12, 19, 24, 28); 'major'/'minor' tune the bank to a triad instead, for a more
// melodic/pitched resonance than a pure overtone stack.
const RESONATOR_CHORD_OFFSETS: Record<ResonatorChord, readonly number[]> = {
  fifths: [0, 7, 12, 19, 24],
  major: [0, 4, 7, 12, 16],
  minor: [0, 3, 7, 12, 15],
  octaves: [0, 12, 24, 36, 48],
  harmonic: [0, 12, 19, 24, 28],
}
// Phase 23 Stream BD: mirrors document.ts's EqFilterSlope/EQ_FILTER_SLOPES (same hand-kept-mirror
// convention as above) — eq7's HP/LP slope, in dB/octave, matching Tone.Filter's `rolloff` values.
type EqFilterSlope = '12' | '24' | '48' | '96'
const EQ_FILTER_SLOPES: readonly EqFilterSlope[] = ['12', '24', '48', '96']

// Tempo-sync (Phase 18 Stream R): mirrors src/core/document.ts's LfoSyncRate/LFO_SYNC_RATES/
// lfoSyncRateHz exactly (same hand-kept-mirror convention as LFO_DESTS above).
type LfoSyncRate = '1/1' | '1/2' | '1/4' | '1/8' | '1/16' | '1/32' | '1/4t' | '1/8t' | '1/16t' | '1/4d' | '1/8d' | '1/16d'
const LFO_SYNC_RATES: readonly LfoSyncRate[] = ['1/1', '1/2', '1/4', '1/8', '1/16', '1/32', '1/4t', '1/8t', '1/16t', '1/4d', '1/8d', '1/16d']

/** Seconds-per-cycle of a tempo-synced LFO division at a given bpm ("1/4" = one quarter note =
 * 60/bpm seconds; 't' = triplet, 2/3 length; 'd' = dotted, 1.5x length). */
function lfoSyncDivisionSeconds(bpm: number, division: LfoSyncRate): number {
  const m = /^1\/(\d+)([td]?)$/.exec(division)
  const denom = m ? Number(m[1]) : 4
  const mod = m?.[2]
  let seconds = ((60 / bpm) * 4) / denom
  if (mod === 't') seconds *= 2 / 3
  else if (mod === 'd') seconds *= 1.5
  return seconds
}

/** The synced rate in Hz — what lfoValueAt's sine wants. Real tempo-tracking: this is recomputed
 * from doc.bpm every tick() call (see below), so a BPM edit changes the LFO's actual period on
 * the very next scheduled step, not just at note-on. */
function lfoSyncRateHz(bpm: number, division: LfoSyncRate): number {
  const seconds = lfoSyncDivisionSeconds(bpm, division)
  return seconds > 0 ? 1 / seconds : 1
}

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
  lfoSync: boolean
  lfoSyncRate: LfoSyncRate
  lfo2Rate: number
  lfo2Depth: number
  lfo2Dest: LfoDest
  lfo2Sync: boolean
  lfo2SyncRate: LfoSyncRate
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
  bitcrushRate: number
  pingPongTime: number
  pingPongFeedback: number
  pingPongCrossFeed: number
  pingPongWobbleRate: number
  pingPongWobbleDepth: number
  pingPongMix: number
  beatRepeatGrid: number
  beatRepeatGate: number
  beatRepeatChance: number
  beatRepeatMode: BeatRepeatMode
  chorusMode: ChorusMode
  chorusRate: number
  chorusDepth: number
  chorusMix: number
  phaserRate: number
  phaserDepth: number
  phaserMix: number
  saturatorCurve: SaturatorCurve
  saturatorDrive: number
  saturatorMix: number
  autoFilterRate: number
  autoFilterDepth: number
  autoFilterOctaves: number
  autoFilterBaseFrequency: number
  autoFilterType: FilterType
  autoFilterMix: number
  autoPanRate: number
  autoPanDepth: number
  autoPanMix: number
  tremoloRate: number
  tremoloDepth: number
  tremoloSpread: number
  tremoloMix: number
  utilityWidth: number
  utilityGain: number
  grainDelayTime: number
  grainDelayFeedback: number
  grainDelaySize: number
  grainDelayPitch: number
  grainDelayMix: number
  vinylDrive: number
  vinylNoiseLevel: number
  vinylTone: number
  vinylMix: number
  resonatorFreq: number
  resonatorChord: ResonatorChord
  resonatorQ: number
  resonatorMix: number
  eq7HpOn: boolean
  eq7HpFreq: number
  eq7HpSlope: EqFilterSlope
  eq7HpQ: number
  eq7LowShelfOn: boolean
  eq7LowShelfFreq: number
  eq7LowShelfGain: number
  eq7Bell1On: boolean
  eq7Bell1Freq: number
  eq7Bell1Gain: number
  eq7Bell1Q: number
  eq7Bell2On: boolean
  eq7Bell2Freq: number
  eq7Bell2Gain: number
  eq7Bell2Q: number
  eq7Bell3On: boolean
  eq7Bell3Freq: number
  eq7Bell3Gain: number
  eq7Bell3Q: number
  eq7HighShelfOn: boolean
  eq7HighShelfFreq: number
  eq7HighShelfGain: number
  eq7LpOn: boolean
  eq7LpFreq: number
  eq7LpSlope: EqFilterSlope
  eq7LpQ: number
  sendReverb: number
  sendDelay: number
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
  const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
  const syncRate = (v: unknown, d: LfoSyncRate): LfoSyncRate => (typeof v === 'string' && LFO_SYNC_RATES.includes(v as LfoSyncRate) ? (v as LfoSyncRate) : d)
  const beatRepeatMode = (v: unknown, d: BeatRepeatMode): BeatRepeatMode => (typeof v === 'string' && BEAT_REPEAT_MODES.includes(v as BeatRepeatMode) ? (v as BeatRepeatMode) : d)
  const chorusMode = (v: unknown, d: ChorusMode): ChorusMode => (typeof v === 'string' && CHORUS_MODES.includes(v as ChorusMode) ? (v as ChorusMode) : d)
  const saturatorCurve = (v: unknown, d: SaturatorCurve): SaturatorCurve => (typeof v === 'string' && SATURATOR_CURVES.includes(v as SaturatorCurve) ? (v as SaturatorCurve) : d)
  const resonatorChord = (v: unknown, d: ResonatorChord): ResonatorChord => (typeof v === 'string' && RESONATOR_CHORDS.includes(v as ResonatorChord) ? (v as ResonatorChord) : d)
  const eqSlope = (v: unknown, d: EqFilterSlope): EqFilterSlope => (typeof v === 'string' && EQ_FILTER_SLOPES.includes(v as EqFilterSlope) ? (v as EqFilterSlope) : d)
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
    lfoDest: (LFO_DESTS.includes(p.lfoDest as LfoDest) ? p.lfoDest : 'off') as LfoDest,
    lfoSync: bool(p.lfoSync, false),
    lfoSyncRate: syncRate(p.lfoSyncRate, '1/4'),
    lfo2Rate: num(p.lfo2Rate, 3),
    lfo2Depth: num(p.lfo2Depth, 0),
    lfo2Dest: (LFO_DESTS.includes(p.lfo2Dest as LfoDest) ? p.lfo2Dest : 'off') as LfoDest,
    lfo2Sync: bool(p.lfo2Sync, false),
    lfo2SyncRate: syncRate(p.lfo2SyncRate, '1/8'),
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
    bitcrushRate: num(p.bitcrushRate, 1),
    pingPongTime: num(p.pingPongTime, 0.19),
    pingPongFeedback: num(p.pingPongFeedback, 0.3),
    pingPongCrossFeed: num(p.pingPongCrossFeed, 1),
    pingPongWobbleRate: num(p.pingPongWobbleRate, 0.5),
    pingPongWobbleDepth: num(p.pingPongWobbleDepth, 0),
    pingPongMix: num(p.pingPongMix, 0),
    beatRepeatGrid: num(p.beatRepeatGrid, 1),
    beatRepeatGate: num(p.beatRepeatGate, 0),
    beatRepeatChance: num(p.beatRepeatChance, 1),
    beatRepeatMode: beatRepeatMode(p.beatRepeatMode, 'insert'),
    chorusMode: chorusMode(p.chorusMode, 'off'),
    chorusRate: num(p.chorusRate, 1.5),
    chorusDepth: num(p.chorusDepth, 0.7),
    chorusMix: num(p.chorusMix, 0),
    phaserRate: num(p.phaserRate, 0.5),
    phaserDepth: num(p.phaserDepth, 3),
    phaserMix: num(p.phaserMix, 0),
    saturatorCurve: saturatorCurve(p.saturatorCurve, 'analog'),
    saturatorDrive: num(p.saturatorDrive, 0),
    saturatorMix: num(p.saturatorMix, 0),
    autoFilterRate: num(p.autoFilterRate, 1),
    autoFilterDepth: num(p.autoFilterDepth, 1),
    autoFilterOctaves: num(p.autoFilterOctaves, 2.6),
    autoFilterBaseFrequency: num(p.autoFilterBaseFrequency, 200),
    autoFilterType: (['lowpass', 'bandpass', 'highpass'].includes(String(p.autoFilterType)) ? p.autoFilterType : 'lowpass') as FilterType,
    autoFilterMix: num(p.autoFilterMix, 0),
    autoPanRate: num(p.autoPanRate, 1),
    autoPanDepth: num(p.autoPanDepth, 1),
    autoPanMix: num(p.autoPanMix, 0),
    tremoloRate: num(p.tremoloRate, 10),
    tremoloDepth: num(p.tremoloDepth, 0.5),
    tremoloSpread: num(p.tremoloSpread, 180),
    tremoloMix: num(p.tremoloMix, 0),
    utilityWidth: num(p.utilityWidth, 0.5),
    utilityGain: num(p.utilityGain, 0),
    grainDelayTime: num(p.grainDelayTime, 0.25),
    grainDelayFeedback: num(p.grainDelayFeedback, 0.35),
    grainDelaySize: num(p.grainDelaySize, 0.1),
    grainDelayPitch: num(p.grainDelayPitch, 0),
    grainDelayMix: num(p.grainDelayMix, 0),
    vinylDrive: num(p.vinylDrive, 0.3),
    vinylNoiseLevel: num(p.vinylNoiseLevel, 0),
    vinylTone: num(p.vinylTone, 0.5),
    vinylMix: num(p.vinylMix, 0),
    resonatorFreq: num(p.resonatorFreq, 220),
    resonatorChord: resonatorChord(p.resonatorChord, 'fifths'),
    resonatorQ: num(p.resonatorQ, 20),
    resonatorMix: num(p.resonatorMix, 0),
    eq7HpOn: bool(p.eq7HpOn, false),
    eq7HpFreq: num(p.eq7HpFreq, 80),
    eq7HpSlope: eqSlope(p.eq7HpSlope, '24'),
    eq7HpQ: num(p.eq7HpQ, 0.707),
    eq7LowShelfOn: bool(p.eq7LowShelfOn, false),
    eq7LowShelfFreq: num(p.eq7LowShelfFreq, 120),
    eq7LowShelfGain: num(p.eq7LowShelfGain, 0),
    eq7Bell1On: bool(p.eq7Bell1On, false),
    eq7Bell1Freq: num(p.eq7Bell1Freq, 250),
    eq7Bell1Gain: num(p.eq7Bell1Gain, 0),
    eq7Bell1Q: num(p.eq7Bell1Q, 1),
    eq7Bell2On: bool(p.eq7Bell2On, false),
    eq7Bell2Freq: num(p.eq7Bell2Freq, 1000),
    eq7Bell2Gain: num(p.eq7Bell2Gain, 0),
    eq7Bell2Q: num(p.eq7Bell2Q, 1),
    eq7Bell3On: bool(p.eq7Bell3On, false),
    eq7Bell3Freq: num(p.eq7Bell3Freq, 4000),
    eq7Bell3Gain: num(p.eq7Bell3Gain, 0),
    eq7Bell3Q: num(p.eq7Bell3Q, 1),
    eq7HighShelfOn: bool(p.eq7HighShelfOn, false),
    eq7HighShelfFreq: num(p.eq7HighShelfFreq, 8000),
    eq7HighShelfGain: num(p.eq7HighShelfGain, 0),
    eq7LpOn: bool(p.eq7LpOn, false),
    eq7LpFreq: num(p.eq7LpFreq, 12000),
    eq7LpSlope: eqSlope(p.eq7LpSlope, '24'),
    eq7LpQ: num(p.eq7LpQ, 0.707),
    sendReverb: num(p.sendReverb, 0),
    sendDelay: num(p.sendDelay, 0),
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

// Bipolar -1..1 LFO value at time t, at a plain sine (BeatLab's lfoWaveValue minus the
// custom-shape branch — still not ported, see the file-header "deliberately not ported" list).
// Phase 18 Stream R added real tempo-sync: `rateHz` is resolved by the caller (tick(), below) as
// either the free-Hz field or lfoSyncRateHz(doc.bpm, ...syncRate) when *Sync is on, so a BPM edit
// changes this function's actual period on the very next tick — this function itself just needs a
// rate, it doesn't care where it came from.
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

// Phase 22 Stream AA: the ordered, reorderable per-track effect chain — mirrors
// src/core/document.ts's EffectType/BeatEffect exactly (ui/ hand-mirrors core constants, same
// convention as LFO_DESTS/LFO_SYNC_RATES above). Replaces the old fixed
// EQ3->comp->distortion->bitcrush insert order this file's header comment used to list as "NOT
// ported" — the chain is now built by iterating the track's declared, ordered `effects` list.
// Phase 23 Streams BD, BE, and BF widened this to twelve types: BD added 'eq7' (7-band parametric
// EQ), BE added autoFilter/autoPan/tremolo/utility, BF added grainDelay/vinylDistortion/resonator
// — all eight ADDED to the same reorderable mechanism, not a parallel one (see EffectRuntime/
// buildEffectRuntime below and document.ts's EffectType comment for why these are real chain
// members, unlike Stream AC's fixed saturator/chorus/phaser/pingPong inserts below).
type EffectType =
  | 'eq3'
  | 'comp'
  | 'distortion'
  | 'bitcrush'
  | 'eq7'
  | 'autoFilter'
  | 'autoPan'
  | 'tremolo'
  | 'utility'
  | 'grainDelay'
  | 'vinylDistortion'
  | 'resonator'

// One live effect instance's Tone nodes. `entry`/`exit` are the two nodes the chain SPINE
// connects to (upstream -> entry, exit -> downstream); everything else is that effect's own
// internal wiring, built once and never touched by reordering. Each type also exposes its OWN
// param nodes (eq3/compressor/compDry/compWet/distortion/bitcrush/eq7/autoFilter/autoPan/tremolo/
// utility/grainDelay/vinylDistortion/resonator) so applyEffectParams and the LFO/clip-automation
// destinations below can reach them directly, keyed by TYPE (not id) — see findEffect. `nodes` is
// every Tone node this instance owns, for disposeChain/disposeEffect.
interface EffectRuntime {
  id: string
  type: EffectType
  entry: Tone.ToneAudioNode
  exit: Tone.ToneAudioNode
  nodes: Tone.ToneAudioNode[]
  // Native (non-Tone) nodes this instance owns, disconnect()-only cleanup (no `.dispose()`) —
  // currently only bitcrush's Redux downsampler (see buildDownsampler below: a raw
  // ScriptProcessorNode, no Tone.js built-in does sample-rate reduction). Kept OFF `nodes` (which
  // is strictly Tone.ToneAudioNode[], iterated by callers that call `.dispose()` on every entry)
  // rather than widening that array's type for one case — see the two call sites that check this
  // (reconcileEffectChain's removal loop, disposeChain).
  raw?: AudioNode[]
  eq3?: Tone.EQ3
  compressor?: Tone.Compressor
  compDry?: Tone.Gain
  compWet?: Tone.Gain
  distortion?: Tone.Distortion
  bitcrush?: Tone.BitCrusher
  bitcrushDry?: Tone.Gain
  bitcrushWet?: Tone.Gain
  downsampler?: DownsamplerNode
  autoFilter?: Tone.AutoFilter
  autoPan?: Tone.AutoPanner
  tremolo?: Tone.Tremolo
  utility?: { widener: Tone.StereoWidener; gainTrim: Tone.Volume }
  grainDelay?: GrainDelayNodes
  vinylDistortion?: VinylNodes
  resonator?: ResonatorNodes
  eq7?: EQ7Nodes
}

// Phase 23 Stream BE — Redux's downsampling half (research 17 §5.6: "Tone.js has no built-in
// Rate/Jitter node"). A sample-and-hold decimator: holds each channel's last sample for `hold`
// consecutive input samples before taking a new one — the classic sample-rate-reduction trick
// (aliases high-frequency content down as `hold` increases, the same mechanism a hardware sample-
// rate reducer uses). Built as a raw ScriptProcessorNode rather than a custom AudioWorklet:
// synchronous construction (no addModule()/blob-URL registration race to await — see BitCrusher's
// own ToneAudioWorklet base class, node_modules/tone, for what that dance looks like) and plain,
// portable JS state (a held L/R sample + a counter), no bundler-asset wiring needed.
// ScriptProcessorNode is deprecated but still implemented by every browser this project targets
// (Chromium, via Playwright) — an accepted tradeoff for "small," per the research doc's framing.
// See docs/phase-23-stream-be.md for the fuller design writeup.
interface DownsamplerNode {
  node: ScriptProcessorNode
  setHold: (n: number) => void
}
const DOWNSAMPLER_BUFFER_SIZE = 1024
function buildDownsampler(): DownsamplerNode {
  const ctx = Tone.getContext().rawContext as AudioContext
  const node = ctx.createScriptProcessor(DOWNSAMPLER_BUFFER_SIZE, 2, 2)
  let hold = 1 // samples to hold; 1 = passthrough (no reduction) — bitcrushRate's default/off state
  let counter = 0
  let heldL = 0
  let heldR = 0
  node.onaudioprocess = (ev: AudioProcessingEvent) => {
    const inL = ev.inputBuffer.getChannelData(0)
    const inR = ev.inputBuffer.numberOfChannels > 1 ? ev.inputBuffer.getChannelData(1) : inL
    const outL = ev.outputBuffer.getChannelData(0)
    const outR = ev.outputBuffer.getChannelData(1)
    for (let i = 0; i < inL.length; i++) {
      if (counter <= 0) {
        heldL = inL[i]!
        heldR = inR[i]!
        counter = hold
      }
      counter--
      outL[i] = heldL
      outR[i] = heldR
    }
  }
  return { node, setHold: (n: number) => { hold = Math.max(1, Math.round(n)) } }
}

/** Builds one effect instance's Tone subgraph (internal wiring only — NOT connected to anything
 * upstream/downstream yet, that's the chain-spine's job in reconcileEffectChain). Mirrors what
 * buildSynthChain used to wire unconditionally for all four; now built lazily, one instance per
 * declared chain entry. eq3/distortion are single nodes (entry === exit); comp/bitcrush keep a
 * dry/wet fan-in shape (entry = a Gain that fans into dry+processing, exit = the Gain that sums
 * them back — bitcrush's pair also carries Stream BE's Redux downsampler alongside the bit-
 * crusher, see the 'bitcrush' case below). autoFilter/autoPan/tremolo are single Tone effect nodes
 * with their own internal wet/dry (entry === exit, like eq3/distortion); utility has no wet/dry
 * (like eq3) since its two params (width/gain) ARE the effect, not something to blend. `trackId`
 * is ONLY used by vinylDistortion, to seed its reproducible noise buffer (see
 * buildVinylDistortion) — every other type ignores it. */
function buildEffectRuntime(id: string, type: EffectType, trackId: string): EffectRuntime {
  switch (type) {
    case 'eq3': {
      const eq3 = new Tone.EQ3()
      return { id, type, entry: eq3, exit: eq3, nodes: [eq3], eq3 }
    }
    case 'comp': {
      const compIn = new Tone.Gain()
      const compDry = new Tone.Gain(1)
      const compressor = new Tone.Compressor()
      const compWet = new Tone.Gain(0)
      const compOut = new Tone.Gain()
      compIn.fan(compDry, compressor)
      compressor.connect(compWet)
      compDry.connect(compOut)
      compWet.connect(compOut)
      return { id, type, entry: compIn, exit: compOut, nodes: [compIn, compDry, compressor, compWet, compOut], compressor, compDry, compWet }
    }
    case 'distortion': {
      const distortion = new Tone.Distortion({ distortion: 0, wet: 0 })
      return { id, type, entry: distortion, exit: distortion, nodes: [distortion], distortion }
    }
    case 'bitcrush': {
      // Phase 23 Stream BE: bit-depth reduction (Tone.BitCrusher) and Redux's sample-rate
      // reduction (the raw downsampler) share ONE dry/wet pair driven by bitcrushMix — the same
      // "one Mix knob bypasses the whole device" contract every other insert has, now covering
      // both dimensions of this one (see docs/phase-23-stream-be.md). bitcrush.wet is forced to 1
      // (always fully wet internally) so the OUTER pair here is the only blend that matters.
      const inN = new Tone.Gain(1)
      const dry = new Tone.Gain(1)
      const wet = new Tone.Gain(0)
      const out = new Tone.Gain()
      const bitcrush = new Tone.BitCrusher(8)
      bitcrush.wet.value = 1
      const downsampler = buildDownsampler()
      inN.connect(dry)
      dry.connect(out)
      Tone.connect(inN, downsampler.node)
      Tone.connect(downsampler.node, bitcrush)
      bitcrush.connect(wet)
      wet.connect(out)
      return {
        id, type, entry: inN, exit: out, nodes: [inN, dry, wet, out, bitcrush], raw: [downsampler.node],
        bitcrush, bitcrushDry: dry, bitcrushWet: wet, downsampler,
      }
    }
    case 'autoFilter': {
      const autoFilter = new Tone.AutoFilter({ frequency: 1, depth: 1, baseFrequency: 200, octaves: 2.6, filter: { type: 'lowpass', rolloff: -12, Q: 1 }, wet: 0 }).start()
      return { id, type, entry: autoFilter, exit: autoFilter, nodes: [autoFilter], autoFilter }
    }
    case 'autoPan': {
      const autoPan = new Tone.AutoPanner({ frequency: 1, depth: 1, wet: 0 }).start()
      return { id, type, entry: autoPan, exit: autoPan, nodes: [autoPan], autoPan }
    }
    case 'tremolo': {
      const tremolo = new Tone.Tremolo({ frequency: 10, depth: 0.5, spread: 180, wet: 0 }).start()
      return { id, type, entry: tremolo, exit: tremolo, nodes: [tremolo], tremolo }
    }
    case 'utility': {
      const widener = new Tone.StereoWidener(0.5)
      const gainTrim = new Tone.Volume(0)
      widener.connect(gainTrim)
      return { id, type, entry: widener, exit: gainTrim, nodes: [widener, gainTrim], utility: { widener, gainTrim } }
    }
    case 'grainDelay': {
      const g = buildGrainDelay()
      return { id, type, entry: g.in, exit: g.out, nodes: grainDelayNodeList(g), grainDelay: g }
    }
    case 'vinylDistortion': {
      const v = buildVinylDistortion(hashSeed(trackId, id, 'vinylNoise'))
      return { id, type, entry: v.in, exit: v.out, nodes: vinylNodeList(v), vinylDistortion: v }
    }
    case 'resonator': {
      const r = buildResonatorBank()
      return { id, type, entry: r.in, exit: r.out, nodes: resonatorNodeList(r), resonator: r }
    }
    case 'eq7': {
      const eq7 = buildEq7()
      return { id, type, entry: eq7.in, exit: eq7.out, nodes: eq7NodeList(eq7), eq7 }
    }
  }
}

// A signature no REAL effect-list signature can ever equal (effect ids are restricted to
// alphanumeric/_/- by the format's SLUG_RE, so a NUL character can't appear in one) — including
// the empty-array case (`[].join('|') === ''`, which IS a real, reachable signature: an explicitly
// emptied chain, "effects none" in the file). Used to seed SynthChain.effectsSig so a freshly built
// chain's very first reconcileEffectChain call always runs, even when the track's first-ever
// effects list happens to be empty.
const EFFECTS_SIG_UNSET = ' '

function applyEffectParams(e: EffectRuntime, p: EngineSynth): void {
  if (e.eq3) {
    e.eq3.low.value = p.eqLow
    e.eq3.mid.value = p.eqMid
    e.eq3.high.value = p.eqHigh
  }
  if (e.compressor) {
    e.compressor.threshold.value = p.compThreshold
    e.compressor.ratio.value = p.compRatio
    e.compressor.attack.value = p.compAttack
    e.compressor.release.value = p.compRelease
    e.compDry!.gain.value = 1 - p.compMix
    e.compWet!.gain.value = p.compMix
  }
  if (e.distortion) {
    e.distortion.distortion = p.distortionAmount
    e.distortion.wet.value = p.distortionMix
  }
  if (e.bitcrush) {
    e.bitcrush.bits.value = Math.round(p.bitcrushBits)
    e.downsampler?.setHold(p.bitcrushRate)
    // Shared dry/wet for the whole bitcrush device (bit depth + Redux's sample-rate reduction) —
    // see buildEffectRuntime's 'bitcrush' case for why this is an OUTER pair, not bitcrush.wet
    // (forced to 1 there) directly.
    if (e.bitcrushDry && e.bitcrushWet) {
      e.bitcrushDry.gain.value = 1 - p.bitcrushMix
      e.bitcrushWet.gain.value = p.bitcrushMix
    }
  }
  if (e.autoFilter) {
    e.autoFilter.frequency.value = p.autoFilterRate
    e.autoFilter.depth.value = p.autoFilterDepth
    e.autoFilter.baseFrequency = p.autoFilterBaseFrequency
    e.autoFilter.octaves = p.autoFilterOctaves
    e.autoFilter.filter.type = p.autoFilterType
    e.autoFilter.wet.value = p.autoFilterMix
  }
  if (e.autoPan) {
    e.autoPan.frequency.value = p.autoPanRate
    e.autoPan.depth.value = p.autoPanDepth
    e.autoPan.wet.value = p.autoPanMix
  }
  if (e.tremolo) {
    e.tremolo.frequency.value = p.tremoloRate
    e.tremolo.depth.value = p.tremoloDepth
    e.tremolo.spread = p.tremoloSpread
    e.tremolo.wet.value = p.tremoloMix
  }
  if (e.utility) {
    e.utility.widener.width.value = p.utilityWidth
    e.utility.gainTrim.volume.value = p.utilityGain
  }
  if (e.grainDelay) {
    applyGrainDelay(e.grainDelay, p.grainDelayTime, p.grainDelayFeedback, p.grainDelaySize, p.grainDelayPitch, p.grainDelayMix)
  }
  if (e.vinylDistortion) {
    applyVinylDistortion(e.vinylDistortion, p.vinylDrive, p.vinylNoiseLevel, p.vinylTone, p.vinylMix)
  }
  if (e.resonator) {
    applyResonatorBank(e.resonator, p.resonatorFreq, p.resonatorChord, p.resonatorQ, p.resonatorMix)
  }
  if (e.eq7) applyEq7(e.eq7, p)
}

// Phase 23 Stream BD — eq7's node group: 7 Tone.Filter instances (HP, Low Shelf, 3 Bell/peaking,
// High Shelf, LP). Tone.Filter exposes every native BiquadFilterNode type (lowpass/highpass/
// lowshelf/highshelf/peaking/...) plus a selectable `rolloff` (-12/-24/-48/-96 dB/oct, implemented
// as N cascaded biquad sections) — exactly the "Tone.Filter covers HP/LP with selectable slope+Q;
// Web Audio's native BiquadFilterNode peaking/shelving types cover the bell/shelf bands" split
// research 17 flagged (docs/research/17-track-fx-arsenal.md §3) — Tone.Filter turns out to be a
// single primitive that covers BOTH halves (it's a thin wrapper around cascaded BiquadFilterNodes
// exposing every native type), so no raw AudioContext.createBiquadFilter() calls were needed after
// all. HP/LP get the real rolloff cascade (eq7HpSlope/eq7LpSlope, EQ7_ROLLOFF below); the 5 bell/
// shelf bands are always pinned to rolloff -12 (Tone.Filter's minimum, i.e. exactly ONE biquad
// section) — rolloff has no meaningful "slope" concept for a peaking/shelving filter (cascading N
// of them multiplies the gain N times rather than steepening anything; a real parametric EQ's
// bell/shelf bands don't have a slope control either).
//
// Each band is independently enabled (the 7 *On flags in SYNTH_FIELDS). Rather than a wet/dry
// illusion (no clean "neutral" HP/LP frequency exists that's a true no-op filter), a disabled band
// is spliced OUT of the internal chain entirely by reconcileEq7Bands below — the same "real
// bypass" discipline the whole-device `effect ... bypassed` token already uses (see
// reconcileEffectChain). Internal signal order is fixed, low-to-high: HP -> LowShelf -> Bell1 ->
// Bell2 -> Bell3 -> HighShelf -> LP, regardless of which bands are actually enabled — mirrors
// BeatSynth's eq7* field order in src/core/document.ts exactly.
interface EQ7Nodes {
  in: Tone.Gain
  hp: Tone.Filter
  lowShelf: Tone.Filter
  bell1: Tone.Filter
  bell2: Tone.Filter
  bell3: Tone.Filter
  highShelf: Tone.Filter
  lp: Tone.Filter
  out: Tone.Gain
  activeSig: string // last-wired "which bands are on" signature — internal rewiring only on change
}

const EQ7_ROLLOFF: Record<EqFilterSlope, -12 | -24 | -48 | -96> = { '12': -12, '24': -24, '48': -48, '96': -96 }

/** Build one fully-internally-wired eq7 node group (Phase 23 Stream BD). Callers connect an
 * upstream node to `.in` and take `.out` onward — internal band wiring is established by the
 * first applyEq7/reconcileEq7Bands call (activeSig starts at EFFECTS_SIG_UNSET, the same sentinel
 * pattern SynthChain.effectsSig uses, so that first call always wires something, even "nothing"). */
function buildEq7(): EQ7Nodes {
  const inN = new Tone.Gain(1)
  const hp = new Tone.Filter({ type: 'highpass', frequency: 80, Q: 0.707, rolloff: -24 })
  const lowShelf = new Tone.Filter({ type: 'lowshelf', frequency: 120, gain: 0, rolloff: -12 })
  const bell1 = new Tone.Filter({ type: 'peaking', frequency: 250, gain: 0, Q: 1, rolloff: -12 })
  const bell2 = new Tone.Filter({ type: 'peaking', frequency: 1000, gain: 0, Q: 1, rolloff: -12 })
  const bell3 = new Tone.Filter({ type: 'peaking', frequency: 4000, gain: 0, Q: 1, rolloff: -12 })
  const highShelf = new Tone.Filter({ type: 'highshelf', frequency: 8000, gain: 0, rolloff: -12 })
  const lp = new Tone.Filter({ type: 'lowpass', frequency: 12000, Q: 0.707, rolloff: -24 })
  const out = new Tone.Gain()
  return { in: inN, hp, lowShelf, bell1, bell2, bell3, highShelf, lp, out, activeSig: EFFECTS_SIG_UNSET }
}

/** Splices the enabled bands, in fixed low-to-high order, between `.in` and `.out` — a disabled
 * band is fully out of the graph (a true bypass; see EQ7Nodes' doc comment above), not merely at a
 * neutral value. Only re-wires when the ON/OFF combination actually changed since the last call
 * (cheap signature compare), the same discipline reconcileEffectChain uses one level up. */
function reconcileEq7Bands(nodes: EQ7Nodes, p: EngineSynth): void {
  const bands: { on: boolean; node: Tone.Filter }[] = [
    { on: p.eq7HpOn, node: nodes.hp },
    { on: p.eq7LowShelfOn, node: nodes.lowShelf },
    { on: p.eq7Bell1On, node: nodes.bell1 },
    { on: p.eq7Bell2On, node: nodes.bell2 },
    { on: p.eq7Bell3On, node: nodes.bell3 },
    { on: p.eq7HighShelfOn, node: nodes.highShelf },
    { on: p.eq7LpOn, node: nodes.lp },
  ]
  const sig = bands.map((b) => (b.on ? '1' : '0')).join('')
  if (sig === nodes.activeSig) return
  nodes.in.disconnect()
  for (const b of bands) b.node.disconnect()
  let upstream: Tone.ToneAudioNode = nodes.in
  for (const b of bands) {
    if (!b.on) continue
    upstream.connect(b.node)
    upstream = b.node
  }
  upstream.connect(nodes.out)
  nodes.activeSig = sig
}

/** Apply live params to an eq7 node group — always keeps every band's freq/Q/gain/slope current
 * (even a disabled one), so re-enabling it never "jumps"; reconcileEq7Bands (called last) is what
 * actually gates whether a band's processing is heard, same "params stay live, the flag/route
 * gates audibility" split every other insert in this file follows. */
function applyEq7(nodes: EQ7Nodes, p: EngineSynth): void {
  nodes.hp.frequency.value = p.eq7HpFreq
  nodes.hp.Q.value = p.eq7HpQ
  nodes.hp.rolloff = EQ7_ROLLOFF[p.eq7HpSlope]
  nodes.lowShelf.frequency.value = p.eq7LowShelfFreq
  nodes.lowShelf.gain.value = p.eq7LowShelfGain
  nodes.bell1.frequency.value = p.eq7Bell1Freq
  nodes.bell1.gain.value = p.eq7Bell1Gain
  nodes.bell1.Q.value = p.eq7Bell1Q
  nodes.bell2.frequency.value = p.eq7Bell2Freq
  nodes.bell2.gain.value = p.eq7Bell2Gain
  nodes.bell2.Q.value = p.eq7Bell2Q
  nodes.bell3.frequency.value = p.eq7Bell3Freq
  nodes.bell3.gain.value = p.eq7Bell3Gain
  nodes.bell3.Q.value = p.eq7Bell3Q
  nodes.highShelf.frequency.value = p.eq7HighShelfFreq
  nodes.highShelf.gain.value = p.eq7HighShelfGain
  nodes.lp.frequency.value = p.eq7LpFreq
  nodes.lp.Q.value = p.eq7LpQ
  nodes.lp.rolloff = EQ7_ROLLOFF[p.eq7LpSlope]
  reconcileEq7Bands(nodes, p)
}

/** Every node in an eq7 group, for disposeChain()'s flat node list (via EffectRuntime.nodes). */
function eq7NodeList(e: EQ7Nodes): Tone.ToneAudioNode[] {
  return [e.in, e.hp, e.lowShelf, e.bell1, e.bell2, e.bell3, e.highShelf, e.lp, e.out]
}

// Phase 22 Stream AC — Beat Repeat's chance roll: a PER-NOTE-POSITION-SEEDED RNG, not a global
// stream (docs/research/21-opendaw-devices-effects.md row 5, "Velocity device's random-seed +
// note position reseed pattern"). The seed is a pure hash of (track id, repeat step, item id) —
// no persisted RNG state, no document-level seed field needed — so the SAME document always rolls
// the SAME outcome at the SAME repeat: re-rendering is bit-for-bit reproducible, matching
// dotbeat's diff/determinism goals. FNV-1a string hash feeding one mulberry32-style mix step.
function seededRoll(trackId: string, step: number, itemId: string): number {
  const s = `${trackId}:${step}:${itemId}`
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h >>>= 0
  h = Math.imul(h ^ (h >>> 15), h | 1)
  h ^= h + Math.imul(h ^ (h >>> 7), h | 61)
  return ((h ^ (h >>> 14)) >>> 0) / 4294967296
}

// Phase 22 Stream AC — Saturator curve authoring (research 17 §5.4): each SaturatorCurve maps to
// a small closed-form waveshaping function, sampled once into a Float32Array PER CURVE-TYPE
// CHANGE (cached on the chain — see chain.saturator.lastCurve in applyParams), never per sample.
// `analog`/`warm` are tanh-based soft clips (warm is asymmetric — a softer negative half biases
// toward even harmonics, the classic "tube warmth" move); `clip` is a hard 3-segment clip (strong
// odd harmonics, a more "digital" bite); `fold` is a sin()-based wavefolder (wraps rather than
// clips, producing inharmonic-ish fold-back content as drive increases).
const SATURATOR_CURVE_SIZE = 1024
function buildSaturatorCurve(kind: SaturatorCurve): Float32Array {
  const n = SATURATOR_CURVE_SIZE
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1 // -1..1
    let y: number
    switch (kind) {
      case 'warm':
        y = x >= 0 ? Math.tanh(x * 2) : Math.tanh(x * 1.4) * 0.9
        break
      case 'clip':
        y = Math.max(-1, Math.min(1, x * 3))
        break
      case 'fold':
        y = Math.sin(x * Math.PI * 1.5)
        break
      case 'analog':
      default:
        y = Math.tanh(x * 3)
    }
    curve[i] = y
  }
  return curve
}

// Phase 22 Stream AC — Ping Pong Delay's node group (research 17 §5.1 + research 21 row 4: a
// continuously-variable cross-feedback control and a delay-time LFO wobble, not a plain
// Tone.PingPongDelay — that built-in class hardwires 100% L<->R cross-feedback with no dial, per
// its StereoXFeedbackEffect base). Built from primitives (two Tone.Delay lines + four feedback
// Gains + a wobble LFO) rather than the built-in class so pingPongCrossFeed and the wobble fields
// have somewhere real to land. Input taps delayL only (the classic ping-pong topology: the first
// echo is always on the left); delayR only ever receives signal via cross-feedback from delayL,
// so pingPongCrossFeed=0 (no bleed) leaves the right channel silent — the deliberate, documented
// behavior of "how much L/R bleed," not a bug (see applyParams). The wobble LFO OWNS both delay
// times entirely (see buildPingPong: delayTime's own .value is left at 0, never touched again) —
// Tone Param connections are additive, so a non-zero base value plus an LFO output would double
// up; driving the LFO's min/max directly (equal min/max = a static, non-wobbling delay time) is
// the correct way to make this one control cover both the static and wobbling cases.
interface PingPongNodes {
  in: Tone.Gain
  delayL: Tone.Delay
  delayR: Tone.Delay
  feedLL: Tone.Gain // delayL self-feedback (bleed=0 share)
  feedLR: Tone.Gain // delayL -> delayR cross-feedback (bleed=1 share)
  feedRR: Tone.Gain // delayR self-feedback
  feedRL: Tone.Gain // delayR -> delayL cross-feedback
  panL: Tone.Panner
  panR: Tone.Panner
  wobble: Tone.LFO
  dry: Tone.Gain
  wet: Tone.Gain
  out: Tone.Gain
}

// Phase 22 Stream AC — Saturator's node group (research 17 §5.4): a pre-gain (the `saturatorDrive`
// knob — how hard the signal hits the shaper) feeding a Tone.WaveShaper whose curve is authored by
// buildSaturatorCurve() above, plus the usual dry/wet pair (same compDry/compWet convention
// already used for the parallel compressor) so saturatorMix=0 is a true bypass regardless of
// drive/curve.
interface SaturatorNodes {
  in: Tone.Gain
  preGain: Tone.Gain
  shaper: Tone.WaveShaper
  dry: Tone.Gain
  wet: Tone.Gain
  out: Tone.Gain
  lastCurve: SaturatorCurve | null // cache: recompute the curve array only when the curve TYPE changes
}

/** Build one fully-internally-wired Saturator node group (Phase 22 Stream AC). Callers connect an
 * upstream node to `.in` and take `.out` onward — everything between is wired here once. */
function buildSaturator(): SaturatorNodes {
  const inN = new Tone.Gain(1)
  const preGain = new Tone.Gain(1)
  const shaper = new Tone.WaveShaper(buildSaturatorCurve('analog'))
  const dry = new Tone.Gain(1)
  const wet = new Tone.Gain(0)
  const out = new Tone.Gain()
  inN.connect(dry)
  inN.connect(preGain)
  preGain.connect(shaper)
  shaper.connect(wet)
  dry.connect(out)
  wet.connect(out)
  return { in: inN, preGain, shaper, dry, wet, out, lastCurve: 'analog' }
}

/** Build one fully-internally-wired Ping Pong Delay node group (Phase 22 Stream AC). Callers
 * connect an upstream node to `.in` and take `.out` onward. See PingPongNodes' doc comment for the
 * topology rationale (why this is hand-built from primitives rather than Tone.PingPongDelay). */
function buildPingPong(): PingPongNodes {
  const inN = new Tone.Gain(1)
  const delayL = new Tone.Delay(0, 1.6)
  const delayR = new Tone.Delay(0, 1.6)
  const feedLL = new Tone.Gain(0)
  const feedLR = new Tone.Gain(0)
  const feedRR = new Tone.Gain(0)
  const feedRL = new Tone.Gain(0)
  const panL = new Tone.Panner(-1)
  const panR = new Tone.Panner(1)
  const dry = new Tone.Gain(1)
  const wet = new Tone.Gain(0)
  const out = new Tone.Gain()
  // wobble LFO drives BOTH delay times' full value (min===max => static; min<max => wobbling) —
  // see PingPongNodes' doc comment for why the delayTime Params themselves are never touched.
  const wobble = new Tone.LFO(0.5, 0.19, 0.19).start()

  inN.connect(delayL)
  delayL.connect(panL)
  delayL.connect(feedLL)
  feedLL.connect(delayL)
  delayL.connect(feedLR)
  feedLR.connect(delayR)
  delayR.connect(panR)
  delayR.connect(feedRR)
  feedRR.connect(delayR)
  delayR.connect(feedRL)
  feedRL.connect(delayL)
  panL.connect(wet)
  panR.connect(wet)
  inN.connect(dry)
  dry.connect(out)
  wet.connect(out)
  wobble.connect(delayL.delayTime)
  wobble.connect(delayR.delayTime)

  return { in: inN, delayL, delayR, feedLL, feedLR, feedRR, feedRL, panL, panR, wobble, dry, wet, out }
}

/** Apply live params to a Saturator node group (shared by SynthChain and DrumBus). The curve
 * array is only rebuilt when `curve` actually changes type (cached via `.lastCurve`) — authored
 * once per curve CHANGE, never per sample, per research 17 §5.4. */
function applySaturator(nodes: SaturatorNodes, curve: SaturatorCurve, drive: number, mix: number): void {
  if (nodes.lastCurve !== curve) {
    nodes.shaper.curve = buildSaturatorCurve(curve)
    nodes.lastCurve = curve
  }
  nodes.preGain.gain.value = 1 + drive * 9
  nodes.dry.gain.value = 1 - mix
  nodes.wet.gain.value = mix
}

/** Apply live params to a Ping Pong Delay node group (shared by SynthChain and DrumBus).
 * crossFeed splits `feedback` between each delay's self-feedback and its cross-feedback into the
 * OTHER channel — 1 = classic full alternation (all energy crosses, matching Tone.PingPongDelay's
 * hardwired behavior), 0 = each channel's tail feeds only itself (no bleed; since only delayL is
 * ever fed from the input, delayR then never sounds at all — the honest result of "zero bleed",
 * not a bug). The wobble LFO's min/max are recomputed from the current time/depth every call — see
 * PingPongNodes' doc comment for why delayTime.value itself is never touched. */
function applyPingPong(nodes: PingPongNodes, time: number, feedback: number, crossFeed: number, wobbleRate: number, wobbleDepth: number, mix: number): void {
  const cross = Math.max(0, Math.min(1, crossFeed))
  nodes.feedLR.gain.value = feedback * cross
  nodes.feedLL.gain.value = feedback * (1 - cross)
  nodes.feedRL.gain.value = feedback * cross
  nodes.feedRR.gain.value = feedback * (1 - cross)
  const center = Math.max(0.001, Math.min(1.45, time))
  const wobbleFrac = 0.3 * Math.max(0, Math.min(1, wobbleDepth))
  const lo = Math.max(0.001, center * (1 - wobbleFrac))
  const hi = Math.min(1.5, center * (1 + wobbleFrac))
  nodes.wobble.min = lo
  nodes.wobble.max = hi
  nodes.wobble.frequency.value = Math.max(0.01, wobbleRate)
  nodes.dry.gain.value = 1 - mix
  nodes.wet.gain.value = mix
}

/** Every node in a Saturator/PingPong group, for disposeChain()'s flat node list. */
function saturatorNodeList(s: SaturatorNodes): Tone.ToneAudioNode[] {
  return [s.in, s.preGain, s.shaper, s.dry, s.wet, s.out]
}
function pingPongNodeList(pp: PingPongNodes): Tone.ToneAudioNode[] {
  return [pp.in, pp.delayL, pp.delayR, pp.feedLL, pp.feedLR, pp.feedRR, pp.feedRL, pp.panL, pp.panR, pp.wobble, pp.dry, pp.wet, pp.out]
}

// ============================================================================================
// Phase 23 Stream BF — the three "meaningfully bigger lift" effects research 17 §5 deferred past
// Stream AC's build-next-four: Grain Delay, Vinyl Distortion, Resonators. Unlike AC's saturator/
// chorus/phaser/pingPong (fixed, always-wired inserts — see SynthChain's own comment), these three
// are genuine EffectType chain members (document.ts's EffectType/EFFECT_TYPES): built lazily by
// buildEffectRuntime, one instance per declared `effect` line, spliced into the chain SPINE by
// reconcileEffectChain exactly like eq3/comp/distortion/bitcrush already are.

// ---- Grain Delay -----------------------------------------------------------------------------
// Research 17 §5's own suggested shape was "Tone.GrainPlayer + custom capture" — but GrainPlayer
// is fundamentally a BUFFER PLAYER (plays a pre-loaded AudioBuffer with granular controls), not an
// insert effect that grains its own LIVE input; adapting it into a real-time insert would need a
// rolling capture buffer with no Tone.js primitive to build it from (the same class of problem
// Beat Repeat sidesteps at the SCHEDULING layer in resolveBeatRepeat above — but Grain Delay's
// character lives in the AUDIO signal itself, not just note/hit retriggering, so that shortcut
// doesn't apply here). Tone.PitchShift is the more honest primitive: it implements a REAL granular
// pitch-shifting algorithm internally (overlapping delay-line grains with a `windowSize` the class
// exposes directly) — literally what a hardware/plugin "shimmer"/grain delay pedal does (a delay
// line + a granular pitch-shifter, often in the SAME feedback loop so every repeat is pitched
// again). This hand-builds that topology from primitives (Tone.Delay + Tone.Gain feedback +
// Tone.PitchShift), same "hand-built network, not a single dropped-in class" discipline Stream
// AC's ping-pong delay established, rather than either (a) a naive PitchShift-as-effect one-liner
// with no delay/feedback character at all, or (b) chasing GrainPlayer into live-buffer-capture
// territory research 17 explicitly flags as its own, bigger, AudioWorklet-tier problem (the same
// tier Corpus is scoped out of this stream for).
interface GrainDelayNodes {
  in: Tone.Gain
  delay: Tone.Delay
  pitchShift: Tone.PitchShift
  feedback: Tone.Gain
  dry: Tone.Gain
  wet: Tone.Gain
  out: Tone.Gain
}
function buildGrainDelay(): GrainDelayNodes {
  const inN = new Tone.Gain(1)
  const delay = new Tone.Delay(0.25, 2)
  const pitchShift = new Tone.PitchShift({ pitch: 0, windowSize: 0.1 })
  const feedback = new Tone.Gain(0)
  const dry = new Tone.Gain(1)
  const wet = new Tone.Gain(0)
  const out = new Tone.Gain()
  // Feedback loop: delay -> pitchShift -> feedback -> back into delay. Every pass back through
  // pitchShift both re-grains (windowSize's audible chopping/warble) AND re-pitches (grainDelay
  // Pitch semitones), so repeat N is pitched N * grainDelayPitch semitones from the original — the
  // classic ascending/descending "shimmer" grain-delay signature. The wet tap is AFTER pitchShift
  // (not after the raw delay), so even a single repeat (before any feedback) already carries the
  // granular/pitched character, not just a plain echo.
  inN.connect(delay)
  delay.connect(pitchShift)
  pitchShift.connect(feedback)
  feedback.connect(delay)
  pitchShift.connect(wet)
  inN.connect(dry)
  dry.connect(out)
  wet.connect(out)
  return { in: inN, delay, pitchShift, feedback, dry, wet, out }
}
/** Feedback is clamped to 0.92 (not 1) — a real, deliberate choice, not an oversight: Tone.
 * PitchShift's own grain algorithm adds a small amount of processing latency/artifact energy each
 * pass, so a feedback loop that's allowed to hit unity gain can very slowly build toward a runaway
 * hot signal over a long render (unlike Ping Pong Delay's plain delay-line feedback, which has no
 * such per-pass gain-adding side effect and can safely allow feedback up to 1 elsewhere in this
 * file). 0.92 still reads as "near-infinite" repeats musically while keeping every render stable. */
function applyGrainDelay(nodes: GrainDelayNodes, time: number, feedback: number, size: number, pitch: number, mix: number): void {
  nodes.delay.delayTime.value = Math.max(0.01, Math.min(2, time))
  nodes.feedback.gain.value = Math.max(0, Math.min(0.92, feedback))
  nodes.pitchShift.windowSize = Math.max(0.01, Math.min(1, size))
  nodes.pitchShift.pitch = pitch
  nodes.dry.gain.value = 1 - mix
  nodes.wet.gain.value = mix
}
function grainDelayNodeList(g: GrainDelayNodes): Tone.ToneAudioNode[] {
  return [g.in, g.delay, g.pitchShift, g.feedback, g.dry, g.wet, g.out]
}

// ---- Vinyl Distortion -------------------------------------------------------------------------
// Research 17 §5: "Tone.WaveShaper + Tone.Noise" for the harmonic-distortion half and the
// surface-noise half respectively. Built here from Tone.WaveShaper (an authored asymmetric
// tape/record-playback-style soft-clip curve, same "author once, apply per curve-type change"
// discipline as Saturator's buildSaturatorCurve) PLUS a hand-generated, SEEDED noise buffer rather
// than Tone.Noise directly — Tone.Noise's own internal buffer generation has no public seed API
// (it draws from Math.random() at construction), which would make every render of the SAME
// document sound different, breaking dotbeat's "the same document always renders the same audio"
// contract every other stochastic element in this file (seededRoll/chanceFires above) is built to
// honor. Instead: a short buffer of hiss + sparse crackle pops is generated ONCE per effect
// instance from a seed derived from (trackId, effect id) via makeNoiseStream below (a proper
// STREAMING mulberry32 generator, distinct from the one-shot mulberry32(seed)/hashSeed pair above
// which mix ONE value per call for per-event dice-rolls — bulk buffer fill needs many values in
// sequence from one seed), looped continuously through a Tone.Player. Reproducible: the same
// (trackId, id) always generates the identical noise buffer, every render.
interface VinylNodes {
  in: Tone.Gain
  preGain: Tone.Gain
  shaper: Tone.WaveShaper
  noisePlayer: Tone.Player
  noiseGain: Tone.Gain
  wetSum: Tone.Gain
  toneFilter: Tone.Filter
  dry: Tone.Gain
  wet: Tone.Gain
  out: Tone.Gain
}
/** A proper STREAMING mulberry32 PRNG (internal state advances across calls) — see VinylNodes'
 * doc comment for why this is a different shape from the one-shot mulberry32(seed) above. */
function makeNoiseStream(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const VINYL_NOISE_SECONDS = 3
/** Generates a mono, seeded surface-noise-and-crackle buffer: a gentle one-pole-lowpassed white
 * noise floor (softer/more "surface hiss"-like than raw white noise) plus sparse, seeded
 * high-amplitude crackle pops — real vinyl's two audible noise components in one buffer, one
 * `vinylNoiseLevel` knob controls both together via the downstream gain (see applyVinylDistortion).
 * Built once per effect instance (buildVinylDistortion), never regenerated per-tick. */
function buildVinylNoiseBuffer(seed: number): Tone.ToneAudioBuffer {
  const ctx = Tone.getContext().rawContext as unknown as AudioContext
  const sr = ctx.sampleRate
  const length = Math.max(1, Math.round(sr * VINYL_NOISE_SECONDS))
  const raw = ctx.createBuffer(1, length, sr)
  const data = raw.getChannelData(0)
  const rand = makeNoiseStream(seed)
  let lp = 0
  for (let i = 0; i < length; i++) {
    const white = rand() * 2 - 1
    lp += (white - lp) * 0.2
    let s = lp
    if (rand() < 0.0008) s += (rand() * 2 - 1) * (0.5 + rand() * 0.5) // sparse seeded crackle pop
    data[i] = Math.max(-1, Math.min(1, s))
  }
  return new Tone.ToneAudioBuffer(raw)
}
/** Authored once (curve never changes per-tick — Vinyl Distortion has one fixed curve, unlike
 * Saturator's curve-family enum): a mild asymmetric tanh soft-clip, the "worn tape/record
 * playback" character rather than a harsh digital clip. */
function buildVinylCurve(): Float32Array {
  const n = 1024
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = x >= 0 ? Math.tanh(x * 2.2) : Math.tanh(x * 1.6) * 0.85
  }
  return curve
}
function buildVinylDistortion(noiseSeed: number): VinylNodes {
  const inN = new Tone.Gain(1)
  const preGain = new Tone.Gain(1)
  const shaper = new Tone.WaveShaper(buildVinylCurve())
  const noisePlayer = new Tone.Player({ url: buildVinylNoiseBuffer(noiseSeed), loop: true })
  const noiseGain = new Tone.Gain(0)
  const wetSum = new Tone.Gain(1)
  const toneFilter = new Tone.Filter(8000, 'lowpass')
  const dry = new Tone.Gain(1)
  const wet = new Tone.Gain(0)
  const out = new Tone.Gain()
  inN.connect(preGain)
  preGain.connect(shaper)
  shaper.connect(wetSum)
  noisePlayer.connect(noiseGain)
  noiseGain.connect(wetSum)
  wetSum.connect(toneFilter)
  toneFilter.connect(wet)
  inN.connect(dry)
  dry.connect(out)
  wet.connect(out)
  noisePlayer.start() // continuous background bed, same "start once at build time" convention as pingPong's wobble LFO/chorus above
  return { in: inN, preGain, shaper, noisePlayer, noiseGain, wetSum, toneFilter, dry, wet, out }
}
function applyVinylDistortion(nodes: VinylNodes, drive: number, noiseLevel: number, tone: number, mix: number): void {
  nodes.preGain.gain.value = 1 + Math.max(0, Math.min(1, drive)) * 6
  // Headroom-capped at 0.35 so even noiseLevel=1 sits UNDER typical signal level, not overwhelms it
  // — a real added noise FLOOR, matching what "surface noise" means on an actual record.
  nodes.noiseGain.gain.value = Math.max(0, Math.min(1, noiseLevel)) * 0.35
  const t = Math.max(0, Math.min(1, tone))
  nodes.toneFilter.frequency.value = 800 + t * 11000 // 0 = dull/muffled, 1 = brighter/more open
  nodes.dry.gain.value = 1 - mix
  nodes.wet.gain.value = mix
}
function vinylNodeList(v: VinylNodes): Tone.ToneAudioNode[] {
  return [v.in, v.preGain, v.shaper, v.noisePlayer, v.noiseGain, v.wetSum, v.toneFilter, v.dry, v.wet, v.out]
}

// ---- Resonators -------------------------------------------------------------------------------
// Research 17 §5: "a bank of up to 5 Tone.Filter (bandpass) nodes tuned to pitched frequencies" —
// no dedicated Tone.js class exists (that's Corpus-tier, explicitly out of this stream's scope),
// but a parallel bank of narrow bandpass filters is a reasonable, honestly-approximate physical-
// resonance model: each filter rings at its own tuned frequency when excited by a broadband
// transient, and Q sets how narrow (= how long-ringing) that resonance is — the closest thing a
// plain biquad filter bank has to a physical resonator's own decay time.
interface ResonatorNodes {
  in: Tone.Gain
  filters: Tone.Filter[] // 5 parallel bandpass filters, tuned by applyResonatorBank
  sum: Tone.Gain
  dry: Tone.Gain
  wet: Tone.Gain
  out: Tone.Gain
}
const RESONATOR_BANK_SIZE = 5
function buildResonatorBank(): ResonatorNodes {
  const inN = new Tone.Gain(1)
  const filters = Array.from({ length: RESONATOR_BANK_SIZE }, () => new Tone.Filter({ type: 'bandpass', frequency: 220, Q: 20 }))
  const sum = new Tone.Gain(1)
  const dry = new Tone.Gain(1)
  const wet = new Tone.Gain(0)
  const out = new Tone.Gain()
  for (const f of filters) {
    inN.connect(f)
    f.connect(sum)
  }
  sum.connect(wet)
  inN.connect(dry)
  dry.connect(out)
  wet.connect(out)
  return { in: inN, filters, sum, dry, wet, out }
}
function applyResonatorBank(nodes: ResonatorNodes, freq: number, chord: ResonatorChord, q: number, mix: number): void {
  const offsets = RESONATOR_CHORD_OFFSETS[chord]
  const nyquistSafe = Tone.getContext().sampleRate / 2 - 200
  const root = Math.max(20, freq)
  const clampedQ = Math.max(0.5, Math.min(200, q))
  for (let i = 0; i < nodes.filters.length; i++) {
    const semis = offsets[i] ?? offsets[offsets.length - 1] ?? 0
    const f = Math.max(40, Math.min(nyquistSafe, root * Math.pow(2, semis / 12)))
    nodes.filters[i]!.frequency.value = f
    nodes.filters[i]!.Q.value = clampedQ
  }
  nodes.dry.gain.value = 1 - mix
  nodes.wet.gain.value = mix
}
function resonatorNodeList(r: ResonatorNodes): Tone.ToneAudioNode[] {
  return [r.in, ...r.filters, r.sum, r.dry, r.wet, r.out]
}

// Phase 22 Stream AC — Beat Repeat (research 17 §5.2 + §4.3): scheduling-layer stutter, NOT a
// Tone.js audio node. dotbeat already knows every note/hit ahead of the audio callback (it's a
// fully sequenced engine, not a live-input processor), so "repeat the last captured slice" is
// literal note/hit re-scheduling inside tick(), not live buffer-capture DSP.
//
// Design decisions the format sketch left open (documented here, not guessed silently):
//   - GATE WINDOW placement: once per BAR, as the LAST beatRepeatGate 16th-steps of the bar — the
//     classic "stutter/fill into the next bar" placement Beat Repeat is reached for in practice.
//   - REPEAT CADENCE: fires on ABSOLUTE grid-aligned 16th-step boundaries (contentStep % grid ===
//     0) while the gate window is active — Grid is a fixed clock division, not relative to when
//     the gate happens to start, so it doesn't always land exactly on the window's first step.
//   - GRID ROUNDING: tick() itself only runs once per 16th-step (Tone's scheduleRepeat('16n', 0)
//     in play()), so repeats can never fire faster than that regardless of beatRepeatGrid — grid
//     values below 1 (e.g. 0.5 for a 32nd-note slice) still shrink the CAPTURED slice's size (and
//     therefore how tightly-packed the repeated content is) but the repeat TRIGGER cadence itself
//     floors to whole 16th-steps, same quantization every other note trigger in tick() already
//     uses (`Math.floor(n.start) === contentStep`).
//   - CAPTURE: the repeated slice is grabbed ONCE per gate-window engagement (immediately
//     preceding the window, `sliceStart = gateStart - grid`) and held for every repeat within that
//     window — matching real Beat Repeat's "capture on engage, then loop that buffer" behavior,
//     not a fresh capture per repeat.
//   - Ableton's own no-op rule carries over unchanged: Gate < Grid disables the effect entirely.
interface BeatRepeatState {
  engaged: boolean
  active: boolean // this contentStep falls inside an active gate window
  suppressOriginal: boolean // per beatRepeatMode: should the NORMAL note/hit at this step be muted?
  repeatNow: boolean // this contentStep is a grid-aligned repeat trigger inside an active window
  sliceStart: number // captured grid-sized slice's start (immediately before the gate engaged)
  grid: number // effective grid size in 16th-steps, floored to >= 1 (see GRID ROUNDING above)
}
function resolveBeatRepeat(p: { beatRepeatGrid: number; beatRepeatGate: number; beatRepeatMode: BeatRepeatMode }, contentStep: number): BeatRepeatState {
  const grid = Math.max(1, Math.round(p.beatRepeatGrid))
  const engaged = p.beatRepeatGate > 0 && p.beatRepeatGate >= p.beatRepeatGrid // Ableton's no-op rule
  if (!engaged) return { engaged: false, active: false, suppressOriginal: false, repeatNow: false, sliceStart: 0, grid }
  const bar = Math.floor(contentStep / 16)
  const gateLen = Math.min(16, Math.round(p.beatRepeatGate))
  const gateStart = bar * 16 + (16 - gateLen)
  const active = contentStep >= gateStart
  const sliceStart = gateStart - grid
  const repeatNow = active && contentStep % grid === 0
  // 'gate': original NEVER passes, engaged or not — an intentional, extreme mode (matches
  // Ableton's Gate mode exactly: "only repeats ever play, original never passes"). 'insert':
  // original muted only while a repeat is active. 'mix': original always passes; repeats layer on.
  const suppressOriginal = p.beatRepeatMode === 'gate' || (p.beatRepeatMode === 'insert' && active)
  return { engaged, active, suppressOriginal, repeatNow, sliceStart, grid }
}

// ---- v0.10 note-scheduling additions (Phase 22 Stream AD) — hand-mirrored from src/core (groove.
// ts, chance.ts, pitchtime.ts's ratchetSlots) per the same "ui/ has no build-time dependency on
// src/core" convention as lfoSyncRateHz/LFO_DESTS above. Keep these three in sync with core BY
// INSPECTION if the math ever changes; core's own test suite (test/groove.test.ts,
// test/chance.test.ts, test/pitchtime.test.ts) is the source of truth for the math itself. ------

/** Groove/shuffle warp — mirrors src/core/groove.ts's moebiusEase/warpStep exactly. Applied to a
 * note/hit's `start` at SCHEDULING time only (never written back to the document): the format's
 * shuffleAmount/shuffleGrid fields are a reversible playback property, not stored timing. */
function moebiusEase(x: number, h: number): number {
  if (h <= 0 || h >= 1) return x
  return (x * h) / ((2 * h - 1) * (x - 1) + h)
}
function shuffleH(amount: number): number {
  const a = Math.max(0, Math.min(1, amount))
  return Math.min(0.5 + a / 2, 0.999)
}
function warpStep(step: number, amount: number, grid: number): number {
  if (!(amount > 0) || !(grid > 0)) return step
  const cell = grid * 2
  const cellIndex = Math.floor(step / cell)
  const x = (step - cellIndex * cell) / cell
  return cellIndex * cell + moebiusEase(x, shuffleH(amount)) * cell
}

/** Per-note trigger probability — mirrors src/core/chance.ts's chanceFires exactly (mulberry32 +
 * an FNV-1a seed fold over (pass, trackId, noteId)). `pass` is a per-loop-cycle counter the
 * scheduler advances once per traversal (computeLoopPass, below) so the SAME note re-rolls
 * independently every time the loop comes back around — "re-rolled per playback pass," not baked
 * once — while staying reproducible for the exact same (pass, track, note) triple. */
function mulberry32(seed: number): number {
  let a = seed >>> 0
  a |= 0
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261
  for (const part of parts) {
    const s = String(part)
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    h ^= 0x1f
  }
  return h >>> 0
}
function chanceFires(chance: number, pass: number, trackId: string, noteId: string): boolean {
  if (chance >= 100) return true
  if (chance <= 0) return false
  return mulberry32(hashSeed(pass, trackId, noteId)) * 100 < chance
}

/** Ratchet repeat slots — mirrors src/core/pitchtime.ts's ratchetSlots exactly (the SAME shape
 * consolidateRatchet uses, so live playback of a ratcheted note sounds like what Consolidate would
 * bake it into). count<=1 is a single full-length "slot" (no ratchet — the common case). */
function ratchetSlots(count: number, curve: number, repeatLength: number, noteDuration: number): { start: number; duration: number }[] {
  if (count <= 1) return [{ start: 0, duration: noteDuration }]
  const k = curve >= 0 ? 1 + curve * 3 : 1 / (1 - curve * 3)
  const edges: number[] = []
  for (let i = 0; i <= count; i++) edges.push(Math.pow(i / count, k) * noteDuration)
  const slots: { start: number; duration: number }[] = []
  for (let i = 0; i < count; i++) {
    const slotStart = edges[i]!
    const slotSpan = edges[i + 1]! - slotStart
    slots.push({ start: slotStart, duration: Math.max(0.001, slotSpan * repeatLength) })
  }
  return slots
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
  // Phase 22 Stream AA: the ordered, reorderable effect chain, keyed by stable effect id — a
  // reorder/add/remove/bypass in the document reconciles here (reconcileEffectChain) rather than
  // through hardcoded fields. `effectOrder` is the live chain order (ids); `effectsSig` is
  // the last-wired signature (id:type:enabled joined) so param-only ticks skip re-wiring. Covers
  // the TWELVE effect types the format grammar declares (`EffectType` in document.ts:
  // eq3/comp/distortion/bitcrush, plus Phase 23 Stream BD's eq7, Stream BE's autoFilter/autoPan/
  // tremolo/utility, and Stream BF's grainDelay/vinylDistortion/resonator) — the only ones a
  // `.beat` file can list/reorder today.
  effects: Map<string, EffectRuntime>
  effectOrder: string[]
  effectsSig: string
  // Phase 22 Stream AC: saturator -> chorus -> phaser -> pingPong, inserted after the reorderable
  // chain's exit and before muteGain (research 17 §5's build order). Fixed inserts, NOT part of
  // the reorderable `effects` list above (this is the shape Stream BE deliberately did NOT repeat
  // for its own four new types — see EffectRuntime/buildEffectRuntime above, which DID extend
  // EffectType/the reorderable list instead), and they're wired identically on DrumBus below,
  // which has no reorderable-list concept at all (v0.10's `effects` field is synth-tracks-only,
  // format-spec.md's serialize note). Scoping them as fixed-after-the-list keeps synth and drum
  // tracks consistent rather than fixing this asymmetry only on one track kind.
  saturator: SaturatorNodes
  chorus: Tone.Chorus
  phaser: Tone.Phaser
  pingPong: PingPongNodes
  // muteGain sits BEFORE the panner fan-out, so gating it to 0 silences both the dry path
  // (panner->vol->master) AND the reverb/delay sends (panner->*Send->return bus) — a mute that
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
  lastOsc: OscType | null
}

/** Finds the live effect runtime of a given TYPE in a chain (used by LFO/clip-automation
 * destinations, which target eqLow/compMix/distortionMix/bitcrushMix — type-addressed params, same
 * as before this stream). Returns undefined if no instance of that type is currently in the
 * track's declared chain (removed entirely) — callers treat that as a silent no-op, which is
 * correct: there is nothing to modulate. Does NOT check `enabled` — a bypassed effect's params
 * still update/ramp (so re-enabling it doesn't jump), it's just not wired into the audio path. */
function findEffect(chain: SynthChain, type: EffectType): EffectRuntime | undefined {
  for (const e of chain.effects.values()) if (e.type === type) return e
  return undefined
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
  saturator: SaturatorNodes
  chorus: Tone.Chorus
  phaser: Tone.Phaser
  pingPong: PingPongNodes
  muteGain: Tone.Gain // gate before the panner fan-out (see SynthChain.muteGain)
  levelTap: Tone.Analyser // post-fader waveform tap for the drums track's channel strip (see SynthChain.levelTap)
  panner: Tone.Panner
  vol: Tone.Volume
  reverbSend: Tone.Gain
  delaySend: Tone.Gain
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

// ---- Phase 22 Stream AB: the open per-track drum lane model (research 19/20) ---------------
// A drum track whose `lanes` list is non-empty (declared mode) is driven by a lane-name ->
// LaneVoice dispatch table built from that list, instead of the hardcoded DrumKit struct above.
// The legacy DrumKit/triggerDrum switch path is left COMPLETELY UNTOUCHED for a track with an
// empty `lanes` list (the implicit 5 DRUM_LANES) — this is deliberate, not laziness: research 20's
// verification bar is "an old 5-lane file still plays identically before/after," which is
// trivially true when the code path it exercises literally didn't change.

interface SynthLaneVoice {
  kind: 'synth'
  voiceType: DrumVoiceType
  node: Tone.MembraneSynth | Tone.NoiseSynth | Tone.MetalSynth
  // noise voices only: a quiet tonal "shell" layer blended in by the `tone` param — the same idea
  // as the legacy kit's snareTone/snareToneGain (a MembraneSynth blended under the noise voice).
  toneLayer?: { synth: Tone.MembraneSynth; gain: Tone.Gain }
  params: Record<string, number> // explicit overrides only (elided-default convention, like the format)
}
interface SampleLaneVoice {
  kind: 'sample'
  sample: string // media id this lane is currently TARGETING (may be mid-load)
  loadedSample: string | null // media id currently loaded into `player`
  gainDb: number
  tune: number // semitones -> Tone.Player.playbackRate
  gain: Tone.Gain
  player: Tone.Player | null
}
interface SfLaneVoice {
  kind: 'sf'
  sample: string
  program: number
  note: number // GM MIDI note this lane triggers on the shared drum-channel WorkletSynthesizer
}
type LaneVoice = SynthLaneVoice | SampleLaneVoice | SfLaneVoice

const DRUM_CHANNEL = 9 // GM channel 10 (0-indexed) — research 19 Part IV/V.2, distinct from the
// instrument-track path's hardcoded channel 0.

/** Resolved playable content for one track this tick (loop vs. song mode). contentStep is the step
 * WITHIN that content (absolute in loop mode; section-relative, cycling every loopBars in song mode
 * — or, Phase 24 Stream CJ, cycling within the active clip's own `loop` range when it has one,
 * clip-local bars overriding the document-wide loopBars just for that clip's tiling). In song mode a
 * track unmapped by the active scene is silent (contentOf returns null). */
interface Content {
  notes: BeatNote[]
  hits: BeatDrumHit[]
  automation: Map<string, { time: number; value: number }[]>
  contentStep: number
  // Phase 24 Stream CJ: the step contentStep WRAPS BACK TO at the start of each tiling pass — 0
  // except when a clip's own `loop` override has a non-zero `start` (in which case the cycle starts
  // at loop.start*16, not 0). The audio-region retrigger check below reads this instead of a
  // hardcoded 0 so a clip-loop-shifted audio region still retriggers on schedule.
  cycleStart: number
  // Phase 22 Stream AE: the active audio-region clip's content, only ever non-null for 'audio'-
  // kind tracks in song mode (audio-region clips have no live/non-clip form this stream — see
  // docs/phase-22-stream-ae.md — so loop mode and every other track kind always gets null here).
  audio: BeatAudioRegion | null
}

/** One live instrument (SoundFont) track. `synth` is a spessasynth_lib WorkletSynthesizer running
 * on Tone's raw AudioContext; its output feeds `entry` (a native passthrough) → `muteGain` → `vol`
 * → `pan` → master. `sample`/`program` are the currently-loaded values, so syncInstruments() can
 * tell a cheap programChange from a full soundbank reload.
 * `muteGain` gates mute/solo (Phase 16 Stream K), same dedicated-gate discipline as
 * SynthChain.muteGain/DrumBus.muteGain — a separate node so it never fights the volume value.
 * `levelTap` is the post-fader side-tap (off `pan`, the last node before master) that
 * getTrackLevel() reads for this track's mixer meter, mirroring SynthChain.levelTap/
 * DrumBus.levelTap exactly (a waveform Analyser read as true RMS, not a decaying Tone.Meter). */
interface InstrumentVoice {
  synth: WorkletSynthesizer
  entry: GainNode
  muteGain: Tone.Gain
  vol: Tone.Volume
  pan: Tone.Panner
  levelTap: Tone.Analyser
  sample: string
  program: number
}

/** Phase 22 Stream AE: one live audio-region-clip track. `player` is a shared, reused Tone.Player
 * — its `.buffer` is swapped (not rebuilt) when the currently-active clip references different
 * media, and `.playbackRate`/`.volume` are set per-trigger from the active BeatAudioRegion (repitch
 * rate, static gain + gain-automation ramps). `player` → `muteGain` → master, the same dedicated-
 * gate discipline as SynthChain/DrumBus/InstrumentVoice so mute/solo never fights the region's own
 * gain value. No separate track-level volume/pan this stream (documented gap, see
 * docs/phase-22-stream-ae.md) — a clip's own `gainDb` is the only level control. */
interface AudioTrackVoice {
  player: Tone.Player
  muteGain: Tone.Gain
  levelTap: Tone.Analyser
}

class Engine {
  private chains = new Map<string, SynthChain>()
  private drums: DrumKit | null = null
  private drumTrackId: string | null = null
  private kickTuneHz = 32.7
  private repeatId: number | null = null
  private started = false
  private lastLaneTriggerTime: Record<string, number> = {}

  // Phase 22 Stream AB: declared-lane dispatch state (see the LaneVoice types above). Live only
  // while the drums track has a non-empty `lanes` list; the legacy `drums`/`kickTuneHz` fields
  // above stay untouched and are what's used otherwise.
  private drumDeclaredMode = false
  private drumLanes = new Map<string, LaneVoice>()
  private drumSfVoice: { synth: WorkletSynthesizer; entry: GainNode; sample: string; program: number } | null = null
  private drumSfPending = false
  private drumSamplePending = new Set<string>()

  // Instrument (SoundFont) tracks. `instruments` holds READY voices; `instrumentPending` guards
  // the async build (fetch soundfont + addSoundBank + isReady) so sync() — called every tick —
  // never kicks off a second load for the same track while the first is in flight.
  private instruments = new Map<string, InstrumentVoice>()
  private instrumentPending = new Set<string>()
  private workletModulePromise: Promise<void> | null = null

  // Phase 22 Stream AE: audio-region-clip tracks. `audioTracks` holds one voice per 'audio'-kind
  // track (built lazily, like `instruments`); `audioBuffers` is a CONTENT-ADDRESSED decode cache
  // keyed by media id — shared across every track/clip that references the same sample, matching
  // the format's own content-addressed `media/` block. `audioBufferPending` guards the async
  // fetch+decode the same way `instrumentPending` guards a soundfont load.
  private audioTracks = new Map<string, AudioTrackVoice>()
  private audioBuffers = new Map<string, Tone.ToneAudioBuffer>()
  private audioBufferPending = new Set<string>()
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
  // Phase 22 Stream AC retired the third shared bus this used to build here (chorusBus/phaserBus,
  // reachable only via the generic project-global `sendMod` field) — Chorus-Ensemble and
  // Phaser-Flanger are now real per-track inserts (see buildSynthChain()/getDrumBus()), consistent
  // with every other configurable effect in dotbeat (EQ3, compressor, distortion, bitcrush all
  // already live one-instance-per-track — research 17 §4.2). reverb/delay stay shared sends.
  private getBuses() {
    if (!this.reverbBus) {
      this.reverbBus = new Tone.Reverb({ decay: 2.2, wet: 1 }).connect(this.getMaster())
      this.delayBus = new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.3, wet: 1 }).connect(this.getMaster())
    }
    return { reverb: this.reverbBus, delay: this.delayBus! }
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
    saturator: SaturatorNodes,
  ) {
    filter.connect(eq3)
    eq3.connect(compIn)
    compOut.connect(distortion)
    distortion.connect(bitcrush)
    bitcrush.connect(saturator.in)
  }

  /** Wire saturator -> chorus -> phaser -> pingPong -> nextStage (Phase 22 Stream AC's four new
   * inserts, in the fixed order research 17 §5 builds them — shared by buildSynthChain() and
   * getDrumBus() so the two chains never drift). */
  private wireFxTail(saturator: SaturatorNodes, chorus: Tone.Chorus, phaser: Tone.Phaser, pingPong: PingPongNodes, nextStage: Tone.ToneAudioNode) {
    saturator.out.connect(chorus)
    chorus.connect(phaser)
    phaser.connect(pingPong.in)
    pingPong.out.connect(nextStage)
  }

  private getDrumBus(): DrumBus {
    if (!this.drumBus) {
      const { reverb, delay } = this.getBuses()
      const filter = new Tone.Filter(12000, 'lowpass')
      const eq3 = new Tone.EQ3()
      const compIn = new Tone.Gain()
      const compDry = new Tone.Gain(1)
      const compressor = new Tone.Compressor()
      const compWet = new Tone.Gain(0)
      const compOut = new Tone.Gain()
      const distortion = new Tone.Distortion({ distortion: 0, wet: 0 })
      const bitcrush = new Tone.BitCrusher(8)
      const saturator = buildSaturator()
      const chorus = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.7, wet: 0 }).start()
      const phaser = new Tone.Phaser({ frequency: 0.5, octaves: 3, baseFrequency: 1000, wet: 0 })
      const pingPong = buildPingPong()
      const muteGain = new Tone.Gain(1)
      const levelTap = new Tone.Analyser('waveform', 256)
      const panner = new Tone.Panner({ pan: 0, channelCount: 2 })
      const vol = new Tone.Volume(0)
      const reverbSend = new Tone.Gain(0)
      const delaySend = new Tone.Gain(0)

      compIn.fan(compDry, compressor)
      compressor.connect(compWet)
      compDry.connect(compOut)
      compWet.connect(compOut)
      // ...bitcrush -> saturator -> chorus -> phaser -> pingPong -> muteGain -> panner: the mute
      // gate is upstream of the fan-out so it catches the sends too.
      this.wireInsertChain(filter, eq3, compIn, compOut, distortion, bitcrush, saturator)
      this.wireFxTail(saturator, chorus, phaser, pingPong, muteGain)
      muteGain.connect(panner)

      panner.chain(vol, this.getMaster())
      vol.connect(levelTap) // post-fader side-tap (not in the audible path)
      panner.connect(reverbSend)
      reverbSend.connect(reverb)
      panner.connect(delaySend)
      delaySend.connect(delay)

      this.drumBus = { filter, eq3, compIn, compDry, compressor, compWet, compOut, distortion, bitcrush, saturator, chorus, phaser, pingPong, muteGain, levelTap, panner, vol, reverbSend, delaySend }
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
    applySaturator(bus.saturator, p.saturatorCurve, p.saturatorDrive, p.saturatorMix)
    // chorusMode 'off' forces wet=0 regardless of chorusMix (mirrors the *Mix=0-bypasses
    // convention every other insert follows); 'vibrato' forces wet=1 fixed, no dry blend —
    // matches Ableton's Vibrato mode exactly (research 17 §5.3), so chorusMix has no audible
    // effect in that one mode, by design.
    bus.chorus.wet.value = p.chorusMode === 'off' ? 0 : p.chorusMode === 'vibrato' ? 1 : p.chorusMix
    bus.chorus.frequency.value = p.chorusRate
    bus.chorus.depth = p.chorusDepth
    bus.chorus.spread = p.chorusMode === 'ensemble' ? 180 : p.chorusMode === 'vibrato' ? 0 : 90
    bus.phaser.frequency.value = p.phaserRate
    bus.phaser.octaves = p.phaserDepth
    bus.phaser.wet.value = p.phaserMix
    applyPingPong(bus.pingPong, p.pingPongTime, p.pingPongFeedback, p.pingPongCrossFeed, p.pingPongWobbleRate, p.pingPongWobbleDepth, p.pingPongMix)
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

  // ---- Phase 22 Stream AB: declared-lane dispatch (research 19 Part VII step 5) ---------------

  private buildSynthLaneNode(voiceType: DrumVoiceType, busIn: Tone.InputNode): Tone.MembraneSynth | Tone.NoiseSynth | Tone.MetalSynth {
    // Reuses the exact same MembraneSynth/NoiseSynth/MetalSynth building blocks buildDrums() hand-
    // wires per lane above — the point of the dispatch table is that this is now parameterized and
    // data-driven (one constructor per voice TYPE, not per lane).
    if (voiceType === 'membrane') {
      return new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 7, envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.1 } }).connect(busIn)
    }
    if (voiceType === 'noise') {
      return new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.13, sustain: 0 } }).connect(busIn)
    }
    return new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.05, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5 }).connect(busIn)
  }

  /** A noise voice's optional tonal "shell" layer (the `tone` param) — the generalized form of the
   * legacy kit's snareTone/snareToneGain (a quiet MembraneSynth blended under the snare noise). */
  private buildNoiseToneLayer(busIn: Tone.InputNode): { synth: Tone.MembraneSynth; gain: Tone.Gain } {
    const gain = new Tone.Gain(0).connect(busIn)
    const synth = new Tone.MembraneSynth({ pitchDecay: 0.02, octaves: 4, envelope: { attack: 0.001, decay: 0.13, sustain: 0, release: 0.05 } }).connect(gain)
    return { synth, gain }
  }

  private applySynthLaneParams(voice: SynthLaneVoice): void {
    const defaults = DRUM_VOICE_PARAM_DEFAULTS[voice.voiceType]
    const p = voice.params
    const decay = p.decay ?? defaults.decay!
    if (voice.voiceType === 'membrane') {
      ;(voice.node as Tone.MembraneSynth).set({ pitchDecay: p.punch ?? defaults.punch, envelope: { decay } })
    } else if (voice.voiceType === 'noise') {
      ;(voice.node as Tone.NoiseSynth).set({ envelope: { decay } })
      if (voice.toneLayer) {
        voice.toneLayer.synth.set({ envelope: { decay } })
        voice.toneLayer.gain.gain.value = p.tone ?? defaults.tone ?? 0
      }
    } else {
      ;(voice.node as Tone.MetalSynth).set({ envelope: { decay }, resonance: p.tone ?? defaults.tone })
    }
  }

  private disposeLaneVoice(voice: LaneVoice): void {
    if (voice.kind === 'synth') {
      voice.node.dispose()
      if (voice.toneLayer) {
        voice.toneLayer.synth.dispose()
        voice.toneLayer.gain.dispose()
      }
    } else if (voice.kind === 'sample') {
      voice.player?.dispose()
      voice.gain.dispose()
    }
    // sf: nothing per-lane to dispose — the shared drumSfVoice is torn down separately.
  }

  /** (Re)loads a sample-backed lane's one-shot buffer — this is the deferred v0.5 live sample-lane
   * playback (`engine.ts`'s file-header "deliberately NOT ported" list used to include it) finally
   * landing, generalized to any declared lane rather than the closed 5. Fire-and-forget from
   * syncDeclaredDrumLanes(); best-effort like buildInstrument(). */
  private loadLaneSample(laneName: string, sampleId: string, mediaPath: string, voice: SampleLaneVoice): void {
    this.drumSamplePending.add(laneName)
    const old = voice.player
    const player = new Tone.Player({
      url: `${daemonBase()}/media/${mediaPath}`,
      onload: () => {
        this.drumSamplePending.delete(laneName)
      },
      onerror: (err: Error) => {
        console.warn(`[engine] drum lane "${laneName}" sample failed to load:`, err)
        this.drumSamplePending.delete(laneName)
      },
    }).connect(voice.gain)
    voice.player = player
    voice.loadedSample = sampleId
    if (old) old.dispose()
  }

  /** (Re)loads the ONE shared drum-channel WorkletSynthesizer every sf-backed lane on this track
   * triggers into (by GM note) — one voice per drum track, not one per lane, mirroring how a real
   * GM drum channel works (research 19 Part IV/V.2). Programs at DRUM_CHANNEL, not the instrument
   * path's hardcoded channel 0. */
  private async ensureDrumSfVoice(sampleId: string, program: number, mediaPath: string): Promise<void> {
    if (this.drumSfVoice && this.drumSfVoice.sample === sampleId) {
      if (this.drumSfVoice.program !== program) {
        this.drumSfVoice.synth.programChange(DRUM_CHANNEL, program)
        this.drumSfVoice.program = program
      }
      return
    }
    if (this.drumSfPending) return
    this.drumSfPending = true
    try {
      await this.ensureWorkletModule()
      const res = await fetch(`${daemonBase()}/media/${mediaPath}`)
      if (!res.ok) throw new Error(`fetch soundfont "${mediaPath}": HTTP ${res.status}`)
      const bytes = await res.arrayBuffer()
      const ctx = this.ensureNativeContext()
      const synth = new WorkletSynthesizer(ctx)
      await synth.soundBankManager.addSoundBank(bytes, 'main')
      await synth.isReady
      const entry = ctx.createGain()
      synth.connect(entry)
      Tone.connect(entry, this.getDrumBus().filter)
      synth.programChange(DRUM_CHANNEL, program)
      const previous = this.drumSfVoice
      this.drumSfVoice = { synth, entry, sample: sampleId, program }
      if (previous) {
        try {
          previous.synth.stopAll(true)
          previous.synth.disconnect()
          previous.synth.destroy()
        } catch {
          // best-effort teardown
        }
        previous.entry.disconnect()
      }
    } catch (err) {
      console.warn('[engine] drum sf voice failed to load:', err)
    } finally {
      this.drumSfPending = false
    }
  }

  /** Reconciles the live per-lane voice map with a drum track's declared `lanes` list: builds
   * synth voices from {voiceType, params}, kicks off sample loads, and ensures the shared sf
   * voice — the lane->backing dispatch table research 19 Part VII step 5 asked for. */
  private syncDeclaredDrumLanes(doc: BeatDocument, track: BeatTrack): void {
    const busIn = this.getDrumBus().filter
    const declared = new Set(track.lanes.map((l) => l.name))
    for (const [name, voice] of [...this.drumLanes]) {
      if (!declared.has(name)) {
        this.disposeLaneVoice(voice)
        this.drumLanes.delete(name)
      }
    }
    const media = doc.media as { id: string; path: string }[]
    let sfNeeded: { sample: string; program: number } | null = null
    for (const decl of track.lanes as BeatDrumLaneDecl[]) {
      const backing = decl.backing
      if (backing.type === 'synth') {
        let v = this.drumLanes.get(decl.name)
        if (!v || v.kind !== 'synth' || v.voiceType !== backing.voice) {
          if (v) this.disposeLaneVoice(v)
          const node = this.buildSynthLaneNode(backing.voice, busIn)
          const toneLayer = backing.voice === 'noise' ? this.buildNoiseToneLayer(busIn) : undefined
          v = { kind: 'synth', voiceType: backing.voice, node, toneLayer, params: {} }
          this.drumLanes.set(decl.name, v)
        }
        v.params = backing.params
        this.applySynthLaneParams(v)
      } else if (backing.type === 'sample') {
        let v = this.drumLanes.get(decl.name)
        if (!v || v.kind !== 'sample') {
          if (v) this.disposeLaneVoice(v)
          const gain = new Tone.Gain(1).connect(busIn)
          v = { kind: 'sample', sample: backing.sample, loadedSample: null, gainDb: backing.gainDb, tune: backing.tune, gain, player: null }
          this.drumLanes.set(decl.name, v)
        }
        v.gainDb = backing.gainDb
        v.tune = backing.tune
        v.gain.gain.value = Tone.dbToGain(backing.gainDb)
        if (v.loadedSample !== backing.sample && !this.drumSamplePending.has(decl.name)) {
          const m = media.find((x) => x.id === backing.sample)
          if (m) {
            v.sample = backing.sample
            this.loadLaneSample(decl.name, backing.sample, m.path, v)
          }
        }
      } else {
        // sf-backed
        this.drumLanes.set(decl.name, { kind: 'sf', sample: backing.sample, program: backing.program, note: backing.note })
        sfNeeded = { sample: backing.sample, program: backing.program }
      }
    }
    if (sfNeeded) {
      const m = media.find((x) => x.id === sfNeeded!.sample)
      if (m) void this.ensureDrumSfVoice(sfNeeded.sample, sfNeeded.program, m.path)
    }
  }

  /** Choke groups (research 19 Part V.1/research 20's "the 12-voice kit needs it"): silences
   * `laneName`'s currently-sounding voice at `time` — used so a closed-hat hit cuts off a ringing
   * open hat. Declared-lane mode only (see triggerDrum's file-header note on why the legacy path
   * is untouched); best-effort, since choking a voice that isn't currently sounding is a no-op
   * Tone.js tolerates via the try/catch (a release/stop on an idle voice can throw on some Tone.js
   * node types if scheduled at/before its last scheduled time). */
  private chokeDeclaredLane(laneName: string, time: number): void {
    const voice = this.drumLanes.get(laneName)
    if (!voice) return
    try {
      if (voice.kind === 'synth') voice.node.triggerRelease(time)
      else if (voice.kind === 'sample') voice.player?.stop(time)
      else if (voice.kind === 'sf' && this.drumSfVoice) this.drumSfVoice.synth.noteOff(DRUM_CHANNEL, voice.note, { time })
    } catch {
      // best-effort — see comment above
    }
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
    const { reverb, delay } = this.getBuses()
    const filter = new Tone.Filter(2000, 'lowpass')
    // channelCount 2 so the unison stack's stereo image (osc2Pan/osc3Pan/uniPairs) survives the
    // panner instead of being folded to mono.
    const panner = new Tone.Panner({ pan: 0, channelCount: 2 })
    const vol = new Tone.Volume(0)
    const reverbSend = new Tone.Gain(0)
    const delaySend = new Tone.Gain(0)

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

    // Phase 22 Stream AC: fixed inserts (not part of AA's reorderable `effects` list below — see
    // SynthChain's field comment for why).
    const saturator = buildSaturator()
    const chorus = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.7, wet: 0 }).start()
    const phaser = new Tone.Phaser({ frequency: 0.5, octaves: 3, baseFrequency: 1000, wet: 0 })
    const pingPong = buildPingPong()
    const muteGain = new Tone.Gain(1)
    const levelTap = new Tone.Analyser('waveform', 256)

    synth.connect(filter)
    osc2.chain(osc2Pan, osc2Gain, filter)
    osc3.chain(osc3Pan, osc3Gain, filter)
    for (const u of uniPairs) u.poly.chain(u.pan, u.gain, filter)
    sub.chain(subGain, filter)
    noise.chain(noiseGain, filter)
    fm.chain(fmGain, filter)

    // Phase 22 Stream AA: filter->...effects...->saturator is NOT wired here — reconcileEffectChain
    // (called from applyParams, below) owns that whole link, driven by the track's own declared,
    // ordered `effects` list. effectsSig starts at a sentinel no real signature can ever equal
    // (see the comment there), so the very first applyParams call always reconciles and makes the
    // filter->saturator connection, even for a track whose chain is explicitly empty. An unedited
    // track's first reconcile lands on the exact old fixed order (eq3->comp->distortion->bitcrush,
    // all enabled — defaultEffectChain's default), so a freshly built chain sounds identical to
    // before this stream. saturator->chorus->phaser->pingPong->muteGain->panner IS static (Stream
    // AC's fixed tail, unaffected by the reorderable list) and wired now via wireFxTail.
    this.wireFxTail(saturator, chorus, phaser, pingPong, muteGain)
    muteGain.connect(panner)

    panner.chain(vol, this.getMaster())
    vol.connect(levelTap) // post-fader side-tap for this track's meter (not in the audible path)
    panner.connect(reverbSend)
    reverbSend.connect(reverb)
    panner.connect(delaySend)
    delaySend.connect(delay)

    return {
      synth, osc2, osc2Gain, osc2Pan, osc3, osc3Gain, osc3Pan, uniPairs, sub, subGain, noise, noiseGain, fm, fmGain,
      filter, effects: new Map(), effectOrder: [], effectsSig: EFFECTS_SIG_UNSET, saturator, chorus, phaser, pingPong,
      muteGain, levelTap, panner, vol, reverbSend, delaySend, lastOsc: null,
    }
  }

  /** Rebuilds the chain's SPINE (filter -> ...ordered, enabled effects... -> muteGain) whenever
   * the track's declared effect list's shape changed (add/remove/reorder/bypass) since the last
   * reconcile — never on an unrelated param tick (cheap: a plain string compare against
   * `effectsSig`). Disposes runtimes for ids no longer declared, builds runtimes for new ids,
   * reuses (and re-parents) everything else — so a live-playing voice's comp/eq3/etc. nodes
   * survive a reorder, only their position in the graph changes. A disabled effect's node is
   * built and kept current (still receives applyEffectParams below) but is NOT spliced into the
   * spine at all — a real routing bypass, not a wet/dry illusion (see BeatEffect.enabled's own
   * comment in src/core/document.ts; this is the one place that "real bypass" choice is
   * implemented). `trackId` is threaded through ONLY so vinylDistortion instances can seed their
   * reproducible noise buffer from (trackId, effect id) — see buildEffectRuntime/
   * buildVinylDistortion. */
  private reconcileEffectChain(chain: SynthChain, effects: BeatEffect[], trackId: string): void {
    const sig = effects.map((e) => `${e.id}:${e.type}:${e.enabled}`).join('|')
    if (sig === chain.effectsSig) return

    const wanted = new Set(effects.map((e) => e.id))
    for (const [id, runtime] of [...chain.effects]) {
      if (!wanted.has(id)) {
        for (const n of runtime.nodes) n.dispose()
        if (runtime.raw) for (const n of runtime.raw) n.disconnect()
        chain.effects.delete(id)
      }
    }
    for (const e of effects) {
      if (!chain.effects.has(e.id)) chain.effects.set(e.id, buildEffectRuntime(e.id, e.type, trackId))
    }

    // Re-wire the spine: filter -> [enabled effects, in file order] -> muteGain. Disconnecting
    // each boundary node's OWN outgoing connection is safe and precise — it only removes the
    // spine link this function itself created (an effect's internal wiring, e.g. comp's
    // dry/wet fan-in, was never touched and stays intact).
    chain.filter.disconnect()
    for (const runtime of chain.effects.values()) runtime.exit.disconnect()
    let upstream: Tone.ToneAudioNode = chain.filter
    for (const e of effects) {
      if (!e.enabled) continue
      const runtime = chain.effects.get(e.id)!
      upstream.connect(runtime.entry)
      upstream = runtime.exit
    }
    upstream.connect(chain.saturator.in)

    chain.effectOrder = effects.map((e) => e.id)
    chain.effectsSig = sig
  }

  private applyParams(chain: SynthChain, p: EngineSynth, effects: BeatEffect[], trackId: string): void {
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
    this.reconcileEffectChain(chain, effects, trackId)
    for (const runtime of chain.effects.values()) applyEffectParams(runtime, p)
    applySaturator(chain.saturator, p.saturatorCurve, p.saturatorDrive, p.saturatorMix)
    // See applyDrumBusParams for the chorusMode 'off'/'vibrato' special-casing rationale.
    chain.chorus.wet.value = p.chorusMode === 'off' ? 0 : p.chorusMode === 'vibrato' ? 1 : p.chorusMix
    chain.chorus.frequency.value = p.chorusRate
    chain.chorus.depth = p.chorusDepth
    chain.chorus.spread = p.chorusMode === 'ensemble' ? 180 : p.chorusMode === 'vibrato' ? 0 : 90
    chain.phaser.frequency.value = p.phaserRate
    chain.phaser.octaves = p.phaserDepth
    chain.phaser.wet.value = p.phaserMix
    applyPingPong(chain.pingPong, p.pingPongTime, p.pingPongFeedback, p.pingPongCrossFeed, p.pingPongWobbleRate, p.pingPongWobbleDepth, p.pingPongMix)
  }

  private disposeChain(chain: SynthChain): void {
    const nodes: Tone.ToneAudioNode[] = [
      chain.synth, chain.osc2, chain.osc2Gain, chain.osc2Pan, chain.osc3, chain.osc3Gain, chain.osc3Pan,
      chain.sub, chain.subGain, chain.noise, chain.noiseGain, chain.fm, chain.fmGain, chain.filter,
      ...saturatorNodeList(chain.saturator), chain.chorus, chain.phaser, ...pingPongNodeList(chain.pingPong),
      chain.muteGain, chain.levelTap, chain.panner, chain.vol, chain.reverbSend, chain.delaySend,
    ]
    for (const u of chain.uniPairs) nodes.push(u.poly, u.pan, u.gain)
    for (const runtime of chain.effects.values()) {
      nodes.push(...runtime.nodes)
      if (runtime.raw) for (const n of runtime.raw) n.disconnect()
    }
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
      this.applyParams(chain, coerce(track.synth), track.effects ?? [], track.id)
    }
    const drumsTrack = doc.tracks.find((t) => t.kind === 'drums')
    this.drumTrackId = drumsTrack?.id ?? null
    // Phase 22 Stream AB: a track with a non-empty `lanes` list uses the NEW declared-lane
    // dispatch; an empty list (every pre-v0.10 file) keeps the legacy path bit-for-bit unchanged.
    this.drumDeclaredMode = !!drumsTrack && drumsTrack.lanes.length > 0
    if (drumsTrack) {
      const p = coerce(drumsTrack.synth)
      this.applyDrumBusParams(p)
      if (this.drumDeclaredMode) {
        this.syncDeclaredDrumLanes(doc, drumsTrack)
      } else {
        this.applyDrumVoiceParams(p)
      }
    }
    // Per-tick read of the mixer's mute/solo state -> real audio gating. sync() already runs every
    // 16th tick, so a mute toggled mid-playback takes effect on the next step (well under a beat).
    this.applyMuteGates()
    this.syncInstruments(doc)
    this.syncAudioTracks(doc)
  }

  /** Gate each track's output to 0 or 1 from the store's effective mute/solo state (mute wins; if
   * anything is soloed only soloed tracks pass). Gated at muteGain (upstream of the panner fan-out
   * for synth/drum chains) so the dry path AND the reverb/delay/mod sends are silenced together.
   * Instrument voices (Phase 16 Stream K) have no sends to worry about, but get the same dedicated
   * muteGain node for consistency and because a ready voice may not exist yet (a track still
   * loading its soundfont is simply skipped — nothing to gate). Idempotent + cheap; safe to call
   * every tick. */
  private applyMuteGates(): void {
    const state = useStore.getState()
    for (const [id, chain] of this.chains) {
      chain.muteGain.gain.value = isEffectivelyMuted(state, id) ? 0 : 1
    }
    if (this.drumBus && this.drumTrackId) {
      this.drumBus.muteGain.gain.value = isEffectivelyMuted(state, this.drumTrackId) ? 0 : 1
    }
    for (const [id, voice] of this.instruments) {
      voice.muteGain.gain.value = isEffectivelyMuted(state, id) ? 0 : 1
    }
    for (const [id, voice] of this.audioTracks) {
      voice.muteGain.gain.value = isEffectivelyMuted(state, id) ? 0 : 1
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
   * post-mute/post-fader tap, so a muted track reads -Infinity immediately. Instrument (SoundFont)
   * tracks got a level tap in Phase 16 Stream K (closing Phase 14 Stream F's deferred item); null
   * only for a track with no live voice at all yet (e.g. an instrument track whose soundfont is
   * still loading — nothing to meter until buildInstrument() lands a ready voice). */
  getTrackLevel(trackId: string): number | null {
    const chain = this.chains.get(trackId)
    if (chain) return Engine.rmsDb(chain.levelTap.getValue() as Float32Array)
    if (this.drumBus && trackId === this.drumTrackId) return Engine.rmsDb(this.drumBus.levelTap.getValue() as Float32Array)
    const voice = this.instruments.get(trackId)
    if (voice) return Engine.rmsDb(voice.levelTap.getValue() as Float32Array)
    const audioVoice = this.audioTracks.get(trackId)
    if (audioVoice) return Engine.rmsDb(audioVoice.levelTap.getValue() as Float32Array)
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
      const muteGain = new Tone.Gain(1)
      const vol = new Tone.Volume(inst.volume)
      const pan = new Tone.Panner(inst.pan)
      const levelTap = new Tone.Analyser('waveform', 256)
      Tone.connect(entry, muteGain)
      muteGain.chain(vol, pan, this.getMaster())
      pan.connect(levelTap) // post-fader side-tap (not in the audible path), see InstrumentVoice doc
      synth.programChange(0, inst.program)
      this.instruments.set(trackId, { synth, entry, muteGain, vol, pan, levelTap, sample: inst.sample, program: inst.program })
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
    voice.muteGain.dispose()
    voice.vol.dispose()
    voice.pan.dispose()
    voice.levelTap.dispose()
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

  // ---- audio-region-clip tracks (Phase 22 Stream AE) ---------------------------------------

  /** Fetch + decode one media sample's bytes into the shared, content-addressed buffer cache (the
   * same daemon `/media/<path>` route instrument soundfonts use). Fire-and-forget from
   * syncAudioTracks(); on completion every track whose active clip references this media id can
   * start scheduling it on the next tick. */
  private async loadAudioBuffer(mediaId: string, mediaPath: string): Promise<void> {
    try {
      const res = await fetch(`${daemonBase()}/media/${mediaPath}`)
      if (!res.ok) throw new Error(`fetch media "${mediaPath}": HTTP ${res.status}`)
      const bytes = await res.arrayBuffer()
      const ctx = this.ensureNativeContext()
      const decoded = await ctx.decodeAudioData(bytes)
      // If the sample vanished from the document while decoding, drop it silently — nothing
      // references it, so there's nothing to serve; a future re-add re-fetches.
      const stillWanted = useStore.getState().doc?.media?.some((m) => (m as { id: string }).id === mediaId)
      if (!stillWanted) return
      this.audioBuffers.set(mediaId, new Tone.ToneAudioBuffer(decoded))
    } catch (err) {
      console.warn(`[engine] audio media "${mediaId}" failed to load:`, err)
    } finally {
      this.audioBufferPending.delete(mediaId)
    }
  }

  private buildAudioTrackVoice(): AudioTrackVoice {
    const player = new Tone.Player()
    const muteGain = new Tone.Gain(1)
    const levelTap = new Tone.Analyser('waveform', 256)
    player.chain(muteGain, this.getMaster())
    muteGain.connect(levelTap) // post-fader side-tap, same discipline as every other levelTap
    return { player, muteGain, levelTap }
  }

  private disposeAudioTrackVoice(voice: AudioTrackVoice): void {
    try {
      voice.player.stop()
    } catch {
      // best-effort: a not-yet-started player may reject stop()
    }
    voice.player.dispose()
    voice.muteGain.dispose()
    voice.levelTap.dispose()
  }

  /** Reconcile live audio-track voices with the document: dispose vanished tracks, build voices
   * for new ones, and kick off (deduplicated) buffer loads for every media id any audio track's
   * clips currently reference — a track can visit several clips (and therefore several media
   * files) over a song's lifetime, so this pre-fetches all of them rather than just the one
   * active this instant. */
  private syncAudioTracks(doc: BeatDocument): void {
    const audioTracks = doc.tracks.filter((t) => t.kind === 'audio')
    const wanted = new Set(audioTracks.map((t) => t.id))
    for (const [id, voice] of [...this.audioTracks]) {
      if (!wanted.has(id)) {
        this.disposeAudioTrackVoice(voice)
        this.audioTracks.delete(id)
      }
    }
    for (const track of audioTracks) {
      if (!this.audioTracks.has(track.id)) this.audioTracks.set(track.id, this.buildAudioTrackVoice())
      for (const clip of track.clips) {
        if (!clip.audio) continue
        const mediaId = clip.audio.media
        if (this.audioBuffers.has(mediaId) || this.audioBufferPending.has(mediaId)) continue
        const media = (doc.media as { id: string; path: string }[]).find((m) => m.id === mediaId)
        if (!media) continue // not registered — nothing to load (reported elsewhere)
        this.audioBufferPending.add(mediaId)
        void this.loadAudioBuffer(mediaId, media.path)
      }
    }
  }

  /** Triggers one drum hit. `lane` is open (Phase 22 Stream AB) — a declared name on the drums
   * track's `lanes` list, or one of the implicit 5 DRUM_LANES for a legacy/migrated track.
   * `duration` (16th steps, research 20 Part 7) is honored ONLY in declared-lane mode: the legacy
   * switch below is left bit-for-bit as it was pre-Stream-AB (see the LaneVoice types' comment for
   * why), so it never had a duration concept and doesn't gain one now. */
  triggerDrum(lane: string, time: number, velocity = 1, duration?: number): void {
    // Per-lane monotonic guard: the single-instance drum voices reject a start at/before the last
    // one (Tone.js's strictly-increasing-start rule). Nudge any non-increasing trigger 5ms forward.
    let t = time
    const last = this.lastLaneTriggerTime[lane]
    if (last !== undefined && t <= last) t = last + 0.005
    this.lastLaneTriggerTime[lane] = t

    if (this.drumDeclaredMode) {
      // Choke group: a closed-hat hit silences a ringing open hat (research 19 Part V.1). Keyed by
      // canonical name, same simplification the 12-lane default kit's naming makes elsewhere in
      // this stream (no general choke-group declaration — out of scope, see docs/phase-22-stream-ab.md).
      if (lane === 'hat') this.chokeDeclaredLane('openhat', t)
      const voice = this.drumLanes.get(lane)
      if (!voice) return
      const stepSec = Tone.Time('16n').toSeconds()
      const durSec = duration !== undefined ? duration * stepSec : undefined
      if (voice.kind === 'synth') {
        const defaults = DRUM_VOICE_PARAM_DEFAULTS[voice.voiceType]
        if (voice.voiceType === 'membrane') {
          const tuneHz = voice.params.tune ?? defaults.tune!
          voice.node.triggerAttackRelease(tuneHz, durSec ?? '8n', t, velocity)
        } else if (voice.voiceType === 'noise') {
          voice.node.triggerAttackRelease(durSec ?? '8n', t, velocity)
          if (voice.toneLayer) voice.toneLayer.synth.triggerAttackRelease('A2', durSec ?? '8n', t, velocity)
        } else {
          voice.node.triggerAttackRelease(300, durSec ?? '16n', t, velocity)
        }
      } else if (voice.kind === 'sample') {
        if (!voice.player || !voice.player.loaded) return
        voice.player.playbackRate = Math.pow(2, voice.tune / 12)
        voice.gain.gain.setValueAtTime(Tone.dbToGain(voice.gainDb) * velocity, t)
        // duration present -> gate/truncate (research 20 Part 4's Simpler-Gate analogue), with a
        // short fade so truncation doesn't click; absent -> play the whole sample (today's Trigger).
        voice.player.fadeOut = durSec !== undefined ? 0.015 : 0.005
        if (durSec !== undefined) voice.player.start(t, 0, durSec)
        else voice.player.start(t)
      } else {
        // sf-backed
        if (!this.drumSfVoice || this.drumSfVoice.sample !== voice.sample) return
        const vel = Math.max(1, Math.min(127, Math.round(velocity * 127)))
        this.drumSfVoice.synth.noteOn(DRUM_CHANNEL, voice.note, vel, { time: t })
        if (durSec !== undefined) this.drumSfVoice.synth.noteOff(DRUM_CHANNEL, voice.note, { time: t + durSec })
      }
      return
    }

    // ---- legacy 5-lane path — UNCHANGED from pre-Stream-AB, see this method's doc comment ----
    if (!this.drums) return
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

  async previewDrum(lane: string, velocity = 1): Promise<void> {
    await this.ensureStarted()
    this.triggerDrum(lane, Math.max(Tone.now(), (this.lastLaneTriggerTime[lane] ?? 0) + 0.005), velocity)
  }

  /** Audition a single pitch through a synth/instrument track's live voice — the note-editor analog
   * of previewDrum (NoteView.tsx's piano-strip: clicking a key auditions that pitch). Ensures the
   * engine is started and the track's chain/voice is built with current params (sync()), then fires
   * one short note. Deliberately minimal: for synth tracks it triggers the MAIN oscillator only
   * (an audible reference pitch), not the full osc2/sub/noise/FM bank the sequenced tick renders —
   * it's a "what pitch is this key" audition, not a full patch render. Instrument (SoundFont) tracks
   * note-on then note-off their WorkletSynthesizer voice. A no-op for a track with no live voice. */
  async previewNote(trackId: string, pitch: number, velocity = 0.8): Promise<void> {
    await this.ensureStarted()
    const doc = useStore.getState().doc
    if (!doc) return
    this.sync(doc) // build the chain/voice if it doesn't exist yet, with current params
    const midi = Math.round(pitch)
    const chain = this.chains.get(trackId)
    if (chain) {
      chain.synth.triggerAttackRelease(Tone.Frequency(midi, 'midi').toFrequency(), 0.4, undefined, velocity)
      return
    }
    const voice = this.instruments.get(trackId)
    if (voice) {
      const vel = Math.max(1, Math.min(127, Math.round(velocity * 127)))
      voice.synth.noteOn(0, midi, vel)
      setTimeout(() => {
        try {
          voice.synth.noteOff(0, midi)
        } catch {
          // the voice may have been disposed (track removed / sample changed) before release
        }
      }, 400)
    }
  }

  // ─── Phase 22 Stream AH: content-browser preview-before-load ────────────────────────────────────
  // Audition a preset/sample from the content browser BEFORE it's ever applied to a document —
  // "preview-before-load" per research 18 §8, extending previewDrum/previewNote's exact idiom (an
  // ephemeral voice, fired-and-torn-down, that never touches the store's document) to content that
  // isn't on any track yet. Nothing here reads or writes useStore's `doc`.

  /** Audition a SYNTH preset's param bag on a throwaway voice. Reuses the real per-track DSP
   * (buildSynthChain/applyParams/disposeChain — the exact chain a live synth track gets), just built
   * standalone and disposed after one note's tail instead of kept alive and synced every tick.
   * `coerce` already treats every field as optional (falls back to the same defaults a bare INIT_SYNTH
   * track would use), so a preset's partial param bag previews correctly with no merging here. */
  async previewSynthPreset(params: Partial<BeatSynth>, pitch = 60, velocity = 0.85): Promise<void> {
    await this.ensureStarted()
    const chain = this.buildSynthChain()
    // effects is always [] here (an ephemeral preview voice never carries a chain), so the
    // placeholder trackId below is never actually read (buildEffectRuntime only fires for a
    // non-empty effects list) — see applyParams'/reconcileEffectChain's own trackId doc comment.
    this.applyParams(chain, coerce(params as BeatSynth), [], '__preview__')
    const freq = Tone.Frequency(Math.round(pitch), 'midi').toFrequency()
    chain.synth.triggerAttackRelease(freq, 0.5, undefined, velocity)
    setTimeout(() => this.disposeChain(chain), 1800)
  }

  /** Audition a DRUM-KIT preset's voice-shaping params (kickTune/kickPunch/kickDecay, snareDecay,
   * hatDecay/hatTone — the same BeatSynth fields drum presets set) with a short kick/hat/snare/hat
   * phrase. Deliberately a SEPARATE, throwaway set of voices from the live drums track's singleton
   * DrumKit (buildDrums()/this.drums) — that one is synced every tick off the real document and
   * shared by the whole app; previewing a not-yet-applied preset must not perturb it. Uses the same
   * Tone.js voice types/params buildDrums() does (MembraneSynth kick, NoiseSynth snare, MetalSynth
   * hat) wired straight to the master bus, bypassing the drum bus's EQ/comp/insert chain (a preview
   * doesn't need that fidelity). */
  async previewDrumPreset(params: Partial<BeatSynth>): Promise<void> {
    await this.ensureStarted()
    const p = coerce(params as BeatSynth)
    const out = new Tone.Gain(0.9).connect(this.getMaster())
    const kick = new Tone.MembraneSynth({ pitchDecay: p.kickPunch, octaves: 7, envelope: { attack: 0.001, decay: p.kickDecay, sustain: 0, release: 0.1 } }).connect(out)
    const snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: p.snareDecay, sustain: 0 } }).connect(out)
    const hat = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: p.hatDecay, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: p.hatTone, octaves: 1.5 }).connect(out)
    const t = Tone.now() + 0.02
    kick.triggerAttackRelease(p.kickTune, '8n', t)
    hat.triggerAttackRelease(300, '32n', t + 0.16)
    snare.triggerAttackRelease('8n', t + 0.32)
    hat.triggerAttackRelease(300, '32n', t + 0.48)
    setTimeout(() => {
      kick.dispose()
      snare.dispose()
      hat.dispose()
      out.dispose()
    }, 1400)
  }

  /** Audition a raw one-shot sample (a kit's kick.wav/snare.wav/… fetched straight from the daemon's
   * `GET /library/file` route) by decoding and playing it once through the shared master bus (so it
   * shows up on the master meter/scope like everything else, and respects master volume) — but with
   * no per-track mute/pan wiring, since this is a library browse preview with no track of its own
   * yet. `Tone.connect` bridges the raw native AudioNode graph into Tone's node graph, the same
   * bridging buildInstrument() uses for its WorkletSynthesizer output. */
  async previewBuffer(bytes: ArrayBuffer): Promise<void> {
    await this.ensureStarted()
    const ctx = this.ensureNativeContext()
    const audioBuffer = await ctx.decodeAudioData(bytes)
    const src = ctx.createBufferSource()
    src.buffer = audioBuffer
    const gain = ctx.createGain()
    gain.gain.value = 0.9
    src.connect(gain)
    Tone.connect(gain, this.getMaster())
    src.onended = () => {
      src.disconnect()
      gain.disconnect()
    }
    src.start()
  }

  /** Audition a SoundFont bank (fetched raw bytes, not yet registered as project media) by loading
   * it into a throwaway WorkletSynthesizer — the same synthesis path buildInstrument() uses for a
   * live instrument track's voice, minus the mute/vol/pan bus wiring a real track needs — and firing
   * one note on the requested program, through the shared master bus (see previewBuffer). */
  async previewSoundfont(bytes: ArrayBuffer, program = 0, pitch = 60, velocity = 100): Promise<void> {
    await this.ensureStarted()
    await this.ensureWorkletModule()
    const ctx = this.ensureNativeContext()
    const synth = new WorkletSynthesizer(ctx)
    await synth.soundBankManager.addSoundBank(bytes, 'preview')
    await synth.isReady
    const gain = ctx.createGain()
    synth.connect(gain)
    Tone.connect(gain, this.getMaster())
    synth.programChange(0, program)
    const midi = Math.round(pitch)
    synth.noteOn(0, midi, velocity)
    setTimeout(() => {
      try {
        synth.noteOff(0, midi)
      } catch {
        // best-effort; the preview may already be torn down
      }
      setTimeout(() => {
        try {
          synth.destroy()
        } catch {
          // best-effort teardown
        }
        gain.disconnect()
      }, 500)
    }, 700)
  }

  /** Phase 24 Stream CE: resolve the session-only loop-region override (`store.loopRegion`) against
   * the CURRENT document's actual length, clamping to `[0, songBars]` and treating a range that's
   * empty/inverted (e.g. the song got shorter after the region was set, or it hasn't been set at
   * all) as inactive — falls back to the full-song wrap, same as `null`. Shared by `play()` (picks
   * the playback START position) and `tick()` (wraps the manual step/pass computation) so both
   * always agree on the same range. */
  private resolveLoopRegion(songBars: number): { start: number; end: number } | null {
    const raw = useStore.getState().loopRegion
    if (!raw) return null
    const start = Math.max(0, Math.min(Math.floor(raw.start), songBars))
    const end = Math.max(0, Math.min(Math.floor(raw.end), songBars))
    return end > start ? { start, end } : null
  }

  /** Starts the transport. `startBar`, when given, is where playback begins (click-to-seek's "start
   * playback from the clicked position" case, Phase 24 Stream CE `seek()`) — otherwise playback
   * starts at the active loop region's own start bar, or bar 0 when no region is active (unchanged
   * default).
   *
   * The Transport's own NATIVE loop range (`t.loopStart`/`t.loopEnd`) deliberately always stays the
   * full song, exactly as before this stream — it is NOT narrowed to the active region. A loop
   * region is instead enforced entirely by `tick()`'s own manual step/pass modulo (see its comment),
   * which wraps correctly for any magnitude of raw elapsed ticks with no dependency on Tone's own
   * loop-crossing bookkeeping. This keeps the region concept fully self-contained in this file's own
   * arithmetic rather than split across two wrap mechanisms that have to agree. */
  async play(startBar?: number): Promise<void> {
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
    const region = this.resolveLoopRegion(songBars)
    t.position = `${startBar ?? region?.start ?? 0}m`
    if (this.repeatId !== null) t.clear(this.repeatId)
    this.repeatId = t.scheduleRepeat((time) => this.tick(time), '16n', 0)
    t.start()
    useStore.getState().setPlaying(true)
  }

  /** Phase 24 Stream CE: click-to-seek — clicking a spot on the ruler jumps the playhead there.
   * Ableton's own framing: clicking while STOPPED starts playback from that position; clicking
   * while PLAYING just relocates the playhead, leaving the transport's running state alone (no
   * stop/restart, nothing else interrupted). `bar` is absolute within the full song/loop, the same
   * units `tick()`'s own `bar` is in. */
  seek(bar: number): void {
    const doc = useStore.getState().doc
    if (!doc) return
    const clamped = Math.max(0, bar)
    if (useStore.getState().playing) {
      Tone.getTransport().position = `${clamped}m`
      // tick() (scheduled every 16th note) overwrites this with the authoritative value on the very
      // next step anyway, but nudging it here means the position readout and playhead jump
      // immediately on click rather than up to one 16th note later.
      useStore.setState({ currentStep: clamped * 16 })
    } else {
      void this.play(clamped)
    }
  }

  stop(): void {
    const t = Tone.getTransport()
    t.stop()
    if (this.repeatId !== null) {
      t.clear(this.repeatId)
      this.repeatId = null
    }
    // `t.clear()` cancels FUTURE tick() invocations, but any tick() that had already run before stop()
    // was called may have left its own `Tone.getDraw().schedule(...)` callback queued — Draw is a
    // separate rAF-driven timeline keyed to real AudioContext time, decoupled from the Transport's
    // own start/stop, so those already-queued `currentStep` writes would otherwise still land a few
    // hundred ms from now, stomping the `currentStep: -1` set below with a stale value from the
    // session that just ended. Found live investigating Phase 24 Stream CE (a `play(bar)` seek right
    // after a stop() briefly showed the PREVIOUS session's position before settling): cancel every
    // pending Draw callback here so a stop is a clean cut, not a fade-out of stale reads. Must pass an
    // explicit `0`, not call `cancel()` bare — Draw.cancel()'s default "after" argument is `now()`,
    // which only cancels events scheduled for the FUTURE; an event already due but not yet flushed by
    // the next animation frame (scheduled time <= now, exactly the stale-straggler case here) has
    // `time <= after` and survives an argument-less cancel(). `0` is safely before every real
    // AudioContext time (which only ever counts up from the context's own start), so it always
    // catches every pending callback regardless of how "due" it already is.
    Tone.getDraw().cancel(0)
    this.lastLaneTriggerTime = {}
    for (const voice of this.instruments.values()) {
      try {
        voice.synth.stopAll(true)
      } catch {
        // best-effort: a not-yet-ready voice may reject stopAll
      }
    }
    if (this.drumSfVoice) {
      try {
        this.drumSfVoice.synth.stopAll(true)
      } catch {
        // best-effort, same as the instrument voices above
      }
    }
    for (const voice of this.drumLanes.values()) {
      if (voice.kind === 'sample') {
        try {
          voice.player?.stop()
        } catch {
          // best-effort: a not-yet-loaded player may reject stop
        }
      }
    }
    for (const voice of this.audioTracks.values()) {
      try {
        voice.player.stop()
      } catch {
        // best-effort: a not-yet-started player may reject stop()
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
  /** Fire one note across the whole oscillator bank (main synth + osc2/osc3 + unison pairs + sub +
   * noise + FM), plus the filter envelope if any of filterEnvAmount/keytrackAmount/
   * velToFilterAmount are active. Factored out of tick()'s main note loop so Beat Repeat (Phase 22
   * Stream AC) can fire a repeated note through the exact same full-bank path as a normal one,
   * just at a different `noteTime` — a repeat should sound like a real repeat of the note, not a
   * thin single-oscillator blip. v0.10 (Phase 22 Stream AD): also applies the note's own `cent`
   * micro-tuning once (folded into freq before any ratchet slot, so every repeat shares the same
   * detune) and loops over `ratchetSlots` — count<=1 is a single full-length slot, so this reduces
   * to exactly one trigger per call when nothing is ratcheted, same as before this stream. A
   * Beat-Repeat-triggered call ratchets too: a repeated ratcheted note repeats its whole ratchet
   * pattern, which is the correct compounded behavior, not a special case. */
  private fireSynthNote(chain: SynthChain, p: EngineSynth, n: BeatNote, noteTime: number, stepSeconds: number, baseCutoff: number, lfoOn: boolean, lfo: number, lfo2On: boolean, lfo2: number): void {
    let freq = Tone.Frequency(n.pitch, 'midi').toFrequency() * Math.pow(2, n.cent / 1200)
    if (p.lfoDest === 'pitch' && lfoOn) freq *= Math.pow(2, (p.lfoDepth * lfo * 100) / 1200)
    if (p.lfo2Dest === 'pitch' && lfo2On) freq *= Math.pow(2, (p.lfo2Depth * lfo2 * 100) / 1200)
    for (const slot of ratchetSlots(n.ratchetCount, n.ratchetCurve, n.ratchetLength, n.duration)) {
      const slotTime = noteTime + slot.start * stepSeconds
      const dur = Math.max(slot.duration * stepSeconds * 0.9, 0.05)
      chain.synth.triggerAttackRelease(freq, dur, slotTime, n.velocity)
      if (p.osc2Level > 0) chain.osc2.triggerAttackRelease(freq * Math.pow(2, p.osc2Detune / 1200), dur, slotTime, n.velocity)
      if (p.unisonVoices >= 3 && p.osc2Level > 0) chain.osc3.triggerAttackRelease(freq * Math.pow(2, -p.osc2Detune / 1200), dur, slotTime, n.velocity)
      for (const u of chain.uniPairs) {
        if (p.unisonVoices >= u.minVoices && p.osc2Level > 0) u.poly.triggerAttackRelease(freq * Math.pow(2, (u.mul * p.osc2Detune) / 1200), dur, slotTime, n.velocity)
      }
      if (p.subLevel > 0) chain.sub.triggerAttackRelease(freq / 2, dur, slotTime, n.velocity)
      if (p.noiseLevel > 0) chain.noise.triggerAttackRelease(dur, slotTime, n.velocity)
      if (p.fmLevel > 0) chain.fm.triggerAttackRelease(freq, dur, slotTime, n.velocity)
      if (p.filterEnvAmount > 0 || p.keytrackAmount > 0 || p.velToFilterAmount > 0) {
        // Keytracking/velocity shift this note's cutoff at note-on; the filter envelope then
        // sweeps relative to that shifted value. Each ratchet repeat re-triggers its own envelope
        // pluck (count<=1 matches today's single-trigger behavior exactly).
        const keytrackMult = Math.pow(2, (p.keytrackAmount * (n.pitch - 60)) / 12)
        const velMult = Math.pow(2, p.velToFilterAmount * (n.velocity - 0.5) * 4)
        const noteCutoff = Math.max(baseCutoff * keytrackMult * velMult, 20)
        const peak = Math.max(noteCutoff * Math.pow(2, p.filterEnvAmount * 4), 20)
        const sustainHz = Math.max(noteCutoff * Math.pow(2, p.filterEnvAmount * 4 * p.filterEnvSustain), 20)
        chain.filter.frequency.cancelScheduledValues(slotTime)
        chain.filter.frequency.setValueAtTime(noteCutoff, slotTime)
        chain.filter.frequency.exponentialRampToValueAtTime(peak, slotTime + Math.max(p.filterEnvAttack, 0.001))
        chain.filter.frequency.exponentialRampToValueAtTime(sustainHz, slotTime + Math.max(p.filterEnvAttack, 0.001) + Math.max(p.filterEnvDecay, 0.001))
        chain.filter.frequency.exponentialRampToValueAtTime(noteCutoff, slotTime + dur + Math.max(p.filterEnvRelease, 0.001))
      }
    }
  }

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
      // Phase 22 Stream AE: audio-region clips have no live/non-clip form this stream (see
      // docs/phase-22-stream-ae.md), so loop mode is always silent for 'audio'-kind tracks —
      // audio: null unconditionally here, populated only from a clip below.
      return { notes: track.notes, hits: track.hits, automation: new Map(), contentStep: step, cycleStart: 0, audio: null }
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
    const clip = (
      track.clips as {
        id: string
        notes: BeatNote[]
        hits: BeatDrumHit[]
        automation: { param: string; points: { time: number; value: number }[] }[]
        audio?: BeatAudioRegion
        loop?: { start: number; end: number } | null
      }[]
    ).find((c) => c.id === clipId)
    if (!clip) return null
    const rel = step - sectionStartBar * 16
    // Phase 24 Stream CJ: a clip's own `loop` range (BeatClipLoop, Phase 22 Stream AG's
    // src/core/document.ts model — `{start, end}`, clip-local bars, `end` exclusive) overrides the
    // document-wide loopBars tiling for just THIS clip. When present, contentStep cycles WITHIN
    // [loop.start*16, loop.end*16) instead of [0, loopBars*16) — the clip repeats only that sub-
    // window of its own authored content, starting right at the section boundary (rel=0 ->
    // contentStep = loop.start*16). Falls back to the pre-existing loopBars-wide tiling (starting at
    // step 0) when clip.loop is null — the exact same formula this replaced, byte-for-byte, so a
    // clip that never set `loop` behaves identically to before this stream (canonical elision's
    // "no override = today's behavior, unchanged" default — see BeatClipLoop's own doc comment).
    const loopStartSteps = clip.loop ? clip.loop.start * 16 : 0
    const loopSteps = clip.loop ? (clip.loop.end - clip.loop.start) * 16 : loopBars * 16
    return {
      notes: clip.notes,
      hits: clip.hits,
      automation: autoOf(clip.automation ?? []),
      contentStep: loopStartSteps + (((rel % loopSteps) + loopSteps) % loopSteps),
      cycleStart: loopStartSteps,
      audio: clip.audio ?? null,
    }
  }

  private tick(time: number): void {
    const doc = useStore.getState().doc
    if (!doc) return
    // Re-sync each tick so live knob/step edits are heard on the next step (BeatLab does the same).
    this.sync(doc)
    const transport = Tone.getTransport()
    const song = doc.song && doc.song.length > 0 ? (doc.song as { scene: string; bars: number }[]) : null
    const songBars = song ? song.reduce((sum, s) => sum + s.bars, 0) : doc.loopBars
    // Phase 24 Stream CE: wrap over the active loop region's bar range instead of the full song when
    // one is set (wrapStartBar 0, wrapBars songBars when not — exactly today's
    // `rawStep % (songBars*16)`). `step`/`bar` stay ABSOLUTE within the whole song (contentOf's own
    // section lookup needs that to resolve the right scene/clip) — only the WRAP POINT narrows, the
    // modulo below just re-centers on `wrapStartBar` instead of always on bar 0.
    const region = this.resolveLoopRegion(songBars)
    const wrapStartBar = region ? region.start : 0
    const wrapBars = region ? region.end - region.start : songBars
    const wrapStartStep = wrapStartBar * 16
    const wrapSteps = wrapBars * 16
    const ticksPerStep = transport.PPQ / 4
    const rawStep = Math.round(transport.getTicksAtTime(time) / ticksPerStep)
    const step = wrapStartStep + (((rawStep - wrapStartStep) % wrapSteps) + wrapSteps) % wrapSteps
    const bar = Math.floor(step / 16)
    // v0.10 chance (Phase 22 Stream AD): a per-loop-cycle counter, incremented once per full
    // traversal of the loop region (or the whole song/loop, same as before this stream when no
    // region is active) — chanceFires re-rolls per (pass, track, note), so the same note is
    // re-evaluated fresh every time the loop comes back around rather than a single fixed draw.
    const pass = Math.floor((rawStep - wrapStartStep) / wrapSteps)
    const stepSeconds = Tone.Time('16n').toSeconds()

    for (const track of doc.tracks) {
      const content = this.contentOf(track, step, doc.loopBars, song, doc.scenes, bar)
      if (!content) continue // song mode: this track is silent this section

      if (track.kind === 'drums') {
        const p = coerce(track.synth)
        // Filter-sweep / amp LFO on the drum bus (the one continuously-moving value; static bus
        // params are applied reactively in sync()). Phase 18 Stream R: real tempo-sync — when
        // lfoSync is on, the rate is resolved from the CURRENT doc.bpm every tick, so a BPM edit
        // changes the drum bus LFO's period on the very next 16th-note step.
        if ((p.lfoDest === 'cutoff' || p.lfoDest === 'amp') && p.lfoDepth > 0) {
          const rateHz = p.lfoSync ? lfoSyncRateHz(doc.bpm, p.lfoSyncRate) : p.lfoRate
          const lfo = lfoValueAt(rateHz, time)
          const bus = this.getDrumBus()
          if (p.lfoDest === 'cutoff') {
            bus.filter.frequency.linearRampToValueAtTime(p.cutoff * Math.pow(2, p.lfoDepth * lfo), time + stepSeconds)
          } else {
            bus.vol.volume.linearRampToValueAtTime(p.volume + p.lfoDepth * lfo * 12, time + stepSeconds)
          }
        }
        // Beat Repeat (Phase 22 Stream AC) — see resolveBeatRepeat's doc comment for the full
        // design (gate-window placement, grid cadence, capture semantics, mode meanings).
        const drumRep = resolveBeatRepeat(p, content.contentStep)
        for (const h of content.hits) {
          if (Math.floor(h.start) === content.contentStep && !drumRep.suppressOriginal) {
            const frac = h.start - Math.floor(h.start)
            this.triggerDrum(h.lane, time + frac * stepSeconds, h.velocity, h.duration)
          }
        }
        if (drumRep.repeatNow) {
          for (const h of content.hits) {
            if (h.start < drumRep.sliceStart || h.start >= drumRep.sliceStart + drumRep.grid) continue
            if (seededRoll(track.id, content.contentStep, h.id) >= p.beatRepeatChance) continue
            const offset = h.start - drumRep.sliceStart
            this.triggerDrum(h.lane, time + offset * stepSeconds, h.velocity)
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
          // v0.10 groove (Phase 22 Stream AD): warp the note's effective start before the
          // due-this-step check, so a shuffled track's notes actually land off their raw grid step.
          const warpedStart = warpStep(n.start, track.shuffleAmount, track.shuffleGrid)
          if (Math.floor(warpedStart) !== content.contentStep) continue
          // v0.10 chance: skip this pass entirely (no noteOn at all) rather than a silent/zero-vel
          // trigger — a chance miss is "the note wasn't there this time," not "played silently."
          if (!chanceFires(n.chance, pass, track.id, n.id)) continue
          const noteTime = time + (warpedStart - content.contentStep) * stepSeconds
          const midi = Math.round(n.pitch)
          const vel = Math.max(1, Math.min(127, Math.round(n.velocity * 127)))
          // v0.10 ratchet: count<=1 (the common case) is a single full-length slot, so this loop
          // reduces to exactly today's one noteOn/noteOff when nothing is ratcheted. cent micro-
          // tuning isn't wired for instrument (SoundFont) voices yet — see the file's own note on
          // WorkletSynthesizer's channel-wide pitch-bend making a clean per-note implementation a
          // bigger lift than this pass's scope; synth-track notes (below) DO apply cent.
          for (const slot of ratchetSlots(n.ratchetCount, n.ratchetCurve, n.ratchetLength, n.duration)) {
            const slotTime = noteTime + slot.start * stepSeconds
            const slotDur = Math.max(slot.duration * stepSeconds * 0.9, 0.02)
            voice.synth.noteOn(0, midi, vel, { time: slotTime })
            voice.synth.noteOff(0, midi, { time: slotTime + slotDur })
          }
        }
        continue
      }

      if (track.kind === 'audio') {
        // Phase 22 Stream AE: audio-region clip playback — a Tone.Player per track, buffer
        // swapped to whichever media the ACTIVE clip references, offset/duration taken straight
        // from the region's in/out (source-media seconds — unaffected by playbackRate, same as
        // the native AudioBufferSourceNode.start(when, offset, duration) semantics Tone.Player
        // wraps), playbackRate set from `rate` only in warp='repitch' (off/complex play at native
        // rate — complex has no stretch implementation yet, see BeatAudioRegion's doc comment).
        const voice = this.audioTracks.get(track.id)
        const region = content.audio
        if (voice && region) {
          const buf = this.audioBuffers.get(region.media)
          const gainAuto = content.automation.get('gain')
          if (content.contentStep === content.cycleStart && buf) {
            // A clip re-triggers at the start of every pass through its own content (contentStep
            // wraps back to cycleStart — 0, or Phase 24 Stream CJ's loop.start*16 when the clip has
            // its own loop override — the same tiling `contentOf` already gives notes/hits, reused
            // as-is).
            if (voice.player.buffer !== buf) voice.player.buffer = buf
            const rate = region.warp === 'repitch' ? region.rate : 1
            voice.player.playbackRate = rate
            voice.player.volume.value = gainAuto && gainAuto.length ? interpolateAutomation(gainAuto, content.contentStep, false) : region.gainDb
            const duration = Math.max(region.out - region.in, 0.001)
            try {
              voice.player.start(time, region.in, duration)
            } catch (err) {
              console.warn(`[engine] audio track "${track.id}" failed to start:`, err)
            }
          } else if (gainAuto && gainAuto.length) {
            // Mid-region gain automation: ramp the already-playing player's volume, the same
            // linearRampToValueAtTime discipline every other automated param below uses.
            voice.player.volume.linearRampToValueAtTime(interpolateAutomation(gainAuto, content.contentStep, false), time + stepSeconds)
          }
        }
        continue
      }

      if (track.kind !== 'synth') continue // any other kind: nothing to schedule
      const chain = this.chains.get(track.id)
      if (!chain) continue
      const p = coerce(track.synth)
      const rampTime = time + stepSeconds

      // Phase 18 Stream R: real tempo-sync — each LFO's rate is resolved from the CURRENT
      // doc.bpm every tick when its *Sync flag is on, so a BPM edit changes that LFO's actual
      // period on the very next scheduled 16th-note step (see lfoSyncRateHz above).
      const lfoRateHz = p.lfoSync ? lfoSyncRateHz(doc.bpm, p.lfoSyncRate) : p.lfoRate
      const lfo2RateHz = p.lfo2Sync ? lfoSyncRateHz(doc.bpm, p.lfo2SyncRate) : p.lfo2Rate
      const lfoOn = p.lfoDest !== 'off' && p.lfoDepth > 0
      const lfo = lfoOn ? lfoValueAt(lfoRateHz, time) : 0
      const lfo2On = p.lfo2Dest !== 'off' && p.lfo2Depth > 0
      const lfo2 = lfo2On ? lfoValueAt(lfo2RateHz, time) : 0

      // Cutoff: automation (log interp) forms the base; either LFO can modulate around it now
      // (Phase 18 Stream R widened lfoDest/lfo2Dest to one shared enum — previously only LFO1
      // could reach cutoff). Last-applied wins if both target it, same documented step-resolution
      // tradeoff as clip automation vs. LFO below.
      const cutoffAuto = content.automation.get('cutoff')
      let baseCutoff = p.cutoff
      if (cutoffAuto && cutoffAuto.length) baseCutoff = interpolateAutomation(cutoffAuto, content.contentStep, true)
      let cutoffLfoApplied = false
      if (p.lfoDest === 'cutoff' && lfoOn) {
        chain.filter.frequency.linearRampToValueAtTime(Math.max(baseCutoff * Math.pow(2, p.lfoDepth * lfo), 20), rampTime)
        cutoffLfoApplied = true
      }
      if (p.lfo2Dest === 'cutoff' && lfo2On) {
        chain.filter.frequency.linearRampToValueAtTime(Math.max(baseCutoff * Math.pow(2, p.lfo2Depth * lfo2), 20), rampTime)
        cutoffLfoApplied = true
      }
      if (!cutoffLfoApplied && cutoffAuto && cutoffAuto.length) {
        chain.filter.frequency.linearRampToValueAtTime(baseCutoff, rampTime)
      }
      if (p.lfoDest === 'amp' && lfoOn) {
        chain.vol.volume.linearRampToValueAtTime(p.volume + p.lfoDepth * lfo * 12, rampTime)
      }
      if (p.lfo2Dest === 'amp' && lfo2On) {
        chain.vol.volume.linearRampToValueAtTime(p.volume + p.lfo2Depth * lfo2 * 12, rampTime)
      }

      // Generic clip automation for the remaining live-rampable params (cutoff handled above,
      // duckAmount handled with the duck below). Last write wins within a tick if a param is also
      // driven by an LFO — a documented step-resolution tradeoff, same as BeatLab. eq3/comp/
      // distortion/bitcrush destinations are TYPE-addressed (findEffect), same as before this
      // stream — if the track's chain no longer includes that effect type at all, the ramp is a
      // silent no-op (there's nothing to modulate); a merely-bypassed instance still ramps (see
      // findEffect's comment) so re-enabling it doesn't jump.
      for (const [key, points] of content.automation) {
        if (key === 'cutoff' || key === 'duckAmount' || !points.length) continue
        const val = interpolateAutomation(points, content.contentStep, false)
        switch (key) {
          case 'resonance': chain.filter.Q.linearRampToValueAtTime(val, rampTime); break
          case 'volume': chain.vol.volume.linearRampToValueAtTime(val, rampTime); break
          case 'pan': chain.panner.pan.linearRampToValueAtTime(val, rampTime); break
          case 'sendReverb': chain.reverbSend.gain.linearRampToValueAtTime(val, rampTime); break
          case 'sendDelay': chain.delaySend.gain.linearRampToValueAtTime(val, rampTime); break
          case 'eqLow': { const e = findEffect(chain, 'eq3'); if (e) e.eq3!.low.linearRampToValueAtTime(val, rampTime); break }
          case 'eqMid': { const e = findEffect(chain, 'eq3'); if (e) e.eq3!.mid.linearRampToValueAtTime(val, rampTime); break }
          case 'eqHigh': { const e = findEffect(chain, 'eq3'); if (e) e.eq3!.high.linearRampToValueAtTime(val, rampTime); break }
          case 'compMix': {
            const e = findEffect(chain, 'comp')
            if (e) {
              e.compDry!.gain.linearRampToValueAtTime(1 - val, rampTime)
              e.compWet!.gain.linearRampToValueAtTime(val, rampTime)
            }
            break
          }
          case 'distortionMix': { const e = findEffect(chain, 'distortion'); if (e) e.distortion!.wet.linearRampToValueAtTime(val, rampTime); break }
          case 'bitcrushMix': { const e = findEffect(chain, 'bitcrush'); if (e) e.bitcrush!.wet.linearRampToValueAtTime(val, rampTime); break }
        }
      }

      // LFO additive destinations — Phase 18 Stream R widened coverage: resonance/compMix/
      // bitcrushMix are NEW LFO targets (previously only reachable via clip automation, above);
      // pan/sends/EQ/distortionMix used to be LFO2-only (and were actually unreachable through the
      // document schema at all — see LFO_DESTS's comment) — now both LFOs share one destination
      // enum and both can reach the full set. One function, called once per LFO with its own
      // dest/depth/value, so there's exactly one place that knows how each destination maps onto
      // the live audio graph. ('off'/'pitch'/'cutoff'/'amp' are handled above/below; 'wtPos' is a
      // deliberate no-op — wavetable oscillators aren't ported, see the file-header scope note.)
      const applyLfoAdditive = (dest: LfoDest, depth: number, lfoVal: number): void => {
        const d = depth * lfoVal
        const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
        switch (dest) {
          case 'resonance': chain.filter.Q.linearRampToValueAtTime(Math.max(0, p.resonance + d * 8), rampTime); break
          case 'pan': chain.panner.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, p.pan + d)), rampTime); break
          case 'sendReverb': chain.reverbSend.gain.linearRampToValueAtTime(clamp01(p.sendReverb + d * 0.5), rampTime); break
          case 'sendDelay': chain.delaySend.gain.linearRampToValueAtTime(clamp01(p.sendDelay + d * 0.5), rampTime); break
          case 'eqLow': { const e = findEffect(chain, 'eq3'); if (e) e.eq3!.low.linearRampToValueAtTime(p.eqLow + d * 12, rampTime); break }
          case 'eqMid': { const e = findEffect(chain, 'eq3'); if (e) e.eq3!.mid.linearRampToValueAtTime(p.eqMid + d * 12, rampTime); break }
          case 'eqHigh': { const e = findEffect(chain, 'eq3'); if (e) e.eq3!.high.linearRampToValueAtTime(p.eqHigh + d * 12, rampTime); break }
          case 'compMix': {
            const e = findEffect(chain, 'comp')
            if (e) {
              const v = clamp01(p.compMix + d * 0.5)
              e.compDry!.gain.linearRampToValueAtTime(1 - v, rampTime)
              e.compWet!.gain.linearRampToValueAtTime(v, rampTime)
            }
            break
          }
          case 'distortionMix': { const e = findEffect(chain, 'distortion'); if (e) e.distortion!.wet.linearRampToValueAtTime(clamp01(p.distortionMix + d * 0.5), rampTime); break }
          case 'bitcrushMix': { const e = findEffect(chain, 'bitcrush'); if (e) e.bitcrush!.wet.linearRampToValueAtTime(clamp01(p.bitcrushMix + d * 0.5), rampTime); break }
        }
      }
      if (lfoOn) applyLfoAdditive(p.lfoDest, p.lfoDepth, lfo)
      if (lfo2On) applyLfoAdditive(p.lfo2Dest, p.lfo2Depth, lfo2)

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

      // Trigger notes due this step across the whole oscillator bank. Beat Repeat (Phase 22 Stream
      // AC) can suppress the normal trigger (insert/gate modes) and/or layer repeat-triggered
      // notes on top — see resolveBeatRepeat's doc comment for the full design.
      const synthRep = resolveBeatRepeat(p, content.contentStep)
      for (const n of content.notes) {
        // v0.10 groove (Phase 22 Stream AD): warp the note's effective start before the
        // due-this-step check — see the instrument-track branch above for the same pattern.
        const warpedStart = warpStep(n.start, track.shuffleAmount, track.shuffleGrid)
        if (Math.floor(warpedStart) !== content.contentStep || synthRep.suppressOriginal) continue
        // v0.10 chance: a miss means the note truly doesn't sound this pass (not a silent voice).
        if (!chanceFires(n.chance, pass, track.id, n.id)) continue
        const noteTime = time + (warpedStart - content.contentStep) * stepSeconds
        this.fireSynthNote(chain, p, n, noteTime, stepSeconds, baseCutoff, lfoOn, lfo, lfo2On, lfo2)
      }
      if (synthRep.repeatNow) {
        // Beat Repeat's window match stays on the note's RAW (un-grooved) start — grid position is
        // what the grid-aligned repeat window is defined against; groove only shifts when a note
        // sounds, not which grid cell a hit belongs to. Its own seededRoll gate is a separate,
        // independent probability from chance — not stacked on top of it (this stream's own
        // per-pass chance check is skipped for repeats, matching how Beat Repeat already used to
        // fire every note in its slice unconditionally before this stream landed).
        for (const n of content.notes) {
          if (n.start < synthRep.sliceStart || n.start >= synthRep.sliceStart + synthRep.grid) continue
          if (seededRoll(track.id, content.contentStep, n.id) >= p.beatRepeatChance) continue
          const offset = n.start - synthRep.sliceStart
          this.fireSynthNote(chain, p, n, time + offset * stepSeconds, stepSeconds, baseCutoff, lfoOn, lfo, lfo2On, lfo2)
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

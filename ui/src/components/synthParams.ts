// The declarative parameter-metadata table that drives SynthPanel's generic control renderer —
// BeatLab's DevicePanel.tsx PATTERN (arrays of {type,label,hint} + formatter functions feeding a
// generic renderer), re-derived against dotbeat's OWN SYNTH_FIELDS (src/core/document.ts), NOT a
// verbatim port of BeatLab's synth-specific field list. Anything ParamStatus/grading-related from
// BeatLab is intentionally absent (docs/research/15 §4).
//
// Every core-9 param plus all ~58 optional SYNTH_FIELDS is covered exactly once, organized into
// musical groups (osc / filter+env / LFO / amp / inserts / sends / sidechain / drum-voice) so the
// panel is grouped controls, not one flat wall of knobs. Each spec carries only display/UI
// metadata; the actual edit path is `<track>.<key>` via POST /edit (core's setValue), so adding a
// param here needs no other change. (Phase 18 Stream R added the 'bool' kind for lfoSync/
// lfo2Sync — a plain checkbox alongside the existing knob/enum/trackref controls.)

// ---- formatters (the hz/ms/pct/db family DevicePanel uses; compact for the 10px knob readout) --
export const fmt = {
  hz: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${Math.round(v)}`),
  sec: (v: number) => (Math.abs(v) < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`),
  pct: (v: number) => `${Math.round(v * 100)}%`,
  db: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`,
  num1: (v: number) => v.toFixed(1),
  num2: (v: number) => v.toFixed(2),
  int: (v: number) => `${Math.round(v)}`,
  cents: (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}c`,
  ratio: (v: number) => `${v.toFixed(1)}:1`,
  pan: (v: number) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`),
}

export type ParamKind = 'knob' | 'enum' | 'trackref' | 'bool'
export type TrackKind = 'synth' | 'drums' | 'instrument'

export interface ParamSpec {
  key: string
  label: string
  kind: ParamKind
  // knob
  min?: number
  max?: number
  log?: boolean
  format?: (v: number) => string
  // enum
  values?: readonly string[]
  hint?: string
}

export interface ParamGroup {
  id: string
  title: string
  /** Which track kinds render this group (drum tracks carry a synth block driving the drum bus). */
  kinds: readonly TrackKind[]
  open: boolean // initial <details> state
  params: ParamSpec[]
}

const OSC_TYPES = ['sine', 'triangle', 'sawtooth', 'square'] as const
// Phase 18 Stream R: widened from {off,pitch,cutoff,amp,wtPos} — mirrors src/core/document.ts's
// LFO_DESTS exactly (ui/ hand-mirrors core constants; see synthParams.ts's own file-header note
// and engine.ts's identical LFO_DESTS). Shared by both lfoDest and lfo2Dest — same shared-enum
// fix documented there (LFO2's pan/sends/EQ/distortionMix used to be unreachable dead code).
const LFO_DESTS = [
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
] as const
// Phase 22 Stream AC: mirrors document.ts's BEAT_REPEAT_MODES/CHORUS_MODES/SATURATOR_CURVES.
const BEAT_REPEAT_MODES = ['mix', 'insert', 'gate'] as const
const CHORUS_MODES = ['off', 'chorus', 'ensemble', 'vibrato'] as const
const SATURATOR_CURVES = ['analog', 'warm', 'clip', 'fold'] as const
// Phase 23 Stream BF: mirrors document.ts's RESONATOR_CHORDS.
const RESONATOR_CHORDS = ['fifths', 'major', 'minor', 'octaves', 'harmonic'] as const
// Tempo-sync note divisions (lfoSyncRate/lfo2SyncRate) — mirrors document.ts's LFO_SYNC_RATES.
const LFO_SYNC_RATES = ['1/1', '1/2', '1/4', '1/8', '1/16', '1/32', '1/4t', '1/8t', '1/16t', '1/4d', '1/8d', '1/16d'] as const

const k = (key: string, label: string, min: number, max: number, format: (v: number) => string, log = false): ParamSpec => ({
  key,
  label,
  kind: 'knob',
  min,
  max,
  log,
  format,
})
const e = (key: string, label: string, values: readonly string[]): ParamSpec => ({ key, label, kind: 'enum', values })
const b = (key: string, label: string, hint: string): ParamSpec => ({ key, label, kind: 'bool', hint })

export const PARAM_GROUPS: ParamGroup[] = [
  {
    id: 'osc',
    title: 'Oscillator',
    kinds: ['synth'],
    open: true,
    params: [
      e('osc', 'Osc', OSC_TYPES),
      e('wtTable', 'WT', ['analog', 'pwm', 'vocal', 'custom']),
      k('wtPos', 'WTpos', 0, 1, fmt.pct),
      e('osc2Type', 'Osc2', OSC_TYPES),
      k('osc2Level', 'Osc2', 0, 1, fmt.pct),
      k('osc2Detune', 'Detune', -1200, 1200, fmt.cents),
      k('subLevel', 'Sub', 0, 1, fmt.pct),
      k('noiseLevel', 'Noise', 0, 1, fmt.pct),
      k('fmLevel', 'FM', 0, 1, fmt.pct),
      k('fmHarmonicity', 'FMharm', 0, 8, fmt.num2),
      k('fmModIndex', 'FMidx', 0, 20, fmt.num1),
      k('unisonVoices', 'Unison', 1, 7, fmt.int),
      k('unisonWidth', 'Uwidth', 0, 1, fmt.pct),
      k('glide', 'Glide', 0, 1, fmt.sec),
      k('keytrackAmount', 'Keytrk', -1, 1, fmt.num2),
    ],
  },
  {
    id: 'filter',
    title: 'Filter & Envelope',
    kinds: ['synth', 'drums'],
    open: true,
    params: [
      e('filterType', 'Type', ['lowpass', 'bandpass', 'highpass']),
      k('cutoff', 'Cutoff', 20, 18000, fmt.hz, true),
      k('resonance', 'Res', 0, 20, fmt.num1),
      k('attack', 'Attack', 0.001, 2, fmt.sec, true),
      k('decay', 'Decay', 0.001, 2, fmt.sec, true),
      k('sustain', 'Sustain', 0, 1, fmt.num2),
      k('release', 'Release', 0.001, 4, fmt.sec, true),
      k('filterEnvAmount', 'Fenv', 0, 1, fmt.pct),
      k('filterEnvAttack', 'FenvA', 0.001, 2, fmt.sec, true),
      k('filterEnvDecay', 'FenvD', 0.001, 2, fmt.sec, true),
      k('filterEnvSustain', 'FenvS', 0, 1, fmt.num2),
      k('filterEnvRelease', 'FenvR', 0.001, 2, fmt.sec, true),
      k('velToFilterAmount', 'Vel→F', 0, 1, fmt.pct),
    ],
  },
  {
    id: 'lfo',
    title: 'LFO',
    kinds: ['synth'],
    open: false,
    params: [
      k('lfoRate', 'LFO1', 0.01, 20, fmt.hz, true),
      k('lfoDepth', 'Depth1', 0, 1, fmt.pct),
      e('lfoDest', 'Dest1', LFO_DESTS),
      b('lfoSync', 'Sync1', 'tempo-sync LFO1 to a note division (Rate1) instead of free Hz'),
      e('lfoSyncRate', 'Rate1', LFO_SYNC_RATES),
      e('lfoShape', 'Shape1', ['sine', 'custom']),
      k('lfo2Rate', 'LFO2', 0.01, 20, fmt.hz, true),
      k('lfo2Depth', 'Depth2', 0, 1, fmt.pct),
      e('lfo2Dest', 'Dest2', LFO_DESTS),
      b('lfo2Sync', 'Sync2', 'tempo-sync LFO2 to a note division (Rate2) instead of free Hz'),
      e('lfo2SyncRate', 'Rate2', LFO_SYNC_RATES),
    ],
  },
  {
    id: 'amp',
    title: 'Amp & Output',
    kinds: ['synth', 'drums'],
    open: true,
    params: [k('volume', 'Vol', -60, 6, fmt.db), k('pan', 'Pan', -1, 1, fmt.pan), k('macroValue', 'Macro', 0, 1, fmt.pct)],
  },
  {
    id: 'inserts',
    title: 'Inserts (EQ / Comp / Drive)',
    kinds: ['synth', 'drums'],
    open: false,
    params: [
      k('eqLow', 'EQlo', -18, 18, fmt.db),
      k('eqMid', 'EQmid', -18, 18, fmt.db),
      k('eqHigh', 'EQhi', -18, 18, fmt.db),
      k('compThreshold', 'CompTh', -60, 0, fmt.db),
      k('compRatio', 'CompR', 1, 20, fmt.ratio),
      k('compAttack', 'CompA', 0.001, 1, fmt.sec, true),
      k('compRelease', 'CompRel', 0.01, 2, fmt.sec, true),
      k('compMix', 'CompMix', 0, 1, fmt.pct),
      k('distortionAmount', 'Drive', 0, 1, fmt.pct),
      k('distortionMix', 'DrvMix', 0, 1, fmt.pct),
      k('bitcrushBits', 'Bits', 1, 16, fmt.int),
      k('bitcrushMix', 'CrushMix', 0, 1, fmt.pct),
      // Phase 23 Stream BE (Redux): the SAME bitcrush insert's sample-rate-reduction half, gated
      // by the same CrushMix above (one shared dry/wet, see docs/phase-23-stream-be.md).
      k('bitcrushRate', 'Redux', 1, 50, fmt.int, true),
    ],
  },
  {
    id: 'pingpong',
    title: 'Ping Pong Delay',
    kinds: ['synth', 'drums'],
    open: false,
    params: [
      k('pingPongTime', 'Time', 0.02, 1.4, fmt.sec, true),
      k('pingPongFeedback', 'Fdbk', 0, 1, fmt.pct),
      k('pingPongCrossFeed', 'Cross', 0, 1, fmt.pct),
      k('pingPongWobbleRate', 'WobRate', 0.05, 8, fmt.hz, true),
      k('pingPongWobbleDepth', 'WobDepth', 0, 1, fmt.pct),
      k('pingPongMix', 'Mix', 0, 1, fmt.pct),
    ],
  },
  {
    id: 'beatrepeat',
    title: 'Beat Repeat',
    kinds: ['synth', 'drums'],
    open: false,
    params: [
      k('beatRepeatGrid', 'Grid', 0.25, 4, fmt.num2),
      k('beatRepeatGate', 'Gate', 0, 16, fmt.num1),
      k('beatRepeatChance', 'Chance', 0, 1, fmt.pct),
      e('beatRepeatMode', 'Mode', BEAT_REPEAT_MODES),
    ],
  },
  {
    id: 'chorusphaser',
    title: 'Chorus / Phaser',
    kinds: ['synth', 'drums'],
    open: false,
    params: [
      e('chorusMode', 'ChMode', CHORUS_MODES),
      k('chorusRate', 'ChRate', 0.05, 8, fmt.hz, true),
      k('chorusDepth', 'ChDepth', 0, 1, fmt.pct),
      k('chorusMix', 'ChMix', 0, 1, fmt.pct),
      k('phaserRate', 'PhRate', 0.02, 8, fmt.hz, true),
      k('phaserDepth', 'PhOct', 0, 8, fmt.num1),
      k('phaserMix', 'PhMix', 0, 1, fmt.pct),
    ],
  },
  {
    id: 'saturator',
    title: 'Saturator',
    kinds: ['synth', 'drums'],
    open: false,
    params: [e('saturatorCurve', 'Curve', SATURATOR_CURVES), k('saturatorDrive', 'Drive', 0, 1, fmt.pct), k('saturatorMix', 'Mix', 0, 1, fmt.pct)],
  },
  // Phase 23 Stream BE: Auto Filter / Auto Pan / Tremolo / Utility — additive entries in Stream
  // AA's reorderable effect chain (unlike inserts/pingpong/beatrepeat/chorusphaser/saturator
  // above, which are wired for BOTH synth and drum tracks, these four are synth-tracks-only —
  // see src/core/document.ts's BeatTrack.effects comment — so `kinds` is ['synth'] only; showing
  // them on a drum track's panel would be decorative knobs with no engine wiring behind them).
  {
    id: 'autofilter',
    title: 'Auto Filter',
    kinds: ['synth'],
    open: false,
    params: [
      k('autoFilterRate', 'Rate', 0.02, 10, fmt.hz, true),
      k('autoFilterDepth', 'Depth', 0, 1, fmt.pct),
      k('autoFilterBaseFrequency', 'Base', 20, 4000, fmt.hz, true),
      k('autoFilterOctaves', 'Octaves', 0.5, 6, fmt.num1),
      e('autoFilterType', 'Type', ['lowpass', 'bandpass', 'highpass']),
      k('autoFilterMix', 'Mix', 0, 1, fmt.pct),
    ],
  },
  {
    id: 'autopan',
    title: 'Auto Pan',
    kinds: ['synth'],
    open: false,
    params: [k('autoPanRate', 'Rate', 0.02, 10, fmt.hz, true), k('autoPanDepth', 'Depth', 0, 1, fmt.pct), k('autoPanMix', 'Mix', 0, 1, fmt.pct)],
  },
  {
    id: 'tremolo',
    title: 'Tremolo',
    kinds: ['synth'],
    open: false,
    params: [
      k('tremoloRate', 'Rate', 0.5, 20, fmt.hz, true),
      k('tremoloDepth', 'Depth', 0, 1, fmt.pct),
      k('tremoloSpread', 'Spread', 0, 180, fmt.int),
      k('tremoloMix', 'Mix', 0, 1, fmt.pct),
    ],
  },
  {
    id: 'utility',
    title: 'Utility',
    kinds: ['synth'],
    open: false,
    params: [k('utilityWidth', 'Width', 0, 1, fmt.pct), k('utilityGain', 'Gain', -24, 24, fmt.db)],
  },
  // Phase 23 Stream BF: these three are real EffectType CHAIN members (document.ts's EFFECT_TYPES),
  // unlike the fixed inserts above — knobs here only do something audible once the matching effect
  // is actually `effect-add`ed via the Effect Chain panel (same decoupled-knobs-vs-chain-membership
  // convention the 'inserts' group above already has for eq3/comp/distortion/bitcrush). synth-only:
  // drum tracks never carry an `effects` chain (see BeatTrack.effects), so these controls would be
  // dead weight there — unlike the AC group above, which drum tracks' OWN fixed bus also wires.
  {
    id: 'graindelay',
    title: 'Grain Delay',
    kinds: ['synth'],
    open: false,
    params: [
      k('grainDelayTime', 'Time', 0.02, 2, fmt.sec, true),
      k('grainDelayFeedback', 'Fdbk', 0, 0.92, fmt.pct),
      k('grainDelaySize', 'Grain', 0.01, 1, fmt.sec, true),
      k('grainDelayPitch', 'Pitch', -24, 24, (v) => `${v > 0 ? '+' : ''}${Math.round(v)}st`),
      k('grainDelayMix', 'Mix', 0, 1, fmt.pct),
    ],
  },
  {
    id: 'vinyldistortion',
    title: 'Vinyl Distortion',
    kinds: ['synth'],
    open: false,
    params: [k('vinylDrive', 'Drive', 0, 1, fmt.pct), k('vinylNoiseLevel', 'Noise', 0, 1, fmt.pct), k('vinylTone', 'Tone', 0, 1, fmt.pct), k('vinylMix', 'Mix', 0, 1, fmt.pct)],
  },
  {
    id: 'resonator',
    title: 'Resonators',
    kinds: ['synth'],
    open: false,
    params: [k('resonatorFreq', 'Freq', 40, 4000, fmt.hz, true), e('resonatorChord', 'Chord', RESONATOR_CHORDS), k('resonatorQ', 'Q', 0.5, 200, fmt.num1, true), k('resonatorMix', 'Mix', 0, 1, fmt.pct)],
  },
  {
    id: 'sends',
    title: 'Sends',
    kinds: ['synth', 'drums'],
    open: false,
    params: [k('sendReverb', 'Reverb', 0, 1, fmt.pct), k('sendDelay', 'Delay', 0, 1, fmt.pct)],
  },
  {
    id: 'sidechain',
    title: 'Sidechain Duck',
    kinds: ['synth', 'drums'],
    open: false,
    params: [
      { key: 'duckSource', label: 'Source', kind: 'trackref', hint: "kick track that ducks this one ('none' = off)" },
      k('duckAmount', 'Amount', 0, 1, fmt.pct),
    ],
  },
  {
    id: 'drumvoice',
    title: 'Drum Voice',
    kinds: ['drums'],
    open: true,
    params: [
      k('kickTune', 'KickHz', 20, 120, fmt.hz),
      k('kickPunch', 'KickPch', 0, 1, fmt.pct),
      k('kickDecay', 'KickDec', 0.05, 2, fmt.sec, true),
      k('snareTone', 'SnrTone', 0, 1, fmt.pct),
      k('snareDecay', 'SnrDec', 0.02, 1, fmt.sec, true),
      k('hatDecay', 'HatDec', 0.01, 0.5, fmt.sec, true),
      k('openHatDecay', 'OHatDec', 0.05, 2, fmt.sec, true),
      k('hatTone', 'HatHz', 500, 12000, fmt.hz, true),
    ],
  },
]

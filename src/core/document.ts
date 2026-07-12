// The in-memory shape of a .beat v0 document. Every field maps 1:1 onto real fields in
// BeatLab's Track/Note/SynthParams (beatlab/src/types.ts) — see docs/format-spec.md's "v0
// grammar" section for the frozen grammar this type mirrors, and the worked example there for
// what serializing one of these actually looks like on disk.

export type OscType = 'sine' | 'triangle' | 'sawtooth' | 'square'

export type TrackKind = 'synth' | 'drums' | 'instrument'

/** Phase 18 Stream R: an LFO rate expressed as a tempo-synced note division instead of free Hz —
 * Ableton's convention (Synced / Triplet / Dotted). `t` = triplet (2/3 the plain division's
 * length), `d` = dotted (1.5x). Promoted from `DELIBERATELY_UNMODELED` (`lfoSync`/`lfoSyncRate`,
 * `lfo2Sync`/`lfo2SyncRate` — see src/core/convert.ts) now that LFOs are getting real attention
 * (docs/research/18-ableton-ui-architecture.md's LFO-depth section). */
export type LfoSyncRate = '1/1' | '1/2' | '1/4' | '1/8' | '1/16' | '1/32' | '1/4t' | '1/8t' | '1/16t' | '1/4d' | '1/8d' | '1/16d'

/** Phase 18 Stream R: the enumerated LFO destination set — ONE shared list for both lfoDest and
 * lfo2Dest (see LFO_DESTS below), widened from the original 5-value {off,pitch,cutoff,amp,wtPos}
 * toward AUTOMATABLE_SYNTH_PARAMS coverage per research 18's recommendation ("more LFOs and/or a
 * larger but still-enumerated, still-single-token destination set... widening each LFO's allowed
 * destination enum... If a user wants LFO1 on pan, they can't. Fix that."). Kept literal/enumerated
 * (no free-routing matrix) — see docs/research/18-ableton-ui-architecture.md's LFO section. */
export type LfoDestination =
  | 'off'
  | 'pitch'
  | 'cutoff'
  | 'resonance'
  | 'amp'
  | 'pan'
  | 'wtPos'
  | 'sendReverb'
  | 'sendDelay'
  | 'sendMod'
  | 'eqLow'
  | 'eqMid'
  | 'eqHigh'
  | 'compMix'
  | 'distortionMix'
  | 'bitcrushMix'

// BeatLab's own lane set and order (DRUM_LANES in beatlab/src/types.ts). Order is canonical for
// serialization: all five lanes are always emitted, in this order, so toggling any drum step is
// always a one-line diff and never inserts or deletes lines (the Humdrum fixed-grid discipline —
// see docs/format-spec.md).
export const DRUM_LANES = ['kick', 'snare', 'clap', 'hat', 'openhat'] as const
export type DrumLane = (typeof DRUM_LANES)[number]

// One velocity (0..1) per step; 0 = off. This is BeatLab's 16-step (one-bar) cycle shape.
// Since v0.8 it is a VIEW/interchange shape only (GUI payloads, engine partials, migration of
// v<=0.7 files) — the document itself stores drums as free-timed BeatDrumHit events. See
// docs/research/12-drum-representation.md: every mature DAW stores events, grids are views.
export type BeatDrumPattern = Record<DrumLane, number[]>

/** v0.8: one drum hit — a free-timed trigger event, fully general (owner decision). `start` is
 * in 16th steps from the loop start, fractional allowed (v0.7 number rules), ABSOLUTE across
 * loop_bars (unlike the old per-bar pattern cycle). No duration: drum voices/one-shots are
 * triggers (SMF note-off irrelevance for percussion; Hydrogen's length=-1 — research 12). */
export interface BeatDrumHit {
  id: string
  lane: DrumLane
  start: number // 16th steps, fractional, absolute over the loop
  velocity: number // (0..1]; a zero-velocity hit is meaningless and rejected
}

export interface BeatSynth {
  // ---- the required core 9 (v0.1, always serialized) ----
  osc: OscType
  volume: number // dB
  cutoff: number // Hz
  resonance: number
  attack: number // seconds
  decay: number // seconds
  sustain: number // 0..1
  release: number // seconds
  pan: number // -1..1
  // ---- v0.3: the full musical surface (serialized iff != default — canonical elision) ----
  // Every field maps 1:1 onto beatlab's SynthParams; defaults are frozen copies of beatlab's
  // DEFAULT_SYNTH at v0.3 freeze time (see SYNTH_FIELDS below and format-spec.md).
  wtTable: 'analog' | 'pwm' | 'vocal' | 'custom' // wavetable set for the main osc's WT mode
  wtPos: number // 0..1 wavetable position
  filterType: 'lowpass' | 'bandpass' | 'highpass'
  osc2Type: OscType
  osc2Level: number // 0..1; 0 = layer off
  osc2Detune: number // cents (1200 = +1 octave)
  subLevel: number // 0..1
  noiseLevel: number // 0..1
  fmLevel: number // 0..1
  fmHarmonicity: number
  fmModIndex: number
  unisonVoices: number // 1 = off
  unisonWidth: number // 0..1 stereo spread of unison pairs
  filterEnvAmount: number // 0..1, sweep up to ~4 octaves at full
  filterEnvAttack: number
  filterEnvDecay: number
  filterEnvSustain: number
  filterEnvRelease: number
  lfoRate: number // Hz (ignored when lfoSync is true — see lfoSyncRate)
  lfoDepth: number // 0..1
  lfoDest: LfoDestination
  lfoSync: boolean // true = lfoSyncRate (note division) drives the rate instead of lfoRate (Hz)
  lfoSyncRate: LfoSyncRate
  lfoShape: 'sine' | 'custom'
  lfo2Rate: number
  lfo2Depth: number
  lfo2Dest: LfoDestination
  lfo2Sync: boolean
  lfo2SyncRate: LfoSyncRate
  glide: number // seconds
  keytrackAmount: number
  velToFilterAmount: number
  macroValue: number
  eqLow: number // dB
  eqMid: number // dB
  eqHigh: number // dB
  compThreshold: number // dB
  compRatio: number
  compAttack: number // seconds
  compRelease: number // seconds
  compMix: number // 0..1; 0 = insert bypassed
  distortionAmount: number
  distortionMix: number
  bitcrushBits: number
  bitcrushMix: number
  sendReverb: number // 0..1
  sendDelay: number // 0..1
  sendMod: number // 0..1
  duckSource: string | null // track id whose kick ducks this track; null = off ("none" in text)
  duckAmount: number // 0..1
  // drum-voice shaping (audible on drum tracks; harmless defaults on synth tracks)
  kickTune: number // Hz
  kickPunch: number
  kickDecay: number
  snareTone: number
  snareDecay: number
  hatDecay: number
  openHatDecay: number
  hatTone: number // Hz
}

export type SynthFieldKind = 'number' | 'enum' | 'bool' | 'trackref'

export interface SynthFieldDef {
  key: keyof BeatSynth
  kind: SynthFieldKind
  default: number | string | boolean | null
  values?: readonly string[] // enum only
}

export interface BeatNote {
  id: string
  pitch: number // MIDI 0-127
  start: number // 16th-note steps from the loop start
  duration: number // steps
  velocity: number // 0..1
}

/** v0.9: one automation point — a (time, value) pair on a clip's automation lane for one synth
 * param. `time` is in 16th steps from the CLIP's own start (v0.7 fractional-number rules, same
 * unit as note/hit `start`). Stable id (D6); no interpolation field (curve shape — linear vs
 * hold — is deferred, see docs/phase-9-automation-plan.md). */
export interface BeatAutomationPoint {
  id: string
  time: number // 16th steps from clip start, fractional, >= 0
  value: number // raw units of the automated param (Hz, dB, 0..1, etc. — whatever the param uses)
}

/** v0.9: one automation lane — every point recorded for a single synth param within one clip.
 * A lane only exists while it has >= 1 point (canonical elision: no lane = no automation for
 * that param — one canonical form per state, same discipline as v0.3's synth-field elision). */
export interface BeatAutomationLane {
  param: string // a key from AUTOMATABLE_SYNTH_PARAMS below
  points: BeatAutomationPoint[]
}

/** v0.4: a named snapshot of playable content, owned by a track. Mirrors beatlab's Clip (a
 * value copy, not a reference — see docs/phase-6-plan.md). Synth-track clips carry notes;
 * drum-track clips carry hits (v0.8; was a five-lane pattern through v0.7 — the parser
 * migrates). v0.9: clips may also carry automation lanes (deliberately NOT modeled at the live
 * track / non-clip level — see docs/format-spec.md's v0.9 section for why clip-scoped-only was
 * chosen). Ids are track-scoped human slugs (D6). */
export interface BeatClip {
  id: string
  notes: BeatNote[] // synth tracks only; always [] for drums
  hits: BeatDrumHit[] // drum tracks only; always [] for synth
  automation: BeatAutomationLane[] // v0.9; [] when the clip has none (serialized only when present)
}

/** v0.4: a scene maps tracks to clips — one complete statement of "what plays". Mirrors
 * beatlab's Scene.clipIds. Serialized as one `slot` line per mapping, in track order. */
export interface BeatScene {
  id: string
  slots: Record<string, string> // trackId -> clipId
}

/** v0.4: one song section — play `scene` for `bars` bars (clip content loops within the
 * section). The section list IS the arrangement timeline; order is data. */
export interface BeatSongSection {
  scene: string
  bars: number
}

/** v0.5: a content-addressed reference to an audio file — the first thing a .beat document
 * points at that cannot be text. The sha256 pins the exact bytes (integrity + dedup + honest
 * git story: media files are immutable blobs); path is relative to the .beat file. License
 * provenance lives in a sidecar (<path>.json), deliberately outside the music file. */
export interface BeatMediaSample {
  id: string // document-scoped human slug (D6)
  sha256: string // lowercase hex, 64 chars
  path: string // relative path, forward slashes
}

/** v0.5: one drum lane backed by a sample one-shot instead of the synthesized voice. */
export interface BeatLaneSample {
  sample: string // BeatMediaSample id
  gainDb: number // static lane level, multiplies per-hit velocity
  tune: number // semitones
}

/** v0.6: an instrument track's voice — a media-referenced SoundFont preset. Deliberately NOT a
 * synth block: the 55 synth params mostly don't apply to sampled instruments, and fail-loudly
 * beats half-meaningful knobs. volume/pan are the small bus subset that does apply. */
export interface BeatInstrument {
  sample: string // BeatMediaSample id of an .sf2/.sf3
  program: number // SoundFont program number within the bank (0-127)
  volume: number // dB
  pan: number // -1..1
}

// v0.10 (Phase 22 Stream AA): the per-track insert-effect chain, promoted out of
// DELIBERATELY_UNMODELED's 'insertOrder' entry (src/core/convert.ts) now that it has a real
// grammar. Replaces the old hardcoded EQ3->compressor->distortion->bitcrush order
// (ui/src/audio/engine.ts's buildSynthChain) with a literal, ordered, per-track list: the file
// states the chain directly, and array order in `BeatTrack.effects` IS chain order (same
// discipline as note/clip/track order elsewhere — see format-spec.md's canonical-ordering
// section). Deliberately flat text, no box/pointer graph (research/21-opendaw-devices-effects.md
// #1's "adapt, not adopt" verdict): reordering two effects is a two-line move, not a numeric
// `index` field edit.
//
// Each entry names WHICH built-in effect type it is and whether it's active; the effect's own
// knobs stay right where they already lived (eqLow/eqMid/eqHigh, comp*, distortion*, bitcrush* in
// SYNTH_FIELDS below) — unchanged, so LFO destinations/clip automation targeting those params keep
// working unmodified. This means dotbeat does not yet support two independent instances of the
// SAME type with different params (both would read the one shared eqLow etc.) — a documented scope
// cut, not an oversight; see docs/phase-22-stream-aa.md.
export type EffectType = 'eq3' | 'comp' | 'distortion' | 'bitcrush'
export const EFFECT_TYPES: readonly EffectType[] = ['eq3', 'comp', 'distortion', 'bitcrush']

export interface BeatEffect {
  id: string // track-scoped stable id (D6) — what makes a reorder a MOVE, not a delete+insert
  type: EffectType
  enabled: boolean // default true (elided as a bare line); false serializes as a trailing "bypassed" token
}

/** The canonical migration target for every pre-v0.10 file (and any synth track that never
 * declares an explicit `effect`/`effects` line): the exact old hardcoded order, all enabled. A
 * synth track whose `effects` deep-equals this (same ids/types/enabled, same order) elides all
 * effect lines entirely — one canonical form per state, and every existing .beat file keeps
 * serializing byte-identically. Returns a fresh array (never share one array instance). */
export function defaultEffectChain(): BeatEffect[] {
  return EFFECT_TYPES.map((type) => ({ id: type, type, enabled: true }))
}

/** True iff `effects` is exactly the default chain (same length, same id/type/enabled per index,
 * in order) — the serializer's canonical-elision test for the whole effect chain. */
export function isDefaultEffectChain(effects: readonly BeatEffect[]): boolean {
  const def = defaultEffectChain()
  if (effects.length !== def.length) return false
  return effects.every((e, i) => e.id === def[i]!.id && e.type === def[i]!.type && e.enabled === def[i]!.enabled)
}

export interface BeatTrack {
  id: string
  name: string
  color: string // lowercase hex, e.g. "#c678dd"
  kind: TrackKind
  synth: BeatSynth // drum tracks carry these too — in BeatLab they're the real drum bus/voice params
  instrument?: BeatInstrument // v0.6; present iff kind === 'instrument' (synth block absent)
  laneSamples: Partial<Record<DrumLane, BeatLaneSample>> // v0.5; drum tracks only, {} when none
  clips: BeatClip[] // v0.4; [] when the track has none (serialized only when present)
  notes: BeatNote[] // synth tracks only; always [] for drums
  hits: BeatDrumHit[] // v0.8; drum tracks only, always [] for synth/instrument
  // v0.10: the ordered insert-effect chain — synth tracks only (drum/instrument tracks carry []
  // and never serialize effect lines; drum-bus insert ordering is out of this stream's scope, see
  // docs/phase-22-stream-aa.md). A synth track always has SOME chain in memory (the default when
  // the file has no explicit declaration); [] here means "explicitly emptied" (`effects none`).
  effects: BeatEffect[]
}

export interface BeatDocument {
  formatVersion: string
  bpm: number
  loopBars: number
  selectedTrack: string
  media: BeatMediaSample[] // v0.5; [] when none. Canonical position: before tracks.
  tracks: BeatTrack[]
  scenes: BeatScene[] // v0.4; [] when none
  song: BeatSongSection[] | null // v0.4; null = no song block = loop mode (today's behavior)
}

export const OSC_TYPES: readonly OscType[] = ['sine', 'triangle', 'sawtooth', 'square']

/** Phase 18 Stream R: widened from the original {off,pitch,cutoff,amp,wtPos} — see LfoDestination
 * above for the rationale. Shared by lfoDest and lfo2Dest (SYNTH_FIELDS below): this ALSO fixes a
 * real pre-existing bug — ui/src/audio/engine.ts's LFO2 implementation already switched on
 * 'pan'/'sendReverb'/'sendDelay'/'sendMod'/'eqLow'/'eqMid'/'eqHigh'/'distortionMix', but the
 * document schema only ever allowed the original 5 values for lfo2Dest too, so those engine
 * branches were unreachable dead code — no document could legally set lfo2Dest to 'pan'. Exported
 * so ui/src/audio/engine.ts's hand-maintained mirror can be kept in sync by inspection. */
export const LFO_DESTS: readonly LfoDestination[] = [
  'off',
  'pitch',
  'cutoff',
  'resonance',
  'amp',
  'pan',
  'wtPos',
  'sendReverb',
  'sendDelay',
  'sendMod',
  'eqLow',
  'eqMid',
  'eqHigh',
  'compMix',
  'distortionMix',
  'bitcrushMix',
]

/** Phase 18 Stream R: the tempo-sync note-division vocabulary (lfoSyncRate/lfo2SyncRate) —
 * Ableton's convention (plain / triplet 't' / dotted 'd'). Exported so ui/src/audio/engine.ts's
 * mirror and ui/src/components/synthParams.ts's dropdown can match exactly. */
export const LFO_SYNC_RATES: readonly LfoSyncRate[] = ['1/1', '1/2', '1/4', '1/8', '1/16', '1/32', '1/4t', '1/8t', '1/16t', '1/4d', '1/8d', '1/16d']

/** Seconds-per-cycle of one tempo-synced LFO division at a given bpm. A "1/N" division is N-ths
 * of a whole note (so "1/4" = one quarter note = 60/bpm seconds, matching a DAW click); 't'
 * (triplet) shortens it to 2/3 (three fit where two normally would); 'd' (dotted) lengthens it to
 * 1.5x (a note plus half its own length). Falls back to a quarter note for any unrecognized token
 * (should never happen — callers only ever pass an LFO_SYNC_RATES member). */
export function lfoSyncDivisionSeconds(bpm: number, division: LfoSyncRate): number {
  const m = /^1\/(\d+)([td]?)$/.exec(division)
  const denom = m ? Number(m[1]) : 4
  const mod = m?.[2]
  let seconds = ((60 / bpm) * 4) / denom // a whole note is 4 quarter notes long
  if (mod === 't') seconds *= 2 / 3
  else if (mod === 'd') seconds *= 1.5
  return seconds
}

/** The synced LFO rate in Hz (1/period) — what lfoValueAt-style sine evaluation actually wants. */
export function lfoSyncRateHz(bpm: number, division: LfoSyncRate): number {
  const seconds = lfoSyncDivisionSeconds(bpm, division)
  return seconds > 0 ? 1 / seconds : 1
}

/** The REQUIRED core 9 — always serialized, must all appear in every synth block (v0.1
 * contract, unchanged). BeatLab's own P_FULL progressive-reveal order, pan appended. */
export const SYNTH_PARAM_ORDER = [
  'osc',
  'volume',
  'cutoff',
  'resonance',
  'attack',
  'decay',
  'sustain',
  'release',
  'pan',
] as const satisfies readonly (keyof BeatSynth)[]

/** v0.3: the optional field table, in canonical serialization order (grouped musically: osc
 * extras -> layers -> filter env -> motion -> inserts -> sends -> duck -> drum voices).
 * Serialized iff value != default (canonical elision — deterministic both directions, one
 * canonical form per state); parsed missing-as-default. Defaults are frozen copies of
 * beatlab's DEFAULT_SYNTH at v0.3 freeze time. Parser/serializer/edit/diff/convert are all
 * driven by this table — adding a field is one row here plus a BeatSynth type line. */
export const SYNTH_FIELDS: readonly SynthFieldDef[] = [
  { key: 'wtTable', kind: 'enum', default: 'analog', values: ['analog', 'pwm', 'vocal', 'custom'] },
  { key: 'wtPos', kind: 'number', default: 0.5 },
  { key: 'filterType', kind: 'enum', default: 'lowpass', values: ['lowpass', 'bandpass', 'highpass'] },
  { key: 'osc2Type', kind: 'enum', default: 'sawtooth', values: OSC_TYPES },
  { key: 'osc2Level', kind: 'number', default: 0 },
  { key: 'osc2Detune', kind: 'number', default: 12 },
  { key: 'subLevel', kind: 'number', default: 0 },
  { key: 'noiseLevel', kind: 'number', default: 0 },
  { key: 'fmLevel', kind: 'number', default: 0 },
  { key: 'fmHarmonicity', kind: 'number', default: 1 },
  { key: 'fmModIndex', kind: 'number', default: 5 },
  { key: 'unisonVoices', kind: 'number', default: 1 },
  { key: 'unisonWidth', kind: 'number', default: 0 },
  { key: 'filterEnvAmount', kind: 'number', default: 0 },
  { key: 'filterEnvAttack', kind: 'number', default: 0.01 },
  { key: 'filterEnvDecay', kind: 'number', default: 0.2 },
  { key: 'filterEnvSustain', kind: 'number', default: 0.3 },
  { key: 'filterEnvRelease', kind: 'number', default: 0.2 },
  { key: 'lfoRate', kind: 'number', default: 4 },
  { key: 'lfoDepth', kind: 'number', default: 0 },
  { key: 'lfoDest', kind: 'enum', default: 'off', values: LFO_DESTS },
  { key: 'lfoSync', kind: 'bool', default: false },
  { key: 'lfoSyncRate', kind: 'enum', default: '1/4', values: LFO_SYNC_RATES },
  { key: 'lfoShape', kind: 'enum', default: 'sine', values: ['sine', 'custom'] },
  { key: 'lfo2Rate', kind: 'number', default: 3 },
  { key: 'lfo2Depth', kind: 'number', default: 0 },
  { key: 'lfo2Dest', kind: 'enum', default: 'off', values: LFO_DESTS },
  { key: 'lfo2Sync', kind: 'bool', default: false },
  { key: 'lfo2SyncRate', kind: 'enum', default: '1/8', values: LFO_SYNC_RATES },
  { key: 'glide', kind: 'number', default: 0 },
  { key: 'keytrackAmount', kind: 'number', default: 0 },
  { key: 'velToFilterAmount', kind: 'number', default: 0 },
  { key: 'macroValue', kind: 'number', default: 0 },
  { key: 'eqLow', kind: 'number', default: 0 },
  { key: 'eqMid', kind: 'number', default: 0 },
  { key: 'eqHigh', kind: 'number', default: 0 },
  { key: 'compThreshold', kind: 'number', default: -24 },
  { key: 'compRatio', kind: 'number', default: 4 },
  { key: 'compAttack', kind: 'number', default: 0.02 },
  { key: 'compRelease', kind: 'number', default: 0.25 },
  { key: 'compMix', kind: 'number', default: 0 },
  { key: 'distortionAmount', kind: 'number', default: 0 },
  { key: 'distortionMix', kind: 'number', default: 0 },
  { key: 'bitcrushBits', kind: 'number', default: 8 },
  { key: 'bitcrushMix', kind: 'number', default: 0 },
  { key: 'sendReverb', kind: 'number', default: 0 },
  { key: 'sendDelay', kind: 'number', default: 0 },
  { key: 'sendMod', kind: 'number', default: 0 },
  { key: 'duckSource', kind: 'trackref', default: null },
  { key: 'duckAmount', kind: 'number', default: 0 },
  { key: 'kickTune', kind: 'number', default: 32.7 },
  { key: 'kickPunch', kind: 'number', default: 0.05 },
  { key: 'kickDecay', kind: 'number', default: 0.4 },
  { key: 'snareTone', kind: 'number', default: 0 },
  { key: 'snareDecay', kind: 'number', default: 0.13 },
  { key: 'hatDecay', kind: 'number', default: 0.05 },
  { key: 'openHatDecay', kind: 'number', default: 0.35 },
  { key: 'hatTone', kind: 'number', default: 4000 },
] as const

export const SYNTH_FIELD_BY_KEY: ReadonlyMap<string, SynthFieldDef> = new Map(SYNTH_FIELDS.map((f) => [f.key, f]))

/** v0.9: the params clip automation may target — every NUMERIC synth field (core 9 minus the
 * enum `osc`, plus every v0.3 field of kind 'number'). Enum/bool/trackref fields (osc,
 * wtTable, filterType, osc2Type, lfoDest/lfo2Dest, lfoShape, duckSource) don't have a
 * meaningful (time, value) curve, so they're excluded — derived from the existing tables
 * rather than a hand-maintained parallel list (the "one table, many consumers" house style). */
export const AUTOMATABLE_SYNTH_PARAMS: readonly string[] = [
  ...SYNTH_PARAM_ORDER.filter((k) => k !== 'osc'),
  ...SYNTH_FIELDS.filter((f) => f.kind === 'number').map((f) => f.key),
]

/** A BeatSynth with every optional field at its canonical default. */
export function defaultSynthFields(): Omit<BeatSynth, (typeof SYNTH_PARAM_ORDER)[number]> {
  const out: Record<string, unknown> = {}
  for (const f of SYNTH_FIELDS) out[f.key] = f.default
  return out as Omit<BeatSynth, (typeof SYNTH_PARAM_ORDER)[number]>
}

export const TRACK_KINDS: readonly TrackKind[] = ['synth', 'drums', 'instrument']

/** The format's standard init patch for a newly-created track (`beat init` / `beat add-track`).
 * A format-level default, not a copy of any host app's: a mellow filtered saw that sounds
 * reasonable for bass, chords, or lead until edited. */
export const INIT_SYNTH: BeatSynth = {
  osc: 'sawtooth',
  volume: -10,
  cutoff: 2000,
  resonance: 0.8,
  attack: 0.01,
  decay: 0.2,
  sustain: 0.6,
  release: 0.3,
  pan: 0,
  ...defaultSynthFields(),
} as BeatSynth

/** Default track colors cycled by `beat add-track` when none is given — beatlab's own palette. */
export const TRACK_COLORS = ['#e06c75', '#56b6c2', '#f7c948', '#c678dd', '#98c379', '#61afef'] as const

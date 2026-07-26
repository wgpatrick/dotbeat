// Audio tracks get a production chain — the DATA-CONTRACT half (research 142 headline 1 / §3.2).
//
// 142's most consequential finding: dotbeat could PLACE sampled audio but could not PROCESS it. An
// `audio` track's whole engine voice was `player -> muteGain -> master`; parse.ts rejected
// `effect` lines on one and edit.ts's addEffect refused outright — while a sample-backed DRUM LANE
// had a filter, an AHD envelope and its own ordered effect chain. The drum machine could mangle a
// sample; the track literally named `audio` could not.
//
// The RENDER assertions live in ui/verify-audio-track-fx.mjs (the engine needs a browser
// AudioContext — the same split every other engine-audio check in this repo uses). THIS file
// guards the format contract those renders consume:
//   - the exact key set an audio track may carry, and that everything outside it is REFUSED
//     (the "fail-loudly beats half-meaningful knobs" rule the instrument branch already follows);
//   - the DEFAULTS, one by one, because they are the whole backward-compatibility story: they are
//     0 dB / 20 kHz / Q 0 / no sends / empty chain, deliberately NOT INIT_SYNTH's -10 dB / 2 kHz,
//     so an untouched audio track renders exactly as it did before this stream;
//   - byte-identical round-trip and canonical elision, on both the untouched and the fully
//     produced shape.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AUDIO_TRACK_FIELDS,
  AUDIO_TRACK_PRODUCTION_FIELDS,
  BeatEditError,
  BeatParseError,
  EFFECT_PARAM_KEYS,
  addEffect,
  addTrack,
  initAudioTrackSynth,
  initDocument,
  moveEffect,
  parse,
  serialize,
  setValue,
} from '../src/core/index.js'

const HEADER = `format_version 0.11
bpm 120
loop_bars 4
selected_track aud
`

/** A minimal audio-track project; `extra` are indented track-level production lines. */
function project(extra: string[] = []): string {
  return `${HEADER}
media
  sample tone sha256:${'0'.repeat(64)} media/tone.wav

track aud Aud #56b6c2 audio
${extra.map((l) => `  ${l}\n`).join('')}  clip c1
    audio tone 0 2 0 off 1
`
}

// ---- the key set -----------------------------------------------------------------------------

test('an audio track may carry exactly the production block + the 12 EffectType param groups', () => {
  const production = AUDIO_TRACK_PRODUCTION_FIELDS.map((f) => f.key)
  assert.deepEqual(production, ['volume', 'pan', 'cutoff', 'resonance', 'filterType', 'sendReverb', 'sendDelay'])

  // The effect half is DERIVED from EFFECT_PARAM_KEYS, not hand-listed — so adding an EffectType
  // widens the audio track's surface automatically and this assertion can't drift into a lie.
  const effectKeys = new Set(Object.values(EFFECT_PARAM_KEYS).flat() as string[])
  const carried = new Set(AUDIO_TRACK_FIELDS.map((f) => f.key as string))
  for (const k of effectKeys) assert.ok(carried.has(k), `audio tracks must carry the effect param "${k}"`)
  assert.equal(carried.size, effectKeys.size + production.length, 'nothing beyond the production block and the effect params')

  // The honest "does not apply" list from document.ts, asserted rather than only commented: an
  // audio region is not a note, so nothing per-note-modulated is settable on the track.
  for (const absent of ['osc', 'attack', 'decay', 'sustain', 'release', 'osc2Level', 'subLevel', 'noiseLevel', 'unisonVoices', 'lfoDepth', 'lfoDest', 'filterEnvAmount', 'keytrackAmount', 'velDest', 'duckAmount', 'duckSource', 'saturatorDrive', 'chorusMix', 'phaserMix', 'pingPongMix', 'glide']) {
    assert.equal(carried.has(absent), false, `"${absent}" must NOT be settable on an audio track`)
  }
})

// ---- the defaults (the backward-compatibility story) -------------------------------------------

test('audio-track defaults are the TRANSPARENT ones, not INIT_SYNTH’s', () => {
  const s = initAudioTrackSynth() as unknown as Record<string, unknown>
  assert.equal(s.volume, 0, 'unity, not INIT_SYNTH’s -10 dB — the old voice went straight to master')
  assert.equal(s.pan, 0)
  assert.equal(s.cutoff, 20000, 'wide open, not INIT_SYNTH’s 2 kHz — a 2 kHz default would gut every existing loop')
  assert.equal(s.resonance, 0, 'flat, not INIT_SYNTH’s 0.8')
  assert.equal(s.filterType, 'lowpass')
  assert.equal(s.sendReverb, 0)
  assert.equal(s.sendDelay, 0)

  // Both creation paths agree: addTrack and parse must produce the same starting patch, or a
  // GUI-created track and a hand-written one would sound different.
  const { doc } = addTrack(initDocument({ trackId: 'lead' }), { id: 'aud', kind: 'audio' })
  const built = doc.tracks.find((t) => t.id === 'aud')!
  assert.deepEqual(built.synth, initAudioTrackSynth())
  assert.deepEqual(built.effects, [], 'empty chain — an audio track never had a fixed insert order to preserve')
  assert.deepEqual(parse(project()).tracks[0]!.synth, initAudioTrackSynth())
})

test('an untouched audio track serializes NO production lines at all (canonical elision)', () => {
  const src = project()
  const doc = parse(src)
  assert.equal(serialize(doc), src, 'byte-identical round trip')
  for (const f of AUDIO_TRACK_FIELDS) {
    assert.equal(serialize(doc).includes(`\n  ${f.key} `), false, `${f.key} must stay elided at its default`)
  }
})

// ---- parse / serialize -------------------------------------------------------------------------

test('a fully produced audio track parses, renders its fields into track.synth, and round-trips', () => {
  const src = project([
    'volume -6',
    'pan -0.5',
    'cutoff 300',
    'resonance 2',
    'filterType highpass',
    'sendReverb 0.4',
    'sendDelay 0.2',
    'bitcrushBits 3',
    'bitcrushMix 1',
    'effect tape distortion',
    'effect vinyl vinylDistortion',
    'effect crush bitcrush',
  ])
  const doc = parse(src)
  const t = doc.tracks[0]!
  const s = t.synth as unknown as Record<string, unknown>
  assert.equal(s.volume, -6)
  assert.equal(s.pan, -0.5)
  assert.equal(s.cutoff, 300)
  assert.equal(s.resonance, 2)
  assert.equal(s.filterType, 'highpass')
  assert.equal(s.sendReverb, 0.4)
  assert.equal(s.sendDelay, 0.2)
  assert.equal(s.bitcrushBits, 3)
  // The mined degradation stack's own order (tape -> vinyl -> bitcrush) survives verbatim: file
  // order IS chain order, and nothing re-sorts it.
  assert.deepEqual(t.effects.map((e) => e.id), ['tape', 'vinyl', 'crush'])
  assert.equal(serialize(doc), src, 'byte-identical round trip')
})

test('production lines are ordered canonically on output regardless of input order', () => {
  const scrambled = project(['sendDelay 0.2', 'cutoff 300', 'volume -6'])
  const canonical = project(['volume -6', 'cutoff 300', 'sendDelay 0.2'])
  assert.equal(serialize(parse(scrambled)), canonical)
})

test('a field an audio track does not carry is rejected at parse time', () => {
  assert.throws(() => parse(project(['attack 0.5'])), BeatParseError)
  assert.throws(() => parse(project(['osc2Level 0.5'])), BeatParseError)
  assert.throws(() => parse(project(['volume -6', 'volume -3'])), /duplicate synth param/)
  assert.throws(() => parse(project(['pan 2'])), /pan must be -1\.\.1/)
  assert.throws(() => parse(project(['filterType notch'])), /filterType must be one of/)
  // An audio track still has NO `synth` block — the bare-line shape is the whole grammar, exactly
  // as for instrument tracks.
  assert.throws(() => parse(project(['synth'])), /audio tracks have no synth block/)
})

// ---- edit ---------------------------------------------------------------------------------------

test('beat set reaches every audio production field and refuses everything else', () => {
  let doc = parse(project())
  for (const f of AUDIO_TRACK_FIELDS) {
    const v = f.kind === 'number' ? '0.25' : f.kind === 'bool' ? 'true' : String(f.values![0])
    doc = setValue(doc, `aud.${String(f.key)}`, v)
  }
  assert.equal((doc.tracks[0]!.synth as unknown as Record<string, unknown>).cutoff, 0.25)
  assert.throws(() => setValue(doc, 'aud.attack', '0.5'), BeatEditError)
  assert.throws(() => setValue(doc, 'aud.osc', 'sine'), BeatEditError)
  assert.throws(() => setValue(doc, 'aud.pan', '2'), /pan must be -1\.\.1/)
  // The refusal names what IS available rather than just saying no.
  assert.throws(() => setValue(doc, 'aud.attack', '0.5'), /production params: volume, pan, cutoff/)
})

test('the effect-chain primitives all work on an audio track now (the lifted refusal)', () => {
  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead' }), { id: 'aud', kind: 'audio' })
  const { doc: a, effect } = addEffect(withTrack, 'aud', 'vinylDistortion')
  assert.equal(effect.id, 'vinylDistortion', 'no collision — an audio track starts from []')
  const { doc: b } = addEffect(a, 'aud', 'bitcrush')
  const { doc: c } = moveEffect(b, 'aud', 'bitcrush', 0)
  assert.deepEqual(c.tracks.find((t) => t.id === 'aud')!.effects.map((e) => e.id), ['bitcrush', 'vinylDistortion'])
  // ...and the result is a legal file that parses back to the same chain.
  assert.deepEqual(parse(serialize(c)).tracks.find((t) => t.id === 'aud')!.effects.map((e) => e.id), ['bitcrush', 'vinylDistortion'])
})

// Track 1a: the surge track kind + surge block — pure format tests (parse/serialize round-trip,
// canonical elision, edit path, semantic diff, validation). CI-SAFE: no surgepy, no sidecar, no
// render — a .beat with a surge track must load and edit on any machine (the surgepy/patch check
// is deferred to render time, tested separately in surge-track-render.test.ts).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse, serialize, setValue, addTrack, diffDocuments, formatDiff, BeatParseError } from '../src/core/index.js'

const SURGE_DOC = `format_version 0.11
bpm 120
loop_bars 2
selected_track lead

track lead Lead #e06c75 surge
  surge
    patch "Formant Pulse"
    sampleRate 48000
    override cutoff 0.62
    override resonance 0.3
  synth
    osc sawtooth
    volume -8
    cutoff 2000
    resonance 0.8
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
    sendReverb 0.2
  note u1 61 0 4 0.8
  note u2 64 4 4 0.8
`

test('surge track: byte-identical round-trip of a canonical document', () => {
  const doc = parse(SURGE_DOC)
  assert.equal(serialize(doc), SURGE_DOC, 'serialize(parse(x)) === x for a canonical surge doc')
  // and stable under a second pass
  assert.equal(serialize(parse(serialize(doc))), SURGE_DOC)
})

test('surge track: parses the sound-source block onto track.surge, notes stay ordinary', () => {
  const t = parse(SURGE_DOC).tracks[0]!
  assert.equal(t.kind, 'surge')
  assert.equal(t.surge!.patch, 'Formant Pulse')
  assert.equal(t.surge!.sampleRate, 48000)
  assert.deepEqual(t.surge!.overrides, [{ param: 'cutoff', value: 0.62 }, { param: 'resonance', value: 0.3 }])
  assert.equal(t.notes.length, 2)
  // the synth production block still applies
  assert.equal(t.synth.volume, -8)
  assert.equal(t.synth.sendReverb, 0.2)
})

test('surge track: sampleRate 44100 and empty overrides are elided (canonical form)', () => {
  const doc = parse(`format_version 0.11
bpm 120
loop_bars 1
selected_track lead

track lead Lead #e06c75 surge
  surge
    patch "Init Saw"
    sampleRate 44100
  synth
    osc sawtooth
    volume -10
    cutoff 2000
    resonance 0.8
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
`)
  const out = serialize(doc)
  assert.ok(!out.includes('sampleRate'), 'the default 44100 sample rate is elided')
  assert.ok(!out.includes('override'), 'no override lines when there are none')
  assert.match(out, /patch "Init Saw"/)
})

test('surge track: a bare (unquoted) patch name canonicalizes to quoted; input order of overrides normalizes', () => {
  const doc = parse(`format_version 0.11
bpm 120
loop_bars 1
selected_track lead

track lead Lead #e06c75 surge
  surge
    patch Init Saw
    override resonance 0.3
    override cutoff 0.62
  synth
    osc sawtooth
    volume -10
    cutoff 2000
    resonance 0.8
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
`)
  const out = serialize(doc)
  assert.match(out, /patch "Init Saw"/, 'bare patch name re-serializes quoted')
  // overrides serialize sorted by param name regardless of input order (one canonical form)
  const overrideLines = out.split('\n').filter((l) => l.includes('override'))
  assert.deepEqual(overrideLines, ['    override cutoff 0.62', '    override resonance 0.3'])
})

test('surge track: a missing synth block defaults to INIT production and re-emits it (liberal in, strict out)', () => {
  const doc = parse(`format_version 0.11
bpm 120
loop_bars 1
selected_track lead

track lead Lead #e06c75 surge
  surge
    patch "Init Saw"
  note u1 60 0 4 0.8
`)
  const t = doc.tracks[0]!
  assert.equal(t.synth.volume, -10, 'INIT_SYNTH default volume')
  assert.match(serialize(doc), /  synth\n/, 'a canonical surge track always emits its synth production block')
})

// --- validation (fail loudly at parse for structural errors; NEVER for surgepy/patch availability) ---

test('surge track: a surge block without a patch line is rejected', () => {
  assert.throws(
    () => parse(`format_version 0.11
bpm 120
loop_bars 1
selected_track lead

track lead Lead #e06c75 surge
  surge
    sampleRate 44100
  synth
    osc sawtooth
    volume -10
    cutoff 2000
    resonance 0.8
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
`),
    (err) => err instanceof BeatParseError && /missing its patch/.test(err.message),
  )
})

test('surge track: a surge track without a surge block is rejected', () => {
  assert.throws(
    () => parse(`format_version 0.11
bpm 120
loop_bars 1
selected_track lead

track lead Lead #e06c75 surge
  synth
    osc sawtooth
    volume -10
    cutoff 2000
    resonance 0.8
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
`),
    (err) => err instanceof BeatParseError && /missing its surge block/.test(err.message),
  )
})

test('surge block: only allowed on surge tracks; only patch/sampleRate/override inside', () => {
  const synthWithSurge = `format_version 0.11
bpm 120
loop_bars 1
selected_track lead

track lead Lead #e06c75 synth
  surge
    patch "Init Saw"
  synth
    osc sawtooth
    volume -10
    cutoff 2000
    resonance 0.8
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
`
  assert.throws(() => parse(synthWithSurge), (err) => err instanceof BeatParseError && /only belong in surge tracks/.test(err.message))

  const badKey = SURGE_DOC.replace('    override cutoff 0.62', '    nonsense 0.5')
  assert.throws(() => parse(badKey), (err) => err instanceof BeatParseError && /inside a surge block/.test(err.message))
})

test('surge block: an out-of-range override value and a duplicate override are rejected', () => {
  const outOfRange = SURGE_DOC.replace('    override cutoff 0.62', '    override cutoff 1.5')
  assert.throws(() => parse(outOfRange), (err) => err instanceof BeatParseError && /normalized 0\.\.1/.test(err.message))
  const dup = SURGE_DOC.replace('    override resonance 0.3', '    override cutoff 0.4')
  assert.throws(() => parse(dup), (err) => err instanceof BeatParseError && /duplicate override/.test(err.message))
})

// --- edit path ---

test('setValue: surge.patch / surge.sampleRate / surge.override.<param> through the standard edit path', () => {
  let doc = parse(SURGE_DOC)
  doc = setValue(doc, 'lead.surge.patch', 'Acidofil')
  doc = setValue(doc, 'lead.surge.sampleRate', '44100')
  doc = setValue(doc, 'lead.surge.override.cutoff', '0.4')
  const s = doc.tracks[0]!.surge!
  assert.equal(s.patch, 'Acidofil')
  assert.equal(s.sampleRate, 44100)
  assert.equal(s.overrides.find((o) => o.param === 'cutoff')!.value, 0.4)
  // clearing an override with an empty value removes it
  doc = setValue(doc, 'lead.surge.override.cutoff', '')
  assert.ok(!doc.tracks[0]!.surge!.overrides.some((o) => o.param === 'cutoff'))
  // production fields still route to the synth block on a surge track
  doc = setValue(doc, 'lead.volume', '-5')
  assert.equal(doc.tracks[0]!.synth.volume, -5)
})

test('setValue: surge.* addresses are rejected on non-surge tracks', () => {
  const doc = parse(`format_version 0.11
bpm 120
loop_bars 1
selected_track bass

track bass Bass #61afef synth
  synth
    osc square
    volume -10
    cutoff 1200
    resonance 0.5
    attack 0.01
    decay 0.2
    sustain 0.5
    release 0.2
    pan 0
`)
  assert.throws(() => setValue(doc, 'bass.surge.patch', 'Init Saw'), /no surge block/)
  assert.throws(() => setValue(doc, 'bass.surge.override.cutoff', '0.5'), /no surge block/)
})

test('addTrack: a surge track requires a patch and starts with INIT production + default effect chain', () => {
  const base = parse(`format_version 0.11
bpm 120
loop_bars 1
selected_track a

track a A #e06c75 synth
  synth
    osc sawtooth
    volume -10
    cutoff 2000
    resonance 0.8
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
`)
  assert.throws(() => addTrack(base, { id: 'lead', kind: 'surge' }), /surge tracks need a patch/)
  const { doc, track } = addTrack(base, { id: 'lead', kind: 'surge', surge: { patch: 'Formant Pulse' } })
  assert.equal(track.kind, 'surge')
  assert.equal(track.surge!.patch, 'Formant Pulse')
  assert.equal(track.surge!.sampleRate, 44100)
  // round-trips
  assert.equal(serialize(parse(serialize(doc))), serialize(doc))
})

// --- semantic diff ---

test('diff: a patch swap, an override change, and a production edit read as clean one-line facts', () => {
  const before = parse(SURGE_DOC)
  let after = setValue(before, 'lead.surge.patch', 'Acidofil')
  after = setValue(after, 'lead.surge.override.cutoff', '0.4')
  after = setValue(after, 'lead.surge.override.resonance', '') // remove
  after = setValue(after, 'lead.volume', '-6')
  const text = formatDiff(diffDocuments(before, after))
  assert.match(text, /lead: surge\.patch Formant Pulse -> Acidofil/)
  assert.match(text, /lead: surge\.override\.cutoff 0\.62 -> 0\.4/)
  assert.match(text, /lead: surge\.override\.resonance 0\.3 -> \(none\)/)
  assert.match(text, /lead: volume -8 -> -6/)
})

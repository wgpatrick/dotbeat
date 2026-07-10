import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse, serialize, BeatParseError, defaultSynthFields, type BeatDocument } from '../src/core/index.js'

const WORKED_EXAMPLE = `format_version 0.2
bpm 124
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
  synth
    osc square
    volume -14
    cutoff 4500
    resonance 0.8
    attack 0.01
    decay 0.3
    sustain 0.2
    release 0.4
    pan 0
  note n100000 64 0 2 0.8
  note n100001 67 2 2 0.8
  note n100002 71 4 4 0.72
`

// Fixture body reused by drum tests: a complete synth block at 4-space indent.
const SYNTH_BLOCK = `  synth
    osc sine
    volume 0
    cutoff 1000
    resonance 1
    attack 0.01
    decay 0.1
    sustain 0.5
    release 0.1
    pan 0`

const DRUM_EXAMPLE = `format_version 0.2
bpm 124
loop_bars 4
selected_track drums

track drums Drums #e35d5d drums
${SYNTH_BLOCK}
  pattern kick 0.9 0 0 0 0.9 0 0 0 0.9 0 0 0 0.9 0 0 0
  pattern snare 0 0 0 0 0.8 0 0 0 0 0 0 0 0.8 0 0 0
  pattern clap 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
  pattern hat 0 0 0.6 0 0 0 0.6 0 0 0 0.6 0 0 0 0.6 0
  pattern openhat 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.5 0
`

test('parses the worked example from format-spec.md into the expected shape', () => {
  const doc = parse(WORKED_EXAMPLE)
  assert.equal(doc.formatVersion, '0.2')
  assert.equal(doc.bpm, 124)
  assert.equal(doc.loopBars, 1)
  assert.equal(doc.selectedTrack, 'lead')
  assert.equal(doc.tracks.length, 1)
  const lead = doc.tracks[0]!
  assert.equal(lead.id, 'lead')
  assert.equal(lead.name, 'Lead')
  assert.equal(lead.color, '#c678dd')
  assert.equal(lead.kind, 'synth')
  assert.deepEqual(lead.synth, {
    osc: 'square',
    volume: -14,
    cutoff: 4500,
    resonance: 0.8,
    attack: 0.01,
    decay: 0.3,
    sustain: 0.2,
    release: 0.4,
    pan: 0,
    ...defaultSynthFields(), // v0.3: elided optional fields parse as their canonical defaults
  })
  assert.equal(lead.notes.length, 3)
  assert.deepEqual(lead.notes[0], { id: 'n100000', pitch: 64, start: 0, duration: 2, velocity: 0.8 })
})

test('serialize(parse(x)) === x for the worked example (byte-identical round trip)', () => {
  const doc = parse(WORKED_EXAMPLE)
  assert.equal(serialize(doc), WORKED_EXAMPLE)
})

test('serialize(parse(x)) === x for a drum track (byte-identical round trip)', () => {
  const doc = parse(DRUM_EXAMPLE)
  const drums = doc.tracks[0]!
  assert.equal(drums.kind, 'drums')
  assert.equal(drums.pattern!.kick.length, 16)
  assert.equal(drums.pattern!.kick[0], 0.9)
  assert.equal(drums.notes.length, 0)
  assert.equal(serialize(doc), DRUM_EXAMPLE)
})

test('canonical note sort: notes out of order in the source still serialize sorted by (start, pitch, id)', () => {
  const shuffled = `format_version 0.2
bpm 100
loop_bars 1
selected_track a

track a A #ffffff synth
${SYNTH_BLOCK}
  note n3 60 4 1 0.5
  note n1 60 0 1 0.5
  note n2 64 0 1 0.5
`
  const doc = parse(shuffled)
  const canonical = serialize(doc)
  const noteLines = canonical.split('\n').filter((l) => l.startsWith('  note'))
  assert.deepEqual(noteLines, [
    '  note n1 60 0 1 0.5',
    '  note n2 64 0 1 0.5',
    '  note n3 60 4 1 0.5',
  ])
})

test('parse(serialize(doc)) deep-equals doc for a hand-built multi-track document', () => {
  const doc: BeatDocument = {
    formatVersion: '0.2',
    bpm: 140,
    loopBars: 2,
    selectedTrack: 'bass',
    tracks: [
      {
        id: 'bass',
        name: 'Bass',
        color: '#56b6c2',
        kind: 'synth',
        synth: { osc: 'sawtooth', volume: -8, cutoff: 700, resonance: 0.8, attack: 0.005, decay: 0.25, sustain: 0.3, release: 0.15, pan: 0, ...defaultSynthFields() },
        laneSamples: {},
        clips: [],
        notes: [
          { id: 'u1', pitch: 33, start: 0, duration: 2, velocity: 0.8 },
          { id: 'u2', pitch: 33, start: 4, duration: 2, velocity: 0.8 },
        ],
      },
      {
        id: 'drums',
        name: 'Drums',
        color: '#e35d5d',
        kind: 'drums',
        synth: { osc: 'sawtooth', volume: -10, cutoff: 9000, resonance: 0.8, attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.3, pan: 0, ...defaultSynthFields() },
        laneSamples: {},
        clips: [],
        notes: [],
        pattern: {
          kick: [0.9, 0, 0, 0],
          snare: [0, 0, 0.8, 0],
          clap: [0, 0, 0, 0],
          hat: [0.5, 0.5, 0.5, 0.5],
          openhat: [0, 0, 0, 0.4],
        },
      },
    ],
    media: [],
    scenes: [],
    song: null,
  }
  const round = parse(serialize(doc))
  assert.deepEqual(round, doc)
})

test('formatNumber stabilizes floating-point noise so round-tripping is idempotent', () => {
  const doc: BeatDocument = {
    formatVersion: '0.2',
    bpm: 120,
    loopBars: 1,
    selectedTrack: 't',
    tracks: [
      {
        id: 't',
        name: 'T',
        color: '#000000',
        kind: 'synth',
        synth: {
          osc: 'sine',
          volume: 0.1 + 0.2, // classic float noise -> 0.30000000000000004
          cutoff: 1000,
          resonance: 1,
          attack: 0.01,
          decay: 0.1,
          sustain: 0.5,
          release: 0.1,
          pan: 0,
          ...defaultSynthFields(),
        },
        laneSamples: {},
        clips: [],
        notes: [],
      },
    ],
    media: [],
    scenes: [],
    song: null,
  }
  const text = serialize(doc)
  assert.match(text, /volume 0\.3\n/)
  // second pass through parse+serialize must be a no-op (idempotent canonical form)
  assert.equal(serialize(parse(text)), text)
})

test('a single synth-param edit produces exactly one changed line', () => {
  const before = parse(WORKED_EXAMPLE)
  const beforeTrack = before.tracks[0]!
  const after: BeatDocument = { ...before, tracks: [{ ...beforeTrack, synth: { ...beforeTrack.synth, cutoff: 900 } }] }
  const beforeLines = serialize(before).split('\n')
  const afterLines = serialize(after).split('\n')
  assert.equal(beforeLines.length, afterLines.length)
  const changed = beforeLines.filter((l, i) => l !== afterLines[i])
  assert.deepEqual(changed, ['    cutoff 4500'])
})

test('a single drum-step toggle produces exactly one changed line', () => {
  const before = parse(DRUM_EXAMPLE)
  const drums = before.tracks[0]!
  const kick = [...drums.pattern!.kick]
  kick[2] = 0.7 // add a kick on the 3rd step
  const after: BeatDocument = { ...before, tracks: [{ ...drums, pattern: { ...drums.pattern!, kick } }] }
  const beforeLines = serialize(before).split('\n')
  const afterLines = serialize(after).split('\n')
  assert.equal(beforeLines.length, afterLines.length) // all 5 lanes always emitted — no line count change
  const changed = beforeLines.filter((l, i) => l !== afterLines[i])
  assert.equal(changed.length, 1)
  assert.match(changed[0]!, /^ {2}pattern kick /)
})

test('rejects malformed indentation', () => {
  assert.throws(() => parse('format_version 0.2\nbpm 120\nloop_bars 1\nselected_track a\n\n track a A #ffffff synth\n'), BeatParseError)
})

test('rejects a synth block missing a required param', () => {
  const bad = `format_version 0.2
bpm 120
loop_bars 1
selected_track a

track a A #ffffff synth
  synth
    osc sine
    volume 0
    cutoff 1000
    resonance 1
    attack 0.01
    decay 0.1
    sustain 0.5
`
  assert.throws(() => parse(bad), /missing required param\(s\): release, pan/)
})

test('rejects an invalid color', () => {
  const bad = 'format_version 0.2\nbpm 120\nloop_bars 1\nselected_track a\n\ntrack a A red synth\n'
  assert.throws(() => parse(bad), BeatParseError)
})

test('rejects an unknown track kind', () => {
  const bad = 'format_version 0.2\nbpm 120\nloop_bars 1\nselected_track a\n\ntrack a A #ffffff sampler\n'
  assert.throws(() => parse(bad), /kind must be one of synth\|drums/)
})

test('rejects an out-of-range pitch', () => {
  const bad = `format_version 0.2
bpm 120
loop_bars 1
selected_track a

track a A #ffffff synth
${SYNTH_BLOCK}
  note n1 200 0 1 0.5
`
  assert.throws(() => parse(bad), /pitch must be 0-127/)
})

test('rejects a duplicate track id', () => {
  const bad = `format_version 0.2
bpm 120
loop_bars 1
selected_track a

track a A #ffffff synth
${SYNTH_BLOCK}

track a A2 #ffffff synth
${SYNTH_BLOCK}
`
  assert.throws(() => parse(bad), /duplicate track id/)
})

test('rejects a note line inside a drum track', () => {
  const bad = `format_version 0.2
bpm 120
loop_bars 1
selected_track d

track d D #ffffff drums
${SYNTH_BLOCK}
  note n1 60 0 1 0.5
`
  assert.throws(() => parse(bad), /note lines only belong in synth tracks/)
})

test('rejects a pattern line inside a synth track', () => {
  const bad = `format_version 0.2
bpm 120
loop_bars 1
selected_track a

track a A #ffffff synth
${SYNTH_BLOCK}
  pattern kick 0.9 0 0 0
`
  assert.throws(() => parse(bad), /pattern lines only belong in drum tracks/)
})

test('rejects a drum track missing a lane', () => {
  const bad = `format_version 0.2
bpm 120
loop_bars 1
selected_track d

track d D #ffffff drums
${SYNTH_BLOCK}
  pattern kick 0.9 0 0 0
  pattern snare 0 0 0.8 0
  pattern clap 0 0 0 0
  pattern hat 0.5 0.5 0.5 0.5
`
  assert.throws(() => parse(bad), /missing pattern lane\(s\): openhat/)
})

test('rejects unequal pattern lane lengths', () => {
  const bad = `format_version 0.2
bpm 120
loop_bars 1
selected_track d

track d D #ffffff drums
${SYNTH_BLOCK}
  pattern kick 0.9 0 0 0
  pattern snare 0 0 0.8 0
  pattern clap 0 0 0 0
  pattern hat 0.5 0.5 0.5 0.5
  pattern openhat 0 0 0
`
  assert.throws(() => parse(bad), /unequal length/)
})

test('rejects a pattern velocity out of 0..1', () => {
  const bad = `format_version 0.2
bpm 120
loop_bars 1
selected_track d

track d D #ffffff drums
${SYNTH_BLOCK}
  pattern kick 0.9 0 0 2
  pattern snare 0 0 0.8 0
  pattern clap 0 0 0 0
  pattern hat 0.5 0.5 0.5 0.5
  pattern openhat 0 0 0 0
`
  assert.throws(() => parse(bad), /velocities must be 0\.\.1/)
})

test('full-line comments are ignored and never re-emitted', () => {
  const withComment = `# a helpful comment
format_version 0.2
bpm 120
loop_bars 1
selected_track a

# another comment
track a A #ffffff synth
${SYNTH_BLOCK}
`
  const doc = parse(withComment)
  assert.equal(doc.tracks.length, 1)
  const out = serialize(doc)
  assert.ok(!out.includes('helpful comment'))
  assert.ok(!out.includes('another comment'))
})

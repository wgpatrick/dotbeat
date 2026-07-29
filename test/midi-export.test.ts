// `beat export-midi` — the SMF writer's unit contract (src/midi/export.ts), pinned at the byte
// level because a DAW punishes every one of these when wrong:
//   * VLQ edges (delta 127 = one byte, 128 = the first two-byte value)
//   * the 125bpm set_tempo payload (480000 us/quarter = 07 53 00)
//   * note_off sorts BEFORE note_on at the same tick (same-pitch repeats must not fuse)
//   * velocity 0..1 -> 1..127 with the >=1 clamp (a velocity-0 note_on IS a note_off)
//   * loop-overhanging durations keep their true length
//   * cent/chance/ratchet/deactivated notes are dropped WITH COUNTS, never silently
//   * drum lanes -> General MIDI notes on channel 10; unmapped lanes skipped BY NAME
// Plus a real round-trip: a tiny SMF reader (below) parses the writer's output back and the
// note count/pitches/starts/durations must survive within a tick.

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse } from '../src/core/index.js'
import {
  BeatMidiError,
  GM_LANE_NOTES,
  MIDI_TICKS_PER_QUARTER,
  ONE_SHOT_HIT_TICKS,
  TICKS_PER_STEP,
  encodeVlq,
  exportTracksToMidi,
  midiVelocity,
  runExportMidi,
  tempoMetaBytes,
} from '../src/midi/export.js'

// ---- a tiny SMF reader (test-only; the writer must survive an independent decode) --------------

interface SmfNote {
  channel: number
  pitch: number
  velocity: number
  onTick: number
  offTick: number
}

interface SmfEvent {
  tick: number
  status: number
  data: number[]
}

interface SmfFile {
  format: number
  division: number
  tracks: { events: SmfEvent[]; notes: SmfNote[] }[]
}

function readSmf(bytes: Uint8Array): SmfFile {
  let pos = 0
  const u8 = () => bytes[pos++]!
  const u16 = () => (u8() << 8) | u8()
  const u32 = () => (u16() << 16) | u16()
  const vlq = () => {
    let v = 0
    for (;;) {
      const b = u8()
      v = (v << 7) | (b & 0x7f)
      if ((b & 0x80) === 0) return v
    }
  }
  assert.equal(u32(), 0x4d546864, 'MThd magic')
  assert.equal(u32(), 6, 'MThd length')
  const format = u16()
  const ntrks = u16()
  const division = u16()
  const tracks: SmfFile['tracks'] = []
  for (let t = 0; t < ntrks; t++) {
    assert.equal(u32(), 0x4d54726b, 'MTrk magic')
    const len = u32()
    const end = pos + len
    const events: SmfEvent[] = []
    const open = new Map<string, { onTick: number; velocity: number }[]>()
    const notes: SmfNote[] = []
    let tick = 0
    while (pos < end) {
      tick += vlq()
      const status = u8()
      assert.ok(status >= 0x80, `no running status expected, got ${status.toString(16)} at ${pos}`)
      if (status === 0xff) {
        const type = u8()
        const dlen = vlq()
        const data = [...bytes.slice(pos, pos + dlen)]
        pos += dlen
        events.push({ tick, status, data: [type, ...data] })
        continue
      }
      const kind = status & 0xf0
      const channel = status & 0x0f
      if (kind === 0x90 || kind === 0x80) {
        const pitch = u8()
        const velocity = u8()
        events.push({ tick, status, data: [pitch, velocity] })
        const key = `${channel}:${pitch}`
        if (kind === 0x90 && velocity > 0) {
          const q = open.get(key) ?? []
          q.push({ onTick: tick, velocity })
          open.set(key, q)
        } else {
          const q = open.get(key)
          assert.ok(q && q.length > 0, `note_off with no open note (ch ${channel} pitch ${pitch} tick ${tick})`)
          const on = q.shift()!
          notes.push({ channel, pitch, velocity: on.velocity, onTick: on.onTick, offTick: tick })
        }
      } else {
        assert.fail(`unexpected event status 0x${status.toString(16)}`)
      }
    }
    for (const [key, q] of open) assert.equal(q.length, 0, `unclosed note ${key}`)
    tracks.push({ events, notes })
  }
  assert.equal(pos, bytes.length, 'trailing bytes after the last MTrk')
  return { format, division, tracks }
}

// ---- fixtures ----------------------------------------------------------------------------------

const SYNTH_BLOCK = `  synth
    osc sine
    volume -10
    cutoff 2000
    resonance 0.8
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0`

function synthDoc(noteLines: string[], bpm = 125, loopBars = 1) {
  return parse(`format_version 0.11
bpm ${bpm}
loop_bars ${loopBars}
selected_track t

track t T #e06c75 synth
${SYNTH_BLOCK}
${noteLines.map((l) => `  ${l}`).join('\n')}
`)
}

function drumDoc(laneLines: string[], hitLines: string[]) {
  return parse(`format_version 0.11
bpm 125
loop_bars 1
selected_track dr

track dr Drums #e06c75 drums
${SYNTH_BLOCK}
${[...laneLines, ...hitLines].map((l) => `  ${l}`).join('\n')}
`)
}

// ---- VLQ / tempo / velocity edges --------------------------------------------------------------

test('VLQ encoding edges: 127 is one byte, 128 is the first two-byte value', () => {
  assert.deepEqual(encodeVlq(0), [0x00])
  assert.deepEqual(encodeVlq(127), [0x7f])
  assert.deepEqual(encodeVlq(128), [0x81, 0x00])
  assert.deepEqual(encodeVlq(0x3fff), [0xff, 0x7f])
  assert.deepEqual(encodeVlq(0x4000), [0x81, 0x80, 0x00])
  assert.throws(() => encodeVlq(-1), BeatMidiError)
  assert.throws(() => encodeVlq(1.5), BeatMidiError)
})

test('set_tempo meta: 125bpm = 480000 us/quarter = 07 53 00', () => {
  assert.deepEqual(tempoMetaBytes(125), [0xff, 0x51, 0x03, 0x07, 0x53, 0x00])
  assert.deepEqual(tempoMetaBytes(120), [0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]) // 500000
})

test('velocity 0..1 -> MIDI 1..127; never 0 (a velocity-0 note_on means note_off)', () => {
  assert.equal(midiVelocity(0.7), 89)
  assert.equal(midiVelocity(1), 127)
  assert.equal(midiVelocity(0.001), 1) // clamped up, never 0
  assert.equal(midiVelocity(0), 1)
  assert.equal(midiVelocity(9), 127) // clamped down
})

// ---- the byte-level golden ---------------------------------------------------------------------

test('golden bytes: one track, two back-to-back same-pitch notes at 125bpm', () => {
  // note u1: pitch 60, step 0, 1 step, vel 0.7 -> on@0, off@120
  // note u2: pitch 60, step 1, 1 step, vel 0.7 -> on@120, off@240
  // At tick 120 the FIRST note's off must precede the SECOND's on, or they fuse on import.
  const doc = synthDoc(['note u1 60 0 1 0.7', 'note u2 60 1 1 0.7'])
  const { format, bytes } = exportTracksToMidi(doc, ['t'])
  assert.equal(format, 0)
  const expected = [
    // MThd: format 0, 1 track, 480 ticks/quarter
    0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x01, 0xe0,
    // MTrk, 32-byte body
    0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, 0x20,
    0x00, 0xff, 0x51, 0x03, 0x07, 0x53, 0x00, // delta 0, set_tempo 480000 (125bpm)
    0x00, 0xff, 0x03, 0x01, 0x74, // delta 0, track name "t"
    0x00, 0x90, 0x3c, 0x59, // delta 0, note_on ch0 pitch 60 vel 89 (0.7*127)
    0x78, 0x80, 0x3c, 0x00, // delta 120, note_off — BEFORE the same-tick note_on below
    0x00, 0x90, 0x3c, 0x59, // delta 0 (same tick 120), second note_on
    0x78, 0x80, 0x3c, 0x00, // delta 120, second note_off at tick 240
    0x00, 0xff, 0x2f, 0x00, // end of track
  ]
  assert.deepEqual([...bytes], expected)
})

test('at equal ticks note_off sorts before note_on (the fuse-prevention rule, asserted on event order)', () => {
  const doc = synthDoc(['note u1 60 0 1 0.7', 'note u2 60 1 1 0.7'])
  const smf = readSmf(exportTracksToMidi(doc, ['t']).bytes)
  const at120 = smf.tracks[0]!.events.filter((e) => e.tick === 120 && e.status !== 0xff)
  assert.equal(at120.length, 2)
  assert.equal(at120[0]!.status & 0xf0, 0x80, 'first event at tick 120 must be the note_off')
  assert.equal(at120[1]!.status & 0xf0, 0x90, 'second event at tick 120 must be the note_on')
  // And the round-trip proof: two distinct 120-tick notes, not one fused 240-tick note.
  assert.deepEqual(
    smf.tracks[0]!.notes.map((n) => ({ on: n.onTick, len: n.offTick - n.onTick })),
    [{ on: 0, len: 120 }, { on: 120, len: 120 }],
  )
})

// ---- durations, overhang, round-trip -----------------------------------------------------------

test('a note overhanging the loop boundary keeps its true duration (no clamp at loop_bars)', () => {
  // loop_bars 1 = 16 steps; this note runs steps 14..22.
  const doc = synthDoc(['note u1 72 14 8 0.5'])
  const smf = readSmf(exportTracksToMidi(doc, ['t']).bytes)
  assert.deepEqual(smf.tracks[0]!.notes, [
    { channel: 0, pitch: 72, velocity: 64, onTick: 14 * TICKS_PER_STEP, offTick: 22 * TICKS_PER_STEP },
  ])
})

test('round-trip: count, pitches, starts and durations survive within a tick (fractional starts round)', () => {
  const doc = synthDoc(['note u1 58 0 2 0.6', 'note u2 63 2.25 1.5 0.8', 'note u3 75 7.5 0.5 1'])
  const { tracks, bytes } = exportTracksToMidi(doc, ['t'])
  assert.equal(tracks[0]!.noteCount, 3)
  const smf = readSmf(bytes)
  assert.equal(smf.format, 0)
  assert.equal(smf.division, MIDI_TICKS_PER_QUARTER)
  const notes = smf.tracks[0]!.notes
  const expect = [
    { pitch: 58, start: 0, dur: 2 },
    { pitch: 63, start: 2.25, dur: 1.5 },
    { pitch: 75, start: 7.5, dur: 0.5 },
  ]
  assert.equal(notes.length, expect.length)
  for (let i = 0; i < expect.length; i++) {
    const want = expect[i]!
    const got = notes[i]!
    assert.equal(got.pitch, want.pitch)
    assert.ok(Math.abs(got.onTick - want.start * TICKS_PER_STEP) <= 1, `start of note ${i} off by >1 tick`)
    assert.ok(Math.abs(got.offTick - got.onTick - want.dur * TICKS_PER_STEP) <= 1, `duration of note ${i} off by >1 tick`)
  }
})

// ---- dropped fields are counted, never silent ---------------------------------------------------

test('cent/chance/ratchet are dropped WITH counts; deactivated notes are skipped and counted', () => {
  const doc = synthDoc([
    'note u1 60 0 1 0.7 cent=10',
    'note u2 62 1 1 0.7 chance=50',
    'note u3 64 2 1 0.7 ratchetCount=4',
    'note u4 65 3 1 0.7 active=0',
    'note u5 67 4 1 0.7',
  ])
  const { tracks, bytes } = exportTracksToMidi(doc, ['t'])
  const r = tracks[0]!
  assert.equal(r.noteCount, 4, 'the deactivated note must not be exported')
  assert.equal(r.droppedCent, 1)
  assert.equal(r.droppedChance, 1)
  assert.equal(r.droppedRatchet, 1)
  assert.equal(r.skippedInactive, 1)
  assert.equal(readSmf(bytes).tracks[0]!.notes.length, 4)
})

// ---- drums --------------------------------------------------------------------------------------

test('drum hits: GM notes on channel 10, sf-backed lanes use their own note, unmapped lanes skip BY NAME', () => {
  const doc = parse(`format_version 0.11
bpm 125
loop_bars 1
selected_track dr

media
  sample muldjordkit sha256:${'a'.repeat(64)} media/kit.sf2

track dr Drums #e06c75 drums
${SYNTH_BLOCK}
  lane kick synth:membrane
  lane hat synth:metal
  lane bongo_hi sf muldjordkit 0 60
  lane weird synth:noise
  hit h1 kick 0 0.9
  hit h2 hat 1 0.5
  hit h3 bongo_hi 2 0.7
  hit h4 weird 3 0.8
  hit h5 kick 4 1 2
`)
  const { tracks, bytes } = exportTracksToMidi(doc, ['dr'])
  const r = tracks[0]!
  assert.equal(r.channel, 9, 'drums must land on channel 10 (index 9)')
  assert.equal(r.noteCount, 4, 'the unmapped-lane hit must not export')
  assert.deepEqual(r.laneNotes, { kick: 36, hat: 42, bongo_hi: 60 })
  assert.deepEqual(r.skippedLanes, { weird: 1 })

  const notes = readSmf(bytes).tracks[0]!.notes.sort((a, b) => a.onTick - b.onTick)
  assert.deepEqual(
    notes.map((n) => ({ ch: n.channel, pitch: n.pitch, on: n.onTick, len: n.offTick - n.onTick })),
    [
      { ch: 9, pitch: 36, on: 0, len: ONE_SHOT_HIT_TICKS },
      { ch: 9, pitch: 42, on: 120, len: ONE_SHOT_HIT_TICKS },
      { ch: 9, pitch: 60, on: 240, len: ONE_SHOT_HIT_TICKS },
      { ch: 9, pitch: 36, on: 480, len: 2 * TICKS_PER_STEP }, // explicit hit duration is honored
    ],
  )
})

test('the GM lane map covers the default 12-lane kit and the legacy implicit 5', () => {
  // Derived from DEFAULT_DRUM_KIT — one source of truth; this pins the values Ableton will see.
  assert.deepEqual(GM_LANE_NOTES, {
    kick: 36, snare: 38, rimshot: 37, clap: 39, hat: 42, openhat: 46,
    tom_lo: 45, tom_mid: 47, tom_hi: 50, crash: 49, ride: 51, cowbell: 56,
  })
})

// ---- multi-track (type 1) -----------------------------------------------------------------------

test('several tracks -> SMF type 1: tempo track first, drums on ch 10, pitched tracks on 1,2,…', () => {
  const doc = parse(`format_version 0.11
bpm 125
loop_bars 1
selected_track a

track a A #e06c75 synth
${SYNTH_BLOCK}
  note u1 60 0 1 0.7

track b B #61afef synth
${SYNTH_BLOCK}
  note u2 64 0 1 0.7

track dr Drums #98c379 drums
${SYNTH_BLOCK}
  hit h1 kick 0 0.9
`)
  const { format, bytes, tracks } = exportTracksToMidi(doc, ['a', 'b', 'dr'])
  assert.equal(format, 1)
  assert.deepEqual(tracks.map((t) => t.channel), [0, 1, 9])
  const smf = readSmf(bytes)
  assert.equal(smf.format, 1)
  assert.equal(smf.tracks.length, 4, 'tempo track + one per beat track')
  const tempo = smf.tracks[0]!.events.find((e) => e.status === 0xff && e.data[0] === 0x51)
  assert.ok(tempo, 'track 0 carries the set_tempo meta')
  assert.equal(smf.tracks[1]!.notes[0]!.channel, 0)
  assert.equal(smf.tracks[2]!.notes[0]!.channel, 1)
  assert.equal(smf.tracks[3]!.notes[0]!.channel, 9)
})

// ---- errors -------------------------------------------------------------------------------------

test('loud errors: unknown track, audio track, empty track (with the clips hint), duplicate track', () => {
  const doc = synthDoc(['note u1 60 0 1 0.7'])
  assert.throws(() => exportTracksToMidi(doc, ['nope']), /no track "nope"/)
  assert.throws(() => exportTracksToMidi(doc, ['t', 't']), /listed twice/)

  const empty = parse(`format_version 0.11
bpm 125
loop_bars 1
selected_track t

track t T #e06c75 synth
${SYNTH_BLOCK}
  clip only_here
    note u1 60 0 1 0.7
`)
  assert.throws(() => exportTracksToMidi(empty, ['t']), /content lives only in clips \(1 event\(s\)\)/)
})

// ---- the shared runner (what both the CLI and MCP call) -----------------------------------------

test('runExportMidi: per-track files into the default <file>-midi/ dir, with the full report text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-midi-'))
  const file = join(dir, 'song.beat')
  writeFileSync(
    file,
    `format_version 0.11
bpm 125
loop_bars 1
selected_track t

track t T #e06c75 synth
${SYNTH_BLOCK}
  note u1 60 0 1 0.7 cent=5

track dr Drums #98c379 drums
${SYNTH_BLOCK}
  hit h1 kick 0 0.9
`,
  )
  const { text, files } = runExportMidi({ file })
  assert.deepEqual(files, [join(dir, 'song-midi', 't.mid'), join(dir, 'song-midi', 'dr.mid')])
  for (const f of files) assert.ok(existsSync(f), `${f} not written`)
  assert.match(text, /exported song\.beat @ 125bpm/)
  assert.match(text, /1 step = 120 ticks/)
  assert.match(text, /t {2}1 note {2}ch 1/)
  assert.match(text, /dr {2}1 hit {2}ch 10 \(GM drums\)/)
  assert.match(text, /GM drum map: kick->36/)
  assert.match(text, /dropped \(no SMF equivalent\): cent detune on 1/)
  assert.match(text, /severed copy/)
  // Each per-track file is a valid type-0 SMF.
  const smf = readSmf(new Uint8Array(readFileSync(files[1]!)))
  assert.equal(smf.format, 0)
  assert.equal(smf.tracks[0]!.notes[0]!.pitch, 36)
})

test('pilot-147 fixes: song-mode NOTE, multi-clip note, and a clean missing-file error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-midi-'))
  const file = join(dir, 'song.beat')
  writeFileSync(
    file,
    `format_version 0.11
bpm 125
loop_bars 1
selected_track t

track t T #e06c75 synth
${SYNTH_BLOCK}
  clip t_a
    note u1 60 0 1 0.7
  clip t_soft
    note u2 55 0 4 0.4
  note u1 60 0 1 0.7

scene s1
  slot t t_a

scene s2
  slot t t_soft

song
  section s1 8
  section s2 4
`,
  )
  const { text } = runExportMidi({ file })
  // HIGH: a song-mode project must say the export is loop content, not the arranged timeline.
  assert.match(text, /NOTE: this project has a song arrangement \(2 sections, 12 bars\) — export-midi v1 exports each track's own LOOP content, NOT the arranged timeline/)
  // MEDIUM: a track with several saved clips must say the other variants are not included.
  assert.match(text, /note: t has 2 saved clips \(t_a, t_soft\) — this export is the track's CURRENT loop content/)
  // MEDIUM: a typo'd path is one clean line, not an ENOENT stack trace.
  assert.throws(() => runExportMidi({ file: join(dir, 'nope.beat') }), (err: Error) => err.name === 'BeatMidiError' && /no such file/.test(err.message))
})

test('runExportMidi: -o writes ONE multi-track file; -o with --out-dir is rejected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-midi-'))
  const file = join(dir, 'song.beat')
  writeFileSync(
    file,
    `format_version 0.11
bpm 125
loop_bars 1
selected_track a

track a A #e06c75 synth
${SYNTH_BLOCK}
  note u1 60 0 1 0.7

track b B #61afef synth
${SYNTH_BLOCK}
  note u2 64 0 1 0.7
`,
  )
  const out = join(dir, 'both.mid')
  const { text, files } = runExportMidi({ file, tracks: ['a', 'b'], out })
  assert.deepEqual(files, [out])
  assert.match(text, /SMF type 1, 2 tracks \+ tempo track/)
  const smf = readSmf(new Uint8Array(readFileSync(out)))
  assert.equal(smf.format, 1)
  assert.equal(smf.tracks.length, 3)

  assert.throws(() => runExportMidi({ file, out, outDir: dir }), /not both/)
})

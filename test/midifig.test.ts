// Commercial-MIDI showdown figures (docs/source-showdown-eval.md, "The midi figure source"):
// src/taste/midifig.ts validation/transposition/conversion plus the midi_extract.py sidecar run
// against a TINY ORIGINAL fixture (test/fixtures/midifig-house.mid — 8 bars of generic house
// bass/stabs/lead/drums composed in code for this repo, NOT a transcription of anything). The
// sidecar tests gate on python3 + mido availability, same convention as surge-sidecar.test.ts;
// the pure TS half runs everywhere.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  validateMidiFigure,
  midiTranspositionSemitones,
  midiFigureToComposedPhrase,
  midiFigureLabel,
  listMidiFiles,
  pickMidiFile,
  roleMidiPart,
  runMidiExtract,
  midiExtractDoctor,
  midiExtractAvailable,
  MIDI_ROLE_REGISTER_TARGETS,
  type MidiFigure,
} from '../src/taste/midifig.js'
import { writeShowdownBatch, applyComposedPhrase } from '../src/taste/showdown.js'
import { generateSeedBeat } from '../src/taste/seeds.js'
import { parse } from '../src/core/index.js'
import { scoreBatch, BeatBatchError } from '../src/vary/batch.js'
import { resolvePython } from '../src/analysis/sidecar.js'

const fixtureMid = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'midifig-house.mid')

// gate the sidecar tests on a python that can import mido (resolvePython finds python/.venv)
let hasMido = false
try {
  execFileSync(resolvePython(), ['-c', 'import mido'], { stdio: 'ignore' })
  hasMido = true
} catch {
  hasMido = false
}

// ---- validateMidiFigure ------------------------------------------------------------------------

const goodPayload = (): Record<string, unknown> => ({
  backend: 'midi',
  input: '/private/midi/song.mid',
  part: 'bass',
  picked: { track: 1, channel: 0, name: 'Bass' },
  bpm: 124,
  timeSignature: '4/4',
  totalBars: 16,
  window: { startBar: 4, bars: 4 },
  key: { rootPc: 9, minor: true },
  notes: [
    { pitch: 45, start: 0, duration: 2, velocity: 0.75 },
    { pitch: 45, start: 8, duration: 2, velocity: 0.6 },
  ],
})

test('validateMidiFigure: accepts a well-formed payload', () => {
  const fig = validateMidiFigure(goodPayload())
  assert.equal(fig.part, 'bass')
  assert.equal(fig.key?.rootPc, 9)
  assert.equal(fig.notes.length, 2)
  assert.equal(fig.bpm, 124)
})

test('validateMidiFigure: null key and null bpm are legal (honest "could not derive")', () => {
  const fig = validateMidiFigure({ ...goodPayload(), key: null, bpm: null })
  assert.equal(fig.key, null)
  assert.equal(fig.bpm, null)
})

test('validateMidiFigure: rejects malformed payloads loudly', () => {
  assert.throws(() => validateMidiFigure({ ...goodPayload(), part: 'drums' }), /part must be/)
  assert.throws(() => validateMidiFigure({ ...goodPayload(), notes: [] }), /empty notes/)
  assert.throws(() => validateMidiFigure({ ...goodPayload(), window: { startBar: 0, bars: 3 } }), /bars must be 4 or 8/)
  assert.throws(() => validateMidiFigure({ ...goodPayload(), key: { rootPc: 12, minor: false } }), /rootPc/)
  assert.throws(
    () => validateMidiFigure({ ...goodPayload(), notes: [{ pitch: 45, start: 64, duration: 1, velocity: 0.5 }] }),
    /outside 0\.\.63/,
    'a start beyond the 4-bar window must fail validation, not wrap at render time',
  )
  assert.throws(() => validateMidiFigure({ ...goodPayload(), notes: [{ pitch: 45, start: 0, duration: 0, velocity: 0.5 }] }), /duration/)
  assert.throws(() => validateMidiFigure({ ...goodPayload(), notes: [{ pitch: 45, start: 0, duration: 1, velocity: 1.5 }] }), /velocity/)
})

// ---- transposition (relative-key alignment) ----------------------------------------------------

test('midiTranspositionSemitones: same mode aligns tonics', () => {
  // A minor figure into an A minor seed: nothing to do
  assert.equal(midiTranspositionSemitones({ rootPc: 9, minor: true }, { root: 57, minor: true }), 0)
  // A minor figure into a C minor seed (root 48): +3
  assert.equal(midiTranspositionSemitones({ rootPc: 9, minor: true }, { root: 48, minor: true }), 3)
  // folds to the nearest direction: C major figure into G major (root 55) is -5, not +7
  assert.equal(midiTranspositionSemitones({ rootPc: 0, minor: false }, { root: 55, minor: false }), -5)
})

test('midiTranspositionSemitones: cross-mode targets the RELATIVE key (intervals preserved, diatonic pcs land in the seed scale)', () => {
  // A minor figure into a C major seed: A minor IS C major's relative minor — shift 0
  assert.equal(midiTranspositionSemitones({ rootPc: 9, minor: true }, { root: 48, minor: false }), 0)
  // C major figure into an A minor seed: C major IS A minor's relative major — shift 0
  assert.equal(midiTranspositionSemitones({ rootPc: 0, minor: false }, { root: 57, minor: true }), 0)
  // F minor figure (pc 5) into a C major seed: target A (pc 9) -> +4
  assert.equal(midiTranspositionSemitones({ rootPc: 5, minor: true }, { root: 48, minor: false }), 4)
})

test('midiFigureToComposedPhrase: transposes chromatically, recentres by whole octaves, labels honestly', () => {
  const fig: MidiFigure = validateMidiFigure({
    ...goodPayload(),
    key: { rootPc: 9, minor: true }, // A minor
    notes: [
      { pitch: 81, start: 0, duration: 2, velocity: 0.8 }, // an A5 bass written 3 octaves high
      { pitch: 84, start: 4, duration: 2, velocity: 0.7 },
    ],
  })
  const seedKey = { root: 48, minor: true } // C minor
  const { phrase, transposition } = midiFigureToComposedPhrase(fig, seedKey)
  // +3 semitones (A->C), then whole-octave recentring toward the bass register target
  const interval = phrase.notes[1]!.pitch - phrase.notes[0]!.pitch
  assert.equal(interval, 3, 'intervals survive verbatim')
  assert.equal((((phrase.notes[0]!.pitch - 48) % 12) + 12) % 12, 0, 'tonic lands on the seed root pitch class')
  const mean = phrase.notes.reduce((s, n) => s + n.pitch, 0) / phrase.notes.length
  assert.ok(Math.abs(mean - MIDI_ROLE_REGISTER_TARGETS.bass) <= 6, `mean ${mean} recentred near the bass target`)
  assert.match(transposition, /transposed \+3 st/)
  assert.match(transposition, /oct register recentre/)
  assert.equal(phrase.archetype, 'midi:song')
})

test('midiFigureToComposedPhrase: no key -> untransposed, said so; 8-bar figures keep their first 4 bars', () => {
  const fig = validateMidiFigure({
    ...goodPayload(),
    key: null,
    window: { startBar: 0, bars: 8 },
    notes: [
      { pitch: 45, start: 0, duration: 2, velocity: 0.5 },
      { pitch: 47, start: 60, duration: 8, velocity: 0.5 }, // runs past step 64: clamped
      { pitch: 49, start: 100, duration: 2, velocity: 0.5 }, // bar 7: dropped
    ],
  })
  const { phrase, transposition } = midiFigureToComposedPhrase(fig, { root: 50, minor: false })
  assert.match(transposition, /untransposed/)
  assert.equal(phrase.notes.length, 2)
  const clamped = phrase.notes.find((n) => n.start === 60)!
  assert.equal(clamped.duration, 4, 'duration clamped to the 64-step loop')
  // untransposed notes still recentre by octave only: same pitch classes as the input
  assert.deepEqual(phrase.notes.map((n) => n.pitch % 12).sort(), [45 % 12, 47 % 12].sort())
})

test('midiFigureToComposedPhrase output is applyComposedPhrase-compatible', () => {
  const fig = validateMidiFigure(goodPayload())
  const { phrase } = midiFigureToComposedPhrase(fig, { root: 50, minor: true })
  const seed = parse(generateSeedBeat(31).text)
  const doc = applyComposedPhrase(seed, 'bass', phrase)
  const bass = doc.tracks.find((t) => t.id === 'bass')!
  assert.equal(bass.kind, 'synth')
  if (bass.kind === 'synth') assert.equal(bass.notes.length, phrase.notes.length)
})

// ---- file picking ------------------------------------------------------------------------------

test('roleMidiPart: bassline/chords/lead map; drum-loop and unknowns stay on the bank', () => {
  assert.equal(roleMidiPart('bassline'), 'bass')
  assert.equal(roleMidiPart('chords'), 'chords')
  assert.equal(roleMidiPart('lead'), 'lead')
  assert.equal(roleMidiPart('drum-loop'), null)
  assert.equal(roleMidiPart('nope'), null)
})

test('pickMidiFile: deterministic, exclude-chained, degrades on exhaustion', () => {
  const files = ['/m/a.mid', '/m/b.mid', '/m/c.mid']
  const first = pickMidiFile(files, 7, [])
  assert.equal(pickMidiFile(files, 7, []), first, 'seeded pick is stable')
  const second = pickMidiFile(files, 7, [midiFigureLabel(first!)])
  assert.notEqual(second, first, 'exclude skips the used file')
  const exhausted = pickMidiFile(files, 7, files.map((f) => midiFigureLabel(f)))
  assert.ok(files.includes(exhausted!), 'exhausted pool still returns a file (caller detects the label collision)')
  assert.equal(pickMidiFile([], 7, []), null)
})

test('listMidiFiles finds .mid recursively; midiFigureLabel strips dir + extension', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-midifig-list-'))
  writeFileSync(join(dir, 'one.mid'), 'x')
  writeFileSync(join(dir, 'notmidi.txt'), 'x')
  const found = listMidiFiles(dir)
  assert.equal(found.length, 1)
  assert.equal(midiFigureLabel(found[0]!), 'midi:one')
})

// ---- figureSource plumbing (manifest -> gitignore gate -> scores log) --------------------------

function fakeWav(): Buffer {
  // minimal valid 16-bit PCM RIFF (0.1s silence) — enough for manifest/scoring plumbing
  const frames = 4410
  const data = Buffer.alloc(44 + frames * 2)
  data.write('RIFF', 0); data.writeUInt32LE(36 + frames * 2, 4); data.write('WAVE', 8)
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22)
  data.writeUInt32LE(44100, 24); data.writeUInt32LE(88200, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34)
  data.write('data', 36); data.writeUInt32LE(frames * 2, 40)
  return data
}

test('writeShowdownBatch: figureSource midi gitignore-gates the dir and lands in the manifest; bank does not gate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-midifig-batch-'))
  writeFileSync(join(dir, 'v1.wav'), fakeWav())
  writeFileSync(join(dir, 'v2.wav'), fakeWav())
  const clips = [
    { file: 'v1.wav', source: { kind: 'engine' as const, from: 'midi:x [/private/x.mid] (transposed +2 st)' } },
    { file: 'v2.wav', source: { kind: 'gen' as const, from: 'a prompt' } },
  ]
  const manifest = writeShowdownBatch(dir, 'bassline', clips, { seed: 5, figureSource: 'midi' })
  assert.equal(manifest.figureSource, 'midi')
  assert.ok(existsSync(join(dir, '.gitignore')), 'midi-figure batches never land in git')
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /\*/)

  const bankDir = mkdtempSync(join(tmpdir(), 'beat-midifig-bank-'))
  writeFileSync(join(bankDir, 'v1.wav'), fakeWav())
  writeFileSync(join(bankDir, 'v2.wav'), fakeWav())
  const bank = writeShowdownBatch(bankDir, 'bassline', clips.map((c) => ({ ...c, source: { ...c.source, from: 'composed' } })), { seed: 5, figureSource: 'bank' })
  assert.equal(bank.figureSource, 'bank')
  assert.ok(!existsSync(join(bankDir, '.gitignore')), 'bank batches stay committable')
})

test('scoreBatch: copies the figureSource LABEL into the log entry — never the midi path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-midifig-score-'))
  const batch = join(dir, 'showdown-bassline-5')
  mkdirSync(batch)
  writeFileSync(join(batch, 'v1.wav'), fakeWav())
  writeFileSync(join(batch, 'v2.wav'), fakeWav())
  writeShowdownBatch(batch, 'bassline', [
    { file: 'v1.wav', source: { kind: 'engine', from: 'midi:secret-song [/private/secret-song.mid]' } },
    { file: 'v2.wav', source: { kind: 'gen', from: 'a prompt' } },
  ], { seed: 5, figureSource: 'midi' })
  const result = scoreBatch(batch, ['1'])
  assert.equal(result.entry.figureSource, 'midi')
  const logLine = readFileSync(result.logPath, 'utf8').trim().split('\n').pop()!
  assert.ok(!logLine.includes('secret-song'), 'song identity stays out of the shared log')
  assert.ok(logLine.includes('"figureSource":"midi"'))
})

// ---- the sidecar against the original fixture (gated on python + mido) -------------------------

test('midiExtractDoctor: honest availability report', { skip: !hasMido }, async () => {
  const report = await midiExtractDoctor()
  assert.equal(report.backend, 'midi')
  assert.equal(midiExtractAvailable(report), true)
})

test('midiExtractAvailable: defensive on malformed reports', () => {
  assert.equal(midiExtractAvailable({}), false)
  assert.equal(midiExtractAvailable({ mido: { available: false } }), false)
  assert.equal(midiExtractAvailable({ mido: { available: true } }), true)
})

test('runMidiExtract: picks the right voice per part on the fixture', { skip: !hasMido }, async () => {
  const expected: Record<string, string> = { bass: 'Sub Bass', chords: 'Stab Chords', lead: 'Lead Pluck' }
  for (const part of ['bass', 'chords', 'lead'] as const) {
    const fig = await runMidiExtract({ midiPath: fixtureMid, part })
    assert.equal(fig.picked.name, expected[part], `${part} picks ${expected[part]}`)
    assert.equal(fig.part, part)
    assert.equal(fig.window.bars, 4)
    assert.ok(fig.notes.length >= 4, `${part} extracted ${fig.notes.length} notes`)
    for (const n of fig.notes) {
      assert.ok(n.start >= 0 && n.start < 64, 'starts on the 4-bar/64-step grid')
      assert.ok(n.duration >= 1)
      assert.ok(n.velocity > 0 && n.velocity <= 1)
    }
    assert.deepEqual(fig.key, { rootPc: 9, minor: true }, 'the fixture is A minor')
    assert.equal(fig.bpm, 124)
  }
})

test('runMidiExtract: chords part is actually polyphonic, bass/lead monophonic-ish', { skip: !hasMido }, async () => {
  const chords = await runMidiExtract({ midiPath: fixtureMid, part: 'chords' })
  const byStart = new Map<number, number>()
  for (const n of chords.notes) byStart.set(n.start, (byStart.get(n.start) ?? 0) + 1)
  assert.ok([...byStart.values()].some((c) => c >= 3), 'stab chords carry >= 3 simultaneous notes')
  const bass = await runMidiExtract({ midiPath: fixtureMid, part: 'bass' })
  assert.ok(bass.notes.every((n) => n.pitch < 60), 'bass stays in bass register')
})

test('runMidiExtract: unusable input fails loudly (CLI catches and falls back)', { skip: !hasMido }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-midifig-bad-'))
  const bad = join(dir, 'bad.mid')
  writeFileSync(bad, 'this is not a midi file')
  await assert.rejects(() => runMidiExtract({ midiPath: bad, part: 'bass' }), BeatBatchError)
  await assert.rejects(() => runMidiExtract({ midiPath: join(dir, 'missing.mid'), part: 'bass' }), /no midi file/)
})

test('end-to-end: fixture -> sidecar -> ComposedPhrase in the seed key', { skip: !hasMido }, async () => {
  const seed = parse(generateSeedBeat(31).text)
  const fig = await runMidiExtract({ midiPath: fixtureMid, part: 'bass' })
  const { inferSeedKey } = await import('../src/taste/showdown.js')
  const key = inferSeedKey(seed)
  const { phrase, transposition } = midiFigureToComposedPhrase(fig, key)
  assert.ok(phrase.notes.length >= 4)
  assert.equal(phrase.archetype, 'midi:midifig-house')
  assert.ok(transposition.length > 0)
  const doc = applyComposedPhrase(seed, 'bass', phrase)
  const bass = doc.tracks.find((t) => t.id === 'bass')!
  if (bass.kind === 'synth') assert.equal(bass.notes.length, phrase.notes.length)
})

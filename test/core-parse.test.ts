// Reader-side validation tests for src/core/parse.ts — the permanent home for adversarial hunt
// #2's class-A repro (rt1-roundtrip.mjs).
//
// THE INVARIANT UNDER TEST: **parse() must not accept a document it cannot hand back.** Two ways
// that failed, and the corpus below is organised around them:
//
//   A. parse accepted text that serialize() then wrote back UNPARSEABLE. Every number in a .beat
//      file goes back out through formatNumber's 4-decimal rounding, but parse range-checked the
//      RAW token — so `note n1 60 0 0.00001 0.5` passed "duration > 0", re-serialized as
//      `... 0 ...`, and the very same parser rejected it. Open a file, save it untouched, project
//      bricked. Fixed by canon-then-validate in parseFloatStrict.
//
//   B. parse accepted states NO WRITER CAN PRODUCE, and they were round-trip-stable, so once a
//      hand-edited or externally-generated file introduced one it stayed forever: bpm 0, negative
//      loop_bars, note velocity 5, duplicate note ids, a dangling selected_track. The writers have
//      always refused all of these — the asymmetry was the whole bug.
//
// The negative cases below are deliberately paired with positive ones: the format still has to
// accept non-canonically-SPELLED numbers ("0.50", "1e2"), which merely re-serialize canonically.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BeatParseError, parse, serialize } from '../src/core/index.js'

const HDR = 'format_version 0.11\nbpm 120\nloop_bars 2\nselected_track t1\n'
const SYNTH = `  synth
    osc sawtooth
    volume -12
    cutoff 800
    resonance 1
    attack 0.01
    decay 0.1
    sustain 0.5
    release 0.2
    pan 0
`
const synthTrack = (body = '') => `${HDR}\ntrack t1 t1 #ff0000 synth\n${SYNTH}${body}`
const drumTrack = (body = '') => `${HDR.replace('selected_track t1', 'selected_track d')}\ntrack d d #ff0000 drums\n${SYNTH}${body}`
const header = (bpm: string, loopBars: string, selected = 't1') =>
  `format_version 0.11\nbpm ${bpm}\nloop_bars ${loopBars}\nselected_track ${selected}\n\ntrack t1 t1 #ff0000 synth\n${SYNTH}`

/** parse must be a fixed point at generation 1: no "it stabilizes on the second save" allowed —
 * that IS the drift D4's canonical-bytes guarantee rules out. */
function assertStableRoundTrip(text: string, what: string) {
  const doc = parse(text)
  const out = serialize(doc)
  assert.deepEqual(parse(out), doc, `${what}: parse(serialize(parse(x))) != parse(x)`)
  assert.equal(serialize(parse(out)), out, `${what}: serialize is not a fixed point`)
}

// ---------------------------------------------------------------------------
// A. numbers that round through their own guard on the way back out
// ---------------------------------------------------------------------------

const roundsThroughGuard: [string, string, RegExp][] = [
  ['note duration', synthTrack('  note n1 60 0 0.00001 0.5\n'), /note duration must be > 0 steps/],
  ['note ratchetLength', synthTrack('  note n1 60 0 1 0.5 ratchetLength=0.00001\n'), /ratchetLength must be >0\.\.1/],
  ['hit velocity', drumTrack('  hit h1 kick 0 0.00001\n'), /hit velocity must be in \(0, 1\]/],
  ['hit duration', drumTrack('  hit h1 kick 0 0.5 0.00001\n'), /hit duration must be > 0 steps/],
  ['clip loop range', synthTrack('  clip c1\n    loop 0 0.00003\n    note n1 60 0 1 0.5\n'), /loop end must be > start/],
  ['groove grid', synthTrack('  groove 0.5 0.00001\n'), /shuffleGrid must be > 0/],
  [
    'audio in/out',
    `${HDR.replace('selected_track t1', 'selected_track a')}\nmedia\n  sample s1 sha256:${'a'.repeat(64)} kick.wav\n\ntrack a a #ff0000 audio\n  clip c1\n    audio s1 1 1.00001 0 off 1\n`,
    /audio out-point must be > in-point/,
  ],
]

for (const [what, text, message] of roundsThroughGuard) {
  test(`parse rejects a ${what} that rounds through its own guard`, () => {
    // Before the fix each of these PARSED, and serialize() then produced text the same parse()
    // refused — a load-then-save that destroys the project.
    assert.throws(() => parse(text), message)
    assert.throws(() => parse(text), BeatParseError)
  })
}

test('a non-canonically SPELLED number is still accepted, and lands on its canonical value', () => {
  // The flip side of the guard above: rounding at parse time must not make the format pickier
  // about spelling. These are all legal hand-edits.
  const doc = parse(synthTrack('  note n1 60 0.50 1.0000 0.500001\n'))
  const note = doc.tracks[0]!.notes[0]!
  assert.equal(note.start, 0.5)
  assert.equal(note.duration, 1)
  assert.equal(note.velocity, 0.5, 'a 6th decimal place is rounded away, not preserved into an unwritable value')
  assertStableRoundTrip(synthTrack('  note n1 60 0.50 1.0000 0.500001\n'), 'non-canonical spelling')
})

test('finding 8: a sub-resolution groove amount round-trips at generation 1', () => {
  // `groove 0.00001 1` used to parse to shuffleAmount 0.00001 and serialize as `groove 0 1`, so
  // parse(serialize(x)) != x for exactly one generation — the file changed under a no-op save.
  const doc = parse(synthTrack('  groove 0.00001 1\n'))
  assert.equal(doc.tracks[0]!.shuffleAmount, 0)
  assertStableRoundTrip(synthTrack('  groove 0.00001 1\n'), 'groove 0.00001 1')
})

// ---------------------------------------------------------------------------
// B. states no writer can produce (hunt #2 finding 6)
// ---------------------------------------------------------------------------

test('bpm outside the writers’ own 20-999 range is refused', () => {
  // A zero bpm parsed, round-tripped, and then killed offline render with raw internals.
  for (const bad of ['0', '-100', '19', '1000']) {
    assert.throws(() => parse(header(bad, '2')), /bpm must be an integer 20-999/, `bpm ${bad}`)
  }
  for (const ok of ['20', '120', '999']) assertStableRoundTrip(header(ok, '2'), `bpm ${ok}`)
  assert.throws(() => parse(header('120.5', '2')), /expected an integer/)
})

test('loop_bars outside the writers’ own 1-64 range is refused', () => {
  for (const bad of ['0', '-4', '65', '100000000']) {
    assert.throws(() => parse(header('120', bad)), /loop_bars must be an integer 1-64/, `loop_bars ${bad}`)
  }
  for (const ok of ['1', '2', '64']) assertStableRoundTrip(header('120', ok), `loop_bars ${ok}`)
})

test('note velocity is range-checked, like the hit line right below it always was', () => {
  assert.throws(() => parse(synthTrack('  note n1 60 0 1 5\n')), /note velocity must be 0\.\.1/)
  assert.throws(() => parse(synthTrack('  note n1 60 0 1 -3\n')), /note velocity must be 0\.\.1/)
  assertStableRoundTrip(synthTrack('  note n1 60 0 1 0\n'), 'velocity 0')
  assertStableRoundTrip(synthTrack('  note n1 60 0 1 1\n'), 'velocity 1')
})

test('duplicate note ids are refused (they make id-addressed edits ambiguous)', () => {
  assert.throws(() => parse(synthTrack('  note n1 60 0 1 0.5\n  note n1 62 1 1 0.5\n')), /duplicate note id "n1"/)
  assert.throws(
    () => parse(synthTrack('  clip c1\n    note n1 60 0 1 0.5\n    note n1 62 1 1 0.5\n')),
    /duplicate note id "n1"/,
    'inside a clip too',
  )
  // ...but a clip is a SNAPSHOT of its track's notes and legitimately reuses their ids, so the
  // check is per note list. Every file saveClip has ever written looks like this.
  assertStableRoundTrip(synthTrack('  note n1 60 0 1 0.5\n  clip c1\n    note n1 60 0 1 0.5\n'), 'clip reuses track note ids')
})

test('selected_track must name a track that exists', () => {
  assert.throws(() => parse(header('120', '2', 'nosuch')), /selected_track "nosuch" is not a track in this file/)
  assertStableRoundTrip(header('120', '2', 't1'), 'selected_track t1')
})

test('a repeated header line is refused instead of silently last-wins', () => {
  const dup = 'format_version 0.11\nbpm 120\nbpm 90\nloop_bars 2\nselected_track t1\n\ntrack t1 t1 #ff0000 synth\n' + SYNTH
  assert.throws(() => parse(dup), /duplicate bpm line/)
  assert.throws(() => parse(`${HDR}loop_bars 4\n\ntrack t1 t1 #ff0000 synth\n${SYNTH}`), /duplicate loop_bars line/)
})

// ---------------------------------------------------------------------------
// The corpus as a whole: everything parse still accepts must round-trip at gen 1
// ---------------------------------------------------------------------------

test('every adversarial input parse still accepts round-trips stably', () => {
  const accepted: [string, string][] = [
    ['note id with an = in it', synthTrack('  note "n=1" 60 0 1 0.5\n')],
    ['note start far past the loop', synthTrack('  note n1 60 320 1 0.5\n')],
    ['huge note start', synthTrack('  note n1 60 1000000 1 0.5\n')],
    ['emoji track name', synthTrack().replace('track t1 t1', 'track t1 \u{1f941}\u{1f3b9}')],
    ['very long ids', synthTrack().replaceAll('t1', 'x'.repeat(5000))],
    ['empty scene', `${synthTrack()}\nscene s1\n`],
    ['song reusing one scene twice', `${synthTrack()}\nscene s1\n\nsong\n  section s1 64\n  section s1 64\n`],
    ['empty clip', synthTrack('  clip c1\n')],
    ['two effects of the same type', synthTrack('  effect d1 distortion\n  effect d2 distortion\n')],
    ['surge patch name with spaces', `${HDR.replace('selected_track t1', 'selected_track s')}\ntrack s s #ff0000 surge\n  surge\n    patch "A B  C"\n`],
    ['full-precision numbers', synthTrack('  note n1 60 0.0625 0.9999 0.0001\n')],
  ]
  for (const [what, text] of accepted) assertStableRoundTrip(text, what)
})

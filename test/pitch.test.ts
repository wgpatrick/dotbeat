// Phase 40 Stream VA — pitch detection tested against signals whose right answer is known a
// priori (synthesized tones), and against the REAL recipe-song assets whose ground truth was
// measured by hand with numpy in the session that motivated the stream (docs/phase-40-plan.md §VA).
//
// The two halves matter for different reasons. The synthetic half proves the detector is accurate:
// a sine at a known Hz must come back within a few cents, or the tunes a keymap computes are
// wrong. The real half proves it is HONEST: every one of these files is a bell, a chord, or found
// percussion — the sounds this workflow is made of and precisely where f0 detection is weakest —
// and each must report LOW confidence rather than a confident wrong number, because a wrong keymap
// is worse than none.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectPitch, formatPartials, formatPitchLine, verifyRoot, formatRootVerification, PITCH_CONFIDENCE_MEDIUM } from '../src/analysis/pitch.js'
import { decodeWav } from '../src/metrics/wav.js'
import { hzToMidi } from '../src/core/keymap.js'

const FS = 44100

function tone(fn: (t: number) => number, seconds = 1.5): Float64Array {
  const out = new Float64Array(Math.round(seconds * FS))
  for (let i = 0; i < out.length; i++) out[i] = fn(i / FS)
  return out
}
const sine = (hz: number, seconds = 1.5) => tone((t) => Math.sin(2 * Math.PI * hz * t), seconds)

/** Cents between a detected Hz and the truth — the unit that actually matters here, since cents
 * are what a listener hears and what a `tune` offset is denominated in. */
const centsOff = (got: number, want: number) => Math.abs(1200 * Math.log2(got / want))

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const media = (name: string) => join(repoRoot, 'examples', 'recipe-song', 'media', name)
function detectFile(name: string) {
  const { channels, sampleRate } = decodeWav(readFileSync(media(name)))
  return detectPitch(channels, sampleRate)
}

// ---- known-answer: synthesized tones ------------------------------------------------------------

test('a synthesized sine is detected within a few cents, across the useful range', () => {
  for (const hz of [110, 220, 440, 1000, 1748.6]) {
    const p = detectPitch([sine(hz)], FS)
    assert.ok(p.hz !== null, `${hz} Hz: nothing detected`)
    assert.ok(centsOff(p.hz!, hz) < 5, `${hz} Hz: detected ${p.hz!.toFixed(2)} (${centsOff(p.hz!, hz).toFixed(1)} cents off)`)
    assert.equal(p.level, 'high', `${hz} Hz: a pure sine must read HIGH confidence, got ${p.confidence.toFixed(2)}`)
  }
})

test('a 25.3 Hz sine — the recipe-song bass\'s measured f0 — is detected, not lost to the low end', () => {
  // The bass one-shot is the reason fmin is 20 Hz. Also a regression guard for the body-window
  // bug that gave a STEADY tone a 66 ms analysis window (the envelope's argmax is meaningless
  // when the envelope is flat) and reported a perfectly detectable sine as unpitched.
  const p = detectPitch([sine(25.3, 2)], FS)
  assert.ok(p.hz !== null)
  assert.ok(centsOff(p.hz!, 25.3) < 5, `detected ${p.hz!.toFixed(2)} Hz`)
  assert.equal(p.level, 'high')
  assert.ok(p.analyzedToSeconds - p.analyzedFromSeconds > 1, `body window collapsed to ${(p.analyzedToSeconds - p.analyzedFromSeconds).toFixed(3)}s`)
})

test('note name and cents-off are reported against the nearest semitone', () => {
  const a4 = detectPitch([sine(440)], FS)
  assert.equal(a4.note, 'a4')
  assert.ok(Math.abs(a4.cents!) < 5)
  // 1000 Hz is a real 21 cents above b5 (987.77) — the cents field must SAY so rather than round
  // the pitch to the nearest note and pretend it landed there.
  const b5 = detectPitch([sine(1000)], FS)
  assert.equal(b5.note, 'b5')
  assert.ok(Math.abs(b5.cents! - 21) < 3, `cents off b5 = ${b5.cents!.toFixed(1)}, expected ~+21`)
})

test('a harmonic-series tone (sawtooth) reads high confidence and its partials are integer multiples', () => {
  const saw = tone((t) => {
    let v = 0
    for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * 220 * h * t) / h
    return v * 0.4
  })
  const p = detectPitch([saw], FS)
  assert.ok(centsOff(p.hz!, 220) < 5)
  assert.equal(p.level, 'high')
  assert.ok(p.harmonicity > 0.9, `harmonicity ${p.harmonicity.toFixed(2)}`)
  for (const partial of p.partials.slice(0, 4)) {
    assert.ok(Math.abs(partial.ratio - Math.round(partial.ratio)) < 0.01, `partial x${partial.ratio.toFixed(3)} is not an integer multiple`)
  }
})

// ---- honesty: unpitched / inharmonic / polyphonic ------------------------------------------------

test('white noise reports LOW confidence, not a confident wrong number', () => {
  const p = detectPitch([tone(() => Math.random() * 2 - 1)], FS)
  assert.equal(p.level, 'low')
  assert.ok(p.confidence < 0.2, `confidence ${p.confidence.toFixed(2)}`)
  assert.ok(p.periodicity < 0.3, `noise should not look periodic; got ${p.periodicity.toFixed(2)}`)
})

test('an inharmonic clang reports LOW confidence even though its waveform IS periodic', () => {
  // 500/900/1200 Hz repeats exactly at 100 Hz, so autocorrelation "correctly" finds 100 Hz and
  // every partial is an exact harmonic of it — yet there is no 100 Hz in the sound and no listener
  // hears one. A sample's root has to be a pitch the sample actually contains.
  const p = detectPitch([tone((t) => 0.33 * (Math.sin(2 * Math.PI * 500 * t) + Math.sin(2 * Math.PI * 900 * t) + Math.sin(2 * Math.PI * 1200 * t)))], FS)
  assert.equal(p.level, 'low', `confidence ${p.confidence.toFixed(2)} — an inharmonic clang must not read as pitched`)
  assert.match(p.method, /no partial at/)
  // …and it must still hand the user something to act on: the lowest strong partial.
  assert.equal(p.suggestedRootNote, 'b4') // 500 Hz
})

test('two partials a semitone apart read LOW/ambiguous and suggest the lower as root', () => {
  // examples/recipe-song/media/bell_b.wav's defining flaw, synthesized: 496.2 + 526.7 Hz. No single
  // f0 explains both, and the pair beats. This is the case a plain "strongest peak" reading calls
  // 526.7 Hz with total confidence.
  const p = detectPitch([tone((t) => 0.5 * (Math.sin(2 * Math.PI * 496.2 * t) + Math.sin(2 * Math.PI * 526.7 * t)))], FS)
  assert.equal(p.level, 'low', `confidence ${p.confidence.toFixed(2)}`)
  assert.equal(p.suggestedRootNote, 'b4')
  const ratios = p.partials.slice(0, 2).map((q) => q.ratio).sort((a, b) => a - b)
  assert.ok(Math.abs(ratios[1]! - 1.06) < 0.01, `expected a x1.06 pair, got x${ratios[1]!.toFixed(3)}`)
})

test('the returned partial count is display-only — it never moves the measurement', () => {
  const saw = tone((t) => Math.sin(2 * Math.PI * 300 * t) + 0.5 * Math.sin(2 * Math.PI * 600 * t) + 0.3 * Math.sin(2 * Math.PI * 900 * t))
  const few = detectPitch([saw], FS, { partialCount: 2 })
  const many = detectPitch([saw], FS, { partialCount: 12 })
  assert.equal(few.partials.length, 2)
  assert.equal(few.confidence, many.confidence)
  assert.equal(few.harmonicity, many.harmonicity)
  assert.equal(few.suggestedRootHz, many.suggestedRootHz)
})

test('an empty or silent buffer reports no pitch rather than throwing', () => {
  assert.equal(detectPitch([new Float64Array(0)], FS).hz, null)
  assert.equal(detectPitch([new Float64Array(FS)], FS).hz, null)
  assert.equal(detectPitch([new Float64Array(FS)], FS).level, 'low')
})

// ---- the real assets, against hand-measured ground truth ------------------------------------------

test('bell_a: the dominant partial is the ~1748.6 Hz a6 the song is keyed on, with a ~1.8 inharmonic partner', () => {
  const p = detectFile('bell_a.wav')
  // Ground truth measured by hand (numpy) in the session that produced examples/recipe-song.
  const a6 = p.partials.find((q) => centsOff(q.hz, 1748.6) < 50)
  assert.ok(a6, `no partial near 1748.6 Hz; got ${p.partials.map((q) => q.hz.toFixed(0)).join(', ')}`)
  assert.ok(a6!.relDb > -6, 'the 1748.6 Hz partial should be a strong one')
  const clang = p.partials.find((q) => Math.abs(q.ratio - 1.8) < 0.05)
  assert.ok(clang, `no inharmonic partial near x1.80; got ${p.partials.map((q) => 'x' + q.ratio.toFixed(2)).join(', ')}`)
  // The keymap's whole --root story: detection is not trusted here, and the suggestion is the note
  // the song's hand-written lanes are actually rooted on.
  assert.equal(p.level, 'low')
  assert.equal(p.suggestedRootNote, 'a6')
  assert.ok(centsOff(p.suggestedRootHz!, 1748.6) < 50)
})

test('bell_b: two strong partials a semitone apart (x1.06) — the reading that made it the reject', () => {
  const p = detectFile('bell_b.wav')
  const strong = p.partials.filter((q) => q.relDb >= -6)
  assert.ok(strong.length >= 2, 'bell_b should show two comparably strong partials')
  // ~496.2 and ~526.7 Hz, hand-measured.
  assert.ok(strong.some((q) => centsOff(q.hz, 496.2) < 30), `no ~496.2 Hz partial; got ${strong.map((q) => q.hz.toFixed(1)).join(', ')}`)
  assert.ok(strong.some((q) => centsOff(q.hz, 526.7) < 30), `no ~526.7 Hz partial; got ${strong.map((q) => q.hz.toFixed(1)).join(', ')}`)
  assert.ok(strong.some((q) => Math.abs(q.ratio - 1.06) < 0.015), `expected a x1.06 pair; got ${strong.map((q) => 'x' + q.ratio.toFixed(3)).join(', ')}`)
  assert.equal(p.level, 'low')
})

test('bass_p: the ~25.3 Hz hand-measured f0 is the lowest strong partial', () => {
  const p = detectFile('bass_p.wav')
  assert.ok(p.suggestedRootHz !== null)
  assert.ok(centsOff(p.suggestedRootHz!, 25.3) < 50, `suggested root ${p.suggestedRootHz!.toFixed(2)} Hz, expected ~25.3`)
})

test('pad_am is a CHORD — it must not report a confident single pitch', () => {
  const p = detectFile('pad_am.wav')
  assert.equal(p.level, 'low', `a polyphonic pad reported ${p.level} confidence ${p.confidence.toFixed(2)} — the one thing it must never do`)
})

test('hat_g, a hi-hat, is unpitched — it must not report a confident pitch', () => {
  const p = detectFile('hat_g.wav')
  assert.equal(p.level, 'low', `a hi-hat reported ${p.level} confidence ${p.confidence.toFixed(2)}`)
})

// ---- formatting ----------------------------------------------------------------------------------

test('formatPartials/formatPitchLine render the readings a caller has to reason with', () => {
  const p = detectFile('bell_b.wav')
  const table = formatPartials(p.partials)
  assert.match(table, /frequency/)
  assert.match(table, /x1\.0/) // the root's own row
  assert.equal(table.split('\n').length, p.partials.length + 1) // header + one row per partial
  const line = formatPitchLine(p)
  assert.match(line, /confidence LOW/)
  assert.match(line, /periodicity/)
  assert.equal(formatPartials([]), '  (no partials above the noise floor)')
})

test('hzToMidi/detected midi agree — the number keymap actually consumes', () => {
  const p = detectPitch([sine(440)], FS)
  assert.ok(Math.abs(p.midi! - hzToMidi(p.hz!)) < 1e-9)
  assert.ok(Math.abs(p.midi! - 69) < 0.05)
})

// ---- D22: root verification (research/132 §3) ---------------------------------------------------
//
// 132's diagnosis of the keymap source: "a wrong root makes the whole instrument systematically out
// of tune with the batch, and nothing downstream checks." keymap sits at 31-38% in the source
// showdown DESPITE the best bass-timbre match to the references of any source (sub 45.3% vs ref
// 47.1%) — the profile of a tuning defect, not a timbre one.
//
// The failure confidence cannot catch is a CONFIDENT reading of the wrong member of a harmonic
// series. So these tests are built around that case specifically: a clean sawtooth, whose detection
// is high-confidence and correct, checked against roots that are deliberately wrong by an octave.
// The re-render-and-re-detect design was rejected as circular (repitching is a frequency scaling, so
// a systematic octave error reproduces itself and reports agreement); verifyRoot re-reads the
// SPECTRUM instead, which is the only reading independent of the estimator that produced the root.

const sawtooth = (hz: number, seconds = 1.5) =>
  tone((t) => {
    let s = 0
    for (let n = 1; n <= 12; n++) s += Math.sin(2 * Math.PI * hz * n * t) / n
    return s * 0.3
  }, seconds)

test('verifyRoot passes the root a harmonic series actually sits on', () => {
  const p = detectPitch([sawtooth(220)], FS)
  const v = verifyRoot(hzToMidi(220), p)
  assert.equal(v.ok, true, v.detail)
  assert.equal(v.reason, 'ok')
  assert.ok(v.harmonicSupport > 0.9, `support ${v.harmonicSupport}`)
})

test('verifyRoot catches the octave error — the defect confidence cannot see', () => {
  const p = detectPitch([sawtooth(220)], FS)
  // The detection itself is confident and CORRECT here; the wrongness is in the claimed root.
  assert.ok(p.confidence >= PITCH_CONFIDENCE_MEDIUM, `precondition: the sawtooth must read confidently (got ${p.confidence})`)
  for (const [claimedHz, label] of [[440, 'an octave high'], [660, 'a twelfth high'], [880, 'two octaves high']] as [number, string][]) {
    const v = verifyRoot(hzToMidi(claimedHz), p)
    assert.equal(v.ok, false, `${label}: should have been rejected`)
    assert.equal(v.reason, 'octave-error', label)
    assert.ok(v.alternateRootMidi !== null, `${label}: must hand back a root to paste after --root`)
    // The alternate must be a real partial of the sound, at or below the claimed root.
    assert.ok(v.alternateRootMidi! < hzToMidi(claimedHz), label)
  }
})

test('verifyRoot rejects a root the series does not support at all', () => {
  const p = detectPitch([sawtooth(220)], FS)
  const v = verifyRoot(hzToMidi(220) + 1, p) // one semitone off: no partial lands on the series
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'unsupported')
  assert.ok(v.harmonicSupport < 0.35)
})

test('verifyRoot does not fire on a pure sine at its own root (one partial IS the series)', () => {
  const v = verifyRoot(hzToMidi(440), detectPitch([sine(440)], FS))
  assert.equal(v.ok, true, v.detail)
})

test('verifyRoot reports no-evidence rather than refusing when there is no partial table', () => {
  const v = verifyRoot(60, detectPitch([new Float64Array(FS)], FS)) // digital silence
  assert.equal(v.reason, 'no-evidence')
  assert.equal(v.ok, true, 'absence of evidence must not block a keymap — it is reported as unchecked, not confirmed')
})

test('verifyRoot passes the recipe-song bell on the root the song is actually keyed to', () => {
  // examples/recipe-song's hand-written keymap is rooted on bell_a's 1748.6 Hz a6 (the ground truth
  // measured by hand in the session that produced the song). Real, inharmonic, and it must not be
  // refused — a check that rejects the project's own known-good asset is worse than no check.
  const p = detectFile('bell_a.wav')
  const v = verifyRoot(hzToMidi(1748.6), p)
  assert.equal(v.ok, true, `bell_a on its own a6 root was rejected: ${v.detail}`)
})

// The octave-DOWN hole, found by the 2026-07-26 CLI/MCP pilot AFTER the checks above shipped.
// `--root a3` on an unambiguous a4 sample passed both hard checks and built a keymap an octave
// sharp in silence: nothing sits below a3 to trip the octave-error check, and a3's harmonic series
// trivially CONTAINS the real a4, so support read 100%. It is the likelier human error of the two
// directions, and it was the one that was missed.
test('verifyRoot warns (never silently passes) on a root an octave BELOW the true fundamental', () => {
  const p = detectPitch([sawtooth(440)], FS)
  const v = verifyRoot(hzToMidi(220), p)
  assert.equal(v.ok, true, 'a missing fundamental is legitimate material — this must not become a refusal')
  assert.equal(v.warnings.length, 1, 'but it must not pass silently')
  assert.match(v.warnings[0]!, /no partial sits at a3 itself/)
  assert.match(v.warnings[0]!, /probably a4/, 'the warning must name the root the spectrum points at')
  assert.match(v.warnings[0]!, /12 semitones flat/, 'and say which way the whole clip would be wrong')
})

test('verifyRoot stays silent on the CORRECT root — a warning on every root is no warning at all', () => {
  const v = verifyRoot(hzToMidi(440), detectPitch([sawtooth(440)], FS))
  assert.equal(v.ok, true)
  assert.deepEqual(v.warnings, [])
  assert.match(formatRootVerification(hzToMidi(440), v), /OK/)
})

test('the recipe-song bell does not trip the octave-DOWN warning on its own root', () => {
  // bell_a's 1748.6 Hz a6 IS present in its partial table (0.8 dB under the strongest), so the
  // check has nothing to say. A warning here would fire on the project's own known-good asset.
  const v = verifyRoot(hzToMidi(1748.6), detectFile('bell_a.wav'))
  assert.equal(v.ok, true)
  assert.deepEqual(v.warnings, [], 'the song\'s own hand-verified root must not be called suspect')
})

test('formatRootVerification never prints OK and SUSPECT together', () => {
  const suspect = verifyRoot(hzToMidi(220), detectPitch([sawtooth(440)], FS))
  const text = formatRootVerification(hzToMidi(220), suspect)
  assert.match(text, /SUSPECT/)
  assert.ok(!/: OK/.test(text), 'a reader who sees OK first stops reading — which is how this hole stayed invisible')
})

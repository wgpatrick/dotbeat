// The deterministic, theory-aware composition layer (research 124 §C.7, src/taste/theory.ts):
// unit tests for every craft rule, with fixed seeds so each is reproducible. These cover the chord
// track (weighted progression selection, harmonic rhythm, position-conditional cadence, planing,
// modes), the theory-aware generators (register rule, voice-leading cost, motif constraints), and
// the pre-render lint. The motif-variation OPERATORS have their own file (motif.test.ts).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  scalePitchClasses,
} from '../src/taste/showdown.js'
import {
  PROGRESSION_BANK,
  buildChordTrack,
  chordAtStep,
  violatesRegisterRule,
  enforceBassRegister,
  REGISTER_RULE_FLOOR_MIDI,
  composeTheoryBass,
  THEORY_BASS_ARCHETYPES,
  voiceLeadingCost,
  chooseVoicing,
  composeTheoryChords,
  composeTheoryLead,
  composeTheoryPhrase,
  snapToScale,
  enforceSinglePeak,
  scaleConsistency,
  registerRuleViolations,
  grooveConsistency,
  lintFigure,
} from '../src/taste/theory.js'

const MINOR = { root: 48, minor: true }
const MAJOR = { root: 48, minor: false }

// ---- scale modes (§C.4) ------------------------------------------------------------------------

test('scalePitchClasses: Phrygian and Dorian extend the major/natural-minor pair', () => {
  assert.deepEqual([...scalePitchClasses({ root: 48, minor: false })], [0, 2, 4, 5, 7, 9, 11])
  assert.deepEqual([...scalePitchClasses({ root: 48, minor: true })], [0, 2, 3, 5, 7, 8, 10])
  assert.deepEqual([...scalePitchClasses({ root: 48, minor: true, mode: 'phrygian' })], [0, 1, 3, 5, 7, 8, 10])
  assert.deepEqual([...scalePitchClasses({ root: 48, minor: true, mode: 'dorian' })], [0, 2, 3, 5, 7, 9, 10])
  // mode overrides the coarse minor flag
  assert.deepEqual([...scalePitchClasses({ root: 48, minor: false, mode: 'phrygian' })], [0, 1, 3, 5, 7, 8, 10])
})

// ---- progression weighting (§C.1) --------------------------------------------------------------

test('progression selection is weighted — i-VI-III-VII (the genre default) dominates the minor slice', () => {
  const counts = new Map<string, number>()
  for (let seed = 0; seed < 2000; seed++) {
    const track = buildChordTrack(MINOR, seed)
    counts.set(track.progressionName, (counts.get(track.progressionName) ?? 0) + 1)
  }
  // only minor entries appear for a minor key
  for (const name of counts.keys()) {
    const entry = PROGRESSION_BANK.find((e) => e.name === name)!
    assert.equal(entry.minor, true, `${name} should be a minor progression for a minor key`)
  }
  // the highest-weight entry is the most frequent
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!
  assert.equal(top[0], 'i-VI-III-VII', 'the highest-weight progression should be drawn most often')
  // and it's meaningfully more common than a weight-2 entry (roughly its weight ratio)
  const default6 = counts.get('i-VI-III-VII') ?? 0
  const rare2 = counts.get('i-iv-VI-v') ?? 1
  assert.ok(default6 > rare2 * 1.6, `weight-6 should beat weight-2 substantially (${default6} vs ${rare2})`)
})

test('major keys draw only major progressions', () => {
  for (let seed = 0; seed < 300; seed++) {
    const track = buildChordTrack(MAJOR, seed)
    const entry = PROGRESSION_BANK.find((e) => e.name === track.progressionName)!
    assert.equal(entry.minor, false)
  }
})

// ---- harmonic rhythm (§C.1) --------------------------------------------------------------------

test('harmonic rhythm is 1 or 2 bars per chord — never a hardcoded always-one-per-bar', () => {
  const rhythms = new Set<number>()
  for (let seed = 0; seed < 200; seed++) rhythms.add(buildChordTrack(MINOR, seed).barsPerChord)
  assert.deepEqual([...rhythms].sort(), [1, 2], 'both 1-bar and 2-bar harmonic rhythms must occur')
  // a 2-bar rhythm actually holds a chord across two bars
  const held = buildChordTrack(MINOR, 0, { barsPerChord: 2, bars: 4 })
  assert.ok(held.chords.every((c) => c.bars === 2))
  assert.equal(held.chords.length, 2)
})

// ---- cadence position (§C.1) -------------------------------------------------------------------

test('cadence substitution is position-conditional: only ever the phrase-FINAL chord, and it is a harmonic-minor V', () => {
  let sawCadential = false
  for (let seed = 0; seed < 400; seed++) {
    const track = buildChordTrack(MINOR, seed)
    track.chords.forEach((c, i) => {
      if (c.cadential) {
        sawCadential = true
        assert.equal(i, track.chords.length - 1, 'cadential chord must be the last one')
        assert.equal(c.rootDegree, 4, 'the cadence is a V (degree 4)')
        // raised third => a MAJOR third above the root (the leading tone), 4 semitones
        const thirdInterval = (((c.tones[1]! - c.tones[0]!) % 12) + 12) % 12
        assert.equal(thirdInterval, 4, 'harmonic-minor V has a major third (raised leading tone)')
      }
    })
  }
  assert.ok(sawCadential, 'some minor phrases must get the cadence substitution')
})

test('cadence:false disables the substitution; major keys never cadential by default', () => {
  for (let seed = 0; seed < 200; seed++) {
    assert.ok(!buildChordTrack(MINOR, seed, { cadence: false }).chords.some((c) => c.cadential))
    assert.ok(!buildChordTrack(MAJOR, seed).chords.some((c) => c.cadential))
  }
})

// ---- parallel planing (§C.1) -------------------------------------------------------------------

test('planing mode: one m7 shape transposed by fixed offsets, ignoring diatonic membership', () => {
  const track = buildChordTrack(MINOR, 5, { planing: true })
  assert.equal(track.planing, true)
  for (const c of track.chords) {
    assert.equal(c.planed, true)
    assert.equal(c.rootDegree, null, 'planed chords have no diatonic degree')
    // the tone shape relative to the chord root is always the m7 [0,3,7,10]
    assert.deepEqual(c.tones.map((t) => t - c.rootOffset), [0, 3, 7, 10])
  }
})

// ---- register rule (§C.2) ----------------------------------------------------------------------

test('register rule predicate + enforcement: sub-register colour tones lift, root/5th/octave pass', () => {
  const root = 36 // sub register (below the floor)
  assert.equal(violatesRegisterRule(root, root), false) // root
  assert.equal(violatesRegisterRule(root + 7, root), false) // fifth
  assert.equal(violatesRegisterRule(root + 12, root), false) // octave
  assert.equal(violatesRegisterRule(root + 3, root), true) // minor third — a violation in the sub
  assert.equal(violatesRegisterRule(root + 4, root), true) // major third — a violation
  // above the floor, anything is allowed
  assert.equal(violatesRegisterRule(REGISTER_RULE_FLOOR_MIDI + 3, REGISTER_RULE_FLOOR_MIDI), false)
  // enforcement lifts a sub third until it clears the floor / lands on an allowed interval
  const lifted = enforceBassRegister(root + 3, root)
  assert.ok(!violatesRegisterRule(lifted, root), 'a lifted note no longer violates')
  assert.equal(enforceBassRegister(root + 7, root), root + 7, 'the fifth is untouched')
})

test('every theory bass figure carries ONLY root/5th/octave in the sub register', () => {
  for (const archetype of THEORY_BASS_ARCHETYPES) {
    for (let seed = 0; seed < 50; seed++) {
      const track = buildChordTrack(MINOR, seed)
      const notes = composeTheoryBass(archetype, track, seed)
      const violations = registerRuleViolations(notes, track)
      assert.equal(violations.length, 0, `${archetype} seed ${seed} must not violate the register rule`)
    }
  }
})

// ---- voice-leading (§C.4) ----------------------------------------------------------------------

test('voiceLeadingCost rewards common tones / minimal motion over a leap', () => {
  const prev = [60, 64, 67]
  const common = [60, 64, 69] // one voice moves 2 semitones, two held
  const leap = [72, 76, 79] // whole voicing an octave up
  assert.ok(voiceLeadingCost(common, prev) < voiceLeadingCost(leap, prev))
  // no previous voicing => cost is the spread (prefers a compact opening)
  assert.equal(voiceLeadingCost([60, 64, 67], null), 7)
})

test('chooseVoicing picks the minimal-motion voicing and keeps the pad register-separated from the sub', () => {
  const track = buildChordTrack(MINOR, 11, { barsPerChord: 1 })
  let prev: number[] | null = null
  let totalMotion = 0
  for (const chord of track.chords) {
    const v = chooseVoicing(track.key, chord, 'triad', prev)
    // register separation: the pad never dips to the sub bass at key.root-12
    assert.ok(Math.min(...v) >= track.key.root, `pad bottom ${Math.min(...v)} stays above the sub`)
    if (prev !== null) {
      const motion = v.reduce((s, p) => s + Math.min(...prev!.map((q) => Math.abs(p - q))), 0)
      totalMotion += motion
    }
    prev = v
  }
  // minimal-motion voice-leading keeps total motion modest (never octave-leaping every chord)
  assert.ok(totalMotion < 24, `total voice motion ${totalMotion} should be small for a 4-chord phrase`)
})

test('composeTheoryChords stays register-separated from the sub bass across styles/seeds', () => {
  for (let seed = 0; seed < 40; seed++) {
    const track = buildChordTrack(MINOR, seed)
    const notes = composeTheoryChords('lush-pad', track, seed)
    for (const n of notes) assert.ok(n.pitch >= track.key.root, 'a pad note never enters the sub octave')
  }
})

// ---- motif constraints (§C.3) ------------------------------------------------------------------

test('lead has a single peak note, once, on a strong beat, near the phrase midpoint', () => {
  for (let seed = 0; seed < 60; seed++) {
    const track = buildChordTrack(MINOR, seed)
    const notes = composeTheoryLead('motif-call-response', track, seed)
    const max = Math.max(...notes.map((n) => n.pitch))
    const peaks = notes.filter((n) => n.pitch === max)
    assert.equal(peaks.length, 1, `seed ${seed}: the highest pitch must occur exactly once`)
    const peak = peaks[0]!
    assert.equal(Math.round(peak.start) % 4, 0, 'the peak lands on a strong beat')
    const mid = (track.bars * 16) / 2
    assert.ok(Math.abs(peak.start - mid) <= 12, `the peak (${peak.start}) sits near the midpoint (${mid})`)
  }
})

test('lead melody is mostly stepwise and the call ends higher than the answer ends', () => {
  const track = buildChordTrack(MINOR, 3)
  const notes = composeTheoryLead('motif-call-response', track, 3)
  let steps = 0
  let moves = 0
  for (let i = 1; i < notes.length; i++) {
    const iv = Math.abs(notes[i]!.pitch - notes[i - 1]!.pitch)
    if (iv > 0) {
      moves += 1
      if (iv <= 2) steps += 1
    }
  }
  assert.ok(steps / Math.max(1, moves) >= 0.5, 'a majority of melodic moves are stepwise')
  const mid = track.bars * 8
  const callEnd = notes.filter((n) => n.start < mid).reduce((a, b) => (b.start > a.start ? b : a))
  const answerEnd = notes.filter((n) => n.start >= mid).reduce((a, b) => (b.start > a.start ? b : a))
  assert.ok(callEnd.pitch > answerEnd.pitch, 'call ends high, answer ends low')
})

test('snapToScale maps any pitch into the key; enforceSinglePeak yields exactly one maximum', () => {
  const key = { root: 48, minor: true }
  const scale = scalePitchClasses(key)
  for (let p = 40; p < 90; p++) {
    const s = snapToScale(p, key)
    assert.ok(scale.includes((((s - 48) % 12) + 12) % 12), `${p} snapped to an in-scale pitch`)
  }
  const notes = [
    { pitch: 72, start: 0, duration: 2, velocity: 0.5 },
    { pitch: 79, start: 8, duration: 2, velocity: 0.5 },
    { pitch: 79, start: 16, duration: 2, velocity: 0.5 }, // a tie for the max
    { pitch: 74, start: 24, duration: 2, velocity: 0.5 },
  ]
  enforceSinglePeak(notes, 16, key)
  const max = Math.max(...notes.map((n) => n.pitch))
  assert.equal(notes.filter((n) => n.pitch === max).length, 1)
})

// ---- determinism -------------------------------------------------------------------------------

test('composeTheoryPhrase is deterministic in the seed (same figure) and differs across seeds', () => {
  for (const role of ['bassline', 'chords', 'lead'] as const) {
    const a = composeTheoryPhrase(role, MINOR, 21)
    const b = composeTheoryPhrase(role, MINOR, 21)
    assert.deepEqual(a.notes, b.notes, `${role} is byte-stable for one seed`)
    const c = composeTheoryPhrase(role, MINOR, 22)
    assert.notDeepEqual(a.notes, c.notes, `${role} changes across seeds`)
    assert.ok(a.archetype.startsWith('theory:'), 'the figure label marks the theory source')
  }
})

test('composeTheoryPhrase honours the exclude chain (consecutive draws avoid a used archetype)', () => {
  const first = composeTheoryPhrase('bassline', MINOR, 30)
  const second = composeTheoryPhrase('bassline', MINOR, 30, { exclude: [first.archetype] })
  assert.notEqual(second.archetype, first.archetype)
})

// ---- pre-render lint (§B.7) --------------------------------------------------------------------

test('lint: scaleConsistency, registerRuleViolations, grooveConsistency behave as gross-error gates', () => {
  const key = { root: 48, minor: true }
  const inKey = [
    { pitch: 48, start: 0, duration: 1, velocity: 0.5 },
    { pitch: 51, start: 4, duration: 1, velocity: 0.5 },
  ]
  assert.equal(scaleConsistency(inKey, key), 1)
  const withChromatic = [...inKey, { pitch: 49, start: 8, duration: 1, velocity: 0.5 }] // b2 not in nat minor
  assert.ok(scaleConsistency(withChromatic, key) < 1)

  // register violations detected against a chord track (a planted sub third)
  const track = buildChordTrack(key, 1, { barsPerChord: 1 })
  const rootSub = key.root - 12 + track.chords[0]!.rootOffset
  const bad = [{ pitch: rootSub + 3, start: 0, duration: 1, velocity: 0.5 }]
  assert.equal(registerRuleViolations(bad, track).length, 1)

  // groove consistency: identical bars => 1, disjoint onsets => < 1
  const same = [
    { pitch: 60, start: 0, duration: 1, velocity: 0.5 },
    { pitch: 60, start: 16, duration: 1, velocity: 0.5 },
  ]
  assert.equal(grooveConsistency(same, 2), 1)
  const disjoint = [
    { pitch: 60, start: 0, duration: 1, velocity: 0.5 },
    { pitch: 60, start: 17, duration: 1, velocity: 0.5 },
  ]
  assert.ok(grooveConsistency(disjoint, 2) < 1)
})

test('lintFigure flags nothing for a clean theory figure', () => {
  for (let seed = 0; seed < 40; seed++) {
    for (const role of ['bassline', 'chords', 'lead'] as const) {
      const phrase = composeTheoryPhrase(role, MINOR, seed)
      const report = lintFigure(phrase.notes, phrase.chordTrack)
      assert.deepEqual(report.flags, [], `${role} seed ${seed} should be lint-clean, got ${report.flags.join('; ')}`)
    }
  }
})

test('chordAtStep resolves the sounding chord across a 2-bar harmonic rhythm', () => {
  const track = buildChordTrack(MINOR, 0, { barsPerChord: 2, bars: 4 })
  assert.equal(chordAtStep(track, 0), track.chords[0])
  assert.equal(chordAtStep(track, 16), track.chords[0]) // still the first chord in bar 2
  assert.equal(chordAtStep(track, 32), track.chords[1]) // second chord starts bar 3
})

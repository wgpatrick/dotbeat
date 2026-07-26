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
import { mulberry32 } from '../src/taste/eval.js'
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
  bassBarSchedule,
  chooseOpeningVoicing,
  THEORY_CHORD_ARCHETYPES,
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

test('harmonic rhythm is 1, 2 or (rarely) the whole clip per chord — never a hardcoded always-one-per-bar', () => {
  const rhythms = new Map<number, number>()
  for (let seed = 0; seed < 200; seed++) {
    const b = buildChordTrack(MINOR, seed).barsPerChord
    rhythms.set(b, (rhythms.get(b) ?? 0) + 1)
  }
  assert.deepEqual([...rhythms.keys()].sort((a, b) => a - b), [1, 2, 4], 'all three harmonic rhythms must occur')
  // the whole-clip hold (the techno one-chord vamp) stays RARE — it colours a round, never defines it
  assert.ok((rhythms.get(4) ?? 0) < (rhythms.get(1) ?? 0), 'the 4-bar hold is rarer than the 1-bar rhythm')
  assert.ok((rhythms.get(2) ?? 0) > (rhythms.get(1) ?? 0), 'the 2-bar held chord stays the trance-breakdown norm')
  // a 2-bar rhythm actually holds a chord across two bars
  const held = buildChordTrack(MINOR, 0, { barsPerChord: 2, bars: 4 })
  assert.ok(held.chords.every((c) => c.bars === 2))
  assert.equal(held.chords.length, 2)
})

// ---- mode colour (§C.4) ------------------------------------------------------------------------

test('minor chord tracks draw a weighted mode palette — natural minor dominant, Phrygian/Dorian as colour', () => {
  const counts = new Map<string, number>()
  for (let seed = 0; seed < 600; seed++) {
    const m = buildChordTrack(MINOR, seed).key.mode!
    counts.set(m, (counts.get(m) ?? 0) + 1)
  }
  assert.deepEqual([...counts.keys()].sort(), ['dorian', 'natural-minor', 'phrygian'])
  const nat = counts.get('natural-minor')!
  assert.ok(nat > counts.get('phrygian')! * 2, 'natural minor stays the genre workhorse')
  assert.ok(nat > counts.get('dorian')! * 2, 'natural minor stays the genre workhorse')
  // major keys keep one mode
  for (let seed = 0; seed < 100; seed++) assert.equal(buildChordTrack(MAJOR, seed).key.mode, 'major')
  // and an explicit mode still wins
  assert.equal(buildChordTrack(MINOR, 4, { mode: 'dorian' }).key.mode, 'dorian')
})

// ---- cadence position (§C.1) -------------------------------------------------------------------

test('cadence substitution is position-conditional: only ever the phrase-FINAL chord, and it is a harmonic-minor V', () => {
  let sawCadential = false
  for (let seed = 0; seed < 400; seed++) {
    const track = buildChordTrack(MINOR, seed, { mode: 'natural-minor' })
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

test('cadence:false disables the substitution; major and modal keys never cadential by default', () => {
  for (let seed = 0; seed < 200; seed++) {
    assert.ok(!buildChordTrack(MINOR, seed, { cadence: false }).chords.some((c) => c.cadential))
    assert.ok(!buildChordTrack(MAJOR, seed).chords.some((c) => c.cadential))
    // the borrowed harmonic-minor V is the NATURAL-minor move; Phrygian/Dorian cadence elsewhere
    assert.ok(!buildChordTrack(MINOR, seed, { mode: 'phrygian' }).chords.some((c) => c.cadential))
    assert.ok(!buildChordTrack(MINOR, seed, { mode: 'dorian' }).chords.some((c) => c.cadential))
  }
  // forced on over a modal track, the V is still spelled from natural minor (a borrowed chord)
  const forced = buildChordTrack(MINOR, 3, { mode: 'phrygian', cadence: true, barsPerChord: 1 })
  const last = forced.chords[forced.chords.length - 1]!
  if (last.cadential) assert.deepEqual(last.tones.map((t) => t - last.tones[0]!), [0, 4, 7])
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

// ---- rhythm-skeleton variety (owner ear-report, 2026-07-26) ------------------------------------
// Calibration: before this work the five bass archetypes produced EIGHT distinct onset skeletons
// across 144 draws of a simulated 9-batch round (~9.6 same-skeleton repeats per 15 figures) — the
// owner heard it in blind rating as "a lot of the same note patterns again". After: 99 skeletons,
// 0.87 repeats per 15. These guards pin the mechanism, not the exact numbers.

const onsetKey = (notes: readonly { start: number }[]): string =>
  [...new Set(notes.map((n) => Math.round(n.start)))].sort((a, b) => a - b).join(',')

test('each bass archetype has a FAMILY of rhythmic realizations, not one fixed slot list', () => {
  for (const archetype of THEORY_BASS_ARCHETYPES) {
    const skeletons = new Set<string>()
    for (let seed = 0; seed < 40; seed++) {
      const track = buildChordTrack(MINOR, seed)
      skeletons.add(onsetKey(composeTheoryBass(archetype, track, seed)))
    }
    assert.ok(skeletons.size >= 6, `${archetype} produced only ${skeletons.size} distinct skeletons in 40 draws`)
  }
})

test('bassBarSchedule states the pattern in bar 1 and restates it in full in the last bar', () => {
  for (let seed = 0; seed < 60; seed++) {
    const sched = bassBarSchedule(mulberry32(seed), [0, 4, 8, 10, 12, 14], 4)
    assert.equal(sched.length, 4)
    assert.equal(sched[0]!.kind, 'full', 'bar 1 states the pattern')
    assert.equal(sched[3]!.kind, 'full', 'the last bar restates it in full')
    // every middle bar carries at most ONE change, on a slot inside the bar
    for (const c of sched.slice(1, 3)) {
      if (c.kind === 'full') continue
      assert.ok(c.slot >= 0 && c.slot < 16, 'a scheduled change stays inside its bar')
      if (c.kind === 'push') assert.ok(c.slot < 15, 'a pushed note cannot cross the barline')
    }
  }
})

test("the Stussy recipe's OWN per-bar schedule survives the seeded variation", () => {
  // §C.2 verbatim: bar 2 turns the slot-7 octave into a tonic; bar 3 skips slot 14; bar 4 is full.
  for (let seed = 0; seed < 30; seed++) {
    const track = buildChordTrack(MINOR, seed, { barsPerChord: 1 })
    const notes = composeTheoryBass('stussy', track, seed)
    const rootOf = (bar: number): number => track.key.root - 12 + chordAtStep(track, bar * 16).rootOffset
    const at = (bar: number, slot: number): number[] => notes.filter((n) => Math.round(n.start) === bar * 16 + slot).map((n) => n.pitch)
    for (const bar of [0, 1, 2, 3]) assert.ok(at(bar, 0).includes(rootOf(bar)), `bar ${bar + 1} keeps the slot-1 tonic`)
    assert.deepEqual(at(1, 6), [rootOf(1)], 'bar 2: the slot-7 octave becomes the tonic')
    assert.deepEqual(at(2, 14), [], 'bar 3: slot 14 is skipped')
    assert.ok(at(3, 14).length > 0, 'bar 4: the full pattern returns')
  }
})

test('a bass figure is never four copies of bar 1 — the per-bar schedule always changes something', () => {
  let variedFigures = 0
  let total = 0
  for (const archetype of THEORY_BASS_ARCHETYPES) {
    for (let seed = 0; seed < 40; seed++) {
      const track = buildChordTrack(MINOR, seed, { barsPerChord: 4 }) // one chord: only RHYTHM can differ
      const notes = composeTheoryBass(archetype, track, seed)
      const bars = [0, 1, 2, 3].map((b) => onsetKey(notes.filter((n) => Math.floor(n.start / 16) === b).map((n) => ({ start: n.start - b * 16 }))))
      total += 1
      if (new Set(bars).size > 1) variedFigures += 1
    }
  }
  assert.ok(variedFigures / total > 0.6, `only ${variedFigures}/${total} figures vary bar-to-bar`)
})

test('every bass archetype is deterministic in its seed across the new seeded realizations', () => {
  for (const archetype of THEORY_BASS_ARCHETYPES) {
    for (let seed = 0; seed < 20; seed++) {
      const track = buildChordTrack(MINOR, seed)
      assert.deepEqual(composeTheoryBass(archetype, track, seed), composeTheoryBass(archetype, track, seed))
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

test('each chord archetype has a family of rhythmic realizations, and the opening voicing is seeded', () => {
  for (const archetype of THEORY_CHORD_ARCHETYPES) {
    const skeletons = new Set<string>()
    for (let seed = 0; seed < 40; seed++) {
      const track = buildChordTrack(MINOR, seed)
      skeletons.add(onsetKey(composeTheoryChords(archetype, track, seed)))
    }
    assert.ok(skeletons.size >= 6, `${archetype} produced only ${skeletons.size} distinct skeletons in 40 draws`)
  }
  // the SAME chord, drawn many times, opens on more than one voicing — but always a compact one
  const track = buildChordTrack(MINOR, 9, { barsPerChord: 1, mode: 'natural-minor' })
  const chord = track.chords[0]!
  const openings = new Set<string>()
  for (let seed = 0; seed < 60; seed++) {
    const v = chooseOpeningVoicing(track.key, chord, 'triad', mulberry32(seed))
    openings.add(v.join(','))
    assert.ok(Math.min(...v) >= track.key.root, 'an opening voicing never dips into the sub')
    assert.ok(Math.max(...v) - Math.min(...v) <= 24, 'an opening voicing stays close-position')
  }
  assert.ok(openings.size >= 2, `the opening voicing is seeded, got ${openings.size} distinct`)
})

test('chord figures are deterministic in the seed across the new seeded realizations', () => {
  for (const archetype of THEORY_CHORD_ARCHETYPES) {
    for (let seed = 0; seed < 20; seed++) {
      const track = buildChordTrack(MINOR, seed)
      assert.deepEqual(composeTheoryChords(archetype, track, seed), composeTheoryChords(archetype, track, seed))
    }
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

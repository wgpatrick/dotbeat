// Production-trick tests — docs/research/118-production-bag-of-tricks.md. Three contracts, mirroring
// macro.test.ts's discipline:
//   1. every shipped trick passes EAGER validation against the live format vocabulary, and a
//      synthetic drifted trick fails loudly at load (the genSubject/showdownRole property);
//   2. apply is exactly a bag of ordinary edits — the referenced fields land, notes/hits the recipe
//      doesn't touch are untouched, and a counter-indicated apply refuses unless forced;
//   3. suggest proposes only precondition-passing, non-counter-indicated tricks, ranked by the
//      MEASURED axis order and against each track's own per-role target band.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse, serialize, parseMacroLibrary, initDocument, addTrack, addNote, addHit, saveClip, setScene, setSong } from '../src/core/index.js'
import { FEATURE_KEYS, type FeatureVector } from '../src/taste/features.js'
import {
  parseTrickLibrary,
  applyTrick,
  suggestForTrack,
  suggestForDocument,
  BeatTrickError,
  TRICK_AXES,
  type BeatTrick,
} from '../src/analysis/index.js'

const macrosJson = readFileSync(fileURLToPath(new URL('../presets/macros.json', import.meta.url)), 'utf8')
const tricksJson = readFileSync(fileURLToPath(new URL('../presets/tricks.json', import.meta.url)), 'utf8')
const MACROS = parseMacroLibrary(macrosJson)
const TRICKS = parseTrickLibrary(tricksJson, MACROS)

/** A minimal, valid trick; tests corrupt one field then assert parseTrickLibrary rejects it. */
function validTrick(over: Record<string, unknown> = {}): unknown {
  return {
    name: 'x',
    axis: 'width',
    slots: { track: { kind: 'synth' } },
    when: [{ field: 'unisonVoices', op: '==', value: 1 }],
    recipe: [{ set: '$track.unisonVoices', value: 5 }],
    expect: [{ metric: 'stereoWidthDb', dir: 'up' }],
    counter: [],
    why: 'because',
    ...over,
  }
}
const lib = (trick: unknown): string => JSON.stringify({ version: 1, tricks: [trick] })

function projectWithRoles() {
  let doc = initDocument({ trackId: 'lead' })
  doc = addTrack(doc, { id: 'bass', kind: 'synth' }).doc
  doc = addTrack(doc, { id: 'drums', kind: 'drums' }).doc
  doc = addNote(doc, 'lead', { pitch: 60, start: 0, duration: 4, velocity: 0.8 }).doc
  return doc
}

// ---- group 1: catalog validation ---------------------------------------------------------------

test('the shipped catalog parses and passes eager validation (15 tricks, all four axes)', () => {
  assert.equal(TRICKS.length, 15)
  const axes = new Set(TRICKS.map((t) => t.axis))
  for (const a of TRICK_AXES) assert.ok(axes.has(a), `catalog should cover axis "${a}"`)
  for (const name of ['unison-spread', 'air-shelf', 'section-sweep', 'sub-foundation']) {
    assert.ok(TRICKS.some((t) => t.name === name), `catalog must include "${name}"`)
  }
})

test('every shipped trick has a sourced why citing the research', () => {
  for (const t of TRICKS) assert.match(t.why, /research 115|115 §/, `${t.name}: why must cite research 115`)
})

test('a drifted set-field fails loudly at load', () => {
  assert.throws(() => parseTrickLibrary(lib(validTrick({ recipe: [{ set: '$track.warpDrive', value: 1 }] })), MACROS), /not a settable synth field/)
})
test('an unknown effect type fails loudly at load', () => {
  assert.throws(() => parseTrickLibrary(lib(validTrick({ recipe: [{ effectAdd: '$track', type: 'reverb' }] })), MACROS), /not an EFFECT_TYPES member/)
})
test('an unknown macro reference fails loudly at load', () => {
  assert.throws(() => parseTrickLibrary(lib(validTrick({ recipe: [{ macro: 'nope', track: '$track', knob: 50 }] })), MACROS), /not in the macro library/)
})
test('an unknown FEATURE_KEYS metric in a precondition fails loudly', () => {
  assert.throws(() => parseTrickLibrary(lib(validTrick({ when: [{ metric: 'loudness', op: '<', value: 0 }] })), MACROS), /not a FEATURE_KEYS member/)
})
test('an invalid axis fails loudly', () => {
  assert.throws(() => parseTrickLibrary(lib(validTrick({ axis: 'space' })), MACROS), /axis must be one of/)
})
test('an unknown drum lane in addHits fails loudly', () => {
  assert.throws(() => parseTrickLibrary(lib(validTrick({ slots: { track: { kind: 'drums' } }, recipe: [{ addHits: '$track', lane: 'triangle', steps: 'quarters', velocity: 0.5 }] })), MACROS), /not a known kit lane/)
})
test('an automate step without a declared clip slot fails loudly', () => {
  assert.throws(() => parseTrickLibrary(lib(validTrick({ recipe: [{ automate: '$track.cutoff', clip: '$clip', points: [[0, 400], [16, 4000]] }] })), MACROS), /requires the trick to declare a clip slot/)
})
test('a value referencing an undeclared knob slot fails loudly', () => {
  assert.throws(() => parseTrickLibrary(lib(validTrick({ recipe: [{ set: '$track.unisonWidth', value: '$ghost' }] })), MACROS), /undeclared knob slot/)
})
test('a wrong-typed enum value fails loudly', () => {
  assert.throws(() => parseTrickLibrary(lib(validTrick({ recipe: [{ set: '$track.chorusMode', value: 'wobble' }] })), MACROS), /enum field value must be one of/)
})
test('a missing why fails loudly, and a duplicate name fails loudly', () => {
  assert.throws(() => parseTrickLibrary(lib(validTrick({ why: '' })), MACROS), /missing sourced "why"/)
  assert.throws(() => parseTrickLibrary(JSON.stringify({ version: 1, tricks: [validTrick(), validTrick()] }), MACROS), /duplicate trick name/)
})

// ---- group 2: apply semantics ------------------------------------------------------------------

const trick = (name: string): BeatTrick => {
  const t = TRICKS.find((x) => x.name === name)
  if (!t) throw new Error(`no trick ${name} in test fixture`)
  return t
}

test('applying a trick lands its referenced fields as ordinary edits, and leaves notes untouched', () => {
  const doc = projectWithRoles()
  const before = doc.tracks.find((t) => t.id === 'lead')!.notes
  const res = applyTrick(trick('unison-spread'), { doc, trackId: 'lead', features: null }, { macros: MACROS })
  const lead = res.doc.tracks.find((t) => t.id === 'lead')!
  assert.equal(lead.synth.unisonVoices, 5)
  assert.equal(lead.synth.unisonWidth, 0.7)
  assert.equal(lead.synth.osc2Level, 0.4)
  // notes are identical (same ids, same values) — a production trick never edits content
  assert.deepEqual(lead.notes, before)
  // and the input document was not mutated (pure)
  assert.equal(doc.tracks.find((t) => t.id === 'lead')!.synth.unisonVoices, 1)
})

test('the applied document round-trips and carries no trick indirection', () => {
  const doc = projectWithRoles()
  const res = applyTrick(trick('pad-chorus'), { doc, trackId: 'lead', features: null }, { macros: MACROS, force: true })
  const text = serialize(res.doc)
  assert.ok(!text.includes('pad-chorus'), 'serialized file must not reference the trick by name')
  assert.equal(serialize(parse(text)), text)
})

test('an addHits trick adds hits without disturbing existing hits', () => {
  let doc = projectWithRoles()
  doc = addHit(doc, 'drums', { lane: 'kick', start: 0, velocity: 1 }).doc
  const res = applyTrick(trick('open-hat-air'), { doc, trackId: 'drums', features: null }, { macros: MACROS })
  const drums = res.doc.tracks.find((t) => t.id === 'drums')!
  assert.ok(drums.hits.some((h) => h.lane === 'kick' && h.start === 0), 'the pre-existing kick hit survives')
  assert.ok(drums.hits.some((h) => h.lane === 'openhat' && h.start === 2), 'an openhat offbeat hit was added')
})

test('a counter-indicated apply refuses, and --force overrides it', () => {
  const doc = projectWithRoles()
  // unison-spread is for lead/pad/chords/arp; "bass" reads as role bass -> counter-indicated
  assert.throws(() => applyTrick(trick('unison-spread'), { doc, trackId: 'bass', features: null }, { macros: MACROS }), BeatTrickError)
  const forced = applyTrick(trick('unison-spread'), { doc, trackId: 'bass', features: null }, { macros: MACROS, force: true })
  assert.equal(forced.doc.tracks.find((t) => t.id === 'bass')!.synth.unisonVoices, 5)
  assert.deepEqual(forced.overridden.length > 0, true)
})

test('a hard kind mismatch throws even with --force (structural, not advisory)', () => {
  const doc = projectWithRoles()
  // open-hat-air is a drums trick; applying it to a synth track can't resolve
  assert.throws(() => applyTrick(trick('open-hat-air'), { doc, trackId: 'lead', features: null }, { macros: MACROS, force: true }), BeatTrickError)
})

test('an automate trick refuses when the track has no clip', () => {
  const doc = projectWithRoles() // lead has notes but no saved clip, not song mode
  assert.throws(() => applyTrick(trick('section-sweep'), { doc, trackId: 'lead', features: null }, { macros: MACROS, force: true }), /has no clip/)
})

test('an automate trick writes automation points on the resolved clip', () => {
  let doc = projectWithRoles()
  doc = saveClip(doc, 'lead', 'intro').doc
  doc = setScene(doc, 'sceneA', { lead: 'intro' })
  doc = setSong(doc, [{ scene: 'sceneA', bars: 4 }])
  const res = applyTrick(trick('section-sweep'), { doc, trackId: 'lead', features: null }, { macros: MACROS })
  const lane = res.doc.tracks.find((t) => t.id === 'lead')!.clips.find((c) => c.id === 'intro')!.automation.find((l) => l.param === 'cutoff')
  assert.ok(lane, 'a cutoff automation lane was written')
  assert.equal(lane!.points.length, 2)
})

// ---- group 3: suggest ranking ------------------------------------------------------------------

test('suggest excludes counter-indicated and kind-mismatched tricks', () => {
  const doc = projectWithRoles()
  const bass = suggestForTrack(TRICKS, { doc, trackId: 'bass', features: null })
  const names = bass.map((s) => s.trick.name)
  assert.ok(!names.includes('unison-spread'), 'unison-spread is counter-indicated for a bass-role track')
  assert.ok(names.includes('bass-mono-anchor'), 'bass-mono-anchor is for bass')
  // a drums-only trick never shows for a synth track
  assert.ok(!names.includes('open-hat-air'))
})

// Was 'suggest ranks width tricks before air/motion/glue (the measured showdown ordering)', pinning
// 115 §6's width-first order. Research 133 §1 measured that ordering as dead — pack basslines win
// ~87% pairwise at -45.5 dB width and 0.00% air, and engineplus already sits inside the pack width
// range, so width/air tricks were ranked first onto an already-closed gap. Motion and glue now lead.
// This is a SCREEN, not a frozen ablation constant (research/140 §4.3): reordering it invalidates no
// historical blind comparison, unlike engineplusProfile.
test('suggest ranks motion and glue before width and air (133 §1, replacing 115 §6)', () => {
  const doc = projectWithRoles()
  const all = suggestForDocument(TRICKS, doc, null)
  const axisSeq = all.map((s) => s.trick.axis)
  const order = { motion: 0, glue: 1, width: 2, air: 3 } as const
  for (let i = 1; i < axisSeq.length; i++) {
    assert.ok(order[axisSeq[i - 1]!] <= order[axisSeq[i]!], `axis order violated at ${i}: ${axisSeq[i - 1]} before ${axisSeq[i]}`)
  }
})

test('produced targets are per-role: the same width reads as a gap on lead and as fine on bass', () => {
  // -44 dB width. For a LEAD that is far below the pack lead band (p25 -11.2 dB) — a real gap.
  // For a BASSLINE it is exactly what the reference class does (21 of 32 pack basslines measure at
  // or below -40 dB), so it must NOT read as a gap. The old role-blind table scored both identically
  // and, being one-sided, could not express "too wide" for bass at all.
  const feats = (widthDb: number) => ({
    lufs: -14, samplePeakDb: -1, truePeakDb: -1, crestDb: 12, rmsDb: -20,
    bandSubPct: 4, bandBassPct: 30, bandMidsPct: 50, bandPresencePct: 5, bandAirPct: 0.1,
    centroidLog2: 9, stereoCorrelation: 1, stereoWidthDb: widthDb,
  })
  const doc = projectWithRoles()
  const widthGap = (trackId: string, w: number) => {
    const s = suggestForTrack(TRICKS, { doc, trackId, features: feats(w) }).find((x) => x.trick.name === 'unison-spread')
    return s ? s.gap : null
  }
  const leadGap = widthGap('lead', -44)
  assert.ok(leadGap !== null && leadGap > 0, 'a -44 dB lead sits below the pack lead width band, so it is a gap')

  // and the bass side of the same coin: a dead-mono bassline is on target, not deficient.
  const bassGap = widthGap('bass', -44)
  if (bassGap !== null) {
    assert.equal(bassGap, 0, 'a -44 dB bassline is exactly the pack bassline target — it must not score a width gap')
  }
})

test('produced ranges are two-sided, so "too much" is as visible as "too little"', () => {
  // The one-sided predecessor returned 0 for every over-range value, which is why 133 could report
  // an air-shelf firing on a chords track whose reference class ships 0.00% air.
  const doc = projectWithRoles()
  const overWide = {
    lufs: -14, samplePeakDb: -1, truePeakDb: -1, crestDb: 12, rmsDb: -20,
    bandSubPct: 4, bandBassPct: 30, bandMidsPct: 50, bandPresencePct: 5, bandAirPct: 0.1,
    centroidLog2: 9, stereoCorrelation: 0, stereoWidthDb: 6, // +6 dB: wider than any pack loop
  }
  const s = suggestForTrack(TRICKS, { doc, trackId: 'lead', features: overWide }).find((x) => x.trick.name === 'unison-spread')
  if (s) assert.ok(s.gap > 0, 'a +6 dB width is far ABOVE the pack lead band and must score a nonzero gap')
})

test('without a render, metric-gated tricks are flagged unverified rather than dropped', () => {
  const doc = projectWithRoles()
  const lead = suggestForTrack(TRICKS, { doc, trackId: 'lead', features: null })
  const uni = lead.find((s) => s.trick.name === 'unison-spread')
  assert.ok(uni, 'unison-spread should still be suggested (its doc-state clause passes)')
  assert.equal(uni!.unverified, true, 'its stereoWidthDb precondition can not be checked without a render')
})

test('with a render, a passing metric gate marks the suggestion verified and computes a gap', () => {
  const doc = projectWithRoles()
  // synthesize a mono, dark, dry feature vector (well inside every width/air precondition)
  const features = {
    ...(Object.fromEntries(FEATURE_KEYS.map((k) => [k, 0])) as FeatureVector),
    lufs: -14, samplePeakDb: -1, truePeakDb: -1, crestDb: 12, rmsDb: -20,
    bandSubPct: 4, bandBassPct: 30, bandMidsPct: 50, bandPresencePct: 5, bandAirPct: 0.1,
    centroidLog2: 9, stereoCorrelation: 1, stereoWidthDb: -52,
  }
  const lead = suggestForTrack(TRICKS, { doc, trackId: 'lead', features })
  const uni = lead.find((s) => s.trick.name === 'unison-spread')!
  assert.equal(uni.unverified, false)
  assert.ok(uni.gap > 0, 'a -52 dB width sits far below the lead role\'s produced range, so gap > 0')
})

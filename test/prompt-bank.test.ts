// I9 — the generation prompt bank (src/taste/seeds.ts, lines 208+) had ZERO dedicated tests despite
// being 240 lines of the crown-jewels layer: it is what every gen clip in every rated batch was
// actually asked for. Four parallel maps keyed by the same id space with nothing binding them
// (GEN_SUBJECTS / PHRASE_VARIANTS / PHRASE_ISOLATION / PHRASE_NEGATIVE), and four seeded generators
// on top. A phrase subject added to one map and not the others silently ships a broken prompt —
// exactly the failure the owner's 2026-07-25 rating pass caught (Lyria putting drums in "no drums"
// bassline clips), whose fix added the fourth map rather than closing the class of bug.
//
// Two jobs here:
//   1. SNAPSHOT the banks so a silent edit is loud. These are prompts that rated batches were
//      generated from; changing one changes what a future batch means relative to the archive.
//   2. Pin the four maps' SYNC invariant and each generator's determinism.
//
// IF A SNAPSHOT FAILS: someone edited the prompt bank. That may be entirely intended (adding a
// variant is normal) — update the snapshot in the SAME commit as the edit, so the diff shows both
// halves. What must never happen is the bank moving with no diff anywhere saying so.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  GEN_SUBJECTS,
  PHRASE_VARIANTS,
  PHRASE_ISOLATION,
  PHRASE_NEGATIVE,
  genSubject,
  genSubjectVaried,
  genStyles,
  generateGenPrompts,
  generateGenStyleBatches,
  generateStyleContrasts,
  stylePromptsFor,
} from '../src/taste/seeds.js'
import { mulberry32 } from '../src/taste/eval.js'

// ---- bank snapshots ----------------------------------------------------------------------------

test('GEN_SUBJECTS: snapshot of the id/seconds spine (17 subjects, one-shot + phrase tiers)', () => {
  assert.deepEqual(
    GEN_SUBJECTS.map((s) => [s.id, s.seconds]),
    [
      ['kick', 1], ['snare', 1], ['clap', 1], ['hat', 1], ['perc', 1],
      ['bass', 2], ['pluck', 2], ['stab', 2],
      ['pad', 4], ['texture', 4],
      ['vox', 2], ['riser', 3], ['impact', 3],
      // phrase tier — the ~8s / 4-bar material the showdown's gen arm draws from
      ['melody', 8], ['bassline', 8], ['chords', 8], ['drumloop', 8],
    ],
  )
  assert.equal(new Set(GEN_SUBJECTS.map((s) => s.id)).size, GEN_SUBJECTS.length, 'ids are unique')
  for (const s of GEN_SUBJECTS) assert.ok(s.subject.length > 0 && s.seconds > 0)
})

test('PHRASE_VARIANTS: snapshot — 4 phrase ids x 7 genre/mood variants, variants[0] IS the default subject', () => {
  assert.deepEqual(Object.keys(PHRASE_VARIANTS), ['melody', 'bassline', 'chords', 'drumloop'])
  for (const [id, variants] of Object.entries(PHRASE_VARIANTS)) {
    assert.equal(variants.length, 7, `${id} carries 7 variants`)
    assert.equal(new Set(variants).size, 7, `${id} variants are distinct`)
    // the deliberate duplication F7 will remove: variants[0] is verbatim GEN_SUBJECTS[id].subject
    assert.equal(variants[0], genSubject(id).subject, `${id}: variants[0] must equal the default subject`)
  }
  assert.deepEqual(PHRASE_VARIANTS['melody'], [
    'a melodic synth lead phrase, 4 bar loop, catchy and emotive',
    'a dark minor-key arpeggio lead phrase, 4 bars, moody and driving',
    'an uplifting trance lead phrase, 4 bars, soaring and bright',
    'a breezy pop synth topline, 4 bars, simple and hooky',
    'an aggressive acid-style lead phrase, 4 bars, squelchy and relentless',
    'a jazzy, syncopated synth lead phrase, 4 bars, playful and loose',
    'a sparse, spacious ambient lead phrase, 4 bars, slow and airy',
  ])
  assert.deepEqual(PHRASE_VARIANTS['bassline'], [
    'a rolling deep house bassline loop, 4 bars, groovy and hypnotic',
    'a dark techno sub bassline loop, 4 bars, driving and hypnotic',
    'a funky disco bassline loop, 4 bars, syncopated and bouncy',
    'a moody drum-and-bass reese bassline loop, 4 bars, growling and dense',
    'a laid-back downtempo bassline loop, 4 bars, warm and round',
    'a trap-influenced 808 bassline loop, 4 bars, sliding and sparse',
    'a jazzy walking bassline loop, 4 bars, loose and swung',
  ])
  assert.deepEqual(PHRASE_VARIANTS['chords'], [
    'a chord progression loop, lush warm chords, 4 bars',
    'a moody minor chord-stab progression, 4 bars, dark and tense',
    'a bright major arpeggiated chord progression, 4 bars, uplifting and open',
    'a jazzy extended-7th chord progression, 4 bars, sophisticated and smooth',
    'a staccato plucked chord progression, 4 bars, rhythmic and percussive',
    'a slow ambient sustained-pad chord progression, 4 bars, spacious and dreamy',
    'a gritty distorted chord-stab progression, 4 bars, aggressive and raw',
  ])
  assert.deepEqual(PHRASE_VARIANTS['drumloop'], [
    'a full drum loop, 4 bars, punchy and groovy',
    'a four-on-the-floor house drum loop, 4 bars, driving and steady',
    'a syncopated breakbeat drum loop, 4 bars, choppy and energetic',
    'a fast drum-and-bass drum loop, 4 bars, rolling and intricate',
    'a trap-style drum loop, 4 bars, sparse with rapid hi-hat rolls',
    'a laid-back downtempo drum loop, 4 bars, loose and swung',
    'a lo-fi boom-bap drum loop, 4 bars, dusty and swung',
  ])
})

test('PHRASE_ISOLATION: snapshot — the "one role per clip" clause appended to every phrase prompt', () => {
  assert.deepEqual(PHRASE_ISOLATION, {
    melody: 'isolated solo lead melody stem only, no drums, no other instruments',
    bassline: 'isolated solo bassline stem only, absolutely no drums, no percussion, no other instruments',
    chords: 'isolated chords stem only, no drums, no bass, no other instruments',
    drumloop: 'drums only, no melodic instruments',
  })
})

test('PHRASE_NEGATIVE: snapshot — the real negative_prompt channel (the 2026-07-25 Lyria fix)', () => {
  // every phrase role must negate the OTHER roles' material — a bassline clip that doesn't say
  // "drums" is exactly the bug this map was added to fix. (Read before the deepEqual below: node's
  // strict assert narrows its first argument to the literal shape.)
  for (const id of ['melody', 'bassline', 'chords']) assert.match(PHRASE_NEGATIVE[id]!, /drums/)
  assert.match(PHRASE_NEGATIVE['drumloop']!, /melody/)
  // prose negations inside the positive prompt are demonstrably ignored; these strings are the fix.
  assert.deepEqual(PHRASE_NEGATIVE, {
    melody: 'drums, percussion, kick drum, snare, hi-hats, cymbals, bass, vocals',
    bassline: 'drums, percussion, kick drum, snare, hi-hats, cymbals, lead melody, chords, vocals',
    chords: 'drums, percussion, kick drum, snare, hi-hats, cymbals, bass, lead melody, vocals',
    drumloop: 'melody, bassline, chords, synths, vocals',
  })
})

test('GEN_STYLES: snapshot — the 8 production-texture treatments layered on top of every subject', () => {
  assert.deepEqual(genStyles(), [
    'analog warmth, tape saturation',
    'clean and modern, club-ready',
    'lo-fi, dusty, vinyl character',
    'dark and cavernous, heavy reverb',
    'bright and glassy, digital sheen',
    'organic and acoustic-leaning',
    'gritty distorted electronic',
    'soft, intimate, close-mic feel',
  ])
})

// ---- the four-map sync invariant (F7) ----------------------------------------------------------

test('the four parallel maps stay in sync: same key set, all real GEN_SUBJECTS ids', () => {
  const variantIds = Object.keys(PHRASE_VARIANTS).sort()
  assert.deepEqual(Object.keys(PHRASE_ISOLATION).sort(), variantIds, 'PHRASE_ISOLATION covers exactly the variant ids')
  assert.deepEqual(Object.keys(PHRASE_NEGATIVE).sort(), variantIds, 'PHRASE_NEGATIVE covers exactly the variant ids')
  const subjectIds = new Set(GEN_SUBJECTS.map((s) => s.id))
  for (const id of variantIds) assert.ok(subjectIds.has(id), `${id} is a real GEN_SUBJECTS id`)
  // every phrase-tier subject (the ~8s material) needs all three side maps — the sync rule the
  // discriminated-union model (F7) will make uncompilable rather than merely tested
  for (const s of GEN_SUBJECTS) {
    if (s.seconds < 8) continue
    assert.ok(PHRASE_VARIANTS[s.id], `phrase-tier subject ${s.id} needs variants`)
    assert.ok(PHRASE_ISOLATION[s.id], `phrase-tier subject ${s.id} needs an isolation clause`)
    assert.ok(PHRASE_NEGATIVE[s.id], `phrase-tier subject ${s.id} needs a negative prompt`)
  }
})

test('genSubject / genSubjectVaried: one-shots pass through, phrase ids draw a variant + isolation', () => {
  assert.deepEqual(genSubject('kick'), { id: 'kick', subject: 'a punchy kick drum one-shot', seconds: 1 })
  assert.throws(() => genSubject('nope'), /unknown gen subject/)
  // a one-shot has no variants bank — genSubjectVaried is the identity there, whatever the rng
  assert.deepEqual(genSubjectVaried('kick', mulberry32(7)), genSubject('kick'))
  // a phrase id: some variant of the bank, with the role's isolation clause appended
  for (const id of Object.keys(PHRASE_VARIANTS)) {
    for (const seed of [0, 1, 7, 4242]) {
      const v = genSubjectVaried(id, mulberry32(seed))
      assert.equal(v.id, id)
      assert.equal(v.seconds, genSubject(id).seconds)
      assert.ok(v.subject.endsWith(`, ${PHRASE_ISOLATION[id]}`), `${id}/${seed}: isolation clause appended`)
      const base = v.subject.slice(0, v.subject.length - PHRASE_ISOLATION[id]!.length - 2)
      assert.ok(PHRASE_VARIANTS[id]!.includes(base), `${id}/${seed}: "${base}" is a real variant`)
    }
  }
  // deterministic in the rng seed
  assert.deepEqual(genSubjectVaried('melody', mulberry32(11)), genSubjectVaried('melody', mulberry32(11)))
})

// ---- generator determinism + output snapshots ---------------------------------------------------
// These four generators are the only consumers of the prompt bank, and the ONLY thing that has ever
// pinned their behavior is this file. The snapshots below are seed -> prompt mappings; they change
// whenever the shuffle changes (see the Fisher-Yates commit) or the bank changes. Determinism (same
// seed -> same output) is the invariant that must hold regardless.

test('generateGenPrompts: deterministic, stratified across subjects, snapshot at seed 11', () => {
  assert.deepEqual(generateGenPrompts(11, 6), generateGenPrompts(11, 6), 'same seed, same prompts')
  assert.notDeepEqual(generateGenPrompts(11, 6), generateGenPrompts(12, 6), 'a different seed draws differently')
  const out = generateGenPrompts(11, 6)
  // stratification: with 17 subjects and 6 draws, no subject repeats
  assert.equal(new Set(out.map((p) => p.id)).size, 6)
  for (const p of out) assert.ok(p.prompt.length > 0 && p.seconds > 0)
  assert.deepEqual(out, [
    { id: 'vox1', prompt: 'a short wordless vocal chop, sung vowel, gritty distorted electronic', seconds: 2 },
    { id: 'kick1', prompt: 'a punchy kick drum one-shot, gritty distorted electronic', seconds: 1 },
    { id: 'chords1', prompt: 'a bright major arpeggiated chord progression, 4 bars, uplifting and open, isolated chords stem only, no drums, no bass, no other instruments, analog warmth, tape saturation', seconds: 8 },
    { id: 'snare1', prompt: 'a tight snare drum one-shot, analog warmth, tape saturation', seconds: 1 },
    { id: 'bassline1', prompt: 'a trap-influenced 808 bassline loop, 4 bars, sliding and sparse, isolated solo bassline stem only, absolutely no drums, no percussion, no other instruments, dark and cavernous, heavy reverb', seconds: 8 },
    { id: 'clap1', prompt: 'a layered hand clap one-shot, bright and glassy, digital sheen', seconds: 1 },
  ])
})

test('stylePromptsFor: one subject in n DISTINCT styles, deterministic, snapshot at seed 9', () => {
  const subject = 'a punchy kick drum one-shot'
  assert.deepEqual(stylePromptsFor(subject, 4, 9), stylePromptsFor(subject, 4, 9))
  assert.notDeepEqual(stylePromptsFor(subject, 4, 9), stylePromptsFor(subject, 4, 10))
  const four = stylePromptsFor(subject, 4, 9)
  assert.equal(new Set(four).size, 4, 'styles are sampled WITHOUT replacement')
  assert.deepEqual(four, [
    'a punchy kick drum one-shot, clean and modern, club-ready',
    'a punchy kick drum one-shot, lo-fi, dusty, vinyl character',
    'a punchy kick drum one-shot, soft, intimate, close-mic feel',
    'a punchy kick drum one-shot, organic and acoustic-leaning',
  ])
  // n beyond the 8-style bank cycles rather than throwing
  const ten = stylePromptsFor(subject, 10, 9)
  assert.equal(ten.length, 10)
  assert.deepEqual(ten.slice(0, 8), [...new Set(ten.slice(0, 8))], 'the first pass through the bank is distinct')
  assert.deepEqual(ten.slice(8), ten.slice(0, 2), 'then it cycles')
})

test('generateGenStyleBatches: one subject x n distinct styles per batch, snapshot at seed 3', () => {
  assert.deepEqual(generateGenStyleBatches(3, 2, 3), generateGenStyleBatches(3, 2, 3))
  assert.notDeepEqual(generateGenStyleBatches(3, 2, 3), generateGenStyleBatches(4, 2, 3))
  const out = generateGenStyleBatches(3, 2, 3)
  for (const b of out) assert.equal(new Set(b.prompts).size, 3, 'within-batch styles are distinct (the diversity fix)')
  assert.equal(new Set(out.map((b) => b.id)).size, 2, 'subjects are stratified across batches')
  assert.deepEqual(out, [
    {
      id: 'perc1',
      label: 'a resonant percussion hit',
      seconds: 1,
      prompts: [
        'a resonant percussion hit, analog warmth, tape saturation',
        'a resonant percussion hit, clean and modern, club-ready',
        'a resonant percussion hit, lo-fi, dusty, vinyl character',
      ],
    },
    {
      id: 'clap1',
      label: 'a layered hand clap one-shot',
      seconds: 1,
      prompts: [
        'a layered hand clap one-shot, analog warmth, tape saturation',
        'a layered hand clap one-shot, lo-fi, dusty, vinyl character',
        'a layered hand clap one-shot, organic and acoustic-leaning',
      ],
    },
  ])
})

test('generateStyleContrasts: ONE subject x several styles per contrast, snapshot at seed 5', () => {
  assert.deepEqual(generateStyleContrasts(5, 3), generateStyleContrasts(5, 3))
  assert.notDeepEqual(generateStyleContrasts(5, 3), generateStyleContrasts(6, 3))
  const out = generateStyleContrasts(5, 3)
  for (const c of out) {
    assert.equal(c.prompts.length, 4, 'stylesPer defaults to 4')
    assert.equal(new Set(c.prompts).size, 4)
    for (const p of c.prompts) assert.ok(p.startsWith(c.subject), 'every prompt is the SAME subject, a different treatment')
  }
  assert.deepEqual(out, [
    {
      id: 'percsc1',
      subject: 'a resonant percussion hit',
      seconds: 1,
      prompts: [
        'a resonant percussion hit, gritty distorted electronic',
        'a resonant percussion hit, analog warmth, tape saturation',
        'a resonant percussion hit, organic and acoustic-leaning',
        'a resonant percussion hit, clean and modern, club-ready',
      ],
    },
    {
      id: 'kicksc2',
      subject: 'a punchy kick drum one-shot',
      seconds: 1,
      prompts: [
        'a punchy kick drum one-shot, lo-fi, dusty, vinyl character',
        'a punchy kick drum one-shot, dark and cavernous, heavy reverb',
        'a punchy kick drum one-shot, bright and glassy, digital sheen',
        'a punchy kick drum one-shot, gritty distorted electronic',
      ],
    },
    {
      id: 'stabsc3',
      subject: 'a wide chord stab one-shot',
      seconds: 2,
      prompts: [
        'a wide chord stab one-shot, soft, intimate, close-mic feel',
        'a wide chord stab one-shot, bright and glassy, digital sheen',
        'a wide chord stab one-shot, gritty distorted electronic',
        'a wide chord stab one-shot, analog warmth, tape saturation',
      ],
    },
  ])
})

test('phrase-tier prompts carry their isolation clause through every generator', () => {
  // the "one role per clip" rule has to survive the generators, not just genSubjectVaried — a
  // showdown gen clip that quietly loses its isolation clause is un-ratable against the other arms
  const prompts = generateGenPrompts(11, 17).filter((p) => /^(melody|bassline|chords|drumloop)\d/.test(p.id))
  assert.ok(prompts.length >= 4, 'a full stratified pass covers every phrase subject')
  for (const p of prompts) {
    const id = p.id.replace(/\d+$/, '')
    assert.ok(p.prompt.includes(PHRASE_ISOLATION[id]!), `${p.id} keeps its isolation clause`)
  }
})

// I2b — the cross-source figure-label DISJOINTNESS guard (R3 finding 4).
//
// There are four figure sources (bank / theory / ca2 / midi) and ONE shared per-role exclude list:
// cli/beat.mjs keeps a single `usedFigures[role]` array that all four sources push into and read
// from, and that list is the only thing enforcing D24's "no two clips in a session share a figure"
// blindness rule. Correctness rests entirely on the four label namespaces being disjoint —
//
//   bank    bare archetype name         'rolling-8ths'
//   theory  'theory:' + name            'theory:offbeat-stabs'
//   ca2     'ca2:' + ask name           'ca2:sparse-motif'
//   midi    'midi:' + file basename     'midi:trance-lead-1'
//
// — which until now was asserted only in source comments. It is NOT a coincidence that can be
// dropped: the raw names genuinely overlap across banks (see the collision test below), so a
// refactor that normalises labels away from prefixed strings (e.g. to {kind, name}) silently lets
// two clips in one batch share a figure. That is a D24 un-blinding regression which throws nothing,
// shows nothing in the report, and is detectable only by the owner's ear mid-rating.
//
// Each source's exclude contract is already tested in isolation (showdown/theory/ca2/midifig tests);
// what this file tests is the contract that actually holds in production — all four sharing one list.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  composePitchedPhrase,
  composeDrumPhrase,
  BASSLINE_ARCHETYPES,
  CHORDS_ARCHETYPES,
  LEAD_ARCHETYPES,
  DRUM_ARCHETYPES,
  type PhraseKey,
} from '../src/taste/showdown.js'
import {
  composeTheoryPhrase,
  THEORY_BASS_ARCHETYPES,
  THEORY_CHORD_ARCHETYPES,
  THEORY_LEAD_ARCHETYPES,
} from '../src/compose/theory.js'
import { chooseCA2Ask, ca2FigureLabel, CA2_ROLE_ASKS } from '../src/compose/ca2.js'
import { pickMidiFile, midiFigureLabel } from '../src/taste/midifig.js'
import { mulberry32 } from '../src/taste/eval.js'

const KEY: PhraseKey = { root: 50, minor: true }
const BANKS: Record<string, readonly string[]> = {
  bassline: BASSLINE_ARCHETYPES,
  chords: CHORDS_ARCHETYPES,
  lead: LEAD_ARCHETYPES,
  'drum-loop': DRUM_ARCHETYPES,
}
const THEORY_BANKS: Record<string, readonly string[]> = {
  bassline: THEORY_BASS_ARCHETYPES,
  chords: THEORY_CHORD_ARCHETYPES,
  lead: THEORY_LEAD_ARCHETYPES,
}
const MIDI_FILES = ['/pool/a/rolling-8ths.mid', '/pool/b/four-floor.mid', '/pool/c/stabs.mid', '/pool/d/phrase.mid']
// ca2's per-role salts, mirrored here: composeCA2Phrase needs the sidecar, chooseCA2Ask does not,
// and the ask draw is the only part of ca2 that participates in the exclude chain.
const CA2_ROLE_SALTS = { bassline: 2311, chords: 2477, lead: 2683 } as const

test('label namespaces: the four prefixes are what keeps genuinely-colliding raw names apart', () => {
  // no bank archetype may contain ':' — the property the whole prefix scheme rests on
  for (const [role, bank] of Object.entries(BANKS)) {
    for (const name of bank) assert.ok(!name.includes(':'), `bank archetype ${role}/${name} must not contain ':'`)
  }
  for (const [role, bank] of Object.entries(THEORY_BANKS)) {
    for (const name of bank) assert.ok(!name.includes(':'), `theory archetype ${role}/${name} must not contain ':'`)
  }
  for (const [role, asks] of Object.entries(CA2_ROLE_ASKS)) {
    for (const a of asks) assert.ok(!a.name.includes(':'), `ca2 ask ${role}/${a.name} must not contain ':'`)
  }

  // and the raw names DO collide across sources, so the prefixes are load-bearing, not decorative:
  // 'offbeat-stabs' is in both the bank's chords bank and theory's; 'motif-repeat' is in both lead
  // banks; 'sparse-motif' is in theory's lead bank AND ca2's lead asks.
  const bankNames = new Set<string>(Object.values(BANKS).flatMap((b) => [...b]))
  const theoryNames = new Set<string>(Object.values(THEORY_BANKS).flatMap((b) => [...b]))
  const ca2Names = new Set<string>(Object.values(CA2_ROLE_ASKS).flatMap((asks) => asks.map((a) => a.name)))
  const overlaps = [...theoryNames].filter((n) => bankNames.has(n) || ca2Names.has(n))
  assert.ok(overlaps.length > 0, 'raw archetype names overlap across sources — that is WHY labels are prefixed')

  // the three prefixed namespaces are mutually exclusive by construction, and none can be mistaken
  // for a bare bank name
  const prefixed = [
    ...[...theoryNames].map((n) => `theory:${n}`),
    ...[...ca2Names].map((n) => ca2FigureLabel(n)),
    ...MIDI_FILES.map((f) => midiFigureLabel(f)),
  ]
  for (const label of prefixed) assert.equal(bankNames.has(label), false, `${label} must not read as a bank archetype`)
  assert.equal(new Set(prefixed).size, prefixed.length, 'no two prefixed labels collide')
})

test('one shared exclude list threaded through all four sources yields four distinct labels', () => {
  // exactly the production shape: cli/beat.mjs keeps ONE usedFigures[role] list that every source
  // pushes into and reads from. Run each pitched role through all four sources in the CLI's
  // precedence order (midi > ca2 > theory > bank) sharing that one list.
  for (const role of ['bassline', 'chords', 'lead'] as const) {
    for (const seed of [1, 7, 4242, 90210]) {
      const used: string[] = []

      const midi = pickMidiFile(MIDI_FILES, seed, used)
      assert.ok(midi, 'midi pool is non-empty')
      used.push(midiFigureLabel(midi))

      const ask = chooseCA2Ask(mulberry32(seed + CA2_ROLE_SALTS[role]), CA2_ROLE_ASKS[role], used)
      used.push(ca2FigureLabel(ask.name))

      used.push(composeTheoryPhrase(role, KEY, seed, { exclude: used }).archetype)
      used.push(composePitchedPhrase(role, KEY, seed, { exclude: used }).archetype)

      assert.equal(new Set(used).size, 4, `${role}/${seed}: four sources, four distinct figures (${used.join(', ')})`)
      // and each label is recognisable as its own source's — the projection the manifest relies on
      assert.match(used[0]!, /^midi:/)
      assert.match(used[1]!, /^ca2:/)
      assert.match(used[2]!, /^theory:/)
      assert.ok(!used[3]!.includes(':'), `bank label stays bare (${used[3]})`)
      assert.ok(BANKS[role]!.includes(used[3]!), 'bank label is a real member of the role bank')
    }
  }
})

test('the drum-loop role shares the same list without colliding with the pitched sources', () => {
  // drums only have a bank source today, but they draw from the SAME shared list shape, and
  // DRUM_ARCHETYPES must not collide with anything a pitched source could have already pushed.
  for (const seed of [3, 11, 777]) {
    const used: string[] = [
      midiFigureLabel(MIDI_FILES[1]!), // 'midi:four-floor' — same stem as a real drum archetype
      ca2FigureLabel('pulse'),
      'theory:house-pulse',
    ]
    const drums = composeDrumPhrase(seed, { exclude: used })
    assert.ok(!used.includes(drums.archetype), 'the drum figure is distinct from every prefixed label')
    assert.ok((DRUM_ARCHETYPES as readonly string[]).includes(drums.archetype))
    // 'midi:four-floor' must NOT read as the bank's 'four-floor' — the prefix is doing the work
    assert.notEqual(midiFigureLabel(MIDI_FILES[1]!), 'four-floor')
  }
})

test('every selector degrades to a VALID member when its own namespace is exhausted', () => {
  // exhaustion fallback is `shuffled[0]` in all four — a 7th batch may repeat a figure, never a
  // realization. What must never happen is a fallback returning something outside the bank.
  const seed = 31337
  for (const role of ['bassline', 'chords', 'lead'] as const) {
    const bankAll: string[] = [...BANKS[role]!]
    const bank = composePitchedPhrase(role, KEY, seed, { exclude: bankAll })
    assert.ok(bankAll.includes(bank.archetype), 'bank falls back inside its own bank')

    const theoryAll = THEORY_BANKS[role]!.map((n) => `theory:${n}`)
    const theory = composeTheoryPhrase(role, KEY, seed, { exclude: theoryAll })
    assert.ok(theoryAll.includes(theory.archetype), 'theory falls back inside its own bank')

    const ca2All = CA2_ROLE_ASKS[role].map((a) => ca2FigureLabel(a.name))
    const ca2 = chooseCA2Ask(mulberry32(seed + CA2_ROLE_SALTS[role]), CA2_ROLE_ASKS[role], ca2All)
    assert.ok(ca2All.includes(ca2FigureLabel(ca2.name)), 'ca2 falls back inside its own asks')
  }
  const drumAll: string[] = [...DRUM_ARCHETYPES]
  assert.ok(drumAll.includes(composeDrumPhrase(seed, { exclude: drumAll }).archetype))

  const midiAll = MIDI_FILES.map((f) => midiFigureLabel(f))
  const midi = pickMidiFile(MIDI_FILES, seed, midiAll)
  assert.ok(midi && MIDI_FILES.includes(midi), 'midi falls back inside its own pool')

  // and exhausting ONE namespace never starves another: a full bank exclude list leaves theory/ca2
  // free (this is the failure mode a normalised label scheme would introduce)
  const allBank = Object.values(BANKS).flatMap((b) => [...b])
  const stillFree = composeTheoryPhrase('chords', KEY, seed, { exclude: allBank })
  assert.match(stillFree.archetype, /^theory:/)
  assert.ok(!allBank.includes(stillFree.archetype))
})

test('the exclude chain walks EVERY bank to exhaustion, not just the bassline one', () => {
  // the pre-existing chain-walk test covers BASSLINE_ARCHETYPES only; the other three banks were
  // never exercised, so a per-bank selector bug would have been invisible.
  for (const role of ['bassline', 'chords', 'lead'] as const) {
    const used: string[] = []
    for (let i = 0; i < BANKS[role]!.length; i++) {
      const p = composePitchedPhrase(role, KEY, 500 + i, { exclude: used })
      assert.ok(!used.includes(p.archetype), `${role}: draw ${i + 1} avoided all ${used.length} used archetypes`)
      used.push(p.archetype)
    }
    assert.deepEqual([...used].sort(), [...BANKS[role]!].sort(), `${role}: the chain exhausts the whole bank`)
  }
  const usedDrums: string[] = []
  for (let i = 0; i < DRUM_ARCHETYPES.length; i++) {
    const p = composeDrumPhrase(500 + i, { exclude: usedDrums })
    assert.ok(!usedDrums.includes(p.archetype), `drum-loop: draw ${i + 1} avoided the used archetypes`)
    usedDrums.push(p.archetype)
  }
  assert.deepEqual([...usedDrums].sort(), ([...DRUM_ARCHETYPES] as string[]).sort())
})

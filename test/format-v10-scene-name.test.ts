// v0.10 grammar tests — scene/section naming (Phase 32 Stream LB, docs/research/90). The contract
// under test: an optional nested `name <token>` line inside a `scene` block, elided entirely when
// absent (a pre-existing .beat file with no name lines round-trips byte-identically), a slug-like
// token (same SLUG_RE convention as scene/track ids, no whitespace/quoting), named on the SCENE
// (not the section — see docs/research/93's "scene vs section" comparison and BeatScene's own doc
// comment in src/core/document.ts), and a real edit primitive (renameScene) that sets/clears it and
// diffs musically. See test/format-v04.test.ts for the base clips/scenes/song grammar this extends.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parse,
  serialize,
  diffDocuments,
  formatDiff,
  setScene,
  renameScene,
  saveClip,
  BeatParseError,
  BeatEditError,
} from '../src/core/index.js'

const CORE_SYNTH = `  synth
    osc sine
    volume 0
    cutoff 1000
    resonance 1
    attack 0.01
    decay 0.1
    sustain 0.5
    release 0.1
    pan 0`

const NAMED_SCENE_EXAMPLE = `format_version 0.10
bpm 124
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  clip quiet
    note a1 69 0 2 0.4
  clip busy
    note b1 69 0 2 0.9

scene intro
  name partA
  slot lead quiet

scene main
  slot lead busy

song
  section intro 2
  section main 4
`

test('a scene with a name round-trips byte-identically', () => {
  const doc = parse(NAMED_SCENE_EXAMPLE)
  assert.equal(serialize(doc), NAMED_SCENE_EXAMPLE)
})

test('the name line parses into BeatScene.name; a scene with no name line has name undefined', () => {
  const doc = parse(NAMED_SCENE_EXAMPLE)
  assert.equal(doc.scenes[0]!.id, 'intro')
  assert.equal(doc.scenes[0]!.name, 'partA')
  assert.equal(doc.scenes[1]!.id, 'main')
  assert.equal(doc.scenes[1]!.name, undefined)
})

test('a document with no name lines at all is unchanged v0.4 behavior', () => {
  const plain = NAMED_SCENE_EXAMPLE.replace('  name partA\n', '')
  const doc = parse(plain)
  assert.equal(doc.scenes[0]!.name, undefined)
  assert.equal(serialize(doc), plain, 'no name lines in, none out — byte-identical')
})

test('scene names are slug-like tokens (SLUG_RE) — whitespace/punctuation rejected', () => {
  assert.throws(() => parse(NAMED_SCENE_EXAMPLE.replace('name partA', 'name part a')), BeatParseError)
  assert.throws(() => parse(NAMED_SCENE_EXAMPLE.replace('name partA', 'name "part a"')), BeatParseError)
  // a valid slug with digits/underscore/hyphen is fine
  const doc = parse(NAMED_SCENE_EXAMPLE.replace('name partA', 'name part-A_2'))
  assert.equal(doc.scenes[0]!.name, 'part-A_2')
})

test('a duplicate name line within one scene block is rejected', () => {
  const dup = NAMED_SCENE_EXAMPLE.replace('  name partA\n', '  name partA\n  name partB\n')
  assert.throws(() => parse(dup), /already has a name/)
})

test('name must appear inside a scene block, not floating at top level', () => {
  assert.throws(() => parse(NAMED_SCENE_EXAMPLE.replace('song\n', 'name loose\nsong\n')), BeatParseError)
})

test('renameScene sets a name, round-trips, and diffs as a musical fact', () => {
  const a = parse(NAMED_SCENE_EXAMPLE)
  const b = renameScene(a, 'main', 'partB')
  assert.equal(b.scenes[1]!.name, 'partB')
  // round trip
  assert.equal(serialize(parse(serialize(b))), serialize(b))
  const text = formatDiff(diffDocuments(a, b))
  assert.match(text, /scene main: name \(none\) -> partB/)
})

test('renameScene(null) clears an existing name back to id-only display', () => {
  const a = parse(NAMED_SCENE_EXAMPLE)
  const b = renameScene(a, 'intro', null)
  assert.equal(b.scenes[0]!.name, undefined)
  const reserialized = serialize(b)
  assert.ok(!reserialized.includes('name partA'), 'the name line should be gone entirely, not just emptied')
  assert.equal(serialize(parse(reserialized)), reserialized, 'clears cleanly and round-trips')
  const text = formatDiff(diffDocuments(a, b))
  assert.match(text, /scene intro: name partA -> \(none\)/)
})

test('renameScene validates the name token and refuses an unknown scene id', () => {
  const doc = parse(NAMED_SCENE_EXAMPLE)
  assert.throws(() => renameScene(doc, 'intro', 'has space'), BeatEditError)
  assert.throws(() => renameScene(doc, 'no-such-scene', 'x'), BeatEditError)
})

test('setScene (the slot-map setter) preserves an existing name across a re-set', () => {
  const doc = parse(NAMED_SCENE_EXAMPLE)
  const resetSlots = setScene(doc, 'intro', { lead: 'busy' })
  assert.equal(resetSlots.scenes[0]!.name, 'partA', 'the slot re-map is unrelated to the scene name and should not wipe it')
  assert.deepEqual(resetSlots.scenes[0]!.slots.lead, [{ clip: 'busy', at: 0 }])
  assert.equal(serialize(parse(serialize(resetSlots))), serialize(resetSlots))
  // and a brand-new scene minted via setScene naturally starts with no name
  const withNew = setScene(doc, 'outro', { lead: 'quiet' })
  assert.equal(withNew.scenes[2]!.name, undefined)
})

test('the same scene reused across two sections shows one name for both — a name is scene-level, not section-level', () => {
  // "intro" is reused nowhere in the fixture above; snapshot a second section onto it to prove the
  // name travels with the scene id wherever it's placed, not tied to a specific section index.
  const doc = parse(NAMED_SCENE_EXAMPLE)
  const reused = { ...doc, song: [...doc.song!, { scene: 'intro', bars: 2 }] }
  assert.equal(reused.song![0]!.scene, reused.song![2]!.scene, 'both sections reference the same scene id')
  const sceneForBoth = reused.scenes.find((s) => s.id === reused.song![2]!.scene)
  assert.equal(sceneForBoth!.name, 'partA', 'the reused section resolves to the same name, not a blank/independent one')
})

test('a named clip snapshot (saveClip) does not disturb the scene name', () => {
  const doc = parse(NAMED_SCENE_EXAMPLE)
  const { doc: next } = saveClip(doc, 'lead', 'quiet')
  const scene = next.scenes.find((s) => s.id === 'intro')!
  assert.equal(scene.name, 'partA')
})

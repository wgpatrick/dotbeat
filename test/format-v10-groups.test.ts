// v0.10 grammar tests — track groups (Phase 22 Stream AF, "Track & project polish bundle"). The
// contract under test: a group is a flat, named, colored fold of N existing tracks (no
// nesting/group-of-groups), a track belongs to at most one group, the grammar round-trips
// byte-identically, group blocks sit between tracks and scenes in canonical order, a v0.9 file
// (no group grammar at all) parses unchanged, and the edit primitives fail loudly on bad input
// the same way addTrack/addHit do. Collapsed/expanded is deliberately NOT modeled here — it's
// UI-only session state (see ui/src/state/store.ts's mutes/solos precedent), not a musical fact.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parse,
  serialize,
  diffDocuments,
  formatDiff,
  addTrack,
  removeTrack,
  addGroup,
  removeGroup,
  renameGroup,
  setGroupColor,
  setGroupTracks,
  initDocument,
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

const GROUP_EXAMPLE = `format_version 0.10
bpm 120
loop_bars 2
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}

track bass Bass #56b6c2 synth
${CORE_SYNTH}

group group1 Keys #e06c75 lead bass
`

// ---- grammar / round-trip ------------------------------------------------------------------------

test('the group example round-trips byte-identically', () => {
  const doc = parse(GROUP_EXAMPLE)
  assert.equal(serialize(doc), GROUP_EXAMPLE)
})

test('a group parses into the expected shape', () => {
  const doc = parse(GROUP_EXAMPLE)
  assert.equal(doc.groups.length, 1)
  assert.deepEqual(doc.groups[0], { id: 'group1', name: 'Keys', color: '#e06c75', tracks: ['lead', 'bass'] })
})

test('a v0.9 file with no group grammar at all parses unchanged (groups: [])', () => {
  const text = `format_version 0.9
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
`
  const doc = parse(text)
  assert.deepEqual(doc.groups, [])
  assert.equal(serialize(doc), text)
})

test('group blocks must reference real, already-declared tracks', () => {
  const text = `format_version 0.10
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}

group group1 Keys #e06c75 lead ghost
`
  assert.throws(() => parse(text), /unknown track "ghost"/)
})

test('a track cannot appear in two groups', () => {
  const text = `format_version 0.10
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}

track bass Bass #56b6c2 synth
${CORE_SYNTH}

group group1 A #e06c75 lead
group group2 B #56b6c2 lead bass
`
  assert.throws(() => parse(text), /in more than one group/)
})

test('duplicate group ids are rejected', () => {
  const text = `format_version 0.10
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}

track bass Bass #56b6c2 synth
${CORE_SYNTH}

group g1 A #e06c75 lead
group g1 B #56b6c2 bass
`
  assert.throws(() => parse(text), /duplicate group id/)
})

test('canonical order: group blocks must come before scene/song blocks', () => {
  const text = `format_version 0.10
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}

scene verse

group g1 A #e06c75 lead
`
  assert.throws(() => parse(text), /group blocks must come before scene\/song blocks/)
})

test('canonical order: track blocks must come before group blocks', () => {
  const text = `format_version 0.10
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}

group g1 A #e06c75 lead

track bass Bass #56b6c2 synth
${CORE_SYNTH}
`
  assert.throws(() => parse(text), /track blocks must come before group\/scene\/song blocks/)
})

// ---- edit primitives ------------------------------------------------------------------------------

function twoTrackDoc() {
  const { doc } = addTrack(initDocument({ trackId: 'lead' }), { id: 'bass', kind: 'synth' })
  return doc
}

test('addGroup mints group<n> ids and cycles TRACK_COLORS when id/color are omitted', () => {
  const doc = twoTrackDoc()
  const { doc: grouped, group } = addGroup(doc, { trackIds: ['lead', 'bass'] })
  assert.equal(group.id, 'group1')
  assert.equal(group.name, 'group1') // defaults to id, same convention as addTrack
  assert.equal(grouped.groups.length, 1)
  assert.deepEqual(grouped.groups[0]!.tracks, ['lead', 'bass'])
})

test('addGroup refuses an unknown track, a track listed twice, and re-grouping an already-grouped track', () => {
  const doc = twoTrackDoc()
  assert.throws(() => addGroup(doc, { trackIds: ['lead', 'ghost'] }), BeatEditError)
  assert.throws(() => addGroup(doc, { trackIds: ['lead', 'lead'] }), BeatEditError)
  const { doc: grouped } = addGroup(doc, { trackIds: ['lead'], name: 'A' })
  assert.throws(() => addGroup(grouped, { trackIds: ['lead', 'bass'], name: 'B' }), /already in group/)
})

test('removeGroup ungroups without touching the member tracks', () => {
  const doc = twoTrackDoc()
  const { doc: grouped, group } = addGroup(doc, { trackIds: ['lead', 'bass'], name: 'Keys' })
  const { doc: ungrouped } = removeGroup(grouped, group.id)
  assert.equal(ungrouped.groups.length, 0)
  assert.deepEqual(ungrouped.tracks.map((t) => t.id), ['lead', 'bass'])
})

test('renameGroup and setGroupColor mutate just that field', () => {
  const doc = twoTrackDoc()
  const { doc: grouped, group } = addGroup(doc, { trackIds: ['lead', 'bass'] })
  const renamed = renameGroup(grouped, group.id, 'Keys')
  assert.equal(renamed.groups[0]!.name, 'Keys')
  assert.equal(renamed.groups[0]!.color, group.color)
  const recolored = setGroupColor(renamed, group.id, '#123456')
  assert.equal(recolored.groups[0]!.color, '#123456')
  assert.equal(recolored.groups[0]!.name, 'Keys')
})

test('setGroupTracks replaces the whole membership list, respecting the one-group-per-track rule', () => {
  const doc = twoTrackDoc()
  const { doc: withThird } = addTrack(doc, { id: 'pad', kind: 'synth' })
  const { doc: grouped, group } = addGroup(withThird, { trackIds: ['lead'] })
  const next = setGroupTracks(grouped, group.id, ['lead', 'bass', 'pad'])
  assert.deepEqual(next.groups[0]!.tracks, ['lead', 'bass', 'pad'])
  assert.throws(() => setGroupTracks(next, group.id, []), BeatEditError) // needs >= 1 track
})

test('removeTrack drops the track from its group; a group left with zero members is dropped entirely', () => {
  const doc = twoTrackDoc()
  const { doc: grouped, group } = addGroup(doc, { trackIds: ['lead', 'bass'] })
  const { doc: afterRemoveOne } = removeTrack(grouped, 'bass')
  assert.deepEqual(afterRemoveOne.groups[0]!.tracks, ['lead'])
  // removeTrack refuses to drop the last track in the doc, so grow first to empty the group cleanly.
  const { doc: withThird } = addTrack(afterRemoveOne, { id: 'pad', kind: 'synth' })
  const { doc: afterRemoveLast } = removeTrack(withThird, 'lead')
  assert.equal(afterRemoveLast.groups.find((g) => g.id === group.id), undefined, 'the emptied group is gone')
})

test('group identity validation: bad id, whitespace name, and bad color all fail loudly', () => {
  const doc = twoTrackDoc()
  assert.throws(() => addGroup(doc, { id: 'bad id', trackIds: ['lead'] }), BeatEditError)
  assert.throws(() => addGroup(doc, { trackIds: ['lead'] , name: 'has space'}), BeatEditError)
  assert.throws(() => addGroup(doc, { trackIds: ['lead'], color: 'red' }), BeatEditError)
})

// ---- diff -------------------------------------------------------------------------------------------

test('diffDocuments reports group add/remove/rename/recolor/membership as musical facts', () => {
  const doc = twoTrackDoc()
  const { doc: grouped, group } = addGroup(doc, { trackIds: ['lead', 'bass'], name: 'Keys' })

  const addDiff = formatDiff(diffDocuments(doc, grouped))
  assert.match(addDiff, /group added "group1" \("Keys": lead, bass\)/)

  const renamed = renameGroup(grouped, group.id, 'Synths')
  assert.match(formatDiff(diffDocuments(grouped, renamed)), /group group1: name "Keys" -> "Synths"/)

  const { doc: withThird } = addTrack(renamed, { id: 'pad', kind: 'synth' })
  const regrouped = setGroupTracks(withThird, group.id, ['lead', 'bass', 'pad'])
  assert.match(formatDiff(diffDocuments(withThird, regrouped)), /group group1: tracks lead,bass -> lead,bass,pad/)

  const { doc: removed } = removeGroup(regrouped, group.id)
  assert.match(formatDiff(diffDocuments(regrouped, removed)), /group removed "group1"/)
})

// ---- parse error surface (BeatParseError sanity) -----------------------------------------------------

test('a malformed group line (too few tokens) is a parse error', () => {
  const text = `format_version 0.10
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}

group g1 A #e06c75
`
  assert.throws(() => parse(text), BeatParseError)
})

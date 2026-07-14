// Phase 35 Stream OB — drum-surface legibility (docs/phase-35-plan.md §OB; pilot 101 mediums 1-2
// + low, pilot 94 cosmetic). Under test:
//   - `beat inspect` per-lane truth: name + the backing that actually plays (synth voice / sample
//     id gain tune / sf) with non-default lane params, for declared-lane AND legacy tracks
//   - drums tracks show a `bus:` line (volume/cutoff/res/pan — what the drum bus really reads),
//     never the old misleading full `synth:` header line
//   - the pattern grid renders the REAL loop length (bars space-separated, chunked rows past 4
//     bars), never silently truncated/collapsed to the first 16 steps
//   - stale v0.5 laneSamples on a declared-lane track: serializer round-trips them untouched (D4),
//     inspect flags them, clearLegacyLaneSamples is the explicit one-shot cleanup (and refuses on
//     legacy tracks, where the same lines are live)
//   - text view stays consistent with the structured (--json) document

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parse,
  serialize,
  describeDocument,
  initDocument,
  addTrack,
  addHit,
  setValue,
  setMediaSample,
  setLaneSample,
  setLaneParam,
  clearLegacyLaneSamples,
  defaultDrumKitLanes,
  BeatEditError,
} from '../src/core/index.js'
import { serializeLaneBacking } from '../src/core/serialize.js'
import type { BeatTrack } from '../src/core/document.js'

const SHA = 'd'.repeat(64)

function declaredKitDoc(loopBars = 2) {
  // The 12-lane declared kit is the CLI/MCP add-track default; core addTrack takes it explicitly.
  let doc = addTrack(initDocument({ trackId: 'lead', loopBars }), { id: 'dr', kind: 'drums', lanes: defaultDrumKitLanes() }).doc
  doc = setMediaSample(doc, 'smp_kick', SHA, 'media/kick.wav')
  return doc
}

const trackOf = (doc: ReturnType<typeof declaredKitDoc>, id: string): BeatTrack => doc.tracks.find((t) => t.id === id)!

// A synth block at the parser's full spelling — legacy fixtures below need one verbatim.
const SYNTH_BLOCK = `  synth
    osc sawtooth
    volume -10
    cutoff 12000
    resonance 0.1
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0`

// ---- per-lane truth (declared-lane tracks) ------------------------------------------------------

test('inspect shows per-lane backing truth for a declared-lane drums track, and no synth: header', () => {
  let doc = declaredKitDoc()
  doc = setLaneSample(doc, 'dr', 'kick', { sample: 'smp_kick', gainDb: -3, tune: 2 })
  doc = setLaneParam(doc, 'dr', 'kick', 'start', 0.01).doc // non-default sample-lane param
  doc = setLaneParam(doc, 'dr', 'hat', 'decay', 0.2).doc // non-default synth-lane param
  const text = describeDocument(doc)

  const drBlock = text.split('\n\n').find((b) => b.startsWith('dr '))!
  assert.ok(drBlock, 'drums track block present')
  // The bus line replaces the misleading synth: header (pilot 94 cosmetic / plan OB item 3).
  assert.ok(!/^ {2}synth: /m.test(drBlock), 'no full synth: line on a drums track')
  assert.match(drBlock, /^ {2}bus: -10 dB, cutoff \d+ Hz, res [\d.]+, pan 0$/m)
  // Per-lane truth: sample-backed with id/gain/tune + non-default param, synth-backed with voice
  // + non-default param, defaults elided (plan OB item 1).
  assert.match(drBlock, /^ {4}kick {4}sample smp_kick -3 2 start=0\.01$/m)
  assert.match(drBlock, /^ {4}hat {5}synth:metal decay=0\.2$/m)
  assert.match(drBlock, /^ {4}snare {3}synth:noise$/m)
  assert.match(drBlock, /^ {2}lanes:$/m)
})

test('inspect lane lines are exactly the canonical decl backing strings — text and --json (parsed doc) cannot drift', () => {
  let doc = declaredKitDoc()
  doc = setLaneSample(doc, 'dr', 'snare', { sample: 'smp_kick', gainDb: -1.5, tune: -4 })
  const text = describeDocument(doc)
  // The --json view IS the parsed document (the CLI prints it verbatim); each structured lane decl
  // must appear in the text view as the same canonical backing string the file itself carries.
  for (const decl of trackOf(doc, 'dr').lanes) {
    const line = `    ${decl.name.padEnd(7)} ${serializeLaneBacking(decl.backing)}`
    assert.ok(text.includes(`\n${line}\n`), `text view carries lane truth line: ${JSON.stringify(line)}`)
    assert.ok(serialize(doc).includes(`  lane ${decl.name} ${serializeLaneBacking(decl.backing)}\n`), 'same string as the file grammar')
  }
})

test('inspect shows sf-backed lane truth', () => {
  const text = `format_version 0.10
bpm 120
loop_bars 1
selected_track dr

media
  sample sf_kit sha256:${SHA} media/kit.sf2

track dr Drums #e06c75 drums
${SYNTH_BLOCK}
  lane kick sf sf_kit 0 36
  hit h1 kick 0 0.9
`
  const out = describeDocument(parse(text))
  assert.match(out, /^ {4}kick {4}sf sf_kit 0 36$/m)
})

// ---- per-lane truth (legacy implicit-5-lane tracks) ---------------------------------------------

const LEGACY_TEXT = `format_version 0.10
bpm 120
loop_bars 1
selected_track dr

media
  sample snare-x sha256:${SHA} media/snare.wav

track dr Drums #e06c75 drums
${SYNTH_BLOCK}
  lane snare snare-x -2 -3
  hit h1 kick 0 0.9
  hit h2 snare 4 0.8
`

test('inspect shows legacy-track lane truth: implicit kit, live laneSamples, non-default voice fields', () => {
  let doc = parse(LEGACY_TEXT)
  doc = setValue(doc, 'dr.kickTune', '40')
  const text = describeDocument(doc)
  assert.match(text, /^ {2}lanes: \(implicit legacy 5-lane kit\)$/m)
  // The laneSample IS what plays on a legacy track — shown as the backing, no stale flag.
  assert.match(text, /^ {4}snare {3}sample snare-x -2 -3$/m)
  assert.ok(!text.includes('legacy lane lines (ignored by playback)'), 'live legacy laneSamples are never flagged stale')
  // Synth-backed legacy lanes show their voice + the track-wide fields that shape them, defaults
  // elided, spelled exactly as `beat set dr.<field>` takes them.
  assert.match(text, /^ {4}kick {4}synth:membrane kickTune=40$/m)
  assert.match(text, /^ {4}clap {4}synth:noise$/m)
  assert.match(text, /^ {4}openhat synth:metal$/m)
})

// ---- pattern grid: real loop length, chunked ----------------------------------------------------

test('the drum grid renders the whole loop, not a mod-16 collapse of it', () => {
  let doc = declaredKitDoc(2) // 32 steps
  doc = addHit(doc, 'dr', { lane: 'kick', start: 0, velocity: 0.9 }).doc
  doc = addHit(doc, 'dr', { lane: 'kick', start: 20, velocity: 0.9 }).doc
  const text = describeDocument(doc)
  // Two 16-step bars, space-separated: step 20 lands in bar 2 cell 4 — and does NOT ghost into
  // bar 1 cell 4 (the old mod-16 collapse pilot 101 medium 1 caught).
  assert.match(text, /^ {2}kick {4}X\.{15} \.{4}X\.{11} {2}\(2 hits\)$/m)
})

test('grids past 4 bars chunk into aligned continuation rows, hit count on the last row', () => {
  let doc = declaredKitDoc(8) // 128 steps = 8 bars -> 2 rows of 4 bars
  doc = addHit(doc, 'dr', { lane: 'kick', start: 0, velocity: 0.9 }).doc
  doc = addHit(doc, 'dr', { lane: 'kick', start: 64, velocity: 0.5 }).doc
  const text = describeDocument(doc)
  const lines = text.split('\n')
  const first = lines.findIndex((l) => /^ {2}kick {4}X/.test(l))
  assert.notEqual(first, -1, 'first kick grid row present')
  assert.match(lines[first]!, /^ {2}kick {4}X\.{15} \.{16} \.{16} \.{16}$/, 'row 1: 4 bars, no count yet')
  assert.match(lines[first + 1]!, /^ {10}x\.{15} \.{16} \.{16} \.{16} {2}\(2 hits\)$/, 'row 2: aligned continuation + count')
})

test('every declared lane still gets a grid row and off-grid/duration counts survive', () => {
  let doc = declaredKitDoc(1)
  doc = addHit(doc, 'dr', { lane: 'cowbell', start: 3.5, velocity: 0.9 }).doc
  doc = addHit(doc, 'dr', { lane: 'cowbell', start: 8, velocity: 0.9, duration: 2 }).doc
  const text = describeDocument(doc)
  assert.match(text, /^ {2}cowbell [.xX]{16} {2}\(2 hits, 1 off-grid, 1 with duration\)$/m)
})

// ---- stale legacy laneSamples on declared-lane tracks -------------------------------------------

const STALE_TEXT = `format_version 0.10
bpm 120
loop_bars 1
selected_track dr

media
  sample kick-909 sha256:${SHA} media/kick.wav

track dr Drums #e06c75 drums
${SYNTH_BLOCK}
  lane kick synth:membrane
  lane snare synth:noise
  lane kick kick-909 -2 -3
  hit h1 kick 0 0.9
`

test('D4: the serializer round-trips stale legacy lane lines byte-identically — nothing is dropped silently', () => {
  assert.equal(serialize(parse(STALE_TEXT)), STALE_TEXT)
})

test('inspect flags stale legacy lane lines on a declared-lane track and points at the explicit cleanup', () => {
  const doc = parse(STALE_TEXT)
  const text = describeDocument(doc)
  assert.match(text, /^ {2}legacy lane lines \(ignored by playback\): kick — stale v0\.5 sample assignments; the declared lanes above are what plays\. Remove with `beat lane <file> dr --clear-legacy`\.$/m)
  // Consistency with the structured (--json) view: the flagged set IS the laneSamples keys.
  assert.deepEqual(Object.keys(trackOf(doc, 'dr').laneSamples), ['kick'])
  // And the lane truth line still shows the DECLARED backing (what plays), not the stale sample.
  assert.match(text, /^ {4}kick {4}synth:membrane$/m)
})

test('clearLegacyLaneSamples removes exactly the stale lines, keeps declarations, and unflags inspect', () => {
  const before = parse(STALE_TEXT)
  const { doc, cleared } = clearLegacyLaneSamples(before, 'dr')
  assert.deepEqual(cleared, ['kick'])
  assert.deepEqual(trackOf(doc, 'dr').laneSamples, {})
  const out = serialize(doc)
  assert.ok(!out.includes('lane kick kick-909'), 'stale line gone from the file')
  assert.match(out, /^ {2}lane kick synth:membrane$/m)
  assert.ok(!describeDocument(doc).includes('legacy lane lines'), 'inspect flag gone after cleanup')
  // The original doc is untouched (pure edit, same as every other core edit).
  assert.deepEqual(Object.keys(trackOf(before, 'dr').laneSamples), ['kick'])
})

test('clearLegacyLaneSamples refuses where it would be destructive or meaningless', () => {
  // Legacy track: those lines are LIVE v0.5 assignments — clearing would change the sound.
  assert.throws(() => clearLegacyLaneSamples(parse(LEGACY_TEXT), 'dr'), (e: unknown) => e instanceof BeatEditError && /declares no lanes/.test((e as Error).message) && /none/.test((e as Error).message))
  // Declared-lane track with nothing stale.
  assert.throws(() => clearLegacyLaneSamples(declaredKitDoc(), 'dr'), /no legacy lane-sample lines to clear/)
  // Not a drums track.
  assert.throws(() => clearLegacyLaneSamples(declaredKitDoc(), 'lead'), /only belong on drum tracks/)
})

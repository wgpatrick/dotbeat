// The whole-loop invariant for src/core/{edit,serialize,parse}.ts, stated once and enforced by
// generation rather than by enumeration:
//
//   **Whatever a public writer accepts, serialize() must be able to write and parse() must be able
//   to read back — identically, on the first save.**
//
// The hand-written cases in core-edit.test.ts and core-parse.test.ts pin the specific holes
// adversarial hunt #2 found. This file exists because that hunt found them by trying values nobody
// had thought to try: 0.00001 (inside every "> 0" guard, exactly 0 after the format's 4-decimal
// rounding), "" (passes a whitespace check, deletes a token), 60.5 (a finite number, not an
// integer). The property test below keeps trying values in that shape forever, against a menu of
// real writer operations, so the NEXT writer added to edit.ts is covered before anyone thinks to
// write a case for it.
//
// Contract for a generated operation: it may THROW (rejecting a bad edit loudly is the correct
// outcome — that's the fix, not a failure), or it may succeed. What it may not do is succeed and
// leave a document that doesn't survive serialize -> parse. "Fails loudly" and "writes a loadable
// file" are the only two acceptable outcomes; "writes an unloadable file" is the bug family.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BeatEditError,
  addGroup,
  addHit,
  addNote,
  addTrack,
  initDocument,
  parse,
  renameGroup,
  saveClip,
  serialize,
  setClipLoop,
  setValue,
  type BeatDocument,
} from '../src/core/index.js'
// The ONE seeded generator (src/core/rng.ts) — not a local copy, per the project's rng discipline.
import { mulberry32 } from '../src/core/rng.js'

/** Values chosen the way the hunt chose them: on and just past every boundary, plus the band
 * BELOW the format's 4-decimal resolution where a number is nonzero to the writer and zero to the
 * file. Plain musical values are in the pool too, so the run does real work and not only rejection. */
const PROBE_NUMBERS = [
  0, 1, -1, 0.5, 0.25, 2, 4, 16, 64, 127, 120, 0.8,
  0.0001, -0.0001, 0.00001, -0.00001, 0.000000001, 0.99999, 1.00001, 0.99995, 0.00005,
  1e-12, 1e12, 60.5, 2.5, -0.5, 0.12345678, 1000, -1000,
]

/** Names/values on the string side of the same idea: "" is the one that deletes a token. */
const PROBE_STRINGS = ['', ' ', 'ok', 'two words', 'Lead_2', '0.00001', '60.5', '0', '-1', 'x'.repeat(200), '#ff0000', 'nope']

const LANES = ['kick', 'snare', 'clap', 'hat', 'openhat']

/** Serialize deliberately re-sorts four lists into canonical file order (notes by start/pitch/id,
 * hits by start/lane/id, automation points by time/id, surge overrides by param), so an in-memory
 * document built by appending will legitimately come back in a different ARRAY order than it went
 * out — that is canonical ordering doing its job, not data loss. Both sides go through the same
 * arbitrary-but-consistent sort here so the deep-equal below compares VALUES, which is where the
 * bug family lives. Everything else (track order, clip order, effect-chain order, song sections)
 * is left exactly as it is: there the order IS the data, and a reordering would be a real failure. */
function sortListsForComparison(doc: BeatDocument): BeatDocument {
  const byJson = (a: unknown, b: unknown) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)
  return {
    ...doc,
    tracks: doc.tracks.map((t) => ({
      ...t,
      notes: [...t.notes].sort(byJson),
      hits: [...t.hits].sort(byJson),
      clips: t.clips.map((c) => ({
        ...c,
        notes: [...c.notes].sort(byJson),
        hits: [...c.hits].sort(byJson),
        automation: c.automation.map((l) => ({ ...l, points: [...l.points].sort(byJson) })),
      })),
      ...(t.surge ? { surge: { ...t.surge, overrides: [...t.surge.overrides].sort(byJson) } } : {}),
    })),
  }
}

function makeDoc(): BeatDocument {
  let doc = initDocument({ trackId: 't1' })
  doc = addTrack(doc, { id: 'd1', kind: 'drums' }).doc
  doc = addTrack(doc, { id: 't2', kind: 'synth' }).doc
  return doc
}

/** One generated writer operation. Each closure is a real public entry point — the same functions
 * the CLI, MCP, and the daemon's /edit route call. */
function applyRandomOp(doc: BeatDocument, rng: () => number): BeatDocument {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!
  const num = () => pick(PROBE_NUMBERS)
  const str = () => pick(PROBE_STRINGS)
  const synthTrack = () => pick(['t1', 't2'])

  const ops: (() => BeatDocument)[] = [
    () => setValue(doc, 'bpm', String(num())),
    () => setValue(doc, 'loop_bars', String(num())),
    () => setValue(doc, 'selected_track', pick(['t1', 't2', 'd1', 'nosuch'])),
    () => setValue(doc, `${synthTrack()}.name`, str()),
    () => setValue(doc, `${synthTrack()}.color`, pick(['#aabbcc', '#AABBCC', 'red', ''])),
    () => setValue(doc, `${synthTrack()}.cutoff`, String(num())),
    () => setValue(doc, `${synthTrack()}.volume`, String(num())),
    () => setValue(doc, `${synthTrack()}.shuffleAmount`, String(num())),
    () => setValue(doc, `${synthTrack()}.shuffleGrid`, String(num())),
    () => setValue(doc, `d1.pattern.${pick(LANES)}[${Math.floor(rng() * 34)}]`, String(num())),
    () => setValue(doc, `d1.hit`, `${pick(LANES)} ${num()} ${num()}`),
    () => addNote(doc, synthTrack(), { pitch: Math.floor(rng() * 130), start: num(), duration: num(), velocity: num() }).doc,
    () =>
      addNote(doc, synthTrack(), {
        pitch: 60,
        start: 0,
        duration: 1,
        velocity: 0.5,
        cent: num(),
        ratchetCurve: num(),
        ratchetLength: num(),
      }).doc,
    () => addHit(doc, 'd1', { lane: pick(LANES), start: num(), velocity: num() }).doc,
    () => addHit(doc, 'd1', { lane: pick(LANES), start: num(), velocity: 0.8, duration: num() }).doc,
    () => addTrack(doc, { id: `g${Math.floor(rng() * 1000)}`, kind: 'synth', name: str() }).doc,
    () => addGroup(doc, { id: `grp${Math.floor(rng() * 100)}`, name: str(), trackIds: [pick(['t1', 't2', 'd1'])] }).doc,
    () => renameGroup(doc, doc.groups[0]?.id ?? 'grp0', str()),
    () => saveClip(doc, synthTrack(), pick(['c1', 'c2', 'bad id', ''])).doc,
    () => setClipLoop(doc, 't1', doc.tracks[0]!.clips[0]?.id ?? 'c1', { start: num(), end: num() }),
  ]
  return pick(ops)()
}

test('property: no sequence of writer operations can produce an unloadable document', () => {
  let applied = 0
  let rejected = 0
  for (let seed = 1; seed <= 400; seed++) {
    const rng = mulberry32(seed)
    let doc = makeDoc()
    for (let step = 0; step < 25; step++) {
      let next: BeatDocument
      try {
        next = applyRandomOp(doc, rng)
      } catch (err) {
        // Rejecting a bad edit is the CORRECT outcome. It just has to be the documented error
        // type, not a TypeError from dereferencing something that wasn't checked.
        assert.ok(
          err instanceof BeatEditError,
          `seed ${seed} step ${step}: a writer threw ${(err as Error).name} instead of BeatEditError — ${(err as Error).message}`,
        )
        rejected++
        continue
      }
      applied++
      let text: string
      try {
        text = serialize(next)
      } catch (err) {
        assert.fail(`seed ${seed} step ${step}: serialize threw on an accepted edit — ${(err as Error).message}`)
      }
      let reparsed: BeatDocument
      try {
        reparsed = parse(text)
      } catch (err) {
        assert.fail(`seed ${seed} step ${step}: an accepted edit wrote an UNPARSEABLE file — ${(err as Error).message}\n${text}`)
      }
      assert.deepEqual(
        sortListsForComparison(reparsed),
        sortListsForComparison(next),
        `seed ${seed} step ${step}: a value the writer stored is not the value that came back\n${text}`,
      )
      assert.equal(serialize(reparsed), text, `seed ${seed} step ${step}: serialize is not a fixed point`)
      doc = next
    }
  }
  // Guards against the test quietly becoming vacuous: if a future change made every generated op
  // throw (or made none of them throw), the property above would still "pass" while testing
  // nothing. Both sides of the menu have to stay live.
  assert.ok(applied > 2000, `expected the generator to land thousands of successful edits, got ${applied}`)
  assert.ok(rejected > 200, `expected the generator to exercise rejection too, got ${rejected}`)
})

test('the generator is deterministic (a failure above is reproducible from its seed)', () => {
  const run = () => {
    const rng = mulberry32(42)
    let doc = makeDoc()
    for (let i = 0; i < 25; i++) {
      try {
        doc = applyRandomOp(doc, rng)
      } catch {
        /* rejected — see the property test */
      }
    }
    return serialize(doc)
  }
  assert.equal(run(), run())
})

test('serialize output is always canonical bytes: re-serializing changes nothing', () => {
  // The narrow serialize-side statement of the same invariant, on a document built entirely from
  // ordinary writer calls (the shape a real session produces).
  let doc = makeDoc()
  doc = setValue(doc, 'bpm', '128')
  doc = setValue(doc, 'loop_bars', '4')
  doc = addNote(doc, 't1', { pitch: 60, start: 0.0625, duration: 0.9999, velocity: 0.0001, cent: 12.3456 }).doc
  doc = addHit(doc, 'd1', { lane: 'kick', start: 0, velocity: 0.0001, duration: 0.0001 }).doc
  doc = setValue(doc, 't1.shuffleAmount', '0.6667')
  doc = saveClip(doc, 't1', 'c1').doc
  doc = setClipLoop(doc, 't1', 'c1', { start: 0, end: 0.0001 })
  doc = addGroup(doc, { id: 'g1', name: 'bus', trackIds: ['t1', 't2'] }).doc

  const once = serialize(doc)
  assert.deepEqual(parse(once), doc)
  assert.equal(serialize(parse(once)), once)
})

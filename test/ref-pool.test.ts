// D12 (research/140, from 120 §4) — the ref POOL now rides the scores log the way `figureSource`
// already did.
//
// The bug it closes: `src/taste/showdown.ts`'s pool tally computed the split at REPORT time from
// each batch dir's own `manifest.json`, and skipped any entry whose manifest was gone. Deleting
// batch dirs after a round is the documented lifecycle, so every historical pool breakdown silently
// under-counted — the exact failure the D25 holdout fix closed for the sibling field
// `trainingExcluded` in the same writer, which the pool label did not get at the time.
//
// Two things are tested here, and the second is the one that matters in six months:
//   1. the writer freezes the split into the entry, present-but-empty on a ref-less batch, so
//      "looked, no refs" stays distinguishable from "written before this field existed";
//   2. the DAW-side `refPoolOf` and `src/taste/showdown.ts`'s own `classifyRefPool` twin agree.
//      They are two copies of one rule (showdown's was owned by a concurrent stream and could not
//      be deleted in this change), and CLAUDE.md's parity guardrail says a vow to keep two copies
//      in sync is worth nothing — so this is the gate instead. The follow-up is to delete
//      showdown's copy, import refPoolOf, and delete the agreement test with it.

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { refPoolOf, refPoolsOf, trainingExcludedFiles, scoreBatch, type RefPool, type VaryBatchManifest } from '../src/vary/batch.js'
import { classifyRefPool } from '../src/taste/showdown.js'

/** One path per pool, a bare refs dir with no pool at all, and a relative path.
 *
 * `refs-packs-old` is in the table deliberately and classifies as `ref:packs`, not `ref:other`:
 * both implementations anchor on `\b`, and `-` is a word boundary. That is the LIVE behaviour on
 * both sides and it errs conservative (an unknown sibling dir gets held out of critic training
 * rather than swept in), so it is pinned rather than "fixed" — a tighter anchor would change what
 * every historical showdown report counted. */
const PATHS: [string, RefPool][] = [
  ['/x/taste-dataset/refs-familiar/bass/loop-01.wav', 'ref:familiar'],
  ['/x/taste-dataset/refs-unfamiliar/lead/loop-02.wav', 'ref:unfamiliar'],
  ['/x/taste-dataset/refs-packs/drums/loop-03.wav', 'ref:packs'],
  ['/x/taste-dataset/refs-cc0/chords/loop-04.wav', 'ref:cc0'],
  ['/x/taste-dataset/refs/loose.wav', 'ref:other'],
  ['/x/refs-packs-old/loop.wav', 'ref:packs'],
  ['relative/refs-familiar/a.wav', 'ref:familiar'],
]

test('refPoolOf classifies each taste-dataset pool, including the boundary cases pinned above', () => {
  for (const [path, want] of PATHS) assert.equal(refPoolOf(path), want, path)
})

test('the DAW-side refPoolOf and showdown.ts classifyRefPool are the SAME rule', () => {
  for (const [path] of PATHS) {
    assert.equal(
      refPoolOf(path),
      classifyRefPool(path),
      `${path}: src/vary/batch.ts refPoolOf and src/taste/showdown.ts classifyRefPool disagree. ` +
        'These are two copies of one rule; delete showdown\'s copy and import refPoolOf rather than re-syncing them.',
    )
  }
})

function manifest(variants: { file: string; source?: { kind: string; from?: string } }[]): VaryBatchManifest {
  return { version: 1, createdAt: '2026-07-26T00:00:00Z', parent: 'song.beat', track: 'lead', group: 'showdown', seed: 1, variants } as unknown as VaryBatchManifest
}

test('refPoolsOf labels ref variants only — a non-ref variant is absent, never "ref:other"', () => {
  const m = manifest([
    { file: 'v1.beat', source: { kind: 'engine' } },
    { file: 'v2.beat', source: { kind: 'ref', from: '/x/refs-familiar/a.wav' } },
    { file: 'v3.beat', source: { kind: 'ref', from: '/x/refs-packs/b.wav' } },
    { file: 'v4.beat' },
  ])
  assert.deepEqual(refPoolsOf(m), { 'v2.beat': 'ref:familiar', 'v3.beat': 'ref:packs' })
  // the refs-packs holdout still reads its answer through the same one rule
  assert.deepEqual(trainingExcludedFiles(m), ['v3.beat'])
})

test('scoreBatch freezes refPools into the log entry, and writes an EMPTY object for a ref-less batch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-refpool-'))
  const log = join(dir, 'scores.jsonl')

  const write = (batch: string, variants: { file: string; source?: { kind: string; from?: string } }[]) => {
    const bdir = join(dir, batch)
    mkdirSync(bdir, { recursive: true })
    for (const v of variants) writeFileSync(join(bdir, v.file), 'format_version 0.11\nbpm 120\nloop_bars 2\nselected_track lead\n\ntrack lead lead #e06c75 synth\n  synth\n    osc sawtooth\n    volume -10\n    cutoff 2000\n    resonance 0.8\n    attack 0.01\n    decay 0.2\n    sustain 0.6\n    release 0.3\n    pan 0\n')
    writeFileSync(join(bdir, 'manifest.json'), JSON.stringify(manifest(variants)))
    return bdir
  }

  const withRefs = write('b-refs', [
    { file: 'v1.beat', source: { kind: 'engine' } },
    { file: 'v2.beat', source: { kind: 'ref', from: '/x/refs-unfamiliar/a.wav' } },
  ])
  scoreBatch(withRefs, ['v2'], log)

  const noRefs = write('b-norefs', [
    { file: 'v1.beat', source: { kind: 'engine' } },
    { file: 'v2.beat', source: { kind: 'gen' } },
  ])
  scoreBatch(noRefs, ['v1'], log)

  const entries = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { batch: string; refPools?: Record<string, string> })
  const a = entries.find((e) => e.batch.endsWith('b-refs'))!
  const b = entries.find((e) => e.batch.endsWith('b-norefs'))!

  assert.deepEqual(a.refPools, { 'v2.beat': 'ref:unfamiliar' }, 'the pool split must survive the batch dir being deleted')
  // Present and EMPTY, not omitted: this is the whole absent-means-old-entry discipline. If this
  // becomes `undefined`, a freshly-scored ref-less batch becomes indistinguishable from a
  // pre-D12 entry and a reader has to fall back to the manifest that may no longer exist.
  assert.deepEqual(b.refPools, {}, '"looked, no refs" must be distinguishable from "predates the field"')
})

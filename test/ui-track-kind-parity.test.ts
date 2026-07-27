// A headless guard on the GUI's hand-mirrored TrackKind — the drift class that research 137 §2.3
// found and research 136 §3 diagnosed from the other end, without either citing the other.
//
// `ui/` is a standalone Vite app, so ui/src/types.ts RE-DECLARES ~422 lines of document types
// rather than importing src/core/document.ts (types.ts's own header states the convention: "the
// daemon's JSON is the contract"). By 2026-07-26 that mirror had fallen a whole track kind behind:
//
//     src/core/document.ts:14   'synth'|'drums'|'instrument'|'audio'|'surge'
//     ui/src/types.ts:92        'synth'|'drums'|'instrument'|'audio'          <- no surge
//
// ArrangementView.tsx builds AUTO_OPTIONS_BY_KIND as a Record<TrackKind, …> — so it had exactly
// four keys — then indexed it unguarded at four sites, the first of which calls `.map()` on the
// result. A surge track's kind arrives verbatim in GET /document's JSON, so opening the shipped
// `examples/surge-pilot` project meant `undefined.map(...)`: a TypeError on the arrangement render
// path, i.e. the view does not draw at all. Type-checking could never catch it, because the cast
// happens at the JSON boundary where `kind` is just a string.
//
// `node --test` cannot mount React, but the two facts that actually matter here are textual: the
// two enum declarations must agree, and the by-kind record must cover every kind core can emit.
// This test costs milliseconds and fails loudly the next time a kind is added to core only.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { TRACK_KINDS } from '../src/core/document.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8')

// AUTO_OPTIONS_BY_KIND moved out of ArrangementView.tsx with the rest of the automation surface
// (Phase 41 Stream C). Named once here so the next move is a one-line edit rather than three.
const AUTO_OPTIONS_FILE = 'ui/src/components/AutomationLane.tsx'

/** Pull the string-literal members out of a `export type X = 'a' | 'b'` declaration. */
function unionMembers(src: string, decl: RegExp, what: string): string[] {
  const m = src.match(decl)
  assert.ok(m, `could not find ${what} — the declaration moved; update this test's pattern`)
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!)
}

test('ui/src/types.ts TrackKind mirrors core TRACK_KINDS exactly', () => {
  const ui = unionMembers(
    read('ui/src/types.ts'),
    /export type TrackKind = ([^\n]+)/,
    'ui/src/types.ts TrackKind',
  )
  assert.deepEqual(
    [...ui].sort(),
    [...TRACK_KINDS].sort(),
    'ui/src/types.ts:TrackKind has drifted from src/core/document.ts:TRACK_KINDS. The GUI receives ' +
      '`kind` verbatim over GET /document, so a kind core can emit and the GUI does not know is a ' +
      'live render crash (research 137 §2.3, the `surge` case). Add the missing member to ' +
      `ui/src/types.ts and give it an AUTO_OPTIONS_BY_KIND entry in ${AUTO_OPTIONS_FILE}.`,
  )
})

test('AutomationLane AUTO_OPTIONS_BY_KIND covers every core track kind', () => {
  const src = read(AUTO_OPTIONS_FILE)
  const body = src.match(/const AUTO_OPTIONS_BY_KIND[^=]+= \{([\s\S]*?)\n\}/)
  assert.ok(body, 'AUTO_OPTIONS_BY_KIND initializer not found — update this test')

  // Keys set in the object literal, plus any assigned afterwards (`AUTO_OPTIONS_BY_KIND.surge = …`),
  // since a kind whose options are derived rather than listed is covered just as well.
  const covered = new Set([
    ...[...body[1]!.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]!),
    ...[...src.matchAll(/AUTO_OPTIONS_BY_KIND\.(\w+)\s*=/g)].map((m) => m[1]!),
  ])

  for (const kind of TRACK_KINDS) {
    assert.ok(
      covered.has(kind),
      `AUTO_OPTIONS_BY_KIND has no '${kind}' entry. It is indexed by a track's runtime kind, so a ` +
        `missing entry is undefined and the first read calls .map() on it — the crash 137 §2.3 found.`,
    )
  }
})

test('AUTO_OPTIONS_BY_KIND is never indexed unguarded', () => {
  const src = read(AUTO_OPTIONS_FILE)
  // Reads must go through autoOptionsFor(), which supplies `?? []`. The two writes inside the
  // PARAM_GROUPS build loop are indexed by a declared ParamGroup.kinds member, not by runtime data.
  const rawIndexes = [...src.matchAll(/AUTO_OPTIONS_BY_KIND\[([^\]]+)\]/g)].map((m) => m[1]!.trim())
  const fromRuntimeDoc = rawIndexes.filter((expr) => expr !== 'kind' && expr !== 'kind as TrackKind')
  assert.deepEqual(
    fromRuntimeDoc,
    [],
    `AUTO_OPTIONS_BY_KIND is indexed directly by ${JSON.stringify(fromRuntimeDoc)}. Anything derived ` +
      `from a document's own \`kind\` must go through autoOptionsFor(), which degrades to [] instead ` +
      `of throwing when core emits a kind this file has not mirrored yet.`,
  )
})

test('the shipped surge example still exercises the kind this guards', () => {
  // If examples/surge-pilot ever stops containing a surge track, the tests above keep passing while
  // the thing they protect stops shipping. Name that dependency instead of assuming it.
  const beat = read('examples/surge-pilot/loop.beat')
  assert.match(
    beat,
    /^track \S+ .* surge$/m,
    'examples/surge-pilot/loop.beat no longer declares a surge track',
  )
})

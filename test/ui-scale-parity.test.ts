// A headless guard on the GUI's hand-mirrored scale table — the same drift class
// test/ui-track-kind-parity.test.ts guards for TrackKind, applied to the one table where drift
// would be worst.
//
// `ui/` is a standalone Vite app with no build-time dependency on src/core, so NoteView.tsx
// re-declares the scale table (SCALE_TABLE) that src/core/pitchtime.ts owns (SCALES). The GUI needs
// the PITCH CLASSES, not just the names, because two things read them client-side: the in-scale row
// shading, and the note-entry lock. Those two must agree with each other AND with the CLI's
// `beat fit-scale`, or a row that looks in-key rejects a note that the CLI would happily place —
// a lock disagreeing with its own highlighting is worse than no lock.
//
// Before v0.12 the GUI mirrored only the KEYS as a string list, so this drift was invisible: the
// GUI passed a name to the daemon and core did the resolving. Now that the GUI resolves pitch
// classes itself, the table is real shared math and needs a real gate.
//
// `node --test` cannot mount React, so this reads NoteView.tsx as text and parses the literal —
// the same technique the TrackKind parity test uses, for the same reason.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SCALES, SCALE_NAMES, CUSTOM_SCALE_NAME } from '../src/core/pitchtime.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const NOTE_VIEW = join(repoRoot, 'ui', 'src', 'components', 'NoteView.tsx')

function readNoteView(): string {
  const src = readFileSync(NOTE_VIEW, 'utf8')
  // A missing/renamed file must FAIL LOUDLY with a fix hint, never silently skip (CLAUDE.md:
  // "a test that can silently skip is not a gate").
  if (!src.includes('SCALE_TABLE')) {
    throw new Error(`${NOTE_VIEW} no longer declares SCALE_TABLE — if the GUI's scale table moved or was renamed, point this parity test at its new home rather than deleting it.`)
  }
  return src
}

/** Parses the `const SCALE_TABLE: ... = { ... }` object literal out of NoteView.tsx into the same
 * shape as core's SCALES. Comments are stripped first so the prose inside the literal (which
 * explains the third-less entries) can't be mistaken for entries. */
function parseUiScaleTable(src: string): Record<string, number[]> {
  const start = src.indexOf('const SCALE_TABLE')
  const open = src.indexOf('{', start)
  let depth = 0
  let end = -1
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  assert.ok(end > open, 'could not find the end of the SCALE_TABLE literal')
  const body = src
    .slice(open + 1, end)
    .replace(/\/\/[^\n]*/g, '') // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
  const out: Record<string, number[]> = {}
  for (const m of body.matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:\s*\[([^\]]*)\]/g)) {
    out[m[1]!] = m[2]!
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .map(Number)
  }
  return out
}

test("the GUI's SCALE_TABLE matches src/core/pitchtime.ts's SCALES exactly, key for key and value for value", () => {
  const ui = parseUiScaleTable(readNoteView())
  assert.deepEqual(
    Object.keys(ui).sort(),
    [...SCALE_NAMES].sort(),
    'scale NAMES drifted — a scale added to core but not the GUI is invisible in the piano roll; one added to the GUI only is rejected by the daemon',
  )
  for (const name of SCALE_NAMES) {
    assert.deepEqual(
      ui[name],
      [...SCALES[name]!],
      `scale "${name}" has different pitch classes in the GUI than in core — the piano roll would shade rows the CLI disagrees with`,
    )
  }
})

test('the GUI knows the same literal `custom` scale name core does', () => {
  const src = readNoteView()
  assert.match(
    src,
    new RegExp(`const CUSTOM_SCALE_NAME = '${CUSTOM_SCALE_NAME}'`),
    'the GUI\'s custom-scale sentinel drifted from core\'s CUSTOM_SCALE_NAME — a mismatch means the custom pitch-class form silently stops resolving in the piano roll',
  )
})

test('the GUI mirrors the third-less scales specifically (the reason the table grew at all)', () => {
  // Pinned by name rather than only via the loop above, because these two are the entries with a
  // measured musical claim attached: they are what lets a suspended/modal part avoid its own third.
  // If a future edit trims the table, this fails with an explanation instead of a diff.
  const ui = parseUiScaleTable(readNoteView())
  assert.deepEqual(ui.susPentatonic, [0, 2, 5, 7, 10], 'susPentatonic is the measured third-less set — the piano roll must know it')
  assert.deepEqual(ui.susHexatonic, [0, 2, 5, 7, 9, 10])
  for (const name of ['susPentatonic', 'susHexatonic']) {
    assert.ok(!ui[name]!.includes(3) && !ui[name]!.includes(4), `${name} must contain neither third`)
  }
})

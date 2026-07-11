// D2 pointing-protocol tests: the selection grammar (canonical round-trip + one-form rejection),
// doc-aware validation, the note-id resolution that makes `--scope selection` possible, and the
// daemon's ephemeral /selection channel (POST/GET, 400 on invalid, drop-on-doc-change).

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { get } from 'node:http'
import { test } from 'node:test'
import {
  parse,
  parseSelection,
  serializeSelection,
  validateSelection,
  selectionToNoteIds,
  selectionToVaryScope,
  BeatSelectionError,
  type BeatSelection,
} from '../src/core/index.js'
import { startDaemon, type Daemon } from '../src/daemon/daemon.js'

function synthBlock(): string {
  return `  synth
    osc sawtooth
    volume -10
    cutoff 9000
    resonance 0.8
    attack 0.01
    decay 0.2
    sustain 0.7
    release 0.3
    pan 0`
}

// drums (for lane refs) + lead (with a fractional-start note for the bars-window test).
const TEST_BEAT = `format_version 0.7
bpm 120
loop_bars 8
selected_track lead

track drums Drums #e06c75 drums
${synthBlock()}
  pattern kick 1 0 0 0 1 0 0 0 1 0 0 0 1 0 0 0
  pattern snare 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
  pattern clap 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
  pattern hat 0 0 1 0 0 0 1 0 0 0 1 0 0 0 1 0
  pattern openhat 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0

track lead Lead #c678dd synth
${synthBlock()}
  note u1 60 0 4 0.8
  note u2 64 3.5 0.5 0.7
  note u3 67 67 2 0.6
`

const doc = parse(TEST_BEAT)

const FULL_SELECTION = `selection
  tracks drums lead
  lanes drums.hat drums.openhat
  bars 8 16
  notes lead.u1 lead.u3
`

test('the canonical grammar round-trips byte-identically', () => {
  assert.equal(serializeSelection(parseSelection(FULL_SELECTION)), FULL_SELECTION)
})

test('an empty selection is just the header line', () => {
  assert.equal(serializeSelection({}), 'selection\n')
  assert.deepEqual(parseSelection('selection\n'), {})
  assert.equal(serializeSelection(parseSelection('selection\n')), 'selection\n')
})

test('each axis line is omitted when its axis is absent (single-axis forms)', () => {
  assert.equal(serializeSelection({ tracks: ['drums'] }), 'selection\n  tracks drums\n')
  assert.equal(serializeSelection({ bars: { start: 8, end: 16 } }), 'selection\n  bars 8 16\n')
  assert.equal(serializeSelection(parseSelection('selection\n  notes lead.u3\n')), 'selection\n  notes lead.u3\n')
})

test('bars are fractional-capable and formatted canonically', () => {
  const sel = parseSelection('selection\n  bars 2.5 4\n')
  assert.deepEqual(sel.bars, { start: 2.5, end: 4 })
  assert.equal(serializeSelection(sel), 'selection\n  bars 2.5 4\n')
})

test('parse rejects out-of-order axes to keep one canonical form', () => {
  assert.throws(() => parseSelection('selection\n  bars 0 4\n  tracks drums\n'), BeatSelectionError)
  assert.throws(() => parseSelection('selection\n  lanes drums.hat\n  tracks drums\n'), /out of order/)
})

test('parse rejects duplicated axes', () => {
  assert.throws(() => parseSelection('selection\n  tracks drums\n  tracks lead\n'), /out of order or duplicated/)
})

test('parse rejects a missing header, bad indentation, unknown axes, and empty axes', () => {
  assert.throws(() => parseSelection('tracks drums\n'), /must begin with a "selection" header/)
  assert.throws(() => parseSelection('selection\n    tracks drums\n'), /indented exactly 2 spaces/)
  assert.throws(() => parseSelection('selection\n  wat foo\n'), /unknown selection axis/)
  assert.throws(() => parseSelection('selection\n  tracks\n'), /needs at least one entry/)
  assert.throws(() => parseSelection('selection\n  lanes drums\n'), /must be "track\.lane"/)
})

test('validateSelection accepts a fully-resolving selection', () => {
  assert.doesNotThrow(() => validateSelection(parseSelection(FULL_SELECTION), doc))
})

test('validateSelection fails loudly on an unknown track', () => {
  assert.throws(() => validateSelection({ tracks: ['ghost'] }, doc), /unknown track "ghost"/)
})

test('validateSelection fails on an unknown drum lane', () => {
  assert.throws(() => validateSelection({ lanes: [{ track: 'drums', lane: 'cowbell' }] }, doc), /unknown drum lane "cowbell"/)
})

test('validateSelection rejects a lane ref to a non-drum track', () => {
  assert.throws(() => validateSelection({ lanes: [{ track: 'lead', lane: 'hat' }] }, doc), /lanes exist only on drum tracks/)
})

test('validateSelection fails on an unknown note id', () => {
  assert.throws(() => validateSelection({ notes: [{ track: 'lead', note: 'u9' }] }, doc), /unknown note "u9" on track "lead"/)
})

test('validateSelection accepts a `notes` axis entry naming a drum HIT id (drum tracks have hits, not notes)', () => {
  assert.doesNotThrow(() => validateSelection({ notes: [{ track: 'drums', note: 'kick0' }] }, doc))
})

test('validateSelection fails on an unknown hit id on a drum track', () => {
  assert.throws(() => validateSelection({ notes: [{ track: 'drums', note: 'kick999' }] }, doc), /unknown note "kick999" on track "drums"/)
})

test('validateSelection rejects bars with start >= end and negatives', () => {
  assert.throws(() => validateSelection({ bars: { start: 4, end: 4 } }, doc), /start must be less than end/)
  assert.throws(() => validateSelection({ bars: { start: 8, end: 4 } }, doc), /start must be less than end/)
  assert.throws(() => validateSelection({ bars: { start: -1, end: 4 } }, doc), /must be >= 0/)
})

test('selectionToNoteIds: absent tracks axis is unfiltered; drum tracks (no notes) drop out', () => {
  assert.deepEqual(selectionToNoteIds({}, doc), [{ track: 'lead', notes: ['u1', 'u2', 'u3'] }])
  assert.deepEqual(selectionToNoteIds({ tracks: ['drums'] }, doc), [])
})

test('selectionToNoteIds: a bars window catches a fractional-start note by [start*16, end*16)', () => {
  // bars 0 1 -> steps [0, 16): u1 @0 and the fractional u2 @3.5, but not u3 @67.
  assert.deepEqual(selectionToNoteIds({ bars: { start: 0, end: 1 } }, doc), [{ track: 'lead', notes: ['u1', 'u2'] }])
  // bars 4 5 -> steps [64, 80): only u3 @67.
  assert.deepEqual(selectionToNoteIds({ bars: { start: 4, end: 5 } }, doc), [{ track: 'lead', notes: ['u3'] }])
})

test('selectionToNoteIds intersects the axes (tracks AND bars AND notes list)', () => {
  const sel: BeatSelection = { tracks: ['lead'], bars: { start: 0, end: 1 }, notes: [{ track: 'lead', note: 'u1' }, { track: 'lead', note: 'u3' }] }
  // u1 passes all three; u2 fails the notes list; u3 fails the bars window.
  assert.deepEqual(selectionToNoteIds(sel, doc), [{ track: 'lead', notes: ['u1'] }])
})

// ---- selectionToVaryScope: the resolution behind `beat vary --scope selection` ------------

test('selectionToVaryScope: a fully empty selection resolves to no scope (whole track) for any track', () => {
  assert.deepEqual(selectionToVaryScope({}, doc, 'lead'), {})
  assert.deepEqual(selectionToVaryScope({}, doc, 'drums'), {})
})

test('selectionToVaryScope: a tracks-only selection naming the target resolves to no scope (whole track)', () => {
  assert.deepEqual(selectionToVaryScope({ tracks: ['lead'] }, doc, 'lead'), {})
  assert.deepEqual(selectionToVaryScope({ tracks: ['drums', 'lead'] }, doc, 'drums'), {})
})

test('selectionToVaryScope: tracks/lanes/notes axes name the tracks the selection is "about" — excluding the target throws', () => {
  assert.throws(() => selectionToVaryScope({ tracks: ['lead'] }, doc, 'drums'), /does not cover track "drums"/)
  assert.throws(() => selectionToVaryScope({ notes: [{ track: 'lead', note: 'u1' }] }, doc, 'drums'), /does not cover track "drums"/)
  assert.throws(() => selectionToVaryScope({ lanes: [{ track: 'drums', lane: 'hat' }] }, doc, 'lead'), /does not cover track "lead"/)
})

test('selectionToVaryScope: a bars-only selection has no tracks/lanes/notes axis, so it applies to any track (unfiltered on tracks)', () => {
  // lead: u1@0 and fractional u2@3.5 fall in steps [0,16); u3@67 does not.
  assert.deepEqual(selectionToVaryScope({ bars: { start: 0, end: 1 } }, doc, 'lead'), { ids: ['u1', 'u2'] })
  // drums: every hit in steps [0,16) across all lanes, in track order (kick, then hat, then openhat).
  assert.deepEqual(selectionToVaryScope({ bars: { start: 0, end: 1 } }, doc, 'drums'), {
    ids: ['kick0', 'kick4', 'kick8', 'kick12', 'hat2', 'hat6', 'hat10', 'hat14', 'openhat14'],
  })
})

test('selectionToVaryScope: a pure lanes selection on a drum track passes straight through as {lanes}', () => {
  assert.deepEqual(selectionToVaryScope({ lanes: [{ track: 'drums', lane: 'hat' }, { track: 'drums', lane: 'openhat' }] }, doc, 'drums'), {
    lanes: ['hat', 'openhat'],
  })
})

test('selectionToVaryScope: lanes narrowed further by bars resolves to concrete hit ids, not {lanes}', () => {
  const sel: BeatSelection = { lanes: [{ track: 'drums', lane: 'hat' }], bars: { start: 0, end: 1 } }
  assert.deepEqual(selectionToVaryScope(sel, doc, 'drums'), { ids: ['hat2', 'hat6', 'hat10', 'hat14'] })
})

test('selectionToVaryScope: a notes-axis selection maps to --ids — hit ids on a drum track, note ids on a synth track', () => {
  assert.deepEqual(selectionToVaryScope({ notes: [{ track: 'drums', note: 'kick0' }, { track: 'drums', note: 'hat2' }] }, doc, 'drums'), {
    ids: ['kick0', 'hat2'],
  })
  assert.deepEqual(selectionToVaryScope({ notes: [{ track: 'lead', note: 'u1' }, { track: 'lead', note: 'u3' }] }, doc, 'lead'), {
    ids: ['u1', 'u3'],
  })
})

test('selectionToVaryScope: intersects tracks AND bars AND notes, same rule as selectionToNoteIds', () => {
  const sel: BeatSelection = { tracks: ['lead'], bars: { start: 0, end: 1 }, notes: [{ track: 'lead', note: 'u1' }, { track: 'lead', note: 'u3' }] }
  // u1 passes all three; u3 fails the bars window (u2 isn't in the notes list at all).
  assert.deepEqual(selectionToVaryScope(sel, doc, 'lead'), { ids: ['u1'] })
})

test('selectionToVaryScope throws when the selection is non-empty but covers zero events on this track', () => {
  // bars window with nothing in it for lead.
  assert.throws(() => selectionToVaryScope({ bars: { start: 100, end: 101 } }, doc, 'lead'), /nothing on track "lead" to vary/)
  // notes axis names this track but lists none of its actual ids after the tracks-axis gate passes.
  assert.throws(
    () => selectionToVaryScope({ tracks: ['lead', 'drums'], notes: [{ track: 'drums', note: 'kick0' }] }, doc, 'lead'),
    /nothing on track "lead" to vary/,
  )
})

test('selectionToVaryScope throws for an unknown track', () => {
  assert.throws(() => selectionToVaryScope({}, doc, 'ghost'), /no track "ghost"/)
})

// ---- daemon /selection channel ------------------------------------------------------------

/** Minimal SSE client: resolves with the next event whose name is in `names`. */
function nextSseEvent(port: number, names: string[], timeoutMs = 3000): { promise: Promise<{ event: string; data: unknown }>; ready: Promise<void> } {
  let resolveReady!: () => void
  const ready = new Promise<void>((r) => (resolveReady = r))
  const promise = new Promise<{ event: string; data: unknown }>((resolve, reject) => {
    const req = get({ host: '127.0.0.1', port, path: '/events' }, (res) => {
      resolveReady()
      let buf = ''
      res.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf8')
        let sep: number
        while ((sep = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, sep)
          buf = buf.slice(sep + 2)
          const eventLine = frame.split('\n').find((l) => l.startsWith('event: '))
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '))
          if (!eventLine || !dataLine) continue
          const event = eventLine.slice('event: '.length)
          if (!names.includes(event)) continue
          clearTimeout(timer)
          req.destroy()
          resolve({ event, data: JSON.parse(dataLine.slice('data: '.length)) })
          return
        }
      })
    })
    const timer = setTimeout(() => {
      req.destroy()
      reject(new Error(`no ${names.join('/')} SSE event within ${timeoutMs}ms`))
    }, timeoutMs)
    req.on('error', reject)
  })
  return { promise, ready }
}

async function withDaemon(fn: (daemon: Daemon, filePath: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'beat-selection-test-'))
  const filePath = join(dir, 'song.beat')
  writeFileSync(filePath, TEST_BEAT)
  const daemon = await startDaemon({ filePath, port: 0 })
  try {
    await fn(daemon, filePath)
  } finally {
    await daemon.close()
  }
}

test('GET /selection returns {} when unset; POST stores, GET reflects, SSE broadcasts', async () => {
  await withDaemon(async (daemon) => {
    const base = `http://127.0.0.1:${daemon.port}`
    const empty = await (await fetch(`${base}/selection`)).json()
    assert.deepEqual(empty, {})

    const { promise, ready } = nextSseEvent(daemon.port, ['selection'])
    await ready
    const sel: BeatSelection = { tracks: ['drums'], bars: { start: 0, end: 4 } }
    const res = await fetch(`${base}/selection`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sel) })
    assert.equal(res.status, 200)

    const { event, data } = await promise
    assert.equal(event, 'selection')
    assert.deepEqual(data, sel)
    assert.deepEqual(await (await fetch(`${base}/selection`)).json(), sel)
    assert.deepEqual(daemon.getSelection(), sel)
  })
})

test('POST /selection with an unresolvable selection is a 400 with the error message', async () => {
  await withDaemon(async (daemon) => {
    const base = `http://127.0.0.1:${daemon.port}`
    const res = await fetch(`${base}/selection`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tracks: ['ghost'] }) })
    assert.equal(res.status, 400)
    assert.match(((await res.json()) as { error: string }).error, /unknown track "ghost"/)
    // rejected selection was not stored
    assert.deepEqual(daemon.getSelection(), {})
  })
})

test('a doc edit that removes a selected track drops the selection to empty and broadcasts', async () => {
  await withDaemon(async (daemon, filePath) => {
    const base = `http://127.0.0.1:${daemon.port}`
    await fetch(`${base}/selection`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tracks: ['drums'] }) })
    assert.deepEqual(daemon.getSelection(), { tracks: ['drums'] })

    // Rewrite the file with the drums track gone (lead remains, so the doc still parses).
    const { promise, ready } = nextSseEvent(daemon.port, ['selection'])
    await ready
    const withoutDrums = `format_version 0.7
bpm 120
loop_bars 8
selected_track lead

track lead Lead #c678dd synth
${synthBlock()}
  note u1 60 0 4 0.8
  note u2 64 3.5 0.5 0.7
  note u3 67 67 2 0.6
`
    writeFileSync(filePath, withoutDrums)
    const { data } = await promise
    assert.deepEqual(data, {})
    assert.deepEqual(daemon.getSelection(), {})
  })
})

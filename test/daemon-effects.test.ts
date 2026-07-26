// The daemon's four effect routes — first tests. Wave-0 gate W0.8(b).
//
// Review R5-F7: `/effect-add`, `/effect-remove`, `/effect-move` and `/effect-enabled` had ZERO
// `test/` references between them (one headful `ui/verify-*.mjs` each, run by hand). R5-F3 found
// live semantic drift in exactly this family — the `bypass` verb takes a boolean that means
// "bypassed?" on the CLI and "enabled?" on MCP — and nothing on any surface would have caught it.
// This file pins the daemon's half of that (see test/mcp-effects.test.ts for the MCP half and the
// cross-surface polarity comparison); it is also the gate R5-F5's daemon split steps 4-5 need,
// since these routes are among the ones the split moves.
//
// Request-level, through a real daemon over HTTP, following test/daemon.test.ts's pattern.

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { initDocument, addTrack, serialize, parse, type BeatDocument, type BeatEffect } from '../src/core/index.js'
import { startDaemon, type Daemon } from '../src/daemon/daemon.js'

/** synth `lead` (starts with the format's default eq3 -> comp -> distortion -> bitcrush chain),
 * drums `beat`, and an `audio`-kind track, which has no effect chain at all. */
function seedDoc(): BeatDocument {
  let doc = initDocument({ bpm: 120, loopBars: 1, trackId: 'lead' })
  doc = addTrack(doc, { id: 'beat', kind: 'drums' }).doc
  doc = addTrack(doc, { id: 'stem', kind: 'audio' }).doc
  return doc
}

interface Ctx {
  daemon: Daemon
  filePath: string
  post: (path: string, body?: unknown) => Promise<{ status: number; body: any }>
  chain: (trackId: string) => BeatEffect[]
  onDisk: () => BeatDocument
}

async function withDaemon(fn: (ctx: Ctx) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'beat-effects-test-'))
  const filePath = join(dir, 'song.beat')
  writeFileSync(filePath, serialize(seedDoc()))
  const daemon = await startDaemon({ filePath, port: 0 })
  const base = `http://127.0.0.1:${daemon.port}`
  const post = async (path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
    return { status: res.status, body: await res.json() as any }
  }
  const onDisk = () => parse(readFileSync(filePath, 'utf8'))
  try {
    await fn({ daemon, filePath, post, onDisk, chain: (trackId) => onDisk().tracks.find((t) => t.id === trackId)!.effects })
  } finally {
    await daemon.close()
  }
}

const ids = (effects: BeatEffect[]) => effects.map((e) => e.id)

// ---------------------------------------------------------------------------------------------
// The starting chain — pinned, because every case below reads relative to it.
// ---------------------------------------------------------------------------------------------

test('effects: a fresh synth track starts with the default eq3 -> comp -> distortion -> bitcrush chain', async () => {
  await withDaemon(async ({ chain }) => {
    assert.deepEqual(ids(chain('lead')), ['eq3', 'comp', 'distortion', 'bitcrush'])
    assert.ok(chain('lead').every((e) => e.enabled), 'all four start active, not bypassed')
    assert.deepEqual(ids(chain('stem')), [], 'an audio track STARTS with no chain (142 §3.2: it can carry one now, but [] is its canonical default — nothing to preserve)')
  })
})

// Research 142 §3.2: the audio-track refusal is lifted on every surface at once — the daemon route
// is the same edit.ts addEffect the CLI and MCP call, so this is one assertion that the lift
// reached the HTTP surface too (it previously 400'd with "effect chains only belong on
// synth/drums/instrument tracks").
test('POST /effect-add: an audio track accepts an insert now', async () => {
  await withDaemon(async ({ post, chain }) => {
    const res = await post('/effect-add', { track: 'stem', type: 'eq7' })
    assert.equal(res.status, 200)
    assert.deepEqual(ids(chain('stem')), ['eq7'])
  })
})

// ---------------------------------------------------------------------------------------------
// POST /effect-add
// ---------------------------------------------------------------------------------------------

test('POST /effect-add: appends by default, returns {written, doc}, and persists', async () => {
  await withDaemon(async ({ post, chain, daemon }) => {
    const { status, body } = await post('/effect-add', { track: 'lead', type: 'eq7' })
    assert.equal(status, 200)
    assert.equal(body.written, true)
    // The daemon's return shape is the FULL raw document (MCP's twin returns a human diff instead —
    // divergent, but defensible per transport; see test/mcp-effects.test.ts).
    assert.deepEqual(ids(body.doc.tracks.find((t: { id: string }) => t.id === 'lead').effects), ['eq3', 'comp', 'distortion', 'bitcrush', 'eq7'])
    assert.deepEqual(ids(chain('lead')), ['eq3', 'comp', 'distortion', 'bitcrush', 'eq7'], 'written to disk')
    assert.equal(daemon.getUndoDepth(), 1, 'and it is one undo step')
  })
})

test('POST /effect-add: `index` inserts at a position; `id` names the instance; ids auto-mint on collision', async () => {
  await withDaemon(async ({ post, chain }) => {
    await post('/effect-add', { track: 'lead', type: 'eq7', index: 0 })
    assert.deepEqual(ids(chain('lead')), ['eq7', 'eq3', 'comp', 'distortion', 'bitcrush'])

    await post('/effect-add', { track: 'lead', type: 'autoPan', id: 'widener', index: 2 })
    assert.deepEqual(ids(chain('lead')), ['eq7', 'eq3', 'widener', 'comp', 'distortion', 'bitcrush'])

    // A second instance of a type already present gets `<type>_2`.
    await post('/effect-add', { track: 'lead', type: 'eq7' })
    assert.deepEqual(ids(chain('lead')).slice(-1), ['eq7_2'])

    // An out-of-range index clamps to the chain bounds rather than erroring.
    await post('/effect-add', { track: 'lead', type: 'tremolo', index: 999 })
    assert.deepEqual(ids(chain('lead')).slice(-1), ['tremolo'])
  })
})

test('POST /effect-add: `bypassed` is INVERTED into core\'s `enabled` (the daemon\'s add-side polarity)', async () => {
  await withDaemon(async ({ post, chain }) => {
    // The daemon's add route speaks "bypassed?" — `opts.enabled = !b.bypassed`. Its sibling
    // /effect-enabled route speaks "enabled?". Two polarities inside ONE surface's effect family;
    // pinned here so the wave-2/W3.1 naming unification is a visible test change.
    await post('/effect-add', { track: 'lead', type: 'eq7', id: 'off-by-default', bypassed: true })
    assert.equal(chain('lead').find((e) => e.id === 'off-by-default')!.enabled, false, 'bypassed:true => enabled:false')

    await post('/effect-add', { track: 'lead', type: 'autoPan', id: 'on-explicitly', bypassed: false })
    assert.equal(chain('lead').find((e) => e.id === 'on-explicitly')!.enabled, true)

    await post('/effect-add', { track: 'lead', type: 'tremolo', id: 'on-by-omission' })
    assert.equal(chain('lead').find((e) => e.id === 'on-by-omission')!.enabled, true, 'omitted => active')
  })
})

test('POST /effect-add: rejects a bad body with 400 and a type list, a bad type/track with 400', async () => {
  await withDaemon(async ({ post, chain }) => {
    const missing = await post('/effect-add', { track: 'lead' })
    assert.equal(missing.status, 400)
    assert.match(missing.body.error, /body must include string track and type/)
    // The daemon enumerates all 12 legal types in its 400 (MCP does not — R5-F3's naming-drift list).
    assert.match(missing.body.error, /eq3\|comp\|distortion\|bitcrush\|eq7\|autoFilter\|autoPan\|tremolo\|utility\|grainDelay\|vinylDistortion\|resonator/)

    const badType = await post('/effect-add', { track: 'lead', type: 'reverb' })
    assert.equal(badType.status, 400)
    assert.match(badType.body.error, /effect type must be one of/)

    const noTrack = await post('/effect-add', { track: 'ghost', type: 'eq7' })
    assert.equal(noTrack.status, 400)
    assert.match(noTrack.body.error, /no track "ghost"/)

    assert.deepEqual(ids(chain('lead')), ['eq3', 'comp', 'distortion', 'bitcrush'], 'no failed request touched the file')
  })
})

test('POST /effect-add: a duplicate explicit id is refused', async () => {
  await withDaemon(async ({ post }) => {
    const dup = await post('/effect-add', { track: 'lead', type: 'eq7', id: 'eq3' })
    assert.equal(dup.status, 400)
    assert.match(dup.body.error, /effect id "eq3" already exists on track "lead"/)
  })
})

// ---------------------------------------------------------------------------------------------
// POST /effect-remove
// ---------------------------------------------------------------------------------------------

test('POST /effect-remove: removes by id, preserves the rest of the order', async () => {
  await withDaemon(async ({ post, chain }) => {
    const { status, body } = await post('/effect-remove', { track: 'lead', id: 'comp' })
    assert.equal(status, 200)
    assert.equal(body.written, true)
    assert.deepEqual(ids(chain('lead')), ['eq3', 'distortion', 'bitcrush'])

    // The chain may be emptied entirely — an empty chain is legal.
    for (const id of ['eq3', 'distortion', 'bitcrush']) await post('/effect-remove', { track: 'lead', id })
    assert.deepEqual(ids(chain('lead')), [])
  })
})

test('POST /effect-remove: 400s on a bad body, an unknown id, and an unknown track', async () => {
  await withDaemon(async ({ post, chain }) => {
    const bad = await post('/effect-remove', { track: 'lead' })
    assert.equal(bad.status, 400)
    assert.match(bad.body.error, /body must be \{track: string, id: string\}/)

    const unknown = await post('/effect-remove', { track: 'lead', id: 'nope' })
    assert.equal(unknown.status, 400)
    // The error names what IS there — the affordance that makes the id discoverable.
    assert.match(unknown.body.error, /no effect "nope" on track "lead" \(have: eq3, comp, distortion, bitcrush\)/)

    assert.equal((await post('/effect-remove', { track: 'ghost', id: 'eq3' })).status, 400)
    assert.deepEqual(ids(chain('lead')), ['eq3', 'comp', 'distortion', 'bitcrush'])
  })
})

// ---------------------------------------------------------------------------------------------
// POST /effect-move — array order IS chain order, so this is the whole reorder operation
// ---------------------------------------------------------------------------------------------

test('POST /effect-move: moves one entry to a 0-based index, clamped to the bounds', async () => {
  await withDaemon(async ({ post, chain }) => {
    assert.equal((await post('/effect-move', { track: 'lead', id: 'bitcrush', index: 0 })).status, 200)
    assert.deepEqual(ids(chain('lead')), ['bitcrush', 'eq3', 'comp', 'distortion'])

    await post('/effect-move', { track: 'lead', id: 'bitcrush', index: 2 })
    assert.deepEqual(ids(chain('lead')), ['eq3', 'comp', 'bitcrush', 'distortion'])

    // Past the end clamps to last; negative clamps to first. Neither is an error.
    await post('/effect-move', { track: 'lead', id: 'eq3', index: 99 })
    assert.deepEqual(ids(chain('lead')), ['comp', 'bitcrush', 'distortion', 'eq3'])
    await post('/effect-move', { track: 'lead', id: 'eq3', index: -5 })
    assert.deepEqual(ids(chain('lead')), ['eq3', 'comp', 'bitcrush', 'distortion'])
  })
})

test('POST /effect-move: a move to its own index is a canonical no-op (written:false, no undo step)', async () => {
  await withDaemon(async ({ post, chain, daemon }) => {
    const { status, body } = await post('/effect-move', { track: 'lead', id: 'eq3', index: 0 })
    assert.equal(status, 200)
    assert.equal(body.written, false)
    assert.deepEqual(ids(chain('lead')), ['eq3', 'comp', 'distortion', 'bitcrush'])
    assert.equal(daemon.getUndoDepth(), 0)
  })
})

test('POST /effect-move: 400s on a missing/mistyped index, an unknown id, and an unknown track', async () => {
  await withDaemon(async ({ post }) => {
    const noIndex = await post('/effect-move', { track: 'lead', id: 'eq3' })
    assert.equal(noIndex.status, 400)
    assert.match(noIndex.body.error, /body must be \{track: string, id: string, index: number\}/)

    const strIndex = await post('/effect-move', { track: 'lead', id: 'eq3', index: '1' })
    assert.equal(strIndex.status, 400)

    assert.equal((await post('/effect-move', { track: 'lead', id: 'nope', index: 0 })).status, 400)
    assert.equal((await post('/effect-move', { track: 'ghost', id: 'eq3', index: 0 })).status, 400)
  })
})

// ---------------------------------------------------------------------------------------------
// POST /effect-enabled — the daemon's half of the R5-F3 polarity story
// ---------------------------------------------------------------------------------------------

test('POST /effect-enabled: the boolean means ENABLED (the route is named for what it implements)', async () => {
  await withDaemon(async ({ post, chain }) => {
    // Of the three surfaces exposing this operation, the daemon is the one whose route name matches
    // its argument's meaning: `enabled:false` bypasses. The CLI's `beat effect-bypass <true|false>`
    // takes "bypassed?" and MCP's `beat_effect_bypass` takes "enabled?" under a bypass-shaped name
    // (R5-F3). See test/mcp-effects.test.ts for the cross-surface assertion.
    const off = await post('/effect-enabled', { track: 'lead', id: 'distortion', enabled: false })
    assert.equal(off.status, 200)
    assert.equal(off.body.written, true)
    assert.equal(chain('lead').find((e) => e.id === 'distortion')!.enabled, false)
    assert.deepEqual(ids(chain('lead')), ['eq3', 'comp', 'distortion', 'bitcrush'], 'bypass is not removal — order is untouched')

    await post('/effect-enabled', { track: 'lead', id: 'distortion', enabled: true })
    assert.equal(chain('lead').find((e) => e.id === 'distortion')!.enabled, true)

    // Setting the state it is already in writes nothing.
    assert.equal((await post('/effect-enabled', { track: 'lead', id: 'distortion', enabled: true })).body.written, false)
  })
})

test('POST /effect-enabled: 400s unless enabled is a real boolean', async () => {
  await withDaemon(async ({ post, chain }) => {
    for (const enabled of [undefined, 'false', 0, null]) {
      const res = await post('/effect-enabled', { track: 'lead', id: 'eq3', enabled })
      assert.equal(res.status, 400, `enabled=${JSON.stringify(enabled)} should be refused`)
      assert.match(res.body.error, /body must be \{track: string, id: string, enabled: boolean\}/)
    }
    assert.equal((await post('/effect-enabled', { track: 'lead', id: 'nope', enabled: false })).status, 400)
    assert.ok(chain('lead').every((e) => e.enabled), 'nothing was bypassed by a refused request')
  })
})

// ---------------------------------------------------------------------------------------------
// Cross-cutting: the file stays canonical, and every op is undoable
// ---------------------------------------------------------------------------------------------

test('effects: the whole family round-trips through the file and is undoable step by step', async () => {
  await withDaemon(async ({ post, chain, filePath, daemon }) => {
    await post('/effect-add', { track: 'lead', type: 'eq7', id: 'shelf' })
    await post('/effect-move', { track: 'lead', id: 'shelf', index: 0 })
    await post('/effect-enabled', { track: 'lead', id: 'shelf', enabled: false })
    await post('/effect-remove', { track: 'lead', id: 'comp' })
    assert.deepEqual(ids(chain('lead')), ['shelf', 'eq3', 'distortion', 'bitcrush'])

    const text = readFileSync(filePath, 'utf8')
    assert.equal(serialize(parse(text)), text, 'the daemon leaves the file canonical (D4)')

    assert.equal(daemon.getUndoDepth(), 4, 'effect ops carry no coalescing key — one step each')
    await post('/undo')
    assert.deepEqual(ids(chain('lead')), ['shelf', 'eq3', 'comp', 'distortion', 'bitcrush'], 'the removal came back')
    await post('/undo')
    assert.equal(chain('lead').find((e) => e.id === 'shelf')!.enabled, true, 'the bypass came back')
    await post('/undo')
    assert.deepEqual(ids(chain('lead')), ['eq3', 'comp', 'distortion', 'bitcrush', 'shelf'], 'the move came back')
    await post('/undo')
    assert.deepEqual(ids(chain('lead')), ['eq3', 'comp', 'distortion', 'bitcrush'], 'the add came back')
  })
})

test('effects: drums tracks carry chains too (the routes are not synth-only)', async () => {
  await withDaemon(async ({ post, chain }) => {
    assert.equal((await post('/effect-add', { track: 'beat', type: 'bitcrush', id: 'crush' })).status, 200)
    assert.ok(ids(chain('beat')).includes('crush'))
    assert.equal((await post('/effect-enabled', { track: 'beat', id: 'crush', enabled: false })).status, 200)
    assert.equal(chain('beat').find((e) => e.id === 'crush')!.enabled, false)
  })
})

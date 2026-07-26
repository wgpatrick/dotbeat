// The CA2 figure source (src/taste/ca2.ts, python/ca2_figures.py) — research 124 §A.4's
// LLM-as-orchestrator wiring: our theory layer owns the chord track, Composer's Assistant 2
// proposes the notes, our guards and lint have the last word.
//
// Most of this runs EVERYWHERE, with no CA2 install, by pointing BEAT_CA2_PYTHON at a tiny STUB
// interpreter written at test time: a node script that reads the request JSON on stdin and prints
// a canned sidecar payload. That exercises the real spawn path, the real payload validation, the
// real guards, and the real reseed loop while keeping the 716MB weights out of the test suite.
// The last block is the integration test against the REAL sidecar and skips cleanly when the
// out-of-repo install isn't present (same posture as the surge tests).

import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  CA2_CONTRACT_VERSION,
  CA2_MAX_RESEEDS,
  CA2_ROLE_ASKS,
  CA2_ROLE_REGISTER_OFFSETS,
  buildCA2Request,
  ca2Available,
  ca2Doctor,
  ca2FigureLabel,
  chooseCA2Ask,
  chordTrackToRequestChords,
  composeCA2Phrase,
  guardCA2Notes,
  isCA2Role,
  validateCA2Payload,
} from '../src/taste/ca2.js'
import { buildChordTrack, lintFigure, scaleConsistency } from '../src/taste/theory.js'
import { mulberry32 } from '../src/taste/eval.js'
import { BeatBatchError } from '../src/vary/batch.js'
import type { PhraseKey } from '../src/taste/showdown.js'

const KEY: PhraseKey = { root: 48, minor: true }

// ---- the stub sidecar ---------------------------------------------------------------------------
// A node script masquerading as the CA2 python interpreter. It ignores the script path it is
// handed, reads the request on stdin, and answers from a per-test recipe compiled into it.

function writeStub(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'beat-ca2-stub-'))
  const path = join(dir, 'stub-python')
  writeFileSync(path, `#!/usr/bin/env node
let raw = ''
process.stdin.on('data', (d) => { raw += d })
process.stdin.on('end', () => {
  const req = raw.trim() === '' ? {} : JSON.parse(raw)
  const reply = (notes, extra) => {
    process.stdout.write(JSON.stringify({ backend: 'ca2', contract: ${CA2_CONTRACT_VERSION}, model: 'stub',
      device: 'cpu', role: req.role, seed: req.seed, bars: req.bars, generatedNotes: notes.length,
      wallSeconds: 0.01, notes, ...(extra ?? {}) }))
    process.exit(0)
  }
  const note = (start, pitch, duration = 2, velocity = 0.8) => ({ start, pitch, duration, velocity })
${body}
})
`)
  chmodSync(path, 0o755)
  return path
}

/** Run `fn` with BEAT_CA2_PYTHON pointed at a stub, restoring the env afterwards. */
async function withStub<T>(body: string, fn: () => Promise<T>): Promise<T> {
  const before = process.env.BEAT_CA2_PYTHON
  process.env.BEAT_CA2_PYTHON = writeStub(body)
  try {
    return await fn()
  } finally {
    if (before === undefined) delete process.env.BEAT_CA2_PYTHON
    else process.env.BEAT_CA2_PYTHON = before
  }
}

/** A clean, in-key, four-on-the-floor answer: root of the sounding chord on every beat. */
const CLEAN_STUB = `
  const notes = []
  for (let bar = 0; bar < req.bars; bar++) {
    const chord = req.chordTrack.filter((c) => c.bar <= bar).pop() ?? req.chordTrack[0]
    for (const step of [0, 4, 8, 12]) notes.push(note(bar * 16 + step, chord.root))
  }
  reply(notes)
`

// ---- pure helpers -------------------------------------------------------------------------------

test('isCA2Role: pitched roles only — drum-loop is NOT a CA2 role', () => {
  assert.equal(isCA2Role('bassline'), true)
  assert.equal(isCA2Role('chords'), true)
  assert.equal(isCA2Role('lead'), true)
  assert.equal(isCA2Role('drum-loop'), false, 'CA2 is a pitched infiller; drums keep the bank')
  assert.equal(isCA2Role('nonsense'), false)
})

test('ca2FigureLabel: prefixed so it can never collide with a bank / theory / midi label', () => {
  assert.equal(ca2FigureLabel('roller'), 'ca2:roller')
  for (const asks of Object.values(CA2_ROLE_ASKS)) {
    for (const a of asks) assert.ok(ca2FigureLabel(a.name).startsWith('ca2:'))
  }
})

test('chooseCA2Ask: honours the per-role exclude chain, falls back when exhausted', () => {
  const asks = CA2_ROLE_ASKS.bassline
  const first = chooseCA2Ask(mulberry32(5), asks, [])
  const second = chooseCA2Ask(mulberry32(5), asks, [ca2FigureLabel(first.name)])
  assert.notEqual(second.name, first.name, 'exclude skips the used ask')
  const allUsed = asks.map((a) => ca2FigureLabel(a.name))
  const fallback = chooseCA2Ask(mulberry32(5), asks, allUsed)
  assert.ok(asks.some((a) => a.name === fallback.name), 'every ask used → seeded pick anyway, never undefined')
})

test('chordTrackToRequestChords: the theory chord track becomes ABSOLUTE midi pitches', () => {
  const track = buildChordTrack(KEY, 11)
  const chords = chordTrackToRequestChords(track)
  assert.equal(chords.length, track.chords.length)
  for (let i = 0; i < chords.length; i++) {
    assert.equal(chords[i]!.bar, track.chords[i]!.startBar)
    assert.equal(chords[i]!.root, KEY.root + track.chords[i]!.rootOffset)
    assert.deepEqual(chords[i]!.tones, track.chords[i]!.tones.map((t) => KEY.root + t))
  }
})

test('buildCA2Request: register comes from OUR code (the §A.4 orchestrator half), not the model', () => {
  const track = buildChordTrack(KEY, 3)
  const ask = CA2_ROLE_ASKS.lead[0]!
  const req = buildCA2Request('lead', track, ask, 3, 128)
  assert.equal(req.role, 'lead')
  assert.equal(req.bpm, 128)
  assert.equal(req.bars, track.bars)
  assert.equal(req.register.lo, KEY.root + CA2_ROLE_REGISTER_OFFSETS.lead.lo)
  assert.equal(req.register.hi, KEY.root + CA2_ROLE_REGISTER_OFFSETS.lead.hi)
  assert.deepEqual(req.density, { horiz: ask.horiz, vert: ask.vert })
  assert.ok(req.register.lo < req.register.hi)
  // the bass window deliberately reaches under the theory register floor — enforceBassRegister
  // decides what may live there, not CA2
  assert.ok(KEY.root + CA2_ROLE_REGISTER_OFFSETS.bassline.lo < 48)
})

// ---- payload validation -------------------------------------------------------------------------

const okPayload = {
  backend: 'ca2', contract: CA2_CONTRACT_VERSION, model: 'm', device: 'cpu', role: 'bassline',
  seed: 1, bars: 4, generatedNotes: 1, wallSeconds: 0.1,
  notes: [{ pitch: 40, start: 0, duration: 4, velocity: 0.8 }],
}

test('validateCA2Payload: accepts a well-formed payload', () => {
  const p = validateCA2Payload(okPayload)
  assert.equal(p.role, 'bassline')
  assert.equal(p.notes.length, 1)
  assert.equal(p.notes[0]!.pitch, 40)
})

test('validateCA2Payload: a malformed payload fails HERE, not as NaN pitches at render time', () => {
  const bad: [string, unknown][] = [
    ['not an object', 42],
    ['wrong backend', { ...okPayload, backend: 'amt' }],
    ['contract skew', { ...okPayload, contract: CA2_CONTRACT_VERSION + 1 }],
    ['bad role', { ...okPayload, role: 'drum-loop' }],
    ['no notes', { ...okPayload, notes: [] }],
    ['pitch out of range', { ...okPayload, notes: [{ pitch: 900, start: 0, duration: 1, velocity: 0.5 }] }],
    ['start past the phrase', { ...okPayload, notes: [{ pitch: 40, start: 64, duration: 1, velocity: 0.5 }] }],
    ['zero duration', { ...okPayload, notes: [{ pitch: 40, start: 0, duration: 0, velocity: 0.5 }] }],
    ['velocity out of range', { ...okPayload, notes: [{ pitch: 40, start: 0, duration: 1, velocity: 9 }] }],
  ]
  for (const [why, payload] of bad) {
    assert.throws(() => validateCA2Payload(payload), BeatBatchError, `should reject: ${why}`)
  }
})

// ---- the guards ---------------------------------------------------------------------------------

test('guardCA2Notes: folds out-of-range notes back into the window OUR code asked for', () => {
  const track = buildChordTrack(KEY, 2, { planing: false })
  const root = KEY.root + track.chords[0]!.rootOffset
  const { notes, corrections } = guardCA2Notes('lead', [
    { pitch: root + 36, start: 0, duration: 2, velocity: 0.8 }, // way above
    { pitch: root - 24, start: 4, duration: 2, velocity: 0.8 }, // way below
  ], track, { lo: root, hi: root + 24 })
  assert.equal(corrections.rangeFolded, 2)
  for (const n of notes) assert.ok(n.pitch >= root && n.pitch <= root + 24, `${n.pitch} inside the window`)
})

test('guardCA2Notes: snaps out-of-key notes but SPARES chord tones of the sounding chord', () => {
  const track = buildChordTrack(KEY, 4, { planing: false, cadence: false })
  const chord = track.chords[0]!
  const chordTone = KEY.root + 12 + chord.tones[1]! // the third, an octave up
  const outOfKey = KEY.root + 13 // a b9 above the key root — not in natural minor
  const { notes, corrections } = guardCA2Notes('lead', [
    { pitch: chordTone, start: 0, duration: 2, velocity: 0.8 },
    { pitch: outOfKey, start: 4, duration: 2, velocity: 0.8 },
  ], track, { lo: 0, hi: 127 })
  assert.equal(notes[0]!.pitch, chordTone, 'a tone of OUR OWN chord is legal by construction')
  assert.ok(corrections.scaleSnapped >= 1, 'the out-of-key note was corrected')
  assert.equal(scaleConsistency(notes, track.key), 1, 'nothing out of key survives')
})

test('guardCA2Notes: enforces the bass register rule (below ~130 Hz only root/5th/octave)', () => {
  const track = buildChordTrack(KEY, 6, { planing: false, barsPerChord: 1, cadence: false })
  const chordRoot = KEY.root - 12 + track.chords[0]!.rootOffset
  // a third below the register floor — the textbook violation §C.2 exists to stop
  const third = chordRoot + 3
  assert.ok(third < 48, 'the fixture note really is in the sub register')
  const { notes, corrections } = guardCA2Notes('bassline', [
    { pitch: third, start: 0, duration: 4, velocity: 0.8 },
    { pitch: chordRoot, start: 4, duration: 4, velocity: 0.8 }, // root: legal at any register
  ], track, { lo: 28, hi: 60 })
  assert.equal(corrections.registerLifted, 1)
  assert.equal(notes.find((n) => n.start === 4)!.pitch, chordRoot, 'the root passes through untouched')
  assert.equal(lintFigure(notes, track).registerViolations.length, 0)
})

test('guardCA2Notes: records the RAW pre-guard scale consistency (what CA2 actually handed back)', () => {
  const track = buildChordTrack(KEY, 8, { planing: false, cadence: false })
  const { corrections } = guardCA2Notes('lead', [
    { pitch: KEY.root + 24, start: 0, duration: 2, velocity: 0.8 },
    { pitch: KEY.root + 25, start: 4, duration: 2, velocity: 0.8 },
  ], track, { lo: 0, hi: 127 })
  assert.equal(corrections.rawScaleConsistency, 0.5, 'the honest before-correction number is kept')
})

test('guardCA2Notes: never mutates the caller\'s notes', () => {
  const track = buildChordTrack(KEY, 9)
  const input = [{ pitch: KEY.root + 61, start: 0, duration: 2, velocity: 0.8 }]
  guardCA2Notes('lead', input, track, { lo: 60, hi: 84 })
  assert.equal(input[0]!.pitch, KEY.root + 61, 'input array is untouched')
})

// ---- the sidecar contract, end to end through a stub ---------------------------------------------

test('composeCA2Phrase: same ComposedPhrase contract as composeTheoryPhrase', async () => {
  const phrase = await withStub(CLEAN_STUB, () => composeCA2Phrase('bassline', KEY, 21))
  assert.ok(phrase.archetype.startsWith('ca2:'))
  assert.ok(Array.isArray(phrase.notes) && phrase.notes.length > 0)
  for (const n of phrase.notes) {
    assert.equal(typeof n.pitch, 'number')
    assert.equal(typeof n.start, 'number')
    assert.ok(n.duration >= 1)
    assert.ok(n.velocity > 0 && n.velocity <= 1)
  }
  assert.ok(phrase.lint, 'carries the pre-render lint report, like a theory phrase')
  assert.ok(phrase.chordTrack, 'carries the chord track it composed over')
  assert.equal(phrase.ca2.reseeds, 0, 'a clean figure needs no reseed')
  assert.equal(phrase.ca2.model, 'stub')
})

test('composeCA2Phrase: the chord track is OURS — same seed builds the same harmony as theory', async () => {
  const phrase = await withStub(CLEAN_STUB, () => composeCA2Phrase('chords', KEY, 33))
  assert.deepEqual(phrase.chordTrack, buildChordTrack(KEY, 33), 'buildChordTrack, seeded identically')
})

test('composeCA2Phrase: determinism — the same seed reproduces the same notes', async () => {
  const [a, b] = await withStub(CLEAN_STUB, async () => [
    await composeCA2Phrase('lead', KEY, 77),
    await composeCA2Phrase('lead', KEY, 77),
  ])
  assert.deepEqual(a!.notes, b!.notes)
  assert.equal(a!.archetype, b!.archetype)
  assert.equal(a!.ca2.acceptedSeed, b!.ca2.acceptedSeed)
})

test('composeCA2Phrase: the seed reaches the sidecar (the model\'s own sampling seed)', async () => {
  // the stub echoes the seed it received back as a NOTE COUNT (pitches would be normalized away by
  // the guards), so a different phrase seed must reach the sidecar as a different request seed
  const stub = `
    const notes = []
    for (let i = 0; i <= req.seed % 3; i++) notes.push(note(i * 8, req.chordTrack[0].root))
    reply(notes)
  `
  const [a, b] = await withStub(stub, async () => [
    await composeCA2Phrase('bassline', KEY, 100),
    await composeCA2Phrase('bassline', KEY, 101),
  ])
  assert.notEqual(a!.notes.length, b!.notes.length, 'the phrase seed reached the model\'s sampler')
})

test('composeCA2Phrase: a lint-failing figure is REJECTED and reseeded, and the reseed is recorded', async () => {
  // attempt 0 answers with alternating even/odd onset bars (groove consistency 0 — the lint's
  // gross-error gate); every later attempt answers cleanly.
  const stub = `
    const notes = []
    if (req.seed === 0) {
      for (let bar = 0; bar < req.bars; bar++) {
        for (let s = bar % 2; s < 16; s += 2) notes.push(note(bar * 16 + s, req.chordTrack[0].root, 1))
      }
    } else {
      for (let bar = 0; bar < req.bars; bar++) {
        const chord = req.chordTrack.filter((c) => c.bar <= bar).pop() ?? req.chordTrack[0]
        for (const step of [0, 4, 8, 12]) notes.push(note(bar * 16 + step, chord.root))
      }
    }
    reply(notes)
  `
  // seed 0 makes attempt 0 the failing branch (0 % 7919 === 0), attempt 1 the clean one
  const phrase = await withStub(stub, () => composeCA2Phrase('chords', KEY, 0))
  assert.equal(phrase.ca2.reseeds, 1, 'exactly one reseed was needed')
  assert.equal(phrase.ca2.acceptedSeed, 7919, 'the accepted seed is recorded, not just the count')
  assert.deepEqual(phrase.lint.flags, [], 'the accepted figure is clean')
  assert.deepEqual(phrase.ca2.unresolvedFlags, [])
})

test('composeCA2Phrase: a figure that never passes exhausts the budget and is returned FLAGGED, not thrown', async () => {
  const stub = `
    const notes = []
    for (let bar = 0; bar < req.bars; bar++) {
      for (let s = bar % 2; s < 16; s += 2) notes.push(note(bar * 16 + s, req.chordTrack[0].root, 1))
    }
    reply(notes)
  `
  const phrase = await withStub(stub, () => composeCA2Phrase('chords', KEY, 5))
  assert.equal(phrase.ca2.reseeds, CA2_MAX_RESEEDS, 'the whole budget was spent')
  assert.ok(phrase.ca2.unresolvedFlags.length > 0, 'the surviving flags are recorded, honestly')
  assert.ok(phrase.notes.length > 0, 'a flagged figure is still rendered and rated (flag, never score)')
})

test('composeCA2Phrase: guards run on real sidecar output, and the corrections are counted', async () => {
  // an out-of-key note (b9), a sub-register third, and an out-of-range note in one answer
  const stub = `
    const root = req.chordTrack[0].root
    reply([note(0, root), note(4, root + 1), note(8, root - 36), note(12, root + 40)])
  `
  const phrase = await withStub(stub, () => composeCA2Phrase('bassline', KEY, 13))
  const c = phrase.ca2.corrections
  assert.ok(c.rangeFolded >= 2, 'the two wild notes were folded back into the window')
  assert.ok(c.rawScaleConsistency < 1, 'the RAW model output really was out of key')
  assert.equal(scaleConsistency(phrase.notes, phrase.chordTrack.key), 1, 'nothing out of key survives the guards')
  assert.equal(lintFigure(phrase.notes, phrase.chordTrack).registerViolations.length, 0)
})

test('composeCA2Phrase: excludes thread through to the ask, so two clips in a batch differ', async () => {
  const [a, b] = await withStub(CLEAN_STUB, async () => {
    const first = await composeCA2Phrase('lead', KEY, 55)
    const second = await composeCA2Phrase('lead', KEY, 55, { exclude: [first.archetype] })
    return [first, second]
  })
  assert.notEqual(b!.archetype, a!.archetype)
})

// ---- loud failure -------------------------------------------------------------------------------

test('composeCA2Phrase: a sidecar failure THROWS — never a silent bank substitution', async () => {
  const stub = `
    process.stderr.write('dependency error: no Composer\\'s Assistant 2 checkout found\\n')
    process.exit(3)
  `
  await withStub(stub, async () => {
    await assert.rejects(() => composeCA2Phrase('lead', KEY, 1), (err: unknown) => {
      assert.ok(err instanceof BeatBatchError)
      assert.match(err.message, /ca2_figures/)
      assert.match(err.message, /BEAT_CA2_DIR/, 'the setup hint rides along on exit 3')
      return true
    })
  })
})

test('composeCA2Phrase: non-JSON stdout fails loudly with the offending output', async () => {
  await withStub(`process.stdout.write('not json at all'); process.exit(0)`, async () => {
    await assert.rejects(() => composeCA2Phrase('lead', KEY, 1), /non-JSON stdout/)
  })
})

test('composeCA2Phrase: a payload with the wrong contract version fails loudly (version skew)', async () => {
  await withStub(`
    process.stdout.write(JSON.stringify({ backend: 'ca2', contract: 99, role: req.role, seed: req.seed,
      bars: req.bars, notes: [note(0, 48)] }))
    process.exit(0)
  `, async () => {
    await assert.rejects(() => composeCA2Phrase('lead', KEY, 1), /contract 99/)
  })
})

test('ca2Doctor / ca2Available: honest report, never throws, when the interpreter is missing', async () => {
  const before = process.env.BEAT_CA2_PYTHON
  process.env.BEAT_CA2_PYTHON = join(tmpdir(), 'beat-ca2-definitely-not-here')
  try {
    const report = await ca2Doctor()
    assert.equal(ca2Available(report), false)
    assert.ok(report.error, 'reports WHY, not a stack trace')
    assert.ok(report.fix, 'and how to fix it')
  } finally {
    if (before === undefined) delete process.env.BEAT_CA2_PYTHON
    else process.env.BEAT_CA2_PYTHON = before
  }
})

test('ca2Available: reads the doctor report defensively', () => {
  assert.equal(ca2Available({ available: true }), true)
  assert.equal(ca2Available({ available: false }), false)
  assert.equal(ca2Available({}), false, 'no available key → unavailable')
})

// ---- integration with the REAL sidecar (skipped without the out-of-repo install) -----------------

const realReport = await (async () => {
  const before = process.env.BEAT_CA2_PYTHON
  delete process.env.BEAT_CA2_PYTHON
  try {
    return await ca2Doctor()
  } catch {
    return { available: false } as Record<string, unknown>
  } finally {
    if (before !== undefined) process.env.BEAT_CA2_PYTHON = before
  }
})()
const hasCA2 = ca2Available(realReport)

test('integration: the real CA2 sidecar composes an in-key figure over our chord track',
  { skip: !hasCA2 ? 'no CA2 install (set BEAT_CA2_DIR / BEAT_CA2_PYTHON)' : false }, async () => {
    const phrase = await composeCA2Phrase('bassline', KEY, 7)
    assert.ok(phrase.notes.length > 0)
    assert.equal(scaleConsistency(phrase.notes, phrase.chordTrack.key), 1, 'guards leave nothing out of key')
    assert.equal(lintFigure(phrase.notes, phrase.chordTrack).registerViolations.length, 0)
    assert.ok(phrase.ca2.reseeds <= CA2_MAX_RESEEDS)
    assert.notEqual(phrase.ca2.device, 'unknown')
  })

test('integration: the real sidecar is DETERMINISTIC in the seed',
  { skip: !hasCA2 ? 'no CA2 install (set BEAT_CA2_DIR / BEAT_CA2_PYTHON)' : false }, async () => {
    const a = await composeCA2Phrase('lead', KEY, 12)
    const b = await composeCA2Phrase('lead', KEY, 12)
    assert.deepEqual(a.notes, b.notes, 'same seed, same notes — CA2 sampling is seedable')
  })

// `beat compose` / beat_compose (src/taste/compose.ts) — the verb that puts the theory layer and
// CA2 into an ordinary project.
//
// THE GATE THIS FILE EXISTS FOR is the song-mode clip trap. In song mode the engine renders a
// track's CLIPS, never its live notes (ui/src/audio/engine.ts contentOf), so a compose that writes
// notes and stops produces variants that render BYTE-IDENTICAL to the parent. That happened for
// real on 2026-07-27: eight board variants of an arp figure, two full render passes burned, caught
// only because all eight measured identically.
//
// A test that asserts "the composed variant differs from the parent" is worthless on its own,
// because a variant differs in its LIVE notes whether or not the clips were re-snapshotted, and
// the live notes are not what is rendered. So every assertion here goes through `renderedNotes`
// below — a deliberate re-implementation of the engine's OWN clip resolution — and the trap test
// carries its NEGATIVE CONTROL in the same test: the same compose with clipSync:false must come
// out clip-identical to the parent. That control is what proves the assertion has teeth; it fails
// (asserts identical, finds different) the moment the clip re-snapshot starts happening
// unconditionally, and the positive half fails the moment it stops happening at all.
//
// CA2 (--source ca2) runs against the same STUB INTERPRETER test/ca2.test.ts uses, so the spawn
// path, payload validation and guards are exercised everywhere with no 716MB install; the one
// REAL-install test is env-gated with a named reason, as is the one real render.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse, serialize } from '../src/core/index.js'
import type { BeatDocument } from '../src/core/document.js'
import {
  composeBatch,
  composeIntoDoc,
  defaultComposeBatchDir,
  inferComposeRole,
  keyLabel,
  octaveShiftFor,
  parseComposeMode,
  parseKeyRoot,
  placedClipIds,
  resolveComposeKey,
} from '../src/taste/compose.js'
import { CA2_CONTRACT_VERSION, ca2Available, ca2Doctor } from '../src/taste/ca2.js'
import { BeatBatchError } from '../src/vary/batch.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const beatCli = join(repoRoot, 'cli', 'beat.mjs')

function beat(args: string[], opts: { expectExit?: number } = {}): string {
  try {
    return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8' })
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    if (opts.expectExit !== undefined && e.status === opts.expectExit) return (e.stdout ?? '') + (e.stderr ?? '')
    throw new Error(`beat ${args.join(' ')} exited ${e.status}:\n${e.stderr ?? ''}${e.stdout ?? ''}`)
  }
}

// ---- fixtures ------------------------------------------------------------------------------------

/** A song-mode project shaped like the real one this verb was built for: an `arp` track placed in
 * two scenes under TWO different clips (arp_a loud, arp_soft quiet), a bass, and a 3-section song.
 * The live buffer matches arp_a, exactly as a file that has been through `beat clip` does. */
const SONG_MODE = `format_version 0.11
bpm 125
loop_bars 4
selected_track arp

track arp ARP #61afef synth
  clip arp_a
    note a1 63 0 1 0.85
    note a2 66 1 1 0.7
    note a3 70 2 1 0.7
    note a4 75 3 1 0.7
  clip arp_soft
    note a1 63 0 1 0.468
    note a2 66 1 1 0.385
    note a3 70 2 1 0.385
    note a4 75 3 1 0.385
  note a1 63 0 1 0.85
  note a2 66 1 1 0.7
  note a3 70 2 1 0.7
  note a4 75 3 1 0.7

track bass BASS #98c379 synth
  clip bass_a
    note b1 39 0 4 0.9
    note b2 39 8 4 0.9
  note b1 39 0 4 0.9
  note b2 39 8 4 0.9

scene s_intro
  slot arp arp_soft
  slot bass bass_a

scene s_drop
  slot arp arp_a
  slot bass bass_a

song
  section s_intro 8
  section s_drop 16
`

/** The same material with NO song block — loop mode, where the engine plays live notes directly. */
const LOOP_MODE = `format_version 0.11
bpm 125
loop_bars 4
selected_track arp

track arp ARP #61afef synth
  note a1 63 0 1 0.85
  note a2 66 1 1 0.7
  note a3 70 2 1 0.7
  note a4 75 3 1 0.7
`

function scratch(name: string, text: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'beat-compose-'))
  const file = join(dir, name)
  writeFileSync(file, text)
  return { dir, file }
}

/** THE ENGINE'S OWN RESOLUTION, re-implemented: for every section the song visits, the notes the
 * track actually sounds — its placed CLIP's notes in song mode, its live notes in loop mode
 * (engine.ts contentOf, lines 4247-4310). Every "did this compose change what you hear" assertion
 * in this file goes through here rather than through the file's bytes, because the file's bytes
 * change either way and only this changes when the render does. */
function renderedNotes(doc: BeatDocument, trackId: string): string {
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track || track.kind !== 'synth') throw new Error(`no synth track ${trackId}`)
  const fmt = (ns: readonly { pitch: number; start: number; duration: number; velocity: number }[]): string =>
    ns.map((n) => `${n.pitch}@${n.start}/${n.duration}v${n.velocity}`).join(' ')
  if (!doc.song || doc.song.length === 0) return `live: ${fmt(track.notes)}`
  const out: string[] = []
  for (const section of doc.song) {
    const scene = doc.scenes.find((s) => s.id === section.scene)
    const placements = scene ? scene.slots[trackId] ?? [] : []
    const clipId = (placements.find((p) => p.at === 0) ?? placements[0])?.clip
    const clip = clipId ? track.clips.find((c) => c.id === clipId) : undefined
    out.push(`${section.scene}:${clipId ?? 'silent'}:${clip ? fmt(clip.notes) : ''}`)
  }
  return out.join('\n')
}

const readDoc = (file: string): BeatDocument => parse(readFileSync(file, 'utf8'))

// ---- THE TRAP ------------------------------------------------------------------------------------

test('song mode: compose re-snapshots the placed clips, so what the ENGINE plays actually changes', async () => {
  const parent = parse(SONG_MODE)
  const before = renderedNotes(parent, 'arp')
  const res = await composeIntoDoc({ doc: parent, trackId: 'arp', source: 'theory', seed: 4211 })

  assert.deepEqual(res.clipsSnapshotted, ['arp_soft', 'arp_a'], 'both clips the song places the arp under, in song order')
  const after = renderedNotes(res.doc, 'arp')
  assert.notEqual(after, before, 'THE GATE: the notes the engine resolves for arp must differ from the parent\'s')
  for (const section of ['s_intro', 's_drop']) {
    assert.ok(after.split('\n').some((l) => l.startsWith(`${section}:`) && l.includes('@')), `${section} still plays a non-empty arp clip`)
  }
  // and the other track is untouched — a compose is a one-track edit
  assert.equal(renderedNotes(res.doc, 'bass'), renderedNotes(parent, 'bass'))
})

test('NEGATIVE CONTROL: the same compose with clipSync:false is the UNFIXED behavior — live notes change, the render does not', async () => {
  const parent = parse(SONG_MODE)
  const res = await composeIntoDoc({ doc: parent, trackId: 'arp', source: 'theory', seed: 4211, clipSync: false })

  // the live buffer DID change — which is exactly why "the variant differs from the parent" is not
  // a sufficient assertion, and why the test above resolves through the clips instead
  const liveBefore = parent.tracks.find((t) => t.id === 'arp')!
  const liveAfter = res.doc.tracks.find((t) => t.id === 'arp')!
  assert.notEqual(
    liveAfter.kind === 'synth' ? liveAfter.notes.length : 0,
    liveBefore.kind === 'synth' ? liveBefore.notes.length : -1,
    'the live note buffer was rewritten',
  )
  assert.notEqual(serialize(res.doc), SONG_MODE, 'and the FILE differs — the misleading signal that cost two board renders')

  // ...while what the engine plays is byte-identical. This is the bug, pinned.
  assert.equal(renderedNotes(res.doc, 'arp'), renderedNotes(parent, 'arp'), 'clips untouched => the render is identical to the parent')
  assert.deepEqual(res.clipsSnapshotted, [])
  assert.ok(
    res.lines.some((l) => l.startsWith('WARNING:') && l.includes('render')),
    'and it says so loudly rather than failing silently',
  )
})

test('song mode: a --count batch produces variants that DIFFER FROM THE PARENT AND FROM EACH OTHER at the clip level', async () => {
  const { file } = scratch('song.beat', SONG_MODE)
  const out = beat(['compose', file, 'arp', '--count', '5', '--seed', '777'])
  const dir = defaultComposeBatchDir(file, 'theory', 'arp', 777)
  assert.ok(out.includes('5 composed variants'), out)

  const parentRendered = renderedNotes(readDoc(file), 'arp')
  const seen = new Map<string, string>()
  for (let i = 1; i <= 5; i++) {
    const variant = join(dir, `v${i}.beat`)
    assert.ok(existsSync(variant), `${variant} written`)
    const rendered = renderedNotes(readDoc(variant), 'arp')
    assert.notEqual(rendered, parentRendered, `v${i} must not render identically to the parent (the 2026-07-27 bug)`)
    assert.equal(seen.get(rendered), undefined, `v${i} duplicates ${seen.get(rendered)} — an option board of identical options is not a board`)
    seen.set(rendered, `v${i}`)
  }
  // the parent is never touched by a batch
  assert.equal(readFileSync(file, 'utf8'), SONG_MODE)
})

test('loop mode: no clips to re-snapshot, and the live notes ARE the render', async () => {
  const parent = parse(LOOP_MODE)
  const res = await composeIntoDoc({ doc: parent, trackId: 'arp', source: 'theory', seed: 99 })
  assert.deepEqual(res.clipsSnapshotted, [])
  assert.deepEqual(placedClipIds(parent, 'arp'), [])
  assert.notEqual(renderedNotes(res.doc, 'arp'), renderedNotes(parent, 'arp'))
  assert.ok(!res.lines.some((l) => l.startsWith('WARNING')), 'and no song-mode warning where there is no song')
})

test('--clip narrows the re-snapshot to one rendition, leaving the other alone', async () => {
  const parent = parse(SONG_MODE)
  const res = await composeIntoDoc({ doc: parent, trackId: 'arp', source: 'theory', seed: 4211, clips: ['arp_a'] })
  assert.deepEqual(res.clipsSnapshotted, ['arp_a'])
  const after = renderedNotes(res.doc, 'arp').split('\n')
  const before = renderedNotes(parent, 'arp').split('\n')
  assert.equal(after[0], before[0], 's_intro still plays the untouched arp_soft rendition')
  assert.notEqual(after[1], before[1], 's_drop plays the new figure')
})

test('an unknown clip id is refused by name, not silently ignored', async () => {
  await assert.rejects(
    () => composeIntoDoc({ doc: parse(SONG_MODE), trackId: 'arp', source: 'theory', seed: 1, clips: ['nope'] }),
    (err: Error) => err instanceof BeatBatchError && /no clip "nope"/.test(err.message) && /arp_a, arp_soft/.test(err.message),
  )
})

// ---- key ------------------------------------------------------------------------------------------

test('key: explicit > declared scale > histogram, and the winning source is always reported', () => {
  const doc = parse(SONG_MODE)
  const inferred = resolveComposeKey(doc, 'arp', {})
  assert.equal(keyLabel(inferred.key), 'D# natural-minor', 'the fixture is D# minor, same as the real song')
  assert.match(inferred.source, /histogram/)

  const declared = parse(SONG_MODE.replace('track arp ARP #61afef synth\n', 'track arp ARP #61afef synth\n  scale 5 dorian\n'))
  const fromScale = resolveComposeKey(declared, 'arp', {})
  assert.equal(keyLabel(fromScale.key), 'F dorian', 'a declared scale is an authored statement and beats the histogram')
  assert.match(fromScale.source, /declared scale/)

  const explicit = resolveComposeKey(declared, 'arp', { keyRoot: parseKeyRoot('a'), mode: parseComposeMode('minor') })
  assert.equal(keyLabel(explicit.key), 'A natural-minor')
  assert.match(explicit.source, /--key/)
})

test('key roots parse the way the rest of the CLI spells notes', () => {
  assert.equal(parseKeyRoot('d#'), 3)
  assert.equal(parseKeyRoot('Eb'), 3)
  assert.equal(parseKeyRoot('C'), 0)
  assert.equal(parseKeyRoot('f#3'), 6, 'octave digits are ignored — a key is a pitch class')
  assert.equal(parseKeyRoot('3'), 3, 'and a bare pitch class works like analyze-structure --root')
  assert.throws(() => parseKeyRoot('h'), BeatBatchError)
  assert.throws(() => parseKeyRoot('12'), BeatBatchError)
  assert.equal(parseComposeMode('minor'), 'natural-minor')
  assert.throws(() => parseComposeMode('lydian'), BeatBatchError)
})

test('the composed figure is diatonic in the resolved key', async () => {
  const res = await composeIntoDoc({ doc: parse(SONG_MODE), trackId: 'arp', source: 'theory', seed: 4211 })
  assert.ok(res.lint.scaleConsistency >= 0.95, `figure should sit in the key, got ${res.lint.scaleConsistency}`)
})

// ---- register -------------------------------------------------------------------------------------

test('register: the figure is moved by WHOLE OCTAVES onto the target track\'s own range', async () => {
  const parent = parse(SONG_MODE)
  const auto = await composeIntoDoc({ doc: parent, trackId: 'arp', source: 'theory', seed: 4211 })
  const source = await composeIntoDoc({ doc: parent, trackId: 'arp', source: 'theory', seed: 4211, register: 'source' })
  const notesOf = (d: BeatDocument): number[] => {
    const t = d.tracks.find((x) => x.id === 'arp')!
    return t.kind === 'synth' ? t.notes.map((n) => n.pitch) : []
  }
  const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
  const target = med([63, 66, 70, 75])
  assert.ok(Math.abs(med(notesOf(auto.doc)) - target) <= 6, `auto lands near the track's own register (${med(notesOf(auto.doc))} vs ${target})`)
  assert.equal(auto.octaveShift, -1, 'and this fixture needs exactly one octave down')
  assert.equal(source.octaveShift, 0)
  // whole octaves only: every pitch moved by the same multiple of 12
  const deltas = new Set(notesOf(auto.doc).map((p, i) => p - notesOf(source.doc)[i]!))
  assert.deepEqual([...deltas], [-12])
})

test('octaveShiftFor: no target material is not a licence to guess, and it never pushes out of MIDI range', () => {
  assert.equal(octaveShiftFor([{ pitch: 72, start: 0, duration: 1, velocity: 0.8 }], []), 0)
  assert.equal(octaveShiftFor([], [60]), 0)
  assert.equal(octaveShiftFor([{ pitch: 120, start: 0, duration: 1, velocity: 0.8 }], [126]), 0, 'a +1 octave shift would exceed 127')
})

test('register: an explicit ±N octave shift wins over the match', async () => {
  const res = await composeIntoDoc({ doc: parse(SONG_MODE), trackId: 'arp', source: 'theory', seed: 4211, register: 2 })
  assert.equal(res.octaveShift, 2)
})

// ---- role, append, refusals -------------------------------------------------------------------------

test('role is inferred from what the track is CALLED, and stated with --role', () => {
  const doc = parse(SONG_MODE)
  assert.equal(inferComposeRole(doc.tracks.find((t) => t.id === 'bass')!).role, 'bassline')
  assert.equal(inferComposeRole(doc.tracks.find((t) => t.id === 'arp')!).role, 'lead')
})

test('--append keeps the track\'s existing notes; the default replaces them', async () => {
  const parent = parse(SONG_MODE)
  const replaced = await composeIntoDoc({ doc: parent, trackId: 'arp', source: 'theory', seed: 4211 })
  const appended = await composeIntoDoc({ doc: parent, trackId: 'arp', source: 'theory', seed: 4211, append: true })
  const count = (d: BeatDocument): number => {
    const t = d.tracks.find((x) => x.id === 'arp')!
    return t.kind === 'synth' ? t.notes.length : 0
  }
  assert.equal(count(appended.doc), count(replaced.doc) + 4, 'the four original notes survive alongside the figure')
  const ids = (d: BeatDocument): string[] => {
    const t = d.tracks.find((x) => x.id === 'arp')!
    return t.kind === 'synth' ? t.notes.map((n) => n.id) : []
  }
  assert.ok(ids(appended.doc).includes('a1'), 'and keep their ids')
  assert.equal(new Set(ids(appended.doc)).size, ids(appended.doc).length, 'no id collisions with the appended figure')
})

test('compose refuses a non-synth track by name, pointing at the drum verbs', () => {
  const { file } = scratch('d.beat', `format_version 0.11\nbpm 120\nloop_bars 4\nselected_track kit\n\ntrack kit KIT #e06c75 drums\n  hit h1 kick 0 0.9\n`)
  const out = beat(['compose', file, 'kit'], { expectExit: 2 })
  assert.match(out, /drums track/)
  assert.match(out, /gen-kit|drum-kit/)
})

test('compose rejects unknown flags rather than silently ignoring them (pilot 109/111\'s rule)', () => {
  const { file } = scratch('song.beat', SONG_MODE)
  const out = beat(['compose', file, 'arp', '--sorce', 'theory'], { expectExit: 2 })
  assert.match(out, /unknown flag "--sorce"/)
})

test('--dry-run previews without writing', () => {
  const { file } = scratch('song.beat', SONG_MODE)
  const out = beat(['compose', file, 'arp', '--seed', '4211', '--dry-run'])
  assert.match(out, /not written/)
  assert.equal(readFileSync(file, 'utf8'), SONG_MODE)
})

// ---- the batch contract ------------------------------------------------------------------------------

test('a compose batch is a REAL vary-batch: the manifest fields board/adopt/render read are all there', async () => {
  const { file } = scratch('song.beat', SONG_MODE)
  const res = await composeBatch({
    doc: parse(SONG_MODE),
    parentPath: file,
    parentText: SONG_MODE,
    trackId: 'arp',
    source: 'theory',
    seed: 4242,
    count: 4,
  })
  const manifest = JSON.parse(readFileSync(join(res.outDir, 'manifest.json'), 'utf8')) as Record<string, unknown>
  assert.equal(manifest.parent, file)
  assert.equal(typeof manifest.parentSha256, 'string')
  assert.equal((manifest.parentSha256 as string).length, 64, 'adopt refuses without a real parent hash')
  assert.equal(manifest.track, 'arp')
  assert.equal(manifest.group, 'compose:theory')
  assert.equal(manifest.figureSource, 'theory')
  assert.equal(manifest.seed, 4242)
  assert.equal(manifest.count, 4)
  const variants = manifest.variants as { file: string; recipe: string }[]
  assert.equal(variants.length, 4)
  for (let i = 0; i < 4; i++) {
    assert.equal(variants[i]!.file, `v${i + 1}.beat`, 'the file field board/adopt/render all resolve through')
    assert.ok(existsSync(join(res.outDir, `v${i + 1}.beat`)), 'and the file it names exists')
    assert.match(variants[i]!.recipe, /^compose theory theory:/, 'a replayable, human-readable recipe line')
  }
})

test('a batch sweeps the archetype bank rather than emitting one figure kind N times', async () => {
  const res = await composeBatch({
    doc: parse(SONG_MODE),
    parentPath: 'song.beat',
    parentText: SONG_MODE,
    trackId: 'arp',
    source: 'theory',
    seed: 31,
    count: 4,
    outDir: join(mkdtempSync(join(tmpdir(), 'beat-compose-batch-')), 'b'),
  })
  const archetypes = res.variants.map((v) => /theory:([a-z-]+)/.exec(v.recipe)![1]!)
  assert.equal(new Set(archetypes).size, 4, `all four lead archetypes, got ${archetypes.join(', ')}`)
})

test('--count is range-checked', async () => {
  await assert.rejects(
    () => composeBatch({ doc: parse(SONG_MODE), parentPath: 'x.beat', parentText: SONG_MODE, trackId: 'arp', source: 'theory', seed: 1, count: 0 }),
    (err: Error) => err instanceof BeatBatchError && /1-32/.test(err.message),
  )
})

// ---- CA2, against the stub interpreter --------------------------------------------------------------

function writeStub(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'beat-compose-ca2-stub-'))
  const path = join(dir, 'stub-python')
  writeFileSync(path, `#!/usr/bin/env node
let raw = ''
process.stdin.on('data', (d) => { raw += d })
process.stdin.on('end', () => {
  const req = raw.trim() === '' ? {} : JSON.parse(raw)
  const reply = (notes) => {
    process.stdout.write(JSON.stringify({ backend: 'ca2', contract: ${CA2_CONTRACT_VERSION}, model: 'stub',
      device: 'cpu', role: req.role, seed: req.seed, bars: req.bars, generatedNotes: notes.length,
      wallSeconds: 0.01, notes }))
    process.exit(0)
  }
  const note = (start, pitch, duration = 2, velocity = 0.8) => ({ start, pitch, duration, velocity })
${body}
})
`)
  chmodSync(path, 0o755)
  return path
}

/** Chord roots on every beat, seed-dependent so two seeds give two different figures. */
const CLEAN_STUB = `
  const notes = []
  for (let bar = 0; bar < req.bars; bar++) {
    const chord = req.chordTrack.filter((c) => c.bar <= bar).pop() ?? req.chordTrack[0]
    for (const step of [0, 4, 8, 12]) notes.push(note(bar * 16 + step, chord.tones[(req.seed + bar + step) % chord.tones.length]))
  }
  reply(notes)
`

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

test('--source ca2 composes through the real sidecar contract (stub interpreter) and re-snapshots clips the same way', async () => {
  const parent = parse(SONG_MODE)
  const res = await withStub(CLEAN_STUB, () => composeIntoDoc({ doc: parent, trackId: 'arp', source: 'ca2', seed: 5, role: 'lead' }))
  assert.match(res.label, /^ca2:/)
  assert.deepEqual(res.clipsSnapshotted, ['arp_soft', 'arp_a'])
  assert.notEqual(renderedNotes(res.doc, 'arp'), renderedNotes(parent, 'arp'))
})

test('--source ca2 --archetype pins the density ask, and an unknown one is refused with the bank', async () => {
  const pinned = await withStub(CLEAN_STUB, () => composeIntoDoc({ doc: parse(SONG_MODE), trackId: 'arp', source: 'ca2', seed: 5, role: 'lead', archetype: 'long-tones' }))
  assert.equal(pinned.label, 'ca2:long-tones')
  await assert.rejects(
    () => withStub(CLEAN_STUB, () => composeIntoDoc({ doc: parse(SONG_MODE), trackId: 'arp', source: 'ca2', seed: 5, role: 'lead', archetype: 'nope' })),
    (err: Error) => /unknown lead CA2 ask "nope"/.test(err.message) && /sparse-motif/.test(err.message),
  )
})

test('--source ca2 without an install fails LOUDLY with the doctor pointer, never a substituted theory figure', () => {
  const { file } = scratch('song.beat', SONG_MODE)
  let status: number | undefined
  let output = ''
  try {
    execFileSync(process.execPath, [beatCli, 'compose', file, 'arp', '--source', 'ca2', '--seed', '3'], {
      encoding: 'utf8',
      env: { ...process.env, BEAT_CA2_PYTHON: join(tmpdir(), 'definitely-not-a-python-interpreter') },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    status = e.status
    output = (e.stdout ?? '') + (e.stderr ?? '')
  }
  assert.equal(status, 2, `compose --source ca2 must FAIL without an install, not fall back to a theory figure:\n${output}`)
  assert.match(output, /BEAT_CA2_DIR/, 'the refusal names the env vars')
  assert.match(output, /ca2-doctor/, 'and points at the doctor, which is the thing that actually knows')
  assert.equal(readFileSync(file, 'utf8'), SONG_MODE, 'and the project is untouched')
})

test('--archetype pins a theory archetype, and an unknown one lists the bank', async () => {
  const res = await composeIntoDoc({ doc: parse(SONG_MODE), trackId: 'arp', source: 'theory', seed: 4211, archetype: 'sparse-motif' })
  assert.equal(res.label, 'theory:sparse-motif')
  await assert.rejects(
    () => composeIntoDoc({ doc: parse(SONG_MODE), trackId: 'arp', source: 'theory', seed: 1, archetype: 'not-a-thing' }),
    (err: Error) => err instanceof BeatBatchError && /motif-call-response/.test(err.message),
  )
})

// ---- the one env-gated integration test -------------------------------------------------------------

const realReport = await ca2Doctor()
const hasCA2 = ca2Available(realReport)

test(
  'integration: --source ca2 against the REAL Composer\'s Assistant 2 install',
  { skip: !hasCA2 ? 'no CA2 install (set BEAT_CA2_DIR / BEAT_CA2_PYTHON — see beat showdown --ca2-doctor)' : false },
  async () => {
    const parent = parse(SONG_MODE)
    const res = await composeIntoDoc({ doc: parent, trackId: 'arp', source: 'ca2', seed: 11, role: 'lead' })
    assert.ok(res.notes > 0)
    assert.match(res.label, /^ca2:/)
    assert.notEqual(renderedNotes(res.doc, 'arp'), renderedNotes(parent, 'arp'))
  },
)

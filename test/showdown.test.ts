// Source-showdown eval (docs/source-showdown-eval.md): the pure half of `beat showdown` — the
// document builders (engine solo / keymap phrase / kit phrase), blind batch assembly with
// per-variant source records, duration matching, and the per-source win-rate scoreboard. Audio is
// synthetic (tone wavs built in-memory) and no renders/generation happen here, same posture as
// test/taste.test.ts: the render+gen halves ride paths (renderVaryBatch, source-lib) that have
// their own tests.

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse, serialize, setMediaSample } from '../src/core/index.js'
import { generateSeedBeat } from '../src/taste/seeds.js'
import {
  SHOWDOWN_ROLES,
  showdownRole,
  extendToFourBars,
  soloForShowdown,
  keymapScratchText,
  phraseFromSeed,
  buildPitchedKeymapPhrase,
  buildKitPhrase,
  isolateTrack,
  serializeChecked,
  assignClipOrder,
  writeShowdownBatch,
  matchClipDurations,
  loadShowdownEntries,
  computeShowdownReport,
  formatShowdownReport,
  SHOWDOWN_MUTE_DB,
  SHOWDOWN_PROMINENT_DB,
  inferSeedKey,
  scalePitchClasses,
  composePitchedPhrase,
  composeDrumPhrase,
  applyComposedPhrase,
  applyComposedDrums,
  BASSLINE_ARCHETYPES,
  type PhraseKey,
} from '../src/taste/showdown.js'
import { variantTypeOf } from '../src/taste/eval.js'
import { scoreBatch, adoptVariant, normalizeBatchLoudness, readBatchManifest, BeatBatchError } from '../src/vary/batch.js'

// ---- synthetic audio helper (same shape as test/taste.test.ts) ---------------------------------

function toneWav(freq: number, gain: number, seconds = 0.6, sampleRate = 44100): Buffer {
  const frames = Math.round(seconds * sampleRate)
  const data = Buffer.alloc(frames * 4)
  for (let i = 0; i < frames; i++) {
    const s = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * gain * 32767)
    data.writeInt16LE(s, i * 4)
    data.writeInt16LE(s, i * 4 + 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8, 'ascii')
  h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22)
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36, 'ascii'); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

/** A seed that definitely has an arp track (generateSeedBeat rolls one ~70% of the time). */
function seedWithArp(): ReturnType<typeof parse> {
  for (let s = 1; s < 50; s++) {
    const doc = parse(generateSeedBeat(s).text)
    if (doc.tracks.some((t) => t.id === 'arp')) return doc
  }
  throw new Error('no seed with an arp track in 50 tries — the generator changed')
}

// ---- role specs --------------------------------------------------------------------------------

test('showdown roles: every spec resolves against the prompt bank and the seed-track vocabulary', () => {
  assert.deepEqual(SHOWDOWN_ROLES.map((r) => r.role), ['bassline', 'chords', 'lead', 'drum-loop'])
  for (const r of SHOWDOWN_ROLES) {
    const spec = showdownRole(r.role) // throws if a subject id drifted out of the bank
    assert.equal(spec.role, r.role)
  }
  const seed = parse(generateSeedBeat(1).text)
  for (const r of SHOWDOWN_ROLES) {
    if (r.seedTrack === 'arp') continue // arp is optional per seed; the CLI filters for it
    assert.ok(seed.tracks.some((t) => t.id === r.seedTrack), `seed track ${r.seedTrack} exists`)
  }
  assert.throws(() => showdownRole('vocals'), /unknown showdown role/)
})

// ---- document builders -------------------------------------------------------------------------

test('extendToFourBars: 2-bar seed doubles to 4 bars with shifted copies, and round-trips', () => {
  const doc = parse(generateSeedBeat(3).text)
  assert.equal(doc.loopBars, 2)
  const ext = extendToFourBars(doc)
  assert.equal(ext.loopBars, 4)
  const bass = doc.tracks.find((t) => t.id === 'bass')!
  const extBass = ext.tracks.find((t) => t.id === 'bass')!
  assert.equal(extBass.kind, 'synth')
  assert.equal(bass.kind, 'synth')
  if (bass.kind !== 'synth' || extBass.kind !== 'synth') return
  assert.equal(extBass.notes.length, bass.notes.length * 2)
  // the copies sit exactly one 2-bar loop later
  const originals = extBass.notes.slice(0, bass.notes.length)
  const copies = extBass.notes.slice(bass.notes.length)
  for (let i = 0; i < originals.length; i++) {
    assert.equal(copies[i]!.start, originals[i]!.start + 32)
    assert.equal(copies[i]!.pitch, originals[i]!.pitch)
  }
  const drums = doc.tracks.find((t) => t.id === 'drums')!
  const extDrums = ext.tracks.find((t) => t.id === 'drums')!
  if (drums.kind === 'drums' && extDrums.kind === 'drums') assert.equal(extDrums.hits.length, drums.hits.length * 2)
  parse(serialize(ext)) // a built doc must survive its own format
  // idempotent on an already-4-bar doc
  assert.equal(extendToFourBars(ext), ext)
})

test('soloForShowdown: target boosted to prominent, everything else muted', () => {
  const doc = parse(generateSeedBeat(3).text)
  const solo = soloForShowdown(doc, 'bass')
  for (const t of solo.tracks) {
    if (t.id === 'bass') assert.ok(t.synth.volume >= SHOWDOWN_PROMINENT_DB, `bass at ${t.synth.volume}`)
    else assert.equal(t.synth.volume, SHOWDOWN_MUTE_DB)
  }
  assert.throws(() => soloForShowdown(doc, 'nope'), /no track "nope"/)
})

test('buildPitchedKeymapPhrase: sample lanes over the recentred phrase span, one hit per note, round-trips', () => {
  const seed = extendToFourBars(parse(generateSeedBeat(3).text))
  const phrase = phraseFromSeed(seed, 'bass')
  assert.ok(phrase.length >= 2)
  let scratch = parse(keymapScratchText(seed.bpm))
  scratch = setMediaSample(scratch, 'sdkm', 'a'.repeat(64), 'media/sdkm.wav')
  const rootMidi = 81 // a5 one-shot vs a ~C2 bass phrase — octave recentring must bridge it
  const { doc, shift, fromMidi, toMidi } = buildPitchedKeymapPhrase(scratch, 'sdkm', rootMidi, phrase)
  assert.equal(shift % 12, 0, 'shift is whole octaves')
  const track = doc.tracks.find((t) => t.id === 'phrase')!
  assert.equal(track.kind, 'drums')
  if (track.kind !== 'drums') return
  // only keymap sample lanes remain (the materialized default kit was dropped), all inside ±24
  assert.ok(track.lanes.length >= 2)
  for (const lane of track.lanes) {
    assert.equal(lane.backing.type, 'sample')
    if (lane.backing.type === 'sample') {
      assert.equal(lane.backing.sample, 'sdkm')
      assert.ok(Math.abs(lane.backing.tune) <= 24, `${lane.name} tune ${lane.backing.tune}`)
    }
  }
  assert.equal(track.hits.length, phrase.length)
  // every hit lands on a declared lane inside the span
  const laneNames = new Set(track.lanes.map((l) => l.name))
  for (const h of track.hits) assert.ok(laneNames.has(h.lane), `hit lane ${h.lane} declared`)
  assert.ok(toMidi - fromMidi <= 48)
  serializeChecked(doc)
})

test('buildKitPhrase + isolateTrack: the seed drum pattern re-backed by sample lanes, round-trips', () => {
  const seed = extendToFourBars(parse(generateSeedBeat(3).text))
  let drumsOnly = isolateTrack(seed, 'drums')
  assert.equal(drumsOnly.tracks.length, 1)
  assert.equal(drumsOnly.selectedTrack, 'drums')
  for (const lane of ['kick', 'snare', 'hat']) {
    drumsOnly = setMediaSample(drumsOnly, `sd${lane}`, 'b'.repeat(64), `media/sd${lane}.wav`)
  }
  const doc = buildKitPhrase(drumsOnly, 'drums', { kick: 'sdkick', snare: 'sdsnare', hat: 'sdhat' })
  const track = doc.tracks.find((t) => t.id === 'drums')!
  assert.equal(track.kind, 'drums')
  if (track.kind !== 'drums') return
  const byName = new Map(track.lanes.map((l) => [l.name, l]))
  for (const lane of ['kick', 'snare', 'hat']) {
    const decl = byName.get(lane)!
    assert.equal(decl.backing.type, 'sample')
    if (decl.backing.type === 'sample') assert.equal(decl.backing.sample, `sd${lane}`)
  }
  // the pattern itself is untouched
  const before = drumsOnly.tracks[0]!
  if (before.kind === 'drums' && track.kind === 'drums') assert.equal(track.hits.length, before.hits.length)
  serializeChecked(doc)
})

// ---- composed phrase bank (the 2026-07-21 un-blinding fix) -------------------------------------

const COMPOSE_KEYS: PhraseKey[] = [
  { root: 48, minor: false },
  { root: 53, minor: true },
  { root: 57, minor: true },
  { root: 50, minor: false },
]

const inScalePc = (key: PhraseKey): Set<number> => new Set(scalePitchClasses(key).map((pc) => (pc + key.root) % 12))

test('inferSeedKey: deterministic, in the seed-generator range, and actually covers the seed notes', () => {
  for (let s = 1; s <= 20; s++) {
    const doc = parse(generateSeedBeat(s).text)
    const key = inferSeedKey(doc)
    assert.deepEqual(inferSeedKey(doc), key)
    assert.ok(key.root >= 48 && key.root < 60, `root ${key.root} in the generator's 48..59 range`)
    const pcs = inScalePc(key)
    let inScale = 0
    let total = 0
    for (const t of doc.tracks) {
      if (t.kind !== 'synth') continue
      for (const n of t.notes) {
        total += 1
        if (pcs.has(((n.pitch % 12) + 12) % 12)) inScale += 1
      }
    }
    assert.ok(inScale / total >= 0.8, `seed ${s}: ${inScale}/${total} notes in the inferred scale`)
  }
})

test('composePitchedPhrase: deterministic per seed, every note diatonic and inside the 4-bar loop', () => {
  for (const role of ['bassline', 'chords', 'lead'] as const) {
    for (const key of COMPOSE_KEYS) {
      const pcs = inScalePc(key)
      for (let seed = 1; seed <= 8; seed++) {
        const a = composePitchedPhrase(role, key, seed * 331)
        assert.deepEqual(composePitchedPhrase(role, key, seed * 331), a, `${role} seed ${seed} deterministic`)
        assert.ok(a.notes.length > 0)
        for (const n of a.notes) {
          assert.ok(pcs.has(((n.pitch % 12) + 12) % 12), `${role}/${a.archetype}: pitch ${n.pitch} in ${key.minor ? 'minor' : 'major'} on root ${key.root}`)
          assert.ok(n.pitch >= 0 && n.pitch <= 127)
          assert.ok(n.start >= 0 && n.start < 64, `start ${n.start} inside the 4-bar loop`)
          assert.ok(n.duration > 0 && n.velocity > 0 && n.velocity <= 1)
        }
      }
    }
  }
})

test('composePitchedPhrase: different batch seeds produce genuinely different figures (the un-blinding fix)', () => {
  const key: PhraseKey = { root: 48, minor: true }
  for (const role of ['bassline', 'chords', 'lead'] as const) {
    const signatures = new Set<string>()
    const archetypes = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      const p = composePitchedPhrase(role, key, seed * 977)
      archetypes.add(p.archetype)
      signatures.add(p.notes.map((n) => `${n.pitch}@${n.start}:${n.duration}`).join(' '))
    }
    assert.equal(signatures.size, 12, `${role}: 12 seeds -> 12 distinct note sequences`)
    assert.ok(archetypes.size >= 3, `${role}: the archetype bank actually varies (got ${[...archetypes].join(', ')})`)
  }
})

test('composePitchedPhrase: exclude steers the archetype so no two batches in a session share a figure', () => {
  const key: PhraseKey = { root: 50, minor: false }
  const used: string[] = []
  for (let seed = 1; seed <= BASSLINE_ARCHETYPES.length; seed++) {
    const p = composePitchedPhrase('bassline', key, seed, { exclude: used })
    assert.ok(!used.includes(p.archetype), `${p.archetype} not reused while the bank still has unused figures`)
    used.push(p.archetype)
  }
  assert.equal(new Set(used).size, BASSLINE_ARCHETYPES.length, 'a full session walks the whole bank')
})

test('composeDrumPhrase: deterministic, diverse across seeds, kit lanes only, inside the loop', () => {
  const signatures = new Set<string>()
  const archetypes = new Set<string>()
  for (let seed = 1; seed <= 12; seed++) {
    const a = composeDrumPhrase(seed * 613)
    assert.deepEqual(composeDrumPhrase(seed * 613), a)
    archetypes.add(a.archetype)
    signatures.add(a.hits.map((h) => `${h.lane}@${h.start}`).join(' '))
    for (const h of a.hits) {
      assert.ok(['kick', 'snare', 'hat'].includes(h.lane), `lane ${h.lane} is a kit lane`)
      assert.ok(h.start >= 0 && h.start < 64 && h.velocity > 0 && h.velocity <= 1)
    }
  }
  assert.ok(signatures.size >= 11, `12 seeds -> ${signatures.size} distinct grooves`)
  assert.ok(archetypes.size >= 3, `drum archetype bank actually varies (got ${[...archetypes].join(', ')})`)
})

test('engine and keymap clips share the composed figure within one batch (the comparison holds notes constant)', () => {
  const seed = extendToFourBars(parse(generateSeedBeat(3).text))
  const composed = composePitchedPhrase('bassline', inferSeedKey(seed), 4242)
  const phrased = applyComposedPhrase(seed, 'bass', composed)
  const plain = composed.notes.map((n) => ({ pitch: n.pitch, start: n.start, velocity: n.velocity }))
  // the engine doc plays exactly the composed notes...
  const engineTrack = soloForShowdown(phrased, 'bass').tracks.find((t) => t.id === 'bass')!
  assert.equal(engineTrack.kind, 'synth')
  if (engineTrack.kind !== 'synth') return
  assert.deepEqual(engineTrack.notes.map((n) => ({ pitch: n.pitch, start: n.start, velocity: n.velocity })), plain)
  // ...and the keymap phrase reads the SAME notes back off the same doc (the CLI's construction)
  const phrase = phraseFromSeed(phrased, 'bass')
  assert.deepEqual(phrase, plain)
  // the built keymap clip carries one hit per composed note, and the phrased doc round-trips
  let scratch = parse(keymapScratchText(seed.bpm))
  scratch = setMediaSample(scratch, 'sdkm', 'a'.repeat(64), 'media/sdkm.wav')
  const { doc } = buildPitchedKeymapPhrase(scratch, 'sdkm', 45, phrase)
  const km = doc.tracks.find((t) => t.id === 'phrase')!
  if (km.kind === 'drums') assert.equal(km.hits.length, composed.notes.length)
  serializeChecked(phrased)
  assert.throws(() => applyComposedPhrase(seed, 'drums', composed), /needs synth track/)
})

test('applyComposedDrums: engine and kit clips share the composed groove, and the doc round-trips', () => {
  const seed = extendToFourBars(parse(generateSeedBeat(3).text))
  const groove = composeDrumPhrase(777)
  const phrased = applyComposedDrums(seed, 'drums', groove)
  let drumsOnly = isolateTrack(phrased, 'drums')
  for (const lane of ['kick', 'snare', 'hat']) drumsOnly = setMediaSample(drumsOnly, `sd${lane}`, 'b'.repeat(64), `media/sd${lane}.wav`)
  const kit = buildKitPhrase(drumsOnly, 'drums', { kick: 'sdkick', snare: 'sdsnare', hat: 'sdhat' })
  const kitTrack = kit.tracks.find((t) => t.id === 'drums')!
  const engTrack = phrased.tracks.find((t) => t.id === 'drums')!
  assert.equal(kitTrack.kind, 'drums')
  assert.equal(engTrack.kind, 'drums')
  if (kitTrack.kind !== 'drums' || engTrack.kind !== 'drums') return
  assert.deepEqual(kitTrack.hits.map((h) => `${h.lane}@${h.start}`), engTrack.hits.map((h) => `${h.lane}@${h.start}`))
  assert.equal(engTrack.hits.length, groove.hits.length)
  serializeChecked(phrased)
  assert.throws(() => applyComposedDrums(seed, 'bass', groove), /needs drums track/)
})

// ---- batch assembly ----------------------------------------------------------------------------

test('assignClipOrder: a deterministic permutation, not identity for typical seeds', () => {
  const order = assignClipOrder(4, 1)
  assert.deepEqual([...order].sort(), [0, 1, 2, 3])
  assert.deepEqual(assignClipOrder(4, 1), order)
  assert.notDeepEqual(assignClipOrder(4, 2), order) // different seed, different blind
})

test('writeShowdownBatch: showdown:<role> clip-set manifest with source records; score carries kinds; adopt refuses', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-showdown-batch-'))
  writeFileSync(join(dir, 'v1.wav'), toneWav(220, 0.4))
  writeFileSync(join(dir, 'v2.wav'), toneWav(440, 0.3))
  writeFileSync(join(dir, 'v3.wav'), toneWav(880, 0.2))
  const manifest = writeShowdownBatch(dir, 'bassline', [
    { file: 'v1.wav', source: { kind: 'gen', from: '"a rolling bassline, analog warmth" (stub)' } },
    { file: 'v2.wav', source: { kind: 'engine', from: 'seed-003.beat bass solo' } },
    { file: 'v3.wav', source: { kind: 'keymap', from: 'keymap of "a deep bass stab"' } },
  ], { seed: 7 })
  assert.equal(manifest.group, 'showdown:bassline')
  assert.equal(manifest.parent, '')
  assert.equal(variantTypeOf(manifest), 'showdown', 'eval splits classify showdown batches as their own type')
  assert.ok(!existsSync(join(dir, '.gitignore')), 'no ref clip -> no gitignore')

  const result = scoreBatch(dir, ['2', '1'])
  assert.deepEqual(result.entry.sources, { 'v1.wav': 'gen', 'v2.wav': 'engine', 'v3.wav': 'keymap' })
  assert.equal(result.entry.group, 'showdown:bassline')
  // the entry never carries the `from` provenance — kinds only (ref privacy contract)
  assert.ok(!JSON.stringify(result.entry).includes('seed-003'), 'source provenance stays out of the log entry')
  assert.throws(() => adoptVariant(dir, '2'), /clip-set batch/)
})

test('writeShowdownBatch: a ref clip gates the whole batch dir behind .gitignore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-showdown-ref-'))
  writeFileSync(join(dir, 'v1.wav'), toneWav(220, 0.4))
  writeFileSync(join(dir, 'v2.wav'), toneWav(440, 0.3))
  writeShowdownBatch(dir, 'chords', [
    { file: 'v1.wav', source: { kind: 'engine', from: 'seed-001.beat chords solo' } },
    { file: 'v2.wav', source: { kind: 'ref', from: '/private/chops/song.wav' } },
  ])
  const gitignore = readFileSync(join(dir, '.gitignore'), 'utf8')
  assert.ok(gitignore.includes('*'), 'everything in a ref-bearing batch dir is ignored')
  assert.throws(
    () => writeShowdownBatch(dir, 'chords', [{ file: 'v9.wav', source: { kind: 'engine' } }, { file: 'v1.wav', source: { kind: 'gen' } }]),
    /missing/,
  )
})

test('normalizeBatchLoudness on a showdown batch preserves the source records', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-showdown-norm-'))
  writeFileSync(join(dir, 'v1.wav'), toneWav(220, 0.1, 1))
  writeFileSync(join(dir, 'v2.wav'), toneWav(440, 0.4, 1))
  writeShowdownBatch(dir, 'lead', [
    { file: 'v1.wav', source: { kind: 'engine', from: 'seed-002.beat arp solo' } },
    { file: 'v2.wav', source: { kind: 'gen', from: '"a melodic synth lead phrase" (stub)' } },
  ])
  const r = normalizeBatchLoudness(dir, 2)
  assert.ok(r && r.normalized)
  const manifest = readBatchManifest(dir)
  assert.equal(manifest.variants[0]!.source?.kind, 'engine')
  assert.equal(manifest.variants[1]!.source?.kind, 'gen')
  assert.ok(manifest.variants[0]!.loudness !== undefined, 'loudness recorded next to source')
})

// ---- duration matching -------------------------------------------------------------------------

test('matchClipDurations: trims to the shortest clip with a fade, pads up to an explicit target', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-showdown-dur-'))
  writeFileSync(join(dir, 'v1.wav'), toneWav(220, 0.4, 2.0))
  writeFileSync(join(dir, 'v2.wav'), toneWav(440, 0.4, 1.0))
  writeFileSync(join(dir, 'v3.wav'), toneWav(880, 0.4, 1.5, 22050)) // different sample rate is fine
  const r = matchClipDurations(dir, ['v1.wav', 'v2.wav', 'v3.wav'])
  assert.equal(r.targetSeconds, 1)
  assert.deepEqual(r.clips.map((c) => c.action), ['trimmed', 'kept', 'trimmed'])
  // every file now holds ~1s of frames at its own rate
  for (const [file, rate] of [['v1.wav', 44100], ['v2.wav', 44100], ['v3.wav', 22050]] as const) {
    const bytes = readFileSync(join(dir, file))
    const dataLen = bytes.readUInt32LE(40)
    assert.equal(dataLen, Math.round(1 * rate) * 4, `${file} trimmed to 1s`)
  }
  // the trim faded: the final sample of a trimmed file is ~silent (a raw cut of a 0.4 sine is not)
  const v1 = readFileSync(join(dir, 'v1.wav'))
  const lastFrameOff = 44 + v1.readUInt32LE(40) - 4
  assert.ok(Math.abs(v1.readInt16LE(lastFrameOff)) < 300, 'fade-out applied at the cut')

  // explicit target above the longest clip pads with silence
  const r2 = matchClipDurations(dir, ['v2.wav'], { targetSeconds: 1.5 })
  assert.equal(r2.clips[0]!.action, 'padded')
  const v2 = readFileSync(join(dir, 'v2.wav'))
  assert.equal(v2.readUInt32LE(40), Math.round(1.5 * 44100) * 4)
})

// ---- reporting ---------------------------------------------------------------------------------

function showdownEntry(batch: string, role: string, ranked: string[], all: Record<string, string>): string {
  const picks = ranked.map((v, i) => ({ rank: i + 1, variant: v }))
  const rejected = Object.keys(all).filter((f) => !ranked.includes(f))
  return JSON.stringify({ t: new Date().toISOString(), batch, group: `showdown:${role}`, seed: 1, parentSha256: '', picks, rejected, sources: all })
}

test('computeShowdownReport: wins / top-half / pairwise per source, per role and overall, smoke labels', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-showdown-report-'))
  const log = join(dir, 'beat-scores.jsonl')
  const sources = { 'v1.wav': 'gen', 'v2.wav': 'engine', 'v3.wav': 'keymap' }
  const lines = [
    // 2 bassline batches: gen wins both, full ranking then partial ranking
    showdownEntry('/b/1', 'bassline', ['v1.wav', 'v2.wav', 'v3.wav'], sources),
    showdownEntry('/b/2', 'bassline', ['v1.wav'], sources),
    // 1 chords batch: engine wins
    showdownEntry('/b/3', 'chords', ['v2.wav', 'v1.wav'], sources),
    // non-showdown entries are ignored
    JSON.stringify({ t: 't', batch: '/b/vary', group: 'filter', track: 'bass', seed: 2, parentSha256: '', picks: [{ rank: 1, variant: 'v1.beat' }], rejected: [] }),
    // a showdown-group entry with no sources map is counted as skipped, not crashed on
    JSON.stringify({ t: 't', batch: '/b/old', group: 'showdown:lead', seed: 3, parentSha256: '', picks: [{ rank: 1, variant: 'v1.wav' }], rejected: ['v2.wav'] }),
  ]
  writeFileSync(log, lines.join('\n') + '\n')

  const { entries, skipped } = loadShowdownEntries(log)
  assert.equal(entries.length, 3)
  assert.equal(skipped, 1)

  const report = computeShowdownReport(log)
  assert.equal(report.totalBatches, 3)
  const overall = Object.fromEntries(report.overall.map((s) => [s.kind, s]))
  assert.equal(overall.gen!.wins, 2)
  assert.equal(overall.engine!.wins, 1)
  assert.equal(overall.keymap!.wins, 0)
  assert.equal(overall.gen!.batches, 3)
  // top-half = top ceil(3/2)=2 ranked picks: batch1 gen+engine, batch2 gen, batch3 engine+gen
  assert.equal(overall.gen!.topHalf, 3)
  assert.equal(overall.engine!.topHalf, 2)
  assert.equal(overall.keymap!.topHalf, 0)
  // pairwise: batch1 gen beats engine+keymap, engine beats keymap; batch2 gen beats both;
  // batch3 engine beats gen+keymap, gen beats keymap
  assert.equal(overall.gen!.pairsWon, 5)
  assert.equal(overall.gen!.pairCount, 6)
  assert.equal(overall.engine!.pairsWon, 3)
  assert.equal(overall.keymap!.pairsWon, 0)
  // roles split with smoke labels (both under the 5-batch floor)
  assert.deepEqual(report.roles.map((r) => r.role), ['bassline', 'chords'])
  assert.ok(report.roles.every((r) => r.smoke))
  const bassline = report.roles[0]!
  assert.equal(Object.fromEntries(bassline.stats.map((s) => [s.kind, s.wins])).gen, 2)

  const text = formatShowdownReport(report)
  assert.ok(text.includes('3 scored showdown batch(es)'))
  assert.ok(text.includes('[small n — smoke, not evidence]'))
  assert.ok(text.includes('1 showdown-group entry skipped'))
  assert.ok(text.match(/gen\s+win 67% \(2\/3\)/), `overall gen line present:\n${text}`)
})

test('computeShowdownReport: a re-score supersedes the earlier entry for the same batch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-showdown-rescore-'))
  const log = join(dir, 'beat-scores.jsonl')
  const sources = { 'v1.wav': 'gen', 'v2.wav': 'engine' }
  writeFileSync(log, [
    showdownEntry('/b/1', 'bassline', ['v1.wav', 'v2.wav'], sources),
    showdownEntry('/b/1', 'bassline', ['v2.wav', 'v1.wav'], sources), // changed my mind: engine wins
  ].join('\n') + '\n')
  const report = computeShowdownReport(log)
  assert.equal(report.totalBatches, 1)
  const overall = Object.fromEntries(report.overall.map((s) => [s.kind, s]))
  assert.equal(overall.engine!.wins, 1)
  assert.equal(overall.gen!.wins, 0)
})

test('formatShowdownReport: empty log points at the collect->rate loop', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-showdown-empty-'))
  const log = join(dir, 'beat-scores.jsonl')
  writeFileSync(log, '')
  const text = formatShowdownReport(computeShowdownReport(log))
  assert.ok(text.includes('nothing scored yet'))
})

// ---- rate-UI integration guarantee -------------------------------------------------------------

test('a showdown batch dir looks exactly like any other rateable batch (manifest + all wavs present)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-showdown-rate-'))
  const batch = join(dir, 'showdown-lead-99')
  mkdirSync(batch)
  writeFileSync(join(batch, 'v1.wav'), toneWav(300, 0.3))
  writeFileSync(join(batch, 'v2.wav'), toneWav(600, 0.3))
  writeShowdownBatch(batch, 'lead', [
    { file: 'v1.wav', source: { kind: 'engine' } },
    { file: 'v2.wav', source: { kind: 'gen' } },
  ], { seed: 99 })
  // the exact predicate cli/rate.mjs findBatches applies
  const manifest = readBatchManifest(batch)
  const wavs = manifest.variants.map((v) => v.file.replace(/\.beat$/, '.wav'))
  assert.ok(wavs.length >= 2 && wavs.every((w) => existsSync(join(batch, w))))
  // and its label surface (track ?? '' + group) carries no per-clip source hint
  assert.equal(manifest.track, undefined)
  assert.equal(manifest.group, 'showdown:lead')
})

// Production-task eval (docs/research/119 §T-C, docs/prodtask.md): the PURE half of `beat prodtask
// transform` — the per-role trick stacks, the tricked arm through the real applyTrick path, the
// magnitude-matched random-edit control, blind clip-set batch assembly with per-arm source records,
// and the per-arm scoreboard. Audio is synthetic (tone wavs) and no renders happen here — the
// render half rides renderVaryBatch (its own tests) and the owner-side real round, same posture as
// test/showdown.test.ts.

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse } from '../src/core/index.js'
import { parseMacroLibrary } from '../src/core/index.js'
import { parseTrickLibrary } from '../src/analysis/trick.js'
import { generateSeedBeat } from '../src/taste/seeds.js'
import {
  extendToFourBars,
  soloForShowdown,
  composePitchedPhrase,
  composeDrumPhrase,
  applyComposedPhrase,
  applyComposedDrums,
  inferSeedKey,
  assignClipOrder,
} from '../src/taste/showdown.js'
import {
  PRODTASK_ROLES,
  PRODTASK_TRICK_STACKS,
  prodtaskRole,
  resolveTrickStack,
  applyTrickStack,
  randomEditControl,
  randomEditCandidates,
  writeProdtaskBatch,
  loadProdtaskEntries,
  computeProdtaskReport,
  formatProdtaskReport,
  armMetricMeans,
  type ProdtaskClipSource,
} from '../src/taste/prodtask.js'
import { variantTypeOf } from '../src/taste/eval.js'
import { scoreBatch, adoptVariant, normalizeBatchLoudness, BeatBatchError } from '../src/vary/batch.js'

// ---- synthetic audio (same helper as test/showdown.test.ts) ------------------------------------

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

// ---- the real catalog (parsed once, like the CLI's loadTricks) ---------------------------------

function loadCatalog(): { tricks: ReturnType<typeof parseTrickLibrary>; macros: ReturnType<typeof parseMacroLibrary> } {
  const macros = parseMacroLibrary(readFileSync(new URL('../../presets/macros.json', import.meta.url), 'utf8'))
  const tricks = parseTrickLibrary(readFileSync(new URL('../../presets/tricks.json', import.meta.url), 'utf8'), macros)
  return { tricks, macros }
}

/** The soloed ORIGINAL-arm document for a role, over a generated seed — the same construction the
 * CLI does (compose figure -> apply -> extend -> solo). */
function originalArmDoc(role: string, seedNum = 7): { doc: ReturnType<typeof parse>; seedTrack: string } {
  const spec = prodtaskRole(role)
  const seed = parse(generateSeedBeat(seedNum).text)
  const extended = extendToFourBars(seed)
  if (role === 'drum-loop') {
    const c = composeDrumPhrase(seedNum)
    return { doc: soloForShowdown(applyComposedDrums(extended, spec.seedTrack, c), spec.seedTrack), seedTrack: spec.seedTrack }
  }
  const key = inferSeedKey(seed)
  const c = composePitchedPhrase(role as 'bassline' | 'chords' | 'lead', key, seedNum)
  return { doc: soloForShowdown(applyComposedPhrase(extended, spec.seedTrack, c), spec.seedTrack), seedTrack: spec.seedTrack }
}

// ---- roles & stacks ----------------------------------------------------------------------------

test('prodtask roles: the four transform roles resolve; an unknown role throws with the legal list', () => {
  assert.deepEqual(PRODTASK_ROLES.map((r) => r.role), ['bassline', 'chords', 'lead', 'drum-loop'])
  assert.equal(prodtaskRole('chords').seedTrack, 'chords')
  assert.equal(prodtaskRole('lead').seedTrack, 'arp')
  assert.throws(() => prodtaskRole('vocal'), /unknown prodtask role/)
})

test('every default trick stack resolves against the real catalog and fits its role', () => {
  const { tricks } = loadCatalog()
  for (const role of Object.keys(PRODTASK_TRICK_STACKS)) {
    const stack = resolveTrickStack(role, tricks)
    assert.deepEqual(stack.map((t) => t.name), [...PRODTASK_TRICK_STACKS[role]!], `stack for ${role}`)
    assert.ok(stack.length >= 2, `${role} stack has at least two moves`)
    // the stack must actually apply to a fresh soloed clip for that role (no counter fires, no
    // kind mismatch) — the whole eval depends on the tricked arm building
    const { doc, seedTrack } = originalArmDoc(role, role === 'lead' ? 3 : 7)
    if (!doc.tracks.some((t) => t.id === seedTrack)) continue // seed didn't roll an arp — skip
    const res = applyTrickStack(doc, seedTrack, stack, [])
    assert.ok(res.editCount > 0, `${role} stack made edits`)
  }
})

test('resolveTrickStack: an unknown trick name in an override throws', () => {
  const { tricks } = loadCatalog()
  assert.throws(() => resolveTrickStack('chords', tricks, ['air-shelf', 'no-such-trick']), /unknown trick "no-such-trick"/)
})

// ---- the tricked arm holds notes constant, changes production ----------------------------------

test('applyTrickStack: notes are untouched; production fields change; the receipt is honest', () => {
  const { tricks, macros } = loadCatalog()
  const { doc, seedTrack } = originalArmDoc('chords', 7)
  const before = doc.tracks.find((t) => t.id === seedTrack)!
  assert.equal(before.kind, 'synth')
  const beforeNotes = before.kind === 'synth' ? before.notes.map((n) => `${n.pitch}@${n.start}`) : []

  const stack = resolveTrickStack('chords', tricks)
  const res = applyTrickStack(doc, seedTrack, stack, macros)

  const after = res.doc.tracks.find((t) => t.id === seedTrack)!
  const afterNotes = after.kind === 'synth' ? after.notes.map((n) => `${n.pitch}@${n.start}`) : []
  assert.deepEqual(afterNotes, beforeNotes, 'the tricked arm plays the SAME notes as the original')
  assert.deepEqual(res.tricks, ['unison-spread', 'air-shelf', 'glue-saturation'])
  // the width/glue moves landed as ordinary synth fields
  if (after.kind === 'synth') {
    assert.equal(after.synth.unisonVoices, 5, 'unison-spread set the unison stack')
    assert.ok((after.synth.saturatorMix ?? 0) > 0, 'glue-saturation wired the saturator')
  }
  assert.ok(res.editCount >= 6, `a real stack makes several edits (got ${res.editCount})`)
  assert.ok(res.applied.every((a) => a.includes(':')), 'every receipt line names its trick')
})

// ---- the random-edit control: magnitude parity, determinism, notes untouched -------------------

test('randomEditControl: exactly editCount distinct legal edits, notes untouched, deterministic', () => {
  const { doc, seedTrack } = originalArmDoc('chords', 7)
  const beforeTrack = doc.tracks.find((t) => t.id === seedTrack)!
  const beforeNotes = beforeTrack.kind === 'synth' ? beforeTrack.notes.length : 0
  const candidateCount = randomEditCandidates(seedTrack, 'synth').length
  assert.ok(candidateCount > 20, 'a synth track has a wide random-edit surface')

  const n = 11
  const r1 = randomEditControl(doc, seedTrack, n, 999)
  assert.equal(r1.edits.length, n, 'the control matches the requested edit count exactly')
  const paths = r1.edits.map((e) => e.split(' ')[0])
  assert.equal(new Set(paths).size, n, 'every random edit targets a DISTINCT param')
  assert.ok(!paths.some((p) => p!.endsWith('.volume')), 'volume is excluded (loudness normalization would cancel it)')
  const afterTrack = r1.doc.tracks.find((t) => t.id === seedTrack)!
  assert.equal(afterTrack.kind === 'synth' ? afterTrack.notes.length : -1, beforeNotes, 'the control leaves notes untouched')

  // deterministic under the seed, different under another
  assert.deepEqual(randomEditControl(doc, seedTrack, n, 999).edits, r1.edits, 'same seed -> same edits')
  assert.notDeepEqual(randomEditControl(doc, seedTrack, n, 1000).edits, r1.edits, 'different seed -> different edits')
})

test('randomEditControl: edit count matches the trick stack (the magnitude-parity contract)', () => {
  const { tricks, macros } = loadCatalog()
  const { doc, seedTrack } = originalArmDoc('chords', 7)
  const trickedRes = applyTrickStack(doc, seedTrack, resolveTrickStack('chords', tricks), macros)
  const control = randomEditControl(doc, seedTrack, trickedRes.editCount, 42)
  assert.equal(control.edits.length, trickedRes.editCount, 'the control makes the same number of edits the trick stack made')
})

test('randomEditControl: drums tracks draw from the bus groups only (no legacy voice params)', () => {
  const cands = randomEditCandidates('drums', 'drums')
  const keys = cands.map((c) => c.path.split('.')[1])
  assert.ok(!keys.includes('kickTune'), 'legacy track-wide drum-voice params (inaudible on a declared-lane kit) are excluded')
  assert.ok(keys.includes('sendReverb'), 'the drum bus sends are candidates')
})

// ---- blind batch assembly: arms recorded, shuffled, normalized ---------------------------------

/** Assemble a batch the way the CLI does: build three arm sources, seeded-shuffle them into
 * v-numbers, write the three synthetic renders, then the manifest. Returns the batch dir + the
 * v-number->arm truth. */
function assembleBatch(container: string, role: string, seed: number): { dir: string; truth: Record<string, string> } {
  const dir = join(container, `prodtask-transform-${role}-${seed}`)
  mkdirSync(dir, { recursive: true })
  const arms: { kind: string; source: ProdtaskClipSource }[] = [
    { kind: 'original', source: { kind: 'original', from: `composed figure on seed ${role} solo` } },
    { kind: 'tricked', source: { kind: 'tricked', from: 'same figure + trick stack', tricks: ['unison-spread', 'air-shelf'], edits: ['unison-spread: set unisonVoices 5'] } },
    { kind: 'random', source: { kind: 'random', from: 'same figure + random-edit control', edits: ['drums.cutoff 3200'] } },
  ]
  const order = assignClipOrder(arms.length, seed)
  const truth: Record<string, string> = {}
  const files: { file: string; source: (typeof arms)[number]['source'] }[] = []
  for (let v = 0; v < arms.length; v++) {
    const arm = arms[order[v]!]!
    writeFileSync(join(dir, `v${v + 1}.wav`), toneWav(220 * (v + 1), 0.3 - v * 0.05, 1))
    truth[`v${v + 1}.wav`] = arm.kind
    files.push({ file: `v${v + 1}.wav`, source: arm.source })
  }
  writeProdtaskBatch(dir, role, files, { seed, task: 'transform' })
  return { dir, truth }
}

test('writeProdtaskBatch: prodtask:transform:<role> clip-set manifest; arms + tricks/edits recorded; score carries KINDS; adopt refuses', () => {
  const container = mkdtempSync(join(tmpdir(), 'beat-prodtask-batch-'))
  const { dir, truth } = assembleBatch(container, 'chords', 7)
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  assert.equal(manifest.group, 'prodtask:transform:chords')
  assert.equal(manifest.parent, '', 'empty parent — an ordinary clip-set batch')
  assert.equal(variantTypeOf(manifest), 'prodtask', 'eval splits classify prodtask batches as their own type')
  assert.ok(!existsSync(join(dir, '.gitignore')), 'engine-only arms -> no gitignore gate')
  // arm kinds are a permutation of the three arms; the honest tricks/edits detail is in the manifest
  assert.deepEqual([...new Set(Object.values(truth))].sort(), ['original', 'random', 'tricked'])
  const trickedVariant = manifest.variants.find((v: { source: { kind: string } }) => v.source.kind === 'tricked')
  assert.deepEqual(trickedVariant.source.tricks, ['unison-spread', 'air-shelf'], 'the trick names are recorded honestly')
  assert.ok(Array.isArray(trickedVariant.source.edits), 'the applied edits are recorded honestly')

  const result = scoreBatch(dir, ['1', '2'])
  assert.deepEqual(result.entry.sources, truth, 'the log entry maps each v-file to its ARM kind')
  // the honest tricks/edits provenance never leaves the batch dir — the log carries kinds only
  assert.ok(!JSON.stringify(result.entry).includes('random-edit control'), 'arm provenance stays out of the shared log')
  assert.throws(() => adoptVariant(dir, '1'), /clip-set batch/)
})

test('assignClipOrder blinds the arms: not identity for typical seeds', () => {
  // across a spread of seeds, the original arm should NOT always land on v1 (else the blind leaks)
  let nonIdentity = 0
  for (const s of [7, 11, 23, 31, 44]) {
    const order = assignClipOrder(3, s)
    if (order[0] !== 0) nonIdentity += 1
  }
  assert.ok(nonIdentity >= 3, 'the seeded shuffle moves the arms around across seeds')
})

test('writeProdtaskBatch: refuses a one-arm batch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-prodtask-one-'))
  writeFileSync(join(dir, 'v1.wav'), toneWav(220, 0.3, 1))
  assert.throws(() => writeProdtaskBatch(dir, 'chords', [{ file: 'v1.wav', source: { kind: 'original', from: 'x' } }]), /at least two arm clips/)
})

test('normalizeBatchLoudness on a prodtask batch preserves the arm records and gain-matches', () => {
  const container = mkdtempSync(join(tmpdir(), 'beat-prodtask-norm-'))
  const { dir } = assembleBatch(container, 'lead', 12)
  const norm = normalizeBatchLoudness(dir, 3)
  assert.ok(norm && norm.normalized, 'the batch is loudness-normalized (tricks must not win by level)')
  assert.equal(typeof norm!.targetLufs, 'number')
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  assert.ok(manifest.variants.every((v: { source?: { kind?: string } }) => v.source?.kind), 'arm records survive normalization')
})

// ---- the per-arm scoreboard --------------------------------------------------------------------

function writeEntry(logPath: string, role: string, sources: Record<string, string>, picks: string[], features?: Record<string, Record<string, number>>) {
  const rejected = Object.keys(sources).filter((f) => !picks.includes(f))
  const entry: Record<string, unknown> = {
    t: new Date().toISOString(),
    batch: join('/tmp', `prodtask-transform-${role}-${Math.floor(Math.random() * 1e6)}`),
    group: `prodtask:transform:${role}`,
    picks: picks.map((variant, i) => ({ rank: i + 1, variant })),
    rejected,
    sources,
  }
  if (features) entry.features = features
  appendFileSync(logPath, JSON.stringify(entry) + '\n')
}

test('computeProdtaskReport: per-arm win/top-half/pairwise, per role, with the smoke label under 5', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-prodtask-report-'))
  const log = join(dir, 'beat-scores.jsonl')
  // three chords batches where tricked beats original beats random every time
  for (let i = 0; i < 3; i++) {
    writeEntry(log, 'chords', { 'v1.wav': 'original', 'v2.wav': 'tricked', 'v3.wav': 'random' }, ['v2.wav', 'v1.wav', 'v3.wav'])
  }
  const report = computeProdtaskReport(log)
  assert.equal(report.totalBatches, 3)
  const overall = Object.fromEntries(report.overall.map((s) => [s.kind, s]))
  assert.equal(overall.tricked!.wins, 3, 'tricked won all three')
  assert.equal(overall.original!.wins, 0)
  // tricked beat original AND random in each batch -> 6 implied pairwise wins, all won
  assert.equal(overall.tricked!.pairsWon, 6)
  assert.equal(overall.tricked!.pairCount, 6)
  assert.equal(overall.random!.pairsWon, 0)
  assert.equal(report.roles.length, 1)
  assert.equal(report.roles[0]!.task, 'transform')
  assert.equal(report.roles[0]!.role, 'chords')
  assert.ok(report.roles[0]!.smoke, 'three batches < 5 -> smoke')
  // the formatter mentions the arms and the chance framing
  const text = formatProdtaskReport(report)
  assert.match(text, /tricked/)
  assert.match(text, /research 119/)
})

test('computeProdtaskReport: the DSP receipt reports per-arm metric means from the log features', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-prodtask-receipt-'))
  const log = join(dir, 'beat-scores.jsonl')
  // the tricked arm carries much wider stereo + more air than the original (the mechanical receipt)
  const features = {
    'v1.wav': { stereoWidthDb: -52, bandAirPct: 0.2 }, // original: mono / airless
    'v2.wav': { stereoWidthDb: -12, bandAirPct: 1.8 }, // tricked: produced range
    'v3.wav': { stereoWidthDb: -30, bandAirPct: 0.9 }, // random: somewhere between
  }
  writeEntry(log, 'chords', { 'v1.wav': 'original', 'v2.wav': 'tricked', 'v3.wav': 'random' }, ['v2.wav', 'v1.wav', 'v3.wav'], features)
  const { entries } = loadProdtaskEntries(log)
  const widthByArm = armMetricMeans(entries, 'stereoWidthDb')
  assert.equal(widthByArm.original, -52)
  assert.equal(widthByArm.tricked, -12)
  const report = computeProdtaskReport(log)
  const receipt = report.roles[0]!.metricMeans.find((m) => m.metric === 'stereoWidthDb')!
  assert.equal(receipt.byArm.tricked, -12, 'the tricked arm sits in the produced width range in the report receipt')
  assert.match(formatProdtaskReport(report), /receipt stereoWidthDb/)
})

test('loadProdtaskEntries: only prodtask groups, latest per batch, sourceless entries skipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-prodtask-load-'))
  const log = join(dir, 'beat-scores.jsonl')
  // a showdown entry and a plain clip-set entry must be ignored
  appendFileSync(log, JSON.stringify({ batch: '/tmp/showdown-chords-1', group: 'showdown:chords', picks: [{ rank: 1, variant: 'v1.wav' }], sources: { 'v1.wav': 'engine' } }) + '\n')
  appendFileSync(log, JSON.stringify({ batch: '/tmp/prodtask-x', group: 'prodtask:transform:lead', picks: [{ rank: 1, variant: 'v1.wav' }] }) + '\n') // no sources -> skipped
  writeEntry(log, 'lead', { 'v1.wav': 'tricked', 'v2.wav': 'original' }, ['v1.wav', 'v2.wav'])
  const { entries, skipped } = loadProdtaskEntries(log)
  assert.equal(entries.length, 1, 'only the sourced prodtask entry loads')
  assert.equal(entries[0]!.role, 'lead')
  assert.equal(skipped, 1, 'the sourceless prodtask entry is counted as skipped')
})

test('computeProdtaskReport: empty log reports nothing scored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-prodtask-empty-'))
  const report = computeProdtaskReport(join(dir, 'beat-scores.jsonl'))
  assert.equal(report.totalBatches, 0)
  assert.match(formatProdtaskReport(report), /nothing scored yet/)
})

test('BeatBatchError surfaces on a bad random-edit count', () => {
  const { doc, seedTrack } = originalArmDoc('chords', 7)
  assert.throws(() => randomEditControl(doc, seedTrack, 0, 1), BeatBatchError)
})

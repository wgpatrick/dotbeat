// `beat ab` — the owner-feedback surface (research/128 §2.5, 137). Covers the feedback core
// (src/feedback/ab.ts) and the `beat ab --status` / `--digest` / `--bank-listen-bench` CLI:
//
//   - the log semantics (append-only, per-comparison answer file, re-answer supersedes)
//   - BARE-FOLDER inference against BOTH real on-disk layouts, reproduced as fixtures:
//       taste-dataset/layered-check/   <case>/{engineplus,layered,layeredplus}.wav  (+ a vary
//                                      manifest.json whose v1-v3 wavs must NOT be swept in)
//       taste-dataset/retarget-check/  <role>/<role>--<preset>--{before,after}.wav and the
//                                      --heldout- variants, which must split into their OWN pair
//   - --status / --digest output, including that the digest carries the owner's words VERBATIM
//   - the SEPARATION invariant: feedback never lands in beat-scores.jsonl or beat-decisions.jsonl,
//     and a feedback row is not shaped like a score row (mirrors test/board.test.ts's invariant)

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  loadAbSet,
  inferComparisons,
  groupByArmToken,
  recordFeedback,
  readFeedbackLog,
  answersByComparison,
  readAnswerFile,
  answerPathFor,
  buildAbStatus,
  buildDigest,
  missingOptions,
  formatDigest,
  listenBenchCandidates,
  AbError,
  ANSWERS_DIR,
  DEFAULT_FEEDBACK_LOG,
  FEEDBACK_MANIFEST,
  LISTEN_BENCH_CANDIDATES_FILE,
  type FeedbackEntry,
} from '../src/feedback/ab.js'
import { DEFAULT_SCORES_LOG } from '../src/vary/batch.js'
import { DEFAULT_DECISIONS_LOG } from '../src/board/decisions.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const beatCli = join(repoRoot, 'cli', 'beat.mjs')

/** Run the CLI. Returns stdout; `all: true` returns stdout+stderr, for the warnings that
 * deliberately go to stderr so they never contaminate a `--json` pipe. */
function beat(args: string[], opts: { expectExit?: number; all?: boolean } = {}): string {
  const r = spawnSync(process.execPath, [beatCli, ...args], { encoding: 'utf8' })
  const out = opts.all === true ? (r.stdout ?? '') + (r.stderr ?? '') : (r.stdout ?? '')
  if (r.status === 0) return out
  if (opts.expectExit !== undefined && r.status === opts.expectExit) return (r.stdout ?? '') + (r.stderr ?? '')
  throw new Error(`beat ${args.join(' ')} exited ${r.status}:\n${r.stderr ?? ''}${r.stdout ?? ''}`)
}

/** A minimal valid 44-byte WAV — enough for inference (which only reads names) and for the feature
 * pass to decline politely. */
function touchWav(path: string): void {
  const buf = Buffer.alloc(44)
  buf.write('RIFF', 0); buf.writeUInt32LE(36, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(44100, 24); buf.writeUInt32LE(88200, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(0, 40)
  writeFileSync(path, buf)
}

const scratch = (): string => mkdtempSync(join(tmpdir(), 'beat-ab-'))

/**
 * `taste-dataset/layered-check/` reproduced: six case dirs, each holding the three treatment arms
 * AND the vary batch (manifest.json + v1-v3.wav) they were rendered from. The v-wavs are the trap:
 * they are `beat board`'s territory, they are present in every case dir, and a naive "all wavs in
 * the folder" rule would put six options on every screen.
 */
function makeLayeredCheck(): string {
  const root = scratch()
  for (const c of ['bassline-41', 'bassline-1050', 'chords-138', 'lead-235']) {
    const dir = join(root, c)
    mkdirSync(dir)
    for (const arm of ['engineplus', 'layered', 'layeredplus']) touchWav(join(dir, `${arm}.wav`))
    for (const v of ['v1', 'v2', 'v3']) touchWav(join(dir, `${v}.wav`))
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({ parent: '', parentSha256: 'x', group: 'layered-check', seed: 41, variants: [{ file: 'v1.beat' }, { file: 'v2.beat' }, { file: 'v3.beat' }] }),
    )
  }
  writeFileSync(join(root, 'results.json'), '{}')
  return root
}

/** `taste-dataset/retarget-check/` reproduced: role dirs of `<role>--<preset>--{before,after}.wav`
 * plus the held-out pair, and a loss-curve jsonl that must be ignored. */
function makeRetargetCheck(): string {
  const root = scratch()
  for (const [role, presets] of [
    ['bassline', ['deep-sub-bass', 'roll-bassline-349']],
    ['chords', ['lush-pad']],
  ] as [string, string[]][]) {
    const dir = join(root, role)
    mkdirSync(dir)
    for (const p of presets) {
      for (const arm of ['before', 'after', 'heldout-before', 'heldout-after']) {
        touchWav(join(dir, `${role}--${p}--${arm}.wav`))
      }
      writeFileSync(join(dir, `${role}--${p}--loss-curve.jsonl`), '{}\n')
    }
  }
  return root
}

// ---- 1. bare-folder inference ----------------------------------------------------------------

test('inference: layered-check infers one comparison per case dir, and never sweeps in the vary variants', () => {
  const root = makeLayeredCheck()
  const set = loadAbSet(root)
  assert.equal(set.source, 'inferred')
  assert.equal(set.comparisons.length, 4, 'one comparison per case dir')
  assert.deepEqual(
    set.comparisons.map((c) => c.id),
    ['bassline-1050', 'bassline-41', 'chords-138', 'lead-235'],
  )
  const one = set.comparisons.find((c) => c.id === 'bassline-41')!
  assert.deepEqual(one.options.map((o) => o.name), ['engineplus', 'layered', 'layeredplus'])
  assert.deepEqual(
    one.options.map((o) => o.wav),
    ['bassline-41/engineplus.wav', 'bassline-41/layered.wav', 'bassline-41/layeredplus.wav'],
  )
  // The whole point of reading manifest.json during inference:
  assert.ok(!one.options.some((o) => /\/v[123]\.wav$/.test(o.wav)), 'v1-v3 belong to beat board, not beat ab')
})

test('inference: retarget-check pairs before/after AND splits the held-out figure into its own comparison', () => {
  const root = makeRetargetCheck()
  const set = loadAbSet(root)
  assert.equal(set.comparisons.length, 6, '3 presets x {search figure, held-out figure}')
  const ids = set.comparisons.map((c) => c.id)
  assert.ok(ids.includes('bassline/bassline--deep-sub-bass'), ids.join(', '))
  assert.ok(ids.includes('bassline/bassline--deep-sub-bass--heldout'), ids.join(', '))

  const search = set.comparisons.find((c) => c.id === 'bassline/bassline--deep-sub-bass')!
  assert.deepEqual(search.options.map((o) => o.name), ['before', 'after'], 'before sorts first, always')
  assert.deepEqual(search.options.map((o) => o.wav), [
    'bassline/bassline--deep-sub-bass--before.wav',
    'bassline/bassline--deep-sub-bass--after.wav',
  ])
  const heldout = set.comparisons.find((c) => c.id === 'bassline/bassline--deep-sub-bass--heldout')!
  assert.equal(heldout.label, 'bassline--deep-sub-bass (heldout)')
  assert.deepEqual(heldout.options.map((o) => o.wav), [
    'bassline/bassline--deep-sub-bass--heldout-before.wav',
    'bassline/bassline--deep-sub-bass--heldout-after.wav',
  ])
  // A held-out clip must never end up as a third arm of the search-figure comparison — that would
  // silently ask the owner to compare two different musical figures.
  assert.ok(!search.options.some((o) => o.wav.includes('heldout')))
})

test('inference: a leading arm token (compose-lab/renders) groups too, and unpaired wavs are reported', () => {
  const root = scratch()
  for (const n of ['amt-harmonize-1', 'ca2-harmonize-1', 'amt-bass-infill-1', 'ca2-bass-infill-1', 'ref-lead-strobe']) {
    touchWav(join(root, `${n}.wav`))
  }
  const { comparisons, note } = inferComparisons(root)
  assert.equal(comparisons.length, 2)
  assert.deepEqual(comparisons.map((c) => c.id).sort(), ['bass-infill-1', 'harmonize-1'])
  assert.deepEqual(comparisons[1]!.options.map((o) => o.name), ['amt', 'ca2'])
  assert.match(note, /1 unpaired wav\(s\) ignored/)
})

test('inference: a folder with nothing comparable yields nothing rather than a bogus comparison', () => {
  const root = scratch()
  touchWav(join(root, 'only-one.wav'))
  assert.deepEqual(inferComparisons(root).comparisons, [])
})

test('groupByArmToken: a qualified arm only folds when the bare arm exists in the same folder', () => {
  // `after` present -> `heldout-after` splits into qualifier + arm
  assert.equal(groupByArmToken(['x--before.wav', 'x--after.wav', 'x--heldout-before.wav', 'x--heldout-after.wav']).length, 2)
  // `after` absent -> `heldout-after` stays one opaque arm name, so this is ONE 2-arm comparison
  const opaque = groupByArmToken(['x--heldout-before.wav', 'x--heldout-after.wav'])
  assert.equal(opaque.length, 1)
  assert.deepEqual(opaque[0]!.arms.map((a) => a.arm), ['heldout-before', 'heldout-after'])
})

// ---- 2. the manifest shape -------------------------------------------------------------------

test('a feedback.json manifest wins over inference and carries the agent question through', () => {
  const root = makeLayeredCheck()
  writeFileSync(
    join(root, FEEDBACK_MANIFEST),
    JSON.stringify({
      question: 'does the layered version sound better than the unlayered one?',
      comparisons: [
        {
          id: 'bassline-41',
          label: 'bassline (seed 41)',
          question: 'and does the layering make it sound same-ish?',
          options: [
            { name: 'unlayered', wav: 'bassline-41/engineplus.wav', note: 'engineplus, one voice' },
            { name: 'layered', wav: 'bassline-41/layered.wav' },
          ],
          measurements: { unlayered: { LUFS: -14.1 }, layered: { LUFS: -12.8 } },
        },
      ],
    }),
  )
  const set = loadAbSet(root)
  assert.equal(set.source, 'manifest')
  assert.equal(set.comparisons.length, 1, 'the manifest is the whole question set — inference does not top it up')
  assert.equal(set.question, 'does the layered version sound better than the unlayered one?')
  assert.equal(set.comparisons[0]!.question, 'and does the layering make it sound same-ish?')
  assert.equal(set.comparisons[0]!.options[0]!.note, 'engineplus, one voice')
  assert.equal(set.comparisons[0]!.measurements!['layered']!['LUFS'], -12.8)
})

test('a malformed manifest fails loudly, naming the comparison', () => {
  const root = scratch()
  writeFileSync(join(root, FEEDBACK_MANIFEST), JSON.stringify({ comparisons: [{ id: 'a', options: [{ name: 'x', wav: 'x.wav' }] }] }))
  assert.throws(() => loadAbSet(root), (e: Error) => e instanceof AbError && /needs at least 2 options/.test(e.message))
})

// ---- 3. log semantics ------------------------------------------------------------------------

const OPTIONS = [
  { name: 'engineplus', wav: 'bassline-41/engineplus.wav' },
  { name: 'layered', wav: 'bassline-41/layered.wav' },
]

test('recordFeedback appends one JSONL row and writes the per-comparison answer file', () => {
  const root = makeLayeredCheck()
  const log = join(root, DEFAULT_FEEDBACK_LOG)
  const res = recordFeedback(root, {
    comparisonId: 'bassline-41',
    question: 'does the layering help?',
    preference: 'engineplus',
    freeText: "the bassline layering doesn't sound great, I liked the unlayered one better",
    options: OPTIONS,
  }, log)

  const rows = readFeedbackLog(log)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.preference, 'engineplus')
  assert.equal(rows[0]!.freeText, "the bassline layering doesn't sound great, I liked the unlayered one better")
  assert.equal(rows[0]!.nonBlind, true, 'every row is self-describing as non-blind')
  assert.deepEqual(rows[0]!.options.map((o) => o.name), ['engineplus', 'layered'])
  assert.ok(typeof rows[0]!.t === 'string' && rows[0]!.t.endsWith('Z'))

  assert.equal(res.answerPath, answerPathFor(root, 'bassline-41'))
  assert.ok(existsSync(res.answerPath), 'the answer file an agent globs')
  const answer = readAnswerFile(root, 'bassline-41')!
  assert.equal(answer.preference, 'engineplus')
  assert.equal(answer.freeText, rows[0]!.freeText)
  assert.equal(answer.comparisonId, 'bassline-41')
})

test('a re-answer supersedes in the map but the log keeps both (append-only)', () => {
  const root = makeLayeredCheck()
  const log = join(root, DEFAULT_FEEDBACK_LOG)
  const base = { comparisonId: 'bassline-41', question: 'q', options: OPTIONS }
  recordFeedback(root, { ...base, preference: 'layered', freeText: 'first pass, sounds fuller' }, log)
  recordFeedback(root, { ...base, preference: 'engineplus', freeText: 'listened again on headphones — unlayered wins' }, log)
  assert.equal(readFeedbackLog(log).length, 2, 'nothing is ever overwritten in the log')
  const latest = answersByComparison(log, root).get('bassline-41')!
  assert.equal(latest.preference, 'engineplus')
  assert.match(readAnswerFile(root, 'bassline-41')!.freeText, /headphones/)
})

test('a preference naming no option is refused, and "neither" with no words records nothing', () => {
  const root = makeLayeredCheck()
  const log = join(root, DEFAULT_FEEDBACK_LOG)
  assert.throws(
    () => recordFeedback(root, { comparisonId: 'c', question: 'q', preference: 'nonesuch', freeText: 'x', options: OPTIONS }, log),
    (e: Error) => e instanceof AbError && /not one of/.test(e.message),
  )
  assert.throws(
    () => recordFeedback(root, { comparisonId: 'c', question: 'q', preference: 'neither', freeText: '   ', options: OPTIONS }, log),
    (e: Error) => e instanceof AbError && /records nothing/.test(e.message),
  )
  assert.ok(!existsSync(log), 'a refused answer writes no row at all')
})

test('a nested comparison id becomes exactly one answer file', () => {
  const root = makeRetargetCheck()
  const log = join(root, DEFAULT_FEEDBACK_LOG)
  recordFeedback(root, {
    comparisonId: 'bassline/bassline--deep-sub-bass',
    question: 'did retargeting help?',
    preference: 'after',
    freeText: 'much deeper, yes',
    options: [
      { name: 'before', wav: 'bassline/bassline--deep-sub-bass--before.wav' },
      { name: 'after', wav: 'bassline/bassline--deep-sub-bass--after.wav' },
    ],
  }, log)
  const p = answerPathFor(root, 'bassline/bassline--deep-sub-bass')
  assert.equal(dirname(p), join(root, ANSWERS_DIR), 'answers live in one globbable folder')
  assert.ok(!p.includes('/bassline/bassline--deep'), 'the slash is folded, not turned into a subdirectory')
  assert.ok(existsSync(p))
})

// ---- 4. status + digest ----------------------------------------------------------------------

test('buildAbStatus reports answered/unanswered with the owner words attached', () => {
  const root = makeLayeredCheck()
  const log = join(root, DEFAULT_FEEDBACK_LOG)
  recordFeedback(root, {
    comparisonId: 'bassline-41', question: 'q', preference: 'engineplus',
    freeText: 'I liked the unlayered one better', options: OPTIONS,
  }, log)
  const status = buildAbStatus(root, log)
  assert.equal(status.total, 4)
  assert.equal(status.answered, 1)
  assert.equal(status.unanswered, 3)
  const answered = status.comparisons.find((c) => c.id === 'bassline-41')!
  assert.equal(answered.answered, true)
  assert.equal(answered.freeText, 'I liked the unlayered one better')
  assert.equal(status.comparisons.find((c) => c.id === 'chords-138')!.answered, false)
})

test('the digest carries the owner VERBATIM and tallies preferences', () => {
  const root = makeLayeredCheck()
  const log = join(root, DEFAULT_FEEDBACK_LOG)
  const quote = "the layering makes everything sound same-ish"
  recordFeedback(root, { comparisonId: 'bassline-41', question: 'q', preference: 'engineplus', freeText: quote, options: OPTIONS }, log)
  recordFeedback(root, { comparisonId: 'chords-138', question: 'q', preference: 'engineplus', freeText: 'this one is fine', options: OPTIONS }, log)

  const d = buildDigest(root, log)
  assert.equal(d.answered, 2)
  assert.deepEqual(d.preferences, [{ name: 'engineplus', count: 2 }])
  assert.equal(d.quotes.length, 2)
  assert.equal(d.quotes[0]!.freeText, quote, 'stored and returned character-for-character')
  assert.deepEqual(d.unansweredIds.sort(), ['bassline-1050', 'lead-235'])

  const text = formatDigest(d)
  assert.ok(text.includes(quote), 'the digest text quotes the owner, it does not summarise them')
  assert.match(text, /RELAY THESE, do not paraphrase/)
  assert.match(text, /PREFERENCES/)
})

// ---- 5. listen-bench wiring ------------------------------------------------------------------

const entry = (over: Partial<FeedbackEntry>): FeedbackEntry => ({
  t: '2026-07-26T12:00:00.000Z', dir: '/tmp/layered-check', comparisonId: 'bassline-41',
  question: 'does the layering help?', preference: 'engineplus', freeText: '', options: OPTIONS,
  nonBlind: true, ...over,
})

test('a complaint becomes a MATCHED fail/pass listen-bench candidate; a plain compliment does not', () => {
  const cands = listenBenchCandidates([
    entry({ freeText: "the bassline layering doesn't sound great, I liked the unlayered one better" }),
    entry({ comparisonId: 'chords-138', freeText: 'nice, the layered one opens up' }),
    entry({ comparisonId: 'lead-235', freeText: 'neither works', preference: 'neither' }),
    entry({ comparisonId: 'bassline-1050', freeText: 'fine either way', flagged: true }),
    entry({ comparisonId: 'silent', freeText: '', flagged: true }),
  ])
  assert.deepEqual(cands.map((c) => c.comparisonId), ['bassline-41', 'lead-235', 'bassline-1050'])
  assert.deepEqual(cands.map((c) => c.trigger), ['wording', 'neither', 'flag'])

  const first = cands[0]!
  assert.ok(first.passWav!.endsWith('bassline-41/engineplus.wav'), 'the preferred side is the pass clip')
  assert.deepEqual(first.failWavs.map((w) => w.split('/').pop()), ['layered.wav'])
  assert.equal(first.quote, "the bassline layering doesn't sound great, I liked the unlayered one better")

  // A "neither" verdict has no pass side — every clip is a fail. Recorded honestly rather than
  // inventing a reference.
  const neither = cands[1]!
  assert.equal(neither.passWav, undefined)
  assert.equal(neither.failWavs.length, 2)
})

test('beat ab --bank-listen-bench writes the candidate file next to the renders', () => {
  const root = makeLayeredCheck()
  const log = join(root, DEFAULT_FEEDBACK_LOG)
  recordFeedback(root, {
    comparisonId: 'bassline-41', question: 'does the layering help?', preference: 'engineplus',
    freeText: "the bassline layering doesn't sound great", flagged: true, options: OPTIONS,
  }, log)
  const out = beat(['ab', root, '--bank-listen-bench'])
  assert.match(out, /1 listen-bench candidate/)
  const banked = JSON.parse(readFileSync(join(root, LISTEN_BENCH_CANDIDATES_FILE), 'utf8'))
  assert.equal(banked.candidates.length, 1)
  assert.equal(banked.candidates[0]!.trigger, 'flag')
  assert.ok(banked.candidates[0]!.passWav.endsWith('engineplus.wav'))
})

// ---- 6. the CLI ------------------------------------------------------------------------------

test('beat ab --status/--digest read a bare folder with no manifest and no browser', () => {
  const root = makeRetargetCheck()
  const status = JSON.parse(beat(['ab', root, '--status', '--json']))
  assert.equal(status.source, 'inferred')
  assert.equal(status.total, 6)
  assert.equal(status.unanswered, 6)

  const plain = beat(['ab', root, '--status'])
  assert.match(plain, /before vs after/)

  const digest = beat(['ab', root, '--digest'])
  assert.match(digest, /no answers yet/)
})

test('beat ab rejects an unknown flag loudly rather than binding the default port', () => {
  const root = makeLayeredCheck()
  const out = beat(['ab', root, '--prot', '4520'], { expectExit: 2 })
  assert.match(out, /unknown flag "--prot"/)
})

test('beat ab on a folder with nothing to compare says so and exits non-zero', () => {
  const out = beat(['ab', scratch()], { expectExit: 1 })
  assert.match(out, /nothing to compare/)
  assert.match(out, /feedback\.json/)
})

// ---- 6b. CLI pilot 2026-07-26 fixes -----------------------------------------------------------

/** A listening set whose manifest points at two renders that are not on disk. */
function makeBrokenSet(): string {
  const root = scratch()
  mkdirSync(join(root, 'case-a'))
  touchWav(join(root, 'case-a', 'good.wav'))
  writeFileSync(
    join(root, FEEDBACK_MANIFEST),
    JSON.stringify({
      question: 'which?',
      comparisons: [{
        id: 'case-a', label: 'Case A',
        options: [
          { name: 'good', wav: 'case-a/good.wav' },
          { name: 'typo', wav: 'case-a/does-not-exist.wav' },
          { name: 'abs', wav: '/tmp/definitely-not-here/absolute.wav' },
        ],
      }],
    }),
  )
  return root
}

test('a missing render is reported, not silently played as silence (pilot HIGH)', () => {
  const root = makeBrokenSet()
  const set = loadAbSet(root)
  const gaps = missingOptions(set)
  assert.equal(gaps.length, 1)
  assert.deepEqual(gaps[0]!.missing, ['case-a/does-not-exist.wav', '/tmp/definitely-not-here/absolute.wav'])
  assert.equal(gaps[0]!.total, 3)

  const status = buildAbStatus(root, join(root, DEFAULT_FEEDBACK_LOG))
  assert.equal(status.missingCount, 2, 'the status an agent polls carries the count')
  assert.equal(status.comparisons[0]!.missing.length, 2)

  const out = beat(['ab', root, '--status'], { all: true })
  assert.match(out, /2 of 3 missing/, 'and the CLI says so loudly')
  assert.match(out, /MISSING RENDER/)
})

test('beat ab --answer records without a browser — the transcribe-from-chat channel', () => {
  const root = makeLayeredCheck()
  const quote = 'the layering makes everything sound same-ish'
  const out = beat(['ab', root, '--answer', 'bassline-41', '--prefer', 'engineplus', '--note', quote, '--flag'])
  assert.match(out, /recorded bassline-41: engineplus/)

  const rows = readFeedbackLog(join(root, DEFAULT_FEEDBACK_LOG))
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.freeText, quote, 'the owner\'s words go in exactly as typed')
  assert.equal(rows[0]!.flagged, true)
  assert.equal(rows[0]!.preference, 'engineplus')
  // Identical to what the browser writes: same log, same answer file, same shape.
  assert.equal(readAnswerFile(root, 'bassline-41')!.freeText, quote)

  const unknown = beat(['ab', root, '--answer', 'no-such-case', '--prefer', 'x'], { expectExit: 2 })
  assert.match(unknown, /no comparison "no-such-case"/)
  assert.match(unknown, /known ids:/, 'and it lists what it does know')
})

test('the answer file carries the same facts as the log row (pilot MEDIUM)', () => {
  const root = makeLayeredCheck()
  writeFileSync(
    join(root, FEEDBACK_MANIFEST),
    JSON.stringify({
      question: 'q',
      comparisons: [{
        id: 'bassline-41', label: 'bassline (seed 41)',
        options: [
          { name: 'engineplus', wav: 'bassline-41/engineplus.wav', note: 'unlayered, one voice' },
          { name: 'layered', wav: 'bassline-41/layered.wav', note: 'sub + growl + click' },
        ],
        measurements: { engineplus: { LUFS: -14.1 }, layered: { LUFS: -12.8 } },
      }],
    }),
  )
  beat(['ab', root, '--answer', 'bassline-41', '--prefer', 'layered', '--note', 'fuller'])
  const answer = readAnswerFile(root, 'bassline-41')!
  assert.equal(answer.label, 'bassline (seed 41)', 'the file explains which comparison it is')
  assert.equal(answer.options[0]!.note, 'unlayered, one voice', 'and what the option names MEANT')
  assert.equal(answer.measurements!['layered']!['LUFS'], -12.8)
})

test('the digest refuses to tally preferences across comparisons with different options (pilot LOW)', () => {
  const root = scratch()
  const log = join(root, DEFAULT_FEEDBACK_LOG)
  recordFeedback(root, {
    comparisonId: 'a', question: 'q', preference: 'alpha', freeText: 'this one',
    options: [{ name: 'alpha', wav: 'a/alpha.wav' }, { name: 'beta', wav: 'a/beta.wav' }],
  }, log)
  recordFeedback(root, {
    comparisonId: 'b', question: 'q', preference: 'after', freeText: 'that one',
    options: [{ name: 'before', wav: 'b/before.wav' }, { name: 'after', wav: 'b/after.wav' }],
  }, log)
  writeFileSync(join(root, FEEDBACK_MANIFEST), JSON.stringify({
    comparisons: [
      { id: 'a', options: [{ name: 'alpha', wav: 'a/alpha.wav' }, { name: 'beta', wav: 'a/beta.wav' }] },
      { id: 'b', options: [{ name: 'before', wav: 'b/before.wav' }, { name: 'after', wav: 'b/after.wav' }] },
    ],
  }))
  const d = buildDigest(root, log)
  assert.deepEqual(d.preferences, [], 'no tally of unrelated arm names')
  assert.match(d.preferencesNote ?? '', /do not share an option vocabulary/)
  assert.match(formatDigest(d), /not tallied/)
  // The quotes still carry the whole report.
  assert.equal(d.quotes.length, 2)
})

test('the two modes cannot be combined silently (pilot LOW)', () => {
  const root = makeLayeredCheck()
  const out = beat(['ab', root, '--status', '--digest'], { expectExit: 2 })
  assert.match(out, /separate modes/)
})

test('a banked candidate carries a pre-filled answer-key stub, not homework', () => {
  const root = makeLayeredCheck()
  const log = join(root, DEFAULT_FEEDBACK_LOG)
  const quote = 'the two voices beat against each other around 100-120hz'
  recordFeedback(root, {
    comparisonId: 'bassline-41', question: 'does the layering help?', preference: 'engineplus',
    freeText: quote, flagged: true, options: OPTIONS,
  }, log)
  const c = buildDigest(root, log).candidates[0]!
  assert.equal(c.answerKeyStub.finding, quote, 'the finding starts as the owner\'s exact words')
  assert.ok(c.answerKeyStub.fail.endsWith('layered.wav'))
  assert.ok(c.answerKeyStub.pass!.endsWith('engineplus.wav'))
  assert.equal(c.answerKeyStub.span, '', 'the fields only a listen can fill are present and empty')
  assert.match(c.answerKeyStub.source, /beat ab .*bassline-41/)
})

// ---- 7. the SEPARATION invariant --------------------------------------------------------------

test('feedback never contaminates blind eval or the decisions log (the separation invariant)', () => {
  // Three surfaces, three log filenames, no two the same. A rename that collapsed any pair would
  // silently merge production feedback into the taste model's ground truth (D24).
  const names = [DEFAULT_SCORES_LOG, DEFAULT_DECISIONS_LOG, DEFAULT_FEEDBACK_LOG]
  assert.equal(new Set(names).size, 3, `these three must never collide: ${names.join(', ')}`)

  const root = makeLayeredCheck()
  recordFeedback(root, {
    comparisonId: 'bassline-41', question: 'q', preference: 'engineplus',
    freeText: 'unlayered wins', options: OPTIONS,
  }, join(root, DEFAULT_FEEDBACK_LOG))

  assert.ok(existsSync(join(root, DEFAULT_FEEDBACK_LOG)))
  assert.ok(!existsSync(join(root, DEFAULT_SCORES_LOG)), 'NOTHING is written to beat-scores.jsonl')
  assert.ok(!existsSync(join(root, DEFAULT_DECISIONS_LOG)), 'NOTHING is written to beat-decisions.jsonl')
  // And no decision.json either — an answer is not a production pick and must not look like one to
  // `beat board --status`.
  assert.ok(!existsSync(join(root, 'bassline-41', 'decision.json')))

  // Shape-level separation, not just filename-level: the blind scorer's readers key off `picks`,
  // the board's off `decision`. A feedback row has neither, so even a misdirected --log cannot make
  // one load as a score or a decision.
  const row = readFeedbackLog(join(root, DEFAULT_FEEDBACK_LOG))[0] as unknown as Record<string, unknown>
  assert.equal(row['picks'], undefined, 'a feedback row is not shaped like a blind score row')
  assert.equal(row['decision'], undefined, 'a feedback row is not shaped like a board decision row')
  assert.equal(row['nonBlind'], true)
})

test('the three review surfaces stay three separate CLI verbs', () => {
  // `beat feedback` is the MACHINE-critique verb (render + metrics + lint) and points the other way
  // down the loop; `beat ab` is the owner's channel. If these ever merge, the help text below is
  // the first thing that changes.
  assert.match(beat(['ab', '--help']), /owner-FEEDBACK UI/)
  assert.match(beat(['feedback', '--help']), /report mix feedback/)
  assert.match(beat(['board', '--help']), /option-board PICKING UI/)
  assert.match(beat(['rate', '--help']), /blind/)
})

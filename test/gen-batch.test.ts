// Phase 40 Stream VB — `beat source gen --count N`: generation joins the taste loop.
//
// The bug these tests exist for is a real one, from building examples/recipe-song on 2026-07-14:
// the snare was picked from seeds 5/6/7 by out-of-band FFT measurement, and the two LOSING
// candidates are still registered in that song's media block with no record an audition happened —
// because `beat source gen` registered every sound it made, the instant it made it. So the load-
// bearing assertions here are NEGATIVE ones: after a batch the parent .beat must be BYTE-IDENTICAL
// and have no media/ dir at all; after adopt, exactly ONE sample (the winner) is registered and the
// losers left nothing behind.
//
// GATED on python3 like gen-sidecar.test.ts, and everything runs on the `stub` backend — stdlib
// only, no torch, deterministic per seed, so a 3-seed batch is a known-answer test that stays green
// in CI. (A stub candidate is a seed-derived tone bed; distinct seeds give distinct sha256s, which
// is exactly what makes "did the RIGHT one get registered?" checkable.)

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { defaultGenBatchDir, readBatchManifest, type VaryBatchManifest } from '../src/vary/batch.js'
import { parseScoresLog } from '../src/vary/suggest.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const beatCli = join(repoRoot, 'cli', 'beat.mjs')

let hasPython = false
try {
  execFileSync('python3', ['--version'], { stdio: 'ignore' })
  hasPython = true
} catch {
  hasPython = false
}

interface RunResult {
  status: number
  stdout: string
  stderr: string
}

function beat(args: string[]): RunResult {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8' }), stderr: '' }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

function freshProject(): { beatFile: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'beat-gen-batch-'))
  const beatFile = join(dir, 'song.beat')
  const init = beat(['init', beatFile])
  assert.equal(init.status, 0, init.stderr)
  return { beatFile, dir }
}

/** Generate a 3-candidate stub batch of one prompt over seeds 5-7 — the recipe-song's exact case. */
function genBatch(beatFile: string, id = 'snare', extra: string[] = []): RunResult {
  const out = beat(['source', 'gen', beatFile, id, 'tight acoustic snare', '--count', '3', '--seed-from', '5', '--backend', 'stub', '--seconds', '1', ...extra])
  assert.equal(out.status, 0, out.stderr)
  return out
}

// ---- the deferred registration: a batch must not touch the project at all --------------------

test('a gen batch generates N candidates and registers NOTHING in the parent .beat', (t) => {
  if (!hasPython) return t.skip('no python3')
  const { beatFile, dir } = freshProject()
  const before = readFileSync(beatFile, 'utf8')

  const out = genBatch(beatFile)
  const batchDir = defaultGenBatchDir(beatFile, 'snare', 5)
  assert.equal(batchDir, join(dir, 'gen-snare-5'), 'batch dir defaults NEXT TO the .beat, like vary batches')

  // THE point of the stream: the project is untouched, byte for byte.
  assert.equal(readFileSync(beatFile, 'utf8'), before, 'the parent .beat must be byte-identical after a batch')
  assert.ok(!existsSync(join(dir, 'media')), 'a batch must not even create media/ — candidates leave no trace outside the batch dir')

  // ...and the candidates are real, prepped, auditionable audio sitting in the batch dir.
  for (const f of ['v1.wav', 'v2.wav', 'v3.wav', 'manifest.json']) {
    assert.ok(existsSync(join(batchDir, f)), `missing ${f}`)
  }
  assert.match(out.stdout, /3 candidates of "tight acoustic snare" \(seeds 5-7\)/)
  assert.match(out.stdout, /nothing is registered in .*song\.beat yet/)
  assert.match(out.stdout, /audition, then: beat score .*gen-snare-5 <best>/)
  assert.match(out.stdout, /then register the winner: beat adopt .*gen-snare-5 <best>/)
})

test('the gen manifest is the ONE vary-batch shape (D21): wav variants, no track, media per variant', (t) => {
  if (!hasPython) return t.skip('no python3')
  const { beatFile, dir } = freshProject()
  genBatch(beatFile)
  // Read it through the SHARED reader both surfaces use — if a gen batch needed its own reader,
  // D21's "one manifest" claim would be false.
  const m: VaryBatchManifest = readBatchManifest(join(dir, 'gen-snare-5'))

  assert.equal(m.parent, beatFile)
  assert.equal(m.group, 'gen:snare', 'strain (b): group carries the sample id, so the scores log stays one shape')
  assert.equal(m.track, undefined, 'strain (b): a gen batch has no track')
  assert.equal(m.prompt, 'tight acoustic snare')
  assert.equal(m.seed, 5)
  assert.equal(m.count, 3)
  assert.deepEqual(m.variants.map((v) => v.file), ['v1.wav', 'v2.wav', 'v3.wav'], 'strain (a): variants are wavs, not .beat files')
  // parentSha256 pins the file adopt will register into — the guard still applies.
  assert.match(m.parentSha256, /^[0-9a-f]{64}$/)

  m.variants.forEach((v, i) => {
    assert.ok(v.media, 'every gen variant carries the D21 media field')
    assert.equal(v.media!.id, 'snare')
    assert.equal(v.media!.seed, 5 + i, 'seeds are seed-from..seed-from+N-1, recorded per candidate')
    assert.equal(v.edits, undefined)
    assert.equal(v.recipe, undefined)
    // The provenance sidecar rides in the manifest until (and only if) this candidate wins.
    const gen = (v.media!.sidecar as { generated?: Record<string, unknown> }).generated!
    assert.equal(gen.prompt, 'tight acoustic snare')
    assert.equal(gen.seed, 5 + i)
    assert.equal(gen.backend, 'stub')
  })
  // Distinct seeds must give distinct audio, or "pick the best one" is theatre (pilot 106 M1).
  assert.equal(new Set(m.variants.map((v) => v.media!.sha256)).size, 3, 'each seed produces distinct audio')
})

// ---- score: one log, one shape ----------------------------------------------------------------

test('scoring a gen batch appends to the SAME beat-scores.jsonl a vary batch does', (t) => {
  if (!hasPython) return t.skip('no python3')
  const { beatFile, dir } = freshProject()
  genBatch(beatFile)
  const batchDir = join(dir, 'gen-snare-5')

  const scored = beat(['score', batchDir, 'v2', 'v3'])
  assert.equal(scored.status, 0, scored.stderr)
  // A gen winner has no edits to replay and no doc to copy — adopt IS the registration, so the
  // hint must say that rather than offering a `beat set` line that cannot exist.
  assert.match(scored.stdout, /to adopt the winner \(snare, seed 6\) — this is what registers it into/)
  assert.doesNotMatch(scored.stdout, /beat set /)

  const logPath = join(dir, 'beat-scores.jsonl')
  assert.ok(existsSync(logPath), 'the log lands next to the .beat, exactly like a vary batch\'s')
  const entry = JSON.parse(readFileSync(logPath, 'utf8').trim())
  assert.equal(entry.group, 'gen:snare')
  assert.equal(entry.track, undefined)
  assert.equal(entry.prompt, 'tight acoustic snare', 'the prompt is in the log: "which prompts do I like" is one jq away')
  assert.deepEqual(entry.picks.map((p: { rank: number; variant: string }) => [p.rank, p.variant]), [[1, 'v2.wav'], [2, 'v3.wav']])
  assert.deepEqual(entry.picks[0].media, { id: 'snare', seed: 6, sha256: entry.picks[0].media.sha256 })
  assert.deepEqual(entry.rejected, ['v1.wav'])

  // And a vary round on the same project appends to the same file — ONE log, two batch kinds.
  beat(['vary', beatFile, 'lead', 'filter', '--count', '2', '--seed', '3', '--out-dir', join(dir, 'vb')])
  const varyScored = beat(['score', join(dir, 'vb'), 'v1'])
  assert.equal(varyScored.status, 0, varyScored.stderr)
  const lines = readFileSync(logPath, 'utf8').trim().split('\n')
  assert.equal(lines.length, 2, 'both kinds of round land in the one log')
  // The vary entry is unchanged by any of this — .beat variants, a track, replayable edits.
  const varyEntry = JSON.parse(lines[1]!)
  assert.equal(varyEntry.track, 'lead')
  assert.equal(varyEntry.picks[0].variant, 'v1.beat')
  assert.ok(Array.isArray(varyEntry.picks[0].edits))
})

test('beat suggest does not choke on gen entries — it ignores them rather than polluting a track\'s stats', (t) => {
  if (!hasPython) return t.skip('no python3')
  const { beatFile, dir } = freshProject()
  genBatch(beatFile)
  beat(['score', join(dir, 'gen-snare-5'), 'v2'])
  beat(['vary', beatFile, 'lead', 'filter', '--count', '2', '--seed', '3', '--out-dir', join(dir, 'vb')])
  beat(['score', join(dir, 'vb'), 'v1'])

  const suggest = beat(['suggest', beatFile, 'lead'])
  assert.equal(suggest.status, 0, suggest.stderr)
  assert.match(suggest.stdout, /filter/)
  assert.match(suggest.stdout, /based on 1 scored round/, 'the gen round is not counted as a round for "lead"')
  assert.doesNotMatch(suggest.stdout, /gen:snare/, 'a gen group must never be recommended as a vary target')

  // Concretely: suggest's parser drops trackless entries, which is the intended reading and not an
  // accident — a gen round is not a mutation round for any track, so it must not enter the
  // Bradley-Terry stats or produce a nonsense `beat vary <file> <track> gen:snare` recommendation.
  const parsed = parseScoresLog(readFileSync(join(dir, 'beat-scores.jsonl'), 'utf8'))
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0]!.group, 'filter')
})

// ---- adopt: the winner ALONE ------------------------------------------------------------------

test('beat adopt registers the WINNER ALONE — the losers leave no trace (the recipe-song bug)', (t) => {
  if (!hasPython) return t.skip('no python3')
  const { beatFile, dir } = freshProject()
  genBatch(beatFile)
  const batchDir = join(dir, 'gen-snare-5')
  const m = readBatchManifest(batchDir)
  const winner = m.variants[1]!.media! // v2, seed 6
  const losers = [m.variants[0]!.media!, m.variants[2]!.media!]

  const out = beat(['adopt', batchDir, 'v2'])
  assert.equal(out.status, 0, out.stderr)
  assert.match(out.stdout, /adopted v2 -> registered snare in .*song\.beat/)
  assert.match(out.stdout, /provenance sidecar: media\/snare\.wav\.json/)
  assert.match(out.stdout, /the 2 losing candidates stayed in .* and were never registered/)

  // EXACTLY ONE sample is registered, and it is the one that was picked.
  const beatText = readFileSync(beatFile, 'utf8')
  const sampleLines = beatText.split('\n').filter((l) => l.trim().startsWith('sample '))
  assert.equal(sampleLines.length, 1, `exactly one sample registered, got:\n${sampleLines.join('\n')}`)
  assert.match(sampleLines[0]!, new RegExp(`sample snare sha256:${winner.sha256} media/snare\\.wav`))
  for (const l of losers) assert.doesNotMatch(beatText, new RegExp(l.sha256), 'a losing candidate must not appear anywhere in the .beat')

  // media/ holds the winner and nothing else — no stray candidate files, no loser sidecars.
  assert.deepEqual(readdirSync(join(dir, 'media')).sort(), ['snare.wav', 'snare.wav.json'])

  // The registered bytes ARE the auditioned bytes: prep ran at batch time and adopt COPIES, so
  // what you heard is what you got (re-prepping at adopt would re-trim/re-fade and change them).
  assert.equal(
    readFileSync(join(dir, 'media', 'snare.wav')).toString('base64'),
    readFileSync(join(batchDir, 'v2.wav')).toString('base64'),
    'the registered wav is byte-identical to the candidate that was auditioned',
  )

  // The winner's provenance sidecar is the one recorded at generation — prompt + seed intact, so
  // the sample is regenerable from the .beat alone (the recipe property).
  const sidecar = JSON.parse(readFileSync(join(dir, 'media', 'snare.wav.json'), 'utf8'))
  assert.equal(sidecar.sha256, winner.sha256)
  assert.equal(sidecar.query, 'tight acoustic snare')
  assert.equal(sidecar.generated.seed, 6)
  assert.equal(sidecar.generated.backend, 'stub')
  assert.equal(sidecar.license, 'stub-placeholder', 'a stub tone must never claim the Stability license (pilot 106 M2)')
})

test('adopting a second candidate (changing your mind) trips the sha guard, then upserts under --force', (t) => {
  if (!hasPython) return t.skip('no python3')
  const { beatFile, dir } = freshProject()
  genBatch(beatFile)
  const batchDir = join(dir, 'gen-snare-5')
  const m = readBatchManifest(batchDir)

  beat(['adopt', batchDir, 'v2'])
  // The first adopt itself moved the parent — so the guard fires, but the message must explain
  // THAT (a gen adopt upserts one media line; it does not overwrite the document).
  const refused = beat(['adopt', batchDir, 'v3'])
  assert.equal(refused.status, 2)
  assert.match(refused.stderr, /has changed since this batch was generated/)
  assert.match(refused.stderr, /adopting an earlier candidate from this batch is itself such a change/)
  assert.match(refused.stderr, /upserts the media entry and leaves every other edit alone/)
  assert.doesNotMatch(refused.stderr, /would overwrite that newer work/, 'the doc-copy wording is wrong for a media adopt')
  assert.match(readFileSync(beatFile, 'utf8'), new RegExp(m.variants[1]!.media!.sha256), 'the refusal left v2 registered')

  const forced = beat(['adopt', batchDir, 'v3', '--force'])
  assert.equal(forced.status, 0, forced.stderr)
  assert.match(forced.stdout, /note: re-registered snare \(replaced sha256:/, 'reuses the existing re-register messaging')

  // Still exactly one sample — an upsert, not a second entry.
  const sampleLines = readFileSync(beatFile, 'utf8').split('\n').filter((l) => l.trim().startsWith('sample '))
  assert.equal(sampleLines.length, 1)
  assert.match(sampleLines[0]!, new RegExp(m.variants[2]!.media!.sha256), 'v3 is now the registered snare')
})

test('adopt into a project that has moved on registers the winner WITHOUT clobbering the newer edits', (t) => {
  if (!hasPython) return t.skip('no python3')
  const { beatFile } = freshProject()
  genBatch(beatFile)
  const batchDir = defaultGenBatchDir(beatFile, 'snare', 5)

  // An ordinary edit after the batch — the exact case the sha guard exists for. For a vary batch
  // adopting would destroy this; for a gen batch it must survive, because adopt only touches media.
  beat(['set', beatFile, 'lead.cutoff', '500'])
  const forced = beat(['adopt', batchDir, 'v1', '--force'])
  assert.equal(forced.status, 0, forced.stderr)

  const after = readFileSync(beatFile, 'utf8')
  assert.match(after, /cutoff 500/, 'the unrelated newer edit survives a forced gen adopt')
  assert.match(after, /sample snare/, 'and the winner is registered')
})

// ---- audition: no render needed ---------------------------------------------------------------

test('--audition stitches the candidates directly — they are already audio, so no Chromium render', (t) => {
  if (!hasPython) return t.skip('no python3')
  const { beatFile, dir } = freshProject()
  const out = genBatch(beatFile, 'snare', ['--audition'])
  const batchDir = join(dir, 'gen-snare-5')

  assert.match(out.stdout, /audition\.wav \(0:0\d\.\d\): v1 @ 0:00\.0, v2 @ 0:0\d\.\d, v3 @ 0:0\d\.\d/)
  assert.ok(existsSync(join(batchDir, 'audition.wav')))
  const index = JSON.parse(readFileSync(join(batchDir, 'audition.json'), 'utf8'))
  assert.deepEqual(index.entries.map((e: { variant: string; wav: string }) => [e.variant, e.wav]), [['v1', 'v1.wav'], ['v2', 'v2.wav'], ['v3', 'v3.wav']])
  // Still nothing registered: auditioning is listening, not committing.
  assert.ok(!existsSync(join(dir, 'media')))
})

// ---- errors + the untouched single-shot path --------------------------------------------------

test('gen batch input errors are actionable, and a failed batch still leaves the project alone', (t) => {
  if (!hasPython) return t.skip('no python3')
  const { beatFile, dir } = freshProject()
  const before = readFileSync(beatFile, 'utf8')

  const zero = beat(['source', 'gen', beatFile, 'x', 'a prompt', '--count', '0', '--backend', 'stub'])
  assert.equal(zero.status, 2)
  assert.match(zero.stderr, /--count must be a positive integer, got 0/)

  const tooMany = beat(['source', 'gen', beatFile, 'x', 'a prompt', '--count', '99', '--backend', 'stub'])
  assert.equal(tooMany.status, 2)
  assert.match(tooMany.stderr, /--count is capped at 16/)

  const noFile = beat(['source', 'gen', join(dir, 'nope.beat'), 'x', 'a prompt', '--count', '2', '--backend', 'stub'])
  assert.equal(noFile.status, 2)
  assert.match(noFile.stderr, /no \.beat file at/)

  assert.equal(readFileSync(beatFile, 'utf8'), before)
  assert.ok(!existsSync(join(dir, 'media')))
})

test('without --count, `beat source gen` still generates and registers in one step (unchanged)', (t) => {
  if (!hasPython) return t.skip('no python3')
  const { beatFile, dir } = freshProject()
  const out = beat(['source', 'gen', beatFile, 'pad', 'warm pad', '--backend', 'stub', '--seconds', '1', '--seed', '42'])
  assert.equal(out.status, 0, out.stderr)
  assert.match(out.stdout, /registered pad/)
  assert.ok(existsSync(join(dir, 'media', 'pad.wav')), 'the single-shot path registers immediately, as it always has')
  assert.ok(existsSync(join(dir, 'media', 'pad.wav.json')))
  assert.match(readFileSync(beatFile, 'utf8'), /sample pad/)
  assert.ok(!existsSync(defaultGenBatchDir(beatFile, 'pad', 42)), 'and makes no batch dir')
})

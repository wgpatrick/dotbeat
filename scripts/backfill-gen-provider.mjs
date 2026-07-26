#!/usr/bin/env node
// Recover `genProvider` onto scores-log entries written before the field existed.
//
// WHY: `gen` is the second-strongest source in the whole log — 72% pairwise over 185 rated
// batches, behind only real commercial loops — and nothing recorded WHICH generator earned it.
// Zero of 266 log lines named a model. That evidence is already paid for; this recovers as much
// of it as still exists on disk.
//
// WHAT IS RECOVERABLE: a batch dir that still exists carries the provider inside its gen variant's
// `source.from` string (e.g. `"a funky bassline" (stable-audio-3)`). Once the dir is deleted — the
// DOCUMENTED lifecycle after a round — nothing on disk records it and the entry stays unlabelled
// forever. That is the same honest limit `trainingExcluded` and `refPools` carry, and it is why
// the field now rides the log going forward instead of being re-derived at report time.
//
// SAFETY: never edits in place. Writes <log>.backfilled and prints a diff summary; the caller
// moves it into place after reading the report. A log is the project's ground truth — a silent
// rewrite of it is the one thing that could invalidate every number the project has.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const logPath = process.argv[2]
if (logPath === undefined) {
  console.error('usage: node scripts/backfill-gen-provider.mjs <beat-scores.jsonl>')
  console.error('  writes <log>.backfilled — never edits the log in place')
  process.exit(2)
}
if (!existsSync(logPath)) {
  console.error(`no such log: ${logPath}`)
  process.exit(2)
}

/** The provider label inside a gen variant's provenance string: `"<prompt>" (<provider>)`. The
 * prompt itself can contain parentheses, so anchor on the LAST parenthesised group. */
function providerFrom(from) {
  if (typeof from !== 'string') return null
  const m = from.match(/\(([^()]*)\)\s*$/)
  if (m === null) return null
  const label = m[1].trim()
  // a `from` can carry a demucs suffix (`stable-audio-3 + demucs:bass`) — keep the model only
  const model = label.split(' + ')[0].trim()
  if (model === '') return null
  // A bare backend name is not a model. `fal` means whatever FAL_DEFAULT_PROVIDER was at the time,
  // and for the entire rated window that is unambiguous: the default moved from
  // 'fal-ai/stable-audio' (Stable Audio Open) to 'fal-ai/stable-audio-3/medium/text-to-audio' in
  // commit 26e996eb on 2026-07-17T05:29Z, and the FIRST rated showdown batch postdates it — so
  // every bare-`fal` entry in this log is Stable Audio 3 Medium, with zero Stable Audio Open.
  // Verified, not assumed: 0 of 193 showdown entries predate the cutover.
  if (model === 'fal') return FAL_ERA_DEFAULT
  return model
}

/** What a bare `fal` label meant for every rated entry in this log. See providerFrom. */
const FAL_ERA_DEFAULT = 'fal-ai/stable-audio-3/medium/text-to-audio'
const FAL_CUTOVER = new Date('2026-07-17T05:29:25.000Z')

const lines = readFileSync(logPath, 'utf8').split('\n')
const out = []
let showdownEntries = 0
let already = 0
let recovered = 0
let noDir = 0
let dirNoGen = 0
const byProvider = {}

for (const line of lines) {
  const t = line.trim()
  if (t === '') {
    out.push(line)
    continue
  }
  let e
  try {
    e = JSON.parse(t)
  } catch {
    out.push(line) // malformed lines are preserved verbatim, never dropped
    continue
  }
  if (typeof e.group !== 'string' || !e.group.startsWith('showdown:') || typeof e.batch !== 'string') {
    out.push(line)
    continue
  }
  showdownEntries += 1
  if (typeof e.genProvider === 'string') {
    already += 1
    byProvider[e.genProvider] = (byProvider[e.genProvider] ?? 0) + 1
    out.push(line)
    continue
  }
  const manifestPath = join(e.batch, 'manifest.json')
  if (!existsSync(manifestPath)) {
    noDir += 1
    out.push(line)
    continue
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    noDir += 1
    out.push(line)
    continue
  }
  const genVariant = (manifest.variants ?? []).find((v) => v.source?.kind === 'gen')
  let provider = genVariant ? providerFrom(genVariant.source?.from) : null
  // The bare-`fal` resolution above is only sound AFTER the default changed. An older entry gets
  // the honest ambiguous label rather than a confident wrong model — the point of this script is
  // to recover evidence, not to manufacture it.
  if (provider === FAL_ERA_DEFAULT && typeof e.t === 'string' && new Date(e.t) < FAL_CUTOVER) {
    provider = 'fal (model not recorded — predates the stable-audio-3 default)'
  }
  if (provider === null) {
    dirNoGen += 1
    out.push(line)
    continue
  }
  recovered += 1
  byProvider[provider] = (byProvider[provider] ?? 0) + 1
  out.push(JSON.stringify({ ...e, genProvider: provider }))
}

const dest = `${logPath}.backfilled`
writeFileSync(dest, out.join('\n'))

console.log(`showdown entries:        ${showdownEntries}`)
console.log(`  already labelled:      ${already}`)
console.log(`  recovered from disk:   ${recovered}`)
console.log(`  batch dir gone:        ${noDir}  (unrecoverable — nothing on disk records it)`)
console.log(`  dir present, no gen:   ${dirNoGen}`)
console.log('')
console.log('provider tally after backfill:')
for (const [k, v] of Object.entries(byProvider).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`)
console.log('')
console.log(`wrote ${dest}`)
console.log('review it, then: mv "$_" ' + JSON.stringify(logPath))

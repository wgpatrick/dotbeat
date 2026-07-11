#!/usr/bin/env node
// Freesound CC0 ingestion pipeline (docs/phase-7-plan.md §7.4, research 07/09).
//
//   FREESOUND_API_KEY=... node scripts/freesound-cc0.mjs "kick drum" --count 6 --out-dir candidates/kick
//
// Searches Freesound APIv2 HARD-FILTERED to license:"Creative Commons 0" (the only subset
// research 07 verified as redistributable), pulls each candidate's HQ preview, preps it through
// the same trim/fade/normalize path as every bundled one-shot, and writes a per-file provenance
// sidecar (Freesound ID, uploader, license URL, retrieval date, quality tier).
//
// Two deliberate boundaries:
// - QUALITY TIER: token auth only reaches the 128kbps MP3 previews; original-quality files need
//   an OAuth2 browser consent flow. Preview-grade candidates are for AUDITIONING (vary/score
//   style); anything promoted into presets/ should be re-fetched at original quality via OAuth
//   and its sidecar updated. Every sidecar records which tier it is.
// - The API key comes from the environment, never from a file in the repo.

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAccessToken } from './freesound-oauth.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const key = process.env.FREESOUND_API_KEY
if (!key) {
  console.error('set FREESOUND_API_KEY (get one at freesound.org/apiv2/apply)')
  process.exit(2)
}

const args = process.argv.slice(2)
const query = args.find((a) => !a.startsWith('--'))
if (!query) {
  console.error('usage: freesound-cc0.mjs "<query>" [--count 6] [--dur-min 0.05] [--dur-max 1.5] [--out-dir candidates]')
  process.exit(2)
}
const flag = (name, dflt) => {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] : dflt
}
const wantOriginal = args.includes('--original')
const count = Number(flag('--count', '6'))
const durMin = Number(flag('--dur-min', '0.05'))
const durMax = Number(flag('--dur-max', '1.5'))
const outDir = flag('--out-dir', `freesound-${query.replace(/\s+/g, '-')}`)

const filter = `license:"Creative Commons 0" duration:[${durMin} TO ${durMax}]`
const fields = 'id,name,username,license,duration,type,avg_rating,num_ratings,tags,previews,url,download'
const searchUrl =
  `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(query)}` +
  `&filter=${encodeURIComponent(filter)}&fields=${fields}&sort=rating_desc&page_size=${Math.min(count * 3, 50)}&token=${key}`

// --original: full-quality files via OAuth2 (scripts/freesound-oauth.mjs); falls back loudly.
let bearer = null
if (wantOriginal) {
  bearer = await getAccessToken()
  if (!bearer) {
    console.error('--original needs OAuth tokens — run: node scripts/freesound-oauth.mjs authorize')
    process.exit(2)
  }
}

const res = await fetch(searchUrl)
if (!res.ok) {
  console.error(`freesound search failed: ${res.status} ${await res.text()}`)
  process.exit(1)
}
const data = await res.json()
console.log(`${data.count} CC0 results for "${query}" (${filter}); taking top ${count} by rating`)

mkdirSync(outDir, { recursive: true })
const tier = wantOriginal ? 'original (OAuth2)' : 'preview-hq-mp3 (128kbps) — audition grade; re-fetch originals via OAuth2 (--original) before bundling'
const manifest = { query, filter, retrievedAt: new Date().toISOString(), qualityTier: tier, candidates: [] }

let taken = 0
for (const s of data.results) {
  if (taken >= count) break
  // every candidate double-checked against the exact CC0 URL — never trust the filter alone
  if (s.license !== 'http://creativecommons.org/publicdomain/zero/1.0/') continue
  const preview = s.previews?.['preview-hq-mp3']
  if (!preview && !wantOriginal) continue
  const slug = `fs${s.id}`
  const rawPath = join(outDir, `${slug}.raw.${wantOriginal ? s.type : 'mp3'}`)
  const outPath = join(outDir, `${slug}.wav`)
  try {
    const audio = wantOriginal
      ? await fetch(s.download, { headers: { Authorization: `Bearer ${bearer}` } })
      : await fetch(preview)
    if (!audio.ok) {
      console.error(`  skipped #${s.id}: fetch ${audio.status}`)
      continue
    }
    writeFileSync(rawPath, Buffer.from(await audio.arrayBuffer()))
    execFileSync(process.execPath, [
      join(root, 'scripts/prep-oneshot.mjs'), rawPath, outPath,
      '--license', 'CC0-1.0',
      '--source', `Freesound #${s.id} "${s.name}" by ${s.username} (${s.url}); license verified ${s.license}; ${wantOriginal ? 'ORIGINAL quality (OAuth2)' : 'preview-hq-mp3 quality tier'}`,
    ], { stdio: ['ignore', 'inherit', 'inherit'] })
    rmSync(rawPath)
    // enrich the sidecar with the structured provenance fields
    const sidecar = JSON.parse(readFileSync(outPath + '.json', 'utf8'))
    sidecar.freesound = { id: s.id, name: s.name, username: s.username, url: s.url, licenseUrl: s.license, avgRating: s.avg_rating, numRatings: s.num_ratings, tags: s.tags?.slice(0, 8), duration: s.duration, qualityTier: wantOriginal ? 'original' : 'preview-hq-mp3' }
    writeFileSync(outPath + '.json', JSON.stringify(sidecar, null, 2) + '\n')
    manifest.candidates.push({ file: `${slug}.wav`, id: s.id, name: s.name, by: s.username, rating: s.avg_rating })
    taken++
  } catch (err) {
    console.error(`  skipped #${s.id}: ${err.message}`)
  }
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`${taken} candidates prepped into ${outDir}/ (${wantOriginal ? 'ORIGINAL quality' : 'audition grade'} — see manifest.json)`)

// Research/127 Part B — the screening round. Generates 10 loops per backend across roles
// (3 bassline, 3 chords, 2 lead, 2 drum-loop), the SAME prompt+BPM+seed per slot across the four
// backends, via the gen-fal adapter table. Real fal spend. Outputs land OUTSIDE the repo in the
// PRIVATE dataset dir; a per-provider manifest.json records prompt/seed/cost/timing/model-id and
// the rights tags. RESUMABLE: a slot whose trimmed wav already exists is skipped, so a harness
// stall never double-spends. Run: `node scripts/gen-bakeoff-run.mjs` with FAL_KEY set.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

const dist = (p) => pathToFileURL(join(process.cwd(), 'dist', p)).href
const { runGenFal } = await import(dist('src/analysis/gen-fal.js'))
const { genSubjectVaried } = await import(dist('src/taste/seeds.js'))
const { mulberry32 } = await import(dist('src/taste/eval.js'))

const OUT_ROOT = join(homedir(), 'Documents', 'dotbeat', 'taste-dataset', 'gen-bakeoff')
const BARS = 4

// One BPM per slot, used across ALL backends (fair comparison; the showdown pins gen to the
// composed clips the same way). Seed per slot feeds the seed-capable backends (SA-3, lyria2);
// minimax/elevenlabs ignore seed but the slot's prompt is identical regardless.
const SLOT_DEFS = [
  { slot: 'bassline1', role: 'bassline', id: 'bassline', bpm: 122 },
  { slot: 'bassline2', role: 'bassline', id: 'bassline', bpm: 128 },
  { slot: 'bassline3', role: 'bassline', id: 'bassline', bpm: 115 },
  { slot: 'chords1', role: 'chords', id: 'chords', bpm: 120 },
  { slot: 'chords2', role: 'chords', id: 'chords', bpm: 124 },
  { slot: 'chords3', role: 'chords', id: 'chords', bpm: 118 },
  { slot: 'lead1', role: 'lead', id: 'melody', bpm: 126 },
  { slot: 'lead2', role: 'lead', id: 'melody', bpm: 122 },
  { slot: 'drum1', role: 'drum-loop', id: 'drumloop', bpm: 128 },
  { slot: 'drum2', role: 'drum-loop', id: 'drumloop', bpm: 90 },
]

// Build the fixed per-slot prompt ONCE (identical across backends). A per-slot rng draws a
// PHRASE_VARIANTS entry + its isolation clause (genSubjectVaried); deterministic rejection sampling
// (bump the seed until the subject is new within the role) guarantees the 2-3 slots of a role are
// distinct genres, not the same one at two BPMs. Seconds is the exact 4-bar length at the slot BPM
// so short-duration backends (elevenlabs music_length_ms, SA-3 duration) generate the right length
// and the downbeat trim only has to align, not shorten hard.
const usedByRole = new Map()
const SLOTS = SLOT_DEFS.map((d, i) => {
  const seen = usedByRole.get(d.role) ?? new Set()
  let subject = ''
  for (let attempt = 0; attempt < 40; attempt++) {
    subject = genSubjectVaried(d.id, mulberry32(2000 + i * 149 + attempt)).subject
    if (!seen.has(subject)) break
  }
  seen.add(subject); usedByRole.set(d.role, seen)
  const seconds = Math.round((BARS * 4 * 60) / d.bpm)
  return { ...d, index: i, seed: 41 + i, seconds, prompt: `${subject}, ${d.bpm} BPM` }
})

const BACKENDS = [
  { slug: 'stable-audio-3', provider: 'fal-ai/stable-audio-3/medium/text-to-audio', price: 0.0376 },
  { slug: 'lyria2', provider: 'fal-ai/lyria2', price: 0.10 },
  { slug: 'minimax-v2.6', provider: 'fal-ai/minimax-music/v2.6', price: 0.15 },
  { slug: 'elevenlabs-music', provider: 'fal-ai/elevenlabs/music', price: 0.80 },
]

async function main() {
  if (!process.env.FAL_KEY && !process.env.FAL_API_KEY) { console.error('FAL_KEY not set'); process.exit(1) }
  mkdirSync(OUT_ROOT, { recursive: true })
  let totalSpend = 0
  let generated = 0
  const grand = []
  for (const backend of BACKENDS) {
    const dir = join(OUT_ROOT, backend.slug)
    mkdirSync(dir, { recursive: true })
    const manPath = join(dir, 'manifest.json')
    const manifest = existsSync(manPath) ? JSON.parse(readFileSync(manPath, 'utf8')) : { provider: backend.provider, model: backend.provider, pricePerClip: backend.price, clips: {} }
    manifest.clips ??= {}
    for (const s of SLOTS) {
      const outPath = join(dir, `${s.slot}.wav`)
      const rawOutPath = join(dir, `${s.slot}.raw.wav`)
      // Resume: skip any slot whose trimmed wav is already ON DISK — that clip was already paid for,
      // never re-call fal for it (a manifest record may be missing if a prior run died between the
      // download and the manifest write; the file's existence is the money-spent truth). Only a
      // recorded error with NO file re-generates.
      if (existsSync(outPath)) {
        console.log(`skip ${backend.slug}/${s.slot} (wav on disk — already paid)`)
        if (manifest.clips[s.slot] && !manifest.clips[s.slot].error) grand.push({ backend: backend.slug, ...manifest.clips[s.slot] })
        continue
      }
      const t0 = Date.now()
      const rec = { slot: s.slot, role: s.role, prompt: s.prompt, bpm: s.bpm, seed: s.seed, seconds: s.seconds, cost: backend.price }
      try {
        const meta = await runGenFal({ prompt: s.prompt, seconds: s.seconds, seed: s.seed, provider: backend.provider, bpm: s.bpm, bars: BARS, outPath, rawOutPath })
        rec.latencyMs = Date.now() - t0
        rec.model = meta.model
        rec.sampleRate = meta.sampleRate
        rec.watermark = meta.watermark ?? null
        rec.trainingExcluded = meta.trainingExcluded ?? false
        rec.trimOffsetSeconds = meta.trimOffsetSeconds ?? null
        rec.trimmedSeconds = meta.trimmedSeconds ?? null
        rec.rawKept = meta.rawOutPath ? true : false
        totalSpend += backend.price
        generated += 1
        console.log(`ok   ${backend.slug}/${s.slot} ${rec.latencyMs}ms trimmed=${rec.trimmedSeconds}s off=${rec.trimOffsetSeconds}s`)
      } catch (err) {
        rec.error = err instanceof Error ? err.message : String(err)
        rec.latencyMs = Date.now() - t0
        console.error(`FAIL ${backend.slug}/${s.slot}: ${rec.error}`)
      }
      manifest.clips[s.slot] = rec
      writeFileSync(manPath, JSON.stringify(manifest, null, 2) + '\n') // persist after EVERY clip
      grand.push({ backend: backend.slug, ...rec })
    }
  }
  writeFileSync(join(OUT_ROOT, 'slots.json'), JSON.stringify(SLOTS, null, 2) + '\n')
  console.log(`\nDONE — ${generated} clips generated this run, ~$${totalSpend.toFixed(2)} spent this run.`)
  const fails = grand.filter((g) => g.error)
  console.log(`failures/refusals: ${fails.length}`)
  for (const f of fails) console.log(`  ${f.backend}/${f.slot}: ${f.error}`)
}

main().catch((e) => { console.error(e); process.exit(1) })

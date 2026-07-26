// Research/127 Part B — score the screening clips and print the comparison table. Per backend per
// role: Audiobox-Aesthetics PQ/CE means, DSP LUFS/width/air means, generation latency, cost, and
// failure count. Reads the per-provider manifest.json (latency/cost/error) written by the runner
// and the trimmed wavs (DSP + aes). Set BEAT_PYTHON at the aes venv; HF_HUB_OFFLINE=1 to dodge the
// hub SSL retry hang (memory: hf-hub-hang-diagnostic). Writes comparison.json + prints a table.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

const dist = (p) => pathToFileURL(join(process.cwd(), 'dist', p)).href
const { featuresForAudioFile } = await import(dist('src/metrics/features.js'))
const { embedAudioFile } = await import(dist('src/taste/embeddings.js'))

const OUT_ROOT = join(homedir(), 'Documents', 'dotbeat', 'taste-dataset', 'gen-bakeoff')
const ROLES = ['bassline', 'chords', 'lead', 'drum-loop']
const AES = ['CE', 'CU', 'PC', 'PQ']
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : ' -- ')
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : ' -- ')

async function scoreClip(wav) {
  const out = { dsp: null, aes: null, aesErr: null }
  out.dsp = featuresForAudioFile(wav) // null if not a decodable WAV
  try {
    const r = await embedAudioFile(wav, { backend: 'aes' })
    out.aes = r.embedding // [CE, CU, PC, PQ]
  } catch (e) { out.aesErr = e instanceof Error ? e.message : String(e) }
  return out
}

async function main() {
  const backends = readdirSync(OUT_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  const table = {} // backend -> role -> aggregates
  const perClip = []
  for (const backend of backends) {
    const dir = join(OUT_ROOT, backend)
    const manPath = join(dir, 'manifest.json')
    if (!existsSync(manPath)) continue
    const man = JSON.parse(readFileSync(manPath, 'utf8'))
    table[backend] = {}
    for (const role of ROLES) {
      const slots = Object.values(man.clips).filter((c) => c.role === role)
      const ok = slots.filter((c) => !c.error)
      const fails = slots.filter((c) => c.error)
      const aesAxes = { CE: [], CU: [], PC: [], PQ: [] }
      const lufs = [], width = [], air = []
      for (const c of ok) {
        const wav = join(dir, `${c.slot}.wav`)
        if (!existsSync(wav)) continue
        const s = await scoreClip(wav)
        if (s.dsp) { lufs.push(s.dsp.lufs); width.push(s.dsp.stereoWidthDb); air.push(s.dsp.bandAirPct) }
        if (s.aes) AES.forEach((a, i) => aesAxes[a].push(s.aes[i]))
        perClip.push({ backend, ...c, dsp: s.dsp, aes: s.aes, aesErr: s.aesErr })
      }
      table[backend][role] = {
        n: ok.length, failures: fails.length,
        latencyMs: mean(ok.map((c) => c.latencyMs).filter(Number.isFinite)),
        cost: ok.reduce((a, c) => a + (c.cost || 0), 0),
        PQ: mean(aesAxes.PQ), CE: mean(aesAxes.CE), CU: mean(aesAxes.CU), PC: mean(aesAxes.PC),
        lufs: mean(lufs), widthDb: mean(width), airPct: mean(air),
      }
    }
  }
  writeFileSync(join(OUT_ROOT, 'comparison.json'), JSON.stringify({ table, perClip }, null, 2) + '\n')

  // print
  console.log('\n=== gen-backend bake-off — screening comparison (research/127 Part B) ===\n')
  const hdr = ['backend', 'role', 'n', 'fail', 'PQ', 'CE', 'CU', 'PC', 'LUFS', 'widthDb', 'air%', 'lat(s)', '$']
  console.log(hdr.map((h) => h.padEnd(h === 'backend' ? 17 : h === 'role' ? 10 : 7)).join(''))
  for (const backend of backends) {
    if (!table[backend]) continue
    for (const role of ROLES) {
      const t = table[backend][role]; if (!t) continue
      console.log([
        backend.padEnd(17), role.padEnd(10), String(t.n).padEnd(7), String(t.failures).padEnd(7),
        f2(t.PQ).padEnd(7), f2(t.CE).padEnd(7), f2(t.CU).padEnd(7), f2(t.PC).padEnd(7),
        f1(t.lufs).padEnd(7), f1(t.widthDb).padEnd(7), f2(t.airPct).padEnd(7),
        f1((t.latencyMs || 0) / 1000).padEnd(7), t.cost.toFixed(2),
      ].join(''))
    }
  }
  // per-backend overall
  console.log('\n--- per-backend overall (mean across roles, total spend) ---')
  for (const backend of backends) {
    if (!table[backend]) continue
    const rows = ROLES.map((r) => table[backend][r]).filter(Boolean)
    const allPQ = [], allCE = []
    for (const r of rows) { if (Number.isFinite(r.PQ)) allPQ.push(r.PQ); if (Number.isFinite(r.CE)) allCE.push(r.CE) }
    const spend = rows.reduce((a, r) => a + r.cost, 0)
    const fails = rows.reduce((a, r) => a + r.failures, 0)
    console.log(`${backend.padEnd(17)} PQ ${f2(mean(allPQ))}  CE ${f2(mean(allCE))}  failures ${fails}  spend $${spend.toFixed(2)}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })

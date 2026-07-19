#!/usr/bin/env node
// beat rate — the taste data-collection rating UI (owner decision 2026-07-17): a tiny local web
// app over a directory of rendered vary batches. Blind by construction (variants are shown as
// A/B/C... in an order shuffled with the batch's own seed, same mulberry32 convention as the
// audition flow), one batch per screen, picks written through the SAME scoreBatch() path the CLI
// uses — one beat-scores.jsonl at the collection root, so `beat taste-eval --log <root>/...`
// reads it with zero translation. No dependencies: node http + inline HTML.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, normalize } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Recursively find batch dirs (manifest.json + all vN.wav present) under root. */
function findBatches(root, batch) {
  const out = []
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    if (entries.some((e) => e.name === 'manifest.json')) {
      try {
        const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
        const wavs = manifest.variants.map((v) => v.file.replace(/\.beat$/, '.wav'))
        if (wavs.length >= 2 && wavs.every((w) => existsSync(join(dir, w)))) out.push({ dir, manifest, wavs })
      } catch { /* not a batch manifest — keep walking */ }
      return // batch dirs don't nest
    }
    for (const e of entries) if (e.isDirectory() && e.name !== 'media' && !e.name.startsWith('.')) walk(join(dir, e.name))
  }
  walk(root)
  return out.sort((a, b) => a.dir.localeCompare(b.dir))
}

function scoredBatchDirs(logPath) {
  const scored = new Set()
  if (!existsSync(logPath)) return scored
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    try {
      const e = JSON.parse(line)
      if (typeof e.batch === 'string' && Array.isArray(e.picks)) scored.add(resolve(e.batch))
    } catch { /* non-entry line */ }
  }
  return scored
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>beat rate</title>
<style>
  body{font:16px/1.5 system-ui;margin:0;background:#181a1f;color:#e6e6e6;display:flex;min-height:100vh;align-items:center;justify-content:center}
  main{max-width:640px;width:100%;padding:24px}
  h1{font-size:15px;color:#9aa0ab;font-weight:500;margin:0 0 4px}
  .prog{color:#61afef;font-size:13px;margin-bottom:16px}
  .v{display:flex;align-items:center;gap:12px;background:#22252c;border-radius:10px;padding:10px 14px;margin:8px 0;border:2px solid transparent}
  .v.r1{border-color:#98c379}.v.r2{border-color:#61afef}.v.r3{border-color:#c678dd}
  .v b{width:28px;font-size:18px}
  .v audio{flex:1;height:36px}
  .v button{background:#2c313a;color:#e6e6e6;border:0;border-radius:8px;padding:8px 12px;cursor:pointer}
  .v .rank{width:56px;text-align:center;color:#98c379;font-size:13px}
  .bar{display:flex;gap:10px;margin-top:16px}
  .bar button{flex:1;padding:12px;border:0;border-radius:10px;cursor:pointer;font-size:15px}
  #submit{background:#98c379;color:#111}
  #skip,#clear{background:#2c313a;color:#e6e6e6}
  #done{color:#98c379;font-size:18px;text-align:center}
  .hint{color:#6b7280;font-size:12px;margin-top:12px}
</style>
<main>
  <h1 id="title">loading…</h1><div class="prog" id="prog"></div>
  <div id="list"></div>
  <div class="bar"><button id="submit">save ranking</button><button id="clear">clear</button><button id="skip">skip batch</button></div>
  <div class="hint">click "pick" in preference order (best first, up to 3) — letters are shuffled per batch, so listen, don't pattern-match. keys: 1-9 pick, enter save, s skip.</div>
  <div class="hint" id="sinkrow">output: <select id="sink"><option value="">system default</option></select>
    <button id="sinkbtn" title="list this machine's outputs (asks a one-time permission so device names show)">find headphones…</button>
    — moves ONLY this page's audio; the rest of the system stays where it was.</div>
</main>
<script>
let queue=[],idx=0,picks=[]
const $=(id)=>document.getElementById(id)
async function load(){queue=await (await fetch('/api/queue')).json();idx=0;show()}
function show(){
  picks=[]
  if(idx>=queue.length){document.querySelector('main').innerHTML='<div id="done">all '+queue.length+' batches rated — thank you, the taste model appreciates it. safe to close.</div>';return}
  const b=queue[idx]
  $('title').textContent=b.label
  $('prog').textContent='batch '+(idx+1)+' of '+queue.length
  $('list').innerHTML=b.order.map((v,i)=>{
    const letter=String.fromCharCode(65+i)
    return '<div class="v" id="v'+i+'"><b>'+letter+'</b><audio controls preload="none" src="/audio?b='+encodeURIComponent(b.id)+'&f='+encodeURIComponent(v)+'"></audio><span class="rank" id="r'+i+'"></span><button onclick="togglePick('+i+')">pick</button></div>'
  }).join('')
  applySink()
}
function paint(){
  const b=queue[idx]
  b.order.forEach((_,i)=>{const el=$('v'+i);el.className='v'+(picks.includes(i)?' r'+(picks.indexOf(i)+1):'');$('r'+i).textContent=picks.includes(i)?['best','2nd','3rd'][picks.indexOf(i)]:''})
}
function togglePick(i){
  const at=picks.indexOf(i)
  if(at!==-1)picks.splice(at,1)
  else if(picks.length<3)picks.push(i)
  paint()
}
async function submit(){
  if(picks.length===0)return
  const b=queue[idx]
  const res=await fetch('/api/score',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:b.id,picks:picks.map(i=>b.order[i])})})
  if(!res.ok){alert('save failed: '+await res.text());return}
  idx++;show()
}
$('submit').onclick=submit
$('clear').onclick=()=>{picks=[];paint()}
$('skip').onclick=()=>{idx++;show()}
// Per-page audio output (setSinkId): rate through Bluetooth headphones while the system default
// (someone else's audio) stays on another device. Labels need a one-time mic permission grant —
// Chrome only exposes device names after getUserMedia; the stream is stopped immediately.
let sinkId=localStorage.getItem('rateSink')||''
async function populateSinks(unlock){
  if(!('setSinkId' in HTMLMediaElement.prototype)){$('sinkrow').style.display='none';return}
  try{
    if(unlock){const s=await navigator.mediaDevices.getUserMedia({audio:true});s.getTracks().forEach(t=>t.stop())}
    const outs=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audiooutput')
    $('sink').innerHTML='<option value="">system default</option>'+outs.map(d=>
      '<option value="'+d.deviceId+'"'+(d.deviceId===sinkId?' selected':'')+'>'+(d.label||'output '+d.deviceId.slice(0,6))+'</option>').join('')
  }catch(e){/* permission denied: selector keeps whatever it has */}
}
function applySink(){document.querySelectorAll('audio').forEach(a=>{if(a.setSinkId)a.setSinkId(sinkId).catch(()=>{})})}
$('sink').onchange=()=>{sinkId=$('sink').value;localStorage.setItem('rateSink',sinkId);applySink()}
$('sinkbtn').onclick=()=>populateSinks(true)
if(navigator.mediaDevices)navigator.mediaDevices.addEventListener?.('devicechange',()=>populateSinks(false))
populateSinks(false)
document.addEventListener('keydown',(e)=>{
  if(e.key==='Enter')submit()
  else if(e.key==='s')(idx++,show())
  else if(/^[1-9]$/.test(e.key)){const i=Number(e.key)-1;if(queue[idx]&&i<queue[idx].order.length)togglePick(i)}
})
load()
</script>`

export async function rateCommand(argv) {
  // Pilot 112 (MEDIUM): a typo'd flag (--prot 4520) used to be silently ignored — the server
  // bound the default port while the user waited on a dead one. Same loud-error stance as
  // render/vary/taste-eval after pilots 109-111.
  for (const a of argv) {
    if (a.startsWith('--') && a !== '--port' && a !== '--log') {
      console.error(`error: unknown flag "${a}" (known: --port, --log)`)
      process.exit(2)
    }
  }
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--port' && argv[i - 1] !== '--log')
  const root = resolve(positional[0] ?? '.')
  const portIdx = argv.indexOf('--port')
  const port = portIdx !== -1 ? Number(argv[portIdx + 1]) : 4321
  const logIdx = argv.indexOf('--log')
  const logPath = resolve(logIdx !== -1 ? argv[logIdx + 1] : join(root, 'beat-scores.jsonl'))
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`error: no directory at ${root}`)
    process.exit(2)
  }
  const { scoreBatch } = await import(pathToFileURL(join(repoRoot, 'dist/src/vary/batch.js')).href)
  const { shuffledOrder } = await import(pathToFileURL(join(repoRoot, 'dist/src/vary/audition.js')).href)

  const buildQueue = () => {
    const scored = scoredBatchDirs(logPath)
    return findBatches(root).filter((b) => !scored.has(resolve(b.dir))).map((b) => ({
      id: b.dir,
      label: b.manifest.prompt ? `generated: "${b.manifest.prompt}"` : `${b.manifest.track ?? ''} ${b.manifest.group} (seed ${b.manifest.seed})`.trim(),
      // blind: seeded shuffle, same convention as the audition flow (1-based variant numbers)
      order: shuffledOrder(b.wavs.length, b.manifest.seed).map((i) => b.wavs[i - 1]),
    }))
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`)
    try {
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE)
      } else if (url.pathname === '/api/queue') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(buildQueue()))
      } else if (url.pathname === '/audio') {
        const batchDir = resolve(url.searchParams.get('b') ?? '')
        const file = normalize(url.searchParams.get('f') ?? '')
        const full = resolve(batchDir, file)
        // path discipline: only wavs inside a batch dir inside the scanned root
        if (!batchDir.startsWith(root) || !full.startsWith(batchDir) || !full.endsWith('.wav') || !existsSync(full)) {
          res.writeHead(404).end('not found')
          return
        }
        res.writeHead(200, { 'content-type': 'audio/wav' }).end(readFileSync(full))
      } else if (url.pathname === '/api/score' && req.method === 'POST') {
        let body = ''
        for await (const chunk of req) body += chunk
        const { id, picks } = JSON.parse(body)
        const batchDir = resolve(id)
        if (!batchDir.startsWith(root)) {
          res.writeHead(400).end('batch outside root')
          return
        }
        if (!Array.isArray(picks) || picks.length === 0) {
          res.writeHead(400).end('picks must be a non-empty array')
          return
        }
        // picks arrive as wav filenames in preference order; scoreBatch wants variant refs.
        // A bad pick is the CLIENT's error (pilot 112: it used to 500) — scoreBatch's own
        // message is already the useful part.
        let result
        try {
          result = scoreBatch(batchDir, picks.map((w) => String(w).replace(/\.wav$/, '')), logPath)
        } catch (scoreErr) {
          res.writeHead(400).end(String(scoreErr?.message ?? scoreErr))
          return
        }
        console.error(`scored ${batchDir}: ${picks.join(' > ')}`)
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, log: result.logPath ?? logPath }))
      } else {
        res.writeHead(404).end('not found')
      }
    } catch (err) {
      res.writeHead(500).end(String(err?.message ?? err))
    }
  })
  const initial = buildQueue()
  if (initial.length === 0) {
    // Pilot 112: this used to start a server whose page cheerfully said "all 0 batches rated".
    console.error(`nothing to rate: no unscored rendered batches under ${root}`)
    console.error(`generate some first: beat taste-seeds <dir> && beat taste-collect <dir> — or point at a dir of rendered vary batches`)
    process.exit(1)
  }
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`error: port ${port} is already in use — pass --port <other> (is another beat rate still running?)`)
      process.exit(2)
    }
    console.error(`error: ${err.message}`)
    process.exit(1)
  })
  server.listen(port, '127.0.0.1', () => {
    console.error(`rating ${initial.length} unscored batch(es) under ${root}`)
    console.error(`scores -> ${logPath}`)
    console.error(`open http://localhost:${port} — ctrl-c here when done`)
  })
}

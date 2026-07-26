#!/usr/bin/env node
// beat rate — the taste data-collection rating UI (owner decision 2026-07-17): a tiny local web
// app over a directory of rendered vary batches. Blind by construction (variants are shown as
// A/B/C... in an order shuffled with the batch's own seed, same mulberry32 convention as the
// audition flow), one batch per screen, picks written through the SAME scoreBatch() path the CLI
// uses — one beat-scores.jsonl at the collection root, so `beat taste-eval --log <root>/...`
// reads it with zero translation. No dependencies: node http + inline HTML.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

// Exported so test/review-server.test.ts can assert the page's pick cap against the SCORER's cap
// (src/vary/batch.ts) — a page that invites more picks than the scorer accepts is exactly the M6
// bug, and a text-level constant nobody checks would drift straight back into it.
export const PAGE = `<!doctype html><meta charset="utf-8"><title>beat rate</title>
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
  #nonegood{background:#3a2c2c;color:#e6b0b0}
  #done{color:#98c379;font-size:18px;text-align:center}
  .hint{color:#6b7280;font-size:12px;margin-top:12px}
  .capmsg{color:#e5c07b;font-size:12px;min-height:18px;margin-top:8px}
</style>
<main>
  <h1 id="title">loading…</h1><div class="prog" id="prog"></div>
  <div id="list"></div>
  <div class="capmsg" id="capmsg"></div>
  <div class="bar"><button id="submit">save ranking</button><button id="clear">clear</button><button id="nonegood">none are good</button><button id="skip">skip batch</button></div>
  <div class="hint" id="caphint">click "pick" in preference order — <b>your top 3, best first</b> (that's all the scorer records; every unranked clip counts as below all three). letters are shuffled per batch, so listen, don't pattern-match. keys: 1-9 pick, enter save, n none-good, s skip.</div>
  <div class="hint">"none are good" records a verdict (all variants rejected) instead of forcing a pick or silently skipping — it's excluded from the taste model and win-rate math, and counted in the showdown report.</div>
  <div class="hint" id="sinkrow">output: <select id="sink"><option value="">system default</option></select>
    <button id="sinkbtn" title="list this machine's outputs (asks a one-time permission so device names show)">find headphones…</button>
    — moves ONLY this page's audio; the rest of the system stays where it was.</div>
</main>
<script>
// The scorer (src/vary/batch.ts scoreBatch) records AT MOST 3 ranked picks — the Edisyn (3,16)
// pattern. The page used to bind keys 1-9 and invite "rank as many as you can judge", so a rater
// working a 6-7 clip showdown would rank 4+, hit a 400 from /api/score, and see "save failed" with
// the whole batch's listening discarded. The cap now lives in ONE place on each side and they
// agree; lifting it is a data-math decision (see the report), not a UI tweak.
const MAX_PICKS=3
let queue=[],idx=0,picks=[]
const $=(id)=>document.getElementById(id)
async function load(){queue=await (await fetch('/api/queue')).json();idx=0;show()}
function show(){
  picks=[]
  if($('capmsg'))$('capmsg').textContent=''
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
  const ord=n=>n===0?'best':(n+1)+(['th','st','nd','rd'][((n+1)%100>10&&(n+1)%100<14)?0:Math.min((n+1)%10,4)]||'th')
  b.order.forEach((_,i)=>{const el=$('v'+i);el.className='v'+(picks.includes(i)?' r'+(picks.indexOf(i)+1):'');$('r'+i).textContent=picks.includes(i)?ord(picks.indexOf(i)):''})
}
function togglePick(i){
  const at=picks.indexOf(i)
  if(at!==-1){picks.splice(at,1);$('capmsg').textContent=''}
  else if(picks.length<Math.min(queue[idx].order.length,MAX_PICKS))picks.push(i)
  // At the cap, say so instead of swallowing the click — the old page ignored it silently and the
  // rater only found out at save time, after the batch was already listened through.
  else{$('capmsg').textContent='top '+MAX_PICKS+' only — unpick one to change your ranking. everything you don\\'t rank counts as below all '+MAX_PICKS+'.'}
  paint()
}
async function submit(){
  if(picks.length===0)return
  const b=queue[idx]
  const res=await fetch('/api/score',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:b.id,picks:picks.map(i=>b.order[i])})})
  if(!res.ok){alert('save failed: '+await res.text());return}
  idx++;show()
}
async function noneGood(){
  const b=queue[idx]
  if(!b)return
  if(!confirm('Mark ALL '+b.order.length+' clips in this batch as "none good"? This records a verdict (no pick) and moves on.'))return
  const res=await fetch('/api/none-good',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:b.id})})
  if(!res.ok){alert('save failed: '+await res.text());return}
  idx++;show()
}
$('submit').onclick=submit
$('clear').onclick=()=>{picks=[];$('capmsg').textContent='';paint()}
$('nonegood').onclick=noneGood
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
  else if(e.key==='n')noneGood()
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
  const { scoreBatch, recordNoneGood } = await import(pathToFileURL(join(repoRoot, 'dist/src/vary/batch.js')).href)
  const { shuffledOrder } = await import(pathToFileURL(join(repoRoot, 'dist/src/vary/audition.js')).href)
  // The shared server shell `beat board` uses too (src/serve/review-server.ts): page + /audio +
  // routing + the path-containment and CSRF guards, in ONE place so a fix can't land on one twin
  // and miss the other (research/130 T9/W2.9).
  const { createReviewServer, listenReviewServer, isInside, ReviewHttpError } = await import(
    pathToFileURL(join(repoRoot, 'dist/src/serve/review-server.js')).href
  )

  const buildQueue = () => {
    const scored = scoredBatchDirs(logPath)
    return findBatches(root).filter((b) => !scored.has(resolve(b.dir))).map((b) => ({
      id: b.dir,
      label: b.manifest.prompt ? `generated: "${b.manifest.prompt}"` : `${b.manifest.track ?? ''} ${b.manifest.group} (seed ${b.manifest.seed})`.trim(),
      // blind: seeded shuffle, same convention as the audition flow (1-based variant numbers)
      order: shuffledOrder(b.wavs.length, b.manifest.seed).map((i) => b.wavs[i - 1]),
    }))
  }

  /** A batch id from a POST body, checked for real containment in the scanned root. */
  const batchDirFrom = (id) => {
    const batchDir = resolve(String(id ?? ''))
    if (!isInside(root, batchDir)) throw new ReviewHttpError(400, 'batch outside root')
    return batchDir
  }

  const server = createReviewServer({
    root,
    page: PAGE,
    routes: {
      '/api/queue': { method: 'GET', handler: () => buildQueue() },
      '/api/score': {
        method: 'POST',
        handler: (body) => {
          const { id, picks } = body ?? {}
          const batchDir = batchDirFrom(id)
          if (!Array.isArray(picks) || picks.length === 0) throw new ReviewHttpError(400, 'picks must be a non-empty array')
          // picks arrive as wav filenames in preference order; scoreBatch wants variant refs.
          // A bad pick is the CLIENT's error (pilot 112: it used to 500) — scoreBatch's own
          // message is already the useful part.
          let result
          try {
            result = scoreBatch(batchDir, picks.map((w) => String(w).replace(/\.wav$/, '')), logPath)
          } catch (scoreErr) {
            throw new ReviewHttpError(400, String(scoreErr?.message ?? scoreErr))
          }
          console.error(`scored ${batchDir}: ${picks.join(' > ')}`)
          return { ok: true, log: result.logPath ?? logPath }
        },
      },
      '/api/none-good': {
        // "None of these are good" verdict: no pick, all variants rejected — recorded instead of
        // a silent skip so the signal survives. Same batch-dir path discipline as /api/score.
        method: 'POST',
        handler: (body) => {
          const batchDir = batchDirFrom((body ?? {}).id)
          let result
          try {
            result = recordNoneGood(batchDir, logPath)
          } catch (ngErr) {
            throw new ReviewHttpError(400, String(ngErr?.message ?? ngErr))
          }
          console.error(`none-good ${batchDir}: no pick, ${result.entry.rejected.length} variants rejected`)
          return { ok: true, log: result.logPath ?? logPath }
        },
      },
    },
  })
  const initial = buildQueue()
  if (initial.length === 0) {
    // Pilot 112: this used to start a server whose page cheerfully said "all 0 batches rated".
    console.error(`nothing to rate: no unscored rendered batches under ${root}`)
    console.error(`generate some first: beat taste-seeds <dir> && beat taste-collect <dir> — or point at a dir of rendered vary batches`)
    process.exit(1)
  }
  listenReviewServer(
    server,
    port,
    () => {
      console.error(`rating ${initial.length} unscored batch(es) under ${root}`)
      console.error(`scores -> ${logPath}`)
      console.error(`open http://localhost:${port} — ctrl-c here when done`)
    },
    'is another beat rate still running?',
  )
}

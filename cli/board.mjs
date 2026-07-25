#!/usr/bin/env node
// beat board — the option-board PICKING surface (research/128 §2.1, build item 1). The NON-BLIND
// sibling of `beat rate`: `rate` is blind MEASUREMENT into beat-scores.jsonl; `board` is named
// PRODUCTION decisions into beat-decisions.jsonl. Same self-contained node:http + inline-HTML
// pattern as rate.mjs (no build step, no React), but everything is shown in the open — provenance,
// params, measurements — because the point is the owner using taste to pick, not to measure blind.
//
// Alignment (owner directive, this build): the page borrows the daemon GUI's design tokens
// (ui/src/styles.css — amber accent, dark panels, mono readouts, uppercase section headings) so
// moving between the GUI and a board doesn't feel like leaving the product; provenance uses the
// GUI/manifest vocabulary verbatim (source.kind, recipe, provider). The SERVER logic below
// (findBoardBatches / buildBoardDetail / buildStatus) is kept cleanly separate from the PAGE
// string and from the decision core (src/board/decisions.ts) so the same machinery could later
// back a daemon route / in-GUI panel — the standalone sibling of the GUI's VaryAffordance bar —
// without rework.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, normalize } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---- server logic (no HTML) — reusable if a daemon route ever backs this ----------------------

/** Recursively find batch dirs (manifest.json + all rendered variant wavs present) under root —
 * the same scan `beat rate` does, resolving each variant through its manifest `file` (vN.beat for
 * vary, vN.wav for gen). A board needs at least one rendered candidate to audition. */
export function findBoardBatches(root) {
  const out = []
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    if (entries.some((e) => e.name === 'manifest.json')) {
      try {
        const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
        const wavs = manifest.variants.map((v) => v.file.replace(/\.beat$/, '.wav'))
        if (wavs.length >= 1 && wavs.every((w) => existsSync(join(dir, w)))) out.push({ dir, manifest, wavs })
      } catch { /* not a batch manifest — keep walking */ }
      return // batch dirs don't nest
    }
    for (const e of entries) if (e.isDirectory() && e.name !== 'media' && !e.name.startsWith('.')) walk(join(dir, e.name))
  }
  walk(root)
  return out.sort((a, b) => a.dir.localeCompare(b.dir))
}

/** A batch's display label — the same shape `beat rate` builds, in the same vocabulary. */
export function batchLabel(manifest) {
  return manifest.prompt
    ? `generated: "${manifest.prompt}"`
    : `${manifest.track ?? ''} ${manifest.group} (seed ${manifest.seed})`.trim()
}

/** Solo render for a variant's manifest `file`: "v3.beat" -> "v3.wav"; gen "v3.wav" -> "v3.wav". */
const soloWav = (file) => (file.endsWith('.wav') ? file : file.replace(/\.beat$/, '.wav'))
/** Optional in-context render, by convention next to the solo render: "v3.beat" -> "v3.context.wav".
 * Present only if a caller has rendered the candidate stitched into its surrounding bars; the
 * solo/in-context toggle appears only when EVERY candidate has one. */
const contextWav = (file) => file.replace(/\.(beat|wav)$/, '') + '.context.wav'

/** Human-readable projection of a variant's DSP feature vector (src/taste/features.ts) — the
 * measured features table the board shows (LUFS / crest / centroid / width / band shares). Keeps
 * the GUI's units: dB and Hz, not the training-space log2. */
function displayFeatures(fv) {
  if (!fv) return null
  return {
    lufs: fv.lufs,
    crestDb: fv.crestDb,
    centroidHz: Math.round(Math.pow(2, fv.centroidLog2)),
    widthDb: fv.stereoWidthDb,
    subPct: fv.bandSubPct,
    airPct: fv.bandAirPct,
  }
}

/** Full per-batch detail the page renders: candidates with NON-BLIND provenance (in manifest
 * order, not shuffled — this is the whole difference from rate) + the measured features table.
 * computeBatchFeatures is passed in so this stays a pure shaping function. */
export function buildBoardDetail(batch, computeBatchFeatures) {
  const { dir, manifest } = batch
  const rawFeatures = computeBatchFeatures(dir, manifest.variants.map((v) => v.file))
  const candidates = manifest.variants.map((v, i) => {
    const prov = {}
    if (v.source?.kind !== undefined) prov.sourceKind = v.source.kind
    if (v.source?.from !== undefined) prov.from = v.source.from
    if (v.recipe !== undefined) prov.recipe = v.recipe
    if (v.edits !== undefined && v.edits.length > 0) prov.edits = v.edits
    if (v.media !== undefined) {
      prov.mediaId = v.media.id
      if (v.media.source !== undefined) prov.provider = v.media.source
      if (v.media.license !== undefined) prov.license = v.media.license
      if (v.media.seed !== undefined) prov.mediaSeed = v.media.seed
    }
    const solo = soloWav(v.file)
    return {
      n: i + 1,
      file: v.file,
      label: `v${i + 1}`,
      provenance: prov,
      solo,
      context: existsSync(join(dir, contextWav(v.file))) ? contextWav(v.file) : null,
    }
  })
  const features = {}
  for (const [file, fv] of Object.entries(rawFeatures)) features[file] = displayFeatures(fv)
  return {
    id: dir,
    label: batchLabel(manifest),
    group: manifest.group,
    track: manifest.track ?? null,
    seed: manifest.seed,
    prompt: manifest.prompt ?? null,
    count: manifest.variants.length,
    warnLarge: manifest.variants.length > 4,
    hasContext: candidates.length > 0 && candidates.every((c) => c.context !== null),
    candidates,
    features,
  }
}

/** The `--status` report (no server): every rendered board batch under root, decided or not, plus
 * each decision — the shape the produce-song loop polls to learn "whose turn is it". */
export function buildStatus(root, decidedBatchDirs, readDecisionFile, logPath) {
  const decided = decidedBatchDirs(logPath)
  const batches = findBoardBatches(root).map(({ dir, manifest }) => {
    const decision = readDecisionFile(dir)
    const isDecided = decision !== null || decided.has(resolve(dir))
    return {
      batch: dir,
      label: batchLabel(manifest),
      group: manifest.group,
      count: manifest.variants.length,
      decided: isDecided,
      decision, // decision.json contents, or null when undecided
    }
  })
  return {
    root,
    log: logPath,
    total: batches.length,
    decided: batches.filter((b) => b.decided).length,
    undecided: batches.filter((b) => !b.decided).length,
    batches,
  }
}

// ---- the page (GUI-aligned; tokens borrowed from ui/src/styles.css) ---------------------------

const PAGE = `<!doctype html><meta charset="utf-8"><title>beat board</title>
<style>
  :root{
    --bg:#16171b;--panel:#1e2026;--panel-2:#23262e;--line:#2e3138;--text:#d8dbe2;--text-dim:#8a8f9a;
    --accent:#e0a13c;--danger:#e06c75;--good:#6ec97c;--surface-recessed:#14151a;
    --font-mono:ui-monospace,SFMono-Regular,Menlo,monospace;--label-tracking:0.05em;
    --radius-sm:3px;--radius-md:4px;--radius-lg:6px;color-scheme:dark;
  }
  /* graceful light fallback for a light-default system — the GUI is dark-first, so is this */
  @media (prefers-color-scheme: light){:root{
    --bg:#f2f3f5;--panel:#fff;--panel-2:#eceef1;--line:#d5d8de;--text:#1c1e24;--text-dim:#6a707c;
    --surface-recessed:#e7e9ec;color-scheme:light;
  }}
  *{box-sizing:border-box}
  body{font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;margin:0;background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased}
  main{max-width:760px;margin:0 auto;padding:22px 20px 60px}
  .brand{font-weight:700;letter-spacing:var(--label-tracking);font-size:15px;margin-bottom:2px}
  .brand::before{content:'●';color:var(--accent);margin-right:6px}
  .sub{color:var(--text-dim);font-size:12px;margin-bottom:14px}
  .prog{color:var(--accent);font-size:12px;font-weight:600;margin-bottom:4px;letter-spacing:var(--label-tracking)}
  h1{font-size:15px;font-weight:700;margin:0 0 12px}
  .warn{background:rgba(224,161,60,0.12);border:1px solid var(--accent);color:var(--text);border-radius:var(--radius-md);padding:8px 12px;font-size:12px;margin-bottom:12px}
  .cand{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-lg);padding:12px 14px;margin:10px 0}
  .cand.picked{border-color:var(--good);box-shadow:0 0 0 1px var(--good)}
  .cand-top{display:flex;align-items:center;gap:12px}
  .cand-top b{font-size:16px;font-weight:700;min-width:26px}
  .cand-top audio{flex:1;height:34px}
  .pickbtn{background:var(--panel-2);color:var(--text);border:1px solid var(--line);border-radius:var(--radius-md);padding:8px 14px;cursor:pointer;font-size:13px;font-weight:600}
  .pickbtn:hover{border-color:var(--good);color:var(--good)}
  .cand.picked .pickbtn{background:var(--good);color:#12140f;border-color:var(--good)}
  .prov{margin-top:8px;font-size:12px;color:var(--text-dim);display:flex;flex-wrap:wrap;gap:6px 14px}
  .prov .k{color:var(--text-dim);text-transform:uppercase;font-size:10px;letter-spacing:var(--label-tracking);font-weight:700;margin-right:4px}
  .prov .v{color:var(--text);font-family:var(--font-mono)}
  .prov-row{width:100%}
  .toggle{display:flex;gap:6px;margin:10px 0 4px}
  .toggle button{background:var(--surface-recessed);color:var(--text-dim);border:1px solid var(--line);border-radius:var(--radius-sm);padding:4px 10px;font-size:11px;cursor:pointer;letter-spacing:var(--label-tracking)}
  .toggle button.on{background:var(--accent);color:#1a1509;border-color:var(--accent);font-weight:700}
  .section-heading{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:var(--label-tracking);color:var(--text-dim);margin:20px 0 6px}
  table.feat{width:100%;border-collapse:collapse;font-family:var(--font-mono);font-size:12px;background:var(--surface-recessed);border-radius:var(--radius-md);overflow:hidden}
  table.feat th,table.feat td{padding:6px 9px;text-align:right;border-bottom:1px solid var(--line)}
  table.feat th:first-child,table.feat td:first-child{text-align:left}
  table.feat thead th{color:var(--text-dim);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:var(--label-tracking)}
  table.feat tbody tr:last-child td{border-bottom:0}
  .note{width:100%;margin-top:16px;background:var(--surface-recessed);color:var(--text);border:1px solid var(--line);border-radius:var(--radius-md);padding:9px 11px;font:13px/1.4 inherit;resize:vertical;min-height:44px}
  .note::placeholder{color:var(--text-dim)}
  .bar{display:flex;gap:10px;margin-top:12px}
  .bar button{flex:1;padding:11px;border:1px solid var(--line);border-radius:var(--radius-md);cursor:pointer;font-size:13px;font-weight:600;background:var(--panel-2);color:var(--text)}
  #reject{background:rgba(224,108,117,0.14);border-color:var(--danger);color:var(--danger)}
  #reject:hover{background:var(--danger);color:#170c0d}
  #skip:hover{border-color:var(--text-dim)}
  #done{color:var(--good);font-size:15px;text-align:center;padding:40px 0}
  .hint{color:var(--text-dim);font-size:11.5px;margin-top:14px;line-height:1.5}
  #sinkrow{color:var(--text-dim);font-size:11.5px;margin-top:12px}
  #sink{background:var(--panel-2);color:var(--text);border:1px solid var(--line);border-radius:var(--radius-sm);padding:3px 6px}
  #sinkbtn{background:var(--panel-2);color:var(--text);border:1px solid var(--line);border-radius:var(--radius-sm);padding:3px 8px;cursor:pointer}
  a.provfrom{color:inherit}
</style>
<main>
  <div class="brand">beat board</div>
  <div class="sub">production picks — non-blind, provenance shown. this is NOT blind eval; nothing here touches beat-scores.jsonl.</div>
  <div class="prog" id="prog"></div>
  <h1 id="title">loading…</h1>
  <div id="warn"></div>
  <div id="list"></div>
  <div id="feat"></div>
  <textarea class="note" id="noteBox" placeholder="note (optional for a pick — REQUIRED to reject all: say why, it feeds PREFERENCES.md)"></textarea>
  <div class="bar"><button id="reject">reject all (n)</button><button id="skip">skip (s)</button></div>
  <div class="hint">keys: <b>1-9</b> pick that candidate · <b>n</b> reject all (needs a note) · <b>s</b> skip (records nothing — comes back next session). a pick writes decision.json in the batch dir + one line to beat-decisions.jsonl; adopt the winner with <span style="font-family:var(--font-mono)">beat adopt &lt;batch&gt; &lt;pick&gt;</span>.</div>
  <div id="sinkrow">output: <select id="sink"><option value="">system default</option></select>
    <button id="sinkbtn" title="list this machine's outputs (asks a one-time permission so device names show)">find headphones…</button>
    — moves ONLY this page's audio.</div>
</main>
<script>
let queue=[],idx=0,detail=null,audMode='solo'
const $=(id)=>document.getElementById(id)
const esc=(s)=>String(s).replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))
async function load(){queue=await (await fetch('/api/queue')).json();idx=0;await show()}
async function show(){
  $('noteBox').value='';audMode='solo'
  if(idx>=queue.length){document.querySelector('main').innerHTML='<div id="done">all boards decided — safe to close. the agent reads decision.json / beat-decisions.jsonl.</div>';return}
  detail=await (await fetch('/api/board?id='+encodeURIComponent(queue[idx].id))).json()
  $('prog').textContent='board '+(idx+1)+' of '+queue.length
  $('title').textContent=detail.label
  $('warn').innerHTML=detail.warnLarge?'<div class="warn">'+detail.count+' candidates — boards read best at 2-4 (fatigue is the documented failure mode). the agent should shortlist finalists.</div>':''
  render()
}
function provHtml(p){
  const rows=[]
  if(p.sourceKind)rows.push('<span><span class="k">source.kind</span><span class="v">'+esc(p.sourceKind)+'</span></span>')
  if(p.provider)rows.push('<span><span class="k">provider</span><span class="v">'+esc(p.provider)+'</span></span>')
  if(p.mediaId)rows.push('<span><span class="k">media</span><span class="v">'+esc(p.mediaId)+(p.mediaSeed!=null?' (seed '+p.mediaSeed+')':'')+'</span></span>')
  if(p.license)rows.push('<span><span class="k">license</span><span class="v">'+esc(p.license)+'</span></span>')
  if(p.recipe)rows.push('<span><span class="k">recipe</span><span class="v">'+esc(p.recipe)+'</span></span>')
  if(p.from)rows.push('<span class="prov-row"><span class="k">from</span><span class="v">'+esc(p.from)+'</span></span>')
  if(p.edits)rows.push('<span class="prov-row"><span class="k">edits</span><span class="v">'+esc(p.edits.join('  '))+'</span></span>')
  if(rows.length===0)rows.push('<span class="v" style="color:var(--text-dim)">(no recorded provenance)</span>')
  return '<div class="prov">'+rows.join('')+'</div>'
}
function render(){
  const b=detail
  $('list').innerHTML=b.candidates.map((c)=>{
    const wav=audMode==='context'&&c.context?c.context:c.solo
    return '<div class="cand" id="c'+c.n+'"><div class="cand-top"><b>'+c.label+'</b>'+
      '<audio controls preload="none" src="/audio?b='+encodeURIComponent(b.id)+'&f='+encodeURIComponent(wav)+'"></audio>'+
      '<button class="pickbtn" onclick="pick('+c.n+')">pick '+c.n+'</button></div>'+provHtml(c.provenance)+'</div>'
  }).join('')
  $('feat').innerHTML=featHtml(b)
  if(b.hasContext){
    $('list').insertAdjacentHTML('beforebegin','<div class="toggle" id="tg"><button id="tSolo" class="'+(audMode==='solo'?'on':'')+'" onclick="setMode(\\'solo\\')">solo</button><button id="tCtx" class="'+(audMode==='context'?'on':'')+'" onclick="setMode(\\'context\\')">in-context</button></div>')
  }
  applySink()
}
function setMode(m){audMode=m;const old=document.getElementById('tg');if(old)old.remove();render()}
function featHtml(b){
  const keys=[['lufs','LUFS'],['crestDb','crest'],['centroidHz','centroid Hz'],['widthDb','width dB'],['subPct','sub %'],['airPct','air %']]
  const any=b.candidates.some((c)=>b.features[c.file])
  if(!any)return ''
  const fmt=(x)=>x==null?'—':(Math.abs(x)>=100?Math.round(x):x.toFixed(1))
  let h='<div class="section-heading">measured features</div><table class="feat"><thead><tr><th>variant</th>'+keys.map((k)=>'<th>'+k[1]+'</th>').join('')+'</tr></thead><tbody>'
  for(const c of b.candidates){const f=b.features[c.file];h+='<tr><td>'+c.label+'</td>'+keys.map((k)=>'<td>'+(f?fmt(f[k[0]]):'—')+'</td>').join('')+'</tr>'}
  return h+'</tbody></table>'
}
async function pick(n){
  const note=$('noteBox').value.trim()
  const res=await fetch('/api/pick',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:detail.id,variant:n,note:note||undefined})})
  if(!res.ok){alert('pick failed: '+await res.text());return}
  idx++;await show()
}
async function rejectAll(){
  const note=$('noteBox').value.trim()
  if(!note){$('noteBox').style.borderColor='var(--danger)';$('noteBox').focus();$('noteBox').placeholder='a note is REQUIRED to reject all — say why nothing worked.';return}
  if(!confirm('Reject ALL '+detail.count+' candidates on this board? Recorded with your note.'))return
  const res=await fetch('/api/reject-all',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:detail.id,note})})
  if(!res.ok){alert('reject failed: '+await res.text());return}
  idx++;await show()
}
$('reject').onclick=rejectAll
$('skip').onclick=()=>{idx++;show()}
$('noteBox').addEventListener('input',()=>{$('noteBox').style.borderColor=''})
// Per-page audio output (setSinkId) — same affordance as beat rate: audition through headphones
// while the system default stays elsewhere. Labels need a one-time mic grant (Chrome only names
// devices after getUserMedia; the stream is stopped immediately).
let sinkId=localStorage.getItem('boardSink')||''
async function populateSinks(unlock){
  if(!('setSinkId' in HTMLMediaElement.prototype)){$('sinkrow').style.display='none';return}
  try{
    if(unlock){const s=await navigator.mediaDevices.getUserMedia({audio:true});s.getTracks().forEach((t)=>t.stop())}
    const outs=(await navigator.mediaDevices.enumerateDevices()).filter((d)=>d.kind==='audiooutput')
    $('sink').innerHTML='<option value="">system default</option>'+outs.map((d)=>'<option value="'+d.deviceId+'"'+(d.deviceId===sinkId?' selected':'')+'>'+(d.label||'output '+d.deviceId.slice(0,6))+'</option>').join('')
  }catch(e){/* permission denied: keep what we have */}
}
function applySink(){document.querySelectorAll('audio').forEach((a)=>{if(a.setSinkId)a.setSinkId(sinkId).catch(()=>{})})}
$('sink').onchange=()=>{sinkId=$('sink').value;localStorage.setItem('boardSink',sinkId);applySink()}
$('sinkbtn').onclick=()=>populateSinks(true)
if(navigator.mediaDevices)navigator.mediaDevices.addEventListener?.('devicechange',()=>populateSinks(false))
populateSinks(false)
document.addEventListener('keydown',(e)=>{
  if(e.target&&e.target.tagName==='TEXTAREA')return
  if(e.key==='n')rejectAll()
  else if(e.key==='s')(idx++,show())
  else if(/^[1-9]$/.test(e.key)){const n=Number(e.key);if(detail&&n<=detail.count)pick(n)}
})
load()
</script>`

// ---- the command ------------------------------------------------------------------------------

export async function boardCommand(argv) {
  // Loud unknown-flag stance, same as rate/render/vary (pilots 109-112): a typo'd flag never gets
  // silently ignored while the user waits on the wrong behavior.
  const KNOWN = new Set(['--port', '--log', '--status', '--json'])
  for (const a of argv) {
    if (a.startsWith('--') && !KNOWN.has(a)) {
      console.error(`error: unknown flag "${a}" (known: --port, --log, --status, --json)`)
      process.exit(2)
    }
  }
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--port' && argv[i - 1] !== '--log')
  const root = resolve(positional[0] ?? '.')
  const portIdx = argv.indexOf('--port')
  const port = portIdx !== -1 ? Number(argv[portIdx + 1]) : 4322
  const logIdx = argv.indexOf('--log')
  // ONE beat-decisions.jsonl at the collection root (doc 128 §2.1) — the deliberate sibling of
  // beat-scores.jsonl, never the same file. --log overrides.
  const logPath = resolve(logIdx !== -1 ? argv[logIdx + 1] : join(root, 'beat-decisions.jsonl'))
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`error: no directory at ${root}`)
    process.exit(2)
  }

  const { computeBatchFeatures } = await import(pathToFileURL(join(repoRoot, 'dist/src/taste/features.js')).href)
  const { recordPick, recordRejectAll, decidedBatchDirs, readDecisionFile } = await import(pathToFileURL(join(repoRoot, 'dist/src/board/decisions.js')).href)

  // --status: no server. Print per-batch decided/undecided + decisions; --json for the loop.
  if (argv.includes('--status')) {
    const status = buildStatus(root, decidedBatchDirs, readDecisionFile, logPath)
    if (argv.includes('--json')) {
      process.stdout.write(JSON.stringify(status, null, 2) + '\n')
      return
    }
    process.stdout.write(`boards under ${root}: ${status.decided} decided, ${status.undecided} undecided (${status.total} total)\n`)
    process.stdout.write(`decisions log: ${status.log}\n`)
    for (const b of status.batches) {
      if (!b.decided) {
        process.stdout.write(`  [ ] ${b.label}  —  ${b.batch}\n`)
      } else if (b.decision) {
        const d = b.decision
        const verdict = d.decision === 'pick' ? `pick ${d.pick}` : 'reject-all'
        const note = d.note ? `  "${d.note}"` : ''
        process.stdout.write(`  [x] ${b.label}  —  ${verdict}${note}\n`)
      } else {
        process.stdout.write(`  [x] ${b.label}  —  decided (logged; decision.json absent)\n`)
      }
    }
    return
  }

  const buildQueue = () => {
    const decided = decidedBatchDirs(logPath)
    return findBoardBatches(root)
      .filter((b) => readDecisionFile(b.dir) === null && !decided.has(resolve(b.dir)))
      .map((b) => ({ id: b.dir, label: batchLabel(b.manifest), count: b.manifest.variants.length }))
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`)
    try {
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE)
      } else if (url.pathname === '/api/queue') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(buildQueue()))
      } else if (url.pathname === '/api/board') {
        const dir = resolve(url.searchParams.get('id') ?? '')
        if (!dir.startsWith(root) || !existsSync(join(dir, 'manifest.json'))) {
          res.writeHead(404).end('no such board')
          return
        }
        const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
        const wavs = manifest.variants.map((v) => v.file.replace(/\.beat$/, '.wav'))
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(buildBoardDetail({ dir, manifest, wavs }, computeBatchFeatures)))
      } else if (url.pathname === '/audio') {
        const batchDir = resolve(url.searchParams.get('b') ?? '')
        const file = normalize(url.searchParams.get('f') ?? '')
        const full = resolve(batchDir, file)
        if (!batchDir.startsWith(root) || !full.startsWith(batchDir) || !full.endsWith('.wav') || !existsSync(full)) {
          res.writeHead(404).end('not found')
          return
        }
        res.writeHead(200, { 'content-type': 'audio/wav' }).end(readFileSync(full))
      } else if (url.pathname === '/api/pick' && req.method === 'POST') {
        let body = ''
        for await (const chunk of req) body += chunk
        const { id, variant, note } = JSON.parse(body)
        const dir = resolve(id)
        if (!dir.startsWith(root)) { res.writeHead(400).end('batch outside root'); return }
        let result
        try {
          result = recordPick(dir, String(variant), note ? { note: String(note) } : {}, logPath)
        } catch (err) {
          res.writeHead(400).end(String(err?.message ?? err))
          return
        }
        console.error(`picked ${result.entry.picks[0]?.variant} in ${dir}${note ? ` — "${note}"` : ''}`)
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, log: result.logPath }))
      } else if (url.pathname === '/api/reject-all' && req.method === 'POST') {
        let body = ''
        for await (const chunk of req) body += chunk
        const { id, note } = JSON.parse(body)
        const dir = resolve(id)
        if (!dir.startsWith(root)) { res.writeHead(400).end('batch outside root'); return }
        let result
        try {
          result = recordRejectAll(dir, String(note ?? ''), logPath)
        } catch (err) {
          res.writeHead(400).end(String(err?.message ?? err))
          return
        }
        console.error(`reject-all ${dir}: "${note}"`)
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, log: result.logPath }))
      } else {
        res.writeHead(404).end('not found')
      }
    } catch (err) {
      res.writeHead(500).end(String(err?.message ?? err))
    }
  })

  const initial = buildQueue()
  if (initial.length === 0) {
    console.error(`nothing to decide: no undecided rendered board batches under ${root}`)
    console.error(`generate candidates first (e.g. beat vary <file> <track> <group> --count 3 --render), or check what's already decided: beat board ${root} --status`)
    process.exit(1)
  }
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`error: port ${port} is already in use — pass --port <other> (is another beat board or beat rate still running?)`)
      process.exit(2)
    }
    console.error(`error: ${err.message}`)
    process.exit(1)
  })
  server.listen(port, '127.0.0.1', () => {
    console.error(`board: ${initial.length} undecided batch(es) under ${root}`)
    console.error(`decisions -> ${logPath}`)
    console.error(`open http://localhost:${port} — ctrl-c here when done`)
  })
}

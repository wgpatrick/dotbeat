#!/usr/bin/env node
// beat ab — the owner-FEEDBACK surface. Point it at a directory of renders; it serves an A/B(/C)
// comparison page that captures a preference AND, first-class, the owner's own words.
//
// WHY THE NAME. `feedback` was already taken by the machine-critique verb (`beat feedback <file>`
// renders a song and reports metrics + lint), and overloading it would have made "beat feedback"
// mean both "the computer tells me about the mix" and "I tell the computer about the mix" — the two
// opposite directions of the loop. `board --ab` was the other candidate and is wrong for a
// structural reason, not a cosmetic one: `board` is manifest-driven (it only sees dirs holding a
// vary-batch manifest.json), its unit is variants of ONE document, and its verdict is a PICK that
// `beat adopt` consumes. The sets this serves are plain folders of wavs comparing TREATMENTS
// (layered vs unlayered, before vs after retargeting, model vs model), and their verdict is prose.
// Same log, same page, same queue would have blurred pick-for-production with tell-me-what-you-hear.
// `ab` names the gesture, is two characters, and collides with nothing.
//
// The three review surfaces and their three logs, which are NEVER merged (D24 extended):
//   beat rate   blind measurement -> beat-scores.jsonl      (taste model, showdown reports)
//   beat board  non-blind picking -> beat-decisions.jsonl   (production decisions)
//   beat ab     non-blind feedback -> beat-feedback.jsonl   (development decisions)
//
// Same self-contained node:http + inline-HTML shape as rate.mjs/board.mjs (no build step, no
// React), on the shared server shell (src/serve/review-server.ts) so the path-containment and CSRF
// guards live in one place for all three. Design tokens borrowed from the daemon GUI
// (ui/src/styles.css) exactly as `board` does.

import { existsSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---- server logic (no HTML) -------------------------------------------------------------------

/** Human-readable projection of a DSP feature vector — the same units the board shows (dB and Hz,
 * not the training-space log2), so the two non-blind surfaces read alike. */
function displayFeatures(fv) {
  if (!fv) return null
  return {
    LUFS: Number(fv.lufs.toFixed(1)),
    crest: Number(fv.crestDb.toFixed(1)),
    'centroid Hz': Math.round(Math.pow(2, fv.centroidLog2)),
    'width dB': Number(fv.stereoWidthDb.toFixed(1)),
    'sub %': Number(fv.bandSubPct.toFixed(1)),
    'air %': Number(fv.bandAirPct.toFixed(1)),
  }
}

/**
 * Everything the page needs for one comparison. `measurements` are the AGENT's if it supplied them
 * (shown verbatim, this module invents no units); otherwise the DSP feature vectors are measured on
 * demand so a bare folder still gets numbers on screen. Which one is showing is stated on the page
 * — a measurement whose provenance is ambiguous is worse than none.
 */
export function buildComparisonDetail(set, comparison, computeBatchFeatures) {
  const question = comparison.question ?? set.question
  let measurements = comparison.measurements ?? null
  let measurementSource = measurements === null ? null : 'agent'
  if (measurements === null && computeBatchFeatures) {
    const raw = computeBatchFeatures(set.dir, comparison.options.map((o) => o.wav))
    const byName = {}
    for (const o of comparison.options) {
      const d = displayFeatures(raw[o.wav])
      if (d !== null) byName[o.name] = d
    }
    if (Object.keys(byName).length > 0) {
      measurements = byName
      measurementSource = 'measured'
    }
  }
  return {
    id: comparison.id,
    label: comparison.label ?? comparison.id,
    question,
    // `missing` travels to the page so a dead option is shown as dead rather than played as
    // silence — CLI pilot 2026-07-26's one HIGH finding (see missingOptions in src/feedback/ab.ts).
    options: comparison.options.map((o, i) => ({
      n: i + 1,
      name: o.name,
      wav: o.wav,
      note: o.note ?? null,
      missing: !existsSync(resolve(set.dir, o.wav)),
    })),
    measurements,
    measurementSource,
    warnLarge: comparison.options.length > 4,
  }
}

// ---- the page (GUI-aligned; tokens borrowed from ui/src/styles.css, same set `beat board` uses) --
//
// The two things that make an A/B honest and are therefore not optional here:
//   1. INSTANT switching — every option is preloaded and PLAYING at once, all but one muted, so
//      pressing 1/2/3 swaps which one you hear with no load, no seek, no gap.
//   2. The SAME MOMENT — comparing bar 1 of A against bar 3 of B is the classic way an A/B lies to
//      you. Two mechanisms, both found necessary by ui/verify-ab-page.mjs: play() waits for EVERY
//      element to be ready before starting any (without it they each started when their own
//      buffering finished, measured up to 880 ms apart, which is bar-1-vs-bar-3 territory), and a
//      coarse watchdog catches a stall or a loop-wrap mismatch afterwards. `resync` documents why
//      the watchdog is coarse rather than a tight controller — the short version is that
//      `currentTime` is too noisy a clock to control against.

const PAGE = `<!doctype html><meta charset="utf-8"><title>beat ab</title>
<style>
  :root{
    --bg:#16171b;--panel:#1e2026;--panel-2:#23262e;--line:#2e3138;--text:#d8dbe2;--text-dim:#8a8f9a;
    --accent:#e0a13c;--danger:#e06c75;--good:#6ec97c;--surface-recessed:#14151a;
    --font-mono:ui-monospace,SFMono-Regular,Menlo,monospace;--label-tracking:0.05em;
    --radius-sm:3px;--radius-md:4px;--radius-lg:6px;color-scheme:dark;
  }
  @media (prefers-color-scheme: light){:root{
    --bg:#f2f3f5;--panel:#fff;--panel-2:#eceef1;--line:#d5d8de;--text:#1c1e24;--text-dim:#6a707c;
    --surface-recessed:#e7e9ec;color-scheme:light;
  }}
  *{box-sizing:border-box}
  body{font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;margin:0;background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased}
  main{max-width:900px;margin:0 auto;padding:22px 20px 60px}
  .brand{font-weight:700;letter-spacing:var(--label-tracking);font-size:15px;margin-bottom:2px}
  .brand::before{content:'\\25CF';color:var(--accent);margin-right:6px}
  .sub{color:var(--text-dim);font-size:12px;margin-bottom:14px}
  .prog{color:var(--accent);font-size:12px;font-weight:600;margin-bottom:6px;letter-spacing:var(--label-tracking)}
  .case{font-size:12px;color:var(--text-dim);font-family:var(--font-mono);margin-bottom:4px}
  h1{font-size:18px;font-weight:700;margin:0 0 14px;line-height:1.35}
  .warn{background:rgba(224,161,60,0.12);border:1px solid var(--accent);color:var(--text);border-radius:var(--radius-md);padding:8px 12px;font-size:12px;margin-bottom:12px}
  .opts{display:grid;gap:10px;margin:0 0 12px}
  .opt{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-lg);padding:11px 13px;display:flex;align-items:center;gap:12px;cursor:pointer}
  .opt.hearing{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
  .opt.gone{border-color:var(--danger);opacity:0.65;cursor:not-allowed}
  .opt.gone .key,.opt.gone .name{color:var(--danger)}
  .opt.chosen{background:rgba(110,201,124,0.10)}
  .opt.chosen .prefbtn{background:var(--good);color:#12140f;border-color:var(--good)}
  .opt .key{font-family:var(--font-mono);font-size:15px;font-weight:700;color:var(--text-dim);min-width:18px}
  .opt.hearing .key{color:var(--accent)}
  .opt .body{flex:1;min-width:0}
  .opt .name{font-size:14px;font-weight:700}
  .opt .prov{color:var(--text-dim);font-size:11.5px;margin-top:2px;font-family:var(--font-mono);overflow-wrap:anywhere}
  .opt .live{font-size:10px;letter-spacing:var(--label-tracking);text-transform:uppercase;color:var(--accent);font-weight:700;min-width:56px;text-align:right;opacity:0}
  .opt.hearing .live{opacity:1}
  .prefbtn{background:var(--panel-2);color:var(--text);border:1px solid var(--line);border-radius:var(--radius-md);padding:7px 12px;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap}
  .prefbtn:hover{border-color:var(--good);color:var(--good)}
  .transport{background:var(--surface-recessed);border:1px solid var(--line);border-radius:var(--radius-lg);padding:10px 13px;display:flex;align-items:center;gap:12px;margin-bottom:12px}
  .transport button{background:var(--panel-2);color:var(--text);border:1px solid var(--line);border-radius:var(--radius-md);padding:7px 14px;cursor:pointer;font-size:13px;font-weight:700;min-width:74px}
  .transport input[type=range]{flex:1;accent-color:var(--accent)}
  .transport .time{font-family:var(--font-mono);font-size:11.5px;color:var(--text-dim);min-width:82px;text-align:right}
  .transport label{font-size:11.5px;color:var(--text-dim);display:flex;align-items:center;gap:4px;cursor:pointer}
  .section-heading{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:var(--label-tracking);color:var(--text-dim);margin:16px 0 6px}
  table.feat{width:100%;border-collapse:collapse;font-family:var(--font-mono);font-size:12px;background:var(--surface-recessed);border-radius:var(--radius-md);overflow:hidden}
  table.feat th,table.feat td{padding:6px 9px;text-align:right;border-bottom:1px solid var(--line)}
  table.feat th:first-child,table.feat td:first-child{text-align:left}
  table.feat thead th{color:var(--text-dim);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:var(--label-tracking)}
  table.feat tbody tr:last-child td{border-bottom:0}
  .askbox{margin-top:16px}
  .asklabel{font-size:13px;font-weight:700;margin-bottom:5px}
  .asksub{color:var(--text-dim);font-size:11.5px;margin-bottom:6px}
  .note{width:100%;background:var(--surface-recessed);color:var(--text);border:1px solid var(--line);border-radius:var(--radius-md);padding:10px 12px;font:13px/1.5 inherit;resize:vertical;min-height:82px}
  .note:focus{outline:none;border-color:var(--accent)}
  .note::placeholder{color:var(--text-dim)}
  .flagrow{margin-top:7px;font-size:12px;color:var(--text-dim);display:flex;align-items:center;gap:6px}
  .flagrow input{accent-color:var(--danger)}
  .bar{display:flex;gap:10px;margin-top:12px}
  .bar button{padding:11px 14px;border:1px solid var(--line);border-radius:var(--radius-md);cursor:pointer;font-size:13px;font-weight:600;background:var(--panel-2);color:var(--text)}
  #record{flex:1;background:var(--good);color:#12140f;border-color:var(--good)}
  #record.armed{background:var(--accent);border-color:var(--accent);color:#1a1509}
  #neither{background:rgba(224,108,117,0.14);border-color:var(--danger);color:var(--danger)}
  #skip:hover{border-color:var(--text-dim)}
  #msg{color:var(--accent);font-size:12px;min-height:17px;margin-top:8px}
  #done{color:var(--good);font-size:15px;text-align:center;padding:40px 0;line-height:1.7}
  .hint{color:var(--text-dim);font-size:11.5px;margin-top:14px;line-height:1.6}
  .hint b{color:var(--text);font-family:var(--font-mono)}
  #sinkrow{color:var(--text-dim);font-size:11.5px;margin-top:12px}
  #sink,#sinkbtn{background:var(--panel-2);color:var(--text);border:1px solid var(--line);border-radius:var(--radius-sm);padding:3px 7px}
  #sinkbtn{cursor:pointer}
</style>
<main>
  <div class="brand">beat ab</div>
  <div class="sub" id="banner">owner feedback — non-blind on purpose (you are judging, not being tested). This is NOT blind eval; nothing here touches beat-scores.jsonl.</div>
  <div class="prog" id="prog"></div>
  <div class="case" id="case"></div>
  <h1 id="question">loading&hellip;</h1>
  <div id="warn"></div>
  <div class="opts" id="opts"></div>
  <div class="transport">
    <button id="play">play</button>
    <input type="range" id="seek" min="0" max="1000" value="0" step="1">
    <span class="time" id="time">0:00 / 0:00</span>
    <label><input type="checkbox" id="loop" checked>loop</label>
  </div>
  <div id="feat"></div>
  <div class="askbox">
    <div class="asklabel">What did you hear?</div>
    <div class="asksub">Plain words, one line is plenty. This is the part the agent actually acts on &mdash; the preference button is just the headline.</div>
    <textarea class="note" id="freeText" placeholder="e.g. &quot;the layering makes everything sound same-ish&quot; / &quot;the bassline layering doesn't sound great, I liked the unlayered one better&quot;"></textarea>
    <div class="flagrow"><input type="checkbox" id="flag"><label for="flag">something here sounds <b>wrong</b> (banks a listen-bench case from this pair)</label></div>
  </div>
  <div class="bar">
    <button id="record">record &amp; next (enter)</button>
    <button id="neither">neither / no preference (n)</button>
    <button id="skip">skip (s)</button>
  </div>
  <div id="msg"></div>
  <div class="hint">keys: <b>1-9</b> switch to that option instantly (they all play in sync, so you hear the SAME moment) &middot; <b>space</b> play/pause &middot; <b>p</b> then a number sets your preference &middot; <b>n</b> neither &middot; <b>s</b> skip (records nothing, comes back next time) &middot; <b>enter</b> record. Clicking an option switches to it; its button sets the preference.</div>
  <div class="hint">answers append to <b>beat-feedback.jsonl</b> + one file per comparison under <b>feedback-answers/</b>. The agent reads them with <b>beat ab &lt;dir&gt; --status</b> and <b>--digest</b>.</div>
  <div id="sinkrow">output: <select id="sink"><option value="">system default</option></select>
    <button id="sinkbtn" title="list this machine's outputs (asks a one-time permission so device names show)">find headphones&hellip;</button>
    &mdash; moves ONLY this page's audio.</div>
</main>
<script>
var queue=[],idx=0,detail=null,auds=[],hearing=0,pref=null,armed=false,prefMode=false,setInfo=null
function $(id){return document.getElementById(id)}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function fmtTime(s){if(!isFinite(s))return '0:00';var m=Math.floor(s/60),r=Math.floor(s%60);return m+':'+(r<10?'0':'')+r}

async function load(){
  setInfo=await (await fetch('/api/set')).json()
  $('banner').innerHTML=esc(setInfo.banner)
  queue=await (await fetch('/api/queue')).json()
  idx=0;await show()
}
async function show(){
  teardown()
  pref=null;armed=false;prefMode=false
  $('freeText').value='';$('freeText').style.borderColor='';$('flag').checked=false
  $('msg').textContent='';$('record').classList.remove('armed')
  if(idx>=queue.length){
    document.querySelector('main').innerHTML='<div id="done">that is all of them &mdash; thank you, this is the highest-signal data the project gets.<br>safe to close. the agent reads it with <b>beat ab '+esc(setInfo.dir)+' --digest</b>.</div>'
    return
  }
  detail=await (await fetch('/api/comparison?id='+encodeURIComponent(queue[idx].id))).json()
  $('prog').textContent='comparison '+(idx+1)+' of '+queue.length
  $('case').textContent=detail.label
  $('question').textContent=detail.question
  var warn=detail.warnLarge?'<div class="warn">'+detail.options.length+' options &mdash; comparisons read best at 2-4 (fatigue is the documented failure mode).</div>':''
  // A missing render must SHOUT. Playing silence for it would let the owner judge — in good faith —
  // a file that was never loaded, and that answer would be recorded as real data.
  var gone=detail.options.filter(function(o){return o.missing})
  if(gone.length)warn+='<div class="warn" style="border-color:var(--danger);background:rgba(224,108,117,0.14)">'+
    gone.length+' of '+detail.options.length+' renders are MISSING from disk ('+gone.map(function(o){return esc(o.wav)}).join(', ')+
    '). They are not loaded and cannot be picked &mdash; do not judge this comparison until the agent re-renders them.</div>'
  $('warn').innerHTML=warn
  renderOptions();renderFeatures();buildAudio()
}
function renderOptions(){
  $('opts').innerHTML=detail.options.map(function(o){
    if(o.missing){
      return '<div class="opt gone" id="o'+o.n+'"><span class="key">'+o.n+'</span>'+
        '<div class="body"><div class="name">'+esc(o.name)+'</div>'+
        '<div class="prov">'+esc(o.wav)+' &mdash; FILE MISSING, not loaded</div></div></div>'
    }
    return '<div class="opt" id="o'+o.n+'" onclick="switchTo('+o.n+')">'+
      '<span class="key">'+o.n+'</span>'+
      '<div class="body"><div class="name">'+esc(o.name)+'</div>'+
      (o.note?'<div class="prov">'+esc(o.note)+'</div>':'')+
      '<div class="prov">'+esc(o.wav)+'</div></div>'+
      '<span class="live">hearing</span>'+
      '<button class="prefbtn" onclick="event.stopPropagation();setPref('+o.n+')">prefer this</button></div>'
  }).join('')
  paint()
}
function renderFeatures(){
  var m=detail.measurements
  if(!m||Object.keys(m).length===0){$('feat').innerHTML='';return}
  var keys=[]
  for(var k in m)for(var f in m[k])if(keys.indexOf(f)===-1)keys.push(f)
  var src=detail.measurementSource==='agent'?'measurements (from the agent)':'measured features (dotbeat DSP, computed just now)'
  var h='<div class="section-heading">'+src+'</div><table class="feat"><thead><tr><th>option</th>'+keys.map(function(k){return '<th>'+esc(k)+'</th>'}).join('')+'</tr></thead><tbody>'
  detail.options.forEach(function(o){
    var row=m[o.name]||{}
    h+='<tr><td>'+esc(o.name)+'</td>'+keys.map(function(k){return '<td>'+(row[k]===undefined?'\\u2014':esc(row[k]))+'</td>'}).join('')+'</tr>'
  })
  $('feat').innerHTML=h+'</tbody></table>'
}

// ---- the transport: every option preloaded and playing at once, all but one muted -------------
function live(){return auds.filter(function(a){return a!==null})}
function teardown(){live().forEach(function(a){try{a.pause()}catch(e){}a.src=''});auds=[];hearing=0;$('play').textContent='play';$('seek').value=0;$('time').textContent='0:00 / 0:00'}
function buildAudio(){
  // auds stays index-parallel with detail.options, with null where the render is missing, so the
  // number keys keep meaning the same option whether or not one of them failed to render.
  auds=detail.options.map(function(o){
    if(o.missing)return null
    var a=new Audio('/audio?b='+encodeURIComponent(setInfo.dir)+'&f='+encodeURIComponent(o.wav))
    a.preload='auto';a.loop=$('loop').checked;a.muted=true
    // A render that 404s or fails to decode is the same hazard as one missing from disk: silence
    // the owner would read as a verdict. Say so instead.
    a.addEventListener('error',function(){
      var el=$('o'+(auds.indexOf(a)+1))
      if(el&&!el.classList.contains('gone')){el.classList.add('gone');el.innerHTML+='<div class="prov">FAILED TO LOAD &mdash; not audible</div>'}
    })
    return a
  })
  hearing=auds.findIndex(function(a){return a!==null})+1
  paint();applySink()
  var first=live()[0]
  if(first)first.addEventListener('loadedmetadata',updateTime)
}
function activeAud(){return hearing>0?auds[hearing-1]:null}
function ready(a){
  // HAVE_FUTURE_DATA. Starting before every element can play is what staggers them: each one
  // begins whenever its own buffering finishes, so pressing 2 a second later drops you somewhere
  // else in the bar. Verified: without this wait the three clips started up to ~880 ms apart.
  if(a.readyState>=3)return Promise.resolve()
  return new Promise(function(res){
    var done=function(){a.removeEventListener('canplay',done);res()}
    a.addEventListener('canplay',done)
    setTimeout(done,4000)
  })
}
async function play(){
  if(live().length===0)return
  $('play').textContent='\\u2026'
  var mine=auds
  await Promise.all(live().map(ready))
  if(mine!==auds)return // comparison changed while buffering
  var at=activeAud().currentTime
  live().forEach(function(a){a.currentTime=at;a.muted=true})
  await Promise.all(live().map(function(a){return a.play().catch(function(){})}))
  if(mine!==auds)return
  resync()
  activeAud().muted=false
  $('play').textContent='pause'
}
function pause(){live().forEach(function(a){a.pause()});$('play').textContent='play'}
function toggle(){var a=activeAud();if(!a)return;a.paused?play():pause()}
/**
 * The sync watchdog — deliberately a COARSE safety net, not a fine controller. It only acts on a
 * gap big enough to be real: a stalled element, or a loop wrap against an option of a different
 * length. Sync itself comes from the coordinated start in play() above.
 *
 * Two earlier versions of this function were wrong, and the reason is worth keeping because it is
 * not obvious from the spec:
 *
 *   1. Seeking every element more than 40 ms out could never converge below ~43 ms — a seek takes
 *      about that long to complete, so each correction landed one seek-latency behind and
 *      immediately needed another. Measured, repeatedly.
 *   2. Nudging playbackRate instead (no seek latency, inaudible on a muted element) converged
 *      fine and then oscillated: 12 ms, reopening to 30 ms, corrected, reopening again. The cause
 *      is that HTMLMediaElement.currentTime is NOT a precise clock — the spec lets the official
 *      playback position update on a coarse timer (why timeupdate fires ~4x/s), so readings
 *      across elements carry tens of ms of phase noise. The controller was chasing that noise, and
 *      by acting on it it was INJECTING the drift it thought it was removing.
 *
 * Elements started together in one browser render off one device clock; they do not meaningfully
 * drift, and the residual "spread" visible in any measurement is mostly the clock granularity
 * above. So: start them together, then leave them alone unless something is unambiguously wrong.
 */
var SYNC_HARD=0.25
function resync(){
  var act=activeAud()
  if(!act||act.paused)return
  live().forEach(function(a){
    if(a===act||a.seeking||a.paused)return
    if(Math.abs(act.currentTime-a.currentTime)>SYNC_HARD)a.currentTime=act.currentTime
  })
}
function switchTo(n){
  if(!detail||n<1||n>auds.length||auds[n-1]===null)return // a missing render is not switchable-to
  var was=activeAud()
  // The position the owner was actually HEARING is the truth to carry across.
  var at=was&&!was.paused&&!was.seeking?was.currentTime:null
  hearing=n
  var now=activeAud()
  // Instant: swap which element is audible, normally with no seek at all — the watchdog has been
  // keeping them aligned all along. This guard only fires on a real desync.
  if(at!==null&&Math.abs(now.currentTime-at)>SYNC_HARD)now.currentTime=at
  live().forEach(function(a){a.muted=true})
  now.muted=false
  paint()
  resync()
}
function setPref(n){
  // A missing render can never be the preference — a "pick" over a file nobody heard is the
  // wrong-data failure this whole guard exists to prevent.
  if(detail&&detail.options[n-1]&&detail.options[n-1].missing){$('msg').textContent='that render is missing from disk — it was never loaded, so it cannot be preferred.';return}
  pref=n;armed=false;$('record').classList.remove('armed');$('msg').textContent='';paint()}
function paint(){
  detail.options.forEach(function(o){
    var el=$('o'+o.n)
    if(!el)return
    el.className='opt'+(o.missing?' gone':'')+(o.n===hearing?' hearing':'')+(o.n===pref?' chosen':'')
    var b=el.querySelector('.prefbtn')
    if(b)b.textContent=o.n===pref?'preferred':'prefer this'
  })
}
function updateTime(){
  var a=activeAud();if(!a)return
  var d=a.duration||0
  $('seek').value=d?Math.round((a.currentTime/d)*1000):0
  $('time').textContent=fmtTime(a.currentTime)+' / '+fmtTime(d)
}
setInterval(function(){if(live().length){updateTime();resync()}},120)
$('play').onclick=toggle
$('loop').onchange=function(){live().forEach(function(a){a.loop=$('loop').checked})}
$('seek').oninput=function(){
  var a=activeAud();if(!a||!a.duration)return
  var t=(Number($('seek').value)/1000)*a.duration
  live().forEach(function(x){x.currentTime=t})
}

// ---- recording --------------------------------------------------------------------------------
async function post(preference){
  var text=$('freeText').value.trim()
  // Free text is required-ish, deliberately: the WHY is the product, and a bare preference count
  // is what this surface exists to stop being the only thing that survives. First press nudges;
  // a second press records anyway, because refusing outright would just train people to type ".".
  if(text===''&&!armed){
    armed=true
    $('record').classList.add('armed')
    $('freeText').style.borderColor='var(--accent)';$('freeText').focus()
    $('msg').textContent='what did you hear? one line is enough \\u2014 the words are worth more than the pick. (press again to record without them)'
    return
  }
  var res=await fetch('/api/answer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
    id:detail.id,preference:preference,freeText:text,flagged:$('flag').checked
  })})
  if(!res.ok){$('msg').textContent='save failed: '+await res.text();return}
  idx++;await show()
}
$('record').onclick=function(){
  if(pref===null&&!$('flag').checked&&$('freeText').value.trim()===''){
    $('msg').textContent='pick an option (1-9 / "prefer this"), or use "neither" \\u2014 or just write what you heard.'
    return
  }
  post(pref===null?'neither':detail.options[pref-1].name)
}
$('neither').onclick=function(){pref=null;paint();post('neither')}
$('skip').onclick=function(){idx++;show()}
$('freeText').addEventListener('input',function(){$('freeText').style.borderColor=''})

// Per-page audio output (setSinkId) — same affordance as beat rate / beat board.
var sinkId=localStorage.getItem('abSink')||''
async function populateSinks(unlock){
  if(!('setSinkId' in HTMLMediaElement.prototype)){$('sinkrow').style.display='none';return}
  try{
    if(unlock){var s=await navigator.mediaDevices.getUserMedia({audio:true});s.getTracks().forEach(function(t){t.stop()})}
    var outs=(await navigator.mediaDevices.enumerateDevices()).filter(function(d){return d.kind==='audiooutput'})
    $('sink').innerHTML='<option value="">system default</option>'+outs.map(function(d){
      return '<option value="'+d.deviceId+'"'+(d.deviceId===sinkId?' selected':'')+'>'+esc(d.label||('output '+d.deviceId.slice(0,6)))+'</option>'}).join('')
  }catch(e){}
}
function applySink(){live().forEach(function(a){if(a.setSinkId)a.setSinkId(sinkId).catch(function(){})})}
$('sink').onchange=function(){sinkId=$('sink').value;localStorage.setItem('abSink',sinkId);applySink()}
$('sinkbtn').onclick=function(){populateSinks(true)}
if(navigator.mediaDevices&&navigator.mediaDevices.addEventListener)navigator.mediaDevices.addEventListener('devicechange',function(){populateSinks(false)})
populateSinks(false)

document.addEventListener('keydown',function(e){
  // The text box is always focusable and typing in it must never trigger a shortcut — except
  // cmd/ctrl-enter, which records from inside the box (the natural "done writing" gesture).
  if(e.target&&e.target.tagName==='TEXTAREA'){
    if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();$('record').click()}
    return
  }
  if(e.key===' '){e.preventDefault();toggle()}
  else if(e.key==='Enter'){e.preventDefault();$('record').click()}
  else if(e.key==='n')$('neither').click()
  else if(e.key==='s')$('skip').click()
  else if(e.key==='p'){prefMode=true;$('msg').textContent='press a number to prefer that option\\u2026';return}
  else if(/^[1-9]$/.test(e.key)){
    var n=Number(e.key)
    if(prefMode){setPref(n)}else{switchTo(n)}
  }
  prefMode=false
})
load()
</script>`

// ---- the command ------------------------------------------------------------------------------

const KNOWN_FLAGS = [
  '--port', '--log', '--all', '--json',
  '--status', '--digest', '--bank-listen-bench',
  '--answer', '--prefer', '--note', '--flag',
]
/** Flags that take a value, so the positional <dir> scan doesn't eat their argument. */
const VALUE_FLAGS = new Set(['--port', '--log', '--answer', '--prefer', '--note'])
/** The mutually-exclusive modes. Combining them used to silently run one and drop the other. */
const MODES = ['--status', '--digest', '--bank-listen-bench', '--answer']

export async function abCommand(argv) {
  // Loud unknown-flag stance, same as rate/board/render/vary (pilots 109-112). A flag's own VALUE
  // is skipped, so an owner's note may start with dashes without being mistaken for a typo.
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (VALUE_FLAGS.has(argv[i - 1])) continue
    if (a.startsWith('--') && !KNOWN_FLAGS.includes(a)) {
      console.error(`error: unknown flag "${a}" (known: ${KNOWN_FLAGS.join(', ')})`)
      process.exit(2)
    }
  }
  // CLI pilot 2026-07-26 (LOW): `--status --digest` printed only the digest and never said the
  // other flag had been dropped. Silently honouring one of two requests is the same class of bug
  // as silently ignoring a typo'd flag.
  const modesGiven = MODES.filter((m) => argv.includes(m))
  if (modesGiven.length > 1) {
    console.error(`error: ${modesGiven.join(' and ')} are separate modes — run one at a time`)
    process.exit(2)
  }
  const valueOf = (flag) => {
    const i = argv.indexOf(flag)
    return i === -1 ? undefined : argv[i + 1]
  }
  const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(argv[i - 1]))
  const root = resolve(positional[0] ?? '.')
  const port = argv.includes('--port') ? Number(valueOf('--port')) : 4323
  const logIdx = argv.indexOf('--log')

  const ab = await import(pathToFileURL(join(repoRoot, 'dist/src/feedback/ab.js')).href)
  // ONE beat-feedback.jsonl at the listening dir's root — the deliberate third sibling of
  // beat-scores.jsonl (blind) and beat-decisions.jsonl (picks), never the same file. --log overrides.
  const logPath = resolve(logIdx !== -1 ? argv[logIdx + 1] : join(root, ab.DEFAULT_FEEDBACK_LOG))

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`error: no directory at ${root}`)
    process.exit(2)
  }

  let set
  try {
    set = ab.loadAbSet(root)
  } catch (err) {
    console.error(`error: ${String(err?.message ?? err)}`)
    process.exit(2)
  }

  /** Report every option wav that is not on disk. Called by every mode; see missingOptions(). */
  const reportMissing = () => {
    const gaps = ab.missingOptions(set)
    if (gaps.length === 0) return 0
    let n = 0
    console.error(`WARNING: ${gaps.length} comparison(s) reference renders that are not on disk:`)
    for (const g of gaps) {
      n += g.missing.length
      console.error(`  ${g.comparisonId}: ${g.missing.length} of ${g.total} missing — ${g.missing.join(', ')}`)
    }
    console.error('a missing option is shown as dead and cannot be picked — re-render before asking the owner.')
    return n
  }

  // ---- --answer: record an answer WITHOUT a browser ---------------------------------------------
  // The channel that would have saved the 2026-07-26 round trip: the owner replies in chat, and the
  // coordinator transcribes their exact words into the same log the UI writes, instead of
  // hand-translating them into a work order. Also what makes the loop scriptable and testable at
  // all — CLI pilot 2026-07-26 found there was no non-browser write path and had to reverse-engineer
  // POST /api/answer out of the served page's JavaScript.
  if (argv.includes('--answer')) {
    const id = valueOf('--answer')
    const comparison = set.comparisons.find((c) => c.id === id)
    if (comparison === undefined) {
      console.error(`error: no comparison "${id ?? ''}" in ${root}`)
      console.error(`known ids: ${set.comparisons.map((c) => c.id).join(', ') || '(none)'}`)
      process.exit(2)
    }
    const preference = valueOf('--prefer') ?? 'neither'
    const note = valueOf('--note') ?? ''
    if (preference === 'neither' && note.trim() === '' && !argv.includes('--flag')) {
      console.error('error: --prefer is required, or pass --note "..." to record what the owner said')
      process.exit(2)
    }
    try {
      const result = ab.recordFeedback(
        root,
        {
          comparisonId: comparison.id,
          ...(comparison.label !== undefined ? { label: comparison.label } : {}),
          question: comparison.question ?? set.question,
          preference,
          freeText: note,
          flagged: argv.includes('--flag'),
          options: comparison.options,
          ...(comparison.measurements !== undefined ? { measurements: comparison.measurements } : {}),
        },
        logPath,
      )
      process.stdout.write(`recorded ${comparison.id}: ${preference}${note ? ` — "${note}"` : ''}\n`)
      process.stdout.write(`  ${result.logPath}\n  ${result.answerPath}\n`)
    } catch (err) {
      console.error(`error: ${String(err?.message ?? err)}`)
      process.exit(2)
    }
    return
  }

  // ---- --digest: the agent-facing summary (preferences + VERBATIM quotes + bench candidates) ----
  if (argv.includes('--digest')) {
    reportMissing()
    const digest = ab.buildDigest(root, logPath)
    if (argv.includes('--json')) {
      process.stdout.write(JSON.stringify(digest, null, 2) + '\n')
      return
    }
    process.stdout.write(ab.formatDigest(digest))
    return
  }

  // ---- --bank-listen-bench: complaints -> candidate listening cases -----------------------------
  if (argv.includes('--bank-listen-bench')) {
    const digest = ab.buildDigest(root, logPath)
    const out = join(root, ab.LISTEN_BENCH_CANDIDATES_FILE)
    writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), sourceDir: set.dir, candidates: digest.candidates }, null, 2) + '\n')
    if (argv.includes('--json')) {
      process.stdout.write(JSON.stringify({ out, count: digest.candidates.length, candidates: digest.candidates }, null, 2) + '\n')
      return
    }
    process.stdout.write(`${digest.candidates.length} listen-bench candidate(s) -> ${out}\n`)
    for (const c of digest.candidates) {
      process.stdout.write(`  ${c.id}  (${c.trigger})  "${c.quote}"\n`)
    }
    if (digest.candidates.length === 0) {
      process.stdout.write('nothing flagged yet — a candidate needs an answer that is flagged "sounds wrong", is "neither", or reads as a complaint.\n')
    } else {
      process.stdout.write('these are CANDIDATES: review, then copy the pairs into taste-dataset/listen-bench/ with an answer-key entry.\n')
    }
    return
  }

  // ---- --status: no server, the shape an agent polls (mirrors `beat board --status`) ------------
  if (argv.includes('--status')) {
    const status = ab.buildAbStatus(root, logPath)
    if (argv.includes('--json')) {
      process.stdout.write(JSON.stringify(status, null, 2) + '\n')
      return
    }
    reportMissing()
    process.stdout.write(`feedback under ${status.dir} (${status.source}): ${status.answered} answered, ${status.unanswered} unanswered (${status.total} total)\n`)
    process.stdout.write(`question: ${status.question}\n`)
    process.stdout.write(`feedback log: ${status.log}\n`)
    for (const c of status.comparisons) {
      const gap = c.missing.length > 0 ? `  !! ${c.missing.length} MISSING RENDER(S): ${c.missing.join(', ')}` : ''
      if (!c.answered) {
        process.stdout.write(`  [ ] ${c.label}  —  ${c.options.join(' vs ')}${gap}\n`)
      } else {
        const flag = c.flagged ? ' (flagged)' : ''
        const text = c.freeText ? `  "${c.freeText}"` : '  (no words)'
        process.stdout.write(`  [x] ${c.label}  —  ${c.preference}${flag}${text}${gap}\n`)
      }
    }
    return
  }

  // ---- the server ------------------------------------------------------------------------------
  // src/taste/features.ts moved to src/metrics/features.ts and this path was left behind, so EVERY
  // `beat ab <dir>` (the server path — the whole command) died with ERR_MODULE_NOT_FOUND before
  // opening. Caught 2026-07-26 independently by test/feedback-ab.test.ts while preparing a listening
  // set, and by test/dist-imports.test.ts, which now scans every dist path the CLI imports.
  const { computeBatchFeatures } = await import(pathToFileURL(join(repoRoot, 'dist/src/metrics/features.js')).href)
  const { createReviewServer, listenReviewServer, ReviewHttpError } = await import(
    pathToFileURL(join(repoRoot, 'dist/src/serve/review-server.js')).href
  )

  const showAll = argv.includes('--all')
  const buildQueue = () => {
    const answered = ab.answersByComparison(logPath, set.dir)
    return set.comparisons
      .filter((c) => showAll || (!answered.has(c.id) && ab.readAnswerFile(set.dir, c.id) === null))
      .map((c) => ({ id: c.id, label: c.label ?? c.id, options: c.options.length }))
  }
  const comparisonById = (id) => {
    const c = set.comparisons.find((x) => x.id === String(id ?? ''))
    if (c === undefined) throw new ReviewHttpError(404, 'no such comparison')
    return c
  }

  const server = createReviewServer({
    root,
    page: PAGE,
    routes: {
      '/api/set': {
        method: 'GET',
        handler: () => ({
          dir: set.dir,
          source: set.source,
          banner:
            set.source === 'manifest'
              ? 'owner feedback — the agent wrote the question in feedback.json. Non-blind on purpose: you are judging, not being tested. Nothing here touches beat-scores.jsonl.'
              : `owner feedback — ${set.inferenceNote ?? ''} Non-blind on purpose. Nothing here touches beat-scores.jsonl.`,
        }),
      },
      '/api/queue': { method: 'GET', handler: () => buildQueue() },
      '/api/comparison': {
        method: 'GET',
        handler: (url) => buildComparisonDetail(set, comparisonById(url.searchParams.get('id')), computeBatchFeatures),
      },
      '/api/answer': {
        method: 'POST',
        handler: (body) => {
          const { id, preference, freeText, flagged } = body ?? {}
          const c = comparisonById(id)
          const detail = buildComparisonDetail(set, c, computeBatchFeatures)
          let result
          try {
            result = ab.recordFeedback(
              set.dir,
              {
                comparisonId: c.id,
                ...(c.label !== undefined ? { label: c.label } : {}),
                question: c.question ?? set.question,
                preference: String(preference),
                freeText: String(freeText ?? ''),
                flagged: flagged === true,
                options: c.options,
                ...(detail.measurements !== null ? { measurements: detail.measurements } : {}),
              },
              logPath,
            )
          } catch (err) {
            throw new ReviewHttpError(400, String(err?.message ?? err))
          }
          const words = result.entry.freeText === '' ? '(no words)' : `"${result.entry.freeText}"`
          console.error(`${c.id}: ${result.entry.preference} — ${words}`)
          return { ok: true, log: result.logPath, answer: result.answerPath }
        },
      },
    },
  })

  const initial = buildQueue()
  if (initial.length === 0) {
    if (set.comparisons.length === 0) {
      console.error(`nothing to compare under ${root}`)
      console.error('point beat ab at a folder of renders (it infers <case>/<arm>.wav sets and <stem>--before/--after.wav pairs),')
      console.error(`or have the agent write ${join(root, ab.FEEDBACK_MANIFEST)}: {question, comparisons:[{id, options:[{name, wav}]}]}`)
    } else {
      console.error(`every comparison under ${root} is already answered (${set.comparisons.length} total)`)
      console.error(`read them: beat ab ${root} --digest    ·    re-answer: beat ab ${root} --all`)
    }
    process.exit(1)
  }
  listenReviewServer(
    server,
    port,
    () => {
      reportMissing()
      // The PID, because an agent has no ctrl-c. CLI pilot 2026-07-26 found a sibling review server
      // still listening 24 hours after the session that started it died.
      console.error(`ab: ${initial.length} unanswered comparison(s) under ${root} (${set.source}) [pid ${process.pid}]`)
      console.error(`question: ${set.question}`)
      console.error(`feedback -> ${logPath}`)
      console.error(`open http://localhost:${port} — ctrl-c here when done`)
    },
    'is another beat ab, beat board or beat rate still running?',
  )
}

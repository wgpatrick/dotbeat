#!/usr/bin/env node
// Phase 16 Stream J, item 1 — lane-granular selection for the vary affordance. Closes Phase 15
// Stream I's own deferred item: the daemon's /vary route already infers and enforces a param group
// from a selected drum LANE (resolveVaryTarget in src/daemon/daemon.ts), but nothing in the GUI
// posted a lane-level selection — clicking a lane always left the selection at the track level (or
// unset), so the group always fell back to the drums per-kind default ("hats"). StepSequencer.tsx
// now posts `{tracks:[id], lanes:[{track:id, lane}]}` when a lane LABEL (not a step) is clicked.
//
// This verification deliberately selects the KICK lane, not hats — hats is already the drums
// per-kind default, so a trigger correctly labelled "vary hats" wouldn't prove lane scoping did
// anything. Kick only shows up if the lane selection is actually read.
//
//   L1. Clicking the kick lane label posts a lane-scoped selection (store.selection.lanes has
//       {track:'drums', lane:'kick'}), and the vary trigger now reads "vary kick" (not "vary hats").
//   L2. The daemon's real /vary response (fetched directly, not just eyeballed off the UI) is
//       inspected: every edit path in every variant touches only kick-group fields (kickTune/
//       kickPunch/kickDecay) — NOT hat fields (hatTone/hatDecay/openHatDecay) or snare fields.
//   L3. Driving it through the GUI (trigger -> audition -> Keep) end to end, then a REAL git diff
//       confirms only kick synth fields changed on disk, kick fields actually moved off their
//       original values, and hat/snare fields are untouched.
//
// Usage: node ui/verify-phase16-lane-vary.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8491
const PREVIEW_PORT = 5321

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
async function pollUntil(fn, what, timeoutMs = 9000, everyMs = 25) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}
const KICK_KEYS = ['kickTune', 'kickPunch', 'kickDecay']
const OFF_LIMITS_KEYS = ['hatTone', 'hatDecay', 'openHatDecay', 'snareTone', 'snareDecay']
const pick = (synth, keys) => Object.fromEntries(keys.map((k) => [k, Math.round(Number(synth[k]) * 10000) / 10000]))
const sameOn = (a, b, keys) => keys.every((k) => a[k] === b[k])

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p16-lanevary-'))
  const beatPath = join(proj, 'night-shift.beat')
  writeFileSync(beatPath, serialize(parse(readFileSync(join(repoRoot, 'examples', 'night-shift.beat'), 'utf8'))))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline')

  const daemon = await startDaemon({ filePath: beatPath, port: PORT })
  console.log(`daemon up on :${daemon.port}, project ${beatPath}`)

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  preview.stdout.on('data', () => {})
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))
  await pollUntil(
    async () => {
      try {
        return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok
      } catch {
        return false
      }
    },
    'vite preview to serve',
    15000,
  )
  console.log(`ui served on :${PREVIEW_PORT}`)

  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const results = {}
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1280, height: 800 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    const original = pick(
      await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'drums').synth),
      [...KICK_KEYS, ...OFF_LIMITS_KEYS],
    )
    console.log(`\noriginal drums synth (kick + off-limits fields): ${JSON.stringify(original)}`)
    results.original = original

    // Editor tab shows the drums track's step grid. Select the drums track first (TrackList), the
    // way a human would land on the step sequencer at all.
    await page.click('.view-tab[data-view="editor"]')
    await page.click('.track-row:has(.track-name:text-is("drums"))')
    await page.waitForSelector('.stepseq', { timeout: 5000 })

    // ---- L1: click the KICK lane label (not a step) -> a lane-scoped selection posts ----
    await page.click('[data-lane-select="kick"]')
    await pollUntil(
      () => page.evaluate(() => window.__store.getState().selection.lanes?.some((l) => l.track === 'drums' && l.lane === 'kick')),
      'kick lane selection to post',
    )
    const selection = await page.evaluate(() => window.__store.getState().selection)
    console.log(`[L1] store selection after clicking kick lane label: ${JSON.stringify(selection)}`)
    if (!selection.tracks?.includes('drums')) throw new Error('[L1] selection.tracks does not include drums')
    if (!selection.lanes?.some((l) => l.track === 'drums' && l.lane === 'kick')) throw new Error('[L1] selection.lanes missing {track:drums, lane:kick}')

    const triggerText = await pollUntil(async () => {
      const el = await page.$('.vary-btn.trigger')
      return el ? (await el.textContent())?.trim() : null
    }, 'vary trigger button to appear')
    console.log(`[L1] vary trigger shows: "${triggerText}"`)
    if (!/vary\s+kick/i.test(triggerText)) throw new Error(`[L1] expected trigger labelled "vary kick" (proving lane scope, not the drums per-kind hats default), got "${triggerText}"`)
    results.triggerLabel = triggerText
    console.log('[L1] PASS: lane click posts {tracks:[drums], lanes:[{track:drums,lane:kick}]}; trigger correctly reads "vary kick"')

    // Also confirm the selection came from a real POST /selection round-trip, not just optimistic
    // local state: read it straight back from the daemon.
    const daemonSelection = await (await fetch(`http://localhost:${daemon.port}/selection`)).json()
    console.log(`[L1] GET /selection from the daemon itself: ${JSON.stringify(daemonSelection)}`)
    if (!daemonSelection.lanes?.some((l) => l.track === 'drums' && l.lane === 'kick')) throw new Error('[L1] daemon-side selection does not have the kick lane — POST /selection did not land')

    // ---- L2: fetch the REAL /vary batch directly and inspect every edit's path ----
    const varyRes = await fetch(`http://localhost:${daemon.port}/vary`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    if (!varyRes.ok) throw new Error(`[L2] POST /vary: HTTP ${varyRes.status} — ${await varyRes.text()}`)
    const batch = await varyRes.json()
    console.log(`\n[L2] /vary resolved group="${batch.group}" track="${batch.track}", ${batch.variants.length} variants`)
    if (batch.group !== 'kick') throw new Error(`[L2] daemon resolved group "${batch.group}", expected "kick"`)
    if (batch.track !== 'drums') throw new Error(`[L2] daemon resolved track "${batch.track}", expected "drums"`)
    const allPaths = batch.variants.flatMap((v) => v.edits.map((e) => e.path))
    console.log(`[L2] all edit paths across the batch:\n  ${allPaths.join('\n  ')}`)
    if (allPaths.length === 0) throw new Error('[L2] batch produced zero edits')
    for (const p of allPaths) {
      const field = p.split('.').pop()
      if (!KICK_KEYS.includes(field)) throw new Error(`[L2] edit path "${p}" touches field "${field}", which is NOT one of the kick group's fields (${KICK_KEYS.join(', ')})`)
      if (OFF_LIMITS_KEYS.includes(field)) throw new Error(`[L2] edit path "${p}" touches an off-limits (hat/snare) field — lane scope leaked`)
    }
    console.log(`[L2] PASS: every one of ${allPaths.length} edit paths in the batch touches only kick fields (${KICK_KEYS.join(', ')}) — never hat/snare fields`)
    results.editPaths = allPaths

    // ---- L3: drive it through the GUI end to end, confirm on disk ----
    await page.click('.vary-btn.trigger')
    await page.waitForSelector('.vary-bar.auditioning', { timeout: 8000 })
    const auditioned = pick(
      await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'drums').synth),
      [...KICK_KEYS, ...OFF_LIMITS_KEYS],
    )
    console.log(`\n[L3] auditioned variant 1 drums synth: ${JSON.stringify(auditioned)}`)
    if (sameOn(auditioned, original, KICK_KEYS)) throw new Error('[L3] audition did not change any kick field vs the original')
    if (!sameOn(auditioned, original, OFF_LIMITS_KEYS)) throw new Error('[L3] audition changed a hat/snare field — should be untouched')

    await page.click('.vary-btn.keep')
    await pollUntil(async () => {
      const disk = pick(parse(readFileSync(beatPath, 'utf8')).tracks.find((t) => t.id === 'drums').synth, [...KICK_KEYS, ...OFF_LIMITS_KEYS])
      return sameOn(disk, auditioned, KICK_KEYS) ? disk : null
    }, 'kept variant to be written to disk')
    const disk = pick(parse(readFileSync(beatPath, 'utf8')).tracks.find((t) => t.id === 'drums').synth, [...KICK_KEYS, ...OFF_LIMITS_KEYS])
    console.log(`[L3] on-disk drums synth after Keep: ${JSON.stringify(disk)}`)
    if (!sameOn(disk, auditioned, KICK_KEYS)) throw new Error('[L3] disk kick fields do not match the auditioned/kept variant')
    if (!sameOn(disk, original, OFF_LIMITS_KEYS)) throw new Error('[L3] disk hat/snare fields differ from original — scope leaked into the committed file')
    results.onDisk = disk

    console.log('\n---- real git diff of what the demo committed ----')
    const diff = git(proj, 'diff', '--', 'night-shift.beat')
    console.log(diff)
    results.diff = diff
    // Only inspect actual +/- changed lines — unchanged context lines (e.g. the untouched
    // "hatDecay 0.04" line right next to the changed kickDecay line) legitimately mention hat/snare
    // field names without meaning the edit touched them.
    const changedLines = diff.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
    if (changedLines.length === 0) throw new Error('[L3] git diff is empty')
    if (changedLines.some((l) => /hatTone|hatDecay|openHatDecay|snareTone|snareDecay/.test(l))) {
      throw new Error(`[L3] a CHANGED diff line touches hat/snare fields — the committed batch was not correctly scoped to kick:\n${changedLines.join('\n')}`)
    }
    if (!changedLines.some((l) => /kick(Tune|Punch|Decay)/.test(l))) throw new Error('[L3] no changed diff line mentions a kick field — nothing landed')
    console.log('[L3] PASS: the on-disk diff touches only kick fields, matches the kept variant, and hat/snare fields are untouched')

    await page.screenshot({ path: join(uiDir, 'verify-p16-lane-vary.png') })
    console.log('screenshot -> ui/verify-p16-lane-vary.png')

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ ALL CHECKS PASSED ================')
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nVERIFY FAILED:', err)
  process.exit(1)
})

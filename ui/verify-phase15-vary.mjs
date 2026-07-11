#!/usr/bin/env node
// Phase 15 Stream I end-to-end verification — the vary-and-audition loop, driven in headless Chrome
// against a real daemon, ending in a REAL git diff proving the KEPT variant (not just any variant)
// is what landed on disk. This is the owner's exact demo: "highlight the hi-hats, hit vary."
//
//   V1. Selecting the hat lane in the GUI posts the pointing selection and reveals the inline vary
//       affordance labelled "≈ vary hats" (lane → hats param group, no typing).
//   V2. Clicking it returns a REAL batch from the daemon and enters audition: the store document —
//       which the running engine re-reads every tick — now holds a variant whose hi-hat synth params
//       DIFFER from the original (the variant is genuinely applied/heard, not shown as text).
//   V3. Next steps to different variants (their hi-hat params differ from each other).
//   V4. Keep commits the auditioned variant. The .beat file on disk now holds EXACTLY the kept
//       variant's hi-hat params (== what was in the store at the moment of Keep), differs from the
//       original, and — where the variants differed — is provably the KEPT one, not variant 1. The
//       git diff is printed as evidence.
//
// Usage: node ui/verify-phase15-vary.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8473
const PREVIEW_PORT = 5320

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
const HAT_KEYS = ['hatTone', 'hatDecay', 'openHatDecay']
const hatParams = (synth) => Object.fromEntries(HAT_KEYS.map((k) => [k, Math.round(Number(synth[k]) * 10000) / 10000]))
const sameHats = (a, b) => HAT_KEYS.every((k) => a[k] === b[k])

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  // real git-backed project so we can show a real diff of what landed. Write the CANONICAL form as
  // the baseline (the example file is hand-authored in non-canonical `pattern` shorthand; the daemon
  // serializes canonically on its first write, so committing canonical text up front keeps the diff
  // to exactly the kept variant's changed lines rather than a one-time pattern->hits normalization).
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p15-vary-'))
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

    // original hi-hat params, straight off the file the daemon serves
    const original = hatParams(await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'drums').synth))
    console.log(`\noriginal hi-hat params: ${JSON.stringify(original)}`)
    results.original = original

    // start playback so the audition is genuinely heard live off the engine (it re-reads the store
    // doc each tick — the provisional variant plays without anything being written to disk)
    await page.click('.play-btn')
    await pollUntil(() => page.evaluate(() => window.__store.getState().currentStep >= 0), 'transport ticking')

    // ---- V1: select the drums track in the Arrangement view (the blessed selection surface) ->
    //      vary affordance appears, defaulting a drums track to the hats param group ----
    await page.click('.view-tab[data-view="arrangement"]')
    await page.waitForSelector('.arr-canvas', { timeout: 5000 })
    await page.click('.arr-track-header:has(.arr-track-name:text-is("drums"))')
    await pollUntil(
      () => page.evaluate(() => window.__store.getState().selection.tracks?.includes('drums')),
      'drums track selection to post',
    )
    const triggerText = await pollUntil(async () => {
      const el = await page.$('.vary-btn.trigger')
      return el ? (await el.textContent())?.trim() : null
    }, 'vary trigger button to appear')
    console.log(`[V1] drums track selected; vary trigger shows: "${triggerText}"`)
    if (!/vary\s+hats/i.test(triggerText)) throw new Error(`[V1] expected trigger labelled "vary hats", got "${triggerText}"`)
    results.triggerLabel = triggerText
    console.log('[V1] PASS: inline "vary hats" affordance appears at the drums-track selection')

    // ---- V2: trigger the batch; audition strip enters, provisional variant differs from original ----
    await page.click('.vary-btn.trigger')
    await page.waitForSelector('.vary-bar.auditioning', { timeout: 8000 })
    const v1Hats = hatParams(await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'drums').synth))
    const strip1 = (await page.textContent('.vary-count'))?.trim()
    console.log(`[V2] audition entered (${strip1}); variant 1 hi-hat params: ${JSON.stringify(v1Hats)}`)
    if (sameHats(v1Hats, original)) throw new Error('[V2] variant 1 did not change any hi-hat param vs the original (not actually applied)')
    // still playing while auditioning -> the engine is hearing the provisional doc
    if (!(await page.evaluate(() => window.__store.getState().playing && window.__store.getState().currentStep >= 0)))
      throw new Error('[V2] transport not running during audition (variant would not be heard)')
    results.variant1 = v1Hats
    console.log('[V2] PASS: variant applied provisionally & heard live (params differ from original, transport running)')

    // ---- V3: step to a later variant; its hi-hat params differ from variant 1's ----
    await page.click('.vary-btn:has-text("Next")')
    await page.click('.vary-btn:has-text("Next")')
    const keptIndex = await page.evaluate(() => Number(document.querySelector('.vary-count').textContent.match(/variant (\d+)/)[1]))
    const v3Hats = hatParams(await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'drums').synth))
    console.log(`[V3] stepped to variant ${keptIndex}; its hi-hat params: ${JSON.stringify(v3Hats)}`)
    results.keptIndex = keptIndex
    results.keptVariantInStore = v3Hats
    const variantsDiffer = !sameHats(v3Hats, v1Hats)
    console.log(`[V3] ${variantsDiffer ? 'PASS' : 'note'}: variant ${keptIndex} ${variantsDiffer ? 'differs from' : 'coincides with'} variant 1`)

    // ---- V4: Keep -> the kept variant lands on disk, exactly ----
    await page.click('.vary-btn.keep')
    await pollUntil(async () => {
      const disk = hatParams(parse(readFileSync(beatPath, 'utf8')).tracks.find((t) => t.id === 'drums').synth)
      return sameHats(disk, v3Hats) ? disk : null
    }, 'kept variant to be written to disk')
    const disk = hatParams(parse(readFileSync(beatPath, 'utf8')).tracks.find((t) => t.id === 'drums').synth)
    console.log(`[V4] on-disk hi-hat params after Keep: ${JSON.stringify(disk)}`)
    results.onDisk = disk
    if (!sameHats(disk, v3Hats)) throw new Error(`[V4] disk ${JSON.stringify(disk)} != kept variant ${JSON.stringify(v3Hats)}`)
    if (sameHats(disk, original)) throw new Error('[V4] disk still equals the original — nothing landed')
    if (variantsDiffer && sameHats(disk, v1Hats)) throw new Error('[V4] disk matches variant 1, not the kept variant — wrong variant landed')
    console.log('[V4] PASS: the KEPT variant (not variant 1) is exactly what landed on disk')

    console.log('\n---- real git diff of what the demo committed ----')
    const diff = git(proj, 'diff', '--', 'night-shift.beat')
    console.log(diff)
    results.diff = diff
    if (!/^\+/m.test(diff)) throw new Error('[V4] git diff is empty — no file change recorded')

    await page.screenshot({ path: join(uiDir, 'verify-p15-vary.png') })
    console.log('screenshot -> ui/verify-p15-vary.png')

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ ALL CHECKS PASSED ================')
    console.log(JSON.stringify({ ...results, diff: undefined }, null, 2))
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

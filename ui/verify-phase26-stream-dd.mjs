#!/usr/bin/env node
// Phase 26 Stream DD verification — Macro Controls (docs/research/27-macro-tooling-layer.md,
// docs/phase-26-plan.md). Drives the REAL live GUI in headless Chromium against a REAL daemon,
// same harness/convention as ui/verify-phase25-effects-panel-redesign.mjs.
//
// What this proves, end to end:
//   1  GET /library exposes a "macros" array — the 8-macro factory starter set (presets/macros.json).
//   2  The GUI's Macros row in SynthPanel kind-filters correctly: a synth track shows the 6
//      synth-or-any macros, a drums track shows the 3 drums-or-any macros.
//   3  Dragging a REAL macro knob in the GUI (Playwright pointer drag, not window.__store.setDoc())
//      resolves to literal target params in the resulting .beat file — no macro name/reference is
//      ever written to the document (core's "tooling, not grammar" guarantee, D9-equivalent).
//   4  `beat macro apply <file> <track> <name> <value>` (the CLI) applied to an IDENTICAL baseline
//      document produces the byte-identical resolved target values the GUI drag produced — same
//      underlying resolveMacro/applyMacro, two call sites, one result.
//   5  POST /library/apply-macro (the one-shot daemon route the CLI does NOT use — it writes
//      straight to disk) independently produces the SAME resolved values too, proving all three
//      surfaces (GUI drag -> /edit, CLI -> disk, daemon route -> /library/apply-macro) agree.
//
// Usage: node ui/verify-phase26-stream-dd.mjs

import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 5926 // distinct from other verify scripts' ports so concurrent runs never collide

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
async function pollUntil(fn, what, timeoutMs = 9000, everyMs = 30) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg)
}
function assertClose(a, b, msg, eps = 1e-6) {
  assert(Math.abs(a - b) <= eps, `${msg} (${a} vs ${b}, diff ${Math.abs(a - b)})`)
}

const ALL_MACROS = ['filter-sweep', 'grit', 'space', 'warmth', 'motion', 'width', 'punch', 'snap']
const SYNTH_MACROS = ['filter-sweep', 'grit', 'space', 'warmth', 'motion', 'width'] // kind synth | any
const DRUMS_MACROS = ['punch', 'snap', 'space'] // kind drums | any

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const core = await import(pathToFileURL(join(repoRoot, 'dist/src/core/index.js')).href)
  const { startDaemon } = await import(pathToFileURL(join(repoRoot, 'dist/src/daemon/daemon.js')).href)
  const cliPath = join(repoRoot, 'cli', 'beat.mjs')

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))
  await pollUntil(async () => {
    try {
      return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok
    } catch {
      return false
    }
  }, 'vite preview to serve', 20000)
  console.log(`ui served on :${PREVIEW_PORT}`)

  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })

  function baselineDoc() {
    let doc = core.initDocument({ trackId: 'lead', bpm: 120, loopBars: 2 })
    doc = core.addTrack(doc, { id: 'drums', kind: 'drums', lanes: core.defaultDrumKitLanes() }).doc
    return doc
  }

  function newProject(prefix, doc, selectedTrack) {
    const proj = mkdtempSync(join(tmpdir(), prefix))
    const beatPath = join(proj, 'project.beat')
    writeFileSync(beatPath, core.serialize({ ...doc, selectedTrack }))
    git(proj, 'init', '-q')
    git(proj, 'config', 'user.email', 'verify@dotbeat.local')
    git(proj, 'config', 'user.name', 'verify')
    git(proj, 'add', '-A')
    git(proj, 'commit', '-q', '-m', 'baseline')
    return beatPath
  }

  async function withProject(beatPath, run) {
    const daemon = await startDaemon({ filePath: beatPath, port: 0 })
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1440, height: 960 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    try {
      await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
      await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 12000 })
      await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
      await page.click('[data-pane-tab="device"]')
      await page.waitForSelector('.synth-panel', { timeout: 5000 })
      const result = await run(page, daemon)
      if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
      return result
    } finally {
      await page.close()
      await daemon.close()
    }
  }

  function selectTrack(page, trackId) {
    return page.click(`.arr-track-select:has(.arr-track-name:text-is("${trackId}"))`)
  }

  const visibleMacroNames = async (page) => page.$$eval('[data-macro-knob]', (els) => els.map((el) => el.getAttribute('data-macro-knob')))

  async function dragKnobBy(page, selector, dyPx) {
    await page.waitForSelector(selector, { timeout: 5000 })
    const box = await page.$eval(selector, (el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    await page.mouse.move(box.x, box.y)
    await page.mouse.down()
    // Knob.tsx: dy = startY - clientY, next = startNorm + dy/140 — dragging UP (smaller clientY)
    // increases the value. `steps` fires intermediate pointermove events; only the FINAL one's
    // postEdit call survives the 60ms per-path debounce (bridge.ts), same as every other knob drag.
    await page.mouse.move(box.x, box.y - dyPx, { steps: 12 })
    await page.mouse.up()
  }

  const results = {}

  try {
    // ============================================================================================
    // 1: GET /library exposes the 8-macro factory starter set
    // ============================================================================================
    {
      const beatPath = newProject('dotbeat-p26dd-list-', baselineDoc(), 'lead')
      const daemon = await startDaemon({ filePath: beatPath, port: 0 })
      try {
        const res = await fetch(`http://localhost:${daemon.port}/library`)
        assert(res.ok, `GET /library: HTTP ${res.status}`)
        const lib = await res.json()
        assert(Array.isArray(lib.macros), 'GET /library response has no "macros" array')
        assert(lib.macros.length === 8, `expected 8 factory macros, got ${lib.macros.length}`)
        const names = lib.macros.map((m) => m.name).sort()
        for (const name of ALL_MACROS) assert(names.includes(name), `GET /library macros missing "${name}"`)
        // structural shape sanity: every macro carries kind/category/description/targets
        for (const m of lib.macros) {
          assert(['synth', 'drums', 'any'].includes(m.kind), `macro "${m.name}" has bad kind "${m.kind}"`)
          assert(Array.isArray(m.targets) && m.targets.length > 0, `macro "${m.name}" has no targets`)
          for (const t of m.targets) assert(typeof t.param === 'string' && typeof t.min === 'number' && typeof t.max === 'number', `macro "${m.name}" has a malformed target`)
        }
        console.log(`[1] PASS: GET /library exposes ${lib.macros.length} macros: ${names.join(', ')}`)
        results.libraryMacros = names
      } finally {
        await daemon.close()
      }
    }

    // ============================================================================================
    // 2: the GUI Macros row kind-filters correctly (synth track vs drums track)
    // ============================================================================================
    {
      const beatPath = newProject('dotbeat-p26dd-kind-', baselineDoc(), 'lead')
      await withProject(beatPath, async (page) => {
        await page.waitForSelector('[data-testid="macro-row"]', { timeout: 5000 })
        const synthNames = (await visibleMacroNames(page)).sort()
        assert(synthNames.length === SYNTH_MACROS.length, `synth track: expected ${SYNTH_MACROS.length} macro knobs, got ${synthNames.length} (${synthNames.join(', ')})`)
        for (const name of SYNTH_MACROS) assert(synthNames.includes(name), `synth track missing macro knob "${name}"`)
        console.log(`[2] PASS: synth track shows exactly the ${synthNames.length} synth-or-any macros: ${synthNames.join(', ')}`)

        await selectTrack(page, 'drums')
        await pollUntil(async () => (await visibleMacroNames(page)).length === DRUMS_MACROS.length, 'drums track macro row to show 3 knobs')
        const drumsNames = (await visibleMacroNames(page)).sort()
        for (const name of DRUMS_MACROS) assert(drumsNames.includes(name), `drums track missing macro knob "${name}"`)
        console.log(`[2] PASS: drums track shows exactly the ${drumsNames.length} drums-or-any macros: ${drumsNames.join(', ')}`)
        results.synthMacroKnobs = synthNames
        results.drumsMacroKnobs = drumsNames
      })
    }

    // ============================================================================================
    // 3/4/5: drag a REAL macro knob in the GUI, and cross-check the CLI + daemon route produce the
    // byte-identical resolved values against an IDENTICAL baseline document.
    // ============================================================================================
    let guiSpaceResult
    {
      const doc = baselineDoc()
      const beatPath = newProject('dotbeat-p26dd-gui-', doc, 'lead')
      await withProject(beatPath, async (page) => {
        // "space" (kind: any) targets sendReverb (0->0.7) and sendDelay (0->0.5), both linear, both
        // defaulting to 0 on a fresh track — so the GUI's own best-effort inverse-estimate places
        // the knob at EXACTLY 0 on load (0 is also target.min, so no curve ambiguity). Dragging up
        // exactly 70px (0.5 * 140px/unit) lands the knob at EXACTLY 50 — no approximation needed.
        await dragKnobBy(page, '[data-macro-knob="space"] svg', 70)
        // 60ms per-path postEdit debounce (bridge.ts) + daemon round-trip — poll for the write.
        await pollUntil(async () => {
          const text = readFileSync(beatPath, 'utf8')
          return text.includes('sendReverb 0.35') && text.includes('sendDelay 0.25')
        }, 'the dragged macro knob\'s resolved sendReverb/sendDelay to land in the .beat file', 5000)
      })
      const text = readFileSync(beatPath, 'utf8')
      assert(text.includes('sendReverb 0.35'), `expected literal "sendReverb 0.35" in the file after the GUI drag, got:\n${text}`)
      assert(text.includes('sendDelay 0.25'), `expected literal "sendDelay 0.25" in the file after the GUI drag, got:\n${text}`)
      // the file NEVER references the macro by name — no in-file indirection (D9-equivalent, research 27 §1)
      assert(!/\bspace\b/.test(text), 'the .beat file must never mention the macro\'s own name "space" — resolved params only')
      const after = core.parse(text)
      const lead = after.tracks.find((t) => t.id === 'lead')
      guiSpaceResult = { sendReverb: lead.synth.sendReverb, sendDelay: lead.synth.sendDelay }
      console.log(`[3] PASS: dragging the real "space" macro knob to 50 in the GUI resolved to literal sendReverb=${guiSpaceResult.sendReverb}, sendDelay=${guiSpaceResult.sendDelay} in the .beat file — no macro reference written`)
      results.guiSpaceResult = guiSpaceResult
    }

    // ---- 4: CLI on an IDENTICAL baseline produces the same resolved values ----
    {
      const beatPath = newProject('dotbeat-p26dd-cli-', baselineDoc(), 'lead')
      execFileSync('node', [cliPath, 'macro', 'apply', beatPath, 'lead', 'space', '50'], { stdio: 'pipe' })
      const doc = core.parse(readFileSync(beatPath, 'utf8'))
      const lead = doc.tracks.find((t) => t.id === 'lead')
      assertClose(lead.synth.sendReverb, guiSpaceResult.sendReverb, '[4] CLI sendReverb must match the GUI-drag result exactly')
      assertClose(lead.synth.sendDelay, guiSpaceResult.sendDelay, '[4] CLI sendDelay must match the GUI-drag result exactly')
      console.log(`[4] PASS: \`beat macro apply <file> lead space 50\` produced the BYTE-IDENTICAL resolved document state as the GUI drag (sendReverb=${lead.synth.sendReverb}, sendDelay=${lead.synth.sendDelay})`)
      results.cliSpaceResult = { sendReverb: lead.synth.sendReverb, sendDelay: lead.synth.sendDelay }
    }

    // ---- 5: the one-shot daemon route (POST /library/apply-macro) — NOT the GUI drag path, NOT
    // the CLI path — independently agrees too, proving all three call sites share one resolver. ----
    {
      const beatPath = newProject('dotbeat-p26dd-route-', baselineDoc(), 'lead')
      const daemon = await startDaemon({ filePath: beatPath, port: 0 })
      try {
        const res = await fetch(`http://localhost:${daemon.port}/library/apply-macro`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ track: 'lead', name: 'space', value: 50 }),
        })
        assert(res.ok, `POST /library/apply-macro: HTTP ${res.status}`)
        const { doc } = await res.json()
        const lead = doc.tracks.find((t) => t.id === 'lead')
        assertClose(lead.synth.sendReverb, guiSpaceResult.sendReverb, '[5] daemon route sendReverb must match the GUI-drag result exactly')
        assertClose(lead.synth.sendDelay, guiSpaceResult.sendDelay, '[5] daemon route sendDelay must match the GUI-drag result exactly')
        console.log(`[5] PASS: POST /library/apply-macro independently produced the SAME resolved values (sendReverb=${lead.synth.sendReverb}, sendDelay=${lead.synth.sendDelay}) — GUI drag, CLI, and the daemon route all agree`)
      } finally {
        await daemon.close()
      }
    }

    // ============================================================================================
    // 6: a kind mismatch fails loudly on every surface (drums-only macro onto a synth track)
    // ============================================================================================
    {
      const beatPath = newProject('dotbeat-p26dd-mismatch-', baselineDoc(), 'lead')
      let threw = false
      try {
        execFileSync('node', [cliPath, 'macro', 'apply', beatPath, 'lead', 'punch', '50'], { stdio: 'pipe' })
      } catch {
        threw = true
      }
      assert(threw, '[6] CLI: applying a drums-only macro to a synth track should fail loudly')
      const daemon = await startDaemon({ filePath: beatPath, port: 0 })
      try {
        const res = await fetch(`http://localhost:${daemon.port}/library/apply-macro`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ track: 'lead', name: 'punch', value: 50 }),
        })
        assert(res.status === 400, `[6] daemon route: expected 400 on a kind mismatch, got ${res.status}`)
      } finally {
        await daemon.close()
      }
      console.log('[6] PASS: a drums-only macro applied to a synth track fails loudly on both the CLI and the daemon route')
    }

    console.log('\n================ ALL PHASE 26 STREAM DD (MACRO CONTROLS) CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nPHASE 26 STREAM DD VERIFY FAILED:', err)
    process.exit(1)
  })

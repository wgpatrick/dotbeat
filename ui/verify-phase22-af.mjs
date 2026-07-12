#!/usr/bin/env node
// Phase 22 Stream AF — "Track & project polish bundle", verified live end-to-end against a REAL
// `beat daemon` on a real project, driven through the REAL frontend in headless Chromium. Same bar
// every prior stream used: every assertion checks the on-disk .beat file (or a real second file the
// GUI action created), not just the in-browser store.
//
//   AF1 GROUP     check two tracks' "pick for grouping" boxes, click "+ group"; a `group <id> <name>
//                 <color> <track-id> <track-id>` line appears in the .beat file; collapsing/expanding
//                 hides/shows the member rows in the DOM; a page reload proves group MEMBERSHIP
//                 persists (it's in the file) while collapse resets to expanded (it's UI-only session
//                 state — deliberately never written); ungrouping removes the `group` line and leaves
//                 both tracks untouched.
//   AF2 NEWPROJECT click "new project…", answer the folder prompt; a real, valid, freshly-`beat
//                 init`-shaped .beat file exists on disk (parses, one starter track, the requested bpm).
//   AF3 TEMPLATE   click "save as template…"; the template is a byte-identical copy of the CURRENT
//                 project file. Click "new from template…" to start a new project FROM that template;
//                 it starts as a byte-identical copy. Editing the new project (via a second daemon
//                 instance's real POST /add-track — the same mechanism AF2/Phase 20 Stream W use, not
//                 a mock) leaves BOTH the template and the original project byte-for-byte unchanged —
//                 opening/starting-from a template never mutates it.
//
// Usage: node ui/verify-phase22-af.mjs

import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8722 // distinct from other verify scripts' ports so concurrent runs never collide
const PREVIEW_PORT = 5911

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
const trackLines = (text) => text.split('\n').filter((l) => l.startsWith('track '))
const groupLines = (text) => text.split('\n').filter((l) => l.startsWith('group '))

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p22af-'))
  const beatPath = join(proj, 'night-shift.beat')
  writeFileSync(beatPath, serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8'))))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline night-shift')
  const readBeat = () => readFileSync(beatPath, 'utf8')

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
  const daemonsToClose = [daemon]
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1440, height: 960 })
    const errors = []
    page.on('pageerror', (e) => {
      errors.push(String(e))
      console.log(`[pageerror] ${e}`)
    })
    page.on('console', (m) => {
      if (m.type() === 'warning' || m.type() === 'error') console.log(`[browser ${m.type()}] ${m.text()}`)
    })
    // A queue of answers for the NEXT `prompt()` dialog(s), consumed in order — each AF2/AF3 action
    // fires one or two sequential window.prompt()s (folder/template path, then destination). alert()
    // and confirm() are just accepted (no text needed).
    const promptQueue = []
    page.on('dialog', async (d) => {
      if (d.type() === 'prompt') {
        const answer = promptQueue.shift()
        console.log(`[prompt] "${d.message()}" -> ${JSON.stringify(answer)}`)
        if (answer === undefined) {
          await d.dismiss()
          return
        }
        await d.accept(answer)
      } else {
        console.log(`[${d.type()}] ${d.message()}`)
        await d.accept()
      }
    })
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
    await page.waitForSelector('.arrangement .arr-canvas', { timeout: 5000 })

    // ============ AF1: track grouping ============
    const before = readBeat()
    if (groupLines(before).length !== 0) throw new Error('[AF1] fixture unexpectedly already has a group line')

    await page.click('[data-group-pick="lead"]')
    await page.click('[data-group-pick="drums"]')
    await page.click('[data-action="group-tracks"]')

    const groupId = await pollUntil(
      () => page.evaluate(() => window.__store.getState().doc.groups[0]?.id ?? false),
      'a group to appear in the store',
    )
    const groupLine = await pollUntil(() => {
      const line = groupLines(readBeat())[0]
      return line || false
    }, 'a group line to land in the .beat file')
    if (!new RegExp(`^group ${groupId} [^ ]+ #[0-9a-f]{6} lead drums$`).test(groupLine)) {
      throw new Error(`[AF1] unexpected group line: "${groupLine}"`)
    }
    // exactly one new line, nothing else touched
    const groupDiff = git(proj, 'diff', '--', 'night-shift.beat')
    const addedLines = groupDiff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    if (addedLines.length !== 2 || !addedLines.some((l) => l.startsWith('+group '))) {
      throw new Error(`[AF1] diff did not add exactly one group line (+ blank separator):\n${groupDiff}`)
    }
    console.log(`[AF1a] PASS: grouped lead+drums -> "${groupLine}" (git diff adds exactly that line)`)
    await page.screenshot({ path: join(uiDir, 'verify-p22-af-group.png') })

    // Collapsing hides the member rows in the DOM; expanding brings them back. Session-only — no
    // network call, no file write.
    await page.waitForSelector(`[data-group="${groupId}"]`, { timeout: 3000 })
    const rowsVisible = () => page.$$eval('.arr-row[data-track]', (els) => els.map((e) => e.dataset.track))
    // (arr-row doesn't carry data-track directly — use the header's data-color, which every TrackRow renders)
    const memberRowVisible = (id) => page.$(`[data-color="${id}"]`).then((el) => !!el)
    if (!(await memberRowVisible('lead')) || !(await memberRowVisible('drums'))) throw new Error('[AF1b] member rows should be visible before collapsing')
    await page.click(`[data-group-toggle="${groupId}"]`)
    await pollUntil(async () => !(await memberRowVisible('lead')) && !(await memberRowVisible('drums')), 'member rows to disappear once collapsed')
    console.log('[AF1b] PASS: collapsing the group hides both member rows')
    await page.click(`[data-group-toggle="${groupId}"]`)
    await pollUntil(async () => (await memberRowVisible('lead')) && (await memberRowVisible('drums')), 'member rows to reappear once expanded')
    console.log('[AF1c] PASS: expanding the group brings both member rows back')
    void rowsVisible // (unused helper kept for readability of the two approaches considered)

    // A reload proves group MEMBERSHIP round-trips (it's in the file); collapse resets to expanded
    // (it's UI-only session state that deliberately never touches the file).
    await page.click(`[data-group-toggle="${groupId}"]`) // collapse right before reload
    await pollUntil(async () => !(await memberRowVisible('lead')), 'collapsed before reload')
    await page.reload({ waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
    const groupsAfterReload = await page.evaluate(() => window.__store.getState().doc.groups)
    if (groupsAfterReload.length !== 1 || groupsAfterReload[0].tracks.join(',') !== 'lead,drums') {
      throw new Error(`[AF1d] group membership did not survive a reload: ${JSON.stringify(groupsAfterReload)}`)
    }
    if (!(await memberRowVisible('lead')) || !(await memberRowVisible('drums'))) {
      throw new Error('[AF1d] the group should be EXPANDED again after reload (collapse is session-only, not in the file)')
    }
    console.log('[AF1d] PASS: group membership persists through a reload; collapse state does not (resets to expanded)')
    results.af1 = { groupId, groupLine, membershipPersists: true, collapseIsSessionOnly: true }

    // Ungroup: the `group` line disappears; both tracks are untouched (still present, unchanged).
    const beforeUngroup = trackLines(readBeat())
    await page.click(`[data-ungroup="${groupId}"]`)
    await pollUntil(() => page.evaluate(() => window.__store.getState().doc.groups.length === 0), 'the group to be gone from the store')
    await pollUntil(() => groupLines(readBeat()).length === 0, 'the group line to be gone from the file')
    const afterUngroup = trackLines(readBeat())
    if (afterUngroup.join('\n') !== beforeUngroup.join('\n')) throw new Error('[AF1e] ungrouping should not touch any track line')
    console.log('[AF1e] PASS: ungrouping removed the group line; both tracks are byte-identical to before')
    results.af1.ungroupLeavesTracksUntouched = true

    // ============ AF2: new-project-from-scratch, GUI-reachable ============
    const newProjectDir = mkdtempSync(join(tmpdir(), 'dotbeat-p22af-newproj-'))
    promptQueue.push(newProjectDir)
    await page.click('[data-action="new-project"]')
    const newProjectPath = await pollUntil(() => {
      const p = join(newProjectDir, 'project.beat')
      return existsSync(p) ? p : false
    }, 'a new project.beat to appear on disk')
    const newProjectDoc = parse(readFileSync(newProjectPath, 'utf8'))
    if (newProjectDoc.tracks.length !== 1) throw new Error(`[AF2] expected the format's standard one-starter-track init patch, got ${newProjectDoc.tracks.length} tracks`)
    if (newProjectDoc.bpm !== 120) throw new Error(`[AF2] expected the default 120 bpm, got ${newProjectDoc.bpm}`)
    console.log(`[AF2] PASS: "new project…" created a real, valid .beat file at ${newProjectPath} (${newProjectDoc.tracks.length} track, ${newProjectDoc.bpm} bpm)`)
    results.af2 = { filePath: newProjectPath, tracks: newProjectDoc.tracks.length, bpm: newProjectDoc.bpm }

    // ============ AF3: save project as template + start a new project from it ============
    const templateDir = mkdtempSync(join(tmpdir(), 'dotbeat-p22af-template-'))
    const currentProjectBytesBeforeTemplate = readBeat()
    promptQueue.push(templateDir)
    await page.click('[data-action="save-template"]')
    const templatePath = await pollUntil(() => {
      const p = join(templateDir, 'template.beat')
      return existsSync(p) ? p : false
    }, 'a template.beat to appear on disk')
    const templateBytesAtSave = readFileSync(templatePath, 'utf8')
    if (templateBytesAtSave !== currentProjectBytesBeforeTemplate) throw new Error('[AF3a] the template should be a byte-identical copy of the current project')
    console.log(`[AF3a] PASS: "save as template…" wrote a byte-identical copy to ${templatePath}`)

    const fromTemplateDir = mkdtempSync(join(tmpdir(), 'dotbeat-p22af-fromtemplate-'))
    promptQueue.push(templatePath, fromTemplateDir)
    await page.click('[data-action="new-from-template"]')
    const startedProjectPath = await pollUntil(() => {
      const p = join(fromTemplateDir, 'project.beat')
      return existsSync(p) ? p : false
    }, 'a new project started from the template to appear on disk')
    const startedBytesAtCreate = readFileSync(startedProjectPath, 'utf8')
    if (startedBytesAtCreate !== templateBytesAtSave) throw new Error('[AF3b] a project started from a template should begin as a byte-identical copy')
    console.log(`[AF3b] PASS: "new from template…" started ${startedProjectPath} as a byte-identical copy of the template`)

    // Edit the NEW project for real — a second daemon instance's real POST /add-track (the same
    // mechanism Phase 20 Stream W / AF2 use), not a hand-written mutation — then confirm BOTH the
    // template and the ORIGINAL project are still byte-for-byte what they were: opening/starting a
    // project from a template never mutates it.
    const startedDaemon = await startDaemon({ filePath: startedProjectPath, port: 0 })
    daemonsToClose.push(startedDaemon)
    const addRes = await fetch(`http://127.0.0.1:${startedDaemon.port}/add-track`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'newtrack', kind: 'synth' }),
    })
    if (!addRes.ok) throw new Error(`[AF3c] could not edit the started project: HTTP ${addRes.status}`)
    const startedBytesAfterEdit = readFileSync(startedProjectPath, 'utf8')
    if (startedBytesAfterEdit === startedBytesAtCreate) throw new Error('[AF3c] the started project did not actually change after the edit')
    if (readFileSync(templatePath, 'utf8') !== templateBytesAtSave) throw new Error('[AF3c] editing the started project mutated the TEMPLATE — this is the bug the feature exists to prevent')
    if (readBeat() !== currentProjectBytesBeforeTemplate) throw new Error('[AF3c] editing the started project mutated the ORIGINAL project')
    console.log('[AF3c] PASS: editing the new project left the template AND the original project byte-for-byte untouched')
    results.af3 = { templatePath, startedProjectPath, templateUntouchedAfterEdit: true, originalUntouchedAfterEdit: true }

    if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
    console.log('\nALL PASS — Phase 22 Stream AF (track & project polish bundle) verified live:')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGKILL')
    for (const d of daemonsToClose) await d.close()
  }
}

main()
  .then(() => process.exit(0)) // open SSE/watcher handles otherwise keep the process alive
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })

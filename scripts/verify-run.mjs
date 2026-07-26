#!/usr/bin/env node
// scripts/verify-run.mjs — the verify fleet's runner (W1.5 / R6-8 step 2).
//
// Before this, "the full verify suite" was folklore: `npm test` runs node --test over dist/test
// and nothing else, and every ui/verify-*.mjs documented one-off manual invocation in its header.
// docs/phase-35-plan.md:158 claims "the full verify suite + 635 tests" was run — with no tooling
// for the former in existence. That is also the answer to "what gates an engine refactor?", which
// until now was "an agent remembering to hand-run some of ~102 scripts."
//
//   npm run verify                     every live script in ui/verify-manifest.mjs
//   npm run verify:engine              only the audio-invariant tier — the engine gate (R6-2)
//   npm run verify -- --area effects   one area
//   npm run verify -- --filter phase27 name substring
//   npm run verify -- --list           show the selection without running it
//   npm run verify -- --timeout 600    per-script seconds (default 300)
//   npm run verify -- --bail           stop at the first failure
//
// The build runs ONCE here (repo root + ui) and children get VERIFY_SKIP_BUILD=1. Scripts ported
// to ui/verify-lib.mjs honour that; unported ones still rebuild themselves, which is exactly the
// visible cost that makes porting worth it (95 scripts x 2 builds).
//
// Scripts run SEQUENTIALLY and never in parallel: each boots a daemon, a vite preview and a
// headless Chromium, and the unported ones still hardcode their own magic port pair.
//
// Exit code is 0 only if every selected script exited 0. `legacy` scripts are reported as skipped
// with their manifest reason and are excluded from the pass rate — a status, never a silent pass.

import { execFileSync, spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectScripts, TIERS, VERIFY_SCRIPTS } from '../ui/verify-manifest.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const opts = { tier: null, area: null, filter: null, list: false, bail: false, timeout: 300, build: true, includeLegacy: false }
  const valued = ['--tier', '--area', '--filter', '--timeout']
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--tier') opts.tier = argv[++i]
    else if (a === '--area') opts.area = argv[++i]
    else if (a === '--filter') opts.filter = argv[++i]
    else if (a === '--timeout') opts.timeout = Number(argv[++i])
    else if (a === '--list') opts.list = true
    else if (a === '--bail') opts.bail = true
    else if (a === '--no-build') opts.build = false
    else if (a === '--include-legacy') opts.includeLegacy = true
    else if (!valued.includes(argv[i - 1])) {
      console.error(`error: unknown flag "${a}" (known: ${['--tier', '--area', '--filter', '--timeout', '--list', '--bail', '--no-build', '--include-legacy'].join(', ')})`)
      process.exit(2)
    }
  }
  if (opts.tier && opts.tier !== 'all' && !TIERS.includes(opts.tier)) {
    console.error(`error: unknown tier "${opts.tier}" (known: ${TIERS.join(', ')}, all)`)
    process.exit(2)
  }
  if (!Number.isFinite(opts.timeout) || opts.timeout <= 0) {
    console.error('error: --timeout needs a positive number of seconds')
    process.exit(2)
  }
  return opts
}

/** Run one script to completion, streaming its output so a long GUI script isn't a black box. */
function runScript(script, timeoutSeconds) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const child = spawn(process.execPath, [join(repoRoot, script)], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, VERIFY_SKIP_BUILD: '1' },
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutSeconds * 1000)
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({
        script,
        ms: Date.now() - t0,
        status: timedOut ? 'TIMEOUT' : code === 0 ? 'PASS' : 'FAIL',
        detail: timedOut ? `killed after ${timeoutSeconds}s` : code === 0 ? '' : `exit ${code ?? signal}`,
      })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ script, ms: Date.now() - t0, status: 'FAIL', detail: `spawn: ${err.message}` })
    })
  })
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const selected = selectScripts(opts)
  const legacy = VERIFY_SCRIPTS.filter(
    (e) =>
      e.status === 'legacy' &&
      (!opts.tier || opts.tier === 'all' || e.tier === opts.tier) &&
      (!opts.area || e.area === opts.area) &&
      (!opts.filter || e.script.includes(opts.filter)),
  )

  const label = `tier=${opts.tier ?? 'all'}${opts.area ? ` area=${opts.area}` : ''}${opts.filter ? ` filter=${opts.filter}` : ''}`
  console.log(`verify: ${selected.length} live script(s) selected (${label})`)
  for (const e of legacy) console.log(`  SKIP (legacy) ${e.script} — ${e.note ?? 'no reason recorded'}`)

  if (opts.list) {
    for (const e of selected) console.log(`  ${e.tier.padEnd(6)} ${e.area.padEnd(16)} ${e.script}`)
    return
  }
  if (selected.length === 0) {
    console.error('error: nothing selected')
    process.exit(2)
  }

  if (opts.build) {
    console.log('\nbuilding once for the whole run (repo core/daemon/metrics, then ui)...')
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
    execFileSync('npm', ['run', 'build'], { cwd: join(repoRoot, 'ui'), stdio: 'inherit' })
  }

  const results = []
  for (const [i, e] of selected.entries()) {
    console.log(`\n${'='.repeat(90)}\n[${i + 1}/${selected.length}] ${e.script}  (${e.tier}/${e.area})\n${'='.repeat(90)}`)
    const r = await runScript(e.script, opts.timeout)
    results.push({ ...r, tier: e.tier, area: e.area })
    console.log(`--> ${r.status} ${e.script} (${(r.ms / 1000).toFixed(1)}s)${r.detail ? ` — ${r.detail}` : ''}`)
    if (opts.bail && r.status !== 'PASS') {
      console.log('bailing out (--bail)')
      break
    }
  }

  const pass = results.filter((r) => r.status === 'PASS')
  console.log(`\n${'='.repeat(90)}\nverify summary (${label})\n${'='.repeat(90)}`)
  for (const r of results) {
    console.log(`  ${r.status.padEnd(8)} ${(r.ms / 1000).toFixed(1).padStart(7)}s  ${r.script}${r.detail ? `  (${r.detail})` : ''}`)
  }
  const rate = results.length ? ((100 * pass.length) / results.length).toFixed(0) : '0'
  console.log(`\n${pass.length}/${results.length} passed (${rate}%)${legacy.length ? `, ${legacy.length} legacy skipped` : ''}`)
  if (pass.length !== results.length) process.exitCode = 1
}

main().catch((err) => {
  console.error(err?.stack ?? err)
  process.exit(1)
})

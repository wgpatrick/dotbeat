// W1.5 — the verify fleet's roster is enforced, not aspirational.
//
// R6-8's root cause was not that ten verify scripts had died; it was that NOTHING would ever
// notice. The fleet had no index, no runner, and no document sanctioning retirement, so it grew to
// ~27k LOC (1.3x the GUI it tests) carrying dead members. ui/verify-manifest.mjs is the roster and
// this is the check that keeps it true: every verify script on disk is registered exactly once,
// and every registered script exists. A new script that forgets to register itself fails here —
// which is the only reason a manifest stays accurate.
//
// Deliberately cheap: it never RUNS a verify script (they need a browser, a daemon and a built
// bundle — that is `npm run verify`'s job). It only asserts the bookkeeping.

import assert from 'node:assert/strict'
import { readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const manifestPath = join(repoRoot, 'ui', 'verify-manifest.mjs')

interface VerifyEntry {
  script: string
  area: string
  tier: string
  status: string
  note?: string
}

async function loadManifest(): Promise<{ VERIFY_SCRIPTS: VerifyEntry[]; TIERS: string[] }> {
  return (await import(pathToFileURL(manifestPath).href)) as never
}

/** Every verify script in the tree. The fleet lives in two places: ui/ (Playwright) and scripts/
 * (CLI-level). `verify-lib.mjs`, `verify-manifest.mjs` and `verify-run.mjs` are the harness, not
 * members of the fleet. */
const HARNESS = new Set(['verify-lib.mjs', 'verify-manifest.mjs', 'verify-run.mjs'])

function scriptsOnDisk(): string[] {
  const isVerify = (f: string) => /^verify-.+\.mjs$/.test(f) && !HARNESS.has(f)
  return [
    ...readdirSync(join(repoRoot, 'ui')).filter(isVerify).map((f) => `ui/${f}`),
    ...readdirSync(join(repoRoot, 'scripts')).filter(isVerify).map((f) => `scripts/${f}`),
  ].sort()
}

test('every verify script on disk is registered in ui/verify-manifest.mjs exactly once', async () => {
  const { VERIFY_SCRIPTS } = await loadManifest()
  const listed = VERIFY_SCRIPTS.map((e) => e.script)
  const onDisk = scriptsOnDisk()

  const dupes = listed.filter((s, i) => listed.indexOf(s) !== i)
  assert.deepEqual(dupes, [], 'a script is listed twice in the manifest')

  const unregistered = onDisk.filter((s) => !listed.includes(s)).sort()
  assert.deepEqual(
    unregistered,
    [],
    'these verify scripts exist but are not in ui/verify-manifest.mjs — add a row {area, tier, status} ' +
      'so `npm run verify` knows about them (an unregistered script is one nobody will ever run again)',
  )

  const missing = listed.filter((s) => !existsSync(join(repoRoot, s))).sort()
  assert.deepEqual(missing, [], 'the manifest lists scripts that no longer exist — retire the rows with the scripts')
})

test('every manifest row is well-formed and legacy rows say why', async () => {
  const { VERIFY_SCRIPTS, TIERS } = await loadManifest()
  assert.ok(VERIFY_SCRIPTS.length > 50, 'the manifest looks truncated')
  for (const e of VERIFY_SCRIPTS) {
    assert.ok(TIERS.includes(e.tier), `${e.script}: unknown tier "${e.tier}" (known: ${TIERS.join(', ')})`)
    assert.ok(['live', 'legacy'].includes(e.status), `${e.script}: unknown status "${e.status}"`)
    assert.ok(e.area && e.area.length > 1, `${e.script}: needs an area tag`)
    if (e.status === 'legacy') {
      // A legacy script is a skip, and an unexplained skip is how the fleet accumulated ten dead
      // members. The reason is the whole point of the status.
      assert.ok(
        e.note && e.note.length > 40,
        `${e.script}: status "legacy" needs a note explaining what is broken and why it is kept`,
      )
    }
  }
})

test('the engine tier is a real, non-empty gate for engine work', async () => {
  const { VERIFY_SCRIPTS } = await loadManifest()
  const engine = VERIFY_SCRIPTS.filter((e) => e.tier === 'engine' && e.status === 'live')
  // R6-2: engine.ts cannot be imported by node --test, so these scripts are the ONLY regression
  // gate a decomposition of it has. `npm run verify:engine` running zero scripts would be the same
  // vacuous-gate failure as the clip-automation goldens silently skipping.
  assert.ok(engine.length >= 10, `verify:engine would run only ${engine.length} scripts — the engine gate has holes`)
})

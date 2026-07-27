// pilot-driver.mjs — usability pilot driver. Boots the GUI once, then executes numbered
// command files dropped into /tmp/pilot-drv/cmds so the pilot can interact step by step
// with live browser state preserved between batches.
import { bootGui, sleep } from './verify-lib.mjs'
import { mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = '/tmp/pilot-drv'
const CMDS = join(ROOT, 'cmds')
const OUT = join(ROOT, 'out')
const SHOTS = join(ROOT, 'shots')
for (const d of [ROOT, CMDS, OUT, SHOTS]) mkdirSync(d, { recursive: true })

const file = process.env.PILOT_FILE || '/tmp/pilot-twin-souls/study.beat'

const gui = await bootGui({
  file,
  daemonPort: 8677,
  previewPort: 5411,
  viewport: { width: 1600, height: 1000 },
})
console.log('BOOTED', gui.daemonPort, gui.previewPort)
writeFileSync(join(ROOT, 'ready'), 'ok')

const { page, errors } = gui
const shot = async (name) => {
  const p = join(SHOTS, `${name}.png`)
  await page.screenshot({ path: p })
  return p
}
const ctx = { page, errors, shot, sleep, gui }

const done = new Set()
try {
  for (;;) {
    if (existsSync(join(ROOT, 'quit'))) break
    const files = readdirSync(CMDS)
      .filter((f) => f.endsWith('.mjs') && !done.has(f))
      .sort()
    for (const f of files) {
      done.add(f)
      const before = errors.length
      let result, error
      try {
        const mod = await import(pathToFileURL(join(CMDS, f)).href + `?t=${Date.now()}`)
        result = await mod.default(ctx)
      } catch (e) {
        error = String(e?.stack ?? e)
      }
      const payload = {
        cmd: f,
        result: result === undefined ? null : result,
        error: error ?? null,
        newPageErrors: errors.slice(before),
        allPageErrors: errors,
      }
      writeFileSync(join(OUT, f.replace(/\.mjs$/, '.json')), JSON.stringify(payload, null, 2))
      console.log(`ran ${f}${error ? ' ERROR' : ''}`)
    }
    await sleep(300)
  }
} finally {
  await gui.close()
}
console.log('DRIVER EXIT')

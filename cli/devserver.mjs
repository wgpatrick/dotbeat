// Shared helper: spawn (and reliably kill) a BeatLab vite dev server. Used by cli/render.mjs
// and scripts/verify-m1.mjs. The spawn/URL-parse pattern is BeatLab's own scripts/smoke.mjs.

import { spawn } from 'node:child_process'

export async function spawnBeatlabDevServer(beatlabDir, port) {
  // `npx` execs through an intermediate `sh -c` before reaching the real vite process (confirmed
  // by inspecting the process tree) — plain vite.kill() only signals the `npx` wrapper and
  // leaves the actual dev server orphaned and running. detached:true puts the whole tree in its
  // own process group so killVite() below can take it out with one negative-PID kill.
  const vite = spawn('npx', ['vite', '--port', String(port)], { cwd: beatlabDir, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite did not announce a URL within 30s')), 30000)
    let buf = ''
    const onData = (chunk) => {
      buf += chunk.toString()
      const clean = buf.replace(/\x1B\[[0-9;]*m/g, '') // vite ANSI-bolds the port mid-string
      const m = clean.match(/Local:\s+(http:\/\/localhost:\d+\/musiclearning\/)/)
      if (m) {
        clearTimeout(timer)
        resolve(m[1])
      }
    }
    vite.stdout.on('data', onData)
    vite.stderr.on('data', onData)
    vite.on('exit', (code) => reject(new Error(`vite exited early (code ${code}): ${buf.slice(-300)}`)))
  })
  return { vite, url }
}

export function killVite(vite) {
  try {
    process.kill(-vite.pid, 'SIGTERM') // negative PID = whole process group, see detached:true above
  } catch {
    vite.kill() // group already gone, or platform doesn't support negative-PID kill — best effort
  }
}

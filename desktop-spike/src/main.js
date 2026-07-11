// dotbeat D1 spike: does Web Audio actually run inside macOS WKWebView (Tauri's native webview)?
// See docs/research/13-tauri-shell.md for the risk this de-risks and docs/phase-9-tauri-spike-plan.md
// for the verdict. Nothing here can be "listened to" by an agent, so every step writes a
// timestamped line to a plain log file on disk via a Tauri command (log_spike_result in
// src-tauri/src/lib.rs) — that log file plus a screenshot of this page IS the evidence.

const { invoke } = window.__TAURI__.core;

const LOG_PATH =
  '/Users/willpatrick/Documents/dotbeat/dotbeat/.claude/worktrees/agent-a74b7ceadf58d5bd8/desktop-spike/spike-log.txt'

const statusEl = document.getElementById('status')
const logEl = document.getElementById('log')

function setStatus(cls, text) {
  statusEl.className = cls
  statusEl.textContent = text
}

async function writeLog(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`
  logEl.textContent += stamped + '\n'
  try {
    await invoke('log_spike_result', { path: LOG_PATH, line: stamped })
  } catch (e) {
    // if even the logging call fails, at least surface it on-screen
    logEl.textContent += `[invoke failed] ${e}\n`
  }
}

async function tryResume(ctx) {
  await ctx.resume()
  return ctx.state
}

async function main() {
  await writeLog(`spike starting, userAgent=${navigator.userAgent}`)

  let ctx
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)()
    await writeLog(`AudioContext created, initial state=${ctx.state}`)
  } catch (e) {
    await writeLog(`FAIL: AudioContext construction threw: ${e}`)
    setStatus('fail', 'FAIL: could not construct AudioContext')
    return
  }

  try {
    const state = await tryResume(ctx)
    await writeLog(`after resume(), state=${state}`)

    if (state !== 'running') {
      // Workaround attempt: dispatch a synthetic click/gesture on the document and retry resume
      // from inside that event handler. Not a real trusted user gesture, but a legitimate thing
      // to try per the spike plan before declaring failure.
      await writeLog('state not running after direct resume() — trying synthetic-gesture workaround')
      await new Promise((resolve) => {
        document.addEventListener(
          'click',
          async () => {
            try {
              const s2 = await tryResume(ctx)
              await writeLog(`after synthetic-gesture resume(), state=${s2}`)
            } catch (e) {
              await writeLog(`synthetic-gesture resume() threw: ${e}`)
            }
            resolve()
          },
          { once: true },
        )
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })
    }

    if (ctx.state !== 'running') {
      await writeLog(`FAIL: AudioContext never reached 'running' (final state=${ctx.state})`)
      setStatus('fail', `FAIL: AudioContext stuck at '${ctx.state}'`)
      return
    }
  } catch (e) {
    await writeLog(`FAIL: resume() threw: ${e}`)
    setStatus('fail', 'FAIL: resume() threw')
    return
  }

  // Schedule a short, audible tone and wait for it to actually finish playing.
  try {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 440
    gain.gain.value = 0.2
    osc.connect(gain).connect(ctx.destination)

    const durationSec = 0.3
    const startAt = ctx.currentTime + 0.05
    const stopAt = startAt + durationSec

    const toneFinished = new Promise((resolve, reject) => {
      osc.onended = () => resolve('onended')
      // belt-and-suspenders timeout in case onended never fires in this webview
      setTimeout(() => resolve('timeout-fallback'), (durationSec + 1) * 1000)
      osc.addEventListener('error', (e) => reject(e))
    })

    osc.start(startAt)
    osc.stop(stopAt)
    await writeLog(
      `oscillator scheduled: start=${startAt.toFixed(3)} stop=${stopAt.toFixed(3)} currentTime=${ctx.currentTime.toFixed(3)}`,
    )

    const how = await toneFinished
    await writeLog(`tone completed via ${how}, ctx.state=${ctx.state}, ctx.currentTime=${ctx.currentTime.toFixed(3)}`)

    setStatus('pass', 'PASS: AudioContext running, tone scheduled and completed')
    await writeLog('PASS: spike succeeded end to end')
  } catch (e) {
    await writeLog(`FAIL: oscillator scheduling/playback threw: ${e}`)
    setStatus('fail', 'FAIL: oscillator threw')
  }
}

main().catch(async (e) => {
  await writeLog(`FAIL: uncaught error in main(): ${e}`)
  setStatus('fail', 'FAIL: uncaught error')
})

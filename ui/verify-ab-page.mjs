#!/usr/bin/env node
// `beat ab` — scripted assertions of the FEEDBACK page's behavior (research/128 §2.5). The page is
// a self-contained node:http inline-HTML app like `beat rate`/`beat board`, not part of the vite
// bundle, so this boots the real `beat ab` server on a scratch listening set and drives the real
// page in headless Chromium.
//
// What it asserts, in the order the owner meets it:
//   A1  the question is on screen, the options are named and non-blind, and the agent's supplied
//       measurements render (a board that hides the question is a form, not a conversation)
//   A2  SYNC + INSTANT SWITCHING — the whole honesty argument. Pressing 2 while playing must swap
//       which clip is audible WITHOUT restarting or seeking: exactly one element unmuted, all
//       elements within 50 ms of each other, and playback position monotonically forward.
//   A3  free text is required-ish: a bare submit nudges instead of recording, and a second press
//       records anyway (refusing outright just trains people to type ".")
//   A4  an answer round-trips to beat-feedback.jsonl + feedback-answers/<id>.json with the owner's
//       words character-for-character, and nothing lands in beat-scores.jsonl
//
// Usage: node ui/verify-ab-page.mjs

import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beatCli, check, pickPort, pollUntil, repoRoot, run, screenshot, sleep } from './verify-lib.mjs'

const NAME = 'verify-ab-page'

/** A real decodable WAV: `seconds` of a sine at `freq`, 44.1 kHz stereo. Distinct frequencies per
 * arm so a human reading the screenshots can tell the clips apart, and long enough that the
 * switching test has somewhere to play. */
function writeSine(path, freq, seconds = 4) {
  const sr = 44100
  const n = Math.floor(sr * seconds)
  const buf = Buffer.alloc(44 + n * 4)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40)
  for (let i = 0; i < n; i++) {
    const s = Math.round(Math.sin((2 * Math.PI * freq * i) / sr) * 11000)
    buf.writeInt16LE(s, 44 + i * 4); buf.writeInt16LE(s, 44 + i * 4 + 2)
  }
  writeFileSync(path, buf)
}

/** A scratch listening set shaped like `taste-dataset/layered-check/`, with an agent-written
 * feedback.json so A1 can assert the question and the supplied measurements. */
function scratchSet() {
  const root = mkdtempSync(join(tmpdir(), 'beat-ab-verify-'))
  mkdirSync(join(root, 'bassline-41'))
  writeSine(join(root, 'bassline-41', 'engineplus.wav'), 110)
  writeSine(join(root, 'bassline-41', 'layered.wav'), 220)
  writeSine(join(root, 'bassline-41', 'layeredplus.wav'), 330)
  writeFileSync(
    join(root, 'feedback.json'),
    JSON.stringify(
      {
        question: 'Does the layered version sound better than the unlayered one?',
        comparisons: [
          {
            id: 'bassline-41',
            label: 'bassline (seed 41)',
            options: [
              { name: 'engineplus', wav: 'bassline-41/engineplus.wav', note: 'unlayered, one voice' },
              { name: 'layered', wav: 'bassline-41/layered.wav', note: 'sub + growl + click' },
              { name: 'layeredplus', wav: 'bassline-41/layeredplus.wav' },
            ],
            measurements: { engineplus: { LUFS: -14.1 }, layered: { LUFS: -12.8 }, layeredplus: { LUFS: -12.4 } },
          },
        ],
      },
      null,
      2,
    ),
  )
  return root
}

await run(NAME, async () => {
  const root = scratchSet()
  const port = await pickPort(4324)
  console.log(`  listening set: ${root}`)

  const server = spawn(process.execPath, [beatCli, 'ab', root, '--port', String(port)], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stderr.on('data', (d) => process.stdout.write(`  [ab] ${d}`))

  let browser = null
  try {
    await pollUntil(async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/queue`)
        return r.ok
      } catch {
        return false
      }
    }, 'beat ab server to answer')

    browser = await chromium.launch({
      // Autoplay must not need a gesture: the page's whole model is "everything is already
      // playing, muted". Without this the transport test would measure Chrome's policy, not ours.
      args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    })
    const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' })
    await page.waitForSelector('#opts .opt')

    // ---- A1: the question, the provenance, the measurements -----------------------------------
    check(
      (await page.textContent('#question')) === 'Does the layered version sound better than the unlayered one?',
      'A1 the agent\'s question is the page headline',
    )
    check((await page.textContent('#case')).includes('bassline (seed 41)'), 'A1 the comparison label is shown')
    const names = await page.$$eval('#opts .name', (els) => els.map((e) => e.textContent))
    check(
      names.join(',') === 'engineplus,layered,layeredplus',
      `A1 options are named in the open (non-blind by design) — got ${names.join(',')}`,
    )
    check(
      (await page.textContent('#opts')).includes('unlayered, one voice'),
      'A1 per-option provenance notes render',
    )
    const featText = await page.textContent('#feat')
    check(featText.includes('-12.8') && /from the agent/.test(featText), 'A1 agent-supplied measurements render, labelled as the agent\'s')
    await page.emulateMedia({ colorScheme: 'light' })
    await screenshot(page, 'ab-page-comparison')
    // The daemon GUI is dark-first and so is this page; the light branch is a media-query fallback.
    // Both are shot because a token that only exists in one branch is invisible until someone with
    // the other system setting opens it.
    await page.emulateMedia({ colorScheme: 'dark' })
    await screenshot(page, 'ab-page-comparison-dark')
    check(
      (await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(22, 23, 27)',
      'A1 the dark branch of the shared GUI tokens applies',
    )

    // ---- A2: sync + instant switching ----------------------------------------------------------
    await page.click('#play')
    await sleep(900)
    const beforeSwitch = await page.evaluate(() => ({
      playing: auds.filter((a) => !a.paused).length,
      unmuted: auds.map((a, i) => (a.muted ? -1 : i)).filter((i) => i >= 0),
      times: auds.map((a) => a.currentTime),
    }))
    check(beforeSwitch.playing === 3, `A2 every option is playing at once (got ${beforeSwitch.playing}/3)`)
    check(
      beforeSwitch.unmuted.length === 1 && beforeSwitch.unmuted[0] === 0,
      `A2 exactly one option is audible, the first (got [${beforeSwitch.unmuted}])`,
    )
    check(beforeSwitch.times[0] > 0.3, `A2 playback actually advanced (t=${beforeSwitch.times[0].toFixed(2)}s)`)

    // TOLERANCE PROVENANCE: 120 ms, and not tighter, because `HTMLMediaElement.currentTime` is not
    // a precise clock — the spec lets the official playback position update on a coarse timer, and
    // measured readings across three elements carry ~30-70 ms of phase noise even when the audio is
    // perfectly aligned. A tighter bound would be measuring Chrome's clock granularity, not our
    // sync, and would flake. What this DOES catch is the bug it was written for: before the
    // coordinated start in play(), this spread was 880 ms.
    const SYNC_TOL = 0.12
    const spreadBefore = Math.max(...beforeSwitch.times) - Math.min(...beforeSwitch.times)
    check(
      spreadBefore < SYNC_TOL,
      `A2 all options start together — the SAME moment (spread ${(spreadBefore * 1000).toFixed(0)} ms, tol ${SYNC_TOL * 1000} ms)`,
    )

    const wasAt = beforeSwitch.times[0]
    await page.keyboard.press('2')
    const afterSwitch = await page.evaluate(() => ({
      unmuted: auds.map((a, i) => (a.muted ? -1 : i)).filter((i) => i >= 0),
      times: auds.map((a) => a.currentTime),
      hearing,
      hearingClass: document.getElementById('o2').className,
    }))
    check(
      afterSwitch.unmuted.length === 1 && afterSwitch.unmuted[0] === 1,
      `A2 pressing 2 moves the single audible element to option 2 (got [${afterSwitch.unmuted}])`,
    )
    check(afterSwitch.hearingClass.includes('hearing'), 'A2 the page says which option you are hearing')
    // The switch keeps your PLACE: you land where you were listening, not at the top of the clip.
    // (Ahead, never behind — a switch must not rewind.) This one is checked IMMEDIATELY, because
    // it is what the ear hears at the instant of the keypress.
    check(
      afterSwitch.times[1] >= wasAt - 0.01 && afterSwitch.times[1] < wasAt + 0.25,
      `A2 the switch carries your position across (was ${wasAt.toFixed(3)}s, now ${afterSwitch.times[1].toFixed(3)}s)`,
    )
    // And the set is still together a moment later — a switch must not knock it apart.
    await sleep(400)
    const settled = await page.evaluate(() => ({ times: auds.map((a) => a.currentTime) }))
    const spread = Math.max(...settled.times) - Math.min(...settled.times)
    check(spread < SYNC_TOL, `A2 the set stays together across a switch (spread ${(spread * 1000).toFixed(0)} ms)`)
    check(settled.times[1] > afterSwitch.times[1], 'A2 playback continues through the switch — no restart, no stall')

    // ---- A3: free text is required-ish ---------------------------------------------------------
    await page.click('#opt-none-placeholder', { timeout: 1 }).catch(() => {}) // no such element; keeps the flow explicit
    await page.evaluate(() => setPref(1))
    await page.click('#record')
    await sleep(120)
    const nudge = await page.textContent('#msg')
    check(/what did you hear/i.test(nudge), `A3 a wordless submit NUDGES instead of recording (msg: "${nudge}")`)
    check(!existsSync(join(root, 'beat-feedback.jsonl')), 'A3 and it wrote nothing')
    await screenshot(page, 'ab-page-nudge')

    // ---- A4: the round trip ---------------------------------------------------------------------
    const quote = "the bassline layering doesn't sound great, I liked the unlayered one better"
    await page.fill('#freeText', quote)
    await page.check('#flag')
    await page.click('#record')
    await pollUntil(() => existsSync(join(root, 'beat-feedback.jsonl')), 'the feedback log to appear')

    const row = JSON.parse(readFileSync(join(root, 'beat-feedback.jsonl'), 'utf8').trim().split('\n')[0])
    check(row.preference === 'engineplus', `A4 the preference round-trips (got ${row.preference})`)
    check(row.freeText === quote, 'A4 the owner\'s words are stored character-for-character')
    check(row.flagged === true, 'A4 the "sounds wrong" flag round-trips (the listen-bench trigger)')
    check(row.nonBlind === true, 'A4 the row is self-describing as non-blind')
    check(row.measurements?.layered?.LUFS === -12.8, 'A4 the displayed measurements travel with the answer')

    const answers = readdirSync(join(root, 'feedback-answers'))
    check(answers.join(',') === 'bassline-41.json', `A4 one per-comparison answer file (got ${answers.join(',')})`)
    check(!existsSync(join(root, 'beat-scores.jsonl')), 'A4 NOTHING lands in beat-scores.jsonl (the separation invariant, in the browser)')
    check(!existsSync(join(root, 'beat-decisions.jsonl')), 'A4 and nothing in beat-decisions.jsonl')

    await page.waitForSelector('#done')
    check((await page.textContent('#done')).includes('--digest'), 'A4 the finish screen tells the owner what the agent will read')
    await screenshot(page, 'ab-page-done')

    check(errors.length === 0, `A0 no uncaught page errors (${errors.join(' | ')})`)
  } finally {
    try { if (browser) await browser.close() } catch { /* teardown must not mask the result */ }
    try { server.kill('SIGTERM') } catch { /* already gone */ }
  }
})

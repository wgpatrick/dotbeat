#!/usr/bin/env node
// ui/verify-surge-gui-playback.mjs — a surge track SOUNDS in the GUI, and an edit is heard.
//
// Phase 41 Stream B. docs/surge-track.md claimed "in the GUI a surge track plays its last rendered
// WAV"; nothing implemented it (`grep surge ui/src/audio/engine.ts` matches nothing), so the claim
// had to be verified by ear-equivalent evidence, not by a store assertion — see CLAUDE.md's
// standing note that the de-harsh EQ and fuseAttacks both shipped INERT and passed the full suite.
//
// So the assertions here are about recorded AUDIO from the live engine's master bus:
//   1. with the surge track's companion in the document, the master is not silent;
//   2. transposing the FIRST note up an octave — by clicking it and pressing Shift+ArrowUp, the
//      gesture a person would use — changes the pitch that comes out, measured by autocorrelation
//      on the first note's own window;
//   3. and the wall-clock from that keypress to hearing the new render is reported, because the
//      whole premise of render-on-edit is that it is fast enough to feel immediate.
//
// GATED on surgepy (a source build of Surge XT, no PyPI wheel): without it there is nothing to
// render and the daemon degrades to the silent piano roll this stream started from. Point
// BEAT_PYTHON at the venv that has it.

import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootGui, check, importDist, pollUntil, recordWav, run, screenshot, sleep } from './verify-lib.mjs'

const SOURCE_PROJECT = process.env.SURGE_PILOT_PROJECT ?? join(process.env.HOME, 'Documents/dotbeat/songs/twin-souls-study')
const SOURCE_FILE = process.env.SURGE_PILOT_FILE ?? 'study.beat'

/** Energy at one frequency (Goertzel) — the narrow question this pilot actually asks, instead of
 * "what pitch is this?". A full autocorrelation pitch estimate on a rich Surge patch reports the
 * sub-harmonic about half the time (measured: a 554 Hz note read as 184.5 Hz = 554/3), which is a
 * flaky test, not a finding. Comparing the SAME two frequencies before and after is stable. */
function energyAt(samples, sampleRate, hz) {
  const k = (2 * Math.PI * hz) / sampleRate
  const coeff = 2 * Math.cos(k)
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < samples.length; i++) {
    const s0 = samples[i] + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / samples.length
}

/** Equal temperament, A4 = 440 (MIDI 69) — the same mapping the engine uses. */
const midiHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12)

function rms(samples) {
  let s = 0
  for (const v of samples) s += v * v
  return Math.sqrt(s / samples.length)
}

await run('surge-gui-playback', async () => {
  const { surgeDoctor, surgeAvailable } = await importDist('src/analysis/surge.js')
  if (!surgeAvailable(await surgeDoctor())) {
    console.log('SKIP: surgepy is not available (it is a source build of Surge XT, no wheel).')
    console.log('      Point BEAT_PYTHON at a venv that has it to run this pilot.')
    return
  }
  if (!existsSync(join(SOURCE_PROJECT, SOURCE_FILE))) {
    console.log(`SKIP: no project at ${join(SOURCE_PROJECT, SOURCE_FILE)} (set SURGE_PILOT_PROJECT).`)
    return
  }

  // Work on a COPY. This is a real project of the owner's and the pilot edits a note in it.
  const dir = mkdtempSync(join(tmpdir(), 'surge-gui-pilot-'))
  cpSync(SOURCE_PROJECT, dir, { recursive: true })
  const file = join(dir, SOURCE_FILE)
  console.log(`pilot project: ${file}`)

  const gui = await bootGui({ file, readyTimeoutMs: 30000 })
  const { page } = gui
  try {
    // The daemon renders the surge track on boot; a 24-bar phrase takes a moment, and the GUI
    // learns about it through the `doc` SSE event, so wait for the companion to reach the store.
    const t0 = Date.now()
    const companionId = await pollUntil(
      () => page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.kind === 'drums' && t.id.endsWith('__surge'))?.id ?? null),
      'the surge playback companion to reach the GUI',
      60000,
    )
    console.log(`companion "${companionId}" arrived ${Date.now() - t0} ms after the app was ready`)

    const shape = await page.evaluate(() => {
      const doc = window.__store.getState().doc
      return {
        tracks: doc.tracks.map((t) => `${t.id}:${t.kind}`),
        surgeNotes: doc.tracks.find((t) => t.kind === 'surge')?.notes.length ?? 0,
        sample: doc.tracks.find((t) => t.id.endsWith('__surge'))?.lanes?.[0]?.backing?.sample ?? null,
      }
    })
    console.log(`  tracks: ${shape.tracks.join(', ')}`)
    check(shape.surgeNotes > 0, `the surge track still carries its notes (${shape.surgeNotes}) — the piano roll is the point`)
    check(shape.sample?.startsWith('surge_'), `the companion plays a surge render (${shape.sample})`)

    // Solo the surge companion so the measurement is about IT and not the 30 reference clips this
    // project also carries. (Solo is session state in the store, like a person clicking S.)
    await page.evaluate((id) => window.__store.getState().toggleSolo(id), companionId)
    // The render is a multi-megabyte WAV the browser fetches over /media; recording before it has
    // decoded measures silence and says nothing about whether the track can be heard. (Found the
    // hard way: the first run of this pilot reported rms 0.0000 for a track that plays fine.)
    // The render is a multi-megabyte WAV the browser fetches over /media and DECODES, and the
    // decode is kicked by play()/sync — not by the document arriving. Recording without warming it
    // first measures the cold-start gap, not whether the track can be heard. (Found the hard way:
    // this pilot's first run reported rms 0.0000 for a track that plays fine a second later. That
    // gap is real and worth knowing about — it is just not what these assertions are about.)
    await page.evaluate(() => window.__engine.warmMediaLoads())
    await pollUntil(() => page.evaluate(() => window.__engine.pendingMediaCount() === 0), 'the engine to decode the surge render', 60000)
    await screenshot(page, 'surge-gui-1-loaded')

    const before = await recordWav(page, 2.2)
    const sr = before.sampleRate
    const noteWindow = (rec) => rec.channels[0].slice(Math.floor(sr * 0.05), Math.floor(sr * 0.6))
    const beforeRms = rms(before.channels[0])
    check(beforeRms > 0.001, `the master bus is NOT silent with a surge track playing (rms ${beforeRms.toFixed(4)})`)

    // ---- the edit: click the first note, transpose it an octave, time the round trip ----
    const firstNote = await page.evaluate(() => {
      const doc = window.__store.getState().doc
      const t = doc.tracks.find((x) => x.kind === 'surge')
      const n = [...t.notes].sort((a, b) => a.start - b.start)[0]
      return { track: t.id, id: n.id, pitch: n.pitch }
    })
    await page.evaluate((id) => window.__store.getState().setSelectedTrack(id), firstNote.track)
    await page.waitForSelector(`[data-note-id="${firstNote.id}"]`, { timeout: 10000 })
    await page.click(`[data-note-id="${firstNote.id}"]`)
    await screenshot(page, 'surge-gui-2-note-selected')

    const beforeSample = shape.sample
    const tEdit = Date.now()
    await page.keyboard.press('Shift+ArrowUp') // transpose the selected note up one octave
    const afterSample = await pollUntil(
      () =>
        page.evaluate(
          (prev) => {
            const s = window.__store.getState().doc.tracks.find((t) => t.id.endsWith('__surge'))?.lanes?.[0]?.backing?.sample ?? null
            return s && s !== prev ? s : null
          },
          beforeSample,
        ),
      'the re-rendered surge audio to reach the GUI',
      60000,
    )
    const tDocMs = Date.now() - tEdit
    await page.evaluate(() => window.__engine.warmMediaLoads())
    await pollUntil(() => page.evaluate(() => window.__engine.pendingMediaCount() === 0), 'the engine to decode the new render', 60000)
    const tAudibleMs = Date.now() - tEdit
    console.log(`\n  EDIT -> HEAR: ${tAudibleMs} ms  (new render in the document at ${tDocMs} ms, engine buffer loaded at ${tAudibleMs} ms)`)
    console.log(`  ${beforeSample} -> ${afterSample}`)

    await screenshot(page, 'surge-gui-3-after-edit')

    const after = await recordWav(page, 2.2)
    // The note was at `pitch`; it is now an octave up. Its old fundamental should lose to its new
    // one over the window that note occupies.
    const oldHz = midiHz(firstNote.pitch)
    const newHz = midiHz(firstNote.pitch + 12)
    const balance = (rec) => energyAt(noteWindow(rec), sr, newHz) / energyAt(noteWindow(rec), sr, oldHz)
    const beforeBalance = balance(before)
    const afterBalance = balance(after)
    console.log(`  first note ${oldHz.toFixed(1)} Hz -> ${newHz.toFixed(1)} Hz`)
    console.log(`  energy(new)/energy(old) over that note: ${beforeBalance.toFixed(2)} before, ${afterBalance.toFixed(2)} after`)
    console.log(`  rms: ${beforeRms.toFixed(4)} before, ${rms(after.channels[0]).toFixed(4)} after`)
    check(rms(after.channels[0]) > 0.001, 'the master bus is still not silent after the edit')
    check(
      afterBalance > beforeBalance * 3,
      `the audio that comes out moved to the pitch the owner dragged the note to: energy at ${newHz.toFixed(0)} Hz relative to ${oldHz.toFixed(0)} Hz went x${(afterBalance / beforeBalance).toFixed(1)}`,
    )

    // And the edit is in the FILE, once, on the surge track — not on the companion.
    const text = readFileSync(file, 'utf8')
    check(!text.includes('__surge'), 'the companion was never written to the .beat file')
    check(new RegExp(`note ${firstNote.id} ${firstNote.pitch + 12} `).test(text), `the .beat file records the transposed note (${firstNote.pitch} -> ${firstNote.pitch + 12})`)

    check(gui.errors.length === 0, `no page errors (${gui.errors.join(' | ') || 'none'})`)
  } finally {
    await sleep(100)
    await gui.close()
  }
})

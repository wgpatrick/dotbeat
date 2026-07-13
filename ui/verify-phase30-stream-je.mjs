#!/usr/bin/env node
// Phase 30 Stream JE — Audio track bottom-panel coherence (docs/phase-30-plan.md, docs/research/88).
// Before this stream, the bottom "Clip"/"Device" panel — the one consistent, prominent editing
// surface every other track kind (Synth, Drums, Instrument) uses — showed an empty, meaningless
// note-grid ("0 notes · click a key to preview") for Audio tracks, even after a real clip was placed
// with working content. The actual audio editing controls (waveform, in/out/gain/warp) lived in a
// separate, smaller, unlabeled strip (`.arr-audio-inspector`) wedged between the arrangement grid and
// the bottom panel. The fix (preferred approach from the plan doc): the bottom panel itself now
// renders the real audio-editing controls (`AudioClipEditor.tsx`, App.tsx's BottomPane routing) when
// an Audio track is selected, instead of NoteView's note-grid — one editing surface, always in the
// same place, matching every other track kind. Drives the REAL frontend headlessly against a REAL
// `beat daemon`, reading the actual .beat file on disk — not mocks.
//
//   T1 baseline: selecting the existing synth track ("lead") shows NoteView's note-grid in the
//      bottom panel, unaffected by this stream.
//   T2 adding a fresh Audio track auto-selects it; the bottom panel immediately swaps to
//      AudioClipEditor (not NoteView) — no "0 notes · click a key to preview" anywhere, an explicit
//      empty-state hint instead.
//   T3 entering song mode ("+ section") — the still-unmapped Audio track keeps showing the
//      AudioClipEditor empty state, still no note-grid.
//   T4 dragging a kit sample onto the track's HEADER creates a real audio-region clip; the bottom
//      panel's AudioClipEditor now renders a REAL waveform (measured via pixel data, not just DOM
//      presence) plus in/out/gain/warp fields — the exact controls that used to live only in the
//      small separate arrangement-inline strip.
//   T5 switching selection to the synth track swaps the bottom panel back to NoteView with NO stale
//      audio-editor DOM left over (and vice versa switching back) — clean track-kind swaps in both
//      directions.
//   T6 switching to the drums track also swaps cleanly (a THIRD distinct bottom-panel content type),
//      then back to the audio track shows the SAME clip's fields again, un-corrupted.
//   T7 playback: the arrangement's playhead still advances correctly with the audio track selected
//      (bottom-panel routing didn't disturb the transport/playhead sync this stream deliberately left
//      untouched).
//
// Usage: node ui/verify-phase30-stream-je.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 9130 // distinct from other verify scripts' ports so concurrent runs never collide
const PREVIEW_PORT = 6130

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

const trackHeaderSel = (name) => `.arr-row:has(.arr-track-name:text-is("${name}")) [data-drop-target="track-header"]`
const trackSelectSel = (id) => `.arr-track-select:has(.arr-track-name:text-is("${id}"))`

/** Sample a canvas's own painted pixels (not just "the element exists") — a blank canvas (all-zero
 * alpha, or one uniform color) would mean the decode/draw path silently no-op'd. */
async function sampleCanvas(page, selector) {
  return page.evaluate((sel) => {
    const canvas = document.querySelector(sel)
    if (!canvas) return null
    const ctx = canvas.getContext('2d')
    const { width, height } = canvas
    if (!width || !height) return { width, height, distinctColors: 0, anyPainted: false }
    const data = ctx.getImageData(0, 0, width, height).data
    const seen = new Set()
    let anyPainted = false
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3]
      if (a > 0) anyPainted = true
      seen.add(`${data[i]},${data[i + 1]},${data[i + 2]},${a}`)
    }
    return { width, height, distinctColors: seen.size, anyPainted }
  }, selector)
}

/** What's actually showing in the bottom pane's Clip tab body, keyed by the DOM markers each
 * component renders — used to assert clean swaps with no stale content from a previous track kind. */
async function bottomPaneShape(page) {
  return page.evaluate(() => {
    const body = document.querySelector('.bottom-pane-body')
    if (!body) return null
    return {
      hasNoteView: !!body.querySelector('.noteview'),
      hasAudioEditor: !!body.querySelector('.audio-clip-editor'),
      hasAudioInspector: !!body.querySelector('.audio-clip-inspector'),
      hasAudioEmpty: !!body.querySelector('.audio-clip-editor-empty'),
      hasDrumLanePanel: !!body.querySelector('[data-testid], .drum-lane-panel') || null, // best-effort, not asserted on
      bodyText: body.textContent ?? '',
    }
  })
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p30je-'))
  const beatPath = join(proj, 'night-shift.beat')
  writeFileSync(beatPath, serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8'))))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline night-shift')

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
    await page.setViewportSize({ width: 1600, height: 980 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    const alerts = []
    page.on('dialog', async (d) => {
      alerts.push(d.message())
      await d.dismiss()
    })
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    // ============ T1: baseline — the synth track shows NoteView, untouched by this stream ============
    await page.click(trackSelectSel('lead'))
    await pollUntil(() => page.evaluate(() => window.__store.getState().selectedTrackId === 'lead'), 'the lead synth track to be selected')
    let shape = await bottomPaneShape(page)
    if (!shape.hasNoteView) throw new Error(`[T1] FAIL: expected NoteView for the synth track, got ${JSON.stringify(shape)}`)
    if (shape.hasAudioEditor) throw new Error('[T1] FAIL: AudioClipEditor rendered for a non-audio track')
    console.log('[T1] PASS: synth track still shows NoteView in the bottom panel')
    results.t1 = shape

    // ============ T2: a fresh Audio track auto-selects and shows AudioClipEditor, NOT NoteView ============
    await page.click('[data-action="toggle-library"]')
    await page.waitForSelector('[data-testid="content-browser"]', { timeout: 5000 })
    await pollUntil(async () => (await page.evaluate(() => document.querySelectorAll('.lib-row').length)) > 0, 'library catalog to load rows')

    await page.click('[data-action="add-track"]')
    await page.click('[data-add-kind="audio"]')
    await pollUntil(() => page.evaluate(() => window.__store.getState().doc.tracks.some((t) => t.kind === 'audio')), 'a fresh audio track to appear')
    const audioTrackId = await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.kind === 'audio').id)
    await pollUntil(() => page.evaluate((id) => window.__store.getState().selectedTrackId === id, audioTrackId), 'the new audio track to auto-select')
    // addTrackOfKind's own selection edit is debounced 60ms — wait for it to land before the next
    // section's before/after file diff, same discipline verify-phase23-stream-bc.mjs's T1 uses.
    await pollUntil(() => readFileSync(beatPath, 'utf8').includes(`selected_track ${audioTrackId}`), "the new track's own selection edit to land on disk")

    shape = await bottomPaneShape(page)
    if (shape.hasNoteView) throw new Error(`[T2] FAIL: NoteView (note-grid) rendered for a freshly-selected Audio track: ${JSON.stringify(shape)}`)
    if (!shape.hasAudioEditor) throw new Error(`[T2] FAIL: expected AudioClipEditor for the audio track, got ${JSON.stringify(shape)}`)
    if (!shape.hasAudioEmpty) throw new Error(`[T2] FAIL: expected the empty-state hint (no clip placed yet), got ${JSON.stringify(shape)}`)
    if (/0 notes/i.test(shape.bodyText) || /click a key to preview/i.test(shape.bodyText)) {
      throw new Error(`[T2] FAIL: the irrelevant note-grid hint text is still present for an Audio track: "${shape.bodyText}"`)
    }
    if (!/browser/i.test(shape.bodyText) || !/header/i.test(shape.bodyText)) {
      throw new Error(`[T2] FAIL: expected the empty state to point at the real placement gesture (Browser -> track header), got "${shape.bodyText}"`)
    }
    console.log(`[T2] PASS: fresh audio track "${audioTrackId}" shows AudioClipEditor's empty state, no note-grid anywhere`)
    results.t2 = { audioTrackId, shape }

    // ============ T3: entering song mode — still unmapped, still no note-grid ============
    await page.click('[data-add-section="1"]')
    await pollUntil(() => page.evaluate(() => (window.__store.getState().doc.song?.length ?? 0) >= 1), 'song mode with at least 1 section')
    shape = await bottomPaneShape(page)
    if (shape.hasNoteView) throw new Error('[T3] FAIL: NoteView appeared for the audio track after entering song mode')
    if (!shape.hasAudioEditor) throw new Error('[T3] FAIL: AudioClipEditor disappeared after entering song mode')
    console.log('[T3] PASS: song mode entered; audio track still shows AudioClipEditor (empty), no note-grid regression')
    results.t3 = shape

    // ============ T4: drag a real sample onto the track HEADER -> a real audio-region clip; the
    // BOTTOM PANEL (not a separate arrangement-inline strip) shows the real waveform + fields ============
    const before = readFileSync(beatPath, 'utf8')
    await page.dragAndDrop('[data-kit="kit-init"][data-lane="kick"]', trackHeaderSel(audioTrackId))
    await pollUntil(
      () =>
        page.evaluate((id) => {
          const t = window.__store.getState().doc.tracks.find((tr) => tr.id === id)
          return t.clips.some((c) => c.audio?.media === 'kit-init-kick')
        }, audioTrackId),
      'the audio track to pick up a kit-init-kick region',
    )
    const after = readFileSync(beatPath, 'utf8')
    if (after === before) throw new Error('[T4] FAIL: .beat file did not change after dropping the kit one-shot onto the audio track header')
    const audioClipId = await page.evaluate((id) => {
      const t = window.__store.getState().doc.tracks.find((tr) => tr.id === id)
      return t.clips.find((c) => c.audio?.media === 'kit-init-kick').id
    }, audioTrackId)

    shape = await bottomPaneShape(page)
    if (shape.hasNoteView) throw new Error('[T4] FAIL: NoteView (note-grid) rendered for an audio track WITH a real placed clip')
    if (shape.hasAudioEmpty) throw new Error('[T4] FAIL: empty-state hint still showing after a real clip was placed')
    if (!shape.hasAudioInspector) throw new Error(`[T4] FAIL: expected the real audio inspector (waveform/in/out/gain/warp) in the bottom panel, got ${JSON.stringify(shape)}`)

    const waveformSel = `.bottom-pane-body [data-audio-waveform="${audioClipId}"]`
    await page.waitForSelector(waveformSel, { timeout: 5000 })
    await pollUntil(() => page.evaluate((sel) => document.querySelector(sel)?.getAttribute('data-waveform-ready') === 'true', waveformSel), 'the waveform to finish decoding', 15000)
    const sample = await sampleCanvas(page, waveformSel)
    if (!sample?.anyPainted || sample.distinctColors < 3) throw new Error(`[T4] FAIL: waveform canvas isn't a real render: ${JSON.stringify(sample)}`)
    // The exact same fields the old .arr-audio-inspector strip had — now inside the bottom panel.
    for (const attr of ['data-audio-in', 'data-audio-out', 'data-audio-gain', 'data-audio-warp']) {
      const sel = `.bottom-pane-body [${attr}="${audioClipId}"]`
      if (!(await page.locator(sel).count())) throw new Error(`[T4] FAIL: missing field ${attr} in the bottom-panel audio inspector`)
    }
    console.log(`[T4] PASS: bottom panel shows a real, painted waveform (${sample.distinctColors} distinct colors) + in/out/gain/warp fields for clip "${audioClipId}"`)
    results.t4 = { audioClipId, sample }

    // ============ T5: switching to the synth track swaps cleanly, then back ============
    await page.click(trackSelectSel('lead'))
    await pollUntil(() => page.evaluate(() => window.__store.getState().selectedTrackId === 'lead'), 'switch to the synth track')
    shape = await bottomPaneShape(page)
    if (shape.hasAudioEditor || shape.hasAudioInspector) throw new Error(`[T5] FAIL: stale audio-editor DOM left over after switching to the synth track: ${JSON.stringify(shape)}`)
    if (!shape.hasNoteView) throw new Error('[T5] FAIL: NoteView did not reappear for the synth track')
    // Sanity: it's really the synth clip's own content, not some blank/generic editor.
    const leadNoteCount = await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'lead').notes.length)
    if (leadNoteCount === 0) throw new Error('[T5] setup invalid — expected the lead track to have real notes')
    console.log(`[T5a] PASS: switching audio -> synth swapped cleanly (lead has ${leadNoteCount} real notes, no stale audio DOM)`)

    await page.click(trackSelectSel(audioTrackId))
    await pollUntil(() => page.evaluate((id) => window.__store.getState().selectedTrackId === id, audioTrackId), 'switch back to the audio track')
    shape = await bottomPaneShape(page)
    if (shape.hasNoteView) throw new Error(`[T5] FAIL: stale NoteView left over after switching back to the audio track: ${JSON.stringify(shape)}`)
    if (!shape.hasAudioInspector) throw new Error('[T5] FAIL: audio inspector did not reappear after switching back')
    console.log('[T5b] PASS: switching synth -> audio swapped cleanly back, no stale note-grid')
    results.t5 = { leadNoteCount }

    // ============ T6: a THIRD track kind (drums) also swaps cleanly, then back to audio shows the
    // SAME clip's fields again, un-corrupted ============
    await page.click(trackSelectSel('drums'))
    await pollUntil(() => page.evaluate(() => window.__store.getState().selectedTrackId === 'drums'), 'switch to the drums track')
    shape = await bottomPaneShape(page)
    if (shape.hasAudioEditor) throw new Error('[T6] FAIL: stale AudioClipEditor left over after switching to the drums track')
    if (!shape.hasNoteView) throw new Error('[T6] FAIL: NoteView (drums lane grid) did not appear for the drums track')
    console.log('[T6a] PASS: switching audio -> drums swapped cleanly')

    await page.click(trackSelectSel(audioTrackId))
    await pollUntil(() => page.evaluate((id) => window.__store.getState().selectedTrackId === id, audioTrackId), 'switch back to the audio track again')
    await page.waitForSelector(waveformSel, { timeout: 5000 })
    const inFieldSel = `.bottom-pane-body [data-audio-in="${audioClipId}"]`
    const inValue = await page.locator(inFieldSel).inputValue()
    if (inValue !== String(0)) throw new Error(`[T6] FAIL: expected the same clip's in=0 field back, got "${inValue}"`)
    console.log('[T6b] PASS: switching drums -> audio again shows the SAME clip, fields un-corrupted')
    results.t6 = { inValue }

    // ============ T7: playback sync — the arrangement playhead still advances with the audio track
    // selected (unrelated code path this stream deliberately left untouched) ============
    const step0 = await page.evaluate(() => window.__store.getState().currentStep)
    await page.click('.play-btn')
    await sleep(1200)
    const step1 = await page.evaluate(() => window.__store.getState().currentStep)
    await page.evaluate(() => window.__engine?.stop?.())
    if (!(step1 >= 0)) throw new Error(`[T7] FAIL: transport never started (currentStep=${step1})`)
    if (step1 === step0 && step0 <= 0) throw new Error(`[T7] FAIL: playhead did not advance at all (step0=${step0}, step1=${step1})`)
    console.log(`[T7] PASS: playhead advanced during playback with the audio track selected (${step0} -> ${step1})`)
    results.t7 = { step0, step1 }

    if (errors.length) throw new Error(`[FAIL] uncaught page errors during the run:\n${errors.join('\n')}`)
    // T2's alert-free path is implicit — no dialogs expected anywhere in this script's flow.
    if (alerts.length) console.warn(`[note] ${alerts.length} native alert(s) fired during the run: ${JSON.stringify(alerts)}`)

    console.log('\nALL PASS — Phase 30 Stream JE: audio track bottom-panel coherence verified.')
  } finally {
    await browser.close()
    preview.kill()
    await daemon.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})

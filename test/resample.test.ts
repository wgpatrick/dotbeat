// `beat resample` — the glue half (research 142 §3.1, build item 4).
//
// The render itself needs a browser and lives in cli/render.mjs (renderTrackSolosCommand, already
// shipped and already tested). What is new is everything AROUND it, and that is what this file
// guards: id minting, the provenance a bounce must record to be reproducible, and the fact that
// registration goes through the SAME enforced-sidecar primitive `beat source add` and `beat adopt`
// use — so a resample can never land in a media block without provenance.
//
// The corpus's reason for caring about the provenance in particular: a degradation chain is run
// BEFORE the bounce specifically so it "can't be un-done or re-balanced later." Once that is true,
// the only remaining record of what was committed is the sidecar. If it drifts, the bounce becomes
// an anonymous wav.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { addEffect, addNote, addTrack, initDocument, parse, serialize, setSong, setScene } from '../src/core/index.js'
import { encodeWav16 } from '../src/analysis/gen-trim.js'
import { mintResampleId, projectRenderSeconds, registerResample } from '../src/vary/resample.js'
import { BeatBatchError } from '../src/vary/batch.js'

/** A project with one synth track carrying a committed-looking chain, plus a 2-bar song. */
function scratch(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dotbeat-resample-test-'))
  let doc = initDocument({ trackId: 'lead' })
  doc = addNote(doc, 'lead', { pitch: 60, start: 0, duration: 4, velocity: 0.9 }).doc
  doc = addEffect(doc, 'lead', 'vinylDistortion', { id: 'vinyl' }).doc
  doc = addEffect(doc, 'lead', 'bitcrush', { id: 'crush', enabled: false }).doc
  doc = addTrack(doc, { id: 'pad', kind: 'synth' }).doc
  doc = setScene(doc, 'a', {}) // empty scene: the render length is what this test needs, not content
  doc = setSong(doc, [{ scene: 'a', bars: 2 }])
  const file = join(dir, 'song.beat')
  writeFileSync(file, serialize(doc))
  return { dir, file }
}

/** Stand-in for a rendered solo take — real 16-bit WAV bytes so durations and hashes are real. */
function fakeBounce(seconds = 2): { bytes: Buffer; durationSeconds: number } {
  const sr = 8000
  const n = Math.round(seconds * sr)
  const ch = new Float64Array(n)
  for (let i = 0; i < n; i++) ch[i] = 0.4 * Math.sin((2 * Math.PI * 220 * i) / sr)
  return { bytes: encodeWav16([ch], sr), durationSeconds: seconds }
}

function doResample(file: string, trackId: string, opts: Parameters<typeof registerResample>[0]['opts'] = {}) {
  const { bytes, durationSeconds } = fakeBounce()
  const scratchDir = mkdtempSync(join(tmpdir(), 'dotbeat-bounce-'))
  const wavPath = join(scratchDir, 'bounce.wav')
  writeFileSync(wavPath, bytes)
  try {
    return registerResample({ beatFilePath: file, trackId, wavBytes: bytes, wavPath, durationSeconds, opts })
  } finally {
    rmSync(scratchDir, { recursive: true, force: true })
  }
}

test('a bounce registers as a real media sample with an enforced provenance sidecar', () => {
  const { dir, file } = scratch()
  const res = doResample(file, 'lead', { now: '2026-07-26T00:00:00.000Z' })

  assert.equal(res.id, 'lead-resample')
  assert.equal(res.relPath, 'media/lead-resample.wav')
  assert.ok(existsSync(join(dir, 'media', 'lead-resample.wav')), 'the bytes were copied into media/')
  assert.ok(existsSync(res.sidecarPath), 'the provenance sidecar exists — registerPreppedMedia enforces this')

  // The media block actually names it, at the right sha, so the daemon will serve it and the
  // engine will decode it.
  const after = parse(readFileSync(file, 'utf8'))
  const entry = after.media.find((m) => m.id === 'lead-resample')!
  assert.equal(entry.path, 'media/lead-resample.wav')
  assert.equal(entry.sha256, createHash('sha256').update(readFileSync(join(dir, 'media', 'lead-resample.wav'))).digest('hex'))
  rmSync(dir, { recursive: true, force: true })
})

test('the sidecar records WHAT was bounced, from WHICH document state, through WHICH chain', () => {
  const { dir, file } = scratch()
  const docShaBefore = createHash('sha256').update(readFileSync(file)).digest('hex')
  const res = doResample(file, 'lead', { now: '2026-07-26T00:00:00.000Z', license: 'cleared: my own synth patch' })
  const sc = JSON.parse(readFileSync(res.sidecarPath, 'utf8'))

  assert.equal(sc.resampledFrom.trackId, 'lead')
  assert.equal(sc.resampledFrom.trackKind, 'synth')
  assert.equal(sc.resampledFrom.method, 'solo-render')
  // The document sha is the recipe pin (beat regen's own posture): it is the sha of the file AS IT
  // WAS when the render happened, NOT after registration added the media line.
  assert.equal(sc.resampledFrom.docSha256, docShaBefore)
  assert.notEqual(sc.resampledFrom.docSha256, createHash('sha256').update(readFileSync(file)).digest('hex'))
  // The committed chain, verbatim and IN ORDER, including the bypassed member — "enabled: false"
  // is part of what was committed, and dropping it would make two different bounces look identical.
  assert.deepEqual(sc.resampledFrom.chain, [
    { id: 'eq3', type: 'eq3', enabled: true },
    { id: 'comp', type: 'comp', enabled: true },
    { id: 'distortion', type: 'distortion', enabled: true },
    { id: 'bitcrush', type: 'bitcrush', enabled: true },
    { id: 'vinyl', type: 'vinylDistortion', enabled: true },
    { id: 'crush', type: 'bitcrush', enabled: false },
  ])
  assert.equal(sc.resampledFrom.seconds, 4, '2 bars at 120 bpm')
  assert.equal(sc.license, 'cleared: my own synth patch', 'you assert the licence, we do not guess it')
  assert.equal(sc.durationSeconds, 2)
  rmSync(dir, { recursive: true, force: true })
})

test('a second bounce of the same track is a NEW take, never a silent overwrite', () => {
  const { dir, file } = scratch()
  assert.equal(doResample(file, 'lead').id, 'lead-resample')
  assert.equal(doResample(file, 'lead').id, 'lead-resample-2')
  assert.equal(doResample(file, 'lead').id, 'lead-resample-3')
  const after = parse(readFileSync(file, 'utf8'))
  assert.deepEqual(after.media.map((m) => m.id), ['lead-resample', 'lead-resample-2', 'lead-resample-3'])
  rmSync(dir, { recursive: true, force: true })
})

test('an explicit id MAY re-register, and says so rather than doing it quietly', () => {
  const { dir, file } = scratch()
  const first = doResample(file, 'lead', { as: 'stab' })
  assert.equal(first.reregistered, null)
  const again = doResample(file, 'lead', { as: 'stab' })
  assert.ok(again.reregistered, 'a re-registration is reported to the caller, which prints a warning')
  assert.equal(again.reregistered!.previousSha256, first.sha256)
  assert.deepEqual(parse(readFileSync(file, 'utf8')).media.map((m) => m.id), ['stab'], 'one entry, not two')
  rmSync(dir, { recursive: true, force: true })
})

test('bad inputs fail loudly and leave the project alone', () => {
  const { dir, file } = scratch()
  const before = readFileSync(file, 'utf8')
  assert.throws(() => doResample(file, 'ghost'), /no track "ghost"/)
  assert.throws(() => doResample(file, 'lead', { as: 'not a slug' }), BeatBatchError)
  assert.equal(readFileSync(file, 'utf8'), before, 'a refused bounce is a no-op on the file')
  rmSync(dir, { recursive: true, force: true })
})

test('a failed sidecar write rolls the media copy back (the invariant is inherited, not re-implemented)', () => {
  const { dir, file } = scratch()
  // Let the wav copy SUCCEED and make only the sidecar write fail: a directory sitting where the
  // sidecar file goes (EISDIR). This is the precise ordering the invariant is about — bytes on
  // disk, provenance missing — which is why it is worth asserting rather than assuming.
  const mediaDir = join(dir, 'media')
  mkdirSync(join(mediaDir, 'lead-resample.wav.json'), { recursive: true })
  try {
    assert.throws(() => doResample(file, 'lead'), /provenance sidecar/)
    assert.equal(existsSync(join(mediaDir, 'lead-resample.wav')), false, 'the copied wav was rolled back')
    assert.equal(parse(readFileSync(file, 'utf8')).media.length, 0, 'nothing was registered')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('projectRenderSeconds and mintResampleId match the render/registration rules they mirror', () => {
  const loopOnly = initDocument({ trackId: 'lead' })
  assert.equal(projectRenderSeconds(loopOnly), (loopOnly.loopBars * 16 * 60) / loopOnly.bpm / 4)
  const songed = setSong(setScene(loopOnly, 'a', {}), [{ scene: 'a', bars: 3 }, { scene: 'a', bars: 5 }])
  assert.equal(projectRenderSeconds(songed), 16, '8 bars at 120 bpm')
  assert.equal(mintResampleId(loopOnly, 'lead'), 'lead-resample')
})

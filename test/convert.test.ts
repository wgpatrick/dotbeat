import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse, serialize, sandboxPayloadToBeatDocument, beatDocumentToPartialTracks, type ExternalSandboxPayload } from '../src/core/index.js'

// A real, non-synthetic project export from the live BeatLab dev server (generated via
// Playwright driving the actual store — see the session's gen-fixture.mjs). Proves the .beat
// format against real app data, not just hand-built fixtures: real IDs (n106, u100000...), a
// real 74-field SynthParams object (including wavetable-frame arrays), a drum track, and a
// selectedTrackId that points at that (non-synth) drum track — the actual fallback edge case.
const fixturePath = fileURLToPath(new URL('./fixtures/real-sandbox.beatlab.json', import.meta.url))
const realPayload = JSON.parse(readFileSync(fixturePath, 'utf8')) as ExternalSandboxPayload

test('fixture sanity: this is real, non-trivial project data', () => {
  assert.equal(realPayload.tracks.length, 4)
  assert.ok(realPayload.tracks.some((t) => t.kind === 'drums'))
  assert.equal(realPayload.selectedTrackId, 'drums') // the edge case this suite exercises
  const lead = realPayload.tracks.find((t) => t.id === 'lead')!
  assert.ok(Object.keys(lead.synth).length > 50, 'real SynthParams has far more than v0\'s 9 fields')
})

test('converts real payload to a v0 document, dropping exactly the drum track', () => {
  const { doc, report } = sandboxPayloadToBeatDocument(realPayload)
  assert.deepEqual(report.droppedTracks, ['drums'])
  assert.equal(doc.tracks.length, 3)
  assert.deepEqual(doc.tracks.map((t) => t.id), ['bass', 'chords', 'lead'])
})

test('falls back selectedTrack to the first synth track when the source selected a dropped (drum) track', () => {
  const { doc, report } = sandboxPayloadToBeatDocument(realPayload)
  assert.equal(report.selectedTrackFellBack, true)
  assert.equal(doc.selectedTrack, 'bass')
})

test('reports which real SynthParams fields v0 does not model, per track', () => {
  const { report } = sandboxPayloadToBeatDocument(realPayload)
  const leadDropped = report.droppedSynthParams.lead!
  assert.ok(leadDropped.includes('wtCustomA'), 'wavetable frame arrays are v0-out-of-scope')
  assert.ok(leadDropped.includes('lfoRate'), 'LFO params are v0-out-of-scope')
  assert.ok(!leadDropped.includes('cutoff'), 'cutoff IS in v0 and must not be reported as dropped')
})

test('every note on every real synth track survives the conversion exactly', () => {
  const { doc } = sandboxPayloadToBeatDocument(realPayload)
  for (const srcTrack of realPayload.tracks.filter((t) => t.kind === 'synth')) {
    const converted = doc.tracks.find((t) => t.id === srcTrack.id)!
    assert.equal(converted.notes.length, srcTrack.notes.length, `${srcTrack.id}: note count must match exactly`)
    const byId = new Map(converted.notes.map((n) => [n.id, n]))
    for (const srcNote of srcTrack.notes) {
      const got = byId.get(srcNote.id)
      assert.ok(got, `${srcTrack.id}: note ${srcNote.id} must survive conversion`)
      assert.deepEqual(got, { id: srcNote.id, pitch: srcNote.pitch, start: srcNote.start, duration: srcNote.duration, velocity: srcNote.velocity })
    }
  }
})

test('the 9 v0 synth fields survive conversion exactly, for every real synth track', () => {
  const { doc } = sandboxPayloadToBeatDocument(realPayload)
  for (const srcTrack of realPayload.tracks.filter((t) => t.kind === 'synth')) {
    const converted = doc.tracks.find((t) => t.id === srcTrack.id)!
    for (const key of ['osc', 'volume', 'cutoff', 'resonance', 'attack', 'decay', 'sustain', 'release', 'pan'] as const) {
      assert.equal(converted.synth[key], srcTrack.synth[key], `${srcTrack.id}.synth.${key}`)
    }
  }
})

test('the converted real document round-trips through .beat text byte-for-byte', () => {
  const { doc } = sandboxPayloadToBeatDocument(realPayload)
  const text = serialize(doc)
  assert.equal(serialize(parse(text)), text)
})

test('the real lead track, hand-inspectable as .beat text, contains the exact edit made before export', () => {
  // gen-fixture.mjs set the lead track's cutoff to 3200 and resonance to 1.4, and added a note
  // at pitch 72 / start 8 — confirm those specific edits are visible, verbatim, in the text.
  const { doc } = sandboxPayloadToBeatDocument(realPayload)
  const text = serialize(doc)
  const leadBlock = text.slice(text.indexOf('track lead'))
  assert.match(leadBlock, /^\s*cutoff 3200$/m)
  assert.match(leadBlock, /^\s*resonance 1\.4$/m)
  assert.match(leadBlock, /^\s*note \S+ 72 8 \d+ [\d.]+$/m)
})

test('beatDocumentToPartialTracks round-trips the v0-modeled fields back out for re-import', () => {
  const { doc } = sandboxPayloadToBeatDocument(realPayload)
  const partial = beatDocumentToPartialTracks(doc)
  assert.equal(partial.bpm, realPayload.bpm)
  assert.equal(partial.loopBars, realPayload.loopBars)
  const lead = partial.tracks.find((t) => t.id === 'lead')!
  assert.equal(lead.synth.cutoff, 3200)
  assert.equal(lead.notes.length, realPayload.tracks.find((t) => t.id === 'lead')!.notes.length)
})

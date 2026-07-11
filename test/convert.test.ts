import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse, serialize, sandboxPayloadToBeatDocument, beatDocumentToPartialTracks, DELIBERATELY_UNMODELED, type ExternalSandboxPayload } from '../src/core/index.js'

// A real, non-synthetic project export from the live BeatLab dev server (generated via
// Playwright driving the actual store — see the session's gen-fixture.mjs). Proves the .beat
// format against real app data, not just hand-built fixtures: real IDs (n106, u100000...), a
// real 74-field SynthParams object (including wavetable-frame arrays), a drum track, and a
// selectedTrackId that points at that drum track (which, pre-v0.2, exercised the fallback path —
// since v0.2 drums convert, so it must NOT fall back anymore).
const fixturePath = fileURLToPath(new URL('./fixtures/real-sandbox.beatlab.json', import.meta.url))
const realPayload = JSON.parse(readFileSync(fixturePath, 'utf8')) as ExternalSandboxPayload

test('fixture sanity: this is real, non-trivial project data', () => {
  assert.equal(realPayload.tracks.length, 4)
  assert.ok(realPayload.tracks.some((t) => t.kind === 'drums'))
  assert.equal(realPayload.selectedTrackId, 'drums')
  const lead = realPayload.tracks.find((t) => t.id === 'lead')!
  assert.ok(Object.keys(lead.synth).length > 50, "real SynthParams has far more than the format's 9 fields")
})

test('converts the real payload with zero dropped tracks (drums convert since v0.2)', () => {
  const { doc, report } = sandboxPayloadToBeatDocument(realPayload)
  assert.deepEqual(report.droppedTracks, [])
  assert.equal(doc.tracks.length, 4)
  assert.deepEqual(doc.tracks.map((t) => t.id), ['drums', 'bass', 'chords', 'lead'])
})

test('selectedTrack pointing at the drum track survives — no fallback needed anymore', () => {
  const { doc, report } = sandboxPayloadToBeatDocument(realPayload)
  assert.equal(report.selectedTrackFellBack, false)
  assert.equal(doc.selectedTrack, 'drums')
})

test('the real drum pattern survives conversion into hits (first bar reproduces it exactly)', () => {
  const { doc } = sandboxPayloadToBeatDocument(realPayload)
  const srcDrums = realPayload.tracks.find((t) => t.kind === 'drums')!
  const drums = doc.tracks.find((t) => t.id === srcDrums.id)!
  assert.equal(drums.kind, 'drums')
  // v0.8: the 16-step pattern migrated to free-timed hits; the first bar (steps 0-15) must carry
  // exactly the source's nonzero steps at the same velocities.
  for (const lane of ['kick', 'snare', 'clap', 'hat', 'openhat'] as const) {
    const bar0 = new Map(drums.hits.filter((h) => h.lane === lane && h.start < 16).map((h) => [h.start, h.velocity]))
    srcDrums.pattern![lane]!.forEach((v, step) => {
      if (v > 0) assert.equal(bar0.get(step), v, `${lane} step ${step}`)
      else assert.ok(!bar0.has(step), `${lane} step ${step} should be silent`)
    })
  }
})

test('reports which real SynthParams fields the format does not model, per track', () => {
  const { report } = sandboxPayloadToBeatDocument(realPayload)
  const leadDropped = report.droppedSynthParams.lead!
  assert.ok(leadDropped.includes('wtCustomA'), 'wavetable frame arrays are out of scope')
  assert.ok(!leadDropped.includes('lfoRate'), 'LFO params ARE modeled since v0.3')
  assert.ok(!leadDropped.includes('cutoff'), 'cutoff IS modeled and must not be reported as dropped')
  // Everything still dropped must be on the documented DELIBERATELY_UNMODELED list — no
  // accidental loss beyond the fields the format explicitly declines to model.
  for (const [trackId, dropped] of Object.entries(report.droppedSynthParams)) {
    for (const key of dropped) {
      assert.ok((DELIBERATELY_UNMODELED as readonly string[]).includes(key), `${trackId}: dropped "${key}" is not on the DELIBERATELY_UNMODELED list`)
    }
  }
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

test('the 9 modeled synth fields survive conversion exactly, for every real track (drums included)', () => {
  const { doc } = sandboxPayloadToBeatDocument(realPayload)
  for (const srcTrack of realPayload.tracks) {
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

test('beatDocumentToPartialTracks round-trips the modeled fields back out for re-import', () => {
  const { doc } = sandboxPayloadToBeatDocument(realPayload)
  const partial = beatDocumentToPartialTracks(doc)
  assert.equal(partial.bpm, realPayload.bpm)
  assert.equal(partial.loopBars, realPayload.loopBars)
  assert.equal(partial.selectedTrackId, 'drums')
  const lead = partial.tracks.find((t) => t.id === 'lead')!
  assert.equal(lead.synth.cutoff, 3200)
  assert.equal(lead.notes.length, realPayload.tracks.find((t) => t.id === 'lead')!.notes.length)
  const drums = partial.tracks.find((t) => t.id === 'drums')!
  assert.equal(drums.kind, 'drums')
  assert.deepEqual(drums.pattern!.kick, realPayload.tracks.find((t) => t.id === 'drums')!.pattern!.kick)
})

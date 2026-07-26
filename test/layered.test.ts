// The layered clip source (src/taste/layered.ts): deterministic multi-track assembly, crossover
// correctness, mono discipline, and the target-verification gate. No audio and no renders here —
// the builder is pure, exactly like showdown.ts's own half, and the render-side proof lives in
// scripts/layered-check.mjs (whose output is the arm's before/after feature table).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse, serialize } from '../src/core/index.js'
import {
  LAYERED_ROLES,
  LAYERED_TARGETS,
  MONO_DISCIPLINE,
  UNMEASURABLE_TARGETS,
  anchorShift,
  buildLayeredClip,
  checkCrossover,
  formatTargetVerification,
  isLayeredRole,
  layerNotes,
  layeredArchitecture,
  layeredFeatures,
  layeredScratchText,
  monoViolations,
  verifyLayeredTargets,
  type LayeredFeatures,
} from '../src/taste/layered.js'
import { composePitchedPhrase, inferSeedKey } from '../src/taste/showdown.js'
import { generateSeedBeat } from '../src/taste/seeds.js'
import { engineplusProfile, surgeplusProfile } from '../src/taste/showdown.js'
import type { ComposedPhrase } from '../src/taste/phrase.js'
import type { MixMetrics } from '../src/metrics/index.js'

const KEY = { root: 52, minor: true } // E minor — a fixed key so every assertion below is exact

const phraseFor = (role: 'bassline' | 'chords' | 'lead', seed = 41): ComposedPhrase =>
  composePitchedPhrase(role, KEY, seed)

// ---- architecture invariants -------------------------------------------------------------------

test('every layered architecture is a valid crossover with a mono bottom layer', () => {
  for (const role of LAYERED_ROLES) {
    const arch = layeredArchitecture(role)
    const cross = checkCrossover(arch)
    assert.equal(cross.ok, true, `${role}: ${cross.problems.join('; ')}`)
    // exactly one lowpassed bottom, everything else highpassed — the whole point of the ladder
    assert.equal(arch.layers.filter((l) => l.band.mode === 'lowpass').length, 1, `${role} needs exactly one bottom layer`)
    assert.equal(arch.layers.filter((l) => l.band.mode === 'highpass').length, arch.layers.length - 1, `${role}: every layer above the bottom must be highpassed`)
    // the ladder is reported low-to-high and starts at the lowpassed layer (lower edge 0)
    assert.equal(cross.ladder[0]!.lowerEdgeHz, 0, `${role} ladder must start at the bottom layer`)
    assert.equal(cross.ladder.length, arch.layers.length)
    // the bottom layer is mono, always
    assert.equal(arch.layers.find((l) => l.band.mode === 'lowpass')!.mono, true)
    // every layer has a distinct id and a distinct job
    assert.equal(new Set(arch.layers.map((l) => l.id)).size, arch.layers.length, `${role} has duplicate layer ids`)
    // "remove a layer before adding one" — 2-4 layers, never a sprawl
    assert.ok(arch.layers.length >= 2 && arch.layers.length <= 4, `${role} has ${arch.layers.length} layers`)
    // the anchor window must be at least an octave wide, or some medians fall in a gap that no
    // whole-octave shift can reach and the register target becomes a coin flip (caught by the
    // 24-seed anchorShift sweep below on 2026-07-26: a 6-semitone bass window missed on seed 91)
    assert.ok(arch.anchor.hiMidi - arch.anchor.loMidi >= 12, `${role} anchor window is narrower than an octave`)
  }
})

test('checkCrossover REJECTS the failure modes it exists to catch', () => {
  const base = layeredArchitecture('bassline')
  const bottom = base.layers[0]!
  const mid = base.layers[1]!

  // a second layer reaching into the bottom's band (the mud failure mode)
  const overlapping = { ...base, layers: [bottom, { ...mid, band: { ...mid.band, cutoffHz: 20 } }, base.layers[2]!] }
  const overlap = checkCrossover(overlapping)
  assert.equal(overlap.ok, false)
  assert.match(overlap.problems.join(' '), /pour into/)

  // a gap in the spectrum: the bottom's lowpass below the lowest highpass
  const gapped = { ...base, layers: [{ ...bottom, band: { ...bottom.band, cutoffHz: 40 } }, mid, base.layers[2]!] }
  const gap = checkCrossover(gapped)
  assert.equal(gap.ok, false)
  assert.match(gap.problems.join(' '), /hole in the spectrum/)

  // more than an octave of overlap between the bottom and the next layer
  const smeared = { ...base, layers: [{ ...bottom, band: { ...bottom.band, cutoffHz: 300 } }, mid, base.layers[2]!] }
  assert.equal(checkCrossover(smeared).ok, false)
  assert.match(checkCrossover(smeared).problems.join(' '), /more than an octave/)

  // no lowpassed bottom at all — nobody owns the low end
  const headless = { ...base, layers: [{ ...bottom, band: { mode: 'highpass' as const, cutoffHz: 90 } }, mid, base.layers[2]!] }
  assert.equal(checkCrossover(headless).ok, false)

  // a widened bottom layer
  const wideBottom = { ...base, layers: [{ ...bottom, mono: false }, mid, base.layers[2]!] }
  assert.equal(checkCrossover(wideBottom).ok, false)
  assert.match(checkCrossover(wideBottom).problems.join(' '), /must be mono/)
})

test('bass layers sit in the mined 75-100 Hz sub/mid crossover band', () => {
  const arch = layeredArchitecture('bassline')
  const sub = arch.layers.find((l) => l.id === 'sub')!
  const mid = arch.layers.find((l) => l.id === 'mid')!
  assert.ok(sub.band.cutoffHz >= 75 && sub.band.cutoffHz <= 100, `sub lowpass ${sub.band.cutoffHz} outside the consensus 75-100 Hz band`)
  assert.ok(mid.band.cutoffHz >= 75 && mid.band.cutoffHz <= 100, `mid highpass ${mid.band.cutoffHz} outside the consensus 75-100 Hz band`)
  // and the sub is the loudest layer in the stack (MusicRadar's -3 / -10 staging direction)
  assert.ok(arch.layers.every((l) => l.id === 'sub' || l.gainDb < sub.gainDb), 'the sub must be the hottest bass layer')
})

test('the lead octave layer implements the corroborated MusicTech recipe literally', () => {
  const arch = layeredArchitecture('lead')
  const main = arch.layers.find((l) => l.id === 'main')!
  const octave = arch.layers.find((l) => l.id === 'octave')!
  assert.equal(octave.figure.transpose, 12)
  assert.ok(octave.band.cutoffHz >= 450 && octave.band.cutoffHz <= 550, `octave highpass ${octave.band.cutoffHz} (source: ~500 Hz)`)
  const below = main.gainDb - octave.gainDb
  assert.ok(below >= 6 && below <= 10, `octave sits ${below} dB below main (source: 6-10 dB)`)
  const voices = octave.patch.unisonVoices ?? 1
  assert.ok(voices >= 3 && voices <= 5, `octave unison ${voices} voices (source: 3-5)`)
})

test('parallel compression stays in the sourced 15-35% wet band with a punch-preserving attack', () => {
  for (const role of LAYERED_ROLES) {
    for (const layer of layeredArchitecture(role).layers) {
      const comp = layer.production?.comp
      if (!comp) continue
      assert.ok(comp.mix >= 0.15 && comp.mix <= 0.35, `${role}/${layer.id} comp mix ${comp.mix} outside 0.15-0.35`)
      // 10-30 ms preserves punch; only a layer that IS the transient may go faster (5-10 ms)
      const isTransientLayer = layer.id === 'click'
      const lo = isTransientLayer ? 0.005 : 0.01
      assert.ok(comp.attack >= lo && comp.attack <= 0.03, `${role}/${layer.id} comp attack ${comp.attack}s outside ${lo}-0.03s`)
    }
  }
})

// ---- figure derivation --------------------------------------------------------------------------

test('anchorShift lands the figure in the architecture window, in whole octaves', () => {
  for (const role of LAYERED_ROLES) {
    const arch = layeredArchitecture(role)
    for (let seed = 1; seed <= 24; seed++) {
      const phrase = phraseFor(role, seed * 13)
      const shift = anchorShift(phrase, arch.anchor)
      assert.equal(shift % 12 === 0, true, `${role} seed ${seed}: shift ${shift} is not a whole octave`)
      const pitches = phrase.notes.map((n) => n.pitch + shift).sort((a, b) => a - b)
      const med = pitches.length % 2 === 1 ? pitches[(pitches.length - 1) / 2]! : (pitches[pitches.length / 2 - 1]! + pitches[pitches.length / 2]!) / 2
      assert.ok(
        med >= arch.anchor.loMidi && med <= arch.anchor.hiMidi,
        `${role} seed ${seed}: anchored median ${med} outside [${arch.anchor.loMidi}, ${arch.anchor.hiMidi}]`,
      )
    }
  }
})

test('layerNotes never moves an onset — layers stay sample-aligned', () => {
  const phrase = phraseFor('chords')
  const arch = layeredArchitecture('chords')
  const shift = anchorShift(phrase, arch.anchor)
  const sourceStarts = new Set(phrase.notes.map((n) => n.start))
  for (const layer of arch.layers) {
    const notes = layerNotes(phrase, layer.figure, shift)
    assert.ok(notes.length > 0, `${layer.id} derived no notes`)
    for (const n of notes) assert.ok(sourceStarts.has(n.start), `${layer.id} invented onset ${n.start}`)
  }
})

test('pick modes select the right voices; dropRoot is rootless but never empty', () => {
  const phrase: ComposedPhrase = {
    archetype: 'test',
    notes: [
      { pitch: 60, start: 0, duration: 4, velocity: 0.7 },
      { pitch: 64, start: 0, duration: 4, velocity: 0.7 },
      { pitch: 67, start: 0, duration: 4, velocity: 0.7 },
      { pitch: 72, start: 8, duration: 4, velocity: 0.6 }, // a lone note: no root to drop
    ],
  }
  assert.deepEqual(layerNotes(phrase, { transpose: 0, pick: 'all' }, 0).map((n) => n.pitch), [60, 64, 67, 72])
  assert.deepEqual(layerNotes(phrase, { transpose: 0, pick: 'lowest' }, 0).map((n) => n.pitch), [60, 72])
  assert.deepEqual(layerNotes(phrase, { transpose: 0, pick: 'highest' }, 0).map((n) => n.pitch), [67, 72])
  // rootless: the 60 goes, the lone 72 stays (dropping it would silence the layer)
  assert.deepEqual(layerNotes(phrase, { transpose: 0, pick: 'dropRoot' }, 0).map((n) => n.pitch), [64, 67, 72])
  // transpose and base shift compose additively
  assert.deepEqual(layerNotes(phrase, { transpose: 12, pick: 'lowest' }, -24).map((n) => n.pitch), [48, 60])
})

test('monophonic voicing removes every overlap without touching onsets', () => {
  const phrase: ComposedPhrase = {
    archetype: 'test',
    notes: [
      { pitch: 40, start: 0, duration: 12, velocity: 0.8 }, // would still ring at step 10
      { pitch: 43, start: 10, duration: 8, velocity: 0.8 },
      { pitch: 45, start: 14, duration: 2, velocity: 0.8 },
    ],
  }
  const mono = layerNotes(phrase, { transpose: 0, pick: 'lowest', monophonic: true }, 0)
  assert.deepEqual(mono.map((n) => n.start), [0, 10, 14])
  assert.deepEqual(mono.map((n) => n.duration), [10, 4, 2])
  for (let i = 0; i < mono.length - 1; i++) {
    assert.ok(mono[i]!.start + mono[i]!.duration <= mono[i + 1]!.start, 'monophonic layer still overlaps')
  }
  // and every monophonic layer in a real architecture is genuinely overlap-free
  for (const role of LAYERED_ROLES) {
    const arch = layeredArchitecture(role)
    for (let seed = 1; seed <= 12; seed++) {
      const p = phraseFor(role, seed * 29)
      const shift = anchorShift(p, arch.anchor)
      for (const layer of arch.layers) {
        if (layer.figure.monophonic !== true) continue
        const notes = layerNotes(p, layer.figure, shift)
        for (let i = 0; i < notes.length - 1; i++) {
          assert.ok(
            notes[i]!.start + notes[i]!.duration <= notes[i + 1]!.start,
            `${role}/${layer.id} seed ${seed}: overlap at step ${notes[i]!.start}`,
          )
        }
      }
    }
  }
})

test('clamped layers shorten notes but keep the same onset count', () => {
  const arch = layeredArchitecture('chords')
  const stab = arch.layers.find((l) => l.id === 'stab')!
  const phrase = phraseFor('chords')
  const shift = anchorShift(phrase, arch.anchor)
  const notes = layerNotes(phrase, stab.figure, shift)
  assert.ok(notes.every((n) => n.duration <= stab.figure.maxDurationSteps!), 'stab notes exceed the clamp')
  assert.ok(notes.every((n) => n.duration >= 1), 'a clamped note fell below one step')
})

// ---- assembly ------------------------------------------------------------------------------------

test('buildLayeredClip assembles one synth track per layer, all playing the same figure', () => {
  for (const role of LAYERED_ROLES) {
    const arch = layeredArchitecture(role)
    const phrase = phraseFor(role)
    const clip = buildLayeredClip(role, phrase, 124)
    assert.equal(clip.doc.tracks.length, arch.layers.length, `${role} track count`)
    assert.equal(clip.doc.bpm, 124)
    assert.equal(clip.doc.loopBars, 4)
    for (const layer of arch.layers) {
      const track = clip.doc.tracks.find((t) => t.id === layer.id)
      assert.ok(track && track.kind === 'synth', `${role}: no synth track "${layer.id}"`)
      assert.equal(track.synth.volume, layer.gainDb, `${role}/${layer.id} level`)
      assert.equal(track.synth.filterType, layer.band.mode, `${role}/${layer.id} filter mode`)
      assert.equal(track.synth.cutoff, layer.band.cutoffHz, `${role}/${layer.id} cutoff`)
      assert.ok(track.notes.length > 0, `${role}/${layer.id} has no notes`)
      // every layer's onsets are a subset of the shared figure's onsets
      const figureStarts = new Set(phrase.notes.map((n) => n.start))
      for (const n of track.notes) assert.ok(figureStarts.has(n.start), `${role}/${layer.id} onset drift`)
    }
    // the receipt matches the doc
    assert.deepEqual(clip.layers.map((l) => l.id), arch.layers.map((l) => l.id))
    for (const r of clip.layers) {
      const track = clip.doc.tracks.find((t) => t.id === r.id)!
      assert.equal(r.notes, track.kind === 'synth' ? track.notes.length : -1)
    }
    // the plain `layered` arm applies no production at all — that is its whole point
    assert.deepEqual(clip.applied, [], `${role}: the layered arm must not apply production`)
  }
})

test('the assembled doc round-trips through the .beat format unchanged', () => {
  for (const role of LAYERED_ROLES) {
    for (const produced of [false, true]) {
      const clip = buildLayeredClip(role, phraseFor(role), 120, { produced })
      const text = serialize(clip.doc)
      const reparsed = parse(text)
      assert.equal(serialize(reparsed), text, `${role} produced=${produced} does not round-trip`)
      assert.equal(reparsed.tracks.length, clip.doc.tracks.length)
    }
  }
})

test('assembly is deterministic: same role + figure + bpm => byte-identical doc', () => {
  for (const role of LAYERED_ROLES) {
    const phrase = phraseFor(role, 77)
    for (const produced of [false, true]) {
      const a = serialize(buildLayeredClip(role, phrase, 128, { produced }).doc)
      const b = serialize(buildLayeredClip(role, phrase, 128, { produced }).doc)
      assert.equal(a, b, `${role} produced=${produced} is not deterministic`)
    }
  }
})

test('layers really are registered apart — no two layers share a register AND a band', () => {
  for (const role of LAYERED_ROLES) {
    const clip = buildLayeredClip(role, phraseFor(role), 120)
    const seen = new Set<string>()
    for (const l of clip.layers) {
      const key = `${l.loMidi}:${l.hiMidi}:${l.band}`
      assert.equal(seen.has(key), false, `${role}: two layers occupy the same register and band (${key})`)
      seen.add(key)
    }
  }
})

test('the layeredplus arm produces every layer that asks for it, and reports honestly', () => {
  for (const role of LAYERED_ROLES) {
    const arch = layeredArchitecture(role)
    const clip = buildLayeredClip(role, phraseFor(role), 120, { produced: true })
    assert.ok(clip.applied.length > 0, `${role}: layeredplus applied nothing`)
    for (const layer of arch.layers) {
      if (!layer.production) continue
      assert.ok(clip.applied.some((a) => a.startsWith(`${layer.id}:`)), `${role}/${layer.id}: no production landed`)
    }
    // the parallel compressor is genuinely wired: compMix off the floor AND a comp insert present
    for (const layer of arch.layers) {
      const comp = layer.production?.comp
      if (!comp) continue
      const track = clip.doc.tracks.find((t) => t.id === layer.id)!
      assert.equal(track.kind, 'synth')
      if (track.kind !== 'synth') continue
      assert.equal(track.synth.compMix, comp.mix, `${role}/${layer.id} compMix`)
      assert.equal(track.synth.compRatio, comp.ratio)
      assert.ok(track.effects.some((e) => e.type === 'comp' && e.enabled), `${role}/${layer.id}: comp params set with no comp insert`)
    }
  }
})

// ---- mono discipline -----------------------------------------------------------------------------

test('mono layers stay mono on BOTH arms, field for field', () => {
  for (const role of LAYERED_ROLES) {
    const arch = layeredArchitecture(role)
    for (const produced of [false, true]) {
      const clip = buildLayeredClip(role, phraseFor(role), 120, { produced })
      assert.deepEqual(monoViolations(clip.doc, arch), [], `${role} produced=${produced}`)
      for (const layer of arch.layers) {
        if (!layer.mono) continue
        const track = clip.doc.tracks.find((t) => t.id === layer.id)!
        assert.equal(track.kind, 'synth')
        if (track.kind !== 'synth') continue
        for (const { field, value } of MONO_DISCIPLINE) {
          assert.equal(track.synth[field], value, `${role}/${layer.id}.${String(field)} produced=${produced}`)
        }
        // and no width-adding insert was ever added to a mono layer
        assert.equal(track.effects.some((e) => (e.type === 'utility' || e.type === 'autoPan') && e.enabled), false, `${role}/${layer.id}: width insert on a mono layer`)
      }
    }
  }
})

test('buildLayeredClip REFUSES to emit a doc that broke mono discipline', () => {
  // monoViolations is the gate; prove it fires rather than trusting the happy path
  const arch = layeredArchitecture('bassline')
  const clip = buildLayeredClip('bassline', phraseFor('bassline'), 120)
  const widened = {
    ...clip.doc,
    tracks: clip.doc.tracks.map((t) => (t.id === 'sub' && t.kind === 'synth' ? { ...t, synth: { ...t.synth, unisonWidth: 0.8, pan: -0.4 } } : t)),
  }
  const violations = monoViolations(widened, arch)
  assert.equal(violations.length, 2)
  assert.match(violations.join(' '), /unisonWidth/)
  assert.match(violations.join(' '), /pan/)
})

// ---- target verification -------------------------------------------------------------------------

const metricsFrom = (over: Partial<LayeredFeatures> & { centroidHz?: number }): MixMetrics => ({
  durationSeconds: 8,
  sampleRate: 48000,
  channels: 2,
  integratedLufs: -14,
  samplePeakDbfs: -1,
  truePeakDbtp: over.truePeakDb ?? -1,
  crestDb: over.crestDb ?? 15,
  rmsDbfs: -16,
  spectral: {
    bandsPct: {
      sub: over.bandSubPct ?? 0,
      bass: over.bandBassPct ?? 0,
      mids: over.bandMidsPct ?? 0,
      presence: over.bandPresencePct ?? 0,
      air: over.bandAirPct ?? 0,
    },
    centroidHz: over.centroidHz ?? 1000,
  },
  stereo: { correlation: over.stereoCorrelation ?? 1, widthDb: over.stereoWidthDb ?? -50 },
})

test('layeredFeatures reads the existing metrics and converts the centroid to Hz', () => {
  const f = layeredFeatures(metricsFrom({ bandSubPct: 55, centroidHz: 74, stereoWidthDb: -46, stereoCorrelation: 0.99 }))
  assert.equal(f.bandSubPct, 55)
  assert.ok(Math.abs(f.centroidHz - 74) < 0.01, `centroid ${f.centroidHz}`)
  assert.equal(f.stereoWidthDb, -46)
  assert.equal(f.stereoCorrelation, 0.99)
})

test('verifyLayeredTargets passes a clip inside every measured band', () => {
  const v = verifyLayeredTargets('bassline', layeredFeatures(metricsFrom({
    bandSubPct: 55, centroidHz: 78, stereoWidthDb: -46, stereoCorrelation: 0.995,
  })))
  assert.equal(v.ok, true, formatTargetVerification(v, 'bassline'))
  assert.equal(v.passed, v.total)
  assert.equal(v.total, Object.keys(LAYERED_TARGETS.bassline).length)
})

test('verifyLayeredTargets fails the exact features that miss, and only those', () => {
  // the engineplus bassline profile as 131 measured it: 0.22% sub, 162 Hz centroid, -11.8 dB wide
  const v = verifyLayeredTargets('bassline', layeredFeatures(metricsFrom({
    bandSubPct: 0.22, centroidHz: 162, stereoWidthDb: -11.8, stereoCorrelation: 0.88,
  })))
  assert.equal(v.ok, false)
  assert.equal(v.passed, 0, 'the measured engineplus bass row must fail every bass target')
  assert.deepEqual(v.results.filter((r) => !r.pass).map((r) => r.feature).sort(), ['bandSubPct', 'centroidHz', 'stereoCorrelation', 'stereoWidthDb'])
  // one feature in range, the rest out
  const partial = verifyLayeredTargets('bassline', layeredFeatures(metricsFrom({
    bandSubPct: 45, centroidHz: 162, stereoWidthDb: -11.8, stereoCorrelation: 0.88,
  })))
  assert.equal(partial.passed, 1)
  assert.equal(partial.results.find((r) => r.feature === 'bandSubPct')!.pass, true)
})

test('both-sided target ranges reject BOTH directions', () => {
  const tooNarrow = verifyLayeredTargets('lead', layeredFeatures(metricsFrom({ bandBassPct: 8, bandMidsPct: 80, crestDb: 15, stereoWidthDb: -30 })))
  assert.equal(tooNarrow.results.find((r) => r.feature === 'stereoWidthDb')!.pass, false, 'a too-narrow lead must fail')
  const tooWide = verifyLayeredTargets('lead', layeredFeatures(metricsFrom({ bandBassPct: 8, bandMidsPct: 80, crestDb: 15, stereoWidthDb: -1 })))
  assert.equal(tooWide.results.find((r) => r.feature === 'stereoWidthDb')!.pass, false, 'a too-wide lead must fail')
  const justRight = verifyLayeredTargets('lead', layeredFeatures(metricsFrom({ bandBassPct: 8, bandMidsPct: 80, crestDb: 15, stereoWidthDb: -6 })))
  assert.equal(justRight.ok, true, formatTargetVerification(justRight, 'lead'))
})

test('every target carries its measured provenance, and the blind spots are named', () => {
  for (const role of LAYERED_ROLES) {
    for (const [key, t] of Object.entries(LAYERED_TARGETS[role])) {
      assert.ok(t.source.length > 10, `${role}.${key} has no provenance`)
      assert.ok(t.min !== undefined || t.max !== undefined, `${role}.${key} has no bound`)
      if (t.min !== undefined && t.max !== undefined) assert.ok(t.min < t.max, `${role}.${key} has an inverted range`)
    }
  }
  // the gate must ADMIT what it cannot see rather than silently omitting it
  assert.ok(UNMEASURABLE_TARGETS.length >= 4)
  const named = UNMEASURABLE_TARGETS.map((u) => u.name)
  for (const expected of ['crest_subDb', 'attackMedMs', 'fluxMean', 'flatnessHiDb']) {
    assert.ok(named.includes(expected), `${expected} must be reported as unmeasurable, not dropped`)
  }
  const printed = formatTargetVerification(verifyLayeredTargets('chords', layeredFeatures(metricsFrom({}))), 'x')
  for (const n of named) assert.match(printed, new RegExp(n))
})

test('unknown roles are refused loudly (drum-loop is deliberately out of scope)', () => {
  assert.equal(isLayeredRole('drum-loop'), false)
  assert.throws(() => layeredArchitecture('drum-loop'), /no layered architecture/)
  assert.throws(() => verifyLayeredTargets('drum-loop', layeredFeatures(metricsFrom({}))), /no layered targets/)
  assert.throws(() => buildLayeredClip('drum-loop', phraseFor('lead'), 120), /no layered architecture/)
  assert.throws(() => buildLayeredClip('bassline', { archetype: 'x', notes: [] }, 120), /at least one note/)
})

test('layeredScratchText parses and declares exactly the architecture layers', () => {
  for (const role of LAYERED_ROLES) {
    const arch = layeredArchitecture(role)
    const doc = parse(layeredScratchText(arch, 131))
    assert.equal(doc.bpm, 131)
    assert.deepEqual(doc.tracks.map((t) => t.id), arch.layers.map((l) => l.id))
    assert.ok(doc.tracks.every((t) => t.kind === 'synth'))
    assert.equal(doc.selectedTrack, arch.layers[0]!.id)
  }
})

// ---- frozen science ------------------------------------------------------------------------------

test('the layered arm did not touch the frozen engineplus/surgeplus profiles', () => {
  // A cheap standing tripwire: this stream adds a NEW production path, so the two frozen ones must
  // still hold their exact measured constants (test/showdown.test.ts pins them field-for-field; this
  // just makes a layered-arm regression fail in the layered-arm's own file too).
  const ep = engineplusProfile('synth')
  assert.equal(ep.osc2Layer!.detuneCents, 10)
  assert.equal(ep.osc2Layer!.level, 0.35)
  assert.equal(ep.chorusMix, 0.25)
  assert.equal(ep.eqHigh, 2.5)
  assert.equal(engineplusProfile('drums').chorusMix, 0.15)
  assert.equal(surgeplusProfile('bassline').chorusMix, 0.3)
  assert.equal(surgeplusProfile('lead').utilityWidth, 0.85)
})

test('a real seed key composes a buildable layered clip for every pitched role', () => {
  // end-to-end through the same path the CLI walks: seed -> inferred key -> composed figure -> stack
  const seedDoc = parse(generateSeedBeat(9).text)
  const key = inferSeedKey(seedDoc)
  for (const role of LAYERED_ROLES) {
    const phrase = composePitchedPhrase(role, key, 9)
    const clip = buildLayeredClip(role, phrase, seedDoc.bpm, { produced: true })
    assert.ok(clip.layers.every((l) => l.notes > 0))
    assert.equal(parse(serialize(clip.doc)).tracks.length, clip.layers.length)
    assert.equal(clip.baseShift % 12 === 0, true)
  }
})

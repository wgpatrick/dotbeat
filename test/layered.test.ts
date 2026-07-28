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
  architectureFingerprint,
  architectureShape,
  fitSwellAttack,
  preservedCutoffHz,
  REF_POOL_QUANTILES,
  type LayeredFeatures,
} from '../src/taste/layered.js'
import { composePitchedPhrase, inferSeedKey } from '../src/taste/showdown.js'
import { generateSeedBeat } from '../src/taste/seeds.js'
import { engineplusProfile, surgeplusProfile } from '../src/taste/showdown.js'
import type { ComposedPhrase } from '../src/compose/phrase.js'
import { analyze, analyzeRich } from '../src/metrics/index.js'
import { mulberry32 } from '../src/core/rng.js'

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
  // seed 3 draws a four-layer bass; the assertions below need at least three layers to mangle
  const base = layeredArchitecture('bassline', 3)
  assert.ok(base.layers.length >= 3, 'fixture seed no longer draws a >=3-layer stack')
  const bottom = base.layers[0]!
  const mid = base.layers[1]!
  const rest = base.layers.slice(2)

  // a second layer reaching into the bottom's band (the mud failure mode)
  const overlapping = { ...base, layers: [bottom, { ...mid, band: { ...mid.band, cutoffHz: 20 } }, ...rest] }
  const overlap = checkCrossover(overlapping)
  assert.equal(overlap.ok, false)
  assert.match(overlap.problems.join(' '), /pour into/)

  // a gap in the spectrum: the bottom's lowpass below the lowest highpass
  const gapped = { ...base, layers: [{ ...bottom, band: { ...bottom.band, cutoffHz: 40 } }, mid, ...rest] }
  const gap = checkCrossover(gapped)
  assert.equal(gap.ok, false)
  assert.match(gap.problems.join(' '), /hole in the spectrum/)

  // more than an octave of overlap between the bottom and the next layer
  const smeared = { ...base, layers: [{ ...bottom, band: { ...bottom.band, cutoffHz: 400 } }, mid, ...rest] }
  assert.equal(checkCrossover(smeared).ok, false)
  assert.match(checkCrossover(smeared).problems.join(' '), /more than an octave/)

  // no lowpassed bottom at all — nobody owns the low end
  const headless = { ...base, layers: [{ ...bottom, band: { mode: 'highpass' as const, cutoffHz: 90 } }, mid, ...rest] }
  assert.equal(checkCrossover(headless).ok, false)

  // a widened bottom layer
  const wideBottom = { ...base, layers: [{ ...bottom, mono: false }, mid, ...rest] }
  assert.equal(checkCrossover(wideBottom).ok, false)
  assert.match(checkCrossover(wideBottom).problems.join(' '), /must be mono/)
})

// a drawn architecture that broke the ladder must fail LOUDLY at draw time, not render silently
test('layeredArchitecture draws a valid crossover for every seed in a long sweep', () => {
  for (const role of LAYERED_ROLES) {
    for (let seed = 0; seed < 250; seed++) {
      const arch = layeredArchitecture(role, seed)
      const cross = checkCrossover(arch)
      assert.equal(cross.ok, true, `${role} seed ${seed} (${arch.draw.family}): ${cross.problems.join('; ')}`)
      assert.ok(arch.layers.length >= 2 && arch.layers.length <= 4, `${role} seed ${seed}: ${arch.layers.length} layers`)
      assert.ok(arch.anchor.hiMidi - arch.anchor.loMidi >= 12, `${role} seed ${seed}: anchor window narrower than an octave`)
      assert.equal(new Set(arch.layers.map((l) => l.id)).size, arch.layers.length, `${role} seed ${seed}: duplicate layer ids`)
    }
  }
})

test('bass layers sit in the mined 75-100 Hz sub/mid crossover band, on every seed', () => {
  for (let seed = 0; seed < 120; seed++) {
    const arch = layeredArchitecture('bassline', seed)
    const sub = arch.layers.find((l) => l.id === 'sub')!
    assert.ok(sub.band.cutoffHz >= 75 && sub.band.cutoffHz <= 100, `seed ${seed}: sub lowpass ${sub.band.cutoffHz} outside the consensus 75-100 Hz band`)
    // the layer that meets the sub does so within an octave, which is what makes it a crossover
    const lowestHp = Math.min(...arch.layers.filter((l) => l.band.mode === 'highpass').map((l) => l.band.cutoffHz))
    assert.ok(lowestHp >= sub.band.cutoffHz / 2 && lowestHp <= sub.band.cutoffHz, `seed ${seed}: lowest highpass ${lowestHp} does not meet the sub's ${sub.band.cutoffHz} Hz lowpass`)
    // the sub is NEVER the whole instrument: at least one character layer, and it is never buried
    // more than a few dB under the sub. Calibrated 2026-07-26 against the measured per-layer
    // contributions that produced the owner's complaint — at the old -5 dB nominal offset the growl
    // arrived 14 dB under the mix and sub-alone RMS was within 0.15 dB of the whole stack.
    const character = arch.layers.filter((l) => l.id !== 'sub')
    assert.ok(character.length >= 1, `seed ${seed}: a bass stack must carry at least one character layer`)
    assert.ok(character.some((l) => l.gainDb >= sub.gainDb), `seed ${seed}: every character layer sits under the sub — this is the 2026-07-26 "it is just a sine" failure`)
    // and the sub is a pluck, not a held tone (bass-house vein: "nobody uses a long sustain")
    assert.ok((sub.patch.sustain ?? 1) <= 0.85, `seed ${seed}: sub sustain ${sub.patch.sustain} is a drone, not a bass`)
  }
})

test('the lead octave layer implements the corroborated MusicTech recipe literally, on every seed', () => {
  let seen = 0
  for (let seed = 0; seed < 120; seed++) {
    const arch = layeredArchitecture('lead', seed)
    const main = arch.layers.find((l) => l.id === 'main')!
    const octave = arch.layers.find((l) => l.id === 'octave')
    if (!octave) continue
    seen += 1
    assert.equal(octave.figure.transpose, 12)
    assert.ok(octave.band.cutoffHz >= 420 && octave.band.cutoffHz <= 620, `seed ${seed}: octave highpass ${octave.band.cutoffHz} (source: ~500 Hz)`)
    const below = main.gainDb - octave.gainDb
    assert.ok(below >= 6 && below <= 10, `seed ${seed}: octave sits ${below} dB below main (source: 6-10 dB)`)
    const voices = octave.patch.unisonVoices ?? 1
    assert.ok(voices >= 3 && voices <= 5, `seed ${seed}: octave unison ${voices} voices (source: 3-5)`)
  }
  assert.ok(seen > 40, `the octave layer appeared in only ${seen} of 120 lead draws`)
})

test('parallel compression stays in the sourced 15-35% wet band with a punch-preserving attack', () => {
  for (const role of LAYERED_ROLES) {
    for (const layer of [0, 1, 2, 3, 4, 5, 6, 7].flatMap((s) => layeredArchitecture(role, s).layers)) {
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
  const arch = layeredArchitecture('chords', 3) // a draw that carries a stab layer
  const stab = arch.layers.find((l) => l.id === 'stab')!
  assert.ok(stab, 'fixture seed no longer draws a stab layer')
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
      // the DRAWN cutoff, except where `preserveFundamental` pulls it down to the layer's own
      // lowest note — a build-time fit the architecture cannot make because it has no notes.
      // Asserted through the same helper the builder uses so the two cannot drift apart.
      const bottomLp = arch.layers.find((l) => l.band.mode === 'lowpass')!.band.cutoffHz
      const expected = preservedCutoffHz(layer, layerNotes(phrase, layer.figure, anchorShift(phrase, arch.anchor)), bottomLp)
      assert.equal(track.synth.cutoff, expected, `${role}/${layer.id} cutoff`)
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

// ---- the two BUILD-TIME fits: the 2026-07-26 "barely audible pad / thin stab" gates ---------------

test('no chords layer is ever highpassed above its own lowest fundamental', () => {
  // The owner, on the three chords seeds he has now rated twice: "The stabs in the layered after and
  // production feels... just thin and not complex?" Measured, every one of those stabs was
  // highpassed ABOVE its own lowest note (660/800/640 Hz against fundamentals of 330/349/392 Hz) —
  // the bare upper harmonic series with the fundamental gone, which is the exact failure the
  // `preserveFundamental` field was declared for and which no code implemented.
  //
  // The fix is bounded on purpose (`FUNDAMENTAL_HP_FLOOR_HZ`, so the clamp can never reach into the
  // mud region and change a decision `pruneOverlappingLayers` already took), so this asserts the
  // reachable half: a layer that ASKS to preserve its fundamental is never highpassed above it
  // unless the floor is what stopped the clamp.
  const MUD_HI_HZ = 450 // mirrored from layered.ts; the floor is MUD_HI_HZ + 10
  const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12)
  let clampsFired = 0
  for (const role of LAYERED_ROLES) {
    for (let seed = 0; seed < 60; seed++) {
      const arch = layeredArchitecture(role, seed)
      const phrase = phraseFor(role, seed)
      const clip = buildLayeredClip(role, phrase, 124, { seed })
      const bottomLp = arch.layers.find((l) => l.band.mode === 'lowpass')!.band.cutoffHz
      for (const layer of arch.layers) {
        if (layer.preserveFundamental !== true) continue
        const track = clip.doc.tracks.find((t) => t.id === layer.id)!
        assert.equal(track.kind, 'synth')
        if (track.kind !== 'synth') continue
        const lowestHz = midiHz(Math.min(...track.notes.map((n) => n.pitch)))
        if (track.synth.cutoff !== layer.band.cutoffHz) clampsFired += 1
        // never RAISED — the clamp is lower-only, or it would punch the hole in the ladder that
        // checkCrossover rule 3 exists to reject
        assert.ok(track.synth.cutoff <= layer.band.cutoffHz, `${role}/${layer.id} seed ${seed}: clamp RAISED the highpass to ${track.synth.cutoff} from ${layer.band.cutoffHz}`)
        // and either it covers the fundamental, or the mud floor is why it does not
        assert.ok(
          track.synth.cutoff <= lowestHz + 1 || track.synth.cutoff <= MUD_HI_HZ + 11,
          `${role}/${layer.id} seed ${seed}: highpassed at ${track.synth.cutoff} Hz, above its own lowest fundamental of ${lowestHz.toFixed(0)} Hz, with no floor to blame`,
        )
      }
      // whatever the clamp did, the stack is still a valid crossover in the DOC, not just the draw
      for (const layer of arch.layers) {
        const track = clip.doc.tracks.find((t) => t.id === layer.id)!
        if (track.kind !== 'synth' || layer.band.mode !== 'highpass') continue
        assert.ok(track.synth.cutoff >= bottomLp / 2, `${role}/${layer.id} seed ${seed}: clamped to ${track.synth.cutoff} Hz, below half the bottom layer's ${bottomLp} Hz lowpass`)
      }
    }
  }
  // A GATE THAT CANNOT FIRE IS NOT A GATE (CLAUDE.md). The clamp existing but never engaging on 60
  // seeds of every role would mean the fix shipped inert, which is exactly how the de-harsh EQ and
  // fuseAttacks both shipped before this branch.
  assert.ok(clampsFired > 0, 'preserveFundamental never engaged on any of 180 draws — the fix is inert')
})

test('a swell layer always reaches its own level: attack is fitted to the shortest note', () => {
  // The owner, chords seed 1147: "The dark pad on the layered-after is not loud enough and is barely
  // audible." Measured per layer, that pad sat 10.93 dB under the full mix at the second-highest
  // fader in the stack — because its 240 ms attack was longer than the 97 ms notes it played, on
  // every note. `fitSwellAttack` is the fix and this is its unit gate.
  const notes = (durationSteps: number): { pitch: number; start: number; duration: number; velocity: number }[] => [
    { pitch: 60, start: 0, duration: durationSteps, velocity: 0.8 },
  ]
  // 154 BPM => one 16th step is 97.4 ms; half of that is 48.7 ms, rounded to ms
  assert.equal(fitSwellAttack({ attack: 0.24 }, notes(1), 154).attack, 0.049, 'a 240 ms swell on a 97 ms note was not fitted')
  // a long note leaves the drawn attack alone
  assert.equal(fitSwellAttack({ attack: 0.24 }, notes(16), 154).attack, 0.24, 'a swell that fits its note must not be touched')
  // TRANSIENT layers are never sped up — that belongs to fuseAttacks, and speeding one up here would
  // re-create the "'pop' 'pop' with two hits" the fusion fix removed
  assert.equal(fitSwellAttack({ attack: 0.007 }, notes(1), 154).attack, 0.007, 'a transient attack was refitted')
  // and the floor holds a fitted swell outside the 25 ms fusion window / 30 ms transient window even
  // on an absurdly short note
  assert.equal(fitSwellAttack({ attack: 0.24 }, notes(1), 300).attack, 0.04, 'the swell floor did not hold')

  // end to end: no chords pad in a long sweep is left with an attack longer than its own note
  for (let seed = 0; seed < 60; seed++) {
    const arch = layeredArchitecture('chords', seed)
    const pad = arch.layers.find((l) => l.id === 'pad')
    if (!pad) continue
    const clip = buildLayeredClip('chords', phraseFor('chords', seed), 154, { seed })
    const track = clip.doc.tracks.find((t) => t.id === 'pad')!
    assert.equal(track.kind, 'synth')
    if (track.kind !== 'synth') continue
    const shortestS = Math.min(...track.notes.map((n) => n.duration)) * (60 / 154 / 4)
    assert.ok(
      // +1 ms: the fit rounds its ceiling to whole milliseconds so the drawn number stays readable
      track.synth.attack <= Math.max(0.04, shortestS * 0.5) + 0.001,
      `chords seed ${seed}: pad attack ${track.synth.attack}s against a shortest note of ${shortestS.toFixed(3)}s`,
    )
    // and never fast enough to be heard as a second hit on the chord's onset
    assert.ok(track.synth.attack >= 0.04 - 1e-9, `chords seed ${seed}: pad attack ${track.synth.attack}s is inside the transient window`)
  }
})

test('the chords stab carries the corpus oscillator count and a bounded balance against the pad', () => {
  // docs/priors/organic-vs-mechanical.md §4e: chords are the most oscillator-dense role measured —
  // 71.4% of chord patches run THREE oscillators, the highest of the ten. dotbeat's engine gates
  // osc3 on `unisonVoices >= 3` (ui/src/audio/engine.ts:3132), so that is the only route to it.
  // §4a's 50% unison INCIDENCE governs the pad; §4e's 71.4% oscillator count governs the stab.
  let three = 0
  let stabs = 0
  for (let seed = 0; seed < 400; seed++) {
    const arch = layeredArchitecture('chords', seed)
    const stab = arch.layers.find((l) => l.id === 'stab')
    const pad = arch.layers.find((l) => l.id === 'pad')
    if (!stab) continue
    stabs += 1
    if ((stab.patch.unisonVoices ?? 1) >= 3) three += 1
    // §4b: chords median detune 12.1 cents, p90 21.6 — never a lead's 41.2
    assert.ok((stab.patch.osc2Detune ?? 0) <= 21.6, `seed ${seed}: stab detune ${stab.patch.osc2Detune} past the chords p90 of 21.6 cents`)
    // BALANCE: measured, a stab at the pad's own fader arrives 13-18 dB under it (duty cycle, not
    // band), so it is drawn 2-6 dB over the bed. A stab under the bed is the buried-accent failure.
    if (pad) {
      const over = stab.gainDb - pad.gainDb
      assert.ok(over >= 2 && over <= 6, `seed ${seed}: stab sits ${over} dB over the pad, outside the measured 2-6 dB window`)
    }
  }
  const rate = three / stabs
  assert.ok(rate > 0.6 && rate < 0.82, `${(rate * 100).toFixed(1)}% of stabs run three oscillators — §4e measures 71.4% for chords`)
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

/** A full LayeredFeatures record with every value parked in the middle of the bassline reference
 * class, so a test can move ONE axis and nothing else. Built directly rather than through
 * `layeredFeatures` because the verification tests are about the RANGES, not the extraction. */
const featuresFrom = (over: Partial<LayeredFeatures>): LayeredFeatures => ({
  bandSubPct: 50,
  bandBassPct: 19,
  bandMidsPct: 0.2,
  bandPresencePct: 0,
  bandAirPct: 0,
  centroidHz: 76,
  stereoWidthDb: -56,
  stereoCorrelation: 1,
  crestDb: 8,
  truePeakDb: -1,
  crestSubDb: 8,
  crestBassDb: 11,
  crestMidsDb: 19,
  levelSubDb: -3,
  levelBassDb: -6,
  levelMidsDb: -23,
  levelPresenceDb: -58,
  modDepthDb: 9,
  articulationDb: 20,
  characterLevelDb: 0.4,
  ...over,
})

test('layeredFeatures merges the metrics vector and the articulation family from one render', () => {
  // a real buffer: a 55 Hz sine gated into eighth notes, i.e. a crude bassline with note boundaries
  const sr = 48000
  const n = sr * 2
  const left = new Float64Array(n)
  const right = new Float64Array(n)
  const gateSamples = Math.round(sr * 0.25)
  for (let i = 0; i < n; i++) {
    const inNote = i % gateSamples < gateSamples * 0.6
    const v = inNote ? 0.5 * Math.sin((2 * Math.PI * 55 * i) / sr) : 0
    left[i] = v
    right[i] = v
  }
  const m = analyze([left, right], sr)
  const f = layeredFeatures(m, [left, right], sr)
  // the metrics half
  assert.ok(Math.abs(f.centroidHz - m.spectral.centroidHz) < 0.01, `centroid ${f.centroidHz}`)
  assert.equal(f.bandSubPct, m.spectral.bandsPct.sub)
  // the articulation half — a gated tone swings, and it is nearly all sub, so character is far down
  assert.ok(f.articulationDb > 20, `a gated tone must show real articulation, got ${f.articulationDb}`)
  // sub-dominated, but not by as much as a naive reading suggests: a HARD gate on a sine is itself
  // a broadband transient, so the character bands carry the click energy. That is honest — a real
  // render's transients live there too.
  assert.ok(f.characterLevelDb < 0, `a gated 55 Hz sine must still be sub-dominated, got ${f.characterLevelDb}`)
  assert.ok(Number.isFinite(f.crestSubDb) && Number.isFinite(f.modDepthDb) && Number.isFinite(f.levelMidsDb))
})

test('verifyLayeredTargets passes a clip sitting on the reference medians', () => {
  const v = verifyLayeredTargets('bassline', featuresFrom({}))
  assert.equal(v.ok, true, formatTargetVerification(v, 'bassline'))
  assert.equal(v.passed, v.total)
  assert.equal(v.total, Object.keys(LAYERED_TARGETS.bassline).length)
  // and every result reports its distance from the reference median, not just pass/fail
  for (const r of v.results) assert.ok(Number.isFinite(r.fromMedian), `${r.feature} has no distance-from-median`)
})

test('EVERY derived target is two-sided and fails BOTH directions — the 2026-07-26 overshoot gate', () => {
  // The complaint this test exists for: a floor-only `bandSubPct >= 30` could not fail the layered
  // bassline's 96.1% sub share (reference median 50.1%) or a floor-less companion gate the 38.5 Hz
  // centroid (reference median 76.2, p10 44.1). Both scored PASS while the owner heard them as
  // worse than the unlayered arm. Every derived range must therefore reject overshoot.
  for (const role of LAYERED_ROLES) {
    for (const [key, t] of Object.entries(LAYERED_TARGETS[role]) as [keyof LayeredFeatures, { min?: number; max?: number; median?: number }][]) {
      if (t.min !== undefined) {
        const under = verifyLayeredTargets(role, featuresFrom({ ...roleCentre(role), [key]: t.min - Math.abs(t.min) * 0.5 - 1 }))
        assert.equal(under.results.find((r) => r.feature === key)!.pass, false, `${role}.${key} does not reject undershoot`)
      }
      if (t.max !== undefined) {
        const over = verifyLayeredTargets(role, featuresFrom({ ...roleCentre(role), [key]: t.max + Math.abs(t.max) * 0.5 + 1 }))
        assert.equal(over.results.find((r) => r.feature === key)!.pass, false, `${role}.${key} does not reject overshoot`)
      }
      // the two hand-set overrides are one-sided on purpose and say so in their provenance
      if (t.min === undefined || t.max === undefined) {
        assert.match(LAYERED_TARGETS[role][key]!.source, /ceiling|floor/, `${role}.${key} is one-sided with no stated reason`)
      }
    }
  }
})

/** Every gated feature parked at its own role's reference median — so a single-axis test of one
 * feature is not silently failing on a different one. */
const roleCentre = (role: (typeof LAYERED_ROLES)[number]): Partial<LayeredFeatures> => {
  const out: Partial<LayeredFeatures> = {}
  for (const [key, t] of Object.entries(LAYERED_TARGETS[role])) {
    if (t.median !== undefined) out[key as keyof LayeredFeatures] = t.median
  }
  return out
}

test('the measured layered-bass overshoot of 2026-07-26 now FAILS the gate', () => {
  // the exact numbers measured on taste-dataset/layered-check/bassline-41/layered.wav, the file the
  // owner listened to and rejected while it was scoring 4/4
  const v = verifyLayeredTargets('bassline', featuresFrom({
    bandSubPct: 96.1, centroidHz: 38.52, stereoWidthDb: -56.02, stereoCorrelation: 1,
    crestSubDb: 6.68, articulationDb: 8.74, characterLevelDb: -13.04,
  }))
  assert.equal(v.ok, false, 'the clip the owner rejected must not pass')
  const failed = v.results.filter((r) => !r.pass).map((r) => r.feature).sort()
  for (const expected of ['articulationDb', 'bandSubPct', 'centroidHz', 'characterLevelDb']) {
    assert.ok(failed.includes(expected as keyof LayeredFeatures), `${expected} must fail: ${formatTargetVerification(v, 'layered bass 41')}`)
  }
  // and the engineplus bass the owner PREFERRED must fail for the opposite reasons — the honest
  // picture is that neither arm was right, not that the old one was
  const ep = verifyLayeredTargets('bassline', featuresFrom({
    bandSubPct: 0.26, centroidHz: 140.58, stereoWidthDb: -11.2, stereoCorrelation: 0.86,
    crestSubDb: 19.41, articulationDb: 8.93, characterLevelDb: 19.62,
  }))
  assert.equal(ep.ok, false)
  const epFailed = ep.results.filter((r) => !r.pass).map((r) => r.feature)
  assert.ok(epFailed.includes('characterLevelDb'), 'engineplus bass has no sub at all and must fail for it')
  assert.ok(epFailed.includes('stereoWidthDb'), 'engineplus bass is measurably too wide')
})

test('every target is derived from the measured reference distribution it cites', () => {
  for (const role of LAYERED_ROLES) {
    for (const [key, t] of Object.entries(LAYERED_TARGETS[role])) {
      assert.ok(t.source.length > 10, `${role}.${key} has no provenance`)
      assert.ok(t.min !== undefined || t.max !== undefined, `${role}.${key} has no bound`)
      if (t.min !== undefined && t.max !== undefined) assert.ok(t.min < t.max, `${role}.${key} has an inverted range`)
      const q = REF_POOL_QUANTILES[role][key as keyof LayeredFeatures]
      assert.ok(q, `${role}.${key} is gated with no measured reference quantiles`)
      // the median must actually sit inside the band that claims to be centred on it
      if (t.median !== undefined) {
        if (t.min !== undefined) assert.ok(t.median >= t.min, `${role}.${key}: median below its own floor`)
        if (t.max !== undefined) assert.ok(t.median <= t.max, `${role}.${key}: median above its own ceiling`)
      }
      // and a derived (non-override) range IS the pool's interquartile range
      if (!/ceiling|floor/.test(t.source)) {
        assert.equal(t.min, q!.p25, `${role}.${key} floor drifted from the pool p25`)
        assert.equal(t.max, q!.p75, `${role}.${key} ceiling drifted from the pool p75`)
        assert.equal(t.median, q!.p50, `${role}.${key} median drifted from the pool median`)
      }
    }
    // every quantile row is monotone, or a paste error has silently inverted a gate
    for (const [key, q] of Object.entries(REF_POOL_QUANTILES[role])) {
      assert.ok(q.p10 <= q.p25 && q.p25 <= q.p50 && q.p50 <= q.p75 && q.p75 <= q.p90, `${role}.${key} quantiles are not monotone`)
    }
  }
  // the gate must ADMIT what it cannot see rather than silently omitting it
  assert.ok(UNMEASURABLE_TARGETS.length >= 4)
  const named = UNMEASURABLE_TARGETS.map((u) => u.name)
  for (const expected of ['attackMedMs', 'fluxMean', 'onsetRatePerSec', 'flatnessHiDb']) {
    assert.ok(named.includes(expected), `${expected} must be reported as unmeasurable, not dropped`)
  }
  // ...and it must admit it for the RIGHT reason. Until 2026-07-26 all four rows claimed these
  // features were UNCOMPUTABLE ("onset detection exists nowhere in the codebase", "spectral flux
  // needs an STFT"). analyzeRich computes every one of them and has since a parallel stream landed,
  // so the comment was inviting the next reader to re-derive a wrong conclusion from prose instead
  // of from the code. What is actually missing is calibration against the reference pool.
  const rich = analyzeRich([new Float64Array(4096).fill(0.1), new Float64Array(4096).fill(0.1)], 48000)
  for (const u of UNMEASURABLE_TARGETS) {
    assert.ok(u.name in rich, `${u.name} is listed as unmeasurable but analyzeRich does not compute it — one of the two is wrong`)
    assert.doesNotMatch(u.why, /exists nowhere|not in MixMetrics|needs an STFT;/, `${u.name}'s reason claims the feature cannot be computed, but analyzeRich computes it`)
  }
  const printed = formatTargetVerification(verifyLayeredTargets('chords', featuresFrom(roleCentre('chords'))), 'x')
  for (const n of named) assert.match(printed, new RegExp(n))
  // the printed table carries the median distance, which is the readout the overshoot needed
  assert.match(printed, /vs med/)
})

// ---- architecture diversity — the 2026-07-26 "everything sounds the same-ish" gate ----------------

test('a simulated round does not repeat layered architectures', () => {
  // The owner's report, verbatim: "One thing I noticed with all the layering... is it makes
  // everything sort of sound the same-ish." Before the sweep this number was 1 distinct
  // architecture per role for the entire program — every layered clip ever rendered was the same
  // three voices at the same three cutoffs at the same three levels. Modelled on
  // test/theory.test.ts's "a simulated round does not repeat onset skeletons" guard, which fixed
  // the identical failure one level down at the note layer.
  const OFFSETS = [0, 101, 202, 977]
  for (const role of LAYERED_ROLES) {
    const fingerprints: string[] = []
    const shapes: string[] = []
    const families = new Set<string>()
    const layerCounts = new Set<number>()
    for (const base of [7000, 21, 130501]) {
      const rng = mulberry32(base)
      for (let batch = 0; batch < 6; batch++) {
        const batchSeed = Math.floor(rng() * 100000)
        for (const off of OFFSETS) {
          const arch = layeredArchitecture(role, batchSeed + off)
          fingerprints.push(architectureFingerprint(arch))
          shapes.push(architectureShape(arch))
          families.add(arch.draw.family)
          layerCounts.add(arch.layers.length)
        }
      }
    }
    // 1. no two clips in a 15-draw window are the same instrument. Gate 3.0 copied from the theory
    //    guard's shape; the pre-fix value here was 14.0 (every draw identical).
    let repeats = 0
    let windows = 0
    for (let i = 0; i + 15 <= fingerprints.length; i++) {
      repeats += 15 - new Set(fingerprints.slice(i, i + 15)).size
      windows += 1
    }
    const perWindow = repeats / Math.max(1, windows)
    assert.ok(perWindow < 3, `${role}: ${perWindow.toFixed(2)} identical-architecture repeats per 15 draws (was 14.0 before the sweep, gate 3.0)`)

    // 2. the COARSE identity varies too — a round that varies only cutoffs still sounds the same-ish
    let shapeRepeats = 0
    for (let i = 0; i + 15 <= shapes.length; i++) shapeRepeats += 15 - new Set(shapes.slice(i, i + 15)).size
    const shapesPerWindow = shapeRepeats / Math.max(1, windows)
    assert.ok(shapesPerWindow < 11, `${role}: ${shapesPerWindow.toFixed(2)} identical layer-SET repeats per 15 draws (was 14.0, gate 11.0)`)

    // 3. all three legitimate layer counts occur, and at least four families do
    assert.ok(layerCounts.has(2) && layerCounts.has(3) && layerCounts.has(4), `${role}: layer counts drawn were ${[...layerCounts].sort().join(',')} — 2, 3 and 4 are all legitimate`)
    assert.ok(families.size >= 4, `${role}: only ${families.size} distinct layer families in a whole round`)
  }
})

test('an architecture draw is deterministic in its seed and decorrelated from the figure draw', () => {
  for (const role of LAYERED_ROLES) {
    for (const seed of [0, 1, 41, 1050, 99991]) {
      assert.equal(
        architectureFingerprint(layeredArchitecture(role, seed)),
        architectureFingerprint(layeredArchitecture(role, seed)),
        `${role} seed ${seed} is not deterministic`,
      )
    }
    // adjacent seeds must not collide — a batch walks consecutive seeds
    const adjacent = [0, 1, 2, 3, 4, 5, 6, 7].map((s) => architectureFingerprint(layeredArchitecture(role, s)))
    assert.equal(new Set(adjacent).size, adjacent.length, `${role}: consecutive seeds collide`)
  }
})

test('buildLayeredClip honours the architecture seed end to end', () => {
  for (const role of LAYERED_ROLES) {
    const phrase = phraseFor(role, 77)
    const a = buildLayeredClip(role, phrase, 128, { seed: 5 })
    const b = buildLayeredClip(role, phrase, 128, { seed: 5 })
    const c = buildLayeredClip(role, phrase, 128, { seed: 6 })
    assert.equal(serialize(a.doc), serialize(b.doc), `${role}: the same seed must rebuild byte-identically`)
    assert.notEqual(serialize(a.doc), serialize(c.doc), `${role}: a different seed must build a different stack`)
    assert.equal(a.arch.draw.family.length > 0, true)
    // a pre-drawn architecture short-circuits the draw
    const reused = buildLayeredClip(role, phrase, 128, { arch: a.arch })
    assert.equal(serialize(reused.doc), serialize(a.doc))
  }
})

test('unknown roles are refused loudly (drum-loop is deliberately out of scope)', () => {
  assert.equal(isLayeredRole('drum-loop'), false)
  assert.throws(() => layeredArchitecture('drum-loop'), /no layered architecture/)
  assert.throws(() => verifyLayeredTargets('drum-loop', featuresFrom({})), /no layered targets/)
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

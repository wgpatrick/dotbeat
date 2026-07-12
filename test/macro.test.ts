// Macro tests — docs/research/27-macro-tooling-layer.md, Phase 26 Stream DD. Mirrors
// test/preset.test.ts's discipline: a macro must be indistinguishable, once applied, from a
// hand-typed series of `beat set` edits (no in-file indirection, no macro reference left behind),
// and the factory library must stay valid against the live AUTOMATABLE_SYNTH_PARAMS whitelist.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  parse,
  serialize,
  parseMacroLibrary,
  resolveMacro,
  applyMacro,
  formatMacroList,
  inverseResolveTarget,
  diffDocuments,
  initDocument,
  addTrack,
  BeatMacroError,
  MACRO_CATEGORIES,
  AUTOMATABLE_SYNTH_PARAMS,
  type MacroTarget,
} from '../src/core/index.js'

const macrosJson = readFileSync(fileURLToPath(new URL('../presets/macros.json', import.meta.url)), 'utf8')

function projectWithDrums() {
  const base = initDocument({ trackId: 'lead' })
  return addTrack(base, { id: 'drums', kind: 'drums' }).doc
}

test('the factory macro library parses and validates against the live field table', () => {
  const macros = parseMacroLibrary(macrosJson)
  assert.equal(macros.length, 8)
  const names = macros.map((m) => m.name)
  for (const expected of ['filter-sweep', 'grit', 'space', 'warmth', 'motion', 'width', 'punch', 'snap']) {
    assert.ok(names.includes(expected), `factory macro library must include "${expected}"`)
  }
})

test('every macro target is a member of AUTOMATABLE_SYNTH_PARAMS', () => {
  for (const macro of parseMacroLibrary(macrosJson)) {
    for (const t of macro.targets) {
      assert.ok((AUTOMATABLE_SYNTH_PARAMS as readonly string[]).includes(t.param), `${macro.name}: "${t.param}" is not an automatable param`)
    }
  }
})

test('every macro has a valid category drawn from MACRO_CATEGORIES', () => {
  for (const macro of parseMacroLibrary(macrosJson)) {
    assert.ok((MACRO_CATEGORIES as readonly string[]).includes(macro.category), `"${macro.name}" has invalid category "${macro.category}"`)
  }
})

test('resolveMacro is pure: knob 0 -> every target at its min, knob 100 -> every target at its max (linear)', () => {
  const macro = parseMacroLibrary(macrosJson).find((m) => m.name === 'space')!
  assert.deepEqual(resolveMacro(macro, 0), [
    { param: 'sendReverb', value: 0 },
    { param: 'sendDelay', value: 0 },
  ])
  assert.deepEqual(resolveMacro(macro, 100), [
    { param: 'sendReverb', value: 0.7 },
    { param: 'sendDelay', value: 0.5 },
  ])
  // linear midpoint
  const mid = resolveMacro(macro, 50)
  assert.ok(Math.abs(mid[0]!.value - 0.35) < 1e-9)
  assert.ok(Math.abs(mid[1]!.value - 0.25) < 1e-9)
})

test('resolveMacro handles an inverted range (min > max) — punch\'s kickDecay gets SHORTER as the knob rises', () => {
  const macro = parseMacroLibrary(macrosJson).find((m) => m.name === 'punch')!
  const decayTarget = macro.targets.find((t) => t.param === 'kickDecay')!
  assert.ok(decayTarget.min > decayTarget.max)
  const at0 = resolveMacro(macro, 0).find((r) => r.param === 'kickDecay')!.value
  const at100 = resolveMacro(macro, 100).find((r) => r.param === 'kickDecay')!.value
  assert.equal(at0, decayTarget.min)
  assert.equal(at100, decayTarget.max)
  assert.ok(at100 < at0)
})

test('resolveMacro applies exp/log curve shaping, not just linear', () => {
  const macro = parseMacroLibrary(macrosJson).find((m) => m.name === 'filter-sweep')!
  const cutoffTarget = macro.targets.find((t) => t.param === 'cutoff')!
  assert.equal(cutoffTarget.curve, 'exp')
  const at50 = resolveMacro(macro, 50).find((r) => r.param === 'cutoff')!.value
  const linearMid = cutoffTarget.min + 0.5 * (cutoffTarget.max - cutoffTarget.min)
  // exp curve (n*n) at knob=50 (n=0.5, shaped=0.25) sits well below the LINEAR midpoint.
  assert.ok(at50 < linearMid, `exp-curved midpoint (${at50}) should sit below the linear midpoint (${linearMid})`)
})

test('applying a macro is exactly a bag of synth-param edits — nothing else changes, and no macro reference is left in the document', () => {
  const doc = projectWithDrums()
  const macro = parseMacroLibrary(macrosJson).find((m) => m.name === 'filter-sweep')!
  const next = applyMacro(doc, 'lead', macro, 70)
  const entries = diffDocuments(doc, next)
  assert.ok(entries.length > 0)
  for (const e of entries) {
    assert.equal(e.kind, 'synth-param')
    assert.equal((e as { trackId: string }).trackId, 'lead')
  }
  // the resolved values landed literally
  for (const { param, value } of resolveMacro(macro, 70)) {
    assert.equal(next.tracks.find((t) => t.id === 'lead')!.synth[param as keyof (typeof next.tracks)[0]['synth']], value)
  }
  // and the serialized text contains no trace of the macro's own name/identity — only real params
  const text = serialize(next)
  assert.ok(!text.includes(macro.name), 'serialized document must not reference the macro by name')
  // round-trips cleanly
  assert.equal(serialize(parse(text)), text)
})

test('every factory macro applies cleanly to a fresh track of its kind', () => {
  for (const macro of parseMacroLibrary(macrosJson)) {
    const doc = projectWithDrums()
    const target = macro.kind === 'drums' ? 'drums' : 'lead'
    const next = applyMacro(doc, target, macro, 60)
    for (const { param, value } of resolveMacro(macro, 60)) {
      assert.equal(next.tracks.find((t) => t.id === target)!.synth[param as keyof (typeof next.tracks)[0]['synth']], value, `${macro.name}: ${param}`)
    }
  }
})

test('a "space" (kind any) macro applies to both a synth and a drums track', () => {
  const doc = projectWithDrums()
  const macro = parseMacroLibrary(macrosJson).find((m) => m.name === 'space')!
  assert.doesNotThrow(() => applyMacro(doc, 'lead', macro, 40))
  assert.doesNotThrow(() => applyMacro(doc, 'drums', macro, 40))
})

test('a drums macro refuses to apply to a synth track (and vice versa)', () => {
  const doc = projectWithDrums()
  const macros = parseMacroLibrary(macrosJson)
  const punch = macros.find((m) => m.name === 'punch')!
  const sweep = macros.find((m) => m.name === 'filter-sweep')!
  assert.throws(() => applyMacro(doc, 'lead', punch, 50), BeatMacroError)
  assert.throws(() => applyMacro(doc, 'drums', sweep, 50), BeatMacroError)
})

test('applying to a nonexistent track fails loudly', () => {
  const macro = parseMacroLibrary(macrosJson)[0]!
  assert.throws(() => applyMacro(projectWithDrums(), 'ghost', macro, 50), BeatMacroError)
})

test('a library with a non-automatable target param is rejected at load time', () => {
  const bad = JSON.stringify({
    version: 1,
    macros: [{ name: 'x', kind: 'synth', category: 'tone', description: 'd', targets: [{ param: 'osc', min: 0, max: 1 }] }],
  })
  assert.throws(() => parseMacroLibrary(bad), /must be one of AUTOMATABLE_SYNTH_PARAMS/)
})

test('a library with an unknown param entirely is rejected at load time', () => {
  const bad = JSON.stringify({
    version: 1,
    macros: [{ name: 'x', kind: 'synth', category: 'tone', description: 'd', targets: [{ param: 'warpDrive', min: 0, max: 1 }] }],
  })
  assert.throws(() => parseMacroLibrary(bad), /must be one of AUTOMATABLE_SYNTH_PARAMS/)
})

test('a macro with zero targets is rejected at load time', () => {
  const bad = JSON.stringify({ version: 1, macros: [{ name: 'x', kind: 'synth', category: 'tone', description: 'd', targets: [] }] })
  assert.throws(() => parseMacroLibrary(bad), /non-empty array/)
})

test('a macro with an invalid category is rejected at load time', () => {
  const bad = JSON.stringify({
    version: 1,
    macros: [{ name: 'x', kind: 'synth', category: 'bass', description: 'd', targets: [{ param: 'cutoff', min: 0, max: 1 }] }],
  })
  assert.throws(() => parseMacroLibrary(bad), /category must be one of/)
})

test('duplicate macro names are rejected', () => {
  const one = { name: 'x', kind: 'synth', category: 'tone', description: 'd', targets: [{ param: 'cutoff', min: 0, max: 1 }] }
  const bad = JSON.stringify({ version: 1, macros: [one, one] })
  assert.throws(() => parseMacroLibrary(bad), /duplicate macro name/)
})

test('a target param listed twice in one macro is rejected', () => {
  const bad = JSON.stringify({
    version: 1,
    macros: [
      {
        name: 'x',
        kind: 'synth',
        category: 'tone',
        description: 'd',
        targets: [
          { param: 'cutoff', min: 0, max: 1 },
          { param: 'cutoff', min: 0, max: 1 },
        ],
      },
    ],
  })
  assert.throws(() => parseMacroLibrary(bad), /listed more than once/)
})

test('formatMacroList prints one line per macro', () => {
  const macros = parseMacroLibrary(macrosJson)
  const text = formatMacroList(macros)
  const lines = text.trim().split('\n')
  assert.equal(lines.length, macros.length)
  assert.ok(lines[0]!.includes(macros[0]!.name))
})

test('formatMacroList on an empty library', () => {
  assert.equal(formatMacroList([]), 'no macros\n')
})

test('inverseResolveTarget round-trips resolveMacro for linear, exp, and log curves', () => {
  const linear: MacroTarget = { param: 'sendReverb', min: 0, max: 0.7 }
  const exp: MacroTarget = { param: 'cutoff', min: 80, max: 18000, curve: 'exp' }
  const log: MacroTarget = { param: 'resonance', min: 0.1, max: 5, curve: 'log' }
  for (const t of [linear, exp, log]) {
    for (const knob of [0, 25, 50, 75, 100]) {
      const macro = { name: 'x', kind: 'any' as const, category: 'tone' as const, description: '', targets: [t] }
      const { value } = resolveMacro(macro, knob)[0]!
      const estimate = inverseResolveTarget(t, value)
      assert.ok(Math.abs(estimate - knob) <= 1, `${t.param}/${t.curve ?? 'linear'}: knob ${knob} -> value ${value} -> estimate ${estimate}`)
    }
  }
})

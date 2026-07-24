// Produced-track TEMPLATES (Track 1b — owner-approved plan). The authoring face of the
// produced-defaults layer: `beat add-track --produced` composes a new track that ships with its
// role's width/air/glue/space profile, and `beat produce` retrofits an existing one. Both resolve
// the role + profile through the SAME produce.ts primitives gen-kit/taste-seeds use (zero duplicated
// production values). This file covers the shared resolver (src/analysis/produce.ts:
// resolveProducedProfile / kickSourceTrack) as units, plus the two CLI commands end-to-end
// (created-track carries the profile, retrofit intensify-only, role inference, receipt honesty,
// dry-run purity, kind refusals).

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { initDocument, addTrack, defaultDrumKitLanes } from '../src/core/index.js'
import { resolveProducedProfile, kickSourceTrack, PRODUCED_DUCK_AMOUNT, productionProfileFor } from '../src/analysis/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const beatCli = join(repoRoot, 'cli', 'beat.mjs')

function beat(args: string[], opts: { expectExit?: number } = {}): string {
  try {
    return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8' })
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    if (opts.expectExit !== undefined && e.status === opts.expectExit) return (e.stdout ?? '') + (e.stderr ?? '')
    throw new Error(`beat ${args.join(' ')} exited ${e.status}:\n${e.stderr ?? ''}${e.stdout ?? ''}`)
  }
}

function freshProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'beat-produce-test-'))
  const file = join(dir, 'song.beat')
  beat(['init', file, '--bars', '1']) // one starter synth track "lead"
  return file
}

// ---- the shared resolver (produce.ts) --------------------------------------------------------

test('resolveProducedProfile infers the role from the track id and honors an override', () => {
  const doc = addTrack(initDocument({ trackId: 'lead' }), { id: 'bass', kind: 'synth', name: 'bass' }).doc
  // id-inferred
  assert.equal(resolveProducedProfile(doc, 'lead').role, 'lead')
  assert.equal(resolveProducedProfile(doc, 'bass').role, 'bass')
  // override maps through the same synonym table: keys -> chords, drums -> kit
  assert.equal(resolveProducedProfile(doc, 'lead', 'keys').role, 'chords')
  assert.equal(resolveProducedProfile(doc, 'lead', 'pad').role, 'pad')
})

test('an un-inferrable drums track falls back to the kit-bus profile, not the mild default', () => {
  // id "perc909" maps to `default`, but on a drums track the bus carries the kick -> kit profile
  const doc = addTrack(initDocument({ trackId: 'lead' }), { id: 'perc909', kind: 'drums', name: 'perc909', lanes: defaultDrumKitLanes() }).doc
  assert.equal(resolveProducedProfile(doc, 'perc909').role, 'kit')
  // a synth track with the same un-inferrable id stays the mild all-round default
  const synthDoc = addTrack(initDocument({ trackId: 'lead' }), { id: 'wobblegizmo', kind: 'synth', name: 'wobblegizmo' }).doc
  assert.equal(resolveProducedProfile(synthDoc, 'wobblegizmo').role, 'default')
})

test('kickSourceTrack finds a kick-carrying drums track (and skips the excluded/self track)', () => {
  let doc = initDocument({ trackId: 'bass' })
  assert.equal(kickSourceTrack(doc), null, 'no drums track yet')
  doc = addTrack(doc, { id: 'kit', kind: 'drums', name: 'kit', lanes: defaultDrumKitLanes() }).doc
  assert.equal(kickSourceTrack(doc), 'kit', 'the 12-lane kit carries a kick lane')
  assert.equal(kickSourceTrack(doc, 'kit'), null, 'excluding it (a drums track produced against itself) finds nothing')
  // a legacy/empty-lanes drums track implicitly carries the 5 DRUM_LANES (which include kick)
  const legacy = addTrack(initDocument({ trackId: 'bass' }), { id: 'dr', kind: 'drums', name: 'dr' }).doc
  assert.equal(kickSourceTrack(legacy), 'dr')
})

test('a bass/sub profile is augmented with a duck only when a kick source exists', () => {
  const noKit = initDocument({ trackId: 'bass' })
  assert.equal(resolveProducedProfile(noKit, 'bass').profile.duck, undefined, 'no kit -> no duck (never points at a phantom source)')
  const withKit = addTrack(noKit, { id: 'kit', kind: 'drums', name: 'kit', lanes: defaultDrumKitLanes() }).doc
  const p = resolveProducedProfile(withKit, 'bass').profile
  assert.deepEqual(p.duck, { source: 'kit', amount: PRODUCED_DUCK_AMOUNT })
  // and a lead profile is never given a duck, kit present or not
  assert.equal(resolveProducedProfile(withKit, 'lead').profile.duck, undefined)
  // the augmentation only adds the duck — every other value still comes from productionProfileFor
  const base = productionProfileFor('bass')
  assert.equal(p.saturator!.drive, base.saturator!.drive, 'width/glue values are the profile\'s own, unchanged')
})

// ---- CLI: add-track --produced ---------------------------------------------------------------

test('add-track --produced carries the role profile onto the created track (lead width stack)', () => {
  const file = freshProject()
  const out = beat(['add-track', file, 'melody', 'synth', '--produced']) // "melody" infers the lead role
  assert.match(out, /produced melody \(role: lead\):/)
  assert.match(out, /unison/)
  const text = readFileSync(file, 'utf8')
  // the width stack is really on disk, not just in the receipt
  assert.match(text, /^ {4}unisonVoices 5$/m)
  assert.match(text, /^ {4}osc2Level 0\.3$/m)
})

test('add-track --produced --role maps a user alias onto the profile (keys -> chords)', () => {
  const file = freshProject()
  const out = beat(['add-track', file, 'kb', 'synth', '--produced', '--role', 'keys'])
  assert.match(out, /produced kb \(role: chords\):/)
  assert.match(out, /noise wash/) // the chords/pad profile carries a noise wash; lead does not
})

test('add-track --produced on a drums id resolves the kit bus (air + glue, no width)', () => {
  const file = freshProject()
  const out = beat(['add-track', file, 'drums', 'drums', '--produced'])
  assert.match(out, /produced drums \(role: kit\):/)
  assert.match(out, /eqHigh/)
  assert.doesNotMatch(out, /unison|utility width/) // the bus carries the kick — no width
})

test('add-track --role without --produced is a clear error, not a silent ignore', () => {
  const file = freshProject()
  const out = beat(['add-track', file, 'x', 'synth', '--role', 'lead'], { expectExit: 2 })
  assert.match(out, /--role only applies with --produced/)
})

test('add-track --produced refuses a non-voiced kind (audio has no synth patch)', () => {
  const file = freshProject()
  const out = beat(['add-track', file, 'aud', 'audio', '--produced'], { expectExit: 2 })
  assert.match(out, /--produced covers synth\/drums tracks/)
})

// ---- CLI: beat produce (retrofit) ------------------------------------------------------------

test('beat produce retrofits an existing dry track with its role profile', () => {
  const file = freshProject() // starter "lead" is dry
  const out = beat(['produce', file, 'lead'])
  assert.match(out, /produced lead \(role: lead\):/)
  assert.match(readFileSync(file, 'utf8'), /^ {4}unisonVoices 5$/m)
})

test('beat produce is intensify-only: re-running is a no-op, never weakens the patch', () => {
  const file = freshProject()
  beat(['produce', file, 'lead']) // first pass produces it
  const afterFirst = readFileSync(file, 'utf8')
  const out = beat(['produce', file, 'lead']) // second pass
  assert.match(out, /nothing to intensify/)
  assert.equal(readFileSync(file, 'utf8'), afterFirst, 'the document is byte-identical after the no-op')
})

test('beat produce does not weaken a patch already richer than the profile', () => {
  const file = freshProject()
  beat(['set', file, 'lead.eqHigh', '9', 'lead.sendReverb', '0.8']) // hand-set richer than the lead profile
  const out = beat(['produce', file, 'lead'])
  // the richer fields are preserved and NOT named in the receipt (honest about no-ops)
  assert.doesNotMatch(out, /eqHigh|sendReverb/)
  const text = readFileSync(file, 'utf8')
  assert.match(text, /^ {4}eqHigh 9$/m)
  assert.match(text, /^ {4}sendReverb 0\.8$/m)
})

test('beat produce --dry-run previews the diff and writes nothing', () => {
  const file = freshProject()
  const before = readFileSync(file, 'utf8')
  const out = beat(['produce', file, 'lead', '--dry-run'])
  assert.match(out, /dry-run — produce "lead" \(role: lead\) would apply:/)
  assert.match(out, /unisonVoices/)
  assert.equal(readFileSync(file, 'utf8'), before, 'the file on disk is untouched by --dry-run')
})

test('beat produce wires the bass sidechain duck when a kick-carrying kit exists', () => {
  const file = freshProject()
  beat(['add-track', file, 'bass', 'synth'])
  beat(['add-track', file, 'kit', 'drums']) // 12-lane kit, carries a kick lane
  const out = beat(['produce', file, 'bass'])
  assert.match(out, /duck source kit/)
  assert.match(readFileSync(file, 'utf8'), /^ {4}duckSource kit$/m)
})

test('beat produce refuses on a missing track and on a non-voiced kind', () => {
  const file = freshProject()
  assert.match(beat(['produce', file, 'ghost'], { expectExit: 2 }), /no track "ghost"/)
  beat(['add-track', file, 'aud', 'audio'])
  assert.match(beat(['produce', file, 'aud'], { expectExit: 2 }), /produce covers synth\/drums tracks/)
})

// Regenerates docs/recipes-reference.md from presets/recipes.json — the same
// library-is-the-source-of-truth discipline scripts/gen-tricks-reference.mjs applies to tricks
// (research 118 §3.1 option C, restated for recipes by research 139 §6.3: "docs/recipes-reference.md
// regenerates, never hand-edited").
//
// Run after editing presets/recipes.json (needs a build so the compiled loader is current):
//   npm run build && node scripts/gen-recipes-reference.mjs
//
// NEVER hand-edit docs/recipes-reference.md — edit presets/recipes.json and re-run this.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseRecipeLibrary, isPatchSource, isPendingGateKey } from '../dist/src/recipes/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const recipes = parseRecipeLibrary(readFileSync(join(root, 'presets', 'recipes.json'), 'utf8'))

// The last real verification run, if one has been recorded (scripts/gen-recipe-receipts.mjs). Optional
// by design: the reference doc is readable before anything has been rendered, and gains the
// measured column once it has.
const receiptPath = join(root, 'presets', 'recipe-verify-receipts.json')
const receipts = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : null
const receiptFor = (name) => receipts?.entries?.find((e) => e.recipe === name) ?? null

const ROLE_TITLE = {
  bassline: 'Bassline — register and low-end steadiness (research 131 §7 P1, the largest single per-role gap)',
  chords: 'Chords — punch, pace and body (research 131 §7 P2/P3; ref chords fire 4.9 onsets/s against engineplus 2.3)',
  lead: 'Lead — texture and role-true width (research 131 §7 P4/P5; elite refs are wide and noisy in presence)',
  'drum-loop': 'Drum loop — density and steadiness (research 131 §7 P6; winners are fuller, not spikier)',
}
const ROLE_ORDER = ['bassline', 'chords', 'lead', 'drum-loop']

const CONFIDENCE_LABEL = {
  'measured-refs': 'measured — owned refs',
  'measured-patches': 'measured — patch files',
  consensus: 'consensus (3+ sources)',
  corroborated: 'corroborated (2 sources)',
  'single-source': 'single source — a hypothesis',
}

const esc = (s) => String(s).replace(/\|/g, '\\|')
const band = ([lo, hi]) => `${lo}..${hi}`

function describePatch(layer) {
  if (isPatchSource(layer.patch)) {
    const targets = layer.patch.retarget ? Object.entries(layer.patch.retarget).map(([k, b]) => `${k} ${band(b)}`).join(', ') : '—'
    return `\`from ${layer.patch.from}\`, retargeted to ${targets}`
  }
  return Object.entries(layer.patch)
    .map(([k, v]) => `\`${k}\`=${v}`)
    .join(', ')
}

function describeStep(step) {
  if ('trackAdd' in step) return `\`track-add ${step.trackAdd}\` (${step.kind}, ${step.hits}, ${step.volume} dB)`
  if ('effectAdd' in step) return `\`effect-add ${step.effectAdd} ${step.type}\``
  return `\`set ${step.set} ${step.value}\``
}

function describeFeel(feel) {
  const out = []
  if (feel.swingPct !== undefined) out.push(`swing **${feel.swingPct}%**${feel.swingGrid !== undefined ? ` (grid ${feel.swingGrid})` : ''}`)
  if (feel.velocityTiers) out.push(`velocity tiers ${feel.velocityTiers.join(' / ')} by metrical position`)
  if (feel.gate !== undefined) out.push(`gate ×${feel.gate}`)
  if (feel.glideSeconds !== undefined) out.push(`glide ${feel.glideSeconds}s`)
  if (feel.restBeatOneSixteenth) out.push('**rest on every beat-1 16th** (kick clearance)')
  for (const n of feel.notes ?? []) out.push(n)
  return out
}

const MARK = { pass: '**PASS**', fail: '**FAIL**', pending: '`pending`', unmeasured: '—' }

function gateTable(gates, receipt) {
  const rows = Object.entries(gates).map(([metric, b]) => {
    const measured = receipt?.gates?.find((g) => g.scope === '' && g.metric === metric)
    const status = isPendingGateKey(metric) ? '`pending` — 131 §4 key, waits on 138 B0' : 'computable today'
    const value = measured ? (measured.measured === null ? '—' : String(Math.round(measured.measured * 100) / 100)) : 'not yet rendered'
    const verdict = measured ? MARK[measured.status] + (measured.status === 'fail' ? ` (off by ${Math.round(measured.distance * 100) / 100})` : '') : '—'
    return `| \`${metric}\` | ${band(b)} | ${status} | ${value} | ${verdict} |`
  })
  return ['| gate | band | key status | measured | verdict |', '|---|---|---|---|---|', ...rows].join('\n')
}

const totalLayers = recipes.reduce((s, r) => s + r.layers.length, 0)
const layered = recipes.filter((r) => r.layers.length > 1).length
const pendingGates = recipes.reduce((s, r) => s + Object.keys(r.gates).filter(isPendingGateKey).length, 0)
const allGates = recipes.reduce((s, r) => s + Object.keys(r.gates).length, 0)

function verificationSection() {
  const t = receipts.totals
  const rows = receipts.entries.map((e) => {
    const failed = e.gates.filter((g) => g.status === 'fail').map((g) => `\`${g.scope ? g.scope + '.' : ''}${g.metric}\` ${Math.round(g.measured * 100) / 100} vs ${band(g.target)}`)
    return `| \`${e.recipe}\` | ${e.verdict.toUpperCase()} | ${e.counts.pass} | ${e.counts.fail} | ${e.counts.pending} | ${failed.length ? failed.join('; ') : '—'} |`
  })
  return `## Last verification run — every recipe built, rendered and checked

*From \`presets/recipe-verify-receipts.json\`, generated ${receipts.generatedAt} by
\`${receipts.regenerate}\` (seed ${receipts.build.seed}, key ${receipts.build.key}, ${receipts.build.bpm} BPM,
${receipts.build.mode} render${receipts.build.layerSolos ? ', per-layer solo renders included' : ''}).
**${t.gatesPass} gates passed, ${t.gatesFail} FAILED, ${t.gatesPending} pending on 138's B0 feature upgrade.**
${t.pass} recipes are clean on every computable gate; ${t.fail} have at least one real failure.
A failure here is a FINDING, kept verbatim — the bands are never widened to make this table green.*

| recipe | verdict | pass | fail | pending | what failed |
|---|---|---|---|---|---|
${rows.join('\n')}

`}

const parts = []
parts.push(`# dotbeat — executable recipe reference

*Generated from \`presets/recipes.json\` via \`node scripts/gen-recipes-reference.mjs\` — **do not
hand-edit**. Edit the library and regenerate, so this file can never drift from the validated
catalog (the \`docs/tricks-reference.md\` discipline, restated for recipes by research 139 §6.3).
Drive it with \`beat recipe list|show|build|check\`.*

A **recipe is a layered procedure with a receipt**: layer structure, per-layer patch in dotbeat's
real field names, an effect chain with dosages and order, MIDI/articulation requirements, and exit
gates over metrics the repo already computes. It is one altitude above a **trick** (a single
preconditioned move) and two above a **preset** (a parameter bag with no procedure and no gate),
and it *consumes* both: tricks are its step vocabulary, presets are its patch sources.

**${recipes.length} recipes** across ${ROLE_ORDER.filter((r) => recipes.some((x) => x.role === r)).length} roles, ${totalLayers} layers total (${layered} recipes are genuinely multi-layer).

## How to read a recipe

- **Structure comes from the prose corpus** (\`docs/priors/*.md\` — nine mined veins, cross-source
  CONSENSUS marked separately from CONTRADICTIONS). **Numbers come from measurement**: research 141
  read 3,559 real Surge patch FILES, and where a tutorial and the patch corpus disagree, the patch
  corpus wins — it measures what designers did, not what they said (research 139 §1.3, pushback 2).
- **Gates are \`[lo, hi]\` bands, never scalar maxima.** A band cannot be maximized, which is what
  makes it safe to check automatically: metrics may reject and verify, they may never rank the
  survivors. **A failing gate is a FINDING** — either the recipe is wrong for our engine or the
  engine cannot express what the corpus describes — never a reason to widen the band.
- **\`pending\` gates are honest, not broken.** ${pendingGates} of ${allGates} clip-level gates name a discriminator
  research 131 §4 measured but \`FEATURE_KEYS\` does not compute yet (138's B0 upgrade). They report
  \`pending\`, never silently pass, and no recipe can reach \`verified\` status while one is open.
- **Sweep dials preserve disagreements** instead of averaging them away. Where sources genuinely
  conflict, the recipe encodes the patch-file median as its value and records the full corpus span
  as an explicit dial — so the disagreement stays visible and sweepable.
- **Gaps are recorded, never faked.** A technique the format cannot express is written down as a
  gap. Two are identity-level: dotbeat has no pitch envelope, so neither the 808's downward dive
  nor the hoover's note-on "yawn" is reachable.

## The sweep dials — every recorded source disagreement in one place

| recipe | dial | field | encoded | corpus range |
|---|---|---|---|---|
${recipes.flatMap((r) => (r.dials ?? []).map((d) => `| \`${r.name}\` | ${esc(d.name)} | ${d.field ? `\`${d.field}\`` : '—'} | **${d.value}** | ${band(d.range)} |`)).join('\n')}

${receipts ? verificationSection() : ''}
## The expressibility gaps — what the corpus asks for that dotbeat cannot do

| recipe | gap |
|---|---|
${recipes.flatMap((r) => (r.gaps ?? []).map((g) => `| \`${r.name}\` | ${esc(g)} |`)).join('\n')}
`)

for (const role of ROLE_ORDER) {
  const inRole = recipes.filter((r) => r.role === role)
  if (inRole.length === 0) continue
  parts.push(`\n## ${ROLE_TITLE[role]}\n`)
  for (const r of inRole) {
    parts.push(`### \`${r.name}\` v${r.version}\n`)
    parts.push(`*${r.character}*\n`)
    parts.push(`- **tags** — ${r.tags.join(', ')}`)
    parts.push(`- **status** — \`${r.provenance.status}\` (sourced → verified → validated | parked)`)
    parts.push(`- **figure** — archetype \`${r.figure.archetype}\`, register MIDI ${band(r.figure.register)}`)
    const feel = describeFeel(r.figure.feel)
    if (feel.length > 0) {
      parts.push(`- **feel** (requirements the builder applies; every one of these is invisible to the gates — the owner's ear is their only judge)`)
      for (const f of feel) parts.push(`    - ${f}`)
    }
    parts.push(`- **layers** (${r.layers.length})`)
    for (const layer of r.layers) {
      const shift = layer.transpose ? `, ${layer.transpose > 0 ? '+' : ''}${layer.transpose} semitones` : ''
      parts.push(`    - **\`${layer.id}\`** — ${layer.kind}${shift}${layer.role ? `, production role \`${layer.role}\`` : ''}`)
      parts.push(`        - *why*: ${layer.why}`)
      parts.push(`        - *patch*: ${describePatch(layer)}`)
      if (layer.produce) parts.push(`        - *produce*: \`${JSON.stringify(layer.produce)}\``)
      if (layer.gates) parts.push(`        - *solo gates*: ${Object.entries(layer.gates).map(([k, b]) => `\`${k}\` ${band(b)}`).join(', ')}`)
    }
    if (r.chain.length > 0) {
      parts.push(`- **chain** (clip level, in order)`)
      for (const step of r.chain) parts.push(`    - ${describeStep(step)}`)
    }
    if (r.dials && r.dials.length > 0) {
      parts.push(`- **sweep dials**`)
      for (const d of r.dials) parts.push(`    - **${d.name}**${d.field ? ` (\`${d.field}\`)` : ''} = ${d.value}, range ${band(d.range)} — ${d.note}`)
    }
    if (r.gaps && r.gaps.length > 0) {
      parts.push(`- **gaps** — what this recipe's sources ask for that dotbeat cannot express`)
      for (const g of r.gaps) parts.push(`    - ${g}`)
    }
    parts.push(`- **sources**`)
    for (const s of r.sources) parts.push(`    - *[${CONFIDENCE_LABEL[s.confidence]}]* ${s.url ? `[${s.cite}](${s.url})` : s.cite} — ${s.claim}`)
    parts.push('')
    const receipt = receiptFor(r.name)
    parts.push(`**Clip gates** (checked on the summed render)${receipt ? ` — last verified run: **${receipt.verdict.toUpperCase()}**` : ''}:\n`)
    parts.push(gateTable(r.gates, receipt))
    parts.push('')
    parts.push(`*Gates mined from ${r.provenance.gatesMinedFrom.refs} — ${r.provenance.gatesMinedFrom.stat}, as of ${r.provenance.gatesMinedFrom.asOf}.*`)
    parts.push('')
  }
}

parts.push(`---

## Growth and graduation (research 139 §6.3)

- **\`sourced\`** — the recipe executes end-to-end on a scratch project. Every recipe ships here.
- **\`verified\`** — a seeded reference build renders deterministically and passes every gate;
  the feature receipt is stored in \`provenance.verifyReceipt\`. **Unreachable today for any recipe
  whose gates reach for a 131 §4 discriminator** — the loader refuses the status while a gate is
  pending, and 138's B0 feature upgrade is the prerequisite.
- **\`validated\`** — the recipe's arm beat its pre-registered control in blind rating; one
  \`blindRecord\` entry per rated batch, append-only.
- **\`parked\`** — failed validation twice, record intact. A re-mine or redesign is a NEW version
  beside the old one; the failure stays attached to the version that earned it. That is what makes
  the library evidence rather than lore.

Gates regenerate from the growing rated log by script and mint a new recipe \`version\`; procedures
and sources freeze per version; the blind record only ever appends (CLAUDE.md's frozen-science
rule, the \`engineplusProfile\` precedent).
`)

const out = parts.join('\n')
const outPath = join(root, 'docs', 'recipes-reference.md')
writeFileSync(outPath, out)
console.log(`wrote ${outPath} — ${recipes.length} recipes, ${totalLayers} layers, ${pendingGates}/${allGates} clip gates pending on 138 B0`)

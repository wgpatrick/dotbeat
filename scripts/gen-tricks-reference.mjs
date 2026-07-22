// Regenerates docs/tricks-reference.md from presets/tricks.json (research 118 §3.1 option C: the
// library is the source of truth, the reference doc is GENERATED so it can never drift from it —
// the roadmap-data.mjs -> product-roadmap.md pattern applied to production knowledge).
//
// Run after editing presets/tricks.json (requires a build so the compiled loader is current):
//   npm run build && node scripts/gen-tricks-reference.mjs
//
// NEVER hand-edit docs/tricks-reference.md — edit presets/tricks.json and re-run this.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseTrickLibrary, TRICK_AXES } from '../dist/src/analysis/index.js'
import { parseMacroLibrary } from '../dist/src/core/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const macros = parseMacroLibrary(readFileSync(join(root, 'presets', 'macros.json'), 'utf8'))
const tricks = parseTrickLibrary(readFileSync(join(root, 'presets', 'tricks.json'), 'utf8'), macros)

const AXIS_TITLE = {
  width: 'Width — the -52 dB-vs--11 dB stereo gap (research 115 §2)',
  air: 'Air — the near-zero-vs-1.9% air-band gap (research 115 §3)',
  motion: 'Motion & sidechain — the Audiobox PC 2.1-vs-4.5 gap (research 115 §4)',
  glue: 'Glue & character — harmonic density / "less digital" (research 115 §1 / §5)',
}

const describeClause = (c) => {
  if ('metric' in c) return `\`${c.metric} ${c.op} ${c.value}\``
  if ('field' in c) return `\`${c.field} ${c.op} ${c.value === null ? 'none' : c.value}\``
  if (c.state === 'songMode') return `\`song mode ${c.op} ${c.value}\``
  return `\`${c.lane} hits ${c.op} ${c.value}\``
}
const describeStep = (s) => {
  if ('set' in s) return `\`set ${s.set} ${s.value}\``
  if ('effectAdd' in s) return `\`effect-add ${s.type}\``
  if ('macro' in s) return `\`macro ${s.macro} @ ${s.knob}\``
  if ('automate' in s) return `\`automate ${s.automate}\` → ${s.points.map(([t, v]) => `(${t}, ${v})`).join(', ')}`
  return `\`addHits ${s.lane} ${s.steps} v${s.velocity}\``
}
const describeExpect = (e) => `\`${e.metric}\` ${e.dir}${e.min !== undefined ? ` (≥ ${e.min})` : ''}`

const slotLine = (t) => {
  const tk = t.slots.track
  const parts = [`kind **${tk.kind}**`]
  if (tk.roles) parts.push(`roles ${tk.roles.join('/')}`)
  if (tk.notRoles) parts.push(`not ${tk.notRoles.join('/')}`)
  if (t.slots.clip) parts.push('needs a clip')
  if (t.slots.knobs) parts.push(`knobs ${t.slots.knobs.map((k) => `\`${k.name}\`=${k.default}`).join(', ')}`)
  return parts.join(', ')
}

let out = `# dotbeat — production tricks reference

*Generated from \`presets/tricks.json\` via \`node scripts/gen-tricks-reference.mjs\` — **do not
hand-edit**. Edit the catalog and regenerate, so this file can never drift from the validated
library (research 118 §3.1). See \`docs/tricks.md\` for how the system works, and drive it with
\`beat trick list|show|apply|suggest\`.*

A **trick is a preset with preconditions and a receipt**: a named production move with
machine-readable preconditions over the metric vector the eval loop already computes
(\`FEATURE_KEYS\`) and over document state, a recipe in a closed step vocabulary (every step an
existing edit primitive), and a declared metric delta (the verification contract). Before
production-polishing a project, run \`beat trick suggest <file.beat>\` and read the cards below.

**${tricks.length} tricks**, across ${TRICK_AXES.length} measured gap axes.

`

for (const axis of TRICK_AXES) {
  const inAxis = tricks.filter((t) => t.axis === axis)
  if (inAxis.length === 0) continue
  out += `## ${AXIS_TITLE[axis] ?? axis}\n\n`
  for (const t of inAxis) {
    out += `### \`${t.name}\`\n\n`
    out += `- **applies to** — ${slotLine(t)}\n`
    out += `- **when** — ${t.when.length ? t.when.map(describeClause).join(' AND ') : '(no preconditions)'}\n`
    out += `- **recipe** — ${t.recipe.map(describeStep).join('; ')}\n`
    out += `- **expect** — ${t.expect.map(describeExpect).join(', ')}\n`
    out += `- **counter** —\n`
    for (const c of t.counter) out += `    - ${c.note}${c.clause ? ` *(blocks apply when ${describeClause(c.clause)})*` : ''}\n`
    if (t.counter.length === 0) out += `    - (none)\n`
    out += `- **why** — ${t.why}\n\n`
  }
}

out += `---

*${tricks.length} tricks. Deferred (blocked on format additions or a richer recipe vocabulary — see
research 118 §2's "Explicitly NOT in v1" list and §3.4): \`sidechain-pump\` (needs a second
source-track slot), \`reverb-throw\` (phrase-spike automation), \`tremolo-motion\`,
\`pingpong-echo\` (bpm-synced delay-time arithmetic), \`layered-timeline\` (a stacking policy, not
edits), and the arrangement/transition family (\`drum-pull\`, \`snare-build\` — clip-copy
semantics). Each enters this same catalog, under the same eager validation, when its prerequisite
lands.*
`

const outPath = join(root, 'docs', 'tricks-reference.md')
writeFileSync(outPath, out)
console.log(`wrote ${outPath} — ${tricks.length} tricks`)

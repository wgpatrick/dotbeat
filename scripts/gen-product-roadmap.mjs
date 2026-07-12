// Regenerates docs/product-roadmap.md from scripts/roadmap-data.mjs.
// Run after editing roadmap-data.mjs: `node scripts/gen-product-roadmap.mjs`

import { rows } from './roadmap-data.mjs'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outPath = join(__dirname, '..', 'docs', 'product-roadmap.md')

const LAYER_LABEL = { done: '✅ done', partial: '🔶 partial', missing: '❌ missing', na: '—' }
const STATUS_LABEL = { done: '✅ Done', progress: '🚧 In progress', 'not-started': '⬜ Not started' }

const linkDoc = (path) => (path ? `[\`${path.split('/').pop()}\`](${path})` : '—')

const areas = [...new Set(rows.map((r) => r.area))]

const total = rows.length
const counts = rows.reduce((acc, r) => ((acc[r.status] = (acc[r.status] || 0) + 1), acc), {})

let out = `# dotbeat — product roadmap

*The source of truth for what's built, in progress, and planned. Supersedes \`feature-matrix.md\`
(renamed and restructured 2026-07-12 per owner direction — "feature area" was too coarse a grain:
a whole area like "track management" isn't meaningfully "done" or "not done," the individual
features inside it are).*

*Generated from \`scripts/roadmap-data.mjs\` via \`node scripts/gen-product-roadmap.mjs\` — edit the
data file, not this file directly, so it stays in sync with the matching artifact dashboard.*

## How to read this

- **Feature area** groups related features (e.g. "Drum programming"). It has no status of its
  own — read the features inside it.
- **Feature** is the actual unit of status — small enough that "done" means done.
- **Core / CLI·MCP / GUI** are the three layers every feature can exist at (per \`docs/decisions.md\`'s
  three-surface thesis) — ✅ done, 🔶 partial, ❌ missing, — not applicable to this feature.
- **Status** is the feature's overall state: ✅ Done (all applicable layers done and verified),
  🚧 In progress, ⬜ Not started.
- **Research** links the \`docs/research/NN-*.md\` pass that scoped the feature, if one exists.
- **Plan** links the \`docs/phase-N-*.md\` (or other) doc with the concrete build plan or the
  as-built result, if one exists.

A feature with links in both columns but status "Not started" means: fully scoped, ready for a
stream to pick up — not guesswork, a decision away from being built.

## Snapshot — ${total} features tracked

${Object.entries({ done: 'Done', progress: 'In progress', 'not-started': 'Not started' })
  .map(([k, label]) => `**${counts[k] || 0}** ${label}`)
  .join(' · ')}

---

`

for (const area of areas) {
  const areaRows = rows.filter((r) => r.area === area)
  out += `## ${area}\n\n`
  out += `| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |\n`
  out += `|---|---|---|---|---|---|---|---|\n`
  for (const r of areaRows) {
    out += `| ${r.feature} | ${r.description} | ${LAYER_LABEL[r.core]} | ${LAYER_LABEL[r.cli]} | ${LAYER_LABEL[r.gui]} | ${STATUS_LABEL[r.status]} | ${linkDoc(r.research)} | ${linkDoc(r.plan)} |\n`
  }
  out += `\n`
}

out += `---

## Process

Every stream/phase that ships a feature updates \`scripts/roadmap-data.mjs\` (not this file
directly) as part of its own completion checklist, then re-runs the generator — don't let it
drift stale. When a stream *researches* a feature without building it, add the row the moment the
research doc lands with status "not-started" and a research link, so scoped-but-unbuilt work is
visible in the same place as everything else, not buried in \`docs/research/\`.

Last regenerated: 2026-07-12.
`

writeFileSync(outPath, out)
console.log(`wrote docs/product-roadmap.md: ${total} features, ${areas.length} areas`)
console.log(counts)

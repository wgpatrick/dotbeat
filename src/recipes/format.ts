// Human-readable renderings of a recipe, for `beat recipe list|show`. Kept beside the schema so
// the CLI carries no formatting logic of its own (the tricks-CLI pattern).

import { isPatchSource, type Recipe, type RecipeLayer, type RecipeStep } from './schema.js'

const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length))

const gateLine = (gates: Record<string, readonly [number, number]>): string =>
  Object.entries(gates)
    .map(([k, [lo, hi]]) => `${k} ${lo}..${hi}`)
    .join(', ')

export function describeLayerPatch(layer: RecipeLayer): string {
  const p = layer.patch
  if (isPatchSource(p)) return `from ${p.from}${p.retarget ? ` retargeted to ${gateLine(p.retarget)}` : ''}`
  return Object.entries(p)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
}

export function describeStep(step: RecipeStep): string {
  if ('trackAdd' in step) return `track-add ${step.trackAdd} (${step.kind}, ${step.hits}, ${step.volume} dB)`
  if ('effectAdd' in step) return `effect-add ${step.effectAdd} ${step.type}`
  return `set ${step.set} ${step.value}`
}

export function describeFeel(recipe: Recipe): string[] {
  const f = recipe.figure.feel
  const out: string[] = []
  if (f.swingPct !== undefined) out.push(`swing ${f.swingPct}%${f.swingGrid !== undefined ? ` on grid ${f.swingGrid}` : ''}`)
  if (f.velocityTiers) out.push(`velocity tiers ${f.velocityTiers.join('/')}`)
  if (f.gate !== undefined) out.push(`gate ×${f.gate}`)
  if (f.glideSeconds !== undefined) out.push(`glide ${f.glideSeconds}s`)
  if (f.restBeatOneSixteenth) out.push('rest on every beat-1 16th (kick clearance)')
  for (const n of f.notes ?? []) out.push(n)
  return out
}

export function formatRecipeList(recipes: readonly Recipe[]): string {
  if (recipes.length === 0) return 'no recipes\n'
  const nameW = Math.max(...recipes.map((r) => r.name.length), 4)
  const roleW = Math.max(...recipes.map((r) => r.role.length), 4)
  const lines = recipes.map(
    (r) => `  ${pad(r.name, nameW)}  ${pad(r.role, roleW)}  ${pad(`${r.layers.length}L`, 3)}  ${pad(r.provenance.status, 9)}  ${r.tags.join('/')}`,
  )
  return [`${recipes.length} recipes`, '', ...lines, '', 'show one with `beat recipe show <name>`'].join('\n') + '\n'
}

export function formatRecipeCard(recipe: Recipe): string {
  const l: string[] = []
  l.push(`${recipe.name} v${recipe.version} — ${recipe.role} [${recipe.tags.join(', ')}] (${recipe.provenance.status})`)
  l.push(`  ${recipe.character}`)
  l.push('')
  l.push(`  figure — archetype ${recipe.figure.archetype}, register MIDI ${recipe.figure.register[0]}..${recipe.figure.register[1]}`)
  for (const f of describeFeel(recipe)) l.push(`    feel: ${f}`)
  l.push('')
  l.push(`  layers (${recipe.layers.length})`)
  for (const layer of recipe.layers) {
    l.push(`    ${layer.id} — ${layer.kind}${layer.transpose ? `, ${layer.transpose > 0 ? '+' : ''}${layer.transpose} st` : ''}${layer.role ? `, role ${layer.role}` : ''}`)
    l.push(`      why: ${layer.why}`)
    l.push(`      patch: ${describeLayerPatch(layer)}`)
    if (layer.produce) l.push(`      produce: ${JSON.stringify(layer.produce)}`)
    if (layer.gates) l.push(`      gates: ${gateLine(layer.gates)}`)
  }
  if (recipe.chain.length > 0) {
    l.push('')
    l.push('  chain')
    for (const step of recipe.chain) l.push(`    ${describeStep(step)}`)
  }
  l.push('')
  l.push(`  clip gates — ${gateLine(recipe.gates)}`)
  if (recipe.dials && recipe.dials.length > 0) {
    l.push('')
    l.push('  sweep dials (where the sources disagree)')
    for (const d of recipe.dials) l.push(`    ${d.name}${d.field ? ` (${d.field})` : ''} = ${d.value}, range ${d.range[0]}..${d.range[1]} — ${d.note}`)
  }
  if (recipe.gaps && recipe.gaps.length > 0) {
    l.push('')
    l.push('  expressibility gaps')
    for (const g of recipe.gaps) l.push(`    ${g}`)
  }
  l.push('')
  l.push('  sources')
  for (const s of recipe.sources) l.push(`    [${s.confidence}] ${s.cite} — ${s.claim}`)
  l.push('')
  l.push(`  gates mined from ${recipe.provenance.gatesMinedFrom.refs} (${recipe.provenance.gatesMinedFrom.stat}, as of ${recipe.provenance.gatesMinedFrom.asOf})`)
  return l.join('\n') + '\n'
}

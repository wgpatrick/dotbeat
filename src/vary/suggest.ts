// `beat suggest` — rung 3 of the variation-and-taste loop (docs/variation-loop.md,
// docs/research/08-variation-loop-prior-art.md). Reads the accumulated `beat-scores.jsonl`
// exhaust for a track (rung 1's scoring log — see cli/beat.mjs's scoreCmd for the exact schema:
// { t, batch, track, group, amount, seed, parentSha256, picks: [{rank, variant, edits|recipe}],
// rejected: [variant...] }) and proposes the next `beat vary` invocation, biased toward what has
// historically scored well.
//
// HONESTY NOTE (this project's convention: flag heuristics/inferences explicitly, don't oversell
// them — see docs/research/08-variation-loop-prior-art.md and every phase doc's Result section).
// The design docs name Bradley-Terry as the reference model for turning pairwise win/loss counts
// into a per-item strength score. A textbook BT fit needs items to play each other head-to-head.
// But by rung-1's own design (docs/variation-loop.md), every `beat vary` round mutates exactly
// ONE parameter group — so mutation groups never appear in the same batch and never face off
// directly. There is no group-vs-group trial anywhere in this data, by construction.
//
// What the log DOES contain, per round: a set of picked variants (wins) and a set of rejected
// variants (losses) from that round's single group, against a shared implicit baseline ("the
// variants that didn't make the cut"). That is exactly the degenerate case of Bradley-Terry
// where every "player" (group) only ever faces one common reference opponent — the closed-form
// BT strength update for that case collapses to strength ∝ wins/losses (the odds of being picked
// vs rejected). That's what `computeGroupStats` below computes: a real, principled use of the BT
// odds-form, not an ad-hoc score — but it is NOT a full multi-way BT fit, and it cannot separate
// "this group is inherently better" from "the human was in a more decisive mood that round."
// Treat the ranking as a signal to steer exploration, not a proof of superiority. With the small
// n this project expects (a handful of scored rounds, not thousands — docs/research/08 says
// usable sounds land in 2-12 generations), Laplace smoothing keeps single-round groups from
// producing infinite/zero odds.
//
// The "which direction within a group" hint is a second, separate heuristic: it does NOT use
// Bradley-Terry. It normalizes each picked numeric value into its VARY_GROUPS-defined [min, max]
// range (in log-space for log-scale params, matching vary.ts's own mutation space) and checks
// whether picks cluster above or below the range's midpoint. It is a simple descriptive average,
// reported only when there are enough samples and the trend is not close to the midpoint.

import { VARY_GROUPS, legalGroupsForKind, type VaryParamDef } from './vary.js'
import type { TrackKind } from '../core/document.js'

export interface ScorePick {
  rank: number
  variant: string
  /** Param-group rounds carry each edit as "<trackId>.<param> <value>" (exactly what `beat vary`
   * writes into manifest.json and `beat score` copies verbatim into the log — see cli/beat.mjs's
   * varyCmd/scoreCmd). Feel rounds carry `recipe` instead (humanize isn't a set-replayable edit). */
  edits?: string[]
  recipe?: string
}

export interface ScoreEntry {
  t?: string
  batch?: string
  track: string
  group: string
  amount?: number
  seed?: number
  parentSha256?: string
  picks: ScorePick[]
  rejected: string[]
}

export interface GroupStat {
  group: string
  rounds: number
  wins: number // total picks pooled across this group's rounds
  losses: number // total rejects pooled across this group's rounds
  pickRate: number // wins / (wins + losses); raw, unsmoothed — the human-readable number
  strength: number // Bradley-Terry odds-form score (Laplace-smoothed); see module doc for method + limits
}

export interface DirectionHint {
  param: string
  direction: 'higher' | 'lower'
  label: string // e.g. "brighter" / "darker" / "higher" / "lower"
  samples: number
  meanNorm: number // mean normalized position in [0, 1] across picked values (0.5 = range midpoint)
}

export interface Suggestion {
  coldStart: boolean
  track: string
  totalRounds: number
  stats: GroupStat[] // sorted by strength desc; empty when coldStart
  recommendedGroup: string
  directions: DirectionHint[] // for recommendedGroup, where derivable; empty otherwise
  amount: number
  seed: number
  command: string
  /** Plain-English lines: sample size, what won, and the concrete next command — never a bare
   * number. Join with '\n' for CLI/MCP output. */
  reasoning: string[]
}

/** Groups whose numeric params read as a frequency (higher = brighter-sounding). Everything else
 * gets a neutral "higher"/"lower" label — this list is deliberately small and conservative. */
const BRIGHT_DARK_PARAMS = new Set(['cutoff', 'hatTone', 'kickTune', 'osc2Detune'])

function directionLabel(param: string, high: boolean): string {
  if (BRIGHT_DARK_PARAMS.has(param)) return high ? 'brighter' : 'darker'
  return high ? 'higher' : 'lower'
}

/** Parse an append-only beat-scores.jsonl file's text into entries. Blank lines are skipped;
 * malformed lines are skipped rather than throwing, since the log is append-only exhaust that
 * may span format tweaks over a project's life — a suggestion should degrade gracefully, not
 * refuse to run over one bad line. */
export function parseScoresLog(text: string): ScoreEntry[] {
  const entries: ScoreEntry[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as Partial<ScoreEntry>
      if (parsed && typeof parsed.track === 'string' && typeof parsed.group === 'string' && Array.isArray(parsed.picks)) {
        entries.push({
          t: parsed.t,
          batch: parsed.batch,
          track: parsed.track,
          group: parsed.group,
          amount: parsed.amount,
          seed: parsed.seed,
          parentSha256: parsed.parentSha256,
          picks: parsed.picks as ScorePick[],
          rejected: Array.isArray(parsed.rejected) ? (parsed.rejected as string[]) : [],
        })
      }
    } catch {
      // skip malformed line
    }
  }
  return entries
}

function matchesTarget(entry: ScoreEntry, target: string): boolean {
  if (entry.group === target) return true
  for (const p of entry.picks) {
    if (p.recipe && p.recipe.includes(target)) return true
    if (p.edits && p.edits.some((e) => e.includes(target))) return true
  }
  return false
}

/** Split one manifest-style edit string ("<trackId>.<param> <value>") into its param key and
 * numeric value. Returns undefined if it isn't a bare "path value" pair or the value isn't
 * numeric (enum params like osc2Type aren't part of any VARY_GROUPS range, so they're skipped
 * rather than guessed at). */
function parseEdit(edit: string): { param: string; value: number } | undefined {
  const sp = edit.indexOf(' ')
  if (sp === -1) return undefined
  const path = edit.slice(0, sp)
  const value = Number(edit.slice(sp + 1))
  if (!Number.isFinite(value)) return undefined
  const dot = path.indexOf('.')
  if (dot === -1) return undefined
  return { param: path.slice(dot + 1), value }
}

function computeGroupStats(entries: ScoreEntry[]): GroupStat[] {
  const byGroup = new Map<string, { rounds: number; wins: number; losses: number }>()
  for (const e of entries) {
    const s = byGroup.get(e.group) ?? { rounds: 0, wins: 0, losses: 0 }
    s.rounds += 1
    s.wins += e.picks.length
    s.losses += e.rejected.length
    byGroup.set(e.group, s)
  }
  const stats: GroupStat[] = []
  for (const [group, s] of byGroup) {
    // Laplace smoothing (+0.5 each side): standard fix for the divide-by-zero / infinite-odds
    // case, and essential here because n is often 1-4 rounds per group (small-n is the normal
    // case for this loop, not an edge case).
    const smoothedWins = s.wins + 0.5
    const smoothedLosses = s.losses + 0.5
    stats.push({
      group,
      rounds: s.rounds,
      wins: s.wins,
      losses: s.losses,
      pickRate: s.wins / (s.wins + s.losses || 1),
      strength: smoothedWins / smoothedLosses,
    })
  }
  stats.sort((a, b) => b.strength - a.strength || b.rounds - a.rounds || a.group.localeCompare(b.group))
  return stats
}

function toNorm(value: number, def: VaryParamDef): number {
  if (def.scale === 'log') {
    const lo = Math.log(Math.max(def.min, 1e-9))
    const hi = Math.log(Math.max(def.max, 1e-9))
    const v = Math.log(Math.max(value, 1e-9))
    return (v - lo) / (hi - lo || 1)
  }
  return (value - def.min) / (def.max - def.min || 1)
}

const MIN_DIRECTION_SAMPLES = 3
const DIRECTION_DEADBAND = 0.15 // mean position must be at least this far from the 0.5 midpoint

function computeDirections(entries: ScoreEntry[], group: string): DirectionHint[] {
  const defs = VARY_GROUPS[group]
  if (!defs) return []
  const byParam = new Map<string, number[]>()
  for (const e of entries) {
    if (e.group !== group) continue
    for (const pick of e.picks) {
      if (!pick.edits) continue
      for (const raw of pick.edits) {
        const parsed = parseEdit(raw)
        if (!parsed) continue
        const def = defs.find((d) => d.key === parsed.param)
        if (!def) continue
        const arr = byParam.get(parsed.param) ?? []
        arr.push(toNorm(parsed.value, def))
        byParam.set(parsed.param, arr)
      }
    }
  }
  const hints: DirectionHint[] = []
  for (const [param, norms] of byParam) {
    if (norms.length < MIN_DIRECTION_SAMPLES) continue
    const mean = norms.reduce((a, b) => a + b, 0) / norms.length
    if (Math.abs(mean - 0.5) < DIRECTION_DEADBAND) continue
    const high = mean > 0.5
    hints.push({ param, direction: high ? 'higher' : 'lower', label: directionLabel(param, high), samples: norms.length, meanNorm: mean })
  }
  hints.sort((a, b) => Math.abs(b.meanNorm - 0.5) - Math.abs(a.meanNorm - 0.5) || a.param.localeCompare(b.param))
  return hints
}

export interface SuggestOptions {
  /** Restrict to rounds "about" this lane/id/param — matched against the round's group name, or
   * (best-effort) its picks' recipe text / edit paths. Optional focus filter, not a hard schema
   * field (the log doesn't carry lane/id provenance for param-group rounds). */
  target?: string
  /** Path text to show in the recommended command; defaults to the "<file>" placeholder for
   * library callers that don't have one yet. */
  file?: string
  /** Injectable clock for deterministic tests; defaults to Date.now(). */
  now?: number
  /** The target track's actual kind (synth/drums/instrument/audio). When given, the cold-start
   * recommendation is restricted to a group that's actually legal (audible) on that kind — see
   * vary.ts's `legalGroupsForKind` (research/96: a synth track's first-ever suggestion used to be
   * "kick", a drum-only param group, so the "successful" suggested command was a silent no-op).
   * Omit only for callers that don't have a parsed document handy; falls back to the old
   * kind-agnostic first-group behavior. */
  trackKind?: TrackKind
}

const AMOUNT_DEFAULT = 0.25 // rung-1's own default (vary.ts)
const AMOUNT_CONFIDENT = 0.4
const AMOUNT_MAX = 0.6
const CONFIDENT_ROUNDS = 2
const CONFIDENT_PICK_RATE = 0.3 // ~= 3-of-9, the top of the default batch's pick budget

/** Propose the next `beat vary` round for a track from its scored-rounds exhaust. Pure function
 * of the parsed log entries — no filesystem access (CLI/MCP own reading beat-scores.jsonl). */
export function suggestNext(entries: ScoreEntry[], track: string, opts: SuggestOptions = {}): Suggestion {
  const now = opts.now ?? Date.now()
  const seed = Math.floor(now % 2147483647) || 1
  const file = opts.file ?? '<file>'

  let relevant = entries.filter((e) => e.track === track)
  if (opts.target) relevant = relevant.filter((e) => matchesTarget(e, opts.target!))
  const scope = opts.target ? ` matching --target ${opts.target}` : ''

  if (relevant.length === 0) {
    // Restrict to groups that are actually legal (audible) on this track's kind, if known —
    // otherwise every VARY_GROUPS entry is a candidate, same as before (research/96: an
    // unfiltered "first group" pick handed a synth track "kick", a drum-only group, as its
    // first-ever recommendation — a command that "succeeds" but never touches the audible synth
    // params, a silent no-op).
    const candidates = opts.trackKind ? legalGroupsForKind(opts.trackKind) : Object.keys(VARY_GROUPS)
    const group = candidates[0]!
    const command = `beat vary ${file} ${track} ${group} --amount ${AMOUNT_DEFAULT} --seed ${seed}`
    const kindNote = opts.trackKind
      ? `recommending the first group legal for a "${opts.trackKind}" track (${candidates.join(', ')}): "${group}", at the rung-1 default amount (${AMOUNT_DEFAULT}).`
      : `recommending the first group in vary.ts's declared order (${Object.keys(VARY_GROUPS).join(', ')}): "${group}", at the rung-1 default amount (${AMOUNT_DEFAULT}).`
    return {
      coldStart: true,
      track,
      totalRounds: 0,
      stats: [],
      recommendedGroup: group,
      directions: [],
      amount: AMOUNT_DEFAULT,
      seed,
      command,
      reasoning: [`no scored rounds found for "${track}"${scope} — cold start, nothing to bias toward yet.`, kindNote, `recommend: ${command}`],
    }
  }

  const stats = computeGroupStats(relevant)
  const top = stats[0]!
  const directions = top.group === 'feel' ? [] : computeDirections(relevant, top.group)

  let amount = AMOUNT_DEFAULT
  if (top.rounds >= CONFIDENT_ROUNDS && top.pickRate >= CONFIDENT_PICK_RATE) amount = AMOUNT_CONFIDENT
  if (directions.length > 0 && amount > AMOUNT_DEFAULT) amount = Math.min(AMOUNT_MAX, amount + 0.2)

  const command = top.group === 'feel' ? `beat vary ${file} ${track} feel --seed ${seed}` : `beat vary ${file} ${track} ${top.group} --amount ${amount} --seed ${seed}`

  const reasoning: string[] = [`based on ${relevant.length} scored round(s) for "${track}"${scope}:`]
  for (const s of stats) {
    reasoning.push(`  ${s.group}: ${s.wins}/${s.wins + s.losses} variants picked across ${s.rounds} round(s) (pick rate ${(s.pickRate * 100).toFixed(0)}%)`)
  }
  reasoning.push(
    `"${top.group}" ranks highest by picked-vs-rejected odds (Bradley-Terry odds-form against an implicit "not picked" baseline — groups never appear in the same batch by rung-1's design, so this is a ranking signal, not a proven head-to-head win; see suggest.ts's module doc).`,
  )
  if (directions.length) {
    for (const d of directions) {
      reasoning.push(`  within "${top.group}", picks trend ${d.label} on ${d.param} (mean position ${(d.meanNorm * 100).toFixed(0)}% of its vary.ts range, n=${d.samples}).`)
    }
  } else {
    reasoning.push(`  no clear directional trend within "${top.group}" yet (need more overlapping-param picks).`)
  }
  reasoning.push(`recommend: ${command}`)

  return { coldStart: false, track, totalRounds: relevant.length, stats, recommendedGroup: top.group, directions, amount, seed, command, reasoning }
}

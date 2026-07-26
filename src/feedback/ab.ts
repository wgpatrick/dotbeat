// `beat ab` — the OWNER-FEEDBACK surface (research/128 §2.5's listening packet, 137's checkpoint-
// listen protocol). The third sibling of the two review surfaces that already exist, and the one
// that captures the thing the other two structurally cannot: WHY.
//
//   beat rate   blind MEASUREMENT   -> beat-scores.jsonl     (taste model / showdown reports, D24)
//   beat board  non-blind PICKING   -> beat-decisions.jsonl  (production decisions on vary batches)
//   beat ab     non-blind FEEDBACK  -> beat-feedback.jsonl   (development decisions on any renders)
//
// The three logs are never merged and no loader globs across them (D24: production never
// contaminates eval; the same rule now covers feedback). See test/feedback-ab.test.ts.
//
// Why a third surface rather than a `board --ab` mode: `board` is manifest-driven — it only sees
// directories holding a vary-batch `manifest.json`, its unit is a batch of variants of ONE
// document, and its output is a PICK (`decision.json` + `beat adopt`). The listening sets this
// module exists for are none of those things: `taste-dataset/layered-check/` (arms of a treatment),
// `taste-dataset/retarget-check/` (before/after pairs of a parameter search), `compose-lab/renders/`
// (model-vs-model outputs) are plain folders of wavs, compared to answer a QUESTION the agent
// asked, and the answer that matters is prose, not an adopt target.
//
// The failure this fixes, concretely (2026-07-26): every listening set produced that day landed in
// a folder with a README naming the files to compare. The owner navigated one and replied in chat —
// "the layering makes everything sound same-ish... the bassline layering doesn't sound great, I
// liked the unlayered one better" — which was more valuable than any preference count, and had
// nowhere structured to live, so a coordinator hand-translated it into a work order. Free text is
// therefore a FIRST-CLASS field here, not a footnote on a preference button.

import { existsSync, readFileSync, readdirSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'

/** Where the AGENT writes its question set, at the listening dir's root. Never written by `beat ab` —
 * the manifest is the agent's half of the conversation and stays exactly as the agent wrote it. */
export const FEEDBACK_MANIFEST = 'feedback.json'

/** Where the OWNER's answers are appended, at the listening dir's root. Deliberately a separate
 * filename from DEFAULT_SCORES_LOG (`beat-scores.jsonl`) and DEFAULT_DECISIONS_LOG
 * (`beat-decisions.jsonl`) — same directory allowed, never the same file. */
export const DEFAULT_FEEDBACK_LOG = 'beat-feedback.jsonl'

/** Per-comparison answer files, one JSON per answered comparison, under the listening dir's root.
 *
 * NOTE ON THE NAME: `beat board`'s per-batch answer is `<batch>/decision.json`, and the obvious
 * mirror here would be `<case>/feedback.json`. That name is taken by the QUESTION manifest above,
 * and a case dir holding an *answer* called `feedback.json` would be read as a *question* the
 * moment anyone pointed `beat ab` at that subdirectory — a real footgun, not a theoretical one,
 * because bare-folder inference means pointing at a subdirectory is a normal thing to do. A
 * comparison also does not always own a directory (retarget-check puts three comparisons' worth of
 * wavs in one folder), so "next to the audio" is not even well defined. One rule instead:
 * `<root>/feedback-answers/<comparison-id>.json`, globbable in one line. */
export const ANSWERS_DIR = 'feedback-answers'

// ---- the question shape (what the agent writes) -----------------------------------------------

export interface AbOption {
  /** Display name — the arm/treatment, shown in the open (this surface is non-blind by design). */
  name: string
  /** Path to the render, relative to the listening dir root. */
  wav: string
  /** One line of provenance the owner should know before judging ("+10c osc2 layer, unison 5"). */
  note?: string
}

export interface AbComparison {
  /** Stable id — the key in the log, the answer filename, and what an agent quotes back. */
  id: string
  /** Human label for the case ("bassline-41", "deep-sub-bass — search figure"). */
  label?: string
  /** Overrides the set-level question for this one comparison. */
  question?: string
  options: AbOption[]
  /** Whatever the agent measured and wants on screen, keyed by option name. Values are shown
   * verbatim — this module never invents units. */
  measurements?: Record<string, Record<string, number | string>>
}

export interface AbManifest {
  /** The set-level question. The whole point of the surface: the agent states what it wants to
   * know, in its own words, and the owner answers THAT rather than guessing the brief. */
  question?: string
  comparisons: AbComparison[]
}

/** A loaded question set plus where it came from — `manifest` when the agent wrote one, `inferred`
 * when `beat ab` read the folder layout (so the page can say which, honestly). */
export interface AbSet extends AbManifest {
  source: 'manifest' | 'inferred'
  dir: string
  /** Human note about what inference did / what it skipped, shown in the page banner. */
  inferenceNote?: string
}

// ---- the answer shape (what the owner writes) -------------------------------------------------

export type AbPreference = string | 'neither'

export interface FeedbackEntry {
  t: string
  dir: string
  comparisonId: string
  question: string
  /** The chosen option's `name`, or 'neither' for no-preference/none-good. */
  preference: AbPreference
  /** The owner's own words. The product. Empty only if they explicitly submitted without any. */
  freeText: string
  /** True when the owner flagged this as "something sounds WRONG here" — the listen-bench trigger. */
  flagged?: boolean
  /** Every option that was on screen, in the order shown, with its provenance note. */
  options: { name: string; wav: string; note?: string }[]
  /** Whatever was displayed as measurements (agent-supplied or DSP-measured), copied in so the
   * record survives the render dir being deleted — the same durability rule the decision log
   * follows. */
  measurements?: Record<string, Record<string, number | string>>
  /** Load-time tag: this is owner FEEDBACK, never a blind rating. Any deliberate future import
   * into taste training must carry it. Always true. */
  nonBlind: true
}

/** `<root>/feedback-answers/<id>.json` — the compact per-comparison answer an agent reads without
 * parsing the log. */
export interface AnswerFile {
  answered_at: string
  comparisonId: string
  /** The human label of the comparison, so the file explains itself. */
  label?: string
  question: string
  preference: AbPreference
  freeText: string
  flagged?: boolean
  /** Full options INCLUDING each one's provenance note — see `recordFeedback` for why. */
  options: { name: string; wav: string; note?: string }[]
  measurements?: Record<string, Record<string, number | string>>
}

// ---- bare-folder inference --------------------------------------------------------------------

/** Files that are never comparison options. `.context.wav` is the board's in-context render
 * convention; `audition.wav` is the stitched blind audition; `v<N>.wav` covered by a sibling
 * `manifest.json` belongs to `beat board`, not here (see `variantWavs`). */
const EXCLUDED_WAVS = new Set(['audition.wav'])

/** The wavs in `dir` that a vary-batch `manifest.json` claims as its variants — excluded from
 * inference so `beat ab` and `beat board` never fight over the same files. This is what makes
 * `taste-dataset/layered-check/<case>/` infer as {engineplus, layered, layeredplus} and not as
 * those three PLUS v1/v2/v3. */
function variantWavs(dir: string): Set<string> {
  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) return new Set()
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { variants?: { file?: string }[] }
    const out = new Set<string>()
    for (const v of manifest.variants ?? []) {
      if (typeof v.file === 'string') out.add(v.file.replace(/\.beat$/, '.wav'))
    }
    return out
  } catch {
    return new Set()
  }
}

/** The candidate option wavs directly inside `dir`, sorted. */
function optionWavsIn(dir: string): string[] {
  const skip = variantWavs(dir)
  let entries: string[]
  try {
    entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)
  } catch {
    return []
  }
  return entries
    .filter((n) => n.toLowerCase().endsWith('.wav'))
    .filter((n) => !n.endsWith('.context.wav'))
    .filter((n) => !EXCLUDED_WAVS.has(n) && !skip.has(n) && !n.startsWith('.'))
    .sort()
}

/** Arm names with a conventional order — a before/after pair reads backwards if `after` sorts
 * first. Anything unlisted sorts alphabetically after these. */
const ARM_ORDER: Record<string, number> = {
  before: 0, baseline: 0, orig: 0, original: 0, unlayered: 0, a: 0, old: 0, control: 0,
  after: 1, new: 1, treatment: 1, b: 1, c: 2,
}
/** Rank a whole arm name, falling back to its last dash-segment — so an arm that did NOT fold
 * (`heldout-before` / `heldout-after`, when no bare `after` exists to fold against) still reads
 * before-then-after rather than alphabetically backwards. */
const armRank = (arm: string): number => {
  const lower = arm.toLowerCase()
  const whole = ARM_ORDER[lower]
  if (whole !== undefined) return whole
  const dash = lower.lastIndexOf('-')
  return (dash > 0 ? ARM_ORDER[lower.slice(dash + 1)] : undefined) ?? 10
}

/** Split `name` into `{stem, arm}` on the given separator: the LAST segment is the arm.
 * Returns null when the name has no separator (a single-segment name has no arm). */
function splitArm(name: string, sep2: string): { stem: string; arm: string } | null {
  const at = name.lastIndexOf(sep2)
  if (at <= 0 || at + sep2.length >= name.length) return null
  return { stem: name.slice(0, at), arm: name.slice(at + sep2.length) }
}

interface ArmGroup { stem: string; qualifier: string; arms: { arm: string; file: string }[] }

/**
 * Group a directory's wavs into comparisons by a shared ARM TOKEN — the general rule behind both
 * real on-disk layouts:
 *
 *   retarget-check/bassline/  `bassline--deep-sub-bass--before.wav` / `--after.wav`
 *                             `bassline--deep-sub-bass--heldout-before.wav` / `--heldout-after.wav`
 *                             -> two comparisons: the search figure and the held-out figure, each
 *                                {before, after}. The held-out qualifier is folded into the STEM,
 *                                not the arm, because "does the after hold on a figure the search
 *                                never saw" is a different question from "is the after better" —
 *                                the LISTEN.md for that set says so in as many words.
 *
 *   compose-lab/renders/      `amt-harmonize-1.wav` / `ca2-harmonize-1.wav`
 *                             -> the arm is the LEADING token, so both orientations are tried and
 *                                whichever explains more files wins.
 *
 * A directory whose wavs are all single-segment names (`engineplus.wav`, `layered.wav`,
 * `layeredplus.wav`) yields no groups here — the caller then treats the whole directory as one
 * comparison, which is exactly right for `layered-check/<case>/`.
 */
export function groupByArmToken(files: string[]): ArmGroup[] {
  if (files.length < 2) return []
  const stems = files.map((f) => f.replace(/\.wav$/i, ''))
  const sep2 = stems.some((s) => s.includes('--')) ? '--' : '-'

  const build = (orientation: 'last' | 'first'): ArmGroup[] => {
    const raw: { stem: string; arm: string; file: string }[] = []
    for (let i = 0; i < stems.length; i++) {
      const name = stems[i]!
      let split: { stem: string; arm: string } | null
      if (orientation === 'last') {
        split = splitArm(name, sep2)
      } else {
        const at = name.indexOf(sep2)
        split = at <= 0 || at + sep2.length >= name.length ? null : { stem: name.slice(at + sep2.length), arm: name.slice(0, at) }
      }
      if (split === null) return []
      raw.push({ stem: split.stem, arm: split.arm, file: files[i]! })
    }
    // Fold a QUALIFIED arm (`heldout-after`) back into the stem when its final dash-segment is
    // itself a bare arm elsewhere in this directory. Self-limiting: with no bare `after` present,
    // `heldout-after` stays one opaque arm name.
    const bare = new Set(raw.map((r) => r.arm))
    const folded = raw.map((r) => {
      const dash = r.arm.lastIndexOf('-')
      if (dash > 0) {
        const tail = r.arm.slice(dash + 1)
        if (bare.has(tail)) return { stem: r.stem, qualifier: r.arm.slice(0, dash), arm: tail, file: r.file }
      }
      return { stem: r.stem, qualifier: '', arm: r.arm, file: r.file }
    })
    const byKey = new Map<string, ArmGroup>()
    for (const f of folded) {
      const key = f.qualifier === '' ? f.stem : `${f.stem}::${f.qualifier}`
      let g = byKey.get(key)
      if (g === undefined) { g = { stem: f.stem, qualifier: f.qualifier, arms: [] }; byKey.set(key, g) }
      g.arms.push({ arm: f.arm, file: f.file })
    }
    return [...byKey.values()]
      .filter((g) => g.arms.length >= 2 && new Set(g.arms.map((a) => a.arm)).size === g.arms.length)
      .map((g) => ({ ...g, arms: g.arms.sort((a, b) => armRank(a.arm) - armRank(b.arm) || a.arm.localeCompare(b.arm)) }))
      .sort((a, b) => a.stem.localeCompare(b.stem) || a.qualifier.localeCompare(b.qualifier))
  }

  const last = build('last')
  const first = build('first')
  const covered = (gs: ArmGroup[]) => gs.reduce((n, g) => n + g.arms.length, 0)
  // Ties go to `last`: a trailing arm token (`--before`/`--after`) is the more common convention
  // and the one both LISTEN.md-documented sets use.
  return covered(first) > covered(last) ? first : last
}

/**
 * Discover comparisons in a bare folder — no manifest required. Walks `root`, and for each
 * directory holding >= 2 option wavs either emits the arm-token groups (`groupByArmToken`) or, when
 * that finds none, emits the whole directory as ONE comparison.
 */
export function inferComparisons(root: string): { comparisons: AbComparison[]; note: string } {
  const comparisons: AbComparison[] = []
  let ignoredSingletons = 0
  const relId = (dir: string, name: string): string => {
    const rel = relative(root, dir)
    return rel === '' ? name : `${rel.split(sep).join('/')}/${name}`
  }

  const walk = (dir: string): void => {
    const wavs = optionWavsIn(dir)
    if (wavs.length >= 2) {
      const groups = groupByArmToken(wavs)
      if (groups.length > 0) {
        for (const g of groups) {
          const label = g.qualifier === '' ? g.stem : `${g.stem} (${g.qualifier})`
          comparisons.push({
            id: relId(dir, g.qualifier === '' ? g.stem : `${g.stem}--${g.qualifier}`),
            label,
            options: g.arms.map((a) => ({
              name: a.arm,
              wav: relative(root, join(dir, a.file)).split(sep).join('/'),
            })),
          })
        }
        ignoredSingletons += wavs.length - groups.reduce((n, g) => n + g.arms.length, 0)
      } else {
        const rel = relative(root, dir)
        const label = rel === '' ? basename(resolve(root)) : rel.split(sep).join('/')
        comparisons.push({
          id: rel === '' ? basename(resolve(root)) : rel.split(sep).join('/'),
          label,
          options: wavs.map((w) => ({
            name: w.replace(/\.wav$/i, ''),
            wav: relative(root, join(dir, w)).split(sep).join('/'),
          })),
        })
      }
    } else {
      ignoredSingletons += wavs.length
    }
    let subdirs: string[]
    try {
      subdirs = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'media' && e.name !== ANSWERS_DIR)
        .map((e) => e.name)
        .sort()
    } catch {
      return
    }
    for (const s of subdirs) walk(join(dir, s))
  }
  walk(resolve(root))

  const note =
    comparisons.length === 0
      ? 'no comparable renders found'
      : `inferred from the folder layout: ${comparisons.length} comparison(s)` +
        (ignoredSingletons > 0 ? `, ${ignoredSingletons} unpaired wav(s) ignored` : '') +
        '. No feedback.json here, so the question below is generic — an agent should write one.'
  return { comparisons, note }
}

// ---- loading ----------------------------------------------------------------------------------

const GENERIC_QUESTION =
  'Which of these sounds better to you, and why? The WHY matters more than the pick.'

function validateManifest(raw: unknown, path: string): AbManifest {
  if (raw === null || typeof raw !== 'object') throw new AbError(`${path}: must be a JSON object`)
  const m = raw as Partial<AbManifest>
  if (!Array.isArray(m.comparisons)) throw new AbError(`${path}: missing "comparisons" array`)
  const seen = new Set<string>()
  m.comparisons.forEach((c, i) => {
    if (typeof c?.id !== 'string' || c.id === '') throw new AbError(`${path}: comparisons[${i}] needs a string "id"`)
    if (seen.has(c.id)) throw new AbError(`${path}: duplicate comparison id "${c.id}"`)
    seen.add(c.id)
    if (!Array.isArray(c.options) || c.options.length < 2) {
      throw new AbError(`${path}: comparisons[${i}] ("${c.id}") needs at least 2 options`)
    }
    c.options.forEach((o, j) => {
      if (typeof o?.name !== 'string' || o.name === '') throw new AbError(`${path}: comparisons[${i}].options[${j}] needs a "name"`)
      if (typeof o?.wav !== 'string' || o.wav === '') throw new AbError(`${path}: comparisons[${i}].options[${j}] needs a "wav"`)
    })
  })
  return { question: typeof m.question === 'string' ? m.question : undefined, comparisons: m.comparisons }
}

export class AbError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AbError'
  }
}

/** Load a listening dir: the agent's `feedback.json` if it wrote one, otherwise inference. */
export function loadAbSet(dir: string): AbSet {
  const root = resolve(dir)
  const manifestPath = join(root, FEEDBACK_MANIFEST)
  if (existsSync(manifestPath)) {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (err) {
      throw new AbError(`${manifestPath}: not valid JSON (${String((err as Error).message)})`)
    }
    const m = validateManifest(raw, manifestPath)
    return { source: 'manifest', dir: root, question: m.question ?? GENERIC_QUESTION, comparisons: m.comparisons }
  }
  const { comparisons, note } = inferComparisons(root)
  return { source: 'inferred', dir: root, question: GENERIC_QUESTION, comparisons, inferenceNote: note }
}

/** The question actually asked for one comparison (per-comparison override wins). */
export const questionFor = (set: AbSet, c: AbComparison): string => c.question ?? set.question ?? GENERIC_QUESTION

/**
 * Options whose wav is not on disk, per comparison.
 *
 * CLI pilot 2026-07-26, the one HIGH finding: a manifest with a typo'd path passed every check.
 * `--status` reported the comparison healthy, the server started happily, and the page — whose
 * readiness wait falls back to a timeout — simply played nothing for that arm. In a sync-A/B
 * transport "press 2 and hear silence" reads to the owner as *that render is silent*, so they
 * answer in good faith about a file that never loaded and the tool records it as real data. That
 * is the only failure mode here that produces WRONG data rather than no data, so it is checked at
 * every entry point: `--status`, `--digest`, server startup, and per-option in the page.
 */
export function missingOptions(set: AbSet): { comparisonId: string; missing: string[]; total: number }[] {
  const out: { comparisonId: string; missing: string[]; total: number }[] = []
  for (const c of set.comparisons) {
    const missing = c.options.filter((o) => !existsSync(resolve(set.dir, o.wav))).map((o) => o.wav)
    if (missing.length > 0) out.push({ comparisonId: c.id, missing, total: c.options.length })
  }
  return out
}

/** True when this option's render is actually on disk. */
export const optionExists = (dir: string, wav: string): boolean => existsSync(resolve(dir, wav))

// ---- recording --------------------------------------------------------------------------------

/** `<root>/feedback-answers/<id>.json`, with `/` folded so a nested comparison id stays one file. */
export const answerPathFor = (root: string, id: string): string =>
  join(resolve(root), ANSWERS_DIR, `${id.replace(/[/\\]/g, '__').replace(/[^A-Za-z0-9_.+-]/g, '_')}.json`)

export interface RecordFeedbackInput {
  comparisonId: string
  label?: string
  question: string
  preference: AbPreference
  freeText: string
  flagged?: boolean
  options: { name: string; wav: string; note?: string }[]
  measurements?: Record<string, Record<string, number | string>>
}

export interface RecordFeedbackResult {
  logPath: string
  answerPath: string
  entry: FeedbackEntry
}

/**
 * Append one answer to `beat-feedback.jsonl` and write the per-comparison answer file.
 *
 * A preference naming no real option is refused, and so is an answer with neither a preference nor
 * free text — an empty row would be indistinguishable from a skip, and a skip is deliberately
 * recorded as NOTHING (the comparison simply comes back next session, same as `beat board`).
 */
export function recordFeedback(dir: string, input: RecordFeedbackInput, logPath?: string): RecordFeedbackResult {
  const root = resolve(dir)
  const names = input.options.map((o) => o.name)
  if (input.preference !== 'neither' && !names.includes(input.preference)) {
    throw new AbError(`preference "${input.preference}" is not one of: ${names.join(', ')} (or "neither")`)
  }
  const freeText = (input.freeText ?? '').trim()
  if (freeText === '' && input.preference === 'neither' && input.flagged !== true) {
    throw new AbError('"neither" with no note records nothing — say what was wrong with all of them, or skip (s).')
  }
  const entry: FeedbackEntry = {
    t: new Date().toISOString(),
    dir: root,
    comparisonId: input.comparisonId,
    question: input.question,
    preference: input.preference,
    freeText,
    ...(input.flagged === true ? { flagged: true } : {}),
    options: input.options.map((o) => ({ name: o.name, wav: o.wav, ...(o.note !== undefined ? { note: o.note } : {}) })),
    ...(input.measurements !== undefined && Object.keys(input.measurements).length > 0
      ? { measurements: input.measurements }
      : {}),
    nonBlind: true,
  }
  const resolvedLog = resolve(logPath ?? join(root, DEFAULT_FEEDBACK_LOG))
  appendFileSync(resolvedLog, JSON.stringify(entry) + '\n')

  // The answer file carries the SAME facts as the log row, not a subset. CLI pilot 2026-07-26: it
  // used to drop the label, the per-option provenance notes and the measurements, so the one
  // artifact named after the comparison was the one that could not explain what "layered" was —
  // an agent reading it saw a preference for a bare string.
  const answer: AnswerFile = {
    answered_at: entry.t,
    comparisonId: entry.comparisonId,
    ...(input.label !== undefined ? { label: input.label } : {}),
    question: entry.question,
    preference: entry.preference,
    freeText: entry.freeText,
    ...(entry.flagged === true ? { flagged: true } : {}),
    options: entry.options,
    ...(entry.measurements !== undefined ? { measurements: entry.measurements } : {}),
  }
  const answerPath = answerPathFor(root, input.comparisonId)
  mkdirSync(join(root, ANSWERS_DIR), { recursive: true })
  writeFileSync(answerPath, JSON.stringify(answer, null, 2) + '\n')
  return { logPath: resolvedLog, answerPath, entry }
}

/** Every feedback entry in a log, oldest first, tolerant of non-entry lines. */
export function readFeedbackLog(logPath: string): FeedbackEntry[] {
  if (!existsSync(logPath)) return []
  const out: FeedbackEntry[] = []
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      const e = JSON.parse(line) as Partial<FeedbackEntry>
      if (typeof e.comparisonId === 'string' && typeof e.preference === 'string' && Array.isArray(e.options)) {
        out.push(e as FeedbackEntry)
      }
    } catch {
      /* non-entry line */
    }
  }
  return out
}

/** The LATEST answer per comparison id for one listening dir — a re-answer supersedes, the log
 * keeps both (append-only). */
export function answersByComparison(logPath: string, dir?: string): Map<string, FeedbackEntry> {
  const root = dir === undefined ? null : resolve(dir)
  const out = new Map<string, FeedbackEntry>()
  for (const e of readFeedbackLog(logPath)) {
    if (root !== null && resolve(e.dir) !== root) continue
    out.set(e.comparisonId, e)
  }
  return out
}

/** Read one comparison's answer file, or null when unanswered. */
export function readAnswerFile(dir: string, id: string): AnswerFile | null {
  const path = answerPathFor(dir, id)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as AnswerFile
  } catch {
    return null
  }
}

// ---- --status ---------------------------------------------------------------------------------

export interface AbStatus {
  dir: string
  log: string
  source: 'manifest' | 'inferred'
  question: string
  total: number
  answered: number
  unanswered: number
  comparisons: {
    id: string
    label: string
    question: string
    options: string[]
    /** Option wavs that are NOT on disk — a comparison with any of these must not be auditioned. */
    missing: string[]
    answered: boolean
    preference?: AbPreference
    freeText?: string
    flagged?: boolean
  }[]
  /** Total options missing across the whole set — the number a caller decides to refuse on. */
  missingCount: number
}

/** The `--status` report (no server): what was asked, what came back, in the owner's own words.
 * Mirrors `beat board --status` — this is how an agent polls for answers without a browser. */
export function buildAbStatus(dir: string, logPath: string): AbStatus {
  const set = loadAbSet(dir)
  const answers = answersByComparison(logPath, set.dir)
  const comparisons = set.comparisons.map((c) => {
    const a = answers.get(c.id) ?? (readAnswerFile(set.dir, c.id) as FeedbackEntry | null)
    return {
      id: c.id,
      label: c.label ?? c.id,
      question: questionFor(set, c),
      options: c.options.map((o) => o.name),
      missing: c.options.filter((o) => !optionExists(set.dir, o.wav)).map((o) => o.wav),
      answered: a !== null && a !== undefined,
      ...(a ? { preference: a.preference, freeText: a.freeText } : {}),
      ...(a?.flagged === true ? { flagged: true } : {}),
    }
  })
  return {
    dir: set.dir,
    log: resolve(logPath),
    source: set.source,
    question: set.question ?? GENERIC_QUESTION,
    total: comparisons.length,
    answered: comparisons.filter((c) => c.answered).length,
    unanswered: comparisons.filter((c) => !c.answered).length,
    comparisons,
    missingCount: comparisons.reduce((n, c) => n + c.missing.length, 0),
  }
}

// ---- closing the loop: listen-bench candidates + the digest -----------------------------------

/**
 * Words that read as a complaint. A SUGGESTION mechanism only — the authoritative signals are the
 * owner's explicit "sounds wrong" flag and a `neither` verdict. Over-inclusion is cheap here
 * because everything this produces is a CANDIDATE a human or agent triages before banking, and the
 * cost of the opposite error is the one this whole module exists to fix: a complaint evaporating
 * into chat.
 */
const COMPLAINT_WORDS = [
  'worse', 'bad', 'wrong', 'muddy', 'harsh', 'grind', 'boring', 'flat', 'muffled', 'thin', 'weak',
  'same-ish', 'samey', 'sameish', 'dull', 'hate', 'awful', 'ugly', 'cluttered', 'boxy', 'honky',
  'brittle', 'fatiguing', 'clashing', 'off', 'sloppy', 'lifeless', 'washed', 'noisy', 'buzzy',
  "doesn't sound", 'does not sound', "don't like", 'do not like', 'not great', 'not good',
  'too much', 'too loud', 'too quiet', 'too bright', 'too dark', 'too wide', 'liked the',
  'prefer the', 'annoying', 'distract',
]

export type ComplaintTrigger = 'flag' | 'neither' | 'wording'

/**
 * A banked listening case proposal — the artifact that turns an owner complaint into an asset.
 *
 * Why a PAIR and not a clip: `docs/research/123` measured that the only machine-listening signal
 * that tracked the owner's ear (Daniel & Weber roughness) exists *only between matched renders of
 * the same material* — "roughness > X" as an absolute gate is dead on arrival. A `beat ab`
 * comparison is exactly a matched pair of the same material, and the owner has just labelled which
 * side is wrong and said why. That is the shape `listen-bench/` wants, and the reason the bench has
 * been stuck at n=1 (roadmap: "Bank owner-flagged listening misses into listen-bench/") is that
 * nothing produced pairs in that shape. This is the mechanism.
 */
export interface ListenBenchCandidate {
  /** ISO time of the owner's answer. */
  t: string
  /** Stable proposal id: the listening dir's basename + the comparison id. */
  id: string
  sourceDir: string
  comparisonId: string
  question: string
  /** The owner's exact words. The answer key's `finding` field starts as this, unedited. */
  quote: string
  /** What made this a candidate — the honest provenance of the judgement. */
  trigger: ComplaintTrigger
  /** The wav(s) the owner did NOT prefer (or all of them, on `neither`) — the "fail" side. */
  failWavs: string[]
  /** The preferred wav, when there is one — the matched "pass" side of the pair. */
  passWav?: string
  /** A pre-filled answer-key entry in the bench's own shape, so promoting a candidate is a paste
   * and a listen rather than a re-modelling job (CLI pilot 2026-07-26: the banking step used to
   * end in a sentence of homework). `finding` is the owner's words, untouched; the fields the
   * bench needs but this surface cannot know are present and empty. */
  answerKeyStub: {
    family: 'owner-flagged'
    finding: string
    fail: string
    pass: string | null
    /** MM:SS-MM:SS, for the human to fill from the listen. */
    span: ''
    /** 1-5, for the human to fill. */
    severity: ''
    band: ''
    source: string
  }
}

/** Turn answered comparisons into listen-bench case proposals. Pure — takes entries, returns
 * candidates; the caller decides whether to print or write them. */
export function listenBenchCandidates(entries: FeedbackEntry[]): ListenBenchCandidate[] {
  const out: ListenBenchCandidate[] = []
  for (const e of entries) {
    const lower = e.freeText.toLowerCase()
    const trigger: ComplaintTrigger | null =
      e.flagged === true ? 'flag'
      : e.preference === 'neither' ? 'neither'
      : COMPLAINT_WORDS.some((w) => lower.includes(w)) ? 'wording'
      : null
    if (trigger === null) continue
    if (e.freeText.trim() === '') continue // a complaint with no words is not a case
    const pass = e.options.find((o) => o.name === e.preference)
    const fail = e.options.filter((o) => o.name !== e.preference)
    const failWavs = fail.map((o) => join(resolve(e.dir), o.wav))
    const passWav = pass === undefined ? null : join(resolve(e.dir), pass.wav)
    const id = `${basename(resolve(e.dir))}--${e.comparisonId.replace(/[/\\]/g, '__')}`
    out.push({
      t: e.t,
      id,
      sourceDir: e.dir,
      comparisonId: e.comparisonId,
      question: e.question,
      quote: e.freeText,
      trigger,
      failWavs,
      ...(passWav !== null ? { passWav } : {}),
      answerKeyStub: {
        family: 'owner-flagged',
        finding: e.freeText,
        fail: failWavs[0] ?? '',
        pass: passWav,
        span: '',
        severity: '',
        band: '',
        source: `beat ab ${e.dir} — ${e.comparisonId} (${e.t})`,
      },
    })
  }
  return out
}

/** Where `--bank-listen-bench` writes its proposals. Not inside `listen-bench/` itself: that
 * directory is private data with a hand-maintained answer key, and an automatic writer into it
 * would be banking unreviewed cases. This is the inbox; promotion stays a human/agent step. */
export const LISTEN_BENCH_CANDIDATES_FILE = 'listen-bench-candidates.json'

export interface AbDigest {
  dir: string
  question: string
  total: number
  answered: number
  unanswered: number
  /** option name (or 'neither') -> how many comparisons preferred it. Only populated when the
   * answered comparisons SHARE an option vocabulary; see `buildDigest`. */
  preferences: { name: string; count: number }[]
  /** Set when the answered comparisons do not share an option vocabulary, so a tally would be
   * meaningless. The digest then prints per-comparison instead. */
  preferencesNote?: string
  /** Every answer with words, newest last — verbatim, for relaying. */
  quotes: { comparisonId: string; label: string; preference: AbPreference; freeText: string; flagged: boolean }[]
  candidates: ListenBenchCandidate[]
  unansweredIds: string[]
}

/** The agent-facing digest: preferences, VERBATIM quotes, and the listen-bench candidates. Built so
 * a coordinator relays the owner's actual words instead of a paraphrase — the specific failure
 * (2026-07-26) this whole surface exists to fix. */
export function buildDigest(dir: string, logPath: string): AbDigest {
  const set = loadAbSet(dir)
  const answers = answersByComparison(logPath, set.dir)
  const labels = new Map(set.comparisons.map((c) => [c.id, c.label ?? c.id]))
  const counts = new Map<string, number>()
  const quotes: AbDigest['quotes'] = []
  for (const c of set.comparisons) {
    const a = answers.get(c.id)
    if (a === undefined) continue
    counts.set(String(a.preference), (counts.get(String(a.preference)) ?? 0) + 1)
    if (a.freeText.trim() !== '') {
      quotes.push({
        comparisonId: a.comparisonId,
        label: labels.get(a.comparisonId) ?? a.comparisonId,
        preference: a.preference,
        freeText: a.freeText,
        flagged: a.flagged === true,
      })
    }
  }
  const answeredEntries = set.comparisons.map((c) => answers.get(c.id)).filter((a): a is FeedbackEntry => a !== undefined)

  // A tally of arm names only means something when the answered comparisons are asking the SAME
  // question of the SAME arms (layered-check: every case is engineplus/layered/layeredplus). Over a
  // mixed set it would present a row of unrelated single votes as a preference — CLI pilot
  // 2026-07-26, LOW. When the vocabularies differ, say so and let the quotes carry the report.
  const vocab = answeredEntries.map((e) => e.options.map((o) => o.name).sort().join(' '))
  const sharedVocab = vocab.length <= 1 || vocab.every((v) => v === vocab[0])
  const preferences = sharedVocab
    ? [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    : []

  return {
    dir: set.dir,
    question: set.question ?? GENERIC_QUESTION,
    total: set.comparisons.length,
    answered: answeredEntries.length,
    unanswered: set.comparisons.length - answeredEntries.length,
    preferences,
    ...(sharedVocab
      ? {}
      : { preferencesNote: 'these comparisons do not share an option vocabulary — a tally across them would be meaningless, so the per-comparison verdicts below are the report' }),
    quotes,
    candidates: listenBenchCandidates(answeredEntries),
    unansweredIds: set.comparisons.filter((c) => !answers.has(c.id)).map((c) => c.id),
  }
}

/** The digest as the text an agent (or a coordinator relaying to the owner) reads. */
export function formatDigest(d: AbDigest): string {
  const lines: string[] = []
  lines.push(`feedback digest — ${d.dir}`)
  lines.push(`question: ${d.question}`)
  lines.push(`${d.total} comparison(s): ${d.answered} answered, ${d.unanswered} unanswered`)
  lines.push('')
  if (d.answered === 0) {
    lines.push('no answers yet — run: beat ab ' + d.dir)
    return lines.join('\n') + '\n'
  }
  if (d.preferences.length > 0) {
    lines.push('PREFERENCES')
    const width = Math.max(...d.preferences.map((p) => p.name.length))
    for (const p of d.preferences) {
      lines.push(`  ${p.name.padEnd(width)}  ${String(p.count).padStart(3)}  ${'#'.repeat(p.count)}`)
    }
  } else if (d.preferencesNote !== undefined) {
    lines.push('PREFERENCES')
    lines.push(`  (not tallied — ${d.preferencesNote})`)
    for (const q of d.quotes) lines.push(`  ${q.label}: ${q.preference}`)
  }
  lines.push('')
  lines.push('VERBATIM — the owner\'s actual words. RELAY THESE, do not paraphrase.')
  if (d.quotes.length === 0) {
    lines.push('  (none — every answer was a bare preference. The why is missing.)')
  }
  for (const q of d.quotes) {
    lines.push(`  ${q.label}  [${q.preference}]${q.flagged ? '  (flagged: sounds wrong)' : ''}`)
    lines.push(`    "${q.freeText}"`)
  }
  if (d.candidates.length > 0) {
    lines.push('')
    lines.push(`LISTEN-BENCH CANDIDATES (${d.candidates.length}) — matched pairs from complaints (research/123: the`)
    lines.push('roughness signal only exists BETWEEN matched renders, so a pair is the bankable unit)')
    for (const c of d.candidates) {
      lines.push(`  ${c.id}  (trigger: ${c.trigger})`)
      lines.push(`    fail: ${c.failWavs.join(', ')}`)
      if (c.passWav !== undefined) lines.push(`    pass: ${c.passWav}`)
      lines.push(`    "${c.quote}"`)
    }
    lines.push(`  bank them (writes ${LISTEN_BENCH_CANDIDATES_FILE} with a pre-filled answer-key stub per pair):`)
    lines.push(`    beat ab ${d.dir} --bank-listen-bench`)
  }
  if (d.unansweredIds.length > 0) {
    lines.push('')
    lines.push(`STILL UNANSWERED (${d.unansweredIds.length}): ${d.unansweredIds.slice(0, 8).join(', ')}${d.unansweredIds.length > 8 ? ' …' : ''}`)
  }
  return lines.join('\n') + '\n'
}

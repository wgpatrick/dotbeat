// checkpoint / history / restore — "versioning without git vocabulary" (product-spec-desktop.md
// §4, research/11-versioning-ux.md). The project is already a git-friendly text file, so history
// is a plain local git repo in the project folder — no cloud, no shutdown risk (the Splice
// lesson), the user owns it. This module hides git entirely behind three musician-facing verbs:
// a checkpoint is a commit whose message is the semantic `beat diff` one-liner; history is the
// commit log for the file; "go back" (restore) is APPEND-ONLY — it writes the old bytes and takes
// a fresh checkpoint, never rewriting history (research 11 §2, the Figma model), so redo is free.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, readdirSync, realpathSync } from 'node:fs'
import { resolve, dirname, join, relative, sep } from 'node:path'
import { parse, diffDocuments, formatDiff } from '../core/index.js'

export class HistoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HistoryError'
  }
}

export interface HistoryEntry {
  ref: string // short sha — the checkpoint's handle for `restore`
  when: string // ISO date
  label: string // the semantic one-liner, a user label, or "checkpoint"
  intent?: string // the agent prompt that caused the edit, when one was passed
  pin?: string // the user-given name, when this checkpoint has been pinned
}

export type CheckpointResult = { skipped: true } | ({ skipped: false } & HistoryEntry)

export interface PinEntry {
  name: string // the pin's display name, <=25 chars
  ref: string // the pinned checkpoint's short sha
  when: string // ISO date of the pinned checkpoint
}

/** One row of the collapsed history view: a real checkpoint, or a folded run of unnamed ones. */
export type HistoryRow = ({ kind: 'checkpoint' } & HistoryEntry) | { kind: 'collapsed'; count: number }

// Commit identity so history works with no global git config (the project's zero-setup stance).
const IDENTITY = ['-c', 'user.name=dotbeat', '-c', 'user.email=history@dotbeat.local']

// Pins are plain git tags, namespaced under this prefix so they never collide with anything a
// user might tag by hand outside dotbeat. No new sidecar file format, no cloud: a pin is just
// another ref in the same local repo, so it survives copy/clone/backup exactly like a checkpoint
// does (research 11 / product-spec-desktop.md §4's "no shutdown risk" property extends for free).
const PIN_PREFIX = 'pin/'
const PIN_MAX_LEN = 25 // Figma named-version title length (research 11 §1) — same budget here

// Field/record separators that cannot occur in commit text — safe to split the log on.
const FIELD = '\x1f'
const RECORD = '\x1e'
const LOG_FORMAT = ['%h', '%aI', '%s', '%(trailers:key=Intent,valueonly)'].join(FIELD) + RECORD

function git(repoRoot: string, args: string[]): string {
  // Capture (don't inherit) stderr: several call sites probe with git commands that are expected
  // to fail (unborn branch, unknown ref) and handle it — leaking git's "fatal:" lines would break
  // the no-git-vocabulary promise. Genuine failures still carry the message on the thrown error.
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
}

/** Path relative to the repo root, forward-slashed — the form `git show <ref>:<path>` wants. */
function relpath(repoRoot: string, abs: string): string {
  return relative(repoRoot, abs).split(sep).join('/')
}

/**
 * Resolve to an absolute path, realpath'd when the file already exists. Every caller pairs this
 * with a repo root from `ensureHistoryRepo` (also realpath'd) so `relpath` never has to cross a
 * symlink boundary (see `ensureHistoryRepo`'s comment) — otherwise `relative()` computes a path
 * with a run of `../` that walks git's `-C` root right out of the repository.
 */
function realAbs(p: string): string {
  const abs = resolve(p)
  try {
    return realpathSync(abs)
  } catch {
    return abs // doesn't exist yet — nothing to resolve through
  }
}

/**
 * If projectDir is already inside a git work tree, use that repo (never nest a second one);
 * otherwise `git init` the folder. Returns the repo root.
 *
 * The path is resolved through realpath first: on macOS `os.tmpdir()` (and thus every temp
 * project dir in tests) lives under `/var/folders/...`, itself a symlink to
 * `/private/var/folders/...`. Handing git the symlinked path works for `rev-parse`/`init`, but
 * later commands that mix a symlinked `-C` root with an already-realpath'd path (e.g. from
 * `--show-toplevel`, which git always resolves) report the file as "outside repository" even
 * though it plainly isn't. Resolving once here keeps every path in this module on the same side
 * of the symlink.
 */
export function ensureHistoryRepo(projectDir: string): string {
  const dir = realpathSync(resolve(projectDir))
  try {
    const inside = execFileSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (inside === 'true') return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  } catch {
    // not a work tree — fall through and init one
  }
  execFileSync('git', ['-C', dir, 'init', '-q'], { encoding: 'utf8' })
  return dir
}

/** The prior committed version of the file, or null on an unborn branch / a file HEAD never saw. */
function prevDoc(repoRoot: string, rel: string): ReturnType<typeof parse> | null {
  try {
    return parse(git(repoRoot, ['show', `HEAD:${rel}`]))
  } catch {
    return null
  }
}

function parseLog(out: string): HistoryEntry[] {
  return out
    .split(RECORD)
    .map((rec) => rec.replace(/^\n/, '')) // git separates records with a newline
    .filter((rec) => rec.trim() !== '')
    .map((rec) => {
      const [ref = '', when = '', label = '', intent = ''] = rec.split(FIELD)
      const entry: HistoryEntry = { ref, when, label }
      const trimmed = intent.trim()
      if (trimmed) entry.intent = trimmed
      return entry
    })
}

function logEntries(repoRoot: string, rel: string, limit?: number): HistoryEntry[] {
  const args = ['log', `--format=${LOG_FORMAT}`]
  if (limit !== undefined) args.push('-n', String(limit))
  args.push('--', rel)
  try {
    return parseLog(git(repoRoot, args))
  } catch {
    return [] // unborn branch: no commits yet
  }
}

/** Full (40-char) commit shas touching this file, newest first — same filter as `logEntries`, so
 *  entry `i` here is always the same commit as entry `i` of `logEntries(repoRoot, rel, limit)`. */
function fileFullShas(repoRoot: string, rel: string, limit?: number): string[] {
  const args = ['log', '--format=%H']
  if (limit !== undefined) args.push('-n', String(limit))
  args.push('--', rel)
  try {
    return git(repoRoot, args)
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

/** Lowercase, hyphenated, alphanumeric-only — the form a git tag name (and a stable slug) wants. */
function slugifyPinName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'pin'
}

/** Every `pin/*` tag in the repo: its tag name, display name (the annotation message), and the
 *  full sha of the commit it points at. Repo-wide — callers filter down to one file's commits. */
function listPinRefs(repoRoot: string): { tag: string; name: string; commit: string }[] {
  let out: string
  try {
    out = git(repoRoot, ['for-each-ref', `refs/tags/${PIN_PREFIX}*`, `--format=%(refname:short)${FIELD}%(contents:subject)${FIELD}%(*objectname)${RECORD}`])
  } catch {
    return []
  }
  return out
    .split(RECORD)
    .map((rec) => rec.replace(/^\n/, ''))
    .filter((rec) => rec.trim() !== '')
    .map((rec) => {
      const [tag = '', name = '', commit = ''] = rec.split(FIELD)
      return { tag, name, commit }
    })
}

/** Attach each entry's pin name (if any of this file's checkpoints have one). */
function attachPins(repoRoot: string, rel: string, entries: HistoryEntry[]): HistoryEntry[] {
  const tagRefs = listPinRefs(repoRoot)
  if (tagRefs.length === 0) return entries
  const fullShas = fileFullShas(repoRoot, rel, entries.length)
  const nameByFullSha = new Map(tagRefs.map((t) => [t.commit, t.name]))
  return entries.map((e, i) => {
    const pinName = nameByFullSha.get(fullShas[i] ?? '')
    return pinName ? { ...e, pin: pinName } : e
  })
}

/**
 * Stage the .beat file (and any sibling media/) and commit. The message is the caller's label, or
 * the semantic diff one-liner(s) vs HEAD, or "checkpoint" when there's no prior version or no
 * musical change. Returns { skipped: true } WITHOUT committing when the .beat file is unchanged
 * vs HEAD — a checkpoint that recorded nothing would just be timeline noise.
 */
export function checkpoint(beatFilePath: string, opts: { label?: string; intent?: string } = {}): CheckpointResult {
  const abs = realAbs(beatFilePath)
  const projectDir = dirname(abs)
  const repoRoot = ensureHistoryRepo(projectDir)
  const rel = relpath(repoRoot, abs)

  if (git(repoRoot, ['status', '--porcelain', '--', rel]).trim() === '') return { skipped: true }

  let subject = opts.label
  if (!subject) {
    const prev = prevDoc(repoRoot, rel)
    if (prev) {
      const entries = diffDocuments(prev, parse(readFileSync(abs, 'utf8')))
      subject = entries.length ? formatDiff(entries).trimEnd() : 'checkpoint'
    } else {
      subject = 'checkpoint'
    }
  }
  const message = opts.intent ? `${subject}\n\nIntent: ${opts.intent}` : subject

  git(repoRoot, ['add', '--', rel])
  const mediaDir = join(projectDir, 'media')
  if (existsSync(mediaDir) && readdirSync(mediaDir).length > 0) git(repoRoot, ['add', '--', relpath(repoRoot, mediaDir)])

  git(repoRoot, [...IDENTITY, 'commit', '-q', '-m', message])

  const entry = logEntries(repoRoot, rel, 1)[0]
  if (!entry) throw new HistoryError('checkpoint committed but could not be read back') // should never happen
  return { skipped: false, ...entry }
}

/** Checkpoints touching this file, newest first — pinned ones carry their pin name. */
export function history(beatFilePath: string, opts: { limit?: number } = {}): HistoryEntry[] {
  const abs = realAbs(beatFilePath)
  const repoRoot = ensureHistoryRepo(dirname(abs))
  const rel = relpath(repoRoot, abs)
  return attachPins(repoRoot, rel, logEntries(repoRoot, rel, opts.limit))
}

/**
 * The same list as `history()`, but unnamed checkpoints between pins collapse into a single
 * `{ kind: 'collapsed', count }` row (spec §4 / research 11 §1: "unnamed checkpoints collapse
 * between named ones so the timeline skims"). A leading or trailing run of unnamed checkpoints
 * collapses too — pins are the only thing that stays expanded.
 */
export function collapsedHistory(beatFilePath: string, opts: { limit?: number } = {}): HistoryRow[] {
  const entries = history(beatFilePath, opts)
  const rows: HistoryRow[] = []
  let run = 0
  for (const e of entries) {
    if (e.pin) {
      if (run > 0) {
        rows.push({ kind: 'collapsed', count: run })
        run = 0
      }
      rows.push({ kind: 'checkpoint', ...e })
    } else {
      run++
    }
  }
  if (run > 0) rows.push({ kind: 'collapsed', count: run })
  return rows
}

/**
 * "Go back" to an earlier checkpoint: write that version's bytes, then take a fresh checkpoint
 * (append-only — the current state stays recoverable, redo is free). Fails loudly if the ref is
 * unknown or never had a version of this file.
 */
export function restore(beatFilePath: string, ref: string): CheckpointResult {
  const abs = realAbs(beatFilePath)
  const repoRoot = ensureHistoryRepo(dirname(abs))
  const rel = relpath(repoRoot, abs)

  let fullRef: string
  try {
    fullRef = git(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`]).trim()
  } catch {
    throw new HistoryError(`unknown checkpoint "${ref}"`)
  }
  const shortRef = git(repoRoot, ['rev-parse', '--short', fullRef]).trim()
  let content: string
  try {
    content = git(repoRoot, ['show', `${fullRef}:${rel}`])
  } catch {
    throw new HistoryError(`checkpoint ${shortRef} has no saved version of ${rel} to go back to`)
  }
  const subject = git(repoRoot, ['log', '-1', '--format=%s', fullRef]).trim()

  writeFileSync(abs, content)
  return checkpoint(abs, { label: `go back to ${shortRef} (${subject})` })
}

/**
 * "Pin" a checkpoint with a short name ("rough mix v1", "the good bridge" — spec §4/research 11
 * §1, Figma named versions, <=25 chars). Implemented as a git tag, namespaced `pin/<slug>`,
 * annotated with the exact display name so it round-trips without lossy un-slugging. Tags are
 * immutable refs in the same local repo as the checkpoints themselves — no new file format, no
 * cloud, nothing `restore`'s append-only model can invalidate (a tagged commit is never deleted).
 * Fails loudly on an empty/too-long name, an unknown ref, a ref that isn't a checkpoint of this
 * file, or a name already in use.
 */
export function pin(beatFilePath: string, ref: string, name: string): PinEntry {
  const trimmed = name.trim()
  if (!trimmed) throw new HistoryError('a pin needs a name')
  if (trimmed.length > PIN_MAX_LEN) throw new HistoryError(`pin names are ${PIN_MAX_LEN} characters or fewer ("${trimmed}" is ${trimmed.length})`)

  const abs = realAbs(beatFilePath)
  const repoRoot = ensureHistoryRepo(dirname(abs))
  const rel = relpath(repoRoot, abs)

  let fullRef: string
  try {
    fullRef = git(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`]).trim()
  } catch {
    throw new HistoryError(`unknown checkpoint "${ref}"`)
  }
  const shortRef = git(repoRoot, ['rev-parse', '--short', fullRef]).trim()

  if (!fileFullShas(repoRoot, rel).includes(fullRef)) throw new HistoryError(`checkpoint ${shortRef} has no saved version of ${rel} to pin`)

  const tagName = `${PIN_PREFIX}${slugifyPinName(trimmed)}`
  if (git(repoRoot, ['tag', '--list', tagName]).trim() !== '') throw new HistoryError(`a pin named "${trimmed}" already exists — unpin it first`)

  git(repoRoot, [...IDENTITY, 'tag', '-a', tagName, fullRef, '-m', trimmed])

  const when = git(repoRoot, ['log', '-1', '--format=%aI', fullRef]).trim()
  return { name: trimmed, ref: shortRef, when }
}

/** Remove a pin by name. Fails loudly if no pin has that name. */
export function unpin(beatFilePath: string, name: string): void {
  const trimmed = name.trim()
  const abs = realAbs(beatFilePath)
  const repoRoot = ensureHistoryRepo(dirname(abs))
  const tagName = `${PIN_PREFIX}${slugifyPinName(trimmed)}`
  if (git(repoRoot, ['tag', '--list', tagName]).trim() === '') throw new HistoryError(`no pin named "${trimmed}"`)
  git(repoRoot, ['tag', '-d', tagName])
}

/** This file's pins, newest checkpoint first. */
export function pins(beatFilePath: string): PinEntry[] {
  const abs = realAbs(beatFilePath)
  const repoRoot = ensureHistoryRepo(dirname(abs))
  const rel = relpath(repoRoot, abs)
  return attachPins(repoRoot, rel, logEntries(repoRoot, rel))
    .filter((e): e is HistoryEntry & { pin: string } => !!e.pin)
    .map((e) => ({ name: e.pin, ref: e.ref, when: e.when }))
}

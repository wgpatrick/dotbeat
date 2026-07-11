// checkpoint / history / restore — "versioning without git vocabulary" (product-spec-desktop.md
// §4, research/11-versioning-ux.md). The project is already a git-friendly text file, so history
// is a plain local git repo in the project folder — no cloud, no shutdown risk (the Splice
// lesson), the user owns it. This module hides git entirely behind three musician-facing verbs:
// a checkpoint is a commit whose message is the semantic `beat diff` one-liner; history is the
// commit log for the file; "go back" (restore) is APPEND-ONLY — it writes the old bytes and takes
// a fresh checkpoint, never rewriting history (research 11 §2, the Figma model), so redo is free.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
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
}

export type CheckpointResult = { skipped: true } | ({ skipped: false } & HistoryEntry)

// Commit identity so history works with no global git config (the project's zero-setup stance).
const IDENTITY = ['-c', 'user.name=dotbeat', '-c', 'user.email=history@dotbeat.local']

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
 * If projectDir is already inside a git work tree, use that repo (never nest a second one);
 * otherwise `git init` the folder. Returns the repo root.
 */
export function ensureHistoryRepo(projectDir: string): string {
  const dir = resolve(projectDir)
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

/**
 * Stage the .beat file (and any sibling media/) and commit. The message is the caller's label, or
 * the semantic diff one-liner(s) vs HEAD, or "checkpoint" when there's no prior version or no
 * musical change. Returns { skipped: true } WITHOUT committing when the .beat file is unchanged
 * vs HEAD — a checkpoint that recorded nothing would just be timeline noise.
 */
export function checkpoint(beatFilePath: string, opts: { label?: string; intent?: string } = {}): CheckpointResult {
  const abs = resolve(beatFilePath)
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

/** Checkpoints touching this file, newest first. */
export function history(beatFilePath: string, opts: { limit?: number } = {}): HistoryEntry[] {
  const abs = resolve(beatFilePath)
  const repoRoot = ensureHistoryRepo(dirname(abs))
  return logEntries(repoRoot, relpath(repoRoot, abs), opts.limit)
}

/**
 * "Go back" to an earlier checkpoint: write that version's bytes, then take a fresh checkpoint
 * (append-only — the current state stays recoverable, redo is free). Fails loudly if the ref is
 * unknown or never had a version of this file.
 */
export function restore(beatFilePath: string, ref: string): CheckpointResult {
  const abs = resolve(beatFilePath)
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

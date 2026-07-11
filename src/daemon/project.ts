// Project-folder resolution — the desktop shell (D1) opens a *folder*, not a file, so this maps
// a folder (or a file, for backward compatibility) onto the single `.beat` document the daemon
// should own, creating a starter project when the folder is empty.
//
// The contract deliberately mirrors "open a project" in a conventional DAW: point at a directory
// and get a working session. Keeping it pure (no daemon/HTTP deps) makes it testable headlessly
// and reusable by the CLI, the daemon, and the Tauri sidecar alike.

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { initDocument, serialize } from '../core/index.js'

export class ProjectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectError'
  }
}

export interface ResolveProjectOptions {
  /** Create a starter `.beat` when the target folder has none (or the named file is missing). Default true. */
  create?: boolean
  /** Filename to use when creating a starter project in a folder. Default `project.beat`. */
  defaultName?: string
  /** Passed through to `initDocument` when a starter project is created (bpm, loopBars). */
  init?: Parameters<typeof initDocument>[0]
}

export interface ResolveProjectResult {
  /** Absolute path to the resolved `.beat` file. */
  filePath: string
  /** Absolute path to the project folder that contains it. */
  dir: string
  /** True iff this call created the file (fresh starter project). */
  created: boolean
}

// A folder with several `.beat` files is ambiguous unless one carries a conventional project name.
const PREFERRED_NAMES = ['project.beat', 'song.beat']
const DEFAULT_NAME = 'project.beat'

function writeStarter(filePath: string, opts: ResolveProjectOptions): void {
  writeFileSync(filePath, serialize(initDocument(opts.init ?? {})))
}

/**
 * Resolve `target` (a folder or a `.beat` file) to the document the daemon should own.
 *
 * - An existing `.beat` file → used as-is.
 * - A `*.beat` path that doesn't exist → created (with its parent dir) when `create`.
 * - A folder with exactly one `.beat` → that file.
 * - A folder with several `.beat`s → the one named `project.beat`/`song.beat`, else ambiguity error.
 * - A folder (existing or not) with no `.beat` → a fresh `project.beat` when `create`.
 */
export function resolveProjectFile(target: string, opts: ResolveProjectOptions = {}): ResolveProjectResult {
  const create = opts.create ?? true
  const defaultName = opts.defaultName ?? DEFAULT_NAME
  const abs = resolve(target)

  const exists = existsSync(abs)
  const isFile = exists && statSync(abs).isFile()
  const isDir = exists && statSync(abs).isDirectory()

  // An existing file: must be a .beat, used directly.
  if (isFile) {
    if (!abs.endsWith('.beat')) throw new ProjectError(`${target} is not a .beat file`)
    return { filePath: abs, dir: dirname(abs), created: false }
  }

  // A non-existent path that names a .beat file: create it (and any missing parents).
  if (!exists && abs.endsWith('.beat')) {
    if (!create) throw new ProjectError(`${target} does not exist`)
    mkdirSync(dirname(abs), { recursive: true })
    writeStarter(abs, opts)
    return { filePath: abs, dir: dirname(abs), created: true }
  }

  // A path that exists but is neither file nor dir (socket, device, …): refuse.
  if (exists && !isDir) throw new ProjectError(`${target} is not a file or folder`)

  // From here on `target` is a folder — existing or to-be-created.
  if (isDir) {
    const beats = readdirSync(abs).filter((f) => f.endsWith('.beat')).sort()
    if (beats.length === 1) return { filePath: join(abs, beats[0]!), dir: abs, created: false }
    if (beats.length > 1) {
      const preferred = PREFERRED_NAMES.find((p) => beats.includes(p))
      if (preferred) return { filePath: join(abs, preferred), dir: abs, created: false }
      throw new ProjectError(
        `${target} has ${beats.length} .beat files (${beats.join(', ')}) and none is named ` +
          `project.beat or song.beat — pass the file path explicitly`,
      )
    }
    // Empty (of .beat files) folder.
    if (!create) throw new ProjectError(`${target} has no .beat file`)
    const filePath = join(abs, defaultName)
    writeStarter(filePath, opts)
    return { filePath, dir: abs, created: true }
  }

  // Folder doesn't exist yet: create it and a starter project inside.
  if (!create) throw new ProjectError(`${target} does not exist`)
  mkdirSync(abs, { recursive: true })
  const filePath = join(abs, defaultName)
  writeStarter(filePath, opts)
  return { filePath, dir: abs, created: true }
}

// Track 1a: the surge render prep step — turns a .beat with `surge` tracks into one the engine can
// play, BEFORE the engine boots (cli/render.mjs calls this from bootRenderSession).
//
// The rewrite itself (render/cache each surge track through python/surge_render.py, replace the
// track with the drums-kind SAMPLE host that plays that WAV through the track's own production
// block) lives in src/analysis/surge-host.ts, because the daemon's GUI playback companion needs
// the SAME render and the SAME host shape — see that file's header. What is left here is the file
// IO this step owns: parse the .beat, write the rewritten scratch beside it, delete it after.
//
// v1 honest limitations (docs/surge-track.md): only TRACK-LEVEL notes render (a surge track's
// clips/scenes/song arrangement is deferred); the host plays the whole rendered phrase once per
// loop; a knob edit re-renders on the next render (in the GUI, on the daemon's next re-render).

import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Resolve the repo root from this file (cli/ -> repo root is one up). */
const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..')

/**
 * If `beatPath` has any `surge` tracks, render each and return a rewritten scratch .beat path the
 * engine can play (drums-kind sample hosts); otherwise return the original path unchanged. Throws
 * on a surge render failure (surgepy/patch unavailable) — the fail-loudly-at-render contract.
 *
 * Returns { beatPath, isSurge, cleanup, info } — `cleanup()` removes the scratch (best-effort),
 * `info` is a short human summary of what rendered/cached (printed by the caller on stderr).
 */
export async function prepareSurgeTracks(beatPath) {
  const { parse, serialize } = await import(pathToFileURL(join(repoRoot, 'dist/src/core/index.js')).href)
  const { prepareSurgeDocument } = await import(pathToFileURL(join(repoRoot, 'dist/src/analysis/surge-host.js')).href)

  const doc = parse(readFileSync(beatPath, 'utf8'))
  const projectDir = dirname(beatPath)
  const prepared = await prepareSurgeDocument(doc, projectDir)
  if (!prepared.isSurge) return { beatPath, isSurge: false, cleanup: () => {}, info: null }

  const scratchPath = join(projectDir, `.render-surge.${basename(beatPath)}`)
  writeFileSync(scratchPath, serialize(prepared.doc))
  return {
    beatPath: scratchPath,
    isSurge: true,
    cleanup: () => {
      try {
        if (existsSync(scratchPath)) rmSync(scratchPath)
      } catch {
        /* best-effort */
      }
    },
    info: prepared.notes.join('\n'),
  }
}

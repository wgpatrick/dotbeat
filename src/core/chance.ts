// Per-note trigger probability (Phase 22 Stream AD; docs/research/22-opendaw-editing-workflow.md
// §3.3: "a per-note coin flip evaluated at playback time, skipping the note some percentage of
// passes... real-time, re-rolled per loop pass, not baked once"). This is the pure, testable half
// of the feature — the actual scheduler (ui/src/audio/engine.ts) hand-mirrors chanceFires here the
// same way it already hand-mirrors lfoSyncRateHz and other core pure functions (ui/ is a separate
// Vite package with no build-time dependency on src/core), so the RNG logic itself can be verified
// directly (test/chance.test.ts) without rendering audio 100 times per assertion.

/** mulberry32 — the same tiny deterministic PRNG humanize.ts/vary.ts already use (kept local; core
 * carries no shared PRNG module). One call advances the state and returns one uniform [0,1) draw. */
function mulberry32(seed: number): number {
  let a = seed >>> 0
  a |= 0
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** FNV-1a folding an arbitrary run of (pass, trackId, noteId) parts into one 32-bit seed, so
 * different notes — and the same note on a different pass — draw independently while the exact
 * same (pass, trackId, noteId) triple always draws the exact same value (reproducible, not just
 * "random"). */
function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261
  for (const part of parts) {
    const s = String(part)
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    h ^= 0x1f // part separator, so ("1","23") and ("12","3") don't collide
  }
  return h >>> 0
}

/** Whether a note fires on this playback pass. `chance` is the note's own 0-100 field (canonical
 * elision: >=100 always fires — the pre-v0.10 default, and short-circuits before touching the RNG
 * at all so a chance=100 note's behavior is byte-identical to today's). `pass` is a per-loop-cycle
 * counter the scheduler increments once per traversal (so the SAME note re-rolls independently
 * each time the loop comes back around, matching the research's "re-rolled per loop pass, not
 * baked once"); `trackId`/`noteId` scope the draw to this exact note. */
export function chanceFires(chance: number, pass: number, trackId: string, noteId: string): boolean {
  if (chance >= 100) return true
  if (chance <= 0) return false
  const draw = mulberry32(hashSeed(pass, trackId, noteId))
  return draw * 100 < chance
}

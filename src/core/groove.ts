// Groove/shuffle as a reversible time-WARP (Phase 22 Stream AD; docs/research/22-opendaw-editing-
// workflow.md §3.2). openDAW models groove as a pluggable MIDI-effect device that warps note
// positions live, at playback/query time, via a `warp()`/`unwarp()` pair — never baking the
// shuffle into stored note positions. That is the one genuinely new, worth-adopting idea from
// that research pass: it fits dotbeat's own "quantize is an operation you choose when to apply,
// not a storage default" philosophy far better than a destructive per-note swing offset would.
//
// dotbeat's own groove fields (BeatTrack.shuffleAmount/shuffleGrid — src/core/document.ts) are
// two literal, inspectable numbers; THIS module is the pure math that turns them into an actual
// time shift. It has no document/track dependency on purpose — the engine (ui/src/audio/
// engine.ts) calls warpStep at note-scheduling time; nothing here touches stored data.
//
// The math itself is openDAW's own (read from packages/studio/adapters/src/grooves/
// GrooveShuffleBoxAdapter.ts and packages/lib/std/src/math.ts's moebiusEase — vocabulary/shape,
// reimplemented, not copied; see the research doc's license note): a Möbius-transform ease curve
// applied within each "shuffle pair" (two adjacent grid cells — the on-beat cell stays put, the
// off-beat cell's position within the pair is eased toward later). `unwarpStep` is the EXACT
// inverse (verified by test/groove.test.ts, not just asserted): reversibility is the entire point
// of the warp/unwarp vocabulary — disabling groove, or reasoning about "real" note time (e.g. an
// editor overlay), can always get back to the ungrooved position with zero data loss.

/** The Möbius ease openDAW's groove adapter uses: a fractional-linear curve on x in [0,1] with
 * f(0)=0, f(1)=1, f(0.5)=h — so `h` is literally "where does the cell's midpoint land". h=0.5 is
 * the identity (f(x)=x for all x); h>0.5 delays the midpoint (the classic "shuffle" push), h<0.5
 * pulls it earlier. Exported for the test suite; not meant to be called directly by anything else
 * (warpStep/unwarpStep below are the real entry points). */
export function moebiusEase(x: number, h: number): number {
  if (h <= 0 || h >= 1) return x // outside the well-behaved (0,1) range: no-op rather than a pole
  return (x * h) / ((2 * h - 1) * (x - 1) + h)
}

/** Maps dotbeat's own shuffleAmount (0..1, 0 = off — the canonical default) onto moebiusEase's h
 * (0.5..1). This is the one place that decides "0 means truly no groove": at h=0.5, moebiusEase
 * is the identity for every x, so amount=0 leaves every position untouched — the elision contract
 * (BeatTrack.shuffleAmount default 0) and the warp math agree by construction. amount=1 reaches
 * h=1, openDAW's own field's far end. */
function shuffleH(amount: number): number {
  const a = Math.max(0, Math.min(1, amount))
  // Capped just short of 1: h=1 is a genuine pole of moebiusEase (every x != 0 collapses to 1),
  // not a "maximally shuffled" ease — so amount=1 (the far end of the dial) still gets a real,
  // strongly-shuffled curve instead of silently degenerating back toward a no-op.
  return Math.min(0.5 + a / 2, 0.999)
}

/** Warps a grid position (in 16th-step units, absolute — same coordinate space as BeatNote.start/
 * BeatDrumHit.start) by `amount`/`grid`. Cells pair up two `grid`-sized spans; the position's
 * offset WITHIN its pair is eased by moebiusEase, the pair's own placement on the timeline is
 * untouched (so grid=1 shuffles adjacent 16ths, grid=2 shuffles adjacent 8ths, etc. — the same
 * "grid" vocabulary quantize's own `grid` option uses). amount<=0 or a non-positive grid is a
 * no-op (identity), matching the format's "0 = off" elision. */
export function warpStep(step: number, amount: number, grid: number): number {
  if (!(amount > 0) || !(grid > 0)) return step
  const cell = grid * 2
  const cellIndex = Math.floor(step / cell)
  const x = (step - cellIndex * cell) / cell
  return cellIndex * cell + moebiusEase(x, shuffleH(amount)) * cell
}

/** The exact inverse of warpStep for the SAME (amount, grid): unwarpStep(warpStep(step, a, g), a,
 * g) === step (within floating-point epsilon — test/groove.test.ts asserts this directly, the
 * verification bar's "exact round-trip" requirement). Used wherever code needs to reason about a
 * note's true, ungrooved position (e.g. a future editor overlay) without touching stored data. */
export function unwarpStep(step: number, amount: number, grid: number): number {
  if (!(amount > 0) || !(grid > 0)) return step
  const cell = grid * 2
  const cellIndex = Math.floor(step / cell)
  const y = (step - cellIndex * cell) / cell
  return cellIndex * cell + moebiusEase(y, 1 - shuffleH(amount)) * cell
}

// A single, throttled requestAnimationFrame driver that every continuous-rate view subscribes to,
// rather than each meter/scope owning its own rAF loop. This is the enforced rendering discipline
// from docs/research/15 §2: anything that updates faster than the musical grid (scope, meters,
// smooth playhead later) runs off THIS loop reading refs/mutable buffers — never through Zustand
// state read every frame.
//
// Reimplemented (not copied) from openDAW's packages/lib/dom/src/frames.ts AnimationFrame pattern:
// a singleton fan-out over one rAF, throttled to ~60fps so a 120Hz ProMotion display doesn't
// double every subscriber's work. openDAW is AGPL/LGPL — this project reimplements its ideas
// rather than lifting code (docs/opendaw-notes.md's standing rule).

type FrameCallback = () => void

const callbacks = new Set<FrameCallback>()
let running = false
let last = 0
const MIN_INTERVAL_MS = 16 // ~60fps ceiling

function loop(timestamp: number): void {
  if (callbacks.size === 0) {
    running = false
    return
  }
  requestAnimationFrame(loop)
  if (timestamp - last < MIN_INTERVAL_MS) return
  last = timestamp
  for (const cb of callbacks) {
    try {
      cb()
    } catch (err) {
      console.error('[animationFrame] subscriber threw:', err)
    }
  }
}

/** Subscribe a per-frame callback. Returns an unsubscribe function; starts the shared loop on the
 * first subscriber and stops it when the last one leaves. */
export function onAnimationFrame(cb: FrameCallback): () => void {
  callbacks.add(cb)
  if (!running) {
    running = true
    last = 0
    requestAnimationFrame(loop)
  }
  return () => {
    callbacks.delete(cb)
  }
}

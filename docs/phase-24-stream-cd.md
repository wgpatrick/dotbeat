# Phase 24 Stream CD — Timeline zoom + a bar-number ruler

Scope (`docs/phase-24-plan.md` §CD): the arrangement timeline's `pxPerBar` was always
`laneWidth / totalBars` — fit-to-container-width, no independent zoom, and (as a direct consequence)
no horizontal scroll, since the rendered timeline could never exceed the container. Two related gaps,
both on the ruler row (`.arr-ruler`/`.arr-ruler-row` in `ui/src/components/ArrangementView.tsx`):
there was no way to zoom in past fit-to-width to see detail, and the ruler carried no per-bar tick
marks/numbers at all — only per-section labels (scene name + bar count).

## What changed

All of it lives in `ui/src/components/ArrangementView.tsx` (+ matching CSS in `ui/src/styles.css`).
No daemon, format, or CLI/MCP changes — this stream is pure GUI/session-state, per the plan.

### Zoom

- `pxPerBar` is now `zoomPxPerBar ?? fitPxPerBar`, where `fitPxPerBar` is the old
  `laneWidth / totalBars` computation (renamed, behavior unchanged) and `zoomPxPerBar` is new local
  component state (`useState<number | null>(null)`). `null` means "fit to width" — today's pre-Stream
  behavior, and still the default on load. Every existing reader of `pxPerBar` (the `detail` threshold,
  canvas sizing in `TrackRow`/`AutomationLane`, the ruler's rendered width, drag-to-select bar math,
  the resize-drag preview freeze) already went through this one variable, so decoupling it from
  `laneWidth` was the whole of the zoom feature's plumbing — no other code needed to change to make
  zoom "reach" the rest of the view.
- **Buttons**: a `−` / `43px/bar` / `+` / `fit` cluster (`.arr-zoom-controls`, `data-action="zoom-in"`
  / `"zoom-out"` / `"zoom-fit"`) added to the existing `.arr-length-bar` toolbar row, next to the
  overlap-policy selector. Each click steps the effective px/bar by `ZOOM_FACTOR` (1.4×), clamped to
  `[MIN_PX_PER_BAR, MAX_PX_PER_BAR]` = `[4, 256]`. `fit` resets `zoomPxPerBar` to `null`; it disables
  itself once already at fit, and the in/out buttons disable at their respective clamp.
- **Scroll-wheel zoom**: Cmd/Ctrl+wheel over the timeline (`onWheel` on `.arr-scroll`) zooms by the
  same `ZOOM_FACTOR` per tick, anchored to the pointer — the bar under the cursor stays under the
  cursor across the zoom change (computed from `.arr-scroll`'s `scrollLeft` + the pointer's viewport
  offset, then the scroll position is corrected on the next frame). A plain wheel (no modifier) is left
  alone and scrolls normally — it does not zoom.
- **Horizontal scroll**: no new scroll plumbing was needed. `.arr-scroll` already has `overflow: auto`
  (previously exercised only by the Phase 22 Stream AG resize-drag live preview), and `.arr-lane`/
  `.arr-ruler` were already sized from `pxPerBar * totalBars` in real CSS pixels (not percentage/flex
  sizing) — once that product exceeds the container, the browser overflows and the existing scrollbar
  appears on its own.
- **Sticky headers** (a small addition beyond the plan's literal ask, but necessary for the scroll to
  be usable rather than just present): `.arr-track-header` and `.arr-ruler-corner` are now
  `position: sticky; left: 0`, so track names/mixer strips and the ruler's corner stay pinned while
  the timeline scrolls horizontally under zoom — the same "frozen corner cell" idiom a spreadsheet
  uses. Without this, scrolling right to see zoomed-in content would scroll the track names off-screen
  too, defeating the point of being able to tell which row you're looking at.

### Bar-number ruler ticks

- `RULER_H` grew from a flat `26` to `26 + TICK_ROW_H` (13px), splitting the ruler into two strips: the
  existing section-label row on top, a new bar-tick strip (`.arr-bar-ticks`) along the bottom.
- Tick density is zoom-aware, reusing `DETAIL_PX_PER_BAR` (32, the existing note/hit rendering
  threshold) rather than inventing a second concept, per the plan's explicit instruction:
  `tickIntervalFor(pxPerBar)` returns 1 (every bar) once `pxPerBar >= DETAIL_PX_PER_BAR`, doubling the
  skip (2, 4, 8, 16 bars) as px/bar drops below that, in powers of two, so labels never overlap however
  far zoomed out.
- Once zoomed in even further (`pxPerBar >= DETAIL_PX_PER_BAR * 2` = 64px/bar), unlabeled minor ticks
  appear at each quarter-bar (beat) — "finer subdivision at high zoom," the same LOD instinct extended
  one step further.
- Ticks are `data-bar-tick={b}` divs with a `.arr-bar-tick-num` child showing `b + 1` (1-indexed, as
  musicians count bars), positioned via the same `renderPxPerBar`/`renderTotalBars` the section labels
  and resize-drag preview already use — so ticks track the live preview correctly during a section
  resize drag, not just steady-state.
- The whole tick layer is `pointer-events: none`, so it never intercepts the ruler's own
  drag-to-select-bars gesture (`beginDrag('ruler', e)`).

## Verification

`ui/verify-phase24-stream-cd.mjs` — Playwright-driven against a real `beat daemon` and the built GUI,
on `examples/night-shift-song.beat` (6 sections, 33 bars — plenty of headroom to overflow a 1280px
viewport once zoomed in). Checks, live:

- **A** Baseline is fit-to-width (no `.arr-scroll` overflow), with one tick per bar already present at
  the default viewport's px/bar.
- **B** Clicking zoom-in changes the *real* `pxPerBar` (read off a `data-pxperbar` attribute stamped on
  `.arr-ruler`, not inferred from a CSS class) and the ruler's actual rendered width; once zoomed in
  enough, `.arr-scroll.scrollWidth` genuinely exceeds `clientWidth` — structurally impossible at
  fit-to-width.
- **C** Scrolling `.arr-scroll` actually moves rendered content: a bar tick that was off-screen right
  becomes visible and its on-screen x decreases as the container scrolls right.
- **D** Every visible tick's label text is `bar + 1` and its on-screen x position matches
  `ruler.left + bar * pxPerBar` to within a few px.
- **E** Zoom-out clamps at `MIN_PX_PER_BAR` (button disables) rather than reaching zero/negative.
- **F** Zoom-fit restores `pxPerBar` to *exactly* the original baseline fit value and removes overflow.
- **G** Cmd/Ctrl+wheel changes `pxPerBar`; a plain wheel event does not.

Run: `node ui/verify-phase24-stream-cd.mjs`. All checks passed against this stream's implementation;
screenshot at `ui/verify-p24cd-zoom.png` shows the zoomed timeline mid-scroll — bar numbers along the
ruler, sticky track headers, section labels, and the `43px/bar … fit` zoom readout in the toolbar.

## Notes / follow-ups

- Session-only UI state, as directed: `zoomPxPerBar` is local `useState` in `ArrangementView`, never
  written to the `.beat` file — same treatment as mute/solo and group-collapse (the two precedents
  named in this stream's brief). Scroll position is native browser `scrollLeft`, not tracked in any
  app state either.
- Sticky track headers/ruler-corner are new visual behavior beyond the plan's literal text, added
  because horizontal scroll without them would be present-but-unusable (you'd lose track identity the
  moment you scrolled right). Flagged here in case it visually collides with Stream CA's resizable
  divider or Stream CC's clip-visualization work landing in the same file around the same time.
- `MAX_PX_PER_BAR` (256) is an arbitrary ceiling with headroom well past `DETAIL_PX_PER_BAR` (32) for
  the minor beat-tick LOD to matter; `MIN_PX_PER_BAR` (4) is a floor that keeps the ruler math sane
  (never zero/negative) rather than a considered "useful minimum."

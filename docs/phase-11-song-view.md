# Phase 11 Stream 2 — D4: the song view, first real slice

*Result of `docs/phase-11-plan.md`'s Stream 2. Owner direction: build the desktop app's
centerpiece screen — tracks as rows, bars as columns, notes visible across the whole song,
density-rendered when zoomed out, section boundaries labeled, selection lives here. Full
interaction polish explicitly not expected in one stream; a genuinely functional first slice
that renders real data and lets the owner drag-select a range was the bar.*

PR: **https://github.com/wgpatrick/beatlab/pull/6** (branch `song-view-d4` off beatlab `main`,
independent of the already-open clip-automation fix, `wgpatrick/beatlab#5`, which this doesn't
touch).

## What this is

`docs/product-spec-desktop.md` §5 names the full-song view as the biggest pure-GUI lift in the
whole project and, as of Phase 10, entirely unbuilt. This stream built the first real slice:
`src/components/SongView.tsx` in beatlab, a new view that renders a project's actual
`scenes`/`song` arrangement (format v0.4, `docs/format-spec.md` §6.2 in this repo) — tracks down
the left, bars across the top, section boundaries labeled from the real scene names, notes/hits
visible per track per section — and wires the D2 pointing protocol (drag bars, click a track
header) straight into the daemon's `POST /selection`, the same channel `beat vary --scope
selection` already reads server-side.

It's wired into beatlab's `App.tsx` alongside the existing structure/energy `ArrangementView`
branches, gated on `arrangement.mode === 'timeline'` — i.e. it renders automatically whenever a
project with a real `song` block loads through the daemon bridge. No new mode toggle was needed;
that gate already exists and previously had no view attached to it (timeline mode fell through to
the plain per-track editor with no arrangement UI at all).

## Research: canvas vs SVG vs virtualized DOM

Spent real time on this before writing the component, since a wrong call here is expensive to
redo. Starting point: the existing `PianoRoll.tsx` in beatlab renders one absolutely-positioned
`<div>` per note — fine at its scale (one track, one loop, tens of notes) but not something that
survives a song-length, multi-track view where hundreds of notes can be on screen across dozens
of bars simultaneously. Options considered:

- **DOM/SVG, one node per note** — what `PianoRoll.tsx` already does, and what
  `PianoRollSVGVisualizer` in Google's Magenta.js does too. Rejected for this view: DOM node
  count scales with total notes on screen, not with what's actually distinguishable at the
  current zoom, so it's exactly the wrong cost model for "dense timeline, zoomed out."
- **Canvas** — a single flat raster surface; draw calls are O(events actually rendered), fully
  decoupled from DOM node count, and redraws are one imperative pass rather than a reconciliation
  pass over a large tree. Concrete corroboration found: Magenta.js ships a
  `PianoRollCanvasVisualizer` *alongside* its SVG one, explicitly because it does not redraw the
  entire sequence the way the SVG version does; `dpren/react-piano-roll` offers only
  `CanvasRenderer`/`WebGLRenderer` options — no SVG renderer exists at all in that project. Both
  are real signals that dense-note rendering in practice converges on canvas over SVG.
- **WebGL** — the level up from canvas (`dpren/react-piano-roll`'s other option), justified at
  note counts well beyond what a single song-length arrangement realistically holds. Not chosen:
  real added complexity (shader/buffer management) not justified for a first slice; canvas's 2D
  context is more than enough for the note counts a song produces.
- **Virtualized DOM (windowing)** — solves a different problem (don't render off-screen rows) and
  doesn't by itself solve the "too many notes to draw legibly at once" problem within a rendered
  row. Track-row virtualization (only mount rows currently scrolled into view) is a reasonable
  follow-up optimization for very tall songs (many tracks), but doesn't replace canvas for the
  per-row note density problem, which is what the spec's "density-rendered when zoomed out"
  language is actually about.

**Decision: one `<canvas>` per track row.** Matches the existing `Scope.tsx`'s canvas-drawing
convention in this codebase (ref + `getContext('2d')`, redraw-on-relevant-state-change rather than
a constant `requestAnimationFrame` loop, since nothing here needs 60fps — redraws happen on
selection/data/viewport changes and once per playback step for the playhead).

### The density LOD, concretely

The spec's ask — "density-rendered when zoomed out" — has a well-known analog: audio waveform UIs
never draw every sample past a certain zoom-out level; they draw a min/max-peak-per-pixel
thumbnail instead. This view generalizes that to notes: below a px-per-bar threshold
(`DETAIL_PX_PER_BAR = 32`), each bar renders as one opacity-encoded block per track (opacity ∝
event count in that bar, normalized against a soft reference rather than a hard cap) instead of
individual note/hit glyphs. At or above the threshold, real ticks render — drum hits positioned
by lane (five stacked rows), synth notes positioned by pitch (mapped into the row height by the
bar's actual pitch range) and duration.

There is no interactive zoom control in this first slice (explicitly deferred — see below), so
"zoomed out" here is driven by how many song-bars have to fit the actual viewport
(`containerWidth / totalBars`, tracked live via `ResizeObserver`) rather than a user-operated
slider — a 20-bar song comfortably renders in detail mode at a normal window width; a 100+ bar
song automatically drops into density mode. Both code paths are real, not one being a stub — see
verification below, where both were driven and screenshotted.

## What was built

- `src/components/SongView.tsx` (new file) — the view itself: section-labeled ruler, one track
  row per track with a canvas note/density renderer, drag-to-select wired into
  `POST /selection` (pulls the current selection on mount, listens for the daemon's `selection`
  SSE event so an agent-set selection — the spec's reverse-pointing direction — shows up too, at
  near-zero extra cost since the channel already exists).
- `src/App.tsx` — one new branch: `arrangement.mode === 'timeline' ? <SongView /> : ...`,
  alongside the existing structure/energy branches.
- `src/styles.css` — one new block of song-view-scoped classes, following the existing
  `.editor-toolbar`/`.editor-title` and CSS-variable (`--panel`, `--accent`, etc.) conventions
  already used by `ArrangementView`.

Selection axes wired: **drag across the ruler** → `{ bars: { start, end } }` (all tracks); **drag
inside one track's row** → `{ tracks: [id], bars: { start, end } }`; **click a track header** →
`{ tracks: [id] }` (also sets beatlab's own `selectedTrackId`, so switching to the per-pattern
editor lands on the track that was just clicked). This covers the product spec's three named
song-view gestures directly ("drag across bars, click a track header, click a lane") except the
lane axis, which is deferred (below).

## Verified live (not against mocks)

Used `examples/night-shift-song.beat` from this repo directly — 4 tracks, 3 scenes, a 4-section/
20-bar song (`intro(4) build(4) drop(8) intro(4)`), already exercising multiple sections with a
mix of mapped and unmapped tracks per scene, so no new fixture was needed for the primary check.
Loaded it through a real `beat daemon` (`node cli/daemon.mjs ... --port 8930`) and the new view in
headless Chromium (Playwright via `playwright-core`, matching the `?daw=<port>` pattern every
other stream tonight used), then:

1. **Confirmed real data, not a blank/placeholder view.** Screenshot
   (`songview-detail.png`, described here since the raw file is scratch-only): the ruler shows
   "intro / build / drop / intro" labels with colored section-boundary dividers; the `lead` row
   is empty (no ticks) through intro+build and shows red note ticks only inside "drop"; `drums`
   and `bass` rows are empty through "intro" and show teal/gold ticks starting at "build"; `pad`
   shows purple ticks continuously from bar 0 — this is an exact match for the fixture's
   `scene intro: pad=groove`, `scene build: drums=groove bass=groove pad=groove`,
   `scene drop: lead=hook drums=groove bass=groove pad=groove` slot maps, not mock or placeholder
   content.
2. **Drag-selected bars 0-4 on the ruler** (all tracks), then ran, from the CLI side against the
   *same running daemon*:
   ```
   $ node cli/beat.mjs selection --port 8930
   selection
     bars 0 4
   ```
   — the daemon genuinely received the GUI's drag, not just a client-side visual.
3. **Clicked the `drums` track header**:
   ```
   $ node cli/beat.mjs selection --port 8930
   selection
     tracks drums
   ```
4. **Drag-selected bars 2-4 inside the `bass` track's row**:
   ```
   $ node cli/beat.mjs selection --port 8930
   selection
     tracks bass
     bars 2 4
   ```
   All three round trips also visually confirmed via screenshot (an orange selection band over
   the dragged bars, the `bass` header highlighted with an accent-colored left edge).
5. **Density LOD path**, since the primary fixture renders wide enough to stay in detail mode:
   built a second fixture with `beat song` — the same three scenes repeated to 25 sections / 132
   bars (`intro(4) build(4) drop(8)` × ~9, trailing `intro(4)`) — reloaded through a fresh daemon,
   and confirmed via the view's own toolbar tip and a screenshot that it switched to density mode
   automatically: `"132 bars · 25 sections · density view (6.0px/bar) · ..."`, rendering solid
   opacity-encoded blocks per bar instead of individual ticks, while still correctly reflecting
   which tracks are silent vs. playing per section (same intro/build/drop pattern, now legible as
   density bands rather than individual notes — exactly the LOD switch this was designed to
   produce, exercised for real rather than asserted from code reading alone).

`npx tsc --noEmit` and `node scripts/smoke.mjs` both clean in the beatlab checkout (14/14 smoke
checks passed, zero page errors). `scripts/smoke.mjs` was deliberately *not* extended to cover
`SongView` — it's scoped to audio-engine paths with no daemon involved at all, and none of
beatlab's other view components (`ArrangementView`, `SceneLauncher`, `PianoRoll`, ...) get smoke
coverage there either; bolting a daemon-backed GUI assertion onto an engine smoke suite would be
scope creep against its own stated purpose, not "fitting the existing pattern."

## What's explicitly deferred

- **Interactive zoom.** The density/detail LOD switch is automatic (driven by container width ÷
  total song bars) — there's no zoom slider or keyboard zoom yet. A real zoom control is the
  natural next increment and would let the LOD threshold do more useful work (e.g. deliberately
  zooming into a section to inspect individual notes on a long song).
- **Per-lane selection inside the song view.** The product spec's own worked example ("highlight
  the hi-hats") is a lane-level selection; this view supports whole-track and bar-range selection
  but not clicking an individual drum lane's sub-row within a song-view track row. The existing
  step sequencer already supports lane-level selection/editing for the currently-focused track;
  extending that same gesture into the song view's more compact per-bar rows is real, scoped
  follow-up work rather than something to rush into this slice.
- **Selection `bars`-axis semantics at song scale.** `src/core/selection.ts`'s `bars` axis
  resolves against a track's *live loop* step positions (`0..loopBars*16`), not song-timeline bar
  coordinates — a hangover from a protocol designed before the song view existed. This view posts
  real song-relative bar numbers (verified above), and the daemon happily stores and returns
  them, but `selectionToVaryScope`/`selectionToNoteIds` in this repo don't yet resolve a
  song-relative bars window against the right section's clip content — so `beat vary --scope
  selection` scoped to a song-view bar drag on a multi-section song won't yet vary the musically
  correct notes. The selection *value* round-trips correctly (this stream's job); making the
  *resolution* song-timeline-aware is dotbeat-repo core work, out of this GUI-only stream's scope,
  and is flagged here rather than silently assumed away.
- **Full interaction polish** generally, per the plan doc's own explicit scope-down: no
  multi-select of disjoint bar ranges, no keyboard-driven selection, no click-to-select an
  individual note within a bar (only whole-track / bar-range today).

## Files touched (beatlab repo, PR #6)

- `src/components/SongView.tsx` (new)
- `src/App.tsx` (one new render branch)
- `src/styles.css` (one new additive CSS block)

No changes to `src/audio/engine.ts` or `src/state/store.ts`, per the plan's scope guard — the view
reads existing store state (`tracks`, `scenes`, `arrangement`, `loopBars`, `currentStep`) and
calls the existing `selectTrack` action; selection itself is posted directly to the daemon from
the component, mirroring how `dawBridge.ts` already treats the daemon as the source of truth for
this ephemeral channel.

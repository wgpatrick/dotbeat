# Phase 24 Stream CE — loop only a highlighted section + click-to-seek/play-from-position

*Per `docs/phase-24-plan.md`'s Stream CE. Two related transport features, both touching
`ui/src/audio/engine.ts`'s `tick()`/`play()`/`stop()` and `ArrangementView.tsx`'s ruler pointer
surface, built together as scoped. Session-only transport state throughout — no `.beat` format
change.*

## What was built

### 1. Loop region (`ui/src/state/store.ts`)

A new session-only slice, `loopRegion: { start: number; end: number } | null`, plus `setLoopRegion`.
`null` (the default) means "loop the full song/loop," exactly today's behavior. A non-null value is
a `[start, end)` bar range — the SAME shape `BeatSelection.bars` already uses, deliberately, so it
composes with the existing selection axis rather than inventing a second bar-range representation.

Like mute/solo, group-collapse, the overlap-resolution policy, and CA/CD's pane-height/zoom state,
this is never written to the `.beat` file — looping a section while auditioning it is a listening
choice, not a musical fact the format's diff should carry (`docs/phase-24-plan.md`'s own framing,
matching `store.ts`'s existing "view/session state stays out of the file" precedent).

### 2. GUI affordance to set/clear it (`ArrangementView.tsx`)

Reuses the arrangement's existing bar-range SELECTION axis (`selection.bars`, set by dragging the
ruler or a track row — `docs/phase-13-views.md`'s "Selection wired to `/selection`", the same D2
pointing channel `beat vary --scope selection` reads) rather than building a second selection
mechanism, per the plan's explicit instruction:

- **A section chip's own "loop this section" toggle** (song mode only, `data-section-loop={i}`) — a
  small `⟲` button next to each section's resize/delete controls in the length bar. Loops exactly
  that section's `[startBar, startBar+bars)` range; clicking it again while already active clears the
  region (a toggle, not a one-way setter). Shows an `active` visual state when the currently-looping
  region matches that section's own range exactly.
- **A generic "loop selection" / "clear loop" pair** in the length bar (`data-loop-selection`/
  `data-loop-clear`), next to the overlap-policy selector. "loop selection" is enabled whenever a bar
  range is currently selected (via drag-the-ruler or drag-a-track, in either song or loop mode) and
  sets the region to that range. Once a region is active, the control switches to a badge
  (`looping bars N–M`) plus a "clear loop" button that returns to `null`.

Both paths funnel through one `setLoopRange` callback — the single place `loopRegion` gets written.

### 3. `engine.ts` wraps over the region when active

`tick()`'s wrap arithmetic was generalized rather than special-cased. Before this stream:

```ts
const totalSteps = songBars * 16
const rawStep = Math.round(transport.getTicksAtTime(time) / ticksPerStep)
const step = rawStep % totalSteps
const pass = Math.floor(rawStep / totalSteps)
```

After — `step`/`bar` stay ABSOLUTE within the whole song (`contentOf`'s section lookup needs that to
resolve the right scene/clip), only the WRAP POINT narrows when a region is active:

```ts
const region = this.resolveLoopRegion(songBars)          // null, or a clamped {start, end}
const wrapStartStep = (region ? region.start : 0) * 16
const wrapSteps = (region ? region.end - region.start : songBars) * 16
const rawStep = Math.round(transport.getTicksAtTime(time) / ticksPerStep)
const step = wrapStartStep + (((rawStep - wrapStartStep) % wrapSteps) + wrapSteps) % wrapSteps
const pass = Math.floor((rawStep - wrapStartStep) / wrapSteps)
```

With no region, `wrapStartStep = 0` and `wrapSteps = songBars*16`, reducing to exactly the original
formula — the null case is provably unchanged, not just "probably fine." `resolveLoopRegion` clamps
the stored range to `[0, songBars]` against the CURRENT document (so a region set on a longer song
degrades gracefully, not into an inverted/out-of-bounds range, if the song is later shortened) and
treats an empty/inverted result as inactive, same as `null`.

**A deliberate design choice, found the hard way**: `Tone.Transport`'s own NATIVE loop bounds
(`t.loopStart`/`t.loopEnd`) always stay the full song, unconditionally, exactly as before this
stream — they are never narrowed to the active region. The region is enforced ENTIRELY by the manual
modulo above, which wraps correctly for any magnitude of raw elapsed ticks with no dependency on
Tone's own loop-crossing bookkeeping. `play(startBar?)` only uses the region to pick the transport's
START position (`t.position = ${startBar ?? region?.start ?? 0}m`); a running transport picks up a
newly set/cleared region automatically on its very next scheduled tick, since `tick()` re-reads
`useStore.getState().loopRegion` fresh every call — no extra "push this to the engine" method needed.

### 4. Click-to-seek on the ruler

The ruler's `onPointerDown` (`beginDrag('ruler', e)`) already started a bar-range SELECT drag. This
stream adds the click-without-drag case: `beginDrag` now also records the raw pointerdown `clientX`
(`dragStartClientX`), and the window-level `pointerup` handler judges movement in raw pixels
(`CLICK_MOVE_PX = 4`) rather than bar delta — bar granularity alone would misclassify a real short
drag that doesn't cross a bar boundary as a click. A genuine click on the ruler axis calls
`engine.seek(bar)` instead of committing a selection; a real drag (or any drag on a track row axis,
untouched) behaves exactly as before.

`engine.seek(bar)`:

```ts
seek(bar: number): void {
  const clamped = Math.max(0, bar)
  if (useStore.getState().playing) {
    Tone.getTransport().position = `${clamped}m`
    useStore.setState({ currentStep: clamped * 16 }) // immediate UI nudge; tick() confirms next step
  } else {
    void this.play(clamped)
  }
}
```

Matches the plan's Ableton framing exactly: clicking while STOPPED starts playback AT the clicked
bar (`play(startBar)`); clicking while PLAYING just relocates the running transport's position,
never calling `stop()`/`start()` — confirmed live (verification check B2) that `playing` never
reports `false` at any point during a click-while-playing seek.

## A real bug found and fixed along the way (`engine.stop()`)

Building the loop-region live-verification test (below) surfaced a genuine, pre-existing latent race,
not something this stream's own new logic introduced, but one this stream's tighter test polling
made visible: `Tone.getDraw()` is a separate, rAF-driven callback queue keyed to real `AudioContext`
time, decoupled from `Tone.Transport`'s own start/stop — `t.clear(repeatId)` cancels FUTURE `tick()`
invocations, but a `tick()` that had already run just before `stop()` was called may have left its
own `Tone.getDraw().schedule(() => useStore.setState({currentStep: step, ...}), time)` callback still
queued. That callback fires once the real (always-advancing) `AudioContext` clock reaches its
scheduled `time`, REGARDLESS of whether the transport is still running — so a `play(bar)` call
shortly after a `stop()` could see the store's `currentStep` briefly show a stale value from the
SESSION THAT JUST ENDED before the new session's own first real tick landed.

Fixed with one line in `stop()`: `Tone.getDraw().cancel(0)`. Note the explicit `0` — calling
`cancel()` bare defaults its `after` argument to `now()`, which only cancels callbacks scheduled for
the FUTURE; an already-due-but-not-yet-flushed callback (scheduled time `<= now`, exactly the stale
straggler here) has `time <= after` and survives an argument-less cancel. `0` is safely before every
real `AudioContext` time (which only ever counts up from the context's own start), so it reliably
catches every pending callback regardless of how "due" it already is. This makes `stop()` a clean
cut rather than a fade-out of stale reads — a real correctness improvement for ANY quick stop-then-
restart, not just the loop-region case that surfaced it.

## Verification (`ui/verify-phase24-stream-ce.mjs`)

Real headless Chromium (Playwright), a real `beat daemon`, a real git-backed temp copy of
`examples/night-shift-song.beat` (the actual multi-section song project the whole Phase 24 batch was
scoped against — 6 sections, `intro(4) build(4) drop(13) intro(4) intro(4) intro(4)`, 33 bars total).
Reads `window.__store`/`window.__engine` (already exposed by `main.tsx` for exactly this purpose) to
assert on real transport/store state, not just DOM text.

- **A0 (control)** — plays from the interior "build" section (bars [4,8)) with NO loop region set,
  confirms playback genuinely crosses out of that range. Proves A1's boundary-respecting behavior is
  the loop region actually doing something, not a no-op that would've held anyway regardless.
- **A1** — clicks section 1's own "loop this section" chip (`[data-section-loop="1"]`), confirms the
  chip shows `active`, starts playback via the real `.play-btn`, then samples `currentStep` every
  50ms for 7 seconds (bpm temporarily bumped to 900 live, via `engine.setBpm` — never touches
  `doc.bpm`/the file — purely so several loop cycles fit in a short wall-clock window). Asserts every
  sampled bar stays within `[4, 8)` AND that a wrap was actually observed (a bar-count drop mid-run),
  not just "stalled at one bar."
- **B1/B2 (click-to-seek)** — B1: while stopped, a plain click on the ruler at bar 15 (inside "drop")
  starts playback there, confirmed via both `currentStep` and the real `.transport-readout.position`
  DOM text (`"16.1"`). B2: while playing, a plain click at bar 2 (inside "intro") relocates the
  playhead there — checked by polling `playing` continuously across the click (not just before/
  after) to prove the transport never reports stopped in between.
- **C (regression)** — a real drag on the ruler (movement past `CLICK_MOVE_PX`) still commits a
  bar-range `selection.bars`, unaffected by the click-vs-drag split.
- **D (session-only discipline)** — after all of the above (setting/clearing a loop region, two
  seeks, several play/stop cycles), the `.beat` file on disk is asserted BYTE-IDENTICAL to the
  baseline and `git diff --stat` is empty — this stream's own explicit non-goal (no format field)
  verified in practice, not just by code review.

All checks pass; `npm test` (root, 545/545/0/0) and both typechecks
(`npx tsc -p tsconfig.json`, `cd ui && npx tsc --noEmit`) are clean.

## Files

- `ui/src/state/store.ts` — `loopRegion`/`setLoopRegion` (additive).
- `ui/src/audio/engine.ts` — `resolveLoopRegion` (new private helper); `play()` gains an optional
  `startBar` param and reads the region for its start position; `tick()`'s wrap arithmetic
  generalized to an active region (see above); `seek()` (new); `stop()` gains `Tone.getDraw().cancel(0)`.
- `ui/src/components/ArrangementView.tsx` — loop-region controls (section-chip toggle + generic
  select/clear pair) and the click-to-seek pointerup handling; imports `engine`.
- `ui/src/styles.css` — `.arr-chip-loop`/`.arr-loop-region`/`.arr-loop-badge` (additive).
- `ui/verify-phase24-stream-ce.mjs` (new) — live verification, see above.

## Honest gaps / follow-ups

- **Multi-section (non-contiguous) loop regions.** The plan's own framing allows "one (or more
  contiguous) section(s)" — this stream's GUI affordances (a single section's chip, or a single
  dragged bar range) only ever produce ONE contiguous range. A drag across several adjacent section
  chips' combined bar span already works (the generic "loop selection" button doesn't care whether
  the selected range spans one or many sections), so *contiguous* multi-section looping is already
  reachable via drag-the-ruler; a dedicated "shift-click a second chip to extend the loop" gesture
  was not built — not asked for explicitly, and the drag path already covers the contiguous case.
- **Clicking outside an active loop region while playing.** Not exercised by the verification script
  and not given special handling: clicking the ruler at a bar outside the current region still seeks
  there immediately (per click-to-seek's own contract — the store's `currentStep` briefly reflects
  the clicked bar), but `tick()`'s wrap formula is magnitude-independent, so the very next scheduled
  16th-note tick snaps the position back inside the region rather than continuing from the clicked
  bar. Musically correct by construction (the region is still active; nothing should play outside
  it), but the readout would visibly flicker to the clicked bar and immediately back — a rough edge
  worth smoothing (e.g. clicking outside an active region could clear it, Ableton-style) if this
  comes up in practice. Not called out as a scenario in the plan, so flagged here rather than
  silently assumed away.

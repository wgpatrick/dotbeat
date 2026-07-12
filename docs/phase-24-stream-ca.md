# Phase 24 Stream CA — Resizable divider between the arrangement and the bottom pane

*2026-07-11. Per `docs/phase-24-plan.md`'s CA section: the owner's own complaint was that
`.bottom-pane` (the clip/device editor docked under the arrangement) is stuck at a fixed
`height: 42vh` with no way to drag it taller to see clip/device content more easily. Smallest,
most contained stream in this batch — no daemon route, no format change, touches three files.*

## What was built

### 1. `bottomPaneHeight` — session-only state (`ui/src/state/store.ts`)

A single new field, `bottomPaneHeight: number | null`, alongside its setter `setBottomPaneHeight`.
`null` means "use the CSS default" (`.bottom-pane`'s existing `height: 42vh` rule) — the common
case, so a session that never touches the divider renders byte-identical to before this stream. A
non-null value is a concrete pixel height set by dragging the divider.

This follows the exact precedent the plan pointed at: `mutes`/`solos` and `BeatGroup.collapsed`
are both view/session state that never rides in the `.beat` file (see the fuller rationale already
recorded on `mutes`/`solos` in `store.ts` — real DAWs keep this class of state out of saved
project content, and dotbeat's `formatDiff`/history story is built on every file write meaning
something musically). Pane height is exactly that: a "how am I looking at this right now"
preference, not a musical fact. It resets to the CSS default on reload rather than persisting
across sessions — trivial to upgrade to `localStorage` later if wanted, but the plan explicitly
scoped that as optional ("doesn't need to survive a page reload unless that's trivial to add"), and
piggybacking session state onto a browser storage channel felt like a separate decision worth its
own call, not a two-line add-on to this stream.

### 2. `PaneDivider` — the drag handle (`ui/src/App.tsx`)

A new small component rendered as a sibling between `.main-area` and `<BottomPane/>` inside
`.workspace`, only when a track is selected (the same condition `<BottomPane/>` itself is already
gated on — the divider only exists when there's a pane to resize).

Drag mechanics mirror `ArrangementView.tsx`'s own section-resize handle (`beginResize`) exactly —
same idiom, not a new one: a `pointerdown` captures a start position, a `useEffect` attaches
window-level `pointermove`/`pointerup` listeners for the duration of the drag (so the drag keeps
tracking even if the pointer leaves the thin 6px handle), and everything commits via `setState`
calls — no daemon involvement anywhere, since there is nothing to write to a file.

One deliberate choice: on `pointerdown`, the drag's starting height is read directly off the real
DOM (`document.querySelector('.bottom-pane').getBoundingClientRect().height`), not off the store's
`bottomPaneHeight` value. The store value may still be `null` (CSS default in effect) at drag
start, and the DOM is the one honest source of the actual current pixel height regardless of
whether CSS or an explicit inline style is currently driving it.

Clamping, per the plan's "don't let either pane collapse to zero":
- **Min 200px** — matches the pre-existing CSS `min-height: 200px` that was already on
  `.bottom-pane` before this stream (kept as `MIN_PANE_HEIGHT` so the JS-side clamp and the CSS
  floor agree).
- **Max = workspace height − 160px − 6px** — leaves `.main-area` (the arrangement) at least 160px
  and accounts for the divider's own 6px, so dragging all the way up can never swallow the whole
  arrangement to nothing. Recomputed live off `.workspace`'s real `getBoundingClientRect().height`
  on every `pointermove`, so it stays correct across window resizes mid-drag.

A double-click on the divider resets `bottomPaneHeight` back to `null` (the CSS default) — a quick
way back after over-dragging, cheap to add given the setter already exists.

### 3. CSS (`ui/src/styles.css`)

`.pane-divider`: a 6px-tall flex item (`.workspace` is already a flex column, so it just slots in
as a third stacked child) with `cursor: row-resize` and a thin 2px hairline (`::after`) that
brightens to the accent color on hover/drag — the same "hover reveals the grabbable affordance"
treatment the resize handle elsewhere in the arrangement already uses. `.bottom-pane`'s old
`border-top` was removed in the same edit — the divider's own hairline now sits directly above the
pane whenever it's rendered, so keeping both would have doubled the line.

`BottomPane`'s `<section>` now carries `style={{ height: `${height}px` }}` only when
`bottomPaneHeight` is non-null; otherwise no inline `style` at all, leaving the CSS rule fully in
charge.

## Design decisions worth flagging

- **Pixel height, not a vh/percentage value.** A drag gesture naturally produces a pixel delta;
  converting to vh would need the viewport height at commit time and buys nothing since the state
  is session-only anyway (no reload to round-trip through a more portable unit for).
- **No daemon/file involvement at all.** Every other Phase 24 stream (CB, CD, CE) touches the
  daemon or `src/core`; CA doesn't, by design — the plan calls it "the smallest, most contained
  stream in this batch," and the implementation matches that: three files, no new route, no new
  edit primitive.
- **The max clamp is a MIN_MAIN_AREA_HEIGHT floor, not a percentage cap.** A percentage-of-workspace
  cap (e.g. "never more than 80%") would produce a wildly different absolute floor for
  `.main-area` depending on window size; a fixed 160px floor for the arrangement is what actually
  answers "don't let it swallow the whole arrangement" regardless of window height.

## Verification performed

- `npm test`: 545/545 passing (no `src/core`/daemon changes in this stream, so no new unit-test
  file was needed — matches the precedent Phase 23's own GUI-only streams set, e.g. BA's `/pitch-
  time` route, of relying on the live verify script for coverage of additive, daemon-free GUI work).
- `npx tsc -p tsconfig.json --noEmit` and `cd ui && npx tsc --noEmit`: both clean.
- `node ui/verify-phase24-stream-ca.mjs`: a real headless-Chromium session against a real `beat
  daemon` on a scratch copy of `examples/night-shift.beat`, driving actual `page.mouse` drag
  gestures on the real divider element and reading the real DOM (`getBoundingClientRect()`), not
  just store state. Six checks (T1–T6):
  - T1: selecting a track shows the pane + divider; initial height is a real, non-trivial pixel
    value (~412px of an ~890px-tall workspace at the test's 1600×980 viewport, i.e. plausible 42vh).
  - T2: dragging the divider up 80px grows the pane's real measured height by ~80px (measured
    80.0px exactly in the run recorded below).
  - T3: dragging far down clamps the pane at exactly 200px — never collapses further.
  - T4: dragging far up clamps at a sane max (724px in the test run) while `.main-area` keeps a
    real, nonzero height (160px) throughout — never swallowed.
  - T5: the `.beat` file on disk is byte-identical before and after every drag in T2–T4 — confirms
    the height genuinely never touches the project file.
  - T6: double-clicking the divider resets the pane back to its original CSS-default height
    (411.6px, matching T1's baseline exactly).

  Full run output:
  ```
  [T1] PASS: bottom pane + divider present, initial height 411.6px (workspace 890.0px)
  [T2] PASS: dragging the divider up 80px grew the pane by 80.0px (411.6->491.6)
  [T3] PASS: dragging the divider far down clamped the pane at 200.0px (>= the 200px floor, not collapsed)
  [T4] PASS: dragging the divider far up capped the pane at 724.0px, .main-area kept 160.0px (never swallowed)
  [T5] PASS: the .beat file is byte-identical after all divider drags (session-only state, as intended)
  [T6] PASS: double-clicking the divider reset the pane to 411.6px (initial was 411.6px)
  ```

## Result — what's honestly incomplete

- **Doesn't survive a page reload.** Explicitly optional per the plan ("doesn't need to survive a
  page reload unless that's trivial to add"); a `localStorage` upgrade is a small, isolated follow-
  on if the owner wants it, but wasn't folded in here since it's a separate persistence-layer
  decision, not a natural extension of the session-state work this stream actually scoped.
- **No keyboard-accessible resize path** (arrow keys while the divider is focused, etc.) — the
  divider is a plain `<div>` with a pointer handler, not a `role="separator"` with keyboard
  support. Real DAWs' pane splitters are usually mouse-only too, but a fully accessible version
  would add `tabIndex`/`role="separator"`/`aria-valuenow` and arrow-key stepping; left out here as
  a scope call consistent with the plan's "smallest, most contained" framing for this stream.

# Phase 22 Stream AG — drag-extend the loop boundary, clip properties, overlap policy

*Three related `ArrangementView.tsx`-touching features from the "Arrangement / song structure" area
of `docs/product-roadmap.md`. Sibling streams AA (effect chain) and AB (drums) also touch
`ArrangementView.tsx` this phase, mostly in different regions (mixer-strip/track-header code vs. this
stream's timeline/clip-drag code) — this stream's diff stayed scoped to arrangement/timeline/
clip-property concerns per the coordination note.*

## 1. Drag the rightmost loop boundary directly — closing Phase 19's deferred gap

Phase 19 Stream V (`docs/phase-19-arrangement-length.md`) already built a drag handle on a section's
right edge (`.arr-section-resize`) that resizes by dragging — but only inward. Its own "Deferred"
notes named the reason precisely: the arrangement timeline is fit-to-width
(`pxPerBar = laneWidth / totalBars`), so algebraically `totalBars * pxPerBar === laneWidth` always —
the right edge of the *last* section can never sit to the right of the container, because there is
no slack width to drag into. The `+`/`+ section` buttons covered extension instead.

This stream closes that gap directly, rather than leaving it to "a future scrollable, fixed-px/bar
timeline."

### What changed

**Render-time preview, decoupled from fit-to-width, while a drag is active.** `ArrangementView.tsx`
now computes `renderSections` / `renderTotalBars` / `renderPxPerBar` — normally identical to the
ordinary `sections` / `totalBars` / `pxPerBar`, but while `resize` state is set, they switch to:
- `renderPxPerBar`: the **frozen** px/bar captured at drag-start (`resizePxPerBar.current`), not the
  reactive fit-to-width value (which can't grow until the drag commits).
- `renderSections` / `renderTotalBars`: a **live preview** of the resize, computed by
  `previewResizeSections` — a policy-aware mirror of the daemon's `songResize` (see §3) applied to
  the derived `Section[]` shape, so the preview shows exactly what committing the drag would produce
  under whichever overlap policy is selected, not just a generic "shift everything" guess.

Every layout consumer (the ruler's width and section labels, each `.arr-section-resize` handle's
position, the resize guide, every `TrackRow`'s canvas width/sections, each `AutomationLane`'s
width, and the playhead's x-position) now reads these `render*` values instead of the raw
fit-to-width ones. When `resize` is `null` they're identical to before — zero behavior change
outside an active drag.

**Edge auto-scroll, because growth needs somewhere to scroll into that doesn't exist yet.**
Widening the render values alone isn't enough: a real mouse can't move past the visible viewport
edge, and CSS layout won't overflow `.arr-scroll` until there's already-wider content to overflow —
a chicken-and-egg problem (growth needs scrollable room; scrollable room needs growth to have
already happened). The fix is a small **trailing render buffer** (`DRAG_TAIL_BARS = 8`) added to
the rendered width *only* while a resize drag is active, present **before** any growth has been
requested — so there's always genuine off-screen content to auto-scroll into, and it keeps
reappearing ahead of the growing preview on every render. The resize effect's `pointermove` handler
nudges `.arr-scroll`'s `scrollLeft` whenever the pointer sits within 36px of the container's right
edge (`EDGE_PX`/`SCROLL_STEP`, the same edge-autoscroll idiom every DAW's arrangement view uses),
and the bar-count delta folds in how far the view has auto-scrolled (`startScrollLeft` captured at
drag-start), not just raw pointer movement — holding the mouse still while the view scrolls under it
is the same gesture as moving the mouse further right over static content.

**Commits through the existing edit paths — no new route.** Loop mode still commits via
`postEdit('loop_bars', …)`; song mode still commits via the daemon's `POST /song` `resize` op
(now carrying a `policy` field, see §3). On release the drag ends, the document actually changes,
and the ordinary fit-to-width layout takes back over — visually, the arrangement "re-fits" to the
new, longer length.

### Files touched
- `ui/src/components/ArrangementView.tsx` — `renderSections`/`renderTotalBars`/`renderPxPerBar`,
  `previewResizeSections`, the edge-autoscroll block in the resize `pointermove` effect,
  `startScrollLeft` added to the resize drag state.
- `ui/verify-phase22-stream-ag.mjs` §A — drags the handle past the fit-to-width edge in headless
  Chrome and confirms `loop_bars` grows with a clean one-line `.beat` diff.

## 2. Clip-level loop/length/time-signature properties (format v0.10)

Per `docs/research/18-ableton-ui-architecture.md`'s Clip View table ("Main Clip Properties: clip
Start/End … Loop Position & Length, Clip Loop toggle … time signature"), dotbeat's `clip <slug>`
blocks (v0.4, `src/core/document.ts`) had no per-clip loop range or time signature — only the
track/section-level `loop_bars` existed.

### Format addition

Two new optional clip fields, `BeatClipLoop` and `BeatTimeSignature`, following the same
canonical-elision discipline as v0.9's automation lanes (presence = override; absence = the
default, unchanged behavior — a v0.9-and-earlier file parses byte-identical):

```
clip verse-a
  loop 0 4          # clip-local bar range; presence IS the "Clip Loop" toggle
  signature 3 4      # numerator denominator; metadata only (see below)
  note n1 57 0 4 0.8
```

- **`loop <start> <end>`** — bars, clip-local, `end` exclusive and `> start`. Overrides the
  section/`loop_bars`-driven tiling for just this clip. Fractional bars are legal (same
  4-decimal canonical precision every other position field uses).
- **`signature <numerator> <denominator>`** — both strict integers (numerator 1-32, denominator
  one of `1,2,4,8,16,32` — `TIME_SIG_DENOMINATORS`). **Metadata only**: the audio engine is still
  constant-tempo 4/4 (`docs/phase-6-plan.md`'s exclusion list: "tempo changes / time signatures —
  no engine support"), so this is modeled and round-tripped but not yet interpreted by playback —
  the same "format models it, engine catches up later" posture v0.9's deferred `interpolation`
  column already establishes. New documents are now stamped `format_version 0.10`.
- Both are serialized first inside a clip block (properties before content — Ableton's own Clip
  View panel ordering), one line each, omitted when unset.
- Core primitives `setClipLoop`/`setClipSignature` (`src/core/edit.ts`) mirror the automation
  primitives' add/clear shape; `saveClip` preserves a clip's overrides on re-snapshot (they're
  clip metadata, not live-track content, same reasoning that already applied to automation lanes).
- Diffed as musical facts (`clip-loop`/`clip-signature` `DiffEntry` kinds), shown in
  `beat inspect`'s per-clip summary (`clips: verse-a (1 note, loop 0-4, sig 3/4)`).

### Wiring — no new route needed

`<track>.clip.<clipId>.loop` / `.signature` ride the **existing** `POST /edit` `{path,value}`
channel (`setValue`, `src/core/edit.ts`) — a space-joined value sets the override, an empty value
clears it. This means `beat set`, MCP's `beat_set`, and the GUI's `postEdit` all get the new paths
for free, with no CLI/MCP code changes and no new daemon route. `ui/src/daemon/bridge.ts`'s
`applyLocalEdit` gained a matching optimistic mirror branch (the same "faithful local mirror, one
edit → one canonical line" discipline every other `/edit` path already follows).

### GUI: the Clip View properties panel

A new `ui/src/components/ClipPropertiesPanel.tsx`, docked at the top of the Clip View
(`NoteView`/`StepSequencer`, both wrap it identically right below their toolbar) — Ableton's own
layout, where the property panels sit above/beside the note editor, not inside it.

dotbeat's Clip View edits a track's *live* content, not a named `BeatClip` object directly, so the
panel targets the same **"primary clip"** resolution rule Phase 20 Stream Z's automation lanes
already use: the first song-section whose scene maps this track to a clip that actually exists (v1:
one editable clip per track, a deliberate scope cut carried over from the automation lanes, not a
new one). In loop mode (no saved clip exists at all) the panel shows a hint instead of fields.

Fields: loop start/end number inputs (empty = no override) with a clear (×) button; signature
numerator input + denominator `<select>` (from `TIME_SIG_DENOMINATORS`) with its own clear button.
Every edit posts through the `<track>.clip.<id>.loop`/`.signature` paths above.

### Files touched
- `src/core/document.ts` — `BeatClipLoop`, `BeatTimeSignature`, `TIME_SIG_DENOMINATORS`, the two
  new `BeatClip` fields.
- `src/core/parse.ts` / `src/core/serialize.ts` — grammar + canonical serialization.
- `src/core/edit.ts` — `setClipLoop`/`setClipSignature`, the `setValue` `clip.<id>.loop|signature`
  paths, `saveClip`'s override-preserving re-snapshot.
- `src/core/diff.ts` / `src/core/inspect.ts` — `clip-loop`/`clip-signature` diff entries, the
  inspect summary.
- `src/core/convert.ts` — beatlab has no such concept; a converted clip always gets `loop: null,
  signature: null` (nothing to report as dropped — there was never a source field to lose).
- `ui/src/types.ts` / `ui/src/daemon/bridge.ts` — the mirrored type + optimistic-edit branch.
- `ui/src/components/ClipPropertiesPanel.tsx` (new), wired into `NoteView.tsx` / `StepSequencer.tsx`.
- `ui/src/styles.css` — `.clip-props*` rules (appended, new classes only).
- `test/format-v10.test.ts` (new) — grammar, round-trip, elision, diff, edit primitives, `setValue`
  paths, `saveClip` preservation, `describeDocument`.
- `test/format-v07.test.ts` — the "new documents are stamped v0.9" assertion updated to v0.10.

## 3. Overlapping-region resolution policy

Per `docs/research/22-opendaw-editing-workflow.md` §2.1, openDAW ships a **shipped, user-configurable**
overlap policy (`StudioSettings.OverlappingRegionsBehaviourOptions`): `clip` / `push-existing` /
`keep-existing`. dotbeat had no overlap handling at all before this stream — this is the first
version of it.

### Why the semantics needed reinterpreting, not just porting

openDAW's regions are independently time-positioned on 2D track/time grid — two regions can
literally occupy the same space. dotbeat's song timeline is a **flat ordered list of section
durations**: a section's start is always the sum of the bars before it, so two sections can never
literally overlap. Read closely, the only place growth genuinely "conflicts" with something is
**resizing a non-last section larger** — that growth has to come from somewhere. Today (pre-Stream)
it silently always pushed every later section's start later (their bar counts untouched) — which
turns out to already be exactly openDAW's `push-existing` behavior, just automatic and the only
option. Shrinking, and growing the *last* section, never disturb anything (nothing sits after them),
so **every policy behaves identically in those cases** — matching openDAW, where the policy is a
no-op when there's nothing to overlap in the first place.

Mapping (`src/daemon/daemon.ts`'s `songResize`, full reasoning in its doc comment):

| policy | growing a non-last section |
|---|---|
| **`push-existing`** (default) | gets its full requested size; every later section is untouched and just starts later; total length grows. |
| **`clip`** | gets its full requested size; the immediate *next* section is truncated by the overflow (floor of 1 bar); total length unchanged. Never cascades past that one neighbor. |
| **`keep-existing`** | refused outright — the section's bars stay at their current value; nothing else may move or resize. |

Default is `push-existing` — the original, unconditional pre-Stream-AG behavior — so every existing
caller/test is unaffected by the new (optional) `policy` parameter.

### Where the preference lives

A **GUI/session preference**, not project content — the same call openDAW itself makes (its own
policy lives in app-level `StudioSettings`, not the saved project). It's a small `<select>`
(`overlapPolicy` in `ui/src/state/store.ts`, default `'push-existing'`) always visible in the
arrangement toolbar (`.arr-overlap-policy`), read by both the section chips' `+`/`-` buttons and the
drag handle, sent as a `policy` field on the daemon's `POST /song` `resize` op. It resets to the
default on reload, same as every other GUI-only session flag (mixer mute/solo, the automation
picker's open state).

The `[+]` chip on a non-last section is disabled under `keep-existing` (with an explanatory
`title`), since clicking it would be a guaranteed no-op — the drag handle isn't gated the same way
(a drag can't be "disabled" mid-gesture the way a button click can), so it silently refuses instead,
leaving the arrangement exactly as it was.

### Files touched
- `src/daemon/daemon.ts` — `OverlapPolicy`, `OVERLAP_POLICIES`, `songResize`'s policy branching (plus
  the bars-range validation now happening up front, so an out-of-range request fails identically
  under every policy — see "review fixes" below), the `/song` route's `policy` passthrough.
- `ui/src/state/store.ts` — `overlapPolicy` + `setOverlapPolicy`.
- `ui/src/components/ArrangementView.tsx` — `OverlapPolicy`, `OVERLAP_POLICIES`,
  `previewResizeSections` (also powers §1's live drag preview), the toolbar `<select>`, policy
  threaded through every resize call site.
- `ui/src/styles.css` — `.arr-overlap-policy`/`.arr-overlap-select`.
- `test/daemon.test.ts` — one test per policy's distinct resulting layout, the never-cascades cap,
  the "shrink/grow-last identical under every policy" case, the unknown-policy 400, and the
  out-of-range-bars-under-every-policy 400.
- `ui/verify-phase22-stream-ag.mjs` §C — drives all three policies live and asserts the actual
  resulting section bar counts, not just that the setting exists.

## Review fixes (caught before landing)

A code-review pass over the diff found two real gaps, both fixed and covered by new tests:

- **`songResize`'s bars validation was policy-dependent.** The `clip` and `keep-existing` branches
  don't always forward the raw requested `bars` to `setSong` (`clip` caps it against the neighbor's
  slack; `keep-existing` may no-op entirely) — so an out-of-range request (e.g. `bars: 999`) would
  correctly 400 under `push-existing` but silently clamp/no-op under the other two policies instead
  of failing loudly. Fixed by validating `bars` is an integer 1-64 up front in `songResize`, before
  any policy branching — the same bad input now fails identically under every policy.
- **`setClipSignature` silently rounded a fractional numerator/denominator** instead of rejecting
  it, inconsistent with the codebase's own convention for integer fields (instrument tracks'
  `program` field throws on a non-integer rather than rounding). Fixed to `throw` instead of
  `Math.round`.

## Verification

`npm test`: **333 tests, 333 pass, 0 fail, 0 skipped** (including the new `test/format-v10.test.ts`
round-trip suite and the overlap-policy tests in `test/daemon.test.ts`). `tsc --noEmit` clean on
both the core project and `ui/`.

`node ui/verify-phase22-stream-ag.mjs` — headless Chromium against a real daemon on
`examples/night-shift.beat`. **ALL CHECKS PASSED**:
- **[A]** dragged the loop's right edge outward past the fit-to-width container edge:
  `loop_bars 4 -> 5`, a clean one-line diff (`-loop_bars 4` / `+loop_bars 5`).
- **[B]** set clip `"s1"`'s loop range (`0 4`) and signature (`3 4`) via the GUI properties panel;
  confirmed `loop 0 4` / `signature 3 4` landed on disk under the clip block; cleared both via the ×
  buttons and confirmed the lines disappeared entirely (elision in both directions).
- **[C]** on a 3-section `[5, 5, 5]` song: `push-existing` grew section 0 to `[6, 5, 5]` (others
  untouched); `clip` produced `[6, 4, 5]` (section 1 truncated by exactly the overflow, section 2
  untouched, total held at 15); `keep-existing` left `[5, 5, 5]` unchanged both via the disabled `+`
  chip and a real drag-handle attempt (file byte-for-byte untouched).

Screenshot: `ui/verify-p22ag-arrangement.png` (3-section song, overlap policy selector, and the clip
properties panel all visible together).

## Deferred / notes

- **Independent per-section scene editing** (a separate roadmap row) is still not-started — appended
  sections still share their source scene. Not touched by this stream.
- **Time signature is metadata-only.** No playback effect yet; the engine remains constant-tempo 4/4
  (`docs/phase-6-plan.md`'s exclusion, unchanged by this stream). Wiring it into the tick/renderer is
  a distinct, larger engine-side project.
- **One editable clip per track** in the GUI properties panel (same v1 scope cut Phase 20 Stream Z's
  automation lanes already made) — a track playing different clips across multiple sections can only
  edit the first-occurrence clip's properties from the GUI today. The format itself has no such
  limit (`beat set`/MCP can target any clip id directly).
- **`DRAG_TAIL_BARS = 8`** (the render-only auto-scroll buffer, §1) is a fixed constant, not derived
  from anything — it was sized empirically (enough headroom for the auto-scroll math to bootstrap
  within a couple of pointer ticks without over-rendering). A future pass could make it proportional
  to `pxPerBar` if very zoomed-in timelines ever show it lagging.

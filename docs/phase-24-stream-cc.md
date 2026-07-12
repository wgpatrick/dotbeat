# Phase 24 Stream CC — clip visualization, then cross-track selection/move

Two-part stream (`docs/phase-24-plan.md`'s CC section), sequenced deliberately: Part 1 (make clip
occurrences visible) is a prerequisite for Part 2 (select/move them) — you can't meaningfully drag
something whose boundary the user can't see.

## Part 1 — what was actually there before this stream

The plan's own framing asked to check the CURRENT rendering carefully rather than assume Part 1 was
a from-scratch build. Verified live (headless Chrome against a real daemon on
`examples/night-shift-song.beat`) before writing any GUI code:

- **`ArrangementView.tsx`'s `flattenTrack`/canvas draw effect already renders a clip occurrence's
  own CONTENT in miniature** — real note/hit ticks at `detail` zoom, opacity-encoded density blocks
  when zoomed out. This already matches the "internal content in miniature, not a solid rectangle"
  behavior research/30 (below) confirms for Ableton. This part was never missing.
- **What was genuinely absent for `synth`/`drums`/`instrument` tracks: any BOUNDARY at all.** The
  only per-occurrence visual was a hairline `rgba(255,255,255,0.09)` vertical stroke at each
  *section* start (not per-clip — sections and occurrences happen to coincide 1:1, but the stroke is
  drawn from `sections`, has no clip identity, and is nearly invisible at normal opacity). There was
  **no label anywhere** — a clip's own id/name was not rendered at all outside the bottom Clip View
  panel. Directly confirmed by querying the live DOM: `document.querySelectorAll('.arr-scroll *')`
  returned zero elements with any clip/occurrence-related class — canvas pixels only, nothing
  selectable or hit-testable.
- **`audio`-kind tracks were the partial exception**: the canvas already drew a flat-colored,
  labeled block with edge markers per occurrence (Phase 22 Stream AE). Still canvas-only (not a DOM
  element — not selectable, not a marquee/drag target), so Part 2 needed a real element there too,
  but visually it was already "weak/undiscoverable" rather than "genuinely not rendered."

Screenshot evidence of the "before" state is not preserved (a live DOM query was faster and more
conclusive than a screenshot for proving "zero boundary elements exist"), but the finding is
directly falsifiable by anyone: check out `main` at this stream's parent commit, load
`night-shift-song.beat`, and query `.arr-scroll`'s class list — the CSS classes this stream adds
(`arr-clip-block`, `arr-clip-label`) do not exist.

### Fix

A DOM overlay, one `<div className="arr-clip-block">` per `ClipOccurrence`, rendered as a sibling of
`<canvas>` inside every track row's `.arr-lane` (all kinds, not just audio) — positioned/sized with
the exact same `startBar * pxPerBar` / `bars * pxPerBar` math the canvas already uses, so it lines up
pixel-for-pixel with the content drawn underneath. It carries:

- A visible border (track-colored) and a translucent fill — a real boundary at normal opacity, not a
  0.09-alpha hairline.
- A label showing the clip's own id (`<span className="arr-clip-label">{occ.clipId}</span>`).
- `.selected` / `.dragging` modifier classes for Part 2.

It sits ABOVE the canvas in DOM order so it reads clearly and can catch pointer events, while the
canvas underneath keeps drawing the occurrence's own content in miniature — the overlay only owns
the chrome, not the content. For `audio` tracks the canvas's OWN label draw was removed (now
redundant with the DOM label) but its fill + in/out edge markers were kept, and its remaining text
was repositioned to the block's bottom edge showing the media filename + warp mode — detail the DOM
label doesn't carry.

Loop mode (`doc.song === null`) renders no blocks at all — `trackOccurrences` already returns `[]`
there (no scene/clip concept to show a boundary for), consistent with how the automation-lane picker
already gates on the same emptiness.

### Research grounding (Ableton clip visualization)

`docs/research/18-ableton-ui-architecture.md` covers the Session View / Arrangement View split in
general but does not specifically address "how does a clip authored/looped in Session View look once
placed in the Arrangement timeline" — the plan flagged this as this stream's own research question if
the sibling research stream RF (`docs/research/30-ableton-clip-visualization.md`) hadn't landed yet.
It had not landed in this worktree at the time this stream started. From first-principles knowledge of
real Ableton behavior: an Arrangement View clip renders its own waveform (audio) or a miniature
note/hit preview (MIDI) inside a bordered, labeled block — never a flat color field — and an empty
track region in the same time range is visually bare (no block, no border). dotbeat's existing
note/hit-tick canvas rendering already matches the MIDI case; this stream's DOM overlay adds the
border+label chrome Ableton's block also carries. If research/30 lands with additional detail (e.g.
about audio waveform fidelity), that's a natural follow-up to `AudioClipInspector`'s waveform strip,
not this stream's block-boundary work.

## Part 2 — cross-track selection and drag-move

### Selection model

No existing selection state fit this (per the plan's own note). `ArrangementView`'s `selection`
store field is the daemon-owned D2 pointing protocol (a bar range, optionally scoped to tracks) that
`beat vary --scope selection` reads over HTTP — a different owner (server round-trip) and a coarser
unit (a bar range, not specific clip identities) than "which clip BLOCKS are marquee-selected right
now." This stream adds `selectedOcc: Set<string>` as new, purely local `ArrangementView` component
state, keyed `` `${trackId}::${sectionIndex}` `` (see below for why section index, not a bar
position, is the addressable unit).

### Marquee gesture: reusing the existing drag axis, not inventing a second one

The arrangement already has a track-lane pointerdown-drag gesture (`beginDrag`/the `drag` state) that
selects a bar range — read by `beat vary --scope selection` and (per the Phase 24 plan) about to also
be read by sibling stream CE. Rather than adding a second, competing pointerdown listener on the same
element, the marquee is layered ON TOP of that exact gesture:

- `beginDrag` now also seeds a `rowsSpannedRef` (a plain `Set<string>` ref) with the starting track.
- The drag's `pointermove` handler additionally calls `document.elementFromPoint(x, y).closest(
  '.arr-lane')` on every tick and adds whatever track id it finds — cheaper and more robust than
  re-deriving each row's stacked pixel height a second time (rows already have variable height from
  collapsed groups and open automation lanes; the live DOM already knows the answer).
- On pointerup, the EXISTING `postSelection` call still fires unchanged (CE's dependency is intact).
  Additionally, for every track the pointer crossed, every `ClipOccurrence` whose bar range
  intersects `[start, end)` is added to a fresh `selectedOcc` set (a marquee REPLACES the prior
  selection — no shift-to-add, a deliberate scope cut).

A plain click (down/up with negligible movement) degenerates naturally to a 1-bar range on the
starting row — "select whatever's exactly there, else clear" falls out of the same code path with no
extra branch.

**Starting on an existing clip block never starts a marquee.** `TrackRow`'s `.arr-clip-block` div has
its own `onPointerDown` (`onOccPointerDown`, wired to `beginClipDrag`) that calls `stopPropagation()`
— the lane's own `beginDrag` handler (a React synthetic listener on the parent) never fires. This is
exactly the plan's "starting from empty space, not on an existing clip block, which keeps its own
single-clip drag behavior" requirement.

### The drag-move gesture and its live preview

`beginClipDrag` follows the same "attach window listeners on pointerdown, tear down on pointerup, no
`useEffect`" idiom `AutomationLane`'s own `onPointerDown` already establishes in this file (a one-shot
gesture doesn't need a persistent effect). While dragging, `clipDrag: { deltaBars, keys }` component
state drives a live preview: every `.arr-clip-block` whose key is in `keys` renders shifted by
`deltaBars * pxPerBar`, dashed and semi-transparent — no separate ghost DOM, the real blocks just
reposition provisionally until the drag commits.

Releasing with negligible movement is a click (selects just that one occurrence, replacing the prior
selection). Releasing after a real drag moves the group: if the dragged block was already part of
`selectedOcc`, the WHOLE selection moves together; if it wasn't (a block outside any selection), only
that one block moves — "keeps its own single-clip drag behavior," per the plan.

### The edit primitive — and why section index, not a bar offset

`docs/phase-22-stream-ag.md` and `format-spec.md`'s scene/song model settle this precisely: a scene
maps `trackId -> clipId` (`BeatScene.slots`), and a song section is `{scene, bars}` — there is no
independently-positioned, per-track clip placement anywhere in the format. `ArrangementView.tsx`'s
own `trackOccurrences`/`flattenTrack` already encode the consequence: **a clip occurrence's bar range
is always exactly its section's bar range.** A track's clip is never "at bar 11.5" — it's only ever
"this track's slot in this section's scene." So the only honest edit a clip-block drag can produce is:
**clear the track's slot in the source section's scene, and set it in the target section's scene** —
exactly the framing `docs/phase-24-plan.md` itself anticipated ("moving a clip... edits which SCENE a
section plays... for that track").

This is why `ClipOccurrence` gained a `sectionIndex` field (Part 1) and why the drag-move math snaps a
continuous pointer delta (bars) to the NEAREST section's `startBar`, then converts that to a
section-INDEX delta (`nearestSectionIndex` — `Math.abs(sections[i].startBar - targetStartBar)`,
minimized). That section-index delta, not the raw bar delta, is what gets applied uniformly to every
occurrence in the group — "preserving relative bar offset" in the plan's language is, in this
section-quantized grid, actually preserving relative SECTION-INDEX offset (identical to bar offset
when sections are equal length, which is the common case; honestly different when they're not — see
Deferred below).

**Cross-TRACK moves (vertical, changing which row a clip plays on) are out of scope.** Re-reading the
plan's Part 2 spec closely: every sentence about what's preserved during a drag talks about BAR
offset, never track/row identity, and the required verification is "selects multiple clips across 2+
tracks, and dragging moves them together with correct relative offsets" — selection spans tracks,
movement is along the time axis, each occurrence stays on its own row. This also sidesteps a real
content-model mismatch a literal vertical move would hit: a clip's notes/hits are shaped by its
track's KIND (drum hits vs. synth notes vs. an audio region) — moving a drum clip's content onto a
synth track's row is not a data-preserving operation without a lossy conversion. "Cross-track" in the
stream's own title describes the SELECTION spanning multiple tracks, not clips hopping rows.

### The shared-scene problem, and why every touched section gets a private scene clone

dotbeat's scenes are deliberately REUSED across sections — real content, not an edge case
(`examples/night-shift-song.beat`'s own "intro" scene backs 4 separate sections). Naively mutating a
shared scene's slots for a move would silently also change every OTHER section that happens to reuse
it. `applyClipMoves` (`src/daemon/daemon.ts`) avoids this by minting a fresh, private scene (via the
existing `nextSceneId`/`setScene` — no format grammar change) for every section TOUCHED by a batch of
moves — a full copy of that section's current slot map, patched with just this batch's
removals/additions — before writing anything. Sections not in the batch, even if they originally
shared a scene id with a touched one, are provably unaffected (covered by both
`test/daemon.test.ts`'s unit tests and the live verify script's "pad, not selected, unaffected in all
6 sections" check).

A whole marquee-selected group (however many tracks/sections) is resolved and written as ONE batch —
removals and additions are aggregated PER SECTION INDEX first (so e.g. two tracks both moving from
section 1 to section 2 mint exactly one clone of section 2, not two overwriting each other), then one
`setSong` commits the final section list. One clean write, not N.

### Files touched

- `src/daemon/daemon.ts` — `ClipMove`, `applyClipMoves` (doc comment has the full reasoning above),
  the `POST /clip-move` route.
- `ui/src/daemon/bridge.ts` — `postClipMove` (same "POST, then apply the daemon's returned full
  document" shape as `postAudioSplit`/`postGroupOp` — a multi-scene batch write isn't a `{path,value}`
  `/edit` and isn't optimistically mirrorable client-side).
- `ui/src/components/ArrangementView.tsx` — `ClipOccurrence.sectionIndex`, `occKey`,
  `nearestSectionIndex`, the `.arr-clip-block` DOM overlay in `TrackRow` (generalized from the
  audio-only canvas block), `selectedOcc`/`rowsSpannedRef`/`clipDrag` component state, the marquee
  extension to the existing drag effect, `beginClipDrag`.
- `ui/src/styles.css` — `.arr-clip-block`/`.arr-clip-block.selected`/`.arr-clip-block.dragging`/
  `.arr-clip-label`, `.arr-lane { position: relative }` (the overlay's positioning context).
- `test/daemon.test.ts` — 5 new tests: a single-track move that doesn't bleed into a scene-sharing
  sibling, a batched multi-track move preserving that same guarantee, out-of-range/no-occurrence
  rejection (400, no write), a same-index no-op (200, unwritten), and rejection outside song mode.
- `ui/verify-phase24-stream-cc.mjs` (new) — the live verification script (below).

## Verification

`npm test`: **550 tests, 550 pass, 0 fail, 0 skipped** (including the 5 new `/clip-move` tests).
`tsc --noEmit` clean on both the core project and `ui/`.

`node ui/verify-phase24-stream-cc.mjs` — headless Chromium against a real daemon on
`examples/night-shift-song.beat` (6 sections, "intro" shared by 4 of them). **ALL CHECKS PASSED**:

- **[A]** 11 `.arr-clip-block` DOM elements found, exactly matching a count independently derived
  from the document's own scene/song model (not a copy of the GUI's internals) — before this stream
  there were zero. Every block carries a visible label and non-zero size; "lead" (only mapped in
  section 2) has no block over sections 0/1/3/4/5, proving silent regions are structurally
  distinguishable, not just "no notes drawn."
- **[B]** A marquee starting on "lead"'s empty region (bars 0-8, no block there) and dragged across
  lead/drums/bass rows selected exactly the 5 occurrences whose bar range intersected it, spanning 3
  tracks — the "2+ tracks" requirement.
- **[C]** Dragging one selected block (drums's "drop" occurrence) moved all 5 selected occurrences by
  the identical +1 section-index delta; every section's bar COUNT was unchanged (only scene
  reassignment happened); "pad" (not selected) still plays `groove` in all 6 sections unchanged,
  proving the shared-"intro"-scene sections were not disturbed; the on-disk file re-parses to exactly
  the daemon's in-memory document.

Screenshots: `ui/verify-p24cc-marquee.png` (5-occurrence cross-track selection, glowing borders),
`ui/verify-p24cc-after-move.png` (post-move — lead/drums/bass content now sits together under the
former "intro" section, renamed `s3` by the scene clone; the two trailing untouched "intro" sections
are visibly unchanged).

## Deferred / notes

- **Section-length non-uniformity**: "preserving relative bar offset" is exact when every involved
  section shares the same bar length (matches the plan's own primary framing and the verify script's
  scenario); when section lengths differ, what's actually preserved is relative SECTION-INDEX offset,
  which is the honest, only-available grid a clip can snap to in this format (see "why section index,
  not a bar offset" above) — not a hidden bug, but worth knowing if a future owner expects sub-section
  bar-precise dragging.
- **No shift-to-add on the marquee.** A fresh marquee always REPLACES the selection. Additive
  multi-select (shift-drag, cmd-click) is a real, scoped-out extension — NoteView's own marquee
  already has this pattern to copy from if the owner wants it later.
- **Vertical (cross-track) clip moves are not implemented** — see "why section index, not a bar
  offset" above for the reasoning (content-kind mismatch, and the plan's own spec only requires
  time-axis movement of a track-spanning selection). A future stream wanting literal "move this drum
  clip onto that other drum track" would need a distinct primitive (copy the `BeatClip` into the
  target track's own `clips` array, then reassign the slot) — a bigger, different lift than this one.
- **Destination collisions overwrite.** If a drag's target section already has a DIFFERENT
  (non-selected) clip mapped for a moved track, the move silently overwrites it (last-write-wins via
  `setScene`) rather than refusing or prompting — matches this stream's scope (a real DAW's own
  overwrite-vs-refuse policy is itself a UX decision, not exercised here since the verify scenario's
  destinations are always vacant for the moving tracks).
- **CD's zoom/scroll work isn't in this worktree** — occurrence block positions are computed from the
  same `pxPerBar`/`renderPxPerBar` values the canvas already uses, so they should track zoom
  automatically once CD lands, but that's unverified here (sibling stream, disjoint worktree, per the
  phase-24-plan.md coordination note).

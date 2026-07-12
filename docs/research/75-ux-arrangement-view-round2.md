# Research 75 — Arrangement View round 2: verifying Phase 27's fixes, fresh Ableton detail

*2026-07-12. Round 2 of the Arrangement View UI/UX pass. Round 1
([`70-ux-arrangement-view.md`](70-ux-arrangement-view.md)) found five concrete implementation-level
gaps against Ableton Live 12's Arrangement View chapter (manual ch.6, pp.150-171); Phase 27
([`../phase-27-plan.md`](../phase-27-plan.md), streams EA/EB/EC) shipped fixes for four of them as
real bugs, not polish: (1) loop-mode projects rendered zero clip-boundary chrome — fixed by
synthesizing a display-only occurrence spanning the loop; (2) clicking a track's lane could move the
bar-range selection without moving `selectedTrack`, silently desyncing "what's highlighted" from
"what's open below" — fixed by routing lane clicks through the same handler; (5, shipped as part of
EB) the one drop-target highlight in the app flickered off across ~98% of its own hit area — fixed
with a shared `relatedTarget`-aware drag-state primitive; and (EC) bar-range selection from the ruler
only tinted the one row dragged across — fixed to span every track. This pass does two things: (1)
re-reads the same 19 Ableton page images for detail round 1's narrower brief (clip color/selection/
resize) skipped — track-height management, the Overview strip, locators, time-signature markers, and
anything automation-adjacent; (2) drives dotbeat's actual post-Phase-27 build live via Playwright
against a real `beat daemon`, verifying each fix at the pixel/DOM level (not trusting the plan doc's
own description) and looking for anything newly visible now that the chrome exists. Every dotbeat
claim below is either a direct pixel sample from a real screenshot or a `getComputedStyle`/
`getBoundingClientRect` read against the live DOM — not inferred from the source alone.

---

## 1. Fresh Ableton detail (Part 1)

*Same source as round 1: Ableton Live 12 Reference Manual ch.6, pp.150-171,
`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch06/p-NNN.jpg`, this pass re-viewing
p.150-153, 164-166, 171 specifically for track-height/row management, the Overview strip, locators,
time-signature markers, and anything automation-adjacent that round 1's narrower "how does this pixel
look" brief didn't capture. p.157, 160, 168 are confirmed pure prose with no screenshot (matches round
1's own note) — not skipped, just genuinely empty of new visual material.*

### 1.1 Optimize Height / Optimize Width — a *global* track-fit control, distinct from per-track resize

`[manual p.152, item 13]`: two toggles, **Optimize Height** and **Optimize Width**, fit *all* tracks
into the Arrangement's current viewport height/width in one action, bound to keyboard shortcuts `H`
and `W`. This is a different control from the per-track drag-resize handle round 1 already described
(§2.5) — Ableton has both a manual per-row resize AND a one-key "make everything fit" command. dotbeat
has neither today (`ROW_H` is a hardcoded 56px constant, `ArrangementView.tsx:126`) — this is the
existing, already-tracked `docs/product-roadmap.md` row "Per-track height / unfold + Optimize
Height/Width" (Arrangement / song structure area); this pass just confirms the *global* H/W half of
that item is real Ableton behavior, not an assumption, and adds one nuance the roadmap row doesn't
currently carry: **Alt/Option+drag on a single track's resize handle resizes ALL tracks at once**
`[manual p.164, §6.9]` — a third resize mode (per-track / global-fit / all-at-once) worth folding into
that same build when it's scheduled, not a new row.

### 1.2 "Fold to Notes" — a fold mode distinct from plain fold/unfold

The View menu screenshot `[manual p.171]` shows a **`Fold to Notes`** command (shortcut `F`), separate
from `Fold Selected Track` (`U`) and `Expand All Tracks`. Round 1's §2.5 only described the binary
fold/unfold triangle; this is a *third* state — folding a track's visible pitch range down to just the
notes actually present, an auto-fit rather than a manual collapse. Another nuance for the same
already-tracked roadmap row, not a new one: when "Per-track height / unfold" gets built, the
acceptance criteria should distinguish "collapsed" (today's implicit always-56px state), "manually
resized" (drag), and "fit to content" (`F`) as three distinct target states, not two.

### 1.3 Waveform Vertical Zoom Level slider — genuinely new, not previously named

`[manual p.152, item 14]`: a dedicated slider (separate from the Overview/beat-ruler zoom controls)
that enlarges the *vertical* amplitude display of every audio clip's waveform in the Arrangement,
without touching clip gain — "useful for highlighting transients... without having to adjust the clip
gain." Applies globally to all audio tracks and new clips as they're recorded. This is **not** covered
by any existing `docs/product-roadmap.md` row — dotbeat's audio-track lane rendering
(`ArrangementView.tsx:656-688`) draws a flat single-color fill with in/out markers, not a waveform at
all in the Arrangement lane (real waveforms only render in the separate `AudioClipInspector`, per
round 1 §3.4) — so a vertical-zoom control doesn't yet have anything to act on in this view. Filing as
a genuinely new, low-priority finding (§3 below), not urgent since the underlying waveform-in-lane
feature doesn't exist yet either.

### 1.4 A second, independent wall-clock ruler below the mixer strip

`[manual p.152, item 15]`: directly below the full mixer panel (when open), a **second ruler**
displaying **minutes-seconds-milliseconds**, click-and-drag to scroll — a completely separate time
axis from the bars-beats-sixteenths beat-time ruler at the top (§2.2 in round 1). This is the exact
control the already-tracked roadmap row "Overview strip (minimap) + secondary wall-clock ruler"
describes; this pass adds the precise detail that round 1 didn't have: it's **anchored below the
track/mixer stack, not beneath the main ruler** — a second, independently-scrollable strip, not a
dual-axis label on the existing ruler. Worth keeping when that row gets built, since "put wall-clock
time somewhere" is under-specified without it.

### 1.5 Automation Mode and Lock Envelopes toggles live in the scrub-area button row

`[manual p.151, items 7-8]`, not mentioned anywhere in round 1: two toggles sit in the same
button group as Set Locator / Previous / Next Locator, directly under the beat-time ruler —
**Automation Mode** (show/hide automation lanes for the whole Arrangement in one click) and **Lock
Envelopes** ("lock envelopes to the song position rather than to clips... move clips without moving
automation envelopes"). Lock Envelopes is the exact mechanism the already-tracked, already-flagged-
as-biggest-structural-gap roadmap row "Track/arrangement-scoped automation independent of any single
clip (Lock Envelopes equivalent)" names — this pass just confirms its trigger is a literal one-click
toggle in the transport-adjacent button row, not a menu-buried preference, which matters for how
prominently a dotbeat equivalent should surface once that data-model work happens.

### 1.6 The Editing Grid (§6.10, p.165) — an entire control layer dotbeat has no equivalent of at all

Not named anywhere in round 1. Ableton's cursor snaps to a **meter-relative editing grid**,
independently configurable as **zoom-adaptive or fixed**, with five dedicated shortcuts:
`Ctrl/Cmd+1` narrows (doubles grid density, e.g. eighth→sixteenth notes), `Ctrl/Cmd+2` widens (halves
it), `Ctrl/Cmd+3` toggles **triplet** subdivisions, `Ctrl/Cmd+4` toggles grid snapping on/off
entirely, `Ctrl/Cmd+5` toggles fixed vs. adaptive mode. The current spacing renders as a small text
readout in the ruler's lower-right corner (e.g. "1/16"). Holding `Alt`/`Cmd` while dragging bypasses
snapping for one gesture. Checked directly: `ArrangementView.tsx` has no `snapStep`/grid-density
concept anywhere in the file (only `tickIntervalFor`, which thins the *ruler's number labels* at low
zoom — a display concern, not an editing-snap concern) — dotbeat's only snapping today is implicit
section-boundary snapping for clip moves (round 1 §3.6's `beginClipDrag` comment: "snaps the ORIGIN
clip's new start bar to the nearest section"). There is no roadmap row for this at any grain finer
than section boundaries. New finding — see §3 P2.

### 1.7 The Follow switch's exact visual form

`[manual p.153]`: a small amber/yellow rounded-square icon (an arrow followed by dashes, "→··")
sitting directly to the left of the `1.1.1` position readout, inside the *same* bordered control
group as the transport clock — not a separate switch elsewhere in the Control Bar. Follow pauses on
any edit, manual horizontal scroll, or a ruler click; resumes on stop/restart or a click back in the
Arrangement/scrub area. This is the already-tracked roadmap row "Follow (auto-scroll to playhead
during playback)" — this pass adds the exact reference visual (grouped with the position field, not a
standalone button) for whenever that row gets built.

### 1.8 "…Time" commands' selection visual is a distinct cyan wash, not the usual gray/black scheme

`[manual p.166, §6.11]`: Cut/Paste/Duplicate/Delete Time and Insert Silence operate on a bar-range
selection rendered as a **translucent cyan-blue wash directly over the affected clips' content** —
visually distinct from every other selection treatment in the chapter (the scrub-area's gray-rounded-
rect, or a clip's plain black-outline selection). This is the already-tracked roadmap row
"Arrangement-wide '…Time' commands"; adding the visual grounding (a genuinely different color
language, not a reuse of the standard selection treatment) for whenever it's built.

### 1.9 Mixer Controls / Arrangement Track Controls: per-control visibility, not just a panel toggle

`[manual p.171]`: the View menu's nested submenus let a user independently show/hide each control —
In/Out, Sends, Volume, Track Options, Crossfader, Performance Impact (mixer strip) and a separate
toggle for Return Tracks — rather than the panel being all-or-nothing. Minor, config-surface-only
detail; not proposing a roadmap row for this (dotbeat's InlineStrip is a fixed, non-configurable set
of controls, and there's no evidence that configurability is a real complaint) — noted for
completeness only.

---

## 2. dotbeat's current Arrangement View — Phase 27 fixes verified live

*Driven against a real `beat daemon` + built frontend via Playwright/chromium, 1680×1000 viewport,
matching round 1's own method. Two disposable fixtures, neither touching
`examples/night-shift-song.beat` (the owner's live project): a loop-mode copy of
`examples/night-shift.beat` at `/tmp/dotbeat-ux2-arr/song.beat` (daemon port 9201), and a scratch
song-mode fixture built from it via `beat clip`/`beat scene`/`beat song` (three `verse` sections × 4
bars) at `/tmp/dotbeat-ux2-song/song.beat` (daemon port 9299, chosen to avoid colliding with several
*other* agents' daemons found already running on nearby ports 9203/9205/9209 during this session —
none of those were touched). Both daemons and their `vite preview` processes were killed at the end of
this pass; nothing was left running. `ui/src/components/ArrangementView.tsx` (2,811 lines, up from
2,741 at round 1) read in full for the parts only a DOM/CSS read confirms.*

### 2.1 Fix 1 (loop-mode clip chrome) — confirmed, verified at the pixel level, not just "a border exists"

Loop mode now renders 4 real `.arr-clip-block` DOM elements (one per track), where round 1 found
exactly zero. Confirmed via `getBoundingClientRect`: each block is `1416×49px` — the *exact* width of
the full 4-bar lane, not just the first bar. A plausible-but-wrong first read of the screenshot at
reduced display size made the border look like it stopped after bar 1; a direct pixel sample down the
element's own cropped screenshot (`/tmp/dotbeat-ux2-arr/09-clipblock-crop.png`, sampled via PIL) proved
otherwise — row `y=1` (the top border) reads `rgb(224,108,117)` continuously across the full sampled
width, exactly the lead track's own color (`#e06c75`), and the bottom edge (`y=49`) matches too. The
fix is real and correct: every loop-mode track gets a full-width, track-colored, labeled (`"(loop)"`,
tooltip `"(loop) · 4 bars"`) bounded block, matching Ableton's "every clip is always bounded" baseline
(round 1 §2.4) for the *default* project state — no longer just song mode.

One deliberate, well-reasoned interaction nuance worth naming so a future reader doesn't mistake it
for a bug: the synthetic loop-mode block's `onPointerDown` routes straight to the lane's own
bar-range-selection handler, **not** `beginClipDrag` (`ArrangementView.tsx:879-894`, comment at
`:880-892`) — "the synthetic loop-mode block... has no real clip to move... a drag there is always a
same-section no-op." So dragging inside the "(loop)" block's `cursor: grab` region performs a
bar-range *selection* (which visibly does something — it's not a silent no-op), not a clip move. This
is documented in the code as an explicit tradeoff (and was regression-tested: an earlier version that
let `beginClipDrag` swallow the gesture broke EC's ruler-drag selection entirely). The only residual
UX rough edge: the CSS cursor is still the generic `grab`/`grabbing` pair (round 1 §3.6's finding,
unchanged), which slightly oversells "draggable object" for a block that, in loop mode specifically,
can't actually be moved anywhere. Low-priority — see §3 P2.

### 2.2 Fix 2 (track-select / bar-selection state desync) — confirmed, both visually and in the persisted file

Clicking a track's name (`.arr-track-name`) reliably opens that track's clip in the bottom pane and
marks the header `.selected` (a left-edge amber bar, `screenshot 02-track-selected.png`). More
directly on-point for the actual bug: `ArrangementView.tsx:2027` now calls `setSelectedTrack(d.axis)`
from the row-drag pointerup handler — the exact fix the plan describes ("a plain click in `.arr-lane`
... also set `selectedTrack`"). Confirmed end-to-end against real state, not just the DOM: after
clicking, `selected_track lead` appears as a genuine new line in the on-disk `.beat` file (`git diff`
against the untouched `examples/night-shift.beat` source shows exactly one new field, nothing else) —
this is a real, persisted document fact now staying in sync with the visual selection, not two
independently-clickable states.

### 2.3 Fix 5 / Stream EB (drop-target flicker + shared drag-state) — confirmed in source, not independently
re-driven via native drag-and-drop

`ui/src/dragDrop.ts`'s `useDropTarget` hook now does exactly what the plan specifies: `if
(e.currentTarget.contains(e.relatedTarget as Node | null)) return` before clearing hover state — the
`relatedTarget`/`.contains()` check that was missing at round 1. `ArrangementView.tsx:771-772` wires
`.arr-track-header`'s `onDragOver`/`onDragLeave` through this shared hook. Native HTML5 drag-and-drop
is hard to drive reliably from Playwright's synthetic pointer events, so this pass verified the fix by
reading the actual shipped code rather than re-simulating the drag — the mechanism is confirmed
present and matches the described fix exactly.

### 2.4 Stream EC (full-column selection band) — confirmed working in BOTH loop mode and song mode

Round 1's "screenshot 05: only the lead row is tinted" finding is fixed. Dragging on the **ruler**
(`.arr-ruler`) now paints the amber selection band across *every* track row simultaneously — verified
in loop mode (`/tmp/dotbeat-ux2-arr/05-ruler-drag-selection.png`: all 4 rows tinted from one ruler
drag) and again in the song-mode fixture (`/tmp/dotbeat-ux2-song/04-ruler-drag-songmode.png`: all 4
tracks tinted across the first section). This is exactly Ableton's own model (round 1 §2.2/§2.6:
"dragging across multiple tracks selects that bar range on ALL of them by default"). Dragging inside
a single track's own lane (not the ruler) still scopes the selection to that one row, which the
Phase 27 plan explicitly kept as the still-available track-scoped gesture — both behaviors coexist as
designed, not a regression of the row-scoped case.

### 2.5 The "currently dragging" clip visual (Stream EB) — confirmed with a real clip move in song mode

Loop mode's synthetic blocks can't demonstrate a real move (§2.1), so this was verified against the
song-mode fixture's real `verseLead` occurrence. Mid-drag, the dragged block gets `className="arr-
clip-block dragging"`, rendering exactly per `styles.css:1993-2001`: a **dashed border**, `grabbing`
cursor, elevated `z-index: 4` (lifts above sibling blocks), plus the shared `.dragging` rule's `opacity:
0.4` and `box-shadow: 0 0 0 1px var(--accent)` (`styles.css:33-36`) — the SAME box-shadow-based signal
every other drag surface in the app now uses (effect-chain reorder, section-chip reorder, piano-roll
note move), per the Stream EB unification comment at `styles.css:14-32`. Screenshot
(`/tmp/dotbeat-ux2-song/02-clip-dragging.png`) shows the origin position rendering the ghosted,
dashed-outline preview with just the clip name (no content miniature) while the drop-target position
shows the live insertion point. This is a real, working "this is being manipulated" affordance where
round 1 found none at all (round 1 §2.4/§3.6: no distinct visual for a drag-in-progress anywhere).

### 2.6 Selection state: bar-range is session-shared, not per-tab or persisted to the file

One incidental finding worth a single line, not a bug: a bar-range `selection` (as opposed to
`selected_track`, §2.2) is **not** written to the `.beat` file — confirmed by `git diff`, clean except
for the one `selected_track` line — but it *does* survive a full page reload against the same daemon
process, because the daemon keeps it in memory and serves it to every newly-connecting client. This
surfaced only because two independent Playwright scripts in this pass, run back-to-back against the
same daemon, showed a stale selection band from an earlier script's drag on a supposedly "fresh" page
load. Reasonable architecture for a multi-client/collaborative daemon (the same instance an agent and
a human GUI tab might share); noted here only so a future pass doesn't mistake it for a persistence
bug.

### 2.7 Everything round 1 flagged as still-open and NOT touched by Phase 27 — confirmed still open

Re-checked directly rather than assumed: `ROW_H` is still a hardcoded `56` (`ArrangementView.tsx:126`,
no per-track resize anywhere in the DOM or CSS); `.arr-clip-block` still only shows `grab`/`grabbing`
(`styles.css:1981`, no edge-specific `ew-resize`); `.arr-playhead` is still a bare 2px line with no top
marker; the SECTIONS chip row still shares styling with ordinary toolbar buttons; volume/pan in
`InlineStrip` are still the same native `<input type=range>` varying only in width. All five are
already tracked as individual rows in `docs/product-roadmap.md`'s "Arrangement / song structure" area
(added between round 1 and this pass) — not re-added below, just confirmed still accurate and still
open.

---

## 3. Prioritized NEW findings only

*Cross-checked against `docs/product-roadmap.md`'s "Arrangement / song structure" section. Every
item round 1 raised that's already a roadmap row (per-track height/unfold + Optimize H/W, playhead
top marker, clip-block resize cursor, section-chip visual identity, zoom-readout styling, Lock
Envelopes equivalent, the Overview strip + wall-clock ruler, progressive-disclosure gesture legend,
Cut/Insert/Time commands, track-header identity/action grouping) is confirmed still open per §2.7/§1
above and deliberately NOT repeated here — only genuinely new findings from this pass follow.*

| # | Finding | Priority | Detail |
|---|---|---|---|
| 1 | No editing-grid / snap-density concept anywhere in the Arrangement View | **P2** | §1.6: Ableton's entire "editing grid" layer (zoom-adaptive/fixed toggle, five dedicated density/triplet/snap shortcuts, a live spacing readout) has no dotbeat analog at any grain finer than section-boundary snapping (confirmed: no `snapStep`/grid-density code exists in `ArrangementView.tsx`). Lower priority than it might first appear — dotbeat's whole arrangement model is section/bar-grained by design (clips live on section boundaries, not arbitrary sub-bar positions, per `beginClipDrag`'s own doc comment), so a finer editing grid mostly matters if/when sub-bar clip placement becomes a real feature. Worth a design note next to that future work, not urgent standalone. |
| 2 | Waveform Vertical Zoom Level (Ableton) has no dotbeat equivalent, but also nothing to act on yet | **P2** | §1.3: genuinely new Ableton control, not previously named in any research doc searched this pass. Not actionable on its own today — dotbeat's Arrangement lane renders a flat color fill for audio clips, not a waveform (real waveform rendering lives only in `AudioClipInspector`), so there's no vertical amplitude display in this view to add a zoom control to. File as a follow-on to whenever "real waveform-in-lane rendering" is scheduled, not before. |
| 3 | Loop-mode clip block's `grab` cursor slightly oversells drag-to-move when the only real gesture available is bar-selection | **P2** | §2.1: a first-time user hovering the "(loop)" block sees the same `cursor: grab` every real, movable clip block uses, but in loop mode (a single section) dragging it performs a bar-range selection instead of a move — a deliberate, well-reasoned, code-documented tradeoff (§2.1), not a bug, but a minor cursor/affordance mismatch. Cheapest fix: a loop-mode-specific cursor (e.g. `crosshair`, matching the plain lane) on the synthetic block only, leaving real occurrences' `grab` untouched. |

No P0 or P1 items this pass — Phase 27 closed every P0/P1 finding round 1 raised in this view (§2.1-
2.5), and every other still-open item from round 1 was already captured as its own roadmap row before
this pass started (§2.7). The three items above are genuinely new, low-stakes findings from re-reading
the same source material more closely, not a backlog of urgent work.

---

## Sources

Ableton Live 12 Reference Manual, Chapter 6 "Arrangement View," pp.150-171 — this pass re-viewed
p.150-153, 164-166, 171 specifically
(`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch06/p-{150-153,164-166,171}.jpg`);
chapter text at `.../ableton-chapters/ch06.txt` cross-referenced for exact shortcut/control names
(grid shortcuts §6.10, "…Time" commands §6.11, Selecting Clips and Time §6.9). `docs/research/
70-ux-arrangement-view.md` and `docs/phase-27-plan.md` read in full first, per this pass's own brief,
to avoid re-flagging anything already fixed or already tracked. `ui/src/components/
ArrangementView.tsx` (2,811 lines, read in full), `ui/src/styles.css` (`.arr-clip-block`/`.dragging`/
`.arr-lane` rules), `ui/src/dragDrop.ts` (the Stream EB shared drag-state hook) read directly this
pass. dotbeat screenshots and DOM/pixel verification captured live this session via `playwright-core`
(chromium, 1680×1000) against two real `beat daemon` processes, driving a disposable loop-mode copy of
`examples/night-shift.beat` and a disposable song-mode fixture built from it via `beat clip`/`beat
scene`/`beat song` — `examples/night-shift-song.beat` (the owner's own live project) was never opened
or touched. Screenshots and a pixel-sampled crop left at `/tmp/dotbeat-ux2-arr/*.png` and
`/tmp/dotbeat-ux2-song/*.png` (not committed). `docs/product-roadmap.md`'s "Arrangement / song
structure" section read in full to cross-check every finding against the existing backlog before
including it in §3.

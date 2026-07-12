# Phase 27 — GUI usability, modeled on Ableton Live's actual UI/UX conventions

*2026-07-12. Built off `docs/research/70-74` — five implementation-level UI/UX passes, each
screenshot-grounded against the Ableton Live 12 Reference Manual's own page images (not text/prose
alone) on one side, and fresh Playwright screenshots + direct source reads of dotbeat's real running
app on the other. Where research 50-69 (Phase 26's own basis) asked "does dotbeat have the feature,"
these five ask "exactly how many pixels does the control take, what widget type is it, what gesture
drives it" — a level of detail meant to be handed directly to a build-stream agent, not re-derived.
This phase is scoped entirely to GUI look/feel/interaction: every stream below assumes the underlying
data/feature already exists (per research 50-69) and changes only how it's presented or how a known
interaction bug is fixed. No format changes, no new core primitives, beyond what a bug fix strictly
requires.*

## Fix first — five genuine bugs (Stream EA + EB)

Not aesthetic gaps — actual broken/wrong behavior, found by driving the real running app (not by
reading code or a static screenshot) and confirmed against the cited source.

1. **Zero clip boundaries render in loop mode — the default project state.** `ArrangementView.tsx`
   unconditionally sets `occurrences = []` outside song mode (`ArrangementView.tsx:837-839`, comment
   at `:837` confirms this is deliberate), so the `.arr-clip-block` DOM overlay that provides
   border/label/selection chrome (`:846-858`) never mounts for a fresh/simple project —
   `examples/night-shift.beat` itself, and therefore the state of *every* new project until it grows
   a `song` block. The canvas content fills the row edge-to-edge with zero border, zero label, zero
   selectable-object affordance. *Fix approach:* synthesize one synthetic occurrence per track
   spanning the full loop length and feed it through the existing render path at `:839-858` — no
   data-model change, `occurrence` is already a derived/render-time concept. (research/70 §3.4, item 1)

2. **Clicking a track's arrangement row sets bar-range selection but not the editing track — two
   independent state slices silently diverge.** Selecting a track for editing is a plain click on
   `.arr-track-name` (`ArrangementView.tsx`'s `clickHeader`); clicking anywhere else in that same
   row (the `.arr-lane` drag surface) instead performs bar-range *selection*. It's easy to click the
   row and change the "selection: X · bars N-M" banner at the top of the page without changing which
   track's clip is open in the bottom pane at all, because `selectedTrack` and the arrangement's own
   `selection` are two different pieces of state that happen to both respond to clicks in the same
   visual row. *Fix approach:* make a plain click in `.arr-lane` (that doesn't turn into a
   bar-range drag) also set `selectedTrack`, so "click this track's row" reliably opens that track's
   clip below regardless of which sub-element inside the row was clicked. (research/71 §2.1)

3. **Effect knob-group render order silently diverges from the actual chain order after a
   reorder.** `synthParams.ts`'s `PARAM_GROUPS` is a fixed, hardcoded array order (`eq3, comp,
   distortion, bitcrush, pingpong, ...`); `SynthPanel.tsx`/`InstrumentPanel.tsx`'s group filter
   (`PARAM_GROUPS.filter(...)`) iterates that fixed array — never `track.effects`, the actual,
   user-reorderable chain order. Drag an effect from position 4 to position 1 in the Effect Chain
   list (a real, working gesture) and its knob group stays exactly where `PARAM_GROUPS` put it,
   unmoved — "the order I see in the chain" and "the order I see the knobs in" become two
   independent facts the instant anyone reorders anything. *Fix approach:* sort the filtered
   `groups` array by `effects.findIndex(e => e.type === g.effectType)` before rendering in both
   `SynthPanel.tsx` and `InstrumentPanel.tsx`; fixed-insert groups with no `effectType` keep a
   documented, pinned position (start or end — pick one). Pure render-order logic, no data-model
   change. (research/72 §2.1, P0 item 2)

4. **Instrument tracks get no Macro row and no Preset Picker at all — an inconsistency Phase 26
   itself created.** `MacroRow`'s guard (`if (track.kind !== 'synth' && track.kind !== 'drums')
   return null`, `SynthPanel.tsx:434`) and `PresetPicker`'s equivalent absence from
   `InstrumentPanel.tsx` exclude instrument tracks entirely — confirmed live: the "keys" instrument
   track's panel goes straight from "SOUNDFONT" to "EFFECT CHAIN," no macros anywhere. Phase 26
   Stream DC just gave instrument tracks a real, first-class, macro-able Effect Chain — the exact
   mechanism macros act on — so this guard is now stale, not a deliberate scoping choice. *Fix
   approach:* drop the `track.kind` guard in `MacroRow`, and give `PresetPicker` an instrument-track
   path (or a dedicated small instrument-macro set) now that the underlying Effect Chain parity
   exists. (research/72 §2.6, P0 item 4)

5. **The one drop-target highlight in the app flickers off across ~98% of its own surface area in
   ordinary use.** `ArrangementView.tsx`'s track-header drop target
   (`onDragLeave={() => setDropHover(false)}`, line 755) is a bare boolean with no
   dragenter/dragleave counter and no `relatedTarget`/`contains()` check. `.arr-track-header` is
   densely packed with interactive children (checkbox, swatch, rename button, delete button, the
   InlineStrip's mute/solo/volume/pan controls); native `dragenter`/`dragleave` target the deepest
   element under the cursor, so crossing from the header's bare background onto *any* child re-fires
   `dragleave` on the header and cancels the highlight. Verified directly: an `elementFromPoint` scan
   of the header's ~14,500px² area found only ~200 individual pixels where it resolves to the header
   itself rather than a child — everywhere else, a cursor arriving there mid-drag momentarily
   un-highlights the target, right before the user releases. *Fix approach:* replace the bare
   boolean with a `relatedTarget`-aware check (`if (!e.currentTarget.contains(e.relatedTarget))
   setDropHover(false)`) or an enter/leave counter. This fix ships as part of Stream EB (the shared
   drag-state primitive below), not as a standalone patch, since the correct fix is exactly the
   primitive EB is building anyway. (research/74 §3.1, P0 item 1)

Bugs 1-4 ship together as Stream **EA** (small, independent files, no shared root cause but all
correctness fixes — same "ship the bugs first" discipline as Phase 26's Stream DA). Bug 5 ships as
part of Stream **EB**, described next.

## Streams

*P0 items consolidated from all five docs' own priority lists, grouped by natural buildable unit —
not mechanically one stream per doc. Where multiple docs' P0 lists converged on the same underlying
primitive (research 74's shared drag-state/drop-highlight component directly serving what research
70/71/72 would otherwise each patch separately on their own surface), they're built once, here, as
one stream.*

| Stream | Feature | Roadmap area | Primary files | Source research |
|---|---|---|---|---|
| EA | Fix-first bugs 1-4: loop-mode clip boundary, track-select/selection state-slice mismatch, effect knob-group render order, instrument-track macro/preset gap | — (bugfix) | `ui/src/components/ArrangementView.tsx`, `ui/src/components/SynthPanel.tsx`, `ui/src/components/InstrumentPanel.tsx`, `ui/src/components/synthParams.ts` | research/70, 71, 72 |
| EB | Shared drag-state / drop-highlight primitive (fixes bug 5; one canonical drop-target-highlight treatment replacing `ArrangementView.tsx`'s dashed-outline and `NoteView.tsx`'s hardcoded green fill; gives piano-roll note-drag its first "currently dragging" visual state) | — (bugfix + cross-cutting UI primitive) | `ui/src/components/ArrangementView.tsx` (track-header + clip-block drag), `ui/src/components/NoteView.tsx` (lane drop target + note-drag), `ui/src/styles.css` | research/74 (cites 70, 71, 72, 73) |
| EC | Ruler-drag bar-range selection spans the full column across every track, not just the row dragged across | Arrangement / song structure | `ui/src/components/ArrangementView.tsx`, `ui/src/styles.css` | research/70 |
| ED | Give the Clip View a real colored title/header bar (`track.color`, clip name, sticky to the top of `.noteview`) | Note editing (piano roll) | `ui/src/components/NoteView.tsx`, `ui/src/styles.css` | research/71 |
| EE | Velocity/chance lane: drop opacity-as-velocity encoding on grid notes (keep chance dashing + ratchet ticks), add a live floating numeric readout while dragging a velocity/chance marker | Note editing (piano roll) | `ui/src/components/NoteView.tsx`, `ui/src/styles.css` | research/71 |
| EF | Clip-loop handle: wire the existing `origStart`-aware plumbing to a real second (start-edge) drag handle, thicken both handles with a triangular cap so they read as draggable at rest | Note editing (piano roll) | `ui/src/components/NoteView.tsx`, `ui/src/styles.css` | research/71 |
| EG | Visually differentiate the five stacked NoteView bottom panels (ClipPropertiesPanel / PitchTimePanel / NoteNameReadout / NoteInspector currently share identical CSS) — distinct left-border accent per panel, or adopt `DrumLanePanel`'s already-shipped collapsible-header pattern for all of them | Note editing (piano roll) | `ui/src/components/NoteView.tsx`, `ui/src/components/ClipPropertiesPanel.tsx`, `ui/src/styles.css` | research/71 |
| EH | Effect-row bypass toggle: move it to the leading/leftmost position, give it a real filled/hollow circle glyph (Ableton's Activator convention) instead of a stock checkbox, put visual distance between it and the destructive ✕ remove button | Core effects | `ui/src/components/SynthPanel.tsx`, `ui/src/styles.css` | research/72 |
| EI | `Knob.tsx`: click-to-type numeric value entry — `.knob-value` becomes a real editable field committing on Enter/blur through the same `onChange` the drag path already uses | Core effects | `ui/src/components/Knob.tsx`, `ui/src/styles.css` | research/72 |
| EJ | Content browser row polish: a real per-row type icon (distinct glyph per preset/kit-lane/soundfont, replacing the identical preview-circle for every row type) + an in-place preview progress/playing indicator on the existing `PreviewButton` busy state | Preset / content library | `ui/src/components/ContentBrowser.tsx`, `ui/src/styles.css` | research/73 |

Ten streams (EA-EJ), matching Phase 26's scale (twelve). The remaining P0-adjacent ideas that didn't
consolidate into a natural buildable unit here, plus every P1/P2 item from all five docs, are folded
into `docs/product-roadmap.md` (see below) rather than forced into an eleventh/twelfth stream.

## Merge order

This is a UI-heavy phase — the file-contention picture is the opposite of Phase 26's (`engine.ts`
was the one hot file there; here there are four, plus `styles.css` touched by nearly every stream):

- **`ui/src/components/ArrangementView.tsx`**: EA, EB, EC (three streams).
- **`ui/src/components/NoteView.tsx`**: EB, ED, EE, EF, EG (five streams — the single hottest file
  this phase).
- **`ui/src/components/SynthPanel.tsx`** / **`InstrumentPanel.tsx`**: EA, EH (two streams).
- **`ui/src/styles.css`**: touched by every stream except none — all ten. Each stream should append
  new rules to its own component's existing CSS block (`.arr-*`, `.noteview-*`, `.effect-row`,
  `.knob-*`, `.lib-*`) rather than editing shared color/spacing variables, the same discipline that
  kept Phase 22-26's CSS merges clean.

Suggested sequence:

1. **EA first** — bugfixes, small footprint, independent files, no reason to land any polish stream
   on top of a known-wrong render order or a known-broken state slice. Same "fix bugs first"
   precedent as Phase 26's Stream DA.
2. **EB second** — the shared drag primitive. It re-touches `ArrangementView.tsx` (already fresh
   from EA) and establishes the canonical drop-highlight/dragging-state convention every later
   `styles.css` addition should be visually consistent with, even though EC-EJ don't have a hard
   *code* dependency on it.
3. **EC** — the last `ArrangementView.tsx` stream, landed after EA/EB have already touched the file
   once each, rather than three-way-conflicting all at once.
4. **NoteView.tsx cluster, one at a time, in the file's own top-to-bottom order** to minimize diff
   overlap: **ED** (title bar, new top-of-component chrome) → **EF** (clip-loop strip, upper-mid) →
   **EE** (velocity/chance lanes, mid) → **EG** (the five bottom-stacked panels, end of component).
5. **Device-view cluster**: **EH** (`SynthPanel.tsx`'s `EffectRow`, lands right after EA already
   touched `SynthPanel.tsx`/`InstrumentPanel.tsx` for the bug-3/bug-4 fixes) → **EI** (`Knob.tsx`,
   an isolated file with low contention — could also land in parallel with anything else).
6. **EJ** — fully isolated (`ContentBrowser.tsx` isn't touched by any other stream this phase);
   sequence last purely for scheduling convenience, not a technical dependency.

Re-run each prior stream's own live-verify script after every merge as a regression check — same
discipline as Phases 22-26.

## Verification

Each stream ships its own Playwright-driven live-verify script (`ui/verify-phase27-stream-e*.mjs`)
against a real `beat daemon` + built frontend, on a disposable copy of a fixture `.beat` file (never
`examples/night-shift-song.beat`, the owner's own live project — every research doc this phase is
built from was careful about this, keep the discipline). Because this is a UI-polish phase rather
than a data/engine phase, "verified" means more than "the .beat diff looks right": each script should
assert on the actual rendered DOM/CSS state a screenshot would show — computed styles, class
presence (`.dragging`, `.drop-target-hover`, etc.), element bounding boxes for the new title
bar/handles, not just that a `postEdit` fired. Re-run directly after merge, not trusted from a
stream's own self-report, matching Phase 26's standard.

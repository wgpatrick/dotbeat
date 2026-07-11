# Phase 18 — the Ableton-shaped GUI redesign

*Kicked off 2026-07-11, following a live product-design session (owner walked through real
Ableton screenshots) and `docs/research/18-ableton-ui-architecture.md` (deep research into
Ableton's actual UI architecture, sourced from Ableton's own documentation). This phase acts on
both. Sequenced deliberately: Stream Q (the core layout unification) is the anchor and runs
alone on `App.tsx`/the top-level composition, since everything else either depends on the shape
it produces or risks colliding with it. Streams R and S are genuinely parallel-safe this round.
Automation-lane UI, the browser sidebar, and the macro system are real Phase 18 goals but are
correctly sequenced as the *next* round once Stream Q lands — see "Deliberately deferred" below.*

## The headline finding driving this phase

Research 18's most important result: Ableton is not tabs. It's one window with two always-present
regions — a main area that's unconditionally the Arrangement timeline (Session View doesn't apply
to dotbeat), and a bottom detail pane that follows the current selection and toggles between
**Clip View** (edit the clip's notes) and **Device View** (edit the track's sound) via Shift+Tab.
This reframes the work: dotbeat already has every component this needs (`ArrangementView`,
`NoteView`, `StepSequencer`, `SynthPanel`, `InstrumentPanel`, `MixerView`'s channel-strip logic) —
Phase 18 is substantially a **re-parenting** job, recomposing what exists into the right shape,
not a rebuild.

## Addendum, same day: drum voices are getting reconsidered separately

The owner pushed back on this doc's assumption (inherited from research 18's "skip Racks" call)
that the current 5-lane drum model (kick/snare/hat/openhat/clap) is a fine permanent shape — it's
explicitly a BeatLab holdover, not a deliberate constraint, and he wants real drum racks with many
more named voices (808s etc.), each hit addressable like a piano-roll note but for a specific
drum. **This is a distinct question from Racks-the-nested-chain-machinery** (still probably right
to skip) — it's about lane *cardinality*, a format/engine question. A dedicated research pass is
running now (see task "Research: expanding drum voices beyond the 5-lane BeatLab holdover"); its
recommendation supersedes this doc's 5-lane assumption wherever they conflict. Stream Q below can
proceed as planned regardless — the layout-composition work doesn't depend on the exact lane
count — but `StepSequencer.tsx`'s specific lane-rendering approach should be treated as likely to
change again once that research lands, not as settled.

## Stream Q — core layout unification (runs alone this round)

Read `docs/research/18-ableton-ui-architecture.md` in full before starting — it has the precise
composition model, the Shift+Tab mechanism, and what's Session-View-only and should NOT be
ported. Also read the four Ableton screenshots' worth of detail already captured in this
conversation's history if available, or `docs/phase-13-views.md`/`docs/phase-14-*.md` for what
`ArrangementView.tsx`/`MixerView.tsx`/`NoteView.tsx`/`SynthPanel.tsx`/`InstrumentPanel.tsx`
currently do — you're recomposing these, not rewriting their internals.

**Target shape:**
1. Remove the four-tab switcher (Editor / Arrangement / Mixer / History) from `App.tsx`.
2. **Main area, always visible**: `ArrangementView`, becomes the primary/default view (not one
   of three equal tabs). Each track row gains an inline mixer strip — volume, pan, mute, solo,
   send indicators — reusing `MixerView`'s existing channel-strip logic/data-flow, adapted to a
   compact form that fits in a track header rather than `MixerView`'s current full-width layout.
   (Research 18 covered whether Ableton also keeps a separate full Mixer view alongside the
   inline strip — follow whatever it found; if it recommends keeping a toggleable full Mixer
   alongside the inline strips, build that too rather than deleting `MixerView` outright.)
3. **Bottom docked pane**, appears when something is selected, toggles between:
   - **Clip View**: `NoteView` (melodic/instrument tracks) or `StepSequencer` (drum tracks) —
     whichever already applies to the selected track's kind, exactly as today's Editor tab
     already decides.
   - **Device View**: `SynthPanel` or `InstrumentPanel` — reframed as "the sound," same
     components, new location.
   - Toggle via Shift+Tab (matching Ableton) and/or a clickable pair of labels — your call on
     which reads better, but Shift+Tab should work regardless.
4. **History**: keep `HistoryPanel` as a toggleable slide-out/drawer panel (a button opens/closes
   it over the main view) rather than a fifth tab-equivalent — Ableton has no direct equivalent
   here since it doesn't have dotbeat's checkpoint system, so use your own judgment on the
   cleanest convention, but it shouldn't compete with Clip/Device View for the same screen space.
5. **`VaryAffordance`**: confirm it continues to work unmodified — it's already a
   selection-triggered contextual overlay, not tab-bound, so it should need no changes, but verify
   this explicitly rather than assuming.

**Verify live** (headless Chromium, the established `ui/verify*.mjs` convention): load a real
multi-track project, confirm the arrangement is the persistent main view with inline per-track
mixer controls working (mute/solo/volume exactly as `MixerView` did — real audio-gating,
re-verify Phase 14's mute/solo evidence bar still holds), select a drum track and confirm Clip
View shows `StepSequencer`, Shift+Tab to Device View and confirm `SynthPanel`/drum-voice params
show, select a synth track and confirm `NoteView`/piano roll shows in Clip View, open and close
History without disrupting the main view, confirm `VaryAffordance` still triggers correctly on a
selection.

**File ownership**: `ui/src/App.tsx` (the real target — full recomposition), `ui/src/components/
ArrangementView.tsx` (extend track rows with the inline mixer strip), minimal additive changes to
`ui/src/state/store.ts` for any new UI-mode state (e.g. which pane is showing). Reuse
`NoteView.tsx`/`StepSequencer.tsx`/`SynthPanel.tsx`/`InstrumentPanel.tsx`/`MixerView.tsx`/
`HistoryPanel.tsx` as components — don't rewrite their internals, this is a composition change.
Do not touch `ui/src/audio/engine.ts` (Stream R may touch it, in a different concern) or
`src/core/document.ts` (Stream S touches this).

Result in a new `docs/phase-18-layout.md`.

## Stream R — LFO depth (parallel-safe: `src/core`, `ui/src/audio/engine.ts`, no `App.tsx`)

Per research 18's LFO/modulation recommendation: keep the literal, enumerated-destination model
(no free-routing matrix — that needs in-file indirection with no resolved-value fallback, which
research 18 correctly rejected), but grow real coverage.

1. Widen the enumerated LFO destination lists (`SYNTH_FIELDS`'s `lfoDest`/`lfo2Dest` in
   `src/core/document.ts`) — check `AUTOMATABLE_SYNTH_PARAMS` (or wherever the current automatable
   list lives) for what's already reachable via clip automation but not yet an LFO target, and
   close that gap where it makes musical sense.
2. Add tempo-sync: an LFO rate expressed as a synced note division (1/4, 1/8, 1/16, triplets/
   dotted) as an alternative to free Hz, matching Ableton's convention — this needs a new
   `SYNTH_FIELDS` field (e.g. `lfoSync: boolean` + `lfoSyncRate: string`, or check whether
   something like this already exists partially — Phase 13's engine-parity doc mentioned
   `lfoSync`/`lfoSyncRate` were already ported for drum-voice LFOs, verify and extend consistently
   to the main synth LFOs if that's not already uniform).
3. Wire it into `ui/src/audio/engine.ts` (the live engine) and expose in `ui/src/components/
   SynthPanel.tsx`'s LFO group — additive fields into the existing metadata-table-driven panel
   (`ui/src/components/synthParams.ts`), not a restructure.

**Verify live**: set an LFO to a synced rate, confirm via the engine's real tick/scheduling that
the modulation period actually tracks tempo changes (change BPM, confirm LFO rate changes with
it, not fixed Hz). Widen-destination changes verified by actually modulating a newly-reachable
target and confirming it audibly/measurably changes (reuse `src/metrics`, same evidence bar as
every prior engine stream).

**File ownership**: `src/core/document.ts` (additive `SYNTH_FIELDS` entries — run the FULL
`npm test` after, confirm 290+/287+/0/3), `ui/src/audio/engine.ts` (additive LFO wiring),
`ui/src/components/SynthPanel.tsx`/`synthParams.ts` (additive field exposure). Do not touch
`App.tsx`, `ArrangementView.tsx`, or anything Stream Q owns.

Result in `docs/phase-18-lfo-depth.md`.

## Stream S — content taxonomy: the data layer only (parallel-safe: `presets/`, no GUI)

Per research 18's taxonomy recommendation: borrow Ableton's *categorization logic*, not its binary
file mechanics. This round is the data layer only — the actual browser-sidebar UI is deliberately
deferred to the round after Stream Q lands (a sidebar needs a real place to live in the new
layout, which doesn't exist yet).

1. Add an explicit `category` field to every entry in `presets/factory.json` (today the ~36
   presets are flat, with category only implied in preset names/comments — read the file first to
   confirm the actual current shape before changing it). Use the categories already established in
   `docs/phase-12-presets.md` (Bass/Lead/Pad/Pluck/Keys/Arp/FX for synths, plus the named drum-voice
   kits) as the starting taxonomy, refined against research 18's specific recommendation if it
   proposes something more precise.
2. Update `beat preset`/`beat presets` (`cli/beat.mjs`) and the `beat_preset`/`beat_presets` MCP
   tools to be taxonomy-aware — e.g. `beat presets --category bass` filtering, and confirm listing
   output shows category. Additive only.
3. Add a real test asserting every preset has a valid category from the enumerated set (a
   structural coverage test, same spirit as Phase 12 Stream 2's "no two presets share identical
   params" test).

**File ownership**: `presets/factory.json`, `cli/beat.mjs` (preset-listing commands only,
additive), `src/mcp/server.ts` (preset tool descriptions, additive), one new/extended test file.
Do not touch `ui/` at all this round — no sidebar UI yet.

Result in `docs/phase-18-content-taxonomy.md`.

## Deliberately deferred to the round after Stream Q lands

Real Phase 18 goals, not dropped — just correctly sequenced after the layout exists, since each
one needs Stream Q's output to build against safely:

- **Automation-lane UI**: the inline "<Track> / <Parameter>" picker + draggable curve overlay in
  each arrangement track row (research 18, and the screenshots this phase is based on, cover this
  in detail). Needs Stream Q's restructured `ArrangementView` track-row shape to exist first —
  building it in parallel this round would mean rebuilding it again once Q lands.
- **The browser sidebar UI**: consuming Stream S's new `category` taxonomy to actually let a user
  drag/browse presets onto tracks. Needs a real place in the new layout to dock into.
- **Macros**: research 18's recommendation (adapt as tooling that resolves to literal values on
  write, never as in-file indirection — the same pattern presets already use) is solid and ready
  to execute, but the natural home for a macro-mapping UI is inside the new Device View pane,
  which doesn't exist until Stream Q ships. This is a real, sized subsystem (a mapping UI, a
  resolve-to-literal-edits mechanism, and a place to store the mapping itself outside the `.beat`
  file) — deserves its own dedicated stream next round, not a rushed addition to this one.

## Process

Stream Q runs alone on `App.tsx`/`ArrangementView.tsx` composition. Streams R and S are fully
disjoint from Q and from each other (`src/core`+`ui/src/audio/engine.ts`+`SynthPanel` internals
vs. `presets/`+CLI/MCP preset commands) — real parallel-safe work, dispatch together. `npm test`
must stay green (290+/287+/0/3) throughout for R and S; Q is UI-only and won't be covered by the
root suite, verify it via `ui/`'s own typecheck + the live headless-Chromium evidence bar instead.

# Phase 31 — confusing/discoverability fixes + new bugs from pilots 90-93

Source: four usability pilots run this session — two detailed musical workflows (`docs/research/90`
D&B song, `91` trance lead) and two that followed real, independently-published Ableton beginner
tutorials step-by-step in dotbeat instead of Ableton (`92`, `93`). Per the owner's direction, this
phase tackles as much of the **confusing/discoverability** findings as possible, plus the handful of
**new, real bugs** these pilots surfaced. Two findings need live re-verification before being
treated as confirmed (see streams KA/KB below) — both touch areas Phase 29/30 already fixed and
independently verified, so they may be genuine gaps those fixes didn't cover, or environment
artifacts (the same pattern that turned out to explain most of pilots 87-89's "critical" findings
last round). Verify first, fix only if real — exactly the discipline JA's stream used successfully
last phase.

**Deferred to the roadmap, not this phase** (bigger features or already-tracked, deliberate scope
cuts — see `scripts/roadmap-data.mjs`'s new "Known usability gaps (backlog)" area, added alongside
this plan): sections/scenes having no name field (real format/parser work — Phase 30 Stream JD
already investigated this and correctly scoped it out); no reverse-audio action; no context menus
anywhere; a full Session-View-style independent real-time clip-launching model (explicitly out of
scope per `docs/phase-19-plan.md`, not a bug); no audio-preferences panel, no live/hardware
recording, no user-creatable return tracks, no MP3/partial-range export (all already-tracked,
deliberate scope cuts, reconfirmed live by pilot 92 rather than newly discovered).

## Streams

| Stream | Feature area | Primary files | Source research |
|---|---|---|---|
| KA | Scene/section clip-targeting: verify+fix "Place in Arrangement" ignoring the selected section, clip-block click not reopening the editor in loop mode / for empty scenes, `+ capture scene` unconditionally skipping Audio tracks, audio-drop overwriting an existing clip's edited settings | `ui/src/components/ArrangementView.tsx`, `ui/src/components/NoteView.tsx`, `src/daemon/daemon.ts` | 90, 93 |
| KB | Verify+fix the display/document persistence desync bug | `ui/src/daemon/bridge.ts`, `ui/src/components/NoteView.tsx`, `ui/src/components/AudioClipEditor.tsx` | 93 |
| KC | Note editor: newly-added note not "active" for shortcuts, a new sticky-header instance, the mid-session off-by-one-row drift | `ui/src/components/NoteView.tsx` | 90, 91 |
| KD | Synth panel UX: envelope-amount-defaults-to-0%-silently-gates-shape-knobs (both filter envelope and effect mix), envelope header sub-labels, PRESET dropdown's stale/misleading label on a non-matching fresh track, knob drag-sensitivity visual cue | `ui/src/components/SynthPanel.tsx`, `ui/src/components/InstrumentPanel.tsx`, `ui/src/components/Knob.tsx` | 90, 91 |
| KE | Small copy/interaction fixes: track rename's two-double-click requirement, audio clip "rate" field mislabeled relative to "Transpose," "new project…" toast giving a CLI-only next step, "+X" scene-button prominence | `ui/src/components/ArrangementView.tsx`, `ui/src/components/AudioClipEditor.tsx` | 90, 92, 93 |

## KA — Scene/section clip-targeting

**Item 1 (verify first): "Place in Arrangement" ignores the selected section.** Pilot 90's repro:
build content into a fresh track (auto-creates clip "X", section 0); insert or select a second,
empty section; build different content; click "Placed (clip 'X') — update." Clip X got overwritten
with the new content instead of the newly-selected section getting its own clip —
`window.__store.getState().selectedSectionIndex` read correctly as `1` at the time, yet the write
still targeted the wrong clip. This is exactly the path GA (Phase 29) fixed and verified
(`ui/verify-phase29-stream-ga.mjs` still passes on current main) — first reproduce this exact
scenario live against current main with careful, deliberate clicks (not a scripted burst) before
concluding it's real. If it reproduces, the gap is likely in `NoteView.tsx`'s `placeInArrangement`
(~search for `postPlaceClip`) not fully honoring `selectedSectionIndex` in some specific state GA's
own test didn't cover (e.g. a NEWLY-inserted empty section that's never been the target of a load
yet) — trace exactly which code path diverges from GA's own passing test and close that specific
gap. If it does NOT reproduce, document the negative result (matching how JA handled its own
non-reproducing "highest priority" bug) and move to item 2.

**Item 2: clip-block clicks don't reopen the editor in two cases pilot 93 found.** (a) In loop mode
(a brand-new project's default state), clicking or double-clicking the arrangement's clip block does
nothing — only clicking the track NAME reopens the editor, even though the arrangement's own hint
text ("click a section's name or clip to view/edit its content below") implies the block itself
should work. (b) For a freshly-created scene (via `+ insert scene` or `+ capture scene`), clicking
the new section's clip block does nothing — only the small section-name chip in the SECTIONS toolbar
row (a different element) retargets the editor. Both should route through the same
`selectedSectionIndex`-setting logic GA already built for populated, song-mode clip blocks
(`ArrangementView.tsx`'s `beginClipDrag`/`onOccPointerDown`) — extend it to cover the loop-mode
synthetic block and empty/new-scene clip blocks too, rather than leaving those as separate dead
click targets.

**Item 3: `+ capture scene` unconditionally skips Audio tracks — confirmed root cause.**
`src/daemon/daemon.ts`'s `sceneFromLiveContent` (~line 202) has `if (t.kind === 'audio') continue`
— it skips EVERY audio track unconditionally, including ones with a real, already-placed clip.
Reproduced 5 times in pilot 93 (every capture across 5 new scenes never included the audio track).
The original comment explains this guard was added to avoid a 500 error converting loop→song mode
with an EMPTY audio track present (no clip yet, nothing to snapshot) — a real constraint — but this
same function is now also called by the user-triggered `captureAndInsertScene` (Phase 26 Stream DJ),
where an audio track very often DOES already have a real clip with real media that should be
carried over. Narrow the guard: skip only audio tracks that have NO clip yet (the original problem
this was solving), and carry over an existing audio clip's content (same clip reference, or a real
independent copy — check how `saveClip` handles this for other kinds and match that) when one
exists.

**Item 4: dragging a sample onto an already-populated audio track destroys existing edited
settings.** Re-dropping the same (or a different) sample onto an audio track's header when it
already has a clip resets `warp`/`rate` back to defaults, silently discarding any edit (e.g. a
carefully-set repitch rate) — confirmed via `GET /document` before/after in pilot 93. The
"replace the clip's media on re-drop" behavior itself may be intentional (matches the documented
one-clip-per-track model), but destroying unrelated settings (warp mode, rate) that had nothing to
do with which sample is loaded is an unnecessary extra loss. Preserve `warp`/`rate`/`gainDb` across
a media replacement when technically sensible (a warp mode/rate that doesn't depend on which sample
is loaded should survive a swap), or at minimum show a confirmation before an overwrite that would
discard non-default settings.

## KB — Display/document persistence desync (verify first)

Pilot 93's repro: after switching to a freshly-captured drum clip, several grid clicks (a crash
accent, a syncopated kick, two rimshot fills) produced visible dots on screen but `GET /document`
showed the hit count completely unchanged after every retry — reproduced even immediately after a
hard page reload with zero intervening clicks, i.e. the WRONG state (fewer hits than what actually
persisted, or a phantom extra dot) survived a reload, not just a transient render lag. A second,
independent reproduction: typing a negative `rate` value on an audio clip's warp field visibly
updated the input and the clip's on-screen label, but `GET /document` never changed from the prior
value, and reloading reverted the display too.

This is the same bug family Phase 29 Stream GD targeted (rapid-edit data loss) and Phase 30 Stream
JA specifically re-tested extensively without reproducing it on a clean checkout. Before assuming
this is a real, still-open gap: reproduce pilot 93's EXACT scenario (capture a new scene via
`+ capture scene`, switch the editor to the captured clip, click to add hits at a deliberate,
human pace — not a rapid burst, since GD's fix already covers the rapid-burst case) against current
main, checking `GET /document` after each click and after a hard reload, on both the drum-hit path
and the audio clip's `rate` field specifically (a different code path than anything GD/JA tested,
since JA's stream focused on drums, not audio clip properties). If it reproduces, trace the actual
request being sent (network tab / `postEdit`/`bridge.ts`'s relevant function for whichever field is
involved) versus what the daemon actually receives and writes — the divergence point is the finding.
If it does not reproduce, document the negative result with the same rigor JA used and move on.

## KC — Note editor interaction fixes

1. **A newly-added note isn't reliably the "active" one for keyboard shortcuts.** Clicking empty
   grid to add a note, then immediately using `Shift+ArrowRight` to resize it, can silently resize a
   DIFFERENT, previously-selected note instead — no visual indication anything went wrong (pilot 90).
   The newly-added note should become the active/selected one immediately, the same way it visually
   appears selected — find wherever note-add sets (or fails to set) the selection state and make it
   authoritative for the very next keyboard action.
2. **A new sticky-header instance overlaps the top of the scrollable note grid.** Distinct from the
   sticky title-bar bug Phase 29 Stream GC already fixed (that one was `.noteview-titlebar-name`
   re-docking over lane/pitch ROWS) — this is the `<track> / Clip / Device` TAB header itself sitting
   in front of (higher z-order than) the top ~35-40px of the scrollable note grid, even though the
   grid's own DOM bounding rect claims that space (pilot 91, confirmed via direct DOM bounding-rect
   inspection: clicks landing in that band produce zero visual change, no error). Apply the same
   scroll-margin/z-index fix pattern GC already used for the other sticky-header case, generalized to
   this one too.
3. **Investigate the mid-session off-by-one-row drift.** Pilot 90 found clicking a piano-roll row (or
   hit-lane) at its own measured position consistently placed the note/hit one row above the one
   clicked — but NOT at the very start of the session; it started happening after some scroll/reload
   activity, suggesting something desyncs the grid's pixel-to-row mapping mid-session rather than a
   static off-by-one (which Phase 29 Stream GC already fixed as a *permanent*, present-from-start
   bug). Try to reproduce: perform a sequence of scrolls, zoom changes, and/or a page interaction
   pattern similar to pilot 90's session (extending loop length, switching sections, several rounds
   of note placement) and check whether the row-to-pixel mapping drifts. If reproducible, find what
   state the mapping is computed from and why it goes stale. If not reproducible after a good-faith
   attempt, document the negative result rather than guessing at a fix.

## KD — Synth panel UX

1. **Filter-envelope amount defaults to 0% and silently gates the adjacent shape knobs, with no
   visual cue.** The four shape knobs (attack/decay/sustain/release) sit immediately next to cutoff/
   resonance, reading as a complete, self-contained "the filter envelope" — nothing signals that a
   fifth, separate `FENV`/amount knob gates whether any of the shape knobs have audible effect at all
   (pilots 90, 91 both hit this independently). Add a visual cue when amount is 0 — dim/grey the
   shape knobs, or a small inline "inactive until Amount > 0" label — so a user tweaking
   attack/decay/sustain/release at 0% amount gets a signal instead of silence.
2. **A freshly-added effect defaults to 0% mix, audibly inert, with the same "no visual cue" problem**
   (pilot 90) — apply the same dim/label treatment to a newly-added effect's mix control when it's at
   0%.
3. **Envelope header lacks sub-labels distinguishing amp envelope from filter envelope.** Both live
   under one "FILTER & ENVELOPE" header with no label separating the plain ADSR (amp) from the
   FENV-prefixed set (filter) — a user has to read each knob's own label carefully rather than glance
   at a section heading (pilot 90). Add a small sub-label ("Amp Envelope" / "Filter Envelope") above
   each ADSR group.
4. **PRESET dropdown shows a stale/misleading label on a fresh track whose live params don't match
   any catalog preset — confirmed root cause.** `SynthPanel.tsx`'s `PresetPicker` (~line 296): its
   `cursor` state initializes to `0` and `findMatchingPresetIndex` only moves it when a real match is
   found (`idx !== -1`), leaving `cursor` — and the displayed label — pointing at whatever preset
   happens to be first in the filtered catalog when NO match is found (pilot 91 found this showing
   "deep-sub-bass — bass" on a freshly-initialized sawtooth lead track). Add a "custom"/no-selection
   display state for the no-match case instead of defaulting to index 0's label — the dropdown should
   never claim a preset is applied when `findMatchingPresetIndex` returned -1.
5. **Knob drag-sensitivity is wildly inconsistent across parameter types with no visual cue.** A
   ~25px drag can move a linear/percentage param by a modest amount while moving a steep-log param
   (cutoff, resonance) across nearly its whole range in one pass — every knob looks identical
   regardless (pilot 91). Investigate `Knob.tsx`'s drag-to-value mapping; if params are individually
   configured with wildly different effective sensitivities, consider normalizing so a given pixel
   distance produces a more perceptually-consistent change across knob types, OR (if normalizing risks
   behavior changes across many call sites) add a visual affordance distinguishing a "coarse" knob
   from a "fine" one. Use judgment on which is more contained — this item has more open design space
   than the others in this stream; a real improvement is the goal, not a specific mechanism.

## KE — Small copy/interaction fixes

1. **Track rename requires two double-clicks, not one.** The arrangement's hint text says
   "double-click to rename," but the first double-click on an unselected track actually SELECTS it
   (also surfacing an unrelated "vary filter/vary feel" toolbar); only a second double-click, with
   the track already selected, opens the real rename field (pilot 90). Make a double-click on an
   unselected track both select it AND open the rename field in one action, rather than requiring two
   separate double-clicks.
2. **Audio clip's "Transpose" equivalent is a bare `rate` number field nested inside a `warp`
   dropdown, not a labeled semitone knob.** Functionally works (confirmed in pilot 93) but a user
   reading "locate the Transpose knob" (or just exploring cold) wouldn't connect that instruction to
   a field labeled "rate" under "warp: repitch." Relabel or add a clarifying inline note (e.g.
   "rate (pitch + speed)" or a small "≈ transpose" annotation) so the connection is discoverable
   without already knowing dotbeat's internals.
3. **"new project…"'s toast gives a CLI-only next step a GUI-only user can't act on.** Creates the
   file correctly but the browser-hosted GUI can't switch itself to the new path (a real, structural
   browser-mode constraint — the daemon would need to be restarted pointed at the new file, which
   only the desktop app or CLI can do). The current toast ("Point a beat daemon at it to open it.")
   assumes CLI knowledge. Bring this in line with how the "open folder…" button already communicates
   its own desktop-only limitation (check that button's tooltip/disabled-state copy) — a GUI user
   should get an honest, consistent explanation of the same underlying constraint, not two different
   messaging styles for the same limitation.
4. **Of the three near-identical "+X" scene-creation buttons, the most prominent one is the
   footgun.** `+ section` (first, most inviting) duplicates by reference; `+ capture scene` (the one
   that actually gives independent content) is labeled like a performance action, not an authoring
   one (pilots 90, 93, echoing 86/88 too). The existing tooltips are already accurate (confirmed by
   pilot 87) — this item is about visual/positional prominence and label wording, not adding new
   functionality. Consider: reordering so the safer/more-commonly-wanted option isn't visually
   buried, or strengthening the labels themselves (e.g. spelling out "shares content" / "independent
   copy" directly in the button text rather than only in a hover tooltip). Use judgment on the
   smallest change that meaningfully improves this without a bigger redesign.

## Merge order

KA and KB both touch scene/clip-targeting and note/audio editing paths that overlap with KC's
NoteView.tsx work — merge KA first (verification-gated, potentially the most impactful), then KB
(also verification-gated), then KC. KD is isolated to SynthPanel.tsx/Knob.tsx and safe to merge
anytime after KC. KE is the most isolated (small, scattered copy/label fixes) and safest last.

## Verification approach

Same discipline as every prior phase: after each merge, independently re-run core typecheck, UI
typecheck, full `npm test`, the just-merged stream's own live-verify script, and 1-2 prior streams'
verify scripts as cross-stream regression checks. For KA item 1 and KB specifically, do not accept a
"looks fixed" claim without a `GET /document` (or `beat inspect`) check after a GUI-driven edit and
after a full page reload — that is exactly the class of bug where the screen alone is insufficient
evidence, as pilot 93 demonstrated directly.

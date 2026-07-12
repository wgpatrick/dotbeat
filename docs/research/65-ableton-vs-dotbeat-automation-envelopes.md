# Research 65 — Ableton Live 12 vs dotbeat: track/arrangement automation & envelope editing

*Direct feature/UI comparison, paired with research 46 (which is the grounded primer on Ableton
manual ch.25, pp.481-493, text-only). This doc adds nothing new about what Ableton's manual says —
it cross-references the same page range, now also grounded in 12 of that chapter's own screenshots
(`p-481.jpg` … `p-493.jpg`, all viewed this pass) — and instead answers a different question:
**where dotbeat's actual shipped automation UI (`ArrangementView.tsx`'s `AutomationLane`/
`AutomationPicker`, `src/core/document.ts`'s `BeatAutomationPoint`/`BeatAutomationLane`) stands
next to Ableton's, feature by feature, with a priority call on every gap.** Research-only; no code
changes. Does not duplicate the clip-envelopes chapter (26, a sibling stream) — scope is
arrangement/track automation exactly as research 46 bounded it.*

## 0. What was actually inspected this pass

- **Ableton**: 12 of the 13 chapter-25 page images (`p-481.jpg` through `p-493.jpg` — every image
  in the sample manifest) — automation-arm transport button, the LED-on-slider automated-control
  convention, the Session-automation-recording preference panel, the Re-Enable Automation button,
  the Device/Control chooser pair with its ➕/➖ lane-popout buttons, the Draw Mode switch and a
  stepped freehand-drawn envelope over a waveform, a breakpoint's live value tooltip, drag-a-
  selection-of-breakpoints, a curved segment, the four-corner/four-edge stretch-skew handles with
  their live rectangle overlay, a before/after Simplify Envelope pair, the automation-shapes
  context-menu picker (two rows), the Lock Envelopes switch, and the tempo envelope with its BPM
  min/max scale fields.
- **dotbeat**: `ui/src/components/ArrangementView.tsx`'s `AutomationLane` (canvas-rendered curve +
  pointer-drag editing, lines 857-1081), `AutomationPicker` (param `<select>` + `+ add lane`,
  1085-1107), the per-track `A` toggle and lane-mount wiring (2418-2491); `src/core/document.ts`'s
  `BeatAutomationPoint`/`BeatAutomationLane` (438-454) and `AUTOMATABLE_SYNTH_PARAMS`/
  `AUDIO_AUTOMATABLE_PARAMS` (989-992, 533); `src/core/edit.ts`'s `addAutomationPoint`/
  `setAutomationPoint`/`moveAutomationPoint`/`removeAutomationPoint` (1089-1186); and
  `docs/product-roadmap.md`'s Automation table (lines 143-151) plus `docs/decisions.md` for any
  decision that would make a gap a closed question rather than an open one. No automation-relevant
  decision exists in `docs/decisions.md` — this is genuinely open roadmap territory, confirmed by
  reading D1-D15 in full.

---

## 1. Feature & UI/UX comparison

### a) Shared features / parity

| Capability | Ableton | dotbeat |
|---|---|---|
| Per-parameter breakpoint envelope, drawn as a curve over time | ✅ core model, chapter's entire subject | ✅ `BeatAutomationPoint[]` per `BeatAutomationLane`, one lane per param |
| Add a breakpoint by clicking | ✅ click a line segment or double-click empty space [manual p.487] | ✅ click empty lane space (`AutomationLane`'s `onPointerDown`, `ArrangementView.tsx:1015-1019`) |
| Move a breakpoint by dragging | ✅ [manual p.487] | ✅ hit-test + drag (`ArrangementView.tsx:996-1030`) |
| Delete a breakpoint | ✅ click it directly [manual p.487] | ✅ alt-click (`ArrangementView.tsx:1007-1010`) |
| Stable per-point identity | implicit (breakpoints are objects in the envelope) | ✅ explicit `id` field, D6-style (`document.ts:443`) — arguably a stronger diff-friendliness guarantee than Ableton needs, since dotbeat's points are also git-diff lines |
| A picker to choose which device/parameter's curve is showing | ✅ Device chooser + Control chooser, two linked `<select>`-style widgets [manual pp.485-486] | ✅ one param `<select>` per track (`AutomationPicker`, `ArrangementView.tsx:1085-1107`), derived from `synthParams.ts`'s `PARAM_GROUPS` — same "no hand-maintained parallel list" principle |
| A dedicated lane below the track for the curve, separate from track content | ✅ via the ➕ "pop out into its own lane" button [manual p.486] | ✅ this is dotbeat's *only* presentation — every shown param is already its own `AutomationLane` sub-row (`docs/phase-20-automation-lanes.md` "What was built" §2) |
| Removing/hiding a lane | ✅ ➖ button, with Alt/Cmd for bulk removal [manual p.486] | ✅ per-lane `×` button (`ArrangementView.tsx:1065-1067`); no bulk variant |
| Wide automatable-param surface (not just a handful of "special" knobs) | ✅ "practically all mixer and device controls" [manual p.481] | ✅ `AUTOMATABLE_SYNTH_PARAMS` derives from every numeric `SYNTH_FIELDS` entry (`document.ts:989-992`) — ~46 synth params plus mixer vol/pan plus (audio tracks) `gain` (`AUDIO_AUTOMATABLE_PARAMS`, `document.ts:533`); comparable breadth, narrower only in kind-count (no device-chain-of-devices concept to traverse, since dotbeat's per-track FX chain is flat) |
| Values held (not extrapolated) before the first / after the last point | ✅ implicit envelope behavior | ✅ explicit clamp — `AutomationLane`'s draw loop holds first/last value to tile edges (`ArrangementView.tsx:943-947`), matching `interpolateAutomation`'s clamping (`phase-20-automation-lanes.md`) |
| Writes land as a clean, isolated diff (one line changed, not a rewrite) | ✅ Ableton's binary/XML equivalent has no comparable diff story at all (research 01) — not a fair axis, but worth noting dotbeat wins outright here | ✅ verified live: dragging one breakpoint produces exactly a `+1/-1` line diff (`docs/phase-20-automation-lanes.md` "Z3") |

### b) In Ableton, not in dotbeat

1. **Automation scope is track/arrangement-wide, independent of any one clip** — an envelope can
   span multiple different clips playing on the same track over time, and **Lock Envelopes**
   [manual p.492] lets the curve stay pinned to song position even as clips underneath it move.
   dotbeat's automation is **clip-scoped only, by explicit v0.9 design** (`document.ts:539-543`
   comment: "deliberately NOT modeled at the live track / non-clip level") — the picker/curve
   target only a track's **first-playing** clip; a track that plays different clips in different
   song sections exposes only that one clip's automation
   (`docs/phase-20-automation-lanes.md` "What's deferred").
2. **Discovery UI for "what's already automated here"** — an LED lights up next to any control
   (mixer fader, device knob, switch) that carries automation [manual p.481, p.485-486], plus a
   "Show Automated Parameters Only" filter on the Device chooser. dotbeat has no equivalent: a
   param with existing points only becomes visible by opening the `A` toggle and finding it already
   rendered as a lane (`ArrangementView.tsx:2478-2491`) — no LED on the knob itself in `SynthPanel.tsx`
   (confirmed: `grep automat` on that file returns nothing automation-LED-related), no filtered view.
3. **Draw Mode** — a dedicated mode (`B` key or a Control Bar switch) where drag-and-paint replaces
   click-to-place-one-point, producing a step curve at grid resolution, with `Shift` for finer
   value resolution and a freehand (no-grid) variant [manual p.486-487, screenshot `p-487.jpg`
   showing a stepped red curve painted directly over a waveform]. dotbeat has exactly one gesture:
   click to place a single point, drag to move it (`AutomationLane`'s `onPointerDown`) — no
   paint-a-run-of-points mode at any resolution.
4. **Exact numeric value entry on a breakpoint** — right-click → "Edit Value" (existing point) or
   "Add Value" (a hovered not-yet-real point) opens a keyboard-editable field, shown live as a
   tooltip (`0.00 dB` in `p-488.jpg`) [manual p.488]. A selection of multiple points shifts
   relatively. dotbeat's drag is the only way to set a value — no numeric input, no on-canvas value
   readout while dragging (the code computes `drag.value` but never renders it to the user,
   `ArrangementView.tsx:1029`).
5. **Segment-level selection and drag** — click near (not on) a segment, or Shift-click on it, to
   select and drag an entire segment as one object, with automatic breakpoint insertion at a time
   selection's edges so the move doesn't bleed outside it [manual p.488]. dotbeat has no concept of
   a "segment" as a selectable/draggable unit — only individual points.
6. **Curved segments** — Alt/Option-drag a straight segment to bow it, double-click-with-modifier
   to flatten it back [manual p.489, `p-489.jpg`'s blue curved dip]. dotbeat's `BeatAutomationPoint`
   has no interpolation field at all — `document.ts:441` says so explicitly ("no interpolation
   field (curve shape — linear vs hold — is deferred)") and `product-roadmap.md:148` already tracks
   this as `❌ missing`, `⬜ Not started`. Every dotbeat segment is linear (or log-linear for
   log-scaled params like cutoff, per the engine's interpolation, not the UI).
7. **Stretch/skew a whole time-selected range** — four corner + four edge-midpoint drag handles on
   a hovered time selection: vertical stretch (rescale value range), horizontal stretch
   (time-rescale, with a Shift-to-preserve-tail-data variant), and corner-drag skew, all with a live
   rectangle overlay and snap-at-boundaries feedback [manual pp.489-490, `p-489.jpg`/`p-490.jpg`].
   dotbeat has no selection-level transform of any kind on automation — only single-point drags.
8. **Simplify Envelope** — one command that algorithmically reduces breakpoint count, replacing
   redundant points with straight or curved segments that reproduce the same curve within tolerance
   [manual p.490, `p-490.jpg`'s dense-vs-simplified before/after]. Framed explicitly as the antidote
   to *recorded* automation's breakpoint explosion. dotbeat has no automation recording yet (so the
   explosion problem hasn't materialized) and no Simplify command either.
9. **Predefined automation shapes** — right-click a time selection → insert one of five periodic
   waveforms (sine/triangle/sawtooth/inverse-sawtooth/square, scaled to the selection) or one of
   three linking shapes (two ramps + an ADSR, which connect to the existing curve's edge value)
   [manual p.491, `p-491.jpg`'s two-row picker]. dotbeat has no shape-insertion command — every
   curve is hand-placed point by point.
10. **Cross-parameter copy/paste** — an envelope's copied data can be pasted onto a *different*
    parameter's lane, deliberately ungated by type compatibility [manual p.492]. dotbeat's
    `postAutomation` route only ever writes points into the lane the drag originated in
    (`ArrangementView.tsx:1042-1044`); there's no copy/paste concept for automation at all yet.
11. **Automation recording from live control moves** — turning a knob while Arrangement Record +
    Automation Arm are both on writes automation directly, with distinct "touch" (mouse, stops on
    release) vs. "latch" (MIDI hardware, continues to loop end) behaviors [manual pp.481-483,
    `p-481.jpg`'s Automation Arm button, `p-483.jpg`'s recording-controls diagram]. dotbeat has no
    automation-recording path — every point is placed by explicit click/drag in the editor, never
    captured from a live performance gesture. (Research 46 §2 already flags this as a natural
    extension of the existing daemon `/automate` route, not yet built.)
12. **Override / Re-Enable Automation** — nudging an automated control while not recording silently
    "overrides" it (LED off, plays your manual value); a Control Bar button snaps every overridden
    control back to what's written [manual pp.484-485, `p-484.jpg`]. This is a live-mixing
    monitoring affordance with **no dotbeat analog and, per research 46 §7.2 item 7, none
    recommended** — dotbeat's document-edit-and-commit model already has a structurally different
    (and arguably better-suited) safety net: undo/redo and checkpoint/history. Listed here for
    completeness only.
13. **Tempo as an automated parameter** — the song's tempo is edited through the exact same
    envelope UI as any other control, with the value axis's own scale (min/max BPM fields) doubling
    as the assigned MIDI controller's mapped range [manual pp.492-493, `p-493.jpg`]. dotbeat has a
    single scalar `tempo` field per document (no timeline-scoped tempo concept at all,
    `docs/format-spec.md:833`, `:909`), so there is no attachment point for this yet — a
    prerequisite, engine-level gap, not an automation-UI gap.
14. **Delete Automation as a global per-parameter wipe** — one command clears every occurrence of a
    parameter's automation across the whole Arrangement and all Session clips at once
    [manual p.484]. dotbeat's closest equivalent, the lane `×` button, only clears the lane on the
    *currently visible* clip — consistent with (b)1's clip-scoping gap, not a separate one.

### c) In dotbeat, not in Ableton

1. **Automation is a plain, versioned text fact, not a binary/XML blob.** Every `point` line is
   independently diffable, greppable, and mergeable by an agent or a human reading `git diff` — no
   Ableton `.als` equivalent exists per research 01's own findings ("not confirmed cleanly
   human-readable even decompressed"). This is dotbeat's whole thesis showing up concretely in this
   one feature area.
2. **CLI/MCP-native editing of automation points**, not just GUI: `beat automate` / `beat_automate`
   (MCP tool) hit the exact same `setAutomationPoint`/`removeAutomationPoint` primitives the canvas
   drag uses (`src/core/edit.ts:1089-1186`, `docs/phase-20-automation-lanes.md` §3). An agent can
   script a whole envelope in one shot without touching the GUI at all — Ableton has no headless or
   scriptable equivalent for arrangement automation.
3. **Automation participates in the semantic `beat diff`** (D8's `DiffEntry` machinery) — a
   breakpoint move shows up as a musical-language diff entry (e.g. "cutoff automation point moved"),
   not just a raw text change. Ableton has no comparable structured-diff concept for automation data
   at all (nothing to diff against).
4. **The picker derives its option list from the same declarative table `SynthPanel` renders**
   (`synthParams.ts`'s `PARAM_GROUPS`, filtered to `kind: 'knob'`) rather than a hand-maintained
   parallel list — a smaller, single-source-of-truth surface than Ableton's two-level Device/Control
   chooser tree, which has to traverse an open-ended device chain. Not a "missing feature" so much
   as a structurally simpler (if narrower) alternative given dotbeat's flat per-track FX-chain model.

---

## 2. Prioritized recommendations

| Feature | Priority | Build recommendation |
|---|---|---|
| Curved segments (interpolation field) | **P0** | Add `interpolation?: 'linear' \| 'hold' \| 'curve'` to `BeatAutomationPoint` (`src/core/document.ts:442-446`), defaulting to `'linear'` and elided when default (same canonical-elision discipline as v0.3's `SYNTH_FIELDS`, D9). Store the flag on the point that **starts** the segment, mirroring Ableton's per-segment (not per-lane) curve gesture [manual p.489]. UI: in `AutomationLane`'s `onPointerDown`/`draw` (`ArrangementView.tsx:900-1030`), add an Alt/Option-drag-on-segment gesture that bows the drawn line (quadratic bezier toward the drag point is a reasonable first cut) and writes `interpolation: 'curve'` via a new `postAutomation` op; `'hold'` needs no drag gesture, just a per-point toggle (useful for discrete params like the picker's few remaining bool/enum-adjacent fields). Engine-side, extend the existing per-param interpolation logic in `ui/src/audio/engine.ts` (already log-space-aware for cutoff, per `phase-20-automation-lanes.md`) to branch on the flag. Already tracked as `❌ missing` in `docs/product-roadmap.md:148` — this closes that row. Highest leverage: smallest format change, and it's the *one* gap every other Ableton curve-shaping feature (predefined shapes, ADSR) depends on. |
| Exact numeric value entry on a breakpoint | **P0** | Add a right-click (or long-press, for parity with dotbeat's existing touch-friendly patterns) handler in `AutomationLane` that opens a small inline numeric `<input>` near the hit-tested marker, pre-filled with the point's current value formatted via the existing `spec.format` (`ArrangementView.tsx:1055`), committing through the exact same `postAutomation({ op: 'set', ... })` path a drag already uses (`ArrangementView.tsx:1042`). No new daemon route or core primitive needed — this is pure UI. Also surface the **live value readout while dragging** that Ableton always shows (`ArrangementView.tsx:1029` already computes `drag.value`, it's just never rendered) — a small floating label near the cursor during drag, essentially free given the data already exists. High value-per-effort; ship alongside curved segments since both touch the same component. |
| Discovery UI: which params are already automated on this track | **P1** | The picker (`AutomationPicker`, `ArrangementView.tsx:1085-1107`) already filters to non-visible params (`visibleParamsFor`) — extend its `<option>` labels (or the `A` toggle button itself) with a small dot/badge for any param in `AUTOMATABLE_SYNTH_PARAMS` that has a non-empty lane on the track's primary clip (cheap: iterate `track.clips[0].automation` client-side, no new backend data). This directly answers Ableton's LED-and-filter discovery UX [manual pp.485-486] without needing a device-chain traversal, since dotbeat's automatable surface is already one flat per-track list. |
| Segment-level selection and drag | **P1** | A real but contained lift on top of the existing point-drag machinery in `AutomationLane`: add a "click near but not on a point" hit-test tier (between the point-radius `MARKER_HIT` and a wider segment-hit threshold) that selects the two flanking points as a pair, then extends `dragRef` to move both together on drag. Time-selection-based auto-insert-at-edges (Ableton's refinement, [manual p.488]) can be deferred to a follow-up — the bare "drag two points as one segment" gesture is the 80% case. Natural sequel to curved segments since both touch segment identity, not just point identity. |
| Cross-parameter copy/paste | **P1** | A small, high-leverage addition once exact-value entry ships: a keyboard shortcut (Cmd/Ctrl+C on a selected lane, Cmd/Ctrl+V on a target lane) that copies the source lane's `points` array (normalized to 0-1 within its own min/max, since target params have different ranges) and re-denormalizes into the target's `spec.min/max` on paste, writing each point via the existing `postAutomation` set op in sequence. Deliberately keep Ableton's own "don't gate by type compatibility" stance [manual p.492] — dotbeat's flat automatable-param list makes this cheap to allow universally. |
| Draw Mode (paint a run of points at grid resolution) | **P2** | Real authoring accelerant but a genuinely new interaction mode, not a small tweak — needs a Draw-Mode toggle (a new arrangement-level UI state, not per-lane), a grid-resolution-aware paint loop that mints/updates one point per grid cell along the drag path, and a decision on whether `Shift` gives fine-grained value control as in Ableton [manual p.486-487] or reuses dotbeat's existing snap conventions. Worth building only after curved segments and segment-drag land, since Draw Mode's main value (fast, dense curve authoring) is far more useful once curves can actually bow rather than being forced linear. |
| Stretch/skew a time-selected range | **P2** | Depends on a time-selection concept scoped to a single automation lane, which dotbeat doesn't have today (the existing selection protocol, `daemon /selection`, is track/bar-range at the arrangement level, not lane-local). Build the lane-local time-selection UI first (drag across empty lane background to select a range, mirroring Ableton's own gesture [manual p.489]), then layer stretch/skew handles on top. A real, valuable feature, but sequenced behind curved segments + segment drag since the four-handle transform is meaningless without them (skew is directly analogous to segment drag generalized to N points). |
| Simplify Envelope | **P2** | Genuinely cheap as a pure geometric reduction over `BeatAutomationPoint[]` (points within tolerance of a straight/curved line through neighbors get dropped) — no new format field, just a new core primitive (`simplifyAutomation(doc, track, clip, param, tolerance)` alongside `addAutomationPoint`/`setAutomationPoint` in `src/core/edit.ts`) plus a lane-header button. Genuinely useful *today* even without automation recording (a manually-drawn 40-point curve is real noise in the `.beat` diff), but demoted to P2 because dotbeat has no recording path yet, so the breakpoint-explosion problem this solves hasn't actually manifested — build it when automation recording (a P1/P2 item of its own, not in this table since it's out of ch.25's b-list scope as *editing*, not *feature parity*) gets scoped, or sooner if manual curve-drawing sessions start producing visibly noisy diffs in practice. |
| Predefined automation shapes (waveforms + ADSR/ramps) | **P2** | Sequence strictly after curved segments (item 1) — the ADSR and ramp shapes are meaningless without curve support, and the periodic-waveform row (sine/triangle/etc.) is a closed-form point generator that's easy to add as a small picker UI once a "time selection on a lane" concept exists (shared prerequisite with stretch/skew). Reasonable single unit of work combining a shape-picker button on the lane header + a pure-function point generator (`src/core/automationShapes.ts`) taking (selection range, param min/max, shape) → `BeatAutomationPoint[]`, wired through the existing `setAutomationPoint` primitive in a batch. |
| Multi-clip / track-scoped automation (Lock Envelopes equivalent) | **P1** | Not a small UI addition — this is the single biggest structural gap ((b)1 above) and research 46 §7.2 item 3 already scoped the honest shape of the fix: **not** a second parallel track-level automation data structure, but automation attached at the **scene/section slot-mapping level** rather than the clip object, so a curve can span multiple scenes/clips the way a Lock-Envelopes curve spans multiple Ableton clips. Flagged P1 (not P0) because it's a real format decision needing its own scoped design pass before building — same caution research 46 already gave it — but it should be the next automation-format design pass scheduled, since every other clip-scoping limitation (Delete Automation's global-wipe semantics, the "first-playing clip only" UI restriction, loop-mode automation being entirely absent) traces back to this one root cause. Do not build items further down this list (shapes, stretch/skew) as if the clip/track question is settled — those all assume "one lane, one clip" today and may need revisiting once this lands. |
| Automation recording from live control moves (touch/latch) | **Do-not-recreate (for now)** | Real feature, but it's a different *category* of work (a live-input capture path into the daemon, not an editor-UI gesture) and dotbeat has no realtime knob-twiddling-while-playing capture mechanism to hang it on yet — building it now would mean inventing that capture path *and* the touch/latch semantics simultaneously, disproportionate to this doc's editor-UI scope. Revisit once/if a live-performance-capture use case is actually requested; until then, every point is authored explicitly (click/drag/agent), which fits dotbeat's document-as-source-of-truth model better anyway. |
| Override / Re-Enable Automation | **Do-not-recreate** | Confirmed no-op for dotbeat by research 46 §7.2 item 7's own analysis, reconfirmed this pass: it's a live-mixing monitoring affordance for a real-time performance tool. dotbeat's structurally different safety net (undo/redo, `docs/product-roadmap.md`'s Undo/redo row, still `⬜ Not started` itself — and checkpoint/history, already `✅ Done`) already covers the "try something, revert" need at a coarser and arguably more useful grain (a whole edit or checkpoint, not one overridden control). No action. |
| Delete Automation (global per-parameter wipe across all clips) | **Do-not-recreate (until item "multi-clip/track-scoped automation" ships)** | This command's whole premise — one wipe clears a parameter across the *entire* Arrangement and all Session clips — only makes sense once automation isn't clip-scoped. Building a "delete across all clips" command against today's one-clip-per-lane model would just be a confusing, over-scoped version of the existing per-lane `×` button. Revisit as a natural companion to the P1 clip/track-scope item above, not before. |
| Tempo as an automated parameter | **Do-not-recreate (blocked on an engine prerequisite, not an automation-UI decision)** | Correctly identified as out of scope by research 46 §7.2 item 6: dotbeat's engine is constant-tempo, single scalar `tempo` field (`document.ts`, `format-spec.md:833`), with arbitrary tempo-change support explicitly named as a separate, larger, already-tracked future item (`format-spec.md:909`). Nothing to build in the automation-editing surface until that engine work lands — flagged here only so it isn't mistaken for a small automation-panel gap. |

---

## Sources

Ableton Live 12 Reference Manual, chapter 25 "Automation and Editing Envelopes," pp.481-493
(`prior_art/`, gitignored) — text via `docs/research/46-ableton-automation-envelopes.md`'s own
extraction, screenshots viewed directly this pass: `/Users/willpatrick/.claude/jobs/32ed678c/tmp/
ableton-images/ch25/p-481.jpg` through `p-493.jpg` (12 of 13 sampled images, every file in
`SAMPLE_MANIFEST.txt`). dotbeat citations: `ui/src/components/ArrangementView.tsx` (`AutomationLane`
857-1081, `AutomationPicker` 1085-1107, lane-mount wiring 2400-2494, layout constants 255-258),
`src/core/document.ts` (`BeatAutomationPoint`/`BeatAutomationLane` 438-454, `AUDIO_AUTOMATABLE_PARAMS`
533, `AUTOMATABLE_SYNTH_PARAMS` 989-992), `src/core/edit.ts` (`addAutomationPoint`/
`setAutomationPoint`/`moveAutomationPoint`/`removeAutomationPoint` 1089-1186), `docs/phase-20-
automation-lanes.md` (as-built GUI, verification evidence, deferred-items list), `docs/product-
roadmap.md` (Automation feature-area table, lines 143-151), `docs/decisions.md` (D1-D15, confirmed
no automation-scoped decision exists — this territory is genuinely open), `docs/research/46-
ableton-automation-envelopes.md` (the sibling text-only primer this doc cross-references throughout,
not duplicates).

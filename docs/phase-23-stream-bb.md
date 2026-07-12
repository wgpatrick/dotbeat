# Phase 23 Stream BB — GUI completion bundle: drum lanes, mixer, presets, vary

*Per `docs/phase-23-plan.md`'s Stream BB. Four sub-items, investigated honestly before building —
one turned out to need real new core plumbing (drum lanes), one was a genuine but small gap (hot-
swap preset browser), one was a decision-not-a-build (mixer mute/solo), and one composed cleanly
out of Phase 15's existing audition machinery (rung-2 feel).*

## Summary

| Sub-item | Verdict before building | What shipped |
|---|---|---|
| Drum-lane editing affordance | Real, unbuilt gap (Phase 22 Stream AB's own §5 flagged it) | New core primitives (`materializeLanes`/`addLane`/`removeLane`/`moveLane`/`setLaneBacking`/`setLaneParam`), `POST /lane`, a Lanes panel in the Clip View |
| Mixer persisted mute/solo | Needed a decision, not a build | Confirmed transient-only is correct; decision recorded as a doc comment on `store.ts`, roadmap row closed |
| Hot-swap preset browser in Device View | Real gap — Phase 22 Stream AH's own honest-gaps section named it explicitly | A preset picker inside `SynthPanel`, a soundfont picker inside `InstrumentPanel`, reusing AH's existing daemon routes |
| Rung-2 "feel" GUI affordance | Real gap — Phase 15's own "what's deferred" section named it | A second "≈ vary feel" trigger in `VaryAffordance.tsx`, `POST /vary-feel` + `POST /vary-feel/commit` |

`npm test`: **506/506/0/0** (490 pre-existing + 9 new lane-primitive tests in
`test/format-v10-drum-lanes.test.ts` + 7 new daemon-route tests in `test/daemon.test.ts`). Both
typechecks clean (`npx tsc -p tsconfig.json --noEmit`, `cd ui && npx tsc --noEmit`).
Live verification: `node ui/verify-phase23-bb.mjs` — 10 checks (L1-L10), all real browser + real
daemon + real file, screenshot `ui/verify-p23bb.png`.

---

## 1. Drum-lane editing affordance

### What was missing

Phase 22 Stream AB (`docs/phase-22-stream-ab.md`) shipped the open per-track lane model
(`BeatDrumLaneDecl[]`, synth/sample/sf backings) end-to-end at the format/engine/CLI layer, but its
own §5 named the gap directly: *"No GUI knob surface for per-lane synth params... no dedicated
`setValue` path for `lanes[].backing.params` was added either; extending `applyDrumKit`-style
replace-the-whole-lane semantics to a fine-grained per-param edit is future work."* There was
genuinely no way to add, reorder, retype, or fine-tune a declared lane except hand-editing the file
or replacing a track's *entire* lane list via `beat drum-kit`.

### Core: five new structural primitives (`src/core/edit.ts`)

Mirroring the v0.10 effect-chain primitives' own split (add/remove/move change the LIST's shape or
order and get dedicated functions; a flat field-set fits `setValue`) rather than shoehorning a
list-shape change into `setValue`'s `path=value` grammar:

- **`materializeLanes(doc, trackId)`** — the one-time, explicit opt-in a legacy/migrated track
  (`lanes: []`, playing through the untouched 5-lane switch) needs before any of the below apply.
  Maps the OLD track-wide voice-shaping fields (`kickTune`/`kickPunch`/`kickDecay`,
  `snareTone`/`snareDecay`, `hatDecay`/`hatTone`/`openHatDecay`) onto the 5 new per-lane synth
  backings, so the migrated kit's *current* tuning carries over rather than resetting to voice
  defaults. `clap` has no legacy field (the engine hard-wires a fixed pink-noise voice for it) —
  it lands on the new model's plain noise defaults, the closest honest equivalent, documented as
  such in the function's own comment. A no-op (referentially unchanged) if the track already
  declares lanes.
- **`addLane`/`removeLane`/`moveLane`** — same shape as `addEffect`/`removeEffect`/`moveEffect`.
  `removeLane` refuses if a hit still references the lane (`"remove or re-lane them first"`, the
  same discipline `applyDrumKit`'s orphan check already uses). All three require the track already
  be on the open lane model (`materializeLanes` first) — a clear, fail-loud error names the fix.
- **`setLaneBacking`** — retypes/replaces one lane's whole backing (e.g. `synth:membrane` ->
  `sample`), the lane-level analog of `applyDrumKit`'s whole-list replace, scoped to one lane. The
  lane's *name* (and every hit referencing it) is untouched.
- **`setLaneParam`** — the exact gap Stream AB's §5 named: a fine-grained single-param edit on a
  synth-backed lane (`value === undefined` clears back to that voice type's default, matching
  `serialize.ts`'s own canonical-elision discipline for these params).

A parallel, small backing-grammar tokenizer (`parseLaneBackingTokens`) lives in `edit.ts` rather
than being shared with `parse.ts`'s `tryParseLaneDecl` — same reasoning `drumkit.ts`'s own header
comment already gives for its own third implementation: three different callers need three
different error shapes (`BeatParseError` with a line number, a JSON-object-shaped validator, and
`BeatEditError` with none), so a shared function would need to paper over that rather than solve it.

### Daemon: `POST /lane` (`src/daemon/daemon.ts`)

One route, six ops (`materialize`/`add`/`remove`/`move`/`backing`/`param`) — same "whole-statement
op" shape `POST /group` already established for the same reason: a lane list's shape/order isn't a
single `{path,value}` scalar. Wraps the five core primitives verbatim; returns the fresh document
(the daemon never SSE-echoes its own writes, the established convention every structural route
already follows).

### GUI: the Lanes panel (`ui/src/components/DrumLanePanel.tsx`, new)

Docked at the top of the Clip View (`NoteView.tsx`, drum tracks only) — the plan's own pointer
("the drum clip editor... `NoteView.tsx`'s row-axis adapter"). Defaults *expanded* (unlike
`ContentBrowser.tsx`'s collapsed-by-default sections): this is the primary way to manage a kit's
voicing, not an occasional drawer, the same "always visible" treatment `SynthPanel`'s `EffectChain`
already gets.

- A legacy track shows an "Enable lane editing" button (`materializeLanes`) with a plain-language
  explanation that the current sound carries over.
- An open-model track lists every declared lane: name, a one-line backing summary, ▲/▼ reorder
  buttons (same pattern `EffectRow`'s move buttons already use — a keyboard/click-reachable
  fallback for drag, and a far more reliable hook for automated verification than simulating
  native drag events), an "edit" disclosure exposing the backing's fields (voice + per-param
  number inputs for synth; sample/gain/tune for sample, populated from the project's own
  registered media; bank/program/note for sf), a "type" selector that retypes the backing
  (synth/sample/sf — sample/sf switching refuses with a clear message if the project has no
  registered sample/soundfont of that kind yet, rather than guessing a bogus reference), and a ✕
  remove button.
- An "Add lane" mini-form (name + starting voice) appends a new declared lane. The newly-added
  lane immediately gets its own row in the note-grid gutter (`NoteView.tsx`'s existing row-axis
  machinery — no changes needed there beyond mounting the panel, since `declaredLaneNames`/
  `buildLaneAxis` already iterate whatever `track.lanes` currently holds).

### Honest gap: dragging a sample straight onto a brand-new custom lane isn't wired

Phase 22 Stream AH's content-browser drag (`POST /library/install-kit`) is scoped to the CLOSED 5
`DrumLane` names (`kick`/`snare`/`clap`/`hat`/`openhat`) — it writes through the legacy
`setLaneSample`/`laneSamples` mechanism, a structurally different map from the new
`lanes[].backing` this stream adds. Dragging a kit one-shot onto one of the *original* 5 lane rows
still works exactly as AH built it (independent of whether the track has been materialized). But a
genuinely new custom-named lane (e.g. "extra1") has no drag target — the correct, wired way to
attach a registered sample to it is this stream's own retype-to-sample control, which lists the
project's real registered media. `ui/verify-phase23-bb.mjs`'s L5 check demonstrates the honest
composition: drag a one-shot in via AH's existing mechanism (registering it into the project), then
use this stream's retype control to point the new lane at it — not a fabricated direct drag that
doesn't correspond to any real wiring.

---

## 2. Mixer's persisted mute/solo representation — a decision, not a build

The plan asked for "a real decision (should either become a saved `BeatTrack` field?)... or write a
clear justification for keeping it transient." `ui/src/state/store.ts` already carried a one-line
justification from Phase 14; this stream revisited it deliberately rather than treating that as
settled by inertia, and confirmed transient-only is correct — for three independent reasons, now
recorded as an expanded doc comment on `store.ts`'s `mutes`/`solos` fields (not a new file, so the
reasoning stays next to the code it governs):

1. **Real DAWs treat mute/solo as session/monitoring state, not composition data** (Ableton, Logic
   — the research-18 precedent this row's own research doc points at).
2. **dotbeat already applies the identical rule elsewhere.** `BeatGroup.collapsed`/`expanded`
   (`src/core/document.ts`) is explicitly UI-only for the same reason, and that field's own doc
   comment already cross-references mute/solo — this stream's decision is consistent with existing
   precedent, not inventing a new one.
3. **The `.beat` format's whole premise is a diff that means something musically** (`decisions.md`).
   A solo toggled to audition one track while arranging would otherwise leave a line in every commit
   that isn't a musical choice — the opposite of the format's design goal.

Nothing was added to `BeatTrack`. `ui/verify-phase23-bb.mjs`'s L10 check proves the decision is
*honored*, not just stated: toggling mute updates store/engine state (the existing real-audio gate)
while leaving the `.beat` file byte-identical.

---

## 3. Hot-swap preset browser in Device View

### What was missing

Phase 22 Stream AH's own honest-gaps section (`docs/phase-22-stream-ah.md`) named this precisely:
*"A preset picker/prev-next control living in the panel itself, so a preset can be swapped without
leaving Device View. This is a DISTINCT feature from the sidebar... and was NOT built this
stream."* Checked before building anything: `SynthPanel.tsx`/`InstrumentPanel.tsx` were untouched
by AH, confirming the gap was real, not already covered.

### What shipped

- **`PresetPicker`** (`ui/src/components/SynthPanel.tsx`) — a select + ◀/▶ pair at the top of the
  panel for synth/drum tracks, filtered to that kind's presets (`kind === track.kind || 'any'`).
  Selecting/stepping calls `applyPresetToTrack` — the *exact* client function AH's sidebar drag
  already uses, which wraps core's `applyPreset` (a literal param bag, never a reference —
  `format-spec.md`'s "presets are tooling" precedent). No new daemon route needed.
- **`SoundfontPicker`** (`ui/src/components/InstrumentPanel.tsx`) — the instrument-track analog:
  swaps which bank an instrument track plays via `installSoundfont`, again the exact client
  function AH's sidebar "+" button already uses.
- Since "which preset is currently applied" has no in-file answer (`applyPreset` never leaves a
  reference — there is genuinely nothing to read back), the Prev/Next cursor is local UI browsing
  state only, not a claim about what's live. This is documented directly in the component: picking
  an entry *applies* it; the cursor just remembers where Prev/Next currently points.

`ui/verify-phase23-bb.mjs`'s L7/L8 checks prove both: applying `deep-sub-bass` from inside
`SynthPanel` writes literal params (no `preset` keyword) exactly like AH's own sidebar-drop
verification, and swapping an instrument track's bank from inside `InstrumentPanel` produces a
real, persisted file change.

---

## 4. Rung-2 "feel" content variation, wired into the GUI

### What was missing

Phase 15's own "what's deferred" section (`docs/phase-15-vary-affordance.md`) named it directly:
*"`feel` (rung-2) content variation over the affordance... a natural next increment; the
audition/keep machinery here (snapshot + in-memory apply + commit) already generalizes to it."*
`beat vary <file> <track> feel` (core's `varyFeel`, `src/vary/vary.ts`) has existed since before
this phase; there was no GUI trigger for it.

### Why it needed new daemon plumbing (not just a GUI wrapper on `/vary`)

Rung-1 `varyTrack` produces a small `{path,value}` edit list per variant — cheap to audition (apply
in memory) and cheap to keep (replay through `postEdit`). Rung-2 `varyFeel` calls `humanize`, which
rewrites *many* individual note/hit timing/velocity fields per variant — there's no small edit list
to hand back, only a full resulting document. So this stream added:

- **`POST /vary-feel`** (`src/daemon/daemon.ts`) — read-only, mirrors `/vary`'s selection-scoping:
  it reuses `resolveVaryTarget` for track resolution and the SAME enforced-scope guarantee (spec
  §2 — a selection naming specific tracks refuses a vary aimed elsewhere), discarding the `group`
  it also returns (irrelevant to feel). Each variant in the response carries its own reproducible
  `seed` (`baseSeed + index`, exactly `varyFeel`'s own scheme) plus the FULL resulting document.
- **`POST /vary-feel/commit`** — the "Keep" half. Resending the exact seed a batch offered
  regenerates byte-identical content deterministically (same `(doc, track, seed, lanes)` inputs ->
  same `humanize` output), so committing needs no edit-list replay — just re-run `humanize` and
  write. Verified in `test/daemon.test.ts` to match the audited variant's content exactly (modulo
  array order — see below).

### GUI: a second trigger in `VaryAffordance.tsx`

"≈ vary feel" sits next to the existing "≈ vary `<group>`" trigger, same contextual-bar placement
(research 10's Photoshop Contextual Task Bar pattern Phase 15 already established). A parallel
`feelBatch`/`feelIndex` state pair drives its own audition strip (Prev/Next/Keep/Undo) — kept
structurally separate from the rung-1 `batch` state rather than unified, because the two audition
models are genuinely different (apply-edits-to-a-snapshot vs. setDoc-the-variant-directly) and
conflating them would obscure that. Selecting a drum lane (the same gesture that already narrows
rung-1's group) also narrows rung-2's scope via the new `feelLaneScope` helper, so "select the hats,
vary feel" humanizes just the hats — the same one-click, no-typing shape the product spec's
signature demo already establishes for rung 1.

### Honest gap carried forward, not closed here

Scoring (`beat score`/`beat suggest`) still isn't wired to either rung's GUI Keep — Phase 15's own
deferred list already named this, and it remains out of scope: a kept variant (param or feel)
commits to the file but doesn't append to `beat-scores.jsonl`. Noted in the roadmap row's
description so a future stream doesn't have to re-discover it.

---

## Verification

`node ui/verify-phase23-bb.mjs` — real headless Chromium, real `beat daemon`, a real git-backed
temp copy of `examples/night-shift.beat`. Every check reads the actual `.beat` file on disk, not
just in-memory store state:

- **L1** materializing a legacy drum track writes 5 real `lane <name> synth:...` declarations.
- **L2** Add Lane writes a real `lane extra1 synth:noise` line; the Clip View gains a real gutter
  row for it.
- **L3** the ▲ move button changes the file's own `lane` line ORDER (declaration order is
  canonical order).
- **L4** editing one field (kick's `tune`) writes a fine-grained param edit
  (`lane kick synth:membrane ... tune=55`), not a whole-lane replace.
- **L5** registers a sample into the project via Phase 22 Stream AH's proven drag mechanism, then
  uses this stream's retype-to-sample control to point the *new* custom lane at it — the honest
  composition of the two features (see §1's gap note above).
- **L6** removing a lane drops both its file line and its Clip View row.
- **L7** applying a preset from *inside* `SynthPanel` writes literal params (`subLevel 0.6`, no
  `preset` keyword) — same discipline as AH's sidebar drop, now reachable without leaving Device
  View.
- **L8** swapping an instrument track's soundfont bank from *inside* `InstrumentPanel` produces a
  real, persisted file change.
- **L9** "≈ vary feel" auditions a genuinely humanized (off-grid) variant live, and Keep writes
  EXACTLY the audited variant's hit set to disk (compared by id, since a written-then-reparsed
  document's hits sort into `serialize.ts`'s canonical order — a legitimate array-order difference,
  not a content difference; see `test/daemon.test.ts`'s `withSortedHits` helper for the same fix at
  the unit-test level).
- **L10** toggling mute changes store/engine state but leaves the `.beat` file byte-identical —
  the mixer mute/solo decision (§2), honored in practice.

Screenshot: `ui/verify-p23bb.png`.

`npm test`: **506/506/0/0** — 490 pre-existing plus:
- `test/format-v10-drum-lanes.test.ts`: 9 new tests covering `materializeLanes` (no-op on an
  already-open track; correctly carries legacy field values forward on a fresh migration),
  `addLane`/`removeLane`/`moveLane` (including the "still on the implicit kit" refusal and the
  orphaned-hit refusal), `setLaneBacking` (retype + the unregistered-sample refusal), and
  `setLaneParam` (edit, clear-to-default, and the sample/sf-backed refusal).
- `test/daemon.test.ts`: 7 new tests covering `POST /lane`'s six ops end-to-end against a real
  daemon+file (including a 400/no-write case), and `POST /vary-feel`/`POST /vary-feel/commit`
  (reproducible seeds, selection-scope enforcement, lane scoping, and the exact-match-modulo-order
  commit guarantee).

Both typechecks clean: `npx tsc -p tsconfig.json --noEmit`, `cd ui && npx tsc --noEmit`.
`cd ui && npx vite build` succeeds.

## Files

- `src/core/edit.ts` — `materializeLanes`/`addLane`/`removeLane`/`moveLane`/`setLaneBacking`/
  `setLaneParam` + `parseLaneBackingTokens` (new); `src/core/index.ts` (exports, additive).
- `src/daemon/daemon.ts` — `POST /lane`, `POST /vary-feel`, `POST /vary-feel/commit` (additive).
- `ui/src/components/DrumLanePanel.tsx` (new); `ui/src/components/NoteView.tsx` (mounts it,
  additive); `ui/src/components/VaryAffordance.tsx` (feel trigger/audition, additive);
  `ui/src/components/SynthPanel.tsx` (`PresetPicker`, additive); `ui/src/components/
  InstrumentPanel.tsx` (`SoundfontPicker`, additive).
- `ui/src/daemon/bridge.ts` — `postLaneOp`/`LaneOp`, `requestVaryFeel`/`commitVaryFeel`/`FeelBatch`
  (additive). `ui/src/types.ts` — `BeatMediaSample`, `DRUM_VOICE_TYPES` (additive/typing only).
- `ui/src/state/store.ts` — expanded doc comment recording the mute/solo decision (no code change).
- `ui/src/styles.css` — `.lane-panel*`/`.lane-row*`/`.lane-edit-field`/`.lane-add-form` and
  `.preset-picker*` blocks (additive).
- `test/format-v10-drum-lanes.test.ts`, `test/daemon.test.ts` (additive tests).
- `scripts/roadmap-data.mjs` (4 rows updated — see below); `docs/product-roadmap.md` (regenerated).
- `ui/verify-phase23-bb.mjs` (new), `ui/verify-p23bb.png` (evidence).

## Roadmap rows closed

- **Drum programming / Open per-track lane model + 12-lane GM-aligned default kit**: `gui: partial`
  -> `gui: done`, `status: progress` -> `done`.
- **Mixer / Persisted mute/solo representation**: `status: not-started` -> `done` (decision made and
  already fully implemented as designed — same treatment the "overlapping-region resolution policy"
  row already gets for a deliberate session-only preference).
- **Preset / content library / Hot-swap preset browser in Device View**: `gui: missing` ->
  `gui: done`, `status: not-started` -> `done`.
- **Vary / audition loop / Rung-2 "feel" content variation, wired into the GUI**: `gui: missing` ->
  `gui: done`, `status: not-started` -> `done`.

44 done / 6 in progress / 32 not started (was 40/7/35 before this stream, per the plan doc's own
snapshot — 4 rows closed, none newly opened).

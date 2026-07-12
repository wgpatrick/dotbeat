# Research 22 — openDAW's editing/arrangement/workflow feature surface

*2026-07-11. Source-reading pass over a shallow clone of openDAW at
`/private/tmp/dotbeat-scratch2/opendaw` (commit `de7565a`), scoped specifically to what
`docs/opendaw-notes.md` did **not** cover: clip editing, automation UX, region/overlap behavior,
comping, warping, groove/quantize, and note-editing gestures. Read `docs/opendaw-notes.md` first
(data model, engine/UI split, undo system, bundle format — not re-derived here). Cross-referenced
against dotbeat's own prior research, `docs/research/16-audio-clip-editing.md` (Ableton audio-clip
editing scoping) and `docs/research/18-ableton-ui-architecture.md` (Ableton UI/automation
architecture), so this pass reads as a *second, independent data point* against those, not a
re-derivation.*

> **License note**: openDAW is AGPL v3 / LGPL-3.0-or-later. Everything below is vocabulary,
> field-shapes, and behavioral rules — facts and ideas, not copyrightable — read directly from
> source for citation accuracy. Treat as "read and reimplement," never "copy-paste," exactly as
> `docs/opendaw-notes.md`'s license note already establishes.

---

## 1. Automation UX specifics

### 1.1 Node placement rules — a real, specified, tested algorithm

openDAW has a written spec for what happens when you double-click to place an automation
(`ValueEvent`) node, because ambiguity at overlapping timestamps caused enough confusion to need
one: `docs/automation-node-placement.md` (openDAW repo), implementing GitHub issue #275.

The core fact: **two value events can share one time position** (drawn as a vertical step —
a `ValueEventBox` schema field `index` distinguishes them, `packages/studio/forge-boxes/src/schema/std/timeline/ValueEventBox.ts:12`).
Index 0 = "incoming" (the value the curve reaches arriving from the left), index 1 = "outgoing"
(the value the curve leaves with, going right). Placement resolves by **which half of the existing
node's hit-box the cursor is on**:

| already there at this time | cursor side | result |
|---|---|---|
| nothing | either | create a lone node (index 0) |
| incoming only | right | add outgoing (index 1) = your value; existing stays incoming |
| incoming only | left | your value becomes incoming (index 0); existing value moves to outgoing (index 1) |
| incoming **and** outgoing | left | overwrite incoming with your value |
| incoming **and** outgoing | right | overwrite outgoing with your value |

The "add left" row is the interesting one: clicking left of a lone node does **not** change that
node's value — it pushes the existing value to the outgoing (right) slot and your new click
becomes the incoming (left) slot. Implementation is split cleanly: a pure, unit-tested decision
function `ValueEventPlacement.resolve(hasIncoming, hasOutgoing, side)` in
`packages/app/studio/src/ui/timeline/editors/value/ValueEventPlacement.ts`, execution in
`ValueEventEditing.createOrMoveEvent`, and cursor-side detection in `ValueEditor.tsx` (compare raw
cursor position to the *snapped* position — `raw < snapped` → left/incoming).

**Relevance to dotbeat**: dotbeat's automation is points-only today (confirmed in
`docs/research/18-ableton-ui-architecture.md`'s automation table: "v0.9 is points only — no
interpolation/curve field"). openDAW's step/vertical-discontinuity concept (two co-located points
forming a hard step) is a real, load-bearing feature for anything that needs instant value jumps
(e.g. a filter cutoff snapping between clip sections) that a single-point-per-time model can't
express. If dotbeat ever wants hard steps without inventing a separate "hold" segment type, the
two-points-at-one-time-with-an-index model is a proven, tested shape to borrow — vocabulary only,
not code.

### 1.2 Curve/interpolation types — exactly three, one of them lazily allocated

`ValueEventBox.interpolation` (`packages/studio/forge-boxes/src/schema/std/timeline/ValueEventBox.ts:13-17`)
is an int32 constrained to `{0, 1}` with a doc comment "default is linear" (value 1). Reading
`InterpolationFieldAdapter` (`packages/studio/adapters/src/timeline/event/InterpolationFieldAdapter.ts`)
shows the real type is a 3-way union:

- `"none"` (field value 0, no companion box) — **hold/step**, value stays flat until the next node.
- `"linear"` (field value 1, no companion box) — straight interpolation.
- `"curve"` (field value 0 *and* an attached `ValueEventCurveBox`) — a separate box
  (`packages/studio/forge-boxes/src/schema/std/timeline/ValueEventCurveBox.ts`) with one field,
  `slope` (unipolar float, default 0.5), pointed at from the event via `Pointers.ValueInterpolation`.

The curve box is only created when a user actually bends a segment — most points stay at the
2-byte "linear" or "none" encoding, and only curved segments pay for the extra box. This is the
same "schema-level sparse allocation" instinct `docs/opendaw-notes.md` §1 already flagged for
parameter metadata — applied here to per-segment curve shape specifically.

**Cross-reference to research 18/16**: research 18's automation table flagged curved segments as
"Adapt / defer... needs the deferred `interpolation` column (DAWproject `hold`/`linear`) added to
the `point` grammar." openDAW is a second independent confirmation that a 3-state interpolation
enum (`hold`/`linear`/`curve`) — not a richer bezier or per-point tangent model — is the right
granularity: it's what both DAWproject's XSD (`opendaw-notes.md` §6: `interpolation(hold|linear)`)
and openDAW's actual shipped implementation converge on, with "curve" as a bolt-on unipolar slope
rather than a fourth interpolation *type*. Recommend dotbeat's deferred `point` grammar addition
use exactly this 3-state shape (`hold` / `linear` / `curve:<slope>`), not invent a richer one.

### 1.3 Live automation recording — touch-based, with real-time point decimation

`packages/studio/core/src/capture/RecordAutomation.ts` is a full touch-automation recorder (bind a
knob move during transport-record to a growing region), worth reading in full for anyone building
dotbeat's own live-automation capture later. Notable mechanisms, none previously covered by
research 16/18 (which discuss Ableton's *editing* gestures, not recording):

- **Region auto-grows during recording** by repeatedly calling `RegionClipResolver.fromRange` to
  carve/extend the value region as the transport advances (`updateRegionDurations`), snapped to
  `PPQN.SemiQuaver` quanta.
- **Floating vs. stepped writes**: whether recorded points interpolate linearly or hold depends on
  `adapter.valueMapping.floating()` — i.e., whether the underlying parameter is continuous (a
  knob) or discrete (an enum/toggle). Continuous params record with `Interpolation.Linear`
  segments; discrete params record with `Interpolation.None` (hold) segments automatically — the
  interpolation choice isn't a UI setting, it's derived from the parameter's own type.
  `handleWriteUpdate` (line 138) creates a new event only when the *relative ppqn position*
  actually advances — same-position updates overwrite the last event's value instead of stacking.
- **Post-recording decimation**: `simplifyRecordedEvents` (line 116) walks the just-recorded
  linear-interpolated points and removes any point that lies within `Epsilon = 0.01` of the
  straight line between its neighbors — a Douglas-Peucker-style simplification pass that runs only
  for floating (continuous) parameters, keeping recorded automation lanes from ending up with one
  point per audio block.
- **Loop-wrap handling**: recording through a loop point finalizes the current region and starts a
  fresh one at the loop-in point (`handleLoopWrap`), rather than one region spanning the whole
  recording — each loop pass becomes its own value region.

**Relevance to dotbeat**: dotbeat doesn't have live-knob-touch automation recording yet (per
feature-matrix scope: "per-track per-param automation lanes (points only)" implies draw/edit, not
live capture). If/when dotbeat adds it, the decimation-on-stop pattern is directly reusable and
cheap — recording without it produces useless per-sample point spam.

### 1.4 Note-level "automation" — per-note property lanes, drawable as a curve

Distinct from track automation: openDAW's piano-roll has a **Property Editor**
(`packages/app/studio/src/ui/timeline/editors/notes/property/`) — a lane below the piano roll for
per-note scalar fields (velocity, cent/fine-tune, chance, play-count, play-curve — see §3.2). The
`PropertyDrawModifier.ts` gesture lets you **click-drag across many notes at once to paint a
continuous curve of one property** (e.g. drag a velocity ramp across 8 notes in one gesture) —
values are captured per-x-position into a `Map<ppqn, unitValue>` during the drag and committed to
each note's box field on mouse-up (`approve()`). This is conceptually the same gesture as track
automation drawing, but targets discrete per-note fields instead of a continuous timeline lane —
worth having in mind as a *third* "automation-shaped" editing surface (track automation, per-note
property lanes, node-repeat curve) if dotbeat's note-editing gestures ever grow velocity-lane
drawing.

---

## 2. Region/clip editing behavior

### 2.1 Overlapping regions — three configurable modes, actually shipped

`packages/studio/core/src/StudioSettings.ts:4`:
```
export const OverlappingRegionsBehaviourOptions = ["clip", "push-existing", "keep-existing"] as const
```
This is the **current, shipped** state — three modes, user-configurable in Preferences → Editing.
(Note: `docs/overlapping-regions-behaviour.md`, openDAW's own design-notes doc, is a stale WIP
artifact that still describes only two enum values (`["clip", "push-to-new-track"]`) mid-refactor;
the live source has all three. Flagging this because it's a good example of "trust the code over
the design doc" even within openDAW's own repo.)

- **`clip`** (default): incoming region wins, existing overlapped region(s) get truncated —
  standard "last edit wins" DAW behavior.
- **`push-existing`**: incoming region lands exactly where you put it; anything it overlaps gets
  pushed to a track below (an existing track with room, or a newly created one).
- **`keep-existing`**: mirror image — the *incoming* region is the one that gets pushed down if it
  would overlap something; existing arrangement is never disturbed.

Rules that apply to both push modes (from the doc, matching the shipped `RegionOverlapResolver`
shape): push direction is always **below** (never above), all overlapping regions from one
operation land on the *same* target track, and pushes never cascade (a pushed region always lands
on space with guaranteed room, so it can't trigger a second push).

**Relevance to dotbeat**: dotbeat's current section append/resize/delete model isn't described in
the framing brief as having overlap semantics yet. This is a genuinely new option worth
considering: a **user preference for overlap resolution strategy**, not just one hardcoded
behavior. "keep-existing" in particular ("don't touch my arrangement, push my incoming edit
instead") is a real user-respecting default that a naive "always clip" implementation wouldn't
surface as a choice.

### 2.2 Region splitting — no dedicated command, but an equivalent primitive exists as a side effect

Directly relevant to `docs/research/16-audio-clip-editing.md` §2, which recommends an explicit
`Cmd/Ctrl+E`-style split-at-playhead command for dotbeat (matching Ableton). **openDAW has no such
command** — grepping the entire `packages/app/studio/src/ui/timeline` tree for a "Split" region
action returns nothing. What it *does* have is `RegionClipResolver`
(`packages/studio/core/src/ui/timeline/RegionClipResolver.ts`), whose `"separate"` task type
implements the same underlying operation as a side effect: when an overlap mask lands **fully
inside** an existing region (touching neither edge), the resolver calls `RegionEditing.clip(region,
begin, end)`, which is exactly "cut a hole out of the middle" — i.e., a region split into two,
triggered only when something else is dropped/moved on top of it, never as a direct user gesture.

**This is a genuine gap in openDAW's UX, not a design openDAW chose over an explicit split** — the
split *machinery* exists (`RegionEditing.clip`, warp markers already partition into per-region
subsets given the schema — `WarpMarkerBox.owner` is a mandatory pointer per-region, so splitting a
warped audio region would naturally partition its markers the same way Ableton does, per research
16 §2's expectation), but there's no direct hotkey wired to it. **This reinforces, rather than
weakens, research 16's recommendation**: dotbeat building an explicit `splitClip` edit primitive
(not just an overlap-resolution side effect) would be *strictly better UX* than the closest prior
art, not a redundant feature. Flag this as a concrete opportunity to differentiate, not just parity.

### 2.3 Comping / take lanes — confirmed absent

Grepped `packages/studio` for "comp", "comping", "take-lane", "TakeLane" — no matches beyond two
unrelated clipboard-handler test files. **openDAW has no multi-take comping feature at all.** This
matches `docs/research/16-audio-clip-editing.md`'s own framing, which places "sample-accurate
multi-take comping ... with real disk streaming" in the **"Genuinely M4-native-tier"** bucket (i.e.
correctly scoped as hard/deferred, not something a browser-only competitor has already solved).
openDAW — the closest browser-DAW prior art — not having it either is a second data point that
this is a legitimately hard, unsolved-in-the-web-DAW-space feature, not something dotbeat is
behind on. No action item; just confirms the existing scoping call was right.

### 2.4 Warp modes — repitch vs. time-stretch, as two distinct playback-mode boxes

`AudioRegionBox.play-mode` is a pointer accepting **either** of two box types
(`packages/studio/forge-boxes/src/schema/std/timeline/`):

- **`AudioTimeStretchBox`**: `warp-markers` (field collection) + `transient-play-mode`
  (`TransientPlayMode` enum: `Once | Repeat | Pingpong`, `packages/studio/enums/src/TransientPlayMode.ts`)
  + `playback-rate` (float, default 1.0). This is full warping — markers remap musical position to
  seconds, with a transient-handling strategy for what happens to percussive content between
  markers when stretched.
- **`AudioPitchStretchBox`**: just `warp-markers`, no transient mode, no rate field — the simpler
  "resample/repitch" mode where changing tempo also changes pitch (the opposite tradeoff from
  time-stretch).

**Direct, valuable cross-reference to `docs/research/16-audio-clip-editing.md`**: that doc
recommends "repitch-mode warping" as one option and full warp-marker time-stretch (via
signalsmith-stretch) as the fuller feature, without a second real-world implementation to check the
split against. openDAW is exactly that second data point, and it validates the **same two-mode
split** dotbeat already scoped — repitch (simple, resample-based, no transient handling needed) and
full time-stretch (warp markers + a transient-handling knob) are being modeled as genuinely
different playback strategies with different field requirements, not one mode with a flag. Worth
importing the `TransientPlayMode` three-way vocabulary (`Once`/`Repeat`/`Pingpong`) specifically —
it's a smaller, more concrete decision than Ableton's named warp modes (Beats/Tones/Texture/
Complex/Complex Pro) and maps cleanly onto "what happens between two warp markers when a
percussive hit doesn't fill the stretched gap."

Warp markers themselves are minimal: `WarpMarkerBox` (`packages/studio/forge-boxes/src/schema/std/WarpMarkerBox.ts`)
is just `owner` (mandatory pointer back to the region) + `position` (ppqn) + `seconds` — a single
musical-time↔real-time pair per marker, matching research 16 §4's expectations exactly (no
per-marker curve/tension field, so interpolation between markers is presumably linear/handled
entirely by the stretch engine, not the marker data itself).

---

## 3. Groove / quantize / humanize mechanism

This is the section with the most genuinely new information relative to research 16/18, which
don't cover groove/humanize at all (out of scope for Ableton audio-clip editing and UI-architecture
respectively).

### 3.1 "Quantize Notes" — a simple, destructive, position-only snap

The only quantize feature found is a context-menu item, `createPitchMenu`
(`packages/app/studio/src/ui/timeline/editors/notes/pitch/PitchMenu.ts:51-53`):
```
MenuItem.default({label: "Quantize Notes", separatorBefore: true})
    .setTriggerProcedure(() => modify(adapters => adapters.forEach(({box, position}) =>
        box.position.setValue(snapping.round(position)))))
```
That's the entire implementation: round each selected (or all, if none selected) note's `position`
to the current snap grid via `snapping.round()`. No duration snapping, no swing/humanize
percentage, no strength slider, no "quantize to X%" partial-correction — it's a hard, immediate,
undoable-but-destructive grid-snap. Framing-brief context notes dotbeat already does
"quantize-as-operation (not grid lock)" — **openDAW's quantize is the simpler thing dotbeat already
moved past**, not a model to adopt. Confirms dotbeat's current design is already ahead of this
specific prior-art data point.

### 3.2 Groove — NOT part of quantize at all; it's a pluggable MIDI-effect device

This is the most interesting finding in this pass. openDAW's swing/groove system is architecturally
separate from quantize, implemented as a **first-class MIDI-effect device** (`ZeitgeistDeviceBox`,
`packages/studio/forge-boxes/src/schema/devices/midi-effects/ZeitGeistDeviceBox.ts`) that holds one
mandatory pointer field, `groove`, to a `Groove`-typed box. Two groove box types exist
(`packages/studio/forge-boxes/src/schema/std/GrooveBoxes.ts`):

- **`GrooveShuffleBox`**: `amount` (unipolar, default 0.6) + `duration` (ppqn subdivision, default
  1/8 note — the swing "grid").
- **`GrooveOffsetBox`**: `amount` (unipolar, default 0) + `sync` (boolean, default true).

The actual warp math (`packages/studio/adapters/src/grooves/GrooveShuffleBoxAdapter.ts`) is a
**continuous, invertible time-warp function**, not a snap-to-grid-with-offset table:
```
fx: x => moebiusEase(x, this.#amount)
fy: y => moebiusEase(y, 1.0 - this.#amount)
```
`moebiusEase` (`packages/lib/std/src/math.ts:33`) is a Möbius-transform easing curve:
`(x*h) / ((2h-1)(x-1)+h)`. The adapter exposes `warp(position)` / `unwarp(position)` — this is the
**same warp/unwarp vocabulary as audio time-stretch** (§2.4), applied to note timing instead of
audio. `ZeitgeistDeviceProcessor` (`packages/studio/core-processors/src/devices/midi-effects/
ZeitgeistDeviceProcessor.ts`) calls `groove.unwarp()` on the *query* window before reading notes
from upstream, then `groove.warp()` on each note's position before re-emitting it — i.e. groove is
applied live, at the MIDI-effect-chain stage, non-destructively, per-play, not baked into note
positions at all.

**Why this matters as a design pattern, independent of the specific easing function**: because
groove lives as a device in the effect chain rather than a per-clip/per-track property, it
naturally gets:
- **Per-track (or even per-chain-position) different groove**, since it's just another MIDI effect
  slot — one track can have no groove, another a heavy shuffle, without a separate "groove amount"
  field bolted onto every track/clip.
- **Reversibility for free** — because it's `warp`/`unwarp`, not a destructive move, disabling or
  removing the device instantly restores the untouched note positions, and any other logic that
  needs to reason about "real" note time (recording, display) can call `unwarp` to get back to the
  ungrooved position.
- **Composability** — nothing stops chaining two groove devices (though the "resolved
  specification" doesn't discuss that explicitly), or swapping groove types (shuffle vs. offset)
  per track without touching note data.

There is **no humanize (randomized micro-timing/velocity jitter) feature anywhere** in the grep
results — groove is deterministic shuffle/offset only, no noise/randomization component.

**Cross-reference / recommendation for dotbeat**: dotbeat's framing brief describes
"quantize-as-operation (not grid lock)" for notes but doesn't mention groove/swing at all in scope.
This is new information neither research 16 nor 18 covered (both are Ableton-audio-clip and
Ableton-UI-architecture scoped, and Ableton's own groove pool is a per-clip percentage+depth
control, a different shape). openDAW's "groove is a device, applied via reversible warp/unwarp, not
a property baked into stored positions" pattern is worth serious consideration if/when dotbeat adds
swing: it composes cleanly with dotbeat's own "quantize-as-operation, not grid-lock" philosophy —
both are already committed to *not* destructively snapping data, so a warp/unwarp groove function
applied at read-time is the more consistent choice than a stored per-note swing offset.

### 3.3 Per-note "ratchet"/repeat and probability — genuinely new note-editing vocabulary

`NoteEventBox` (`packages/studio/forge-boxes/src/schema/std/timeline/NoteEventBox.ts`) carries five
fields beyond position/duration/pitch/velocity that aren't in dotbeat's current note model per the
framing brief, and aren't covered by research 16/18 either (both are audio-clip/UI-architecture
scoped, not piano-roll note-property scoped):

- **`play-count`** (int, 1–128, default 1) + **`play-curve`** (bipolar float, default 0) — a
  **note-repeat/ratchet** feature: play the note `play-count` times within its duration, with
  `play-curve` shaping the spacing between repeats (a bipolar curve — presumably linear at 0,
  front-loaded or back-loaded toward the extremes, matching the same `slope`/`curve` shape as
  automation interpolation in §1.2). A `NoteEventRepeatBox` schema
  (`packages/studio/forge-boxes/src/schema/std/timeline/NoteEventRepeatBox.ts`) exists as a
  planned refactor target (comment: `"TODO Create, refer this and remove 'play-count' and
  'play-curve' from NoteEventBox"`) that would add a `length` field (ratio of each repeat's
  duration) — i.e. openDAW's own team considers this under-scoped today and is mid-migration to a
  richer note-repeat feature (count + curve + per-repeat length ratio).
- **`chance`** (int, 0–100, default 100) — **probabilistic trigger**: `NoteSequencer.ts:229` reads
  `if (chance < 100.0 && this.#random.nextDouble(0.0, 100.0) > chance) {continue}` — a per-note coin
  flip evaluated at playback time, skipping the note some percentage of passes. This is real-time,
  re-rolled per loop pass (not baked once), giving generative/probabilistic sequencing for free
  from stored per-note data with zero extra format complexity beyond one int field.
- **`cent`** (float, ±50, default 0) — per-note micro-tuning in cents, independent of `pitch`
  (semitone).
- **`Consolidate`** menu action (`PitchMenu.ts:44-50`, `canConsolidate()` = `playCount > 1` on
  `NoteEventBoxAdapter`) — converts a ratcheted note back into `playCount` separate discrete note
  events (the inverse operation, "bake the repeat into real notes").

**Recommendation for dotbeat**: these three fields (`chance`, `play-count`/`play-curve`, `cent`)
are cheap, high-leverage, format-only additions — each is a single scalar per note event, no engine
architecture changes implied beyond reading them at trigger time. `chance` in particular is close
to zero-cost (one RNG comparison in the note-trigger path) for a real generative-sequencing
capability. None of this was flagged in research 16/18 or the framing brief's description of
dotbeat's current note model, so this section is the most net-new material in this pass.

---

## 4. Candidate-feature table for dotbeat

| Feature | Description | Adopt/Adapt/Skip | Reasoning |
|---|---|---|---|
| 3-state interpolation (`hold`/`linear`/`curve:slope`) for automation points | openDAW's `ValueEventBox.interpolation` + optional `ValueEventCurveBox.slope` (§1.2) | **Adopt** | Second independent confirmation (after DAWproject's XSD, `opendaw-notes.md` §6) of the same 3-state shape research 18 already flagged as dotbeat's deferred format addition. Use this as the concrete shape when implementing it: sparse curve box (or equivalent optional field) only when a segment is actually curved, not a mandatory field on every point. |
| Two-points-at-one-time "step" automation node (incoming/outgoing) | openDAW's index-0/index-1 co-located value events for hard value jumps (§1.1) | **Adapt** | Not urgent, but if dotbeat needs instant-jump automation (not just steep linear ramps), this tested two-node-with-index model is cleaner than inventing a separate "hold" segment type. Low priority — only pursue if a real use case surfaces. |
| Live automation-recording point decimation | Douglas-Peucker-style epsilon-based simplification of recorded points on stop (§1.3) | **Adapt** | Only relevant once/if dotbeat gets live-knob-touch automation recording (not currently scoped). File away for that future feature — recording without decimation is a known trap. |
| User-configurable overlapping-region resolution (clip / push-existing / keep-existing) | Preference-driven region overlap handling, push direction always downward, no cascade (§2.1) | **Adopt** | Genuinely new: neither research 16 nor 18 discuss overlap-resolution *policy* as a user preference. `keep-existing` ("don't disturb my arrangement") is a real, non-obvious default worth having as an option once dotbeat's section/region model needs overlap semantics. |
| Explicit split-at-playhead command | A direct `splitClip`/`splitRegion` edit primitive, distinct from overlap-triggered splitting | **Adopt (reinforces research 16 unchanged)** | openDAW has the underlying split *mechanism* (`RegionClipResolver`'s `"separate"` case) but no direct user-facing command for it — a confirmed UX gap in the closest prior art. Strengthens research 16 §2's existing recommendation: build the explicit command, don't wait for it to "just fall out" of overlap handling. |
| Multi-take comping / take lanes | Recording multiple takes into selectable/combinable lanes | **Skip (confirms existing scoping)** | Confirmed absent in openDAW too (§2.3). Matches research 16's own "Genuinely M4-native-tier" bucket — not something a browser-DAW competitor has already solved, so no urgency to catch up. |
| Repitch vs. time-stretch as two distinct warp modes, with a `TransientPlayMode` (`Once`/`Repeat`/`Pingpong`) knob for time-stretch | Two box types with different field sets for the two fundamentally different tradeoffs (§2.4) | **Adopt (reinforces research 16 unchanged)** | Second real-world data point validating research 16's repitch-mode + full-warp split. Additionally worth importing: the specific 3-way `TransientPlayMode` vocabulary as the concrete "what happens to a percussive hit between two warp markers" control — smaller and more implementable than Ableton's 5-way named-warp-mode system. |
| Groove as a reversible, warp/unwarp MIDI-effect device (not a stored per-note offset) | `ZeitgeistDeviceBox` + `GrooveShuffleBox`/`GrooveOffsetBox`, applied live via `warp()`/`unwarp()` (§3.2) | **Adopt** | Entirely new to this pass — not covered by research 16/18 or the framing brief. Fits dotbeat's existing "quantize-as-operation, not grid-lock" philosophy: a groove function applied at read-time is more consistent with that philosophy than a destructively-stored swing offset. Worth prototyping as a track-level (or chain-position) pluggable time-warp rather than a per-clip percentage field. |
| Destructive "Quantize Notes" (position-only grid snap) | openDAW's entire quantize feature: `box.position.setValue(snapping.round(position))` (§3.1) | **Skip** | dotbeat's quantize-as-operation is already more sophisticated than this. No reason to regress toward openDAW's simpler destructive model. |
| Per-note `chance` (0–100 probabilistic trigger) | Re-rolled RNG comparison per playback pass, one int field, no engine changes (§3.3) | **Adopt** | Cheapest, highest-leverage new idea in this pass. Single scalar field + one comparison in the trigger path buys real generative-sequencing capability. Not previously considered per the framing brief. |
| Per-note `play-count`/`play-curve` (ratchet/note-repeat) + `Consolidate` bake-back action | Repeat a note N times within its duration with curve-shaped spacing; convert back to discrete notes (§3.3) | **Adopt** | A genuinely useful note-editing gesture (Ableton-style "Repeat" / ratcheting) not present in dotbeat's current free-timed-note model per the framing brief. Note openDAW's own team is mid-refactor here (planned `NoteEventRepeatBox` with an added `length` ratio field) — if dotbeat adopts this, design the richer 3-field shape (count + curve + per-repeat length) directly rather than openDAW's current 2-field version they're already trying to replace. |
| Per-note `cent` (±50 micro-tuning independent of semitone pitch) | One float field on `NoteEventBox` (§3.3) | **Adopt** | Small, cheap, and already-normalized vocabulary (also present in `opendaw-notes.md` §1's `NoteEventBox` field list) — low cost for expressive-tuning use cases. |
| Draw-across-multiple-notes gesture for per-note property lanes (velocity/chance/cent) | `PropertyDrawModifier`'s click-drag-paints-a-curve interaction for note properties (§1.4) | **Adapt** | Only relevant once dotbeat has per-note property lanes beyond velocity. File away as the reference gesture (same shape as automation drawing, applied to discrete note fields) if/when that UI surface gets built. |

---

## Collaboration-adjacent note (flagged, not deep-dived — per scope, another research stream owns this angle)

The `BoxEditing.modify()` transaction model (`docs/opendaw-notes.md` §7, and confirmed again while
reading `packages/studio/core/src/ui/timeline/RegionClipResolver.ts` and `RecordAutomation.ts` in
this pass) has **no per-field ownership or lock concept** — any code with a reference to a box can
mutate any field inside a transaction, and conflicts are resolved by "last transaction wins" at the
box-graph level, not by a WHO-can-edit-WHAT permission model. Nothing in the source suggests
openDAW has thought about concurrent-editor conflict resolution at all (it's architected for a
single local user; p2p exists as a package name, `packages/studio/p2p`, but wasn't explored this
pass — out of scope here). Flagging only because the framing brief asked for it; the actual
collaborative-editing angle needs its own dedicated pass against `packages/studio/p2p` if that
becomes a priority.

---

## Sources read this pass

- `/private/tmp/dotbeat-scratch2/opendaw/docs/automation-node-placement.md`
- `/private/tmp/dotbeat-scratch2/opendaw/docs/overlapping-regions-behaviour.md`
- `/private/tmp/dotbeat-scratch2/opendaw/docs/graph.md`
- `/private/tmp/dotbeat-scratch2/opendaw/docs/performance.md`
- `packages/studio/forge-boxes/src/schema/std/WarpMarkerBox.ts`
- `packages/studio/forge-boxes/src/schema/std/timeline/AudioRegionBox.ts`
- `packages/studio/forge-boxes/src/schema/std/timeline/AudioTimeStretchBox.ts`
- `packages/studio/forge-boxes/src/schema/std/timeline/AudioPitchStretchBox.ts`
- `packages/studio/forge-boxes/src/schema/std/timeline/ValueEventBox.ts`
- `packages/studio/forge-boxes/src/schema/std/timeline/ValueEventCurveBox.ts`
- `packages/studio/forge-boxes/src/schema/std/timeline/NoteEventBox.ts`
- `packages/studio/forge-boxes/src/schema/std/timeline/NoteEventRepeatBox.ts`
- `packages/studio/forge-boxes/src/schema/std/GrooveBoxes.ts`
- `packages/studio/forge-boxes/src/schema/devices/midi-effects/ZeitGeistDeviceBox.ts`
- `packages/studio/enums/src/TransientPlayMode.ts`
- `packages/studio/adapters/src/grooves/GrooveShuffleBoxAdapter.ts`
- `packages/studio/adapters/src/timeline/event/InterpolationFieldAdapter.ts`
- `packages/lib/std/src/math.ts` (`moebiusEase`)
- `packages/studio/core-processors/src/devices/midi-effects/ZeitgeistDeviceProcessor.ts`
- `packages/studio/core-processors/src/NoteSequencer.ts` (`chance` evaluation)
- `packages/studio/core/src/ui/timeline/RegionClipResolver.ts`
- `packages/studio/core/src/StudioSettings.ts`
- `packages/app/studio/src/ui/pages/PreferencesPageLabels.ts`
- `packages/app/studio/src/ui/timeline/editors/notes/pitch/PitchMenu.ts`
- `packages/app/studio/src/ui/timeline/editors/notes/property/PropertyParameters.ts`
- `packages/app/studio/src/ui/timeline/editors/notes/property/PropertyDrawModifier.ts`
- `packages/studio/core/src/capture/RecordAutomation.ts`
- `packages/studio/adapters/src/timeline/event/NoteEventBoxAdapter.ts` (`consolidate`/`canConsolidate`)
- `packages/lib/inference/src/tasks/BasicPitchTask.ts` (noted but not deep-dived — not wired into
  the studio UI yet per a grep for its usage in `packages/app/studio/src`, so treat as unshipped/
  speculative; audio-to-MIDI transcription as a library capability, out of this pass's scope)
- Cross-referenced against `/Users/willpatrick/Documents/dotbeat/dotbeat/docs/opendaw-notes.md`,
  `docs/research/16-audio-clip-editing.md`, `docs/research/18-ableton-ui-architecture.md`

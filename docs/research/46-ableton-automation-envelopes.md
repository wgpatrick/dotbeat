# Research 46 — Ableton Live 12 manual ch.25, "Automation and Editing Envelopes"

*Parallel research pass, one of a set mining the official Ableton Live 12 Reference Manual
(999 pages, `prior_art/`, gitignored) chapter-by-chapter for ideas/gaps relevant to dotbeat's own
design. This pass covers **chapter 25, pp. 481-493** — **track-level automation**: arrangement
automation lanes, recording control moves into the timeline, drawing/editing breakpoint envelopes.
Research-only; no code changes.*

## 0. Scope note — this is not the clip-envelopes doc

Ableton draws a hard line the manual itself names explicitly: "Automation editing for Session View
clips is covered in detail in the Clip Envelopes chapter" **[manual p.485]**. Chapter 25 (this doc)
is about a control's value changing **against the Arrangement timeline** — i.e. one automation
curve per track/parameter, spanning the whole song, independent of which clip happens to be
playing underneath it at any given bar. Chapter 26 ("Clip Envelopes," a sibling research stream) is
about automation baked **into a Session clip itself** — the curve is part of the clip's own content
and travels with it wherever the clip is triggered or copied.

This distinction matters for dotbeat because **dotbeat currently has only the clip-scoped kind**
(§7 below) — its `BeatAutomationLane`/`BeatAutomationPoint` model lives on `BeatClip.automation`,
deliberately, "NOT modeled at the live track / non-clip level" per `docs/format-spec.md`'s own v0.9
section. Everything Ableton documents in *this* chapter — automation that belongs to the
**Arrangement timeline itself**, independent of clip identity — is a genuine gap dotbeat hasn't
built and hasn't explicitly decided against. That gap, and what to do about it, is this doc's main
payload (§7).

## 1. What the chapter covers, and why it matters for dotbeat

Ableton's own framing, first sentence of the chapter: "the controls' movements... become part of
the music... [t]he movement of a control across the song timeline or Session clip is called
automation" **[manual p.481]**, and "[p]ractically all mixer and device controls in Live can be
automated, including the song tempo" **[manual p.481]**. Two things worth pulling out immediately:

- **Automation is universal, not a bolted-on feature for a few params.** Ableton frames it as "any
  control, any time" — mixer faders, device knobs, switches, even the transport's own tempo. That's
  a much wider net than dotbeat currently automates (§7).
- **Automation is a first-class *editing surface* (breakpoint envelopes), not just a record/replay
  mechanism.** Roughly two-thirds of the chapter (§25.5, pp. 485-493) is dedicated to drawing,
  reshaping, and manipulating curves by hand — draw mode, breakpoint dragging, curved segments,
  stretch/skew transforms, simplification, predefined shapes, envelope locking. This is the part
  with the most direct, concrete UI lessons for dotbeat's own automation lane (`ArrangementView.tsx`,
  Phase 20 Stream Z), which today supports exactly one editing gesture (click to add a linear
  breakpoint, drag to move it) against Ableton's roughly ten.

## 2. Recording automation into the Arrangement (§25.1, p.481)

Two record paths **[manual p.481]**:

1. **Manually turning a knob while recording new material directly into the Arrangement.**
2. **Recording a Session View performance into the Arrangement** — if the Session clips being
   recorded contain automation, that automation is carried over.

The gate for path 1 is the **Automation Arm button**: when it's on, *any* control change that
happens while the Control Bar's Arrangement Record transport button is also on becomes recorded
automation **[manual p.481]**. This is a deliberate two-key-combination gate — you can play/record
notes without accidentally laying down automation, and vice versa, by toggling Automation Arm
independently of Record.

A recorded/automated control gets a visible **LED indicator** — "a little LED has appeared in the
slider thumb to indicate the control is now automated," with switches (Track Activator, etc.)
showing the LED "in their upper left corners" **[manual p.481]**. This is the chapter's first
visual-language idea worth flagging: automation state is legible **at the control itself**, not
only in a separate lane you have to go find.

## 3. Recording automation into Session View — touch vs. latch (§25.2, pp.482-484)

A parallel record path exists for Session clips, gated similarly: enable Automation Arm, arm the
target tracks (which surfaces Clip Record buttons in their empty slots), then hit Session Record
**[manual p.482]**. A **Session Automation Recording** preference (Record, Warp & Launch Settings)
optionally records automation into *any* currently playing Session clip, armed or not — explicitly
so you can "overdub Session automation into an existing MIDI clip without also recording notes into
the clip" **[manual p.483]**.

The most concretely useful idea in this section is the **two distinct recording behaviors named
explicitly by their industry-standard terms** **[manual p.483]**:

- **"Touch"** — using the mouse: recording stops the instant you release the mouse button, and the
  control holds whatever value you left it at.
- **"Latch"** — using a hardware MIDI controller knob/fader: recording *continues* after you let go,
  holding the last value, until the clip's loop point, then "punches out" automatically.

Once a clip is recorded/copied into the Arrangement, "[a]ny automation in Session View becomes
track-based automation" **[manual p.483]** — i.e. the clip-scoped and track-scoped representations
converge into one arrangement-level curve at that point, which is exactly the boundary described in
§0.

## 4. Deleting automation (§25.3, p.484)

One command, two invocation paths: right-click an automated control → **Delete Automation**, or the
shortcut `Ctrl+Backspace` (Win) / `Cmd+Delete` (Mac) **[manual p.484]**. Effect: the automation LED
disappears and "the control's value stays constant across the entire Arrangement timeline **and in
any Session View clips**" **[manual p.484]** — i.e. deleting a track's automation for a parameter is
a global wipe across every clip that references it, not a per-occurrence edit. Partial deletion
(a time range, not the whole lane) is done by selecting and editing/deleting the relevant breakpoints
directly, covered under §25.5 below.

## 5. Overriding & re-enabling automation (§25.4, pp.484-485)

This section documents a **live-performance safety net specific to Ableton's mixing workflow**, not
an authoring concept: if you nudge an automated control's value *while not recording*, its
automation LED turns off — the control is now "inactive," playing your manual override value
instead of what's written in the timeline **[manual p.484]**. Nothing is destroyed; the automation
data itself is untouched, you're just previewing a value on top of it. The Control Bar's **Re-Enable
Automation** button lights up whenever any control is in this overridden state and — one click —
snaps every overridden control back to whatever's written "on tape" **[manual p.484]**. A
context-menu variant re-enables just one parameter; in Session View, simply relaunching a clip that
contains automation also re-enables it **[manual p.485]**.

This is explicitly a **live-mixing/monitoring affordance** (audition a tweak without committing to
it, then snap back) with no clean analog in a document-edit-and-commit model like dotbeat's — noted
here for completeness (and because research 18 §7 already flagged it as "a live-mixing affordance
with no dotbeat analog"), not as a recommendation.

## 6. Drawing and editing envelopes (§25.5, pp.485-493)

This is the chapter's largest section and the one with the most transferable UI ideas.

### 6.1 Turning envelopes on, and the lane-selection model (p.485)

**Automation Mode** is a toggle above the track headers (or the `A` keyboard shortcut) that shows/
hides automation envelopes at all **[manual p.485]**. Once on, the actual curve for a specific
control appears the moment you click that control anywhere in the mixer/device chain — there's no
separate "add a lane" step for the *first* lane; clicking the control *is* the add-lane action
**[manual p.485]**.

Envelopes render **"on top of" the track's own audio waveform or MIDI display**, in the track's
**main automation lane**, specifically so breakpoints can be lined up visually against the
underlying musical content **[manual p.485]**. This is the "same-row red-line overlay" presentation
— the *default* in Ableton, not an alternative.

Two linked choosers select exactly which curve is showing **[manual pp.485-486]**:

- **Device chooser** — track mixer, a specific device on the chain, or "None" (hides the envelope).
  It doubles as a **discovery UI**: an LED next to each device's name shows which devices actually
  have automation on this track, and a "Show Automated Parameters Only" filter narrows the list to
  just those — i.e. you can answer "what's automated on this track at all?" without opening every
  device.
- **Automation Control chooser** — the specific parameter within the chosen device; automated
  controls get the same LED treatment.

A dedicated button **pops the current envelope out into its own lane below the clip**, so multiple
parameters can be viewed/edited simultaneously stacked as separate sub-lanes; Alt/Cmd-click pops
*every* automated parameter out at once **[manual p.486]**. A matching button collapses a lane back
(Alt/Cmd-click removes it and every subsequent lane); a toggle shows/hides the whole stack at once;
left/right arrow keys fold/unfold the lane stack from the main track row **[manual p.486]**.
Right-clicking a lane header's context menu adds bulk operations: "clear all automation envelopes
for the track or any of its devices" **[manual p.486]**.

### 6.2 Draw Mode (p.486)

A dedicated mode (`B`, or the Control Bar's Draw Mode switch, or the Options menu) that changes what
click-and-drag *means* on an envelope: with it on, dragging **paints** a step curve, one step per
unit of the current grid, rather than manipulating individual breakpoints **[manual p.486]**.
Refinements: holding `Shift` while dragging vertically gives finer value resolution; hiding the grid
(Snap to Grid off, or `Ctrl+4`/`Cmd+4`) switches to true freehand painting, or you can hold Alt/Cmd
to freehand *temporarily* without changing the persistent grid setting; holding `B` itself while
already dragging with the mouse toggles Draw Mode on the fly, mid-gesture **[manual pp.486-487]**.

### 6.3 Editing breakpoints directly, Draw Mode off (pp.487-489)

This is the densest, most transferable part of the chapter — with Draw Mode off, segments and
breakpoints become individually draggable objects, and Ableton documents roughly ten distinct
gestures:

- **Add a breakpoint**: click directly on a line segment, or double-click empty envelope space
  **[manual p.487]**.
- **Delete a breakpoint**: click directly on it **[manual p.487]**.
- **Live value readout while editing**: the automation value shows on-screen the moment you create,
  hover, or drag a breakpoint — and while dragging/hovering a *segment* rather than a point, it
  shows the value of whichever breakpoint is nearest the cursor **[manual p.487]**.
- **Move a breakpoint**: click-drag it; if it's part of a multi-breakpoint selection, the whole
  selection moves together; a thin vertical guide line shows grid alignment while dragging
  **[manual p.487]**.
- **Type an exact value**: right-click a breakpoint → "Edit Value" opens a keyboard-editable numeric
  field; a selection of multiple breakpoints all shift by the same relative amount. The same
  right-click menu on a *hovered preview point* (not yet a real breakpoint) offers "Add Value" — type
  an exact value to both create and place a new breakpoint in one action **[manual p.488]**.
- **Select and move a whole segment**: click near (not directly on) a segment, or Shift-click
  directly on it, to select the segment; drag moves the entire segment. If the segment falls inside
  an active time selection, Ableton auto-inserts breakpoints at the *selection's* edges first so the
  move doesn't distort material outside the selection **[manual p.488]**.
- **Grid snapping controls**: breakpoints near a grid line snap to it by default; hold Alt/Cmd while
  dragging horizontally to bypass snapping. Separately, breakpoints/segments also snap to the time
  positions of **neighboring breakpoints** (not just the grid) — and dragging a point/segment past a
  neighbor "over" it horizontally deletes that neighbor, a fast way to remove intermediate points
  without a separate delete gesture **[manual p.488]**.
- **Constrain drag to one axis**: hold `Shift` while dragging a breakpoint/segment to lock movement
  to purely horizontal or purely vertical **[manual p.488]**; a separate `Shift`-while-dragging-
  vertically behavior gives finer value resolution specifically **[manual p.489]**.
- **Curve a segment**: hold Alt (Win) / Option (Mac) and drag a straight segment to bow it into a
  curve; double-click while holding the same modifier flattens it back to a straight line
  **[manual p.489]**. This is the *only* mechanism in the whole chapter for producing a non-linear
  segment — there's no separate "curve type" dropdown; curving is a direct-manipulation gesture on
  the segment itself.

### 6.4 Stretching and skewing a whole selection (pp.489-490)

Hovering a **time selection** on an envelope surfaces drag handles at the four corners and four edge
midpoints of the selection's bounding box **[manual p.489]** — a distinct, higher-level editing
tool from individual-breakpoint dragging, operating on an entire selected range at once:

- **Top/bottom center handles** — vertical stretch (rescale the value range of the selection). A
  live rectangle overlay shows the amount; it snaps at the upper/lower value boundaries and when its
  own corners intersect; `Shift` gives fine control; dragging past the value boundaries clips the
  envelope rather than extrapolating **[manual p.489]**.
- **Left/right center handles** — horizontal stretch (time-rescale the selection). Breakpoints
  *outside* the selection that the drag sweeps over get deleted by default, or — hold `Shift` —
  moved proportionally instead of deleted, so the whole tail of the envelope rescales with the
  selection rather than losing data **[manual p.490]**. Alt/Cmd bypasses grid snap here too.
- **Corner handles** — skew (a combined time/value shear, tilting the selection). Same rectangle-
  overlay/snap/fine-control behavior as vertical stretch **[manual p.490]**.
- **Alt/Option while dragging any handle** — mirrors the opposite handle's movement simultaneously,
  as if both were being dragged in opposite directions at once (e.g., stretch symmetrically from the
  center rather than from one edge) **[manual p.490]**.

### 6.5 Simplify Envelope (p.490)

A single command that **reduces breakpoint count algorithmically**: "calculates the optimal number
of breakpoints needed to represent the selected automation envelope, and removes any unnecessary
breakpoints, replacing them with straight lines or curved segments where appropriate"
**[manual p.490]**. Explicitly framed as the cleanup tool for **recorded** automation, which tends
to capture far more breakpoints than a hand-drawn curve would need (a mouse/controller move recorded
in real time samples continuously). Workflow: select a time range on the envelope, right-click →
Simplify Envelope.

### 6.6 Predefined automation shapes (pp.490-491)

Right-click a time selection to insert one of several **predefined curve shapes** in place of
manual drawing — described as useful both for "complex rhythmic automation patterns" and "subtle,
slow-paced movements like swells, builds and drops" **[manual p.491]**. Two distinct families,
laid out as two rows in the picker:

- **Top row — periodic waveforms**: sine, triangle, sawtooth, inverse sawtooth, square. These scale
  horizontally to fill the active time selection and vertically to the automated parameter's full
  range; with no time selection active, they instead scale to the current grid size
  **[manual p.491]**.
- **Bottom row — directional ramps and an ADSR shape**: two ramp variants plus an ADSR envelope
  shape. These behave differently from the top row — rather than filling a fixed value range, they
  **link up to the existing automation value immediately before or after the selection** (shown as
  a dotted preview line before insertion), so the inserted shape connects smoothly to whatever's
  already there instead of resetting to an arbitrary range **[manual p.491]**.

### 6.7 Locking envelopes to song position (p.492)

By default, moving an Arrangement clip carries its automation along with it. **Lock Envelopes**
(Options menu, or a Control Bar switch) flips this: envelopes stay pinned to their absolute song
position, and the clip slides underneath them instead **[manual p.492]** — a direct expression of
the chapter-25/26 distinction (§0): with locking on, automation genuinely behaves as a track-timeline
property independent of clip identity, exactly the thing dotbeat doesn't model at all today.

### 6.8 Edit-menu command scoping (p.492)

Cut/Copy/Duplicate/Delete behave differently depending on **what's selected**: applied to an
envelope-only selection within one lane, they affect *only that envelope* — the clip and any other
parameter's automation in the same time range are untouched, and multiple lanes can be edited
simultaneously and independently **[manual p.492]**. To make an edit apply to **both** the clip and
all of its automation together, Lock Envelopes must be *disabled* and the selection made in the clip
track itself, not a sub-lane **[manual p.492]**.

One more explicitly named capability: automation data can be **copy/pasted across parameters**, not
just across time — "the parameters may be completely unrelated, this can have unexpected (but
possibly interesting) results" **[manual p.492]**, i.e. Ableton deliberately doesn't gate paste by
parameter-type compatibility; a filter-cutoff curve can be pasted directly onto a pan lane.

### 6.9 Tempo as an automated parameter (pp.492-493)

The chapter closes on the concrete instance of its opening claim ("including the song tempo"): tempo
is edited through the *exact same* envelope machinery as any other control, not a special-cased
tempo-track UI. To reach it: unfold the Main track, then pick "Mixer" from the top (Device) chooser
and "Song Tempo" from the bottom (Control) chooser **[manual p.492]**. Two numeric fields beneath
the envelope set the **displayed** value-axis min/max in BPM — a pure zoom/scale control over the
same curve, not a hard clamp on the data — and, notably, **these same two bounds also set the value
range mapped from an assigned MIDI controller**, so the display-scale setting has a real functional
consequence beyond visualization **[manual p.493]**.

## 7. Relevance to dotbeat

### 7.1 Where dotbeat stands today (verified from source this pass)

- **Automation is clip-scoped only, by explicit design decision** — `BeatClip.automation:
  BeatAutomationLane[]` (`src/core/document.ts:548`), and the format spec's own v0.9 section states
  this was "deliberately NOT modeled at the level track / non-clip level" (`document.ts:539`
  comment). There is **no track-timeline automation concept at all** — nothing corresponding to
  Ableton's Lock Envelopes (§6.7) or the clip-vs-track distinction the whole chapter rests on,
  because dotbeat currently has only one of the two kinds Ableton models.
- **Points are linear-only, no curve gesture** — `BeatAutomationPoint` has `id`/`time`/`value` and
  explicitly "no interpolation field (curve shape — linear vs hold — is deferred)"
  (`document.ts:438-446`). Ableton's Alt/Option-drag-to-curve (§6.3) has no dotbeat equivalent, and
  `docs/product-roadmap.md`'s Automation table already flags "Curved segments... add an
  interpolation field (hold/linear/curve)" as `❌ missing`, `⬜ Not started`.
  (`docs/product-roadmap.md:148`).
- **One editing gesture exists**: click empty space to add a breakpoint, drag a marker to move it,
  alt-click to remove it (`ui/src/components/ArrangementView.tsx`, `AutomationLane` component,
  ~line 857; documented in `docs/phase-20-automation-lanes.md` §2/§Z1-Z5). No draw-mode painting
  (§6.2), no exact-value entry (§6.3's "Edit Value"/"Add Value"), no segment-level selection or
  drag (§6.3), no stretch/skew (§6.4), no Simplify (§6.5), no predefined shapes (§6.6), no
  cross-parameter copy/paste (§6.8).
- **Automation is presented as its own dedicated sub-lane below the track**, *not* overlaid on the
  clip content in the main row — the opposite of Ableton's *default* presentation (§6.1's "on top
  of the waveform/MIDI"). `docs/phase-20-automation-lanes.md`'s own "What's deferred" section
  already names this explicitly: "the alternate same-row red-line overlay is noted as deferred."
- **Automation only plays in song mode, and only for a track's first-playing clip** — Phase 20's
  own caveats: "clip automation only plays in song mode," and "the picker/curve target a track's
  first-playing clip; tracks that play *different* clips in different sections expose only that
  primary clip's automation." Ableton has no such limitation because its automation isn't
  clip-bound at all.
- **No tempo automation, and no tempo-change events of any kind** — `document.ts` has exactly one
  scalar `tempo` field per document (serialized as `tempo 126`, `docs/format-spec.md:833`); the
  format spec names "arbitrary tempo/time-sig changes" as an explicit **future**, not-yet-built
  item (`docs/format-spec.md:909`). Ableton's §6.9 (tempo as just another automated control) has
  literally nothing to attach to yet in dotbeat — there's no timeline-scoped tempo concept, curved
  or otherwise, only per-clip `BeatTimeSignature` overrides that the engine doesn't even interpret
  (`document.ts:469-479`).
- **Automatable-param surface is already reasonably wide**: `AUTOMATABLE_SYNTH_PARAMS` derives from
  every numeric `SYNTH_FIELDS` entry plus mixer-adjacent params (`document.ts:989-992`), and audio
  tracks separately automate `gain` (`AUDIO_AUTOMATABLE_PARAMS`, `document.ts:533`). This part
  already tracks Ableton's "practically all controls" framing (§1) reasonably well — the gap is in
  *editing power* and *scope* (clip vs. track), not *which params* are automatable.

### 7.2 Concrete recommendations, ranked by leverage

1. **Add an `interpolation` field to `BeatAutomationPoint` (hold / linear / curve) — highest
   leverage, smallest format change.** This is already an acknowledged gap (`product-roadmap.md`
   line 148, `format-spec.md`'s v0.9 section) and Ableton's chapter shows exactly how cheap the UI
   gesture can be: **curve shape is a per-*segment* property set by a direct drag on the segment
   itself** (§6.3's Alt/Option-drag), not a separate mode or dropdown. Concretely: store the curve
   flag on the point that **starts** the segment (so `point p1 8 548 curve` means "the segment from
   p1 to p2 bows"), default to linear (canonical elision — only serialize when non-default, same
   discipline as v0.3's synth-field elision), and let the engine's existing per-param interpolation
   logic (already log-space-aware for cutoff, per `phase-20-automation-lanes.md`'s "What's
   deferred") branch on it. `hold` (step/no interpolation) is worth including too — it's the natural
   representation for automating a discrete/switch param (Ableton names this explicitly, §25.5:
   "the value axis is discrete... e.g., on/off," p.485), which dotbeat doesn't cleanly support today
   since a linear ramp between two boolean-ish values is meaningless.

2. **Ship Simplify Envelope before (or alongside) any future automation-recording feature.**
   Ableton frames Simplify explicitly as the antidote to *recorded* automation's breakpoint
   explosion (§6.5) — worth noting now because dotbeat doesn't record automation from live knob
   twiddling yet, but if/when it does (a natural extension of the existing daemon `/automate`
   route), recorded curves will immediately need this or become unreadable/undiffable messes in the
   `.beat` text. Cheap to build even without recording: it's a pure geometric reduction over
   existing `BeatAutomationPoint[]` (points that lie within tolerance of a straight/curved line
   through their neighbors get dropped) — genuinely useful today as a manual "clean up this curve"
   command, and it directly protects dotbeat's own diff-friendliness value prop (a hand-drawn 40-point
   curve is a much noisier diff than an equivalent 6-point one).

3. **Decide the clip-vs-track automation question explicitly, rather than leaving it implicit.**
   This chapter exists *because* Ableton draws a clean line between clip-scoped and track-scoped
   automation and gives users a tool to choose (§6.7's Lock Envelopes). dotbeat inherited only the
   clip-scoped half by design (`format-spec.md` v0.9), which is a reasonable v1 simplification but
   has a real, already-documented cost: automation is invisible outside song mode and only follows a
   track's "first-playing" clip (`phase-20-automation-lanes.md`'s own deferred-items list). Given
   dotbeat's document-as-source-of-truth model, the Ableton-equivalent of "track automation" is
   probably **not** a second parallel data structure — it's closer to: automation that lives on the
   **scene/section's slot mapping** rather than the clip object, so a curve can genuinely span
   multiple scenes/clips the way a Lock-Envelopes curve spans multiple Ableton clips. This needs its
   own scoped design pass before building (a real format decision, not a small addition), but the
   gap is worth flagging now rather than rediscovering it later the way the M3 session rediscovered
   per-lane drum gain.

4. **Add exact-value entry to the breakpoint editor — a small, high-value UI addition.**
   Ableton's right-click "Edit Value"/"Add Value" (§6.3) solves a real precision problem: dragging a
   breakpoint by eye to hit exactly `440.0 Hz` or exactly `-6.0 dB` is hard with a mouse. dotbeat's
   `AutomationLane` component already has the pointer-drag plumbing (`ArrangementView.tsx` ~line
   857) and the daemon route (`POST /automate`, wrapping `setAutomationPoint`); this is a small,
   contained UI addition — a number input appearing on right-click/long-press of a breakpoint,
   committing through the exact same `postAutomation` path a drag already uses. High value-per-effort
   relative to most of this list.

5. **Consider a same-row overlay as an alternative *view*, not a replacement.** Ableton's default is
   the curve drawn directly over the clip's waveform/MIDI content (§6.1) specifically so breakpoints
   can be lined up against the music underneath — exactly the same alignment problem dotbeat's own
   `ArrangementView.tsx` already solved for clip *content* rendering (research 30's finding that
   audio/synth/drum blocks need visible boundaries). Phase 20 already flagged this as deferred; worth
   revisiting once multi-clip-per-track automation (item 3) is closer, since overlay mode is far more
   valuable when a lane can span several different underlying clips and you need to see which
   musical event a breakpoint lines up with.

6. **Lower priority: predefined shapes (§6.6) and stretch/skew (§6.4).** Both are genuinely useful
   authoring accelerants, but they're refinements on top of a curve-editing model that doesn't yet
   have curves (item 1) or a settled clip/track scope (item 3). Worth returning to once those land —
   the ADSR/ramp shapes in particular pair naturally with a future `hold`/`curve` interpolation
   column, since a "swell" shape is meaningless without curved segments to draw it with.
   **Tempo automation (§6.9) is explicitly out of scope for now** — it depends on dotbeat's engine
   growing arbitrary tempo-change support first (`format-spec.md:909`'s own stated future item,
   currently a single scalar `tempo` field), which is a much larger, already-tracked, separate piece
   of work than anything in this doc.

7. **Not recommended: Ableton's override/re-enable mechanism (§5/§25.4).** This is a live-mixing
   safety net for a real-time performance tool, not an authoring-and-commit document model. dotbeat's
   equivalent safety net is already structurally different and arguably better-suited to a
   git-native tool: undo/redo (tracked separately, `product-roadmap.md`'s v1 tier) and the checkpoint/
   history system (D3) already let you try something and revert, at the level of a whole edit or a
   whole checkpoint rather than a single overridden control. No action needed here — flagged only so
   a future pass doesn't treat its absence as an oversight.

## Sources

Ableton Live 12 Reference Manual, chapter 25 "Automation and Editing Envelopes," pp. 481-493
(`prior_art/`, local PDF extract via `pdftotext -layout`, not tracked in git). dotbeat citations
this pass: `src/core/document.ts` (`BeatAutomationPoint`/`BeatAutomationLane`/
`AUTOMATABLE_SYNTH_PARAMS`/`AUDIO_AUTOMATABLE_PARAMS`/`BeatTimeSignature`, lines 438-553, 989-992),
`docs/format-spec.md` (tempo field line 833, future tempo/time-sig note line 909),
`docs/product-roadmap.md` (Automation table, lines 143-150), `docs/phase-20-automation-lanes.md`
(automation-lane UI build and its own deferred-items list), `ui/src/components/ArrangementView.tsx`
(`AutomationLane`/`AutomationPicker`, ~lines 245-260, 857-1085), `docs/research/18-ableton-ui-
architecture.md` §7 (prior automation-focused pass, cross-checked rather than re-derived).

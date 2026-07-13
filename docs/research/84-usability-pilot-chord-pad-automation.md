# Usability Pilot 84: Chord Pad + Curved Automation + Verse/Chorus Reuse

## What I set out to build

An exploratory (non-scripted) usability pass on dotbeat: build a synth pad/string layer for a
song, give it an evolving feel via clip automation, and place it into an arrangement as a
repeated "verse" section — then try to build a "chorus" from the same musical idea but with more
automated movement, to find out honestly whether dotbeat's current architecture lets a reused clip
carry different automation per placement, or forces duplication.

Final result (ground truth via `beat inspect`):

```
synth  "pad"  synth  #56b6c2
  synth: sawtooth, -10 dB, cutoff 3200 Hz, res 0.5, ADSR 0.5/0.2/0.8/1, pan 0
  notes: 12, pitch 53-67, steps 0-48 of 64
  clips: s1 (12 notes, auto: cutoff(3)), s2 (12 notes, auto: cutoff(6))

scene s1: lead=s1 synth=s1
scene s2: lead=s2 synth=s2

song: s1(4) s1(4) s2(4) — 12 bars total
```

A 4-bar Am–F–C–G pad chord progression (`string-pad` preset), a smooth curved filter-cutoff
automation rise for the "verse" (played twice, 8 bars), and a distinct, more agitated
swinging-cutoff automation curve for a "chorus" built by capturing an independent copy of the same
notes (12 bars total). Playback was sanity-checked and produced audible signal (confirmed via the
live level meter during playback).

## Narrative walkthrough (condensed, real-time log)

**Setup friction (environment, not dotbeat):** the browser hung at "connecting to daemon..."
indefinitely on first launch. Root cause: a leftover puppet-driver script from a *different*,
concurrently-running usability pilot in this shared sandbox had hardcoded the same port I was
assigned (9405) and was squatting on it (IPv6 side), while my real daemon held the IPv4 side —
`localhost` resolution picked the wrong one. Not a dotbeat bug; worked around by moving to fresh
ports. Mentioning it only so it isn't confused with a real product issue below.

**First impression:** the app loaded into a clean, dark, information-dense but not overwhelming
layout — arrangement view on top, a per-track clip editor below, one starter synth track already
selected with its (empty) piano roll open. No fumbling needed to find where to start.

**Track + preset:** `+ track → Synth` was immediate and unambiguous (options: Synth/Drums/
Instrument/Audio). Renamed it "pad" via double-click on the track name. The Device tab's preset
picker is a plain, scannable native `<select>` grouped by category in the label text itself
("string-pad — pad", "lush-pad — pad", "deep-sub-bass — bass", ...) with prev/next step buttons —
no separate modal needed. Picked `string-pad`. Confirmed via `beat inspect` that this really
changed the synth engine (slow 0.5s attack / 1.0s release vs. the sawtooth-lead default's punchy
0.01s/0.3s) — not just a cosmetic label.

**Chord entry in the piano roll — the rough part of the session.** Extended the clip to 4 bars via
the global "LOOP LENGTH" stepper, then tried to place 12 notes (3-note chords × 4 bars, one bar
sustained per chord). This is where most of the session's friction concentrated:
- Discovered that **clicking empty grid space while a note is currently selected only deselects
  it** rather than adding a new note — the click is silently "eaten." A naive click-click-click
  sequence to stamp out several notes in a row loses notes unpredictably as a result.
- Drag-based note resizing (grabbing the right-edge handle and dragging to the target length)
  triggered an unexplained vertical scroll drift of exactly one octave partway through a sequence
  of edits, silently placing later notes an octave away from where they were clicked.
- Both were real, reproducible interaction hazards, not just scripting artifacts — a patient human
  clicking through the same sequence would hit the same silent failures.
- Once understood, the *underlying* primitives were solid and precise: click adds a short
  grid-snapped note; clicking an existing note selects it; `Shift+→` extends a selected note by
  exactly one grid step, reliably, with no drag imprecision. Switching to keyboard-driven
  resizing plus explicit before/after verification against the daemon's live document (not just
  the screen) got all 12 notes placed correctly.
- Dragging the horizontal divider between the arrangement and the clip editor to claim more
  screen height was necessary at 1440×900 (only ~7 pitch rows are visible by default) and worked
  well once found, but there's no visible grab-handle affordance — I found it by inspecting the
  DOM, not by looking at the screen.

**Placing the clip into the arrangement ("verse"):** the per-track automation toggle ("A") stays
disabled with the hint "add this track to a scene to automate its clip" until the clip is actually
placed — a reasonable design, but the hint is only visible in the DOM `title` attribute, not as a
visible tooltip/label a user would naturally see. Clicking "Place in Arrangement" first requires a
song section to exist; `+ section` created one and, conveniently, `+ section` a second time
duplicated it — giving the "verse played twice" (8-bar) shape in one extra click, exactly what the
goal wanted.

**Automation lane:** enabling the "A" toggle revealed an AUTOMATION row with a parameter picker
(~100 params, e.g. `pad / Cutoff`, `pad / Reverb`, `Track Vol`) and a `+ add lane` button. The
first attempts appeared to do nothing — no lane appeared, the parameter dropdown just reset. It
turned out the lane genuinely *was* being created in the underlying document (confirmed via the
daemon's live JSON) but was rendering **behind** the clip-editor panel due to a layout stacking
issue tied to how tall I'd made the arrangement pane. Enlarging the pane made the lane visible.
Once visible, plain clicks on the lane canvas placed automation points accurately (confirmed via
the document: a click landed at clip-relative step 3.92, value ≈8.7 kHz, matching the click
position exactly against the parameter's real 20 Hz–18 kHz range).

**Curved automation — real, and visually confirmed.** Using the CLI's `beat automate ... --id p1
--interpolation curve`, I reshaped a straight two-point ramp into a genuinely bowed ease-curve,
and it rendered as a smooth curve in the GUI, not a straight line — screenshotted and confirmed.
I did not find an equivalent curve-shaping *gesture* directly in the GUI (dragging a segment's
midpoint just added a stray extra point rather than bending the curve), so this capability seems
real but only reachable via the CLI today.

**The core research question — verse vs. chorus automation reuse:** with the pad clip ("s1")
placed twice as the verse, I duplicated it as a third section using `+ capture scene`, which
"snapshot[s] every track's current live content into a new, independent scene." This produced a
new clip id ("s2") with the **same 12 notes** copied over, but **zero automation points** — i.e.,
capture-scene copies notes but does not copy automation. I then authored a distinctly more intense
automation shape on s2 (a fast open, then two down-up swings, vs. s1's single smooth rise) via the
CLI, confirmed it landed via `beat inspect` (`s1: auto cutoff(3)` vs `s2: auto cutoff(6)`).

While building this I hit a second real blocker: **the GUI's clip editor would not open the s2
clip at all.** Clicking directly on the s2 clip block in the arrangement (verified with precise
`data-clip-block="synth::2"` targeting, not approximate coordinates) correctly selected the track
and highlighted the block, but the bottom clip-editor panel stayed locked on showing clip "s1"'s
content throughout — across page reloads, track switches, and a daemon restart. I could not find
any interaction that opened the second scene's clip for editing in the GUI; I ended up authoring
the entire chorus automation via the CLI as a workaround.

**Playback sanity check:** pressed Play from bar 1; the transport ran, the playhead advanced
visibly through both the verse and chorus sections, and the master meter (top-right) showed a live
animated waveform confirming actual audio signal — a clean final sanity check.

**Infrastructure hiccups (noted for completeness, not dotbeat product bugs per se):** the beat
daemon process died silently twice during the session with no error in its log; both times all
data was intact on restart because CLI writes go straight to the `.beat` file on disk and the
daemon just re-reads it.

## Findings summary (ordered by real-user impact)

- **[bug]** Clicking empty piano-roll grid space while a note is selected silently deselects
  instead of creating a note — the very next click at the same spot then creates it. A fast,
  patient click-click-click chord-entry workflow silently drops notes with no error shown.
- **[bug]** Drag-based note resize (dragging the right-edge handle) can cause the piano roll's
  vertical scroll to drift by exactly one octave mid-sequence, silently placing later notes an
  octave away from where they were clicked/dragged.
- **[bug][high-impact]** Once a song has more than one distinct scene, the GUI's clip editor
  appears unable to open any clip other than the first scene's — clicking directly on a later
  section's clip block (verified via precise DOM targeting) updates track/selection state but
  never swaps the editor's content. This meant the entire "chorus" automation had to be authored
  via the CLI; a GUI-only user would likely be stuck unable to edit a second section's content at
  all.
- **[bug]** A newly-added automation lane is created correctly in the document but can render
  invisibly, painted over by the clip-editor panel, if the arrangement pane isn't tall enough —
  looks indistinguishable from "the add-lane button doesn't work."
- **[bug]** Dragging the midpoint of an automation segment (attempting to bend a curve) silently
  adds an unwanted extra point instead of bending the segment or doing nothing.
- **[bug, minor]** One React "setState during render" console warning surfaced in
  `ArrangementView` during normal use — not user-visible, but a real code-quality flag.
- **[bug, minor]** The beat daemon process died silently (no error in its log) twice during a
  single session; all data survived because the CLI/daemon both read/write the same on-disk
  `.beat` file, but a real user would just see "○ offline" with no explanation.
- **[confusing]** The automation-lane parameter dropdown (~100 options) resets to the top of the
  list every time you add a lane, making multi-lane setup tedious (reopen, re-scroll, every time).
- **[confusing]** The per-track automation toggle stays disabled with an explanatory tooltip only
  visible in the DOM `title` attribute — a real user hovering might see it, but it's easy to miss
  since the button just looks inert otherwise.
- **[slow-to-discover]** The arrangement/clip-editor divider is draggable and necessary to get
  useful piano-roll screen space at a normal laptop resolution, but has no visible grab affordance.
- **[worked well]** Track creation, renaming, and the preset picker (native `<select>`, grouped-
  by-category labels, prev/next stepper, confirmation toast) were all clean, fast, and did exactly
  what they looked like they'd do.
- **[worked well]** Once understood, core note editing (click to add, click to select, `Shift+→`
  to extend) and automation point editing (click to add a point, accurate to the parameter's real
  value range) were precise and reliable — verified against the daemon's live document, not just
  visual impression.
- **[worked well]** `+ section` (duplicate) vs. `+ insert scene` (empty, independent) vs.
  `+ capture scene` (snapshot current content into a new independent scene) is a clear, honestly-
  labeled three-way choice (tooltips spell out the difference precisely) that maps directly onto
  the verse/chorus reuse question — see below.
- **[worked well]** Curved (non-linear) automation interpolation is real and renders correctly.
- **[worked well]** `beat inspect` / the daemon's live `/document` were completely trustworthy
  ground truth throughout, and let me resolve every GUI ambiguity definitively.

## Does a reused clip carry different automation per arrangement section?

**No — not today, and the architecture is explicit about it rather than accidental.**

Automation lives on `clip.automation`, keyed by clip id, exactly parallel to how notes live on
`clip.notes`. A clip placed into multiple arrangement sections (e.g. the "verse" played twice, both
referencing clip `s1`) has **exactly one** automation array, shared identically by every placement
— confirmed both by the daemon's live document and visually, where the same bowed cutoff curve
rendered pixel-identically at both timeline positions.

The one supported path to independent per-section automation is **duplication**: `+ capture scene`
snapshots a track's current live clip content into a brand-new, fully independent scene/clip. In my
test this copied the 12 chord notes over faithfully but explicitly did **not** carry over the
automation — the new clip (`s2`) started with zero automation points, ready for independent
authoring. This is a real, working, honestly-labeled workflow (the button's own tooltip says
"snapshot ... into a new, independent scene" — it does not claim to preserve automation, and in
practice it doesn't), but it is duplication, not an override mechanism. There is no way to keep a
single shared clip and vary just its automation per placement; if the notes should stay identical
between verse and chorus but automation should differ, you pay for that by fully forking the clip
(and its notes travel along for the ride, needing no re-entry, which is a real convenience — but
the two copies are now independent for *any* future edit, not just automation).

Practically, this also means: once you've forked a chorus clip this way, the current GUI's clip
editor cannot actually be used to shape that forked clip's automation (see the high-impact bug
above) — the honest verse/chorus divergence workflow in this build runs through the CLI, not
click-and-drag.

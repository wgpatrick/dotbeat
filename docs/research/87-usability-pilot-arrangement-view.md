# Usability pilot 87: Arrangement view mechanics, in breadth

Exploratory pilot (no scripted checklist) driving the real dotbeat GUI with Playwright (via a
persistent Chrome instance connected over CDP, since no Playwright MCP tool was available in this
environment) against a real `beat daemon`, working from `examples/night-shift.beat` (copied to a
disposable scratch fixture, never the owner's live `night-shift-song.beat`). Unlike prior pilots,
this session deliberately does not build one song — it audits the Arrangement view itself as a
feature surface: every track-kind, every "+" button, section reordering/deletion, clip drag/drop,
loop-vs-song mode, and a handful of wrong-path tries (right-click, guessed keyboard shortcuts).

## Narrative walkthrough (condensed)

The app opened into `night-shift.beat`'s 4-track loop (`lead`/`drums`/`bass`/`pad`, LOOP 4,
detail view). **Track management** first: `+ track` opens a dropdown with Synth/Drums/Instrument/
Audio. Synth and Drums added cleanly, auto-naming collisions handled well (`drums` → `drums2`).
Instrument was greyed out and unclickable — a hover tooltip said "needs a registered SoundFont
sample (beat sample)," confirmed by checking the Browser panel, which does have a "SoundFonts"
category with 3 presets and a `+` register button, but nothing in the add-track menu itself
explains the prerequisite. Audio added successfully but turned out to be a dead end (see findings
below) — its Clip tab reuses the note-editor UI verbatim ("0 notes · click a key to preview") and
its Device tab is a bare header with zero controls. Rename via double-click worked, but typing
"vox sample" silently became "voxsample" — the space vanished with no warning. Delete is gated by
a real native `window.confirm()` dialog ("Delete track ... cannot be undone from here") — my first
two delete attempts appeared to silently no-op because Playwright auto-dismisses unhandled native
dialogs; a human would just see the OS-style confirm sheet. `+ group` (disabled until ≥2 track
checkboxes are ticked) worked well: grouping, collapsing (hides member rows, keeps others visible),
and ungrouping (instant, no confirmation, unlike track delete) were all clean and predictable.

**Section/scene management** was the deepest area. `+ section` converted LOOP 4 → SONG 8 and
duplicated the previous section by *reference* — both chips showed scene id `s1`, confirmed via
`GET /doc` (`song: [{sceneId:'s1'},{sceneId:'s1'}]`). This matches a previously-documented finding
(research/86), so I moved on quickly rather than re-litigating it. `+ insert scene` created a
genuinely empty new scene (`s2`, `clipIds: {}`); `+ capture scene` created a new scene (`s3`)
pre-populated with every track's *current live* content. Unlike prior pilots, I checked whether the
UI explains the difference between these three near-identical buttons — it does, just only on
hover: `title="append a section (duplicates the last section's content)"` /
`"insert a new, empty, fully independent scene..."` / `"snapshot every track's current live
content into a new, independent scene..."`. I also found a "linked scene" indicator I hadn't seen
documented before: once two sections share a scene, both chips grow a small colored dot
(`.arr-chip-linked`) with tooltip `"shares scene 's1' with 1 other section — editing one edits all
of them (sections with a matching dot share content)"`. This is a real, working answer to "can I
tell which sections share content" — it just requires a deliberate hover to discover, same as the
button-difference tooltips.

Section reordering (◀/▶ move-arrows on each chip) worked cleanly — moving `s3` left swapped it with
`s2`, bar numbers and content re-mapped correctly, confirmed both visually and via `GET /doc`.
Section deletion (×) has no confirmation dialog (unlike track deletion) and immediately shrank the
song; the deleted section's scene became **orphaned** — still present in `doc.scenes` (and in the
persisted `.beat` file as a bare `scene s2` with no slots) but referenced by nothing. I deliberately
tried clicking directly on a section's name label to see if it "selects" the section the way the
arrangement's own hint text implies ("click a section's name or clip to view/edit its content
below") — instead, a single click **started playback** from that bar, no rename field, no
selection-only state. Double-click did the same (also playback, no rename UI ever appears despite
adjacent hint text). This matches research/86's "double-click starts playback" finding, but I
confirmed it's not double-click-specific — a single click on the label is enough.

The most consequential new finding came from **clip-block interaction**. Left-clicking a
non-first-section clip block (using precise `data-clip-block="lead::N"` targeting, not approximate
coordinates) selects the track and visually highlights the block, but — confirmed exactly as
research/80's Phase 29 GA writeup predicted — does **not** retarget the bottom Clip editor, which
stays locked on whatever it was last showing. I then tried **right-clicking** the same block
(testing for a context menu, per the brief's "wrong path" prompt) — no menu appeared, but the Clip
editor's header **did** flip from `clip "s1"` to `clip "s3"`, and the "Placed (clip ...) — update"
button label updated to match. Right-click retargets; left-click doesn't. That's a genuinely
strange, undiscovered asymmetry — nothing in the UI hints that right-click (normally reserved for
context menus, which don't exist here) is the one gesture that actually lets you look at a later
section's clip content.

Then I tried the brief's explicit ask — "drag a placed clip occurrence to a new position" — by
grabbing the `lead::2` (`s3`) block and dragging it ~200px left, expecting either a no-op or a
simple visual nudge. Instead it performed a real structural edit: the `lead` track's clip
assignment moved from section 3 into section 2, and because sections 1–2 were still sharing scene
`s1`, the app had to fork **two new anonymous scenes** to represent the result without corrupting
the shared original — `GET /doc` afterward showed `song: [s1, s5, s4]` where `s5` is s1's slots
with `lead` now pointing at what used to be s3's clip, and `s4` is s3's slots with `lead` **removed
entirely**. Visually, section 3's `lead` row just went blank. Zero toast, zero confirmation, zero
visual diff highlighting what happened — a user would just see their clip "disappear" from one
section and reappear, unexplained, in the neighboring one, alongside two new opaque scene IDs.
`Undo` cleanly reverted the whole thing in one click (confirmed via `GET /doc`), which is the one
reassuring part.

I rounded out clip manipulation with the brief's keyboard "wrong path" tries: selecting a clip
block and pressing `Delete` did nothing (confirmed via `GET /doc` — no change), and `Cmd+D` also
did nothing (no browser dialog intercepted it either). Checking the in-app Shortcuts panel
afterward explained why: `Delete`/`Backspace` are documented as scoped to "PIANO ROLL / NOTE
EDITING" only. The panel has exactly three sections — GLOBAL, PIANO ROLL / NOTE EDITING, KNOBS —
and **zero** arrangement-specific shortcuts exist anywhere. Right-click on a section name label and
on a track header both produced no context menu (label click also still triggered playback-seek;
track header did nothing at all).

I tested note-level editing inside the Clip tab too: dragging a note (using precise
`.noteview-note` bounding boxes, not guessed screenshot coordinates) moved it both in time and
pitch smoothly and persisted correctly to the *live* track buffer (confirmed via the raw `.beat`
file: `note u100033 76 20 2 0.7` → `note u100033 77 27 2 0.7`). But the **saved** `clip "s3"`
content block in the same file kept the old, unmoved note — the drag only updated the live editing
buffer, not the arrangement's snapshot, which needs an explicit "Placed (clip "s3") — update" click
to propagate. This is the same live/saved split research/86 found via "Place in Arrangement," just
reached through a different, more organic gesture (a plain note drag) that gives no hint it hasn't
already "taken."

Bar-range selection (drag across the ruler) worked well and contextually relabeled the two "vary"
buttons from `≈ vary filter` / `≈ vary feel` to `≈ vary filter (tone)` / `≈ vary feel (timing)` once
a bar range was selected — a nice, easy-to-miss polish detail. Zoom controls worked (`-`/`+`,
`93px/bar` readout); `zoom in` disabled itself quickly (apparently near a cap) and `fit` was
disabled when already fit. A `loop selection` button (title `"loop bars 2–4"`) toggled a transient
playback-only loop over just the selected bar range — a third, distinct "loop" concept alongside
LOOP-mode-vs-SONG-mode and the individual sections' own "⟲ loop this section while auditioning"
buttons.

Finally, I deleted sections back down to exactly one to see whether SONG mode reverts to LOOP mode.
It does not — the header kept showing `SONG 4` with 1 section, not `LOOP 4`. Once a project crosses
into song mode there's no UI path back, even when the song is structurally back to a single section
worth of content.

## Findings summary

- **[bug] Dragging a clip block silently forks anonymous new scenes with zero feedback.** Dragging
  `lead`'s clip block from section 3 into section 2's area (a very natural reading of "drag a
  placed clip occurrence to a new position") performed a real structural edit: it moved that one
  track's clip assignment across sections and, because the source/destination sections shared a
  scene, forked two brand-new scene IDs (`s4`, `s5`) to represent the result — confirmed via
  `GET /doc` before/after. No toast, confirmation, or visual explanation appears; the user just
  sees a clip vanish from one section and appear in another, plus two new opaque scene ids in the
  document. `Undo` does cleanly revert it in one click (verified), so it's recoverable, but the
  operation's very existence and its scene-forking side effect are undiscoverable from the UI
  alone. Repro: with 3+ sections where two share a scene, drag a track's clip block by roughly one
  section-width; diff `GET /doc`'s `song`/`scenes` before and after.
- **[bug] Right-click retargets the clip editor to a section's clip; left-click doesn't.** Left-
  clicking a non-first-section's clip block (confirmed with precise `data-clip-block="track::N"`
  targeting) selects the track but leaves the bottom Clip editor showing whatever it was already
  showing — the known GA issue (research/80, /83, /84, /86). But right-clicking the identical block
  **does** retarget the editor to that section's clip (`clip "s1"` → `clip "s3"`), with no context
  menu and no visual cue that right-click does anything different from left-click. This is a novel,
  undocumented, and highly non-obvious way to reach the one GUI capability three prior pilots
  reported as entirely unreachable.
- **[confusing] "Audio" track kind is a GUI dead end.** Creating an Audio track via `+ track` →
  Audio produces a track whose Clip tab is the literal note-editor UI ("0 notes · click a key to
  preview," "Preview clip") and whose Device tab is a bare header ("AUDIO — full synth surface ·
  drag a knob...") with **no controls underneath at all**. The Browser panel (tooltip: "browse
  presets, kits, and soundfonts") has no audio-file/sample category to drag from. Cross-referencing
  `docs/format-spec.md` §"v0.10 additions — audio-region clips" confirms this isn't a bug so much
  as an intentionally CLI/MCP-only feature (`beat audio-clip`) with no GUI counterpart yet — but the
  add-track menu offers "Audio" as a first-class, undifferentiated peer of Synth/Drums with no
  indication that it currently leads nowhere in the GUI.
- **[confusing] Track rename silently strips spaces.** Renaming a track to "vox sample" via
  double-click → type → Enter produced "voxsample" (space removed) with no warning, no error, and
  no indication in the UI that spaces aren't allowed.
- **[confusing] A single click on a section's name label starts playback, not selection.** The
  arrangement's own hint text says "click a section's name or clip to view/edit its content below,"
  but clicking a section label starts playback seeking to that bar instead (confirmed on both
  single- and double-click — research/86 only reported the double-click case). No rename field, no
  selection-only affordance, ever appears from clicking the label itself.
- **[confusing] Note edits (e.g. a plain drag) update the live buffer but not the saved arrangement
  clip.** Dragging a note in the Clip editor persists to the live track's notes immediately
  (confirmed in the raw `.beat` file), but the scene's saved `clip "s3"` block keeps the pre-drag
  note until the "Placed (clip "s3") — update" button is explicitly clicked. Nothing about a plain
  note-drag gesture suggests it hasn't already updated the arrangement.
- **[confusing] Track deletion requires a native `window.confirm()` dialog; section deletion needs
  no confirmation at all.** The two deletion actions closest in spirit (delete a track vs. delete a
  section) have opposite confirmation behavior, and the track-delete confirmation is an OS-style
  native dialog rather than any of the app's own styled overlays — a stylistic outlier (this is also
  why my first two automated delete attempts silently no-op'd: Playwright auto-dismisses unhandled
  native dialogs, which is itself informative about how invisible this dialog type is to tooling).
- **[confusing] "Instrument" track kind is disabled with only a hover-tooltip explanation.** The
  `+ track` menu's Instrument option is visibly greyed out; the only explanation
  ("needs a registered SoundFont sample (beat sample)") is a browser-native title tooltip, not
  inline UI text, and the wording assumes CLI vocabulary ("beat sample") a GUI-only user wouldn't
  recognize.
- **[confusing] Deleting a section orphans its scene.** Confirmed independently via both `GET /doc`
  and the persisted `.beat` file (`scene s2` with no slots, referenced by no `song` line) — matches
  the known GA scope item, reproduced live on current `main`.
- **[slow-to-discover] Zero arrangement-specific keyboard shortcuts exist.** The in-app Shortcuts
  panel documents exactly three scopes — GLOBAL, PIANO ROLL/NOTE EDITING, KNOBS — with nothing for
  the arrangement itself. `Delete` and `Cmd+D` on a selected clip block are silent no-ops (matching
  the documented, note-editor-only scope of `Delete`), which is at least *consistent*, but a user
  extrapolating from the note editor's rich shortcut set (arrows to nudge, Shift+arrows to resize,
  Cmd+C/V to copy/paste) would reasonably expect at least `Delete` to work one level up too.
- **[slow-to-discover] LOOP-mode → SONG-mode is one-directional.** Once a second section is added
  the header permanently reads `SONG N`; deleting sections back down to exactly one does not revert
  it to `LOOP N`, and no button anywhere offers to convert back. Not destructive, just a dead end —
  a user who added a section experimentally and deleted it again is left in a cosmetically different
  (but functionally near-identical) mode with no way back.
- **[worked well] The three "+" section/scene buttons ARE explained in the UI, just via hover
  tooltips.** `+ section` / `+ insert scene` / `+ capture scene` each carry an accurate, specific
  `title` attribute spelling out exactly how they differ. This softens (without eliminating) the
  discoverability complaint from research/86 — the information exists, it's just gated behind a
  deliberate hover most users won't perform on three visually-similar buttons.
- **[worked well] A "linked scene" indicator already exists.** Two sections sharing a scene each
  grow a small dot (`.arr-chip-linked`) with tooltip `"shares scene ... with N other section(s) —
  editing one edits all of them (sections with a matching dot share content)"`. This is a real,
  functioning answer to "can a user tell which sections share content" — again hover-gated, but
  present and accurate, confirmed by toggling it on/off as sections were reassigned scenes.
- **[worked well] Section reordering, track add/rename/delete, and group/collapse/ungroup are all
  reliable.** Move-arrows correctly re-map bar numbers and content; grouping/collapsing/ungrouping
  tracks via checkboxes was immediate, visually clear, and (for ungroup) required no confirmation
  at all, in pleasant contrast to how heavy track deletion's confirmation is.
- **[worked well] Bar-range selection and its contextual labeling.** Dragging across the ruler
  selects a bar range and relabels the "vary" toolbar buttons with parenthetical hints (`(tone)` /
  `(timing)`) specific to a bar-range selection vs. a track selection — a small but genuinely useful
  contextual detail.
- **[worked well] Note dragging inside the Clip editor** is smooth and precise (moved both pitch and
  time correctly in one gesture) once real element bounding boxes are used instead of guessed
  coordinates, and the resulting edit persists to the live buffer immediately.
- **[worked well] Undo cleanly reverts even the most surprising structural edits** — the
  clip-drag-that-forked-two-scenes fully reverted, confirmed against `GET /doc`, in a single Undo
  click.

## Where the pilot leaned on ground truth over the screen

Several findings here (the orphaned scene on section-delete, the live-vs-saved clip split on note
drag, and especially the clip-drag scene-forking behavior) were only fully legible by diffing
`GET /doc` and the raw `.beat` file before and after each action — the screen alone showed a
plausible-looking but incomplete picture (e.g., a clip block just "went blank," with no on-screen
indication that two new scene IDs had been minted to explain why). This is the same lesson prior
pilots flagged: ground truth from the daemon's live document catches classes of bug that a purely
visual read cannot.

## Where I gave up on the ideal workflow

None of the "ideal workflows" attempted here were abandoned outright — every affordance tried
either worked, no-op'd cleanly, or produced a (documented) surprising-but-recoverable result. The
closest to a genuine dead end was the **Audio track kind**: there is currently no GUI path at all to
attach real audio content to one once created (confirmed by exhausting the Browser panel's
categories and the Device tab), so building anything with actual audio content would require
dropping to the CLI/MCP (`beat audio-clip`) — which is consistent with `docs/format-spec.md`'s own
documented v0.10 scope, not a surprise regression, but worth flagging since the `+ track` menu
presents "Audio" as equally ready-to-use as Synth/Drums/Instrument.

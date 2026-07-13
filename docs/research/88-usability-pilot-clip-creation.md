# Usability pilot 88: create-a-clip-and-place-it, across all four track kinds

Exploratory pilot (no scripted checklist) driving the real dotbeat GUI with Playwright against a
real `beat daemon`, working from a fresh `beat init` project (never `examples/night-shift-song.beat`).
Goal: for each of dotbeat's four track kinds — Synth, Drums, Instrument, Audio — go through the
full create-content → place-in-arrangement lifecycle as a real user would, compare how the workflow
feels across kinds, and specifically stress-test whether a track that already has one clip placed
can get a second, independently-authored clip in a different song section.

This pilot runs against current `main`, before Phase 29's fixes for GA (scene/clip-editor
targeting) land — several findings below reproduce or extend GA-class bugs already tracked in
`docs/phase-29-plan.md`, called out explicitly where that's the case.

## Narrative walkthrough (condensed)

The app opened straight into a fresh loop-mode project with one starter Synth track ("lead"), the
same note-grid clip editor documented in prior pilots. Clicking into the grid to add the first note
worked on the first try (click = add), but rapid follow-up clicks reproduced the known view-
autorecenter bug (GC-2): after the first note landed, the visible pitch window jumped, and two of
my next three clicks silently missed their intended target and landed as no-ops or on the wrong
row, matching pilot 80/83's description almost exactly. Slowing down to one click, screenshot, look,
click made the rest land reliably. Five notes total ended up as the synth clip.

Clicking **Place in Arrangement** while still in loop mode (no song sections yet) was a genuine
no-op — the button's own `data-place-clip-state` stayed `"unplaced"` and nothing was written to the
`.beat` file, confirmed via `beat inspect`-equivalent (direct file diff). Worse, the on-screen note
count briefly desynced afterward, showing "7 notes" against a document that actually had 4 — a
transient, reload-fixable display glitch I could not fully isolate as timing-vs-real (noted below,
lower confidence than the other findings). Clicking **+ section** was what actually mattered: it
converted the project to song mode in one click, and — reproducing pilot 86's exact finding —
silently created a *second* section sharing the *same* scene id as the first (`SONG 4`, 2 sections,
both showing `s1`), with no visual cue that they're linked. Only after this did "Place in
Arrangement" start working, confirming (again matching pilot 86) that the button requires song mode
to already exist before it does anything, with zero UI hint that loop-mode is the reason it doesn't.

**Testing the "second clip, new section" workflow (goal #4).** With the synth clip placed, I used
`+ insert scene` to add a genuinely new, empty third section, then reordered it to index 0 with the
section chip's `◀` button (the pilot-86-documented workaround, since "Place in Arrangement" always
targets `doc.song[0]`). I added a new, distinctly different note to the note editor and clicked the
now-relabeled **"Placed (clip "s1") — update"** button. The result, confirmed by diffing the raw
`.beat` file before/after: the new note was written into the *existing* shared clip `s1`, **and**
that same clip got wired into the new section's scene as well — so all three sections now play the
exact same one clip, including my "new" note. There is no GUI path to give a track a second,
independently-authored clip in a different section — this is not a bug so much as a hard
architectural wall: dotbeat v1 is documented in source comments (`ClipPropertiesPanel.tsx:15`,
`ArrangementView.tsx:317`) as "one editable clip per track," reused by reference across every scene
it's slotted into. Nothing in the GUI tells you this before you try; the button's own copy
("update," "already placed as clip 's1'") reads like a normal save action, not a warning that
you're about to retroactively change every other section using that clip too.

**Drums.** Adding a Drums track surfaced a visibly different, and better-suited, clip editor: a
12-lane grid (kick/snare/rimshot/clap/hat/openhat/tom_lo/tom_mid/tom_hi/crash/ride/cowbell) with
markers instead of a piano roll — a sensible, expected differentiation from the Synth/Instrument
editor. Clicking to place 14 hits in quick succession (roughly 100-150ms apart) reproduced the
documented rapid-edit data-loss bug (GD-1) at a striking severity: **13 of 14 hits were silently
lost** — the UI kept rendering all 14 markers on screen with no error, but `GET /document` and the
raw file showed only 1 hit persisted, confirmed again after a full page reload (ruling out a
render-vs-doc timing fluke). A controlled retest with the same clicks spaced ~1.5s apart persisted
all 7 additional hits cleanly — strong evidence this is the same root-cause race GD-1 already
targets, just previously undocumented on the *drum* grid specifically (prior evidence was on the
note/pitch grid). "Place in Arrangement" worked cleanly for drums once song mode existed, correctly
naming the new clip `"clip1"` and showing it only in the one section drums has a slot in.

**Instrument.** The `+ track` dropdown's "Instrument" option was greyed out until a SoundFont was
registered — its disabled-button tooltip explained why ("needs a registered SoundFont sample"), but
only on hover, and there's no proactive hint anywhere else. The actual unlock mechanism, found by
opening the Content Browser and scrolling to a "SoundFonts" section at the very bottom (below
Presets — Synth, Presets — Drums, and Kits), was pleasantly different from what I expected: clicking
the "+" on a SoundFont entry (`fluidr3-gm-small`) didn't just register the file as project media —
it immediately created a new, ready-to-use Instrument track pointed at that SoundFont in one click,
no separate "+ track → Instrument" step needed. Its clip editor turned out to be the *exact same*
note-grid component as Synth (same hint text, same interactions) — a sensible reuse, since both are
pitched/note-based content, just driven by a different sound engine. Adding 3 notes and placing
worked cleanly, no data loss this time (all 3 landed and persisted). One real backend nuance
surfaced while investigating: `GET /doc` (the daemon's legacy BeatLab-bridge endpoint) *excludes*
instrument-kind tracks by design — they're deliberately carried on a separate `instruments` field,
not `tracks` — while `GET /document` (the endpoint dotbeat's own GUI actually uses) includes them
normally. This is intentional, tested behavior (`test/instrument-clips.test.ts`), not a bug, but
worth flagging for future testers/tools: `GET /doc` is the wrong ground-truth endpoint to check for
instrument tracks specifically.

**Audio.** This is where the workflow diverges most sharply from the other three. A brand-new Audio
track's clip editor rendered the same empty piano-roll UI as Synth/Instrument ("0 notes, click a
key to preview") — nonsensical for a track that will never have notes, and the first sign that Audio
doesn't get its own bottom-panel treatment. There is no "Place in Arrangement" button at all for
Audio tracks. Finding real sample content required digging past the Content Browser's genre-named
drum sections (`808-TRAP`, `TECHNO`, etc. — these *look* like audio loops with a cassette icon, but
are actually synthesized drum-kit presets, not decoded audio, confirmed by trying to drag one first
and getting no drop feedback) down into `Kits → kit-audiophob → <lane>` rows, where each lane
(Kick, Snare, Clap, Hat, Open) is a real, `draggable` `.wav` file — the row's own title tooltip
actually says "drag onto a drum lane, or onto an audio track to create a clip," which is a good,
correctly-scoped hint, just easy to miss without hovering. Dragging "Kick" onto the audio *track
header* (not the arrangement grid row — dropping there did nothing, confirmed empirically) worked
and immediately created a placed clip with a real waveform. This is a genuinely different mechanism
from every other track kind's explicit button — matching the brief's expectation, and it worked,
but it demands the user already know to (a) target the header specifically and (b) already be in
song mode (untested by me directly this session since song mode already existed, but documented as
a hard requirement, with a native unstyled `alert()` on failure, by pilot 85).

Once placed, the audio clip's *real* editing controls (in/out/gain/warp fields, a live waveform)
appeared as a compact strip (`.arr-audio-inspector`) squeezed directly under the track rows in the
arrangement view — but the prominent, identically-styled bottom "Clip / Device" panel that every
other track kind uses as *the* clip editor still rendered the same irrelevant empty note-grid
("0 notes · click a key to preview") for the audio track, simultaneously, the whole time. A user
naturally looking at the big labeled panel (same chrome as Synth/Drums/Instrument) would see what
looks like a broken or empty editor, while the actual working controls sit in a much smaller,
unlabeled strip above it that's easy to miss. **Goal #4 for Audio:** dragging a second sample
(Snare) onto the same track header reproduced pilot 85's finding exactly — it replaced clip1's
audio reference in place (`kit-audiophob-kick` → `kit-audiophob-snare`, same clip id) rather than
adding a second region or clip, confirmed via the raw file. Same "one clip per track" wall as Synth,
reached through a completely different (drag-based) mechanism.

A final full playback pass (`Play`, ~1.5s) confirmed the whole arrangement is genuinely wired up,
not just cosmetically placed: the playhead advanced correctly across all four tracks' clip blocks,
the note-grid and the audio-inspector's playhead markers stayed in sync, and the audio waveform
strip scrolled with playback.

## Cross-track-kind comparison

| | Synth | Drums | Instrument | Audio |
|---|---|---|---|---|
| Content authored via | click-to-add piano roll | click-to-add 12-lane hit grid | click-to-add piano roll (identical to Synth) | drag-and-drop `.wav` from Browser |
| Placement mechanism | "Place in Arrangement" button | "Place in Arrangement" button | "Place in Arrangement" button | drag sample onto **track header** (no button exists) |
| Placement needs song mode first | yes, silent no-op otherwise | yes | yes | yes (native `alert()` on failure, per pilot 85) |
| Bottom "Clip" panel matches content type | yes | yes (distinct 12-lane UI) | yes (reuses Synth's UI, sensibly) | **no** — shows an empty, irrelevant note-grid; real controls live in a separate small arrangement-inline strip |
| Track-kind-specific prerequisite | none | none | needs a registered SoundFont (disabled otherwise, tooltip explains) | none, but needs to know Kits-section lanes are the real audio media |
| "Second clip, new section" achievable via GUI | no — shared single clip, confirmed | not tested independently (same architecture) | not tested independently (same architecture) | no — second drag replaces the one clip's content in place, confirmed |

The MIDI-ish kinds (Synth, Drums, Instrument) share one consistent, discoverable placement idiom
(a labeled button) that just has a hidden precondition (song mode must already exist) and a hidden
scope (always section index 0). Audio breaks that pattern entirely — no button, a drag gesture
whose only documentation is a tooltip on the source row, and a target (the track header, not the
arrangement row) that has to be discovered by trial and error. This is a real, load-bearing
inconsistency: nothing in the arrangement UI signals "audio tracks work differently here," so a
user who's just learned "click Place in Arrangement" for three track kinds in a row has no reason
to expect the fourth to require an entirely different gesture.

## Findings summary

- **[bug] Rapid successive hit-clicks on the Drums lane grid silently lose data, more severely than
  previously documented.** 14 clicks ~100-150ms apart persisted only 1 hit (13/14 lost), while the
  UI kept rendering all 14 with no error, confirmed stale even after a full page reload. A controlled
  retest at ~1.5s spacing persisted 100% of clicks. This is very likely the same root cause as the
  already-tracked GD-1 (rapid note-grid edits, `NoteView.tsx` pointer handlers / `bridge.ts` edit
  posting), now independently confirmed on the drum-hit code path too, and at a higher loss rate
  than GD-1's original repro (pilot 82: ~4/24 survived vs. this session's 1/14).
- **[confusing] Dotbeat v1 supports exactly one clip per track, shared by reference across every
  section it's slotted into — and nothing in the GUI says so before you act.** Tried on both a
  Synth track (edit-then-"update") and an Audio track (drag a second sample onto the same header):
  in both cases the "new" content silently overwrote/extended the track's single existing clip
  rather than creating independent content, confirmed via the raw `.beat` file. This matches a
  documented v1 scope cut (`ArrangementView.tsx:317`, `ClipPropertiesPanel.tsx:15`), so it's a real
  design decision, not a bug — but the button copy ("update," "already placed") gives no warning
  that clicking it will retroactively change every other section sharing that clip, which is a
  legitimate discoverability/wording gap worth closing regardless of the underlying architecture.
- **[confusing] The bottom "Clip" panel — the one consistent, prominent editing surface for every
  other track kind — shows an empty, meaningless note-grid ("0 notes · click a key to preview") for
  Audio tracks, even after a real clip is placed.** The actual working controls (waveform, in/out/
  gain/warp) live in a separate, much smaller, unlabeled strip (`.arr-audio-inspector`) wedged
  between the arrangement grid and the bottom panel — both are visible and "live" (playhead-synced)
  simultaneously during playback. A user would very reasonably conclude the audio editor is broken
  or empty by looking at the big labeled panel first.
- **[confusing] Audio tracks use an entirely different placement mechanism (drag onto the track
  header) than the other three kinds (a "Place in Arrangement" button), with no in-app signal that
  this is coming.** The only documentation is a title-attribute tooltip on the Browser's sample rows
  ("drag onto a drum lane, or onto an audio track to create a clip") — real and correctly worded,
  but invisible without hovering, and the drop target (header, not the arrangement grid row) had to
  be found by trial and error (dropping on the grid row silently does nothing).
- **[slow-to-discover] The Content Browser's genre-named drum sections (`808-TRAP`, `TECHNO`,
  `BOOM-BAP`, `LOFI`, `ACOUSTIC-ROCK`) visually read as audio loops (cassette icon, single item) but
  are synthesized drum-kit presets with zero audio content — a natural first click when hunting for
  a sample, and a dead end with no drag feedback. The real audio media is one level deeper, inside
  `Kits → <kit> → <lane>` rows, visually similar to the fake-looking genre rows and not called out
  as different. (Independently reproduces pilot 85's identical finding.)
- **[slow-to-discover] "Place in Arrangement" is a silent no-op in loop mode, with no explanation
  surfaced at the point of failure.** The button's state attribute stays `"unplaced"`, nothing
  writes to the document, and the only relevant hint text ("add this track to a scene (song mode) to
  edit a saved clip's loop range/signature") describes the wrong precondition-in-reverse and doesn't
  read as "click + section first." (Reproduces pilot 86's finding.)
- **[confusing] "+ section" silently links the new section to the same scene as the previous one**,
  with no visual distinction between linked and independent sections in the arrangement. (Reproduces
  pilot 86's finding exactly — still present on `main`, expected since Phase 29 hasn't landed.)
- **[worked well] Track-kind-appropriate clip editors where they exist.** Drums' 12-lane hit grid
  and Synth/Instrument's shared piano roll are each genuinely well-matched to their content type,
  and switching between tracks of different kinds correctly swapped editor type immediately with no
  stale state.
- **[worked well] The Content Browser's SoundFont "+" button is a satisfying one-click shortcut** —
  it doesn't just register media, it creates a ready-to-play Instrument track pointed at that
  SoundFont in a single action, better than the multi-step "register, then + track → Instrument"
  flow I expected going in.
- **[worked well] Once dragged onto an audio track header, the drop just works** — a real waveform
  renders immediately, the arrangement block gets a correct descriptive label
  (`kit-audiophob-kick`), and the file/document update immediately and correctly.
- **[worked well] Full-arrangement playback stayed correctly wired across all four heterogeneous
  track kinds at once** — playhead, per-track sync, and the audio waveform strip's own scroll
  position all tracked together with no drift, the same strong "this is real, not cosmetic" signal
  prior pilots found for song-structure playback.
- **[note, low confidence] After clicking "Place in Arrangement" for the very first time (while
  still in loop mode, so the click was a no-op), the on-screen note count briefly read "7 notes"
  against an actual document count of 4; a full page reload corrected it to "4 notes."** I could not
  cleanly separate "genuine stale client cache" from "my zero-delay scripted click outrunning a
  render that would have caught up with more realistic human timing" — flagging for awareness, not
  asserting as a confirmed bug the way the drum-grid data-loss finding is.

## Where I gave up on the ideal workflow

Goal #4 ("give an already-placed track a second, independently-authored clip in a new section") is
not achievable through the GUI in either mechanism tested (button-based for Synth, drag-based for
Audio) — not because I failed to find the right sequence of clicks, but because the underlying data
model deliberately supports only one clip per track, reused by reference. I confirmed this via the
`.beat` file and source comments rather than continuing to hunt for a GUI path that doesn't exist.
The honest workaround a real user would need today is the CLI/raw file, same conclusion pilots
83/84/86 reached independently for the MIDI-track case, now confirmed to extend to Audio tracks too.

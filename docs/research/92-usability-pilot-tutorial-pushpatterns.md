# Usability pilot 92: following a real published Ableton beginner tutorial in dotbeat

## Intro

This pilot follows "Easy Ableton Live 12 Tutorial for Beginners 2026"
(pushpatterns.com, https://www.pushpatterns.com/blog/ableton-live-12-tutorial-for-beginners) step
by step, translating each instruction into dotbeat's own GUI, rather than inventing a dotbeat-native
goal. The point is to measure dotbeat against an external, independently-authored standard of "what
should a beginner be able to do in a DAW" — not against dotbeat's own roadmap assumptions. Driven
with a headless Chrome via `playwright-core` (`chromium.launch({channel:'chrome'})`) against a fresh
project (`beat init --bpm 120`), daemon on :9805, Vite dev server on :9806, screenshotting after every
action and reading each one before deciding the next. Ground truth cross-checked against
`GET /document` on the daemon and the on-disk `.beat` file throughout. A small custom HTTP-controlled
Playwright driver script was used in place of an interactive browser tool (temporarily placed at
`ui/__usability92_driver.mjs` so its `import` resolved against `ui/node_modules`, removed before
finishing).

## Narrative walkthrough

### Initial Setup

**Launch & Explore Demo.** The tutorial's very first instruction assumes Ableton auto-loads a demo
song you can press play on to get oriented. Loading dotbeat fresh (`beat init`) drops straight into
Arrangement view with exactly one empty starter track ("lead", 0 notes, sawtooth synth) — confirmed
by reading `initDocument()` (`src/core/edit.ts:1068`) directly: it always builds this same minimal
single-track skeleton, never a rich multi-track demo. There is no bundled demo project anywhere in
the repo that the GUI itself would auto-open. The "open folder…" toolbar button, which is the closest
mechanism for loading an existing example project, is disabled in browser mode with the tooltip
"available in the desktop app — switches the daemon to another project folder" — confirmed live by
inspecting the disabled button's DOM attributes. So in the browser-hosted GUI a beginner has
literally nothing to press play on and explore before starting their own work.

**Create New Project.** Clicked "new project…" in the topbar. This is a real, working feature
(`ArrangementView.tsx:2273`, `POST /new-project`) — but it works via a native `window.prompt()`
asking the user to type a destination filesystem path ("New project — destination folder (or a path
ending in .beat)"), not a file-save dialog. Typed a scratch path and accepted: the daemon genuinely
created a new `.beat` file at that path, but the running GUI's own view never switched to it — a toast
appeared: *"Created /tmp/.../np-test.beat. Point a beat daemon at it to open it."* In other words,
"File > New Live Set" in dotbeat's browser-hosted GUI creates a file on disk and then requires the
user to know how to restart a `beat daemon` process pointed at the new path — something a GUI-only
beginner coming from Ableton would have no way to do and no prompt telling them how.

**Configure Audio Preferences.** Grepped the entire `ui/src/components` tree for any preferences
panel, audio-device picker, sample-rate, or buffer-size control — zero hits, and the full topbar
button inventory (`Play, Undo, Redo, Export, Browser, Mixer, History, Shortcuts, +track, +group, open
folder…, new project…, new from template…, save as template…`) confirms there is no
Preferences/Settings entry point of any kind.

### Interface Navigation

**Toggle Between Views.** Searched the live DOM for any mention of "session" — zero matches. Grepped
project docs and found this is a deliberate, explicitly recorded decision, not an oversight: "Out of
scope, per owner direction: a Session-View / 'Live view' clip-launching grid" (`docs/phase-19-plan.md`,
`docs/phase-19-arrangement-length.md`). dotbeat has one unified Arrangement-style timeline and a set
of togglable overlay panels (Browser, Mixer, History, Shortcuts) instead of Ableton's dual
Session/Arrangement view system. Opened Mixer (a clean overlay of all channel strips — level, pan,
shuffle/grid knobs, mute/solo, live meters) and Browser (a categorized preset library sidebar) — both
worked well and are reasonable, if structurally different, substitutes for "switching views."

### Adding Content

**Insert Tracks.** "+ track" opens a dropdown: Synth, Drums, Instrument (soundfont-based, disabled
until a soundfont is loaded via the Browser), Audio. Picked Synth — a new "synth" track appeared
immediately, auto-selected, with its (empty) clip editor opening in the bottom panel. Smooth, no
friction. No "Return track" option exists in this menu or anywhere else in the GUI — dotbeat has
exactly two fixed, non-editable sends (`reverbBus`, `delayBus` in `engine.ts`) rather than
user-creatable return tracks with their own hostable FX chain, a gap the roadmap already tracks
explicitly (`docs/product-roadmap.md` line 212, citing research 61).

**Load Instruments.** Opened the Browser (categorized Synth presets: Bass, Lead, Pad, Pluck, Keys,
etc., each with a preview button, "drag a preset... onto a track to apply it" per the panel's own
help text). First attempt: dragged the "bright-lead" preset onto the synth track's **clip/note lane**
(the large, obviously-track-associated area on the right) using a raw mouse-move drag — nothing
happened, no error, no toast, and `GET /document` confirmed the synth's params were untouched
defaults. Second attempt with a proper HTML5 drag simulation onto the same target: still nothing.
Reading `ArrangementView.tsx:793` explained why: the only real HTML5 drop target
(`data-drop-target="track-header"`, wired via `useDropTarget(LIBRARY_DND_MIME, handleLibraryDrop)`)
is the narrow **track header** column on the left (name/fader/pan), not the much larger clip lane. A
third attempt targeting the header succeeded instantly and silently — no confirmation toast, but
`GET /document` showed real values (`cutoff: 2000→5200`, `osc2Detune: 12→14`) and the mixer strip grew
new "RV"/"DI" send-active badges. **This is a real, high-impact discoverability gap**: the one visible
"drag it onto the track" surface most beginners would try first (the wide clip lane, matching the
tutorial's own phrasing "drag... directly into a MIDI track") is a silent no-op; the only working drop
target is a narrow strip most users wouldn't immediately associate with "the track" as a whole, and
there is zero feedback (success or failure) either way.

**Create MIDI Clips.** The note editor ("Piano Roll" equivalent) is already open by default in the
bottom panel once a track is selected — no double-click-to-open step is even needed, arguably better
than the tutorial's own workflow. Clicking empty grid cells added notes instantly (note count in the
header updated live: "0 notes" → "3 notes" → "4 notes" after a `Ctrl+A`-select-all incidentally added
one more), and the arrangement's mini clip preview updated in real time. This worked well end to end.

**Enable Scale Mode.** Selected all 4 notes (`Ctrl+A`) and opened the "PITCH & TIME" panel's "Fit to
Scale" control (root-note + scale-name dropdowns, currently C major). Clicking "Fit to Scale" gave
immediate textual feedback ("1 note changed") and visibly moved a note in the grid. This is a real,
working feature, but it is structurally different from what "Enable Scale Mode" means in the
tutorial: Ableton's Scale Mode is a **persistent toggle** that shades in-scale rows in the piano roll
*while you are drawing new notes*, so melodic mistakes are visually prevented as they happen. dotbeat's
version is a **one-shot corrective transform** applied after the fact to an existing selection — there
is no stored `scale` field on the clip/track and no live row-highlighting at all. This exactly matches
a gap the roadmap already names explicitly ("Scale-lock field + scale-tone highlighting (Scale Mode)"
— `docs/product-roadmap.md` line 61, citing research 57) — confirmed live here rather than merely
inferred from docs.

### Recording Audio

**Prepare Hardware** and **Capture Audio.** Grepped `ArrangementView.tsx` and `MixerView.tsx` for
"arm", "record", "monitoring" — no hits outside of unrelated code comments. There is no red Record
button, no track-arm control, no input-device selector, and no monitoring toggle anywhere in the GUI.
This is a confirmed, deliberately-scoped gap, not a bug: `ROADMAP.md` explicitly documents "Native
audio recording ❌ missing... gated behind the confirmed ~30ms web-audio latency wall — explicitly
Tauri/M4-native scope" and "the browser is fine for MIDI/synth, hits real walls on recorded audio."
Both of the tutorial's Recording Audio steps have **no dotbeat equivalent today**, by design.

### Exporting

**Save Project.** No explicit "Save" action exists anywhere (confirmed against the full Keyboard
Shortcuts reference panel — no Cmd/Ctrl+S listed), and none is needed: every edit is already synced
live to the on-disk `.beat` file through the daemon (verified — the file on disk contained the "synth"
track and its notes immediately, with no save step taken). Opened the "History" panel, which is
actually dotbeat's real, richer equivalent of "Save Project" — a git-native Version History pane with
"Save checkpoint" (prompts for an optional label, matching `beat checkpoint --label`) and "Pin"/"Go
back" per entry. Saved a labelled checkpoint ("first melody + bright-lead preset") and confirmed it
appeared in the list with a timestamp and short commit hash. This is a genuinely good, arguably
superior substitute for Ableton's manual save — worth calling out as a strength, not just a gap-filler.
"Collect All and Save" (Ableton's explicit media-bundling command for project portability) has no
direct GUI equivalent — no "collect all" button exists anywhere in the codebase — though dotbeat's
git-native single-file/single-folder project model addresses the same underlying goal (portability) by
a different, arguably simpler mechanism (the whole project + its `media/` folder is just files next to
each other, trivially copyable or git-clonable) rather than a dedicated command.

**Export Audio.** Clicked "Export" in the topbar. Reading `ExportButton.tsx` directly (Phase 20
Stream X) confirmed the exact mechanism: a single click renders the current loop/song through the
live Tone.js engine (`engine.play()` + `engine.recordWav(seconds)`), then auto-triggers a real browser
file download of a timestamped `dotbeat-export-<ISO>.wav` via a Blob-URL anchor click — no dialog,
no destination picker, no format choice beyond WAV (there is no MP3 export path in the CLI or the
GUI — confirmed by grepping `cli/render.mjs`), and no way to scope the export to an arbitrary
highlighted region. The tutorial's "Use the Loop Bracket to highlight your desired section" has no
counterpart at all: `renderSeconds()` in both `ExportButton.tsx` and `cli/render.mjs` computes render
length as "the full `song` timeline if one exists, otherwise exactly one loop pass" — there is no
in/out-point selection mechanism anywhere for export. Live UI feedback is minimal: the button reads
"Rendering…" during capture and flashes "Exported ✓" for only 2 seconds before reverting to "Export",
easy to miss.

### One non-obvious interaction

Right-clicked directly on a placed note in the piano roll (a natural thing to try, expecting a
context menu the way automation points get one — `docs/product-roadmap.md` line 272 documents a
per-point right-click popup for curve/hold/linear on automation breakpoints). Nothing happened at all
— no context menu, no browser default menu, no visible reaction. Not necessarily a bug (dotbeat may
simply not use context menus for notes, routing all note edits through the dedicated PITCH & TIME
toolbar instead), but worth noting as an inconsistency: the automation lane offers a right-click
popup elsewhere in the same app, so a user who discovers that convention there would reasonably
expect it to work on notes too.

## Findings summary

- **[missing-feature] No literal "Session View" clip-launching grid.** Confirmed as a deliberate,
  explicitly recorded scope decision (`docs/phase-19-plan.md`: "Out of scope, per owner direction"),
  not an oversight. dotbeat's single unified Arrangement timeline plus a track's always-live top-level
  content is a structurally different (and reasonable) substitute, but a beginner following this
  tutorial's "Toggle Between Views" step has nothing to toggle to.
- **[confusing] Instrument-preset drag-and-drop has a silent, narrow, undiscoverable drop target.**
  Dropping a Browser preset onto a synth track's wide clip/note lane — the most visually obvious "the
  track" surface, and the literal reading of the tutorial's "drag... directly into a MIDI track" — is
  a complete no-op with zero feedback. The only real drop target is the narrow track-header column
  (`ArrangementView.tsx:793`, `data-drop-target="track-header"`). No error, highlight-on-hover cue, or
  toast distinguishes a successful drop from a failed one either way — confirmed by cross-checking
  `GET /document` before/after both attempts.
- **[bug] "new project…" creates a file but never switches the running GUI to it, with no
  instructions for what to do next.** `window.prompt()`-based path entry (not a native save dialog)
  already reads as dated for a modern DAW GUI, but the bigger issue: after successfully creating the
  new project, the toast just says "Point a beat daemon at it to open it" — a CLI-flavored instruction
  a GUI-only beginner has no way to act on. Repro: click "new project…", accept the path prompt,
  observe the arrangement view is completely unchanged and the toast gives no GUI-actionable next step.
- **[missing-feature] No audio preferences panel at all** — no input/output device picker, no sample
  rate, no buffer size. Confirmed by exhaustive grep of `ui/src/components`. Consistent with dotbeat's
  current lack of any live-audio-recording capability (see below), but the tutorial calls this out as
  a standalone setup step independent of recording.
- **[missing-feature] No live/hardware audio recording (mic/instrument capture, track-arm, input
  select, Auto Monitoring).** Confirmed via source grep — no arm/record/monitoring concept exists in
  the GUI at all. This is an explicit, already-documented scope boundary (`ROADMAP.md`: native
  recording gated on the ~30ms web-audio latency wall, "explicitly Tauri/M4-native scope"), not a bug,
  but both of the tutorial's "Recording Audio" steps are simply unsupported today.
- **[missing-feature] "Enable Scale Mode" has no persistent, propagating equivalent** — only a
  one-shot "Fit to Scale" transform applied to an already-drawn selection after the fact, not a
  toggle that shades in-scale piano-roll rows while drawing. Matches an already-tracked roadmap gap
  (research 57) — confirmed live rather than just cited from docs.
- **[missing-feature] No user-creatable Return tracks** — only two fixed, non-editable reverb/delay
  buses. Already tracked (research 61).
- **[missing-feature] Export Audio has no partial-range ("Loop Bracket") selection and no MP3
  option** — always renders either exactly one full loop or the full song timeline, WAV only. Confirmed
  by reading `ExportButton.tsx` and `cli/render.mjs`'s shared `renderSeconds()` formula directly.
- **[missing-feature] No "Collect All and Save" media-bundling command** in the GUI — no button exists
  anywhere in the codebase. dotbeat's git-native single-folder project model addresses the same
  underlying goal differently, but a beginner literally following the tutorial's menu item will not
  find it.
- **[worked well] Insert Tracks, Create MIDI Clips, and the note editor being open by default** — all
  smooth, immediate, with live note-count feedback and no discoverability friction.
  "Adding Content"'s core creative loop (add a track, draw notes) is genuinely easier in dotbeat than
  the tutorial's own multi-step Ableton instructions (no separate "double-click to open Piano Roll"
  step needed).
- **[worked well] Version History / "Save checkpoint"** is a strong, arguably superior substitute for
  Ableton's manual "Save Project" — live auto-persistence to the `.beat` file with zero explicit save
  step required, plus an optional-label, git-backed checkpoint/restore system that Ableton's own save
  model doesn't offer.
- **[worked well] Mixer and Browser overlay panels** are clean, immediately usable substitutes for the
  parts of "Interface Navigation" that do have a dotbeat equivalent.
- **[confusing] Right-click on a note does nothing**, while the automation lane elsewhere in the same
  app offers a right-click popup for its own points — a minor internal inconsistency in an otherwise
  reasonable "no context menus for notes" design choice.

## Where the pilot gave up on the "ideal" workflow

Two tutorial steps had no dotbeat workaround to fall back on at all and were logged as confirmed
missing features rather than worked around: **Configure Audio Preferences** (no settings surface
exists to attempt) and both **Recording Audio** steps, **Prepare Hardware** and **Capture Audio** (no
arm/record/input/monitoring concept exists anywhere in the GUI to even partially exercise). Everything
else in the tutorial had at least a real, working dotbeat equivalent that was actually exercised live
end-to-end (new project, browser instrument loading once the correct drop target was found, note
drawing, Fit to Scale, checkpoint save, WAV export).

## Could a total beginner coming from this tutorial actually complete it in dotbeat?

**Partial.** The creative core of the tutorial — insert a track, load an instrument sound, draw a MIDI
melody, save your work — is fully reachable in dotbeat and in some respects (auto-persistence, version
history, no double-click-to-open-piano-roll step) is smoother than the Ableton workflow the tutorial
describes. But a beginner following this specific tutorial's literal steps would hit real, unresolved
walls at three points: (1) "Launch & Explore Demo" has nothing to explore — no bundled demo project
and no way in a plain browser to load one of dotbeat's own example projects; (2) "Configure Audio
Preferences" and the entire "Recording Audio" section are simply not possible — no settings panel, no
record/arm mechanism exists at all; (3) even within "Adding Content," the very first natural drag
gesture a beginner would try (dropping an instrument preset onto the wide, obviously-track-associated
clip lane) silently fails with zero feedback, and only the much narrower track-header column actually
works — a beginner with no prior dotbeat exposure would very plausibly conclude "drag and drop is
broken" and give up on that step rather than discover the real target through trial and error. A
beginner who pushed past that one silent failure (or was told the ProTip to drop onto the track name/
fader area specifically) could complete every step of the tutorial that has any dotbeat equivalent,
but as written, this tutorial does not fully transfer without a knowledgeable guide filling in three
real gaps.

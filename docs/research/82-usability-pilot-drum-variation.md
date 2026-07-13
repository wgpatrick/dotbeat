# Usability Pilot 82: Drum Groove with Variation Across a Song Structure

## Intro

The goal was to build a drum groove for a song that "feels alive" across its length rather than
looping one clip unchanged forever: create a drums track, author a base 1-bar kick/snare/hat
groove as a clip, hand-build two clearly-related variations (a busier/fill version and a sparser
version), then arrange all three across a 4-section song structure (verse/verse/chorus/outro) and
confirm by playback that the sections actually differ. This is an exploratory GUI usability pass
against a real running dotbeat instance (daemon + Vite dev server + Playwright-driven Chromium),
not a scripted verify test.

## Narrative walkthrough (condensed, in order)

**Setup.** `beat init` created `song.beat` (120bpm, starter "lead" track) instantly. Daemon and
Vite came up clean on dedicated ports. First page load at `?daw=9401` showed a well-organized DAW
layout — Play/Undo/Redo/BPM/Loop/Position transport, a green "daemon" connection light, and a
bottom "Clip" editor already showing the "lead" track's empty note grid. Good first impression:
nothing to guess about whether the GUI was talking to my daemon.

**Adding the drums track.** Clicked "+ track" → a dropdown appeared (Synth/Drums/Instrument/Audio).
My first `getByText('Drums', {exact:true})` locator timed out — turned out to be a coordinate-space
issue on my end (the screenshot is 2x device-pixel-ratio, page coordinates are in CSS px), not a
product bug. Once I converted correctly, clicking "Drums" worked immediately and added a track with
12 sensible drum lanes (kick, snare, rimshot, clap, hat, openhat, tom_lo/mid/hi, crash, ride,
cowbell) and a helpful "selection: drums" bar appeared up top with **"≈ vary hats"** and
**"≈ vary feel"** buttons — exactly the kind of built-in "vary" tooling the task asked me to look
for and try.

**Building the base pattern (the hard part).** The drum step grid is a small, dense, canvas-rendered
widget (`14px/step`, 12 rows × 32 steps for a 2-bar clip) with *no DOM hooks at all* — I could
locate ordinary buttons via `getBoundingClientRect()` reliably, but the grid cells themselves are
pure canvas pixels. Placing hits required blind pixel-coordinate calibration (crop-and-zoom
screenshots with Pillow to read row/column positions), and even after calibrating, coordinates
**drifted between turns** whenever the page's vertical layout changed height (e.g. a banner
appearing/disappearing above the clip editor, or the "clip properties" row expanding once a scene
existed). I mis-clicked into neighboring rows or the transport/ruler several times as a direct
result. A real human clicking interactively, watching the cursor land, would not hit this exact
failure mode — but it does point at a real gap: **there is no numeric feedback (e.g. a step number
in a tooltip) while placing a drum hit**, so even a human has no way to confirm "that's step 8, not
step 9" except by re-reading the compact ASCII-grid via `beat inspect` or squinting at pixel
spacing.

**A real, reproducible bug: rapid grid edits lose earlier hits.** While building the base groove I
fired off ~24 grid clicks in quick succession (300–400ms apart) via the automation. Screenshots
after *every single click* showed the dot accumulating correctly in the UI. But when I checked the
daemon's actual document state (`GET /doc` and `beat inspect`) afterward, **only 4 of the ~24 hits
had actually persisted** — the rest were silently lost. I confirmed this is a genuine
race/lost-update bug, not a fluke: I re-tested by placing 3 hits on the `clap` lane with 1.5s
between clicks, and all 3 persisted correctly; with rapid-fire clicks, edits are lost. This smells
like a classic optimistic-update race — each grid edit likely computes its patch against a
possibly-stale local copy of the pattern and overwrites the daemon's actual current state rather
than merging, so a fast burst of edits can clobber each other. A real user clicking at a brisk
but human pace (rhythmically tapping out a beat, which is exactly what a musician does) could
plausibly trigger this. I worked around it for the rest of the session by pacing GUI clicks ≥1.1s
apart, and used the `beat` CLI directly (same daemon, same file) for later bulk pattern edits once
I understood the grid well enough — a deliberate fallback I'm flagging as a "gave up on the ideal
GUI-only workflow" moment.

**The scene/clip model — confusing at first, then genuinely well-designed.** I tried "Place in
Arrangement" on my finished base clip and got a **native JS `alert()` dialog**: *"Add a song section
first ('+ section') — clips only play once slotted into a song-mode scene."* That's a good,
actionable error message once you see it, but Playwright's default dialog handling auto-dismissed
it and crashed my driver — worth noting for anyone else automating this GUI. Clicking "+ section"
switched the whole app from "Arrangement/Loop" mode into "Song" mode, auto-created a scene "s1" from
my current clip, and placed it. From there I spent a long time trying to figure out how to point
the editor at a *different* section's clip content — clicking directly on a section's block in the
timeline, double-clicking it, right-clicking for a context menu — none of it retargeted the bottom
Clip editor away from "clip s1". Eventually I inspected the raw `.beat` file directly and it
clarified everything: **there is a single "staging" pattern per track (the one the grid always
edits) plus separate named `clip s1`/`clip s2`/... snapshots.** "+ capture scene" snapshots
*whatever is currently in the staging pattern* into a brand-new named clip/section; "+ section"
just duplicates the *last* section's scene. So the correct workflow is: edit staging → "+ capture
scene" → repeat. Once I understood this, building the busy and sparse variants was fast and
reliable (via the CLI, given the grid's earlier fragility) and each did create a genuinely distinct
scene (`s3` with 15 hits, `s4` with 8 hits) confirmed via `beat inspect`.

**Reordering/deleting sections.** Discovered by trial that each section gets its own inline
mini-toolbar (⠿ drag handle, `s1 ◀ ▶ − 2 + ✕ ↻`) positioned directly in the ruler above its bars.
The `◀`/`▶` arrows swap that section with its neighbor (confirmed: clicking `▶` on section 3
swapped it with section 4 in the song order) — a real, working reorder primitive, just not
labeled or discoverable without testing. The `✕` deletes a section outright. Using these I trimmed
a redundant duplicate down to a clean 4-section arrangement.

**The vary tool.** "≈ vary hats" opened a proper audition UI: *"hats on drums · variant 1 of 9 ·
hatTone 5030.4883, hatDecay 0.0585 · ◀ Prev / Next ▶ / Keep / Undo"*. This is genuinely useful
tooling — but it varies **synth timbre parameters** (tone/decay of the hat voice), not the
rhythmic pattern. I had assumed from the task framing that "vary" would produce a rhythmic
variant (add/remove hits); it does not. Worth knowing: it's a sound-design tool, not a
pattern-generation tool, and the button label doesn't make that distinction clear upfront.

**Daemon crashed mid-session with no log output.** At one point the connection indicator silently
flipped from green "● daemon" to "○ offline" — the daemon process had died with **zero error
output** in its log file (just the startup banner, then nothing). I confirmed via `ps`/`curl` it
was genuinely gone, not a network blip. Restarting it on the same port let the GUI **auto-reconnect
within a few seconds** without a page reload, which is a nice resilience property, but the silent
crash itself (no stack trace, no exit reason logged anywhere) is a real gap for debuggability.

**Final structure and playback.** Ended with a clean 8-bar, 4-section song: `s1` (base groove,
"verse") → `s2` (identical repeat) → `s3` (busy: added crash accent on beat 1, a soft ghost snare,
and swapped the last closed hat for an open-hat lift — 15 hits vs 12, "chorus") → `s4` (sparse:
kick+snare+quarter-note hats only, no extras — 8 hits, "outro"). Pressing Play moved the playhead
convincingly through all four sections and looped back to the top. Because this is a headless/CDP
automation context (no real audio device), the transport clock ran far faster than real time (8
bars advanced in ~2 seconds at 120bpm, which should take ~16s) and the small waveform/scope widget
next to the daemon indicator showed a flat line during playback — I could not verify actual audio
output "by ear." I instead relied on `beat inspect`/`GET /doc` as ground truth that the three
clips' hit-lists are genuinely different (12 vs 15 vs 8 hits, with clearly distinguishable
lane content), which is the more reliable confirmation method anyway per this project's own
"render→metrics→critique" philosophy.

## Findings summary

- **[bug] Rapid successive drum-grid edits silently lose earlier hits.** Clicking to add grid
  hits ~300-400ms apart resulted in only ~4 of ~24 placed hits actually persisting to the
  daemon/file, even though every intermediate screenshot showed the UI rendering all of them
  correctly. Spacing clicks ≥1.1-1.5s apart fixed it reliably (verified with a controlled 3-hit
  test). Looks like an optimistic-update race where a fast burst of edits computes patches
  against a stale base state and overwrites rather than merges. Real users tapping out a beat at a
  natural rhythmic pace could plausibly hit this.
- **[bug] The dotbeat daemon crashed mid-session with zero log output** — no error, no stack
  trace, just silence after the startup banner, confirmed dead via `ps`/`curl`. The GUI correctly
  detected the drop (green→"○ offline") and **auto-reconnected within seconds** once the daemon
  was restarted on the same port, which is good resilience, but the crash itself is currently
  undebuggable from the log alone.
- **[confusing] The clip/scene/section model is not discoverable from the GUI alone.** There is a
  hidden but important distinction between (a) a track's single "staging" pattern (what the grid
  always edits), (b) named clip snapshots (`clip s1`, `clip s2`, ...), and (c) song sections that
  reference a scene bundling one clip per track. "+ section" duplicates the *last* scene;
  "+ capture scene" snapshots the *current staging pattern* into a genuinely new scene. Neither
  clicking, double-clicking, nor right-clicking an existing section's block in the timeline
  retargets the bottom editor to that section's own clip content — I never found a way to resume
  editing an already-placed scene's pattern except by re-deriving it from the raw `.beat` file.
  This cost the most time in the whole session.
- **[confusing] "≈ vary hats" / "≈ vary feel" vary synth timbre, not the rhythmic pattern.** The
  button reads like it might vary *which steps are hit*; it actually opens a 9-variant browser for
  timbral synth params (`hatTone`, `hatDecay`, etc.) with Prev/Next/Keep/Undo. Genuinely useful,
  just a different kind of "variation" than the task (and I suspect many users) would first guess
  from the label.
- **[slow-to-discover] Per-section reorder/delete controls exist but are unlabeled.** Each song
  section gets its own small inline toolbar (drag handle, ◀/▶ to swap position with a neighbor,
  −/+ for bar count, ✕ to delete, ↻ for something I didn't test) directly in the arrangement ruler
  above its bars. None of these are labeled beyond a single glyph, and the ◀/▶ reorder behavior
  (confirmed by testing) isn't hinted at anywhere in the visible UI text.
- **[confusing] Native `alert()`/`confirm()` dialogs are used for at least one real error path**
  ("Add a song section first..."), which is easy to lose track of in any automated/scripted
  context (Playwright's default dialog auto-dismiss silently discarded it and crashed my driver
  the first time). A real human wouldn't lose the message, but it's a jarring, un-styled
  interruption in an otherwise polished dark-themed GUI.
- **[worked well] Track creation, drum lane defaults, and BPM/transport UI** were immediately
  clear with no trial and error — sensible defaults (12 pre-named drum lanes with plausible synth
  voicings), a visible daemon-connection light, and musical-edit-list-style feedback everywhere
  (`beat inspect`/CLI output matched what the GUI showed at every checkpoint I cross-verified).
- **[worked well] Daemon reconnection after an unexpected crash was seamless** — the GUI noticed
  the drop, showed it honestly ("○ offline"), and picked the live connection back up automatically
  once the daemon came back, no page reload needed.
- **[worked well] Once understood, the capture-scene workflow is genuinely good for exactly this
  task.** Edit the staging pattern into a new variant, hit "+ capture scene," and you get a
  cleanly separated, independently-editable clip slotted into the song — which is precisely the
  "base groove + hand-edited variations across song sections" workflow this pilot set out to
  test. The friction was entirely in *discovering* the model, not in the model itself.

## Where I gave up on the "ideal" workflow

- **Bulk drum-hit placement**: after confirming the canvas grid has no DOM hooks and that rapid
  clicks lose data, I switched to using the `beat` CLI directly (same daemon, same `.beat` file)
  for the busier/sparser variant edits, rather than continuing to fight pixel-perfect GUI clicks
  paced a second-plus apart. This is a legitimate power-user path the project explicitly supports
  (CLI and GUI both write to the same live document), but it means the GUI-only path for
  precision drum programming is currently slow and error-prone for anything beyond a few hits.
- **Editing an already-placed section's clip** ("go back and tweak the chorus after the fact"): I
  could not find a GUI affordance for this at all in the time available and fell back to
  understanding/editing via the raw file format instead. If this exists, it is not discoverable
  from labels, tooltips, or obvious interactions (click/double-click/right-click all tried).
- **Listening confirmation**: the task asked to confirm variation "by ear." In this headless
  Playwright/CDP environment there was no real audio device, the transport clock ran unrealistically
  fast, and the on-screen scope stayed flat during playback, so I substituted `beat inspect`/`GET
  /doc` ground-truth comparison of the three clips' hit-lists (12 vs 15 vs 8 hits, with clearly
  different lane content) as the verification method instead.

## Key files/state referenced

- Scratch project (deleted at end of session): `/tmp/dotbeat-usability-82-drum-variation/song.beat`
- Daemon/CLI: `/Users/willpatrick/Documents/dotbeat/dotbeat/cli/beat.mjs`
- GUI dev server: `/Users/willpatrick/Documents/dotbeat/dotbeat/ui` (Vite, port 9402 for this run)

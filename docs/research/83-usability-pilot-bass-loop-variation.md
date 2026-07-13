# 83 — Usability pilot: bass loop + 4-bar variation clip

**What I set out to build:** a new scratch project with a bass track, a factory bass preset applied
via the content Browser, a 1-bar root-heavy bassline authored by hand in the piano roll, that
1-bar loop repeating for 6 bars in the arrangement, and then a second, new 4-bar clip where each
bar is a variant of the original motif (octave jump, eighth-note fill, ascending turnaround),
placed in the arrangement right after the repeated section. This is a think-aloud pilot, not a
scripted test — no prior checklist of exact clicks, just the goal and the real running app
(dotbeat GUI at `ui/`, driven with a real Chromium instance against a live `beat daemon`).

Full narrative log kept turn-by-turn below; jump to **Findings summary** for the bulleted list, and
to **Crux: repeating a clip (step 5)** / **Crux: the 4-bar variant clip (steps 6–7)** for the two
things this pilot was really testing.

## Narrative walkthrough

**Setup.** `beat init` + `beat daemon --port 9403` + `vite --port 9404` all started cleanly. Opened
`http://localhost:9404/?daw=9403` and the GUI connected to the daemon immediately (green "daemon"
indicator, top right) — no friction here at all.

**Creating the bass track.** The starter project already has one "lead" synth track from `beat
init`. Clicked **+ track** → a dropdown appeared with `Synth / Drums / Instrument / Audio`.
Reasonable, unambiguous. Picked **Synth**, got a track literally named "synth". Renamed it to
"bass" via double-click on the track row's name — this worked, but only when I clicked the actual
row label in the track list (`.arr-track-name`); there's *also* a text string reading "selection:
synth" in the top-left status strip that's easy to confuse it with visually, though a mouse-driving
human wouldn't have my selector-precision problem here. One real, small thing: **after the rename,
that top-left "selection: synth" hint never updated** — it kept showing the pre-rename track name
for the rest of the session. Cosmetic, but a permanently-stale label in the corner of the screen is
the kind of thing that erodes trust in the UI over a longer session.

**Applying a factory bass preset.** Clicked **Browser** in the top bar — instead I hit **Export**
(both are `.topbar-btn` siblings; my own automation selector was too loose, not a real ambiguity a
sighted user would hit, since the labels are perfectly legible side by side). Once I targeted the
right button, the content Browser opened on the left showing `Presets — Synth` grouped by
category: BASS (acid-bass, deep-sub-bass, fm-bass, reese-bass, sub-sine-bass, wobble-bass), LEAD,
PAD, PLUCK, KEYS, etc. Good taxonomy, good names.

Here's where I got genuinely stuck as a first-time user would: **I clicked "reese-bass" in the
list, expecting it to apply to my selected "bass" track.** Nothing happened — the row just got a
highlighted background in the list. I tried double-click. Still nothing applied (verified against
the daemon's live document, not just visually: the track's synth params were untouched). I tried a
drag from the list entry onto the track's arrangement row — no drop-target highlighting, no effect.
The actual apply path turned out to be the **Device tab's own `PRESET` dropdown** on the track
(`bass → Device`), which already had a *different* default preset ("deep-sub-bass") loaded and
showed a clear green **"applied "..."" confirmation** once changed. So: **the content Browser lets
you *look at* presets and preview/audition them, but the thing that actually loads a preset onto a
track lives somewhere else entirely**, with no visible link between the two. This is the single
most surprising gap in the whole session relative to how every other sample-library/synth browser
I've used behaves (click or drag from a browser onto a track = load it).

**Authoring the 1-bar loop.** Set `LOOP LENGTH` down to 1 bar (from the project-init default of 2),
selected the bass track, opened its `Clip` tab (piano roll). Clicked to place notes; the app's
default note length is an eighth (2 sixteenth-steps), extendable in single-step increments with
`Shift+→` — worked exactly as documented in the on-screen hint bar. Built: **A2(quarter) · A2(8th)
· C3(8th) · E3(quarter) · C3(8th) · A2(8th)** — root-heavy, two passing tones (C3, a minor third;
E3, the fifth), classic simple bass phrase. One real, repeatable behavior worth flagging: **every
time a note is added, the piano roll's vertical scroll position silently re-centers** (it visibly
jumped between C2–C6, then C3–C7, then C4–C8-ish windows across my first six clicks, apparently
re-framing around the note range added so far). For a mouse-driving human clicking by eye rather
than computed pixel coordinates, this means **the note you're about to click next may not be where
you expect it after the previous click landed**, especially near the edges of the visible range.
It never broke anything, but it's a real "wait, did the view just move?" moment repeated several
times per phrase.

**Placing the clip in the arrangement — first snag.** Clicked the note editor's **"Place in
Arrangement"** button. Nothing visibly changed, and — checked directly against the daemon's
document — `song` stayed `null` and `scenes` stayed `[]`. The button was fully enabled and
clickable throughout; it just silently did nothing, because the project was still in loop mode with
no song section for it to target yet (its own tooltip does say "the first song section's scene",
but there's no section at all when you're in loop mode — the button doesn't disable itself or
explain that). I only found the real next step by trial: the toolbar's **"+ section"** button
("split into arrangement sections, keeps this loop as the first section") converts the project into
song mode *and*, as a side effect, auto-placed my already-live loop content into that first
section's scene (`s1`) — after which "Place in Arrangement" correctly showed **"Placed (clip
"s1") — update."** So the two-step "convert to song mode, then place" isn't obvious up front, but
once you've done it once, it makes sense in hindsight.

**Repeating the loop across bars (step 5) — worked well once found.** See the dedicated section
below; short version: each section has its own bar-length stepper, and growing it visibly **tiles**
the section's 1-bar clip to fill the wider span. Grew `s1` from 1→6 bars this way; the arrangement
row visibly repeated the same 6-note pattern six times.

**Building the second, 4-bar variant clip (steps 6–7) — the hard part.** See the dedicated section
below. Short version: there is no GUI path to make a *single* clip's own note-editing canvas wider
than 1 bar, nor any way to point the piano roll at a *different*, already-created scene's clip once
a track has more than one. The only way through was "**+ capture scene**", which snapshots
whatever's currently live on the track into a brand-new, independent scene appended as a new
1-bar section — used four times in a row (editing the live buffer between each capture) to build
bar1 (the original motif again), bar2 (octave-jump ending), bar3 (an 8-note ascending/descending
eighth-note fill), and bar4 (an ascending-quarter-note turnaround: A2→C3→E3→A3). The result is a
musically convincing 4-bar evolving phrase and it *is* a clean solution — but it is four separate
1-bar scenes chained as four consecutive sections, not one 4-bar clip object, because dotbeat's
data model doesn't appear to have the latter reachable from the GUI at all.

**One interaction-model surprise along the way:** after marquee-selecting all 6 notes of the
original loop (to try copy/paste-based extension before finding the capture-scene route), a plain
click directly on a single note did **not** narrow the selection back down to just that note — all
6 stayed selected. I had to click an empty grid cell first (to deselect everything), then click the
one note I wanted, to get a single-note selection. Every other note editor I've used treats a plain
click on an unselected-context item as "select just this one."

**Cleanup encountered along the way:** deleting an empty, unused song section (I'd created one
speculatively with "+ insert scene" and then abandoned it) removed it from the visible timeline,
but `beat inspect` afterward still showed the underlying empty scene object lingering in the
document's scene list. Harmless clutter, but real.

**Final sanity check (step 8).** Hit Play on the full 10-bar arrangement (6 bars looped groove + 4
bars of variants). Transport ran cleanly start to finish with visible waveform activity in the
meter and a moving playhead across every section; no console-visible crash, no stall. The
arrangement's per-track clip thumbnails visually matched what was authored: the repeated 6-bar
block shows the same tiny 6-note shape six times, and the four trailing 1-bar blocks show four
visually distinct shapes (level, level-with-a-jump, an arch, and a rising staircase) — a genuinely
satisfying "yes, that's what I built" moment glancing at the arrangement view alone.

## Crux: repeating a clip across 4–8 bars (step 5)

This worked well, and better than I expected once I found the right control. Concretely:

- Every song **section** in the arrangement bar has its own tiny `− N +` bar-length stepper next
  to its scene name (`s1  ◀ − 6 + ✕ ⟲`).
- Clicking `+` doesn't stretch or resample the clip — it **tiles the section's scene at its native
  length to fill the new, wider span**. Confirmed both visually (the arrangement row literally
  redraws the same 6-note shape once per bar) and against the daemon's document (`song: [{sceneId:
  "s1", bars: 6}]` — one song entry, `bars` alone controls the repeat count; the underlying scene's
  note data is untouched and still exactly 1 bar's worth).
- This is *exactly* one of the interpretations the task brief anticipated ("a loop-length control")
  and it's the most discoverable, least error-prone of the mechanisms I found in this session. Two
  clicks (`−`/`+`) go from 1 bar to any bar count; no dialogs, no separate "loop settings" panel.
- The alternative mechanism — clicking **"+ section"** repeatedly to append N *separate* sections —
  also works and produces the same audible result, but does it by giving every appended section the
  **same shared `sceneId`** as the one being duplicated (confirmed: two `song` entries both reading
  `{sceneId: "s1", ...}`, and only one scene object named `s1` in `scenes[]`). That's a sharp edge
  worth knowing about explicitly: if you later edit one of those "repeats" expecting it to become a
  one-off variation, you're silently editing *every* section that shares that scene id, including
  ones you don't currently have on screen. It's fine — even correct — for pure repetition, but a
  user reaching for "duplicate this bar so I can then tweak just the copy" would be surprised.

## Crux: the 4-bar variant clip built from 4 varying 1-bar phrases (steps 6–7)

This is where the pilot found real friction, and it's worth walking through what I tried and ruled
out before landing on a working (if architecturally surprising) answer.

**What I expected**, coming from conventional piano-roll DAWs: drag the clip's right edge to make
it 4 bars long, or find a "clip length" field, and then just keep composing rightward into bars 2–4
in the same continuous grid.

**What actually exists, and what I tried:**

1. The note editor's own grid is hard-capped at exactly the length of whatever scene/clip it's
   currently bound to — 1 bar, in every state I reached. Clicking or double-clicking in the
   (visually empty, unstyled) canvas area to the right of that boundary does nothing; it isn't a
   click target at all.
2. There's a **clip-properties strip** under the note editor header (`clip "s1"  loop [off]–[off]
   bars   sig 4/4`) that looks at first glance like it might set clip length. It doesn't — per its
   own tooltip, `loop` is "a clip-local loop range... overrides the section length just for this
   clip when set," i.e. it's for making a clip *shorter* than its section and looping the remainder,
   not for making the clip itself longer.
3. Setting the document's global `loop_bars` field to 4 via the CLI (`beat set ... loop_bars 4`)
   changes the file, but the **running daemon's live in-memory document doesn't pick it up** — the
   piano roll stayed 1 bar wide. (Aside: this also means CLI edits made to the `.beat` file while a
   daemon has the project open can silently be overwritten by the daemon's own next save, since the
   daemon does not appear to hot-reload external file changes. Worth knowing if you ever mix CLI
   and GUI edits against the same live session — no attempt was made to explore this further since
   it's outside this pilot's scope, but it's a real trap.)
4. Once in song mode with a second, independent scene inserted via **"+ insert scene"**, I could
   not find any way to point the piano roll at *that* scene instead of the first one. The note
   editor's clip binding ("bass — clip 's1'") is sticky: neither clicking into the new section's
   (empty) track row in the arrangement, nor moving the playhead into that section's bar range, nor
   clicking the "clip 's1'" label itself (no dropdown/menu appears) changed which clip the piano
   roll was editing. The **"Place in Arrangement" button is hard-bound to whichever scene the
   track's content was first placed into** — its own button label literally says `Placed (clip
   "s1") — update`, and clicking it always re-saves into `s1`, regardless of playhead or which
   section is visually "selected" in the arrangement.
5. The mechanism that *did* work: **"+ capture scene"** — "snapshot every track's current live
   content into a new, independent scene, inserted as a new section at the end of the song." Since
   the piano roll always edits the track's *live* note buffer (which starts out mirroring `s1`'s
   content), I could edit that live buffer freely, click "+ capture scene" to freeze it into a
   brand-new independent scene + section, then edit the live buffer again for the next bar, capture
   again, and so on. Four capture cycles produced four independent 1-bar scenes (`s3`, `s4`, `s5`,
   `s6` in the final document — `s2` is an orphaned empty scene left over from an abandoned
   experiment, see Findings) chained as four consecutive 1-bar sections.

**The upshot:** dotbeat does not appear to have a "multi-bar clip" as a single authorable object
reachable from the GUI — the atomic unit is a 1-bar (or, more precisely, "whatever `loop_bars` was
at capture time") scene, and a longer musical idea is built by *chaining* scenes as sections, not by
widening one clip. That's a legitimate, even elegant, compositional model (it's essentially
pattern-chaining, like a tracker) — but it is *not* how the GUI's own note editor presents itself
(a single continuous piano roll with a clip name in the header strongly implies "this is the one
canvas for this musical idea"), and there is no in-app hint anywhere that says "to go past 1 bar,
capture repeatedly into new scenes instead." A first-time user chasing "make my clip 4 bars" will,
like I did, spend real time trying to resize/extend a single clip before discovering the
capture-and-chain pattern.

The musical result, once built this way, is genuinely good and exactly matches the brief: bar 1
reprises the motif (A2·A2·C3·E3·C3·A2), bar 2 is the same shape but the last note jumps an octave
to A3, bar 3 is an 8-note arch fill (A2·C3·E3·G3·A3·G3·E3·C3), and bar 4 is an ascending-quarters
turnaround (A2·C3·E3·A3) that lands on the high A3 as a clear "section change" cue. Placed
immediately after the repeated 6-bar section, it reads on the arrangement timeline exactly like a
fill/turnaround before a new song section, which was the goal.

## Findings summary

- **[confusing] Content Browser presets don't apply on click/double-click/drag** — clicking (or
  double-clicking) a preset name in the Browser only highlights it in that list; the real "load
  this onto my track" control is the separate `PRESET` dropdown in the track's `Device` tab, with
  no visible affordance connecting the two panels. This is the single biggest first-instinct
  mismatch in the whole session for a task this common (browse → apply a preset).
- **[bug] "Place in Arrangement" silently no-ops outside song mode** — fully enabled, clickable,
  gives no error/toast/disabled-state, but does nothing (verified against the live document: `song`
  stayed `null`) until the project is first converted to song mode via "+ section". A disabled
  state or inline hint ("convert to song mode first") would save real confusion.
- **[confusing]/[slow-to-discover] No GUI path to widen a clip past 1 bar, and no way to re-target
  the note editor at a different scene's clip** — the crux blocker for building the 4-bar variant
  clip (steps 6–7 above). The working alternative ("+ capture scene", repeated, chaining 1-bar
  scenes as sections) is not hinted at anywhere in the note editor's own UI copy.
- **[confusing] "+ section" duplicates by *sharing* the scene id, not copying it** — correct and
  useful for step 5's repetition, but a real trap if a user's intent was "give me an independent
  copy to then tweak" (editing one shared-scene section silently edits every other section
  referencing that same scene). No visual indicator in the arrangement distinguishes
  "these bars share a scene" from "these bars are independent."
- **[confusing] Selection is sticky in the piano roll** — after a multi-note (marquee) selection,
  a plain click directly on one already-selected note does not narrow the selection to just that
  note; an empty-cell click is needed first to deselect everything before a single note can be
  targeted.
- **[confusing] Piano roll auto-re-centers vertically after every note add** — the visible pitch
  window silently shifts (observed moving from a C2–C6 window to other 4-octave windows) each time
  a note lands, which can put the next intended click position somewhere unexpected relative to
  where the user is still looking.
- **[confusing, minor] Deleting a song section leaves its underlying scene object orphaned** in the
  document (`scenes[]` still listed an empty, unreferenced scene after its only section was
  deleted) — harmless but real accumulating clutter.
- **[confusing, minor] Track-rename doesn't propagate to the top-left status strip** — after
  renaming "synth" → "bass", the "selection: synth" / vary-scope hint text kept the old name for
  the rest of the session.
- **[worked well] Repeating a 1-bar loop across N bars via each section's own `− N +` bar-length
  stepper** — clean, immediate, and exactly matches the task's own "loop-length control"
  interpretation; the best-designed single control found in this session.
- **[worked well] "+ section" auto-converting loop mode → song mode** and carrying the current live
  loop content into the new first section's scene as a side effect — sensible default, saved a step.
- **[worked well] Track creation flow** (`+ track` → type picker → rename via double-click) — fast,
  unambiguous, no surprises.
- **[worked well] Note authoring primitives** — click-to-add, `Shift+←/→` to resize by one grid
  step, double-click to delete: all worked exactly as the note editor's own on-screen hint bar
  describes, no discovery cost once you've read that one line of text.
- **[worked well] Preset apply confirmation** — once the correct control (Device tab dropdown) was
  used, applying "reese-bass" gave immediate, unambiguous green "applied "reese-bass"" feedback.
- **[worked well] Final playback sanity check** — the full 10-bar arrangement (6-bar repeated loop
  + 4-bar variant clip) played back without any crash or stall, with the arrangement's per-section
  clip thumbnails visibly matching the four distinct authored shapes at a glance.

## Cleanup

Daemon, vite dev server, and the temporary Playwright-driver process used to interact with the GUI
were all killed; the scratch project directory was removed. The only change in the dotbeat repo
from this pilot is this report file.

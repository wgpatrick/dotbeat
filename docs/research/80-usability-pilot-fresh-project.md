# 80 — Usability pilot: building a drum + bass groove from a brand-new project

*2026-07-12. Exploratory usability session (not a verify script — no checklist, no pass/fail
assertions). Built the app (`npm run build` at repo root + `ui/`), created a fresh project with
`beat init /tmp/dotbeat-usability-fresh/song.beat --bpm 120` (not the owner's own
`examples/night-shift-song.beat`), ran a real `beat daemon` on :9301 and `vite preview` on :9302,
and drove the actual running app with Playwright (`connectOverCDP` against a long-lived headless
Chrome so each step could be screenshotted and read individually, not executed as one blind
script) the way a brand-new user — familiar with DAWs generally, unfamiliar with dotbeat — would:
add tracks via the GUI, click notes/hits into grids, browse presets, open the mixer, hit Play, and
try to tell whether any of it actually worked. Every GUI edit went through real mouse clicks
against the live app; the `.beat` file and a final WAV export were read afterward only to verify
ground truth against what the screen showed, per dotbeat's own "trust the file, not the vibe"
philosophy.*

## Walkthrough

**First load.** `beat init` does not produce an empty project — it seeds one starter "lead" synth
track with a clip already placed across the full 2-bar loop. The app opens straight into a split
view: the Arrangement timeline on top, that track's (empty) piano-roll Clip editor already open on
the bottom. That's a good default for onboarding — there's instantly something to click into,
rather than a blank canvas with no track and no obvious first action. The UI leans hard on dense,
small gray inline hint text instead of a tutorial overlay: the Arrangement header spells out "drag
the ruler or a track to select bars · click a track name to select it · double-click a name to
rename" and the Clip editor spells out a full paragraph of interaction hints (marquee-select,
freehand placement, chance-lane painting, ratchets, copy/paste at the playhead). It's genuinely
comprehensive — more complete than most DAWs' onscreen help — but it's all delivered at once, in
low-visual-hierarchy gray text, including jargon ("ratchet", "chance<100") a first-time user has
no context for yet. Nobody is going to read all of it before their first click, and they don't
have to (the actionable part — "click empty grid to add" — is right there), but it's a wall.

**The topbar scope.** Next to the green "daemon" connection-status dot sits an unlabeled black bar.
It turned out to be a real `<canvas class="scope-canvas">` — a live master-output oscilloscope,
clickable to toggle waveform/spectrum — which is a genuinely useful "is anything actually
happening" indicator for a browser-based DAW. But at a glance it reads as decoration or a loading
bar; its only affordance is a hover tooltip. Confirmed later that it does animate with real
waveform motion during playback (see below), which makes it a legitimately good feature let down by
zero discoverability.

**Adding tracks.** "+ track" produces a clean instant dropdown: Synth / Drums / Instrument / Audio
(the latter two rendered dimmer, presumably gated behind having a soundfont/sample registered —
did not chase further). This is exactly the mental model an Ableton-familiar user brings in. Picking
"Drums" instantly added a "drums" track with its own full-width placed clip, auto-switched the
bottom panel to that track's drum-lane editor (color-coded teal to match the new track, vs. red for
"lead" — nice, consistent per-track coloring throughout: header dot, clip border, panel title bar,
all match), and surfaced a new top-of-page "selection: drums" bar with quick-action chips ("≈ vary
hats", "≈ vary feel") that map straight onto the CLI's `beat vary` machinery. Those quick actions
appearing before a single hit had been placed felt slightly premature ("vary" implies existing
content) but is a minor nit. The drum editor listed "Lanes (12) · open": kick, snare, rimshot, clap,
hat, openhat, tom_lo/mid/hi, crash, ride, cowbell, each tagged with its synthesis engine
(`synth:membrane`, `synth:noise`, `synth:metal`) — hits are synthesized by default, no forced
sample-browsing detour before you can start.

**Entering the drum pattern — a real, silent-corruption bug.** Collapsing the "Lanes (12)" detail
list drops straight into a compact 12-lane step grid (12px-tall rows, 909-style). Clicking to place
kick/snare/hat hits at the geometric center of each intended step's visual cell — the natural place
to aim — consistently placed the hit **one 16th-note late**. Confirmed by reading the raw `.beat`
file: intending kick on steps 0/8/16/24 produced `hit h1 kick 1 0.8`, i.e. step 1, not 0, and this
was consistent across all 24 hits I placed that way. Root cause, read directly out of
`ui/src/components/NoteView.tsx:462`: the grid's click-to-add handler computes
`step = Math.round((e.clientX - rect.left) / stepW)` — it snaps to the **nearest gridline**, not
"which cell contains the click." Since hit/note markers are drawn starting *at* their step's
gridline, the visual cell for step N spans gridline N to gridline N+1, but the click-target region
that actually resolves to step N is centered *on* gridline N (spanning N−0.5 to N+0.5 step-widths)
— offset by half a cell from what the visible grid suggests. Concretely: clicking in the right half
of what looks like "step N" silently places the note on step N+1 instead. At the default 14px/step
zoom that's a 7px margin for error, comfortably within normal mouse-click imprecision. The result is
subtle — one 16th early or late — easy to miss by ear or eye, and I only caught it because I diffed
intended-vs-actual against the `.beat` file; a real user has no equivalently cheap way to notice.
Clicking near each step's *left* edge instead (gridline, not visual-cell-center) reliably produced
the intended pattern. This is a real, fixable off-by-half-cell bug in the snap math, not a one-off
misclick, and it silently corrupts timing with zero error or visual warning — the highest-priority
finding from this session.

**The clip editor's view jumps after your first edit.** While placing bass notes, I found the same
class of problem again, from a different angle: computing pixel targets once and clicking several
notes in a batch (as a script naturally does) produced notes at wildly wrong pitches after the
first one landed correctly. Diagnosis: the clip editor's vertical scroll position shifts by a fixed
amount (observed: 8 semitones' worth of rows, ~96px) immediately after the *first* note/hit is
added in a session, then stabilizes. The same pattern showed up independently in the drum grid too
(a ~19px vertical shift measured between an empty-grid state and a 24-hit state). A real human,
clicking one note at a time and looking at the screen before each click, would likely absorb this
as "the view jumped once, mildly disorienting" rather than silently misplacing notes the way my
batch script initially did — but it's a real, reproducible view-stability issue worth fixing
regardless, since "the editor scrolls out from under you right after your first edit" is the kind
of thing that erodes trust even when no data gets corrupted.

**A sticky header that hides content.** Also found while scrolling: the teal/gold clip-name title
bar (`.noteview-titlebar-name`) is `position: sticky` inside the scrollable lane/note list. At
certain scroll offsets it re-docks exactly on top of a real content row — confirmed via
`getBoundingClientRect()` for the drum lane list (sticky header top=574.1/bottom=595.1 landing
almost exactly on the "hat" lane row, top=572.8/bottom=588.2) and reproduced again independently in
the note editor's pitch-row list. "hat" is one of the most commonly-tweaked drum lanes for a basic
beat, and its label plus edit/reorder/remove controls are fully obscured at that scroll position —
you'd have to nudge the scroll slightly to uncover it. Low severity individually, but happened
twice in two different panels using the same sticky-header pattern, suggesting a systemic fix (a
scroll-margin or z-index adjustment) rather than a one-off patch.

**A legibility false alarm — reported for what it teaches, not because it's a bug.** After adding
drum hits, the drum clip's box in the Arrangement view appeared to shrink to a ~34px sliver against
the surrounding empty 2-bar timeline (reproduced across five separate screenshots, including after
a forced browser reflow to rule out a stale paint). This looked exactly like "the arrangement lost
track of my pattern's length" and was worth taking seriously. It turned out to be a false alarm:
`getBoundingClientRect()` on the actual `.arr-clip-block` div confirmed it *is* full-width
(1176px, correct for 2 bars), and `elementsFromPoint()` confirmed that same full-width element is
genuinely what's hit-testable across the entire row — there's no separate small overlay clipping
it. A tight, zoomed crop of just that row revealed the real explanation: the clip's 1px border *is*
drawn at full width, but it's extremely low-contrast (thin, dark-on-dark) and essentially invisible
at normal viewing scale; only the "(loop)" label chip in the top-left corner has a bold, clearly
visible fill, which is what reads as "the whole clip" at a glance. The identical pattern showed up
on the untouched "lead" row too, so this isn't drums-specific or edit-triggered — it's just how
every clip block renders, always. Net effect: **the arrangement view gives almost no visible
feedback about how long a clip actually is**, which cost real investigation time to rule out as a
correctness bug and would just as easily read as "did my pattern get deleted?" to a real user
glancing at their screen. Worth raising the border contrast regardless of the "it's just cosmetic"
technicality, since it actively misleads.

**Renaming a track, and a self-inflicted mistake.** Double-clicking a track name opens an inline
rename field exactly as the hint text promises. My first attempt used Ctrl+A to select-all before
typing — that's an Emacs-style "move to start of line" binding on macOS text fields, not
select-all, so the result was "basssynth" instead of "bass." This was my own tooling mistake (macOS
select-all is Cmd+A), not an app bug, but I'm noting it because it's a real trap for anyone testing
or scripting this app on a Mac with muscle memory from other platforms.

**Playback: the positive core of the session.** Clicking Play worked exactly as expected and gave
strong, layered feedback: the button flips to a red "Stop", the `POSITION` readout in the topbar
advances in real time (1.1 → 1.2 → 1.3 → 2.1, correctly wrapping into bar 2), and — best of all — an
orange playhead line sweeps across *both* the Arrangement view and the currently-open Clip editor
in sync. The topbar scope, whose purpose wasn't obvious on first glance, redeemed itself here:
captured mid-playback it showed a genuine animated waveform trace, not a flat line, giving a real
"proof of life" signal independent of actually hearing anything. This is exactly the kind of
feedback a headless/agent-driven user (or anyone testing with speakers off) needs, and it worked
without hunting.

**The Mixer** opens as a clean modal with one channel strip per track (lead/drums/bass, correctly
color-matched), each with a pan knob, shuffle/grid groove knobs, a vertical fader with dB readout,
and mute/solo. Crucially, the faders have **live per-track meters** — and during playback the
drums and bass strips showed real green meter activity while the still-empty "lead" strip stayed
dark. That's a small but meaningful consistency check that things are wired correctly (silent
tracks show no meter, active tracks do) and it worked exactly as expected.

**The preset browser has good content but no discoverability for how to use it.** Opening
"Browser" reveals a legitimately well-organized preset library — 30 synth presets grouped as
BASS (acid-bass, deep-sub-bass, fm-bass, reese-bass, sub-sine-bass, wobble-bass), LEAD, PAD, PLUCK,
KEYS, and more — exactly the kind of thing I'd want browsing for a bass sound. But clicking a
preset name (single- or double-click) does nothing but visually select the row; no param changes
land in the `.beat` file, and there's no error, toast, or hint explaining why. Only by inspecting
the DOM did I find the actual mechanism: preset rows are `draggable="true"` with a `data-preset`
attribute — applying a preset requires **dragging it onto a track**, mirroring an existing
drag-a-sample-onto-a-track precedent elsewhere in the app. That drag *does* work (verified:
dragging "deep-sub-bass" onto the bass track changed `cutoff` from 2000→700 and added
`osc2Type square`/`osc2Level 0.25`/etc., matching the preset's own tooltip description), but unlike
nearly every other panel in this app, the Browser panel carries **zero inline hint text** telling
you drag-and-drop is required. Every other panel over-explains itself; this one under-explains
itself, and it's exactly the panel a new user reaches for early ("browse for a preset/drum kit," as
the task itself puts it). Additionally, after a successful drag-apply there's no visible
confirmation anywhere in the default (Clip-tab) view — you have to know to switch to the "Device"
tab to see the new synth params reflected. The information is there; it's just not surfaced
proactively.

**Version history: a real gap, and copy that says something false.** Opened "History" expecting a
save/checkpoint model. The panel's own subtitle is reassuring and well-written — "newest first ·
restoring goes back without erasing work" — but the body read **"No checkpoints yet — make an edit
to save one,"** despite the fact I'd made several dozen real edits by that point (two tracks added,
24 drum hits, 6 bass notes, a renamed track, an applied preset). Clicking "Show all" changed
nothing. This isn't just an empty state — it's actively misleading: the copy implies "make an edit"
*will* create a checkpoint, which is false (edits alone never create one; this matches a documented,
known gotcha in the project's own internal docs: `beat set`/`add-note`/etc. never auto-checkpoint).
I checked the Shortcuts panel too, hoping for a "checkpoint now" keybinding — none exists; it
explicitly documents Ctrl/Cmd+Z as "undo (in-session only, **separate from version history**)",
which correctly acknowledges the two systems are different but still offers no way to actually
create a version snapshot from the GUI. **A GUI-only new user, after building a real groove from
scratch, has no discoverable way inside the app to save a named version of their work.** They'd
need to already know to reach for the CLI (`beat checkpoint`) or MCP — which defeats the point of a
GUI-first flow for exactly the audience (new user, GUI-only) this session was testing for. This is
the second-highest-priority finding, on par with the click-snap bug, because it's not just
friction — the panel's own words tell you something untrue about the state of your work.

**Export — confirmed with hard evidence, not just a screenshot.** Clicking "Export" started
playback automatically, swapped the button for a "⟳ Rendering..." indicator, and — once finished —
silently saved a WAV to the browser's default downloads location
(`dotbeat-export-<timestamp>.wav`) with no visible in-app confirmation that a file had been saved or
where. Rather than trust that it "probably worked," I read the actual WAV: 4.14s duration (correct
for a 2-bar loop at 120bpm), stereo, 48kHz, peak amplitude ~79% of full scale, RMS ~1994/32767 — i.e.
genuine, substantial audio content, not silence. **This is the strongest confirmation available
that the whole pipeline — GUI clicks → `.beat` file → real-time audio engine → exported file —
actually works end to end**, and it's something a real user could do too (play the downloaded file)
even though the in-app UI gives them no acknowledgment that Export succeeded or where the file
landed.

## Summary of findings, roughly prioritized

1. **[bug]** Clicking the visual center of a drum/note grid cell places the hit/note **one step
   later** than intended (`Math.round` snaps to nearest gridline, not "which cell," in
   `NoteView.tsx:462`). Confirmed via the raw `.beat` file across 24 drum hits. Silent — no error,
   no visual cue — and easy to reproduce by simply clicking where the grid visually suggests. The
   single highest-value fix from this session: it's a correctness bug in the app's own hit-testing
   math, not a misunderstanding on the user's part.

2. **[bug/confusing]** The Version History panel says "No checkpoints yet — make an edit to save
   one" after dozens of real edits, and there is no discoverable button or shortcut anywhere in the
   GUI to actually create a checkpoint/version. The claim in the UI copy is simply false as stated,
   and a GUI-only new user has no way to snapshot their work from the app itself.

3. **[confusing]** The preset/content Browser is the one major panel in the whole app with **no**
   inline usage hint, and its actual interaction model (drag-and-drop onto a track; click alone does
   nothing) is invisible until you either stumble into it or inspect the DOM. Every other panel in
   this app over-explains itself in gray hint text; this is the one place that under-explains.

4. **[confusing]** The clip editor's scroll position visibly shifts after the first note/hit is
   added in a session (observed independently in both the drum-lane grid and the note/pitch grid).
   Disorienting even when it doesn't cause a misplaced click, and happened consistently enough to
   suggest a real, fixable layout-stability issue rather than a fluke.

5. **[bug, minor]** A `position: sticky` clip-title header re-docks on top of real content (the
   "hat" drum lane in one repro, a pitch row in the note editor in another) at certain scroll
   offsets, fully obscuring that row's label and controls. Same underlying pattern in two different
   panels — worth a systemic fix.

6. **[confusing, minor]** Arrangement clip blocks render with a nearly-invisible 1px border across
   their real (correct) width, with only the small "(loop)" label chip clearly visible. This reads,
   at a glance, as "the clip is 30px long" when it's actually the full loop — a false alarm I had to
   spend real effort ruling out via DOM inspection, and a real user has no such recourse.

7. **[confusing, minor]** No visible confirmation after a preset is successfully drag-applied to a
   track (must manually switch to the Device tab to see the new params took effect), and no visible
   confirmation of where an Export's WAV file was saved (found only by checking the OS Downloads
   folder and analyzing the file directly).

8. **[worked well]** Playback feedback is layered and trustworthy: Play/Stop button state, a live
   advancing POSITION readout, a synced playhead sweeping both the Arrangement and Clip views
   simultaneously, and a topbar oscilloscope that visibly animates with real waveform motion during
   playback. For a browser-based, possibly-speakerless DAW, this is a strong "how do I know it's
   working" story.

9. **[worked well]** The Mixer is clean, well-labeled, and functionally correct — per-track color
   coding carries through from the Arrangement into the Mixer's channel strips, and live meters
   correctly showed activity only on tracks with actual content (silent "lead" track = dark meter;
   active drums/bass = real green meter movement during playback).

10. **[worked well]** The "+ track" menu (Synth/Drums/Instrument/Audio), instant per-track color
    coding across every view, and the drum-lane editor defaulting to synthesized voices (no forced
    sample-import detour) all matched what a DAW-literate new user would expect with zero hunting.

11. **[worked well]** End-to-end audio correctness: exporting produced a real WAV (verified by
    reading actual sample data — peak ~79% FS, RMS ~1994/32767, correct 4.14s duration for a 2-bar
    120bpm loop), confirming the whole GUI-edit → engine → file pipeline genuinely works, not just
    that buttons produce visual state changes.

12. **[worked well]** The preset library itself (30 categorized synth presets including a full
    BASS category with plausible, well-differentiated options) is a good, real content set — the
    problem is purely how to discover that dragging is the way to apply one, not the content itself.

## Artifacts

Session scaffolding, screenshots (referenced above by filename), the final `.beat` file, and the
exported WAV all live under `/tmp/dotbeat-usability-fresh/` and `~/Downloads/dotbeat-export-*.wav`
respectively (not committed; ephemeral by design of this pilot). Key screenshots: `01-first-load.png`
(first impression), `08-drum-pattern.png` + the corrected re-entry (drum grid + the off-by-one repro),
`11k-drumsrow.png`/`11l-leadrow.png` (the clip-border legibility crop that resolved the false alarm),
`21-playing.png`/`22-23-scope-*.png` (playback + scope confirmation), `24-mixer.png` (mixer with live
meters), `26-browser.png` (preset browser), `32-33-history*.png` (the misleading checkpoint copy),
`35-shortcuts.png` (confirming no checkpoint keybinding exists).

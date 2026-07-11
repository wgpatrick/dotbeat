# Phase 19 — two real gaps found in live testing

*Kicked off 2026-07-11, the owner's first hands-on pass in the actual Mac app since Phase 18
shipped. Two concrete, well-scoped UI gaps found by using the app for real, not by more research.
Both fixes below, dispatched together — disjoint files, zero collision risk.*

## Stream U — piano roll needs a pitch reference (research first, per owner direction)

`NoteView.tsx`'s note editing (add/move/resize/multi-select/marquee, Phase 13/17) is real and
correct — notes render as colored bars at the right position, the toolbar correctly reports note
count. What's missing, confirmed by grep (zero hits for any keyboard/gridline/pitch-label code):
**no piano keyboard strip and no horizontal pitch gridlines.** Notes render as unanchored bars
with no visual reference for what pitch they're at. The owner explicitly asked for real research
here, not a quick eyeball-copy from screenshots — do that first.

**Research, from Ableton's own documentation plus the screenshots already reviewed this
session** (a second reference screenshot, reviewed live in this conversation, adds real detail —
summarized here so you don't need the image itself):
1. **Keyboard strip range**: NOT clipped to just the clip's used notes — the reference shows a
   wide range (C7 down to C-2 visible, well beyond the actual note content) with the view
   scrolled/zoomed to a comfortable working range. Research how Ableton actually decides initial
   scroll position/zoom (likely: centered on the clip's note range, but the strip itself spans the
   full addressable range and scrolls, it doesn't resize to fit).
2. **"Fold" mode**: a toggle (visible top-left in the reference) that switches between showing all
   128 keys and showing only pitch rows that actually contain notes (or, per Ableton's manual, may
   fold to a musical scale rather than literal used-notes — confirm precisely which). Real,
   valuable density feature — research exactly what it does before deciding whether to build it
   this round or flag it as a fast-follow.
3. **Gridline hierarchy**: octave boundaries (each "C") get a heavier/labeled line; other pitch
   rows within an octave get lighter lines. Black/white key coloring on the keyboard strip itself,
   and confirm whether that coloring also extends as subtle row-shading in the note grid behind
   the notes (the reference screenshot suggests it might).
4. **Scale-tone highlighting**: the clip properties panel has a "Scale" field (e.g. "A Minor") —
   research whether Ableton visually distinguishes in-scale vs. out-of-scale rows in the note grid
   when a scale is set (a common, valuable piano-roll convention) — if so, note it as a real
   feature; dotbeat's format may or may not have a per-clip scale field yet (check
   `src/core/document.ts` — if it doesn't, that's a scope boundary: highlighting needs data to
   highlight against, don't invent a fake default).
5. **Note coloring**: confirm it's the track's own color (already true in dotbeat) vs. anything
   velocity- or state-dependent.

**Then build**, informed by the above:
1. A piano-key strip along the left edge — vertical, one row per pitch, black/white key coloring,
   spanning a sensible range per your research finding (not clipped to just used notes), scrollable
   if the full range doesn't fit. Clicking a key previews that pitch through the engine (check
   whether `StepSequencer`'s existing `previewDrum` pattern has a note-preview analog already, or
   needs a small new engine method).
2. Horizontal gridlines with the octave-boundary hierarchy from your research (heavier/labeled at
   each C, lighter between).
3. "Fold" mode if your research shows it's straightforward and high-value; otherwise document it
   as a clearly-scoped fast-follow rather than skipping it silently.
4. Scale-tone highlighting ONLY if the format already models a per-clip scale (per your research
   check in point 4) — otherwise flag the format gap in your result doc rather than building
   against fake data.
5. Keep all existing interactions (marquee, multi-select, drag-move, resize, keyboard nudge)
   working unmodified — this is a rendering addition, not an interaction change.

Verify live (headless Chromium, this repo's `ui/verify*.mjs` convention): load a real clip with
known notes at known pitches, screenshot the result, confirm the keyboard strip and gridlines
render and that a note's vertical position visually lines up with its correct key.

Owns: `ui/src/components/NoteView.tsx` only. Result in `docs/phase-19-piano-roll-keys.md`
(including your research findings, cited, not just the build summary).

## Stream V — no way to change the song's length

Confirmed via code: `doc.song: BeatSongSection[] | null` — `null` means loop mode, a single
fixed-length region using `doc.loopBars`. This is real, working, correct behavior for a
loop-mode project — but there is currently **no GUI control anywhere to change it**: no way to
extend/shrink the loop, no way to add a new song section, no way to delete or resize one. The
underlying capability already exists and is agent-accessible: `loop_bars` is already a supported
`POST /edit` path (confirmed in `ui/src/daemon/bridge.ts`'s `applyLocalEdit`), and `beat song`/
`beat scene` (backed by `setSong`/`setScene` in `src/core/edit.ts`) already let the CLI/an agent
build a full multi-section arrangement — none of this is exposed in the GUI yet.

**Explicitly out of scope, per owner direction**: a Session-View-style ("Live view") clip-launching
grid. Real Ableton feature, correctly deferred — this stream is only about the Arrangement
timeline's own length, not building Session View.

1. **Loop mode**: a drag handle or +/- control at the end of the loop region in `ArrangementView`
   to extend/shrink `loopBars` directly, wired through the already-supported `loop_bars` edit path
   — this alone covers the common case and is the fastest win.
2. **Song mode**: UI to append a new section (choose bar count; scene assignment can start simple
   — e.g. duplicate the current/last section's slot map as a starting point rather than requiring
   the user to configure every track's clip from scratch), delete a section, and resize an existing
   section's bar count. `setSong`/`setScene` already do the real work — check whether a small
   additive daemon route is needed to expose them via HTTP (similar precedent: Phase 15's `/history`
   and `/vary` routes, both thin HTTP faces on existing `src/core`/`src/history`/`src/vary`
   functions) — reuse that pattern, don't reimplement the logic.
3. **Loop-to-song transition**: converting from loop mode (`song: null`) into song mode (a real
   `BeatSongSection[]`) needs to happen the first time a user adds a section from loop mode — make
   sure this produces a sensible first section (the existing loop content, `loopBars` long) rather
   than discarding what's there.

Verify live: extend a loop-mode project's length via the new control, confirm `loopBars` actually
changed on disk (one-line diff). Add a section to a song-mode project, confirm the arrangement
timeline visually grows and the new section is playable. Delete a section, confirm the timeline
shrinks correctly and remaining sections stay intact.

Owns: `ui/src/components/ArrangementView.tsx`, `src/daemon/daemon.ts` (additive route only, if
needed — run the FULL `npm test` afterward, confirm 295+/292+/0/3). Do not touch `NoteView.tsx`
(Stream U's territory), `ui/src/audio/engine.ts`, `src/core/document.ts`.

Result in `docs/phase-19-arrangement-length.md`.

## Process

Streams U and V touch entirely different files (`NoteView.tsx` vs. `ArrangementView.tsx` +
possibly `daemon.ts`) — no overlap, dispatch together. `npm test` must stay green throughout for
V if it touches the daemon; U is UI-only, verify via `ui/` typecheck + live evidence.

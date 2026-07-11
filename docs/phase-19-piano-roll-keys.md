# Phase 19 Stream U — piano-roll pitch reference (keyboard strip + octave gridlines)

*Built 2026-07-11 against `main` (31d61a7). Owns `ui/src/components/NoteView.tsx` plus one small,
additive engine method (`engine.previewNote`). The owner asked for real research first — Ableton's
own documentation — before building. That research is below, cited, then the build, then what was
deliberately scoped out, then live verification evidence.*

> Note on the base: this stream's worktree was initially branched from a stale commit (deba7c1,
> pre-Phase-17) whose `NoteView.tsx` lacked the marquee/multi-select/keyboard-nudge logic the brief
> describes. That was reset onto current `main` (which carries the real Phase-17 NoteView) before any
> work, so this extends the actual current component, not a fork of an old one.

## 1. Research — Ableton Live 12's MIDI Note Editor (piano roll)

Primary source is Ableton's official reference manual, cross-checked against the Live 12 Keys &
Scales FAQ. Findings, mapped to the brief's five points:

1. **Keyboard-strip range / scroll / zoom.** The note editor's vertical axis is a *note ruler* that
   "displays octaves C-2–C8" — i.e. the full MIDI-addressable range, **not** a range clipped to the
   clip's used notes. It **scrolls**: "Scroll up and down in the note ruler to change which octaves
   are shown," and "Click and drag horizontally in the note ruler to change the zoom level for key
   tracks" (Alt/Option changes the key-track zoom from inside the editor). The ruler shows standard
   black/white piano keys. The manual does not pin an exact default octave — the initial view depends
   on loaded content, centred so the clip's notes are visible.
   Source: [Editing MIDI — Live 12 manual](https://www.ableton.com/en/live-manual/12/editing-midi/).

2. **"Fold" mode.** Two distinct fold behaviours live at the top-left of the note editor:
   - **Fold to Notes** (Fold button / `F`): "immediately hide all key tracks that do not contain
     MIDI notes" — a density feature that collapses the editor to only the pitch rows in use.
   - **Fold to Scale** (Scale button / `G`): only available when the clip has Scale Mode on; hides
     "all key tracks that do not belong to the scale specified for the clip."
   Sources: [Editing MIDI — Live 12 manual](https://www.ableton.com/en/live-manual/12/editing-midi/);
   [Keys and Scales in Live 12 FAQ](https://help.ableton.com/hc/en-us/articles/11425083250972-Keys-and-Scales-in-Live-12-FAQ).

3. **Gridline / octave-label hierarchy + row shading.** The ruler is a literal piano keyboard, so the
   octave boundary is the visual anchor — each C is where a labelled octave (C-2 … C8) begins.
   Black-vs-white key colouring is on the keys themselves; the grid behind the notes carries subtle
   per-row shading that follows the black/white key pattern. (The manual describes the ruler and the
   horizontal time ruler; the octave-boundary emphasis and row shading are the standard piano-roll
   convention the reference screenshots showed.)
   Source: [Editing MIDI — Live 12 manual](https://www.ableton.com/en/live-manual/12/editing-midi/).

4. **Scale-tone highlighting.** With Scale Mode enabled and a scale chosen, "notes belonging to the
   scale are highlighted in the piano roll." Concretely, Highlight Scale (`K`) paints the in-scale
   key tracks — and the corresponding ruler keys — **purple** ("the color that signifies scale
   awareness across Live"), and "the root note is indicated by a prominent highlight in the piano
   ruler." This is gated on a **per-clip Scale field** (key + mode, e.g. "A Minor").
   Sources: [Editing MIDI — Live 12 manual](https://www.ableton.com/en/live-manual/12/editing-midi/);
   [Keys and Scales in Live 12 FAQ](https://help.ableton.com/hc/en-us/articles/11425083250972-Keys-and-Scales-in-Live-12-FAQ).

5. **Note colouring.** A note block's colour is its **clip/track colour** — "all notes are displayed
   with their clip's color." Velocity is *not* a separate colour; it is shown as **saturation** of
   that same colour ("less saturated notes play softly, while more saturated notes play louder").
   dotbeat already colours notes by track colour and encodes velocity as opacity — the same idea, so
   no change was needed here.
   Source: [Editing MIDI — Live 12 manual](https://www.ableton.com/en/live-manual/12/editing-midi/).

## 2. What was built (in `NoteView.tsx`, + one engine method)

1. **Piano-key strip** down the left edge — one row per pitch, `ROW_H`-aligned 1:1 with the grid
   rows so a note at pitch *p* sits at exactly the same *y* as key *p*. White naturals / dark
   accidentals (pitch-class ∈ {1,3,6,8,10}); each C is bold-labelled in **scientific pitch notation**
   (MIDI 60 = C4). The strip is `position: sticky; left: 0` inside the horizontal scroller, so it
   stays pinned while the grid scrolls in time. **Clicking a key auditions that pitch** through the
   track's live voice via the new `engine.previewNote(trackId, pitch)`.

2. **Range — deliberately not clipped to used notes.** The old code hugged the used notes ±3
   semitones. Now the window is padded an octave beyond the content on each side, **snapped out to C
   boundaries**, and forced to span at least `MIN_SPAN` (48 semitones / 4 octaves) so even an empty
   or single-note clip gets a real keyboard. (For the night-shift `lead` track, whose notes span
   67–76, this renders C3–B6 — 48 keys — with the notes sitting comfortably in the middle.) This
   mirrors Ableton's "full ruler, view centred on content" behaviour without a nested vertical
   virtualizer; a genuinely huge pitch spread just makes the panel taller and the page scrolls.

3. **Octave gridlines + row shading** inside the grid, painted behind the notes and
   `pointer-events: none` so grid add/marquee are untouched: a heavier horizontal line at each C
   (the octave boundary), and faint shading on every black-key row.

4. **`engine.previewNote(trackId, pitch, velocity=0.8)`** — the note-editor analog of the existing
   `previewDrum`. Ensures the engine is started, `sync()`s so the track's chain/voice exists with
   current params, then fires one short note: for synth tracks it triggers the **main oscillator
   only** (an audible reference pitch — minimal by design, not a full osc2/sub/noise/FM render); for
   instrument (SoundFont) tracks it note-on/note-offs the WorkletSynthesizer voice. No-op if the
   track has no live voice yet.

Every pre-existing interaction (tap-to-add, marquee-select, shift/cmd multi-select, drag-move, group
move, resize, uniform-delta group resize, keyboard nudge, velocity-lane drag) is untouched — the
grid element, its handlers, and the `(hi - pitch) * ROW_H` y-math are all unchanged. The additions
are new sibling/child render layers only. This was re-verified live (K5/K6 below).

## 3. Deliberately scoped out (documented fast-follows)

- **Fold mode — deferred, on purpose.** Fold-to-Notes is straightforward *conceptually* but not a
  pure rendering addition: it makes the visible pitch rows a *non-contiguous* set, which means
  replacing the uniform `pitch ↔ row` mapping (`(hi - pitch) * ROW_H`) with an indexed lookup across
  all six interaction handlers (marquee hit-test, tap-to-add, move `dRows`, etc.) **and** changing
  vertical drag/add semantics (you can no longer drag a note onto a hidden pitch, and you can't add
  on a hidden empty row). That's a behaviour change, not a render addition, and the brief's item 5
  puts a hard priority on not regressing the Phase-17 interactions. It's a clean, well-scoped
  fast-follow once the pitch↔row mapping is centralised behind a helper.

- **Scale-tone highlighting — blocked by a real format gap.** dotbeat's `.beat` format has **no
  per-clip scale field**: `BeatClip` (`src/core/document.ts`) is `{ id, notes, hits, automation }`,
  and there is no key/mode anywhere on clip, track, or document. Per the brief, highlighting needs
  data to highlight against, so this is **not** built and no fake default scale was invented. To do
  it for real, the format needs a clip-scoped `scale` (key + mode) field first — a `src/core`
  change owned by another stream, out of scope for a `NoteView.tsx`-only stream.

## 4. Verification (live, headless Chromium)

`ui/verify-phase19-piano-keys.mjs` (this repo's `verify*.mjs` convention) builds the real core/daemon
+ ui, starts a real `beat daemon` on a canonical copy of `examples/night-shift.beat`, drives the real
frontend, and asserts both DOM state and on-disk git diffs. All six checks pass; screenshot at
`ui/verify-p19-piano-keys.png`:

- **K1 — keyboard + range not clipped.** 48-key strip spanning **C3–B6** (pitches 48–95) while the
  lead's notes only span 67–76 — padded well beyond the content, bottom snapped to a C, fully
  contiguous, C keys labelled (pitch-60 key reads "C4").
- **K2 — pitch alignment (the load-bearing check).** Note `u100033` (pitch 76) top vs. the pitch-76
  key top differ by **1.00 px** (the grid's 1-px top border); the key strip sits to the left of the
  grid. Notes line up with their keys.
- **K3 — octave gridlines.** Exactly 4 `.noteview-octline` elements — one per C in range (48, 60,
  72, 84).
- **K4 — key preview.** Clicking the pitch-72 key runs `engine.previewNote` with no page error.
- **K5 — regression: add still works.** Tap on an empty grid row added exactly one note
  (`note u100040 71 8 2 0.8`), a clean 1-line diff.
- **K6 — regression: marquee + group move intact.** Marquee-selected exactly 3 notes and drag-moved
  them as a rigid body (relative offsets preserved), landing a clean 3-line per-note diff — the
  Phase-17 interactions are unaffected by the rendering additions.

The screenshot shows the keyboard strip (white/black keys, C6/C5/C4 labels), heavier octave lines at
each C, faint black-key row shading, and the red lead notes each anchored to their correct key.

## 5. Checks

- `ui/` typechecks clean: `npx tsc --noEmit` → no errors.
- Root `npm test` unaffected (ui-only change; the suite doesn't cover `ui/`): **292 pass / 0 fail /
  0 skipped**, fully green.

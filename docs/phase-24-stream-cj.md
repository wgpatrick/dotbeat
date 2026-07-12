# Phase 24 Stream CJ — wire per-clip length (loop) into actual playback + a drag handle to resize it

*Built 2026-07-11. Closes the gap `docs/format-spec.md` itself flagged: Phase 22 Stream AG modeled
`BeatClipLoop` (`clip.loop: {start, end} | null`, bars, clip-local) and built a typed GUI editor for
it, but the audio engine never read the field — every clip implicitly tiled at the document-wide
`doc.loopBars` period regardless. This stream wires the field into real playback and adds a drag
handle so "resize a clip" has something real to affect — the owner's own framing: "How can I size the
clip? I think it should be with an easy way of dragging the size of the clip."*

## Scope

Per `docs/phase-24-plan.md`'s CJ section:
1. Wire `ui/src/audio/engine.ts`'s `contentOf` (and any other clip-tiling computation) to use a
   clip's own `clip.loop` range when present, falling back to the existing `doc.loopBars`-wide tiling
   when `clip.loop` is null — an additive interpretation, not a behavior change for existing files.
2. A drag-handle affordance for resizing a clip's length, calling the existing `setClipLoop`
   primitive (`src/core/edit.ts`) rather than requiring `ClipPropertiesPanel.tsx`'s numeric fields.
3. A live Playwright verification that drag-resizes a clip shorter, confirms the file's `clip.loop`
   changed, AND confirms via rendered/measured audio that the clip genuinely tiles at the new,
   shorter length.
4. Round-trip/unit coverage for the `contentOf` tiling change, confirming pre-Stream-AG files (no
   `clip.loop` set) are provably unaffected.

## Where CC stood when this started

Checked before designing the drag handle's host surface, per the plan's own instruction: Stream CC
(clip visualization in the arrangement) had **not** landed on `main` yet at the time this stream
started (`git log --all --oneline | grep -i stream-cc` — nothing; no `docs/phase-24-stream-cc.md`).
`ArrangementView.tsx`'s existing `ClipOccurrence`/`trackOccurrences` machinery predates this phase
(Phase 22 Stream AE) and is explicitly scoped to `'audio'`-kind tracks only ("only meaningful for
kind 'audio' — every other kind ignores it," per that file's own comment) — it is not the general
clip-boundary visualization CC is scoped to build. Per the plan's own fallback instruction, the drag
handle is built into `NoteView.tsx`'s own clip canvas instead.

## Part 1 — `contentOf`'s clip-local tiling

### The old formula (unchanged when `clip.loop` is null)

```ts
const rel = step - sectionStartBar * 16
const loopSteps = loopBars * 16
contentStep: ((rel % loopSteps) + loopSteps) % loopSteps
```

The clip always tiled across `[0, loopBars*16)`, restarting at the section boundary — the
document-wide field, with no per-clip say in the matter.

### The new formula

```ts
const loopStartSteps = clip.loop ? clip.loop.start * 16 : 0
const loopSteps = clip.loop ? (clip.loop.end - clip.loop.start) * 16 : loopBars * 16
contentStep: loopStartSteps + (((rel % loopSteps) + loopSteps) % loopSteps)
```

When `clip.loop` is set, `contentStep` cycles **within** `[loop.start*16, loop.end*16)` instead of
`[0, loopBars*16)` — the clip repeats only that sub-window of its own authored content, starting
right at the section boundary (`rel=0` → `contentStep = loop.start*16`). Events (notes/hits) whose
own `start` falls outside that window simply never match `Math.floor(event.start) === contentStep`
for any step, so they're silently excluded from that pass — exactly the "drag the clip shorter and
the tail stops sounding" behavior a length-resize handle should produce. When `clip.loop` is null,
`loopStartSteps` is `0` and `loopSteps` is `loopBars*16` — byte-for-byte the old formula, not an
approximation of it. This is the "no override = today's behavior, unchanged" canonical-elision
discipline `BeatClipLoop`'s own doc comment in `src/core/document.ts` already commits to.

### A second retrigger site this also had to fix

`contentOf`'s audio-region branch (Phase 22 Stream AE) re-triggers a `Tone.Player` whenever
`content.contentStep === 0` ("the start of every pass through the clip"). With a `clip.loop.start >
0`, `contentStep` never returns to literal `0` — it wraps back to `loop.start*16` instead — so that
check would have silently stopped audio-region clips from ever retriggering once they had a
loop-start offset. Fixed by adding a `cycleStart` field to `Content` (`0` normally, `loop.start*16`
when a clip-loop override is active) and comparing against that instead of a hardcoded `0`
(`ui/src/audio/engine.ts`, the `Content` interface and the `track.kind === 'audio'` branch of
`tick()`).

### The other tiling site: `ArrangementView.tsx`'s `flattenTrack`

Grep for every place clip content gets tiled (not just `engine.ts`) turned up a second spot:
`ArrangementView.tsx`'s `flattenTrack`, which flattens a track's notes/hits into absolute-step events
for the arrangement's note-density canvas rendering. It previously tiled purely off the clip's own
authored content length (`clipStepLen`, `Math.ceil(maxEnd/16)*16`) with no knowledge of `clip.loop`
at all — so a clip with a loop override would keep rendering its full original extent in the
arrangement even though playback (post this stream) only sounds the loop window. Fixed with a new
`tileOffsets` helper mirroring `contentOf`'s exact interpretation (restrict to events whose `start`
falls in `[loop.start*16, loop.end*16)`, tile at that period instead of `clipStepLen`'s), so the
arrangement's visual density now matches what the engine actually plays. `trackOccurrences` (which
side of a section maps to which clip, not what's inside it) needed no change — clip-loop is about
content *within* an occurrence, not the occurrence's own span.

## Part 2 — the drag handle (`NoteView.tsx`)

A new strip (`.noteview-cliploop-strip`) sits directly above the note/hit grid, only rendered when
`primaryClipFor(track, doc)` resolves to a real saved clip (the exact same "which clip am I editing"
resolution `ClipPropertiesPanel.tsx`'s numeric fields already use — exported from that file rather
than re-derived a third time). It shows:
- a shaded range (`.noteview-cliploop-range`) for `[loop.start, loop.end)` bars, or the full
  `loopBars` width when no override exists yet (the position the clip already effectively tiles at
  today — so the handle always starts exactly where the clip visibly already ends);
- a draggable handle (`.noteview-cliploop-handle`, `data-clip-loop-handle="<trackId>"`) at the right
  edge, `ew-resize` cursor, live-previewed (`.noteview-cliploop-label`) while dragging, matching
  Stream AG's own established single-right-edge-drag precedent (`ArrangementView.tsx`'s section
  resize handle) rather than a two-handle range-select gesture.

Dragging commits through `postEdit(`${track.id}.clip.${clip.id}.loop`, `${start} ${end}`)` on
pointer-up — the exact same `<track>.clip.<id>.loop` edit path (`src/core/edit.ts`'s `setClipLoop`
wrapper) `ClipPropertiesPanel.tsx`'s numeric fields already use. This is a second **input method** for
the identical fact, not a second mechanism: no new edit primitive, no new daemon route. Dragging the
handle back out to the full `loopBars` width (with `start` still `0`) clears the override entirely
(an empty-value `postEdit`) rather than writing an explicit `"0 loopBars"` that would mean the exact
same thing — keeping the file at true canonical-elision when the effective result is "no override."

Only the **end** is drag-resizable (start stays wherever it already was — `0` for a fresh override);
a start-edge handle was considered but cut for this pass as a second gesture with no immediate use
case (the owner's own framing was specifically about *shortening* the clip, not shifting a window).
`ClipPropertiesPanel.tsx`'s numeric start field remains the way to set a non-zero start precisely.

## Part 3 & 4 — verification (`ui/verify-phase24-stream-cj.mjs`)

One script, three parts (see the file's own header comment for the full rationale):

- **Part A** — unit-style assertions against `window.__engine.contentOf` directly (synthetic
  track/scene/song inputs, no `.beat` file involved): the `clip.loop === null` case reproduces the
  exact pre-stream formula for a **full pass** of 64 steps (not a sample); the `clip.loop = {1, 3}`
  case is checked against hand-computed expected `contentStep` values spanning multiple wraps of the
  32-step window; `cycleStart` is checked at every probe; unmapped-scene/past-end-of-song edge cases
  still return `null`.

  Why this is the right substitute for a `ui/`-local unit-test suite: there isn't one (no vitest, no
  `test/*.test.ts` covering `ui/src` — confirmed by grep), and `engine.ts` can't be imported under
  plain `node --test` — it has a Vite-only `?url` static import (the spessasynth worklet processor)
  and pulls in Tone.js's real audio-graph machinery at module scope. `contentOf` is a TypeScript
  `private` method, but that's compile-time-only; at runtime it's a normal method on the
  `window.__engine` singleton every other Phase 22/23 engine-verification script already relies on
  (`main.tsx`'s `window.__engine = engine`), so this drives the actual production code inside a real
  Chromium tab rather than a hand-mirrored duplicate of the formula.

- **Part B** — loads `examples/night-shift-song.beat` (song mode, multiple tracks/sections/clips,
  confirmed by grep to have no `loop` line anywhere — a genuine file that predates this stream)
  through a real daemon, and compares `contentOf`'s `contentStep` against an independently
  hand-recomputed old-formula oracle for 704 real `(track, step)` combinations spanning every section
  — byte-for-byte match required. This is the "confirm existing pre-Stream-AG files are provably
  unaffected" check the plan asked for, run against a real file rather than a synthetic one.

- **Part C** — a fresh drums clip (one kick hit, `loopBars=4` → an 8s default tiling period) is
  recorded for 3s before any change (exactly 1 onset — no repeat inside the window, proving the
  *default* period is still what it always was); the new handle is dragged from the full-width
  position down to 1 bar; `clip.loop` is confirmed to land on disk as `loop 0 1`; the clip is
  recorded again for 5.2s and shows 3 onsets at a measured 2.000s / 1.9999...s spacing — the new
  1-bar (2s @ 120bpm) period, not the old 8s one. This is the "real render+measure check, not just a
  DOM/file assertion" the plan specifically called for.

All three parts passed on a clean run:

```
[A1] PASS: clip.loop=null reproduces the exact pre-stream formula for all 64 steps of a full pass
[A2] PASS: clip.loop={start:1,end:3} cycles contentStep within [16,48), wrapping back to 16 (not 0)
[A3] PASS: cycleStart correctly reports the loop-local wrap-back point (16) for every probe
[A4] PASS: unmapped-scene / past-end-of-song edge cases still return null, unchanged
[B]  PASS: 704 real (track, step) combinations ... match the pre-stream formula exactly
[C]  PASS: dragging the handle committed clip.loop = {start:0, end:1} — "loop 0 1" on disk
[C]  PASS: recorded audio genuinely repeats at the NEW, shorter 1-bar period
```

## Files touched

- `ui/src/audio/engine.ts` — `contentOf`'s clip-local tiling (`Content.cycleStart`, both call sites,
  the audio-region retrigger check).
- `ui/src/components/ArrangementView.tsx` — `flattenTrack`'s `tileOffsets` helper (arrangement-canvas
  visual tiling, kept consistent with `contentOf`).
- `ui/src/components/NoteView.tsx` — the clip-loop resize strip/handle, calling `setClipLoop` via the
  existing `postEdit` channel.
- `ui/src/components/ClipPropertiesPanel.tsx` — exported `primaryClipFor` so `NoteView.tsx` resolves
  the identical "which clip" target as the numeric fields.
- `ui/src/styles.css` — `.noteview-cliploop-*` rules.
- `ui/verify-phase24-stream-cj.mjs` — the three-part verification above.

## Explicitly out of scope

- CC's clip-boundary visualization in the arrangement itself — this stream's drag handle lives in
  `NoteView.tsx` per the plan's own fallback instruction. If/when CC lands, a clip-block-anchored
  resize handle there would be a natural follow-up, reusing the same `setClipLoop` call.
- A start-edge drag handle (shifting the loop window without changing its length) — only the end is
  drag-resizable this pass; `ClipPropertiesPanel.tsx`'s numeric start field covers that case.
- Per-clip time signature (`BeatClipLoop`'s sibling field) — untouched, still metadata-only per
  `docs/phase-6-plan.md`'s existing exclusion, unrelated to this stream's scope.

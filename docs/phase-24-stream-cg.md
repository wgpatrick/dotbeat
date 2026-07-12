# Phase 24 Stream CG — sync the clip-view playhead to actual song playback

*Real bug fix (not a feature gap), from `docs/phase-24-plan.md`'s Stream CG — found via live GUI
testing against `examples/night-shift-song.beat`, a real multi-section song project.*

## The bug

`ui/src/components/NoteView.tsx` (the clip/note editor docked in the bottom pane) already rendered a
playhead:

```tsx
{currentStep >= 0 && currentStep < totalSteps && (
  <div className="noteview-playhead" style={{ left: `calc(${currentStep} * var(--note-step-w))` }} />
)}
```

`totalSteps` there is `loopBars * 16` — the document's vestigial loop-mode-only length
(`doc.loopBars`, a field that means "how long is the loop" only when there's no `song` array at all).
`currentStep`, read from the same shared store `ArrangementView.tsx` uses, is the **absolute
song-timeline step** once a real `song` array exists — `engine.ts`'s `tick()` computes it as
`rawStep % totalSteps` where `totalSteps` there is the **whole song's** length (e.g. 528 steps for
this fixture's 33 bars), not one clip's.

The consequence: `currentStep < loopBars*16` (e.g. `< 64`) goes false almost immediately after
playback starts, for any song with more than about one section's worth of bars. The playhead was
visible for a few seconds at the very start of the whole song and then simply vanished for the rest
of playback, regardless of which clip/track was open in the editor.

## The fix

`ui/src/components/NoteView.tsx` now mirrors the exact resolution `engine.ts`'s private `contentOf`
method already does for real playback, rather than comparing the raw absolute step against the
open clip's own length:

1. **Which clip is "open"?** There's no per-clip selector in the GUI yet — `NoteView` always edits a
   track's *live* content (`track.notes`/`track.hits`), not a named `BeatClip` object directly. The
   established stand-in (already used by `ClipPropertiesPanel.tsx`, which docks in this same view) is
   the **"primary clip"**: the first song-section's scene that maps this track to a real, existing
   clip. A new `primaryClipFor(track, doc)` helper in `NoteView.tsx` duplicates that same four-line
   rule locally (matching `ClipPropertiesPanel.tsx`'s own documented reason for duplicating it from
   `ArrangementView.tsx` rather than sharing a module — "kept in lockstep by the shared comment").

2. **Which section is playing right now?** A new `resolveClipPlayhead(track, doc, currentStep,
   loopBars)` walks `doc.song`'s cumulative bars from `bar = Math.floor(currentStep / 16)` to find the
   currently-playing section and its `sectionStartBar` — the identical walk `contentOf` does.

3. **Is the open clip the one actually playing?** Looks up that section's scene and checks whether
   `scene.slots[track.id]` equals the primary clip's id. If not — wrong section, or this track isn't
   in the current scene at all — returns `null` and **no playhead renders**. A missing line is
   strictly better than one at a nonsensical position (the plan's own framing).

4. **If it is, what's the clip-relative position?** Applies `contentOf`'s exact modulo formula:
   `rel = currentStep - sectionStartBar * 16`, `contentStep = ((rel % loopSteps) + loopSteps) %
   loopSteps` where `loopSteps = loopBars * 16` (the document's `loopBars`, matching `contentOf`'s own
   `this.contentOf(track, step, doc.loopBars, song, doc.scenes, bar)` call — deliberately *not* a
   per-clip loop override, for the same reason real playback doesn't use one there either).

Loop mode (no `song` array, or an empty one) is unaffected: `resolveClipPlayhead` falls back to the
old direct condition (`currentStep` is already clip-relative when `engine.ts`'s `tick()` has no song
to wrap against), so the original loop-mode behavior — the only case that was ever correct before —
is untouched.

Everything else that used to key off `totalSteps`/`currentStep` (grid width, marquee/drag clamping,
bar-line rendering) is unchanged — only the playhead's own visibility/position now reads the new
`playheadStep` (`null` or a clip-relative step) instead of the raw absolute `currentStep`.

### Files touched
- `ui/src/components/NoteView.tsx` — `primaryClipFor`, `resolveClipPlayhead`, and the playhead JSX
  now gated on `playheadStep !== null` instead of `currentStep < totalSteps`.

## Verification

`ui/verify-phase24-stream-cg.mjs` — Playwright-driven against a real daemon + built UI, on
`examples/night-shift-song.beat` (6 sections: `intro(4) build(4) drop(13) intro(4) intro(4) intro(4)`
= 33 bars, `bpm 124`, `loop_bars 4`; scenes: `intro` maps only `pad`, `build` maps `drums`/`bass`/
`pad` but not `lead`, `drop` maps all four tracks). bpm is bumped to 960 live via the GUI's own BPM
field purely to make the real-time wait practical in a test — the fix itself is tempo-independent.

- **[pre]** No playhead while stopped (`currentStep === -1`).
- **[A] not-playing case**: opens `lead` in NoteView, starts playback, and samples repeatedly while
  the transport is inside the "build" section. `lead`'s own primary clip (`hook`, found via "drop")
  exists, and playback is genuinely running — but "build"'s scene doesn't map `lead` at all, so
  `lead` is silent this section. Asserts **zero** stray playhead renders across 15 samples.
- **[B] playing case**: switches to `drums` (mapped to `groove` in "drop", the same clip that's
  `drums`' own primary clip) while still playing, once the transport enters the 13-bar "drop" section
  (3.25 loops of the 4-bar clip). Cross-checks 40 samples of the rendered playhead's pixel position
  against `contentOf`'s exact formula computed independently in the script from the fixture's known
  structure (0 mismatches), and explicitly finds a same-direction-in-time pair of samples where the
  rendered step **drops** even though `currentStep` climbed — the unambiguous signature of the clip
  tiling/wrapping, something the old absolute-step bug could never produce.

Confirmed the test is non-vacuous: re-ran it against the pre-fix `NoteView.tsx` (via `git stash`) and
case [B] fails immediately (`expected a playhead for drums inside "drop", got none` — the old
`currentStep < 64` condition is false by the time playback reaches bar 8, so nothing renders).

```
node ui/verify-phase24-stream-cg.mjs
```

Also run: `npm test` (545/545 passing), `npx tsc --noEmit -p ui` and `npx tsc -p tsconfig.json`
(both clean).

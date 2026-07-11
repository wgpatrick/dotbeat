# Phase 13 Stream C — arrangement/song view + mixer, dotbeat's own build

*Built 2026-07-11 per `docs/phase-13-plan.md` Stream C. Two new views in `ui/` (dotbeat's own React
frontend from Phase 12 Stream 1): the arrangement/song view (D4, `docs/product-spec-desktop.md` §5 —
"the desktop app's centerpiece screen") and a mixer. Reuses the *research* from the discarded
BeatLab-side Phase 11 attempt (`docs/phase-11-song-view.md`: canvas + density-LOD), rewritten fresh
against dotbeat's real document shape. No engine or note-editor changes — Streams A/B own those.*

## What was built

### Navigation (App.tsx)

`ui/` was a single screen (the per-track editor). Added a three-tab switcher in the top bar —
**Editor / Arrangement / Mixer** — backed by a `view` slice in the store. The original editor
screen is unchanged, now factored into an `EditorView` component and rendered under the `editor`
tab (so Phase 12's `ui/verify.mjs` still drives it exactly as before). Default view is `editor`.

### Arrangement / song view (`ui/src/components/ArrangementView.tsx`, new)

Tracks as rows, bars as columns, the real `song`/`scenes`/`clips` arrangement from the document.
The ruler across the top labels each song section (`intro`/`build`/`drop`/…) with its bar count and
draws section boundaries; each track is a row with a fixed header (color swatch, name, kind) and a
canvas timeline.

- **One `<canvas>` per track row** — the validated approach from `docs/phase-11-song-view.md` (DOM/
  SVG node count scales with *total notes on screen*; canvas draw calls scale with *events actually
  drawn* — the right cost model for a dense, zoomed-out timeline; corroborated there by Magenta.js
  shipping a canvas visualizer alongside its SVG one and `dpren/react-piano-roll` being canvas/WebGL
  only). Matches this codebase's own `Scope.tsx` convention (ref + `getContext('2d')`), but with **no
  rAF loop** — nothing here updates per frame, so canvases redraw only on data/selection/size change
  (a plain `useEffect`, not the shared `animationFrame.ts` driver, which is correct per research 15
  §2: that driver is for continuous-rate views; this is discrete).
- **Density LOD** — below `DETAIL_PX_PER_BAR = 32` px/bar each bar collapses to one opacity-encoded
  block (opacity ∝ event count in that bar, soft-normalized against `DENSITY_REF = 6`, not a hard
  cap); at or above the threshold, real ticks render — drum hits by lane (five stacked lane rows),
  synth notes positioned by pitch within the row and sized by duration. The "zoom" that drives the
  switch is automatic: `containerWidth ÷ totalBars` via a `ResizeObserver`, exactly as the Phase 11
  research described (the audio-waveform min/max-per-pixel idea generalized to notes). Both paths are
  live, not one stubbed — a ~20-bar song renders in detail at a normal window width; a long song
  drops to density automatically.
- **Song-timeline flattening** — each section's scene maps this track to a clip (`scene.slots[id]`);
  an unmapped track is *silent* that section. The clip's events tile across the section's bars
  (rounded to whole bars, min one). A track with no `song` block falls back to loop mode (one
  implicit section over `loop_bars`, using the track's live notes/hits). This is what makes the view
  show real per-section content instead of a flat "all notes everywhere" smear.
- **Selection wired to `/selection`** (the D2 pointing channel `beat vary --scope selection` reads
  server-side): **drag the ruler** → `{ bars }` (all tracks); **drag inside a track row** →
  `{ tracks:[id], bars }`; **click a track header** → `{ tracks:[id] }` (also sets the local
  `selectedTrack`). It pulls the current selection on connect and subscribes to the daemon's
  `selection` SSE event, so an agent-set selection shows up too (the reverse-pointing direction) —
  the orange band and header highlight reflect whatever the daemon holds.

### Mixer (`ui/src/components/MixerView.tsx`, new)

Every track's channel strip visible at once (not one-at-a-time like `SynthPanel`): a pan knob
(reusing the ported `Knob`), a vertical level fader, and mute/solo buttons.

- **Level + pan write through the same primitives the rest of `ui/` uses** — `GET /document` +
  `POST /edit` (`bridge.ts`), path `<id>.volume` / `<id>.pan`. A fader drag is a one-line `git diff`,
  exactly like a `SynthPanel` knob. `setValue` routes the edit to the synth block (synth/drums) or
  the instrument block (instrument tracks) by kind, so one path works for all track kinds; the
  optimistic mirror in `bridge.ts` was extended to match for instrument volume/pan.
- **Mute/solo are GUI-only session state** (a `mutes`/`solos` slice in the store, standard solo
  semantics via `isEffectivelyMuted`). The `.beat` format carries no mute/solo field, and real DAWs
  treat these as session state, not document state — so they are deliberately *not* persisted. Audio
  gating from them is deferred until the engine exposes a per-track mute hook (Stream A owns the
  engine; this stream doesn't touch it). Today they drive the strip's visual state.

## Files touched

- `ui/src/components/ArrangementView.tsx` (new)
- `ui/src/components/MixerView.tsx` (new)
- `ui/src/App.tsx` — view tabs + render switch; the editor screen factored into `EditorView` (no
  behavior change)
- `ui/src/state/store.ts` — `view`, `selection`, `mutes`, `solos` slices + `isEffectivelyMuted`
- `ui/src/daemon/bridge.ts` — exported `daemonBase`; added `postSelection` + selection SSE/pull;
  extended the optimistic edit mirror for instrument volume/pan
- `ui/src/types.ts` — concrete `BeatClip`/`BeatScene`/`BeatSongSection`/`BeatSelection` types +
  `AppView` (replacing the earlier `unknown[]` placeholders on `clips`/`scenes`/`song`)
- `ui/src/styles.css` — view-tab, arrangement, and mixer class blocks (existing CSS-variable
  conventions)
- `ui/verify-phase13.mjs` (new) — the end-to-end harness below

No changes to `ui/src/audio/engine.ts` (Stream A) or `ui/src/components/{NoteView,SynthPanel,
StepSequencer}.tsx` (Stream B). No changes to `src/`, `cli/`, `presets/`, `desktop/`.

## Verified live (not against mocks)

`ui/verify-phase13.mjs` boots a real `beat daemon` on a temp git repo holding
`examples/night-shift-song.beat` in current canonical form (a real multi-scene project: 4 tracks,
3 scenes, a 4-section / 20-bar song `intro(4) build(4) drop(8) intro(4)`), serves the built `ui/`
via `vite preview`, and drives it in headless system Chrome (playwright-core), same pattern as
Phase 12's `ui/verify.mjs`.

**[E] Real per-section track data on screen (not blank/placeholder).** On the Arrangement tab the
four section labels render `["intro","build","drop","intro"]`. Painted-pixel analysis of each track
row's canvas (alpha > 60, which excludes the faint backdrop/gridlines/dividers) over the left 40%
(intro+build), the middle 40% (drop), and the right 20% (final intro):

```
lead   left=0     drop=454   right=0      (plays ONLY in drop — scene drop: lead=hook)
drums  left=1088  drop=2176  right=0      (build+drop; absent from both intros)
bass   left=372   drop=735   right=0      (build+drop; absent from both intros)
pad    left=3768  drop=3767  right=1871   (every scene — pad is in intro/build/drop)
```

This is an exact match for the fixture's slot maps (`scene intro: pad`; `scene build: drums bass
pad`; `scene drop: lead drums bass pad`) — real per-section content, verified independently against
the parsed document. Screenshot `ui/verify-p13-arrangement.png`: the `lead` row is empty through
intro+build, shows red note ticks only inside `drop`, and is empty again in the final `intro`;
`drums`/`bass` start at `build`; `pad`'s chords render as continuous horizontal note bars from bar 0.

**[F] Drag-select → the daemon actually received it, confirmed on the CLI side.** Dragged bars 0-3
on the ruler in the GUI, then ran, against the *same running daemon*:

```
$ node cli/beat.mjs selection --port 8461
selection
  bars 0 4
```

A real round trip through `POST /selection` — the GUI drag reached the daemon and the CLI read it
back. Clicking the `bass` track header then narrowed the daemon's selection to `tracks ["bass"]`
(also verified). (Harness note: the daemon runs in the verify script's own process, so the CLI child
must be awaited async — a synchronous `execFileSync` would freeze the daemon's event loop and the CLI
couldn't reach it. Documented in the script.)

**[G] Mixer fader → correct one-line `.beat` diff.** Dragged `lead`'s level fader down in the GUI;
the daemon recorded the new volume and the file diff is exactly:

```
diff --git a/night-shift-song.beat b/night-shift-song.beat
-    volume -1
+    volume -25.75
```

One line changed, the `volume` field, nothing else. Toggling `drums`' mute updated `store.mutes` to
`{"drums":true}` (session state, as designed). Screenshot `ui/verify-p13-mixer.png`.

Repo suite after (`npm test` at root): **289 / 283 / 0 / 6** — unchanged baseline (`ui/` isn't in
this repo's own suite).

## Honestly deferred

- **Interactive zoom / horizontal scroll.** The detail/density LOD switch is automatic (container
  width ÷ total bars); there's no zoom slider or scrollable long-song timeline yet. The whole song
  fits the viewport width. Same scope-down the Phase 11 attempt made, for the same reason.
- **Per-lane selection inside the arrangement.** Supports whole-track and bar-range selection, not
  clicking an individual drum lane's sub-row (the product spec's "highlight the hi-hats" gesture).
  The `lanes` axis of the protocol is unused from this view (the step sequencer already does
  lane-level selection for the focused track).
- **Song-relative `bars`-axis resolution.** As `docs/phase-11-song-view.md` already flagged, the
  selection *value* round-trips correctly (verified above), but core's `selectionToVaryScope`
  resolves a `bars` window against a track's live loop steps, not song-timeline bar coordinates — so
  `beat vary --scope selection` on a multi-section bar drag doesn't yet vary the musically correct
  notes. That's `src/core` work, out of this GUI stream's scope.
- **Playhead in the arrangement view.** `currentStep` is loop-relative (mod `loop_bars`), not
  song-relative, so mapping it onto the song timeline is ambiguous in song mode; omitted rather than
  drawn wrong.
- **Mixer: audio-gating mute/solo, per-track meters, FX-chain visibility, sends.** Mute/solo are
  visual/session-only (no engine mute hook — Stream A owns the engine). No per-track level meters
  (the engine exposes only a master meter today). No insert/send/EQ visibility in the strip — the
  full `SYNTH_FIELDS` device surface is Stream B's expanded `SynthPanel`.
- **Instrument-track level/pan optimistic mirror** works, but the fixture has no instrument tracks,
  so that path is exercised only by the type/logic, not the live drive.

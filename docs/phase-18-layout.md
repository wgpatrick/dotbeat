# Phase 18 Stream Q — the Ableton-shaped layout recomposition

*2026-07-11. Anchor stream for the Phase 18 GUI redesign (`docs/phase-18-plan.md`), acting on
`docs/research/18-ableton-ui-architecture.md`. This stream is a **composition change, not a
rewrite**: every component this needed already existed and is reused verbatim — only where they live
and what reveals them is new. Result: 8/8 live headless checks green, `ui/` typechecks clean, root
`npm test` unaffected.*

## The finding this executed

Research 18's headline: **Ableton is not tabs.** It's one window with two always-present regions — a
main area that is unconditionally the Arrangement timeline, and a bottom detail pane that follows the
selection and toggles Clip View (edit the notes) ↔ Device View (edit the sound) via Shift+Tab.
dotbeat's old four-tab switcher (Editor / Arrangement / Mixer / History, each a full-screen peer) was
the specific anti-pattern to remove.

## What the layout is now

One window, top to bottom:

- **Top bar** — brand, the existing `TransportBar`, a compact master `Scope` (relocated from the old
  editor sidebar), and two chrome buttons: **Mixer** and **History**.
- **Main area (always visible)** — `ArrangementView`, promoted from one-of-three-tabs to the
  permanent main view. Each track row's header now carries an **inline channel strip**.
- **Bottom detail pane (follows selection)** — `data-testid="bottom-pane"`, with a **Clip / Device**
  toggle. Clip View is the note/hit editor for the track's kind (`StepSequencer` for drums,
  `NoteView` piano roll otherwise); Device View is the sound (`InstrumentPanel` for SoundFont tracks,
  `SynthPanel` otherwise). Toggled by **Shift+Tab** (Ableton's exact shortcut) or the Clip/Device
  labels. A ✕ collapses the pane; selecting any track re-opens it on that track.
- **Mixer** — the full all-strips `MixerView`, demoted from a peer tab to an **on-demand modal
  overlay** (research 18 Q3's "step back and balance" mode), reached from the top-bar Mixer button.
- **History** — `HistoryPanel` in a **slide-out right drawer**, not a peer screen, so it never
  competes with the bottom pane for space.

### How the composition works

`App.tsx` is the whole recomposition. It renders `ArrangementView` inside `.main-area` unconditionally,
`<BottomPane>` below it when a track is selected (there is always a selected track — `selectedTrackId`
falls back to the first — so the pane is available whenever it isn't explicitly collapsed), and the
Mixer overlay / History drawer conditionally on two new store flags. A single global `keydown`
listener maps **Shift+Tab** to `toggleBottomPane()`, yielding to form controls (the same
INPUT/SELECT/TEXTAREA guard `NoteView` uses) so it never hijacks the BPM box or a `<select>`.

State changes are **additive and UI-only**, in `ui/src/state/store.ts`:

| new field | purpose |
|---|---|
| `bottomPane: 'clip' \| 'device'` | which facet the detail pane shows (Shift+Tab / labels flip it) |
| `bottomPaneOpen: boolean` | whether the pane is docked open (✕ collapses; selecting a track re-opens) |
| `historyOpen: boolean` | History drawer open/closed |
| `mixerOpen: boolean` | full-Mixer overlay open/closed |

The old `view: AppView` four-tab enum and its `setView`/`VIEW_TABS` were removed; the `AppView` type
became `BottomPane` (`ui/src/types.ts`). No other file referenced them.

### The inline mixer strip (the one real extension)

`ArrangementView.tsx`'s track header changed from a single clickable button to a two-row header: a
name/select row on top, a compact **inline channel strip** below — mute (M), solo (S), a horizontal
volume slider with a dB readout, a pan slider with an L/C/R readout, and glanceable send badges
(Rv/Dl/Md) for the built-in reverb/delay/mod sends that are actually dialed in. `HEADER_W` widened
128 → 264 and `ROW_H` 44 → 56 to fit; all the arrangement's layout math keys off those constants, so
the canvas timeline, ruler, and playhead followed automatically.

**Crucially, this reuses `MixerView`'s exact data-flow, so no audio behaviour was lost.** Volume/pan
write the same `<id>.volume` / `<id>.pan` edit primitives (one-line `.beat` diffs). Mute/solo drive
the *same* store flags (`mutes`/`solos`) the engine already reads per tick via `isEffectivelyMuted`
to gate real audio (Phase 14 Stream E). The strip is a second view of that shared state — toggling
mute inline gates audio identically to toggling it in the full mixer, because the gate lives in the
engine reading the store, not in either component. A silenced row (muted, or another track soloed)
dims its lane/name while keeping M/S usable. The four tiny formatters (`trackVolume`/`trackPan`/
`fmtDb`/`fmtPan`) are duplicated locally rather than imported so `MixerView` stays untouched (it
remains the full-strip overlay).

`MixerView` is **kept, not deleted** — exactly as research 18 recommended: the inline strip is the
primary per-track surface, the full mixer is the optional all-strips overlay.

### VaryAffordance — verified unmodified

`VaryAffordance` was **not changed**. It reads the store's D2 selection and renders a contextual bar
whenever there's a selection, independent of any layout state — so it rides above the new workspace
untouched. Verified live (Q8 below): it triggers, auditions, and undoes on a selection with zero code
changes.

## Verification — `ui/verify-phase18-layout.mjs`

Headless Chromium against a real `beat daemon` on the real multi-track `examples/night-shift.beat`
(tracks: `lead` synth, `drums`, `bass` synth, `pad` synth). All 8 checks passed:

- **Q1 — arrangement is the persistent main view.** 4 `.arr-canvas` (one per track) present; **0**
  `.view-tab` (the four-tab switcher is gone).
- **Q2 — the inline strip gates REAL audio** (reused Phase 14 Stream E's decay-free RMS measurement,
  not a CSS-class check). Playing, baseline per-track peaks were `{lead:-120, drums:-4.5, bass:-4.4,
  pad:-7.5}` dB; muting the loudest (`bass`) via **its in-header strip button** drove its post-gate
  tap from **-4.4 dB → -120 dB (true silence)**, and the arrangement stayed the main view.
- **Q3 — Clip View follows selection.** Selecting `drums` shows the `StepSequencer` in the pane's Clip
  facet.
- **Q4 — Shift+Tab → Device View.** `store.bottomPane` became `'device'`, `.synth-panel` (drum bus /
  voice params) showed, the step grid was hidden.
- **Q5 — synth Clip View.** Selecting `lead` shows the `.noteview-grid` piano roll in Clip View.
- **Q6 — History drawer doesn't disrupt the main view.** Opening it mounts the drawer while all 4
  arrangement canvases stay mounted; closing it removes the drawer with the main view intact.
- **Q7 — full Mixer overlay.** Opens with all 4 channel strips; closes cleanly.
- **Q8 — VaryAffordance (unmodified) still works.** With `drums` selected its trigger read
  "≈ vary hats"; triggering entered the audition strip; Undo restored — proving it's selection-driven,
  not tab-bound.

### Screenshots (committed, `ui/verify-p18-*.png`)

- `verify-p18-arrangement.png` — the whole one-window layout: transport + compact scope + Mixer/History
  buttons up top; 4 arrangement rows each with an inline strip (M/S, volume+dB, pan+L/C/R, Rv/Dl send
  badges); **`bass` muted — its M button red and its lane visibly dimmed**; the `lead` piano-roll Clip
  View docked below with its Clip/Device toggle and "Shift+Tab toggles" hint.
- `verify-p18-clip-drums.png` — drum track selected, `StepSequencer` in Clip View.
- `verify-p18-device.png` — Shift+Tabbed to Device View: `drums` drum-bus/voice `SynthPanel`
  (Filter & Envelope, Amp & Output, Inserts).
- `verify-p18-clip-synth.png` — synth track piano roll in Clip View.
- `verify-p18-history.png` — the History drawer slid over the (still-mounted) arrangement.
- `verify-p18-mixer.png` — the full-Mixer modal overlay: all 4 channel strips with FX badges, pan
  knobs, faders + live meters, M/S, over a dimmed arrangement.

### Checks

- `ui/` typechecks clean: `npx tsc --noEmit` in `ui/` — no errors.
- Root `npm test` unaffected: **287 tests / 287 pass / 0 fail / 0 skip**. This stream touched only
  `ui/` files, which the root suite doesn't cover, so the suite equals its pre-Phase-18 baseline. (The
  plan's `290+/287+/0/3` target reflects Streams R and S adding tests; those streams are not in this
  worktree.)

## File ownership honored

Edited only: `ui/src/App.tsx` (full recomposition), `ui/src/components/ArrangementView.tsx` (inline
strip), `ui/src/state/store.ts` (additive UI state), plus `ui/src/types.ts` (the `AppView`→`BottomPane`
type swap) and `ui/src/styles.css` (new chrome). **Untouched and reused as components:** `MixerView`,
`NoteView`, `StepSequencer`, `SynthPanel`, `InstrumentPanel`, `HistoryPanel`, `VaryAffordance`, `Scope`,
`TransportBar`. Not touched: `ui/src/audio/engine.ts`, `src/core/document.ts`, `presets/`, `cli/`,
`src/mcp/server.ts` (other streams' territory). `TrackList` is no longer rendered — the arrangement
track headers are the track list now (Ableton's model); the component file remains for reference.

## Deliberately deferred (Phase 18's *next* round, per the plan — not this stream)

- **Automation-lane UI** — the inline "<Track> / <Parameter>" picker + draggable breakpoint curve over
  each arrangement track row. It needs this stream's restructured track-row shape to exist first, which
  it now does.
- **Browser sidebar UI** — consuming Stream S's new preset `category` taxonomy to drag/browse presets
  onto tracks. Needs a dock location in the new layout.
- **Macros** — research 18's "tooling that resolves to literal edits" recommendation; its natural home
  is inside the new Device View pane, which now exists. A sized subsystem for its own stream.
- **Clip-over-Device stacking** — research 18 lists Ableton's stacked (both-visible) mode as optional
  polish; dotbeat ships the mutually-exclusive toggle for v1.
- **Pane resize by drag** — the bottom pane is a fixed 42vh; Ableton's drag-the-top-border resize is
  deferred.

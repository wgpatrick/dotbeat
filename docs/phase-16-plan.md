# Phase 16 — closing the remaining deferred polish items

*Kicked off 2026-07-11, immediately following Phase 15. With both product-defining surfaces
(versioning, vary-and-audition) now real, the remaining gaps across Phases 12-15 are smaller,
enumerable polish items rather than missing capabilities. Two streams, consolidating the
"honestly deferred" lists from every prior Phase-13/14/15 result doc.*

## Stream J — selection granularity + history display + note editing polish

1. **Lane-granular selection for the vary affordance** (Phase 15 Stream I's own deferred item):
   `StepSequencer.tsx` doesn't currently post a lane-level selection when a user clicks/interacts
   with an individual drum lane (hat/kick/snare/etc.) — the daemon's `/vary` route already infers
   and enforces a group from a lane selection (`resolveVaryTarget` in `src/daemon/daemon.ts`, read
   it), it's just never populated from this click gesture. Wire it: clicking a lane label (not a
   step — that's the existing toggle gesture) posts `{tracks: [id], lanes: [laneName]}` via the
   existing `postSelection` (see `ui/src/daemon/bridge.ts` / how `ArrangementView.tsx` already
   calls it). Verify: click the hat lane, trigger vary via `VaryAffordance.tsx`, confirm the
   resulting batch is actually scoped to hats specifically (check the variant params only touch
   `hatTone`/`hatDecay`/etc., not kick/snare fields).
2. **Collapsed history view** (Phase 15 Stream H's deferred item): `src/history/history.ts`
   already exports a `collapsedHistory()` function (per Stream H's own report) that
   `HistoryPanel.tsx` doesn't use yet — wire it in, following `docs/product-spec-desktop.md` §4's
   spec ("unnamed checkpoints collapse between named pins... a long timeline still skims"). Add a
   toggle if a flat view is still sometimes useful, your call.
3. **Velocity-drag in the piano roll** (Phase 13 Stream B's deferred item): `NoteView.tsx`
   supports add/move/resize but not a velocity-drag gesture (e.g. vertical drag on a note, or a
   dedicated velocity lane) — add one, writing through the existing `<track>.note.<id>.velocity`
   edit path (`src/core/edit.ts`'s note grammar, already built).

Owns: `ui/src/components/StepSequencer.tsx`, `ui/src/components/HistoryPanel.tsx`,
`ui/src/components/NoteView.tsx`. Verify each item live (headless Chromium, this repo's
established `ui/verify*.mjs` pattern).

## Stream K — instrument track completeness + insert-chain reordering

1. **Instrument-track meters + mute/solo gating** (Phase 14 Stream F's own deferred item):
   `ui/src/audio/engine.ts`'s `getTrackLevel()` currently returns `null` for instrument tracks
   (no meter tap wired), and `applyMuteGates()` only gates `this.chains`/the drum bus, not
   `this.instruments`. Wire both: add a level tap to each instrument voice's output chain (same
   `Tone.Analyser`-based pattern the synth/drum chains already use — read `buildSynthChain`'s
   `levelTap` setup for the exact pattern), and extend `applyMuteGates()` to also gate instrument
   voices. Verify the same way Phase 14 Stream E did: mute an instrument track, confirm its level
   tap reads true silence (not just that a button toggled).
2. **Insert-chain reordering in the UI** (Phase 13 Stream A's deferred scope, "reorderable insert
   order" — the engine's insert chain is currently fixed-order EQ→comp→distortion→bitcrush;
   check whether `SYNTH_FIELDS`/the format actually models insert *order* as data, or only fixed
   per-effect params — if the format has no order field, this item reduces to "not currently
   buildable without a format change," and the right move is to document that plainly rather than
   force a UI for a capability the data model doesn't support. Read `src/core/document.ts` first
   and make the call.
3. **FX-chain visibility in the mixer** (Phase 13 Stream C's deferred item): `MixerView.tsx`
   currently shows level/pan/mute/solo per strip — add a compact indicator of what's in a track's
   insert chain (e.g. small icons/labels for active EQ/comp/distortion/bitcrush, reading the same
   `SYNTH_FIELDS` data `SynthPanel.tsx` already renders in full) so the mixer gives an at-a-glance
   sense of processing, not just level.

Owns: `ui/src/audio/engine.ts` (additive — instrument meter taps + mute gating extension),
`ui/src/components/MixerView.tsx`. Verify live with real measurements (mute → silence, same
evidence bar Phase 14 Stream E set).

## Process

Same worktree pattern. Stream J and K touch disjoint files except both may lightly touch
`ui/src/state/store.ts` if new state is needed (additive, low risk). `npm test` must stay green
(293+/287+/0/6) throughout — neither stream should need to touch anything the root suite covers.

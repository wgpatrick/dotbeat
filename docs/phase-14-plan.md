# Phase 14 — closing the honest gaps Phase 13 left open

*Kicked off 2026-07-11, immediately following Phase 13's Result. Owner is away for an extended
period; this continues the same take-stock-then-build discipline without waiting for check-in.
Three streams, picked directly from Phase 13's own "honestly still open" list.*

## Stream E — live playback feedback: mixer audio-gating + meters + arrangement playhead

Two related, already-half-built gaps: `ui/src/state/store.ts` already computes
`isEffectivelyMuted` (standard mute/solo semantics) and `ui/src/components/MixerView.tsx` already
has working mute/solo buttons — but per their own code comments, "audio gating from these is
deferred until the engine exposes a per-track mute hook." And `ArrangementView.tsx` (Phase 13
Stream C) renders a static song timeline with no indication of where playback currently is.

1. **Wire mute/solo to actually gate audio** in `ui/src/audio/engine.ts` (Phase 13 Stream A's
   engine): read `isEffectivelyMuted`/the store's `mutes`/`solos` state per track per tick (or via
   a subscription, your call on the cleanest hook point) and gate the track's output accordingly.
   Verify with a real measurement: render/play a project with one track muted, confirm via the
   master analyser or a per-track level check that the muted track's contribution is actually
   gone (not just that the button visually toggled).
2. **Per-track meters in the mixer** — each channel strip shows its own live level, not just the
   master `Scope`. Follow the established rendering discipline from `docs/research/15-desktop-
   frontend-architecture.md` §2: this is continuous-rate data, so it must NOT go through
   Zustand/React state per frame — use the shared throttled rAF driver already built at
   `ui/src/audio/animationFrame.ts` (Stream 1) and read levels via refs/direct engine taps, the
   same pattern `Scope.tsx` already established. Do not build a second rAF loop.
3. **Arrangement-view playhead**: a moving indicator over `ArrangementView.tsx`'s canvas tracking
   real playback position (bar-granularity is fine — this doesn't need to be frame-accurate, just
   real). Reuse the existing `currentStep`/song-position state the editor's step-sequencer
   playhead already reads (`ui/src/audio/engine.ts`'s `Tone.getDraw()` pattern, ported in Phase
   12 Stream 1) rather than inventing a second position-tracking mechanism.

Owns: `ui/src/audio/engine.ts` (additive — mute/solo gating hook), `ui/src/components/
MixerView.tsx`, `ui/src/components/ArrangementView.tsx`. Verify live (headless Chromium, the
established pattern every prior `ui/` stream has used) — real audio/meter evidence, not just "the
code compiles."

## Stream F — instrument (SoundFont) track playback in the live engine

The one deliberately-deferred piece of Phase 13 Stream A's engine port: `ui/src/audio/engine.ts`
currently skips instrument tracks entirely (`if (track.kind !== 'synth') continue`). This means
none of Phase 12 Stream 2's 36-preset library's SoundFont content (`presets/sf2/*`, real FluidR3
GM + MuldjordKit banks) or any instrument track can actually be heard in the GUI — a real, visible
gap given how much work went into that content.

**Read the existing (offline, Node-side) reference implementation first**: `cli/render-
offline.mjs` around line 343-370 uses `spessasynth_core`'s `SpessaSynthProcessor` to render
instrument tracks *outside* the Tone.js graph entirely (a separate audio-generation path, mixed in
afterward) — this is NOT directly portable to a live, real-time browser engine (it's an offline
processor). The root `package.json` also lists `spessasynth_lib` (note: `_lib`, not `_core`) as a
dependency — this is the browser/real-time-capable variant, seemingly unused anywhere in the
codebase yet (confirm this by searching; it may be intended for exactly this job, or may need
fresh integration work). Also check BeatLab's own `engine.ts`/`store.ts` (clone fresh or reuse an
idle checkout) for whether it has ANY instrument/SoundFont live-playback wiring already — Phase 8
shipped "master-bus routing for instrument audio in the offline render" per `docs/phase-8-plan.md`,
so check whether that extended to BeatLab's live engine too, which would make this a port rather
than a from-scratch integration.

1. Get `spessasynth_lib` (or whatever the right real-time-capable path turns out to be after your
   research above) producing actual audio for an instrument track inside `ui/`'s Tone.js-based
   engine, driven by the same document data (`track.instrument.sample`/`program`) the CLI path
   already reads.
2. Wire it into the master bus alongside synth/drum tracks (level/pan at minimum — full FX-chain
   parity for instrument tracks is not required this stream, say so if deferred).
3. Build a basic instrument-track param UI in `ui/src/components/SynthPanel.tsx` (or a new
   component if that's cleaner) replacing the current placeholder ("editing surface is a later
   stream") — at minimum, program/preset selection reusing the multi-preset listing machinery
   (`beat inspect` already lists a bank's programs server-side; expose that through a daemon route
   if one doesn't exist, or reuse `GET /document` if the program list is derivable from it).
4. Verify with real audio: play a project with an instrument track pointed at the real FluidR3 GM
   bank, confirm via the master analyser that sound is actually produced (not silence), and ideally
   confirm the specific program/instrument selected is audible as a different timbre than another
   program (a spectral-centroid comparison via `src/metrics`, same evidence style Phase 12 Stream 2
   used to verify its presets, is a good bar here if you can render/capture output).

This is a genuinely uncertain-scope technical lift — budget real research time before committing
to an implementation approach, and it's fine to ship a real-but-partial result (say plainly what's
proven vs. stubbed) rather than force full fidelity in one stream.

Owns: `ui/src/audio/engine.ts` (additive instrument-track handling — coordinate mentally with
Stream E's mute/solo hook, both touch this file but in different functions; a small merge
conflict here is plausible and acceptable, same as every prior phase), `ui/src/components/
SynthPanel.tsx` or a new instrument-panel component, possibly one small additive daemon route in
`src/daemon/daemon.ts` if program-listing needs server support (run full `npm test` if you touch
this file).

## Stream G — hygiene pass: test coverage + Tauri robustness

Smaller, disjoint cleanup items flagged across Phase 13's streams:

1. **Unit test the note-write grammar** Phase 13 Stream B added to `src/core/edit.ts`'s
   `setValue` (the `<track>.note` / `<track>.note.<id>.<field>` / delete paths) — it shipped with
   real GUI end-to-end coverage but no `test/` file. Add one, following this repo's existing
   test conventions (see `test/` for the pattern — likely alongside wherever `setValue`'s other
   paths are tested).
2. **Bundle a starter/example project** into the Tauri app for a repo-less install — right now
   launching the packaged app with no project folder chosen has no obvious "try it" path; ship one
   small example `.beat` project (reuse `examples/night-shift.beat` or similar) that a fresh
   install can open by default.
3. **Fix the sidecar-orphan-on-force-quit issue** Phase 13 Stream D documented but didn't fix
   (the daemon sidecar isn't killed if the app is force-quit rather than closed normally) — look at
   Tauri's process-lifecycle hooks for a cleaner kill-on-exit guarantee than the current
   window-close-event-only cleanup.

Owns: one new/extended file under `test/` (Stream E/F don't touch `test/`), `desktop/` (disjoint
from Streams E/F, which are `ui/`-only plus at most one shared daemon route). Run the FULL
`npm test` after the `src/core` test addition and confirm 290+/284+/0/6.

## Process

Same worktree-per-stream pattern. E and F both touch `ui/src/audio/engine.ts` — real, acceptable
collision risk (different functions: mute/solo gating vs. instrument-track synthesis), handled at
merge time same as every prior phase. G is fully disjoint. `npm test` must stay green throughout.

## Result (2026-07-11)

All three streams shipped and are merged into `main`. Final suite: **293 tests, 287 passing, 0
failing, 6 skipped** (Stream G's 4 new note-grammar tests, no regressions).

- **Stream E**: mute/solo now genuinely gates audio — a dedicated `muteGain` node upstream of the
  panner fan-out (so dry path and sends are silenced together), read per-tick from the store's
  `isEffectivelyMuted`. Measured: muting drives a track's own level tap to **-120 dB (true
  silence)**; soloing drops master RMS by a clean, measurable delta the limiter can't mask. Added
  real per-track mixer meters (shared rAF driver, `Scope.tsx`'s established discipline, RMS not
  `Tone.Meter` specifically because peak-hold decay would have made the silence test lie) and a
  verified arrangement-view playhead reusing the existing `currentStep` tracking.
- **Stream F**: instrument/SoundFont tracks now actually play — wired the previously-unused
  `spessasynth_lib` dependency into the live engine (a real, non-trivial integration: pinned Tone
  to a native `AudioContext` to resolve a conflict between spessasynth's native `AudioWorkletNode`
  and Tone 15's standardized-audio-context wrapper). Verified with real audio: FluidR3 GM program
  73 (Flute) produces real signal (−22.2 dBFS peak, not the silent-failure mode the offline render
  path has), and switching to program 56 (Trumpet) shifts spectral centroid by a measured 78.9%
  (693 Hz → 1596 Hz) — the selected instrument audibly changes the sound, not just in principle.
  Added a `GET /soundfont-presets` daemon route and a real instrument-track param panel replacing
  the placeholder. **Merge required manual conflict resolution** against Stream E (both touched
  `ui/src/audio/engine.ts`'s `sync()` tail) — resolved by hand (both `applyMuteGates()` and
  `syncInstruments()` now run each tick), re-typechecked clean.
- **Stream G**: added the note-grammar unit tests Phase 13 Stream B's addition to `src/core/
  edit.ts` shipped without; bundled `night-shift.beat` into the packaged Tauri app as a first-open
  default (no more "blank app, no obvious next step"); fixed the sidecar-orphan-on-force-quit gap
  with a detached watchdog process, verified with a real `kill -9` + PID check (daemon confirmed
  gone within the watchdog's ~1s poll window, no leftover watchdog process either).
- **Honestly still open**: instrument tracks have level/pan but no FX chain, no meter tap, and no
  mute/solo gating yet (format has no FX fields for instruments; the meter/mute gap is a small,
  clearly-scoped follow-up per Stream F's own doc); meter ballistics are plain per-frame RMS with
  no peak-hold; only macOS arm64 has been built/verified for the Tauri shell.

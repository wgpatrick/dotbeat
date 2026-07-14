# 101 — Vocal-chop session findings: one-drums-track engine limit, dual lane-sample mechanisms

**Source:** live song-building session, 2026-07-13/14 (owner + agent building `examples/first-light.beat`
over the CLI — not a scripted pilot, but the same "real end-user goal, real surprises" footing as the
research/94-100 pilot series). The goal was Tourist-style chopped vocals; the owner's report was
simply *"i can't really hear any of it"* — which turned out to be two real product gaps, not a mix
problem.

## Finding 1 — the engine wires only the FIRST drums-kind track (silent data loss)

`Engine.sync()` does `doc.tracks.find((t) => t.kind === 'drums')` (`ui/src/audio/engine.ts`, sync's
drum section): one drums track, the first in document order, gets the drum bus / lane dispatch
table. Any additional drums-kind track parses fine, edits fine, inspects fine — and never makes a
sound. Nothing warns: not add-track, not the GUI, not lint, not the render.

Observed live: a second drums track (`vox`, carrying sample-backed vocal-chop lanes) rendered as
pure silence across three full-song renders before the cause was found in engine source. The format
happily allows N drums tracks; the engine's contract (one, first-wins) exists only as an
implementation detail.

**Cost when hit:** hours of confused iteration — velocity/volume/EQ changes on a track that was
never in the graph at all. The failure reads exactly like "my mix choices are bad," not "this track
does not exist."

**Fix directions (pick one deliberately):**
- Real multi-drum-track support in the engine (per-track drum bus + lane maps — the honest fix,
  sized like a phase stream, touches sync/tick/mute-solo/sends), or
- make the constraint LOUD: `beat add-track <id> drums` on a doc that already has a drums track
  should at minimum warn (CLI + GUI + lint), and `beat lint --doc` should flag hits on a
  never-wired drums track as findings.

## Finding 2 — two lane-sample mechanisms; the engine honors only one (fixed at the CLI layer)

Two ways a `.beat` file can say "this drum lane plays a sample":

1. **legacy `laneSamples` record** (v0.5) — what `beat lane` wrote; closed to the 5 legacy lanes.
2. **declaration backing** (v0.10) — `lane <name> sample <id> <gain> <tune>` in the track's `lanes`
   list; what the GUI writes and the ONLY thing `syncDeclaredDrumLanes` reads on a declared-lane
   track.

On any v0.10 track (every track `beat add-track` has created since the 12-lane kit landed), a
`beat lane` assignment therefore changed the file but not the audio, and the 7 non-legacy lane
names (`rimshot`, toms, `crash`, `ride`, `cowbell`) were rejected outright by `setLaneSample`'s
closed-5 validation even though `addHit` already accepted them.

**Fixed this session** (commit "beat lane: write declaration backing on v0.10 declared-lane
tracks"): `laneCmd` routes to `setLaneBacking` when the track declares lanes (`none` reverts to the
default kit's synth voice); legacy tracks keep the old path bit-for-bit.

**Still open (the backlog part):** a file can carry legacy `laneSamples` entries on a declared-lane
track — written by an older CLI or by hand — that silently do nothing (our `vox` track had exactly
this shape before it was retired). Parse accepts them, the engine ignores them, nothing reports the
conflict. Either migrate them into declaration backing at parse/load time, or have lint flag them.

## Also fixed along the way (context, not backlog)

Same session, committed on the branch: `beat render` losing the first ~250ms (recorder armed after
playback started), and `recordWav` truncating long renders on slow machines (capture gated on
wall-clock time instead of audio time). Both were exposed by the owner listening to real renders —
the same lesson as every pilot doc: scripted checks verify what we already believe; a person with a
goal finds what we didn't think to assert.

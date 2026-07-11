# Research 12 — How DAWs represent drum events (v0.8 grounding)

*2026-07-11. Deep-research pass: 106 agents, 5 angles → 24 sources → 111 claims → top 25
adversarially verified → **25 confirmed, 0 refuted** (every claim 3-0 against primary sources:
vendor manuals, format specs, on-disk file inspection). The cleanest sweep of any pass so far.
Decides `docs/format-v08-drums-design.md`.*

## The unanimous verdict

**Every mature system stores drum hits as free-timed events; the step grid is a view/input
layer, never the storage model. No shipped tool uses dual storage.** Candidate B (pattern +
overflow hits) is dead; candidate A (hit lines as ground truth) is confirmed as the industry
shape.

## Verified findings

1. **Ableton Live** *(3-0, Live 11 manual)*: notes carry pitch/position/length/velocity at
   arbitrary time; the grid is "magnetic" snapping that Alt/Cmd bypasses; off-grid notes keep
   their offset relative to the grid so movements *preserve the groove*. Live 11+ puts
   **probability (0–100%) and velocity-range per note event** (serialized as
   `VelocityDeviation` in .als) — expressiveness lives per-event, not per-pad.
2. **FL Studio** *(3-0, official manual)*: the canonical migration example. Step sequencer and
   piano roll share ONE note store — "The Stepsequencer overlays the Piano roll"; steps ARE
   zero-length on-beat notes; the grid renders only when notes conform; converting back
   "discards note lengths" (explicitly lossy). Notes are free-timed at tick granularity
   (per-project PPQ 96–960; lowering PPQ mid-project forcibly repositions off-grid notes —
   **resolution choice is a lossiness decision**). Per-event extras: Shift (microtiming),
   Repeat (ratchet), velocity, pan, release, fine pitch ±100 cents.
3. **Standard MIDI File** *(3-0, MMA spec + mirrors)*: the reference event list — file-level
   PPQ, variable-length delta-times in ticks, 7-bit velocity per Note On. No grid exists in
   storage. GM percussion = pitch-mapped pads on channel 10; **note-offs are irrelevant for
   one-shots** — confirming `hit` lines need no duration.
4. **Hydrogen** *(3-0, verifiers cloned the official pattern repo and read files)*: the direct
   text-format precedent. `.h2pattern` XML = flat `<noteList>` of `<note>` events with integer
   tick `<position>` (192/bar = 48 PPQ), per-note velocity/leadlag/pan/pitch, `length=-1` for
   one-shots. The official **"funky drummer" pattern has snare hits at ticks 147/150/153 —
   off the 16-slot grid — coexisting happily with the step-sequencer UI.** Git-friendly text
   with general drum timing is proven practice, not a bet. (Caveat: Hydrogen 1.3+ adds
   per-note `<probability>` — the Live 11 convergence again.)
5. **Trackers (XM/MOD/S3M/IT)** *(3-0, format specs + OpenMPT manual)*: the counterexample —
   pure row grids with per-cell modifier commands (EDx note delay, Rxy/Qxy retrigger ramps)
   for sub-row timing. Expressive but bounded and grid-coupled; the weaker model. Their one
   good idea worth stealing later: **ratchet as a per-event attribute** (also FL's Repeat).

## What the synthesis decides for v0.8 (adopted in the design doc)

- **Hits as ground truth, grid as view** — candidate A, unchanged.
- **Timing unit: decimal steps, NOT ticks.** The research frames resolution as the lossiness
  knob (PPQ 96–960 convention; Hydrogen's 48 provably coarse at extremes). Our v0.7 canonical
  decimals give 1/10,000 of a step ≈ 2,500× finer than 960 PPQ, stay human-readable in diffs,
  and match note lines exactly. The "should it be rational text?" open question resolves:
  we already are.
- **No duration on hits** (SMF one-shot convention + Hydrogen `length=-1`). If choke/gate ever
  needs it, an optional trailing token adds back compatibly under canonical elision.
- **Per-event future extras have converged precedent**: probability + velocity-range
  (Live 11, Hydrogen 1.3) and ratchet (FL, trackers) go ON the hit line when we add them;
  choke groups/round-robin are per-kit (inference, unverified — revisit before building).
- **Migration**: slot *i* at velocity *v* → hit at start *i* (+16 per bar, replicated across
  loop_bars — hits are absolute over the loop, like notes; patterns were per-bar cycles).
  Lossless by construction, matching FL's steps-are-events equivalence.

## Coverage gaps (honest)

No claims survived on Logic/Bitwig/Reaper storage, .als KeyTracks serialization details,
groove-pool non-destructive swing mechanics, or flams/choke/round-robin placement — all
tracked as open questions in the design doc; none block v0.8's grammar.

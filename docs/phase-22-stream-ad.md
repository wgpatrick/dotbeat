# Phase 22 Stream AD — Pitch & Time, groove/shuffle, per-note chance/ratchet/micro-tuning

Four related, format-level additions to note editing (`docs/research/18-ableton-ui-architecture.md`'s
Clip View "Pitch & Time" row, `docs/research/22-opendaw-editing-workflow.md` §3.2/§3.3): the six
Ableton-style Pitch & Time operations as one-shot CLI/MCP edit primitives, groove/shuffle as a
reversible playback-time warp, per-note `chance` (probabilistic trigger), and per-note
ratchet/repeat + micro-tuning (`cent`). Format version bumped `0.9` -> `0.10`.

## What was built

### 1. Pitch & Time operations (`src/core/pitchtime.ts`)

Six one-shot operations matching `quantizeNotes`' exact shape: pure `document -> document`, scoped
to a track's notes (optionally narrowed to a `noteIds` selection — the same vocabulary
quantize/humanize already use), rewriting literal `note` lines. None of them are persisted as
clip/track state.

- `transposeNotes` — shift pitch by N semitones, **clamped** to MIDI 0-127 (Ableton's own behavior,
  not an error).
- `timeScaleNotes` — the Stretch knob's ×2/÷2 buttons, generalized to any positive factor, anchored
  at the earliest scoped note so a selected phrase stretches in place.
- `fitToScaleNotes` — snaps pitch to the nearest tone in a 13-scale table (major, natural/harmonic/
  melodic minor, the modes, two pentatonics, blues); ties resolve to the lower pitch (documented,
  deterministic).
- `invertNotes` — mirrors pitch around an axis; defaults the axis to the scoped notes' own mean
  pitch when omitted (Ableton's Invert has no separate axis control either).
- `reverseNotes` — a real tape-reverse: each note's `[start, start+duration)` interval reflects
  around the scoped span's midpoint, so playback order flips (not just start points). Its own
  inverse (reversing twice restores the original — unit-tested).
- `legatoNotes` — extends/shortens each note to the next note's start, time-ordered regardless of
  pitch (matches Ableton's own simple behavior); an optional `gap` leaves a small silence instead.

`beat humanize` already covered the Ableton panel's "Humanize Amount" row — not reimplemented here.

**CLI**: `beat transpose|time-scale|fit-scale|invert|reverse|legato <file> <track> ... [--notes id,id]`,
plus `beat fit-scale --list-scales`. **MCP**: `beat_transpose`/`beat_time_scale`/`beat_fit_scale`/
`beat_invert`/`beat_reverse`/`beat_legato`. **No new daemon route** — this matches `beat quantize`'s
own actual precedent (it has none either): the generic `POST /edit` `{path,value}` channel already
covers everything grammar-level these operations touch, and none of them need a daemon-specific
shape the way `/vary` or `/automate` do.

### 2. Groove/shuffle (`src/core/groove.ts`)

Two literal track-level fields, `shuffleAmount` (0..1, default 0 = off) and `shuffleGrid` (positive
16th-step subdivision, default 1), applied **at read/playback time** via `warpStep`/`unwarpStep` —
never baked into stored note/hit `start`. This is the load-bearing design choice research 22 §3.2
flagged: openDAW models groove as a pluggable MIDI-effect device that warps positions live via a
reversible `warp()`/`unwarp()` pair, which fits dotbeat's existing "quantize is an operation you
choose when to apply, not a storage default" philosophy far better than a destructive per-note
swing offset would.

The warp math is openDAW's own (`moebiusEase`, a fractional-linear/Möbius ease curve — vocabulary
and shape read from source, reimplemented, not copied; see the research doc's license note),
adapted so dotbeat's `shuffleAmount=0` is a TRUE identity (openDAW's own field defaults to a
already-shuffled 0.6; dotbeat's canonical-elision contract needs 0 to mean nothing at all
happens). `unwarpStep` is verified to be the *exact* inverse of `warpStep` for the same
`(amount, grid)` — not just asserted, round-trip-tested across a grid of amounts/grids/positions
in `test/groove.test.ts`.

**Scope: track-level, not per-clip/per-note.** openDAW's own model allows groove "per-track or even
per-chain-position" since it's just another effect-chain slot. dotbeat has no effect-chain-position
concept yet, so track is the smallest addressable unit that's still a real per-part musical choice
(drums shuffle, bass stays straight) without inventing a new scoping concept. Set via the existing
`beat set <track>.shuffleAmount <v>` / `<track>.shuffleGrid <v>` grammar — no new CLI verb needed.

**Format**: a `groove <amount> <grid>` line, one per track, entirely elided while `amount` is 0 (so
every pre-v0.10 file parses unchanged).

**Engine**: `ui/src/audio/engine.ts` hand-mirrors `warpStep`/`moebiusEase` (ui/ has no build-time
dependency on `src/core` — see the file's own header note on this convention, already used for
`lfoSyncRateHz`) and applies it when scheduling **synth and instrument track notes**. Drum-hit
scheduling is untouched this stream — sibling stream AB was simultaneously rewriting drum playback
in the same file (see the Result section below).

### 3. Per-note `chance` (`src/core/chance.ts`)

A 0-100 int field on `BeatNote` (canonical elision: absent/100 = always fires, today's behavior).
Re-rolled via a seeded RNG — `chanceFires(chance, pass, trackId, noteId)`, mulberry32 (the same
tiny PRNG `humanize.ts`/`vary.ts` already use) seeded by an FNV-1a fold of a per-loop-cycle `pass`
counter plus the track/note id — **once per playback pass**, not baked once. `pass` is derived in
the engine from the raw (non-modulo) transport tick count divided by the loop/song's total step
count, so a note is re-evaluated fresh every time the loop comes back around.

Verified directly against the seeded sequence rather than by rendering audio repeatedly (the task's
own documented alternative to a statistical render check): `test/chance.test.ts` asserts chance=100
always fires, chance=0 never fires, the same `(pass, track, note)` triple is reproducible, different
notes/tracks/passes draw independently, and — the verification bar's statistical requirement —
chance=50 and chance=70 land within a tight band of their expected rate over 2000 seeded passes.
`scripts/verify-phase22-stream-ad.mjs` re-runs the 50%-over-1000-passes check as a live, CLI-adjacent
check outside the unit-test harness.

### 4. Ratchet/repeat + micro-tuning (`src/core/pitchtime.ts`'s `ratchetSlots`/`consolidateRatchet`)

**Ratchet**: three fields — `ratchetCount` (1-16, default 1 = no ratchet), `ratchetCurve` (-1..1,
default 0 = even spacing), `ratchetLength` (0 exclusive..1, default 1 = fills its slot) —
deliberately the richer 3-field shape research 22 recommends over openDAW's own 2-field
`play-count`/`play-curve` (their own team is mid-refactor toward a `length`-ratio field, per the
research doc's direct source read). `ratchetSlots(count, curve, length, noteDuration)` is the one
pure function that turns those four numbers into concrete repeat offsets/durations — an exponent
warp on the repeat-index fenceposts (`k = 1+curve*3` front-loaded, `k = 1/(1-curve*3)` back-loaded,
continuous through `k=1` at `curve=0`). Both the live engine (hand-mirrored, same convention as
groove) and `consolidateRatchet` call the identical shape, so playback and consolidate always agree
— verified directly in `test/pitchtime.test.ts` (`consolidateRatchet`'s output literally checked
against `ratchetSlots`' own return value) and re-verified live via the CLI in
`scripts/verify-phase22-stream-ad.mjs` (a 4-step note with `count=4, curve=0, length=1` consolidates
to exactly four 1-step notes at steps 2,3,4,5 — an exact, hand-computed expectation, not a fuzzy
check).

**Consolidate** (research 22 §3.3's "Consolidate" menu action): `beat consolidate` /
`beat_consolidate` bakes a ratcheted note back into `ratchetCount` discrete, plain notes (copying
pitch/velocity/chance/cent, minting fresh `u<n>` ids, removing the source note). A scoped note that
isn't ratcheted is left alone — a no-op, the same "already at rest" stance `beat quantize` takes for
on-grid notes.

**Micro-tuning**: a `cent` float field (±50), independent of the semitone `pitch` field, applied as
a frequency offset (`freq *= 2^(cent/1200)`) at trigger time for **synth-track** notes.
**Instrument-track (SoundFont) notes do not apply `cent` yet** — see Result below.

### Format changes (`docs/format-spec.md`'s new "v0.10 additions" section)

- Five new optional per-note fields as trailing `key=value` tokens on a `note` line
  (`chance`/`cent`/`ratchetCount`/`ratchetCurve`/`ratchetLength`), each independently
  canonical-elided (present iff != default), parsed in any order but always re-serialized in one
  fixed canonical order.
- One new track-level `groove <amount> <grid>` line, elided entirely at `amount=0`.
- `format_version` bumped to `0.10`; every `0.9` file parses unchanged (every addition is
  elision-by-default or purely additive — no existing grammar changed shape).

### GUI (`ui/src/components/NoteView.tsx`)

A small per-note inspector panel, shown when exactly one note is selected: `chance`, `cent`,
`ratchetCount` always visible; `ratchetCurve`/`ratchetLength` appear once `ratchetCount > 1`. Each
field commits through the existing `<track>.note.<id>.<field>` `postEdit` path (the same channel
drag/resize/velocity already use), so a typed value is a one-line diff like everything else in this
file. **The six Pitch & Time operations and Consolidate are CLI/MCP-only this pass** — no
piano-roll menu/buttons — an honest scope call given the GUI-wiring cost vs. the rest of this
stream's surface area (see the roadmap's `gui` column for each row).

## Design decisions worth flagging

- **Note fields required, not optional, in the `BeatNote` TypeScript type** (`chance`/`cent`/
  `ratchetCount`/`ratchetCurve`/`ratchetLength` all always present with a concrete value in
  memory), matching the house pattern `BeatSynth`'s v0.3 fields already established: elision is a
  *serialization* concern, not a type concern. A handful of test fixtures that build `BeatNote`
  literals by hand needed the five new fields added (`test/roundtrip.test.ts`,
  `test/instrument-clips.test.ts`) — a one-time, contained cost caught immediately by `tsc`, not a
  design smell.
- **`shuffleH`'s amount=1 edge case**: `moebiusEase(x, h)` has a genuine pole at `h=1` (every
  `x != 0` collapses to `1`, not a "maximally shuffled" curve). `shuffleAmount=1` (the dial's far
  end) is capped to `h=0.999` rather than `h=1.0` so the strongest setting still produces a real,
  strongly-shuffled curve instead of silently degenerating toward a no-op — caught by
  `test/groove.test.ts`'s directional test, not assumed.
- **Ratchet's per-repeat filter-envelope retrigger**: wiring ratchet into the synth-track note loop
  means each repeat re-triggers its own filter-envelope pluck (keytracking/velocity-shift/env
  sweep), not one envelope stretched across the whole ratcheted note. `ratchetCount<=1` (the
  overwhelmingly common case) reduces the loop to exactly one iteration, so this is additive and
  changes nothing for any note that isn't ratcheted.

## Result — what's honestly incomplete

- **GUI**: the six Pitch & Time operations and Consolidate have no GUI surface at all (CLI/MCP
  only). Groove has no GUI knob. chance/cent/ratchet* have a small inspector panel but no
  piano-roll visual indicator (e.g. a chance note drawn lighter, a ratchet note drawn subdivided)
  and no draw-across-multiple-notes gesture (research 22 §1.4's `PropertyDrawModifier` reference,
  explicitly filed away as future work in that research doc already). See `scripts/roadmap-data.mjs`
  for the row-by-row honest `gui` layer value (`missing` for groove/Pitch&Time, `partial` for
  chance/cent/ratchet).
- **Instrument-track `cent`**: parsed, stored, and settable on ANY track kind, but only *sonically
  applied* on synth-track (Tone.js oscillator) notes. `spessasynth_lib`'s `WorkletSynthesizer` only
  exposes pitch-bend at the MIDI-channel level (not per-note), so a clean per-note implementation
  needs either a dedicated channel-per-detuned-note scheme or a different API surface — a bigger
  lift than this pass's scope, left as a flagged, documented gap rather than a silent one.
  `chance`/ratchet DO apply to instrument-track notes (no such API obstacle there).
- **Groove and drum hits**: `shuffleAmount`/`shuffleGrid` are track-level fields that apply
  conceptually to a drum track's hits too, but hit-scheduling in `ui/src/audio/engine.ts` was
  simultaneously being rewritten by sibling stream AB this phase (Phase 22's coordination note
  asked both streams to keep diffs scoped and not block on each other). Groove is wired for note
  scheduling only; extending it to hit scheduling is a small, well-scoped follow-on once AB's drum
  playback rewrite lands.
- **Format-spec "Future" sketch section** (the exploratory post-v0 sketch near the end of
  `format-spec.md`) was not updated — v0.10 is documented in its own dedicated section alongside
  v0.5-v0.9, following the same pattern those already use.

## Verification performed

- `npm test`: 347/347 passing, including four new test files (`test/groove.test.ts` — 8 tests,
  `test/chance.test.ts` — 8 tests, `test/pitchtime.test.ts` — 30 tests, `test/format-v10.test.ts` —
  11 tests) plus five existing test files updated for the new required `BeatNote` fields and the
  `0.9` -> `0.10` format-version bump.
- `node scripts/verify-phase22-stream-ad.mjs`: five live, CLI-driven checks — a Pitch & Time
  operation (transpose) rewrites exactly the expected tokens with everything else byte-identical;
  reverse produces the exact expected discrete note lines; chance's RNG hits ~50% over 1000 seeded
  passes; ratchet consolidate produces the exact expected four discrete notes at the exact expected
  positions; groove's `<track>.shuffleAmount`/`<track>.shuffleGrid` round-trips through the real
  `beat set`/file-write path.
- `cd ui && npx tsc --noEmit && npm run build`: clean typecheck and a successful Vite production
  build with the engine/types/bridge/NoteView changes in place (ui/'s own dependencies were not
  previously installed in this worktree; installed via `npm install` to get a real typecheck rather
  than trusting the diff by inspection alone).

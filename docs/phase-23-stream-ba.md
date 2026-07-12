# Phase 23 Stream BA — Piano-roll GUI for the note-editing vocabulary

Closes the GUI gap Phase 22 Stream AD left open on four rows: Pitch & Time operations, Groove/
shuffle, Per-note probability (chance), and Note ratchet/repeat. AD built the format/core/CLI/MCP
layer (`src/core/pitchtime.ts`, `src/core/groove.ts`, `src/core/chance.ts`) and a small per-note
inspector panel (`ui/src/components/NoteView.tsx`'s `NoteInspector`) for typing exact chance/cent/
ratchet values, but left the six Pitch & Time ops CLI/MCP-only, groove with no knob, and chance/
ratchet with no at-a-glance visual layer or draw-across-notes gesture. This stream is GUI-only over
that existing layer — no format or `src/core` changes.

## What was built

### 1. A daemon route for the six Pitch & Time ops + Consolidate (`src/daemon/daemon.ts`)

AD's own doc reasoned "no daemon route needed... the generic `POST /edit` `{path,value}` channel
already covers everything grammar-level these operations touch" — true for quantize (whose only
input is which notes to snap), but each Pitch & Time op has its own batch parameter shape
(`semitones`, `factor`, `root`+`scale`, `axis`, `gap`) that doesn't fit a single `{path,value}` pair
any better than `/song`'s or `/audio-split`'s ops did. `POST /pitch-time` mirrors those two routes'
own shape exactly: one op per call, `{op, track, noteIds?, ...opParams}`, wraps the same
`transposeNotes`/`timeScaleNotes`/`fitToScaleNotes`/`invertNotes`/`reverseNotes`/`legatoNotes`/
`consolidateRatchet` functions the CLI/MCP tools already call, and **returns the full raw document**
(the daemon never echoes its own writes over SSE) so the GUI applies it directly — same pattern
`postAddTrack`/`postEffectAdd`/`postAudioSplit` already establish in `ui/src/daemon/bridge.ts`
(new `postPitchTime` there, typed by a `PitchTimeOp` discriminated union).

### 2. The Pitch & Time operations panel (`ui/src/components/NoteView.tsx`'s `PitchTimePanel`)

A small panel, always visible under the piano roll for any note (non-drum) track — **not** gated on
a selection existing, because every op already supports an optional `noteIds` scope: nothing
selected means "the whole track," exactly the CLI/MCP tools' own `--notes`-omitted behavior. Buttons
for all seven ops (Transpose with a semitones field, ×2/÷2 time-scale, Fit to Scale with root+scale
selects hand-mirroring `src/core/pitchtime.ts`'s `SCALES` keys, Invert, Reverse, Legato with a gap
field, Consolidate), each a `postPitchTime` call reporting how many notes changed (or "no change" —
Consolidate on an unratcheted selection is an honest no-op, the same "already at rest" stance
quantize takes).

### 3. Groove/shuffle knobs (`ui/src/components/MixerView.tsx`)

A Shuffle (0–1) / Grid (1–4, labelled 16th/8th/4th) `Knob` pair added to every channel strip, next
to Pan — `BeatTrack.shuffleAmount`/`shuffleGrid` are required fields on every track kind, so the pair
renders unconditionally, not gated on track kind. Writes through the existing
`<track>.shuffleAmount`/`<track>.shuffleGrid` `postEdit` grammar AD already wired — no new CLI verb
or daemon route needed, confirmed by re-checking: `ui/src/audio/engine.ts` genuinely does apply
`warpStep`/`chanceFires`/`ratchetSlots` in its synth/instrument note-scheduling loop (hand-mirrored
from `src/core`, same convention as `lfoSyncRateHz`), so turning this knob is audible, not just a
file write — see the note under Verification about how that got double-checked.

### 4. At-a-glance chance/ratchet glyphs on the note itself (`NoteView.tsx`'s note render)

- **Chance**: a note with `chance < 100` now draws with a dashed border and reduced opacity
  (multiplicative on top of the existing velocity-driven opacity, so a quiet *and* probabilistic
  note still reads as both). Note-only — `BeatDrumHit` carries no chance field, matching
  `pitchtime.ts`'s own "Pitch & Time operations work on notes, not hits" scope boundary.
- **Ratchet**: a ratcheted note (`ratchetCount > 1`) draws internal tick marks at its repeat
  boundaries, computed by a small display-only `ratchetTicks(count, curve)` helper in `NoteView.tsx`
  that hand-mirrors the exact same exponent-warp edge formula `pitchtime.ts`'s `ratchetSlots` and
  `engine.ts`'s own copy use (`k = 1+curve*3` front-loaded / `k = 1/(1-curve*3)` back-loaded) — so a
  ratchet's visual spacing matches what it will actually sound like, not an approximation.

### 5. The chance draw-across-notes paint gesture (`NoteView.tsx`'s chance lane)

Research 22 §1.4's `PropertyDrawModifier` reference, explicitly filed as future work by AD's own
doc. A new lane below the velocity lane (note tracks only) renders one bar per note, height =
current chance. Unlike the existing velocity-lane gesture — which anchors to the ONE bar originally
pressed (`startVelocityGesture` captures `{id, rect}` once) — the chance lane's gesture re-evaluates
*which* note is under the pointer on every `pointermove` (`paintChanceAt` scans all note x-ranges
against the current pointer x) and accumulates every touched note's id into a preview map, committing
one `postEdit` per touched note on release. One continuous drag across several notes paints them all
to the same probability in one gesture — the actual "draw across notes" behavior, not just a
per-note click-and-drag.

## Design decisions worth flagging

- **The Pitch & Time panel is not selection-gated.** Every op already supports "no selection = whole
  track" via `pitchtime.ts`'s own optional `noteIds`; requiring a selection first would just be a
  GUI-invented restriction the underlying primitive doesn't have. The panel shows a live scope label
  ("N notes selected" / "whole track") so the ambiguity is visible, not hidden.
- **`/pitch-time` returns the full document rather than a diff-style response.** A batch op like
  Reverse or Consolidate can touch or mint/remove many note ids in one call — there's no clean
  `{path,value}` list to hand back the way `/vary`'s audition batch does, so this follows
  `postAddTrack`/`postAudioSplit`'s "just return the authoritative doc" shape instead of inventing a
  new response format for one route.
- **`ratchetTicks` in `NoteView.tsx` is deliberately display-only**, kept as a small standalone
  function rather than importing anything from `src/core` (the file's own header note: "ui/ has no
  build-time dependency on src/core"). It computes the same edge formula `ratchetSlots` does, so the
  tick marks are accurate, not approximate — it just doesn't carry `repeatLength`'s gate-width
  scaling, which only affects *within-slot* sounding length, not where the slots themselves fall.
- **The chance lane is a separate strip, not a mode toggle on the velocity lane.** Ableton-style prior
  art (research 22) treats per-note draw modifiers as separate lanes/modes; a toggle would save
  vertical space but cost a mode-switch click before every chance edit, and dotbeat already accepts
  a second permanent lane for velocity — a third one for chance is a small, consistent cost.

## Verification performed

- `npm test`: 490/490 passing (no test file needed changes — this stream added no new `src/core` or
  `src/daemon` logic beyond the additive `/pitch-time` route, which the daemon's existing route
  pattern doesn't require its own unit-test file for, matching `/audio-split`'s and `/song`'s own
  precedent of being covered by their live verify script instead).
- `npx tsc -p tsconfig.json --noEmit` and `cd ui && npx tsc --noEmit`: both clean.
- `node ui/verify-phase23-stream-ba.mjs`: a real headless-Chromium session against a real `beat
  daemon` on a scratch copy of `examples/night-shift.beat`, asserting on the actual `.beat` file
  after each GUI action (nine checks, BA1–BA9 — see the script's own header for the full list):
  Transpose/×2÷2/Fit-to-Scale/Invert/Reverse/Legato each produce the exact expected note-line diff;
  setting `ratchetCount=4` shows exactly 3 tick marks and Consolidate produces exactly 4 discrete
  notes at the exact expected positions (`ratchetSlots(4,0,1,dur)` math, same expectation Phase 22's
  own CLI verify script hand-computed); setting `chance=40` shows the `.chancy` glyph; one continuous
  drag across the chance lane paints 7 distinct notes to the same value in a single gesture; dragging
  the mixer's Shuffle/Grid knobs writes a real `groove <amount> <grid>` line.
- **A note on the engine-wiring double-check**: while investigating whether `ui/src/audio/engine.ts`
  actually applies `shuffleAmount`/`chance`/ratchet at playback (relevant to whether the groove knob
  and chance/ratchet glyphs are cosmetic or audible), an early `grep` pass over `engine.ts` returned
  zero matches for `warpStep`/`chanceFires`/`ratchetSlots`/even `.notes` — which would have meant AD's
  documented engine wiring was silently missing. That turned out to be a tooling artifact (the default
  `grep` in this environment silently treats `engine.ts` as a binary file and returns nothing;
  `grep -a` or a direct `Read` shows the real, correct content). Re-verified with `grep -a`: the
  wiring is genuinely present (`engine.ts` lines ~709–768 and ~2340/2535 call `warpStep`/
  `chanceFires`/`ratchetSlots` in the synth/instrument note-scheduling loop, exactly as Phase 22
  Stream AD's own doc describes). Recorded here mainly as a note to future streams: if a `grep`
  across this specific file ever comes back suspiciously empty, re-check with `-a` before concluding
  anything is missing.

## Result — what's honestly incomplete

- **Drum-hit groove/chance/ratchet**: unchanged from AD — `shuffleAmount`/`shuffleGrid` apply to
  synth/instrument note scheduling only (drum-hit scheduling was sibling Stream AB's territory during
  Phase 22 and remains a follow-on); the chance/ratchet glyphs and the chance lane are note-track-only
  for the same reason `BeatDrumHit` carries neither field.
- **No Humanize button in the Pitch & Time panel.** `beat_humanize`'s GUI affordance is tracked as
  its own roadmap row ("Rung-2 'feel' content variation, wired into the GUI," under Vary / audition
  loop) — explicitly Phase 23 Stream BB's territory per the phase plan, not folded into this panel.
- **Instrument-track `cent`** remains sonically unapplied for SoundFont notes (AD's own documented
  gap — `WorkletSynthesizer`'s pitch-bend is channel-wide, not per-note; unrelated to this stream's
  scope and untouched here).

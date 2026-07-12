# Research 39 — Ableton Live 12's MIDI Tools (Transform + Generate panels) vs. dotbeat's vary/score loop

*2026-07-12. Owner-commissioned research pass, one of a parallel set mining Ableton Live 12's
official 999-page Reference Manual (`prior_art/`, gitignored) chapter-by-chapter for ideas/gaps
relevant to dotbeat's roadmap. This chapter — "11. MIDI Tools", manual pp. 278-314 — was flagged
by the owner by name as key. Research-only: no code was written or modified.*

## How to read this doc

- **[manual p.NNN]** — read directly from the Reference Manual's own text this pass (chapter 11
  extract, `pdftotext -layout`), cited to the actual printed page number embedded in the extract's
  own page-footer markers. High confidence — these are closer to verbatim descriptions than
  paraphrase.
- **[dotbeat]** — read directly from this repo's current source this pass, cited with exact
  file:line so a future stream can jump straight to the code.
- **[inference]** — this doc's own synthesis/recommendation, flagged explicitly rather than
  presented as a manual fact or a confirmed dotbeat behavior.

## 0. What this chapter is, and why it's the highest-signal chapter for dotbeat's vary/generate roadmap

Chapter 11 documents Live 12's **MIDI Tools**: two panels in Clip View's MIDI Note Editor —
**Transform** (12 tools, operate on a note *selection*, rewriting it) and **Generate** (5 tools,
operate on a *time selection or loop*, creating new notes from nothing) — plus a small set of
Max-for-Live-hosted tools in the same two panels (Velocity Shaper, Euclidean) [manual p.278].
Both panels are explicitly **scale-aware**: "if a scale is enabled for a clip, any MIDI Tools'
parameters related to pitch will use scale degrees instead of semitones" [manual p.279].

This matters unusually directly to dotbeat because dotbeat already has (a) a scale table and a
family of one-shot note-rewrite primitives that overlap directly with several of Ableton's
Transform tools (`src/core/pitchtime.ts`, §2 below), and (b) its own generative/taste-loop concept
— `beat vary`/`beat score` (`src/vary/`, `docs/variation-loop.md`) — that is conceptually the
Generate panel's *cousin* but, on inspection, covers a narrower slice than Ableton's Generate panel
does. §3 below is the direct comparison the owner asked for.

## 1. The interaction model (§11.1, pp. 278-281)

Worth summarizing on its own because it's a genuinely different shape from dotbeat's current
edit-primitive model, not just a features list:

- **Auto Apply is on by default**: adjusting a MIDI Tool's parameters transforms/generates notes
  *live*, visible in the Note Editor immediately [manual p.278]. Toggling Auto Apply off restores
  notes to their pre-tool state and switches to an explicit **Apply** button (or `Cmd/Ctrl+Enter`)
  — "fine-tune a MIDI Tool's parameters and, once you're happy with the settings, press the Apply
  button for the adjustments to take effect" [manual p.279].
- **Scope rules differ between the two panels** [manual p.279]: Transformations apply to the time
  selection, note selection, or the whole clip loop if neither is set, and *replace* the selected
  notes. Generators apply to the time selection or the whole loop; if notes already exist there,
  generated notes are *added alongside* existing content when they don't overlap, or *replace* it
  when they do.
- **Undo/Redo affects only the resulting notes, not the tool's own parameter state** [manual
  p.280]: a separate **Reset** button (grayed out at defaults) restores a tool's parameters to
  default, independent of the Edit-menu Undo/Redo that reverts the notes themselves. This is a
  two-layer undo model — "what the notes look like" and "what the tool dial is set to" are
  tracked separately.
- **Max for Live MIDI Tools** are user-editable/creatable AMXD patches living in dedicated browser
  folders (`~/Music/Ableton/User Library/MIDI Tools/Max Transformations` and `/Max Generators`)
  [manual p.281], alongside two Ableton-shipped examples used in this chapter: Velocity Shaper
  (Transform) and Euclidean (Generate).

## 2. Transformation Tools (§11.2, pp. 281-305) — targeted operations on an existing note selection

Twelve tools total; grouping by how directly they map onto dotbeat's existing `src/core/pitchtime.ts`
and `src/core/edit.ts` primitives, since that mapping is the point of this pass.

### 2.1 Tools dotbeat has already substantially built

- **Quantize** [manual pp. 294-295] — grid or explicit meter (including triplets), start and/or
  end snapping independently (end-quantize stretches the note), and an **Amount** control that
  "will move notes only by a percentage of the set quantization value" for a non-robotic partial
  snap. This is close to a line-for-line match with dotbeat's `quantizeNotes`
  (`src/core/edit.ts:408-460`), whose own doc comment says "Ableton-style" and whose `QuantizeOptions`
  already has `grid`, `amount` ("How far each note moves toward the grid, 0..1 (Ableton's
  Amount)"), `starts`, and `ends` [dotbeat, `src/core/edit.ts:390-401`]. This was evidently ported
  deliberately in an earlier phase — confirmed parity, not a gap.
- **Span's Legato mode** [manual p.299] — "extends the length of selected notes to the start time
  of the next note in the sequence" — matches `legatoNotes` (`src/core/pitchtime.ts:212-233`)
  almost exactly, including the "last note extends to the selection/loop end" edge case (dotbeat's
  version leaves the last note untouched rather than extending to a loop boundary, a small,
  probably-fine divergence). But Span is a **three-mode** tool — Legato, **Tenuto** (preserve
  original length unless Offset/Variation are set), **Staccato** (new length = half the smallest
  inter-onset gap in the selection) [manual pp. 298-299] — plus an **Offset** (shift end time by up
  to a grid step) and a **Variation** (randomized length jitter, re-rolled on every re-apply)
  [manual p.298]. dotbeat only has the Legato mode; see §3.4.
- **Transpose / Fit to Scale / Invert / Reverse** — Ableton doesn't group these under MIDI Tools at
  all (they're the older, simpler Clip View "Pitch & Time" row covered by research 18 and already
  ported in Phase 22 Stream AD — `transposeNotes`, `fitToScaleNotes`, `invertNotes`, `reverseNotes`,
  `timeScaleNotes`, all in `src/core/pitchtime.ts:60-202`). Worth noting because this chapter's
  scale-awareness statement [manual p.279] retroactively validates dotbeat's own
  `fitToScaleNotes`/`SCALES` table design (`src/core/pitchtime.ts:104-154`) — dotbeat already has
  the exact scale-degree-vs-semitone infrastructure this whole chapter's parameters lean on.

### 2.2 Tools with no dotbeat equivalent at all

- **Arpeggiate** [manual pp. 281-282] — splits a note selection into one of 18 arpeggio *style*
  patterns (borrowed from the Arpeggiator MIDI effect), with **Distance** (transposition per step,
  in scale degrees or semitones), **Steps** (how many transposed steps), and **Rate**/**Gate**
  (note spacing and length). This is a real generative-melodic-content gap: dotbeat has no
  arpeggiator anywhere (CLI, MCP, or GUI) — confirmed, no `arpegg` match anywhere in `src/`,
  `cli/beat.mjs`, or `src/mcp/server.ts` [dotbeat, repo-wide grep].
- **Chop** [manual pp. 283-284] — divides notes into 2-64 parts via a **Parts**/**Gaps** pattern
  (a positive Gaps value = "insert a gap after N notes", negative = "insert N gaps after each
  note"), an **Emphasis** toggle that stretches selected pattern elements 2-8x, and a
  **Variation** slider for randomized start/end jitter. dotbeat's closest concept is its *stored*
  per-note ratchet triplet (`ratchetCount`/`ratchetCurve`/`ratchetLength`, `BeatNote` fields,
  `src/core/document.ts:422-424`) plus `ratchetSlots`/`consolidateRatchet`
  (`src/core/pitchtime.ts:246-301`) — genuinely different in kind, not just coverage: Ableton's
  Chop is a one-shot destructive rewrite of note count, while dotbeat's ratchet is a live,
  reversible, per-note *parameter* (bake-in is the opt-in `consolidateRatchet` step). This is
  arguably a **strength dotbeat already has over Ableton here** — worth stating plainly, not just
  logging a gap (see §3.5).
- **Connect** [manual pp. 285-286] — generates new notes to fill gaps *between* existing notes,
  with randomized placement shaped by **Spread** (pitch randomization), **Density** (% of gap time
  filled), **Rate** (interpolated note length), and **Tie** (probability a generated note extends
  to the next original note). No dotbeat equivalent.
- **Glissando** [manual pp. 287-288] and **LFO** [manual pp. 289-290] — both are **MPE**
  Transformations: Glissando ties two notes' pitch together along a pitch-bend curve, LFO
  modulates pitch-bend/slide/pressure with an oscillator. Both require per-note continuous
  expression lanes that dotbeat's note model doesn't have — `BeatNote` carries discrete
  `pitch`/`velocity`/`chance`/`cent` fields only [dotbeat, `src/core/document.ts`], no pitch-bend
  curve, no MPE dimension anywhere in the format, decisions doc, or roadmap. Correctly out of
  scope; see §3.6.
- **Ornament** (Flam/Grace Notes) [manual pp. 291-293] — inserts one extra note before each
  selected note (Flam, with a **Flam Position** as % of grid and a relative **Flam Velocity**) or
  several equal-length notes (Grace Notes, with **Pitch** relative-to-original of high/low/same, a
  **Position**, relative **Velocity**, per-note **Chance**, and an **Amount** of how many grace
  notes). Reapplying adds *more* ornament notes each time. No dotbeat equivalent — a real gap for
  drum programming (no flam primitive at all today) and melodic ornamentation alike.
- **Recombine** [manual pp. 295-297] — permutes one note-parameter dimension (**Position**,
  **Pitch**, **Duration**, or **Velocity**) across a selection via **Shuffle** (random permutation,
  *re-rolled on every Apply press*), **Mirror** (reverse order), or **Rotate** (circular shift, with
  an optional "Rotate on Grid" mode that rotates by grid cells instead of by note count). All three
  can compose (applied Shuffle → Mirror → Rotate). No dotbeat equivalent — and this is the one
  Transform tool that is structurally a *variation generator*, not a deterministic edit (see §3.3).
- **Strum** [manual pp. 300-301] — spreads a chord's note-on times per a shape set by
  **Strum Low**/**Strum High** (offset the lowest/highest note first, others interpolated) and
  **Tension** (bends the spacing from linear to exponential, front- or back-loaded). No dotbeat
  equivalent; relevant for chord-heavy synth tracks.
- **Time Warp** [manual pp. 302-303] — a 1-3 breakpoint speed curve remapped onto the time
  selection, producing accelerando/ritardando-style tempo curves within a phrase, with
  **Quantize** (snap results to grid), **Preserve Time Range** (keep the result within the
  original span), and **Include Note End** toggles. dotbeat's `timeScaleNotes`
  (`src/core/pitchtime.ts:80-98`) only does a single uniform `factor` (Ableton's simpler x2/÷2
  "Stretch" buttons) — no curve. Gap.
- **Velocity Shaper** (Max for Live) [manual pp. 304-305] — shapes selected notes' velocities
  against a drawn breakpoint envelope, with **Minimum**/**Maximum Velocity** clamps, a **Loop**
  count (how many times the envelope repeats across the selection), and a **Rotate**/**Division**
  offset. dotbeat's `humanize` (`src/core/humanize.ts`) only does *random* Gaussian velocity jitter
  — no deterministic shaped envelope. Gap, though a smaller one (humanize's random jitter is a
  reasonable substitute for most "feel" use cases; Velocity Shaper is for deliberate crescendo/
  accent contouring, a different use case).

## 3. Generative Tools (§11.3, pp. 306-314) — create notes from nothing

Five tools, all scale-aware, all operating on a time selection or loop:

- **Rhythm** [manual pp. 306-308] — generates a step pattern (up to 16 **Steps**) for one pitch or
  drum pad at a time, shaped by **Pattern** (placement, whose available choices depend on
  Steps/Density), **Density** (note count), **Step Duration** (how many times the pattern repeats
  across the selection), **Split** (probability a step subdivides), **Shift**, and separate
  **Velocity**/**Accent** levels with an **Accent Frequency** (notes between accents) and
  **Accent Offset**. Explicitly designed to be layered voice-by-voice: "deselect the previously
  generated notes and adjust Rhythm's parameters again for a different pitch or drum pad" [manual
  p.307] to build up a full drum pattern one lane at a time.
- **Seed** [manual pp. 308-309] — pure random generation within **Pitch**, **Duration**, and
  **Velocity** *ranges* (with a **Key Track** mode that snaps the pitch range to scale), plus
  **Voices** (max simultaneous notes) and **Density** (% of the pitch range populated). The
  simplest, most literal "random notes in a box" generator in the chapter.
- **Shape** [manual pp. 309-310] — generates notes distributed along a drawn or preset contour
  (a melodic shape, not a rhythm pattern) between a **Minimum**/**Maximum Pitch**, with **Rate**
  (min note length), **Tie** (probability of extension), **Density**, and **Jitter** (how far
  generated pitches wander from the drawn shape — 0% follows it exactly).
- **Stacks** [manual pp. 310-312] — a chord/chord-progression generator built on scale-relative
  chord shapes selected via a "Chord Selector Pad" (Tonnetz-based interval diagrams), with
  **Chord Root** (auto-set to the clip's scale root if one is active, but overridable),
  **Chord Inversion**, and per-chord **Duration**/**Offset**. Chord progressions are built by
  adding multiple chords in sequence. **Custom chord banks are plain JSON text files with a
  `.stacks` extension**, loadable from any browser "Places" folder [manual pp. 310-311] —
  Ableton's own words: "text files that define specific chord rules in the JSON format."
- **Euclidean** (Max for Live) [manual pp. 312-314] — Euclidean-rhythm generation for up to 4
  voices simultaneously, each independently toggleable, independently pitched/drum-pad-assigned,
  independently **Rotation**-offset (with a one-click "randomize all rotations" button), governed
  by shared **Steps** (pattern length), **Density** (repeats within the time selection, wrapping
  if needed), and **Division** (step length).

## 4. Relevance to dotbeat: comparing this chapter against `src/vary`/`docs/variation-loop.md`

### 4.1 The headline finding

**dotbeat's `beat vary`/`beat score` loop and Ableton's Transform/Generate panels solve genuinely
different problems that happen to share the word "generate."** `beat vary` (rung 1,
`src/vary/vary.ts:165-196`) mutates **synth parameters** (`kickTune`, `cutoff`, `attack`, etc.) in
musically-scoped groups; `beat vary`'s rung 2, `varyFeel` (`src/vary/vary.ts:220-252`), re-times and
re-accents **existing** notes/hits via `humanize` — jitter around a fixed set of onsets, never
adding or removing a note. Neither creates new note *content* (new pitches, new rhythmic
structure, new chords). **dotbeat currently has zero generative note-creation primitives** —
confirmed by repo-wide search: no arpeggiator, no chord generator, no Euclidean/step-pattern
generator, no random-note-seeder, anywhere in `src/core/`, `src/vary/`, `cli/beat.mjs`, or
`src/mcp/server.ts` [dotbeat]. Every note in a dotbeat project today was placed by a human in
NoteView/StepSequencer, or by playing/recording — there is no machine-proposed starting point for
note content at all, only for synth timbre and micro-timing.

This is the real, actionable gap this chapter surfaces: `docs/variation-loop.md`'s own founding
quote is "auto generating many, many variations of a synth, **4-bar beat, loop**" — the loop/beat
half of that ambition (not just the synth-timbre half) has no tooling yet. Ableton's Generate panel
(§3 above) is a close, battle-tested template for exactly that missing half.

### 4.2 Concrete recommendation — add a `GENERATE_TOOLS` family that plugs into the existing scoring exhaust

**[inference]** Don't build a new UX; extend the one that already works. `beat vary`'s value isn't
just "makes variants," it's the whole pipeline around variants: deterministic seeding, a
replayable-diff manifest, `beat score`'s ranked-pick JSONL exhaust, and `suggest.ts`'s
Bradley-Terry-odds steering (`src/vary/suggest.ts`). A note-content generator should emit into that
same pipeline, not a parallel one. Concretely:

1. **Euclidean rhythm generator for drum tracks** — the single best-scoped first build. dotbeat's
   drum model already has exactly the five fixed lanes (kick, snare, clap, hat, openhat) Rhythm/
   Euclidean operate on one-lane-at-a-time [manual p.307, p.313]. A `generateEuclidean(doc,
   trackId, lane, steps, pulses, rotation, seed?)` sibling to `pitchtime.ts`'s functions — same
   `NoteScopeOptions`-shaped signature, same "rewrite a diff" discipline — is a small, well-known
   algorithm (Bjorklund) with a precise citation trail back to this chapter [manual p.313]. Wire
   it into `beat vary` as a new tool kind alongside `kick`/`snare`/... param groups (or a sibling
   CLI verb `beat generate <file> <track> euclidean --steps 16 --pulses 5 --seed N --render`) so
   9 seeded variants land in the same manifest/score flow `varyTrack` already produces.
2. **Seed-style random note generator for synth tracks** — [manual p.308]'s literal "random notes
   in pitch/duration/velocity ranges, snapped to scale" is close to a direct port once
   `fitToScaleNotes`'s `SCALES` table (`src/core/pitchtime.ts:104-119`) is reused as the pitch
   constraint. This is the cheapest way to give an agent (or `beat vary`) a genuine "propose a
   bassline" primitive, seeded and scoreable exactly like today's kick-timbre variants.
3. **Stacks-style chord generator, with chord banks as a diffable text asset** — [manual pp.
   310-311]'s design choice to store chord definitions as plain JSON text files, loaded from a
   user folder, is unusually resonant with dotbeat's own "the file is the source of truth,
   git-diffable" philosophy (the same principle research 30 and the format spec lean on
   everywhere else). **If a chord generator is built, its chord-shape table should follow
   `SCALES`'s existing pattern** — a literal, named, extensible table (`src/core/pitchtime.ts:104-
   118`) — and, per Ableton's own precedent, should be user-overridable via a project-relative or
   `~/.beat/`-style JSON file rather than hardcoded only, so a musician's own chord vocabulary
   becomes part of the diffable project the same way presets already are.
4. **Recombine is the one Ableton Transform that belongs in `src/vary`, not `pitchtime.ts`** —
   [manual p.297]'s note that Shuffle "creates a new parameter permutation each time the Apply
   button is pressed" makes Recombine a **variation generator over note arrangement**, not a
   single deterministic edit like `invertNotes`/`reverseNotes`. Recommend a `varyArrange`/
   `recombine` sibling next to `varyFeel` in `src/vary/vary.ts` (same `VaryOptions`-shaped `seed`/
   `count` contract) that permutes one note dimension (position/pitch/duration/velocity) across N
   seeded variants for `beat score` to rank — this is a structural-variation counterpart to
   `varyFeel`'s timing/velocity-only variation, filling the "vary the *arrangement* of a phrase,
   not just its feel or its timbre" gap directly.

### 4.3 Cheap wins — small extensions of code that already exists

- **Span's Tenuto/Staccato modes + Offset/Variation** [manual pp. 298-299]: `legatoNotes`
  (`src/core/pitchtime.ts:212-233`) already has the right shape (scoped notes, sorted by start,
  `gap` option) — extending it to an `articulation: 'legato' | 'tenuto' | 'staccato'` parameter
  (tenuto = no-op unless offset/variation set; staccato = half the minimum inter-onset gap) is a
  same-file, same-pattern addition, not a new subsystem.
- **Ornament's Flam** [manual pp. 291-292]: a one-shot note-insertion function alongside
  `consolidateRatchet` (`src/core/pitchtime.ts:268-301`) — same "mint a fresh id, insert before the
  source note" shape `consolidateRatchet` already uses for its own note-splitting. This is a real,
  currently-completely-missing drum-programming primitive (no flam anywhere in dotbeat today) that
  would cost relatively little given the adjacent code.
- **Time Warp's tempo-curve stretch** [manual pp. 302-303]: `timeScaleNotes`
  (`src/core/pitchtime.ts:80-98`) already anchors on the earliest scoped note and applies a single
  `factor` — generalizing `factor` to a small breakpoint curve (1-3 points, matching Ableton's own
  cap) reuses the same anchor-and-remap logic for accelerando/ritardando phrasing.

### 4.4 Confirmed strength — don't regress dotbeat's ratchet model toward Ableton's Chop

**[inference]** Worth stating as a finding, not just a gap-check: Ableton's Chop [manual pp.
283-284] is a **one-shot, destructive** rewrite (apply once, the notes are now split; no live
parameter survives). dotbeat's ratchet fields (`ratchetCount`/`ratchetCurve`/`ratchetLength`,
`src/core/document.ts:422-424`) are **live, stored, re-editable** per-note parameters, with
`consolidateRatchet` as an explicit, opt-in "bake it in" step matching Ableton's own one-shot
behavior only when the user actually wants that (research 22 §3.3's Consolidate action). Chop's
**Gaps**/**Emphasis**/**Variation** pattern-design controls [manual p.284] are genuinely richer
than dotbeat's current ratchet shaping (only `ratchetCurve`'s single front/back-load exponent) —
if ratchet shaping ever gets a second axis, Chop's Gaps-pattern vocabulary (skip every Nth repeat,
stretch emphasized repeats 2-8x) is the right reference, added *to the live parameter*, not by
copying Ableton's destructive-apply model.

### 4.5 Low priority / explicitly out of scope

- **MPE Transformations (Glissando, LFO-as-MPE)** [manual pp. 287-290]: require continuous
  pitch-bend/pressure/slide expression lanes dotbeat's note model doesn't have and no roadmap or
  decisions entry references. Correctly deprioritized — revisit only if/when MPE controller
  support is ever independently roadmapped, not as a side effect of this chapter.
- **Connect** [manual pp. 285-286] (randomized gap-filling between notes): closest existing analog
  in spirit is the recommended Seed generator (§4.2.2) constrained to a time range between two
  notes — not worth a bespoke tool until Seed exists and someone asks for the "between existing
  notes" variant specifically.
- **Strum** [manual pp. 300-301]: real but narrow (chord-voicing-timing only); worth building only
  after a chord generator (Stacks-equivalent, §4.2.3) actually produces chords for it to act on —
  sequencing dependency, not a standalone priority.

### 4.6 A smaller cross-cutting note: Auto Apply / Reset as a preview model

**[inference, lower confidence — not this chapter's main finding]** §1's Auto-Apply-with-live-
preview-then-commit, plus a Reset that's independent of note Undo/Redo [manual pp. 278-280], is a
different two-layer undo shape than anything dotbeat has today. It's tangential to this chapter's
core ask, but worth a one-line flag: dotbeat's GUI currently has no undo stack at all (`Ctrl+Z`
does nothing — flagged elsewhere in `ROADMAP.md`'s v1 section), and its checkpoint/history model
(`docs/research/28-undo-redo-vs-checkpoint-history.md`) is diff/commit-based rather than a live
"preview, then commit or revert" tool-parameter state. If/when any of §4.2's generators ship in the
GUI, Ableton's split between "note state" (undo-able) and "tool dial state" (reset-able,
independent) is a reasonable model to borrow for a generator's own parameter panel — but this is a
GUI-design detail for whichever stream builds that panel, not a blocker for the CLI/MCP primitives
recommended above.

## Sources

Ableton Live 12 Reference Manual, Chapter 11 "MIDI Tools", pp. 278-314 (owner-provided PDF extract,
`prior_art/`, gitignored — not a web fetch this pass). dotbeat internal (read directly this pass):
`src/core/pitchtime.ts`, `src/core/edit.ts` (`quantizeNotes`, lines 390-460), `src/core/humanize.ts`,
`src/core/document.ts` (`BeatNote` fields, lines 420-436), `src/vary/vary.ts`, `src/vary/suggest.ts`,
`docs/variation-loop.md`, `docs/research/08-variation-loop-prior-art.md`,
`docs/research/18-ableton-ui-architecture.md`, `docs/research/22-opendaw-editing-workflow.md`,
`docs/research/28-undo-redo-vs-checkpoint-history.md`, `docs/decisions.md`, `ROADMAP.md`.

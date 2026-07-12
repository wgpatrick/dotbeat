# Research 58 — Ableton Live 12 MIDI Tools vs. dotbeat: feature/UI comparison + priorities

*2026-07-12. Owner-commissioned. Direct sequel to research 39 (`docs/research/39-ableton-midi-tools.md`),
which already established the headline finding — **dotbeat has zero generative note-creation
primitives** — from the manual's *text*. This pass adds the manual's own **screenshots** (16 pages
viewed directly: pp. 278-279, 281, 283, 285, 289, 292, 294, 296, 300, 302, 305, 307, 309, 311, 313)
to ground the UI/UX half, then turns the comparison into a decision-ready priority table. Research
only — no code written or modified.*

## How to read this doc

- **[manual p.NNN]** — read directly from the Reference Manual extract (text or the rendered page
  image itself) this pass, chapter 11 "MIDI Tools," pp. 278-314.
- **[dotbeat file:line]** — read directly from this repo's current source.
- Priorities are decisive by design (P0/P1/P2/Do-not-recreate) — this feeds the next phase's
  planning directly, not a menu to hedge on.

---

## 1. Feature & UI/UX comparison

### a) Shared features / parity

| Area | Ableton | dotbeat | Parity note |
|---|---|---|---|
| **Quantize** | Grid or explicit meter (incl. triplets), independent start/end snap, **Amount** = partial-snap percentage [manual p.294] | `quantizeNotes` — `grid`, `amount` ("How far each note moves toward the grid, 0..1 (Ableton's Amount)"), `starts`, `ends` [`src/core/edit.ts:390-460`] | Near line-for-line port, confirmed in research 39. Genuine parity, not a gap. |
| **Legato (Span mode)** | One of three Span modes: extends note to the next note's start [manual p.298] | `legatoNotes` [`src/core/pitchtime.ts:212-233`] | Matches, including the last-note edge case (dotbeat leaves it untouched rather than extending to a loop boundary — small, likely-fine divergence). Only 1 of Span's 3 modes exists — see 1(b). |
| **Transpose** | Not a MIDI Tool in Ableton (older Clip View row) | `transposeNotes` [`src/core/pitchtime.ts:60-78`] | Equivalent capability, different UI location in both products — not a gap either direction. |
| **Fit to Scale / scale-degree math** | Every pitch-bearing MIDI Tool parameter is scale-aware when a clip scale is enabled [manual p.279] | `fitToScaleNotes` + `SCALES` table [`src/core/pitchtime.ts:104-160`] — a one-shot rewrite operation, not a persisted, continuously-applied scale state | **Partial parity, with a real caveat**: dotbeat has the scale-degree math but no persistent per-clip/track scale-lock the way Ableton's generators consume live. Tracked separately: `product-roadmap.md` lists "Scale-lock field + scale-tone highlighting" as **Not started**. Any new generator built per §2 below inherits this gap unless scale-lock lands first (flagged again there). |
| **Invert / Reverse / ×2÷2 stretch** | Not MIDI Tools in Ableton (older Clip View row) | `invertNotes`, `reverseNotes`, `timeScaleNotes` (uniform factor only) [`src/core/pitchtime.ts:80-98,162-202`] | Equivalent capability. `timeScaleNotes`'s single-factor stretch is the fixed-ratio equivalent of Ableton's simple Stretch buttons — Ableton's *curved* Time Warp is richer, see 1(b). |
| **Two-layer undo shape (conceptually)** | Edit-menu Undo/Redo reverts notes; a separate per-tool **Reset** reverts only the tool's own dial state [manual p.280] | `DiffEntry` (D8) is the reserved shape for undo generally; GUI undo/redo doesn't exist yet at all (`Ctrl+Z` is a no-op, `product-roadmap.md` "Undo/redo" row, ⬜) | Not real parity — flagged here because it's the closest conceptual analog. See 1(b)/1(c) for the honest gap. |

### b) In Ableton, not in dotbeat

Grouped by panel, in the order the manual presents them.

**Transform panel (operates on an existing note selection, rewrites it in place):**

1. **Arpeggiate** [manual pp. 281-282] — 18 named arpeggio styles (Up, Down, Down & Up, etc.),
   **Distance** (transposition per step, scale-degree-aware), **Steps**, **Rate**/**Gate**. No
   dotbeat equivalent anywhere (`src/`, `cli/beat.mjs`, `src/mcp/server.ts` — confirmed no
   `arpegg*` match, research 39).
2. **Chop** [manual pp. 283-284] — one-shot destructive split of selected notes into 2-64 parts,
   shaped by **Parts**/**Gaps** (skip-every-Nth pattern design), **Emphasis** (stretch selected
   pattern elements 2-8x), **Variation** (randomized start/end jitter, re-rolled each Apply). The
   screenshot at p.285 shows the Gaps row as a literal step-sequencer-style bar chart the user
   clicks to toggle gap positions. **Not scored in the recommendations table below** — dotbeat's
   own ratchet system is judged the stronger design for this territory; see 1(c) and §4.4 of
   research 39. Only the **Gaps-pattern vocabulary** (skip-every-Nth, stretch-2-8x) is worth
   borrowing, as a future second shaping axis on the *existing* live ratchet parameter, not as a
   ported destructive tool.
3. **Connect** [manual pp. 285-286] — generates notes filling the gaps *between* existing notes;
   randomized placement via **Spread** (pitch), **Density** (% of gap filled), **Rate** (note
   length), **Tie** (probability a generated note extends to the next original note). No dotbeat
   equivalent.
4. **Glissando** [manual pp. 287-288] — MPE Transformation, ties two notes' pitch together along a
   pitch-bend curve. Requires a continuous per-note pitch-bend lane. `BeatNote` has no such field
   (`src/core/document.ts:410-436` — discrete `pitch`/`velocity`/`chance`/`cent` only, `cent` is a
   static ±50c offset, not a curve). No roadmap/decisions entry references MPE anywhere.
5. **LFO (MPE)** [manual p.289] — oscillator-driven modulation of pitch-bend/slide/pressure, with
   **Shape** (sine/square/triangle/random + a Reseed button), **Rate**, **Amount**, and an
   attack/decay envelope shaping the LFO's own amplitude over the note. Same MPE dependency as
   Glissando.
6. **Ornament (Flam / Grace Notes)** [manual pp. 291-293] — Flam inserts one extra note before each
   selected note (**Position** as % of grid, relative **Velocity**); Grace Notes inserts several
   equal-length notes (**Pitch** high/same/low, **Position**, **Velocity**, per-note **Chance**,
   **Amount** = note count). Screenshot p.294 shows re-applying Grace Notes compounds — each Apply
   adds more ornament notes. No dotbeat equivalent — a real, currently-total gap for drum-flam
   programming and melodic ornamentation alike.
7. **Recombine** [manual pp. 295-297] — permutes **one** of Position/Pitch/Duration/Velocity across
   a note selection via **Shuffle** (re-rolled every Apply), **Mirror** (reverse order), or
   **Rotate** (circular shift, optionally grid-quantized). The p.296 screenshot shows this as a
   compact bar-chart display with a **Rotate** dial directly under it. This is Ableton's one
   Transform tool that is structurally a *variation generator*, not a deterministic edit — see the
   recommendation below, which routes it into `src/vary`, not `pitchtime.ts`.
8. **Span — Tenuto / Staccato modes + Offset / Variation** [manual pp. 298-299] — dotbeat only has
   the Legato mode (1(a)). Tenuto preserves original length unless Offset/Variation set; Staccato
   sets length to half the smallest inter-onset gap in the selection. **Offset** (shift end time,
   up to one grid step) and **Variation** (randomized length jitter, re-rolled on re-apply) apply
   across all three modes.
9. **Strum** [manual pp. 300-301] — spreads a chord's note-on times per **Strum Low**/**Strum
   High** (offset lowest/highest note first) and **Tension** (linear-to-exponential curve,
   front/back-loaded — screenshot p.302 shows this as a draggable 2D curve pad). No dotbeat
   equivalent.
10. **Time Warp** [manual pp. 302-303] — a 1-3 breakpoint speed curve remapped onto the time
    selection (accelerando/ritardando), with **Quantize**, **Preserve Time Range**, **Include Note
    End** toggles. dotbeat's `timeScaleNotes` only does a single uniform factor — no curve.
11. **Velocity Shaper** (Max for Live, bundled) [manual p.305] — shapes selected notes' velocities
    against a hand-drawn breakpoint envelope (click to add points, drag to reshape), with
    **Minimum/Maximum Velocity** clamps, a **Loop** count (envelope repeats across the selection),
    and **Rotate**/**Division** offset. dotbeat's `humanize.ts` only does *random* Gaussian
    velocity jitter (`src/core/humanize.ts:34-58`) — no deterministic shaped envelope for
    crescendo/accent design.

**Generate panel (creates new notes from nothing, into a time selection or loop):**

12. **Rhythm** [manual pp. 306-308] — a step-pattern generator for *one pitch or drum pad at a
    time*, meant to be layered voice-by-voice ("deselect the previously generated notes and adjust
    Rhythm's parameters again for a different pitch or drum pad," p.307). Controls: **Steps** (≤16),
    **Pattern** (placement shape, count depends on Steps×Density), **Density**, **Step Duration**
    (pattern repeat count), **Split** (probability a step subdivides), **Shift**, **Velocity** +
    **Accent** level with **Accent Frequency**/**Offset**.
13. **Seed** [manual pp. 308-309] — literal random-notes-in-a-box: independent **Pitch**,
    **Duration**, **Velocity** *range* sliders (Pitch range respects an active clip scale — purple
    slider color cue, p.309), **Voices** (max simultaneous), **Density** (% of pitch range
    populated). The simplest generator in the chapter.
14. **Shape** [manual p.309-310] — notes distributed along a drawn/preset melodic contour between a
    Min/Max pitch, with **Rate** (min note length), **Tie** (extension probability), **Density**,
    **Jitter** (how far pitches wander from the drawn shape).
15. **Stacks** [manual pp. 310-312] — chord/progression generator via a Tonnetz-based "Chord
    Selector Pad" (screenshot p.311: a small draggable diamond-and-lines diagram), **Root**
    (defaults to clip scale root), **Inversion**, per-chord **Duration**/**Offset**. **Notable
    design choice, directly resonant with dotbeat's own philosophy**: custom chord banks are
    "text files that define specific chord rules in the JSON format" with a `.stacks` extension,
    loaded from a user browser folder [manual pp. 310-311] — i.e. Ableton itself chose
    diffable-text-as-content here.
16. **Euclidean** (Max for Live, bundled) [manual pp. 312-314] — up to 4 independently-toggleable
    voices, each with its own pitch/drum-pad assignment and **Rotation** offset (screenshot p.313
    shows a circular multi-ring pattern visualization, one ring per voice, with a dice-icon
    randomize-all-rotations button in the center), governed by shared **Steps**, **Density**
    (repeats within the time selection, wraps if needed), **Division** (step length).

**Cross-cutting UI/UX pattern (not a single tool, but a real interaction-model gap):**

17. **Auto Apply + independent Reset, two-layer undo** [manual pp. 278-280] — every tool
    live-previews as its parameters change (Auto Apply on by default); toggling Auto Apply off
    reverts notes to pre-tool state and switches to an explicit **Apply** button
    (`Cmd/Ctrl+Enter`); a separate **Reset** button restores only the tool's *own dial state*,
    independent of Edit-menu Undo/Redo on the notes themselves. dotbeat's GUI has no undo stack at
    all today (`Ctrl+Z` is a no-op — `product-roadmap.md`, "Undo/redo," ⬜) and no "live preview,
    then commit or revert" pattern for any tool-parameter panel.

### c) In dotbeat, not in Ableton

`beat vary`/humanize/chance/ratchet has **no direct Ableton equivalent** — not a gap in the other
direction, a genuinely different design philosophy Ableton doesn't have a slot for. Worth stating
plainly rather than just logging as a footnote, per the brief.

**1. Per-note trigger probability (`chance`) is a *live, stored document field*, not a one-shot
tool.** `BeatNote.chance` is a 0-100 int [`src/core/document.ts:420`], re-rolled by a seeded RNG
**once per playback pass** (`chanceFires`, `src/core/chance.ts:39-44`) — the note stays
probabilistic every time the project plays, forever, until someone edits the field. Ableton has
nothing structurally like this in MIDI Tools: Chop's Variation and Grace Notes' Chance both
*re-roll only at Apply time*, baking a specific random outcome into concrete notes. dotbeat's
version never bakes — the probability itself is the composed, committed, diffable state
(`chance u10023 65` is what shows up in `git diff`). Ableton has no per-note field that survives
in the file as "there's a 65% chance this note plays" — closer prior art would be a step
sequencer's per-step probability (e.g. Elektron/some Max patches), not anything in this chapter.

**2. Ratchet (`ratchetCount`/`ratchetCurve`/`ratchetLength`) is a live, re-editable per-note
parameter with an explicit opt-in bake step, not Chop's one-shot destructive rewrite.**
`BeatNote.ratchetCount`/`ratchetCurve`/`ratchetLength` [`src/core/document.ts:422-424`] are
stored fields the live engine plays directly (`ui/src/audio/engine.ts`, hand-mirroring
`ratchetSlots`, `src/core/pitchtime.ts:246-260`); `consolidateRatchet`
(`src/core/pitchtime.ts:268-301`) is the explicit, optional "flatten to discrete notes" action —
Ableton's Chop *only* has the flattened-forever mode. Already flagged in research 39 §4.4 as a
confirmed dotbeat strength, restated here because it directly answers the brief: this is the
clearest place dotbeat is ahead, not behind.

**3. `beat vary`/`beat score`/`beat suggest` is a taste-learning loop over parameter space, with no
Ableton analog at all.** Ableton's tools are single-shot or Auto-Apply-live, judged by ear in the
moment, with no persistent scoring exhaust. dotbeat's loop (`src/vary/vary.ts`,
`src/vary/suggest.ts`, `docs/variation-loop.md`) generates a batch (default 9) of seeded,
musically-scoped parameter variants (`VARY_GROUPS` — kick/snare/hats/filter/env/filterenv/osc/
motion/fx/sends/mix, `src/vary/vary.ts:32-108`), writes an append-only JSONL scoring log
(`beat-scores.jsonl`) of ranked picks and rejects with their exact diffs, and `beat suggest`
(`src/vary/suggest.ts`) steers the *next* round using a Bradley-Terry-odds-derived heuristic over
that log (explicitly flagged in-source as a degenerate-case approximation, not a full multi-way
fit — `src/vary/suggest.ts:9-29`). Nothing in Ableton's MIDI Tools chapter persists a taste signal
across sessions or uses past choices to bias future generation; Recombine's Shuffle is the closest
analog and it's memoryless (re-rolled fresh every Apply, no scoring, no history).

**4. `varyFeel` (rung 2, humanize-based) separates "vary the feel" from "vary the timbre" as two
distinct, independently-triggerable operations, both flowing through the same audition/score UX.**
`src/vary/vary.ts:220-252` regenerates note timing/velocity via `humanize` under a fresh seed as a
*full-document variant* siblings to rung-1's parameter variants — same manifest shape, same Keep/
Undo GUI affordance (`VaryAffordance.tsx`, per `phase-23-stream-bb.md`). Ableton has no equivalent
"try several different humanizations of this same part and rank them" workflow — Velocity Shaper
and Chop's Variation are single-shot, not batch-and-compare.

**5. Groove/shuffle is a reversible track-level time-warp with an exact-inverse round trip, applied
at read/playback time — not baked into stored notes.** `shuffleAmount`/`shuffleGrid`
(`src/core/document.ts`) plus `warpStep()`/`unwarpStep()` (`src/core/groove.ts`, a Möbius-ease
curve, exact-inverse unit-tested) are the closest dotbeat concept to Ableton's per-clip Groove pool,
but note the model difference: Ableton's Time Warp (1(b)#10) rewrites note *content* via a curve
applied once; dotbeat's groove is a non-destructive lens the engine applies every playback, toggle-
able/adjustable forever without ever touching stored note starts. Different category, worth noting
as a design-philosophy contrast alongside chance/ratchet above.

---

## 2. Prioritized recommendations

Priorities are decisive: **P0** = build next, cheap and directly closes the "zero generative note
primitives" gap flagged in research 39; **P1** = real value, sequence right after P0; **P2** = real
but narrower/dependent; **Do-not-recreate** = explicitly decline, with reasoning.

**Cross-cutting dependency to flag once, not repeated in every row**: every pitch-range-shaped
generator below (Seed, Rhythm, Shape, Stacks) inherits the scale-awareness caveat from 1(a) — none
of them get Ableton's "automatically scale-aware because a clip scale is enabled" behavior for
free, since dotbeat has no persisted scale-lock field yet (`product-roadmap.md`, "Scale-lock field
+ scale-tone highlighting," ⬜ Not started). Recommendation: ship v1 of each generator against
`fitToScaleNotes`'s existing `SCALES` table (`src/core/pitchtime.ts:104-119`) as an **explicit
per-invocation root+scale parameter** (matching `fitToScaleNotes`'s own signature), not a silent
chromatic-only generator — this gets 90% of the value without waiting on the scale-lock field, and
upgrades cleanly to "reads the persisted scale" later with no interface break.

| Feature | Priority | Build recommendation |
|---|---|---|
| **Euclidean rhythm generator** (drum lanes) | **P0** | New `generateEuclidean(doc, trackId, lane, steps, pulses, rotation, seed?)` in a new `src/core/generate.ts` (sibling to `pitchtime.ts`, same `NoteScopeOptions`-shaped signature and "rewrite → diff" discipline). Bjorklund's algorithm is small and well-known — no external dependency. Wire as `beat generate <file> <track> euclidean --steps 16 --pulses 5 --rotation 0 --seed N` (CLI) + `beat_generate_euclidean` (MCP), and as a new tool kind inside `beat vary` so seeded variants land in the existing manifest/`beat score` flow (matches research 39 §4.2.1's exact recommendation). Operates one lane at a time, same as dotbeat's existing 12-lane drum model (`presets/drum-kits.json`) already supports [manual p.313 confirms Ableton's own Euclidean is per-voice too]. |
| **Seed-style random note generator** (synth/melodic tracks) | **P0** | `generateSeed(doc, trackId, {pitchMin, pitchMax, durMin, durMax, velMin, velMax, voices, density, root?, scale?, seed})` in `src/core/generate.ts`, reusing `SCALES` (`src/core/pitchtime.ts:104-119`) for the optional scale constraint per the dependency note above. Cheapest way to give an agent a genuine "propose a bassline/lead" primitive — seeded and scoreable through `beat vary`/`beat score` immediately. |
| **Recombine-style permutation generator** (Shuffle/Mirror/Rotate over Position/Pitch/Duration/Velocity) | **P0** | Belongs in `src/vary/vary.ts`, not `pitchtime.ts` — it's structurally a variation generator (re-rolled each apply per manual p.297), same category as rung-2 `varyFeel`. Add `varyArrange(doc, trackId, dimension, mode: 'shuffle'|'mirror'|'rotate', opts)` as a rung-2 sibling, same `VaryOptions`-shaped `seed`/`count` contract, feeding `beat score`'s existing ranked-pick flow. This is the single highest-leverage item in the whole list: it reuses 100% of existing scoring/audition infrastructure and fills the explicitly-named "vary the *arrangement*, not just feel or timbre" gap from research 39 §4.2.4. |
| **Ornament — Flam** | **P1** | One-shot note-insertion function next to `consolidateRatchet` in `src/core/pitchtime.ts` (same "mint a fresh id, insert before the source note" shape, `pitchtime.ts:268-301`). `flamNotes(doc, trackId, {position, velocityRel}, opts)`. Cheap, and closes a total gap (no flam primitive anywhere today) that matters specifically for drum programming, dotbeat's other strong suit. |
| **Ornament — Grace Notes** | **P1** | Same file, same pattern as Flam above but N equal-length notes with pitch high/same/low and per-note chance — note `chance` reuse is natural here since dotbeat already has a native per-note chance field (1(c)#1), arguably a *better* fit than Ableton's own bolted-on Chance parameter. Sequence directly after Flam (shared insertion helper). |
| **Span — Tenuto / Staccato modes + Offset / Variation** | **P1** | Extend `legatoNotes` (`src/core/pitchtime.ts:212-233`) to accept `articulation: 'legato'\|'tenuto'\|'staccato'` (tenuto = no-op unless offset/variation set; staccato = half the minimum inter-onset gap in the selection) plus `offset`/`variation` params. Same file, same function signature shape, no new subsystem — one of the cheapest wins on this list. |
| **Stacks-style chord/progression generator with diffable JSON chord banks** | **P1** | `generateStacks(doc, trackId, {chords: ChordSpec[], root, scale?, seed?}, opts)` in `src/core/generate.ts`. Chord-shape table follows `SCALES`'s existing literal-named-table pattern; per Ableton's own precedent [manual pp.310-311], make it user-overridable via a project-relative or `~/.beat/`-style JSON file (mirrors how `presets/factory.json` already works — D9's "presets are tooling, never grammar" applies identically here: chord banks are a lookup table, never an in-file reference). High value for melodic/harmonic content and unusually well-aligned with dotbeat's own diffable-text philosophy — Ableton chose the same shape independently. |
| **Velocity Shaper** (deterministic drawn-envelope velocity shaping) | **P1** | `shapeVelocity(doc, trackId, {breakpoints, min, max, loop, rotate, division}, opts)` in `src/core/pitchtime.ts` or a new `velocity.ts` — distinct from `humanize.ts`'s *random* jitter (`src/core/humanize.ts:34-58`), this is deterministic contour (crescendo/accent design). Real, currently-unaddressed use case; humanize's randomness is not a substitute. GUI needs a breakpoint-envelope editor widget (new, no existing dotbeat analog) — that's the main cost driver, not the core logic. |
| **Time Warp** (breakpoint tempo-curve stretch) | **P1** | Generalize `timeScaleNotes`'s single `factor` (`src/core/pitchtime.ts:80-98`) to accept a 1-3-point breakpoint curve (matching Ableton's own cap [manual p.303]), reusing the existing anchor-and-remap logic. Same file, same pattern, moderate value (accelerando/ritardando phrasing is a real but not everyday need). |
| **Rhythm generator** (richer step-pattern-per-lane than Euclidean) | **P1** | Sequence directly after the Euclidean P0 ships — `generateRhythm(doc, trackId, lane, {steps, pattern, density, stepDuration, split, shift, velocity, accent, accentFrequency}, opts)` in `src/core/generate.ts`. Richer shaping (Split's probabilistic step-subdivision, Accent Frequency) than Euclidean but overlapping value — don't build both simultaneously; let Euclidean prove the pipeline first. |
| **Arpeggiate** | **P2** | `generateArpeggio(doc, trackId, {style, distance, steps, rate, gate}, opts)` — real, well-scoped gap (18 named styles is more than needed for v1; ship 4-6: Up, Down, Up & Down, Down & Up, Converge, Random) but lower urgency than P0/P1 items since a hand-sequenced arpeggio pattern is one of the easier things to already build manually in dotbeat's note editor. |
| **Shape** (melodic contour generator) | **P2** | `generateShape(doc, trackId, {contour: number[], pitchMin, pitchMax, rate, tie, density, jitter}, opts)`. Real but narrower than Seed (P0)/Stacks(P1) — needs a drawn-contour input widget in the GUI (new component, real cost) for its full value; a CLI-only version with a preset contour list (`asc`/`desc`/`arch`/`vShape`) is a cheaper first cut if this gets picked up. |
| **Strum** | **P2** | `strumChord(doc, trackId, {strumLow, strumHigh, tension}, opts)` on simultaneous-onset note groups. Explicitly sequence *after* the Stacks generator (P1) — narrow value (chord-voicing timing only) until there's a reliable source of chords to strum, per research 39 §4.5's own sequencing note. |
| **Connect** | **P2** | `connectNotes(doc, trackId, {spread, density, rate, tie}, opts)` filling gaps between existing notes. Sequence after Seed (P0) — per research 39 §4.5, the closest existing analog once Seed exists is Seed constrained to the between-notes time range; not worth a bespoke tool until that's proven insufficient. |
| **Auto-Apply-live-preview + independent Reset (two-layer undo)** | **P2** | GUI-design pattern, not a primitive — relevant only once any of the P0/P1 generators above gets a GUI panel (they're all CLI/MCP-first per this table). When that panel work happens, borrow the split explicitly: "note state" undo-able via the eventual in-session undo stack (`docs/research/28-undo-redo-vs-checkpoint-history.md`, itself still ⬜ Not started per `product-roadmap.md`), "tool dial state" reset-able independently and *not* part of that stack. Blocked on the undo/redo feature landing first — don't build a bespoke parallel undo mechanism just for generator panels. |
| **Chop's Gaps/Emphasis pattern vocabulary** (as a second shaping axis on ratchet, NOT a ported tool) | **P2** | Not a port — per 1(c)#2 and research 39 §4.4, dotbeat's live ratchet model is already the stronger design; only the *pattern-design vocabulary* (skip-every-Nth via Gaps, stretch-2-8x via Emphasis) is worth mining, as a second field alongside the existing `ratchetCurve` (`src/core/document.ts:423`), if/when ratchet shaping needs a second axis. Don't build ahead of a concrete need. |
| **Glissando** (MPE pitch-bend tie between notes) | **Do-not-recreate** | Requires a continuous per-note pitch-bend expression lane `BeatNote` structurally doesn't have (`src/core/document.ts:410-436` — discrete fields only) and no roadmap/decisions entry references MPE anywhere. Adding one MPE-dependent tool in isolation would mean building MPE-controller support as a side effect of a Transform-panel port — backwards. Revisit only if/when MPE is independently roadmapped, never as a consequence of this comparison. |
| **LFO (MPE Transformation)** | **Do-not-recreate** | Same MPE dependency as Glissando, same reasoning. |
| **Max-for-Live-equivalent user-extensible tool plugin architecture** (custom AMXD-style Transform/Generate tools, third-party install folders) | **Do-not-recreate** | Building a full user-authorable plugin SDK for MIDI tools is a large, ongoing investment disproportionate to a solo-owner project, and it cuts directly against D1 (`docs/decisions.md`) — "document-only format for v1, no generator-code layer." A user-installable code-tool ecosystem *is* a generator-code layer by another name. The two Max-for-Live tools this chapter documents (Velocity Shaper, Euclidean) are already covered as first-class native recommendations above (P1/P0 respectively) — ship those as built-in, typed primitives; skip the extensibility framework around them entirely unless D1 itself gets revisited. |

---

## 3. Sequencing summary (for planning)

If picking up as the next phase's generative-tools stream, in build order:

1. **P0 batch** (one `src/core/generate.ts` module + one `beat vary` extension): Euclidean →
   Seed → Recombine/`varyArrange`. All three plug into existing CLI/MCP/scoring infrastructure
   with no new GUI required to be useful (agent-driven via `beat generate`/`beat vary` first,
   GUI panels later — matches how rung-1 `beat vary` itself shipped CLI-first).
2. **P1 batch, cheap wins first**: Span articulation modes → Flam/Grace Notes (same file,
   same pattern as each other) → Time Warp curve → Stacks chord generator → Velocity Shaper →
   Rhythm generator.
3. **P2 batch**, each explicitly sequenced after a P0/P1 dependency: Arpeggiate, Shape, Strum
   (after Stacks), Connect (after Seed), the Auto-Apply/Reset GUI pattern (after in-session undo
   lands), ratchet's Gaps/Emphasis second axis (only if a concrete need appears).
4. **Do-not-recreate, revisit-gated**: Glissando/LFO (gated on MPE ever getting roadmapped),
   Max-for-Live-style extensibility (gated on D1 itself being revisited — currently a "never"
   per D1's own revisit clause).

---

## Sources

Ableton Live 12 Reference Manual, Chapter 11 "MIDI Tools," pp. 278-314 — text extract
(`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-chapters/ch11.txt`) plus 16 rendered page
images viewed directly this pass: pp. 278, 279, 281, 283, 285, 289, 292, 294, 296, 300, 302, 305,
307, 309, 311, 313 (`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch11/`).
dotbeat internal (read directly this pass): `src/core/pitchtime.ts`, `src/core/edit.ts`,
`src/core/humanize.ts`, `src/core/chance.ts`, `src/core/document.ts`, `src/vary/vary.ts`,
`src/vary/suggest.ts`, `docs/variation-loop.md`, `docs/research/39-ableton-midi-tools.md`,
`docs/research/08-variation-loop-prior-art.md`, `docs/decisions.md` (D1, D9), `ROADMAP.md`,
`docs/product-roadmap.md` (Note editing, Vary/audition loop, Undo/redo rows).

# Multi-region audio placement — schema design proposal (Phase 34 Stream ND)

**Status: PROPOSAL — awaiting owner decision. No implementation in this phase.**

Source: pilot 99 (`docs/research/99-usability-pilot-cli-audio.md`) confirmed that placing two
audio regions at different positions on one track within one section is impossible *by data
model*, not by missing UI — the same gap research/85 hit from the GUI side. Phase 33 explicitly
declared it out of scope ("a genuine core/data-model constraint... not a quick fix"). This doc is
the decision material for lifting it, produced now because Risk #3 (format churn) makes schema
surgery more expensive every week we wait.

## 1. The constraint, precisely

Three facts compose into the ceiling:

1. `BeatScene.slots` is `Record<trackId, clipId>` — **one clip per track per scene**
   (`src/core/document.ts:658`).
2. An audio clip carries **exactly one region** (`BeatClip.audio?: BeatAudioRegion` — one
   media/in/out per clip, by design: "one clip, one thing").
3. The engine starts an audio region **only at the clip's own cycle start** — section start, or
   the clip-loop start (`ui/src/audio/engine.ts:3672`, the `contentStep === cycleStart`
   retrigger). There is no "offset within the section" anywhere in the format or the engine.

So within any one song section, an audio track can sound at most one region, and it always
enters at the section boundary. Consequences already observed in pilots:

- Can't lay a riser at bar 3 of a 4-bar section, or two one-shots at different spots (99, 85).
- `beat audio-split` produces a correct second-half clip that **cannot be placed** where it
  belongs — a scene slot can only hold one of the two halves. The CLI "wires both halves fine"
  at the clip level (pilot 99), but arrangement-level the second half is unreachable in the same
  section. The GUI's "orphaned split output" complaint is this same gap wearing a different hat.

## 2. What must stay true (design constraints)

- **D4 diff discipline**: one placement edit = one line in `git diff`; canonical ordering; no
  false diffs on untouched content.
- **Round-trip identity for every existing `.beat` file** — this must be a zero-diff change for
  all current documents (same bar Phase 32's scene `name` cleared).
- **Fail loudly** over silently-wrong playback (no "format models it, engine plays it wrong").
- **One canonical form per state** (D4/D9) — no two spellings of the same placement.
- Scene = reusable bundle of content; section = one placement of a scene (research/93
  vocabulary, now also carrying scene names).

## 3. Options

### Option A (recommended) — `slot` grows an optional `at`, repeated per placement

Grammar today (one line per track, inside a `scene` block):

```
scene s1
  name intro
  slot bass clip1
  slot fx riser1
```

Proposed: a track may have **multiple `slot` lines**, each an independent placement, with an
optional trailing `at <steps>` (16th steps from the section start, fractional allowed — the
same unit note/hit starts already use):

```
scene s1
  name intro
  slot bass clip1
  slot fx riser1
  slot fx impact1 at 48
  slot fx riser1 at 56.5
```

- **Types**: `BeatScene.slots: Record<trackId, clipId>` becomes
  `Record<trackId, BeatPlacement[]>` where `BeatPlacement = { clip: string; at: number }`.
- **Canonical form**: placements sorted by `at` (ties: clip id), `at 0` elided — so every
  existing document round-trips **byte-identically**, and a single-placement-at-zero scene
  looks exactly like today. One new placement = exactly one added line. This is the Csound
  "one event per line" instinct applied to arrangement, and it keeps `slot` as the *only*
  placement mechanism (no parallel grammar).
- **Same clip placeable twice** (riser1 above) — placements are references, which falls out of
  the model for free and is musically common (the same impact sample at two hit points).
- **Overlap**: validation **error** when two placements on one track would overlap in time
  (region timeline length computed from in/out/rate/bpm), matching Ableton's no-overlap
  arrangement rule and fail-loudly. Truncate-at-section-end stays as today.
- **Non-audio tracks**: the grammar is general, but v1 **validation rejects** `at > 0` or
  multiple placements on synth/drums/instrument tracks ("multi-placement is audio-only for now
  — synth/drum clips tile from the section start"). Lifting that later is a pure
  validation+engine change, zero grammar churn. (Rejected alternative: accept-and-ignore — a
  synth clip placed at step 48 that actually plays at 0 is exactly the silent wrongness the
  project refuses.)

**Blast radius** (est. one phase, 3-4 streams):
| Layer | Work |
|---|---|
| core: parse/serialize/document | `at` token, placement arrays, canonical sort+elision, validation (overlap, audio-only, clip-exists) |
| core: diff | `scene-slot` entries become placement-granular: `scene s1: fx +impact1@48` |
| core: edit | `setScene` takes placements; new `placeClip`/`unplaceClip` primitives; `splitAudioClip` gains the obvious follow-up: **auto-place the second half at `split point` in every scene that placed the original** — which retroactively fixes the orphaned-split gap for real |
| CLI/MCP | `beat scene` grammar extends `<track>=<clip>[@<steps>]` (repeatable); `beat place <file> <scene> <track> <clip> <at>` / `beat unplace` as friendlier verbs; matching MCP tools |
| daemon | `/scene`-family payloads carry placement lists |
| engine | schedule region starts at `sectionStart + at` (a per-placement retrigger check instead of the single `cycleStart` one); gain-automation lookup becomes placement-relative |
| GUI | arrangement view draws one block per placement; clip editor targets (track, scene, placement); drag-to-place sets `at` |

### Option B — keep `slot` unique per track; add a separate `place` statement

`slot` stays one-per-track ("the" clip, at 0); extra regions go on new nested lines:
`place fx impact1 48`. Smallest parser delta and perfectly backward compatible — but it creates
**two spellings of "this clip sounds in this scene"** (a `slot X` and a `place X 0` would mean
the same thing), violating one-canonical-form, and permanently splits placement across two
grammars every downstream consumer (diff, GUI, engine, docs) must merge. Rejected: saves maybe
a day now, costs a permanent conceptual seam.

### Option C — arrangement-level absolute-time region lane (bypass scenes for audio)

A top-level block placing audio regions at absolute song positions, independent of sections —
the "real DAW arrangement view" model, closest to where M4 (recording, comping) eventually
wants to be. Rejected **for now**: it introduces a second timing system alongside
scene/section (every consumer must reconcile both), breaks the "song = list of scene
placements" invariant that the GUI, diff, and vary/selection machinery all lean on, and most
of its extra power (regions spanning section boundaries) has no current user. Revisit when M4
recording lands and takes/comping force absolute-time thinking anyway; Option A does not
foreclose it (a future `arrange` block can coexist, and placements migrate mechanically).

## 4. Recommendation

**Option A.** It is the only option that is simultaneously: one grammar (no parallel placement
mechanism), byte-identical for every existing file, one-line-per-edit diff-clean, and honest
about scope (audio-only enforcement now, generalizable later without grammar change). It also
turns `audio-split` from "correct but arrangement-orphaned" into genuinely lossless, closing a
known GUI bug class as a side effect.

Format version: v0.11. Suggested sequencing: core+CLI/MCP+engine first (agent/CLI usable
immediately, consistent with where real usage is happening), GUI arrangement rendering second.

## 5. Open questions for the owner

1. Approve Option A (grammar + audio-only-for-v1 validation stance)?
2. `at` unit: 16th steps (consistent with note/hit starts — recommended) vs bars (consistent
   with section lengths)? This doc assumes steps.
3. Should `beat audio-split` auto-place the second half (recommended) or leave placement to a
   separate explicit step?

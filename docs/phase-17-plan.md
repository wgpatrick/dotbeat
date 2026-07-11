# Phase 17 — engine consolidation, Ableton-standard controls, and scoping the next big pushes

*Kicked off 2026-07-11, following the owner's decisions (D13/D14/D15 in `docs/decisions.md`) and
direction for the next round of work. Five streams. Sequenced deliberately, not just parallelized
blindly: Stream L (engine consolidation) owns `ui/src/audio/engine.ts` and the CLI render paths
exclusively this round — Streams O and P (M4 clip-editing, FX arsenal) are scoped as research +
format-level design this round specifically so they don't collide with Stream L's engine surgery
or build on top of an engine that's mid-consolidation. Streams M and N have no engine dependency
and run fully parallel to everything.*

## Stream L — consolidate onto one canonical audio engine (D15)

Execute the decision already recorded in `docs/decisions.md` D15 — read it in full before
starting, it has the complete reasoning.

1. Retarget `cli/render.mjs` to drive dotbeat's own `ui/` (a local build/dev server of `ui/`,
   headless Chromium, the same pattern `ui/verify*.mjs` already establishes) instead of a BeatLab
   checkout. `--beatlab-dir`/`BEATLAB_DIR` should no longer be required for this to work at all.
2. Retire `cli/render-offline.mjs` and `scripts/build-headless-engine.mjs` (both BeatLab-dependent,
   the former confirmed silently broken in this environment per Phase 12 Stream 2's finding). Check
   what depends on `beat render --offline` (CLI help text, `beat vary`/`beat score`'s batch render
   path, any test/verify script, `scripts/verify-m3.mjs` etc.) before deleting — if something real
   depends on offline rendering for speed, that's worth flagging honestly rather than silently
   breaking it; the decision doesn't mandate zero offline-render capability forever, just that the
   BeatLab-dependent, broken version goes.
3. Update anything that referenced the old dual-path setup: `README.md`, `cli/beat.mjs`'s usage
   text, any doc describing `beat render --offline`.
4. **Verify hard**: render a real project through the new `cli/render.mjs` path, confirm real
   audio comes out (metrics via `src/metrics`, same evidence bar this project always uses), and
   confirm the whole thing works with **zero BeatLab checkout present anywhere** on the machine
   (or simulate that — rename/hide any cached checkout during the test) — that's the actual
   success condition, not just "it still works when a BeatLab checkout happens to be there."
   Re-run existing tests that depended on `render.mjs` (`scripts/verify-phase*.mjs` where
   applicable) against the new path.

Owns: `cli/render.mjs`, `cli/render-offline.mjs` (likely deletion), `scripts/build-headless-
engine.mjs` (likely deletion), `cli/devserver.mjs` (likely deletion — it only existed to spawn a
BeatLab dev server), `cli/beat.mjs`'s render-related help text, `README.md`. Do not touch
`ui/src/audio/engine.ts` itself (it's already correct — the CLI paths are moving to point at it,
not the other way around) beyond what's strictly needed to make it drivable headlessly if it isn't
already (check `ui/verify*.mjs` first — if headless Chromium can already load and drive `ui/`
against a real daemon, most of the plumbing exists).

## Stream M — Ableton-standard arrangement/note editing controls

Owner's direction, close to verbatim: *"replicate all the standard types of UI/UX controls in
Ableton — dragging the size of notes, moving notes around, click multiple notes to move/resize/
delete together, click-and-drag a selector rectangle to select multiple notes."* Owner is an
Ableton user — match its actual conventions, not a generic guess.

1. **Research first, specifically**: Ableton Live's arrangement/piano-roll interaction model —
   marquee (rubber-band) selection, multi-select (shift-click, cmd/ctrl-click), group drag (move
   many selected notes together, preserving relative offsets), group resize (drag one selected
   note's edge, all selected notes resize proportionally or in lockstep — check which Ableton
   actually does), group delete, keyboard shortcuts (arrow-key nudge, delete key, select-all,
   duplicate). Cite what you find; this doesn't need a full adversarial research pass, but get the
   actual behavior right, not a plausible guess — the owner will notice if it doesn't match.
2. **Build in `ui/`**: extend `NoteView.tsx` (piano roll) and likely `StepSequencer.tsx` (drum
   grid, if the same multi-select/marquee model applies there — check whether Ableton's own drum
   rack step view has an equivalent) with: marquee selection (click-drag on empty canvas space
   draws a selection rectangle, selects everything inside), multi-select (shift/cmd-click adds to
   selection), group move (drag any selected note, all move together), group resize, group
   delete (Delete/Backspace key), keyboard nudge (arrow keys move selected note(s) by one grid
   unit). Every group operation should still produce a clean multi-line diff (one line per
   changed note), not a whole-document rewrite.
3. **Verify live**: select 3+ notes via marquee, drag them together, confirm each note's new
   position is correct and the diff shows exactly the moved notes. Multi-select via shift-click,
   delete, confirm exactly those notes are gone. Resize one of several selected notes, confirm the
   group resize behavior matches whatever Ableton convention your research settled on.

Owns: `ui/src/components/NoteView.tsx`, `ui/src/components/StepSequencer.tsx` (if in scope per
your research), `ui/src/state/store.ts` (additive — likely needs multi-note-selection state
distinct from the existing single-selection/pointing-protocol selection, don't conflate the two).
No engine.ts changes needed (this is edit/selection UI, not playback). Result in a new
`docs/phase-17-arrangement-controls.md`.

## Stream N — a Claude Code skill for dotbeat (D14)

The owner's chosen agent-surface investment: BYO-Claude-Code, made excellent rather than building
an embedded chat panel. A **skill** (in the sense Claude Code itself uses skills — read how this
project's own `.claude/` or any skill-authoring convention you can find documents the format, or
default to a well-structured `SKILL.md`/markdown-plus-frontmatter convention if none is locally
documented) that teaches Claude Code how to use dotbeat well: project layout (`.beat` file +
`media/`), the `beat` CLI's real command surface (read `cli/beat.mjs`'s help text as ground
truth), the edit-primitive vocabulary (`beat set <path> <value>`, what paths look like), how to
read a `beat diff`, `beat vary --scope selection` and the selection protocol, `beat mcp-init` for
zero-setup MCP access, and the render/metrics/critique loop. Aim for a skill that would make a
*fresh* Claude Code session immediately productive on a dotbeat project without having to
discover all of this by trial and error — the same problem this project's own `docs/agent-setup.md`
(Phase 10) partially addresses, but as an actual Claude Code skill artifact, not just a doc a
human reads.

Verify by actually trying it: if there's a way to load/invoke the skill in a real Claude Code
session against a real dotbeat project and confirm it changes behavior (fewer wrong CLI
invocations, correct use of `--scope selection`, etc.), do that. If the skill format/invocation
mechanism isn't something you can test standalone in this environment, at minimum verify every
command/path/flag the skill documents against the real current CLI (`cli/beat.mjs --help` or
equivalent) so nothing in it is stale or wrong on day one.

Owns: a new skill file/directory (your call on the right location — check for an existing
`.claude/skills/` convention in this repo first, create one if none exists), `docs/agent-setup.md`
(update if the skill supersedes or should cross-reference it). No overlap with any other stream.
Result in `docs/phase-17-cc-skill.md`.

## Stream O — M4 scoping: Ableton's audio-clip editing toolset (research + design, not engine code)

Owner's framing: M4 is "the engine that modifies audio samples" — velocity, cutting/splicing
clips, time-warp. Research Ableton's actual standard toolset here before scoping anything.

1. Research Ableton Live's audio-clip editing feature set specifically: warping (Complex/
   Complex Pro/Repitch/Texture/Beats warp modes — what each actually does, when Ableton picks
   one over another), clip splitting/splicing (the split-at-playhead gesture, consequences for
   automation/warp markers), velocity editing on audio (how "velocity" even applies to an audio
   clip vs. a MIDI note — this may be more of a gain/transient-shaping concept for audio, worth
   getting precise about rather than assuming it means the same thing as note velocity), warp
   markers (manually anchoring a point in the audio to a musical position).
2. **Cross-reference against what dotbeat's format and M4 design already say**: `docs/format-
   spec.md` (does the format model audio clips as a first-class thing yet, distinct from
   note-based clips?), `docs/m4-native-engine-design.md`, and research 05's engine-architecture
   findings (already-verified: Tracktion-graph-style compiled node lists). Also check the
   still-open WASM-DSP-library question (Rubber Band vs. signalsmith-stretch) flagged repeatedly
   as unresearched — this is the actual missing piece for warping specifically, and it's
   reasonable for you to close that gap as part of this research if time allows.
3. **Produce a scoping recommendation**, not code: what's genuinely M4-tier (needs the native
   engine — likely full warp-mode parity, sample-accurate splice/comp editing) vs. what might be
   buildable sooner on the current web engine (a WASM time-stretch library is explicitly named in
   research as viable in the web tier too, per `ROADMAP.md` §6's table). Write this as a new
   `docs/research/16-audio-clip-editing.md` (matching this project's numbered research-doc
   convention) ending in a concrete recommendation for what Phase 18 (or later) should actually
   build first.

**Do not touch `ui/src/audio/engine.ts` or any CLI render path this round** — Stream L owns the
engine surface this round, and this stream's job is to have a well-researched plan ready for when
engine work resumes, not to start it concurrently. If a genuinely trivial, safe, format-only
addition presents itself (e.g., the format not yet having a field to mark a "split point" in a
clip), noting the gap in the research doc is enough — don't implement it yet.

## Stream P — instrument/track FX arsenal: Ableton's standard toolkit (research + design, not engine code)

Owner's framing, clarified: "instrument-track FX parity" means sound-shaping/effects on tracks —
beat repeat, ping-pong delay, and similar standard DAW effects, to be added incrementally.

1. Research Ableton Live's standard built-in audio-effects rack: Beat Repeat, Ping Pong Delay,
   Auto Filter, Auto Pan, Chorus, Phaser, Flanger, Grain Delay, Redux (bitcrush — dotbeat already
   has a bitcrusher), Saturator, Vinyl Distortion, Utility — what each does, and specifically
   which ones are "essential/commonly reached for" vs. exotic, to prioritize.
2. **Cross-reference against what's already in dotbeat's engine**: `src/core/document.ts`'s
   `SYNTH_FIELDS` already models EQ3, compressor, distortion, bitcrush, reverb/delay sends,
   sidechain duck (read the full table). Beat Repeat and Ping Pong Delay specifically are
   currently absent. Identify exactly which standard effects are missing, which are partially
   covered by an existing field, and which would need new format fields (a real format change,
   flagged as such, not assumed trivial).
3. **Produce a prioritized build list**, not code: which 2-4 effects are highest-value to add
   first (the owner named Beat Repeat and Ping Pong Delay explicitly — treat those as the
   likely-first candidates unless research suggests otherwise), what format changes each needs,
   and a rough implementation sketch (Tone.js has some of these built in — e.g. `Tone.PingPongDelay`
   exists natively — note where the DSP is nearly free vs. needs real building). Write this as a
   new `docs/research/17-track-fx-arsenal.md`.

**Do not touch `ui/src/audio/engine.ts`, `src/core/document.ts`, or any CLI render path this
round** — same reasoning as Stream O. This is the research and design pass that makes Phase 18's
actual FX-adding stream fast and well-scoped, not the implementation itself.

## Explicitly out of scope this round

Per owner direction: **no further work on humanize/feel/algorithmic content-generation** (`src/
vary`'s rung-2 `feel` work) — "we'll get there, but not right now." Don't let Stream O or P's
research wander into that territory even if it seems related.

## Process

Stream L runs alone on the engine/render-path surface. Streams M and N are fully independent
(different files entirely, no engine dependency). Streams O and P are research-and-design only
this round specifically to avoid colliding with Stream L and to avoid building on a
mid-consolidation engine — their actual implementation is Phase 18's job, informed by both this
round's research and Stream L's now-single canonical engine. `npm test` must stay green throughout
(293+/287+/0/6) for every stream that touches this repo's own suite (L, and M/N if they add tests).

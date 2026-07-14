# Phase 37 — deepen the loop: feedback, generation & real sound sources

Source: owner direction 2026-07-14. GUI testing surfaced mostly *parity* pain (tracked as backlog
rows); this phase instead pushes the **CLI/MCP song-writing wedge** across four owner-named areas:
learn-from-existing-songs, automated feedback, generative approaches, and external sound sources.
Owner approved the shape and the two open choices (Freesound-now + ElevenLabs-research; demos =
marquee three + automation taste). Two explorations this session set reuse-vs-build:
- Section feedback is mostly reuse: `analyze()` (`src/metrics/analyze.ts`) is whole-file DSP;
  per-section metrics are derivable by rendering the song once and slicing the WAV at section
  boundaries (bar math in `cli/render.mjs:96`). Reuse `worstTrack`/`TrackContribution`
  (`lint.ts`), `variance.ts`, and `renderTrackSolosCommand`'s store-solo session.
- The Freesound CC0 pipeline is already built (`scripts/freesound-cc0.mjs` + `prep-oneshot.mjs`
  + `<path>.json` provenance sidecars) — RD is a wire-in, not a build.
- Clip automation is not varyable today — RC's real build gap. The taste-loop harness
  (`src/vary/batch.ts` + `audition.ts`) and automation-point primitives (`setAutomationPoint`,
  `edit.ts`) both exist to build on.
- Symbolic musical analysis is greenfield but pure functions over notes/scenes — no rendering.

No format bump this phase — all streams are additive tooling over existing grammar.

## Streams

| Stream | Work | Renders? | Primary files |
|---|---|---|---|
| RA | Section-aware feedback + `render --stems` | yes (proof) | `src/metrics/`, `cli/render.mjs`, `cli/beat.mjs`, `src/mcp/server.ts` |
| RB | Symbolic song analysis (`src/analysis/`) | no | `src/analysis/` (new), `cli/beat.mjs`, `src/mcp/server.ts` |
| RC | Automation generation + vary | yes (proof) | `src/core/edit.ts`, `src/vary/`, `cli/beat.mjs`, `src/mcp/server.ts` |
| RD | Freesound CC0 into the taste loop | no | `cli/beat.mjs`, `src/mcp/server.ts`, `scripts/freesound-*.mjs` |
| RE | Research 103: generative-audio APIs (no code) | no | `docs/research/103-*.md` |

### RA — section-aware feedback (audio-domain)
`beat feedback <file> [--sections] [--ref profile.json]` (+ `beat_feedback` MCP): render the song
once, slice the captured WAV at section boundaries (cumulative `bars`), `analyze()` each slice →
per-section `MixMetrics` → an **energy-arc report** (LUFS / band shares / width / crest per
section + section-to-section deltas, variance-padded via `variance.ts`); optional
per-section-vs-reference-profile (reuse OD's `refFindings`). Reuse `analyze`, `worstTrack`,
`renderTrackSolosCommand`'s store-solo session pattern. Build: a section-slice helper + a report
formatter. Also ship **`beat render --stems`** (per-track stem WAVs — the not-started Render row;
`renderTrackSolosCommand` already produces the per-track captures). CLI + MCP + a render proof.

### RB — symbolic song analysis (no rendering)
New `src/analysis/` of pure, deterministic functions over notes/hits/scenes/placements: onset
density & syncopation per section, pitch-class histogram vs the declared scale (reuse
`fitToScale`'s `SCALES`), repetition/novelty across sections (self-similarity of section content).
Feeds `beat feedback`'s arrangement-level critique (no audio needed) AND establishes the internal
structure vocabulary Phase 38's audio-structure import will emit into. `beat analyze-structure`
(name TBD; may fold into `beat feedback`) + MCP. Known-answer fixture tests.

### RC — automation generation + vary
(a) `beat automate-shape <file> <track> <clip> <param> <ramp|sine|triangle|exp|adsr> [--from --to
--cycles --points]` fills an automation lane via `setAutomationPoint` (the "Predefined automation
shapes" roadmap row, made a generator). (b) Automation as a **vary target**: `beat vary <track>
automation:<param>` (+ `beat_vary`) generates movement candidates (shape + depth + rate jitter)
into the existing `writeVaryBatch → score → adopt → audition` harness — closing the "vary can't
touch automation" gap. CLI + MCP + a render proof that the sweeps are audible.

### RD — Freesound CC0 into the taste loop (build this phase)
Wire `scripts/freesound-cc0.mjs` + `prep-oneshot.mjs` into `beat source search <query>` /
`beat source add <id> <file>` (+ `beat_source_*` MCP), registering straight into `media` via
`setMediaSample` with the provenance sidecar enforced. **First verify network egress to Freesound
through `$HTTPS_PROXY`** (see `/root/.ccr/README.md`); if blocked, ship the offline half (local
`prep-oneshot` ingestion of a supplied file → registered media) and flag the egress gap loudly in
the result. Zero licensing risk (CC0 hard-filtered). API key from env only, never committed.

### RE — research 103: generative-audio APIs (no code)
`docs/research/103-generative-audio-apis.md`, house research format (claims + sources + confidence
labels + honest gaps). Questions: can generated vocal-chops/SFX legally ship inside a user's MIT
`.beat` project (ElevenLabs & peers' per-plan/commercial terms)? quality for musical use; cost;
network reality through the proxy; and a recommended integration slice with an effort estimate.
Gates a Phase 38 build; targets the owner's vocal-chop pain.

## Sequencing
RB and RE start immediately (no Chromium contention). RA/RC/RD dispatch after Part-1 demo renders
finish (RA/RC are render-heavy). RB's report hooks merge into RA's `beat feedback` output —
coordinate the merge (RA ships the audio arc; RB appends the symbolic section) or land RA first.

## Deferred to Phase 38 (noted, not built now)
- `beat analyze` audio-structure import (research 102's Python-sidecar slice → `beat skeleton`) —
  first Python dependency; RB builds the vocabulary it emits into.
- ElevenLabs generative-audio build, gated on RE.
- Chord/melody extraction (research 102 rung 2).

## Wrap-up (standing habits)
CLI/MCP usability pilot on the new `feedback`/`automate-shape`/`source` surface; roadmap +
`product-roadmap.md` + `roadmap-dashboard.html` + README + dotbeat skill refresh.

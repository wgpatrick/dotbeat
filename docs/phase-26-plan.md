# Phase 26 — build the Ableton-comparison P0 shortlist

*2026-07-12. Built off `docs/research/69-ableton-comparison-master-synthesis.md`, the consolidated
backlog from 19 chapter-by-chapter comparisons against Ableton Live 12's own reference manual
(`docs/research/50-68`). This phase builds the 11-item P0 shortlist and fixes the two correctness
bugs the research surfaced along the way. P1/P2 items and the do-not-recreate register are now
folded into `docs/product-roadmap.md` (92 → 220 tracked features) but are explicitly out of scope
for this phase.*

## Fix first — two correctness bugs (Stream DA)

Not features — silent regressions where the `.beat` file and what you hear have already diverged.
Both fully diagnosed in `docs/research/69-...md` §0, both isolated to `ui/src/audio/engine.ts`:

1. **Reverb/delay sends wired pre-fader, not post-fader** — `reverbSend`/`delaySend` tap the signal
   upstream of the track's own volume fader in both `buildSynthChain()` and `getDrumBus()`, so
   riding a fader never affects the wet signal reaching the shared buses. Fix: move both taps
   downstream of `vol` (but still downstream of `muteGain`).
2. **Clip automation and LFO modulation clobber each other** on every shared parameter except
   `cutoff` — the LFO's additive pass runs strictly after the automation pass in the same tick and
   silently overwrites it. Fix: generalize `applyLfoAdditive()` to compose against the automated
   value when one exists, the same pattern already proven for `cutoff`.

Both ship together as one stream — same file, same root cause category (tick-order bugs), cheap to
verify together with one extended version of `docs/volume-fader-bugfix.md`'s measured-audio method.

## Streams

| Stream | Feature | Roadmap area | Primary files | Research |
|---|---|---|---|---|
| DA | Fix pre/post-fader sends + automation/LFO clobbering | — (bugfix) | `ui/src/audio/engine.ts` | research/69 §0 |
| DB | In-session multi-level undo/redo | Undo / redo (in-session) | `src/daemon/daemon.ts`, new `src/daemon/undo.ts`, a History-panel-style GUI affordance | research/28, 52 |
| DC | Instrument-track + drum-bus FX chain parity | Core effects / Extended FX arsenal | `src/core/document.ts` (`effects` field), `ui/src/components/InstrumentPanel.tsx`, `ui/src/audio/engine.ts` (drum-bus wiring) | research/50, 64 |
| DD | Macro Controls | Macros | new `src/core/macro.ts`, `presets/macros.json`, daemon route, CLI/MCP, `ui/src/components/SynthPanel.tsx` | research/27, 63, 64 |
| DE | Level metering: per-effect + peak segment | Mixer | `ui/src/components/MixerView.tsx` (`TrackMeter`), `ui/src/components/SynthPanel.tsx` (`EffectRow`) | research/61, 63 |
| DF | GUI Quantize | Note editing (piano roll) | `ui/src/components/NoteView.tsx` (`PitchTimePanel`) — backend (`quantizeNotes`) and daemon route already exist | research/57 |
| DG | Copy/duplicate notes + clipboard | Note editing (piano roll) | `src/core/edit.ts` (new primitives), `ui/src/components/NoteView.tsx` | research/57 |
| DH | Real wavetable oscillator | Synth sound design | `ui/src/audio/engine.ts`, `src/core/document.ts` (`OscType`), `ui/src/components/synthParams.ts` | research/68 |
| DI | Curved automation segments + exact numeric breakpoint entry | Automation | `src/core/document.ts` (`BeatAutomationPoint.interpolation`), `ui/src/components/ArrangementView.tsx` (`AutomationLane`) | research/65, 50, 55, 66 |
| DJ | Insert Scene + Capture-and-Insert Scene | Arrangement / song structure | `src/daemon/daemon.ts` (generalize `sceneFromLiveContent`), `src/core/edit.ts`, `ui/src/components/ArrangementView.tsx` | research/54 |
| DK | Drum-sampler voice type | Drum programming | `src/core/document.ts` (new lane backing), `ui/src/audio/engine.ts` (sample playback voice), lane UI | research/68 |
| DL | Per-parameter velocity/key modulation, generalized | Synth sound design | `ui/src/components/synthParams.ts` (destination-list pattern, mirrors `LFO_DESTS`), `ui/src/audio/engine.ts` (dispatch) | research/68 |

## Merge order

`ui/src/audio/engine.ts` is the contention point — DA, DC, DE, DH, DK, DL all touch it. Merge order:
**DA first** (small, and every other engine.ts-touching stream should land on top of the fix, not
around it), then the engine.ts-light streams (DB, DF, DG, DI, DJ — mostly untouched or trivial
engine.ts contact), then the engine.ts-heavy streams (DC, DD, DE, DH, DK, DL) last, one at a time,
re-running each prior stream's own live-verify script after every merge as a regression check —
same discipline as Phases 22-24.

## Verification

Each stream ships its own Playwright-driven live-verify script (`ui/verify-phase26-stream-d*.mjs`)
against a real `beat daemon` + built frontend, measuring actual rendered/recorded audio via
`src/core/metrics.ts` where relevant — no mocked assertions. Re-run directly after merge, not
trusted from a stream's own self-report.

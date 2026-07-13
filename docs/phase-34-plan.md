# Phase 34 — agent-surface completeness + two foundation calls

Source: the 2026-07-13 project review (this session, PM pass over Phases 32-33 + pilots 94-100).
The owner's direction: focus on (a) closing the agent-surface gap, (b) render non-determinism,
and (c) the multi-region audio schema decision — while the owner separately dogfoods the MCP/CLI
surface making real tracks. That dogfooding is the other half of this phase: these streams
harden exactly the surface being dogfooded.

Context: Phase 33 deliberately deferred "add the missing MCP tools" (its MB stream only made
`beat mcp`'s coverage *claim* honest) and deferred render non-determinism as "an engine
characteristic." This phase picks both up for real, because each is load-bearing for the thesis:
the vary/score taste loop is dotbeat's most differentiated feature and an agent currently cannot
drive it (pilot 95); and the metrics/lint/vary loop's numbers are only trustworthy if run-to-run
render variance is measured and honestly accounted for (pilot 96 measured ~1 dB between identical
re-renders).

## Streams

| Stream | Work | Primary files | Source |
|---|---|---|---|
| NA | MCP tool coverage: `beat_vary`, `beat_score`, `beat_sample`, `beat_lane` | `src/mcp/server.ts`, `test/mcp*.test.ts`, `cli/beat.mjs` (usage text) | pilot 95; phase-33 MB2 deferral |
| NB | Per-command help: `beat <cmd> --help` / `beat help <cmd>` | `cli/beat.mjs` | pilots 94, 97 |
| NC | Render non-determinism: measure, diagnose, fix-or-tolerance | `cli/render.mjs`, `src/metrics/lint.ts`, `scripts/`, docs | pilot 96; phase-5 result note |
| ND | Multi-region audio schema: design proposal (no implementation without owner sign-off) | `docs/multi-region-audio-design.md` | pilot 99; research/85 |

## NA — MCP tool coverage for the taste loop

`beat mcp` exposes ~50 tools but not `vary`, `score`, `sample`, or `lane` — so an MCP-only agent
can *suggest* (beat_suggest exists) but can neither generate variant batches, record ranked
picks, register media, nor back a drum lane with a sample. The taste loop (ROADMAP §7, D2's
triangle) is exactly the workflow we most want agents driving.

1. **`beat_vary`** — both rungs, same semantics as the CLI: param-group variants
   (`varyTrack`) and `feel` variants (`varyFeel`), writing `vN.beat` + `manifest.json` into an
   out-dir. Reuse the CLI's manifest shape *exactly* (score reads it). Support `count`, `amount`,
   `seed`, `outDir`, `timing`/`velocity`/`pushLate`/`swing`/`lanes`/`ids` for feel. `render:
   true` optional flag matching `--render` (honest description: real-time capture per variant,
   slow). No `--scope selection` in v1 of the tool (needs a running daemon port; agents can pass
   explicit `lanes`/`ids` — note the omission in the tool description honestly).
2. **`beat_score`** — record 1-3 ranked picks against a batch dir; accept `"N"`/`"vN"` pick
   forms (same normalization the CLI got in ME2); same jsonl log append, same `--log` override.
3. **`beat_sample`** — register media (sha256 computed, path relative to the .beat), mirroring
   `sampleCmd` including the exists-check error message.
4. **`beat_lane`** — back a drum lane with a registered sample (`sample-id|none`, gain, tune),
   mirroring `laneCmd`.
5. **Parity discipline (the pilot-95 lesson):** each handler must call the same core functions
   with the same argument-shaping as the CLI command — where the CLI applies defaults or
   normalization, the MCP handler applies the identical ones. Where practical, extract the
   shared shaping into `src/` helpers both surfaces import, so the next drift can't happen.
6. **Update `beat mcp`'s usage text** in `cli/beat.mjs` — after this stream, only `daemon`
   (long-running process, structurally not a tool call) stays CLI-only. Keep the text honest.
7. **Protocol tests** following the existing `test/mcp` patterns: tools/list includes the new
   four; a vary→score round-trip through real handler calls on a temp project produces a
   readable scores log entry byte-compatible with what `beat suggest` parses.

## NB — per-command help

Pilots 94 and 97 both hit this: the only help is the monolithic no-args dump ("more man page
than onboarding"), and `beat <cmd> --help` isn't recognized. Restructure the USAGE literal into
a per-command table (command → usage lines), generate the existing monolithic dump from it
(byte-comparable output, so no doc churn), and add:

- `beat <cmd> --help` and `beat help <cmd>` → print just that command's block, plus a one-line
  "related:" pointer where natural groupings exist (vary/score/suggest; checkpoint/history/
  restore/pin/unpin/pins; effect-add/rm/move/bypass; clip/scene/song family).
- Unknown `<cmd>` in `beat help <cmd>` → the standard "unknown command" error, exit 2.
- `--help` handling must not shadow commands whose own args could be literally `--help`-less —
  i.e. intercept `--help` only as the *first* argument after the command name.

## NC — render non-determinism: measure, diagnose, fix or encode tolerance

Pilot 96 measured ~1 dB LUFS variance between *identical* re-renders; the phase-5 result doc
measured ±0.4 LU / ±4 band pts / ±2 dB width and attributed it (plausibly, not conclusively) to
event-loop-vs-render-thread scheduling. Since D15, the render path is a **real-time capture**
of dotbeat's own engine in headless Chromium — so leading-edge alignment jitter (when the
capture starts relative to transport start) is a prime suspect distinct from true DSP variance.

1. **Measure**: `scripts/measure-render-determinism.mjs` — N≥8 renders each of
   `examples/real-groove.beat` and `examples/night-shift-song.beat`; report per-metric
   min/max/stddev (LUFS, true peak, crest, band shares, width) and wav-length/leading-silence
   deltas. Commit the script (it's a reusable diagnostic) and the measured numbers (in the
   result section of this doc).
2. **Diagnose**: separate *alignment* variance from *DSP* variance — e.g. trim both wavs to
   first-sample-above-threshold and re-measure deltas; compare sample counts. If trimmed
   variance collapses, it's capture alignment; if not, it's the engine.
3. **Fix if cheap**: if alignment dominates, align the capture (start capture on a rendered-
   audio edge, or trim deterministically before writing the wav) inside `cli/render.mjs` —
   fidelity-neutral, no engine change.
4. **Encode what remains honestly**: whatever variance survives becomes a named constant
   (`RENDER_RUN_VARIANCE_LU` or similar) that (a) `beat lint` uses to round/pad its thresholds
   so a finding can't flip between identical renders, (b) `beat metrics` mentions in `--json`
   output metadata, and (c) the vary manifest's existing "only compare renders from the same
   batch" note cites with the real number.
5. **Document**: a short `docs/render-determinism.md` with the measurements, the diagnosis, and
   what tolerance consumers should assume; roadmap row update.

### Result (2026-07-13)

Measured with `scripts/measure-render-determinism.mjs` (committed): N=8 on
`examples/real-groove.beat`, N=5 on `examples/night-shift-song.beat`, spreads = max−min.

- **real-groove (N=8)**: LUFS 0.038 LU, true peak 0.587 dB, crest 0.603 dB, worst band share
  0.36 pt, width 0.747 dB. Captures were byte-length-identical; leading-silence spread 0.1 ms.
- **night-shift-song (N=5)**: LUFS 0.153 LU, true peak 0.080 dB (limiter pins sample peak at
  0 dBFS), crest 0.169 dB, worst band share (sub) 1.61 pt, width 1.317 dB, correlation 0.014.
- **Diagnosis: DSP variance, not capture alignment.** Trimming every run to its first
  non-silent sample and equalizing lengths left every spread essentially unchanged (width
  1.317 dB both ways; sub band 1.6 pt both ways), and leading-edge jitter was ≤0.8 ms. The
  variance is voice/LFO **phase relationships** re-quantizing onto different 128-sample render
  quanta each run: energy metrics (LUFS/RMS) nearly deterministic, phase-sensitive metrics
  (peaks, width, low-band FFT shares) move. Research/96's "~1 dB" was a true-peak swing —
  reproduced (0.59 dB at N=8); today's LUFS stability (≤0.17 LU) is far better than the
  phase-5-era ±0.4 LU.
- **No render.mjs change** (alignment doesn't dominate; amplitude trim would be
  fidelity-negative and provably wouldn't reduce the spread). Tolerance encoded instead:
  `src/metrics/variance.ts` — `RENDER_RUN_VARIANCE_LU` 0.25 / `_PEAK_DB` 1.0 / `_BAND_PCT` 2.0
  / `_WIDTH_DB` 1.5 (measured max, rounded up). `beat lint` pads all thresholds by these (a
  finding can't flip between identical renders; padded threshold reported in the finding);
  `beat metrics --json` + MCP `beat_metrics` emit `meta.renderRunVariance`
  (`RENDER_RUN_VARIANCE_META`, one shared definition); `src/vary/batch.ts`'s manifest comment
  cites the real numbers. Full write-up: `docs/render-determinism.md`. Tests 632/632 green
  (new: lint threshold-padding test).

## ND — multi-region audio schema: design before code

Pilot 99 confirmed the one-clip-per-track-per-scene ceiling is a core data-model constraint
(the scene slot map is `track -> clip`). Risk #3 (format churn) says schema surgery gets more
expensive every week; this stream produces the *decision material*, not the migration.

Deliverable: `docs/multi-region-audio-design.md` — the current model's exact constraint, 2-3
candidate schemas with real `.beat` text examples, blast radius per option (parser, serializer,
converter, daemon, GUI arrangement view, render engine, diff semantics), migration/compat story,
and a recommendation. Owner sign-off required before any implementation phase.

## Wrap-up (standing habits)

- CLI/MCP usability pilot against the new NA/NB surface (research/101+).
- Roadmap rows: add/update for MCP taste-loop coverage, per-command help, render determinism;
  refresh `docs/product-roadmap.md` + the HTML dashboard artifact.
- README refresh if the MCP tool story changes materially (it does — the "CLI-only" caveat dies).

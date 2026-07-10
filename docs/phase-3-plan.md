# Phase 3 build plan — the guardrail layer (ROADMAP M3, first slice)

> **STATUS: COMPLETE (2026-07-10).** The closed loop ran for real and hit its target to
> **0.01 LU** — see "Result". This is the *first* M3 slice — see "What M3 work this deliberately
> does NOT include" below for the honest cut line.

M2 gave an agent surgical edit + musical diff + render. What's missing for the critique loop is
**ears it can trust** — and the fully-verified research says exactly what those must be.

## What the research settled (re-read before building — `research/03-ai-listening.md`, D2)

- **Audio-LLMs cannot be the ears.** Confirmed at high confidence: they frequently answer from
  text priors with the audio replaced by noise; their errors are 55-64% perceptual (mis-hearing),
  which no reasoning layer can compensate for; and they cannot produce calibrated numeric
  judgments (emotion-regression R² at or below predict-the-mean for all 11 evaluated models).
  So: **every number in this subsystem comes from deterministic DSP.** An LLM may later *narrate*
  the numbers (D2) — it never generates them, and nothing in this phase requires an LLM at all.
- **The ground-truth metric list comes straight from the research question's own framing**,
  which survived verification as the sane architecture: EBU R128 / ITU-R BS.1770 loudness
  (integrated, K-weighted, gated), true peak, PLR/crest, spectral balance, stereo field.
- **Masking detection is deferred, explicitly.** No verified evidence provides a workable recipe
  (the report's own caveat: no benchmark even tests it), and the automix literature's
  interpretable baseline is gain/pan-only (automix-toolkit reads confirmed DMC = 2 params/stem).
  Shipping a fake masking metric would be exactly the silent-wrongness D2 exists to prevent.
- **Parameter-estimation, not audio-to-audio** (Diff-MST finding, HIGH): analysis must map to
  *editable project parameters* — which for us means lint findings phrase themselves in terms of
  `.beat`-addressable edits (`lead.volume`, master headroom), and the closed loop applies real
  `beat set` edits, not opaque audio transforms.

## The pieces

| # | What | Where |
|---|---|---|
| 3.1 ✅ | Metrics engine, pure TS, zero deps: WAV decode (16-bit PCM); **integrated LUFS** per ITU-R BS.1770-4 (K-weighting biquads designed from the spec's filter parameters at any sample rate, 400 ms blocks, 75% overlap, -70 LUFS absolute + -10 relative gating); sample peak + **true peak** (4× windowed-sinc oversampling); **crest factor / PLR**; **spectral balance** (radix-2 FFT, Hann, 5 bands: sub <60, bass 60-250, mids 250-2k, presence 2-6k, air >6k, + spectral centroid); **stereo correlation + width** | `src/metrics/` |
| 3.2 ✅ | Metric tests against synthetic signals with *a-priori known* values: the BS.1770 calibration case (997 Hz full-scale sine = **0.0 LUFS** stereo / **-3.01** single-channel — see Result #1 for how the initially-drafted expectation was itself wrong), -20 dBFS ≈ -20.0; sine crest = 3.01 dB, square = 0 dB; band energy lands in the right band; inverted channels → correlation -1 | `test/metrics.test.ts` |
| 3.3 ✅ | `beat metrics <wav> [--json]` + `beat lint <wav> [--target <LUFS>]` — deterministic, opt-in rules: true-peak clipping risk, loudness vs target (default -14 LUFS, the common streaming normalization point), over-compression (low crest), spectral imbalance, effectively-mono. Each finding names the metric, the measured value, the threshold, and — where the format can express the fix — the `.beat` edit to try | `cli/beat.mjs`, `src/metrics/lint.ts` |
| 3.4 ✅ | `beat mcp` — minimal stdio MCP server (JSON-RPC 2.0: `initialize`, `tools/list`, `tools/call`), zero new deps, exposing: `beat_inspect`, `beat_set`, `beat_add_note`, `beat_rm_note`, `beat_diff`, `beat_metrics`, `beat_lint`, `beat_render`. Protocol-level subprocess test | `src/mcp/server.ts`, `test/mcp.test.ts` |
| 3.5 ✅ | The closed loop, run for real: render `examples/real-groove.beat` → measure LUFS → compute a gain edit toward a target → apply via the real edit primitives → re-render → re-measure → **assert loudness measurably moved toward the target**. This is the deterministic skeleton of the M3 exit criterion — every tool an agent would call over MCP, chained end to end | `scripts/verify-m3.mjs` |

## Exit criterion (ROADMAP M3, and what this slice proves of it)

ROADMAP M3's exit test is: *"Claude, given only the repo + MCP, can render a project, read its
metrics, and propose an accepted-or-rejected diff that measurably moves LUFS toward a target."*

- [x] This slice proves the **entire tool chain** of that sentence works end to end, run for
      real (`scripts/verify-m3.mjs`): baseline render of the real groove measured **-18.00
      LUFS**; target set to -15.00; a per-track `+3 dB` volume edit proposed and applied through
      `beat set` (semantic diff: `drums: volume -10 -> -7`, `bass: -8 -> -5`, ...); re-render
      measured **-14.99 LUFS** — distance to target went from 3.00 LU to **0.01 LU**. The
      remaining delta to the literal criterion is putting Claude in the driver's seat over the
      MCP server this slice ships — an interactive session, one command away (`beat mcp` + an
      MCP-capable client), not more engineering.

## What M3 work this deliberately does NOT include (second slice, planned, not forgotten)

- **Engine extraction** (real BeatLab graph on `node-web-audio-api`) — justified by Phase 2's
  22× measurement, sized as its own phase; the loop works today at realtime-render speed.
- **Arrangement timeline** (ROADMAP calls it the biggest pure-eng lift) — beatlab-side feature
  work, separate track.
- **LLM narration of metrics** (D2's "model narrates" half) — needs the MCP server this phase
  ships; narration quality is an interactive concern, not a testable-in-CI one.
- **Masking/frequency-conflict detection** — see research note above; do not fake it.

## Sequencing

3.1 → 3.2 (validates it) → 3.3 (consumes it) → 3.4 (wraps everything) → 3.5 (proves the chain).

## Result

67 tests green (was 55). The guardrail layer exists, and it measures true through a real
render round trip — the +3 dB ask landed as +3.01 measured LU, which validates the BS.1770
implementation against the real engine, not just against synthetic sines (those pass too:
the spec's 997 Hz calibration case reads 0.003 dB off reference).

`beat lint` on the real groove's actual render, unedited:

```
INFO [loudness-vs-target] integrated loudness -18.0 LUFS is 4.0 LU below the -14.0 LUFS target
     fix: raise all track volumes by ~4.0 dB (beat set song.beat <track>.volume <dB> per track)
INFO [low-end-heavy] 79% of spectral energy sits below 250 Hz — the mix likely reads as muddy...
INFO [dull-top-end] only 0.5% of spectral energy sits above 2 kHz — the mix likely reads as dull/dark
INFO [effectively-mono] stereo width -38.9 dB (correlation 1.000) — the mix is effectively mono
     fix: pan tracks apart (beat set song.beat <track>.pan <-1..1>)
```

Every one of those is *checkably true* of the default groove (all tracks sit at pan 0; the
groove is bass-dominated with closed filters) and each maps to a concrete `.beat` edit — the
Diff-MST "analysis must land on editable parameters" lesson, working. No LLM was involved in
producing any number or finding above, per D2.

Found by building, this phase's collection:

1. **The test constant was wrong, not the code.** First LUFS run measured 0.0028 LUFS where the
   test expected -0.69 — but BS.1770's -0.691 constant exists precisely to cancel the K-filter's
   gain at 997 Hz, so full-scale stereo 997 Hz *is* 0.0 LUFS (single-channel is -3.01). The
   implementation was right to 0.003 dB; the expectation was folklore. Worth remembering:
   validate tests against the spec's own calibration cases, not against recalled reference
   numbers.
2. **A pure sine legitimately fails mix lint** (crest 3 dB reads as over-compressed) — the "sane
   mix" test fixture had to be a pulsed tone. Deterministic rules mean the test fixtures have to
   be musically honest too.
3. **K-weighting's high-pass corner (~38 Hz) barely touches 50 Hz** — the bass-attenuation test
   originally used 50 Hz and failed; 20 Hz shows the intended >6 LU attenuation. The filter is
   working as specified; intuition about "bass rolloff" was miscalibrated.

Next (second M3 slice / M4 prep): engine extraction onto `node-web-audio-api` (Phase 2 measured
22× — turns this loop's ~40 s of rendering into ~2 s), LLM narration over `beat mcp` (D2's other
half), arrangement timeline (beatlab-side), and the interactive Claude-over-MCP demo of the
literal exit criterion.

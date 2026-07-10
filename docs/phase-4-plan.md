# Phase 4 build plan — the real engine, offline (M3 second slice)

> **STATUS: COMPLETE (2026-07-10).** `beat render --offline` runs BeatLab's *actual* engine on
> `node-web-audio-api` — no browser, no vite — and the offline closed loop is perfectly
> self-consistent (+3 dB ask → +3.00 LU measured). But the 22× speed hypothesis did NOT survive
> contact with the real graph, and this phase surfaced two real upstream divergences — all
> measured and documented in "Result". The most bug-dense phase yet; every one found by running.

Phase 2's spike proved the runtime (real Tone.js on `node-web-audio-api`, 22× realtime). Phase 3
built the loop that needs it (render→measure→edit→re-measure, currently ~40 s of which ~39 are
rendering). This phase connects them — with the real engine, because a re-implemented
"approximately BeatLab" synth would violate the fidelity stance (D5) the moment the two drifted.

## What the research settled (apply, don't re-decide)

- **Headless = a small browser-API shim, not a refactor** (`docs/opendaw-notes.md` §3): openDAW's
  headless renderer is the *real* engine class plus a worklet-globals shim — they never forked or
  re-implemented the engine for tests. Our equivalent: BeatLab's real `engine.ts` + `store.ts`
  bundled as-is (esbuild, which beatlab already ships), with `import.meta.env.DEV` defined away
  and three tiny global shims (`localStorage`, `requestAnimationFrame` for `Tone.getDraw`, and
  the web-audio polyfill itself).
- **The engine↔store coupling is real** (recon: `engine.ts` line 3 imports `useStore`; `tick()`
  reads state per step) — so the bundle carries both, *unmodified*. The clean package split stays
  deferred (ROADMAP M0 note): tonight's rule is **don't refactor the production app while its
  owner sleeps**; the bundle approach gets the speed without touching beatlab at all.
- **Tone.js has no clean Node teardown** (archaeology §9) — explicit `process.exit`, as
  everywhere else in the CLI.
- **D5 fidelity discipline**: headless Chromium remains the reference renderer. The two paths
  can't be byte-compared — the Chromium path passes through MediaRecorder's *lossy* opus encode —
  so fidelity is verified at the metric level (duration/LUFS/peak/spectral within tolerances),
  which is exactly what the metrics engine from Phase 3 is for.

## The pieces

| # | What | Where |
|---|---|---|
| 4.1 ✅ | `scripts/build-headless-engine.mjs`: esbuild-bundle a tiny entry (`useStore` + `engine` + `DEFAULT_SYNTH` + `audioBufferToWav`, straight from beatlab source) into `dist-headless/engine.mjs` — `tone` kept external (must be the same module instance the runner polyfills), `import.meta.env.DEV=false`, everything else bundled | beatlab-daw (reads beatlab sources, writes nothing into beatlab) |
| 4.2 ✅ | `cli/render-offline.mjs`: polyfill → shims → `Tone.OfflineContext` → import bundle → seed the store (`mode: 'sandbox'`, then the same `applyDawState` every other consumer uses) → `engine.play()` → `render()` → WAV. Auto-(re)builds the bundle when missing/stale | cli |
| 4.3 ✅ | `beat render --offline` flag; Chromium path unchanged and still the default reference | `cli/beat.mjs`, `cli/render.mjs` |
| 4.4 ✅ | Fidelity + speed verification: render the same real `.beat` both ways, compare metrics within tolerances (duration ±0.05 s; LUFS ±1 LU; peak ±1.5 dB — the opus transcode on the reference path is the loosest link), and record the measured speedup | `scripts/verify-m4.mjs` |

## Exit criteria

- [x] `beat render --offline examples/real-groove.beat` produces a valid, non-silent WAV with
      **no browser and no dev server** — but at 0.73× realtime, NOT a small fraction of it (the
      honest measurement; see Result).
- [x] Metric-equivalence verified with a revised, honest contract: same music, same spectrum
      (band shares within 2%), same dynamics (crest within 0.7 dB), same duration — plus a
      **constant, measured 9.5 LU level offset** from differing DynamicsCompressor auto-makeup
      formulas between Chromium and the Rust engine (LUFS and peak offsets agree within 0.8 dB,
      proving it's pure gain, not distortion). ROADMAP Risk #6, now measured, not hypothetical.
- [x] Phase 3's closed loop re-run fully offline: **+3 dB ask → +3.00 LU measured, distance to
      target 0.00 LU** — the loop is perfectly self-consistent within the offline path. Total
      loop wall-clock 23 s (two renders + metrics + edits) vs ~60 s on the Chromium path.

## Explicitly deferred

The proper `core`/`engine`/`ui` package split in beatlab (this bundle is the operational
extraction; the structural one comes when beatlab work is on the table again); worklet-based
rendering; stems export; sample-accurate A/B against an unencoded reference capture.

## Sequencing

4.1 → 4.2 → 4.3 → 4.4.

## Result

The offline path works and the loop runs on it end to end — but three of this phase's four
headline facts were discovered by running, not designing, which is by now the project's most
consistent finding about itself:

1. **The 22× hypothesis failed.** Phase 2's spike (simple filtered-saw graph) extrapolated to
   22× realtime; the full engine graph (6-oscillator MetalSynths, PolySynth voice pools,
   per-track filter/EQ/compressor/distortion chains, sends, master bus) renders at **0.73×
   realtime** in the Rust engine — the DSP itself is the cost (9.8 s of the 10.4 s total),
   not clock yields or setup. The win is real but different than hoped: **zero infrastructure**
   (no Chromium, no vite, no ports — CI-friendly) and a **2-3× faster closed loop** (23 s vs
   ~60 s), not a 22× render. Speeding this up further means upstream Rust engine profiling or
   lighter graphs — logged as an open question, not assumed.
2. **node-web-audio-api explodes on PeriodicWave + negative-frequency FM** (isolated by
   bisection: sine carrier at modIndex 32 → peak 1.0; square carrier → peak 8.5e6; swing kept
   positive → stable). Tone.MetalSynth (beatlab's hats) is exactly that pattern. Mitigation:
   sine carriers for hat/openhat only, in the offline runner only — hats stay present behind
   their 4-7 kHz highpass, timbre differs slightly, quantified by the fidelity check. Worth
   reporting upstream.
3. **The two Web Audio implementations disagree on DynamicsCompressor auto-makeup** (~2 dB per
   stage; the always-on master limiter + drum-bus compressor stack it to a constant 9.5 LU).
   The fidelity contract was rewritten to be honest about this: identical music/spectrum/
   dynamics, constant offset measured and reported. Crucially the offset is *linear*, so the
   agent loop's arithmetic still lands exactly (+3 asked, +3.00 measured) — within-path targets
   are exact; cross-path absolute targets (e.g. "-14 LUFS for streaming") should use the
   Chromium reference, per D5, which stays the reference for exactly this reason.
4. Also fixed on the way: the spec's write-once WaveShaper.curve rule (Chromium is lenient,
   Rust enforces it, Tone's Distortion re-assigns) — patched with a splice-in-fresh-shaper
   wrapper that preserves real curve updates; and Tone's worklet path (BitCrusher) parked
   cleanly so the wet branch is silent rather than crashing (bitcrushMix 0 = exact).

The openDAW "headless = real engine + small shim" lesson held: beatlab's sources were not
modified at all — one esbuild bundle (tone external, DEV defined false) plus four runner-level
shims/patches, each with a comment saying exactly why it exists and when it can be deleted.

Next candidates, in order of leverage: the interactive Claude-over-MCP session (everything it
needs now exists, and renders are CI-cheap); upstream fixes/report for the two divergences;
the ROADMAP's flagged research passes (engine architecture — now with a concrete motivating
question: why is the Rust graph 30× slower than the spike graph); arrangement timeline.

## Addendum (2026-07-10, later): upstream-independence pass — two divergences resolved, one reattributed

Follow-up work took "wait for upstream" off the critical path (docs/upstream/ has the revised
full story):

- **Tier 2:** bitcrush works offline via a WaveShaper-backed stand-in (its DSP is pure
  quantization); verified to produce real quantization harmonics, mix-0 renders unchanged.
- **Tier 3:** deeper bisection **corrected Result item 2** — the FM explosion is in the native
  `square`/`sawtooth` types (PeriodicWave was always fine), and it's **already fixed on the
  crate's main branch, just unreleased**. `scripts/build-patched-webaudio.sh` builds the binding
  against the fixed crate (pinned revs); the hat sine-carrier mitigation is deleted, and
  verify-m4 now matches the reference's presence+air share to **0.01%**.
- **Result item 3 reclassified:** the Rust compressor implements the *spec's* makeup formula —
  the 9.5 LU offset is Chromium-vs-spec latitude, not an upstream bug. Calibrate (D5), don't
  patch.

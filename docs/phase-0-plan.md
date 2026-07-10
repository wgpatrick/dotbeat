# Phase 0 build plan — prove the core loop

> **STATUS: COMPLETE (2026-07-10).** Every item below shipped and is verified — see "Result" at
> the bottom. Kept as-is (not rewritten past-tense) so the reasoning that led to each step stays
> visible; check marks show what's done.

> Distinct from `ROADMAP.md` (the big picture) and `ROADMAP-ARTIST.md` in the `beatlab` repo (a
> separate, unclaimed product roadmap for BeatLab-as-teaching-tool). This document is the
> concrete, short-horizon plan for the vertical slice that tests whether the whole `.beat` thesis
> holds up in practice, before investing further in the bigger roadmap.

## Why two tracks in two repos

Code recon (reading `store.ts`/`engine.ts` directly) surfaced two things that reshape the plan:

1. **`AppState.sandboxSnapshot` already exists and is nearly the shape we need** — tracks, notes,
   patterns, synth params, scenes, bpm, loop bars, all plain serializable data. There is no
   working serializer/persistence yet, but the state shape is proven.
2. **`engine.ts` is a live-context singleton** (`masterBus.chain(masterLimiter,
   Tone.getDestination())` at construction) — `Tone.Offline()` doesn't drop in for free. The
   pragmatic render path is a `MediaRecorder` tap on the master bus in headless Chromium
   (real-time capture, not instant offline render). `ROADMAP-ARTIST.md`'s WAV-export item
   independently reached the same conclusion.

`ROADMAP-ARTIST.md`'s Phase L (sandbox persistence, WAV export, project file save/load) is,
almost exactly, the "prove the state model round-trips to a file" step Phase 0 needs — and it's
currently unclaimed. Rather than build a parallel, redundant JSON serializer in `beatlab-daw`, we
implement Phase L for real in `beatlab` (Track A — ships immediate value to the live app), then
build the `.beat` text format as a layer on top of that *proven, real* JSON shape (Track B) rather
than a speculative one.

## Track A — BeatLab (`wgpatrick/beatlab`, ships to the live app)

Implements `ROADMAP-ARTIST.md` items 1, 4, 2 in that order (1 is a prerequisite for 4; 2 is
independent but needed before Track B.4).

| # | What | Where |
|---|---|---|
| A.1 ✅ | `serializeSandbox()`/`restoreSandbox()`, versioned `{v:1,...}` payload, debounced save to localStorage, restore on load | `src/state/sandboxPersistence.ts`, `store.ts` |
| A.2 ✅ | Same payload, downloadable/re-importable as `.beatlab.json` via a file picker | `src/components/ProjectToolbar.tsx` |
| A.3 ✅ | WAV export: `MediaRecorder` tap on `masterLimiter`, record N loop passes, download | `src/audio/engine.ts` (`recordWav`), `src/audio/wavEncode.ts` |
| A.4 ✅ | Verified end-to-end (Playwright: groove → reload → still there, zero ID collisions; save/load round-trips a real file incl. the invalid-file error path; exported WAV contains real non-silent audio at the right duration), engine smoke suite 14/14, mobile layout checked, pushed to `beatlab` `main` (`04a3c64`, `b377cfa`) | — |

**Exit criteria:** a sandbox groove survives a reload, can be saved/loaded as a JSON file, and can
be exported as a real WAV — all live in production, independent of anything in `beatlab-daw`.

## Track B — beatlab-daw (the `.beat` text format proof)

Builds on Track A's real, working JSON shape rather than inventing test fixtures.

| # | What | Where |
|---|---|---|
| B.1 ✅ | Froze `.beat` v0 grammar — **deliberately minimal**: bpm/loop_bars, synth tracks only, one synth device per track (9-field subset of `SynthParams`), notes only. Csound-style positional note lines + one-param-per-line synth fields (for real single-line diffs) + Humdrum-style canonical ordering + DAWproject-informed field choices | `docs/format-spec.md` (v0 section, frozen) |
| B.2 ✅ | Parser + serializer — pure TS, zero Tone.js/React/beatlab deps, strict (missing/unknown fields error loudly) | `src/core/{document,format,parse,serialize}.ts`, 12 tests |
| B.3 ✅ | Round-trip property tests: `serialize(parse(x)) === x`; `parse(serialize(obj))` deep-equals `obj`; a single synth-param edit produces exactly one changed line | `test/roundtrip.test.ts` |
| B.4 ✅ | Converter: real `.beatlab.json` (generated from the live app, not hand-built) ↔ `.beat` text, with an explicit, tested report of exactly what v0 drops (drum tracks, 65 of 74 SynthParams fields) rather than silent data loss | `src/core/convert.ts`, `test/convert.test.ts` (9 tests against `test/fixtures/real-sandbox.beatlab.json`) |
| B.5 ✅ | `beat render` CLI — headless Chromium (the `scripts/smoke.mjs` spawn pattern), loads a `.beat` file, drives the real app's store actions to apply it, calls the real `exportSandboxWav()`, writes a `.wav` to disk | `cli/render.mjs` |

**Exit criteria — the actual thesis test — MET:** `examples/real-groove.beat` (a real exported
project, hand-inspectable, `cutoff 3200`/`resonance 1.4` and an inserted note all plainly visible
as the exact edits that were made) rendered via `beat render` to a real, valid, non-silent
44.1kHz stereo WAV (1,365,376 bytes, 7.74s, verified peak/duration/RIFF header). Separately,
`test/roundtrip.test.ts` confirms the specific claim this phase was built to test: changing one
synth parameter produces a diff of **exactly one line**:
```diff
-    cutoff 4500
+    cutoff 900
```
The thesis holds. See "Result" below for what this means for the rest of `ROADMAP.md`.

## Explicitly deferred past Phase 0

Daemon, MCP server, DSP metrics, AI critique loop, multi-track automation, drum patterns in
`.beat`, Tauri tier — everything in `ROADMAP.md` §8 M1 onward. Phase 0 is scoped to prove the
core loop end to end on the smallest possible slice, not to build toward feature completeness.

## Sequencing (as planned, and as it actually happened — matched)

A.1 → A.2 (same payload) → A.3 (independent, can interleave) → A.4 (needs all three) → B.1
(can start once A.1's shape is settled, doesn't need A.2/A.3 done) → B.2 → B.3 → B.4 (needs A.1's
real payload) → B.5 (needs A.3's export code path + B.4's converter).

## Result

The vertical slice worked, on the first real attempt, with no redesign needed mid-flight. Three
things worth carrying forward into M1+:

1. **The engine recon paid for itself immediately.** Knowing upfront that `engine.ts` is a
   live-context singleton (so `Tone.Offline()` doesn't drop in) meant Track A.3 was built right
   the first time — real-time `MediaRecorder` capture — instead of discovering that the hard way
   after attempting instant offline rendering.
2. **Two real bugs surfaced only by actually running the CLI, not by writing it carefully:**
   the render process hung after a successful write (fixed with an explicit `process.exit(0)` —
   `vite.kill()`/`browser.close()` alone don't reliably drain Node's event loop, the same issue
   `scripts/smoke.mjs` already had to solve), and `vite.kill()` only killed the `npx` wrapper, not
   the actual vite process underneath (fixed with `detached: true` + a process-group kill). Both
   are exactly the category of thing "measure the plan against real code" was for — an armchair
   review of the script would very plausibly have missed both.
3. **M1's daemon can now be scoped with confidence.** `beatDocumentToPartialTracks()` deliberately
   punts the "reconstitute a full SynthParams" problem to the importing side rather than
   hardcoding beatlab's 74-field defaults inside `core` — the daemon (M1) is exactly that
   importing side, and now has a proven pattern to follow rather than an open question.

Next: `ROADMAP.md` M1 (the daemon + two-way file sync) — everything it needs (a working
serializer, a working converter against real data, a working render path) now exists and is
tested, rather than being milestone-sized unknowns.

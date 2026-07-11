# Phase 17 — Stream L: engine consolidation onto one canonical engine (D15)

*Executed 2026-07-11. Owner: Will Patrick. Co-authored with Claude.*

Executes decision **D15** (`docs/decisions.md`): there is now exactly **one** audio engine —
dotbeat's own `ui/src/audio/engine.ts`, the same engine the live GUI plays through — and the CLI
render path points at it. No BeatLab checkout is required anywhere on the machine to render a
`.beat` file to WAV.

## What changed

### `cli/render.mjs` — retargeted to drive dotbeat's own `ui/`

Before: headless Chromium drove **BeatLab's** app from a separate `wgpatrick/beatlab` checkout on
disk (hard-required `--beatlab-dir`/`BEATLAB_DIR`), spawning a BeatLab vite dev server and calling
BeatLab's own `exportSandboxWav`.

After: the exact pattern `ui/verify*.mjs` already established —

1. boot the daemon (`startDaemon`) on the target `.beat` file (the GUI's data source over HTTP/SSE),
2. serve a production build of `ui/` (`vite preview`; auto-built if `ui/dist` is missing),
3. load it in headless Chromium at `?daw=<daemon-port>` so the store fills from the daemon,
4. `window.__engine.play()` then `window.__engine.recordWav(seconds)` — captures the live
   post-limiter master output (`MediaRecorder` → opus → decode → WAV via the engine's own
   `audioBufferToWav`, the same real-audio path the parity harness uses) and writes the bytes.

Details: the daemon port defaults to `0` (OS-assigned ephemeral) so concurrent/sequential renders
never collide; the preview URL is parsed from vite's own output so a busy port auto-increments
cleanly; render length follows the document (a `song` block plays its full timeline, else one loop
pass) plus an optional `--tail` for reverb/delay tails; repo `dist/` and `ui/dist` are built on
demand so a fresh checkout works out of the box. The legacy `--beatlab-dir`/`--port` flags are
accepted-and-ignored rather than errored, so old invocations don't hard-break.

This is now the reference renderer. It is real-time capture (takes ~as long as the audio is long,
plus a few seconds of daemon/browser/ui-build startup).

### Retired (deleted)

BeatLab-dependent and/or confirmed-broken; all retired rather than repaired-in-place per D15:

- **`cli/render-offline.mjs`** — BeatLab's engine bundled headlessly via `node-web-audio-api`.
  Confirmed to render **total silence** in this environment (Phase 12 Stream 2; needs a locally
  patched `node-web-audio-api` build absent here) and depended on a BeatLab checkout.
- **`scripts/build-headless-engine.mjs`** — bundled BeatLab's engine from a BeatLab checkout; only
  ever consumed by `render-offline.mjs`.
- **`cli/devserver.mjs`** — spawned a BeatLab vite dev server; only reason to exist was the two
  BeatLab render/verify paths.
- **The BeatLab-era verification scripts**, all of which either imported a deleted module or
  hard-required `--beatlab-dir` and so cannot run in a BeatLab-free environment (which is now the
  goal): `scripts/verify-m1.mjs`, `verify-m3.mjs`, `verify-m4.mjs`, `verify-phase5.mjs`,
  `verify-phase7.mjs`, `verify-phase12-presets.mjs`, `spike-offline-render.mjs`. Their living
  replacement is `ui/verify*.mjs`, which already measures real captured audio through dotbeat's own
  engine. None were part of `npm test` (CI runs only `dist/test/*.test.js`), so this has zero CI
  impact.

### Updated references

- **`cli/beat.mjs`** — `render` command routing collapsed to the single path (the `--offline`
  branch is gone; the flag is filtered out if passed). USAGE + header text updated. The two
  `beat vary --render` / `beat vary … feel --render` batch paths now shell out to `render.mjs`
  instead of the retired `render-offline.mjs` (see *Deferred*).
- **`src/mcp/server.ts`** — the `beat_render` MCP tool no longer offers `offline`/`beatlab_dir`;
  it shells to `render.mjs`, adds an optional `tail_seconds`, and its description reflects the one
  engine. (Timeout raised to 10 min since capture is real-time.)
- **`test/master-bus.test.ts`** — deleted (it tested `render-offline.mjs`'s `attachSharedMasterBus`
  exclusively; that code is retired).
- **`test/instrument-clips.test.ts`** — the 3 `instrumentNoteEvents` tests (which loaded
  `render-offline.mjs`) removed; the 7 format/round-trip/edit-primitive/partial-conversion tests
  kept. Scene/song note-resolution for rendering now lives in `ui/src/audio/engine.ts`, exercised
  by `ui/verify-engine-parity.mjs`.
- **`README.md`** — render-path description corrected (quickstart, CLI table, proofs table, and the
  narrative "offline with no browser" paragraph). Light pass, render-related lines only.

## Verification evidence

**Real render through the new path** (`node cli/render.mjs examples/night-shift.beat -o …`),
measured with the project's own `src/metrics` (`beat metrics`):

```
/tmp/ns-render.wav: 7.86s, 2ch @ 48000 Hz
loudness   -8.8 LUFS integrated
peaks      sample 0.0 dBFS, true 0.8 dBTP
dynamics   crest 9.4 dB (rms -9.4 dBFS)
spectrum   sub 45% | bass 32% | mids 21% | presence 1% | air 1%  (centroid 306 Hz)
stereo     correlation 0.935, width -14.4 dB
```

Real, musically-plausible audio — a bass/kick-driven low-heavy mix (sub+bass = 77%, centroid
306 Hz), not silence (which reads as `-∞ LUFS`). Consistent with `ui/verify-engine-parity.mjs`'s
established expectation that night-shift's low-end share dominates.

**BeatLab-independence (the actual acceptance bar).** The one cached BeatLab checkout on this
machine (`/tmp/dotbeat-scratch/beatlab`) was physically moved aside, `BEATLAB_DIR` confirmed unset,
and a `find` confirmed no visible `beatlab` directory remained. The render **succeeded**, producing
a byte-count-identical WAV (`1509164` bytes) with identical metrics (`-8.8 LUFS`, crest `9.4 dB`).
The checkout was then restored and the restore verified. The engine is structurally incapable of
depending on BeatLab (it references it nowhere); this proved it empirically as well.

**Dispatcher + graceful legacy flag**: `beat render --offline examples/night-shift.beat -o …`
(via `cli/beat.mjs`) rendered real audio (`-8.7 LUFS`) with the retired `--offline` flag ignored,
not errored.

**`npm test`**: **287 / 287 / 0 / 0** (tests / pass / fail / skip), run in the worktree.

### Honest note on the test count

Baseline was **293 / 287 / 0 / 6**. The new count is **287 / 287 / 0 / 0** — down 6 *tests*, but
those 6 were exactly the 6 that were **already skipping** in this environment (3
`attachSharedMasterBus` in `master-bus.test.ts` + 3 `instrumentNoteEvents` in
`instrument-clips.test.ts`), because they feature-detect the patched `node-web-audio-api` build
that isn't present here. They only ever exercised the now-retired offline-render internals. So:
**pass count is unchanged (287), fail stays 0, and the 6 skips are gone because the retired code
they tested is gone.** No passing test was lost.

## Deferred / still open (honest)

- **Batch-render speed regression.** `beat vary --render` / `… feel --render` previously used the
  faster-than-realtime offline path; they now use `render.mjs` (real-time, ~loop-length per variant
  plus browser/ui startup). A batch of 9 is meaningfully slower than before. D15 explicitly accepts
  this: *"if a faster-than-realtime batch render path is needed later … that's a fresh build
  bundling `ui/`'s own engine headlessly, not a fix to code that reaches into BeatLab."* Flagged
  here as the concrete future-work item; not built this round.
- **`node-web-audio-api` devDependency** (`file:../upstream/node-web-audio-api`) is now unused (its
  only consumers — the offline renderer and the two skipped tests — are gone). Left in
  `package.json` to keep this stream's blast radius to the render path; a trivial cleanup candidate
  for a future pass.
- **`ui/verify-engine-parity.mjs`** still documents producing its `REF_WAV` via
  `cli/render.mjs … --beatlab-dir`. With one engine, that reference is now produced by *the same
  engine* it's compared against, so the "parity" check is effectively an engine-vs-itself smoke
  test (still useful — it catches a broken render — but no longer a cross-engine parity claim). Not
  rewritten here (sibling-owned file); worth simplifying when that harness is next touched.
- **Stale comments in `ui/src/audio/engine.ts`** reference `cli/render.mjs`'s old Tone graph and
  `cli/render-offline.mjs`. Left untouched by explicit instruction (do not modify `engine.ts`);
  harmless, non-functional.

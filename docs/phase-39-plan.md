# Phase 39 — trustworthy fill-and-hear + generative sound

> **STATUS 2026-07-14:** Owner picked both directions after Phase 38. Two independent streams build
> in parallel worktrees (UA fixes, UB feature); UC is the serial pilot + wrap-up. This doc is the
> source of truth. Owner-side model validation of Phase 38's `beat analyze` proceeds separately.

## Context

Phase 38 shipped audio-structure import (`beat analyze` → `beat skeleton`) on a Python-sidecar
template, proven end-to-end with a stub backend. Pilot 105 reached an audible render but surfaced a
**HIGH silent-render trap** (a groove on a track that isn't placed into a scene renders silent in
song mode, with no warning anywhere), and Phase 38 formally deferred **Stable Audio Open
`beat source gen`** to reuse the now-existing sidecar plumbing. Phase 39 does both: make the
fill-and-hear loop trustworthy, and add local generative sound as the second sidecar.

## Stream UA — silent-render trap + pilot-105 leftovers (no Python)

**1. Orphaned-content detector + warning (the HIGH fix).** New `src/core/coverage.ts`:
`unplacedContentTracks(doc): { trackId, kind, noteCount, hitCount, clipCount }[]` — in **song mode
only** (`doc.song` non-null; loop mode plays live content so returns `[]`), return tracks that have
sounding content (live `notes`/`hits` non-empty, or `clips` containing notes/hits/audio) but are
referenced by **no** scene used in the song. "Referenced" = the track id appears with a non-empty
placement list in `scene.slots` for some scene in `doc.song`. Reuse the resolution pattern in
`src/analysis/structure.ts` (`firstPlacementClip`, per-section slot iteration) — do not duplicate
it loosely; mirror it. Emit the warning from:
- `src/core/inspect.ts` (`describeDocument`) — after the scenes/song block (~lines 209-214), a
  `⚠ track 'drums' has 8 hits but is placed in no scene — song mode won't play it (beat clip →
  beat scene/beat place)` line per silent track.
- `cli/render.mjs` — it already discriminates song vs loop at the render-length math (~lines
  94-98); print the same warning to `console.error` before rendering so a silent render is never a
  surprise. (Warn only; still render.)
The starter `lead` track has no content so never trips it. Known-answer tests in a new
`test/coverage.test.ts` (content-but-unplaced warns; placed track doesn't; loop mode never warns;
empty track never warns) + assert the inspect line.

**2. Render auto-fallback to bundled Playwright chromium.** `cli/render.mjs` currently only
documents `CHROME_PATH` in the launch-failure error. Before surfacing that error, try
`chromium.executablePath()` (playwright-core's programmatic bundled-binary path) and relaunch with
it as `executablePath` when it resolves to an existing file; only if that also fails show the
`CHROME_PATH` message. Order stays: explicit `CHROME_PATH` → system `chrome` channel → bundled
chromium → actionable error. Guard behind a try/catch so a missing bundled browser degrades to the
existing message, never a raw throw.

**3. Importer MCP arg-name ergonomics (LOW, additive only).** In `src/mcp/server.ts`, make
`beat_skeleton` ALSO accept `out`/`analysis` as aliases for `out_file`/`analysis_file` (additive —
existing names keep working; the handler reads whichever is present, erroring clearly if neither).
This directly fixes the pilot's failed natural guess. Do **not** rename existing args. Leave
`beat_analyze_audio`'s `required: []` (its `file` is genuinely optional under `--doctor`, enforced
in-handler) but add a description note that `file` is required unless `doctor:true`.

**4. `add-track instrument` synth nudge (trivial).** The "instrument tracks need a soundfont" error
(cli/beat.mjs) gains a trailing "— or use a `synth` track for a quick part with no sample."

UA touches: `src/core/coverage.ts` (new), `src/core/inspect.ts`, `cli/render.mjs`, `cli/beat.mjs`
(add-track error text only), `src/mcp/server.ts` (beat_skeleton schema/handler only — wrap in
`// ==== Phase 39 Stream UA ====` markers), tests. Stays out of all `beat source`/`beat analyze`
regions.

## Stream UB — Stable Audio Open `beat source gen` (second Python sidecar)

Local text-to-audio one-shot generation, registered into `media` with provenance, reusing every
Phase 38 sidecar convention (documented as shared in `python/README.md` already). Real generation
runs **owner-side** (needs `stable-audio-tools` + torch + a ~couple-GB HF weight download, all
egress-blocked here); a stdlib-only `stub` backend keeps CI/this container green.

**Gen sidecar variant of the contract.** Unlike `analyze` (which emits its whole result as stdout
JSON), gen produces binary audio, so `python/gen.py` **writes the generated WAV to the `--output
<path>` it is told to use** and prints a small JSON **metadata** doc to stdout
(`{backend, provider, model, seconds, seed, sampleRate}`); chatter → stderr. Everything else is
identical to `analyze.py`: stdlib-only top level, backend deps (`stable_audio_tools`, `torch`)
imported lazily inside `run_stableaudio()`; exit codes `0` ok / `2` bad input / `3` missing dep
(last stderr line = copy-pasteable `pip install -r python/requirements-stableaudio.txt`) / `4` gen
failure; `--doctor` probes deps via `importlib.util.find_spec`.
- `python/gen.py`: argv `--backend <stub|stableaudio> --prompt "<text>" --seconds <N> --seed <N>
  --output <wav>` and `--doctor`. `stub` backend writes a **deterministic** seeded WAV of the
  requested duration (a seed-derived tone/noise bed at 44.1 kHz stereo — no prompt interpretation,
  just proves the pipeline; deterministic given seed+seconds so tests assert byte/hash stability).
  `run_stableaudio()`: lazily import stable-audio-tools + torch, generate from prompt/seconds/seed,
  write 44.1 kHz stereo WAV (≤47 s per the model). Clearly comment it as owner-side/unverified.
- `python/requirements-stableaudio.txt`: `torch>=2.0,<3` + `stable-audio-tools` (pin a plausible
  version) + a comment naming the HF weights repo (**placeholder — `stabilityai/stable-audio-open-1.0`
  is the presumed id; MUST be confirmed owner-side**, GitHub/HF unreachable here) and the
  Stability AI Community License + registration-for-commercial-use condition.
- `python/README.md`: fill in the already-stubbed "shared with gen.py" section with the concrete
  gen install/validate steps + the "Powered by Stability AI" attribution note and the <$1M-revenue
  free-commercial-with-registration condition.

**TS + source-lib wiring.**
- `src/analysis/gen.ts` (new): `runGen({ prompt, seconds, seed, backend, outPath }): Promise<{ meta }>`
  and `genDoctor()`, reusing `resolvePython()` (already exported from `src/analysis/sidecar.ts` via
  the barrel) and the same execFile timeout/maxBuffer constants; spawns `python/gen.py` with
  `cwd=repoRoot`; ENOENT/exit-3/exit-non-0 → `BeatSourceError`-style clean errors (map to the
  existing `SourceError`/`BeatEditError` path). Re-export from `src/analysis/index.ts` in a
  `// ==== Phase 39 Stream UB ====` region.
- `scripts/source-lib.mjs`: new `addGeneratedSource({ beatFile, id, prompt, seconds, seed, provider,
  model, license })` sitting beside `addLocalSource`/`addFreesoundSource`. It imports `runGen` from
  `dist`, generates to a temp `media/.<id>.gen.wav`, then calls the existing private `ingest({
  beatFile, id, inPath: tempWav, license: license ?? 'Stability-AI-Community', source: 'generated:
  <provider>', query: prompt, extra: { generated: { provider, model, prompt, seconds, seed,
  licenseUrl } } })` — so all normalization (prepOneshot), sha256/duration, `setMediaSample`
  registration, the enforced provenance sidecar `media/<id>.wav.json`, rollback-on-failure, and the
  re-register note come for free. Remove the temp file in a `finally`.
- `cli/beat.mjs`: `beat source gen <file.beat> <sample-id> "<prompt>" [--seconds N] [--seed N]
  [--backend stub|stableaudio] [--provider stable-audio-open] [--license L]`. Add a `sub === 'gen'`
  branch in `sourceCmd` (positionals `[file, id, prompt]`; add `--seconds`/`--seed`/`--backend`/
  `--provider` to `VALUE_FLAGS`); default backend `stableaudio`, default seconds 2. SourceError→
  BeatEditError mapping is already in `sourceCmd`'s catch. Extend the `source` HELP entry. Wrap the
  gen additions in `// ==== Phase 39 Stream UB ====` markers.
- `src/mcp/server.ts`: `beat_source_gen { file, sample_id, prompt, seconds?, seed?, backend?,
  provider?, license? }` beside `beat_source_add` (own `// ==== Phase 39 Stream UB ====` marker
  block); dynamic-import source-lib like the sibling tools; full inputSchema (every arg declared).
- Tests: `test/gen-sidecar.test.ts`, python3-gated like `analyze-sidecar.test.ts` — `beat source
  gen … --backend stub` registers a media entry, writes the provenance sidecar with the
  prompt/provider/seed, deterministic hash for a fixed seed+seconds, `--backend stableaudio` without
  torch exits with the doctor hint, `--doctor` JSON parses.

**Decision.** Add `docs/decisions.md` D19 — the gen-sidecar variant (Python writes the WAV to a
told-path, TS owns registration/provenance; distinguish from analyze's stdout-only rule) and the
Stability AI Community License posture (outputs are the user's; free commercial use under $1M with
Stability registration; ship "Powered by Stability AI" attribution in dotbeat docs; the license's
distribution/attribution obligations attach to the model, not generated output files).

## Stream UC — pilot 106 + wrap-up (serial, after merge)

- CLI/MCP usability pilot (research/106) over the new `beat source gen` + the fixed render/inspect
  surface: does the silent-render warning actually fire when a user forgets to place content? is the
  gen provenance sane? Framed honestly (stub-only here; real Stable Audio Open is owner-side).
- End-to-end: `beat source gen … --backend stub` a one-shot → place it in a scene → render → hear
  it (deliverable WAV), confirming the orphaned-track warning fires and then clears.
- Wrap-up: `scripts/roadmap-data.mjs` (mark `beat source gen` done, promote the pilot-105 leftovers
  row to done, add any pilot-106 leftovers) → regenerate `docs/product-roadmap.md` → splice the
  dashboard rows + stamp → README status paragraph + test count → dotbeat skill.

## Ordering & process

- **UA ∥ UB in parallel worktrees; UC serial after merge.** They share no files except
  `src/mcp/server.ts` (UA: beat_skeleton region; UB: a new beat_source_gen region) and
  `src/analysis/index.ts` (UB only) and `cli/beat.mjs` (UA: add-track error text; UB: sourceCmd gen
  branch + source HELP) — all in disjoint marked regions, so merges stay mechanical.
- Per CLAUDE.md: **commit AND push this plan to origin/main before dispatching** (worktrees branch
  from origin/main). Confirm plan mode is OFF before dispatching implementation agents.
- Placeholders flagged for owner confirmation: the Stable Audio Open HF repo id and the
  stable-audio-tools version pin (GitHub/HF unreachable here), mirroring the Phase 38 beat_this SHA.

## Verification

`npm run build && npm test` green at every merge (798 existing + new); python3-gated gen/coverage
tests execute here; UC renders a generated one-shot placed in a scene and shows the silent-render
warning firing then clearing; roadmap/dashboard/README/skill refreshed and pushed.

## Critical files

- Reuse: `src/analysis/sidecar.ts` (`resolvePython`, spawn/exit-code contract, timeout constants),
  `scripts/source-lib.mjs` (`ingest`, prepOneshot flow, provenance sidecar + rollback),
  `scripts/prep-oneshot-lib.mjs` (normalize/sha256/duration), `src/analysis/structure.ts`
  (`firstPlacementClip` + per-scene slot resolution — the pattern the coverage detector mirrors),
  `src/core/inspect.ts` (`describeDocument`), `cli/render.mjs` (launch block, song/loop math),
  `python/analyze.py` + `python/README.md` (the sidecar template gen.py copies).
- New: `src/core/coverage.ts`, `src/analysis/gen.ts`, `python/gen.py`,
  `python/requirements-stableaudio.txt`, `test/coverage.test.ts`, `test/gen-sidecar.test.ts`,
  `docs/research/106-*.md`.

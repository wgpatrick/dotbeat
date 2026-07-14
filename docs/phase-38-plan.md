# Phase 38 — learn from real songs: audio-structure import via the first Python sidecar

> **STATUS 2026-07-14:** Owner approved (defaults: adopt the Python sidecar; defer Stable Audio
> Open `beat source gen` to Phase 39). Streams SA / SB / SD build in parallel worktrees; SE is
> serial after merge. This doc is the **source of truth**; the frozen contract in §"analysis.json
> contract" is built against verbatim by both SA and SB.

## Context

Phase 37 shipped the produce-and-critique loop (section feedback, symbolic analysis, automation
generation, Freesound sources). The one owner-named direction still unbuilt is **"using existing
songs as inspiration (figuring out their structure etc)"** — deferred from Phase 37 because it
carries the project's **first non-Node dependency** (research 102's Python-sidecar slice).
`src/analysis/structure.ts` was explicitly shaped for this handoff: its header says Phase 38's
audio import "will emit its detected sections into these same types."

Phase 38 delivers: point dotbeat at a reference WAV → `beat analyze` emits a cached
`*.analysis.json` (tempo/beats/downbeats/sections) → `beat skeleton` scaffolds a structure-matched
empty `.beat` to write into. The full loop then exists: analyze a real track → skeleton → build →
`beat feedback`/`analyze-structure` critique → `beat vary`/`adopt` → render.

**Environment reality that shapes everything:** this container has python3 3.11.15 but no torch,
and the egress proxy blocks PyPI/HuggingFace. Real model inference (Beat This) runs **only on the
owner's machine**; CI and this container exercise identical plumbing through a stdlib-only `stub`
backend. `npm test` stays green with zero Python packages — and even with no python3 at all
(skip-gated integration tests).

## Architecture (one frozen contract, three parties)

`*.analysis.json` sits between: the **Python sidecar** (`python/analyze.py`, emits the analysis
core in **seconds** on stdout, knows nothing about dotbeat), the **TS wrapper**
(`src/analysis/sidecar.ts`: spawns, computes sha256, wraps envelope, caches, atomic write), and
the **TS loader** (`src/analysis/import.ts`: validates, does ALL seconds→bars math, builds the
skeleton doc). If the backend omits bpm (Beat This does), TS derives it from median inter-beat
interval.

### analysis.json contract (FROZEN — SA and SB build against this verbatim)

```json
{
  "dotbeatAnalysis": 1,
  "source": { "file": "ref.wav", "sha256": "<64-hex of the audio bytes>", "durationSeconds": 212.43 },
  "backend": { "name": "beatthis", "version": "1.0.0", "model": "final0" },
  "generatedAt": "2026-07-14T20:11:00.000Z",
  "bpm": 128.02,
  "bpmMethod": "median-ibi",
  "beats": [0.468, 0.937, 1.406],
  "downbeats": [0.468, 2.343],
  "sections": [ { "start": 0.0, "end": 15.02, "label": "intro" } ]
}
```

Rules (enforced by `validateAnalysisArtifact` in `src/analysis/import.ts`, throwing the existing
`BeatAnalysisError`):

- `dotbeatAnalysis === 1` (integer version; unknown version → "newer dotbeat needed").
- `source.file` = path as given at analyze time (relative allowed); `source.sha256` = the
  audio-bytes hash (64-hex) — the **cache key**; `source.durationSeconds` finite > 0.
- `backend.name` non-empty string (`stub | beatthis | allin1` today, open set); `backend.version`
  string; `backend.model` string or null.
- `generatedAt` ISO-8601 string.
- `bpm` finite in (20, 400); `bpmMethod` ∈ `"backend"` | `"median-ibi"`.
- `beats`, `downbeats`: arrays of finite seconds ≥ 0, sorted ascending. `downbeats` MAY be empty.
- `sections`: array MAY be **empty** (pure-beatthis path emits no sections — honest output, not an
  error); each `{ start, end, label }` with `start < end`, non-overlapping, sorted ascending;
  `label` is a string or `null`. **Seconds throughout; bars never appear in this file.**
- Unknown top-level keys are ignored (future additive growth under version bumps).

### Sidecar invocation contract (SB owns the Python side)

- Location: **`python/`** at repo root (NOT `analysis/` — collides with `src/analysis/`):
  `analyze.py`, `README.md`, `requirements-beatthis.txt`, `requirements-allin1.txt`.
- Argv: `<python> python/analyze.py --backend <stub|beatthis|allin1> --input <abs wav path>`;
  separately `<python> python/analyze.py --doctor`.
- Stdout: the analysis **core** JSON only —
  `{ "backend": {...}, "bpm": <float|null>, "beats": [...], "downbeats": [...], "sections": [...] }`.
  Progress/model-download chatter goes to **stderr**. **No file writes from Python** — TS owns all
  file I/O (atomic temp+rename).
- Exit codes: `0` ok · `2` usage/bad input (unreadable/unsupported audio) · `3` missing dependency
  (stderr's last line = a copy-pasteable `pip install -r …` fix) · `4` analysis failure. TS
  surfaces the last non-empty stderr line inside the `BeatAnalysisError` message; for exit 3 it
  appends "run `beat analyze --doctor`".
- `analyze.py` top-level imports **stdlib only** (`argparse, json, sys, wave, contextlib,
  importlib.util`). Backend deps import **lazily** inside `run_beatthis()` / `run_allin1()`,
  wrapped to produce exit 3 on ImportError.
- `stub` backend: reads WAV duration via stdlib `wave` (16-bit PCM) and emits a **deterministic**
  grid — 120 BPM beats, downbeats every 4 beats, sections `intro/loop/outro` cut at fixed
  duration fractions (e.g. 0–15%, 15–85%, 85–100%). Deterministic given the input, so tests
  assert exact values. `bpm` reported by stub (so `bpmMethod` = `"backend"`); beatthis returns
  `bpm: null` → TS derives median-ibi.
- `--doctor`: prints JSON `{ "python": "3.11.15", "backends": { "stub": {"ok": true},
  "beatthis": {"ok": false, "missing": ["torch","beat_this"]}, "allin1": {...} } }` using
  `importlib.util.find_spec` (**never executes torch** — safe to probe).

TS side (`src/analysis/sidecar.ts`, SB):

- Interpreter resolution order: `$BEAT_PYTHON` → `<repo>/python/.venv/bin/python3` if it exists →
  `python3` on PATH. Repo root via `import.meta.url` (same trick as `scripts/source-lib.mjs:24`).
  The resolved interpreter path is printed by `--doctor` and in every degrade message.
- `execFile(python, args, { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 })` (timeout matches the
  `src/mcp/server.ts:1511` prior art).
- Envelope: parse the sidecar's stdout core, light shape-check, then wrap with
  `source` (file + sha256 computed by TS from the real bytes + durationSeconds via
  `decodeWav`), `generatedAt`, `dotbeatAnalysis: 1`, and (if the core's bpm is null) derive bpm
  from median inter-beat interval and set `bpmMethod: "median-ibi"`, else `"backend"`.
- Cache: before spawning, if the target `.analysis.json` exists, parses, `source.sha256` matches
  the current audio hash AND `backend.name` matches the requested backend → return it with
  `cached: true` (CLI prints "using cached ref.analysis.json — pass --force to re-analyze").
  `--force` bypasses.
- Degrade: spawn ENOENT (no python3 anywhere) → `BeatAnalysisError` with the venv setup one-liner
  from `python/README.md`. Never a stack trace.
- Owner install story (`python/README.md`): `python3 -m venv python/.venv && python/.venv/bin/pip
  install -r python/requirements-beatthis.txt` — venv auto-discovered, zero config after. Pin
  `torch>=2.0,<3` and `beat_this @ git+https://github.com/CPJKU/beat_this@<commit-sha>` (pin the
  exact commit; validated owner-side via `--doctor` since pip is blocked here). `requirements-
  allin1.txt` documents the NATTEN/madmom-from-git manual steps and is explicitly labeled **SPIKE**
  (research 102: trust boundaries, not labels, on electronic material). README also notes the
  spawn/JSON/doctor/venv conventions are **shared with a future `python/gen.py`** (Phase 39
  `beat source gen`), so that stream copies them at zero cost.

### `beat skeleton` decisions (SA owns)

- Command: `beat skeleton <out.beat> <analysis.json> [--section-bars N]`. First positional is the
  .beat file (house grammar, cf. `beat init <file>`). **Refuses to overwrite** an existing
  out.beat. MCP twin: `beat_skeleton { out_file, analysis_file, section_bars? }`.
- BPM: `Math.round(artifact.bpm)` (**`initDocument` enforces integer bpm 20–999**); output prints
  both: `tempo 128 (detected 128.02)`.
- Bars conversion (loader-owned, in `import.ts`): `barSeconds` = median inter-downbeat interval
  when ≥ 2 downbeats exist (robust to drift), else `4 * 60 / bpm`. Per section:
  `bars = Math.round((end - start) / barSeconds)`; a section rounding to 0 is dropped with a
  printed note (`skipped 1 sub-bar section at 84.2s`). **`setSong` caps bars at 1–64 per song
  entry** → a section rounding to > 64 bars is emitted as repeated song entries of the same scene
  in chunks of 32.
- Empty `sections` (pure Beat This): fall back to uniform chunking — total bars = downbeat count
  (or `round(duration / barSeconds)`), cut into `--section-bars` (default 8) chunks named
  `part-1..n`, remainder as a final shorter section. So skeleton **always works** on a beats-only
  artifact.
- Scenes: **one scene per distinct label** — all "chorus" sections reference the single `chorus`
  scene (dotbeat's model: repeats reference the same scene; per-entry `bars` lives on the song
  entry, so differing lengths are fine). Scene id = label sanitized to `/^[a-zA-Z0-9_-]+$/`
  (lowercase, spaces→`-`, strip the rest; collision after sanitize → numeric suffix).
  `null`/empty labels get per-section `section-<n>` scenes (no reuse — can't claim two unlabeled
  sections are the same material). Scenes minted empty via `setScene(doc, id, {})` (verified
  legal). Keep `initDocument`'s starter `lead` track.
- Assembly: `initDocument({ bpm })` → `setScene` per distinct scene → `setSong(entries)` →
  `serialize`. Print a section table (index, scene, bars, source start-seconds) + next-step hint
  (`beat clip` / `beat place` to fill the scenes).
- **Reference audio is never registered as media** — research 102's copyright posture: the
  analysis JSON of numbers/labels is the only artifact; the source audio never enters a project.
  No `--register-source` flag. (Gets a decisions.md entry.)

### CLI / MCP naming (collision with shipped `analyze-structure` handled head-on)

- CLI keeps research 102's name: **`beat analyze <audio.wav> [--backend beatthis|stub|allin1]
  [--force] [-o out.json] [--json]`** and **`beat analyze --doctor`** (SB). Disambiguation from the
  shipped symbolic `beat analyze-structure`: (a) HELP entry cross-references it, (b) a positional
  ending in `.beat` errors immediately with that pointer, (c) SA adds a `HELP_FAMILIES` line
  `['analyze', 'skeleton', 'analyze-structure', 'source']`.
- MCP: **`beat_analyze_audio`** (deliberately NOT `beat_analyze` — in an alphabetized ~65-tool list
  it would sit beside `beat_analyze_structure` and invite the wrong pick; the `_audio` suffix
  self-describes), args `{ file, backend?, force?, out?, json?, doctor? }` (doctor mutually
  exclusive with file, enforced in handler) — SB. And **`beat_skeleton`** — SA.
- Errors: **reuse `BeatAnalysisError` everywhere** (loader validation, skeleton construction,
  sidecar spawn/exit failures). Already exported from `src/analysis/index.ts`, already imported by
  `cli/beat.mjs:93`, already on the `main().catch` whitelist (`cli/beat.mjs:2358`). **Zero new
  error classes, zero whitelist changes.** setSong/setScene throwing `BeatEditError` inside
  skeletonCmd is also already whitelisted.

## Streams

### SA — contract, loader, `beat skeleton` (pure TS; NO Python)

- **`src/analysis/import.ts` (new):** `AnalysisArtifact` / `AnalysisSection` interfaces;
  `validateAnalysisArtifact(raw: unknown): AnalysisArtifact` (throws `BeatAnalysisError` per the
  frozen rules); `artifactToSections(artifact, { sectionBars }): { scene, bars, label,
  startSeconds }[]` (ALL bars math + chunking fallback + scene-id sanitizing lives here,
  unit-testable without files); `buildSkeleton(artifact, opts): { doc, report }`. Header comment
  mirrors structure.ts's style and states the seconds-vs-bars boundary. Imports `BeatAnalysisError`
  from `./structure.js`.
- **`src/analysis/index.ts`:** re-export the above (own marked region, distinct from SB's line).
- **`cli/beat.mjs`:** `skeletonCmd`; HELP entry inserted **immediately after the `sample` entry**;
  dispatch `case 'skeleton'` inserted **immediately after `case 'sample'`** (case at line ~2248);
  **SA owns the `HELP_FAMILIES` line** `['analyze', 'skeleton', 'analyze-structure', 'source']`.
  Wrap insertions in `// ==== Phase 38 Stream SA begin/end ====` markers.
- **`src/mcp/server.ts`:** `beat_skeleton` tool inserted **after the `beat_source_add` tool**,
  wrapped in `// ==== Phase 38 Stream SA begin/end ====` markers. Follow the existing register
  pattern (full inputSchema — dispatch-level unknown-arg rejection requires every arg declared).
- **`test/fixtures/ref.analysis.json` (new):** a realistic artifact (build copies
  `test/fixtures/*.json` into dist automatically). **`test/analysis-import.test.ts` (new):**
  validator accept/reject with message asserts; known-answer bars math (round-to-zero drop,
  >64-bar split, sanitize collision, label-reuse-one-scene); empty-sections chunking;
  `buildSkeleton` round-trips through `parse(serialize(doc))` and `analyzeStructure(doc)` sees the
  same section list.

### SB — `beat analyze` sidecar (TS spawn plumbing + `python/`)

- **`python/analyze.py`, `python/README.md`, `python/requirements-beatthis.txt`,
  `python/requirements-allin1.txt` (all new)** per the sidecar contract. allin1 stays in-file as a
  lazily-imported spike path.
- **`src/analysis/sidecar.ts` (new):** `resolvePython()`, `runAnalysis({ audioPath, backend,
  force, outPath }): Promise<{ artifact, cached, outPath }>` (spawn → parse stdout core → light
  shape-check → envelope with sha256/duration/generatedAt → atomic write), `sidecarDoctor()`.
  Duration via `decodeWav` from `src/metrics` (WAV-only input this phase; non-WAV → `BeatAnalysisError`
  suggesting conversion — matches the stub's 16-bit-PCM reach anyway).
- **`src/analysis/index.ts`:** re-export (own marked region, distinct from SA's).
- **`cli/beat.mjs`:** `analyzeCmd` (incl. `--doctor`, `.beat`-redirect guard); HELP entry inserted
  **immediately BEFORE the `analyze-structure` HELP block**; dispatch `case 'analyze'` inserted
  **immediately before `case 'analyze-structure'`** (case at line ~2143). Wrap in
  `// ==== Phase 38 Stream SB begin/end ====` markers.
- **`src/mcp/server.ts`:** `beat_analyze_audio` inserted **after the Phase 37 RB
  `beat_analyze_structure` block end-marker** (line ~436), wrapped in
  `// ==== Phase 38 Stream SB begin/end ====` markers.
- **`test/analyze-sidecar.test.ts` (new):** python3-gated (module-top `execFileSync('python3',
  ['--version'])` in try/catch → `hasPython`; each subtest `if (!hasPython) return t.skip(...)`).
  Stub analyze end-to-end through the real CLI harness; cached second run; `--force`; sha256
  invalidation; `--backend beatthis` without torch exits with the doctor hint (proves the degrade
  path); `analyze foo.beat` prints the redirect; `--doctor` JSON parses. Chained
  `beat analyze --backend stub → beat skeleton` happy path (the one test that proves the two
  streams' halves mate) — lands with whichever of SA/SB merges second, or with SE.

### SC — `beat source gen` (Stable Audio Open): **DEFERRED to Phase 39.**

Synergy with `beat analyze` is the *idiom* (spawn/JSON/doctor/venv), not code — captured free by
documenting the conventions in `python/README.md`. Building it now would ship a second
owner-side-only feature before the first has ever run on a real machine, and its commercial-use
registration condition (research 103) deserves its own decision entry. Deferral is concrete: a
roadmap row citing research 103, conventions noted in the README.

### SD — papercuts (pilot 104 lows; touches NONE of SA/SB's regions)

- **`cli/beat.mjs` + `src/vary/`:** `beat vary automation:<param>` gains a `--clip` selector
  (today it picks implicitly); mirror the arg on `beat_vary` in `src/mcp/server.ts`.
- **`cli/render.mjs`:** suppress the 404 page-error console noise (filter resource-load 404s out of
  the page-error forwarding, or serve the missing asset).
- **`scripts/source-lib.mjs`:** `ingest()` detects an id already present in `doc.media` and prints
  an explicit `re-registered <id> (replaced sha256:abc… → def…)` note instead of silence; small
  test.

### SE — showcase + pilot 105 (serial, after merge)

- End-to-end run in this container: synth a structured WAV (writeTestWav-style) →
  `beat analyze --backend stub` → `beat skeleton` → add tracks/clips → `beat feedback` /
  `analyze-structure` critique → `beat vary` / `adopt` → `beat render`
  (`CHROME_PATH=/opt/pw-browsers/chromium`).
- **`docs/research/105-usability-pilot-audio-import.md` (new):** the CLI/MCP pilot per CLAUDE.md
  standing practice, honestly framed — UX and plumbing validated with `stub`; real-model
  validation is an owner-side checklist (appended to `python/README.md`: install venv →
  `beat analyze --doctor` → analyze a real track → eyeball bpm/sections → `beat skeleton`).
- Wrap-up per standing practice: `scripts/roadmap-data.mjs` + `docs/product-roadmap.md` + dashboard
  splice (checked-in `docs/roadmap-dashboard.html`); README/skill refresh; `docs/decisions.md`
  entries (the sidecar JSON contract; the never-register-reference-audio posture); the deferred
  `beat source gen` roadmap row citing research 103.

## Ordering & process

- **One parallel wave: SA ∥ SB ∥ SD in worktrees; SE serial after merge.** SA/SB parallelism is
  safe because the §contract is frozen verbatim above and the dependency is data-shaped, not
  code-shaped: SB's sidecar.ts does only a light shape-check and envelope (validation authority is
  SA's loader). The chained analyze→skeleton test lands with whichever merges second (or SE).
- Marker discipline (Phase 37's zero-conflict pattern): each stream wraps its cli/beat.mjs and
  src/mcp/server.ts insertions in `// ==== Phase 38 Stream Sx begin/end ====` at the assigned
  anchors. SD touches none of those regions (varyCmd, render.mjs, source-lib.mjs).
- Distinct new files everywhere else, so worst case is a trivially mechanical merge.

## Test plan (green without torch; green even without python3)

1. `test/analysis-import.test.ts` (always runs) — validator + known-answer bars math + round-trip
   closing the loop structure.ts's header promised.
2. `test/analyze-sidecar.test.ts` (skip-gated on `python3 --version`; python3 IS present here so
   these DO run) — stub analyze end-to-end, cache, `--force`, sha256 invalidation, beatthis
   degrade path, `.beat` redirect, `--doctor`.
3. Chained `beat analyze --backend stub` → `beat skeleton` happy path asserting the .beat parses
   with the expected song block.
4. MCP: tool listing includes both names; `beat_skeleton` over stdio against the fixture (no
   Python); `beat_analyze_audio` stub call gated like (2).

## Critical files

- **Reuse:** `src/analysis/structure.ts` (BeatAnalysisError + StructureAnalysis vocabulary),
  `src/metrics/wav.ts` (`decodeWav`), `src/core/edit.ts` (`initDocument`/`setScene`/`setSong`),
  `cli/beat.mjs:2358` error whitelist (already covers BeatAnalysisError), `src/mcp/server.ts`
  register pattern + 600s execFile prior art, `scripts/source-lib.mjs:24` repo-root resolution
  trick, `test/cli.test.ts:179` writeTestWav helper.
- **New:** `src/analysis/{import,sidecar}.ts`, `python/{analyze.py,README.md,requirements-*.txt}`,
  `test/{analysis-import,analyze-sidecar}.test.ts`, `test/fixtures/ref.analysis.json`,
  `docs/research/105-*.md`.

## Verification

`npm run build && npm test` green at every merge (773 existing + new); the python3-gated suite
actually executes in this container; SE's showcase renders a WAV from a skeleton-scaffolded
project; CLI/MCP pilot 105 run and written up; roadmap/dashboard/README/skill refreshed and pushed.

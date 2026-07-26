# 130 — Codebase review synthesis: six streams, one diagnosis

*Synthesis of the 2026-07-25 six-stream holistic codebase review. Inputs: the full area reports
R1 (CLI layer), R2 (core format), R3 (taste/eval), R4 (analysis + Python sidecars), R5 (services:
daemon/MCP/metrics/vary/board), R6 (GUI + verify fleet), read in full, cross-checked against
`docs/decisions.md` and `ROADMAP.md`. Claims sourced from a stream report are cited by stream
finding id and are as confident as that report (all six verified their central claims by direct
measurement). Where this document asserts something BEYOND the stream reports — merged rankings,
file-disjointness of work packages, wave assignments — per-claim confidence is marked inline.
Already hot-fixed during the review itself, recorded here so nobody re-plans them: (1) MCP
`beat_vary` param-branch `linkMediaFrom` parity (R1-F10 / R5-F1, the live pilot-111 twin bug);
(2) the `parse.ts` lane-tune clamp (the D4-violating divergence R2-F1 found — the triplicated
grammar itself is NOT yet unified); (3) raw NUL bytes → `\x00` escapes in the 4 grep-invisible
files (R6-1 / R3-F9). NOT yet done: the CLAP default-backend flip (R4-3) — it is wave 0 below.*

## Headline answers

1. **The six streams converged independently on one diagnosis: discipline is excellent, sharing
   is aspirational.** Every stream found the same shape — carefully commented, well-tested,
   decision-cited code in which copy-paste plus comment discipline stands where structure should:
   "keep in sync by inspection," "a parallel implementation is deliberate," "mirrors the CLI's."
   The duplication ledger totals **40+ distinct clusters** across the six areas (§1.2), and
   parity across the four surfaces (CLI / MCP / daemon / GUI) is maintained entirely by hand —
   71 hand-written MCP twins, ~12 hand-mirrored GUI concepts, 6 copies of the vary tail.

2. **The drift is no longer hypothetical: the review found live bugs of exactly the predicted
   class.** A known pilot-111 fix applied to the CLI and never to its MCP twin (hot-fixed); a
   parser arm missing a range clamp its three siblings enforce (hot-fixed); an inverted boolean
   on a same-named verb across surfaces (`effect-bypass`, R5-F3, still open); a retired
   below-chance embedding backend still the default (R4-3, still open); a biased,
   V8-version-dependent shuffle in the seeded prompt path (R3-F3, still open); a GUI mirror that
   fails open on unknown edit paths (R2-F0a, still open).

3. **The safety net has holes precisely where the refactors need it, so wave 0 is tests, not
   refactors:** the engine's golden-WAV gate silently skips on every clean checkout (R6-2), no
   CLI surface test exists (R1), the frozen ablation constants are guarded by `>=` not `===`
   (R3-I8), no test asserts the figure-label namespaces are disjoint (R3-I2b), and effects/undo
   are untested on every surface at once (R5-F7).

4. **Wave 1 is four extractions the streams each ranked highest, all mechanical, all
   test-covered:** the 8×-copied sidecar spawn scaffold (R4-1), `src/taste/phrase.ts` +
   one `mulberry32` (R3), `runVaryBatch` collapsing the 6-copy vary tail (R5-F2), and
   `cli/lib/args.mjs` with declarative per-command specs (R1-F1/F2).

5. **The endgame is generative, and it is the codebase's own stated principle (D9) applied
   further:** turn hand-mirrored knowledge into tables/specs that satellites are *generated
   from* — MCP schemas from CLI arg specs, CLI help and MCP descriptions from a path-grammar
   table, figure sources behind one interface, GUI mirrors replaced by imports of the pure core
   leaves. Every drift class found in this review becomes structurally impossible rather than
   individually patched.

6. **A meaningful fraction of what looks like a problem is healthy and must be left alone**
   (§4): the frozen-science profile literals, the two-venv split, the provider adapter table,
   the MCP dispatch loop, `history.ts`, the Zustand store, the blind/non-blind log separation.
   The review is a consolidation mandate, not a rewrite mandate.

---

## 1. The diagnosis

### 1.1 The cross-cutting story

Six reviewers, six disjoint areas, no shared prompt beyond "review your area" — and the reports
read like one document. The pattern, everywhere:

- **The primitives are genuinely shared and well-held.** `setValue` is the single path-grammar
  interpreter with 19 opaque call sites (R2-F0); all six training-pair sites route through one
  `trainable()` funnel (R3-F8); every daemon write goes through `writeIfChanged` (R5); the
  Python sidecar exit-code contract is 8/8 perfect (R4-2); `applyProducedDefaults` is one
  primitive both showdown treatments route through (R4 §8). Where a seam was extracted, it held.

- **The orchestration above the primitives is copy-pasted, and the copies have already
  diverged.** The vary render tail exists 6× across two surfaces with three distinct drifts
  (R5-F2); the showdown batch-assembly block exists 3× with three divergences including a
  silently-ignored `--seconds` (R1-F7); the spawn scaffold exists 8× in TS and 8× in Python,
  with doc comments *claiming* a shared module that was never written (R4-1); the lane-backing
  grammar exists 3× plus a serializer and had already produced a parseable-but-unwritable file
  (R2-F1).

- **Parity across surfaces is maintained by review discipline, not structure.** README claims
  "parity is structural rather than reviewed-in" (R1 §8) — true for the batch manifest, false
  for the 71 MCP tool twins, the ~75 CLI commands without unknown-flag validation (a bug class
  four separate pilots rediscovered one command at a time, R1-F2), and the GUI's ~12
  hand-mirrored concepts of which exactly one is drift-tested (R6-13). One mirror has already
  forked (audio-region timeline math, guarded by a comment asserting an invariant nothing
  enforces).

- **Comment discipline is doing structure's job — and it is genuinely good at it, which is why
  the debt accrued invisibly.** The comments are decision records citing pilots, research docs,
  and decisions (30% comment density in `engine.ts`, 50% in `store.ts`, R6). They made the
  duplication *survivable*; they did not make it safe. "Keep these three in sync with core BY
  INSPECTION" (engine.ts:1495) is the whole convention in one sentence.

**Why it happened (medium confidence — inference across the reports):** three identifiable
mechanisms. (a) The parallel-worktree process: `beat.mjs` and `server.ts` are the designated
shared-insert files with `==== Phase N Stream X ====` merge fences, so every stream appended
inline rather than creating modules — the monolith is an accident of merge mechanics, not a
design (R1 §6.1 verified no decision mandates it). (b) The "ui/ is a standalone Vite app"
premise, repeated in ~30 comments, justified all four GUI mirror surfaces — and R6-13 showed the
blocker is literally one line of Vite config. (c) Grep-invisible files: four source files
contained raw NUL bytes, making the single biggest GUI file invisible to every repo-wide search;
R6 demonstrated this producing a false dead-code conclusion *during the review itself*. You
cannot reuse what your tools cannot find.

### 1.2 The duplication ledger (quantified)

Counts are the streams' own measurements, not estimates.

| Area | Cluster | Copies | ≈LOC involved |
|---|---|---|---|
| CLI (R1) | `flagValue` re-implementations | 7 | ~35 |
| CLI (R1) | positional-extraction filter (4 dialects) | 33 | ~66 |
| CLI (R1) | commands lacking unknown-flag validation | ~75 of 87 | — (bug class, not LOC) |
| CLI (R1) | rate/board server skeleton + page scaffold (incl. byte-identical path-traversal guard) | 2 | ~440 |
| CLI (R1) | showdown/prodtask/pilot batch-assembly block | 3 | ~75 |
| CLI (R1) | work-dir lifecycle (mkdir…rm, no finally) | 4 | ~40 |
| CLI (R1) | `instrumentPresetInfo`+formatter CLI↔MCP | 2 | ~110 |
| CLI/MCP (R1) | hand-maintained MCP tool twins of CLI commands | 71 tools | ~2065 (TOOLS literal) |
| Core (R2) | lane-backing grammar parsers (+1 serializer) | 3+1 | ~220 |
| Core (R2) | slug regex inline | ~17 | ~25 |
| Core (R2) | color regex inline | 5 | ~10 |
| Core (R2) | path-grammar satellites (parsers, docs, shadow tables, UI mirror) | 8–10 files | ~1000+ (incl. 566-line `synthParams.ts` fork, 183-line `applyLocalEdit`) |
| Core (R2) | `fmtVal` divergent twins | 2 | ~15 |
| Core (R2) | diff common-track walk | 3 passes | ~30 |
| Taste (R3) | `seededShuffle` Fisher-Yates | 4 | ~50 |
| Taste (R3) | "first unexcluded label" selector | 4 | ~50 |
| Taste (R3) | `mulberry32` (byte-identical closures; +2 more in R6's src sweep: humanize, vary) | 5–6 | ~60 |
| Taste (R3) | `rnd2`/`round2`/`round4` | 5+3+3 | ~20 |
| Taste (R3) | supersede (latest-wins) rule | 3 | ~40 |
| Taste (R3) | `pct` same-name different-contract | 2 | ~10 |
| Taste (R3) | prompt bank parallel maps keyed by convention | 4 structures | ~240 |
| Taste (R3) | RNG salt namespace, hand-policed | ~20 salts | — |
| Analysis (R4) | TS spawn scaffold (`spawnPython`, constants, doctor, resolver, repoRoot) | 8 files | ~500 |
| Analysis (R4) | Python-side scaffold (error classes + main ladder + log) | 8 files | ~400 |
| Analysis (R4) | `Beat*Error` 6-line classes | 22 | ~130 |
| Analysis (R4) | Python-interpreter resolver chains | 5 variants | ~80 |
| Services (R5) | vary render/normalize/audition tail | 6 | ~120 |
| Services (R5) | seed zero-guard (2 behaviours across 4 sites) | 4 | — |
| Services (R5) | daemon error-status expressions | 9 variants / 31 catches | ~60 |
| Services (R5) | daemon `readBody`/catch/err-message boilerplate | 36/31/42 | ~200 |
| Services (R5) | arrangement flatness judged twice (2 schemas, 2 units, 2 thresholds) | 2 | ~200 |
| Services (R5) | `recordNoneGood`/`recordRejectAll` same verb, two impls | 2 | ~60 |
| Services (R5) | shared-log kind-only projection one-liner | 2 | 2 (but load-bearing for D25) |
| GUI (R6) | hand-mirrored concepts src↔ui (incl. all 145 synth-param defaults, 422-line types.ts) | 12 concepts | ~1500 |
| GUI (R6) | `applyLocalEdit`/`applyLocalAutomation` mirror of `setValue` | 1×250 | 250 |
| GUI (R6) | drag mechanisms (18 sites, 4 mechanisms, 2 full reorder clones) | 4 | ~600 |
| GUI (R6) | verify-fleet harness (sleep 94×, pollUntil 94×, git 71×, build 95×) | 94 scripts | **7,000–10,000** |

**Aggregate (high confidence on the inputs, medium on the sum):** roughly **12–15k LOC of
literal or near-literal duplication**, of which the verify fleet alone is ~7–10k. For scale,
`src/` is ~32k LOC. The headline number matters less than the shape: almost every cluster has a
report-verified "already diverged" or "already bit us" example attached.

---

## 2. The unified findings register

Overlapping stream findings merged into 12 threads, ranked by leverage × risk (leverage of
fixing × risk of leaving it). Decision interactions flagged per thread; ⚠ marks a finding that
*conflicts with* a numbered decision today, ✦ marks one that *extends* a decision's own logic.

### T1 — The missing operation layer: parity by hand across four surfaces
**Streams:** R1-F1/F2/F10/F11/F12, R5-F2/F3/F4, R2-F0(b)(c)(d), R6-4/R6-7/R6-13.
**Highest leverage in the review.** One story told four times: nothing owns "the operation"
(arg contract, defaults, validation, error text), so CLI, MCP, daemon, and GUI each re-implement
it and drift. Concrete casualties: the hot-fixed `beat_vary` bug; the still-live
`effect-bypass` polarity inversion (R5-F3 — CLI boolean means *bypassed?*, MCP's same-named
`enabled` means *enabled?*); 7 confirmed CLI/MCP divergences (R1-F11, incl. the MCP `analyze`
that reports a stub 120-BPM grid as if detected, and `humanize` producing different audio per
surface via seed defaults); MCP lacking the pilot-113 volume-confound warning and capture-mode
flag entirely; a stale two-thirds-incomplete `PATHS_NOTE` help string and a fragmented MCP
grammar description (R2-F0b/c); the GUI's `applyLocalEdit` optimistic mirror with zero drift
tests that fails open on unknown paths (R6-4). Exactly ONE byte-level parity test exists,
covering 3 of 71 tools (R1-F12).
**Fix path (three rungs, each valuable alone):** parity tests (wave 0) → shared orchestrators +
declarative arg specs (waves 1–2) → generated schemas / ops layer / path-grammar table (wave 3).
**Decisions:** ✦D9 (extends the single-table principle — and ⚠ D9 is *already breached* by
`ui/src/components/synthParams.ts`, a 566-line hand fork of `SYNTH_FIELDS` with its own legality
gate); ✦D21 (its own text mandates the extraction); D14 (MCP is the agent surface — agent-facing
drift is product-facing drift).

### T2 — The safety gates that must exist before anything moves
**Streams:** R6-2, R1 §6 step 0, R5-F7, R2 §6.1, R3 §3, R1-F12.
The engine golden-WAV gate **silently skips on every clean checkout** — the four `.wav` goldens
were never committed, so the regression test for the exact bug it was written for asserts
nothing (R6-2). No CLI surface test asserts HELP↔dispatch integrity or flag rejection (R1).
Daemon undo/redo — the subtlest state in the services layer — has zero unit tests; effects are
untested on daemon AND MCP simultaneously, which is exactly where R5-F3's semantic drift lives
(R5-F7). `drumkit.ts` has zero coverage and holds the third copy of the lane grammar (R2).
`formatNumber`, the lynchpin of D4's round-trip guarantee, is never directly tested (R2). In the
taste layer: frozen constants guarded by `>=` (changing `eqHigh` 2.5→4.0 passes the whole
suite and silently breaks comparability with ~21+ rated engineplus batches, R3-I8); no
cross-source figure-label disjointness test (I2b — the D24 un-blinding channel); the prompt
bank entirely untested (I9). **Decisions:** D4, D24, D26/D27 (comparability of the rated arc).

### T3 — Eval-integrity hazards (the crown-jewels thread)
**Streams:** R3-F3/F5/F8/I2b/I5/I8, R4-3, R5-F9.
Beyond the missing tests: `seeds.ts` shuffles with `sort(() => rng()-0.5)` in six places —
non-uniform, V8-version-dependent, RNG-stream-perturbing — in the only untested module of the
layer (R3-F3); the retired, measured-below-chance CLAP backend is still the default in three
places while every live caller overrides it, and the endorsed `aes` backend isn't even in the
CLI allowlist (R4-3); the D25 kind-only shared-log posture hangs on two duplicated one-liners in
`vary/batch.ts` with only one substring asserted (R3-F8/I5); RNG salts are a hand-policed global
namespace where the CLI's arm offsets numerically overlap the role salts (R3-F5).
**Decisions:** D24, D25, D26, D27 — this thread is why taste-layer refactors are gated (§5).

### T4 — Mechanical, provably-behavior-preserving extractions
**Streams:** R4-1 (+R4 §10 resolver chains), R2-F2/F5, R3-F4/F10, R5-F9 (loudness block),
R6-13 (groove/chance import swap).
The pure-win set: one `spawnSidecar` + one parameterized `resolvePython` (kills 8 TS copies and
5 resolver variants); one `src/core/ids.ts` (17 slug regex sites); one `src/core/rng.ts` and
`num.ts`; loudness normalization out of `vary/batch.ts` into `metrics/` (also breaks the
`metrics ↔ vary` import cycle); and the single most elegant move in the review — importing
`groove.ts`/`chance.ts` into `engine.ts` (verified logically byte-identical), which converts
three untested mirrors into tested single-sources **without writing one new test** (R6-13).
**Decisions:** none conflicted; ✦D17 (the TS-side extraction preserves it; the *Python*-side
`_sidecar.py` trades away D17's standalone-file property — owner call, see §4).

### T5 — The god-module decompositions
**Streams:** R2 §2/§4/F3, R3-F1, R5-F5/F6/F9, R1 §6, R6-3/R6-11, R4-6.
Eleven files, one property in common: the seams are already drawn and the reports mapped them to
line ranges. `edit.ts` 1902 → 13 contiguous acyclic bands absorbed by the barrel (zero consumer
changes — R2 verified the import graph); `showdown.ts` 1557 → 6 modules incl. a zero-coupling
private WAV codec and report layer; `daemon.ts` 2641 → 5 modules (665 lines of it are pure
domain logic that `project.ts`'s own header says belongs elsewhere); `server.ts`'s 2065-line
TOOLS literal → per-family files; `beat.mjs` 6096 → entry + help + 11 command families (no
decision mandates the monolith; the delegation pattern already exists for 5 commands);
`engine.ts` 4320 → ~1500 pure lines extractable, gated on T2; `vary/batch.ts` 1023 → 6 concerns
behind a barrel (best-tested module in services, do first among the M splits); plus
`parse.ts`'s 1005-line closure, `document.ts`'s 3-in-1, `trick.ts`'s self-bannered seams,
ArrangementView/NoteView/SynthPanel. **Decisions:** D8 (diff entry ordering must survive
R2-F4; ⚠ the daemon's snapshot undo stack is a live, undocumented divergence from D8's
reservation — R5 flags it for an explicit owner settle), D15 (engine split must not fork a
second render path).

### T6 — Taste orchestration policy stranded in the CLI
**Streams:** R3-F2/F6, R1-F7/F8/F9.
The blinding + fairness contract (shuffle → name → duration-match → loudness-match), the
figure-source precedence (`midi > ca2 > theory > bank`), the BPM-conform decision tree, and the
ref-audibility retry policy all live only in `beat.mjs` glue — untestable without booting the
CLI, and the four figure sources have no shared interface (four copies of the selector, four
label namespaces held disjoint by comments alone). The batch-assembly copies have diverged
(pilot silently ignores `--seconds`; work-dir cleanup is not `finally`-guarded, and a leaked
work dir pollutes `beat-scores.jsonl`). **Decisions:** D24 (label normalization during the
FigureSource refactor is the #1 identified un-blinding risk — I2b gates it), D26 (a fifth
figure source is the obvious next lever; today it is a five-file change).

### T7 — One musical judgment implemented twice
**Streams:** R5-F8. Arrangement flatness exists in `sections.ts` (LUFS, LintFinding) and
`screens.ts` (RMS dBFS, PathologyFinding) with 2× different step thresholds; two finding
schemas are both load-bearing; `screens.ts` holds 19 private un-sweepable tuning constants.
**Decisions:** D2 (the LLM narrates from this substrate — consolidation needs an owner note),
D27 (threshold changes shift arrangement judgments; re-baseline after).

### T8 — Error-vocabulary sprawl
**Streams:** R4-5, R1-F5, R5-F5(step 3). 22 near-identical `Beat*Error` classes; an
18-branch hand-maintained catch taxonomy in `beat.mjs` (append-only, unenforced — a new error
class prints a raw stack until someone remembers); 9 hand-maintained daemon status expressions.
One `BeatError` base + one `KNOWN_ERRORS` set collapses all three. Keep the 22 names.

### T9 — The review-server twins
**Streams:** R1-F4, R5-F10. `rate.mjs`/`board.mjs`: identical 18-line batch finder differing in
one digit, byte-identical security-relevant path-traversal guard, independently re-implemented
audio-output-device picker/keyboard map/localStorage. Extract the shell; **never** merge the
pages or logs (D24 — blind vs non-blind is policy).

### T10 — Verify-fleet governance
**Streams:** R6-8. 102 scripts, ~28.8k LOC (1.3× the GUI it tests), zero shared imports, no
runner of any kind, ≥10 dead members (incl. `verify-engine-parity.mjs`, which contradicts D15
outright). The engine's only real audio assertions live here, unrunnable as a suite. No
document sanctions retiring a script — the missing artifact is a *lifecycle*, one paragraph in
`docs/usability-testing.md`.

### T11 — Dead weight and doc rot
**Streams:** R6-6/9/12, R4-2a/R4-3(MERT), R1-F3. `desktop-spike/` (35 tracked files), `err1-3`,
`TrackList.tsx` + dead `.stepseq` CSS block, 10 dead verify scripts, MERT fully unreachable,
`python/README.md` missing 4 of 8 sidecars (D17 designates it the template), 6 undocumented CLI
flags, stale citations in `main.tsx`/`decisions.md:593`/`format-spec.md:291`.

### T12 — The prompt-bank data model
**Streams:** R3-F7 (+F3, I9). Four parallel structures keyed by convention; the missing
`PHRASE_NEGATIVE` failure mode already shipped a live rating-integrity bug (Lyria drums in
"no drums" clips, 2026-07-25); the fix added a fourth parallel map instead of closing the class.
One discriminated-union record makes the bug uncompilable.

---

## 3. The work-package plan

Sequenced waves of disjoint packages. **Disjointness rule:** within a wave, no two packages
touch the same file, with two explicitly-serialized exceptions called out below (both on
`cli/beat.mjs`, which is unavoidable — see §5). Wave N+1 packages may touch wave-N files.
Every package names the tests that must be green FIRST. (File lists high confidence where taken
from the reports' own maps; medium for the exact new-file names.)

### Wave 0 — safety gates + trivial mechanical fixes (all parallelizable)

| # | Package | Files | Size | Risk | Unblocks |
|---|---|---|---|---|---|
| W0.1 | **Engine golden-WAV gate**: commit the 4 clip-automation goldens; make the skip a loud failure when goldens are absent | `test/fixtures/clip-automation/*.wav`, `test/clip-automation-render.test.ts` | S | none | all engine work (W2.7) |
| W0.2 | **CLI surface test**: HELP↔dispatch 1:1, `--help` exit 0 per command, usage golden snapshot, unknown-flag rejection (known-failing allowlist for the ~75) | `test/cli-surface.test.ts` (new; spawns, doesn't edit, beat.mjs) | S | none | W1.4, all of W2.5 |
| W0.3 | **Taste guard tests**: frozen-profile `===` deep-equals (I8); cross-source label disjointness + no-`:`-in-bank-names (I2b); `assignClipOrder` seed-derivation (I3); theory/ca2 gitignore holes (I4); prompt-bank seed snapshots + 4-map key-sync (I9/F7); shared-log projection extended to midi/surge `from` (I5); `packRefFiles` reads both markers + refs-cc0 stays trainable (I6) | `test/showdown.test.ts`, `test/taste.test.ts`, `test/prompt-bank.test.ts` (new) | M | none | W1.2, all of wave-3 taste moves |
| W0.4 | **CLAP default → `'off'`** (R4-3) + add `'aes'` to the `--embed-backend` allowlist; demote clap/mert to opt-in legacy | `src/taste/embeddings.ts:73`, `src/taste/eval.ts:593`, `cli/beat.mjs:3717` (one line — serialize with any other beat.mjs writer) | S | low | honest defaults now |
| W0.5 | **Unreachable trim**: forward `bpm`/`bars` through `RunGenOptions` (opt-in, byte-identical for existing callers) (R4-4) | `src/analysis/gen.ts`, `scripts/source-lib.mjs` | S | low | — |
| W0.6 | **Dead-weight deletion + doc rot**: `desktop-spike/`, `err1-3`, `TrackList.tsx` + `styles.css` dead blocks, the 10 dead verify scripts incl. `verify-engine-parity.mjs`, stale citations in `main.tsx`/`decisions.md`/`format-spec.md`; document the 4 missing sidecars in `python/README.md` (R6-6/9/12, R4-2a) | deletions + comment edits only | S | none | — |
| W0.7 | **Core micro-tests**: `mulberry32` cross-copy equality (write, watch pass, THEN consolidate in W1.2); first `drumkit.ts` tests; `formatNumber` idempotence property test | `test/rng.test.ts`, `test/drumkit.test.ts`, `test/format-number.test.ts` (new) | S | none | W1.2, W2.1, lane-grammar unification |
| W0.8 | **Daemon/MCP behavioural tests**: undo push/coalesce/external-invalidate/redo-clear; effects on daemon AND MCP (pins R5-F3's polarity before it is fixed) | `test/daemon-undo.test.ts`, `test/daemon-effects.test.ts`, `test/mcp-effects.test.ts` (new) | M | none | W2.3 steps 4–5, W3.1 |
| W0.9 | **Parity harness**: MCP `tools/list` snapshot (names + required args); table-driven CLI↔MCP byte-parity test seeded with 15–20 mutating commands (generalizes `place-surface.test.ts`) | `test/mcp-parity.test.ts` (new) | M | none | W2.4, W3.1 — would have caught the two hot-fixed bugs |

### Wave 1 — the four top-ranked extractions (+ one free rider)

| # | Package | Files | Size | Risk | Gates (must be green first) | Unblocks |
|---|---|---|---|---|---|---|
| W1.1 | **`spawnSidecar` + one `resolvePython`** (R4-1, incl. the resolver-chain unification): one module; 8 wrappers become thin | `src/analysis/spawn-sidecar.ts` (new), `src/analysis/{sidecar,gen,stems,surge}.ts`, `src/metrics/roughness.ts`, `src/taste/{ca2,midifig,embeddings}.ts` (spawn blocks only), `scripts/curate-*.mjs` | L | LOW | existing sidecar tests (already good, R4 §9) | R4-5 base class, any future sidecar |
| W1.2 | **`src/taste/phrase.ts` + `src/core/rng.ts`/`num.ts`** (R3's #1): shared vocabulary + one `chooseSeeded`; `showdown.ts` re-exports (barrel) so theory/ca2/midifig need NO edits this wave; consolidate the 3 identical `mulberry32`s | `src/taste/phrase.ts` (new), `src/taste/showdown.ts`, `src/taste/theory.ts`, `src/core/{rng,num}.ts` (new), `src/taste/{eval,ranker}.ts`, `src/vary/audition.ts` | M | LOW | W0.3 (I2b), W0.7 (rng equality) | W2.2, W3.3 |
| W1.3 | **`runVaryBatch`** (R5-F2): one orchestrator owning render→normalize→audition tail + seed zero-guard + pilot-113 warning + capture-mode; deletes 6 copies; MCP gains the two features it silently lacks | `src/vary/run.ts` (new), `src/mcp/server.ts` (vary handler), `cli/beat.mjs` (vary family — lands BEFORE W1.4's sweep begins) | M | MED | vary suite (14 files, best in layer) + one new lines/manifest parity assertion | W3.1 ops pattern proven on the hottest path |
| W1.4 | **`cli/lib/args.mjs` + help extraction** (R1 steps 1–2): `flagValue`/`positionals`/`parseArgs(spec)`; HELP array → `cli/help/`; unknown-flag validation closes for all ~87 commands; W0.2's allowlist shrinks to empty | `cli/lib/args.mjs` (new), `cli/help/*.mjs` (new), `cli/beat.mjs` (serialized after W1.3's diff) | M | LOW | W0.2 | W2.5, W3.1 schema generation |
| W1.5 | **Verify harness** (R6-8 steps 1–2, fully disjoint, any time from now): `ui/verify/_harness.mjs` + `npm run verify` manifest with a `verify:engine` tier | `ui/verify/_harness.mjs` (new), runner script, ported scripts opportunistically | M | LOW | none | gives W2.7 its gate command |

### Wave 2 — the big splits (all behind barrels; pure moves land alone)

| # | Package | Scope / files | Size | Risk | Gates |
|---|---|---|---|---|---|
| W2.1 | **`edit.ts` → 13 modules** (R2 §2) + kernel narrowing helpers (`requireSurge`/`requireInstrument`, R2-F6); barrel absorbs everything — zero consumer changes | `src/core/edit/*` (new), `src/core/index.ts` | M/L | LOW | format-v* + roundtrip suites (existing); land as one pure-move commit |
| W2.2 | **`showdown.ts` → 6 modules** (R3-F1): WAV codec out (check for the repo's third copy first), report layer out (prodtask re-imports), archetype bank → `figures/bank.ts`, surge arm, roles/docs; theory/ca2/midifig import swaps land here | `src/taste/showdown/*`, `src/taste/figures/*`, `src/taste/prodtask.ts`, `src/taste/{theory,ca2,midifig}.ts` | M | LOW→MED | W0.3 all green; W1.2 landed |
| W2.3 | **`daemon.ts` → 5 modules** (R5-F5): arrangement fns → `src/core/arrangement.ts`; `daemon/library.ts`; `daemon/http.ts` with ONE `route()` owning the 9 status expressions; then session + routes (gated) | `src/daemon/*`, `src/core/arrangement.ts` (new) | M then L | LOW then MED | steps 1–3 free; steps 4–5 need W0.8. Settle the ⚠D8 undo-snapshot divergence with the owner when `session.ts` is cut |
| W2.4 | **MCP `TOOLS` → `src/mcp/tools/<family>.ts`** (R5-F6); descriptions co-located; `server.ts` → ~200 lines | `src/mcp/tools/*` (new), `src/mcp/server.ts` | M | LOW | W0.9 snapshot |
| W2.5 | **`beat.mjs` decomposition** (R1 steps 3–6): dispatch table with explicit `exits` metadata, family extraction in ascending risk order, `src/taste/assemble.ts` (`assembleBlindBatch` + `withWorkDir` with `finally`; pilot gains `--seconds`), taste family split | `cli/beat.mjs`, `cli/cmd/*` (new), `src/taste/assemble.ts` (new) | L | LOW–MED | W0.2, W1.4; showdown/prodtask/pilot tests (exist). Delete the merge fences, don't carry them. Coordinate per §5 |
| W2.6 | **`vary/batch.ts` → 6 modules behind a barrel**; loudness block → `src/metrics/normalize.ts` (breaks the metrics↔vary cycle); `logSources()` helper dedupes the two D25-load-bearing one-liners | `src/vary/*`, `src/metrics/normalize.ts` (new) | M | LOW | 14 existing test files; W0.3's I5 extension |
| W2.7 | **Engine phase 1** (R6-13 + R6-3 step 1): `src/core` leaf imports into `engine.ts` (groove/chance/ratchetSlots via an isomorphic barrel; one line of Vite config), then extract the ~1500 pure DSP lines | `ui/vite.config.ts`, `ui/src/audio/engine.ts`, `ui/src/audio/dsp/*` (new), `src/core/isomorphic` barrel | M then L | LOW then MED | import swap needs nothing (verified byte-identical); DSP extraction needs W0.1 + W1.5's `verify:engine` tier. Move comments WITH code |
| W2.8 | **Seeds/prompt-bank**: split `seeds.ts`/`promptBank.ts`, unify the 4 maps into one discriminated union (F7), THEN fix the biased shuffle with Fisher-Yates as its own documented output-changing commit (F3) — land between rating rounds only | `src/taste/seeds.ts`, `src/taste/promptBank.ts` (new) | M | MED | W0.3 (I9 snapshots) — deliberately updated for the F3 commit |
| W2.9 | **Review-server shell** (T9): `cli/lib/review-server.mjs`; `PAGE` consts → `.html` files; one `findBatches(minVariants)`; presentation-only, logs untouched | `cli/{rate,board}.mjs`, `cli/lib/review-server.mjs` (new) | M | LOW | `test/board.test.ts` |
| W2.10 | **`BeatError` base + one catch** (T8): base class in `src/core`; 22 names kept as one-liners; `beat.mjs`'s 18-branch catch → one `instanceof`; daemon `KNOWN_ERRORS` set | `src/core/error.ts` (new), 22 class sites, `cli/beat.mjs` catch, daemon http module | M | LOW | a test that every exported `Beat*Error` is caught (new, part of package) |

### Wave 3 — the generative moves (each converts a drift class into a closed one)

| # | Package | Scope | Size | Risk | Gates |
|---|---|---|---|---|---|
| W3.1 | **MCP schemas generated from arg specs; `src/ops/` one family at a time** (T1 endgame; R5-F4): effects family first (worst drift, clearest boundary) — includes the R5-F3 bypass-polarity fix as an additive alias then deprecation | `src/ops/*` (new), `src/mcp/tools/*`, `cli/cmd/*` | L (decomposable) | MED per family | W0.8/W0.9, W1.4, W2.4, W2.5 |
| W3.2 | **Path-grammar table** (R2-F0): `setValue`'s 15 arms → exported `{pattern, doc, handler}` table; CLI `PATHS_NOTE` + MCP `beat_set` description GENERATED; `bridge.ts` and `synthParams.ts` import patterns/defaults/id-minting instead of forking (heals the D9 breach); `applyLocalEdit` drift test (R6-4, needs no harness) | `src/core/edit/paths.ts`, `cli` help gen, `src/mcp`, `ui/src/daemon/bridge.ts`, `ui/src/components/synthParams.ts` | M/L | MED | W2.1 landed; the drift test FIRST |
| W3.3 | **`FigureSource` interface + `assembleShowdownBatch`** (R3-F2/F6): registry with priority in ONE testable place; CLI's 143 glue lines → ~25; bpm-conform, ref-audibility, ring-screen policies move into the taste layer | `src/taste/figures/index.ts` (new), `src/taste/showdown/batch.ts`, `cli/cmd/taste/*` | M | **HIGH** | W0.3's I2b green is a hard gate; W2.2, W2.5 landed. Do NOT normalize exclude labels away from prefixed strings without the disjointness test proving the replacement |
| W3.4 | **One finding schema, one flatness detector** (R5-F8): keep LUFS + adopt `screens.ts`'s interior filtering and continuous severity; `SCREEN_THRESHOLDS` exported as one sweepable object | `src/metrics/{finding,sections,screens,lint}.ts` | M | MED | **owner sign-off (D2, D27)**; re-baseline evals after |
| W3.5 | **Remaining GUI mirrors + component splits** (R6-7/10/11): types.ts/constants via shared imports; `useReorderable`/`useDragGesture` finishing `dragDrop.ts`; SynthPanel → NoteView → ArrangementView splits (pure model files first) | `ui/src/*` | L | MED | W2.7 landed; W0.1 green for anything touching the tick path |
| W3.6 | **Python `_sidecar.py` shared scaffold** (R4-2c) | `python/_sidecar.py` (new), 8 sidecars | M | LOW-MED | **owner buy-in only** — trades away D17's standalone-file property |

---

## 4. What NOT to do

Healthy patterns the streams explicitly flagged as leave-alone, plus refactors whose risk
exceeds payoff now:

1. **The frozen-science profile literals** (`engineplusProfile`/`surgeplusProfile`,
   showdown.ts). Deliberate, documented, and correct: reproducibility of a measured ablation vs
   an evolving default. Do NOT merge into `productionProfileFor` (R4 §8, R3-I8). Guard with
   `===` tests (W0.3), then leave alone.
2. **The two-venv split** (`python/.venv` + `venv-roughness`): a hard `numpy>=2 ∧ numpy<2`
   conflict, correctly documented. Watch (don't act on) the ca2 `transformers<4.50` ceiling
   (R4 §10).
3. **The `PROVIDER_ADAPTERS` table and `gen-fal.ts`**: clean adapter accretion with an
   injectable transport seam; at the edge of comfortable but not ready to split (R4 §9).
4. **`runMcpServer`'s dispatch loop**: the three dispatch-level hooks (unknown-arg rejection,
   edit telemetry, tool-error semantics) cover 71 tools without touching a handler — the pattern
   the rest of the layer should copy, not a refactor target (R5).
5. **`src/history/history.ts`**: the cleanest module reviewed; the standard the rest of core
   should be measured against (R2-F8).
6. **`ui/src/state/store.ts`**: disciplined accretion with real decision records; Zustand stores
   fragment badly. Extract only `resolveSelection` (R6-5).
7. **`pitch.ts`**: 230 lines are one cohesive DSP algorithm; splitting costs more than it saves
   (R4-6).
8. **The rate/board PAGE consts and the two logs**: extract the *shell* only. The blind/non-blind
   split and `beat-scores.jsonl` vs `beat-decisions.jsonl` are decided policy (D24, doc 128
   §2.1) — never merge, never make the board blind or the rater non-blind (R1-F4, R5-F10).
9. **The `BeatTrack` discriminated-union rewrite**: genuinely L (93 exports, every consumer);
   use the kernel narrowing helpers instead — the codebase already invented the right idiom in
   `requireDrumsWithOpenLanes` (R2-F6).
10. **Collapsing the 22 error names into one class**: the domain distinction is worth keeping in
    messages; base-class only (R4-5).
11. **Lazy `await import()` in the CLI**: deliberate (heavy taste modules); decomposition must
    not convert to static imports (R1 §6.2).
12. **GUI inline styles**: almost entirely computed geometry, which is correct; three hardcoded
    colors to tidy, nothing more (R6-12).
13. **`document.ts` three-way split**: right idea, wrong time — highest fan-in file in core; do
    it last, after `edit.ts` proves the barrel-absorbs-it pattern (R2 §4).
14. **Comment-stripping refactors anywhere**: the comments are decision records (30–50% density
    in the GUI's core files) and a large part of why the codebase is navigable. Mechanical
    extraction moves comments with code; "clean up while I'm in here" is a net loss (R6).

---

## 5. Coordination constraints

1. **`cli/beat.mjs` is the shared-insert file for every concurrent phase stream** (the
   `==== Phase N Stream X ====` fence convention exists solely for parallel-worktree merges,
   R1 §6.1). Rules: (a) within any wave, exactly one package holds the beat.mjs write lock at a
   time — in wave 0 that is W0.4's one line; in wave 1, W1.3's vary-family diff lands before
   W1.4's sweep begins; (b) the W2.5 decomposition must run when no parallel streams are open
   against beat.mjs, or be announced so streams target the new per-command files; (c) the fences
   are deleted by the decomposition, not carried into new files. Same discipline applies to
   `src/mcp/server.ts` (the other designated insert file) for W1.3/W2.4. The standing
   parallel-session warning on this repo applies doubly here. (High confidence; this is the
   review's one genuinely scheduling-shaped risk.)
2. **Eval-integrity invariants gate every taste-layer move** (T3): D24 blindness (the exclude
   -label namespaces, the seeded shuffles, the `*7+3` clip-order derivation, the per-arm seed
   offsets — all currently held by comments), the frozen ablation constants (D26/D27
   comparability with ~21+ rated engineplus batches — `===` tests before anything in
   `showdown.ts` moves), determinism (any output-changing change — W2.8's shuffle fix, W3.4's
   thresholds — is its own commit with a doc note and deliberately-updated snapshots, never
   smuggled into a mechanical refactor), and the D25 kind-only shared-log projection (one
   `logSources()` to protect after W2.6).
3. **Rating rounds in flight:** rating passes are actively ongoing (a 2026-07-25 pass caught the
   Lyria negative-prompt bug mid-round; the engineplus ablation arc is the owner's comparison
   baseline). Output-changing taste moves (W2.8-F3, W3.3, W3.4) land **between** rounds, with the
   owner told which batches predate the change. (Medium confidence on current round status —
   taken from session memory, not re-verified this session; check `beat-scores.jsonl` recency
   before scheduling W2.8.)
4. **Build/import topology:** new `cli/**` modules keep importing `../dist/src/…` (a
   `cli/lib/dist.mjs` re-export shim removes the relative-depth error class, R1); `ui/` imports
   from `src/` only via the sanctioned isomorphic leaf barrel (W2.7) — never wholesale
   (`macro.ts → edit.js` would drag the core graph into the browser bundle, R6-13); `cli/` still
   never imports `ui/`.
5. **Which handlers `process.exit()` vs return is load-bearing** (chromium/vite stragglers,
   R1-F6) — W2.5's dispatch table makes it explicit metadata before render/match/daemon code
   moves.

## Honest gaps

- **No coverage tooling exists** (R2 §6) — every per-module coverage claim in this review is
  grep-derived, not measured. Adding `--experimental-test-coverage` or c8 was not planned into
  any wave; it would sharpen wave-0 priorities and is cheap. (My addition; medium priority.)
- **Areas nobody reviewed:** `scripts/` beyond `source-lib.mjs` (bakeoff/curation scripts),
  `desktop/` (the live Tauri shell — R2 confirmed only that it holds zero grammar knowledge),
  `src/telemetry/` (touched only via R2-F0d's edit-log finding), `src/match/`, and the
  `.claude/skills/` prompt surfaces. The register above cannot claim completeness there.
- **The leverage×risk ranking in §2 and the wave assignments are synthesis judgment**, not
  stream conclusions — the streams ranked within their areas; the cross-area ordering (e.g.
  placing T7 below T6) is mine. (Medium confidence; disagreements would reshuffle waves 2–3,
  not wave 0–1.)
- **File-disjointness of the wave packages was checked against the reports' file lists, not
  against the tree** — the two identified collisions (beat.mjs, and ca2/midifig/embeddings
  between W1.1/W1.2) are resolved above by serialization and by the showdown barrel keeping
  W1.2's blast radius small, but a pre-flight `git diff --stat` per package pair is cheap
  insurance. (Medium-high.)
- **`docs/decisions.md` contains two entries numbered D23** (windowed offline render,
  2026-07-17; GPL out-of-process sound factories, 2026-07-22). Every "D23" citation in the
  stream reports and this doc is therefore ambiguous; worth renumbering the second (e.g. D23b)
  in a one-line owner-approved edit. (High — verified directly this session.)
- **The in-flight rating-round status (§5.3) is from session memory**, not re-verified against
  the logs this session.
- **Estimated LOC savings are directional.** The verify-fleet 7–10k figure is R6's estimate
  from sampled pairwise overlap; the ~12–15k aggregate in §1.2 inherits that spread.

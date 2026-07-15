# Phase 40 — the generative sampler: make the by-hand workflow product

> **STATUS 2026-07-15 — PROPOSED.** Awaiting owner pick of streams.

## Context

Phase 39 shipped `beat source gen` (Stable Audio Open) with its real backend unvalidated — the
build container can't reach PyPI/HF. On 2026-07-14 the owner's machine ran it for the first time,
which produced two things:

**1. Three real dependency bugs and one contract bug**, all invisible to CI (commit `935ef53`):
`beat_this` needs an undeclared `soundfile` (its `load_audio()` silently falls back to it when
`torchaudio.load()` fails, which it does here — every real analyze died with "Could not load
audio"); `stable-audio-tools` pins a numpy-2-ABI-incompatible `PyWavelets==1.4.1`; it imports
`pytorch_lightning` at model-load time without declaring it; and it `print()`s warnings to
**stdout**, breaking the "stdout is exactly one JSON line" contract `beat source gen` parses
strictly. Also: `stable-audio-tools` requires Python `>=3.10,<3.11`, so `python/.venv` must be
built on 3.10 — now documented in `python/README.md` + `README.md`.

**2. `examples/recipe-song/`** (commit `472f8ba`) — a 40 s track where **every** audio asset is
Stable-Audio-Open-generated: one bell one-shot pitch-mapped into a melody across six declared drum
lanes, a found-sound kit, a pad repitched into key. Regenerating a one-shot from only the
prompt/seed/seconds in its provenance sidecar reproduced the registered file **byte-for-byte**
(sha256-verified, same machine) — the `.beat` file is literally a recipe. Owner's read: *"the most
interesting and sonically different thing we've generated thus far… which makes sense because all
the sounds are samples… there will be a lot more to explore here."*

**The gap this phase closes.** Building that song, the interesting parts were all done **by hand,
outside dotbeat**, with numpy in a scratch heredoc:

| What I did by hand | Why dotbeat couldn't | Today's workaround |
|---|---|---|
| Chose bell_a over bell_b | No pitch/quality read on a sample | FFT: bell_b had two partials a semitone apart (would beat against itself) |
| Chose snare seed 5 of 5/6/7 | `beat score` needs a vary manifest; gen makes none | Compared spectral centroids by hand |
| Mapped one bell across 6 lanes | Nothing computes tune offsets for a scale | Hand-wrote `lane a5 sample bell_a 0 -12` … ×6 |
| Tuned bass to A1/G1/C2 | **dotbeat doesn't know what pitch a sample is** | Measured f0=25.3 Hz, derived fractional tunes (-6.5) |
| Repitched the pad into key | Same | Computed `rate 0.9439` by hand |

Every row is the same root cause: **dotbeat can play a sample at a `tune` offset but has no idea
what pitch the sample IS.** That's the missing middle between "generate a sound" and "play a
melody with it," and it's what makes the sampler workflow feel like a research project instead of
an instrument. Phase 40 builds that middle, connects generation to the taste loop, and repairs two
trust bugs the same session exposed.

---

## Stream VA — pitch-aware sampling + keymap (the missing middle)

**No Python.** `src/metrics/analyze.ts` already carries a pure-TS zero-dep FFT (its private
`fft()`, line ~81) and `src/metrics/wav.ts` a `decodeWav()` — so pitch detection ships to
*everyone*, works in CI, and needs no venv. That's D20 below.

**1. `src/analysis/pitch.ts` (new) — `detectPitch(channels, sampleRate)`.** Returns
`{ hz, midi, note, cents, confidence, method }` — the fundamental of a one-shot. Autocorrelation
(YIN-style) over a windowed body segment past the attack transient, cross-checked against the FFT
peak; `confidence` low when partials are inharmonic (a clang) or when the two methods disagree.
**Honesty over false precision**: an unpitched sample must report low confidence, not a confident
wrong number — the whole point is that a user can trust the mapping. Export `fft()` from
`src/metrics/analyze.ts` (currently private) rather than copying it; keep it re-exported through
`src/metrics/index.ts` so the dependency direction stays analysis → metrics.

**2. `beat sample-info <file> <sample-id>` (CLI) / `beat_sample_info` (MCP).** Prints what today
required numpy: detected pitch (+ MIDI note name + cents off), confidence, duration, peak, centroid
— **and the top-partials table** (frequency, relative magnitude, ratio-to-lowest). The partial
table is not decoration: it is literally what made the bell_a-vs-bell_b call decidable (bell_b's
two partials a semitone apart, ratio 1.06 — invisible in any single-f0 summary). A low-confidence
f0 alone leaves an agent stuck; the table lets it reason.

**3. `beat keymap <file> <track> <sample-id> --scale <name> --from <note> --to <note>` (CLI) /
`beat_keymap` (MCP).** The headline. Mints one declared lane per scale degree, all backed by the
same sample, each with the `tune` that lands it on that pitch — computed from the sample's
*detected* fundamental, so the offsets are right even when the sound came back between notes (the
bass's fractional `-6.5`). Names lanes by note (`a5`, `c6`, …). Refuses (with the measured
confidence) when pitch detection isn't sure, unless `--force` or an explicit
`--root <note>` override is given — a wrong keymap is worse than none. **Design `--root` as a
first-class path, not a fallback**: this workflow's signature sounds (bells, plucks, found
percussion) are exactly where f0 detection is weakest — a bell's perceived pitch can be a strike
tone not even present in the spectrum — so expect `--root` to be *common*. The refusal message
must quote the partial table and a ready-to-paste `--root <note>` suggestion derived from the
strongest partial, so the override is one copy-paste, not a research project. Scales: reuse whatever
`src/core/`'s fit-to-scale already knows (`grep scale src/core/edit.ts`) rather than minting a
second scale vocabulary. Respects the `-24..24` lane tune clamp: a requested range wider than that
errors naming the reachable span.

The result is the recipe-song's bell instrument as **one command**, and its output is still just
six diffable text lines — the "only dotbeat does this" demo becomes a first-class feature instead
of a party trick.

**4. `--repitch <note>` on `beat audio-clip`** (or a `beat audio-pitch` verb): compute the `rate`
that moves an audio region to a target pitch, from its detected fundamental. Kills the hand-computed
`0.9439`. Small, same machinery, high leverage.

VA touches: `src/analysis/pitch.ts` (new), `src/core/keymap.ts` (new), `src/metrics/analyze.ts`
(export `fft`), `src/metrics/index.ts`, `src/analysis/index.ts`, `cli/beat.mjs` (new verbs +
HELP), `src/mcp/server.ts` (new `// ==== Phase 40 Stream VA ====` region), `test/pitch.test.ts`,
`test/keymap.test.ts`. Known-answer tests: synth sine at a known Hz detects it within a few cents;
an inharmonic/noise sample reports low confidence; keymap produces exactly the recipe-song's six
lanes from bell_a; out-of-range span errors.

---

## Stream VB — generation joins the taste loop

Closes the backlog row filed today. The natural generative workflow is *same prompt, N seeds, rank,
adopt* — and it can't route through `beat score`/`beat adopt`, which require a vary-batch manifest
that generation never produces. Today the snare was picked out-of-band and its two losing
candidates stay registered in the media block with no record that an audition happened.

**1. `beat source gen … --count N [--seed-from S]`** generates N one-shots (seeds `S..S+N-1`) into
a batch dir next to the `.beat` (reuse `defaultBatchDir`'s convention: `gen-<id>-<seed>/`), writes
a manifest, and prints the same "audition, then: beat score …" call to action the vary rungs print.

**2. Candidates must NOT register until adopt — this inverts source-lib's flow, and it is the
stream's real design work.** Today `beat source gen` runs `ingest()` immediately (prep + sha256 +
media-block registration + provenance sidecar), which is how the recipe-song ended up with two
losing snares permanently in its media block. A batch generates N *candidates* that touch nothing
in the `.beat`; only `beat adopt` runs the ingest step, on the winner alone. Concretely: split
source-lib's `ingest()` so its prep/normalize half runs at batch time (candidates are auditioned
as they'll sound) and its register/sidecar half runs at adopt time. Losing candidates leave no
trace outside the batch dir.

**3. The manifest contract (D21) — a fit, not a free fit.** `VaryBatchManifest.variants[]` is
currently `{ file: 'vN.beat', edits? | recipe? }` and `adoptVariant` is a **pure `.beat` text
copy** — no concept of media. Gen batches strain it in three places, each needing an explicit
answer, not an assumption: (a) variants are **wavs, not `.beat` files** — `variants[].file`
becomes `vN.wav` for gen batches, and every manifest reader that assumes `.beat` must be checked;
(b) `scoreBatch` records `track`/`group`, which a gen batch doesn't have — carry
`group: 'gen:<sample-id>'` and no `track` (schema-optional), so the scores log stays one shape;
(c) `adoptVariant`'s `parentSha256` guard still applies (the `.beat` it will register into must
not have moved), but adopt now *also* copies the winning wav + runs the deferred registration —
extend it in `src/vary/batch.ts` so both surfaces inherit, reusing the existing re-register
messaging for an id that already exists. A parallel gen-only batch shape is rejected — it forks
the contract Phase 34 NA deliberately unified after pilot 95's drift.

**4. Audition without a render.** Vary's `--audition` stitches rendered variants; gen candidates are
already audio, so stitch the one-shots directly (spaced, with the same timecode index +
`audition.json`) — reuse `src/vary/audition.ts`'s `stitchAudition`/`formatAuditionIndex`, no
Chromium needed. Cheap and immediate: N one-shots, one file, pick a number.

**5. `beat score`/`beat suggest` carry through with only the item-3 schema accommodation** — the
goal is one scores log, not zero diffs. A scored gen batch appends to the same
`beat-scores.jsonl`, so "which prompts/seeds do I actually like" becomes answerable by the
machinery that already answers it for cutoff sweeps.

VB touches: `src/vary/batch.ts` (manifest + adopt), `src/analysis/gen.ts`, `scripts/source-lib.mjs`,
`src/vary/audition.ts`, `cli/beat.mjs` (`source gen` flags, own marked region), `src/mcp/server.ts`
(own region), `test/gen-batch.test.ts`. All batch tests run on the `stub` backend — deterministic
per seed, so a 3-seed batch is a known-answer test with zero packages.

---

## Stream VC — prove the recipe; repair two trust bugs

**1. `beat regen <file> [--verify] [--id <sample-id>]` — the payoff of today's byte-identical
proof.** Walk `media/*.wav.json` provenance sidecars, re-run `beat source gen` with each recorded
prompt/seed/seconds/model, and restore `media/`. `--verify` regenerates to a temp dir and reports
sha256 match/mismatch per sample **without** overwriting. This makes "the song is a recipe" an
executable claim rather than a README sentence: clone the repo with an empty `media/`, run
`beat regen`, get the song back. Honest scoping in its own output and docs: determinism is verified
**same-machine/same-torch**; a mismatch across machines is expected, not a bug — report it as
"differs (cross-machine reproduction is not guaranteed)", never as corruption. Non-generated
sidecars (Freesound/local ingest) are skipped with a clear "not regenerable — <source>" line.
State the cost up front in help text and per-run output: ~2 min per one-shot on CPU (measured
2026-07-14), so a full recipe-song regen is ~20 minutes — print the count and estimate before
starting, not after. **Lives in `src/analysis/regen.ts` (new), importing from
`scripts/source-lib.mjs` — it must NOT edit source-lib**, which Stream VB is restructuring in a
parallel worktree (see Ordering).

**2. Render silently serves a stale `ui/dist` (the HIGH bug).** `cli/render.mjs` builds `ui/` only
when `ui/dist/index.html` is **missing** (line ~117), so after a `git pull` that changes the engine
it serves whatever stale bundle is on disk. That is exactly how the recipe-song's first render came
back **pure silence**: the served bundle predated sample-lane playback, and the readiness probe
printed `-1 media load(s) still pending` — nonsense, because `pendingMediaCount()` didn't exist in
that build. The bitter detail: `pendingMediaCount` was *itself* added to close a silent-render trap
(owner's dogfood session 2026-07-13), and Phase 39 UA hardened the same class again — staleness
reopened it from the outside, and the harness couldn't even tell. Fix, in two independent layers: (a) compare `ui/dist` mtime
against the newest file in `ui/src` (+ `ui/package.json`, `ui/index.html`) and rebuild when stale
— a cheap heuristic that can false-negative (e.g. branch switches restore old content with fresh
mtimes), which is acceptable *only because of* (b); (b) treat a missing `pendingMediaCount`
(today's `-1`) as a **hard error** naming the stale-bundle cause and the `cd ui && npm run build`
fix — a probe that can't run must never look like a probe that ran. Layer (b) is the
non-negotiable safety net; (a) is convenience.

**3. `npm test` is red on the machine that matters.** Five tests in `test/analyze-sidecar.test.ts`
and `test/gen-sidecar.test.ts` assert the *dependency-missing degrade path* (`beatthis must fail
without torch installed`; `--doctor` reports `stableaudio.ok === false`). They're premised on the
backends being absent — true in CI, now false on the owner's machine, so `npm test` reports
**5 failures** there for a correctly-working install. That's a broken window: it trains the one
person who runs the full suite most to ignore red. These tests already gate on `python3` presence
(`hasPython`) — extend the same pattern: probe the backend deps once at module top (`beat analyze
--doctor` / `beat source gen --doctor` JSON) and `t.skip('beatthis installed — degrade path not
exercisable here')` when present. The degrade path stays covered where it's real (CI), and the
suite goes green where the deps are real. Optionally add the inverse: an owner-side
`npm run test:sidecars` that exercises the *installed* backends (real analyze on a fixture WAV,
`--doctor` reports ok) — the assertions CI structurally cannot make.

VC touches: `src/analysis/regen.ts` (new — never `scripts/source-lib.mjs`, see Ordering), `cli/beat.mjs` (`regen` verb),
`src/mcp/server.ts` (`beat_regen`), `cli/render.mjs` (staleness + probe error), `test/analyze-sidecar.test.ts`,
`test/gen-sidecar.test.ts`, `test/regen.test.ts`, `package.json` (optional script).

---

## Stream VD — pilot + wrap-up (serial, after merge)

- **CLI/MCP usability pilot** (`docs/research/107-…`) over the new surface: hand an agent a real
  goal ("make a melodic instrument out of a generated sound and audition three versions of it")
  with no checklist. Per CLAUDE.md this is standing practice whenever a phase adds CLI/MCP verbs,
  and it's cheap (~4 min, per research/94). Target VA's keymap/sample-info and VB's gen batches —
  the surfaces where I was the tester today and therefore the least trustworthy judge.
- **A second recipe-song**, built entirely through the new verbs, as the honest test of whether
  the phase actually removed the numpy heredocs. If it still needs one, the phase isn't done.
- **Wrap-up**: `scripts/roadmap-data.mjs` (mark the two backlog rows resolved, add the new
  feature rows) → regenerate `docs/product-roadmap.md` → splice + republish the dashboard artifact
  → README status paragraph + test count → dotbeat skill (new verbs).

---

## Decisions to record

- **D20 — pitch detection is pure TS, not a third Python sidecar.** `src/metrics/` already has a
  zero-dep FFT and WAV decoder; a one-shot's fundamental needs no torch. Keeps the feature
  available to every user with no venv, keeps it CI-testable (the thing today proved matters), and
  holds the line that Python is only for what genuinely needs the ML ecosystem (D17/D18's contained
  -dependency stance). Revisit if polyphonic/chord detection is ever wanted — that *is* ML.
- **Keymap-as-lanes is the v1, not the endgame — record the trajectory so it doesn't calcify.**
  N declared lanes cap a melody at N pitches inside the ±24-semitone lane clamp; the eventual
  "real DAW" answer for pitch-mapped samples is a sampler *instrument* track type — piano roll,
  any MIDI note, tune computed per note from the sample's detected root. Lanes are right for v1
  because they're the format's existing vocabulary and the diffable-pitch-map property is the
  product's signature; but keymap's implementation (detected-root → tune arithmetic in
  `src/core/keymap.ts`) should be written as a function of `(rootMidi, targetMidi)` that a future
  sampler track reuses unchanged. Revisit when a melody wants more than ~a dozen pitches or
  chromatic freedom — that's the sampler-track trigger, and it's a format/engine phase of its own.
- **D21 — one batch manifest; `adopt` learns media.** Gen candidates join `VaryBatchManifest` via
  an optional `media` field on each variant rather than forking a parallel batch shape, and
  `adoptVariant` copies the winning wav into the parent's `media/` and registers it. Rationale: the
  cross-surface manifest/score-log contract was deliberately unified in Phase 34 NA after pilot 95's
  drift; a second shape re-forks exactly what that fixed.

## Ordering & process

- **VA ∥ VB ∥ VC in parallel worktrees; VD serial after merge.** Shared files are `cli/beat.mjs`
  and `src/mcp/server.ts`, each in disjoint `// ==== Phase 40 Stream Vx ====` regions — the
  Phase 39 pattern, mechanical merges. **One deliberate exclusion making that true:**
  `scripts/source-lib.mjs` belongs to VB alone (it restructures `ingest()`); VC's regen therefore
  lives in `src/analysis/regen.ts` and only *imports* source-lib. If regen turns out to need a
  source-lib change, that change goes through VB's stream or waits for the merge — two worktrees
  editing source-lib is exactly the Phase 29 dispatch mistake CLAUDE.md documents.
- Per CLAUDE.md: **commit AND push this plan before dispatching** (worktrees branch from
  `origin/main`, not local HEAD).
- The places to get the design right before writing much code: VB's ingest split +
  D21 manifest accommodation, and VA's keymap/`--root` UX. VC is contained and could go first if
  a quick win is wanted.

## Verification

`npm run build && npm test` green at every merge — and, new this phase, **green on the owner's
machine too** (VC item 3). VA's pitch detector is verified against synthesized known-frequency
tones, not vibes. The phase's real acceptance test is VD's second recipe-song: if building a
melodic instrument from a generated sound still needs a numpy heredoc, VA missed.

## Critical files

- **Reuse**: `src/metrics/analyze.ts` (`fft`, spectral), `src/metrics/wav.ts` (`decodeWav`),
  `src/vary/batch.ts` (manifest/score/adopt contract — `writeVaryBatch`, `adoptVariant`,
  `defaultBatchDir`), `src/vary/audition.ts` (`stitchAudition`), `scripts/source-lib.mjs`
  (`ingest`, provenance sidecar, rollback), `src/analysis/gen.ts` (`runGen`), `src/core/edit.ts`
  (`setLaneSample`, the `-24..24` tune clamp, existing scale vocabulary), `cli/render.mjs`
  (build/serve block ~109-125, probe ~219).
- **New**: `src/analysis/pitch.ts`, `src/core/keymap.ts`, `src/analysis/regen.ts`,
  `test/pitch.test.ts`, `test/keymap.test.ts`, `test/gen-batch.test.ts`, `test/regen.test.ts`,
  `docs/research/107-*.md`.
- **Evidence from today**: `examples/recipe-song/` (the worked artifact + its provenance sidecars),
  commits `935ef53` (the four real bugs), `5f329b6` (the two backlog rows).

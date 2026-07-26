# 145 — Showdown arm pairing, the blind environment-fault guard, and five filed observations

**Date:** 2026-07-26. **Scope:** a task to (1) fix the confound that made round 6 unreadable,
(2) wire the `figureSource` readout, (3) correct false comments in `src/taste/layered.ts`, and
(4) generate a controlled round. Item (4) was cancelled mid-task by the coordinator after the owner
rated the layered arm non-blind (layered alone won 1 of 9); no generation was run and no fal money
was spent. Everything below is verified in code or by a runnable experiment, not inferred.

---

## 1. Does the same `--seed` pair two figure-source arms? Yes — but only by accident, until now

**The question.** Round 6 (2026-07-25) compared bank / theory / ca2 under a script header reading
"One variable — where the figure comes from", and ran the three arms at three DIFFERENT `--seed`s
(93001 / 93002 / 93003). For the bassline cell alone, ca2 composed over `seed-007.beat` with patch
`roll-bassline-234` against ref `NOIZU_sub_loop_06`; theory over `seed-008.beat` with
`roll-bassline-102` against `NOIZU_125_choppy`; bank over `seed-006.beat` with `roll-bassline-402`
against `NOIZU_sub_loop_03` — each with its own gen prompt. Arm was confounded with source doc,
engine patch, reference clip and gen prompt.

**The experiment** (`--gen-backend stub`, no network, no cost): three runs at `--seed 777` over
`--roles bassline,chords` with `--with-produced --ref-dir refs-packs`, one per arm.

| | bank | theory | ca2 |
|---|---|---|---|
| batch seed | 68637 / 61868 | 68637 / 61868 | 68637 / 61868 |
| source doc | seed-003 / seed-005 | seed-003 / seed-005 | seed-003 / seed-005 |
| engine patch | `curated:roll-bassline-32` / `roll-chords-382` | identical | identical |
| ref chop | `GUY_GERBER_bass_loop_smoothy_man_sub_01_120_Bmin.wav` | identical | identical |
| gen prompt | "a trap-influenced 808 bassline loop, … 92 BPM" | identical | identical |
| keymap prompt + detected root | identical | identical | identical |
| v-slot assignment | identical | identical | identical |
| **figure** | `rolling-8ths` | `theory:sub-pulse` | `ca2:roller` |

So the answer is **yes, same-seed already pairs them** — the round-6 damage was entirely the three
different seeds, not a structural defect.

**But it held by accident.** All seven nuisance draws (`batchSeed`, `genSeed`, `kmSeed`, two style
indices, `refPick`, the seed-doc index) came off a single sequential `mulberry32(metaSeed)` walked
across the whole run, and happened to sit at the TOP of the batch loop, above every arm-conditional
branch. One `rng()` call added anywhere lower in that ~500-line body — i.e. anywhere in the
arm-specific code — would have shifted every subsequent batch's draws. That is verbatim the hazard
`src/core/rng.ts`'s header describes, and nothing tested it.

**The fix** (`drawShowdownBatchPlan`, `src/taste/showdown.ts`): the seven draws come from a pure
sub-stream keyed on `(metaSeed, round, role)`. It takes no arm parameter by construction, and
`showdownCmd` now owns no random stream at all — the `mulberry32` import is gone, and a test asserts
the function body contains no `rng(` call.

**A bonus property worth knowing.** The sub-stream is keyed on the ROLE NAME, not its index in
`--roles`. So `--roles chords` and `--roles bassline,chords` now yield the SAME chords batch, and a
round can be re-run one role at a time after a per-role failure without disturbing the others. Under
the old sequential stream a per-role re-run silently produced a different batch.

### 1a. Residual leak: batch-median loudness couples the arm to the ref and gen clips

The clip AUDIO is not byte-identical across arms even though the ref file, the gen prompt and the
durations are. `normalizeBatchLoudness` targets the **batch median LUFS**, and the arm's figure is
one of the clips that median is computed over. Measured on the stub runs: the bassline batch
normalized to −10.7 (bank) / −10.6 (theory) / −10.6 (ca2) LUFS; the chords batch to −12.7 / −13.6 /
−12.7. The ref clip's applied gain moved by up to 0.1 dB and the gen clip's by up to ~0.9 dB.

This is **not** fixed and should not be fixed casually: batch-relative normalization is what makes a
batch internally level-matched, which is a precondition of blind rating, and an absolute target would
change the character of every batch and break comparability with everything already rated. It is
filed here so it is a known, bounded (~1 dB) caveat rather than a surprise.

### 1b. The production treatment IS paired

Asked after the layered A/B, where the owner heard an unpaired ambience difference. Verified:
`engineplusProfile(kind)` and `surgeplusProfile(role)` are pure functions of their one argument —
no seed, no rng, no figure — so two figure-source arms at one `--seed` get byte-identical sends and
effects. `test/showdown-pairing.test.ts` pins that plus an end-to-end check that the same host doc
produced under two DIFFERENT composed figures gets the identical `applied` list, effect chain and
send values. An unpaired ambience setting cannot confound a future figure-source comparison the way
it confounded the layered one.

---

## 2. The environment-fault abort had never worked

`isEnvironmentFault` (`src/vary/batch.ts`) shipped to end the rounds 5 and 6 disaster, where one
broken `ui/` build ate all 18 batches of each round under a warning blaming fal. **Verified by
inducing the real fault** — `ui/node_modules` moved aside, `ui/dist` made stale — and running a
3-role `beat showdown`:

- **Before:** `cli/render.mjs` printed its exact `ui/node_modules is missing` text three times,
  `isEnvironmentFault` matched none of it, all three batches were counted as ordinary skips, exit 0.
  Bit for bit the failure the guard was built to end, still happening after it shipped.
- **After:** aborts after batch 1 — `showdown bassline failed for a reason every remaining batch will
  hit too (ui/node_modules is missing)` — exit 2.

**Cause.** `renderVaryBatch` spawned the render child with `stdio: [ignore, ignore, 'inherit']`, so
the child's fatal message went to the terminal and never into the thrown Error. Node's exec wrapper
message is only `Command failed: <node> <render.mjs> --batch <dir>`, which matches no signature in
the allowlist. Every caller that classified a render failure was classifying an empty string.

**The generalizable lesson.** Both existing tests asserted the CLASSIFIER against hand-typed
strings. Neither asserted that those strings ever REACH it. A guard tested only on its own input
format, never on its real input, is not a guard — and this one sat in that state through the exact
scenario it was written for. `test/showdown.test.ts` now exercises the real spawn path.

---

## 3. `UNMEASURABLE_TARGETS` was wrong about all four of its rows

`src/taste/layered.ts` listed `attackMedMs`, `fluxMean`, `onsetRatePerSec` and `flatnessHiDb` as
unmeasurable with reasons like "onset detection exists nowhere in the codebase", "spectral flux needs
an STFT", "spectral flatness is not in MixMetrics". **`analyzeRich` in `src/metrics/rich.ts` computes
all four**, with a real STFT and a real onset detector; it landed via a parallel stream the layered
author could not see. Comments corrected; `test/layered.test.ts` now asserts each listed name is a
key of `analyzeRich`'s output and that no `why` string claims the feature is uncomputable, so this
cannot silently invert again.

The gates stay OFF, which is the honest state. See observation O1.

---

## 4. Observations filed (each with the trigger that should un-defer it)

Recorded here rather than in `scripts/roadmap-data.mjs` only because another stream held that file
during this task; they should be promoted to rows.

**O1 — Calibrate the four rich features against the reference pool, then gate them.**
Every other `LAYERED_TARGETS` row is derived from measured refs-packs quantiles (`deriveTargets`,
`scripts/ref-pool-stats.mjs`). The four above have only research/131's hand-written prose numbers
against an unstated reference and an unstated measurement method — and two of them are wrong as flat
thresholds regardless (`fluxMean >= 0.17` is scale-dependent on the flux definition; `onsetRatePerSec
>= 4/s` is tempo-dependent). *Work:* run `analyzeRich` over refs-packs per role, derive p25/p50/p75
the same way `deriveTargets` does, then move the rows out of `UNMEASURABLE_TARGETS`. *Trigger:* now —
it is a measurement task with no dependencies.

**O2 — `presets/surge-retargeted.json` is still unreachable.**
Its engine sibling is now wired (`beat showdown --retargeted-patches`, this task). The surge one is
not, and is NOT a small change: its rows carry `nativeOverrides` (a list of Surge native parameter
names and values) that `pickSurgePatch` and the `python/surge_render.py` sidecar have no path to
apply — `pickSurgePatch` returns a patch file path and nothing more. *Work:* a sidecar parameter-set
API plus a `--retargeted-patches` branch in the surge draw. *Trigger:* when the surge arm is next
worth spending renders on.

**O3 — Run the paired curated-vs-retargeted engine round.**
Now possible in one command pair thanks to §1: identical flags and `--seed`, differing only by
`--retargeted-patches`, and the two rounds pair batch-for-batch. *Caveat that shaped the decision not
to fold it into this task:* the layered and ref/gen/keymap clips would be near-identical across the
two rounds (same seeds, same prompts), so the owner would rate duplicates and the ref/gen evidence
counts would inflate. *Work:* run it as its own round with `--with-layered` OFF on both sides.
*Trigger:* whenever engine-arm patch quality is next the question.

**O4 — Batch-median loudness normalization leaks the arm into the ref/gen clip gains.** §1a. Bounded
at ~1 dB. *Trigger:* only if an arm comparison ever turns on a margin that small.

**O5 — Audit the other render-failure classifiers for the §2 defect.** The bug was not in
`isEnvironmentFault` but in what reached it. Any other place that classifies a child process's
failure by its Error message deserves the same "does the real input ever arrive" check.

---

## 5. What did NOT happen

No round was generated. The coordinator cancelled Part 2 mid-task on the owner's non-blind layered
rating (layered alone 1 of 9; unlayered 3, "neither" 3, layered+production 2), having confirmed two
causes in code: every layer in all 18 architectures carries `sendReverb: 0` and `sendDelay: 0` while
the engineplus arm it was compared against carries 0.18 / 0.08, and the character layers are
highpassed saw/square in every role, which is the buzzy signature the owner reported.

**Independently reproduced here, read-only, with one refinement.** Across 36 distinct architectures
(12 per role) and 124 layers: zero with `sendReverb > 0`, zero with `sendDelay > 0`. The refinement:
that is the PLAIN `layered` arm. `layeredplus` does pick up ambience from the per-layer production
pass — on a chords stack, pad 0.30/0.08, stab 0.14/0.12, air 0.40/0 — but its `body` layer stays
fully dry under mono discipline. So the ambience confound is **total** for `layered` vs `engineplus`
and **partial** for `layeredplus` vs `engineplus`. Worth knowing when the fix lands, because the two
arms were not equally affected and their ratings should not be pooled.

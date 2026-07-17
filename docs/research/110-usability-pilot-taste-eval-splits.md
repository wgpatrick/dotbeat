# Usability pilot 110 — `beat taste-eval` per-variant-type splits (CLI)

**Goal:** Persona: a musician who has been living in dotbeat's taste loop for a while — a history of
scored synth vary batches *and* scored generated-sample (gen) batches — who wants to answer, from
the CLI alone: "is the taste model actually learning MY taste, and does it work better on synth
variations than on generated samples?" Everything below was discovered from `beat help taste-eval`
and command output only — no source reading until after the session.

**Fixture:** the container had no real scored history, so a scores log was fabricated before the
session (seeded PRNG, reproducible): 12 batches of 4 variants each with full 13-key DSP feature
vectors — 8 vary batches (`track:"lead"`, `group:"cutoff"`) whose pick is *always* the variant with
the lowest `centroidLog2` (a consistent "darkest wins" taste), and 4 gen batches (`group:
"gen:snare"`, no track) whose picks are random relative to features. So the planted ground truth is:
**yes on vary, chance on gen** — and the pilot can grade the tool's answer against a known key,
which GUI pilots almost never get to do.

## Narrative walkthrough

`beat help taste-eval` is a solid orientation block: it names the method (leave-one-batch-out
held-out pick prediction), promises "accuracy vs chance for the built-in scorers", explains where
embeddings come from and why they might be absent, and lists related commands. It says *nothing*
about per-type splits — I went in not knowing they existed. It also says usage is
`beat taste-eval <file.beat> [--log f]`, which read oddly for my question (I care about my scores
log, not any particular project).

**First contact, natural path:** `beat taste-eval --log <mylog>` with no `.beat` file → exit 2 with
`error: taste-eval needs <file.beat> (the log defaults to beat-scores.jsonl next to it) or an
explicit --log <path>`. That error contradicts itself: I *gave* an explicit `--log <path>` and it
still refused. I created a throwaway `scratch.beat` (which the eval then never visibly used) purely
to satisfy the parser.

**The real run:** with `scratch.beat --log beat-scores.jsonl`, one command produced the whole
answer. `usable batches: 12`, then per scorer an overall line plus indented sub-lines:

```
  dsp-bt   top-1 50% (chance 25%)  top-3 92% (chance 75%)  pairwise 72% of 36 (chance 50%)
    gen       (4 batches) top-1 0% (chance 25%)  pairwise 42% of 12  [small split — smoke, not evidence]
    vary      (8 batches) top-1 75% (chance 25%)  pairwise 88% of 24
```

As the persona, this is exactly my question answered in two lines: vary is way above chance (75% vs
25% top-1, 88% pairwise), gen is at/below chance. The split appeared automatically — no flag to
discover, which is the right call. The batch counts (8 vary / 4 gen) match what I scored, the
`random` scorer row gives a visible chance baseline, and the taste-directions block corroborates
*what* was learned: `-0.97 centroidLog2` at the top — my planted "always pick the darkest" rule,
by far the strongest weight. Against the fixture's answer key the tool scores a clean 100%.

The `[small split — smoke, not evidence]` tag sits on the 4-batch gen lines and not the 8-batch vary
lines. It immediately proved its worth: the *random* scorer's gen split reads top-1 50% — pure
noise that an unlabeled report would let me misread as "even random is learning gen?!". Phrasing is
terse but parseable cold; "smoke" is mild jargon but the "not evidence" apposition rescues it.

**`--json`:** each scorer gains a `byType` array with `type`, `batches`, `top1`, `top3`,
`pairwise`, `pairCount`, `chanceTop1`, `chanceTop3` — sane, mirrors the text, numbers identical.
Two asymmetries: the small-split warning has **no JSON representation** (no `smoke`/`smallSplit`
field — a script consumer can't tell which rows the human output would distrust without re-deriving
the threshold), and the text sub-lines omit top-3 while JSON includes it.

**Mistaken paths:** (1) `--log /nope/missing.jsonl` → friendly, actionable one-liner (`error: no
scores log at ... — score some batches first (beat vary ... --render, beat score)`), exit 2. Model
error UX. (2) Guessed flag `--by-type` → **silently ignored**, exit 0, normal full run — same
silent-unknown-flag class pilot 109 found on `render`. Low stakes here (splits are automatic, so
output was identical), but a user would wrongly conclude the flag exists and is doing something.

**Ground-truthing the splits:** filtered the log to vary-only (8 batches) and re-ran. Sub-lines
correctly disappear for a single-type log, and instead a *global* note appears: "8 batches is far
below the ~10-30 the research base expects for usable signal — treat these numbers as smoke, not
evidence (docs/research/107-taste-model-program.md)" — consistent language with the split tag. The
vary-only run's dsp-bt numbers (top-1 75%, pairwise 88%) exactly match the vary sub-split from the
mixed run, a strong consistency check. `--seed 7` changed the `random` baseline, confirming the
default is a fixed seed (identical output across repeated runs — good for diffing). In JSON, a
single-type log makes `byType` *absent* rather than a one-element array, so consumers must guard
for an optional key.

**User verdict reached:** yes, the taste model has my number on synth varies (and the directions
block even tells me it learned "darker cutoff wins"), and no, it has not learned anything about my
gen-sample taste yet — the tool itself warns me the gen split is too small to conclude even that.
That is precisely the pair of answers the persona came for, from one command.

## Findings summary

- **[worked well] HIGH — the split answers the target question, automatically and correctly.** No
  flag to discover; sub-lines appear exactly when the log mixes round kinds and vanish when it
  doesn't; per-type batch counts, chance columns, and accuracies all match a fixture with a known
  answer key (vary trained to 75%/88% vs planted consistent rule; gen at/below chance vs planted
  random picks). The taste-directions block (`-0.97 centroidLog2`) independently names the planted
  rule. This is the feature working as intended, verified against ground truth.
- **[worked well] HIGH — the small-split tag earns its keep in-session.** The random scorer's
  4-batch gen split read top-1 50% (2x chance, pure noise); without `[small split — smoke, not
  evidence]` the report would invite exactly the over-reading it exists to prevent. Threshold
  application is consistent (4-batch splits tagged, 8-batch not), and the wording matches the
  global low-N note, so the two warnings read as one system.
- **[bug] MEDIUM — `taste-eval --log <path>` without a `<file.beat>` refuses, with a
  self-contradicting error.** CLI-specific (`cli/beat.mjs` taste-eval arg parsing). The error text
  says a file *"or an explicit --log <path>"* is needed — but an explicit `--log` alone still exits
  2. Either honor `--log` with no positional (the eval never visibly used the project file), or fix
  the error text. Repro: `beat taste-eval --log /any/existing.jsonl`.
- **[bug] MEDIUM — unknown flags are silently ignored** (`--by-type` → exit 0, normal run, no
  warning). Same CLI-wide class as pilot 109's `--offlin` on `render`; harmless here only because
  splits happen to be automatic. One `error: unknown flag` line would fix the whole class.
- **[confusing] MEDIUM — the smoke warning is text-only; `--json` has no equivalent.** A script or
  agent consuming `byType` can't tell which rows the human output would distrust without
  re-deriving the size threshold. Add a boolean (e.g. `smoke: true`) to small `byType` rows — and
  arguably to the top level for the global low-N note, which is also JSON-invisible.
- **[slow-to-discover] LOW — `beat help taste-eval` never mentions the per-type splits.** The help
  block documents everything else about the command (method, scorers, embeddings, backfill) but not
  that reports split by round kind when the log mixes them, nor how a batch's type is derived (the
  `gen:` group prefix is guessable from one's own group names, but only after the fact). One
  sentence would close it. Costless in practice because the splits are automatic.
- **[confusing] LOW — text sub-lines omit top-3; JSON includes it.** Probably deliberate line-width
  economy, but a user comparing text to `--json` sees per-type numbers the report never showed.
- **[confusing] LOW — `byType` is absent (not `[]` or one-element) for single-type logs**, so JSON
  consumers must guard an optional key; a one-element array would be more uniform. Judgment call.
- **[confusing] LOW — user-facing note cites an internal doc path**
  (`docs/research/107-taste-model-program.md`), same class as pilot 109's "decisions D22" pointer.
  Fine for the owner-as-user; meaningless to anyone else.
- **[worked well] — error UX on the missing-log path** is the CLI at its best: names the path,
  says what to do instead, exits 2 promptly.
- **[worked well] — deterministic-by-default `random` baseline** (fixed seed, `--seed` to vary)
  makes repeated runs diffable; and the vary-only run's numbers exactly matching the mixed run's
  vary sub-split is a consistency property worth keeping.

## Where the pilot gave up on the "ideal" workflow

Nowhere fatal. The one forced detour: the positional `<file.beat>` requirement made the pilot
create a `scratch.beat` that the evaluation never visibly consumed, purely to reach `--log`. A real
user *in* a project directory would never notice (the log defaults to sitting next to the project);
a user pointing at an archived/copied log from elsewhere hits it immediately.

## Methodology notes / stats

- Pure CLI pilot per `docs/usability-testing.md` "Variant: CLI/MCP pilots": no source read during
  the session; every command's output read before the next; one deliberate mistaken path of each
  kind (bad `--log`, guessed flag).
- Ground truth was *designed in*: the fixture log (12 batches, 4 variants each, full 13-key feature
  vectors from `dist/src/taste/features.js` `FEATURE_KEYS`, seeded mulberry32 PRNG) planted a
  known answer — consistent lowest-`centroidLog2` picks on 8 vary batches, random picks on 4 gen
  batches — so split counts, accuracies, and learned weights were all checkable against a key
  rather than eyeballed for plausibility. All checks passed.
- Fixture and scratch project lived in the session scratchpad (`pilot-110/`), deleted at session
  end; no daemon or ports involved; `git status` afterwards shows only this report.
- ~6 minutes wall, 7 `taste-eval` invocations (2 text, 2 JSON, 1 vary-only, 1 seeded, 1 no-file
  error) plus 1 `init`, 1 `help`, and the fixture generator.

# Production-task eval (`beat prodtask`)

*The eval half of the production-tricks pair. `docs/tricks.md` builds the catalog of named
production moves; this validates them. Companion to `docs/research/119-production-task-evals.md`
(the design — the transform-task section is the spec) and `docs/source-showdown-eval.md` (the
clip-set batch machinery this reuses wholesale). Built 2026-07-22 (plan item A3).*

## The question

The source showdown measured *where* good sound comes from and found dotbeat's engine loses to
commercial chops on **production richness** — it renders literally mono (stereo width ≈ −52 dB vs
≈ −11 dB for real records), near-zero air-band energy, the lowest production-complexity scores.
`beat trick` (research 118) is the catalog of moves that close those gaps, and `beat trick verify`
(deferred) would confirm each move shifts the **metric** it claims to. But the metric moving is not
the point. The point is the owner's ear. **`beat prodtask transform` asks the only question that
matters: do the tricks move the OWNER'S blind ratings, not just the width/air numbers?**

This is research 119's task T-C — the cheapest of the five production-task families (zero new data,
no fal spend, directly closes the loop on research 118) and the one that attacks the exact axis the
showdown measured as the loss.

## The shape: one figure, N arms, blind

Every prodtask batch is a showdown-shaped batch with a different source axis. The showdown holds the
*figure* constant and varies the *source pipeline*; prodtask holds the figure **and the patch**
constant and varies only the **production**:

| arm | what it is | what a win means |
|---|---|---|
| `original` | the role's composed figure, soloed, rendered **raw** through dotbeat's own engine — the documented mono/dry/static loss mode | the engine's raw sound is already fine |
| `tricked` | the SAME figure + patch, plus a sensible per-role **trick stack** applied through the real `beat trick apply` path (width / air / glue moves) | the production tricks move the ear |
| `random` | the SAME figure + patch, plus a magnitude-matched **random-edit control**: the same number of edits the trick stack made, on randomly-chosen legal params at random legal values | — |

The notes and the patch are identical across all three arms — the only thing that varies is
production. That is what makes it a fair test of the *catalog* rather than of any one command.

**Why the random arm is load-bearing.** Tricked-vs-original alone can't distinguish "the *right*
production moves" from "*any* change sounds different / more interesting." The random-edit control
makes the same *number* of edits on the same *kinds* of parameters — random targets, random legal
values — so if the tricked arm only beats the original because the ear rewards novelty, random beats
the original too, and the tricked-vs-random comparison is a coin flip. **Tricked must beat random,
or the catalog's specific content is doing no work** (research 119 §T-C). It's the difference
between "production helps" and "*this* production knowledge helps."

## The per-role trick stacks

Curated in `src/taste/prodtask.ts` (`PRODTASK_TRICK_STACKS`), one sensible production stack per
role, drawn from the validated catalog. Not `beat trick suggest`'s auto-set: the transform arm is
composed *before* any render, so suggest would only ever see document-state preconditions anyway — a
fixed, honest stack is the fair test of the catalog's content. `--tricks name,name` overrides it
(the P1/P2/P3 ablation research 115 asked for: width-only vs width+air vs full, now blind-rated).

| role | stack | axes | why |
|---|---|---|---|
| **bassline** | `sub-foundation`, `glue-saturation` | glue, glue | production for a bass is glue, not width/air — sub weight + warmth. You deliberately DON'T widen or air-shelf a sub; the catalog's width/air tricks all counter-indicate bass/sub (a widened, shelved sub is a mixing mistake), so those tricks *refuse*. An honest two-move stack. |
| **chords** | `unison-spread`, `air-shelf`, `glue-saturation` | width, air, glue | the canonical trio — unison stereo spread + osc-detune layer, an 11 kHz high shelf for air, warm saturation for glue |
| **lead** | `unison-spread`, `air-shelf`, `glue-saturation` | width, air, glue | same trio (`productionRoleFor('arp')` = `lead`, so the lead-role tricks all fit) |
| **drum-loop** | `autopan-hats`, `open-hat-air` | width, air | autopan the hats for width, open-hat offbeats + a brighter tone for air. Glue is a bus move (`glue-saturation` is per-synth-track only), so the kit stack is width+air. |

The stack applies through the *real* `applyTrick` path with no `--force`: a curated stack must not
counter-indicate, so if one does that's a stack bug and it throws loudly. Metric preconditions
(width/air below threshold) can't be checked before a render exists, so they warn ("couldn't verify
— no render") and the stack proceeds — the same advisory posture as `beat trick apply`.

## The random-edit control, precisely

`randomEditControl` (in `src/taste/prodtask.ts`) matches the **number of edits the trick stack
made** (no-op effect re-adds excluded), then applies that many edits on **distinct**, randomly-drawn
legal parameters at **seeded random legal values** — reusing vary's own mutation machinery
(`sampleValueInRange` over `VARY_GROUPS`, the same musically-useful ranges `beat vary` jitters
within, not the merely-legal ones). Candidates are every audible vary param for the track's kind
(synth: the full osc/motion/fx/sends/mix/filter/env surface; drums: the bus groups only — the
legacy track-wide kick/snare/hats voice params are inaudible on a declared-lane kit, pilot 101).
`volume` is excluded everywhere: batch loudness normalization would cancel it, so a random volume
edit is a wasted (invisible) edit. Deterministic in its seed.

## Batch assembly (the showdown machinery, reused)

Per role, per round: pick a seed song carrying the role's track, compose a figure from the
archetype bank (exclude-chained across the run so consecutive batches never share a figure — the
showdown's un-blinding fix), apply it, extend to 4 bars, solo the role track → the **original** arm.
Build the tricked and random arms off that same soloed document. Render all requested arms in ONE
engine boot (offline — exact compute, ~3–5× realtime), then:

1. **seeded arm → v-number shuffle** (`assignClipOrder`) — the first blinding layer; `beat rate`
   shuffles presentation again.
2. **manifest** (`writeProdtaskBatch`): group `prodtask:transform:<role>`, empty parent (score
   works, adopt refuses), per-variant `source` records carrying the arm `kind` **plus** the trick
   names / random edits, honestly (batch-local provenance, like a ref clip's `from`).
3. **duration-match** (trim-with-fade / zero-pad to the shortest arm; `--seconds` overrides).
4. **loudness-normalize** — **load-bearing.** The whole batch is gain-matched to a common LUFS by
   the same `normalizeBatchLoudness` every vary/showdown batch uses. Width and air must win on
   *quality*, never on level — a saturated, widened arm is often several dB louder raw, and without
   normalization the eval would just measure "louder wins." (In the first real round the tricked
   chords arm was pulled down ~5.9 dB.)

Rating flows through the **unchanged** blind `beat rate` / `scoreBatch` path. The scores log records
the arm **kind** per variant (never the trick/edit provenance — that stays in the batch dir); the
DSP feature vector every scored clip already gets is what the report's mechanical receipt reads.
`taste-eval` classifies prodtask batches as their own `prodtask` ablation split (`variantTypeOf`).

## The report (`beat prodtask --report`)

```
beat prodtask --report <dir> [--json]     # (or --log <path>)
```

Per-arm **win / top-half / pairwise** rates, overall and per (task, role), with the same small-n
"smoke, not evidence" label the showdown and taste-eval use (`SPLIT_SMOKE_MIN_BATCHES = 5`). It
reuses the showdown's `tally` verbatim — the scoreboard math is identical, only the kind axis
differs (arm instead of source pipeline).

**The two-receipt design (research 118 §3.5, free here).** Every scored clip already carries its DSP
feature vector in the log, so the report *also* prints the per-arm mean `stereoWidthDb` and
`bandAirPct` — tying the blind result to the mechanical one. The tricked arm should sit toward the
produced range (width −25..−8 dB, air 1..2.5%); if it moved the *metric* but not the *ear* (tricked
loses blind despite a wide receipt), that's the interesting finding, and the receipt makes it
legible. Example from the first real round's smoke score:

```
transform:chords (1 batch)  [small n — smoke, not evidence]
    tricked    win 100% (1/1)  top-half 100% (1/1)  pairwise 100% of 2
    original   win 0% (0/1)  top-half 100% (1/1)  pairwise 50% of 2
    random     win 0% (0/1)  top-half 0% (0/1)  pairwise 0% of 2
      receipt stereoWidthDb: original -57.8  tricked -18.56  random -29.98
      receipt bandAirPct: original 0  tricked 0.01  random 0
```

The width receipt shows exactly what the design wants: the tricked arm mechanically moved from dead
mono (−57.8 dB) into the produced range (−18.6 dB), while random moved only partway (−30 dB). (Air
barely budged on that pad — a shelf only lifts air that has content above ~10 kHz to lift; honest
data, not a bug.)

## How to run a round

```
beat taste-seeds ~/prod            # once — seed songs (any existing collection dir works too)
beat prodtask transform ~/prod --roles bassline,chords,lead --rounds 2   # 6 batches, local engine only
beat rate ~/prod                   # rate them blind in the browser, as usual
beat prodtask --report ~/prod      # the per-arm scoreboard + DSP receipts
```

Renders are dotbeat's own engine, offline — **no fal, no network**. A round of 6 batches costs 18
engine renders (three arms × six batches, one harness boot per batch). Rounds accumulate: the report
reads the whole log, and each (task, role) split sheds its smoke label at 5 batches.

Ablation for free:

```
beat prodtask transform ~/prod --roles chords --tricks unison-spread                       # width only  (P1)
beat prodtask transform ~/prod --roles chords --tricks unison-spread,air-shelf             # width + air (P2)
beat prodtask transform ~/prod --roles chords --tricks unison-spread,air-shelf,glue-saturation  # full   (P3)
```

## Honesty notes

- **The catalog ceiling, not the agent's judgment.** v1 scripts the tricked arm from a fixed
  per-role stack — it evaluates whether the *catalog's* moves help, not whether an interactive agent
  would pick the right ones. The upgrade path is the same as the showdown's: hand a clip to a real
  agent session ("produce this up") and drop its output into the batch dir before assembly. The
  batch format doesn't care where an arm came from. Do the scripted version first — it's the
  baseline the agentic version must beat.
- **Bass is production-light by nature.** The bass stack is glue-only because the catalog's width/air
  tricks correctly refuse a sub. That's honest: a losing bass batch means the glue moves don't help,
  not that we withheld width — there is no legitimate bass width/air move to withhold.
- **Stub rounds are plumbing, not data.** Unlike the showdown, prodtask has no gen arm, so there's
  no stub backend — every arm is a real engine render. But a demo round built for testing still
  shouldn't be mixed into a log you report from; keep throwaway rounds in throwaway dirs.
- **Deferred:** the second prodtask task (complement bass-given-drums, research 119 §2.2, gated on
  T3 stems), and the MCP twin. This ships the transform task, the one that needed no new data.

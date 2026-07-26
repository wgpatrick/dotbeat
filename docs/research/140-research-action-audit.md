# 140 — Research action audit: what was recommended vs. what shipped

**Question (owner, 2026-07-26):** "can you make sure we're acting on everything in the research? Go
through it again and see there's more it recommends that you think we should do."

**Method.** Every recommendation in `docs/research/114-138` (the current program) read in full, plus
a targeted pass over `80-113` hunting never-actioned-but-still-valid items. Each recommendation
classified against four sources of ground truth: the code itself (grep/read, not vibes),
`scripts/roadmap-data.mjs` (the tracking system of record), `docs/decisions.md` (D1-D29 — a
recommendation contradicted by a numbered decision is CLOSED, not pending), and `git log --all`
across the 16 remote branches.

**Baseline verified this pass:** `npm run build` clean; `npm test` = 1481 tests, 1473 pass, 0 fail,
8 skipped (all env-gated). `main == origin/main`. This audit branches from `origin/main` @ `37ef4ff5`.

> **A note on fairness, stated up front.** Eight of the docs in scope (131-138) were committed
> **today** (2026-07-26). Calling a recommendation "dropped" hours after it was written would be
> crying wolf, and an audit that inflates its own findings is worthless. Those are classified
> **UNTRIAGED** below — a separate and milder finding, though not a harmless one: the process step
> that converts research into tracked rows was skipped for all of them, and in at least one case
> (§4.1) a same-day measurement directly contradicts constants that are live in shipped code.

---

## 1. Headline counts

*(pending — filled in once the full per-doc classification is complete)*

### 1.1 The tracking system stopped receiving rows exactly when the current wave started

The clearest single number in this audit. Counting roadmap rows that cite each research doc:

| Research docs | Cited by ≥1 roadmap row | Cited by ZERO rows |
|---|---|---|
| 80-113 (pilots + early program) | 29 of 34 | 5 (`84`, `92`, `106`, `110`, `112`) |
| 114-129 (current program, first half) | 14 of 16 | 2 (`120`, `125`, `126`) |
| **130-138 (current program, second half)** | **0 of 9** | **ALL NINE** |

`rg -c "research/<n>-" scripts/roadmap-data.mjs` for n in 80..138.

Every doc from **130 onward** — the six-stream codebase review, the empirical quality-gap study, the
sound-source expansion, the production-chain-depth measurements, patch design at scale, the producer
knowledge layer, the architecture review, the producer cockpit, and the Splice-parity plan — has
produced **zero** tracked rows. Not a low number. Zero.

Nor are they tracked under a different name: `cockpit`, `SurgePanel`, `session drawer`, `free win`,
`match-to-owned`, `knowledge layer`, `ops layer`, `quality gap`, `composite arm` and `flywheel` all
return **0 hits** anywhere in `roadmap-data.mjs`, description text included.

The last substantive commit to `scripts/roadmap-data.mjs` is `3e5eb18e` (2026-07-25). Docs 131-138
all landed 2026-07-26. Doc 130 landed 2026-07-25 — the same day the roadmap was last touched, and it
was not filed either.

**This is not sloppiness in the tracking file — the roadmap is well maintained where anyone bothers.**
The "Known usability gaps (backlog)" area contains a row (`Candidate / critic "option-board"
surface`) carrying a dated `UPDATE 2026-07-25:` note that carefully partitions which of its four
sub-items shipped and which remain. Someone was doing this properly as recently as the day before
yesterday. The habit stopped; the research did not.

---

## 2. THE DROPPED LIST

*(ranked by expected value × cheapness — pending full completion)*

### 2.1 Research 130's W2 and W3 waves: 15 of 29 items, zero landed, no decision recorded

**Source:** `docs/research/130-codebase-review-synthesis.md` §"waves" (lines 300-343).
**Status: DROPPED** — and it is the largest single block in this audit.

130 laid out a four-wave remediation plan with numbered items. Mapping every ID against
`git log --all --oneline`:

| Wave | Items | Landed | Evidence |
|---|---|---|---|
| W0 (tests/gates first) | 9 | **9/9** | W0.1-W0.9 all have commits |
| W1 (shared scaffolds) | 5 | **4/5** | W1.1, W1.2, W1.3, W1.5 landed — **W1.4 has zero commits** |
| W2 (decomposition) | 10 | **0/10** | no commit mentions any W2.x on any branch |
| W3 (generated surfaces) | 5 | **0/5** | no commit mentions any W3.x on any branch |

Verified structurally, not just by commit message — **every module W2/W3 was supposed to create is
absent**, and every god-file it was supposed to break up is still its original size:

```
MISSING  src/core/edit/        (W2.1)      src/core/edit.ts       1902 lines
MISSING  src/taste/showdown/   (W2.2)      src/taste/showdown.ts  1566 lines
MISSING  src/core/arrangement.ts,
         src/daemon/library.ts,
         src/daemon/http.ts    (W2.3)      src/daemon/daemon.ts   2750 lines
MISSING  src/mcp/tools/        (W2.4)      src/mcp/server.ts      2465 lines
MISSING  src/taste/assemble.ts (W2.5)      cli/beat.mjs           6140 lines
MISSING  src/metrics/normalize.ts (W2.6)   src/vary/batch.ts      1195 lines
MISSING  cli/lib/review-server.mjs (W2.9)
MISSING  src/core/error.ts     (W2.10)
MISSING  src/ops/              (W3.1)
MISSING  cli/lib/args.mjs, cli/help/  (W1.4)
```

Two things make this worth an owner ruling rather than a shrug:

1. **W1.4 is the anomaly.** It sits inside an otherwise-complete wave. W1.1, W1.2, W1.3 and W1.5 all
   landed; W1.4 (`cli/lib/args.mjs` + help extraction, which 130 notes "closes unknown-flag
   validation for all ~87 commands") did not. W0.2 shipped the CLI surface test *with a
   known-failing allowlist for ~75 commands* — W1.4 is what retires that allowlist. Shipping the
   test and skipping the fix leaves a permanent 75-entry exception list in the gate. **Cost: M.**
2. **Pieces of W2 landed untagged, which hides the gap.** W2.8's Fisher-Yates fix shipped as `F3`
   (`2a0ef9ef`); W2.9's substance partly shipped as `1c1322b7` ("rate/board: one shared server shell")
   without creating `cli/lib/review-server.mjs`. A reader scanning `git log` sees the topics
   addressed and concludes the wave ran. It did not.

**WHY MISSED:** W0 and W1 were dispatched as the `wave-*` branches (`wave-gates`, `wave-taste`,
`wave-vary`, `wave-analysis`, `wave-cli-verify`) — all five merged and now sit at 0 commits ahead of
main. There is no `wave-w2` branch. The dispatch simply stopped after W1, and because 130 was never
filed as roadmap rows (§1.1), nothing recorded that it had.

**UNBLOCKS:** 130's own §"sequencing" notes say W2.5's decomposition "must run when no parallel
streams are open" — the window for it narrows every time another feature branch opens, so this gets
*more* expensive with delay, not less.

**STILL VALID?** Yes, but this is explicitly the item most deserving a deliberate *"no"*. See §3.

---

## 3. Dropped, and should STAY dropped

*(pending)*

---

## 4. Unresolved contradictions needing an owner ruling

### 4.1 `PRODUCED_RANGES` still encodes the width/air doctrine that 133 measured as obsolete

**The contradiction.** `docs/research/115-production-layer-techniques.md` §1/§6 established that
stereo width was "the single largest measured deficit, and it is the cheapest to close," and ordered
the format additions "width first, air second." That doctrine is compiled into shipped code:

```
src/analysis/trick.ts:581  export const PRODUCED_RANGES = {
                     582    stereoWidthDb: { lo: -25, hi: -8 },
                     583    bandAirPct:    { lo: 1.0, hi: 2.5 },
                     ...
                     588  const AXIS_PRIORITY = { width: 0, air: 1, motion: 2, glue: 3 }
```

`docs/research/133-production-chain-depth.md` §1 then measured the opposite, **today**:

> "The width and air doctrine is partly obsolete against pack loops — measured this pass. Pack
> basslines are *dead mono* (median stereoWidthDb **-45.5 dB**, correlation 1.00) with **zero**
> air-band energy, and still win ~87% pairwise. Meanwhile engineplus clips already sit at width
> **-10 to -15 dB** — inside the pack range... The width gap the tricks catalog was built around is
> **closed**."

And it names the live consequence explicitly:

> "`PRODUCED_RANGES.bandAirPct {lo:1.0}` and `stereoWidthDb {lo:-25}` treat full-mix numbers as
> per-role targets and will mis-rank suggestions against pack refs (e.g. air-shelf fires on a chords
> track whose ref class ships 0.00% air; nothing fires on the missing bass...)."

**Verified unfixed** this pass: the constants are unchanged on `origin/main`, and
`gapBelowRange`'s own comment still cites the refuted authority — *"The width and air gaps are the
measured showdown ordering (115 §6) — width first."*

**Why this needs the owner, not a patch.** 133 says *demote, not remove* ("chords/lead width
(-3/-8 targets) still wants the existing width stack, and drum-loops carry the only real air
(1.1%)"). Correcting this means replacing one global range table with a **per-role** table, and the
per-role numbers 133 measured were derived from the pack pool — whose composition is itself
questionable (§5.4). That is a taste call about what the target *is*, not a mechanical retune.

**Cost once ruled:** S — four constants plus an `AXIS_PRIORITY` reorder. **Unblocks:** `beat trick
--suggest` ranking that points at the two gaps 133 actually measured (spectral occupancy, transient
life) instead of the one it closed.

---

## 5. The scattered small stuff nobody collected

### 5.1 `D20` is cited by six source files and does not exist

`docs/decisions.md` jumps D19 → D21. But `D20` is cited as though it were there, from code:

```
cli/beat.mjs:131       "…detection (pure TS, no Python — decisions.md D20)"
cli/beat.mjs:4622      "(decisions.md D20)."
src/analysis/pitch.ts:1  "…(docs/phase-40-plan.md §VA, decisions.md D20.)"
src/analysis/pitch.ts:5  "…per D20 it is pure TS with zero deps…"
src/analysis/index.ts:185 "…no Python (decisions.md D20)."
src/mcp/server.ts:97     "Pure TS, no Python (decisions.md D20)."
test/sidecars-installed.owner.ts:114
```

The decision's actual text lives in `docs/phase-40-plan.md:220` — *"D20 — pitch detection is pure TS,
not a third Python sidecar."* It was made, written into a phase plan, and never promoted into the
decisions log. Six files send a reader to a document that doesn't contain the thing.
**Fix: copy the D20 paragraph from `phase-40-plan.md:220` into `decisions.md` between D19 and D21.
One paste.**

### 5.2 `D23` is two different decisions under one number

- `decisions.md:47` — **D23** "offline renders build on a raw NATIVE OfflineAudioContext" (2026-07-17)
- `decisions.md:149` — **D23** "GPL synths may run as out-of-process sound factories" (2026-07-22)

Both are actively cited, under the same number, meaning different things:

| Cites the *offline-render* D23 | Cites the *GPL/surge* D23 |
|---|---|
| `ROADMAP.md:227`, `docs/architecture.md:62,93`, `docs/taste-loop-design.md:183`, `docs/product-roadmap.md:349,351`, `.claude/skills/dotbeat/SKILL.md:128`, `…/references/render-metrics-loop.md:72,93`, `…/references/mistakes.md:56,63` | `docs/surge-track.md:7,78`, `docs/format-spec.md:943,947,971`, `docs/product-roadmap.md:508`, `docs/research/136:325`, `docs/research/137:33` |

**Fix: renumber the newer (GPL/surge, 2026-07-22) entry to D30** — it has 7 citations to the offline
one's 11, and D30 is free. Then fix those 7 references.

**Also, while in the file:** the offline-render D23 is out of chronological order in a log whose own
header says *"Newest at top."* Dated 2026-07-17, it sits at line 47 — above D27 (07-22), D26 (07-22),
D25 (07-22) and D24 (07-22). Moving it below D21 restores the invariant.

### 5.3 Research doc `103` is also duplicated — the identical pathology

```
docs/research/103-generative-audio-apis.md
docs/research/103-usability-pilot-lane-taste-loop.md
```

Otherwise `01`-`138` is gap-free (139 is simply unwritten). But the collision has already produced
ambiguous citations: `docs/phase-37-plan.md:29` points at the glob `docs/research/103-*.md`, which
now matches both files, and `docs/phase-35-plan.md:162` says "research/103+". The roadmap disambiguates
correctly (3 rows cite the API doc, 1 cites the pilot) but only because someone wrote full filenames.

Worth naming the shared cause: **two independent numbering systems have now collided in the same way,
both from parallel sessions allocating a number without checking.** A one-line pre-commit check
(`ls docs/research/*.md | grep -oE '^[0-9]+' | uniq -d`) closes both.

### 5.4 A 34-second FX sweep is filed as a drum-loop reference — and it is not the only outlier

`taste-dataset/refs-packs/` is the D25 pack pool: *the eval's quality bar.* Measuring every file's
duration against its own pool's median:

| Pool | n | median | outliers |
|---|---|---|---|
| bassline | 32 | 7.74s | — |
| chords | 49 | 7.62s | `TA_USC_DISCO_STAB_JAZZY_F` 1.25s · `VOX_MDTH_130_lead_synth_saxy_Gmin` 1.85s · `FO4_CTH_126_kit_sinewave_pad_Dbmin7` 30.5s · `GUY_GERBER_chord_loop_evolver` 40.0s · `GUY_GERBER_chord_loop_chordy` 46.0s · `GUY_GERBER_synth_melody_progression_floating_plucks` **96.0s** |
| drum-loop | 25 | 5.90s | **`008_TG_-_Zenhiser_FX.wav` 34.0s** |
| lead | 59 | 7.68s | `dt_syn124_gate_Dm` 1.94s · `BOS_DH_123_Synth_Arp_Loop_Rune_Am` 31.2s |

The clearest misfile is `refs-packs/drum-loop/008_TG_-_Zenhiser_FX.wav` — 34 seconds, named `_FX`,
sitting in a pool whose other 24 members median 5.9s. A 96-second "melody progression" in `chords`
is the same category of error. Separately, several files are misfiled by **role** rather than length:
`refs-packs/bassline/` holds `91V_SBH_128_synth_lead_duck_wobs_D#m` and three `synth_arp_*` files;
`refs-packs/chords/` holds six `VOX_MDTH_130_lead_synth_*` files.

**Why it matters, concretely:** 133's per-role target numbers (§4.1) were computed *from these pools*.
A 34s FX sweep and a 96s progression in a role's median move that role's targets. **Cost: S** — one
listen-and-sort pass over 165 files, or a duration+role screen at ingestion. **Do it before acting on
133's numbers, not after.**

### 5.5 `decisions.md` D25 still says the training-exclusion is "not yet implemented" — it is

D25 (`decisions.md:130-133`) carries the standing licensing constraint:

> "(1) Splice ToU prohibits AI-training use → pack-pool variants must be EXCLUDED from critic
> training pairs before pack refs enter rated batches (rateable, never trained on — **not yet
> implemented, required before ingestion**)"

It **is** implemented, and well: `src/taste/eval.ts:34-128` defines `trainingExcluded` with a
deliberately conservative **three-tier** holdout (logged list → manifest via
`trainingExcludedFiles()` in `src/vary/batch.ts` → "no manifest, no logged list: any ref variant is
unattributable, so it is excluded"), with the reasoning stated in-code — *"Worst case it withholds a
training pair it could legally have used; the other direction is a licence violation baked into a
model."* Landed in `ea1de24d` and `09339cb4` (H3).

This is the *good* kind of correction, but the stale text is not harmless: it is the sentence
someone reads before deciding whether pack refs may enter a rated batch. **Fix: one sentence.**

### 5.6 `docs/research/README.md` indexes 13 of 139 docs

It links `01`-`09` and `21`-`24`. Nothing else — including the entire `114`-`138` program. This
matters slightly more than a stale index normally would, because `decisions.md`'s own header points
at it as the authority on claim verification: *"all research citations below now point at fully
adversarially-verified claims (four passes...) — see `research/README.md`."* That guarantee, read
literally, covers only the 01-09 era.

### 5.7 One-line path rot

- `docs/research/118-production-bag-of-tricks.md:276` cites `parseTrickLibrary` in **`src/core/trick.ts`**.
  It shipped at **`src/analysis/trick.ts`**. One-word fix.

*(Note: several other non-existent paths cited in 130/136 — `src/ops/`, `src/infra/`,
`cli/lib/args.mjs`, `python/_sidecar.py`, `src/core/error.ts`, `src/taste/showdown/batch.ts`,
`src/metrics/normalize.ts` — are **not** rot. They are the modules those docs proposed and nobody
built. They are counted in §2.1, not here.)*

### 5.8 Test-skip reasons are named but not enumerated anywhere

CLAUDE.md's guardrail: *"Only explicitly env-gated dependencies (venvs, surgepy, network) may skip,
each with a named reason."* The reasons are named at every call site, and there are only six distinct
ones across the suite:

| count | reason |
|---|---|
| 33 | `'no python3'` |
| 5 | `SETUP_HINT` (`test/sidecars-installed.owner.ts`) |
| 5 | `` `no python3 for the stub sidecar here: ${err}` `` |
| 3 | `'beatthis installed — degrade path not exercisable here'` |
| 2 | `'stableaudio installed — degrade path not exercisable here'` |
| 1 | `'running as root (or on a permissionless filesystem)…'` |

This pass measured 8 actual skips out of 1481 tests. The guardrail is being honoured. What is missing
is the *roll-up* — no single place says "these six reasons are the complete sanctioned set," so a
seventh reason can be added without anyone noticing it is new. **Fix: a `test/skip-reasons.test.ts`
that greps the suite for `t.skip(` and asserts the reason set equals a committed list**, which is
exactly the shape of gate W0.1 already established for goldens. **Cost: S.**

### 5.9 `layered-arm` is an in-flight worktree that has produced nothing

`git worktree list` shows `.claude/worktrees/layered-arm` checked out at `37ef4ff5` — byte-identical
to `origin/main`. There is no `origin/layered-arm` (`git ls-remote --heads origin layered-arm` is
empty) and `git log main..layered-arm` is empty. It is carried as active work; it has zero commits.
Compare the branches that *are* live: `fix-core-validation` (+7), `fix-sidecar-lifecycle` (+2),
`preset-retarget` (+1).

Also worth noting while in here: `origin/claude/synthesis-learning-sections-k4jtqh` sits **+58
commits** ahead of main and was last touched **2026-07-11** — fifteen days stale, and easily the
largest orphaned branch in the repo. Someone should decide whether it merges or dies.

---

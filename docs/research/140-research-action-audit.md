# 140 — Research action audit: what was recommended vs. what shipped

**Question (owner, 2026-07-26):** "can you make sure we're acting on everything in the research? Go
through it again and see there's more it recommends that you think we should do."

**Method.** Every recommendation in `docs/research/114-139` read in full, plus a targeted pass over
`80-113`. Each classified against four sources of ground truth: the code itself (grep/read, not
vibes), `scripts/roadmap-data.mjs` (the tracking system of record), `docs/decisions.md` (D1-D29 — a
recommendation contradicted by a numbered decision is CLOSED, not pending), and `git log --all`
across 16 remote branches. **Every item on the ranked list in §2 was re-verified in code by the
coordinator**, not taken on a reader's word.

**Baseline verified this pass:** `npm run build` clean; `npm test` = 1481 tests, 1473 pass, 0 fail,
8 skipped (all env-gated). `main`, `layered-arm`, `preset-retarget` all synced with origin.

> **A note on fairness, stated up front.** Nine docs in scope (131-139) were committed **today**.
> Calling a recommendation "dropped" hours after it was written is crying wolf, and an audit that
> inflates its own findings is worthless. Those are counted separately as **UNTRIAGED**. Where one
> appears on the ranked list anyway, it is because the recommendation contradicts code that is
> *already shipped and running* — which makes it actionable today regardless of the doc's age.

---

## 1. Headline counts

Across **114-130** — the mature program, written 2026-07-21 to 07-25, all with a real window in
which to be actioned — roughly **200 discrete recommendations**:

| Class | Count | Share |
|---|---|---|
| **SHIPPED** (code cited) | ~77 | 38% |
| **DROPPED** (nobody acted, nobody tracked, still valid) | ~99 | 49% |
| **TRACKED** (a roadmap row exists) | ~15 | 7% |
| **SUPERSEDED** (a later doc or decision overrode it) | ~6 | 3% |
| **IN FLIGHT** (unmerged branch) | ~7 | 3% |

Across **131-139** (all written today): ~160 recommendations, **9 in flight** on `layered-arm` and
`preset-retarget`, **0 tracked**, 1 partially superseded, the rest untriaged.

Two readings of the 38% ship rate, and both are true.

**The generous one:** the *headline* item of almost every doc shipped, and shipped well — Surge as a
sound factory (114), produced defaults (115, measured 3%→29% blind pairwise), the trick catalog
(118), `beat prodtask transform` (119), the `produce-song` skill (121→D28), the pathology screens
(122), the theory composition layer (124, implemented nearly line-for-line against a 17-item spec),
the CA2 sidecar (125), `beat board` + the session protocol (128→D29), 130's entire W0/W1 program,
and D25's training-exclusion holdout (which was then *hardened beyond what the doc asked for* after
H3 found the first version silently unsound). This project executes the top of a list well.

**The critical one: it executes only the top.** The dropped items are overwhelmingly positions
2-through-N of lists whose position 1 shipped, and the pattern is consistent enough to be structural.

### 1.1 The tracking system stopped receiving rows exactly when the current wave started

Counting roadmap rows citing each research doc:

| Research docs | Cited by ≥1 roadmap row | Cited by ZERO rows |
|---|---|---|
| 80-113 (pilots + early program) | 29 of 34 | 5 (`84`, `92`, `106`, `110`, `112`) |
| 114-129 (current program, first half) | 13 of 16 | 3 (`120`, `125`, `126`) |
| **130-139 (current program, second half)** | **0 of 10** | **ALL TEN** |

Nor are they tracked under another name: `cockpit`, `SurgePanel`, `session drawer`, `free win`,
`rolecheck`, `match-to-owned`, `knowledge layer`, `ops layer`, `quality gap`, `composite arm`,
`packplus` and `flywheel` all return **0 hits** anywhere in `roadmap-data.mjs`, descriptions included.

The last substantive commit to `roadmap-data.mjs` is `3e5eb18e` (2026-07-25). Doc 130 landed the
same day and was not filed; 131-139 landed the next day and were not filed.

**This is not sloppiness in the tracking file — the roadmap is well maintained where anyone
bothers.** The backlog row `Candidate / critic "option-board" surface` carries a dated
`UPDATE 2026-07-25:` note partitioning which of its four sub-items shipped and which remain. Someone
was doing this properly the day before yesterday. The habit stopped; the research did not.

Two caveats that keep the number honest. Zero citations is a *weak* signal in the 80-113 range —
`106`, `110` and `112` were all fixed in-cycle and simply never filed, so the filing slipped where
the fixing didn't. And the roadmap cites docs two ways (the structured `research:` field and bare
`research/NN` in prose), so a filename grep undercounts. **Standardizing on the structured field is
a one-pass cleanup that makes this metric trustworthy in future.**

### 1.2 The shape of the failure: lists get their heads eaten

Eight independent instances, each verified in code:

- **118** shipped a 15-trick catalog against a 22-trick v1 spec. The 7 missing are *all* motion
  tricks — the axis the doc was commissioned to close.
- **115 P1** (produced width defaults) shipped; P2's three named gen-kit changes and P3's entire
  motion half did not, while P3's sidechain half did.
- **116** shipped the edit log (§4.1) and dropped §4.2 (proposal outcomes) and §4.3 (the feature that
  consumes them) — a three-link chain built at link one.
- **121 §3.7** items #1/#2 became D28; the sample-index pillar (§3.5) did not.
- **130** shipped W0 (9/9) and W1 (4/5) and never scheduled W2 (0/10) or W3 (0/5).
- **117** shipped seven of eight Part-4 safeguards. The one that didn't is the one the doc said to do
  **first**.
- **127** shipped every adapter, the trim, the provenance and the resumable harness — and never ran
  the experiment they exist for.
- **138** (today) had free wins 1-7 picked up *only inside the unmerged prototype for its most
  expensive rung*, while rungs 0-3 — the cheap, one-variable arms the ladder was designed around —
  went untouched. **The ladder was climbed from the top.**

The mechanism is visible in the branch names: work is dispatched as `wave-*`/`fix-*` streams scoped
to a doc's headline, and a stream's definition of done is its own headline, not the doc's tail. The
tail has no home, because the tail was never filed as rows (§1.1).

---

## 2. THE DROPPED LIST

Ranked by expected value × cheapness. Each verified in code this pass.

---

### D1. A surge project almost certainly crashes the GUI arrangement view

**Source:** 137 §2.3/§6. **Cost: XS** for the guard, **S** for the fix. **Unblocks:** opening any
surge-containing song in the GUI at all.

Core and the GUI disagree about how many track kinds exist:

```
src/core/document.ts:14    TrackKind = 'synth'|'drums'|'instrument'|'audio'|'surge'
src/core/document.ts:1279  TRACK_KINDS = [...5 kinds...]
ui/src/types.ts:92         TrackKind = 'synth'|'drums'|'instrument'|'audio'      ← no surge
```

`ArrangementView.tsx:289` builds `AUTO_OPTIONS_BY_KIND` as a `Record<TrackKind, …>` with exactly
those four keys, then indexes it **unguarded at four sites** — `:2005`, `:2710`, `:3229`, `:3280`.
`AUTO_OPTIONS_BY_KIND['surge']` is `undefined`, and `:2005` immediately calls `.map()` on it. That is
a TypeError on the arrangement render path. `examples/surge-pilot` is a shipped two-track surge
project.

This is worth putting first for three reasons. It is a **user-facing hard failure on a shipped
path**, not a quality gap. It is **the cheapest fix in the audit** — one `?? []`. And it is
**136 §3's thesis in miniature**: `ui/src/types.ts` re-declares 422 lines of document types instead
of importing them, and the re-declaration has drifted behind core by a whole track kind. Two docs
written the same night describe the same bug from opposite ends and neither cross-references the
other.

*(137 flagged this as "read, not run — a two-minute runtime check before scheduling the fix." The
two minutes were never spent; the type-level drift above is certain from the code, the runtime
confirmation is still owed.)*

### D2. Edit telemetry is still opt-in and off — the only item that destroys data every day it slips

**Source:** 137 §4.1/§6 item 1, resting on 116 §4.1 and 128 §2.4. **Cost: S** — a flag in a launch
line plus a paragraph. **Unblocks:** the entire Part-4 flywheel.

`src/telemetry/edit-log.ts` shipped and is good. Nothing turns it on: `cli/beat.mjs:1072` still
documents `--edit-log` as opt-in and the desktop sidecar's spawn args don't pass it. 137's framing is
the point — *"retrofitting loses those sessions forever."*

**Every toy-run or owner session that happens before this lands is permanently unrecoverable.** It is
the only item in this audit with a deadline shape. Ship it with the decisions.md entry that 116
§Honest-gaps and 128 §2.4 *both* required and neither got (§5.9).

### D3. `PRODUCED_RANGES` still encodes the width/air doctrine that 133 measured as dead

**Source:** 133 §1/§7-A.1, seconded by 131 §6. **Cost: S** (four constants + one reorder), gated on
one ruling (§4.1). **Unblocks:** `beat trick --suggest` pointing at a real gap.

`src/analysis/trick.ts:581-588` unchanged: `stereoWidthDb {lo:-25}`, `bandAirPct {lo:1.0}`,
`AXIS_PRIORITY = { width: 0, air: 1, … }` — and `gapBelowRange`'s comment still cites the refuted
authority: *"the measured showdown ordering (115 §6) — width first."*

133 measured pack basslines at **-45.5 dB** width / **0.00%** air winning ~87% pairwise, engineplus
already inside the pack width range, and named the live consequence: *"an air-shelf fires on a chords
track whose ref class ships 0.00% air; nothing fires on the missing bass octave."* **The suggestion
engine has been steering toward a closed gap for a week.**

### D4. The ref pool has misfiled loops — and every recent measurement is calibrated against it

**Source:** 133 §7-A.4 / 138 row 14. **Cost: XS** — it is an `mv`. **Unblocks:** trustworthy per-role
targets, i.e. the numbers D3's ruling depends on.

133 found *one* misfiled loop in `refs-packs/`. Nobody moved it, and there are more:

| Pool | Role misfiles |
|---|---|
| `lead/` | `GUY_GERBER_drum_loop_synth_kit_02_120.wav`, `..._03_120.wav`, **`GUY_GERBER_snare_loop_synthetic_longer_decay_120.wav`** |
| `chords/` | 7 files named `lead_synth_*` / `synth_melody_progression_*` |
| `bassline/` | 4 files named `synth_arp_*` / `synth_lead_*` |

Plus nine **duration outliers** against each pool's own median (bassline 7.74s, chords 7.62s,
drum-loop 5.90s, lead 7.68s) — including a **96-second** "melody progression" in `chords/` and a
**34-second** file named `008_TG_-_Zenhiser_FX.wav` sitting in `drum-loop/`.

133's per-role targets were computed *from these pools at n=20 per role*. **Do this before acting on
133's numbers, not after.** It lives outside the repo in the private dataset dir, which is exactly
why every worktree agent missed it and nobody escalated it.

### D5. The board's most-praised affordance has a consumer and no producer

**Source:** 137 §6 item 1. **Cost: S.** **Unblocks:** in-context auditioning on every board.

`cli/board.mjs:56-59,101` define the `.context.wav` convention and gate the solo/in-context toggle on
the file existing. Grepping `src/`, `cli/`, `scripts/` for anything that *writes* one returns **only
that reader**. The roadmap row describes the toggle as shipped. **It can never appear.**

A producer/consumer split across two work packages, with no test that fails when the toggle silently
doesn't render — and 128's survey named in-context audition the single most-praised pattern it found.

### D6. The Surge tempo bug: every surge clip ever rated rendered at 120 BPM

**Source:** 132 §2.3 / 138 row 10. **Cost: S** for the pybind binding, **XS** for the interim screen.
**Unblocks:** the Sequences patch category, every synced-LFO/delay patch, and 138's rung 4 entirely.

`grep -ci "tempo\|bpm\|time_data" python/surge_render.py` → **0**. The sidecar never sets a host
tempo, so every tempo-synced modulation rendered at Surge's 120 BPM default regardless of batch
tempo. 131 §6 independently measured the fingerprint without knowing the cause: **surge chords fire
1.3 onsets/s against a reference 4.9.**

132 also specified an **interim mitigation** — screen out tempo-synced patches — which is pure TS and
also wasn't done. **Neither the fix nor the mitigation exists, and this silently qualifies every
surge rating in the log.** Worth an owner-visible caveat on the scoreboard independent of the fix.

### D7. Split the showdown report by `figureSource` — the theory and CA2 builds have no readout

**Source:** 124 §B.7/§C.7 and 125 §4 — both docs' central validation experiment. **Cost: S** — copy
`refPoolTally`. **Unblocks:** the entire point of two substantial shipped builds.

`figureSource` is written into the batch manifest and copied into the scores-log entry
(`showdown.ts:1094-1116`), but `computeShowdownReport` (`:1510`) tallies **overall / by role / by
ref-pool** and nothing else.

So the theory layer (1,294 lines) and the CA2 sidecar (a 716 MB out-of-repo model, a Python sidecar,
guards, tests, a doctor) both shipped **specifically to be measured by an experiment whose readout
does not exist.** dotbeat has paid CA2's full integration cost and has zero evidence about whether it
beats the free archetype bank. `refPoolTally` at `:1483` is the exact pattern to copy.

**Why missed:** `figureSource` was built as *provenance* (D25 hygiene — the shared log records only
the kind), and the privacy framing masked that it is also the experimental factor.

### D8. The taste import-boundary test — 136's own top pick, still four import edits away

**Source:** 136 §4, verbatim *"the highest leverage-per-risk item in this review."* **Cost: S.**
**Unblocks:** an acyclic module graph, as a side effect of a ~20-line test.

The rule: *"The DAW may not import the taste program."* The enforcement 136 specced: a grep-shaped
import-boundary test, exactly like the existing verify-manifest test, asserting
`src/{core,metrics,analysis,vary,daemon,mcp}` and `ui/` never import `src/taste`. It does not exist,
and all four violations are live: `analysis/genkit.ts:21,22`, `analysis/surge.ts:14`,
`analysis/trick.ts:40`, `vary/batch.ts → taste/features`.

Three of the four fixes are XS one-liners (§5.10). **That the review's own #1 pick lost anyway says
prioritization here isn't reading the docs' rankings at all** — which is the meta-finding this whole
audit exists to surface.

### D9. The role-true width map — and the guardrail that is blocking four cheap fixes

**Source:** 131 §7-P5, 133 §1, 135 §A.2, 138 row 6 (four docs, same numbers). **Cost: S.**
**Unblocks:** ~16% of the measured margin in the core ref-vs-engineplus matchup, at zero DSP risk.

`showdown.ts:219-239` returns `role: 'default'` with one `unison {voices:5, width:0.6}` for every
synth role. 131 measured the correct map (bass ≤-40 dB, chords ≈-5, lead ≈-5…-8, drums ≈-13), called
the lever *"trivial"*, and noted the frozen constant is *"measurably wrong in BOTH directions."*

**This is the most important diagnosis in the audit.** The frozen-constants rule (CLAUDE.md, from
130) correctly forbids *editing* `engineplusProfile` — and explicitly invites writing a **new named
profile alongside**. Nobody took that step, here or in the three sibling cases (132 fix-list 4,
133's `packplusProfile`, 134's curation blend). **A guardrail written to prevent one failure is now,
by misreading, preventing four cheap fixes.** See §4.3 — one sentence unblocks all of them.

### D10. Four new tricks: pure JSON against the two biggest measured gaps

**Source:** 133 §7-A.2. **Cost: S each** — a declarative grammar with an existing test harness and
exact values already specified. **Unblocks:** the occupancy gap (mids 99% → ≤90) and
density-without-crest-loss, with **zero engine work**.

`presets/tricks.json` holds exactly 15 tricks. None of `octave-body`, `ny-glue`, `ghost-kick-pump`,
`stab-articulation` are among them; two are literal four-line recipes.

Corroborating: `compMix` — the comp insert's true dry/wet fan — is set by **no production profile
anywhere**; it ships at 0, exactly as 133 §4 reported. And `ghost-kick-pump` was independently
requested by 118 (as `sidechain-pump`), 133, and 138 §row 9 (*"never used; duck reads kick hits, not
audio, so this works today"*). **Three separate research passes have asked for the same trick.**

### D11. `beat_trick` is advertised to the model and does not exist

**Source:** 118 §3.3. **Cost: S.** **Unblocks:** MCP-driven agent sessions; closes an active lie in
the tool surface.

`src/mcp/server.ts:375` — `beat_produce`'s description tells the model *"Composes with beat_trick (a
named single move)."* Tool definitions named `beat_trick`: **zero**. `test/mcp-parity.test.ts` has no
trick row. This is also a CLAUDE.md guardrail violation in substance ("parity is structural, never
disciplinary") on a command family that shipped *after* the guardrail was written.

Its sibling: `src/core/inspect.ts` and `src/mcp/server.ts` both contain **zero** occurrences of
`surge` — an agent cannot read back what a surge track is set to (137 §2.1).

### D12. Log the ref pool name in the scores log, the way `figureSource` already is

**Source:** 120 §4, verbatim. **Cost: S** — one string field. **Unblocks:** durable pool splits.

`showdown.ts:1465` — *"the pool split is computed at report time from the batch dir's own
manifest"* — and `refPoolTally` skips any entry whose manifest is gone. **Deleting batch dirs is the
documented lifecycle**, so every showdown report's pool breakdown silently under-counts.

Painful because it was nearly caught: finding **H3** (`ea1de24d`, `09339cb4`) fixed precisely this
failure mode for the sibling field `trainingExcluded` in the same file, and the pool label did not
get the same treatment. `src/vary/batch.ts:694` even says out loud *"nothing on disk records which
pool a deleted batch's ref came from."* It leaks nothing new — the pool label is one of five enum
values.

### D13. `produce-song/SKILL.md` tells agents that shipped features may not exist

**Source:** 137 §6 item 1 / §5.2. **Cost: XS.** **Unblocks:** correct agent behaviour on the skill
that D28 makes mandatory.

`SKILL.md:94`, `:167`, `:202` all still say features are *"being built on a sibling branch — check
`beat help`"* with dead manual fallbacks, for `beat board` and `beat diff --since/--rollup` — both of
which shipped (`5cd20ccb`, `df1f3148`). The `audit-honesty` branch un-rotted the *dotbeat* skill and
never touched this one.

Bundle with two more XS skill items: make the cold-start ritual a literal numbered list (137 §5.2),
and move `PREFERENCES.md` from per-song `workshop/` to `~/Documents/dotbeat/` — 137's argument being
that the evidence spans songs, so a per-song home structurally cannot accumulate the ≥2-songs floor
the preference lifecycle needs. Leaving it costs nothing today and quietly makes the flywheel
unbuildable later.

### D14. The plugin-host probe — one afternoon that plausibly buys a whole timbre tier

**Source:** 132 §5 rank 3. **Cost: S** (`pip install pedalboard` into the existing venv + one
render). **Unblocks:** five preset ecosystems at ~zero marginal cost each.

`grep -rli "pedalboard\|dawdreamer\|sfizz" src/ python/ cli/ scripts/` → **nothing**. 132 called it
*"one probe that gates five sources"* (Dexed, OB-Xf, Vaporizer2, Six Sines, Odin 2). OB-Xf alone
ships ~300 professionally-designed presets aimed at the chords role — currently the worst on the
board at 11% pairwise.

**Why missed:** it is the highest expected-value-per-hour item in 132 and was ranked *third*, below
two arms nobody built either, so it inherited their queue position. It depends on nothing.

### D15. Run the gen-backend bake-off, or explicitly kill it

**Source:** 127 §4.1/§4.3/§4.4. **Cost:** ~$11 for the 10-loop screen, plus ~8 batches of listening.

Adapters, round-robin harness, downbeat trim, watermark/training-holdout provenance — all shipped,
and the harness is resumable so a paid clip is never re-spent. **The experiment never ran.** No
results file, no doc reports a round, and research 138 — today's synthesis answering the owner's live
"generate clips as good as Splice" directive — **does not mention Lyria, MiniMax, or ElevenLabs
once.**

**Why missed, and it is the sharpest process finding here:** the roadmap row is `status: 'done'` and
its description conflates *building the adapters* with *running the bake-off*, even restating the
verdict rule as if settled. **A `done` row is why nobody looked again.** Split it.

### D16. Rung 0 / B0: the critic upgrade that 138 said to ship first

**Source:** 138 §3-B0 and §4-rung-0; 131 §7-P0. **Cost: M**, and **zero owner time** by the doc's own
framing. **Unblocks:** literally everything below it. Needs a ruling first (§4.4).

131 measured an **append-only** `FEATURE_KEYS` extension at 0.676 → 0.795 held-out (0.688 → 0.776
synth-only). 138 calls it the gate on the whole build list: *"EVERY screen, curation pass, rolecheck
and future automated search"* depends on it, and *"nothing else in the ladder is interpretable
without this."*

`src/taste/features.ts:25-39` is still the 13 keys. The DSP half exists — `preset-retarget` computes
all 26 axes in `src/retarget/features.ts` — but the commit message **explicitly refuses** the ask:
*"Deliberately NOT an edit to src/taste/features.ts: FEATURE_KEYS is a frozen critic training
vector."* Nothing retrains the ranker; the pre-registered grouped-10-fold validation never ran.

Worse, the fork now has a measurement hazard: `targets.ts` documents its flux running *"~4-5× higher"*
and `attackMedMs` *"~2× slower"* than 131's pipeline. **Two feature extractors whose units disagree
is a hazard that compounds every day it persists.**

### D17. The cheap rungs of 138's ladder were skipped for the expensive one

**Source:** 138 §4 rungs 1-3. **Cost: S** for rung 1 (config-only by design). **Unblocks:** the
nearest plausible D27 event.

`bass2` (rows 1+2+5 only), `punch2` (rows 3+4+6+7+8), and the crafted checklist arm do not exist —
no new `ShowdownSourceKind`, no batches. Meanwhile `layered-arm`'s 979-line `src/taste/layered.ts`
implements free wins 1-7 *inside a four-layer architecture* — which is the exact opposite of the
one-variable discipline rung 1 was designed for.

**This is the ladder inversion, and it matters beyond scheduling: a layered arm that wins tells you
nothing about which of its eight simultaneous changes did the work.** Rung 1 is the cheapest test of
the biggest per-role effect (bassline is 17-4 in engineplus's wins), and it is now *more* valuable,
not less. Related: 138's **design rule** — *"every arm's clips pass their feature gates BEFORE
entering a batch (never spend owner ratings on a clip that missed its own targets)"* — also does not
exist, and owner rating time is the program's scarcest resource.

### D18. The bass-grind detector — the founding complaint has no standing check

**Source:** 121 §3.7 #3. **Cost: S** — all three inputs are already in `MixMetrics`. **Unblocks:** an
*absolute* grind signal.

`grep -rn "bass-grind"` hits **only** `.claude/skills/produce-song/SKILL.md` — the three-clause
composite is an instruction to the agent, not a check in `lint`/`feedback`. Research 123 found a
better *general* answer (MoSQITo DW roughness) and it displaced the specific one — but the roughness
ear is **pair-relative by construction**, so it cannot answer "is this stem pathological on its own,"
which is exactly what the owner's original complaint was. 122 §4.1's cheap complement (per-band
spectral flatness / bass-band HNR, *"~50 lines against the existing FFT"*) is also absent.

### D19. `duckRelease` — one `SYNTH_FIELDS` number, flagged by three docs, filed nowhere

**Source:** 115 §4.2, 133 §7-B.3, 138 §B6. **Cost: S** — one field, default 0.16, byte-compatible.
**Unblocks:** the 250-350 ms deep-house pump the hardcoded 160 ms ramp cannot make; also unblocks the
`sidechain-pump` trick the catalog lists as format-blocked.

`grep -rn duckRelease src/ ui/src/` → **zero hits**. Too small to be anyone's stream, too
engine-adjacent to be anyone's trick, and mis-filed into 138's *last* tier.

### D20. Seed the drum-kit noise sources so `--offline` renders reproduce

**Source:** pilot 109 (HIGH finding). **Cost: M.** **Unblocks:** the taste program's own caching
assumptions.

`ui/src/audio/engine.ts` builds snare/clap as unseeded `Tone.NoiseSynth` (`:2197,:2206,:2228`) and
hat/openhat as `Tone.MetalSynth`; the one seeded stream (`makeNoiseStream`, `:1312`) serves only
`vinylDistortion`. **The pilot's HIGH finding was closed by making the help text honest, not by
fixing it** — while `beat help render`'s `--batch` block still calls offline *"both exact and fast."*

Stakes have risen: `src/taste/embeddings.ts` caches per-wav keyed on audio sha256, so identical
`.beat` files re-render to different hashes and any re-render of a rated batch is a different
artifact.

### D21. The curation screens reject 22% of the owner's own reference material

**Source:** 134 §5, 138 row 11. **Cost: S.** **Unblocks:** every future curation pass; it gates B3,
B5 and the 3rd-party enumeration.

`surgeCuration.ts:47` — `CURATION_GATES = { ringDbMax: -32, activeFractionMin: 0.5 }`, one global
role-blind value, pinned by an `===` test. 134 measured that this gate **fails 22% of the owner's own
Splice lead loops and 16% of chords** — *the screens reject the quality bar itself*.

It is worse than the doc says: `:53` `CURATION_BLEND = { aesQuality: 0.45, critic: 0.3, ringHeadroom:
0.15, active: 0.1 }`, so the pool isn't just gated wrong, it's **sorted** wrong (§4.2). And three
one-line siblings sit in the same pass: `curate-engine-presets.mjs:222` still `normalize: false`
(with a comment documenting the defect), `:97` still probes leads two octaves high at C5-C6, and
`lintFigure` is still missing 124's third MusPy stat, `emptyBeatRate`.

**Why missed:** it is a *loosening* of a safety screen, which is psychologically the hardest change
to make without a rating round to back it — and the `===` pin makes it *feel* frozen when it isn't
(§4.3).

### D22. Keymap root verification — a correctness bug, not an enhancement

**Source:** 132 §3. **Cost: S** — render one lane, re-run the existing pitch detector, refuse on
mismatch. **Unblocks:** trustworthy keymap ratings.

`src/core/keymap.ts` maps one root to one `tune`, clamped ±24 semitones, with nothing downstream
checking. 132: *"a wrong root makes the whole instrument systematically out of tune… nothing
downstream checks."* Keymap sits at 31-38% *despite* having the best bass-timbre match to refs of any
source (sub 45.3% vs ref 47.1%) — a profile consistent with a tuning defect.

### D23. Two pre-registered decision gates were designed and never fired

**Source:** 133 §7 (the `packplus` arm), 134 §4.3-M1 (the match ceiling run). **Cost:** M each.
**Unblocks:** the queue order of everything below them.

Both docs pre-registered a gate whose *outcome was supposed to re-order the build queue* — 133: *"if
packplus moves <10 points… the transient shaper + OTT jump the queue"*; 134-M1 prices whether the
engine's per-voice timbre ceiling sits below pack quality at all. **Neither ran. The queue is ordered
on untested inference, and `layered-arm` is being built without the answer M1 was designed to
provide.** Related: 138's own **global falsifier** ("if rungs 1-3 land their gates and pairwise moves
<10 points, the thesis is false") lives only in prose. The doc says stating it *"is what makes the
ladder an experiment rather than a ratchet."* Unrecorded pre-registrations are what ratchets are made
of. One decisions.md entry.

### D24. Send the m2m licensing email

**Source:** 126 §LICENSE CAUTION. **Cost: S — one email.** **Unblocks:** two measured, Mac-feasible
capabilities (`m2m_drummer`, note-F1 79.3 vs CA2's 20.3; `m2m_arranger`).

Doc 126 is the only doc in range with **no roadmap row and no repo footprint whatsoever** (`rg -i
"m2m|music2music"` → zero hits outside the doc). The models are unlicensed — all rights reserved by
default — so nothing could be built. But nobody emailed the authors, and nobody wrote down that
somebody should. The doc's own framing (*"establishes technical feasibility and musical fit, not
permission"*) made it easy to file as "done, blocked" rather than "one email away." See §4.8.

### D25-D32, the shorter ledger

| # | Item | Source | Cost | Verified absent |
|---|---|---|---|---|
| D25 | **W1.4** — `cli/lib/args.mjs` + help extraction; the only skipped item in an otherwise-complete wave. `UNKNOWN_FLAG_HOLES` is **still exactly 75 entries** — the ledger W0.2 built to shrink has not shrunk by one, while `cli/beat.mjs` grew to 6,140 lines | 130 | M | `cli/lib/` absent |
| D26 | **`beat rolecheck` + `presets/role-targets.json`** — a pre-batch pass/fail with named fixes. The hard part (mined, provenance-carrying per-role targets) already exists on `preset-retarget`; nobody owned the verb | 138 B2 | M | `rg rolecheck` → 0 matches in 1,963 files |
| D27 | **The motion half of produced defaults** — `produce.ts` has no `lfo*` write and no automation-lane write; the sidechain half shipped. 133: *"Automation as production → Mostly YES [capability exists]."* **100% built, 0% invoked by default** | 115 P3 | S | verified in file |
| D28 | **`beat trick verify`** — every `expect` clause in the catalog is unverified prose; the catalog asserts 15 metric deltas and asserts none | 118 §1.3 | M | `trick.ts:85` "not executed in v1" |
| D29 | **Proposal-outcome logging** — the ± reward half of the edit log. `beat board` covers *picking*; nothing covers *proposing* | 116 §4.2, 128 §2.4, 137 §4.2 | S-M | zero hits in `src/telemetry/` |
| D30 | **Bank every owner-flagged listening miss** into `listen-bench/` — both 122 §8 and 123 §6.1 call this *"the single most valuable asset"* in them. Zero references outside doc 123; the roughness thresholds are *"soft until n≥3 pairs"* and n is still 1. **Fix: one CLAUDE.md standing-practice paragraph** | 122, 123 | S | `rg listen-bench` |
| D31 | **The 8/16-bar phrase machinery** — correctly deferred by 124 until composition fed whole tracks; **D28 met that precondition on 2026-07-24 and nothing re-triggered it** | 124 §C.3 | M | `buildChordTrack` defaults `bars: 4` |
| D32 | **`GET /rollup`** — `src/core/rollup.ts` is already pure and IO-free, so the route is a passthrough; it unblocks both the session drawer and any agent readback | 137 §3.2 | S | `rg rollup ui/src/` → 0 files |

---

## 3. Dropped, and should STAY dropped

An audit that says "do everything" is useless. These are verified-absent and should remain so:

1. **Haas widening as a first-class primitive** (115 §2.1). Explicitly skipped, and 133 *re-validated
   the skip* against fresh sources. A rare "don't build this" that stuck.
2. **FMD / Fréchet Music Distance** (124 §B.2). The doc argues itself out of it: distribution metrics
   cannot score an individual piece, and dotbeat's loop is per-clip.
3. **The four Loopcloud / SKIO / Keinemusik / Black Octopus licensing questions** (120). Contingency
   research for paths not taken; Splice was chosen and the pool is full. Flagged so nobody re-opens.
4. **A pairwise render-matrix over the trick catalog** (118). Honestly deferred "until the catalog
   stabilizes"; with 15 tricks and hand-declared `counter` lists this is over-engineering.
5. **AMT as an infill helper** (125 §4). **Obsoleted by its own sibling, not neglected** — CA2
   measurably beats AMT on infill (1.0/1.0/1.0 vs 0.89/0.91/0.84) and is already integrated. Worth an
   explicit "closed, CA2 covers it" note so it stops reading as an open thread.
6. **Building toward the Cursor endgame** — online RL, fleet telemetry (116 §4.5). Correctly held;
   D13 closes it.
7. **MIDI-RWKV / LoRA personalization** (125 §3), **Lyria RealTime phase-2** (127 §4.3), **GPT-4o-audio
   / MOSS-Music / SongEval / RoEx** (122 §3.2-§4.5). All gated on results never measured; they are
   dependents of D15 and D30, not independent items. 123's evidence that hosted LLM critique is a bad
   bet transfers to most of them.
8. **`utilityMonoBelow`, the side-shelf EQ, the master block, the exciter** (115 P4/P5). All *tracked*
   as roadmap rows and all *demoted* by 133's measurements ("pack bass is simply mono, and bass
   profiles carry no width to guard"; melodic pack loops ship ~0% air). Correctly parked — do not
   promote. **Exception worth one row:** the exciter has *no* roadmap row at all while every sibling
   has one, so it will be re-proposed a fourth time. File the row, leave it not-started.
9. **136's ops layer (`defineOp`) and the daemon route collapse**, and **W2.x as a unit** (§6). Big,
   recent, and correctly sequenced behind cheaper things. But take 136's own S-sized pilot — the
   `vary` arg spec, whose body already landed in W1.3 — rather than nothing.
10. **137's board hot-swap, persistent surgepy worker, `beat session status`, Surge XT side-by-side**
    (§6 items 5-8) and **128's board v2 / preference→lint automation**. Every one is explicitly gated
    on toy-run evidence that does not exist. Correct as written.
11. **129's info-line ordering**, **107's T7 (paid listener validation)**, **102's chord-recognition /
    melody-transcription tier**. All self-deferred by their own docs with the lowest confidence
    ratings in them. Sequencing, not drops.

---

## 4. Unresolved contradictions needing an owner ruling

### 4.1 The width/air doctrine: 115 vs 131 + 133 — and it is live in shipped code

115 §6 established *"width first, air second"*, and the ordering is compiled into
`src/analysis/trick.ts` (§2 D3). 133 §1 measured the opposite as a headline; 131 §6 sharpened it
(*"width still discriminates synth-vs-synth 0.704 — it's a placement variable now, not a 'more is
better' one"*).

**Why nobody fixed it unilaterally:** overturning a shipped, tested, documented doctrine is not an
agent's call. So three docs disagree in tone about whether 115's P2/P5 primitives are dead or merely
deferred, and nothing arbitrates.

**The ruling is narrow and unblocks D3, D9, D10, D21 and `trick suggest` v2 at once:** *width and air
are per-role placement targets sourced from the pack pool; 115's global ordering is retired; 115's
P2/P5 primitives remain open but demoted.* One decisions.md entry — **after D4's pool cleanup**,
since 133's numbers were mined from the polluted pools.

### 4.2 The curation objective is 60% measured-suspect

`surgeCuration.ts:53` — `CURATION_BLEND = { aesQuality: 0.45, critic: 0.3, ringHeadroom: 0.15,
active: 0.1 }`, whose comment cites D26 as authority. Since then:

- **131 §2.1 measured `aesPQ` at P(win|hi) = 0.415** — it votes *against* the owner's own winners —
  and `aesCE` inverts on bassline. 131 §7 lists *"treating Audiobox PQ or CE as a target"* under
  **"Explicitly NOT on the path."** 138 §2 repeats the prohibition.
- **134 §5** independently found `ringHeadroom` *"double-rewards darkness."*

That is 0.60 of the blend measured-suspect, plus a `critic` term still running on the un-upgraded
13-key vector (§4.4). **Not a "later" item:** any patch pool generated before it is resolved inherits
the bias, which is exactly the trap 134 §7 warned about ("ship the gate recalibration *before*
generating the M2 pool"). 131's proposed replacement (aesPC + the §4 DSP discriminators) and 134's (a
role-target brightness/movement term) are compatible.

### 4.3 "Frozen eval constants" vs. screens — one sentence unblocks four items

CLAUDE.md's guardrail is right for `engineplusProfile`/`surgeplusProfile`: they pin treatments whose
effects were measured in historical blind ratings, and editing them invalidates every past comparison.

But `CURATION_GATES.ringDbMax`, `CURATION_BLEND`, `PRODUCED_RANGES` and the curation probe definitions
are **screens and rankers, not measured ablation constants** — changing them invalidates nothing
historical. The `===` pin in `test/surge-curation.test.ts:47` has made the ring gate *feel* frozen,
and that is a large part of why D3, D9, D10 and D21 all sat. **A one-line ruling drawing that
boundary is the highest-leverage sentence available.**

### 4.4 Is `FEATURE_KEYS` append-only-safe? — the blocker behind the whole ladder

131 §7-P0 specified an **append-only** extension with a measured payoff; 138 B0 says ship it first.
CLAUDE.md says frozen constants are never edited. Two agents have independently declined to resolve
the collision, and one forked instead (§2 D16).

**Ruling needed, three options:** (a) append to `FEATURE_KEYS` + retrain + re-baseline under a
**key-set snapshot test**; (b) a second frozen vector `CRITIC_KEYS_V2` alongside; (c) the critic stays
at 0.676 and `src/retarget` is the only consumer of the new axes.

Worth noting that 136 §5 named the exact hazard — *"new taste `FEATURE_KEY`: ~3 files and silently
changes the critic"* — and proposed the missing key-set snapshot as a `MetricDescriptor` registry.
**Two docs written the same night describe both halves of this blocker and neither cross-references
the other.** The missing snapshot is very likely *why* the retarget agent forked.

### 4.5 D26 names "parametric EQ first" as an unexploited lever. It shipped in Phase 23.

D26 (2026-07-22) sets the current strategic direction and lists four unexploited levers, one being
*"engine extensions per research/114's evidence order (parametric EQ first)."* But `eq7` is `done`
(Phase 23 Stream BD) and is already in the T6 match search space — as is 114's item 2, the wavetable
oscillator (Phase 26 Stream DH). **114's evidence-ordered list is: item 1 already built, item 2
already built, item 3 (nonlinear ladder filter) dropped, item 4 (FM depth) tracked.**

One of the four named levers in the current direction-setting decision is a no-op. **Ruling:** does
"parametric EQ" mean something not-yet-built, or should D26's list be amended to start at the ladder
filter? Related: `webdx7`, another of D26's four levers, has **no roadmap row at all** — it lives only
in D23/D26 prose.

### 4.6 The roughness ear gates the build from n=1, against its own doc's instruction

123 §5 says the DW roughness lint is gate-capable; 123 §7 says *"log-not-gate until 2-3 more pairs
confirm."* The ship followed §5: `roughness.ts:132` returns severity **3 at exactly the single
measured +25% margin**, and `cli/beat.mjs:5246` exits non-zero at severity ≥3. **A roughness rise
merely reproducing the one calibration datapoint fails the build.** Fix is XS (cap at severity 2, or
exclude `roughness-dw` from the exit-code rule) — but which way is the owner's call, and CLAUDE.md's
own provenance-comment guardrail makes the current state under-documented for a gate calibrated on
one A/B pair.

### 4.7 D26 (synthesis-toward-commercial) vs. 121 §3.5 (samples as the next pillar)

121 §3.5 argues the showdown hierarchy (ref 94% >> gen 70% >> engine 4%) means *"the fastest route to
producer-level sound is often not synthesizing it,"* and asks for a local sample index (`beat source
search --local`). It pre-empts the obvious objection: *"Retrieval is what CLAP is actually good at
(its taste failure is irrelevant here)"* — so the CLAP retirement, which was about preference
*scoring*, does not close this.

Read one way D26 rules the sample path out; read another, D26 is about the *comparison target* and
samples are orthogonal. 132's "sampled top layers" suggests the latter. **Today the purchased pack
loops sit on disk as eval refs only** — nothing lets an agent use them as production material, which
was half the point of buying them.

### 4.8 The project has nowhere to put an owner errand

Not a contradiction between docs — a structural hole that accounts for **six** dropped items: the
m2m licensing email (126), the MiniMax ToS read and the ElevenLabs rights table (127 §4.5), 134
§4.3's Splice-ToU ruling on matched patches, the Surge factory/3rd-party licensing re-verification
(#6741, D23's own open "revisit when"), and the upstream surgepy issue (§5.1). Each is ten minutes of
a human's time blocking a build.

The roadmap tracks *features*; `decisions.md` tracks *decisions*; errands fall between them and
disappear. CLAUDE.md already set the precedent that a second tracking system is the wrong answer —
the same reasoning argues for an **`Owner errands` area in `roadmap-data.mjs`**. The same hole
swallows conditional watch items (122's "revisit immediately if NVIDIA ships a NIM", 124's "watch
Moonbeam").

### 4.9 Which knowledge-capture artifact is the one to build?

The **one partial supersession** in this audit. 139 §4 (today) proposes `presets/recipes.json` +
a generated reference doc as a *superset* citing 135's `role-targets.json` pattern, while 138 B2
still lists role-targets + `rolecheck` as its own build item. **Neither exists.** Somebody should say
which artifact is canonical so the next agent doesn't build both or neither. My read: 139's schema
subsumes 135's and `role-targets.json` becomes an implementation detail of it — but that is a call,
not a finding.

---

## 5. The scattered small stuff nobody collected

### 5.1 `D20` is cited by six source files and does not exist

`docs/decisions.md` jumps D19 → D21. But `D20` is cited as though it were there, from code:
`cli/beat.mjs:131` and `:4622`, `src/analysis/pitch.ts:1` and `:5`, `src/analysis/index.ts:185`,
`src/mcp/server.ts:97`, `test/sidecars-installed.owner.ts:114`, `docs/phase-40-plan.md:51`.

The decision's actual text lives in `docs/phase-40-plan.md:220` — *"D20 — pitch detection is pure TS,
not a third Python sidecar."* It was made, written into a phase plan, and never promoted into the
decisions log. **Fix: paste that paragraph into `decisions.md` between D19 and D21.**

### 5.2 `D23` is two different decisions under one number

- `decisions.md:47` — **D23** "offline renders build on a raw NATIVE OfflineAudioContext" (07-17)
- `decisions.md:149` — **D23** "GPL synths may run as out-of-process sound factories" (07-22)

| Cites the *offline-render* D23 (11) | Cites the *GPL/surge* D23 (7) |
|---|---|
| `ROADMAP.md:227`, `docs/architecture.md:62,93`, `docs/taste-loop-design.md:183`, `docs/product-roadmap.md:349,351`, `.claude/skills/dotbeat/SKILL.md:128`, `…/render-metrics-loop.md:72,93`, `…/mistakes.md:56,63` | `docs/surge-track.md:7,78`, `docs/format-spec.md:943,947,971`, `docs/product-roadmap.md:508`, `docs/research/136:325`, `docs/research/137:33` |

Research 130 flagged this on 2026-07-25 and rated it **High**; 137 re-flagged it 2026-07-26. It needed
"owner-approved" and so fell into the gap between "an agent can just do it" and "someone will ask."
Research 138 now cites "D23-D27" **ambiguously**.

**Fix: renumber the newer (GPL/surge) entry to D30** — fewer citations to repoint — then fix those 7.
**Also:** the offline-render D23 is out of chronological order in a log whose header says *"Newest at
top"* — dated 07-17, it sits above D27, D26, D25 and D24 (all 07-22). Move it below D21.

### 5.3 Research doc `103` is duplicated — the identical pathology

```
docs/research/103-generative-audio-apis.md
docs/research/103-usability-pilot-lane-taste-loop.md
```

Otherwise `01`-`139` is gap-free. The collision already produced ambiguous citations:
`docs/phase-37-plan.md:29` points at the glob `docs/research/103-*.md`, which now matches both, and
`docs/phase-35-plan.md:162` says "research/103+".

Worth naming the shared cause with §5.2: **two independent numbering systems have collided in the
same way, both from parallel sessions allocating a number without checking.** One pre-commit check
closes both: `ls docs/research/*.md | grep -oE '^[0-9]+' | uniq -d`, and the same over `^## D[0-9]+`
in `decisions.md`.

### 5.4 `decisions.md` D25 still says the training-exclusion is "not yet implemented" — it is

D25 (`:130-133`): *"pack-pool variants must be EXCLUDED from critic training pairs… (**not yet
implemented, required before ingestion**)."*

It **is** implemented, and well. `src/taste/eval.ts:34-128` defines a deliberately conservative
**three-tier** holdout (logged list → manifest via `trainingExcludedFiles()` in `src/vary/batch.ts` →
*"no manifest, no logged list: any ref variant is unattributable, so it is excluded"*), reasoned
in-code: *"Worst case it withholds a training pair it could legally have used; the other direction is
a licence violation baked into a model."* Landed in `dd85f360`, hardened by H3 (`ea1de24d`,
`09339cb4`) after the first version was found to silently un-exclude once batch dirs were deleted.

**This is the strongest single piece of follow-through in the audit** — but the stale text is not
harmless: it is the sentence someone reads before deciding whether pack refs may enter a rated batch.

### 5.5 Two roadmap rows drifted, in opposite directions

- **`Rate UI: explicit "none are good" verdict`** (`:1352`) reads `core: 'missing', cli: 'missing',
  status: 'not-started'`. The feature is fully built: `cli/rate.mjs:75` (button), `:126` (handler),
  `:158` (`n` key), `showdown.ts:1346` (`noneGoodByRole`, exactly the scoreboard reporting the
  description asks for). **Flip to done.**
- **`Gen-provider adapters + bake-off`** (`:2082`) reads `status: 'done'` while bundling a shipped
  build with an experiment that never ran (§2 D15). **Split it.**

The pair is the useful observation: **the roadmap drifts both ways, so neither a `done` nor a
`not-started` row can be trusted without a code check.**

### 5.6 The upstream surgepy issue was drafted four days ago and never filed

`docs/research/surge-right-ear-ring-rootcause.md:99` still reads *"Draft issue text for the…"*, and
no issue or PR number appears anywhere in the repo. D23's own wording — *"upstream issue **draft** in
`docs/research/surge-right-ear-ring-rootcause.md`"* — is the outstanding TODO.

**I read this as correct caution rather than neglect:** filing an upstream GitHub issue is an
outward-facing action, and no agent should do that unilaterally. **The failure is that nobody asked.**
It is also the only outward-facing contribution this project has ready to give (the body, a six-line
repro and a one-line fix are all written). Either file it, or edit D23 to say "declined to file" so
the word "draft" stops being load-bearing. *(The internal half shipped correctly: `surge_render.py`
now collects via `processMultiBlock`, never `getOutput()`.)*

### 5.7 `docs/research/README.md` indexes 13 of 139 docs

It links `01`-`09` and `21`-`24`. Nothing else. This matters more than a stale index normally would,
because `decisions.md`'s header points at it as the authority on claim verification: *"all research
citations below now point at fully adversarially-verified claims (four passes...) — see
`research/README.md`."* Read literally, that guarantee covers only the 01-09 era.

### 5.8 Test-skip reasons are named but not enumerated

CLAUDE.md's guardrail — *"only explicitly env-gated dependencies may skip, each with a named
reason"* — **is being honoured**: 8 skips out of 1481 tests, six distinct reasons across the suite.

| count | reason |
|---|---|
| 33 | `'no python3'` |
| 5 | `SETUP_HINT` (`test/sidecars-installed.owner.ts`) |
| 5 | `` `no python3 for the stub sidecar here: ${err}` `` |
| 3 | `'beatthis installed — degrade path not exercisable here'` |
| 2 | `'stableaudio installed — degrade path not exercisable here'` |
| 1 | `'running as root (or on a permissionless filesystem)…'` |

What is missing is the **roll-up** — no single place says "these six are the complete sanctioned
set," so a seventh can be added without anyone noticing it is new. **Fix: a
`test/skip-reasons.test.ts` that greps for `t.skip(` and asserts the reason set equals a committed
list** — the same shape as W0.1's golden gate. **Cost: S.**

### 5.9 One-line rot, in one commit

- `docs/research/118:276` cites `parseTrickLibrary` in **`src/core/trick.ts`**; it shipped at
  **`src/analysis/trick.ts`**.
- `roadmap-data.mjs:2179` (mirrored into `docs/product-roadmap.md:557`) says "CLI pilot 128" for a
  **pilot-129** finding — the doc was renumbered in `646886a0` and the prose wasn't.
- `src/taste/eval.ts:726` prints a **user-facing** note citing an internal doc path — pilot 110's LOW
  finding, never fixed while its siblings were.
- **No decisions.md entry for edit telemetry**, required explicitly by *both* 116 §Honest-gaps
  (*"opt-in default matters even for a single owner"*) and 128 §2.4. It landed. Two research passes
  asked; neither got it.
- `README.md` has zero "Stability" mentions; research 103 asked for "Powered by Stability AI" in
  dotbeat's own docs. It's in `decisions.md`, `python/README.md` and `beat help source gen` — likely
  satisfied under D19, but one line to be certain.

### 5.10 The XS module-hygiene batch (136), one commit, ~30 minutes

All four are prerequisites for D8's boundary test, so do them together:

| Fix | Where |
|---|---|
| Retarget the stale `mulberry32` import to `src/core/rng.ts` | `src/analysis/genkit.ts:21` — still `from '../taste/eval.js'` |
| Retarget the private `mulberry32` copy | `src/vary/vary.ts:254-262` — *"exactly the copy that outlives the consolidation"* |
| Move `SurgePatch`/`SurgeNote` type declarations into `analysis/surge.ts` (type-only, safe) | `src/analysis/surge.ts:14` imports them from `taste/showdown` |
| Move `taste/features.ts` into `metrics/` — it is a DSP extractor, i.e. measurement | dissolves two of three cycles; **cheapest done in the same commit as D16's re-freeze** |

Plus one more from the same doc: **`GET /document` should return canonical `.beat` text alongside
JSON** (`daemon.ts:1081` is `json(res, 200, doc)`), so "what the GUI has" and "what git sees" are
byte-comparable. XS, and it is a diagnostic for the entire mirror class D1 belongs to.

### 5.11 Two live traps worth documenting before someone loses a day

- **Clip automation plays only in song mode** (133 §3). A pack-loop render must wrap its clip in a
  1-scene song block to hear its own automation. No warning exists in the render path or
  `docs/producing.md`. Anyone applying `slow-filter-lfo` / `section-sweep` renders motion-free audio
  and mis-measures the result.
- **`beat rate` has no back/undo after a mis-skip** (pilot 112). The entry is already logged.

### 5.12 Standing practices that were owed and skipped

- **Two new CLI command families shipped with no CLI/MCP usability pilot** — `beat trick` and `beat
  prodtask`. CLAUDE.md calls these *"cheap enough that there's no excuse to skip one"* (~4 min) and
  quotes the owner's own framing. Owed twice.
- **No verify-script retirement lifecycle** (130 T10). Ten dead scripts were retired ad hoc; the
  governance paragraph that would let the *next* person retire one was never written, and 90
  `ui/verify-*.mjs` remain.
- **No coverage tooling** (130 §Honest-gaps, rated medium). No `c8`, no
  `--experimental-test-coverage`. Every "untested module" claim in 130 is grep-derived, and six new
  test files have landed since.
- **No record of which rated batches predate the F3 shuffle change** (130 §5.3 asked for exactly
  this before scheduling W2.8). `2a0ef9ef` correctly says "CHANGES seeded output"; nothing records
  the boundary, and research 131 then analyzed 177 batches spanning it. A dated line in
  `docs/source-showdown-eval.md` fixes it — this is eval integrity, not hygiene.

### 5.13 One stale branch and two ready-to-promote backlog rows

`origin/claude/synthesis-learning-sections-k4jtqh` sits **+58 commits** ahead of main, last touched
**2026-07-11** — fifteen days stale, the largest orphaned branch in the repo. Merge it or kill it.

In "Core effects", two rows added 2026-07-12 are still `not-started` and are now *unblocked*: the
**insertion-line drop indicator** (its stated blocker, a shared drag primitive, now exists as
`ui/src/dragDrop.ts`'s `makeDropTargetHandlers`/`useDropTarget`) and **arrow-key nudge on `Knob`**
(`Knob.tsx:213-222` has `tabIndex` and Enter/Space but no arrow handling — the row itself calls it "a
real accessibility gap"). Both ready as-is.

---

## 6. Research 130's W2/W3 waves — the largest single dropped block

Broken out because it is 16 items with one cause.

| Wave | Items | Landed | Evidence |
|---|---|---|---|
| W0 (tests/gates first) | 9 | **9/9** | commits for W0.1-W0.9 |
| W1 (shared scaffolds) | 5 | **4/5** | W1.4 has zero commits (§2 D25) |
| W2 (decomposition) | 10 | **0/10** | no commit mentions any W2.x on any branch |
| W3 (generated surfaces) | 5+ | **0/5** | ditto |

Verified structurally — every module W2/W3 would create is absent, and every god-file it would break
up is still full size (and three have *grown* since the review):

```
MISSING  src/core/edit/  (W2.1)  src/core/edit.ts 1902 · src/taste/showdown/ (W2.2) showdown.ts 1566
MISSING  src/core/arrangement.ts, daemon/library.ts, daemon/http.ts (W2.3)  daemon.ts 2750 (+109)
MISSING  src/mcp/tools/ (W2.4) server.ts 2465 · src/taste/assemble.ts (W2.5) beat.mjs 6140 (+44)
MISSING  src/metrics/normalize.ts (W2.6) batch.ts 1195 (+172) · cli/lib/review-server.mjs (W2.9)
MISSING  src/core/error.ts (W2.10) · src/ops/ (W3.1) · cli/lib/args.mjs + cli/help/ (W1.4)
```

**Two things make this worth a ruling rather than a shrug.**

**(a) Pieces landed untagged, which hides the gap.** W2.8's Fisher-Yates fix shipped as `F3`
(`2a0ef9ef`); W2.9's substance partly shipped as `1c1322b7` (`src/serve/review-server.ts`) without
creating the specced module — and `findBatches` is still duplicated across `cli/rate.mjs:16` and
`cli/board.mjs:28`. A reader scanning `git log` sees the topics addressed and concludes the wave ran.

**(b) A guardrail describing infrastructure that was never built reads as done.** CLAUDE.md's "parity
is structural… the operation gets a row in the CLI↔MCP parity table test" is written as settled
policy, but the table covers a seeded 15-20 commands out of 71 MCP tools, and W1.4/W3.1 — the
packages that would make it structural — are dropped. Meanwhile `test/mcp-effects.test.ts:16` now
**pins the `beat_effect_bypass` polarity inversion as correct behaviour**, with a comment saying the
fix arrives "when W3.1 lands." W3.1 is dropped. So an agent-facing bug has a *passing test protecting
it*, on three names and two polarities across surfaces (`cli/beat.mjs:4904` bypassed=true,
`server.ts:822` `{enabled}`, `daemon.ts:1869` `/effect-enabled`). Either land the additive `bypassed`
alias — S, one schema field and one negation, no W3.1 needed — or accept it permanently and drop the
"pinned until" language. **Right now the codebase asserts both.**

**My recommendation, as judgment not plan:** do not replay W2 as a unit. The file lists are stale and
130 itself rates the wave ordering "medium confidence." Take the two cheapest, highest-certainty
pieces — **W2.7** (the engine's `src/core` leaf-import swap, which 130 calls *"the single most
elegant move… converts three untested mirrors into tested single-sources without writing one new
test"*, and which retires the **third** `mulberry32` copy at `ui/src/audio/engine.ts:1523`) and
**W2.4** (the MCP `TOOLS` split) — and re-cut the rest. Do **W1.4** regardless: it finishes something
already started.

---

## 7. What I'd put in front of the owner first

Ordered by (leverage × cheapness). Four are rulings that cost a sentence each and unblock a dozen
items between them.

1. **Guard the surge track kind in the GUI (D1)** — and spend the two minutes 137 asked for to
   confirm the crash. A shipped path, a one-line fix, the highest severity in the audit.
2. **Turn edit telemetry on (D2).** The only item that destroys data every day it slips.
3. **Sort the ref pool (D4), then rule on the width/air doctrine (§4.1) and the frozen-vs-screen
   boundary (§4.3).** In that order — the ruling depends on numbers mined from the pool. Together they
   unblock D3, D9, D10, D21 and `trick suggest` v2: five S-sized items currently frozen by governance,
   not difficulty.
4. **Rule on `FEATURE_KEYS` (§4.4).** One sentence. Nothing in 138's ladder is interpretable until it
   exists, and two feature pipelines with disagreeing units are compounding daily.
5. **Split the gen-bake-off roadmap row and either run the $11 screen or kill it (D15).** A `done` row
   is hiding an unrun experiment that sits directly upstream of 138's whole premise.
6. **Run the pedalboard probe (D14).** The only afternoon here that plausibly buys a whole timbre tier,
   dependent on nothing.
7. **Fix or mitigate the Surge tempo bug (D6)** — and caveat the existing surge ratings either way.
8. **Create an `Owner errands` area in `roadmap-data.mjs` (§4.8),** and seed it with the six errands
   this audit found — starting with the m2m email (D24) and the surgepy issue (§5.6), which need a
   yes/no from you, not a build slot.

And the free one: **§5.9 + §5.10 as a single hygiene commit** — the D20 paste, the D23 renumber, four
import edits, `GET /document`, and the citation fixes. Roughly an hour for the lot.

---

## Honest gaps in this audit

- **Docs 131-139 are hours old.** Their items are counted as untriaged, not dropped. Where one appears
  in §2 it is because the recommendation contradicts code that is already shipped and running.
- **Doc 139 (recipe library + layering, 704 lines) landed on `origin/main` mid-audit** and is
  explicitly a proposal — *"this doc proposes, 138's ladder disposes."* It is not audited item by item
  here; its §6 build proposal is the next thing to schedule, not a dropped item. Its one live conflict
  with 135/138 is recorded at §4.9.
- **Recommendation counts are approximate (±10%)**, because "one recommendation" is a judgment call
  when a doc bundles four sub-items into a bullet. Every *named* item's classification was verified;
  the totals are indicative.
- **I did not run the eval, and I did not launch the GUI.** Every claim about what a measurement
  *said* is quoted from the doc that made it; every claim about what the *code does* was verified this
  pass by reading it. D1's runtime confirmation is the one check still owed.
- **Recommendations too vague to action, said plainly rather than turned into invented plans:**
  138 row 8's articulation targets (outcome numbers with no named recipe — the #2-ranked cause and the
  least buildable item in the doc); 138 B4's "two-stage re-host" (named, never specified, and 139
  independently found its blocker — `BeatGroup` is visual-only — which 138 does not mention);
  136's `defineOp` (explicitly "sketch, not a spec", and the per-surface description-override
  mechanism *is* the risk); 135's dosage numbers (honest about being starting points, but without D26's
  `rolecheck` there is no verify loop, so the checklists are a reading assignment, not a procedure);
  131 §7-P4's "texture" (three levers, no dosage); 122 §5's "MAEB is the right place to shop" (a venue,
  not a task); and the conditional watch items (122's NIM, 124's Moonbeam) which the tracking system
  structurally cannot hold — see §4.8.
- **Three areas nobody has reviewed** (130's own honest gap, still open): `scripts/` beyond
  `source-lib.mjs`, `desktop/`, and `.claude/skills/`. The last is now the highest-value gap, since
  D28/D29 make skills load-bearing product surface — and §2 D13 is exactly the kind of rot a review
  would have caught.

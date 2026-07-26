# Research 143 — A prior-mining system: the claims corpus, the mining protocol, and the verification loop that turns folklore into evidence

*Run 2026-07-26, commissioned by the owner after the first nine-agent mining fleet landed: "I'm not
sure how we should architect this in our system, but I really think we should leverage these types
of mined insights (and I'm guessing there's a lot more out there on the internet to mine)... the
internet is absolutely full of people doing tutorials, demos, etc, on production — we should mine
that into priors/recipes/etc that we can use here." Method: read the entire output of that fleet
(`docs/priors/*.md`, 2,735 lines across nine veins — `README.md`, `layering.md`, `pack-production.md`
and `drums.md` in full, the other six by targeted extraction of their consensus/contradiction/
limitation sections), then measured it (claim density, tag-vocabulary drift, source-domain
concentration, WebSearch-exhaustion reports) rather than describing it; read `141` and
`presets/role-parameter-stats.json` as the counterexample that answers the same questions from
patch FILES; read `139 §4` and the live sibling implementation of it in
`.claude/worktrees/recipe-library/src/recipes/{schema,verify,build,format}.ts` (branch
`recipe-library`, commit `ef7c4a65`, ahead 1 / behind 17 — **not on main**); read `src/taste/
layered.ts` and `docs/source-showdown-eval.md` for the two priors measurement REFUTED; read `140`
for the tail-evaporation numbers; and mapped the existing verification surface in code
(`src/metrics/{analyze,screens,lint}.ts`, `src/taste/features.ts`, `cli/render.mjs`,
`scripts/layered-check.mjs`). Confidence: **High** = verified in the repo this pass by reading the
file or running the count; **Medium** = a design judgement resting on one measured observation, or a
cost estimate extrapolated from the single observed fleet; **Low** = an untested hypothesis about
what a future pass would yield. Companions: 139 §4 (the recipe schema this composes with — treat
recipes as the DOWNSTREAM artifact of this corpus), 141 (the measured-artifact arbiter), 140 (why
the tail evaporates), 131 (the measured gaps that rank the veins), 138 B0/B2 (the feature-key
ruling this design routes around rather than resolves). Deliverables: this doc. Research only — no
code changed, nothing outside this file was touched.*

---

## Headline answers

1. **The first fleet produced prose, and prose is where knowledge goes to die — the corpus must be
   a claims STORE.** Nine agents produced 2,735 lines, ~90 recipes, **402 lines carrying a number
   with a unit**, and **165 URL citations across 44 domains**. Zero of it is machine-readable: a
   whole-repo grep for `docs/priors` returns hits only in `.claude/worktrees/recipe-library/src/
   recipes/schema.ts` — and even there they are prose citations inside comments and error strings,
   not parsed data. On main, `src/taste/layered.ts` hard-codes its numbers and does not cite the
   priors at all: a human read the prose and re-typed the values. **That re-typing is the failure
   mode**, and it already happened once — a relayed "sub −9 dB under mid" inverted its own primary
   source. (High.) §1, §2
2. **The tag vocabulary drifted across nine agents in a single session, which is the whole argument
   for an output contract.** `layering.md` uses `[CONSENSUS]`/`[CORROBORATED]`/`[SINGLE SOURCE]`
   (8/6/22 uses). `pack-production.md` invented a different four-tier ladder
   (`[VERIFIED]`/`[PUBLICATION]`/`[FORUM/SNIPPET]`/`[UNVERIFIED — LOW TRUST]`). `transients.md` used
   a two-tier variant. **Five of the nine files use no confidence tag at all** — including every
   bass file, the highest-numeric-density vein in the set (`bass-basseries.md`, 76 numeric lines).
   The README promises "where a technique needs a parameter dotbeat cannot express, the file says
   so"; grep for `dotbeat` across the nine files returns **0 hits in seven of them**. A coordinator
   asking nine agents to self-report in prose gets nine schemas. (High.) §1, §3
3. **The corpus is 45.5% one publication, and that number is the exhaustion test.** Of 165 URL
   citations, **75 are `attackmagazine.com`** — more than the next twenty-two domains combined. This
   is not a criticism of the agents (Attack is genuinely the best-indexed source in this space); it
   is a *measurable* over-fitting signal, and it converts directly into a stopping/quality rule: **a
   vein is not "mined" while one domain supplies >40% of its citations.** (High.) §5, §6, §7
4. **Verification is the load-bearing step, and we have exactly two data points — both refutations.**
   `src/taste/layered.ts` is the only build that consumed mined priors, and measurement killed two
   of them: the mid/side widener *attenuates* near-mono layers ("pushed to 0.92–0.98 it cut chords'
   mids from 29% to 6.9%; even at 0.78 it bought *zero* width"), and parallel compression on a
   sustained low layer *moves the very band-share it targets* ("pushed chords' bass-band share from
   38% (in target) to 62% (out)"). Two for two against the prose. A corpus of unverified claims is
   a corpus of hypotheses, and it should say so in a field. (High.) §4
5. **The percentile adjudication in 141 is the corroboration primitive, and it is already
   implemented.** 141 settled the Reese-detune dispute the prose could not: sources claimed ±7,
   ±27, ±30, ±55–61 and asymmetric −30/+50 cents; the 3,559-patch corpus measures **median 11.4 ¢,
   IQR 6.0–20.0**, and scores each tutorial claim as a percentile — **±7 ¢ = p27, ±10 ¢ = p37,
   ±20 ¢ = p68, ±30 ¢ = p87, ±61 ¢ = p97**. `compare2.py:pctl()` is eight lines. Every claim whose
   field has a measured distribution should carry that percentile, computed, not asserted. (High.)
   §2.2, §4.2
6. **The mining system should mirror the taste program's collect → measure → validate → promote —
   with one structural change: a machine measure inserted BEFORE the owner's ears.** In the taste
   program the scarce resource is owner rating time (1,612 pairwise preferences accumulated over
   177 batches). In mining, claims are cheap and plentiful and owner time is ~100× scarcer per
   claim. So the loop is collect → **triage + probe (machine)** → validate (blind showdown, for
   recipes only, never for individual claims) → promote. This is not a new idea; it is 138 B2's
   never-built rule — *"every arm's clips pass their feature gates BEFORE entering a batch (never
   spend owner ratings on a clip that missed its own targets)"* — applied one level upstream.
   (Medium.) §4.5
7. **A large fraction of claims cannot be auto-verified today, and the honest design says so in a
   status rather than pretending.** Three distinct blockers, all real: (a) **pending metrics** —
   `attackMedMs`, `fluxMean`, `crestSubDb`, `flatnessHiDb`, `onsetRatePerSec` are what 131 measured
   as the actual discriminators and `FEATURE_KEYS` still has 13 keys, none of them these (the
   ruling is stalled; two agents have declined it); (b) **band-edge mismatch** — the corpus's
   best-triangulated number is a **75–100 Hz** sub/mid crossover, and our `bandSubPct` edge is at
   **60 Hz**, so "LPF the sub at 90 Hz" is *invisible* to the band shares (a new observation this
   pass); (c) **inherently unverifiable** claims — workflow ("tune the kick last, against the
   bass"), provenance (the JP-8000 supersaw origin debate), and performance-gesture claims
   (`leads.md` found two credentialed sources arguing acid patches are *not* capturable as static
   parameters). (High for (a) and (b); Medium for (c).) §4.2–§4.4
8. **The corpus must not become the ninth place things go to die — and the fix is that a claim is a
   ROW, not a bullet.** 140 measured **~99 of ~200 recommendations (49%) DROPPED** across docs
   114-130, and named the mechanism precisely: *"The tail has no home, because the tail was never
   filed as rows."* Docs 130-139: **0 of 10 cited by any roadmap row.** A claims store with a status
   field is structurally different from a prose bullet — `unverified` is countable, greppable, and
   shows up in a report. A prose bullet is not. (High.) §7.6, §9

---

## 1. What the first fleet actually produced — the baseline to beat

Measured, not recalled:

| metric | value | how |
|---|---|---|
| vein files | 9 + README | `ls docs/priors/` |
| total lines | 2,735 | `wc -l` |
| recipes claimed | ~90 | README index table |
| lines carrying a number + unit | **402** | grep for `[0-9] ?(Hz\|kHz\|dB\|ms\|cents\|%\|:1\|semitones)` |
| URL citations | 165 | grep `https?://` |
| distinct domains | 44 | dedup of the above |
| `attackmagazine.com` share | **75 / 165 = 45.5%** | same |
| files reporting WebSearch exhaustion | **5 of 9** (`leads`, `drums`, `layering`, `transients`, `chords-pads`, plus `pack-production`'s method note) | grep `quota\|exhaust` |
| files with an explicit CONTRADICTIONS section | 5 of 9 | grep |
| files using a confidence tag vocabulary | 4 of 9, **three different vocabularies** | grep |
| files stating what dotbeat cannot express | **0 of 9** (README promises it) | grep `dotbeat` |
| machine-readable output | **0 bytes** | grep `docs/priors` across the repo |

This is a genuinely good research output — the per-vein narrative in `layering.md` §6 (when *not*
to layer) and `drums.md`'s twelve numbered RECIPE blocks are better than anything we would have
written from first principles, and `pack-production.md`'s finding that Splice publishes *no numeric
audio specs at all* is a real, load-bearing negative result. The problem is not quality. The problem
is **shape**: nothing downstream can consume it without a human retyping it, the confidence
vocabulary is not comparable across files, and there is no field anywhere that could ever change
from "we read this on the internet" to "we measured this in our engine."

Two structural observations worth carrying forward, both from the fleet's own honesty:

- **`pack-production.md` reports "~14 parallel mining agents"** sharing the search budget, while the
  README indexes nine veins. Either the fleet was larger than the surviving output, or the agent was
  estimating. Either way, **nobody knows how many agents ran or what they cost** — there is no
  registry. (Medium.)
- **Reddit was blocked at the tool level** (`www.reddit.com` and `old.reddit.com` both), and several
  named targets returned 403/429/paywall (`pointblankmusicschool.com` 403, `techne.fm` 502,
  `bassculture.substack.com` paywalled, `floriangouello.com` 429 across four retries). These were
  recorded in prose at the bottom of two files and are therefore invisible to the next pass, which
  will spend budget rediscovering them.

---

## 2. The corpus — a claims store, not a document library

### 2.1 The disagreement, stated, then conceded

The owner's prior is that a claims store is not a document library. I agree, with one amendment
that changes the build: **keep both, and make the relationship one-directional.** The prose is the
mining agent's *notes* and stays valuable — the narrative in `layering.md` §7 about stacking vs.
layering, or `drums.md`'s observation that "precise, non-round HPF numbers (271 Hz, 2.52 kHz) show
these came from ear-tuned sweeps, not preset defaults," is reasoning a record cannot hold and a
human genuinely wants. But **the prose stops being the queryable surface**. An agent asking "what do
we know about sub/mid crossover for bass" must never be answered by "read `layering.md`."

The repo has already ruled on this shape and written the ruling into a script header
(`scripts/gen-tricks-reference.mjs:1`):

> *Regenerates docs/tricks-reference.md from presets/tricks.json (research 118 §3.1 option C: the
> library is the source of truth, the reference doc is GENERATED so it can never drift from it —
> the roadmap-data.mjs -> product-roadmap.md pattern applied to production knowledge).*

That is the same pattern, already twice-proven in this repo. Apply it a third time.

### 2.2 The Claim record

One JSON object per line, in **JSONL**, not a JSON array. This matters for a specific, boring
reason: the fleet is parallel, and a nine-agent wave appending to one JSON array produces nine
merge conflicts in the same brackets, whereas nine agents each appending to their own shard file
produces none. It also matches the repo's one proven append-only knowledge artifact,
`beat-scores.jsonl`.

```jsonc
{
  "id": "bass-sub-mid-crossover-hz",        // stable slug; recipes cite THIS, never the prose
  "vein": "layering",
  "assertion": "In a layered bass, the mid layer is high-passed at ~75-100 Hz so it stops competing with the sub layer.",

  // --- expressible in dotbeat's own field names, or explicitly not ---
  "params": [
    { "field": "eq7HpFreq", "scope": "layer:mid", "value": 85, "range": [75, 100], "unit": "Hz" },
    { "field": "eq7HpOn",   "scope": "layer:mid", "value": true }
  ],

  // --- the measurable prediction: what should change, and how ---
  "predicate": {
    "kind": "expect",                        // 'expect' = A/B delta (tricks.json vocabulary)
    "clauses": [ { "metric": "bandSubPct", "scope": "layer:mid", "dir": "down", "min": 5 } ]
  },

  "roles": ["bassline"],
  "techniques": ["layering", "eq", "crossover"],
  "genres": ["house", "techno", "dnb"],

  "sources": [
    { "cite": "ProducerHive — How to layer bass synths", "url": "https://producerhive.com/...",
      "kind": "publication", "practitioner": "editorial-staff",
      "quote": "high-pass just above 100 Hz, low-pass 400-500 Hz",   // <= 25 words, verbatim
      "value": 100, "retrieved": "2026-07-26" },
    { "cite": "MusicRadar — 6 steps to a perfect layered bass", "url": "https://...",
      "kind": "publication", "practitioner": "editorial-staff",
      "quote": "HPF24 at 79 Hz, Q 0.7", "value": 79, "retrieved": "2026-07-26" },
    { "cite": "ModeAudio — Sub-bass layering", "url": "https://...",
      "kind": "publication", "practitioner": "editorial-staff", "value": 75, "retrieved": "2026-07-26" }
  ],

  "agreement": "consensus",                  // DERIVED at parse time, never declared — see §2.3
  "contested": null,                         // or { "span": [75,100], "field": "eq7HpFreq", "note": "..." }

  "measuredCheck": {                         // corroboration against a measured artifact
    "artifact": "presets/role-parameter-stats.json",
    "path": "roles.bass.filter.cutoffHzKnob",
    "verdict": "silent",                     // corroborates | contradicts | silent
    "percentile": null,
    "note": "Surge's knob cutoff is a filter, not a crossover between two layers — not the same quantity."
  },

  "status": "unverified",                    // unverified | verified | refuted | unmeasurable | inexpressible
  "verification": null,                      // filled by the probe: { probe, arms, receipt, delta, at, commit }

  "minedBy": "wave-2026-07-26/layering",
  "minedAt": "2026-07-26",
  "relayed": false                           // true = transcribed from prose by a later agent, not fetched first-hand
}
```

Field-by-field justification, and what I added to the owner's list and why:

- **`id`** — the whole point. `presets/recipes.json` cites `claimId` and stops restating prose.
- **`params[]` with `field`** — validated at parse time against the live `SYNTH_FIELDS` /
  `EFFECT_TYPES` / `DRUM_LANES` tables, exactly as `src/analysis/trick.ts` validates tricks today. A
  `SYNTH_FIELDS` rename therefore breaks the corpus loudly in CI instead of producing a silently
  wrong recipe. `scope` is `clip`, `track`, or `layer:<id>` so a per-layer claim stays per-layer.
- **`predicate`** — **my biggest addition, and the one that makes the rest work.** Without a stated,
  falsifiable prediction, a claim can never move off `unverified`; the pipeline has nothing to
  measure. Two kinds, both reusing vocabularies that already exist rather than inventing a third:
  `expect` clauses (`{metric, dir: up|down|flat, min?}` — lifted verbatim from `presets/tricks.json`)
  for A/B deltas, and `gate` bands (`[lo, hi]` — lifted from the recipe schema's `GateBand`) for
  absolute targets. **Gates are bands, never scalar maxima**, which is the anti-Goodhart shape 139
  §1.3 already ruled on.
- **`sources[].kind` + `practitioner`** — credibility, with a closed vocabulary (§3.3) instead of
  nine improvised ladders.
- **`sources[].quote`** — a ≤25-word verbatim excerpt supporting the number. This is the direct fix
  for the inverted "sub −9 dB under mid": a reader can audit the relay against the source without
  re-fetching it. It is also the licensing ceiling (§7.5).
- **`sources[].value`** — the per-source number. Contradiction becomes arithmetic instead of prose.
- **`agreement`** — **derived, not declared** (§2.3).
- **`contested`** — the full span when sources disagree. This is what feeds the sibling schema's
  `RecipeDial.range`, which already exists and is documented as "the source disagreements this
  recipe resolved by measurement, kept explicit."
- **`measuredCheck`** — the owner's "does a patch-file/measured source corroborate or contradict it."
  Note the honest third verdict: **`silent`**. Most claims have no measured counterpart, and a
  design that only offers corroborate/contradict will get corroborations invented for it.
- **`status`** — five values, discussed in §4.
- **`relayed`** — a claim transcribed from existing prose by a later agent is epistemically weaker
  than one written by the agent that fetched the page, because that is precisely the step that
  inverted a sign last time. Marking it costs one boolean and makes the backfill (§9) honest.
- **`minedAt` / `retrieved`** — staleness (§7.4).

### 2.3 `agreement` is computed, not asserted

The single highest-leverage rule in this design, and it costs ten lines in the parser:

```
distinctDomains = unique(sources[].url -> registrable domain)
agreement = 'contested'      if sources give >1 distinct value for the same field
          = 'consensus'      if distinctDomains >= 3
          = 'corroborated'   if distinctDomains == 2
          = 'single-source'  otherwise
```

`layering.md` states this rule in its own header ("independently stated by 3+ unrelated sources")
and then applies it by hand; five of the nine files did not apply it at all. A derived field cannot
drift across nine agents, cannot be inflated by an agent that wants its vein to look strong, and
catches the specific failure where three "independent" citations are three articles on the same
domain. It also composes with the sibling's existing `SOURCE_CONFIDENCES` ladder
(`measured-refs | measured-patches | consensus | corroborated | single-source`) — the prose tiers
are the same three words, and the two measured tiers come from `measuredCheck`, not from prose.

### 2.4 Where it lives, and how it relates to `presets/recipes.json`

```
presets/claims/<vein>.jsonl        the store — one shard per vein, append-only, one claim per line
presets/claims/index.jsonl         the URL index (wave-0 output; see §3.5)
presets/claims/veins.jsonl         the vein registry (§5)
docs/priors/<vein>.md              the mining agent's NARRATIVE — demoted to notes, never queried
docs/priors-reference.md           GENERATED from the store by scripts/gen-priors-reference.mjs
src/recipes/claims.ts              parseClaimLibrary(json) — eager validation, derived agreement
scripts/claims-report.mjs          status histogram, domain concentration, duplicate ids
```

`presets/` is the right home: it is where this repo already puts machine-consumed knowledge
artifacts (`tricks.json`, `macros.json`, `factory.json`, `role-parameter-stats.json`), and every one
of them follows the same cheap loading pattern — an env override (`BEAT_TRICKS`, `BEAT_MACROS`)
plus a package-relative default plus a `parse*Library` that throws on drift.

**The relationship to `presets/recipes.json` is strictly one-directional, and this is the part that
must not be got wrong,** because the recipe library is being built right now on the
`recipe-library` branch (`src/recipes/schema.ts`, 34 KB, commit `ef7c4a65`) and `presets/
recipes.json` does not exist yet:

> **Claims are the evidence. Recipes are the build. A recipe never restates a claim; it cites one.**

Concretely, that means exactly **one** optional field added to the sibling's already-written
`RecipeSource` interface:

```ts
export interface RecipeSource {
  cite: string
  url?: string
  claim: string
  confidence: SourceConfidence
  claimId?: string          // <- the only addition: the row in presets/claims/*.jsonl this came from
}
```

and one convention on top of it: when `claimId` is present, `parseRecipeLibrary` cross-checks that
the claim exists and that its `agreement` matches the recipe's declared `confidence`. Everything
else the sibling built stays exactly as it is — `RecipeDial` already holds the contested span,
`gaps?: readonly string[]` already holds "techniques the source describes that dotbeat cannot
express — recorded, never faked," `RecipeProvenance.status` already ladders
`sourced → verified → validated | parked`, and `verify.ts` already reports `pending` gates rather
than silently passing them. **This design does not need any of that rebuilt or renamed.** It needs
the layer above it — the thing those `sources[]` entries are currently going to be hand-typed from.

What does NOT go in the claims store: build items, roadmap rows, owner errands. 140's ruling is
explicit and CLAUDE.md's own precedent agrees — a second tracking system is the wrong answer. The
claims store tracks *claims*; anything that turns into work goes into `scripts/roadmap-data.mjs`.

---

## 3. The mining protocol — a contract, not a briefing

### 3.1 The one rule that matters

**The agent that fetches the page writes the record.** No coordinator translation step, ever. The
last run put a human (or a coordinating agent) in the middle to synthesize nine prose reports, and
the fidelity loss is documented: a relayed "sub −9 dB under mid" came back inverted relative to its
own primary source. Every intermediate hop is a chance to flip a sign, drop a unit, or average two
disagreeing numbers into one that no source states.

The mechanical form of the rule: the mining agent's deliverable is **two files it writes itself** —
`presets/claims/<vein>.jsonl` (the records) and `docs/priors/<vein>.md` (its narrative). The
coordinator's job shrinks to dispatch, merge, and running `scripts/claims-report.mjs`. It never
retypes a number.

### 3.2 The prompt template

Committed at `docs/priors/MINING.md` so it is versioned and improves between waves rather than being
re-improvised. The skeleton, with the parts that are load-bearing marked:

```
VEIN: <id> — <one-sentence question this pass exists to answer>
BUDGET: <N> WebSearch queries (HARD CAP — report the count you used), <M> WebFetch calls, <T> minutes.
INDEX: presets/claims/index.jsonl — start here. Fetch from the index before searching.

You are mining production knowledge into a CLAIMS STORE. You write the records yourself.
Nobody will translate your prose into data; if it is not in the JSONL, it does not exist.

OUTPUT 1 (required): append one JSON object per line to presets/claims/<vein>.jsonl.
  Schema: <the §2.2 record, inline>.
  - Every claim needs a `predicate` if one is possible. A claim with a number but no stated,
    falsifiable prediction can never be verified and is worth roughly a third of one that has one.
  - Express `params[].field` in dotbeat's REAL field names (list supplied inline: SYNTH_FIELDS,
    EFFECT_TYPES, DRUM_LANES). If the technique needs a parameter dotbeat does not have, still
    write the claim, set `params: []`, and name the missing capability in `inexpressibleReason`.
    Do NOT approximate it with the nearest field we happen to have.
  - Do NOT set `agreement` — it is computed from your sources.
  - `sources[].quote` is REQUIRED for any claim carrying a number: <= 25 words, verbatim, the
    sentence the number came from.

OUTPUT 2 (required): docs/priors/<vein>.md — your narrative, reasoning, dead ends, and the
  argument behind the numbers. This is for humans. It is not the deliverable an agent reads.

OUTPUT 3 (required): append to presets/claims/index.jsonl every URL you touched, including the
  ones that FAILED — {url, domain, title, vein, status: 200|403|429|paywall|blocked, retrieved}.
  A 403 you record is budget the next pass does not spend.

DISAGREEMENT: never average. If two sources give different values for the same field, emit ONE
  claim with both sources and both `value`s and a `contested.span` covering the full range. The
  midpoint of two disagreeing sources is a number no practitioner has ever used.

STOP when: <the vein's stopping rule from §6>, or the budget is out. Report which.
FINAL REPORT: claims written, sources fetched, searches used, blocked URLs, open leads.
```

### 3.3 Source quality — a closed vocabulary

`sources[].kind`, ranked, replacing the three vocabularies that emerged last time:

| kind | what it means | may it solely support a number? |
|---|---|---|
| `manufacturer-doc` | a synth/plugin manual or official docs (iZotope Neutron manual, Roland articles) | yes |
| `publication` | named outlet with editorial staff — Sound on Sound, MusicTech, Attack Magazine, MusicRadar | yes |
| `practitioner-named` | a named producer/engineer describing their own work (W.A. Production's Roman Trachta on his master chain) | yes |
| `course` | paid/structured instruction — Syntorial, FaderPro, Sonic Academy | yes |
| `video-transcript` | a tutorial video's own words | yes, with timestamp |
| `forum` | KVR, Gearspace, subreddits — practitioner voice, no editorial check | **only as corroboration** |
| `aggregator-seo` | SEO/AI-generated roundups, no named author, no primary reporting | **never** |

`practitioner` is orthogonal: `named-professional | editorial-staff | anonymous | unknown`.

The rule that makes this do work: **a number entering a recipe needs at least one source that is not
`forum` or `aggregator-seo`.** `pack-production.md` got this right by instinct — it marked
plugg-supply.net as *"[UNVERIFIED — LOW TRUST], reads like AI-generated aggregator content"* and
refused to cite its numbers as fact. That instinct becomes a parser check.

### 3.4 Disagreement is data, not noise

The corpus already proves the value of recording it. `bass-basseries.md` §Contradictions preserved
seven live disagreements, of which the detune one — "±27 (#1), ±30 (#3), ±55–61 (#2), asymmetric
−30/+50 (#4), ±7 (#5)... #2 and #14 both claim to describe DnB/jungle Reese but disagree by roughly
5x" — is precisely the dispute that 141 then **settled by measurement**. Had that agent averaged to
"about ±30 cents," we would have shipped the 87th percentile as the default and never known.

The protocol rule is therefore absolute: **never average, never pick, always span.** When a measured
artifact later adjudicates, the *measured median becomes the value and the prose span becomes the
dial* — which is exactly the shape the sibling's `RecipeDial { value, range }` already encodes.

### 3.5 The search budget — design for exhaustion, because it is the normal case

The evidence: **five of nine files report WebSearch exhaustion mid-task**, all attributing it to a
budget shared across the parallel fleet. `chords-pads.md` explicitly downgraded its own numbers as a
result ("individual source pages were not deep-fetched due to session WebSearch budget exhaustion,
so treat exact numbers... as reported-consensus rather than independently re-verified").
`pack-production.md` fell back to fetching DuckDuckGo HTML result pages as a search substitute.

Three mechanisms, in order of how much they matter:

1. **Split discovery from extraction into two waves.** Wave 0 is **one** agent whose entire job is
   to spend the search budget building `presets/claims/index.jsonl` — URL, domain, title, guessed
   vein, HTTP status — and to write **zero claims**. Wave 1 is N agents that run **WebFetch-only**
   against that index. The owner named fetch-from-index as a fallback; the evidence says make it the
   primary path. It also makes the budget *reusable*: a second pass over the same vein starts from
   an index that already exists and only fetches what is new or stale.
2. **Per-agent hard caps, self-reported.** If a wave must search, the prompt states a cap (10
   queries is a reasonable start) and requires `searchQueriesUsed` in the final report. Today,
   exhaustion is unattributable — nobody knows which of the nine agents drained it. Cap the
   concurrent searching fleet at four.
3. **Record failures as first-class rows.** Reddit is blocked at the tool level; `floriangouello.com`
   429s across four retries; `pointblankmusicschool.com` 403s. Those belong in the index with their
   status codes so the next wave neither retries them nor rediscovers them. Roughly a dozen such
   dead ends are currently buried in prose at the bottom of two files.

---

## 4. The verification loop — how a claim becomes knowledge

This is the heart, and the reason to build any of the rest. The corpus's value is not that it holds
90 recipes; it is that it can hold the *sentence* "we tried this and it does not work in our
engine," permanently, where the next agent will find it.

### 4.1 The pipeline

```
claim
  │
  ├─ A. EXPRESSIBILITY TRIAGE      params[].field ∈ SYNTH_FIELDS ∪ EFFECT_TYPES ∪ DRUM_LANES ?
  │      no  → status: inexpressible   (+ inexpressibleReason; feeds the feature backlog, §4.4)
  │
  ├─ B. PREDICATE TRIAGE           predicate metrics ∈ FEATURE_KEYS, at a resolution we can see?
  │      no  → status: unmeasurable    (+ why: pending-key | band-edge | no-predicate)
  │
  ├─ C. PROBE                      build A/B, render offline, analyze(), screen()
  │      screens fire on the treated arm → status: refuted (introduces a pathology)
  │
  ├─ D. EVALUATE PREDICATE         expect-clauses on the delta, gate-bands on the treated arm
  │      holds   → status: verified   + verification receipt (both feature vectors, delta, commit)
  │      inverts → status: refuted    + REQUIRED refutation note with the measured before/after
  │
  └─ E. THE EAR                    only for recipes, never for individual claims (§4.3)
         a recipe whose load-bearing claims are `verified` enters `beat showdown` as an arm;
         its blind win rate lands in provenance.blindRecord.
```

### 4.2 What can be auto-verified — and the probe that does it

**The rule:** anything expressible as parameters plus a measurable prediction. That is stage C+D,
and every primitive it needs already exists in the repo:

| need | what exists | where |
|---|---|---|
| build A/B variants of one clip | `layeredArchitecture` / `buildLayeredClip` / `applyProductionTreatment` | `src/taste/layered.ts`, `src/taste/showdown.ts` |
| render many variants cheaply | `startMatchRenderSession` — boot Chromium once, hot-swap a scratch `.beat`, capture WAV in memory | `cli/render.mjs:705` |
| render one layer in isolation | `beat render --stems` (true mixer solo per track) / `soloForShowdown` | `cli/render.mjs:564` |
| fair comparison | `normalizeBatchLoudness` — the same batch-level LUFS match the showdown uses | `src/taste/showdown.ts` |
| measure | `analyze()` → `MixMetrics`; `featuresForAudioFile()` → the 13-key vector | `src/metrics/analyze.ts`, `src/taste/features.ts` |
| reject defects | `screen()` — 9 pathology kinds: `arrangement-flatness`, `click`, `dc-offset`, `mono-collapse`, `resonance`, `mud`, `crest-collapse`, `dead-air`, `sub-rumble` | `src/metrics/screens.ts`, `beat lint --screens` |
| the whole loop, precedent | `scripts/layered-check.mjs` — builds N clips per role, renders **three arms** holding figure/key/tempo constant, loudness-normalizes the triple together, measures with the same `analyze()`, checks per-role targets, writes `results.json` | `scripts/layered-check.mjs` |

`scripts/layered-check.mjs` is the design already written. A claim probe is that script with the
arms parameterized by a claim instead of hard-coded, which is why §9's build plan is small.

**Corroboration against measured artifacts (stage B′).** Where a claim's field has a measured
distribution, compute the percentile rather than asserting agreement. 141 already implements the
primitive (`compare2.py:pctl`, eight lines) and demonstrated it on five tutorial detune claims at
once. The stats artifact carries per-role `{n, min, p10, p25, median, p75, p90, max}` blocks for
envelope times, cutoff, resonance, unison voices and detune, oscillator counts, and effect presence,
plus a `pooledUnisonDetuneCentsByVoiceCount` table keyed `"2"`…`"16"`. Two cautions the artifact
itself states and the corroborator must honour: Surge's `resonance` is a 0–1 knob and **not**
comparable to dotbeat's `Tone.Filter` Q, and effect percentages are *presence, not audibility*
(a bypassed delay counts). `measuredCheck.verdict` must be allowed to be `silent`.

**The three reasons a claim is `unmeasurable`, all real, all worth naming separately:**

- **`pending-key`** — the predicate names a metric 131 measured as an actual discriminator that
  `FEATURE_KEYS` does not compute: `attackMedMs`, `fluxMean`, `crestSubDb`, `flatnessHiDb`,
  `onsetRatePerSec`. `src/taste/layered.ts` already carries the exact list as
  `UNMEASURABLE_TARGETS`, each with a `why` — the precedent for reporting rather than passing. Note
  this is a *moving* blocker: a rich 36-key extractor (`src/metrics/rich.ts`, `analyzeRich`) exists
  in the `critic-instruments` worktree and the v2 `.features.json` sidecars under
  `examples/taste-t1/` already carry `attackMedMs`, `fluxMean`, `crestSubDb`, `flatnessHiDb`,
  `widthMeanDb` and 31 others. So `unmeasurable/pending-key` is a **queue**, and re-running the
  probe when that lands is the correct behaviour — which is why `verification` stores the commit.
- **`band-edge`** — a new observation this pass, and it will bite immediately. The corpus's
  best-triangulated single number is a **75–100 Hz** sub/mid crossover (three independent figures:
  75, 79, 90–100). Our spectral bands are `sub < 60 Hz`, `bass 60–250 Hz` (`src/metrics/analyze.ts:
  121-127`). A claim about a 90 Hz crossover lives *entirely inside* one band and is invisible to
  `bandSubPct`/`bandBassPct`. The fix is not a new global feature key; it is a claim-scoped band
  measurement in the probe (energy above/below the claim's own frequency), computed for that probe
  only. Until that exists, these claims are honestly `unmeasurable`.
- **`no-predicate`** — the claim asserts something with no stated consequence. `layering.md`'s
  "duplicate the character layer's LFO settings across all layers" is a real, actionable, and
  entirely untestable-by-metric instruction. These are still worth storing; they are just not
  auto-verifiable.

### 4.3 What needs the owner's ear — and the rule that individual claims never get it

The strong recommendation, stated plainly because it is a real design choice and I may be wrong:
**a claim is too small to hear. Claims are never blind-rated; recipes are.**

The reasoning is the taste program's own economics. Owner rating time bought 1,612 pairwise
preferences across 177 batches — the program's scarcest resource by a wide margin, with a measured
test-retest ceiling of 0.917. A single claim ("high-pass the mid layer at 85 Hz") produces a
difference that is often below that ceiling; spending a batch on it is spending the scarcest thing
we have on the least informative comparison available. A *recipe* — four layers, a chain, a figure —
is a difference the ear can actually rank, and the showdown already has the machinery: seeded
`v1..vN` permutation at build, a second re-shuffle in `beat rate`, LUFS matching, BPM conform,
duration match, top-3 ranked picks with an explicit "none are good" verdict, all landing in
`beat-scores.jsonl`. Per D24, un-blinding is a hydra and *"owner listening IS the audit."*

So the ear's job in this pipeline is narrow and well-defined: **it arbitrates recipes, not claims,
and it is the only thing that ever says "better."** Per 139 §1.3's ruling, which this design adopts
unchanged — *metrics may reject and verify; they may pre-filter at low pressure; they may never rank
the survivors.* A `verified` claim means "the parameter did what the source said it would do." It
does not mean "this sounds good," and the status vocabulary should never be read as if it did.

The claim classes that are *inherently* ear-only, and should be tagged `arbiter: "ear"` so nobody
builds a probe for them: aesthetic thresholds ("detune until it just starts to sound a little out of
tune" — stated near-verbatim by two independent sources and genuinely the best available form of the
instruction), genre-appropriateness, character judgements ("distortion here brightens rather than
warms" — which `bass-basseries.md` found framed in *opposite* directions by different sources), and
the anti-layering rule ("three well-crafted layers usually sound better than seven fighting for
space").

There is one cheap intermediate worth naming: `beat lint --screens` on every probe render, before
anything reaches a batch. Its nine pathology screens cost nothing and exit non-zero at severity ≥3.
That is 138 B2's rule — *never spend owner ratings on a clip that missed its own targets* — for the
price of a flag we already ship.

### 4.4 What is inherently unverifiable — and why it is still worth storing

Four classes, all present in the current corpus:

- **Workflow/process claims.** `drums.md`: "tune the kick LAST, against the bassline, not the other
  way round." Real advice, no parameter, no metric. Its value is as an *agent instruction*, not a
  gate.
- **Provenance/history claims.** The KVR debate over whether the original supersaw was seven detuned
  JP-8000 oscillators or a single Juno through a 3-voice chorus. Interesting, occasionally
  load-bearing for naming, never testable here.
- **Claims about other tools.** "Massive's 1Env pitch modulation amount: 60.00," "Serum glide at
  halfway on the dial." Roughly a third of `drums.md`'s recipes are keyed to a plugin's own knob
  positions. These are `inexpressible` unless someone does the translation work — and 141's warning
  about Surge resonance vs. `Tone.Filter` Q is the standing reminder that cross-engine parameter
  translation is a research task, not a rename.
- **Performance-gesture claims.** `leads.md` found two credentialed sources arguing explicitly that
  acid patches are defined by real-time knob performance rather than static values — Attack
  Magazine's *"preferably done hands-on in real time"* and NI's "parameter automation over static
  settings" — and flagged this as *"a structural mismatch with a prior library built from fixed
  values."* That is the corpus telling us to build automation-capture, not to mine harder.

**The `inexpressible` pile is a feature backlog, ranked by demand.** Count claims by
`inexpressibleReason` and the top of that list is the engine's own gap list, derived from what
practitioners actually do rather than from what we imagined. From this corpus, plausible early
entries: per-band mid/side processing, oscillator phase hard-sync to 0° on every gate (`layering.md`
calls this *"the single most actionable, non-obvious fact in this entire research pass"*), multiband
saturation with a user-set split frequency, and a transient shaper with attack/sustain in dB. That
is a real output, and it is invisible in prose.

### 4.5 Should this mirror the taste program? Yes, with one change — argued

The taste program's proven pattern (D24–D27, `docs/source-showdown-eval.md`):

| stage | taste program | mining system |
|---|---|---|
| collect | `beat showdown` builds blinded, loudness/BPM-matched batches; zero owner input | wave-0 index + wave-1 mining agents write claims |
| measure | **the owner's ears** — the only ground truth | **the machine** — triage, probe, `analyze()`, `screen()` |
| validate | `--report`: win rate / top-half / pairwise, smoke label below `SPLIT_SMOKE_MIN_BATCHES = 5` | `scripts/claims-report.mjs`: status histogram, domain concentration; **then** the blind showdown, for recipes |
| promote | a *new named* profile (never an edit — the frozen-science rule), a curated asset file, a `decisions.md` entry | a recipe in `presets/recipes.json` citing `claimId`s, version-bumped on any number change |

The shape transfers cleanly, and three of its disciplines transfer *verbatim* and should be adopted
without discussion: **frozen science** (a changed number mints a new version; the old one stays
attributable — the sibling schema already implements this), **an explicit small-n label** (the
program's `SPLIT_SMOKE_MIN_BATCHES = 5` has an obvious analogue: a vein with fewer than N claims
prints "smoke, not evidence"), and **pre-registration** (140 §2-D23's finding that *"unrecorded
pre-registrations are what ratchets are made of"* applies exactly as much to a mining wave as to a
build rung — write the stopping rule before dispatching, not after reading the output).

**The one change:** insert the machine measure *before* the ear, because the resource ordering is
inverted. In the taste program, candidates are expensive (a fal generation, a Chromium boot) and
judgements are cheap-ish per unit; the owner's ears are the bottleneck but there is nothing cheaper
that could stand in. In mining, claims are nearly free — one fleet produced 402 numeric lines in an
afternoon — and the ear cannot possibly scale to them. So the machine does the rejecting (which 139
§1.3 explicitly licenses metrics to do), and the ear only ever sees things that already passed. Note
this is not a new mechanism: it is the rule 138 B2 wrote and nobody built, and 140 lists it as
dropped item D17.

---

## 5. Coverage — the vein registry, and the next fifteen

### 5.1 The registry

`presets/claims/veins.jsonl`, one row per vein, so the second wave is incremental rather than a
repeat. Today there is no record at all of what was mined, at what depth, or when — the README's
index table is nine rows of prose with no dates, no costs, and no open leads.

```jsonc
{
  "id": "layering", "title": "Per-role layer architectures",
  "question": "How many layers per role, at what crossovers, at what relative levels?",
  "status": "mined",                 // open | in-flight | mined | saturated | parked
  "depth": "survey",                 // survey | deep | saturated
  "passes": [ { "at": "2026-07-26", "wave": "fleet-1", "claims": 0, "searches": "exhausted", "agent": "unknown" } ],
  "claims": { "total": 0, "verified": 0, "refuted": 0, "unmeasurable": 0, "inexpressible": 0 },
  "domains": { "distinct": 26, "topShare": 0.46, "top": "attackmagazine.com" },
  "openLeads": [
    { "url": "https://www.attackmagazine.com/.../layering-vinyl-drum-breaks-with-oeksound-soothe2/", "why": "title found, content not fetched" },
    { "url": "https://blog.techne.fm/posts/how-to-kick-sound-design-before-mixing/", "status": 502 }
  ],
  "nextAction": "chords/pads is this vein's weakest role — no canonical numeric recipe found; re-mine that role only."
}
```

The `openLeads` array alone justifies the file: roughly a dozen named, specific, high-value dead
ends are currently buried in prose footers and will be rediscovered at full cost by the next wave.

### 5.2 The ranking rationale, stated before the list

Five criteria, weighted in this order:

1. **Does it target a MEASURED gap?** 131 measured where our output actually differs from
   commercial loops. A vein aimed at a measured discriminator beats a vein aimed at something we
   have no evidence is wrong. Highest weight by a distance.
2. **Is it expressible in dotbeat's fields today?** A vein whose claims are 80% `inexpressible`
   produces a feature backlog, not a recipe library. Both are valuable; only one is what was asked
   for.
3. **Is it auto-verifiable?** Claims with metric predicates convert to knowledge for free. Claims
   without one sit at `unverified` forever and cost owner attention to resolve.
4. **Does the literature actually carry numbers?** This is not hypothetical: a sibling pass searched
   exhaustively and found that **no tutorial source states lead/pluck attack times in
   milliseconds** — it is entirely qualitative. A vein whose literature is all adjectives is a bad
   vein regardless of how interesting it sounds, and 141 is the proof that the right response is to
   go measure a different corpus instead.
5. **Is it upstream of something being built now?** Recipes and the layered arm are live. A vein
   that feeds them lands; a vein that feeds nothing waits.

### 5.3 The next fifteen, ranked

| # | vein | why it ranks here | verifiable? |
|---|---|---|---|
| 1 | **Arrangement & song structure** | dotbeat's unit is a song, and this is the largest zero-coverage area in the corpus. `analyzeSections`/`arc.ts`/`diffArc` and the `arrangement-flatness` screen already exist — that screen currently fires against a threshold with **no prior behind it**. Section-level metrics make claims directly checkable. | high |
| 2 | **Motion, sidechain & pump dosage** | 131 P3 named flux/motion as a measured discriminator, and 140 found 118 shipped **15 of a 22-trick spec where "the 7 missing are *all* motion tricks"** — a hole we can point at. `duckSource`/`duckAmount`/LFO fields all exist. | high |
| 3 | **Inter-role level & spectral balance in a mix** | The "sub −9 dB under mid" class. Directly feeds the never-built `role-targets.json` + `beat rolecheck` (verified this pass: `rolecheck` has **zero matches in code**). `beat render --stems` gives true per-role solos, so predicates are measurable per track. | high |
| 4 | **Groove, swing & humanization** | Already yielding: `drums.md` produced swing bands per sub-genre (jackin' house 60–65%, dusted deep house 70–80%), velocity tiering (hats 10–15%, kick/snare 5–8%, ghosts 40–60%), and 5–20 ms micro-timing. `beat humanize`/`quantize` exist; predicates are symbolic (`analyzeStructure`), so no render is even needed. Cheapest verification in the list. | high |
| 5 | **Effect-chain order & dosage per genre** | 141 gave *presence* (delay 50.0% of all patches, reverb1 38.5%, EQ 34.4%; lead/pluck = delay-first, bass = EQ+drive-first, pad/keys = reverb-and-chorus-first) but **patch files cannot give ORDER or dosage**. Prose is the only source, our insert chain is ordered and reorderable, and `EFFECT_TYPES` is a closed list. The clearest case where prose is strictly complementary to 141. | medium |
| 6 | **Per-genre full-track production walkthroughs** | The Beat Dissected format proved the highest yield per fetch in the whole first pass — `drums.md`'s twelve RECIPE blocks came almost entirely from one series. Yields whole recipe structures rather than orphan numbers. Risk: it is also the source of the 45.5% Attack concentration, so this vein must deliberately seek other outlets. | medium |
| 7 | **Reference-track analysis methodology** | A meta-vein: how practitioners A/B against a reference. Improves the eval itself (ref pools, `--ref` lint targets, `buildProfile`) rather than the output. Small, cheap, disproportionately useful. | medium |
| 8 | **Transitions, fills & FX** | Risers, impacts, downlifters, filter sweeps. Zero coverage today, song-level, expressible via automation + existing effects. Ranks below arrangement because it is the ornament on it. | medium |
| 9 | **Drum-bus & parallel processing (re-mine)** | `transients.md` covered this and **one of its central claims was then refuted in our engine**. A re-mine carrying the refutation in hand is a different and better pass than the first one — and it is the natural test of whether the corpus can hold a correction. | high |
| 10 | **Synth-specific patch walkthroughs, translated** | Serum/Vital/Massive/Diva step-by-steps are the densest numeric literature that exists. But every number needs cross-engine translation, and 141's Surge-resonance-vs-Q warning is the standing caution. Rank depends entirely on whether someone does the translation table first. | low until translated |
| 11 | **Famous-sound recreations** | Hoover, Reese, 808, supersaw, specific track basses. Concrete and well-documented, but `bass-basseries.md` shows the contradiction rate is the highest in the corpus (7 live disagreements in one vein) — which is fine now that contradiction is a first-class field. | medium |
| 12 | **Vocal-adjacent processing** | Chops, formant, telephone EQ, vocoding. dotbeat has audio clips, `eq7`, `resonator`, `grainDelay`. Real, but not on the measured-gap path. | medium |
| 13 | **Sampling manipulation** | **A pass is running now — do not re-dispatch.** Register it as `in-flight` so the next coordinator does not duplicate it. This row exists to make that visible. | n/a |
| 14 | **Artist/track breakdowns & interviews** | Rich narrative, low numeric density (`pack-production.md` found producer interviews *"light on production-line detail and heavy on business/creative-philosophy framing"*). Good for vocabulary and archetypes, poor for parameters. | low |
| 15 | **Mastering & release loudness** | Partly covered already, and `pack-production.md` established the key negative result: no universal LUFS spec for loops exists publicly; the convention is *pack-internal consistency*. We do not master. Lowest marginal value in the list. | medium |

---

## 6. Economics — what a pass costs, what it yields, when to stop

### 6.1 Cost

Measured for the one observed fleet: 9 vein files (README) or ~14 agents (one agent's own estimate),
one session, 2,735 lines, 165 citations, shared WebSearch budget exhausted mid-run. Per-agent cost
was not recorded by anyone — which is the first thing the vein registry fixes.

Estimated from this pass's own subagent usage as a proxy (**Medium** — one sample, different task
shape): a vein agent runs **60–100k tokens, 15–35 tool calls, 2–6 minutes wall clock** when fetching
from an index, longer when searching. A six-agent wave is therefore roughly **0.5M tokens and under
an hour**, with one shared search budget. Rendering costs, once probes exist, are the real
constraint: offline render is CPU-bound and superlinear (D22: *"1-track smoke 3.4x realtime; 8-track
96s song 0.32x at 10s, 0.12x at 30s"*), with a ~10–15 s Chromium boot amortized by
`startMatchRenderSession`. A probe is a 2-bar, 1–4 track clip — the cheap end of that curve — but a
100-claim probe sweep is still tens of minutes of render, which is an argument for triaging before
rendering, not after.

### 6.2 Yield, and telling a productive vein from an exhausted one

Five computable signals, all derivable from the store with no new instrumentation:

| signal | what it says | rough baseline from pass 1 |
|---|---|---|
| **new-claim rate** | fraction of a pass's claims whose `id` is not already in the store | undefined (no store existed) |
| **claims per successful fetch** | is the literature dense or thin here? | ~2.4 numeric lines per citation |
| **expressible fraction** | share of claims with ≥1 valid `params[].field` | unknown — **this is the number the pilot exists to produce** |
| **verified : refuted : unmeasurable** | is the vein blocked on mining, or on the feature-key ruling? | 0 : 2 : unknown |
| **domain concentration** | over-fit / exhaustion | **45.5% one domain, corpus-wide** |

### 6.3 The stopping rule

Boring and composite. Stop mining a vein when **any** of:

- **(a) Saturation** — a fresh pass returns **< 25% new claims**, or **< 3 new expressible claims**.
  Mark `saturated`, record `openLeads`, do not re-dispatch.
- **(b) Barren literature** — three consecutive successful fetches yield zero numeric claims. This
  is the `leads.md` attack-time case, and the correct response is not to search harder; it is to go
  measure a different corpus, as 141 did.
- **(c) Blocked, not exhausted** — > 60% of the vein's claims land `unmeasurable/pending-key`. The
  vein is fine; the feature-key ruling is the blocker. Park it and say which ruling unblocks it.

And one rule that stops a vein being called *done* prematurely: **a vein is not `mined` while one
domain supplies > 40% of its citations, or while it has fewer than three distinct domains.** By that
test, the current corpus is `survey` depth everywhere and `mined` nowhere.

---

## 7. Failure modes and guards

### 7.1 Folklore that measurement contradicts

Two for two so far. The guard is structural, not attitudinal: **a claim cannot enter a recipe as
`confidence: verified` until a probe has run**, and `verify.ts` already refuses `verified` status
while any gate is pending. The second guard is that **refutations are permanent rows**. `layered.ts`
carries its refutation as a code comment, which works exactly once and only for readers of that
file; in the store it is a row with `status: refuted`, a required note, and a receipt, which is
greppable by every future agent. Note the required posture, which the sibling already wrote down:
a failing gate *"is a FINDING, not a reason to widen the band."*

### 7.2 Sources that disagree with each other

Handled at three levels, and none of them is averaging: the claim records the span (`contested`),
the measured artifact adjudicates when it can (percentile), and the recipe carries the unresolved
remainder as a `RecipeDial` sweep. The worked example is already in hand — Reese detune spans ±7 to
±61 across five sources; the 3,559-patch corpus measures median 11.4 ¢ with ±61 at p97; the recipe
encodes 11.4 and keeps [7, 61] as a dial. A related trap the corpus documents: 141 also found the
folk rule *"wider stacks need more detune"* is simply false in the data (3 voices → 10.0 ¢,
7 → 10.0 ¢, 16 → 16.1 ¢; "essentially no relationship") — so a *derived* claim can be wrong even
when every source it was derived from is individually right.

### 7.3 Over-fitting to one genre or one publication

Two measured concentrations, both currently unguarded: **45.5% of citations from one domain**, and
**all nine veins are scoped to electronic dance music** — acoustic sources appear only as ingredients
inside an electronic arrangement (a layered acoustic hat, "synth + acoustic strings" on a pad), never
as a context of their own, and the genre vocabulary clusters hard on house/techno/DnB. Guards: the
domain-concentration rule in §6.3, the derived-`agreement` rule in §2.3 (which makes three articles
on one domain count as `single-source`, not `consensus`), and a `genres[]` coverage column in the
vein registry so the skew is at least visible. This is a case where the honest answer is "it is
fine for now" — the eval's reference pool is dance loops and D26 set the direction as
synthesis-toward-commercial-dance — but it should be a recorded choice rather than an accident.

### 7.4 Stale claims as the tools change

Three mechanisms, ascending in cost:

- **Loud breakage on rename.** `parseClaimLibrary` validates every `params[].field` against the live
  `SYNTH_FIELDS`/`EFFECT_TYPES` at load time, so a field rename breaks CI rather than producing a
  silently-wrong recipe. This is `src/analysis/trick.ts`'s posture, adopted wholesale.
- **Verification receipts carry a commit.** `verification.commit` records the HEAD at probe time. A
  claim verified before the engine changed under it is *stale*, not *verified*, and
  `scripts/claims-report.mjs` counts them.
- **Source retrieval dates.** `sources[].retrieved` ages; a re-mine of a vein re-fetches its top
  sources and flags URLs that 404 or whose content changed.

The `unmeasurable/pending-key` queue re-runs automatically on the same mechanism when the rich
feature extractor lands.

### 7.5 Provenance and licensing hygiene

The corpus stores **facts and citations**, not text. Concretely: `quote` is capped at 25 words and
required only for numeric claims; no full-article text, no bulk scraping, no paywall circumvention
(`bassculture.substack.com` was correctly left alone); every source carries a URL and a retrieval
date so any claim is auditable back to its origin. The repo's existing posture is the precedent —
D25 keeps commercial MIDI transcriptions private and gitignore-gated, and the shared scores log is
kind-only by licensing design. One rule inherited from it: **a claim derived from a ToU-restricted
artifact inherits that restriction** — if a number came from a Splice-licensed pack analysis, the
claim carries the same training-exclusion flag the ref pool does. And the corpus records only what
practitioners *say*; it never stores their audio.

### 7.6 The tail evaporating — the failure this whole design is trying not to repeat

140's numbers: **~99 of ~200 recommendations (49%) DROPPED** across docs 114-130; **0 of 10** docs
130-139 cited by any roadmap row; and the mechanism named exactly — *"work is dispatched as
`wave-*`/`fix-*` streams scoped to a doc's headline, and a stream's definition of done is its own
headline, not the doc's tail. **The tail has no home, because the tail was never filed as rows.**"*
The shape is consistent: 118 shipped 15 of 22 tricks and the 7 missing were all one axis; 130 went
W0 9/9, W1 4/5, **W2 0/10, W3 0/5**; 138's ladder *"was climbed from the top."*

The guard is the corpus's own shape, and it is the strongest argument for a store over prose:
**a claim IS a row.** It has a status with a lifecycle, so `unverified` is a *countable population*
that shows up in a report, not a bullet in the middle of a 400-line file that nobody opens twice.
Three supporting rules, each lifted from 140's own remedies:

- **Never conflate mined with verified.** 140's sharpest process finding is that a roadmap row
  marked `done` conflated *building the adapters* with *running the bake-off*: *"**A `done` row is
  why nobody looked again.**"* Hence per-claim `status` and per-vein `depth` are separate fields
  that can never be collapsed into one "done."
- **Do not build a second tracker.** Claims live in the claims store; build work goes in
  `scripts/roadmap-data.mjs`, the tracking system of record; decisions and pre-registrations go in
  `decisions.md`. 140 is explicit that a new tracker is the wrong answer, and CLAUDE.md already set
  that precedent for usability findings.
- **File the pre-registration before the wave, not after.** *"Unrecorded pre-registrations are what
  ratchets are made of."*

---

## 8. Honest gaps

- **Nothing here was built or run.** Every cost figure is an estimate from one observed fleet plus
  this pass's own subagent usage; treat §6.1 as Medium at best.
- **The single biggest unknown is the expressible fraction**, and I deliberately did not guess it.
  Nobody knows what share of 402 numeric claims can be written in dotbeat's field names with a
  metric predicate attached. It could be 60% or it could be 15%, and the two answers imply very
  different systems. **The pilot in §9 exists primarily to measure this number** — that is its real
  output, more than the claims themselves.
- **The band-edge mismatch (60 Hz vs 75–100 Hz) is a new observation this pass and is unvalidated.**
  I read the band edges in `src/metrics/analyze.ts:121-127` and the crossover triangulation in
  `layering.md`, and inferred the consequence. Nobody has tried to verify a crossover claim yet.
- **"Claims are never rated, recipes are" is a judgement call, not a measurement.** It follows from
  the owner's 0.917 test-retest ceiling and the scarcity of rating time, but it is possible that
  some single claims (a mono-below-100 Hz rule, say) are audible enough to be worth a batch. If so,
  the design accommodates it — it just is not the default.
- **I did not resolve the `FEATURE_KEYS` ruling and this design deliberately routes around it.**
  Two agents have already declined it; a third declining is not progress. What this design adds is
  a *number* to the argument: the count of claims sitting at `unmeasurable/pending-key` is a direct,
  concrete measure of what the ruling costs, which is more than the debate has had so far.
- **The nine existing vein files cannot be losslessly backfilled.** The agents that fetched those
  pages are gone; anything transcribed now is a relay, which is exactly the step that inverted a
  sign last time. §9 handles this by marking backfilled claims `relayed: true` and requiring the
  `quote` field, but a relay with a quote is still weaker than a first-party record.
- **`presets/role-parameter-stats.json` has no in-repo regeneration path.** Its pipeline lives in a
  scratch directory outside the repo with hard-coded absolute paths. Any design that leans on it for
  corroboration should promote that pipeline into `scripts/` or `python/` first, or accept that the
  artifact is a one-off snapshot.

---

## 9. Build plan — the smallest thing genuinely better than what we did

### M1 — the store and one honest measurement (the minimum)

Five pieces, all boring, none of them a new subsystem:

1. **`presets/claims/<vein>.jsonl`** — the store, JSONL, one shard per vein.
2. **`src/recipes/claims.ts`** — `parseClaimLibrary(json)`, ~200 lines, modelled line-for-line on
   `src/analysis/trick.ts`: eager validation of every `params[].field` against live `SYNTH_FIELDS`/
   `EFFECT_TYPES`/`DRUM_LANES`, every `predicate` metric against `FEATURE_KEYS`, and **`agreement`
   derived from distinct source domains** rather than read from the file. Lives beside the sibling's
   recipe modules because it is the same library's upstream half.
3. **`docs/priors/MINING.md`** — the §3.2 prompt template and output contract, committed and
   versioned so wave 2 improves on wave 1 instead of re-improvising it.
4. **A backfill wave: 3 agents, the three highest-numeric-density veins** (`bass-basseries` 76
   numeric lines, `transients` 65, `layering` 47), converting only claims that carry **both a number
   and a URL**, marked `relayed: true`, with the `quote` field mandatory. Target ~60–80 claims. Their
   real deliverable is not the claims — it is the **expressible fraction**, reported per vein.
5. **`scripts/claims-report.mjs`** — status histogram, per-vein counts, domain concentration,
   duplicate-id check. Under 100 lines. This is the thing that makes the tail visible.

Plus one line elsewhere: `claimId?: string` on the sibling's `RecipeSource` interface, so the recipe
library can cite instead of restate the moment it lands.

**Cost:** roughly one build session plus three backfill agents (~0.3M tokens, under an hour). No new
CLI verb, no new metric, no render, no owner time.

**What it unblocks:** recipes stop hand-copying prose (the step that already inverted one sign); we
learn what fraction of mined knowledge is actually expressible, which is currently unknown and
determines whether veins 1–5 in §5.3 are worth dispatching; the URL index makes wave 2 cheaper than
wave 1; and `unverified` becomes a countable population instead of a prose bullet.

**Explicitly out of scope for M1:** a `beat claims` CLI verb, any UI, an LLM auto-verifier, and any
attempt to resolve the `FEATURE_KEYS` ruling.

### M2 — the probe (only if M1's expressible fraction justifies it)

`scripts/claim-probe.mjs --claim <id>` — `scripts/layered-check.mjs` with the arms parameterized by
a claim instead of hard-coded: build control and treated variants from one figure/key/tempo, render
both through `startMatchRenderSession` (one boot, many renders), loudness-normalize the pair
together, `analyze()` both, run `screen()` on the treated arm, evaluate the predicate, write
`verification` back to the claim row with the commit. Flips claims to `verified`/`refuted` and turns
`refuted` into a permanent, greppable artifact.

**Gate:** build this only if M1 reports ≥ 30% of claims expressible with a predicate. Below that,
the honest next move is the feature-key ruling or a translation table for other synths' parameters —
not more mining.

### M3 — the ear, reusing everything

A recipe whose load-bearing claims are `verified` enters `beat showdown` as an arm; its blind win
rate appends to `provenance.blindRecord`. No new rating surface, no new log — `beat rate` and
`beat-scores.jsonl` already do this, and D24's blinding disciplines already apply.

### The pre-registration, filed here so it is on the record

**Wave 2 succeeds if:** ≥ 30% of backfilled claims are expressible with a metric predicate, ≥ 3
claims flip to `verified` or `refuted` under M2, and no vein exits the wave above 40% single-domain
concentration. **It fails if** the expressible fraction is under 15% — in which case the corpus is
telling us that internet prose is a source of *structure and vocabulary* but not of *numbers*, that
141's read-the-artifacts approach is the one that scales for parameters, and that this system should
be scoped to structure, recipes and the feature backlog rather than to values.

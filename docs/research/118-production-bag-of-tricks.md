# Research 118 — the production bag of tricks: encoding real production moves so an agent can apply them

*2026-07-21. Commissioned as the operational half of `docs/research/115-production-layer-techniques.md`
(115 established WHAT produced tracks do and that dotbeat's engine already owns most of the DSP —
unison, chorus, width, sends, autoPan, LFOs, sidechain duck — while nothing in the generation path
ever sets it). This doc designs the mechanism: production moves researched from real practice,
encoded as verifiable "tricks" an agent can pull from mid-task. Coupled doc:
`docs/research/119-production-task-evals.md` (the production-transform eval there is the blind test
of this catalog). Designed against main @ b7d8d18 (post-PR-26 archetype bank, post-genSubjectVaried,
first full-credibility showdown scoreboard: ref 94% pairwise >> gen 70% >> keymap 13% ≈ engine 4%;
engine renders literally mono at -52 dB width, 0.22% air-band vs ref 1.89%, Audiobox PC 2.1 vs 4.5).*

**Read first:** research 115 (the raw material — this doc operationalizes it, it does not re-argue
it), `docs/format-spec.md` (the vocabulary every recipe must be written in), research 17 (fx
arsenal), `src/core/macro.ts` + `presets/macros.json` (the existing knob→N-params tooling this
extends), `src/taste/features.ts` (`FEATURE_KEYS` — the measurable state preconditions bind to).

## Headline

**A trick is a preset with preconditions and a receipt.** dotbeat already has the two lower rungs
of this ladder — presets (a bag of `set` edits, no conditions) and macros (a knob resolved to N
`set` edits, kind-checked only) — and the house discipline for both: tooling-not-grammar (D9),
resolve to literal lines, validate eagerly against the same `SYNTH_FIELDS`/
`AUTOMATABLE_SYNTH_PARAMS` tables everything else uses. The trick layer adds exactly three things:
(1) **machine-readable preconditions** over the metric vector the eval loop already computes
(`FEATURE_KEYS`: `stereoWidthDb`, `bandAirPct`, `crestDb`, ... — so "this track is mono and
shouldn't be" is a computable fact, not vibes); (2) **a multi-verb recipe** (not just `set` — also
`effect-add`, `automate`, macro application, hit edits); (3) **a declared expected delta** on those
same metrics, which makes every trick verifiable in CI and evaluable blind in research 119's
production-transform task. Delivery is a hybrid: a validated `presets/tricks.json` library behind
`beat trick list/show/apply/suggest`, plus a generated (never hand-edited) agent-facing reference
doc — the roadmap-data.mjs → product-roadmap.md pattern applied to production knowledge.

---

## 1. The trick representation

### 1.1 Anatomy of a trick

Every trick carries seven parts. The first four are machine-readable; the last three are prose the
agent reads (and the generated reference surfaces):

| part | type | what it is |
|---|---|---|
| `name` | slug | e.g. `unison-spread`, `reverb-throw` — same naming rule as macros |
| `slots` | declared inputs | what the recipe is parameterized over: a `track` (with a required role/kind constraint: `synth`, `drums`, `non-bass`, `pad-or-lead`, ...), optionally a `clip`, optionally numeric knobs with defaults |
| `when` | measurable preconditions | clauses over `FEATURE_KEYS` of a render (`stereoWidthDb < -30`, `bandAirPct < 0.8`) AND over document state (`unisonVoices == 1`, `sendReverb == 0`, `duckSource == none`, track kind, note density). Both are computable today: the metric side from `beat metrics --json`, the document side from the parsed doc |
| `recipe` | ordered edit steps | literal edits in the real format vocabulary (§1.2) — every step resolves through existing edit primitives, and the file afterwards contains only ordinary lines |
| `expect` | declared delta | which metrics should move, which direction, roughly how much: `stereoWidthDb: up (>= +6)`, `bandAirPct: up`, `lufs: ~0 (±1)` — the verification contract |
| `counter` | counter-indications | when NOT to apply: musical (never widen a sub bass), technical (LFO-vs-automation clobber, research 47 §6.1), and stacking rules ("don't stack with trick X on the same track") |
| `why` | sourced rationale | 1-3 sentences with the research-115 section or URL + confidence label — the part that keeps the catalog honest and auditable |

Two representation decisions, argued:

- **Preconditions are advisory gates, not hard locks.** `beat trick apply` warns (and `--force`
  proceeds) when a `when` clause fails, rather than refusing — the agent may know context the
  metrics don't (a deliberately mono lo-fi aesthetic). But `beat trick suggest` (§3.4) only
  proposes tricks whose preconditions PASS, which is where preconditions earn their keep: they turn
  the catalog into a checklist the agent can run against a render. This mirrors the critic's
  "advisory, never auto-adopts" stance in `docs/taste-loop-design.md`.
- **Expected deltas are directions with soft magnitudes, not point targets.** The showdown numbers
  give real reference anchors (ref chops: width ≈ -11 dB, air ≈ 1.9%), so `expect` can also carry
  an optional `target` band ("produced range: stereoWidthDb in [-25, -8]") — but the pass/fail
  contract is direction + minimum movement, because absolute values depend on the material.
  *(design judgment, medium confidence — the CI verify in §3.5 will calibrate the minimums)*

### 1.2 The recipe vocabulary

A recipe is an ordered list of steps, each one of a closed set of step kinds — all of which already
exist as edit primitives, so the trick engine composes, it never invents:

| step kind | resolves through | example |
|---|---|---|
| `set` | `setValue` (same path grammar as `beat set`) | `{ set: "$track.unisonVoices", value: 5 }` |
| `effect-add` | `addEffect` (no-op with a note if the id already exists) | `{ effectAdd: "$track", type: "utility" }` |
| `macro` | `applyMacro` from `presets/macros.json` | `{ macro: "space", track: "$track", knob: 35 }` |
| `automate` | `setAutomationPoint` (needs a `$clip` slot) | `{ automate: "$track.cutoff", clip: "$clip", points: [[0, 400], [56, 4000]] }` |
| `hits` | `addHit`/hit-pattern ops, for drum-lane tricks | `{ addHits: "$track", lane: "openhat", steps: "offbeat-8ths", velocity: 0.5 }` |
| `humanize` | the existing `humanizeNotes` op with fixed args | `{ humanize: "$track", swing: 0.55, timing: 0.1, seed: "$seed" }` |

Values may be expressions over slots and document state in a deliberately tiny language:
`$track`, `$clip`, `$bpm`, `$phraseEndStep` (last 16th of the loop), knob slots — nothing more.
The moment a recipe needs real logic ("pick the brightest hat sample"), it is not a trick, it is
gen-kit code; the catalog stays declarative so it stays validatable. *(design judgment, high
confidence — this is the macro/preset lesson re-applied: indirection stays out, resolution is a
pure function)*

**Steps and time-varying values.** Several of the best tricks (throws, sweeps, pump) are
automation-shaped. v0.9 clip automation covers them — but note the honest scope limits carried
over from research 46/47: lanes play only in song mode and only for a track's first-playing clip,
and LFO writes can clobber automation writes on shared destinations (research 47 §6.1's verified
bug). Tricks that automate carry that as a `counter` entry until the fix lands; tricks are the
first consumer that makes that fix pay for itself.

### 1.3 Verifiability is the design center

A trick is only in the catalog if applying it moves a number the eval loop already measures.
Three enforcement layers, cheapest first:

1. **Parse-time (drift guard):** every `set`/`automate` path validated against
   `SYNTH_FIELDS`/`AUTOMATABLE_SYNTH_PARAMS`, every `effect-add` type against `EFFECT_TYPES`,
   every `macro` name against the parsed macro library, every lane name against the 12-lane kit
   set — exactly `parseMacroLibrary`'s posture (`src/core/macro.ts:75`, structural validation up
   front, per-value validation at apply time via `setValue`), and exactly the `genSubject` prior
   art the task named: `showdownRole()` in `src/taste/showdown.ts:70` calls `genSubject(...)` on
   every bank reference *eagerly* "so a drifted prompt bank fails at spec time, not mid-run." A
   format rename breaks the trick library loudly at load, in CI, before any agent trusts a stale
   recipe.
2. **Apply-time:** `setValue`'s own per-value validation, slot-kind checks (a `drums` trick on a
   synth track fails, `BeatMacroError`-style), precondition evaluation with warnings.
3. **Render-time (CI + eval):** a per-trick verify — render a fixed seed project, apply the trick,
   re-render, assert every `expect` direction via `beat metrics --json`. Offline render makes this
   a few seconds per trick (D22/D23). This is also research 119's production-transform eval in
   miniature: CI asserts the *metric* moves; the blind eval asserts the *owner's ear* moves.

---

## 2. The initial catalog (v1: 22 tricks)

Sources: research 115 wherever it settled the practice (cited by section, confidence labels
inherited); targeted web research this pass where 115 was thin — arrangement, transitions, fills,
throws, pump timing (URLs in Sources, confidence labeled per trick). Recipes use only fields
verified to exist in `SYNTH_FIELDS` this pass (grep of `src/core/document.ts` field table).
Format: **name** — when / recipe sketch / expected delta / counter.

### Width (the -52 dB vs -11 dB gap — 115 §2)

1. **`unison-spread`** — *when:* synth pad/lead, `stereoWidthDb < -30`, `unisonVoices == 1`.
   *Recipe:* `set $track.unisonVoices 5`, `unisonWidth 0.7`, `osc2Level 0.4`, `osc2Detune 12`.
   *Expect:* `stereoWidthDb` up ≥ +10; `stereoCorrelation` down. *Counter:* never on bass/sub
   tracks (115 §2.2 mono discipline); mono-safe (detuned voices barely comb). *(115 §2.1, high)*
2. **`pad-chorus`** — *when:* pad/keys, `chorusMix == 0`. *Recipe:* `set $track.chorusMode
   ensemble`, `chorusMix 0.25`. *Expect:* width up, mild. *Counter:* not on percussive
   transient-critical parts (chorus smears attacks). *(115 §2.1, high)*
3. **`utility-widen`** — *when:* any non-bass synth track, `stereoWidthDb < -25`. *Recipe:*
   `effect-add utility`, `set $track.utilityWidth 0.65`. *Expect:* width up; mono-sum-safe (M/S
   scaling, 115 §2.1 table). *Counter:* pointless on a source with zero side signal — run AFTER
   tricks 1/2/4 create side content; keep ≤ 0.75 (side-heavy mixes collapse on clubs' mono subs).
4. **`reverb-bed`** — *when:* non-bass, non-kick track, `sendReverb == 0`. *Recipe:*
   `set $track.sendReverb 0.2`. *Expect:* width up (the stereo bus is decorrelated L/R),
   `bandAirPct` up slightly, `crestDb` down slightly. *Counter:* bass/kick stay dry (mud);
   the passive width bed under everything in produced tracks. *(115 §2.1, high)*
5. **`autopan-hats`** — *when:* drums or perc-role synth, `autoPanMix == 0`. *Recipe:*
   `effect-add autoPan`, `set $track.autoPanRate 0.15`, `autoPanDepth 0.5`, `autoPanMix 1`.
   *Expect:* width up via motion; PC up (time-variance). *Counter:* keep rate slow/shallow —
   fast deep autopan on the timekeeper reads as seasickness, not width. *(115 §2.1/§4.1, high)*
6. **`pingpong-echo`** — *when:* lead/pluck/stab with note gaps (density < ~1 note/step),
   `pingPongMix == 0`. *Recipe:* `set $track.pingPongTime 0.375` (dotted-8th at 120; compute
   `$bpm`-synced: `3 * 60 / (2 * $bpm)`), `pingPongFeedback 0.35`, `pingPongMix 0.18`.
   *Expect:* width up, PC up. *Counter:* dense 16th-note parts turn to wash; lower feedback there.
7. **`bass-mono-anchor`** — the guard-rail counter-trick. *when:* bass-role track after any width
   work elsewhere. *Recipe:* assert/restore `unisonWidth 0`, `chorusMix 0`, `utilityWidth 0.5`,
   `sendReverb 0`, `pan 0` on the bass track. *Expect:* `bandSubPct` unchanged, width metrics on
   the bass solo ≈ mono. *Counter:* none — this is the discipline that lets every other width
   trick run safely. *(115 §2.2, high — club delivery sums lows)*

### Air (near-zero vs 1.9% — 115 §3)

8. **`air-shelf`** — *when:* hats/lead/pad track, `bandAirPct < 1`. *Recipe:* `effect-add eq7`,
   `set $track.eq7HighShelfOn true`, `eq7HighShelfFreq 11000`, `eq7HighShelfGain 3`.
   *Expect:* `bandAirPct` up, `centroidLog2` up. *Counter:* a shelf amplifies what exists — if the
   patch's `cutoff` < ~6 kHz or the source has no top end, run trick 9/10/11 first (115 §3's
   "shelf boosts silence" point). *(115 §3.3, high)*
9. **`noise-wash`** — *when:* pad/lead synth, `noiseLevel == 0`. *Recipe:*
   `set $track.noiseLevel 0.12`; optionally `effect-add eq7` + `eq7HpOn true`, `eq7HpFreq 2000`
   so the noise sits as sizzle not hiss. *Expect:* `bandAirPct` up, `bandPresencePct` up.
   *Counter:* keep ≤ 0.15 — above that it reads as broken, not washy. *(115 §3.2, high)*
10. **`open-hat-air`** — *when:* drum track whose groove has no `openhat` hits. *Recipe:*
    `hits` step — `openhat` on the 8th-note offbeats (steps 2, 6, 10, 14) at velocity 0.5,
    `set $track.hatTone 6500`, `openHatDecay 0.5`. *Expect:* `bandAirPct` up (sustained >8 kHz
    content — the genre's default air carrier), onset density up. *Counter:* clashes with a
    ride-heavy pattern; halve velocities if `bandAirPct` was already > 1.5. *(115 §3.1, high)*
11. **`bright-cutoff`** — *when:* lead/pad with `cutoff < 4000` and `bandAirPct < 0.5`. *Recipe:*
    `macro filter-sweep knob 70` (the factory macro: cutoff + resonance together, quadIn curve).
    *Expect:* `centroidLog2` up, `bandPresencePct`/`bandAirPct` up. *Counter:* taste-searched
    darker patches may be deliberate — this is the one trick most likely to fight the taste model;
    prefer on supporting layers, not the hero sound. *(115 §3 interaction note, medium)*

### Motion & sidechain (the PC 2.1-vs-4.5 gap — 115 §4)

12. **`slow-filter-lfo`** — *when:* pad/chords track, `lfoDest == off`, no cutoff automation lane
    in the target clip (the research-47 §6.1 clobber guard, checked mechanically). *Recipe:*
    `set $track.lfoDest cutoff`, `lfoSync true`, `lfoSyncRate 2m` (2-bar), `lfoDepth 0.35`.
    *Expect:* PC up; spectral flux over time up (no single FEATURE_KEY yet — see Gaps).
    *Counter:* one intra-bar/phrase mover per track, per the layered-timeline rule. *(115 §4.1)*
13. **`section-sweep`** — *when:* song-mode project, intro/build section clip exists. *Recipe:*
    `automate $track.cutoff` on `$clip`: points `[[0, 400], [$clipEndStep, 4500]]`. *Expect:* PC
    up; per-section centroid rises (visible in `beat analyze-structure` / sections metrics).
    *Counter:* automation plays only in song mode and first-playing clip (research 46 §7.1) —
    precondition enforces song mode; don't combine with trick 12 on the same param. *(115 §4.1,
    high — "the genre's #1 automation target")*
14. **`reverb-throw`** — *when:* clip with a phrase-final note/hit; `sendReverb` otherwise low.
    *Recipe:* `automate $track.sendReverb` on `$clip`: `[[0, 0.1], [$phraseEndStep - 1, 0.1],
    [$phraseEndStep, 0.8], [$clipEndStep, 0.1]]`. *Expect:* PC up; tail energy at phrase
    boundary. *Counter:* one throw per phrase, on ONE element — throws are punctuation ("a
    momentary burst of processing... automate the send level so it spikes on the specific hit,
    then drops back"), stacking them is noise. *(high — Splice, Unison, ProduceLikeAPro; URLs in
    Sources; 115 §4.1 names send-spikes the #2 automation move)*
15. **`sidechain-pump`** — *when:* project has a drum track with kick hits + a bass or pad track,
    `duckSource == none`. *Recipe:* `set $bassOrPad.duckSource $drums`, `duckAmount 0.45`.
    *Expect:* PC up, `crestDb` up (periodic level dip); groove coupling audible. *Counter:* the
    engine's release is hardcoded 5 ms dip + 160 ms ramp (115 §4.2) — at 120-128 BPM that is the
    tight/transparent pump, NOT the deep-house breath; the classic pump wants release ≈ 200-350 ms
    (tutorial consensus: medium 100-200 ms = standard house, 200-400 ms = dramatic; quarter note
    at 128 BPM = 469 ms as the never-exceed). Until `duckRelease` ships (115 P3), this trick
    delivers the subtle tier only — say so in `why`, don't oversell. *(high on settings — CMUSE
    calculator, benrainey, Quadrophone; the 60000/BPM formula)*
16. **`tremolo-motion`** — *when:* sustained chord/pad, no amp modulation. *Recipe:*
    `effect-add tremolo`, rate synced-ish to 8ths (`$bpm / 30` Hz), depth 0.3, mix 1. *Expect:*
    PC up; adds the rhythmic-gate feel without note edits. *Counter:* redundant with
    `sidechain-pump` on the same track — pick one amplitude mover. *(115 §4.1, medium)*
17. **`layered-timeline`** — the composition rule as a meta-trick (a checklist, not new edits):
    a produced section runs one slow mover (trick 13), one medium (trick 12 or 5), one event-rate
    (trick 14) — on DIFFERENT tracks/params. `beat trick suggest` uses it as a stacking policy:
    propose at most one trick per rate-class per project pass. *(115 §4.1's "stacking of rates is
    what reads as complexity", medium-high)*

### Glue & character (115 §1/§5)

18. **`glue-saturation`** — *when:* any synth track carrying the mix's harmonic center,
    `saturatorMix == 0`. *Recipe:* `set $track.saturatorCurve warm`, `saturatorDrive 0.25`,
    `saturatorMix 0.3`. *Expect:* `bandPresencePct` up (added harmonics), PQ flat. *Counter:*
    per-track only — the real glue target is the master bus, which needs 115 P4's `master` block;
    this is the available approximation. *(115 §5, high on practice / medium on approximation)*
19. **`sub-foundation`** — *when:* bass-role synth, `subLevel == 0`, `bandSubPct < 8`. *Recipe:*
    `set $track.subLevel 0.5`; keep sub mono per trick 7. *Expect:* `bandSubPct` up. *Counter:*
    check the kick relationship — if `bandSubPct` already > 20, skip (mud); the 3-layer bass stack
    is expressible in ONE track (115 §1.2). *(115 §1.1, high)*
20. **`detune-double`** — *when:* any melodic synth, `osc2Level == 0`. *Recipe:*
    `set $track.osc2Level 0.5`, `osc2Detune 7` (just-audible zone), same `osc2Type` as `osc`.
    *Expect:* width up slightly, spectral density up. *Counter:* on bass keep `osc2Detune ≤ 5`
    and re-check mono sum. *(115 §1.1 — layering slightly-altered copies, high)*

### Arrangement & transitions (thin in 115 — web-researched this pass)

21. **`drum-pull`** — *when:* song-mode, at a section boundary into a drop/chorus. *Recipe:*
    `hits` removal — delete kick (or all drum) hits in the last 2-4 sixteenths of the pre-boundary
    clip (a clip-scoped copy, not the live loop). *Expect:* onset density dips then recovers —
    the impact-by-absence move ("pulling the drums for a beat or two right before the next section
    starts, making the impact even higher when the drums return"). *Counter:* needs a
    section-scoped clip copy so the loop's other placements keep their hits. *(high — EDMProd
    turnarounds, Abstrakt Music Lab; URLs in Sources)*
22. **`snare-build`** — *when:* a build section exists (8-16 bars before a drop). *Recipe:*
    `hits` — snare on quarters for the first half of the build, 8ths, then 16ths over the final
    bars, velocity ramping 0.4 → 0.9; optionally `set` `sendReverb` rising via an `automate` step.
    *Expect:* onset density and band energy rise across the section (visible per-section in
    `analyze-structure`); the standard build grammar ("risers, snare rolls..., stripping the kick
    away near the end"). *Counter:* strip the kick for the last bar (combine with 21). *(high —
    EDMProd build-up guide)*

**Explicitly NOT in v1** (blocked on 115's format additions, listed so the catalog and the format
roadmap stay coupled): `exciter-air` (needs the `exciter` EffectType, 115 P2b), `deep-pump`
(needs `duckRelease`, 115 P3), `master-glue` (needs the `master` block, P4), `stereo-send-delay`
(needs the delay-bus stereo-ization, P5), `mono-below` (needs `utilityMonoBelow`, P5),
`riser-track` (cleanly expressible today — noise-osc track + 8-bar cutoff/pitch automation — but
it creates a track rather than editing one; deferred to v1.1 with the `beat layer` compound-edit
family, 115 P6). When a format item ships, its trick enters the same catalog and inherits the
same validation — that is the drift story working in the constructive direction too.

---

## 3. Delivery: how the agent consumes this

### 3.1 The options, compared

| option | verifiability | drift behavior | agent ergonomics |
|---|---|---|---|
| **A. Reference doc only** (a markdown file / CLAUDE.md skill the MCP agent reads) | none — recipes are prose; nothing executes or checks them | silent rot: a field rename leaves the doc confidently wrong (the exact failure genSubject's eager validation exists to prevent) | best for judgment/context, worst for correctness |
| **B. Executable library only** (`presets/tricks.json` + `beat trick apply`) | full: parse-time validation, CI render-verify, metric receipts | fails loudly at load/CI on any format change | one command; but JSON can't carry the musical judgment (when/why/counter nuance), and an agent that only sees `trick list` output learns less than one that read the reasoning |
| **C. Hybrid: library as source of truth + GENERATED reference** | full (inherited from B) | loud (inherited from B); the doc regenerates from the library so it *cannot* drift from it | both: `beat trick` for the mechanical layer, a rich generated reference for the judgment layer |

**Recommendation: C.** The house has run this exact play twice: presets/macros (validated JSON
libraries, `list --json` for tooling) and `scripts/roadmap-data.mjs` → `docs/product-roadmap.md`
("never hand-edit the .md"). Concretely:

- **`presets/tricks.json`** — the catalog, `parseTrickLibrary` in `src/core/trick.ts` mirroring
  `parseMacroLibrary`'s shape and error class, with the §1.3 layer-1 validations. Loaded by CLI,
  MCP, and CI. The prose fields (`why`, `counter`, source URLs, confidence) live IN the JSON so
  there is exactly one file to review.
- **`docs/tricks-reference.md`** — generated by `scripts/gen-tricks-reference.mjs` from the parsed
  library: per-trick when/recipe/expect/counter/why, grouped by gap axis, with a header banner
  ("generated — edit presets/tricks.json"). This is what an agent session reads for context; it is
  also a natural CLAUDE.md pointer ("before production-polishing a project, read
  docs/tricks-reference.md and run `beat trick suggest`").

### 3.2 CLI surface

```
beat trick list [--json] [--axis width|air|motion|glue|arrangement]
beat trick show <name>                      # full card: when/recipe/expect/counter/why
beat trick apply <file> <track> <name> [--clip c] [--knob k] [--force] [--dry-run]
beat trick suggest <file> [--wav render.wav] [--json]
beat trick verify [--name n]                # CI: seed project → apply → render → assert expect
```

`apply --dry-run` prints the resolved edit list (the same "resolves to literal set edits"
receipt `beat macro apply` gives) without writing — the agent's preview. `apply` prints the
before/after metric delta when a render is cheap to make (`--verify` flag), turning every
application into a measurement.

### 3.3 MCP

One tool, `beat_trick` (list/show/apply/suggest actions), mirroring the CLI — plus the generated
reference doc as ambient context. Per the standing CLAUDE.md practice, a CLI/MCP usability pilot
runs when this ships.

### 3.4 `beat trick suggest` — the closing of the loop

Render (or accept `--wav`), compute `FEATURE_KEYS` + read the document, evaluate every trick's
`when`, filter by the stacking policy (trick 17), and print the passing tricks ranked by how far
the failing metric sits from the produced range (width gap first — the measured ordering from 115
§6). This is deliberately the same shape as `beat lint --ref`: measured state vs a target profile,
suggestions not auto-edits. It is also exactly the state gen-kit's "produced defaults" (115 P1-P3)
should converge to: gen-kit applies a default trick set at creation; `trick suggest` catches what
generation and hand-editing left mono/dry/static afterwards.

### 3.5 Verification & drift, concretely

- **CI test 1 (load):** `parseTrickLibrary(presets/tricks.json)` throws on any unknown param/
  effect/macro/lane — runs in the ordinary test suite, so a `SYNTH_FIELDS` rename cannot land
  without touching the catalog (the genSubject property, inherited).
- **CI test 2 (receipts):** `beat trick verify` — per trick: fixed seed project, apply, offline
  render both, assert each `expect` direction from `beat metrics --json`. A few seconds per trick;
  tricks whose expectation can't be asserted mechanically yet (trick 17) are marked
  `verify: manual` and counted in the report so the gap is visible, not hidden.
- **Eval (the real test):** research 119's production-transform task rates original vs tricked
  clips blind through the unchanged `beat rate` flow. CI proves tricks move metrics; the eval
  proves they move the owner. Both receipts append to the same evidence trail.

## Honest gaps

- **No time-variance metric.** Tricks 12-17 target Audiobox PC and "motion", but `FEATURE_KEYS`
  is all whole-clip statics — a spectral-flux / per-section-variance feature (the
  `src/metrics/variance.ts` / sections machinery may partially cover this) should be promoted into
  the feature vector so motion tricks get a mechanical receipt too. Until then their CI verify
  leans on Audiobox PC sidecars, which is slower and noisier.
- **Settings numbers are tutorial consensus, not measured from the owner's references.** Same
  caveat as 115: the right follow-up is measuring width/air/pump-depth distributions from the
  private `taste-dataset` chops and tuning `expect` targets to them.
- **Recipe language scope is a bet.** The closed step-kind set (§1.2) may prove too small for
  arrangement tricks (21/22 already strain it with clip-copy semantics); the fallback is honest —
  promote those to compound-edit CLI commands (the `beat layer` family) and have the trick card
  reference the command, keeping the catalog declarative.
- **Stacking interactions are hand-declared** (`counter` lists), not computed. A pairwise
  render-matrix over the catalog would find bad pairs mechanically; deferred until the catalog
  stabilizes.
- Single-agent web pass for the arrangement/transition/throw/pump claims — no adversarial
  verification; confidence labels reflect source count.

## Sources

Research 115 (primary — layering §1, width §2, air §3, motion/sidechain §4, bus/master §5,
proposals §6, and its own source list). Format/tooling read this pass: `docs/format-spec.md`
(v0.3 fields, v0.9 automation, v0.10 effect chain/eq7/lanes, v0.11 placements),
`src/core/macro.ts`, `src/core/document.ts` `SYNTH_FIELDS` (field keys verified by grep),
`src/taste/features.ts` (`FEATURE_KEYS`), `src/taste/showdown.ts` (`showdownRole` eager
validation), `presets/macros.json` via `beat macro list --json`, research 17 (insert patterns,
pingPong/saturator sketches), research 27 (macro layer), research 46/47 (automation limits).
Web, this pass: CMUSE sidechain release calculator (cmuse.org/sidechain-release-time-calculator —
60000/BPM formula, 50-100/100-200/200-400 ms tiers); Quadrophone "Synchronize a Sidechained
Compressor to the Beat" (quadrophone.com); benrainey.co.uk sidechain-for-house; Splice "5 Mix
Automation Tips" (splice.com/blog/mix-automation-tips — effect throws); Unison "Reverb Automation
101" (unison.audio/reverb-automation); Produce Like A Pro "Creative Reverb and Delay Tricks for
Vocals" (producelikeapro.com); EDMProd "Ultimate Guide to Build-Ups" (edmprod.com/ultimate-guide-
build-ups) and "The Art of Turnarounds" (edmprod.com/turnarounds); Abstrakt Music Lab "10 Best
Ways to Create Transitions" (abstraktmusiclab.com); EDM Ghost Production "Electronic Song
Structure" (edm-ghost-production.com); Baby Audio "Drops, Risers and SFX" (babyaud.io).

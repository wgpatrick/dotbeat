# Research archive

Four deep-research passes, all fully adversarially verified, that inform
[`../../ROADMAP.md`](../../ROADMAP.md). Plus one code-archaeology pass (direct source reading, not
web search) in [`../opendaw-notes.md`](../opendaw-notes.md).

| File | Topic | Confirmed | Refuted | Sources |
|---|---|---|---|---|
| [`01-landscape.md`](01-landscape.md) | Prior art, the empty-quadrant hypothesis, git-diff prior art, headless rendering | 21 | 4 | 23 |
| [`02-web-stack-feasibility.md`](02-web-stack-feasibility.md) | Pro-DAW feature surface, web-stack feasibility ceiling, WAM2/AudioWorklet architecture | 17 | 8 | 23 |
| [`03-ai-listening.md`](03-ai-listening.md) | Audio-understanding models, auto-mixing, the render→critique loop | 19 | 6 | 24 |
| [`04-format-prior-art.md`](04-format-prior-art.md) | Csound/LilyPond/Humdrum/ABC/ORCA/SuperCollider as text-format prior art | 22 | 3 | 24 |
| [`raw/`](raw/) | Verbatim JSON output of every run + the full openDAW archaeology memo | — | — | — |

**Every claim in these four reports went through 3-vote adversarial verification with zero
infrastructure errors** (an earlier pass hit a rate limit mid-run; all four were subsequently
resumed to completion — cached search/fetch results replayed instantly, only the verification
votes re-ran). 347 raw claims were extracted; each report's "top claims" (~25) were queued for
verification, and every single one resolved cleanly to confirmed or refuted — nothing is stuck
in limbo anymore.

## How to read a report

- **Verified findings** — survived 2-3 skeptic votes. Cite these freely.
- **Refuted claims** — extracted, looked plausible, explicitly rejected. Kept visible on purpose
  so nobody re-cites them later. Several refuted claims in `02` and `03` were specific statistics
  (e.g., an early MMAU headline number) whose *general direction* may still be correct even though
  the *specific figure* didn't survive scrutiny — each report's caveats section says which.
- **Caveats / open questions** — each report is explicit about what it did *not* establish, even
  among its original research questions. Notably: `02` found **zero surviving evidence** on
  engine-architecture prior art (tracktion_engine, Ardour, Reaper, Zrythm) or DSP-library
  portability — these remain genuinely open, not just unwritten.

## A claim that changed mid-verification

The first landscape pass (rate-limited) had a single-source claim that "`.als` is internally just
gzipped XML, human-readable once decompressed." On full reverification **this was refuted** — it
isn't as cleanly text-native as the surface story suggests. Small example of why the resume was
worth doing.

## Complementary source: `docs/opendaw-notes.md`

Web research describes openDAW from the outside (README, marketing). The archaeology pass
**cloned the repo and read the actual source** — its graph/pointer-field data model, the real
headless-rendering code path, its undo system, and its binary project-bundle format (with the one
rationale we could find for why it isn't text). Several of that pass's findings *corrected* the
web-research claims about openDAW above (e.g., there is no separate "headless SDK" package — that
claim is in the refuted list in `01` and `02`, confirmed wrong by direct source reading).

## 05 — Engine architecture (added 2026-07-10)

[`05-engine-architecture.md`](05-engine-architecture.md) — the twice-flagged blind spot,
resolved: 5 angles, 21 sources fetched, 101 claims extracted, 25 verified (23 confirmed / 2
killed), synthesized to 11 findings, every one 3-0. Ran with a concrete motivating measurement
(Phase 4's 0.73×-realtime offline render) and came back with a verified explanation candidate
for it (upstream graph-ordering bottleneck under topology churn) plus the M4 native-engine
design shape (Tracktion-graph-style lock-free multi-threaded node player).

## 06 — Demand signal & adjacent tools (added 2026-07-10)

[`06-demand-and-adjacent-tools.md`](06-demand-and-adjacent-tools.md) — the last two flagged
gaps (live-coding comparison + demand signal), combined: 11 findings (all 3-0), 4 refuted.
Headlines: the empty quadrant survives its third audit (all surveyed live-coding tools are
code-only, none renders headless, the round-trip trap is unsolved everywhere but one Strudel
slider); the strongest verified demand signal is agent control of music tools (ableton-mcp
~2.8k stars); and the broad "musicians want version control" case remains unproven after three
passes — explicitly a bet, not a fact.

## 07 — Sound-design sources: engines, presets, samples, licensing (added 2026-07-10)

[`07-sound-design-sources.md`](07-sound-design-sources.md) — owner-directed pass ("develop
preset synths, import other synths, get audio samples — do some deep research here"): 5 angles,
24 sources, 116 claims extracted, 25 verified (24 confirmed / 1 refuted, all 3-0). Headlines:
engine license ≠ content license (Vital's GPL engine ships NON-redistributable presets AND
wavetables); rendered audio from GPL engines is unencumbered per the FSF unless it copies GPL'd
bundled content; the best permissive imports are Dexed's msfa FM core (Apache-2.0, loads DX7
.syx, proven in-browser) and spessasynth_lib (Apache-2.0 SF2/DLS in pure TS, no WASM); Freesound's
CC0 subset is programmatically isolable via the APIv2 license filter, but aggregated "CC0" packs
have documented mislabeling (LMMS 2014). Honest coverage gap: zero claims survived on
preset-craft technique or the pro-vs-amateur craft gap — those remain open (blog-grade sources
only; re-research against book/curriculum-grade material).

## 08 — Variation-and-taste loop prior art (added 2026-07-10)

[`08-variation-loop-prior-art.md`](08-variation-loop-prior-art.md) — the owner's variation-loop
concept researched: 5 angles, 23 sources, 113 claims extracted, 25 verified — **25 confirmed
3-0, zero refuted**. Headlines: the loop is a documented lineage (Eno 1996 → MutaSynth 2001 →
Evosynth 2016 → Edisyn 2019) with converged design numbers (batch 9-16, rank-3 selection, a
few-hundred-audition hard ceiling, usable sounds in 2-12 generations); exploratory methods beat
direct programming 7.1-7.5 vs 5.9/10 in the one controlled study (n=28); the proven fatigue
mitigations (preference surrogate + clustering, then preferential BO) form the learning ladder
for the scoring exhaust. Honest gaps: zero surviving claims on neural sound-matching data
regimes, shipped-product precedent, or PBO-on-audio sample efficiency — the audio transfer of
Sequential Gallery is unproven and would be a genuine contribution.

## 09 — Sample-source license audit (added 2026-07-11)

[`09-sample-source-licenses.md`](09-sample-source-licenses.md) — the content layer for Phase 7,
verified against primary license texts: 25/25 claims confirmed. Bundle-today shortlist: FreePats
CC0 banks, FreePats MuldjordKit (CC-BY 4.0, fully documented chain, ships as .h2drumkit with
per-instrument samples), Audiophob Hydrogen kit (CC0, Debian-vetted), FluidR3 GM (genuinely
MIT). GeneralUser GS is permissive but carries a self-disclosed provenance caveat. Hydrogen kits
are heterogeneously licensed per kit — the Debian DEP-5 copyright audit is the authoritative
per-kit source, not the free-text <license> field. Nothing survived on 99Sounds/BPB/SampleSwap/
MusicRadar/VSCO/Salamander — NOT cleared. Drum-craft/prep questions again produced zero verified
claims (third strike for blog-grade sourcing) — needs a book-grade pass.

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

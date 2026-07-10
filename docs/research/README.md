# Research archive

Three deep-research passes that informed [`../../ROADMAP.md`](../../ROADMAP.md). Preserved in full
so we don't lose the sourcing.

| File | Topic | Claims | Sources |
|---|---|---|---|
| [`01-landscape.md`](01-landscape.md) | Prior art, the empty-quadrant hypothesis, git-diff prior art, headless rendering, MCP music tools, demand signals | 113 | 23 |
| [`02-web-stack-feasibility.md`](02-web-stack-feasibility.md) | Pro-DAW feature surface (Ableton/Bitwig/Reaper), web-stack feasibility ceiling, engine architecture, DSP libs, format schemas | 115 | 23 |
| [`03-ai-listening.md`](03-ai-listening.md) | Audio-understanding models, auto-mixing, synth-param inference, the render→critique loop, source separation & objective metrics | 119 | 24 |
| [`raw/`](raw/) | Verbatim JSON output of each research run (belt-and-suspenders backup) | — | — |

## How to read the claim tags

- **`VERIFIED (n-0)`** — survived adversarial verification (n skeptic votes, 0 refutes).
- **`SINGLE-SOURCE`** — extracted and quoted from a primary source, but the verification vote was
  rate-limited before it ran. Trustworthy as "this source says X," not yet as "X is triangulated."
- **`REFUTED`** — a verifier majority refuted it. (One claim, in `01`.)
- **`—`** — extracted but never queued for the verification stage.

## ⚠️ Verification caveat

The research harness (search → fetch → extract → **verify**) hit an account rate-limit during the
verification stage, so only a handful of claims per report got the full 3-vote treatment. The
underlying search/fetch/extract worked fine and every claim carries a source quote. **Before any
of this becomes an engineering commitment, re-run verification** on the load-bearing claims —
especially:

- the web-audio latency numbers (`02`, ~30 ms vs ~10 ms; recording-latency compensation blocked),
- the audio-LLM benchmark scores (`03`, ~52% vs 82% human; models answering from text priors),
- and the "empty quadrant" competitive claims (`01`, openDAW/REAPER/DAWproject specifics).

To re-run (from the harness that produced these), resume the workflow scripts referenced in the
run notes with the verification stage un-throttled.

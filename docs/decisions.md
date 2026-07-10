# Design decisions & rationale

A running log of the load-bearing choices, so future-us remembers *why*. Newest at top.

---

## D1 — Document-only format for v1 (no generator-code layer)

**Decision:** the `.beat` file is **literal data** — every note and knob value stated. No loops,
no functions, no code that generates clips. Deferred: a "generator code" layer that compiles to
documents.

**Why:** the two-layer alternative (code generates the document; GUI edits the document) solves a
real problem but adds real complexity. The killer problem it avoids — *you can't write a GUI edit
back into arbitrary code that generated it* — only exists if there's a code layer. Document-only
sidesteps it entirely and still delivers the whole wish list: git-diffable, CLI-editable,
agent-editable. The code layer can be added later as a one-way generator with an "eject to literal
data on GUI edit" handshake, exactly like flattening an arp clip in a DAW today. **Chosen by the
project owner explicitly.**

**Revisit when:** the document format is proven and users ask for algorithmic composition.

---

## D2 — Metrics-first AI critique (LLM narrates, never judges alone)

**Decision:** the AI-listening loop uses deterministic DSP metrics (LUFS, spectral balance,
masking, crest, stereo width) as ground truth; learned auto-mix models (Diff-MST / DMC) propose
*interpretable parameters*; the LLM only narrates the metric deltas and proposes a diff.

**Why:** the research is unambiguous — audio-LLMs mis-hear music badly (best ~52% vs 82% human,
music is their *weakest* domain, several models answer from text priors even when the audio is
noise). A loop that trusts the LLM's ears would hallucinate. Metrics don't hallucinate.
*(`research/03-ai-listening.md`.)*

**Revisit when:** audio-LLM benchmarks on production-quality judgment improve materially (track
MMAU / MuChoMusic / CMI-Bench music scores).

---

## D3 — Web tier now, Tauri native tier for "not a toy"

**Decision:** ship pure-web for the MIDI/synth DAW; plan a Tauri shell as the pro-audio tier
(native recording latency, plugin hosting, time-stretch). Audio backend swappable behind `engine/`.

**Why:** the web platform has hard, well-documented ceilings on recorded audio — ~30 ms round-trip
vs ~10 ms native, recording-latency compensation structurally blocked, no in-browser VST/AU. But
it's entirely sufficient for synth/MIDI (openDAW ships 27 devices with no WASM core). The
toy/serious line is the backend, not the format. *(`research/02-web-stack-feasibility.md`.)*

**Revisit when:** browser audio APIs expose pipeline latency / lower the round-trip floor, or WAM2
plugin ecosystem matures enough to matter.

---

## D4 — Diff-friendliness is a format *requirement*, not a nice-to-have

**Decision:** stable IDs on every entity, one musical event per line, canonical ordering,
deterministic serialization (round-trip identity tested in CI from M0).

**Why:** REAPER already proves "text file" alone isn't enough — practitioners git `.rpp` but say
git "cannot meaningfully diff or merge" it, because it lacks stable IDs and canonical form. The
alsdiff project proves ID-based matching is the fix. Diff quality *is* the product differentiator
(it's what REAPER-in-git lacks), so it's a hard requirement, not an aspiration.
*(`research/01-landscape.md`.)*

**Revisit:** unlikely — this is foundational.

---

## D5 — Headless Chromium as the reference renderer; node-web-audio-api as an optimization

**Decision:** `beat render` uses headless Chromium first (bit-identical to the browser), adopt
`node-web-audio-api` later for speed, validated against the Chromium reference.

**Why:** fidelity beats speed for a v1 render command, and BeatLab's smoke suite already proves
the Chromium path works. `node-web-audio-api` is a *reimplementation* — divergence is a real risk
(Risk #6) that a Chromium reference lets us measure. *(`research/01-landscape.md`.)*

---

## Open decisions (not yet made)

- **Format syntax** — bespoke line-format (leaning) vs restricted YAML vs TOML. → M0.
- **Name** — `beatlab-daw` is a placeholder.
- **License** — MIT keeps DAWproject/automix-toolkit schema/code reuse open.
- **BeatLab relationship** — hard fork vs BeatLab becomes the "learn" mode sharing a core.
- **Web-first vs Tauri-earlier** — reach vs depth.

# Design decisions & rationale

A running log of the load-bearing choices, so future-us remembers *why*. Newest at top.

> **Verification status**: all research citations below now point at fully adversarially-verified
> claims (four passes, zero infrastructure errors on the final run) — see
> [`research/README.md`](research/README.md). Where an earlier version of a decision leaned on a
> claim that was later refuted, this is noted explicitly rather than silently fixed.

---

## D7 — Format syntax resolved: Csound-style lines + Humdrum-style canonical ordering + DAWproject vocabulary

**Decision:** the `.beat` format is a **bespoke line-oriented text format**: typed statement
lines in the spirit of Csound's `.sco` (one event per line, positional fields), a **canonical,
deterministic field ordering** in the spirit of Humdrum `**kern`, and **borrowed field/parameter
names** from DAWproject's XSD schema rather than invented vocabulary.

**Why:** this was an open M0-blocking question (bespoke line-format vs restricted YAML vs TOML)
until `research/04-format-prior-art.md` (fully verified) surfaced real, decades-old precedent:

- Csound `.sco` is confirmed as the closest existing analog to "one event per line, literal
  positional data" — not a novel idea, a 30-year-proven one.
- Humdrum `**kern`'s own specification **explicitly names the diff/version-control problem**
  (equivalent-but-differently-ordered signifiers make `diff`/`cmp` falsely report identical files
  as different) and **prescribes canonical ordering to fix it** — the strongest available
  precedent for treating "one canonical serialization per state" as a hard requirement (see D4)
  rather than a nice-to-have.
- DAWproject's XSD (MIT-licensed, read directly, not just described) gives real, cross-DAW-agreed
  field names for compressor/EQ/clip/automation-point data — no reason to invent our own.
- YAML and JSON both lost on the evidence: YAML has no comparable diff-friendly precedent found
  anywhere in the survey; JSON's trap is demonstrated by openDAW's own `toJSON()` escape hatch,
  which serializes numeric field keys instead of names and is therefore not actually diff-friendly
  despite being "JSON."

**Revisit:** unlikely on the high-level style; exact syntax details still finalized in M0.

---

## D6 — Human-readable slugs over raw UUIDs at the text-serialization boundary

**Decision:** `.beat` entities are identified by short, human-legible slugs (`trk_bass`,
`n_01`) in the text file. UUIDs or content hashes remain canonical internally / for
globally-unique references (e.g. `media/` sample files), but never as the primary text-facing ID.

**Why:** validated independently by two sources found in the same research round —
DAWproject uses `xs:ID`/`xs:IDREF` (human-assignable XML string IDs), and openDAW's own
`AddressIdEncoder` converts its internal random UUIDs into short sequential IDs *specifically* for
its XML export path — i.e. even the project that chose raw UUIDs internally still converts to
short human-facing IDs the moment it needs a text-facing surface. Two independent systems
converging on the same escape hatch is a strong signal. Also matters directly for our agent-native
goal: an AI-authored diff referencing `trk_bass.cutoff` is legible to a human reviewer without a
UUID lookup step; `a3f1e9d2/1/3/20` is not.
*(`docs/opendaw-notes.md` §"do differently" item 3; `research/04-format-prior-art.md` on
DAWproject's `xs:ID`.)*

**Revisit:** unlikely — this is a UX property we want regardless of internal ID scheme.

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

**Why (updated after full verification — the conclusion held, the supporting stats were partly
corrected):** ✅ Confirmed at high confidence: audio-LLMs show severe **text-prior bias**
(barely degrade when audio is replaced with noise), their errors are **dominated by mis-hearing,
not mis-reasoning** (55-64% of errors are perceptual, per MMAU's own error analysis), and they
**cannot produce calibrated numeric judgments** (regression R² at or below the level of guessing
the dataset mean). ⚠️ An earlier version of this rationale cited a "~52% vs 82% human, music is
their weakest domain" headline statistic — **that specific claim was refuted on reverification**
and should not be reused, even though the broader conclusion survives on the claims that did.
**Important epistemic caveat, carried over honestly**: no benchmark has *directly* tested
audio-LLMs on mix-critique tasks specifically (masking detection, frequency-conflict ID,
loudness/dynamics judgment) — this decision rests on a well-evidenced *inference* from adjacent
music-understanding failures, not a direct proof. Strong enough to justify the architecture;
worth remembering it's an inference. *(`research/03-ai-listening.md`, fully verified.)*

**Revisit when:** audio-LLM benchmarks that directly test production/mix-critique judgment appear
(none exist yet, per the research) and show materially better-than-adjacent-task performance.

---

## D3 — Web tier now, Tauri native tier for "not a toy"

**Decision:** ship pure-web for the MIDI/synth DAW; plan a Tauri shell as the pro-audio tier
(native recording latency, plugin hosting, time-stretch). Audio backend swappable behind `engine/`.

**Why (magnitude confirmed, one mechanism claim corrected):** the web platform has a confirmed,
high-confidence latency ceiling — ~30 ms round-trip vs a ~10 ms native target (Soundtrap/W3C
workshop data, 2021; the report flags this figure as now 5 years old and not re-confirmed for
2026). ⚠️ An earlier version of this rationale also cited "`MediaStreamSourceNode` latency is not
exposed anywhere" as the specific mechanism, and separately quoted the WAM-studio authors naming
"the sandbox and latency compensation" as their hardest problems — **both of those specific claims
were refuted on reverification.** The *magnitude* of the gap is solid; the *cause* is not as
pinned-down as previously stated. openDAW is still cited as evidence that synth/MIDI-only web DAWs
are viable — but not by citing its (refuted) specific 2026 roadmap dates; just by the fact that it
ships 27 working devices today. *(`research/02-web-stack-feasibility.md`, fully verified.)*

**Revisit when:** browser audio APIs expose pipeline latency / lower the round-trip floor, or WAM2
plugin ecosystem matures enough to matter.

---

## D4 — Diff-friendliness is a format *requirement*, not a nice-to-have

**Decision:** stable IDs on every entity, one musical event per line, canonical ordering,
deterministic serialization (round-trip identity tested in CI from M0).

**Why (now with a second, stronger precedent):** REAPER already proves "text file" alone isn't
enough — practitioners git `.rpp` but say git "cannot meaningfully diff or merge" it, because it
lacks stable IDs and canonical form. `alsdiff` proves ID-based matching is workable in practice.
**New**: Humdrum `**kern`'s own spec independently arrived at the same conclusion for musical
notation specifically — canonical ordering isn't optional, it's *the* fix for false diffs (see
D7). Two unrelated domains (DAW projects, musicological encoding) converging on "you must define
one canonical serialization" is strong validation this is foundational, not a nice-to-have.
*(`research/01-landscape.md`, `research/04-format-prior-art.md`, both fully verified.)*

**Revisit:** unlikely — this is foundational.

---

## D5 — Headless Chromium as the reference renderer; node-web-audio-api as an optimization

**Decision:** `beat render` uses headless Chromium first (bit-identical to the browser), adopt
`node-web-audio-api` later for speed, validated against the Chromium reference.

**Why (now with a confirmed exact code recipe):** fidelity beats speed for a v1 render command,
and BeatLab's smoke suite already proves the Chromium path works. `node-web-audio-api` is a
*reimplementation* — divergence is a real risk (Risk #6) that a Chromium reference lets us
measure. ✅ Confirmed at high confidence (previously single-source): Tone.js has first-class
offline rendering (`OfflineContext`/`Tone.Offline()`) built on the standard `OfflineAudioContext`.
The exact Node wiring pattern was confirmed by directly reading `node-web-audio-api`'s own example
file: import the polyfill first, construct `AudioContext` from the polyfilled global,
`Tone.setContext()` before creating nodes, and plan for an explicit `process.exit()` since Tone.js
has no clean Node teardown. *(`research/01-landscape.md` + `docs/opendaw-notes.md`, both
first-party sourced.)*

---

## Open decisions (not yet made)

- **Name** — `beatlab-daw` is a placeholder.
- **License** — MIT keeps DAWproject/automix-toolkit schema/code reuse open. Note: openDAW itself
  is **AGPL v3/LGPL** — safe to learn architectural patterns from (facts/ideas aren't
  copyrightable), not safe to port literal code from into an MIT project.
- **BeatLab relationship** — hard fork vs BeatLab becomes the "learn" mode sharing a core.
- **Web-first vs Tauri-earlier** — reach vs depth.
- **Three confirmed research blind spots**, both surfaced by the fully-verified passes finding
  *zero* surviving evidence despite being explicit original research questions — worth a
  dedicated follow-up before treating adjacent decisions (especially M4 engine choices) as settled:
  1. **Engine architecture** — tracktion_engine, Ardour, Reaper's own write-ups, Zrythm, LMMS.
  2. **Live-coding language comparison** — Strudel, TidalCycles, Sonic Pi, Glicol (GUI-lessness,
     file format, CLI/headless specifics).
  3. **Direct demand-signal/survey evidence** — producers-who-code market signals, forum data on
     which pro-DAW features are make-or-break vs rarely used.

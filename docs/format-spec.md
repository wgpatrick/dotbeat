# `.beat` format — working sketch

> **Status:** exploratory. This is a sketch to make the design concrete, not a frozen spec.
> Decisions here are made in **M0** (see [`../ROADMAP.md`](../ROADMAP.md)).

## Goals (from the roadmap)

1. **Literal data, not code** — every note and knob value stated; the GUI reads/writes it losslessly.
2. **Diff-friendly by construction** — stable IDs, one event per line, canonical ordering,
   deterministic serialization.
3. **Content-addressed audio** — samples referenced by hash, stored in a `media/` sidecar.
4. **Versioned schema** — a `format_version` field from commit one.

## Why not just JSON / YAML / an existing format

- **JSON** — noisy diffs (braces, quotes, no comments, trailing-comma churn), and array reorders
  produce large diffs. Rejected as the at-rest format (fine as an internal wire format).
- **YAML** — human-readable but foot-gun-prone (the Norway problem, indentation sensitivity),
  and still diffs poorly for reordered sequences.
- **Ableton `.als`** — gzipped XML; only diffable via external decompress hooks. This is the
  anti-pattern we're avoiding.
- **REAPER `.rpp`** — genuinely text, but practitioners report git "cannot meaningfully diff or
  merge" it: no stable IDs, position-dependent, no canonical ordering. We fix exactly these.
- **DAWproject** — the schema to *borrow vocabulary from* (MIT-licensed, models real sessions),
  but it lives inside a ZIP and is an interchange format, not a working file.

**Leaning:** a **bespoke line-oriented text format** with a strict, deterministic serializer —
maximally diff-legible, comments allowed, one musical event per line.

## Illustrative sketch (NOT final syntax)

```
format_version 0.1
tempo 126
time_sig 4/4
loop 1..8

track bass id=trk_a1 color=#56b6c2
  device synth id=dev_9f
    osc sawtooth
    cutoff 480
    resonance 1.5
    adsr 0.005 0.20 0.40 0.15
  clip id=clp_3 bar=1..4
    # pitch  start(beats)  len   vel
    note id=n_01  A1   0.0   0.5   0.80
    note id=n_02  A1   1.0   0.5   0.80
    note id=n_03  C2   2.0   0.5   0.72
    note id=n_04  A1   3.0   0.5   0.80

track drums id=trk_b2 color=#e06c75
  clip id=clp_7 bar=1..1
    step kick  x...x...x...x...
    step hat   ..x...x...x...x.

send reverb id=snd_r amount=0.0
media                          # content-addressed sample refs
  sample id=smp_1 hash=sha256:9f86d0… file=media/9f86d0.wav
```

### Why each choice serves diffs

- **Stable `id=` on every entity** — a rename changes one token, a reorder changes zero lines
  (match by ID, not position). This is the alsdiff lesson.
- **One note per line, fixed column order** — moving a note = a one-line diff a human reads.
- **Canonical sort** (by start, then pitch) and **canonical formatting** — the serializer always
  emits the same bytes for the same state, so `serialize(parse(x)) == x`.
- **Steps as a compact string** (`x...x...`) — drum patterns diff legibly per-lane.
- **`media/` by hash** — the text file stays text; audio is portable and LFS-friendly.

## Open questions

- Beats vs 16th-steps vs ticks for time. (Beats read best; ticks are lossless for odd grids.)
- How to represent automation curves (breakpoint list per param) diff-legibly.
- Human-friendly IDs (`n_01`) vs opaque UUIDs — readability vs collision-safety.
- Clip content dedup (same clip used in many places) — reference vs inline.

## Invariants the serializer must guarantee (tested in CI from M0)

1. `serialize(parse(bytes)) == bytes` for any file the tool itself wrote (round-trip identity).
2. Two projects that are musically identical serialize to byte-identical files (canonical form).
3. A single-parameter change produces a single-line (or minimal) diff.

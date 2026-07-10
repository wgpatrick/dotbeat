# `.beat` format — working sketch

> **Status:** exploratory sketch, now backed by real prior art (see below) rather than a
> from-scratch guess. The format-style question that used to be an open decision is **resolved**
> — see `ROADMAP.md` §4. Exact syntax is still finalized in **M0**.

## Goals (from the roadmap)

1. **Literal data, not code** — every note and knob value stated; the GUI reads/writes it losslessly.
2. **Diff-friendly by construction** — stable IDs, one event per line, canonical ordering,
   deterministic serialization.
3. **Content-addressed audio** — samples referenced by hash, stored in a `media/` sidecar.
4. **Versioned schema** — a `format_version` field from commit one.

## Why not just JSON / YAML / an existing format

- **JSON** — noisy diffs (braces, quotes, no comments, trailing-comma churn), array reorders
  produce large diffs. Reinforced by archaeology: openDAW's own `toJSON()` escape hatch serializes
  *numeric* field keys (`{"1": ..., "20": true}`) instead of names — proof that "just use JSON"
  quietly becomes non-diffable unless field names are made canonical on purpose, which is real
  discipline, not a default you get for free.
- **YAML** — human-readable but foot-gun-prone, still diffs poorly for reordered sequences.
- **Ableton `.als`** — gzipped XML; not confirmed cleanly readable even decompressed (a claim to
  the contrary was refuted on research verification). Anti-pattern.
- **REAPER `.rpp`** — genuinely text, but practitioners report git "cannot meaningfully diff or
  merge" it: no stable IDs, position-dependent, no canonical ordering. We fix exactly these.
- **DAWproject** — schema to *borrow vocabulary from* (MIT-licensed, confirmed real field names
  for compressor/EQ/clips), but lives inside a ZIP; an interchange format, not a working file.
- **openDAW's `.odb`** — a JSZip of a custom binary format. Archaeology found the *actual*
  rationale (a source-code comment): the binary format exists so a Rust engine and a TypeScript
  engine can byte-checksum each other — a cross-language-parity need that doesn't apply to us.
  No design doc anywhere argues against text on diff-friendliness grounds. Reinforces rather than
  challenges our direction.

## Real prior art — decades of hard-won lessons, not a from-scratch guess

Full research: [`research/04-format-prior-art.md`](research/04-format-prior-art.md), fully
verified.

- **Csound `.sco`** — the closest existing analog. A line begins with a type character (`i` for
  instrument/note events) followed by space/tab-separated **p-fields**: `p1`=instrument,
  `p2`=start time, `p3`=duration are hardwired; `p4+` are free-form, defined by the instrument.
  Decades-stable, real production use. **This is where our "one event per line, typed statement,
  positional fields" instinct comes from — it isn't novel, it's Csound's actual design,
  confirmed still working after 30+ years.**
- **Humdrum `**kern`** — the single most directly useful precedent. It's a pure-ASCII,
  tab-delimited **grid**: rows = time (a row is one musical "moment"/sonority), columns
  ("spines") = simultaneous parts. And critically: **its own specification explicitly names the
  diff problem** — differing-but-musically-equivalent orderings of signifiers within a token cause
  `diff`/`cmp` to falsely report identical files as different — and **prescribes a canonical,
  fixed signifier ordering specifically to prevent it.** We are not inventing the "deterministic
  canonical serialization" requirement from nothing; Humdrum discovered and solved the identical
  problem decades ago. **Steal the discipline, not just the idea**: whenever a `.beat` construct
  has more than one way to express the same musical fact, the spec must pick exactly one
  canonical form, the way Humdrum's signifier-ordering rule does.
- **DAWproject** — real, MIT-licensed, XSD-defined vocabulary (from direct schema reading):
  `Threshold/Ratio/Attack/Release/Knee/InputGain/OutputGain` (compressor),
  `Band/Freq/Gain/Q/Enabled/type` (EQ), `time/duration/contentTimeUnit/playStart/loopStart/
  loopEnd/fadeInTime/fadeOutTime` (clips), `RealPoint/EnumPoint/BoolPoint` with
  `time/value/interpolation` (automation). Borrow these names outright — no reason to invent our
  own when a cross-DAW-agreed vocabulary already exists, and it's permissively licensed.
- **What nobody has done**: no surviving prior art marries notation-style event representation
  (pitch/rhythm/dynamics) *with* synthesis/production parameters (filter cutoff, envelope shapes,
  automation curves) in one diff-friendly text document. Every mature text-notation format
  (LilyPond, ABC, Humdrum) stops at "what note, when" — none of them carry "and the filter cutoff
  was rising through this note." **This is genuinely new ground for `.beat` to cover, not
  something to copy.**
- **A cautionary tale**: SuperCollider's `Score` object is *logically* a literal timestamped event
  list, expressible as plain text — but its actual on-disk format for the synthesis server is
  **binary** (byte-size-prefixed OSC commands). Lesson: being "text-shaped in memory" is not the
  same as being text *as persisted*. Verify the format is text all the way down to the bytes on
  disk, not just in an intermediate representation.

**Leaning, now with real precedent behind it:** a **bespoke line-oriented text format** —
Csound-style typed statement lines, Humdrum-style canonical field ordering, DAWproject-style
parameter vocabulary. Beats YAML (no comparable precedent found) and JSON (openDAW's own JSON
path shows the trap).

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

Compressor using **borrowed DAWproject vocabulary** rather than inventing our own field names:

```
  device compressor id=dev_c1
    threshold -18.0
    ratio 4.0
    attack 5.0
    release 80.0
    knee 3.0
    inputgain 0.0
    outputgain 0.0
```

Automation, using DAWproject's typed-point pattern (`time, value, interpolation`):

```
  automation target=dev_9f.cutoff
    point 0.0   480   linear
    point 2.0  2400   linear
    point 2.5  2400   hold
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
- Clip content dedup (same clip used in many places) — reference vs inline.
- Exact automation-target addressing syntax (`dev_9f.cutoff` above is illustrative) — dotted
  human path vs something else. (openDAW targets automation at an opaque `uuid/field-key`
  address, resolvable only by walking the schema — explicitly the thing to do *differently*, per
  `docs/opendaw-notes.md` §"do differently" item 4. A dotted human path keeps a diff
  self-explanatory without cross-referencing a schema.)

## Resolved by research (previously open)

- **Automation curve representation** — resolved: DAWproject's typed-point pattern
  (`time, value, interpolation ∈ {hold, linear}`) is real, cross-DAW-agreed, and directly
  text-line-friendly. Adopted above.
- **Human-friendly IDs vs opaque UUIDs** — resolved in favor of **human-readable slugs at the
  text-serialization boundary** (`n_01`, `trk_a1`), UUID or content-hash canonical only where
  global uniqueness truly matters (e.g. `media/` sample refs). Validated by two independent
  precedents: DAWproject's `xs:ID`/`xs:IDREF` (human-assignable strings) and openDAW's own
  `AddressIdEncoder`, which converts its internal UUIDs into short sequential IDs purely for its
  (secondary) XML export — even the project that *chose* UUIDs internally converts to short IDs
  the moment it needs a human/text-facing surface.

## Invariants the serializer must guarantee (tested in CI from M0)

1. `serialize(parse(bytes)) == bytes` for any file the tool itself wrote (round-trip identity).
2. Two projects that are musically identical serialize to byte-identical files (canonical form).
3. A single-parameter change produces a single-line (or minimal) diff.

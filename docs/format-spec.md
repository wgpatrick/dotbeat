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

## v0.2 grammar — FROZEN, implemented in `beatlab-daw/src/core`

Deliberately minimal: notes, drum patterns, and one implicit synth device per track (no
automation, no clips/scenes, no device IDs / multi-device chains yet). Every field maps 1:1
onto real fields in BeatLab's actual `Track`/`Note`/`DrumPattern`/`SynthParams` types
(`beatlab/src/types.ts`) — chosen so the converter has no lossy or invented mapping to design,
just a direct field-for-field translation.

Version history: **v0.1** (Phase 0) was synth tracks only — drum tracks were dropped by the
converter, which meant the app's built-in default state, not the file, was still the true root
document. **v0.2** (Phase 1, `phase-1-plan.md`) added the `kind` token and `pattern` lines so
the whole default groove round-trips and the file becomes the actual source of truth.

### Lines

```
format_version <semver-ish, e.g. 0.2>
bpm <integer>
loop_bars <integer>
selected_track <track id>

track <id> <name> <color hex, lowercase> <kind: synth|drums>
  synth
    osc <sine|triangle|sawtooth|square>
    volume <number, dB>
    cutoff <number, Hz>
    resonance <number>
    attack <number, seconds>
    decay <number, seconds>
    sustain <number, 0..1>
    release <number, seconds>
    pan <number, -1..1>
  pattern <lane: kick|snare|clap|hat|openhat> <velocity 0..1, one per step>   # drum tracks only
  note <id> <pitch 0-127> <start, 16th-note steps from loop start> <duration, steps> <velocity 0..1>   # synth tracks only
  ...
```

Drum tracks carry the same 9-param `synth` block (in BeatLab those are the real drum bus/voice
params) plus exactly five `pattern` lines — one per lane, all five always present. A pattern is
a fixed-length velocity cycle (16 steps = one bar in BeatLab, repeating across the loop,
independent of `loop_bars`); `0` = off. Synth tracks carry `note` lines and no `pattern` lines;
the parser rejects the wrong statement kind in either direction, and rejects drum tracks with
missing lanes or unequal lane lengths. Track names are single tokens (a known, accepted v0.2
limitation).

Indentation is exactly 2 spaces per level (`track` at column 0, `synth`/`pattern`/`note` at
column 2, individual synth params at column 4) and is **structural**, not cosmetic — the parser
uses it to know which track/synth a line belongs to. A `#` starts a line comment (ignored by the
parser, never emitted by the serializer — comments are a hand-editing convenience, not part of
the canonical form).

### Why notes are positional but synth params are one-per-line

This is the resolution of the Csound-vs-DAWproject tension the prior-art research left open:

- **Notes are Csound-style positional** (`note <id> <pitch> <start> <dur> <vel>`, five
  whitespace-separated tokens, fixed order) — notes are high-frequency and their field set is
  small, fixed, and never grows; a "move this note" edit meaningfully changes pitch *and* start
  together, so one line per note (rather than one line per field) is the right diff granularity.
- **Synth params are one name-value pair per line** (DAWproject-style: each parameter is its own
  named element) — this is what actually delivers on `docs/decisions.md` D4's hard requirement,
  *"a single-parameter change produces a single-line diff."* If all nine synth params lived on
  one line (the more Csound-authentic choice), changing only `cutoff` would still diff the
  *entire* line under git's line-oriented default view. One param per line costs some
  compactness; it's what makes "hand-edit a cutoff value, see a clean diff" — the actual thesis
  this phase is testing — literally true.
- **Drum patterns are one lane per line, positional velocities** (v0.2) — the Humdrum grid
  spirit at lane granularity. All five lanes are always emitted (no elision of silent lanes —
  one canonical way to write a fact), so toggling any step is always a one-line diff and never
  inserts or deletes lines. Per-step one-line diffs would cost 80 lines per drum track for a
  16-step kit; lane granularity is the deliberate middle ground.

### Canonical ordering (the Humdrum discipline, applied)

Serialization must be deterministic: `serialize(parse(x)) === x` for any canonical `x`, and two
musically-identical documents always produce byte-identical text.

1. Header lines always appear, always in this order: `format_version`, `bpm`, `loop_bars`,
   `selected_track`.
2. Tracks appear in **source order** (the order they appear in BeatLab's `tracks` array) — not
   alphabetical, not by ID. Track order is meaningful (it's the mixer/UI order), so it's
   preserved, not normalized away.
3. Within a track: the `track` line, then the `synth` block with params in this **fixed
   order** — `osc, volume, cutoff, resonance, attack, decay, sustain, release, pan`. This is
   BeatLab's own progressive-reveal lesson order (`P_FULL` in `src/lessons/sound.ts`:
   osc→volume→cutoff→resonance→attack/decay/sustain/release) with `pan` appended — reusing an
   ordering convention that already exists in the real app, not inventing a new one.
4. For drum tracks: exactly five `pattern` lines, always all lanes, always in BeatLab's own
   `DRUM_LANES` order — `kick, snare, clap, hat, openhat`.
5. Then `note` lines, sorted by `(start, pitch, id)` ascending.
6. Numbers: integers with no decimal point (`4500`, not `4500.0`); non-integers rounded to 4
   decimal places, trailing zeros and a trailing `.` stripped (`0.8`, not `0.80` or `0.8000`).
   This is the one place floating-point noise could break byte-identical round-trips, so it's
   pinned down precisely rather than left to `Number.prototype.toString()`.
7. IDs are emitted exactly as given — no re-slugging. BeatLab's real IDs (`lead`, `bass`,
   `n106`, `u100000`) are already human-legible, which independently validates `docs/decisions.md`
   D6's human-slug decision: the app didn't need to be redesigned to get readable IDs, it already
   had them.

### Worked example (a real, small round-trippable document)

```
format_version 0.2
bpm 124
loop_bars 1
selected_track lead

track drums Drums #e35d5d drums
  synth
    osc sawtooth
    volume -10
    cutoff 9000
    resonance 0.8
    attack 0.01
    decay 0.2
    sustain 0.7
    release 0.3
    pan 0
  pattern kick 0.9 0 0 0 0.9 0 0 0 0.9 0 0 0 0.9 0 0 0
  pattern snare 0 0 0 0 0.8 0 0 0 0 0 0 0 0.8 0 0 0
  pattern clap 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
  pattern hat 0 0 0.6 0 0 0 0.6 0 0 0 0.6 0 0 0 0.6 0
  pattern openhat 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.5 0

track lead Lead #c678dd synth
  synth
    osc square
    volume -14
    cutoff 4500
    resonance 0.8
    attack 0.01
    decay 0.3
    sustain 0.2
    release 0.4
    pan 0
  note n100000 64 0 2 0.8
  note n100001 67 2 2 0.8
  note n100002 71 4 4 0.72
```

Changing that lead's cutoff from bright to dark is exactly this diff:

```diff
-    cutoff 4500
+    cutoff 900
```

That one-line diff, for exactly this kind of edit, is the whole thesis — proven in Phase 0
(tests + a real render) and again in Phase 1 (a live GUI knob-turn producing exactly that
`git diff`, measured — see `phase-1-plan.md`). Toggling one drum step is likewise exactly one
changed `pattern` line.

### Deferred past v0.2 (explicitly out of scope, not forgotten)

Automation, clips/scenes, swing, arrangement, multi-device chains (FX, sends), multi-token track
names. See `phase-1-plan.md`'s "explicitly deferred" section — these come as the milestones that
need them land (`ROADMAP.md` §8).

---

## Future (post-v0, not implemented) — a fuller sketch once automation/devices/media land

The sections below are earlier exploratory sketches for where the format goes *after* v0 proves
out — automation, multi-device chains, content-addressed media. Not implemented, not frozen, kept
here so the direction isn't lost.

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
- **Canonical sort** (by start, then pitch) and **canonical formatting** — the serializer always
  emits the same bytes for the same state, so `serialize(parse(x)) == x`.
- **Steps as a compact string** (`x...x...`) — drum patterns diff legibly per-lane.
- **`media/` by hash** — the text file stays text; audio is portable and LFS-friendly.

## Open questions

- Clip content dedup (same clip used in many places) — reference vs inline.
- Exact automation-target addressing syntax (`dev_9f.cutoff` above is illustrative) — dotted
  human path vs something else. (openDAW targets automation at an opaque `uuid/field-key`
  address, resolvable only by walking the schema — explicitly the thing to do *differently*, per
  `docs/opendaw-notes.md` §"do differently" item 4. A dotted human path keeps a diff
  self-explanatory without cross-referencing a schema.)

## Resolved by research (previously open)

- **Time units** — resolved (for v0): 16th-note steps, as integers — exactly BeatLab's own
  `Note.start`/`Note.duration` representation, not beats or ticks. Chosen so Track B.3's
  converter is a direct field mapping with zero unit conversion or rounding loss against real
  app data. Beats-vs-ticks for a *future* fuller timeline (arbitrary tempo/time-sig changes) is
  still open.
- **Automation curve representation** — resolved: DAWproject's typed-point pattern
  (`time, value, interpolation ∈ {hold, linear}`) is real, cross-DAW-agreed, and directly
  text-line-friendly. Adopted above, for when automation lands post-v0.
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

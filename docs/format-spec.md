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

## v0.2 grammar (+ v0.3 additions) — FROZEN, implemented in `dotbeat/src/core`

Deliberately minimal: notes, drum patterns, and one implicit synth device per track (no
automation, no clips/scenes, no device IDs / multi-device chains yet). Every field maps 1:1
onto real fields in BeatLab's actual `Track`/`Note`/`DrumPattern`/`SynthParams` types
(`beatlab/src/types.ts`) — chosen so the converter has no lossy or invented mapping to design,
just a direct field-for-field translation.

Version history: **v0.1** (Phase 0) was synth tracks only — drum tracks were dropped by the
converter, which meant the app's built-in default state, not the file, was still the true root
document. **v0.2** (Phase 1, `phase-1-plan.md`) added the `kind` token and `pattern` lines so
the whole default groove round-trips and the file becomes the actual source of truth. **v0.3**
(Phase 5, `phase-5-plan.md`) added the optional shaped-parameter surface — see "v0.3 additions"
below; the v0.2 grammar is a strict subset (every v0.2 file is a valid v0.3 file, and a document
that touches no optional field serializes identically).

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

### v0.3 additions — the optional shaped-parameter surface (Phase 5)

v0.2's 9-param synth block could carry a melody but not a *sound* — the A/B experiment in
`phase-5-plan.md` showed the same notes go from "video game music" to a real mix purely through
the ~50 store-level params the format couldn't express. v0.3 exposes them:

- **~50 optional synth params** may appear after the core 9, one name-value pair per line at the
  same indent: osc layers (`osc2Type/osc2Level/osc2Detune`, `subLevel`, `noiseLevel`, `fm*`,
  `unisonVoices/unisonWidth`, `wtTable/wtPos`), filter (`filterType`, `filterEnv*`), motion
  (`lfo*`, `lfo2*` — including tempo-sync `lfoSync/lfoSyncRate`/`lfo2Sync/lfo2SyncRate`, Phase 18 —
  plus `glide`, `keytrackAmount`, `velToFilterAmount`, `macroValue`), inserts
  (`eq*`, `comp*`, `distortion*`, `bitcrush*`), sends (`sendReverb/sendDelay/sendMod`),
  sidechain (`duckSource` — a track id or `none` — plus `duckAmount`), and drum-voice shaping
  (`kickTune/kickPunch/kickDecay`, `snareTone/snareDecay`, `hatTone/hatDecay/openHatDecay`,
  audible on drum tracks). The full table, with types, enum values, and frozen defaults, is
  `SYNTH_FIELDS` in `src/core/document.ts` — the single source of truth that drives the parser,
  serializer, editor, differ, and converter. `lfoDest`/`lfo2Dest` share one enumerated destination
  set (`LFO_DESTS`, also in `document.ts`) — kept literal (one canonical token, no free-routing
  matrix) per `docs/research/18-ableton-ui-architecture.md`'s LFO-depth recommendation; Phase 18
  Stream R widened it toward the automatable-param set (`resonance`, `pan`, sends, EQ, `compMix`,
  `distortionMix`, `bitcrushMix` — previously the two LFOs had inconsistent/partly-dead
  destination pools, now both reach the full shared set).
- **Canonical elision**: an optional param is serialized **iff its value differs from its frozen
  default**, in `SYNTH_FIELDS` table order. Missing-at-parse means default. This keeps every
  state at exactly one canonical form (the round-trip property is unchanged), keeps files
  readable (an init patch is still 9 lines, and every line that IS there is a deliberate sound
  decision), and makes any param change a one-line diff — add, modify, or remove.
- **Defaults are frozen** copies of BeatLab's `DEFAULT_SYNTH` at v0.3 freeze time. If the app
  ever changes a default, the format does NOT follow — elision semantics are part of the
  grammar, not a live reference to any app.
- **`duckSource` is a track reference**: it must name a track that exists in the document
  (forward references are fine — validated after the full parse) or be `none` (= null,
  canonical form: elided).
- **Deliberately unmodeled** (`DELIBERATELY_UNMODELED` in `src/core/convert.ts`): wavetable
  frame arrays (`wtCustomA/B`), step-LFO arrays (`lfoSteps`), insert ordering (`insertOrder`),
  and the arp (`arpOn/arpRate/arpPattern`). Each needs grammar design of its own (arrays, ordered
  lists); the converter reports exactly these as dropped and nothing else. (Tempo-sync pairs
  `lfoSync/lfoSyncRate`/`lfo2Sync/lfo2SyncRate` were on this list through Phase 17 — a well-bounded
  bool+enum pair, unlike the array-shaped fields above — and were promoted to real `SYNTH_FIELDS`
  in Phase 18 Stream R.)
- **Presets are tooling, not grammar.** There is no preset reference or include in the file — a
  document always spells out its own sound in full. `beat preset <file> <track> <name>` (and the
  `beat_preset` MCP tool) applies a named bag of param edits from `presets/factory.json` through
  the same code path as `beat set`, so applying one produces a normal edit list and a normal
  diff. Presets never carry track references — routing stays a per-project edit.

Proven exit (Phase 5, `scripts/verify-phase5.mjs`): the Night Shift v3 sound design —
originally only reachable by patching the live store — reproduced from pure v0.3 text, with
exact store-state equivalence on every track and render metrics matching the archived reference.

### v0.5 additions — media block + sample-backed drum lanes (Phase 7)

The first thing a `.beat` file references that cannot be text — real audio — enters
content-addressed and provenance-tracked:

- **`media` block** (top level, canonically BEFORE tracks): `sample <id> sha256:<64-hex> <path>`
  per line. The hash pins the exact bytes (integrity, dedup, honest git story: media files are
  immutable blobs); paths are relative to the `.beat` file, forward slashes, no `..` (validated
  at parse). Hash/existence are checked at LOAD time (renderer/daemon), not parse time — parse
  stays pure text. License provenance lives in a `<path>.json` sidecar (source, license, credit
  lines, prep settings, sha256), deliberately outside the music file.
- **`lane` lines** in drum tracks: `lane <lane> <sample-id> <gain dB> <tune semitones>` — that
  lane plays the sample one-shot instead of the synthesized voice (static gain multiplies
  per-hit velocity; tune ±24 st). Unassigned lanes stay synthesized — mixed kits are the normal
  case. Canonical order: DRUM_LANES order, after synth params, before clips. One line per
  assigned lane = swap-the-kick is a one-line diff.
- Tooling: `beat sample` registers media (computes the sha256 for you), `beat lane`
  assigns/clears; the daemon serves declared media to the browser bridge (only declared paths —
  never a directory listing); the offline renderer verifies hashes and fails loudly on mismatch
  or missing files.
- Content: `presets/kit-init/` (self-rendered, CC0) and `presets/kit-audiophob/` (CC0,
  Debian-vetted — research 09) ship in-repo; the Freesound CC0 pipeline
  (`scripts/freesound-cc0.mjs`, audition previews + OAuth2 originals) sources more.

### v0.6 additions — instrument tracks (Phase 8)

Real sampled instruments enter as a third track kind:

- **`track <id> <name> <color> instrument`** carries a `soundfont <sample-id> <program>` voice
  line (the sample id references an `.sf2`/`.sf3` in the v0.5 `media` block — no new media
  machinery), optional `volume <dB>` / `pan <-1..1>` (elided at -10/center), and `note` lines
  exactly as synth tracks. Deliberately NO synth block (the 55 synth params don't apply to
  sampled instruments — fail loudly beats half-meaningful knobs) and NO clips yet (timeline
  participation is a later slice).
- Rendering: headless goes through spessasynth_core (Apache-2.0, pure DSP — 29x realtime,
  measured) outside the Tone graph; notes loop every `loop_bars` like synth tracks. The
  browser leg (spessasynth_lib worklet in beatlab) is the next Phase 8 slice — until it lands,
  instrument tracks are excluded from GUI sync partials and preserved by the daemon on pushes.
- Content: `presets/sf2/upright-piano-kw-small.sf2` (FreePats, CC0, provenance sidecar).

### v0.7 additions — fractional note timing (owner requirement: live/tapped input)

Notes come off the grid: **`start` and `duration` on `note` lines accept decimals** (still in
16th-step units — `3.5` is halfway between steps 3 and 4). This is the format foundation for
live capture ("tapping on keys to create rhythm"): a tapped performance records at the time it
was played, not snapped to the nearest 16th; quantize becomes an optional edit, never a
storage limitation.

- Canonical form: numbers use the shared `formatNumber` rule (max 4 decimals, trailing zeros
  stripped — `3.5`, never `3.50`). Non-canonical spellings parse and re-serialize canonically.
  Precision floor: 0.0001 step = 12.5 µs at 120 bpm — far below perceptual timing thresholds.
- Validation: `start >= 0`, `duration > 0` (the old integer `>= 1` floor is gone). Pitch stays
  an integer 0-127. `addNote` snaps incoming values to canonical precision so a stored
  document always deep-equals its own serialize→parse round-trip.
- Engine: verified sample-accurate end-to-end — two notes 1.5 steps apart (on-grid step 2,
  off-grid 3.5) rendered through the real beatlab graph measure a 187.6 ms inter-onset gap vs
  187.5 ms expected (0.07 ms error). The spessasynth instrument path already floors fractional
  steps to sample positions.
- Drum patterns remain grid-quantized 16-step lanes in v0.7 — v0.8 makes them fully general
  (below).
- Quantize is an *operation*, not part of the grammar (the Ableton model, owner-directed):
  `beat quantize <file> <track> [--grid 1] [--amount 1] [--ends] [--no-starts] [--notes ...]`
  (also `beat_quantize` over MCP). Starts and ends snap independently; `--amount 0.5` moves
  notes halfway to the grid (tighten without flattening); an end that would collapse onto its
  start keeps one grid cell of length. Idempotent at amount 1.

### v0.8 additions — fully general drum hits (owner decision; research 12)

Drums stop being a step grid and become free-timed events, the way every mature DAW stores them
(Ableton MIDI notes, FL piano-roll notes, SMF, Hydrogen `.h2pattern` — see
`docs/research/12-drum-representation.md`, 25/25 verified). The step grid survives as a *view*,
not the storage model.

- **`hit <id> <lane> <start> <velocity>`** on a drum track (or drum-track clip): stable id, one
  of the five lanes, a fractional `start` in 16th steps (v0.7 number rules, absolute over the
  loop), velocity in (0, 1]. No duration — drum voices are one-shot triggers (SMF note-off is
  irrelevant for percussion; Hydrogen uses `length=-1`). Canonical order: (start, lane, id).
- **`pattern` lines are gone from the grammar** but v≤0.7 files still parse: legacy patterns
  migrate to hits on read (a step at velocity v → a hit at that step, the per-bar cycle tiled
  across the loop; ids `<lane><step>`). Lossless and automatic — old projects just work.
- **Grid sugar stays**: `beat set <track>.pattern.<lane>[<step>] <vel>` upserts/removes the
  on-grid hit at that integer step (0 removes); `beat inspect` still draws the `X...X` lane
  strip for the first bar and annotates off-grid hits (`N off-grid`). `beat quantize` now
  supports drums (starts only). New off-grid hits: `beat add-hit` / `beat_add_hit`.
- **Rendering**: the offline renderer schedules hits at their true fractional times through the
  drum bus (`engine.triggerDrum(lane, timeSec, velocity)`), bypassing the 16-step tick — in
  loop mode, verified sample-accurate (two snares 4.5 steps apart measured a 4.500-step gap,
  ±0ms). The GUI still consumes the projected 16-step pattern (a quantized view); off-grid hits
  live in the file and the daemon carries them over on GUI pushes, so they are never lost. Song
  mode still routes drums through the on-grid tick (off-grid drums in songs are a later slice).

### v0.9 additions — clip automation (docs/phase-9-automation-plan.md)

Phase 6 shipped clips/scenes/song (v0.4) but explicitly deferred clip automation, "needs the
automation grammar — next format phase" (`phase-6-plan.md`'s exclusions list). This is that
phase: a named synth param, inside one clip, gets a lane of (time, value) points.

```
  clip verse-a                 # level-1 block inside a track; human slug id (D6)
    note n1 57 0 4 0.8
    auto lead.cutoff            # automation lane for one param, scoped to this clip
      point p1 0 900             # point <id> <time> <value> — stable id, fractional time (v0.7 rules)
      point p2 2 3200
```

- **Clip-scoped only, deliberately** — automation lives on a `BeatClip`, never on a live/non-clip
  track. beatlab's own clip model already carries automation as engine state (per
  `phase-6-plan.md`'s survey: "Clips ... named, self-contained snapshots of a track's
  notes/pattern/automation"); there's no equivalent live-track automation concept to mirror, and
  adding one would be a second, unrelated grammar decision. If live/timeline automation is wanted
  later, it's a new addition, not a gap in this one.
- **`auto <track>.<param>`** opens a lane, one per param per clip (duplicate lanes for the same
  param on one clip are a parse error). The target repeats the enclosing track's own id — the
  same `<track>.<param>` addressing `beat set` already uses — rather than a bare param name, so
  a lane header is self-describing on its own line and a copy-pasted block that's dropped into
  the wrong track fails loudly (`auto target track "X" must match the enclosing track "Y"`)
  instead of silently automating the wrong track's param.
- **`param` must be a numeric synth field**: the core 9 minus `osc` (an enum, no numeric curve),
  plus every v0.3 field of kind `number` — `AUTOMATABLE_SYNTH_PARAMS` in `src/core/document.ts`,
  derived from the existing `SYNTH_PARAM_ORDER`/`SYNTH_FIELDS` tables rather than a
  hand-maintained parallel list (the format's "one table, many consumers" house style). Enum/
  bool/trackref fields (`osc`, `wtTable`, `filterType`, `osc2Type`, `lfoDest`/`lfo2Dest`,
  `lfoShape`, `duckSource`) are rejected at parse/edit time — they don't have a meaningful
  interpolated curve.
- **`point <id> <time> <value>`**: stable id (D6), `time` fractional 16th steps from the CLIP's
  own start (v0.7 number rules — same unit and precision as note/hit `start`, just a different
  origin), `value` in the automated param's own raw units (Hz, dB, 0..1, etc. — whatever that
  param's `set`/`synth` line already uses). No interpolation-curve field (DAWproject's `hold` vs
  `linear`, sketched in this doc's "Future" section below) — v0.9 ships points only; curve shape
  between points is deferred (see phase-9-automation-plan.md's Result section).
- **Canonical elision**: a lane exists only while it has >= 1 point — there is no serialized form
  for an empty lane (parse rejects an `auto` header with zero `point` children), the same
  discipline as v0.3's synth-field elision (one canonical form per state). A clip with no
  automation emits zero `auto` lines; every v0.8 file (no automation grammar at all) parses
  unchanged.
- **Canonical ordering**: lanes serialize in first-seen (creation) order within a clip, like
  clips themselves — order of creation is meaningful, not alphabetized. Points within a lane
  serialize sorted by `(time, id)` ascending, the same discipline as notes `(start, pitch, id)`
  and hits `(start, lane, id)`.
- **Diff**: unlike clip notes/hits (reported as a delta count on re-snapshot — clips are
  snapshots, so "what changed inside" is usually re-snapshot noise), automation points are
  itemized per-point, matched by `(param, id)`: `lead: clip "verse-a" cutoff automation point
  added p3 (step 3, value 100)`, `... point p2 value 900 -> 3200`, `... point p2 time 2 -> 3`,
  `... point removed p2 (step 2, value 3200)`. A knob move mid-clip is a specific musical fact
  worth naming, not noise.
- **Edit primitives** (`src/core/edit.ts`): `addAutomationPoint` / `moveAutomationPoint` /
  `removeAutomationPoint` (removing the last point in a lane drops the lane — no empty-lane
  state to represent) / `setAutomationPoint` (add-or-move in one call, by id). `saveClip`
  (re-snapshotting a track's live content into an existing clip) preserves that clip's existing
  automation rather than wiping it — there's no live-track automation to snapshot from, so
  automation is the one thing a re-snapshot doesn't touch.
- **CLI/MCP**: `beat automate <file> <track> <clip> <param> <time> <value> [--id p1]` / MCP tool
  `beat_automate` — adds a point, or moves it if `--id`/`id` names an existing point in that lane.
- **Converter** (`src/core/convert.ts`): beatlab's clip automation now converts (was reported
  dropped as `<track>.<clip>.automation` through v0.8); a param the format has no automatable
  field for still reports as dropped, as `<track>.<clip>.automation.<param>`. The exact shape of
  beatlab's live clip-automation engine state was NOT verified against real beatlab source (no
  local checkout available this phase) — see phase-9-automation-plan.md's Result section for
  what's assumed vs. confirmed.

### v0.10 additions — ordered, reorderable per-track effect chain (Phase 22 Stream AA)

Every synth track's insert chain used to be fixed in engine code: EQ3 -> compressor -> distortion
-> bitcrush, in that order, always, with no way to reorder, drop, or duplicate an insert
(`ui/src/audio/engine.ts`'s old `buildSynthChain()`). v0.10 makes the chain a literal, ordered list
in the file itself — flat text, no box/pointer graph (`docs/research/21-opendaw-devices-effects.md`
§3 row 1's "adapt, not adopt" verdict: get openDAW's *outcome* — arbitrary order, addable/
removable, reorderable — without its indirection mechanism).

```
  effect <id> <type> [bypassed]     # one line per insert, in FILE order = CHAIN order
```

- **`type`** is one of `eq3|comp|distortion|bitcrush` — the same four built-in inserts every synth
  track already has knobs for (`eqLow`/`eqMid`/`eqHigh`, `comp*`, `distortion*`, `bitcrush*` in
  `SYNTH_FIELDS`, unchanged). An `effect` line only says WHETHER, WHERE, and IN WHAT ORDER a type
  runs — the type's own params still live in the synth block, exactly as before. (This means
  dotbeat does not yet support two independently-parameterized instances of the same type — both
  would read the one shared `eqLow` etc. — a deliberate, documented scope cut, not an oversight;
  see `docs/phase-22-stream-aa.md`.)
- **`id`** is a stable, track-scoped human slug (D6) — what makes a reorder read as a MOVE (a line
  changes position) rather than a delete-and-reinsert-different-content pair (the alsdiff lesson,
  same discipline as note/hit/clip ids). Defaults (below) use the type name as the id (`eq3`,
  `comp`, `distortion`, `bitcrush`); `beat effect-add` mints `<type>_2`, `_3`, ... on collision.
- **`bypassed`** is the enabled/disabled token, styled after `SYNTH_FIELDS`'s own elision
  convention: enabled is the default and is elided (a bare `effect <id> <type>` line); only a
  disabled instance carries the trailing `bypassed` token. Bypass is a REAL routing bypass — the
  engine splices a disabled effect out of the audio graph entirely (`reconcileEffectChain` in
  `ui/src/audio/engine.ts`), not a wet/dry illusion — the only way to meaningfully bypass `eq3`,
  which has no mix knob of its own.
- **Canonical elision, at the whole-chain level**: `effect` lines are serialized iff the track's
  chain differs from the canonical default (`eq3`, `comp`, `distortion`, `bitcrush`, all enabled,
  in that order — `defaultEffectChain()` in `src/core/document.ts`). An untouched track — old or
  new — emits ZERO effect lines. If a track's chain is explicitly emptied (every insert removed),
  a single `effects none` sentinel line is emitted instead (there would otherwise be no way to
  tell "the user removed everything" from "this file predates the effect-chain grammar" on the
  next parse — the same one-canonical-form-per-state discipline as every other elision rule here).
- **Migration is on-load, automatic, lossless**: any synth track with zero `effect`/`effects`
  lines — every pre-v0.10 file, and any hand-written file that never mentions effects — parses
  into exactly the old hardcoded chain. Since that's also the canonical default, such a file
  re-serializes byte-identical to what it started as; `beat render`/the GUI sound identical to
  before this stream for every existing project. Proven by round-trip tests
  (`test/format-v10-effects.test.ts`).
- **Position in the track block**: right after the `synth` block, before `lane`/`clip`/`note`/`hit`
  lines. Synth tracks only — drum tracks (which also carry a `synth` block, driving the drum bus)
  and instrument tracks never carry `effect` lines; the drum-bus insert chain is untouched by this
  stream (a sibling stream owns drum tracks/kits).
- **Diff**: matched by id, like notes/hits/automation points — `diffDocuments` reports
  `effect-added`/`effect-removed`/`effect-moved`/`effect-enabled` as musical facts
  (`src/core/diff.ts`). A pure reorder's order-comparison runs over ids common to both sides only
  (the same discipline `track-moved` already uses), so an add/remove elsewhere in the list doesn't
  make unrelated entries look like they moved.
- **Edit primitives** (`src/core/edit.ts`): `addEffect`/`removeEffect`/`moveEffect` (structural —
  own CLI commands `beat effect-add`/`-rm`/`-move`, own MCP tools `beat_effect_add`/`_rm`/`_move`,
  same reasoning clip/scene/song get dedicated verbs instead of overloading `beat set`) and
  `setEffectEnabled` (fits `beat set`'s plain `path=value` grammar too, as
  `<track>.effect.<id>.enabled`, alongside its own `beat effect-bypass`/`beat_effect_bypass`).

### Deferred past v0.3 (explicitly out of scope, not forgotten)

Clips/scenes (shipped v0.4), swing, arrangement (shipped v0.4), multi-device chains beyond the
built-in insert set (shipped v0.10, above — multiple INSTANCES of the same type sharing params
remains out of scope), multi-token track names, and the `DELIBERATELY_UNMODELED` fields above. See
`phase-1-plan.md`'s "explicitly deferred" section — these come as the milestones that need them
land (`ROADMAP.md` §8). Clip automation shipped v0.9 (above); automation *curve shape* (linear vs
hold between points) and live/non-clip automation remain deferred.

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

*(v0.9 shipped clip-scoped automation — see above — but without the `interpolation` column: a
point is just `id, time, value`. Curve shape between points, and non-clip/live-track automation,
remain the deferred parts of this older, fuller sketch.)*

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

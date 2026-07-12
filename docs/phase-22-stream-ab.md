# Phase 22 Stream AB — drum voice expansion + drum clip editor redesign, as built

*Built together per research 20 Part 6 ("this redesign and research 19's voice expansion are one
body of work sharing one format version bump"). Scope: `docs/research/19-drum-voice-expansion.md`
+ `docs/research/20-drum-clip-editor-redesign.md`. Format bumped 0.9 → 0.10.*

## Summary

- **Format**: an open, per-track, declared drum lane list (`lanes: BeatDrumLaneDecl[]`) layered
  *additively* alongside the existing closed-5-lane mechanism — every pre-v0.10 `.beat` file parses
  into an identical document and re-serializes byte-for-byte unchanged. `hit` lines gained an
  optional trailing `duration`, elided when absent (same guarantee).
- **Presets**: `kit-808`, `kit-909` (synth-backed, `presets/drum-kits.json`), `kit-acoustic`
  (SoundFont-backed against `presets/sf2/muldjordkit-small.sf2`). `beat add-track --kind drums`
  defaults to the 12-lane GM-aligned kit going forward.
- **Engine** (`ui/src/audio/engine.ts`): a lane→backing dispatch table for tracks that declare
  lanes (synth/sample/sf), threading `duration` through as release (synth/sf) or truncation
  (sample), plus a hat/openhat choke group. The legacy 5-lane switch is **untouched** for tracks
  that declare no lanes.
- **Editor** (`ui/src/components/NoteView.tsx`): generalized behind a row-axis adapter; drum tracks
  now render through the same piano-roll-derived editor as synth tracks, with named-lane rows and
  marker/bar rendering for durationless/durationed hits. `StepSequencer.tsx` is retired (deleted).
- **Verified live**: `ui/verify-phase22-tracks.mjs` — a real DOM drag (marker → duration) checked
  against the on-disk file, and two real `beat render` passes (sample-lane truncation measured from
  decoded audio; a real legacy file's hits confirmed audible at their predicted times).

---

## 1. The grammar, exactly

### 1.1 `lane` declarations (new; additive to the existing v0.5 form)

```
track drums Drums #e06c75 drums
  synth
    ...
  lane kick synth:membrane tune=30 punch=0.08 decay=0.55
  lane snare synth:noise decay=0.18
  lane crash sample crash-1 -3 0
  lane rimshot sf gm-kit 0 37
  hit h1 kick 0 0.9
  hit h2 snare 4 0.8 2
```

One `lane <name> <backing>` line per declared lane, **declaration order is canonical order**
(matches `hit`/`pattern` lane sort, the editor's row order, and the engine's dispatch iteration).
Three backing forms:

| Form | Grammar | Meaning |
|---|---|---|
| synth | `lane <name> synth:<voice> [key=value ...]` | `voice` = `membrane`\|`noise`\|`metal`. Params are **only the ones that differ** from that voice's defaults (canonical elision, same discipline as `SYNTH_FIELDS`): `membrane` → `tune` (Hz, default 32.7), `punch` (pitchDecay, default 0.05), `decay` (default 0.4); `noise` → `decay` (default 0.13), `tone` (0..1 tonal-layer blend, default 0); `metal` → `decay` (default 0.05), `tone` (resonance Hz, default 4000). |
| sample | `lane <name> sample <sample-id> <gain dB> <tune semitones>` | Generalizes v0.5's `BeatLaneSample` off the closed lane enum. **New explicit keyword** (`sample`) — distinct from the legacy 4-token form below so the two never collide. |
| sf | `lane <name> sf <sample-id> <program> <note>` | A SoundFont note (`note` = GM MIDI note 0-127) on `<program>` of the referenced bank, played on the drum channel (GM channel 10 / index 9 — `DRUM_CHANNEL` in `engine.ts`, not the instrument path's hardcoded channel 0). |

A track's `lanes` list is `[]` (declares nothing) for every file written before this stream. **A
track with `lanes.length === 0` is assumed to have the 5 implicit `DRUM_LANES` (`kick/snare/clap/
hat/openhat`), synth-backed, in their historical order** — this assumption lives in the engine and
editor at read time; it is never materialized into the document, so a legacy file's serialized text
is untouched.

### 1.2 The legacy v0.5 form is unchanged

```
lane kick kick-909 -2 -3
```

Exactly 4 values (`<lane> <sample-id> <gain dB> <tune semitones>`), `<lane>` must be one of the
closed 5. This still populates the separate `laneSamples` map exactly as before v0.10 — it does
**not** touch the new `lanes` list. Disambiguation at parse time is by the 3rd token: `synth:...` →
synth form; `sample` → new sample form; `sf` → sf form; anything else → this legacy form (and the
line must then have exactly 5 tokens or it's a parse error). Real sample ids from the existing kit
presets (`kick-909`, `hat-x`, …) never collide with the literal strings `sample`/`sf` or a
`synth:`-prefixed token, so this is unambiguous in practice.

### 1.3 `hit` duration (new; additive)

```
hit <id> <lane> <start> <velocity> [<duration>]
```

`duration` is the 5th, **optional, trailing** token — 16th steps, fractional, `> 0`. Absent (4
tokens): today's lengthless one-shot trigger, byte-identical to every pre-existing hit line. This
is precisely the "optional trailing token" research 12 pre-authorized when it decided against
duration originally.

**Meaning is resolved by the lane's backing** (research 20 Part 4), not a per-hit flag:

| Backing | `duration` present | `duration` absent |
|---|---|---|
| `synth` | `triggerAttackRelease(freq, duration, …)` — the voice's envelope is gated to that length | voice-type default (`'8n'` membrane/noise, `'16n'` metal) |
| `sample` | `Tone.Player.start(time, 0, duration)` — truncates the one-shot, small fade to avoid a click | plays the whole buffer |
| `sf` | `noteOn` then a scheduled `noteOff` after `duration` | fire-and-forget (today's behavior) |

### 1.4 Validation

- Every `hit`'s lane must be declared: in the track's own `lanes` list if non-empty, else one of
  the 5 `DRUM_LANES`. An undeclared lane is a parse error (`unknown drum lane "X" … declare it with
  a "lane" line first`).
- `lane` declarations within one track must have unique names.
- `sample`/`sf` backings must reference a sample id present in the document's `media` block (same
  "register it with `beat sample` first" failure mode as instrument soundfonts and v0.5 lane
  samples).
- `duration > 0`, same precision rules as `start`/`BeatNote.duration`.

---

## 2. Migration — how it stays lossless

There is no migration *pass*: a v0.9-or-earlier drum track simply never has `lane`/`lanes` content
beyond what it always had, and `parse()` initializes `lanes: []` for every track regardless of
version. The round-trip guarantee comes from three independent facts:

1. **The legacy `laneSamples` mechanism is untouched code** — same grammar, same field, same
   serializer branch as before this stream.
2. **`declaredLaneNames()` falls back to `DRUM_LANES`** whenever `lanes.length === 0`, so hit
   validation, the engine's mode selection, and the editor's row axis all treat a legacy track
   exactly as dotbeat always has.
3. **The `lanes` list only ever serializes lines for what it explicitly contains** — an empty list
   emits zero `lane <name> synth:…` lines.

`test/format-v10-drum-lanes.test.ts` proves this directly: a hand-written v0.9 file (5 lanes, no
declarations) round-trips `serialize(parse(x)) === x`, and a v0.5 file using the legacy
`lane <lane> <sample-id> <gain> <tune>` form also round-trips byte-identically. `format-spec.md`'s
v0.10 section has the same guarantee spelled out for a reader who only wants the summary.

## 3. What plays which way (engine)

`ui/src/audio/engine.ts` keeps its original `DrumKit` struct and `triggerDrum` `switch` **entirely
unmodified** for a track with `lanes.length === 0` — this is deliberate: the verification bar
("confirm an old 5-lane file still plays identically before/after") is trivially true when the
code path is provably untouched, not just "should sound the same."

For a track with declared lanes, `syncDeclaredDrumLanes()` builds one `LaneVoice` per declared lane
(`synth` → a parameterized `MembraneSynth`/`NoiseSynth`/`MetalSynth`, reusing the same building
blocks the legacy kit hand-wires; `sample` → a lazily-loaded `Tone.Player`, finally implementing the
deferred v0.5 live sample-lane playback noted at the old `engine.ts:42`; `sf` → one shared
`WorkletSynthesizer` per drum track on `DRUM_CHANNEL`, keyed by GM note). `triggerDrum` dispatches
into this table and threads `h.duration` through per the table in §1.3. A closed-hat trigger
(`lane === 'hat'`) chokes a ringing `'openhat'` voice first (`chokeDeclaredLane`) — keyed by
canonical name, not a general choke-group declaration (out of scope, see §5).

## 4. The editor

`NoteView.tsx` is now the only note/hit editor (`StepSequencer.tsx` deleted). It's parameterized by
a `RowAxis` (`rowCount`/`rowLabel`/`rowOfValue`/`valueOfRow`/`octaveRows`/`preview`) built two ways:

- **`buildPitchAxis`** — unchanged behavior: the padded octave-snapped pitch window, piano-key
  gutter, `Shift+Up/Down` = an octave.
- **`buildLaneAxis`** — rows are the drum track's declared lane names (or the implicit 5); the
  gutter shows lane-name labels; clicking one previews the lane *and* narrows the vary-scope
  selection (the exact behavior `StepSequencer`'s lane-label click had). `octaveRows: 0` — no
  octave nudge for drum rows, per research 20 Part 5.

Every note/hit is normalized into one `EditorEvent {id, start, duration, velocity, row}` before any
pointer math runs, so marquee/multi-select/group-move/group-resize/keyboard-nudge/velocity-lane are
literally the same code for both track kinds. The one behavioral fork: a hit with `duration ===
undefined` renders as a small marker (not a bar); dragging its resize handle sets a duration
(marker → bar); dragging a bar's duration back to 0 clears it (bar → marker again, posting an empty
`.duration` value — `setValue`'s existing "empty value deletes" convention).

**Grid snap**: plain drags round to the nearest whole 16th step (unchanged default); holding
Alt/Cmd bypasses rounding for a freehand, fractional placement — research 20 Part 1's "soft,
per-drag-bypassable snap," applied uniformly to notes and hits (previously neither had any bypass;
this is a small net-new capability for melodic dragging too, not just drums).

## 5. Deliberate scope cuts (honest gaps)

- **No GUI knob surface for per-lane synth params.** A lane's `tune`/`punch`/`decay`/`tone` are
  fully wired end-to-end (format, engine, `beat drum-kit`), but there's no per-lane device panel to
  drag them from yet — author via a kit preset (`beat drum-kit`) or a hand `beat set`-style edit
  (no dedicated `setValue` path for `lanes[].backing.params` was added either; extending
  `applyDrumKit`-style replace-the-whole-lane semantics to a fine-grained per-param edit is future
  work).
- **No Draw-Mode-style fast on-grid toggle.** Research 20 explicitly allowed keeping one if wanted;
  not built this pass — the unified editor's plain click-to-add already covers the common case.
- **`cli/render.mjs`/the offline path needed no separate change** — Phase 20's D15 consolidation
  means there's exactly one engine (`ui/src/audio/engine.ts`); `beat render` drives it headless, so
  this stream's engine work is already the offline story too.
- **The beatlab browser-bridge pattern projection (`convert.ts`'s `hitsToPattern`) silently drops
  hits on lanes outside the closed 5** when bridging to/from a live BeatLab sandbox payload —
  beatlab's own store has no open-lane concept yet (research 19's own scope note). The `.beat` file
  itself never loses these hits; only that one legacy interop view does.
- **Choke groups are hardcoded to the `hat`/`openhat` canonical names**, not a general per-kit
  choke-group declaration — matches what research 19/20 actually asked for ("the hat pair"); a
  kit using different names for its hats won't choke automatically.
- **Multi-drum-track playback remains a pre-existing engine limitation** (the engine only ever
  finds the *first* `kind: 'drums'` track), unrelated to and unchanged by this stream.

## 6. Verification

- `npm test`: 309/309 passing, including `test/format-v10-drum-lanes.test.ts` (migration
  byte-identity, all three new `lane` backing forms, undeclared-lane rejection, duplicate-lane
  rejection, hit duration parse/serialize/elision, `setValue`'s hit grammar, `defaultDrumKitLanes()`,
  `addTrack`'s opt-in-only 12-lane default, diff `lane-decl`/`hit-changed.duration` entries).
- `ui/verify-phase22-tracks.mjs` (live, real browser + real rendered audio):
  - **A**: click-added a hit on the `kick` row of a fresh 12-lane-kit drum track (landed as a
    4-token marker line on disk), dragged its resize handle, confirmed the file gained a 5-token
    line whose duration matches the in-memory document.
  - **B**: rendered the same sample-backed kick hit with and without a duration through `beat
    render`'s real engine path; decoded both WAVs and measured tail energy in the sample's decay
    window — the durationed render's tail energy was ~0 against the undurationed render's real
    decay energy (ratio > 10¹⁰), i.e. genuine, measured truncation.
  - **C**: rendered the real `examples/night-shift.beat` (a legacy file whose drums track declares
    no lanes) end-to-end and confirmed audible energy at each of its pattern-derived kick hit times
    — the untouched legacy `triggerDrum` switch still fires correctly post-refactor.

# `.beat` path/selection grammar — condensed from `docs/format-spec.md`

The `.beat` file itself is line-oriented text (see `docs/format-spec.md` for the full grammar and
worked example). This reference is about the **paths and grammars an agent constructs** when
calling `beat set` / `beat_set`, `beat selection` / `beat_selection`, and reading `beat inspect`
output — not the raw file syntax, which is normally never hand-written (always go through the CLI/
MCP edit primitives so the canonical form and edit-list output stay correct).

## `beat set` path shapes

| Path | Meaning | Example |
|---|---|---|
| `bpm` | tempo, integer | `beat set song.beat bpm 124` |
| `loop_bars` | loop length in bars, integer | `beat set song.beat loop_bars 4` |
| `selected_track` | which track id is "selected" (a document field, distinct from the ephemeral GUI selection below) | `beat set song.beat selected_track drums` |
| `<track>.<param>` | a synth param on that track (see table below) | `beat set song.beat lead.cutoff 900` |
| `<track>.name` | track display name (single token) | `beat set song.beat lead.name Lead2` |
| `<track>.color` | lowercase `#rrggbb` | `beat set song.beat lead.color #c678dd` |
| `<track>.pattern.<lane>[<step>]` | grid sugar: upsert/remove the on-grid drum hit at integer 16th-step `<step>` (0-15, one bar); velocity `0` removes it | `beat set song.beat "drums.pattern.hat[2]" 0.6` |

**Quote the pattern path.** `[` and `]` are shell glob metacharacters; in zsh an unquoted
`drums.pattern.hat[2]` fails with `no matches found` rather than being passed through — confirmed
directly. Always quote: `"drums.pattern.hat[2]"`.

Multiple edits batch in one call: `beat set song.beat lead.cutoff 900 bpm 124` (path/value pairs,
alternating). Each `beat set` call writes the canonical form once and prints one combined edit
list — prefer batching related edits into one call over many single-edit calls.

## Synth params (`<track>.<param>`)

Core 9 (always present on synth/drum tracks): `osc, volume, cutoff, resonance, attack, decay,
sustain, release, pan`.

Optional shaped surface (~46 fields, elided from the file when at default — `beat inspect`/`beat
set`'s edit-list output still shows every change you make regardless of elision):

- Oscillator: `osc2Type, osc2Level, osc2Detune, subLevel, noiseLevel, fm*, unisonVoices,
  unisonWidth, wtTable, wtPos`
- Filter/motion: `filterType, filterEnv*, lfo*, lfo2*, glide, keytrackAmount, velToFilterAmount,
  macroValue`
- Inserts: `eq*, comp*, distortion*, bitcrush*, pingPong*, chorus*, phaser*, saturator*`
- Beat repeat (scheduling-layer stutter, not an audio insert): `beatRepeatGrid, beatRepeatGate,
  beatRepeatChance, beatRepeatMode`
- Sends/routing: `sendReverb, sendDelay, duckSource` (a track id, or `none` to clear),
  `duckAmount`
- Drum-voice shaping (audible on drum tracks): `kickTune, kickPunch, kickDecay, snareTone,
  snareDecay, hatTone, hatDecay, openHatDecay`

The single source of truth for the exact field list, types, and frozen defaults is
`SYNTH_FIELDS` in `src/core/document.ts` in the dotbeat repo — read it directly if a param name is
uncertain rather than guessing.

## Note / drum-hit grammar (via dedicated verbs, not `beat set`)

- **Notes** (synth/instrument tracks): `beat add-note <file> <track> <pitch 0-127> <start>
  <duration> <velocity 0..1>`. `start`/`duration` are in 16th-note steps and accept fractional
  values (v0.7: off-grid/tapped timing) — `3.5` is halfway between steps 3 and 4.
- **Drum hits** (drum tracks): `beat add-hit <file> <track> <lane> <start> <velocity>`. `lane` is
  one of `kick|snare|clap|hat|openhat`. No duration — drum voices are one-shot triggers. `start` is
  fractional 16th steps, absolute over the loop (not per-bar). The `beat set
  track.pattern.lane[step]` sugar above is the integer-step-only shortcut for the common case.
- Removal: `beat rm-note <file> <track> <note-id>` / `beat rm-hit <file> <track> <hit-id>` — ids
  come from `beat inspect` or the edit-list output of whatever created the note/hit.
- **Clip automation** (inside a named clip only, not on a live track): `beat automate <file>
  <track> <clip> <param> <time> <value> [--id p1]`. `time` is fractional 16th steps from the
  *clip's own start* (not the loop start). `param` must be a numeric synth field (the core 9 minus
  `osc`, plus every numeric v0.3 field) — enum/bool/trackref fields are rejected. Omit `--id` to
  add a new point; pass an existing point's id to move it instead.

## Selection grammar (`beat selection --set "..."` / `beat_selection`'s `set` argument)

```
selection
  tracks drums bass
  lanes drums.hat drums.openhat
  bars 8 16
  notes lead.u3 lead.u7
```

- Header line `selection`, then any subset of `tracks`/`lanes`/`bars`/`notes`, each indented
  **exactly 2 spaces**, in that **fixed order** (parsing rejects out-of-order or duplicate axes).
- `lanes`/`notes` entries are `track.entry` (dotted) — a lane or note/hit id scoped to one track.
- `bars` is a `start end` window in bars (not steps).
- **Axis semantics** (decided, not a live open question — see `src/core/selection.ts`'s header
  comment): an absent axis is unfiltered ("matches everything on that axis"), not "nothing".
  Present axes AND together (intersect), not OR. The fully-empty selection (`selection\n`, no axis
  lines) means "everything, unfiltered" — which is why the CLI/daemon display it as "no selection":
  it's the degenerate case of every axis being absent, not a different code path.
- Read the live selection: `beat selection --port <p>`. Set it: `beat selection --port <p> --set
  "<grammar text>"`. Clear it: `beat selection --port <p> --clear`. Requires a running daemon
  (`beat daemon <file> --port <p>`) — the selection lives in the daemon's memory only, never in the
  `.beat` file.
- `beat vary <file> <track> feel --scope selection --port <p>` resolves the daemon's live selection
  into vary's own `{lanes}` or `{ids}` scope for exactly `<track>` — confirmed: a selection of
  `lanes drums.hat` resolves to `--lanes hat`; a selection naming a different track than the one
  passed to `beat vary` throws rather than silently varying the wrong thing.

## `beat inspect` output, read

```
format 0.9 | 124 bpm | 2 bars (32 steps) | selected: lead
tracks: 2

lead  "lead"  synth  #e06c75
  synth: sawtooth, -10 dB, cutoff 900 Hz, res 0.8, ADSR 0.01/0.2/0.6/0.3, pan 0
  notes: 1, pitch 64-64, steps 0-0 of 32

drums  "Drums"  drums  #56b6c2
  synth: sawtooth, -10 dB, cutoff 12000 Hz, res 0.1, ADSR 0.01/0.2/0.6/0.3, pan 0
  kick    ................  (0 hits)
  hat     ..x..x..........  (2 hits, 1 off-grid)
```

The `X...X` lane strip is the projected 16-step grid for bar 1 only; a hit off that grid shows as
"N off-grid" in the count. Always run this before editing an unfamiliar project — it's the fastest
way to learn real track ids (never assume `lead`/`bass`/`drums`; a project can name tracks
anything).

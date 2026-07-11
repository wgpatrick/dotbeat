# Format v0.8 design — fully general drum hits

*Started 2026-07-11 from owner direction: "the drum hits need to be fully general — that's
really key from my POV — definitely research how ableton and other DAWs do this." Research 12
(deep-research pass on Ableton/.als, FL, Logic, Bitwig, SMF/PPQ, trackers, Hydrogen, and
step-grid→free-timing migration patterns) is running; this doc frames the decision so its
findings land somewhere. DRAFT until research 12 is folded in.*

## The problem

Drum tracks are the format's one remaining grid prison: `pattern <lane> <v0..v15>` stores a
fixed 16-slot-per-bar velocity array per lane. That grammar *cannot say* "kick at step 4.31" —
no off-grid hits, no flams, no rushed hats, no tapped-in drum takes (owner's live-capture
requirement), no humanize-timing in `beat vary`. Melodic tracks escaped in v0.7; drums are
still boxed.

## What we already know (pre-research working theory)

Ableton's model: there is no separate "drum event" — Drum Rack pads are pitch-mapped, and
drum hits are ordinary MIDI notes in a clip with arbitrary time/velocity. The step-sequencer
appearance is an *input/view* convention, not a storage format. FL Studio similarly converts
steps to piano-roll notes. If that survives research, the answer shape is:

**Hits become first-class events; the grid becomes a view.**

## Candidate grammars

### A. `hit` lines as ground truth (leading candidate)

```
track drums Drums #e06c75 drums
  lane hat presets/kit/hat.wav ...        # unchanged v0.5 lane-sample lines
  hit h1 kick 0 0.9
  hit h2 hat 2 0.6
  hit h3 hat 4.31 0.55                    # fully general: any time
  hit h4 kick 8.5 0.7
```

- `hit <id> <lane> <start> <velocity>` — stable id, lane ref, fractional start (v0.7 number
  rules), velocity. No duration: drum voices/one-shots are triggers (matches engine
  `triggerDrum`; SMF note-off is irrelevant for percussion — verify in research).
- Canonical sort: (start, lane, id). One hit per line → still one musical event per diff line.
- `pattern` lines **disappear from the grammar** in v0.8; the parser migrates v≤0.7 files by
  expanding patterns into on-grid hits (16 slots/bar → hits at integer steps), minting stable
  ids (`h<lane><n>`). One-way, lossless, automatic.

### B. Dual storage (pattern + overflow hits) — rejected unless research argues otherwise

Keeping `pattern` for on-grid content plus `hit` lines for off-grid extras means two sources
of truth, undefined ordering, and every consumer handling both. The diff-prettiness of
`pattern` isn't worth the semantic fork.

### C. Per-hit duration / note-style drums

Full note lines for drums (`note` with lane instead of pitch). Adds duration nobody uses for
one-shots today; but choke groups / gated sends may want it eventually. Research question:
do DAWs store drum durations meaningfully? If yes, `hit` grows an *optional* duration token
later without breaking canon (elided when absent).

## What the grid becomes

- **Inspect**: `beat inspect` keeps rendering the X...X lane grid for hits that quantize
  cleanly, and annotates off-grid hits (`kick +0.31`). The view survives; the prison doesn't.
- **Edit sugar**: `beat set drums.pattern.kick[3] 0.7` stays as sugar — it upserts/removes
  the on-grid hit at step 3. Existing agent muscle memory keeps working.
- **GUI step sequencer**: becomes an editor over on-grid hits (toggle = add/remove hit), with
  off-grid hits drawn between cells (beatlab change, dev-gated as always).
- **Quantize**: `beat quantize` grows drum support (starts only — no ends without duration),
  closing the "drums are pre-quantized" asymmetry.

## Blast radius (why this is the biggest format change since v0.2)

parse/serialize/document types (BeatDrumPattern → hits), migration in parse, diff entries
(pattern-step → hit-added/removed/changed), edit.ts (setValue pattern sugar, addHit/rmHit),
convert.ts both directions (beatlab payloads still speak 16-step patterns — projection
question below), vary (pattern groups → hit groups + timing-humanize unlock), render paths
(offline: schedule hits at fractional steps — engine already proven sample-accurate in v0.7;
one-shot lane samples unchanged), daemon carry-over rules, beatlab GUI step-seq (main-repo,
dev-gated), presets/kit demos, format-spec, tests throughout.

## Open questions for research 12

1. Confirm Ableton stores drum hits as ordinary MIDI note events with arbitrary time (and how
   .als encodes time/duration/velocity + Live 11 per-note probability/deviation).
2. Do any shipped tools keep *dual* storage (grid + events), or is grid-as-view universal?
   (Decides A vs B definitively.)
3. Drum durations: stored and meaningful, or vestigial for one-shots? (Decides C's timing.)
4. Per-hit vs per-pad split for expressiveness (probability, ratchet, choke, round-robin) —
   what belongs on the `hit` line eventually vs on the `lane`/kit line.
5. Groove/swing: destructive event-time application vs non-destructive groove overlay
   (Ableton groove pool) — informs whether a future `groove` param belongs at track level.
6. Migration precedent: how did tools with step grids add free timing without breaking
   existing projects?

## GUI sync question (needs an answer at build time, not research time)

beatlab's payload speaks 16-step patterns. Options once hits are ground truth:
(a) project on-grid hits into the pattern payload and treat GUI pattern edits as on-grid hit
upserts (off-grid hits daemon-preserved like instrument tracks — never erased by GUI pushes);
(b) teach beatlab a hits model (bigger main-repo change, dev-gated). Leaning (a) now, (b)
with the D-track GUI work.

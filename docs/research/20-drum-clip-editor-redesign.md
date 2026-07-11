# Research 20 — The drum clip editor redesign: piano-roll-for-drums + optional hit duration

*2026-07-11. Commissioned by `docs/phase-21-plan.md` ("the drum clip editor needs to be redone"),
following direct owner feedback with two side-by-side screenshots (dotbeat's current
`StepSequencer` vs. a real Ableton drum-rack note editor). Owner's words: "we don't want this type
of loop concept… the drums can be anywhere, they're not just on 16th notes… the drums can be any
length." This doc scopes the **editing model** and the **one format decision it forces** (hit
duration). It **extends research 19** (`docs/research/19-drum-voice-expansion.md`, the open per-kit
lane model + synth/sample/SoundFont substrate split) rather than duplicating it — and concludes the
two are one body of work, not two.*

## How to read this doc

- **[verified-local]** — confirmed by reading dotbeat source this pass (file + line cited).
- **[cited]** — from an external primary source (Ableton manual etc.; URL in Sources).
- **[general]** — well-established domain knowledge not pinned to one authoritative page this pass;
  flagged so it's confirmed before it drives an irreversible call.

---

# Part 0 — What's already true, confirmed against the code (don't re-derive)

Phase 21's plan asserted three things "checked directly against the real code." Re-confirmed here:

1. **Arbitrary hit timing is already fully supported by the format** [verified-local,
   `src/core/document.ts:54-63`]. `BeatDrumHit` is `{ id, lane, start, velocity }` with
   `start` = "16th steps, fractional, absolute over the loop." Free-timed, not grid-locked. The
   format-spec agrees: `hit <id> <lane> <start> <velocity>`, "fractional allowed… velocity in
   (0, 1]" (`docs/format-spec.md:357-360`). **The rigid 16-step toggle grid is purely a
   `StepSequencer.tsx` UI ceiling**, not a format limit.

2. **`StepSequencer.tsx` actively throws away that freedom** [verified-local,
   `ui/src/components/StepSequencer.tsx:18-26, 80`]. It *projects* free-timed hits onto a
   `loop_bars × 16` velocity array by `Math.round(h.start)` (`:22`) — a hit at `start 6.5` is
   rendered as if it were at step 7 — and a toggle POSTs `pattern.<lane>[i]`, i.e. an integer step.
   So the current editor cannot even *display*, let alone create, an off-grid hit. It is
   structurally a grid toggle, not a note editor. This is exactly the gap the owner's screenshot
   comparison shows.

3. **Hit duration is not modeled at all, and that was deliberate** [verified-local,
   `document.ts:54-57`, `format-spec.md:359-360`]. The v0.8 comment reads: "No duration: drum
   voices/one-shots are triggers (SMF note-off irrelevance for percussion; Hydrogen's length=-1 —
   research 12)." The owner is asking to reverse this for the sustained/tuned case. Part 3 shows
   the reversal is **additive and small**, not a repudiation of research 12.

4. **`NoteView.tsx` already is a full piano-roll editor with every gesture drums need**
   [verified-local, `ui/src/components/NoteView.tsx`]: click-empty-to-add (`:162`), drag-to-move
   with group-relative offsets (`:194-214`), **drag-the-right-edge-to-resize writing
   `.note.<id>.duration`** (`:226`, `:403`), marquee rubber-band select (`:112-147`),
   shift/cmd multi-select (`:170-172`), uniform-delta group resize (Ableton's exact convention,
   `:204-211`), a velocity lane (`:415-440`), and keyboard nudge/resize/delete/select-all
   (`:240-299`). Every edit fans out one `postEdit` per event = one `.beat` line (`:94-98`,
   `:222-227`). This is ~440 lines of subtle, already-verified pointer math. **The drum editor the
   owner wants is this component with two changes** (Part 5): rows keyed by named lane instead of
   MIDI pitch, and events that may lack a duration.

---

# Part 1 — Is Ableton's drum editor literally the piano roll? (Q1)

**Yes — it is the exact same component.** Ableton has *one* MIDI Note Editor; a Drum Rack track
does not open a different editor, it re-labels the same one's vertical axis.

- **Same editor, different vertical axis** [cited, Live 12 manual, *Editing MIDI*]: "The same MIDI
  Note Editor is used for all MIDI tracks." The note ruler's vertical axis "displays octaves
  C-2–C8… or **a list of drum pads if a Drum Rack is loaded**." So pitch rows simply become named
  drum-pad rows. Everything else — marquee, multi-select, group move/resize, velocity lane, draw
  mode — is identical because it is literally the same code.
- **Fold to Notes = hide empty lanes** [cited, same]: "If Fold to Notes is activated on a track
  containing a Drum Rack, only rows containing MIDI notes are displayed." A convenience for kits
  with many pads, not a different interaction.
- **The grid is magnetic, not a hard constraint** [cited, same]. Snapping is *adaptive*: a note
  "will move freely up to the first grid line… and afterwards… snap to grid lines." Snap can be
  turned off entirely (Grid Settings / **Ctrl+4 / Cmd+4**), and — the key point for the owner's
  "drums can be anywhere" — **holding Alt (Win) / Cmd (Mac) while dragging bypasses quantization**
  for freehand placement; if grid is off, the same modifier temporarily re-enables it. So Ableton's
  answer to "not locked to 16th notes" is not "no grid" — it's **a soft, per-drag-bypassable snap**.
- **Draw Mode (B)** draws notes at the current grid size [cited, same].

**Reconciliation with the owner's screenshot:** what looked like "hits at arbitrary positions not
locked to any visible grid" is Ableton's *soft* snap with off-grid hits retaining their offset. The
transferable lesson for dotbeat: build the drum editor as **the note editor with named-lane rows**,
carry over a **soft snap with a bypass modifier** (dotbeat's `beat quantize` already implements the
Ableton grid-snap model over free timing — `docs/format-spec.md`, the v0.7 quantize note), and let
hits live at fractional `start` — which the format *already* stores losslessly.

---

# Part 2 — What "length" means for a drum hit (Q2)

**In the UI:** you set a drum hit's length exactly like any MIDI note — **drag its left or right
edge** [cited, Live 12 manual: "click on a note's left or right edge and drag it to adjust the
note's length," with Alt/Cmd for freehand]. There is no separate drum-length gesture; a Drum Rack
note is a normal MIDI note with a length. `NoteView.tsx:403` already implements precisely this edge
drag for melodic notes.

**What that length *does* is decided by the device under the pad — and Ableton's own Simpler is the
living proof that "length" means different things for a sample vs. an envelope-backed voice.** A
Drum Rack pad is (almost always) a Simpler, whose playback mode determines note-length behavior
[cited, Live manual + FaderPro]:

| Simpler mode | What note length does | dotbeat analogue |
|---|---|---|
| **One-Shot / Trigger** (default for drums) | **Ignored** — "your sound is played back in its entirety when a note is pressed," regardless of how long you hold. | Today's dotbeat: a lengthless trigger. |
| **One-Shot / Gate** | **Truncates the sample** — "samples are played back only as long as the note is pressed." Cuts the one-shot early. | A *sample* hit with a duration = play only that much of the sample. |
| **Classic** | **Gates an amp ADSR envelope** — "samples only play back for as long as the note is held," then release; "sustained, pitched playing suitable for melodic applications." | A *synth/sustained* hit with a duration = extend the voice's sustain/release. The tuned-808-as-bass case. |

So the answer to "choke/truncate a sample early, or extend a synth voice's release?" is **both, and
which one depends on the voice type** — and Ableton exposes exactly that split via a per-voice mode
toggle. Length is not one behavior; it is "gate the voice for this long," and each substrate has its
own idea of what being gated means.

---

# Part 3 — Reconciling with research 12 (Q3): the optional field *is* what 12 anticipated

Research 12 (`docs/research/12-drum-representation.md`) was a 25/25-confirmed pass whose core finding
was **"hits as ground truth, grid as view; every mature system stores free-timed events."** That
finding is **untouched and reinforced** by this redesign — the redesign is *about* finally exposing
the free-timed model the research already banked.

On duration specifically, research 12 said two things:

1. Its decision: **"No duration on hits (SMF one-shot convention + Hydrogen `length=-1`)."** The
   reasoning — most percussion is a one-shot; a kick/snare/clap/hat sample plays to its natural end
   and note-off is irrelevant — **remains true for the majority of hits.**
2. Its explicit escape hatch, verbatim: *"If choke/gate ever needs it, **an optional trailing token
   adds back compatibly under canonical elision.**"* Research 12 **pre-authorized exactly this
   change** and even specified its shape: an optional trailing token, elided when absent.

So the reconciliation is clean and the smallest possible: **add `duration` as an optional trailing
field on `BeatDrumHit`.**

- **Absent (the default, the common case)** → today's lengthless trigger. Because it is elided under
  canonical serialization (D3), *every existing `.beat` file and every ordinary kick/snare/hat hit
  serializes byte-for-byte identically to today.* No reflow, no migration churn (D4/D7 satisfied).
- **Present** → the sustained/gated case: the hit is gated for that many steps (Part 4 defines what
  "gated" does per substrate).

This is **not** a wholesale reversal of research 12; it is the elided-optional token research 12
itself named. The grammar goes from `hit <id> <lane> <start> <velocity>` to
`hit <id> <lane> <start> <velocity> [<duration>]` — duration **last**, so absence is a pure
truncation of the line and back-compat is structural, not conventional. (Contrast: putting duration
before velocity, as `note` lines do at `format-spec.md:115`, would break every existing `hit` line.
Append, don't insert.)

**Verdict on Q3: an optional duration field cleanly coexists with research 12. No substantial
revision of 12 is needed** — its "events not grids" spine is exactly what we're building on, and its
one caveat about duration is being cashed in precisely as written.

---

# Part 4 — Duration means different things per substrate (Q4): confirmed, with reasoning

The brief hypothesized: synthesized voices already have an obvious release/duration parameter, so
duration = extend the voice; sample one-shots more naturally mean "how much of the sample plays," so
duration = truncation. **Confirmed, and it maps 1:1 onto research 19's three substrates and onto
Simpler's three modes (Part 2).** Research 19 established that a drum lane can be backed three ways;
duration resolves against the backing:

1. **Synth-backed lane** (Tone.js voice — the 808/909 canon; research 19 Part I.3). Duration →
   **the voice's amp envelope is gated to that length** (sustain then release). This is nearly free
   because the machinery already exists: `triggerDrum` already calls
   `triggerAttackRelease(freq, <dur>, time, velocity)` — it just passes **hardcoded** durations
   today (`'8n'` for kick/snare/clap, `'32n'`/`'16n'` for hats) [verified-local,
   `ui/src/audio/engine.ts:993-1006`]. Honoring a per-hit duration is *swapping the hardcoded
   literal for the hit's own value* — the identical thing the synth **note** path already does
   (`engine.ts:1289`, `triggerAttackRelease(freq, dur, …)` where `dur` is the note's duration).
   This is Simpler's **Classic** mode, and it is exactly the "tuned, sustained 808 kick played as a
   bass-like note" the owner cited and v0.8 didn't weigh.

2. **Sample-backed one-shot lane** (`lane <lane> <sample-id> <gain> <tune>`, v0.5;
   `BeatLaneSample`, `document.ts:213-217`). Duration → **truncation: play only that much of the
   sample, then cut/fade** (Simpler **One-Shot / Gate**). Absent duration → play the whole sample
   (One-Shot / **Trigger**) — today's behavior. This matches the hypothesis exactly: for a
   fixed sample there is no "release envelope" to extend; the only meaningful length is *how far
   into the sample you get.* (Caveat, unchanged from research 19: live sample-lane playback is a
   **deferred** engine item — `engine.ts:42` — so this truncation lands together with first
   building sample-lane playback at all. Noted, not free.)

3. **SoundFont-backed lane** (research 19's recommended path for realistic/acoustic kits; the
   spessasynth instrument path, `engine.ts:799-830`). Duration → **note-off after that length →
   the SF2 preset's own amp release** (also Classic-like). `noteOn(channel, midi, vel)` today never
   sends a matching `noteOff`; a duration gives it one. For a percussion SF2 whose samples have a
   natural decay this behaves like the sample case in practice, but the *mechanism* is envelope
   release, so it belongs with the synth case.

**So a single optional `duration` field, one meaning per substrate — release for envelope-backed
voices (synth, SF2), truncation for raw sample one-shots — is coherent and directly mirrors Ableton
Simpler's mode split.** The substrate already selects the behavior; no per-hit "mode" flag is needed
on the event. (An optional *per-lane* mode override — "this sample lane should Gate by default" —
pairs naturally with research 19's per-lane backing declaration if ever wanted; not required for v1.)

---

# Part 5 — Editor: extend `NoteView`, don't fork it

**Recommendation: generalize `NoteView` into one editor that takes a row-axis model, and render
drum tracks through it. Do not build a separate-but-copied component, and retire
`StepSequencer` as the primary drum editor.**

Ableton's architecture is the strongest argument: it ships **literally one** MIDI Note Editor and
swaps the vertical axis (Part 1). dotbeat should mirror that — one editor, two row models — because:

- **The interaction machinery is identical and subtle.** `NoteView` is ~440 lines of pointer math
  (marquee overlap tests, group-relative clamping, uniform-delta resize, pointer capture,
  velocity-lane mapping, keyboard handling). A forked copy is guaranteed to drift: a bug fix or an
  Ableton-parity tweak to one editor silently rots the other. One shared engine with two thin
  adapters is the maintainable shape.
- **With an optional duration, a hit and a note are the same event shape.** A `BeatNote` is
  `{ id, start, duration, velocity, pitch }`; a `BeatDrumHit` becomes
  `{ id, start, velocity, lane, duration? }`. Both reduce to *a positioned, optionally-lengthed,
  velocity-carrying event on a labelled row.* The only true differences:
  1. **Row axis.** Melodic: continuous MIDI pitch `lo..hi` (`NoteView.tsx:84-88`), up/down = ±1
     semitone / ±octave. Drum: the kit's **declared, finite, ordered lane list** (research 19's
     per-kit `lanes`), row label = lane name, up/down = move between adjacent lanes (no 0–127
     clamp, no octave nudge). This is the "pitch rows → named-lane rows" swap Ableton makes.
  2. **Optional duration rendering + edit path.** A hit with no `duration` renders as a fixed-width
     **marker/diamond** (a trigger), not a resizable bar; dragging its edge *adds* a duration
     (0 → sustained). A hit with a duration renders and resizes exactly like a note. Edits POST
     `hit`-grammar primitives (`<track>.hit.<id>.start` / `.velocity` / `.duration`, add via
     `<track>.hit`), the drum analogue of the existing `<track>.note.*` paths.
- **Concretely:** lift the row axis behind a small interface — `rowCount`, `rowLabel(i)`,
  `eventRow(ev)` / `rowToValue(i)`, `nudgeRow(±1)` — plus an `eventKind: 'note' | 'hit'` that
  chooses the edit-primitive namespace and whether missing-duration renders as a marker. Everything
  else (marquee, multi-select, group move/resize, velocity lane, keyboard, `postEdit` fan-out)
  is reused unchanged. This is a **refactor-and-extend, ~1 new adapter**, not a rewrite.
- **`StepSequencer`'s fate:** demote or delete. Its one virtue is fast on-grid toggling; that maps
  to Ableton's **Draw Mode + grid snap** *inside* the unified editor. Keeping it as a permanent
  second component re-introduces exactly the split Ableton avoided. If a quick-toggle affordance is
  wanted, add it as a mode of the unified editor, not a separate widget.

**Timing constraint (from `phase-21-plan.md`):** `NoteView.tsx` is mid-flight under Stream U (piano
roll pitch reference). The drum extension must land **after** that stabilizes, or the row-axis
refactor collides with in-flight work. Reading it for reference now is fine (done); editing waits.

---

# Part 6 — Sequencing vs. research 19: land them together, not sequentially

**Headline: this redesign and research 19's voice expansion are one body of work sharing one format
version bump, and should ship together.** The evidence for "together" over "sequential" is strong
and specific:

1. **They edit the same grammar line and the same type.** Research 19 rewrites the drum format
   substantially: closed `DRUM_LANES` enum → **open per-kit ordered `lane` declarations** with
   per-lane backing (`synth:<voiceType>` | `sample …` | `sf …`) and per-lane character params, and
   it drops the "all lanes always emitted" rule (research 19 Part VI, Option B). This redesign adds
   an **optional `duration` token to the `hit` line**. Doing these as two separate format versions
   means **two migrations, two parser/serializer revs, and two independent rounds of
   canonical-form scrutiny on the same `hit`/`lane` grammar** — the second reflowing files the first
   just touched. One coordinated version bump is cleaner and cheaper (D4/D7 both prefer it).

2. **Duration's *semantics are undefined without research 19's substrate model.*** Part 4 defines
   what `duration` does **per backing** (release for synth/SF2, truncation for sample). But "a lane
   has a declared backing" is *precisely research 19's deliverable* — today the backing is a
   hardcoded `switch (lane)` (`engine.ts:983-1006`) that also hardcodes the durations we want to
   make per-hit. You cannot fully specify or implement the duration field's engine behavior until
   the lane→backing dispatch table (research 19 Part VII step 5) exists. **The two changes share one
   engine rewrite: the data-driven voice dispatch table honors `backing` (synth/sample/sf) *and*
   `duration` (gate length) in the same pass.** Splitting them means writing that table twice.

3. **The editor redesign has little value until lanes are many and named.** A lane-row editor over
   today's 5 hardcoded lanes is barely distinguishable from `StepSequencer`; the "real drum rack"
   the owner asked for only materializes once the kit has ~12 declared, GM-named, individually
   backed lanes (research 19's default kit) to put on rows. The editor's row-axis adapter (Part 5)
   *consumes* research 19's per-kit `lanes` list as its row model. Build the editor against the
   finished lane model, not the 5-lane placeholder.

So the natural build order is **not** "editor, then voices" or "voices, then editor" — it is **one
drum-rack stream**: (a) the open per-kit lane model + per-lane backing + **optional hit duration** in
a single format version; (b) one data-driven engine dispatch that honors backing and duration
together; (c) the unified `NoteView`-derived lane-row editor over that model — with (c) gated on
Stream U finishing `NoteView`. The only thing that is genuinely sequential is (c)-after-Stream-U, an
editor-internal constraint, not a voices-vs-editor ordering.

---

# Part 7 — Concrete build plan (for a future stream to execute directly)

This assumes it lands as, or tightly beside, research 19's voice-expansion stream (Part 6).

### Format (`src/core/document.ts`, `docs/format-spec.md`, parser/serializer/convert/diff)
1. **Add one optional field to `BeatDrumHit`:** `duration?: number` — 16th steps, fractional, `> 0`,
   same unit as `start` and `BeatNote.duration`. Absent = lengthless trigger (today's behavior).
2. **Grammar:** `hit <id> <lane> <start> <velocity> [<duration>]` — **duration appended last**, so
   absence is a clean line-truncation and every existing `.beat` file is byte-identical (D3 elision;
   D4/D7 satisfied; research 12's "optional trailing token" cashed in exactly). Canonical order of
   hits is unchanged: `(start, lane, id)`.
3. **Parser:** accept 4- or 5-field `hit` lines; validate `duration > 0` when present. No migration
   needed for existing files (they simply have no duration token).
4. **Per-substrate meaning is a lane property, not a hit property** — resolved via research 19's
   per-lane `backing`; no per-hit mode flag. (Optional future: a per-lane default gate/trigger mode
   on the lane decl, if a sample lane wants Gate-by-default; not required for v1.)

### Engine (`ui/src/audio/engine.ts`) — folds into research 19's dispatch-table rewrite
5. In the **lane→backing dispatch table** (research 19 Part VII step 5), thread the hit's
   `duration` through:
   - **synth-backed** → `triggerAttackRelease(freq, duration ?? <voice default>, time, velocity)`
     — replace the hardcoded `'8n'`/`'32n'`/`'16n'` (`engine.ts:993-1006`) with the per-hit
     duration, falling back to the voice's natural default when absent. (This is what the synth
     **note** path already does at `engine.ts:1289`.)
   - **sample-backed** → a `Tone.Player` one-shot; `duration` present → stop/fade at that length
     (Gate/truncation); absent → play the whole sample (Trigger). *This also finally implements the
     deferred v0.5 live sample-lane playback, `engine.ts:42` — size it as real work, not a tweak.*
   - **sf-backed** → spessasynth `noteOn` on the drum channel with a scheduled `noteOff` after
     `duration` (release); absent → today's fire-and-forget (or the preset's natural decay).
6. The scheduler at `engine.ts:1135` (`triggerDrum(h.lane, time + frac*stepSeconds, h.velocity)`)
   gains a `h.duration` argument passed through to the voice.

### Editor (`ui/src/components/` — after Stream U stabilizes `NoteView.tsx`)
7. **Generalize `NoteView` into a shared editor** parameterized by a **row-axis adapter**
   (`rowCount` / `rowLabel(i)` / `eventRow(ev)` / `nudgeRow`) and an `eventKind: 'note' | 'hit'`.
   Melodic tracks use the pitch adapter (unchanged behavior); drum tracks use a **named-lane
   adapter** whose rows come from the kit's declared `lanes` (research 19). Row label = lane name;
   up/down arrows move between adjacent lanes; no pitch clamp/octave nudge.
8. **Optional-duration rendering:** a hit with no `duration` renders as a fixed-width marker (a
   trigger); dragging its right edge creates a duration (marker → resizable bar). Edits POST the
   `hit` grammar (`<track>.hit.<id>.start|velocity|duration`, add via `<track>.hit`) — the drum
   analogue of the existing `<track>.note.*` primitives, one `.beat` line per event.
9. **Carry over soft snap + bypass** (Part 1): keep a grid-snap default with an Alt/Cmd freehand
   bypass so "drums can be anywhere" is a per-drag choice, reusing dotbeat's existing quantize model.
10. **Retire `StepSequencer` as the primary drum editor.** If a fast on-grid toggle is still wanted,
    add it as a Draw-Mode-style mode of the unified editor, not a second component.

### Do NOT build
- No per-hit "mode" flag (substrate decides; Part 4). No 128-pad grid UI, per-pad device chains, or
  key/velocity zones (research 18/19's Racks-skip stands). No second permanent editor component.

---

## Honest gaps & things to verify before implementation

- **Simpler mode ↔ substrate mapping is [cited] for Ableton but a *design choice* for dotbeat.**
  Ableton lets *any* pad be any mode (a sample pad can be Classic/melodic). dotbeat's simpler rule —
  "backing type picks release-vs-truncation" — is a deliberate simplification; if a user ever wants
  a sample lane to *sustain-release* rather than *truncate*, that needs the optional per-lane mode
  override noted in Part 4/step 4. Flagged so it's a conscious call, not an accidental limit.
- **Sample-lane truncation depends on unbuilt playback.** Live sample-lane playback is deferred
  (`engine.ts:42`); the Gate/truncation behavior lands *with* first building sample-lane playback.
  Don't assume the sample path exists to hang truncation on.
- **Exact truncation UX for samples** (hard cut vs. short fade-out to avoid a click) is unspecified;
  Simpler's One-Shot has Fade Out for exactly this reason. A few-ms release/fade on truncation is
  almost certainly wanted — a small sound-design detail to confirm at build time.
- **`NoteView` is mid-flight (Stream U).** All line numbers cited are as of this pass; the row-axis
  refactor must re-baseline against the post-Stream-U file. Reading-for-reference only this round.
- **The row-axis abstraction was validated by reading, not by building.** The claim that melodic and
  drum editing differ in only the two axes named (Part 5) is well-supported by the code but should
  survive a real refactor spike before the estimate is trusted.

## Sources

- Ableton Live 12 Reference Manual, *Editing MIDI* — same MIDI Note Editor for all tracks; vertical
  axis shows "a list of drum pads if a Drum Rack is loaded"; Fold to Notes hides empty pad rows;
  note length by dragging left/right edge; adaptive/magnetic grid snap; Ctrl+4 / Cmd+4 to toggle
  snap; Alt (Win) / Cmd (Mac) to bypass quantization per-drag; Draw Mode (B):
  https://www.ableton.com/en/live-manual/12/editing-midi/
- Ableton Live 12 Reference Manual, *Instrument, Drum and Effect Racks* — Drum Rack pad grid, pads
  as notes, choke groups: https://www.ableton.com/en/manual/instrument-drum-and-effect-racks/
- Simpler playback modes (Classic amp-envelope note-held release for sustained/pitched playing;
  One-Shot Trigger plays sample in full ignoring note length; One-Shot Gate plays "only as long as
  the note is pressed" = truncation; Slice inherits Trigger/Gate) — FaderPro, *Ableton Simpler:
  Classic vs One-Shot vs Slice mode*: https://blog.faderpro.com/instruments/ableton-simpler-modes/ ;
  corroborated by Ableton forum/search summaries of the Live manual Simpler section (Trigger vs Gate,
  Fade In/Out as attack/release analogues).
- dotbeat internal [verified-local]: `src/core/document.ts` (`BeatDrumHit` `:54-63`, `BeatNote`
  `:148-154` with `duration`, `BeatLaneSample` `:213-217`, `DRUM_LANES` `:45-46`);
  `ui/src/components/StepSequencer.tsx` (`Math.round(h.start)` projection `:22`, `pattern.<lane>[i]`
  toggle `:80`); `ui/src/components/NoteView.tsx` (add/move/resize/marquee/multi-select/velocity/
  keyboard, resize→`.duration` `:226`/`:403`, edit fan-out `:94-98`); `ui/src/audio/engine.ts`
  (`triggerDrum` hardcoded-duration switch `:983-1006`, synth-note `triggerAttackRelease(freq, dur…)`
  `:1289`, deferred sample-lane playback `:42`, spessasynth path `:799-830`); `docs/format-spec.md`
  (`hit` grammar + "no duration" rationale `:357-360`, `note` grammar `:115`, decimal timing `:326`);
  `docs/research/12-drum-representation.md` (events-not-grids; "optional trailing token adds back
  compatibly under canonical elision"); `docs/research/19-drum-voice-expansion.md` (open per-kit lane
  model, three substrates, data-driven dispatch table).

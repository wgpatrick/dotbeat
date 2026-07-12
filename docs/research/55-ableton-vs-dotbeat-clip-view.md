# Research 55 — Ableton Live 12 Clip View vs. dotbeat's clip-authoring surface: a direct feature/UI comparison

*2026-07-12. Owner-commissioned, direct follow-on to `docs/research/36-ableton-clip-view.md` (the
grounded text-only primer on the same manual chapter). That doc narrated the chapter and cross-
referenced it against dotbeat's just-shipped clip flow; this doc is a structured comparison table,
grounded additionally in 15 rendered manual-page screenshots (not just extracted text), built to
feed directly into prioritizing dotbeat's next phase of clip-view work.*

**Sources used this pass**: 15 of the ~20 sampled page images at
`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch08/` — pp. 185, 186, 188, 191, 193,
195, 196, 198, 200, 202, 207, 210, 213, 215, 217 — viewed directly (not OCR'd), plus the raw chapter
text at `.../ableton-chapters/ch08.txt` for anything a screenshot didn't cover. dotbeat side: full
reads of `ui/src/components/ClipPropertiesPanel.tsx` (152 lines) and `ui/src/components/NoteView.tsx`
(1,304 lines), plus targeted reads of `src/core/document.ts` (`BeatClip`, `BeatClipLoop`, `BeatNote`,
`BeatTimeSignature`, `BeatAudioRegion`), cross-checked against `docs/ROADMAP.md`, `docs/decisions.md`,
and `docs/product-roadmap.md` so nothing below re-opens an already-made call or re-proposes something
already shipped or already scoped-and-parked.

**Citation convention**: `[manual p.NNN]` = read from the chapter's extracted running text;
`[manual p.NNN, screenshot]` = read directly off the rendered page image this pass (a UI detail the
running text doesn't spell out in words); `[dotbeat file:line]` = read directly from this repo this
pass.

---

## 1. Feature & UI/UX comparison

### a) Shared features / parity

- **Clip content view opens per-track, driven by selection.** Ableton's Clip View always displays
  the currently selected clip, opened via double-click / the Clip View Toggle
  (`Ctrl+Alt+3`/`Cmd+Option+3`) [manual p.185-186]. dotbeat's `NoteView` is likewise the single,
  always-current editor for whichever track is active in the bottom pane — same "one editor, driven
  by selection" shape, single-window (dotbeat has no two-window "detail view in one window, grid in
  the other" mode Ableton supports [manual p.186], consistent with dotbeat's deliberate single-page
  layout, `NoteView.tsx:530-533`'s own comment on why a second drag-source implementation "isn't
  worth it").
- **Clip-local time signature, metadata-only, independent of the project's own.** Ableton: "Clip time
  signature is completely separate from the project's time signature" [manual p.195]. dotbeat: the
  identical design, independently arrived at — `BeatTimeSignature` (`document.ts:476-479`) and
  `ClipPropertiesPanel.tsx:110`'s own comment, *"clip-level time signature — metadata only for now;
  the audio engine still plays constant-tempo 4/4."* Confirmed-good convergent design, not a gap
  either direction (already noted in research 36 §8.4).
- **Loop toggle + numeric Position/Length fields.** Ableton's Loop Position/Length fields [manual
  p.193, screenshot] and dotbeat's `loop.start`/`loop.end` bar-range fields
  (`ClipPropertiesPanel.tsx:66-108`) are the same idea: a clip-local repeating range, editable as
  numbers. (The *loop brace drag* and *live-capture* halves of Ableton's version are gaps — see 1b.)
- **A drag-resizable loop-range handle directly in the content editor**, not just a properties-panel
  number field — Ableton's loop brace lives in the Sample/MIDI Note Editor itself [manual pp.
  213-214]; dotbeat's clip-loop strip and its end-handle live directly above `NoteView`'s own grid
  (`NoteView.tsx:872-908`). Same placement instinct, only half the gesture — Ableton's brace drags
  *either* edge; dotbeat's only drags the end (real gap, 1b).
- **Clip gain as a first-class, automatable property.** Ableton's Gain slider (dB) [manual p.207];
  dotbeat's `BeatAudioRegion.gainDb` plus a `gain` automation lane on `AUDIO_AUTOMATABLE_PARAMS`
  (`document.ts`, Phase 22 Stream AE per `docs/product-roadmap.md`) — dotbeat's version arguably
  exceeds Ableton's here by making gain automatable through the *exact same* lane machinery every
  other param uses, rather than a bespoke clip-envelope type.
- **A dedicated Pitch & Time selection-transform toolbox**, nearly 1:1. Ableton's Pitch and Time
  Utilities panel: Transpose, Stretch ×2/÷2, Fit to Scale, Invert, Reverse (note-order), Legato
  [manual pp.207-210]. dotbeat's `PitchTimePanel` (`NoteView.tsx:1105-1223`) implements Transpose,
  `timeScale` ×2/÷2, Fit to Scale, Invert, Reverse, Legato, plus Consolidate (dotbeat-only, ratchet-
  specific) — a genuine, already-shipped parity win (Phase 22 Stream AD + Phase 23 Stream BA per
  `docs/product-roadmap.md`), not a gap to flag.
- **Velocity lane: draggable per-event bars.** Ableton's velocity lane [manual pp.185-186,
  screenshot] and dotbeat's `noteview-vel-lane` (`NoteView.tsx:999-1025`, `velocityFromY`) are the
  same drag-to-set-loudness gesture. (Ableton's *velocity randomization toolbar* — Ramp/Randomize/
  Deviation controls visible in the same screenshot — is a real gap; see 1b.)
- **Marquee/multi-select, group move/resize, keyboard nudge.** Both support rubber-band select,
  shift/cmd-click multi-select, dragging a group as a rigid body, and arrow-key nudge — Ableton's
  MIDI Note Editor generally [manual p.191] vs. dotbeat's `onGridPointerDown`/`clampGroupMove`/the
  `onKey` handler (`NoteView.tsx:325-629`). No meaningful gap either direction.
- **Drum-lane-as-row-axis in the same note editor**, not a separate grid. Ableton: "the note ruler's
  vertical axis displays... a list of drum pads if a Drum Rack is loaded" (cited in `NoteView.tsx`'s
  own header comment, itself citing research 20). dotbeat's `buildLaneAxis` vs. `buildPitchAxis`
  (`NoteView.tsx:93-139`) is the same one-editor-two-axis-modes architecture, independently arrived
  at and already shipped (Phase 22 Stream AB retired the separate `StepSequencer.tsx`).
- **"Hear it while authoring it" exists in both, via structurally different but functionally
  equivalent mechanisms.** Ableton gets audition "for free" from Session-clip-launch; dotbeat's
  dedicated "▶ Preview clip" button (`NoteView.tsx:736-752`, `engine.auditionClip`) is the correct,
  deliberate substitute given dotbeat has no Session grid (research 36 §8.1 already confirmed this
  is a good design decision, not a shortfall) — worth restating here as a parity point, not a gap.

### b) In Ableton, not in dotbeat

*(Every item here gets a row in §2's table. Items already-confirmed as deliberate, correct dotbeat
scope cuts — not gaps to fix — are marked so explicitly and still get a `Do-not-recreate` row for
completeness, per this doc's brief.)*

1. **Clip rename, distinct from the referenced file/id.** "Renaming an audio clip does not rename the
   referenced sample file" [manual p.188]; `BeatClip` (`document.ts:544-552`) has only `id`, no
   `name` — confirmed in research 36 §8.3.
2. **Clip Activator (per-clip mute), independent of track mute.** The `0` key, or the title-bar
   toggle [manual p.187]. dotbeat has track-level mute only (`MixerView.tsx:202,255`); no `active`/
   `muted` field on `BeatClip`.
3. **Per-clip color override + bulk "Assign Track Color to Clips."** [manual p.188] `BeatClip` has no
   color field at all — every clip visually inherits its track's color unconditionally.
4. **"Save Default Clip"** — persist a clip's settings (esp. Warp Markers) as the default applied the
   next time the *same sample* is dropped into the project [manual pp.188-189].
5. **Two independently-adjustable regions: clip Start/End vs. Loop.** Ableton models "the section
   that plays when launched" (Start/End, with Set-buttons) *separately* from "the section that
   repeats" (Loop Position/Length) — enabling a pickup/intro that plays once before the clip "runs
   into a loop" [manual pp.193-194, 214, screenshot p.215]. `BeatClipLoop` (`document.ts:464-467`) is
   a single range; dotbeat's playable region and repeating region are definitionally identical
   (confirmed, research 36 §8.2, the sharpest finding of the prior pass).
6. **Live "Set Start/End/Loop Position/Length" capture-during-playback buttons.** *"Playing the clip
   and then clicking the Set Loop Position button moves the beginning of the loop to the current
   playback position... clicking Set Loop Length moves the end..."* [manual p.194] — a direct,
   spontaneous "capture what I'm hearing right now" workflow. dotbeat's loop fields are typed-number-
   only (`ClipPropertiesPanel.tsx:66-108`); no read-the-live-playhead affordance exists anywhere in
   the clip-properties or clip-loop-handle code.
7. **The loop brace is draggable on *both* edges, plus a real keyboard vocabulary** (arrows nudge by
   grid, Ctrl+arrows shorten/lengthen by a grid unit, Ctrl+up/down double/halve) [manual pp.213-214].
   dotbeat's clip-loop handle drags only the end (`NoteView.tsx:477-479`'s own comment says so
   explicitly); the start is numeric-only, and there is no keyboard nudge specific to the clip-loop
   range at all (only per-note nudge exists).
8. **Duplicate Loop** — doubles the loop's length *and* content, sliding trailing MIDI notes to
   preserve their position relative to the new end [manual p.214]. No dotbeat equivalent; `timeScale`
   (×2 in `PitchTimePanel`) rescales note positions but does not touch `clip.loop.end` itself.
9. **Clip Groove pool**: a per-clip, swappable, named groove template (hot-swap from the browser,
   Commit button that "writes" the groove and — for audio — converts velocity data into a real volume
   clip envelope) [manual pp.195-196]. dotbeat has only a track-level parametric pair,
   `shuffleAmount`/`shuffleGrid` (`document.ts:721`, `src/core/groove.ts`) — no per-clip template
   library, no hot-swap, no commit-to-envelope mechanic.
10. **Scale Mode + scale-aware piano-roll key highlighting.** Root Note + Scale Name per clip,
    highlighting in-scale keys directly in the note editor's piano ruler [manual pp.196-197]. Already
    tracked in `docs/product-roadmap.md` ("Note editing" section) as **Not started**, research-scoped
    via `docs/research/18-ableton-ui-architecture.md` — this pass independently reconfirms the same
    gap against real screenshots, doesn't newly discover it.
11. **Extended Clip Properties: Follow Action + full launch-control surface** (mouse/keyboard/MIDI
    trigger, launch quantize, scrub, velocity→volume) [manual pp.197-198]. **Confirmed-correct,
    deliberate scope cut** — research 18/30 already ruled dotbeat Arrangement-only, and this
    chapter's own text independently corroborates it: Ableton itself hides this entire panel for
    Arrangement clips [manual p.198]. Listed here only because the brief asks for every 1(b) item to
    get a table row; this is a `Do-not-recreate`, not an open gap.
12. **MIDI Bank/Program Change controls** [manual p.198], the one part of Extended Clip Properties
    that *does* survive for Arrangement MIDI clips. dotbeat's synth/instrument tracks are internal
    Tone.js voices, not external MIDI-addressable devices — there is no "send program change to
    device N" concept anywhere in the engine.
13. **Full Warp mode vocabulary** (Complex/Complex Pro/Beats/Tones/Texture, tempo-independent Pitch
    shift decoupled from playback rate, BPM field + ×2/÷2 tempo buttons) [manual pp.200-201, 207,
    screenshot]. dotbeat's `WarpMode` (`document.ts:481-484`) is `off | repitch | complex`, but
    `complex` is "a legal enum value with NO implementation this stream" (`document.ts:481-484`'s own
    comment) — only classic linked-rate `repitch` actually works today. Already tracked in
    `docs/product-roadmap.md`'s Audio-region-clip-editing section and scoped via
    `docs/research/25-audio-warp-markers-stretch.md` (signalsmith-stretch WASM).
14. **Destructive Sample Editing** — opens an external editor, with explicit Warp-Marker-survival
    rules if length is unchanged [manual p.203]. No dotbeat equivalent (no "open in external editor"
    integration point exists in the daemon or GUI).
15. **RAM Mode vs. disk-streaming**, with an explicit named tradeoff (disk overload = unwanted mutes;
    RAM overload = mutes *and* rhythmic "hiccups") [manual p.205]. Not applicable yet — dotbeat has no
    disk-streaming audio engine at all (that's explicitly M4/Tauri-native scope per
    `docs/m4-native-engine-design.md` and the "butler-thread" architecture already named in
    `docs/product-roadmap.md`'s Audio-region-clip-editing section).
16. **High Quality Interpolation toggle** (~19 semitones of headroom before audible aliasing) [manual
    p.206]. dotbeat's repitch path is a bare `Tone.Player.playbackRate` set
    (`docs/product-roadmap.md`'s "Repitch-mode warping" row) with no interpolation-quality control.
17. **"Set Length" (snap selection to an exact chosen duration) and "Add Interval" (duplicate the
    selection at a fixed interval)** in the Pitch and Time Utilities panel [manual pp.207-210].
    `pitchtime.ts`'s current op set (per `PitchTimePanel`) has no absolute-duration-set op and no
    interval-duplicate op.
18. **A one-click Humanize control living in the same selection-transform panel as Transpose/Invert/
    Legato** [manual pp.207-210]. dotbeat *has* the underlying primitive (`beat_humanize`, tracked in
    `docs/product-roadmap.md`'s "Vary / audition loop" row, "Rung-2 'feel' content variation") but it
    is reachable only through the separate `VaryAffordance.tsx` audition/Keep/Undo flow, not as a
    same-panel button next to `PitchTimePanel`'s other one-shot ops.
19. **MIDI Transform and Generate panels** — a fuller "MIDI Tools" set beyond the six Pitch & Time
    ops: transformation tools that replace notes in place (the "Arpeggiate" example shown with Style/
    Steps/Distance/Rate/Gate controls [manual p.193, screenshot]) and generative tools that add new
    note patterns within the loop, both scale-aware [manual pp.191, 210-211]. dotbeat has nothing in
    this generative-pattern category.
20. **Scrub area (click-and-hold to repeatedly re-play a chunk, real scrubbing at fine quantization)
    and a Follow toggle that auto-pauses itself the instant you make an edit** [manual pp.211-213].
    dotbeat's "▶ Preview clip" is play/stop only, no scrub gesture; there's also no Follow-style
    auto-scroll-then-pause-on-edit behavior in `NoteView`.
21. **Chase MIDI Notes** — a still-sounding note continues to play back if transport starts mid-note
    [manual p.213]. No equivalent scheduling behavior confirmed in `engine.ts`.
22. **Sample details readout** (name, sample rate, bit depth, channel count; asterisk on disagreement
    across a multi-select) in the Sample Editor header [manual p.215]. No such readout exists in
    dotbeat's audio-clip editing surface.
23. **Non-destructive crop that produces a genuinely new, shorter sample file** ("crop to start/end,"
    "crop to time selection," `Ctrl+Shift+J`) [manual p.216]. dotbeat's `splitAudioClip`
    (`docs/product-roadmap.md`'s "Split-at-point" row) creates *two* clips referencing the same
    source media — a different operation from Ableton's "shrink to a new physical file."
24. **Replace-the-sample gesture**: drag a new sample onto an open Clip View; pitch/gain retained,
    Warp Markers retained only if the new sample is the same length [manual p.216]. No equivalent
    "swap the underlying media, keep the clip's other settings" affordance found in dotbeat's audio
    clip flow.
25. **Multi-clip property editing** (common-properties-only panel, range-drag sliders that collapse
    to one value at an extreme) [manual p.217]. **Confirmed-correct, deliberate v1 scope cut** —
    `ClipPropertiesPanel.tsx:16`'s own comment: "one editable clip per track... a deliberate scope
    cut." Listed for completeness per the brief; this is a `Do-not-recreate` given today's
    one-clip-per-track model, not an open gap — worth reopening only if/when multi-clip-per-track
    ships.
26. **Clip Defaults + a configurable "Clip Update Rate"** governing how fast live edits to a *playing*
    clip are quantized/applied, plus a mechanism to make certain properties (Launch Mode, Warp Mode)
    the default for every newly created clip [manual pp.217-218]. dotbeat's edits commit immediately
    via `postEdit` with no live-quantization concept — this is fundamentally a Session-performance
    feature (quantizing edits to a *playing loop* so they land musically) that doesn't have an
    obvious analog in dotbeat's non-live-performance, Arrangement-only model.
27. **Velocity-lane toolbar: Transform/Ramp/Randomize/Deviation batch tools**, visible alongside the
    plain drag-to-set velocity lane [manual pp.185-186, screenshot]. dotbeat's velocity lane
    (`NoteView.tsx:999-1025`) supports only the single-bar drag gesture — no batch ramp/randomize-
    across-selection tool.

### c) In dotbeat, not in Ableton

- **Every single clip-view control is also a one-line text diff, addressable by CLI or an AI agent —
  structurally, not as an add-on.** This is the whole-project thesis (`docs/ROADMAP.md` §1) made
  concrete at the clip-view layer specifically: dragging a note, resizing the clip loop, or applying
  Transpose all funnel through the *same* `postEdit`/`POST /edit` primitive
  (`NoteView.tsx`'s own header comment, lines 20-26) that `beat set`/`beat_edit` use from a script or
  an MCP tool call. Ableton's Clip View, however rich, has no text/CLI/agent-editable representation
  of any of it — this is the single largest asymmetry in dotbeat's favor and the reason the rest of
  this comparison exists at all.
- **Per-note probability ("chance"), with a genuine draw-across-notes paint lane.** A 0-100% field per
  note (`BeatNote.chance`, `document.ts:420`), re-rolled per playback pass via a seeded RNG
  (`src/core/chance.ts`), paintable across many notes in one continuous drag
  (`NoteView.tsx:660-711`, `onChanceLanePointerDown`/`paintChanceAt`). Ableton Live 12's stock Clip
  View has no per-note probability field in the manual chapter at all (Follow Action has a
  clip-*launch*-level chance concept, a different granularity and a different subsystem entirely,
  scoped out of dotbeat by design per item 11 above).
- **Per-note ratchet (repeat count + curve-shaped spacing + gate length), with a visual tick glyph on
  the note itself.** `ratchetCount`/`ratchetCurve`/`ratchetLength` (`document.ts:422-424`), rendered
  as internal tick marks (`ratchetTicks`, `NoteView.tsx:56-62`) and reversible via the Consolidate
  button in `PitchTimePanel`. Ableton has no comparable per-note authored-repeat property in Clip
  View — its closest analog (Note Repeat) is a separate MIDI-effect device applied uniformly, not a
  per-note authored fact that survives as a stored value.
- **Per-note micro-tuning (cents), independent of semitone pitch, for MIDI notes specifically.**
  `BeatNote.cent` (`document.ts:421`), edited via `NoteInspector` (`NoteView.tsx:1261-1296`).
  Ableton's cents field [manual p.207] is clip-*wide* and audio-clip-only (part of the whole-clip
  Pitch control); a genuine per-note MIDI detune has no stock-Live-12 Clip View equivalent (would
  need MPE, a materially heavier mechanism for a materially smaller ask).
- **"Place in Arrangement" as an idempotent, single-button, update-in-place action.** Clicking it
  again re-saves the editor's current live content into the *same* clip rather than minting a
  duplicate (`existing = primaryClipFor(...)`, `NoteView.tsx:540,550`) — a clean substitute for
  Ableton's drag-based mechanisms, made necessary and possible specifically because dotbeat has no
  Session grid to drag *out of* (research 36 §8.3 already established this is the correct shape, not
  a workaround).

---

## 2. Prioritized recommendations

*Covers every item in §1(b). Ordered by priority, then by manual section. "Build recommendation"
names real dotbeat files/modules to extend — nothing here proposes a new file where an existing one
already owns the concern.*

| # | Feature | Priority | Build recommendation |
|---|---|---|---|
| 6 | Live "Set Loop Position/Length" capture during audition | **P0** | The single most direct answer to what the owner is testing right now. Add a "set end here" button beside "■ Stop" in `NoteView.tsx`'s toolbar (near line 750), visible only while `auditioning` is true. Read the live `currentStep` (already tracked via `useStore((s) => s.currentStep)`, line 239) and call the *same* `postEdit(`${path}.loop`, ...)` the drag handle already uses (line 522). No new state, no new daemon route — research 36 §9 recommendation 1 already scoped the exact wiring. |
| 7 | Loop brace draggable on both edges + keyboard nudge | **P0** | Render a second handle at the *start* of `.noteview-cliploop-range` (today only `.noteview-cliploop-handle` at the end is rendered, `NoteView.tsx:892-898`); reuse the existing `onClipLoopPointerMove`/`onClipLoopPointerUp` math (lines 496-523), just clamping `loop.start` down to 0 instead of `loop.end` up. Add arrow-key nudge for the clip-loop range specifically inside the existing `onKey` handler (lines 559-629), gated on a clip-loop selection state rather than a note selection. Research 36 §9 recommendation 2. |
| 1 | Clip rename, distinct from id | **P1** | One-line format addition: `BeatClip.name?: string` in `document.ts:544-552`, canonically elided when absent (same discipline as every other optional field, per D9). Add a text input to `ClipPropertiesPanel.tsx`'s toolbar strip (currently a static `` `clip "${clip.id}"` `` label, line 63) and to the "Placed (clip ...)" button's title in `NoteView.tsx:781`. Cheap, high-legibility win once a track has more than one or two clips. |
| 5 | Separate clip Start/End vs. Loop region ("run into a loop") | **P1** | A real format decision, not just a UI fix — `BeatClip` needs a second range field alongside `loop: BeatClipLoop`, e.g. `play: { start, end } \| null` defaulting to the loop range when absent (canonical elision preserved). Wire a second numeric field pair into `ClipPropertiesPanel.tsx` and a second drag strip above `NoteView`'s grid (reusing the exact `clipLoopGesture` pattern, `NoteView.tsx:480-523`, parameterized by which range it targets). Sequence *after* P0 items 6/7 land — same UI surface, avoid redesigning it twice. |
| 18 | One-click Humanize inside `PitchTimePanel` | **P1** | The primitive (`beat_humanize`) already exists per `docs/product-roadmap.md`. Add a "Humanize" button + amount field to `PitchTimePanel` (`NoteView.tsx:1105-1223`) next to `Legato`/`Consolidate`, calling the same op through `postPitchTime` or a thin new `PitchTimeOp` variant if the existing daemon route (`POST /pitch-time`) doesn't already cover it. Cheapest item on this list relative to value — the hard part (the algorithm) is done. |
| 2 | Per-clip mute (Clip Activator) | **P2** | Needs a `active?: boolean` field on `BeatClip` (`document.ts:544-552`) and a check in `engine.ts`'s `contentOf`-style resolution. Not urgent under today's one-clip-per-track v1 scope — revisit alongside item 25 (multi-clip editing) since both matter more once >1 clip/track/section is common. |
| 3 | Per-clip color override + bulk reassign | **P2** | Add `color?: string` to `BeatClip`; render it as a swatch in `ClipPropertiesPanel.tsx`'s toolbar strip, falling back to `track.color` when absent (same elision pattern as every optional field). Low effort, mostly cosmetic value until clips diverge visually from their track. |
| 8 | Duplicate Loop | **P2** | New `src/core/edit.ts` primitive: double `clip.loop.end - clip.loop.start`, duplicate the bar-range worth of notes/hits, shift any trailing content past the old end by the loop's own length. Natural pairing with the P0 loop-resize UX once that lands — same mental model as Ableton's version. |
| 9 | Clip Groove pool (named templates, hot-swap, commit-to-envelope) | **P2** | Bigger than it looks: needs a `presets/grooves.json`-style library (mirrors `presets/factory.json`'s "tooling not grammar" precedent, D9) plus a per-clip `groove?: string` reference resolved through the same track-level `shuffleAmount`/`shuffleGrid` math (`src/core/groove.ts`) rather than a second warp system. The "Commit converts groove into a real gain-automation lane" mechanic can reuse the existing `gain` automation lane machinery (`AUDIO_AUTOMATABLE_PARAMS`) as prior art for the shape, even though it'd target a different param. |
| 10 | Scale Mode + scale-aware piano-roll highlighting | **P2** | Already scoped via `docs/research/18-ableton-ui-architecture.md`; add `scale?: {root, name}` to `BeatClip` or `BeatTrack`, and shade in-scale rows in `buildPitchAxis`'s row rendering (`NoteView.tsx:793-864`) the same way `isBlackRow` already shades black keys. No engine change needed — display-only, matching item 10's own confirmed-fine "metadata for now" precedent elsewhere in this doc. |
| 11 | Session launch controls / Follow Actions | **Do-not-recreate** | Confirmed-correct scope cut (research 18/30; independently reconfirmed by the manual's own text gating this panel to Session clips, manual p.198). dotbeat targets Arrangement, not Session — building this would contradict a settled decision. |
| 12 | MIDI Bank/Program Change controls | **Do-not-recreate** | dotbeat's tracks are internal synth voices, not external MIDI-addressable devices — there is nothing on the other end of a program-change message. Revisit only if/when dotbeat ever hosts external MIDI hardware/software as an instrument source (not currently planned anywhere in `docs/ROADMAP.md`). |
| 13 | Full Warp mode vocabulary (Complex/Beats/Tones/Texture, tempo-independent pitch) | **P2** | Already scoped via `docs/research/25-audio-warp-markers-stretch.md` (signalsmith-stretch, MIT/WASM) and tracked as Not-started in `docs/product-roadmap.md`. Real, valuable, but a genuine engine investment (a stretch algorithm, not a UI change) — sequence behind the P0/P1 items above, which are all about the synth/drum clip flow the owner is actively testing this session, not audio warp quality. |
| 14 | Destructive Sample Editing (open in external editor) | **P2** | Simpler than Ableton's version needs to be: a "Reveal in Finder" / "Open with default app" daemon route against the referenced media file, no in-app destructive-edit tracking required. Natural fit once the Tauri shell's file-association story matures — low effort, defer until then. |
| 15 | RAM vs. disk-streaming mode | **Do-not-recreate** *(for now)* | No streaming audio engine exists yet to have modes of — this is M4/Tauri-native scope (`docs/m4-native-engine-design.md`'s butler-thread architecture). Revisit exactly when that engine work starts, not before. |
| 16 | High Quality Interpolation toggle | **P2** | Small addition once warp/repitch quality is being worked on anyway (pairs naturally with item 13) — a boolean on `BeatAudioRegion` gating which resampling path `engine.ts`'s repitch code takes. Not worth a standalone stream. |
| 17 | "Set Length" + "Add Interval" ops | **P2** | Two small additions to `src/core/pitchtime.ts` alongside the existing six ops, surfaced as two more buttons in `PitchTimePanel` (`NoteView.tsx:1105-1223`). Same shape as the P1 Humanize wiring, lower value (less commonly needed than humanize). |
| 19 | MIDI Transform/Generate tools (arpeggiate-style generative patterns) | **P2** | A genuinely new subsystem, not a small addition — scale-aware, parameterized note generation within a loop range. Track this under (or explicitly alongside) the existing "macro tooling layer" research item (`docs/research/27-macro-tooling-layer.md`) rather than opening fresh scope; the two share the "curated, parameterized front-panel control that writes literal edits" shape. |
| 20 | Scrub area + Follow-pause-on-edit | **P2** | Scrub: a pointer-drag-and-hold gesture on the clip-loop strip or grid that repeatedly re-triggers `engine.auditionClip` at a small offset, quantized to the grid. Follow-pause-on-edit: track "last edit timestamp" in `NoteView`'s local state and suppress auto-scroll-to-playhead for N ms after any `postEdit` call. Both genuinely useful, neither blocking — bundle as one small stream once P0/P1 land. |
| 21 | Chase MIDI Notes | **Do-not-recreate** | A live-performance edge case (does a note already sounding when playback starts mid-clip keep sounding) that matters far more for Ableton's Session-launch-driven workflow than dotbeat's Arrangement-only, render-then-listen model. Low value relative to engine-scheduling complexity. |
| 22 | Sample details readout (name/rate/bitdepth/channels) | **P2** | A small header addition to whatever audio-clip properties surface exists today (extend `ClipPropertiesPanel.tsx` with an audio-track branch, or the dedicated component if audio clips get a richer panel first) — read straight off the decoded `AudioBuffer`, no new format field needed. |
| 23 | Non-destructive crop to a new, shorter physical file | **P2** | Distinct from the existing `splitAudioClip` (which keeps both halves referencing the same source media) — needs a real audio-trim-and-re-encode step server-side (daemon route), writing a new file under `media/`. Sequence behind warp-mode work (item 13) since both touch the same audio-region code paths. |
| 24 | Replace-the-sample gesture | **P2** | A drag target on the open clip's waveform view (once one exists — see item 22) that swaps `BeatAudioRegion`'s media reference while keeping `gainDb`/`rate`, clearing `markers` unless the new file's duration matches exactly. Natural companion to item 23, same surface. |
| 25 | Multi-clip property editing | **Do-not-recreate** *(for now)* | `ClipPropertiesPanel.tsx:16`'s own comment already documents this as a deliberate v1 scope cut — one editable clip per track. Revisit exactly when multi-clip-per-track/section ships (tracked separately, "Independent per-section scene editing," `docs/product-roadmap.md`, Not started) — don't build the multi-select UI before there's more than one clip to multi-select. |
| 26 | Clip Defaults + configurable Clip Update Rate | **Do-not-recreate** | This is fundamentally a live-performance feature (quantizing edits to a *playing* loop so they land musically) that doesn't map cleanly onto dotbeat's edit-commits-immediately, non-live-performance model. The "defaults for new clips" half is already better served by dotbeat's existing preset system (`presets/factory.json`, D9) than by a parallel per-property-default mechanism. |
| 4 | "Save Default Clip" (settings inherited by future drops of the same sample) | **Do-not-recreate** | Conflicts with D9 ("presets are tooling, never grammar") and D1 (document-only, no hidden indirection) — an auto-applied-on-drop settings cache is exactly the kind of "what does this file sound like depends on a library version" indirection those decisions were written to rule out. If sample-reuse convenience is ever wanted, it should go through the existing preset-application path (`beat preset`/`beat_preset`), not a new mechanism. |
| 27 | Velocity Ramp/Randomize/Deviation batch tools | **P2** | A small addition to the velocity-lane toolbar area in `NoteView.tsx` (near line 999) — apply a linear ramp or random jitter across the current selection's velocities in one call, writing N `postEdit` calls the same way the chance-paint lane already fans out edits (`onChanceLanePointerUp`, line 704). Straightforward once time allows; not blocking anything else on this list. |

---

## Sources

Ableton Live 12 Reference Manual, Chapter 8 "Clip View," pp. 185-218: raw text at
`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-chapters/ch08.txt`; 15 rendered page images
viewed directly this pass (pp. 185, 186, 188, 191, 193, 195, 196, 198, 200, 202, 207, 210, 213, 215,
217) at `/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch08/`. dotbeat internal, read
directly this pass: `ui/src/components/ClipPropertiesPanel.tsx` (all 152 lines),
`ui/src/components/NoteView.tsx` (all 1,304 lines), `src/core/document.ts` (`BeatClip` lines 544-552,
`BeatClipLoop` lines 464-467, `BeatNote` lines 410-425, `BeatTimeSignature` lines 476-479,
`BeatAudioRegion` lines 517-524). Cross-referenced against `docs/ROADMAP.md`, `docs/decisions.md`,
`docs/product-roadmap.md`, and the prior pass `docs/research/36-ableton-clip-view.md` — every
recommendation here either extends that pass's own findings (§9's top two recommendations are
promoted to P0 here) or covers new ground the primer didn't reach (per-item priority table, the
`1(c)` dotbeat-only list, screenshot-only UI details like the velocity toolbar).

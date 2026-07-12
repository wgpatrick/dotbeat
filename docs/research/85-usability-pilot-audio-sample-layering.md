# Usability pilot 85 — layering an audio sample against MIDI drums/bass

**Goal:** build a small song sketch that layers a real AUDIO sample (waveform region, not MIDI
notes) against basic MIDI drums + bass, exercising dotbeat's audio-region editing surface for the
first time as a genuinely new user would encounter it.

**Method:** step 1 (CLI-scaffolded drums + bass, a few bars of programmed hits/notes) was pure
setup and is not evaluated here. Steps 2–6 (create an AUDIO track in the GUI, find a sample, place
it as a region, trim/warp/split it, layer it against the MIDI tracks, and sanity-check playback)
were driven live against a real running daemon + Vite dev server + headless-but-visible Chromium,
with a screenshot read after every meaningful action — no pre-scripted checklist for what the audio
UI would look like. Two mechanical/tooling snags are worth naming up front because they cost real
time but are **not** dotbeat findings: (1) several other concurrent usability-pilot sessions on the
same host happened to collide on the same daemon/Vite ports, which I resolved by moving to
dedicated ports; (2) `document.querySelectorAll`/`textContent` intermittently failed to find
visibly-rendered button text (Playwright's accessibility-tree/`getByRole` queries worked reliably
where raw DOM text-matching did not) — a quirk of my driver script, not the app.

## Narrative walkthrough

**Creating the audio track.** Clicking `+ track` in the arrangement toolbar popped a clean dropdown
— `Synth / Drums / Instrument / Audio` — exactly where I'd look, no hunting required. Selecting
`Audio` created the track immediately. First surprise: the bottom clip editor for the brand-new,
empty audio track rendered the **generic note-grid UI** (piano-key rows, "0 notes," "click a key to
preview") — the same widget used for synth/instrument tracks. Nothing about it signaled "this is an
audio track" until a sample was actually placed.

**Finding an audio sample.** Opening `Browser` surfaced a left rail starting with `Presets — Synth`
(Bass/Lead/Pad/Pluck/Keys, 30 items). Scrolling down hit a run of genre-named sections —
`808-TRAP`, `TECHNO`, `BOOM-BAP`, `LOFI`, `ACOUSTIC-ROCK` — each holding one item (`808-trap-kit`,
etc.) with a cassette-style icon that visually reads as "a loop file." **They are not audio** —
they're synthesized-drum preset bundles (`kind: 'drums'`, a `params` object), previewed through the
drum synth engine, not a decoded sample. My first instinct as a tester was to try dragging one of
these onto the audio track; a real user would likely do the same and get silent nothing (no
drop-target feedback, no error — the payload type just isn't accepted there). The actual audio media
turns out to live one level deeper: inside the `Kits` section (`kit-audiophob`, `kit-init`), each
expandable into individual lane rows (`Kick`, `Snare`, `Clap`, `Hat`, `Open`) — only *those* rows
are real, sha256-addressed `.wav` files with a `draggable` payload the audio track actually accepts.
`SoundFonts` at the very bottom are `.sf2` banks, relevant to instrument tracks, not audio ones.

**Placing the first region.** Dragging the `Kick` row from `kit-audiophob` onto the audio track's
header (not the arrangement row — that's not a valid drop target, confirmed empirically, see
Findings) triggered a native browser `alert()` and nothing was written to the file. The project was
still in dotbeat's default **loop mode**; audio-clip placement requires **song mode** (at least one
song section). The clip-properties panel does say "add this track to a scene (song mode) to edit a
saved clip's loop range / signature" — but that hint only appears *after* you already have a clip
selected, which is exactly the state you can't reach yet. Clicking `+ section` switched the project
into song mode (`SONG 4`, 2 sections); retrying the identical drag then worked cleanly — `clip1`
(`kit-audiophob-kick`) landed on the audio track and appeared automatically in both repeats of the
song section.

**The trim/warp editor.** Once a clip existed, the bottom panel changed shape entirely: a real
waveform render, then `in`, `out`, `gain (dB)`, and `warp` fields. This is a genuinely functional,
responsive audio-region editor — editing `out` from `0.387` to `0.15` immediately shortened the
audible region and moved a marker on the waveform. Selecting `warp: repitch` revealed a live `rate`
field; setting it to `0.8` correctly wrote `repitch x0.8` to the file and updated the arrangement
block's label text (`kit-audiophob-kick · repitch x0.8`) in real time. Selecting `warp: complex`
revealed **no additional controls at all** — no rate, no stretch amount, nothing — and `beat
inspect` on the resulting file literally prints `complex (unimplemented)`. This matches
`docs/format-spec.md`'s own documentation (`complex` is "a legal enum value with no engine
implementation yet... plays back unwarped") — so it's a known, deliberate scope-cut, not a hidden
bug — but the GUI gives a user zero indication of this; selecting it looks identical to selecting a
working mode.

**Trying to make it rhythmic.** The clip-properties row also exposed `loop  [off] – [off]  bars`
fields, which looked like the natural way to make a 0.15s one-shot retrigger across a bar. Filling
them in (`0` – `1`) visibly resized the purple range bar in the editor below — but a direct diff of
the raw `.beat` file before and after showed **no change whatsoever**; the edit never persisted.
This looks like a dead/no-op control for audio-kind clips (plausibly a leftover from the shared
note-clip-properties component not gated per track kind).

**Trying to place multiple hits.** I then tried the more literal DAW move: drop a second kit-lane
sample (`Snare`) onto the *same* audio track header. Result: it **replaced** `clip1`'s content
entirely — media reference, trim, warp, and rate all reset to defaults — rather than adding a
second region or a second clip. Dropping directly onto the arrangement's clip row at a different bar
position (rather than the header) did nothing at all — confirmed via `dropDefaultPrevented: false`
and no file change. This lines up with `docs/format-spec.md`'s own description of the v0.10 audio
model: **one audio region per clip, one clip per track per scene slot** — there is currently no
in-GUI (or documented CLI) path to have a single audio track sound at multiple independent points
within one section.

**Split.** I found a scissors "split-at-playhead" button in the audio track's own header rail
(title: *"cut this track's clip at the current playhead position"*). My first two attempts failed
with a native alert ("Move the playhead over this track's clip first") because my playhead-seek
clicks weren't landing inside the very short (0.15s) trimmed window — worth noting for a real user
too: seeking precisely inside a sub-beat-length region via the ruler is fiddly. Once positioned
correctly, the split *did* work: the file gained a second clip object (`clip1-2`, the tail of the
trimmed region, `0.1364`–`0.15`). However, the song's scene slot for the audio track still only
referenced the original `clip1` — the new `clip1-2` was created but never wired into any
section/scene, so it exists in the file but is silent/unplaced. I found no further GUI affordance in
the time available to actually place it into the timeline as a second, later-triggered hit.

**Playback and final check.** Pressing `Play` behaved correctly and reassuringly: the transport
`POSITION` readout advanced, a live output scope/meter in the top bar animated, and a playhead line
moved in sync across all three tracks (drums, bass, audio) and the bottom clip editor. As a final,
independent sanity check I rendered the project via `beat render` + `beat metrics` from the CLI
(off to the side of the GUI test, mirroring a prior pilot's WAV-analysis approach): -21.5 LUFS
integrated, -0.5 dBFS peak, spectrum dominated by sub/bass energy consistent with kick+bass content,
stereo correlation 0.979 — confirming the placed audio region is genuinely part of the rendered mix,
not just a GUI-only fiction.

## Findings summary

- **[bug]** The audio clip's `loop [start] – [end] bars` fields respond visually (resize the range
  bar) but never persist to the `.beat` file — confirmed by diffing the raw document before/after
  editing them. A dead-end control that looks functional but does nothing for audio-kind clips.
- **[confusing]** Dropping a sample onto an audio track while the project is still in default *loop*
  mode is silently refused via a native, unstyled browser `alert()` — jarring against the rest of
  dotbeat's in-app UI, and the guidance that would prevent this ("add this track to a scene (song
  mode)...") only appears *after* a clip already exists, i.e. too late to be proactively useful.
- **[confusing]** `warp: complex` is selectable and looks identical to the working `off`/`repitch`
  modes, but is a documented no-op (`beat inspect` prints "complex (unimplemented)"; confirmed in
  `docs/format-spec.md`). Nothing in the GUI itself communicates this — a user has no way to
  discover it without dropping to the CLI or reading source.
- **[bug]/architecture gap** There is no discovered way — GUI or documented CLI — to have one audio
  track sound at multiple independent timeline positions within a section. Dropping a second sample
  onto the track header *replaces* the existing clip's content (media + trim + warp + rate all
  reset) instead of adding a region; dropping onto the arrangement row instead of the header is
  simply ignored; and splitting a clip creates a real second clip object that is **not** wired into
  any scene slot, so it plays nowhere. As shipped, "one-shot hits on specific beats" via a single
  audio track is not achievable through the GUI.
- **[slow-to-discover]** The content browser's genre-named drum sections (`808-TRAP`, `TECHNO`,
  etc.) visually read as audio loops (single item, cassette icon) but are actually synthesized-drum
  presets with zero audio content — a natural first click for a user hunting for a sample, and a
  dead end with no feedback when dragged. The real audio media is one level deeper, inside `Kits →
  <kit> → <lane>` rows, which look visually similar to other browser rows and carry no distinct
  "this is real audio" affordance.
- **[worked well]** Once correctly triggered, the trim/gain/warp editor is genuinely solid: real
  waveform rendering, responsive numeric `in`/`out`/`gain` fields with live marker feedback, and a
  `repitch` mode that's fully wired end-to-end (rate control appears contextually, writes correctly,
  and reflects live in the arrangement block's label).
- **[worked well]** Playback integration is clean and trustworthy: transport position, an animated
  output scope, and a synchronized playhead across MIDI and audio tracks all update correctly and in
  lockstep; a subsequent CLI render/metrics pass confirmed the placed audio region genuinely
  contributes to the mixed output (non-silent, sane loudness/spectrum numbers).
- **[worked well]** The `+ track → Audio` creation flow and the `Kits` lane-row drag-and-drop
  mechanism itself (once discovered) are each individually clean, single-step interactions with no
  rough edges.

## Audio-region editing vs. MIDI note editing — maturity comparison

Audio-region editing is a real, working feature with a genuinely polished *core* (waveform display,
trim, gain, one working warp mode) — but it is clearly an earlier-stage, narrower-scoped citizen
than dotbeat's MIDI note-editing surface, and this isn't hidden: `docs/format-spec.md` explicitly
documents the v0.10 audio-clip model as "Clip-only, deliberately" (no live/non-clip form, exactly
one audio region per clip) and lists warp markers, complex-mode stretch, beat-slicing, native
recording, and multi-take comping as "explicitly deferred to future streams." What I hit in this
session — no persistent rhythmic-loop control, no multi-region-per-clip placement, replace-not-add
drag semantics, and a split that doesn't wire its output into the timeline — are all direct,
observable consequences of that documented scope cut, not surprises contradicting it. MIDI note
editing, by contrast (per prior pilots), has years-deeper affordances already: click-to-add,
drag-to-move/resize, marquee/multi-select, humanize/quantize/vary tooling, and a "Place in
Arrangement" workflow that composes cleanly with the song/scene model. For this pilot's stated goal
— a rhythmic layer of audio one-shots alongside MIDI drums/bass — the honest verdict is: you can
place *one* trimmed, warped audio region per track per section beautifully, but building a real
audio-driven rhythmic texture (the explicit ask in step 5) is not yet possible through the shipped
GUI or CLI surface.

## Environment / project state used

Scratch project at `/tmp/dotbeat-usability-85-audio-sample-layering/song.beat` (110 BPM, drums +
bass MIDI scaffolding, one audio track with a trimmed `kit-audiophob-kick` region) was checkpointed
in its own local history during the session (`scaffold`, then `audio-layer-pilot`) and subsequently
deleted along with the daemon/Vite processes as part of cleanup — nothing here persists outside this
report.

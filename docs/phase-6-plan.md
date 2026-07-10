# Phase 6 — Arrangement timeline: songs, not loops (format v0.4 + beatlab timeline mode)

*Owner-selected 2026-07-10 ("let's go with arrangement timeline"). The last unchecked M3 item
and the biggest structural gap vs a conventional DAW.*

## What actually exists in beatlab today (mapped 2026-07-10, source-verified)

Three orthogonal systems, none of which is a timeline:

- **Clips** (`Track.clips: Clip[]`) — named, self-contained snapshots of a track's
  notes/pattern/automation. Pure storage: the engine never reads them; save/load copies
  values in and out of the live track. Sandbox UI: clip strips in the piano roll / step
  sequencer.
- **Scenes** (`AppState.scenes: Scene[]`) — `{ id, name, clipIds: Record<trackId, clipId> }`.
  Launching a scene copies each mapped clip into its live track (fresh note ids). Manual only —
  nothing sequences scenes. UI: SceneLauncher grid.
- **ArrangementState** — an 8-slot section grid; `energy` mode gates (mutes) tracks per section
  *within the single loop* (`section = floor(bar / barsPerSection)` in the engine tick);
  `structure` mode is a labeling exercise with zero playback effect. Lesson/TrackLab-only —
  sandbox users can't create one.

Playback is always one looping transport of `loopBars` bars (max 64); song length has no
independent existence; bpm is a global constant (no tempo changes, hardcoded 4/4); WAV export
records exactly one loop pass. `applyDawState` deliberately preserves-and-ignores
clips/scenes/arrangement ("not modeled by the file yet").

## Design

### 6.1 beatlab: a real `timeline` arrangement mode *(engine work — owner-approved)*

Add `timeline: { sceneId: string; bars: number }[]` to `ArrangementState`, with
`mode: 'timeline'` as a new flavor. Semantics:

- **The song is an ordered list of sections; each section plays one scene for N bars.** Within
  a section, each track plays its scene-mapped clip's content, looping (a 2-bar groove loops
  through an 8-bar section — the musically-expected behavior). Tracks unmapped in the scene are
  silent for that section (a scene is a complete statement of what plays).
- **Resolution happens in the tick, not by state mutation**: the engine computes
  (bar → section → scene → per-track clip) and reads notes/pattern *from the clip data*,
  leaving live tracks untouched — no mid-playback store writes, no undo pollution, and the
  session-view workflow (launch/copy) keeps working unchanged when timeline mode is off.
- Transport: `loopEnd = totalBars(timeline)` when timeline mode is on (song loops as a whole);
  `loopBars` stays the sandbox-loop length when it's off. Automation inside clips: deferred
  (clip automation exists in beatlab but is not modeled by the format yet — see exclusions).
- Store actions: `setTimeline(entries)` (+ the existing scene/clip actions already cover
  authoring). Persistence: `timeline` rides in `SandboxPayload.arrangement` (already
  serialized). Minimal UI: a read-only timeline strip in ArrangementView is a stretch goal —
  authoring via scenes UI + the file/CLI is the phase-6 story (this is the agent-native DAW;
  the GUI timeline editor is its own later phase).

### 6.2 Format v0.4: clips, scenes, song

Grammar additions (all optional — a fileful of tracks with no clips/scenes/song is unchanged
v0.3, and v0.3 files parse as v0.4 with empty structure):

```
track lead Lead #c678dd synth
  synth
    ...
  clip verse-a                 # level-1 block inside a track; human slug id (D6)
    note n1 57 0 4 0.8         # same note grammar, positions relative to clip start
  clip chorus-a
    note n2 60 0 4 0.8
  note u1 64 0 2 0.7           # live loop content stays exactly as today

track drums Drums #e35d5d drums
  synth
    ...
  clip beat-main
    pattern kick 0.9 0 0 0 ...
    pattern snare ...          # drum clips carry all five lanes (same rule as track patterns)
    ...
  pattern kick ...             # live pattern unchanged

scene verse                    # top-level block after tracks
  slot lead verse-a            # one line per mapping — diff-friendly, canonical order by
  slot drums beat-main         # track position in the file

song                           # presence of a song block = timeline mode enabled
  section verse 8              # play scene "verse" for 8 bars
  section chorus 8
  section verse 4
```

Rules:
- Clip ids are track-scoped human slugs (unique per track); scene ids are document-scoped
  slugs; both deliberately do NOT match beatlab's `clip<n>`/`scene<n>` counter patterns, so
  restored counters can't collide with file-authored ids.
- `slot` lines reference clips that must exist on that track; `section` lines reference scenes
  that must exist; `bars` is an integer 1-64. Duplicate slot tracks / unknown refs are parse
  errors (fail loudly).
- Canonical ordering: clips serialize in first-seen source order (like tracks — creation order
  is meaningful); scene slots serialize in track order; sections are the song, order IS data.
- Synth-track clips carry `note` lines only; drum-track clips carry exactly the five `pattern`
  lanes (same validation as track-level patterns).

### 6.3 Converter + bridge (two-way)

- `.beatlab.json → .beat`: clips (notes/pattern per kind) convert; clip `automation` is
  reported in `droppedSynthParams`-style loss reporting (new `droppedClipFields`); scenes and
  `arrangement.timeline` convert; energy/structure arrangements are DELIBERATELY UNMODELED
  (lesson-side feature) and reported as dropped.
- `.beat → partial tracks`: clips/scenes/timeline ride the partial; beatlab's `applyDawState`
  gains clip/scene/timeline application (replacing today's preserve-and-ignore) — file wins,
  same as every other modeled field.

### 6.4 CLI/MCP surface

- `beat inspect` shows clips per track, scenes, and the song structure with total bars.
- New edit primitives: `beat clip <file> <track> <clip-id>` (snapshot current live content into
  a clip), `beat scene <file> <scene-id> <track>=<clip> ...`, `beat song <file> <scene> <bars>
  [<scene> <bars> ...]` (replace the section list). All canonical-write + edit-list output.
- MCP: `beat_song` tool mirroring the above (inspect covers reading).

### 6.5 Render the song

Offline renderer: when the parsed document has a song block, render length = total song bars
(not `loopBars`). Verify the engine's timeline mode headlessly.

## Exclusions (deliberate, reported by the converter where applicable)

Clip automation (needs the automation grammar — next format phase), energy/structure
arrangement modes (lesson-side), tempo changes / time signatures (no engine support — still
4/4, constant bpm), follow actions, per-section automation.

## Exit criteria

- [ ] A `.beat` file with 2+ scenes and a 3+ section song renders offline to the full song
      length, and per-section metric windows differ according to the scene content (proving
      sections actually switch content, not just mute).
- [ ] v0.3 files parse unchanged (no clips/scenes/song = today's behavior, byte-identical
      round trip).
- [ ] GUI two-way: daemon-synced beatlab session reflects a file-authored song (timeline mode
      on, correct total bars) — and clip edits made in the GUI clip strips survive a sync
      round trip.
- [ ] All existing tests stay green; new grammar/converter/engine tests cover the rules above.

## Sequencing

6.2 format core (types/parse/serialize/diff/inspect + tests) → 6.1 beatlab timeline mode
(types/store/engine/persistence) → 6.3 converter + bridge → 6.5 offline render → 6.4 CLI/MCP →
exit test → docs.

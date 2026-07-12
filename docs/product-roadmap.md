# dotbeat — product roadmap

*The source of truth for what's built, in progress, and planned. Supersedes `feature-matrix.md`
(renamed and restructured 2026-07-12 per owner direction — "feature area" was too coarse a grain:
a whole area like "track management" isn't meaningfully "done" or "not done," the individual
features inside it are).*

*Generated from `scripts/roadmap-data.mjs` via `node scripts/gen-product-roadmap.mjs` — edit the
data file, not this file directly, so it stays in sync with the matching artifact dashboard.*

## How to read this

- **Feature area** groups related features (e.g. "Drum programming"). It has no status of its
  own — read the features inside it.
- **Feature** is the actual unit of status — small enough that "done" means done.
- **Core / CLI·MCP / GUI** are the three layers every feature can exist at (per `docs/decisions.md`'s
  three-surface thesis) — ✅ done, 🔶 partial, ❌ missing, — not applicable to this feature.
- **Status** is the feature's overall state: ✅ Done (all applicable layers done and verified),
  🚧 In progress, ⬜ Not started.
- **Research** links the `docs/research/NN-*.md` pass that scoped the feature, if one exists.
- **Plan** links the `docs/phase-N-*.md` (or other) doc with the concrete build plan or the
  as-built result, if one exists.

A feature with links in both columns but status "Not started" means: fully scoped, ready for a
stream to pick up — not guesswork, a decision away from being built.

## Snapshot — 63 features tracked

**21** Done · **0** In progress · **42** Not started

---

## File format & core engine

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Diff-friendly canonical text format (.beat v0.9) | The .beat grammar itself: stable IDs, canonical field order, byte-identical round-trip. | ✅ done | ✅ done | — | ✅ Done | [`04-format-prior-art.md`](research/04-format-prior-art.md) | [`format-spec.md`](format-spec.md) |
| git-lfs media/binary handling | Presets and sample media stored via git-lfs so the text file stays diff-clean (decisions.md D11). | ✅ done | ✅ done | — | ✅ Done | — | [`decisions.md`](decisions.md) |

## Track management

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Add / delete tracks | Create a new synth/drums/instrument track or remove one, from the GUI or CLI. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-20-track-project-management.md`](phase-20-track-project-management.md) |
| Rename / recolor tracks | Inline double-click rename and a color picker on each track header. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-20-track-project-management.md`](phase-20-track-project-management.md) |
| Group tracks | Fold N tracks into one collapsible group header, the way Ableton groups do. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`18-ableton-ui-architecture.md`](research/18-ableton-ui-architecture.md) | — |

## Note editing (piano roll)

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Core note editing: add/move/resize/multi-select/marquee | Free-timed notes, keyboard strip + octave gridlines, pitch-aligned within 1px. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-19-piano-roll-keys.md`](phase-19-piano-roll-keys.md) |
| Fold mode | Collapse the piano roll to only the pitches actually in use, like Ableton’s Fold. | — | — | ❌ missing | ⬜ Not started | — | — |
| Scale-lock field + scale-tone highlighting | A per-clip/track scale + root note that constrains input and highlights in-scale keys. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`18-ableton-ui-architecture.md`](research/18-ableton-ui-architecture.md) | — |
| Pitch & Time operations (transpose, ×2/÷2, fit-to-scale, invert, humanize, reverse, legato) | One-shot edit primitives that rewrite note lines and produce a normal diff — CLI/MCP-first, same pattern as quantize. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`18-ableton-ui-architecture.md`](research/18-ableton-ui-architecture.md) | — |

## Drum programming

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Open per-track lane model + 12-lane GM-aligned default kit | Replace the closed 5-lane enum with a declared lane list; synth-backed 808/909 voices + SoundFont-backed realistic percussion, hybrid by role. | 🔶 partial | 🔶 partial | ❌ missing | ⬜ Not started | [`19-drum-voice-expansion.md`](research/19-drum-voice-expansion.md) | — |
| Optional per-hit duration field | One optional duration token on hit lines — byte-identical for existing files; substrate (synth/sample/SF) decides release vs. truncation semantics. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`20-drum-clip-editor-redesign.md`](research/20-drum-clip-editor-redesign.md) | — |
| Unified drum clip editor | Extend NoteView with a row-axis adapter for named drum lanes instead of pitch; retire StepSequencer as the primary editor. | — | — | ❌ missing | ⬜ Not started | [`20-drum-clip-editor-redesign.md`](research/20-drum-clip-editor-redesign.md) | — |
| Choke-group handling (hat pair) | Open hat silenced by closed hat on the same tick, standard drum-machine behavior. | ❌ missing | — | — | ⬜ Not started | [`19-drum-voice-expansion.md`](research/19-drum-voice-expansion.md) | — |

## Arrangement / song structure

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Section CRUD + loop→song conversion | Append/resize/delete song sections; a loop-mode project can grow into a full multi-section song. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-19-arrangement-length.md`](phase-19-arrangement-length.md) |
| Drag the rightmost loop boundary directly | Resize the loop by dragging its edge on the timeline instead of using +/- controls. | — | — | ❌ missing | ⬜ Not started | — | — |
| Independent per-section scene editing | Today, appended sections share the source scene; editing one edits them all. Give each section its own scene. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | — | — |
| Clip-level loop/length/time-signature properties | Ableton’s Start/End/Loop/Position/Length/Signature clip panel — not currently in the clip grammar. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`18-ableton-ui-architecture.md`](research/18-ableton-ui-architecture.md) | — |

## Synth sound design

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Full grouped synth param panel | ~54-field SYNTH_FIELDS across osc/filter/envelope/inserts/sends, exposed in one grouped GUI panel. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-13-editing.md`](phase-13-editing.md) |
| Real wavetable oscillator | wtPos exists in the format and an LFO can target it, but no wavetable oscillator exists in the engine — currently a dead knob. | ❌ missing | — | ❌ missing | ⬜ Not started | — | — |

## LFOs / modulation

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| 16-destination tempo-synced LFOs | Two LFOs per track, 16 possible destinations, real tempo sync — deliberately literal/enumerated, not a free-routing matrix. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-18-lfo-depth.md`](phase-18-lfo-depth.md) |

## Instrument / SoundFont tracks

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Playback, program select, meters, mute/solo | SoundFont-backed instrument tracks with program selection and real audio-gated mute/solo. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-14-instrument-tracks.md`](phase-14-instrument-tracks.md) |
| Instrument-track FX chain | EQ/compression/sends per instrument track — today it’s level/pan only. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | — | — |

## Mixer

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Inline strip + full-screen overlay | Per-track header mixer strip plus an on-demand all-strips overlay; real audio-gated mute/solo. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-16-instrument-mixer.md`](phase-16-instrument-mixer.md) |
| Persisted mute/solo representation | Mute/solo are UI-only transient state today — decide whether either should be a real, saved field. | ❌ missing | — | — | ⬜ Not started | [`18-ableton-ui-architecture.md`](research/18-ableton-ui-architecture.md) | — |

## Core effects

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| EQ3 / comp / distortion / bitcrush / reverb+delay sends / sidechain | The built-in insert set every synth and drum bus already carries. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-13-editing.md`](phase-13-editing.md) |

## Extended FX arsenal

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Ping Pong Delay | Tone.PingPongDelay as a per-track insert — the cheapest of the two owner-named asks. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`17-track-fx-arsenal.md`](research/17-track-fx-arsenal.md) | — |
| Beat Repeat | Grid/gate/chance/mode stutter-repeat effect, genre-signature for EDM/hip-hop/glitch. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`17-track-fx-arsenal.md`](research/17-track-fx-arsenal.md) | — |
| Expose Chorus-Ensemble / Phaser-Flanger as a per-track insert | The DSP already runs on a shared mod-send bus; convert it into a proper configurable insert. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`17-track-fx-arsenal.md`](research/17-track-fx-arsenal.md) | — |
| Saturator | Tone.WaveShaper-based character saturation with an analog/warm/clip/fold curve family. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`17-track-fx-arsenal.md`](research/17-track-fx-arsenal.md) | — |
| Auto Filter / Auto Pan / Tremolo | Dedicated Ableton-named devices — deferred since the shared LFO destination matrix already covers the sonic capability. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`17-track-fx-arsenal.md`](research/17-track-fx-arsenal.md) | — |
| Redux (downsampling half) | Bit-reduction already ships; sample-rate downsampling needs a small custom node (no Tone.js built-in). | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`17-track-fx-arsenal.md`](research/17-track-fx-arsenal.md) | — |
| Utility (stereo width / gain trim) | Near-free via Tone.StereoWidener — a mixing-hygiene tool, not a sound-design reach. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`17-track-fx-arsenal.md`](research/17-track-fx-arsenal.md) | — |
| Grain Delay / Vinyl Distortion / Resonators | Real custom DSP built from Tone.js primitives (GrainPlayer, WaveShaper+Noise, filter bank) — bigger lifts, good Phase-19+ candidates. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`17-track-fx-arsenal.md`](research/17-track-fx-arsenal.md) | — |
| Corpus | Resonant-body physical-modeling effect — no Tone.js primitive gets close; AudioWorklet-tier custom DSP, lowest priority. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`17-track-fx-arsenal.md`](research/17-track-fx-arsenal.md) | — |

## Automation

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Per-track picker + draggable curve | Pick a track/param, draw breakpoints, playback verified to follow the drawn curve exactly. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-20-automation-lanes.md`](phase-20-automation-lanes.md) |
| Curved segments | v0.9 is points-only, linear between them; add an interpolation field (hold/linear/curve) to the point grammar. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`18-ableton-ui-architecture.md`](research/18-ableton-ui-architecture.md) | — |
| Same-row curve overlay | Draw the automation curve directly over the clip row instead of only in a dedicated sub-lane. | — | — | ❌ missing | ⬜ Not started | — | — |
| Multi-clip-per-track automation | Automation is currently scoped to one clip at a time — support more than one clip on the same track. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | — | — |
| Log-scale y-axis | Frequency-style params (cutoff, etc.) read better on a log axis than linear. | — | — | ❌ missing | ⬜ Not started | — | — |

## Versioning / history

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| git-backed checkpoints, history panel, pin/restore | Explicit checkpoint/history/pin/restore over git — not automatic, deliberately. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-15-history-panel.md`](phase-15-history-panel.md) |

## Vary / audition loop

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Rungs 1–3: vary / score / suggest | Generate parameter variants, audition live, keep or undo; a cold-start recommender picks the next group to try. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-15-vary-affordance.md`](phase-15-vary-affordance.md) |
| Rung-2 "feel" content variation, wired into the GUI | Humanized timing/velocity variation batches exist in core/CLI; not yet exposed as a GUI affordance. | ✅ done | ✅ done | ❌ missing | ⬜ Not started | — | — |

## Render / export

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| GUI Export button | Reuses the live engine’s own capture path; verified against the CLI reference render. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-20-render-export.md`](phase-20-render-export.md) |

## Metrics / critique loop

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| LUFS / spectral / crest / stereo metrics + lint | Agent-facing per decisions.md D2 ("LLM narrates, never judges alone") — no GUI meter display planned, not a gap. | ✅ done | ✅ done | — | ✅ Done | — | [`decisions.md`](decisions.md) |

## Selection protocol

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| daemon /selection + --scope selection | A shared selection axis grammar wired into both the arrangement and note views and the CLI. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-13-editing.md`](phase-13-editing.md) |

## Preset / content library

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| 36 presets + content taxonomy | Presets are tooling (never in-file indirection); categorized following Ableton’s browsable-kind logic. | ✅ done | ✅ done | — | ✅ Done | [`18-ableton-ui-architecture.md`](research/18-ableton-ui-architecture.md) | [`phase-18-content-taxonomy.md`](phase-18-content-taxonomy.md) |
| Content browser sidebar | A left-sidebar browser over presets/samples/kits, drag-drop onto a track — the data layer is ready, nothing to browse from yet. | — | — | ❌ missing | ⬜ Not started | [`18-ableton-ui-architecture.md`](research/18-ableton-ui-architecture.md) | — |
| Hot-swap preset browser in Device View | Apply a named preset’s literal param edits from inside the synth panel, not just via CLI. | — | ✅ done | ❌ missing | ⬜ Not started | [`18-ableton-ui-architecture.md`](research/18-ableton-ui-architecture.md) | — |
| Preview-before-load | Audition a preset/sample before applying it, consistent with the existing Freesound-preview tooling. | — | — | ❌ missing | ⬜ Not started | [`18-ableton-ui-architecture.md`](research/18-ableton-ui-architecture.md) | — |

## Macros

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Macro tooling layer | A curated "front panel" of knobs mapped to real params, living outside the file (like presets) — turning a macro writes literal edits, never an in-file indirection. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`18-ableton-ui-architecture.md`](research/18-ableton-ui-architecture.md) | — |

## Undo / redo (in-session)

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Multi-level in-session undo/redo | Distinct from checkpoint/history versioning. Stripped from the original BeatLab port and never rebuilt — Ctrl+Z currently does nothing. | — | — | ❌ missing | ⬜ Not started | — | — |

## Project / folder management

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| beat init + "Open Folder" re-pointing | Initialize a new .beat project and re-point the desktop app at a different project folder. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-20-track-project-management.md`](phase-20-track-project-management.md) |
| New-project-from-scratch, GUI-reachable | Create a brand new project without dropping to the CLI first. | — | ✅ done | ❌ missing | ⬜ Not started | — | — |

## Desktop app / packaging

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Tauri shell, compiled sidecar, bundled starter | Real desktop shell, force-quit-safe, local-machine distribution only (no notarization/signing, decisions.md D13). | ✅ done | — | ✅ done | ✅ Done | — | [`decisions.md`](decisions.md) |

## Audio-region clip editing

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Audio-region clip format | Media reference + in-point + out-point + gain + a warp enum + optional markers — the prerequisite for everything else in this area; the format has no such concept today. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`16-audio-clip-editing.md`](research/16-audio-clip-editing.md) | — |
| Repitch-mode warping | A playbackRate-equivalent parameter — the cheapest warp mode and the natural first exit test. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`16-audio-clip-editing.md`](research/16-audio-clip-editing.md) | — |
| Split-at-point | A pure edit primitive on the new clip-content shape — no DSP, no new engine capability. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`16-audio-clip-editing.md`](research/16-audio-clip-editing.md) | — |
| Clip gain (static + automation lane) | Static gain is trivial; the time-varying case very likely reuses the existing BeatAutomationLane machinery. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`16-audio-clip-editing.md`](research/16-audio-clip-editing.md) | — |
| Warp markers + Complex-mode stretch | Marker-list format addition plus a real stretch-algorithm integration via signalsmith-stretch (MIT/WASM). | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`16-audio-clip-editing.md`](research/16-audio-clip-editing.md) | — |
| Beats-mode transient slicing | Onset/transient detection plus the stretch library; sequence after the rest of the audio-clip format proves out. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`16-audio-clip-editing.md`](research/16-audio-clip-editing.md) | — |
| Native audio recording | No capture path exists today; gated behind the confirmed ~30ms web-audio latency wall — explicitly Tauri/M4-native scope. | ❌ missing | — | ❌ missing | ⬜ Not started | [`16-audio-clip-editing.md`](research/16-audio-clip-editing.md) | [`m4-native-engine-design.md`](m4-native-engine-design.md) |
| Multi-take comping, freeze/flatten/bounce | Needs the butler-thread disk-streaming architecture already scoped for M4.2 — a different problem from single-clip warping. | ❌ missing | — | ❌ missing | ⬜ Not started | [`16-audio-clip-editing.md`](research/16-audio-clip-editing.md) | [`m4-native-engine-design.md`](m4-native-engine-design.md) |

## Agent onboarding

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| beat mcp-init + Claude Code skill | Live-verified onboarding skill that sets an agent up to drive dotbeat via MCP. | — | ✅ done | — | ✅ Done | — | [`phase-17-cc-skill.md`](phase-17-cc-skill.md) |

---

## Process

Every stream/phase that ships a feature updates `scripts/roadmap-data.mjs` (not this file
directly) as part of its own completion checklist, then re-runs the generator — don't let it
drift stale. When a stream *researches* a feature without building it, add the row the moment the
research doc lands with status "not-started" and a research link, so scoped-but-unbuilt work is
visible in the same place as everything else, not buried in `docs/research/`.

Last regenerated: 2026-07-12.

// Single source of truth for docs/product-roadmap.md and its artifact rendering.
// status: 'done' | 'progress' | 'not-started'  (progress reserved for future use — nothing is
// mid-stream right now, all seven Phase 19-21 streams just landed)
// layer values: 'done' | 'partial' | 'missing' | 'na'

export const rows = [
  // ── File format & core engine ──────────────────────────────────────────
  {
    area: 'File format & core engine', feature: 'Diff-friendly canonical text format (.beat v0.9)',
    description: 'The .beat grammar itself: stable IDs, canonical field order, byte-identical round-trip.',
    core: 'done', cli: 'done', gui: 'na', status: 'done',
    research: 'research/04-format-prior-art.md', plan: 'format-spec.md',
  },
  {
    area: 'File format & core engine', feature: 'git-lfs media/binary handling',
    description: 'Presets and sample media stored via git-lfs so the text file stays diff-clean (decisions.md D11).',
    core: 'done', cli: 'done', gui: 'na', status: 'done',
    research: null, plan: 'decisions.md',
  },

  // ── Track management ────────────────────────────────────────────────────
  {
    area: 'Track management', feature: 'Add / delete tracks',
    description: 'Create a new synth/drums/instrument track or remove one, from the GUI or CLI.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-20-track-project-management.md',
  },
  {
    area: 'Track management', feature: 'Rename / recolor tracks',
    description: 'Inline double-click rename and a color picker on each track header.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-20-track-project-management.md',
  },
  {
    area: 'Track management', feature: 'Group tracks',
    description: 'Fold N tracks into one collapsible group header, the way Ableton groups do.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/18-ableton-ui-architecture.md', plan: null,
  },

  // ── Note editing (piano roll) ───────────────────────────────────────────
  {
    area: 'Note editing (piano roll)', feature: 'Core note editing: add/move/resize/multi-select/marquee',
    description: 'Free-timed notes, keyboard strip + octave gridlines, pitch-aligned within 1px.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-19-piano-roll-keys.md',
  },
  {
    area: 'Note editing (piano roll)', feature: 'Fold mode',
    description: 'Collapse the piano roll to only the pitches actually in use, like Ableton’s Fold.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: null, plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Scale-lock field + scale-tone highlighting',
    description: 'A per-clip/track scale + root note that constrains input and highlights in-scale keys.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/18-ableton-ui-architecture.md', plan: null,
  },
  {
    area: 'Note editing (piano roll)', feature: 'Pitch & Time operations (transpose, ×2/÷2, fit-to-scale, invert, humanize, reverse, legato)',
    description: 'One-shot edit primitives that rewrite note lines and produce a normal diff — CLI/MCP-first, same pattern as quantize.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/18-ableton-ui-architecture.md', plan: null,
  },

  // ── Drum programming ─────────────────────────────────────────────────────
  {
    area: 'Drum programming', feature: 'Open per-track lane model + 12-lane GM-aligned default kit',
    description: 'Replace the closed 5-lane enum with a declared lane list; synth-backed 808/909 voices + SoundFont-backed realistic percussion, hybrid by role.',
    core: 'partial', cli: 'partial', gui: 'missing', status: 'not-started',
    research: 'research/19-drum-voice-expansion.md', plan: null,
  },
  {
    area: 'Drum programming', feature: 'Optional per-hit duration field',
    description: 'One optional duration token on hit lines — byte-identical for existing files; substrate (synth/sample/SF) decides release vs. truncation semantics.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/20-drum-clip-editor-redesign.md', plan: null,
  },
  {
    area: 'Drum programming', feature: 'Unified drum clip editor',
    description: 'Extend NoteView with a row-axis adapter for named drum lanes instead of pitch; retire StepSequencer as the primary editor.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/20-drum-clip-editor-redesign.md', plan: null,
  },
  {
    area: 'Drum programming', feature: 'Choke-group handling (hat pair)',
    description: 'Open hat silenced by closed hat on the same tick, standard drum-machine behavior.',
    core: 'missing', cli: 'na', gui: 'na', status: 'not-started',
    research: 'research/19-drum-voice-expansion.md', plan: null,
  },

  // ── Arrangement / song structure ────────────────────────────────────────
  {
    area: 'Arrangement / song structure', feature: 'Section CRUD + loop→song conversion',
    description: 'Append/resize/delete song sections; a loop-mode project can grow into a full multi-section song.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-19-arrangement-length.md',
  },
  {
    area: 'Arrangement / song structure', feature: 'Drag the rightmost loop boundary directly',
    description: 'Resize the loop by dragging its edge on the timeline instead of using +/- controls.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: null, plan: null,
  },
  {
    area: 'Arrangement / song structure', feature: 'Independent per-section scene editing',
    description: 'Today, appended sections share the source scene; editing one edits them all. Give each section its own scene.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: null, plan: null,
  },
  {
    area: 'Arrangement / song structure', feature: 'Clip-level loop/length/time-signature properties',
    description: 'Ableton’s Start/End/Loop/Position/Length/Signature clip panel — not currently in the clip grammar.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/18-ableton-ui-architecture.md', plan: null,
  },

  // ── Synth sound design ──────────────────────────────────────────────────
  {
    area: 'Synth sound design', feature: 'Full grouped synth param panel',
    description: '~54-field SYNTH_FIELDS across osc/filter/envelope/inserts/sends, exposed in one grouped GUI panel.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-13-editing.md',
  },
  {
    area: 'Synth sound design', feature: 'Real wavetable oscillator',
    description: 'wtPos exists in the format and an LFO can target it, but no wavetable oscillator exists in the engine — currently a dead knob.',
    core: 'missing', cli: 'na', gui: 'missing', status: 'not-started',
    research: null, plan: null,
  },

  // ── LFOs / modulation ────────────────────────────────────────────────────
  {
    area: 'LFOs / modulation', feature: '16-destination tempo-synced LFOs',
    description: 'Two LFOs per track, 16 possible destinations, real tempo sync — deliberately literal/enumerated, not a free-routing matrix.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-18-lfo-depth.md',
  },

  // ── Instrument / SoundFont tracks ───────────────────────────────────────
  {
    area: 'Instrument / SoundFont tracks', feature: 'Playback, program select, meters, mute/solo',
    description: 'SoundFont-backed instrument tracks with program selection and real audio-gated mute/solo.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-14-instrument-tracks.md',
  },
  {
    area: 'Instrument / SoundFont tracks', feature: 'Instrument-track FX chain',
    description: 'EQ/compression/sends per instrument track — today it’s level/pan only.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: null, plan: null,
  },

  // ── Mixer ────────────────────────────────────────────────────────────────
  {
    area: 'Mixer', feature: 'Inline strip + full-screen overlay',
    description: 'Per-track header mixer strip plus an on-demand all-strips overlay; real audio-gated mute/solo.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-16-instrument-mixer.md',
  },
  {
    area: 'Mixer', feature: 'Persisted mute/solo representation',
    description: 'Mute/solo are UI-only transient state today — decide whether either should be a real, saved field.',
    core: 'missing', cli: 'na', gui: 'na', status: 'not-started',
    research: 'research/18-ableton-ui-architecture.md', plan: null,
  },

  // ── Core effects ─────────────────────────────────────────────────────────
  {
    area: 'Core effects', feature: 'EQ3 / comp / distortion / bitcrush / reverb+delay sends / sidechain',
    description: 'The built-in insert set every synth and drum bus already carries.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-13-editing.md',
  },

  // ── Extended FX arsenal ──────────────────────────────────────────────────
  {
    area: 'Extended FX arsenal', feature: 'Ping Pong Delay',
    description: 'Tone.PingPongDelay as a per-track insert — the cheapest of the two owner-named asks.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/17-track-fx-arsenal.md', plan: null,
  },
  {
    area: 'Extended FX arsenal', feature: 'Beat Repeat',
    description: 'Grid/gate/chance/mode stutter-repeat effect, genre-signature for EDM/hip-hop/glitch.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/17-track-fx-arsenal.md', plan: null,
  },
  {
    area: 'Extended FX arsenal', feature: 'Expose Chorus-Ensemble / Phaser-Flanger as a per-track insert',
    description: 'The DSP already runs on a shared mod-send bus; convert it into a proper configurable insert.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/17-track-fx-arsenal.md', plan: null,
  },
  {
    area: 'Extended FX arsenal', feature: 'Saturator',
    description: 'Tone.WaveShaper-based character saturation with an analog/warm/clip/fold curve family.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/17-track-fx-arsenal.md', plan: null,
  },
  {
    area: 'Extended FX arsenal', feature: 'Auto Filter / Auto Pan / Tremolo',
    description: 'Dedicated Ableton-named devices — deferred since the shared LFO destination matrix already covers the sonic capability.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/17-track-fx-arsenal.md', plan: null,
  },
  {
    area: 'Extended FX arsenal', feature: 'Redux (downsampling half)',
    description: 'Bit-reduction already ships; sample-rate downsampling needs a small custom node (no Tone.js built-in).',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/17-track-fx-arsenal.md', plan: null,
  },
  {
    area: 'Extended FX arsenal', feature: 'Utility (stereo width / gain trim)',
    description: 'Near-free via Tone.StereoWidener — a mixing-hygiene tool, not a sound-design reach.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/17-track-fx-arsenal.md', plan: null,
  },
  {
    area: 'Extended FX arsenal', feature: 'Grain Delay / Vinyl Distortion / Resonators',
    description: 'Real custom DSP built from Tone.js primitives (GrainPlayer, WaveShaper+Noise, filter bank) — bigger lifts, good Phase-19+ candidates.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/17-track-fx-arsenal.md', plan: null,
  },
  {
    area: 'Extended FX arsenal', feature: 'Corpus',
    description: 'Resonant-body physical-modeling effect — no Tone.js primitive gets close; AudioWorklet-tier custom DSP, lowest priority.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/17-track-fx-arsenal.md', plan: null,
  },

  // ── Automation ───────────────────────────────────────────────────────────
  {
    area: 'Automation', feature: 'Per-track picker + draggable curve',
    description: 'Pick a track/param, draw breakpoints, playback verified to follow the drawn curve exactly.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-20-automation-lanes.md',
  },
  {
    area: 'Automation', feature: 'Curved segments',
    description: 'v0.9 is points-only, linear between them; add an interpolation field (hold/linear/curve) to the point grammar.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/18-ableton-ui-architecture.md', plan: null,
  },
  {
    area: 'Automation', feature: 'Same-row curve overlay',
    description: 'Draw the automation curve directly over the clip row instead of only in a dedicated sub-lane.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: null, plan: null,
  },
  {
    area: 'Automation', feature: 'Multi-clip-per-track automation',
    description: 'Automation is currently scoped to one clip at a time — support more than one clip on the same track.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: null, plan: null,
  },
  {
    area: 'Automation', feature: 'Log-scale y-axis',
    description: 'Frequency-style params (cutoff, etc.) read better on a log axis than linear.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: null, plan: null,
  },

  // ── Versioning / history ────────────────────────────────────────────────
  {
    area: 'Versioning / history', feature: 'git-backed checkpoints, history panel, pin/restore',
    description: 'Explicit checkpoint/history/pin/restore over git — not automatic, deliberately.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-15-history-panel.md',
  },

  // ── Vary / audition loop ────────────────────────────────────────────────
  {
    area: 'Vary / audition loop', feature: 'Rungs 1–3: vary / score / suggest',
    description: 'Generate parameter variants, audition live, keep or undo; a cold-start recommender picks the next group to try.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-15-vary-affordance.md',
  },
  {
    area: 'Vary / audition loop', feature: 'Rung-2 "feel" content variation, wired into the GUI',
    description: 'Humanized timing/velocity variation batches exist in core/CLI; not yet exposed as a GUI affordance.',
    core: 'done', cli: 'done', gui: 'missing', status: 'not-started',
    research: null, plan: null,
  },

  // ── Render / export ──────────────────────────────────────────────────────
  {
    area: 'Render / export', feature: 'GUI Export button',
    description: 'Reuses the live engine’s own capture path; verified against the CLI reference render.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-20-render-export.md',
  },

  // ── Metrics / critique loop ──────────────────────────────────────────────
  {
    area: 'Metrics / critique loop', feature: 'LUFS / spectral / crest / stereo metrics + lint',
    description: 'Agent-facing per decisions.md D2 ("LLM narrates, never judges alone") — no GUI meter display planned, not a gap.',
    core: 'done', cli: 'done', gui: 'na', status: 'done',
    research: null, plan: 'decisions.md',
  },

  // ── Selection protocol ───────────────────────────────────────────────────
  {
    area: 'Selection protocol', feature: 'daemon /selection + --scope selection',
    description: 'A shared selection axis grammar wired into both the arrangement and note views and the CLI.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-13-editing.md',
  },

  // ── Preset / content library ─────────────────────────────────────────────
  {
    area: 'Preset / content library', feature: '36 presets + content taxonomy',
    description: 'Presets are tooling (never in-file indirection); categorized following Ableton’s browsable-kind logic.',
    core: 'done', cli: 'done', gui: 'na', status: 'done',
    research: 'research/18-ableton-ui-architecture.md', plan: 'phase-18-content-taxonomy.md',
  },
  {
    area: 'Preset / content library', feature: 'Content browser sidebar',
    description: 'A left-sidebar browser over presets/samples/kits, drag-drop onto a track — the data layer is ready, nothing to browse from yet.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/18-ableton-ui-architecture.md', plan: null,
  },
  {
    area: 'Preset / content library', feature: 'Hot-swap preset browser in Device View',
    description: 'Apply a named preset’s literal param edits from inside the synth panel, not just via CLI.',
    core: 'na', cli: 'done', gui: 'missing', status: 'not-started',
    research: 'research/18-ableton-ui-architecture.md', plan: null,
  },
  {
    area: 'Preset / content library', feature: 'Preview-before-load',
    description: 'Audition a preset/sample before applying it, consistent with the existing Freesound-preview tooling.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/18-ableton-ui-architecture.md', plan: null,
  },

  // ── Macros ───────────────────────────────────────────────────────────────
  {
    area: 'Macros', feature: 'Macro tooling layer',
    description: 'A curated "front panel" of knobs mapped to real params, living outside the file (like presets) — turning a macro writes literal edits, never an in-file indirection.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/18-ableton-ui-architecture.md', plan: null,
  },

  // ── Undo / redo ──────────────────────────────────────────────────────────
  {
    area: 'Undo / redo (in-session)', feature: 'Multi-level in-session undo/redo',
    description: 'Distinct from checkpoint/history versioning. Stripped from the original BeatLab port and never rebuilt — Ctrl+Z currently does nothing.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: null, plan: null,
  },

  // ── Project / folder management ──────────────────────────────────────────
  {
    area: 'Project / folder management', feature: 'beat init + "Open Folder" re-pointing',
    description: 'Initialize a new .beat project and re-point the desktop app at a different project folder.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-20-track-project-management.md',
  },
  {
    area: 'Project / folder management', feature: 'New-project-from-scratch, GUI-reachable',
    description: 'Create a brand new project without dropping to the CLI first.',
    core: 'na', cli: 'done', gui: 'missing', status: 'not-started',
    research: null, plan: null,
  },

  // ── Desktop app / packaging ──────────────────────────────────────────────
  {
    area: 'Desktop app / packaging', feature: 'Tauri shell, compiled sidecar, bundled starter',
    description: 'Real desktop shell, force-quit-safe, local-machine distribution only (no notarization/signing, decisions.md D13).',
    core: 'done', cli: 'na', gui: 'done', status: 'done',
    research: null, plan: 'decisions.md',
  },

  // ── Audio-region clip editing ─────────────────────────────────────────────
  {
    area: 'Audio-region clip editing', feature: 'Audio-region clip format',
    description: 'Media reference + in-point + out-point + gain + a warp enum + optional markers — the prerequisite for everything else in this area; the format has no such concept today.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/16-audio-clip-editing.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Repitch-mode warping',
    description: 'A playbackRate-equivalent parameter — the cheapest warp mode and the natural first exit test.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/16-audio-clip-editing.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Split-at-point',
    description: 'A pure edit primitive on the new clip-content shape — no DSP, no new engine capability.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/16-audio-clip-editing.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Clip gain (static + automation lane)',
    description: 'Static gain is trivial; the time-varying case very likely reuses the existing BeatAutomationLane machinery.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/16-audio-clip-editing.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Warp markers + Complex-mode stretch',
    description: 'Marker-list format addition plus a real stretch-algorithm integration via signalsmith-stretch (MIT/WASM).',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/16-audio-clip-editing.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Beats-mode transient slicing',
    description: 'Onset/transient detection plus the stretch library; sequence after the rest of the audio-clip format proves out.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/16-audio-clip-editing.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Native audio recording',
    description: 'No capture path exists today; gated behind the confirmed ~30ms web-audio latency wall — explicitly Tauri/M4-native scope.',
    core: 'missing', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/16-audio-clip-editing.md', plan: 'm4-native-engine-design.md',
  },
  {
    area: 'Audio-region clip editing', feature: 'Multi-take comping, freeze/flatten/bounce',
    description: 'Needs the butler-thread disk-streaming architecture already scoped for M4.2 — a different problem from single-clip warping.',
    core: 'missing', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/16-audio-clip-editing.md', plan: 'm4-native-engine-design.md',
  },

  // ── Agent onboarding ──────────────────────────────────────────────────────
  {
    area: 'Agent onboarding', feature: 'beat mcp-init + Claude Code skill',
    description: 'Live-verified onboarding skill that sets an agent up to drive dotbeat via MCP.',
    core: 'na', cli: 'done', gui: 'na', status: 'done',
    research: null, plan: 'phase-17-cc-skill.md',
  },
]

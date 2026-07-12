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
  {
    area: 'File format & core engine', feature: 'Reference-counted git-lfs asset GC',
    description: 'A `beat lfs gc`-style command tracking which LFS objects are still referenced by any project on the machine, so orphaned sample/preset media can be safely deleted. git-lfs dedupes by content hash within a repo but has no native answer to "is this still used anywhere."',
    core: 'missing', cli: 'missing', gui: 'na', status: 'not-started',
    research: 'research/23-opendaw-collaboration-storage.md', plan: null,
  },
  {
    area: 'File format & core engine', feature: 'git-lfs file locking for binary media',
    description: 'Adopt git-lfs\'s existing `git lfs lock` (unused today) as a soft mutex with an honest override warning — the one part of a .beat project git genuinely can\'t diff/merge.',
    core: 'missing', cli: 'missing', gui: 'na', status: 'not-started',
    research: 'research/23-opendaw-collaboration-storage.md', plan: null,
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
    description: 'Fold N tracks into one collapsible group header. A group is a flat, named, colored membership list (`group <id> <name> <color> <track-id>...`, v0.10) — a track belongs to at most one group, no nesting. Collapsed/expanded is deliberately UI-only session state (like mute/solo), never written to the file.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/18-ableton-ui-architecture.md', plan: 'phase-22-stream-af.md',
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
    description: 'One-shot edit primitives (src/core/pitchtime.ts) that rewrite note lines and produce a normal diff — same pattern as quantize. beat_humanize already covered the Humanize row (tracked separately under "Vary / audition loop" — its own GUI affordance is Stream BB\'s territory). Phase 22 Stream AD added transpose/time-scale/fit-scale/invert/reverse/legato as CLI verbs + MCP tools; Phase 23 Stream BA added a Pitch & Time panel in NoteView.tsx (always visible for a note track, scoped to the current note selection or the whole track) that calls the six ops plus Consolidate through a new daemon route (POST /pitch-time — AD shipped CLI/MCP-only "no daemon route needed," but each op\'s own batch parameter shape needed one after all, same as /song and /audio-split). Verified live: ui/verify-phase23-stream-ba.mjs drives real clicks and checks the resulting .beat diff for each of the seven ops.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/18-ableton-ui-architecture.md', plan: 'phase-23-stream-ba.md',
  },
  {
    area: 'Note editing (piano roll)', feature: 'Groove / shuffle as a reversible time-warp',
    description: 'Two literal track-level fields (shuffleAmount, shuffleGrid — src/core/document.ts) applied at read/playback time via warpStep()/unwarpStep() (src/core/groove.ts, a Möbius-ease curve; exact-inverse round-trip unit-tested), never baked into stored note/hit start; ui/src/audio/engine.ts hand-mirrors the same math and applies it in the synth/instrument note-scheduling loop (drum-hit scheduling remains a follow-on, unchanged this stream). Phase 23 Stream BA added a Shuffle/Grid knob pair to each mixer channel strip (MixerView.tsx), writing shuffleAmount/shuffleGrid through the existing `<track>.shuffleAmount`/`<track>.shuffleGrid` postEdit grammar — no new CLI verb or daemon route needed, same as AD left it. Verified live (a real knob drag produces the exact `groove <amount> <grid>` line on disk).',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/22-opendaw-editing-workflow.md', plan: 'phase-23-stream-ba.md',
  },
  {
    area: 'Note editing (piano roll)', feature: 'Per-note probability (chance)',
    description: 'A 0-100 int field (default 100 = today\'s always-fires behavior), re-rolled via a seeded RNG (src/core/chance.ts\'s chanceFires — mulberry32 + FNV-1a seed fold) once per playback pass in the scheduler, verified directly against the seeded sequence (statistical unit tests) rather than by rendering audio repeatedly. GUI: the Phase 22 per-note inspector panel remains for typing an exact value; Phase 23 Stream BA added the missing at-a-glance layer — a chance<100 note draws dimmed + dashed in the piano roll — plus a new chance lane below the velocity lane supporting a genuine draw-ACROSS-notes paint gesture (research 22 §1.4\'s PropertyDrawModifier reference): one continuous drag paints every note the pointer sweeps over to the same probability, not just the note first pressed. Verified live.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/22-opendaw-editing-workflow.md', plan: 'phase-23-stream-ba.md',
  },
  {
    area: 'Note editing (piano roll)', feature: 'Note ratchet / repeat (play-count + curve)',
    description: 'The richer 3-field shape (ratchetCount + ratchetCurve + ratchetLength) research 22 recommends over openDAW\'s own 2-field version (their team is mid-refactor away from it). src/core/pitchtime.ts\'s ratchetSlots is the one spacing function both live playback (engine.ts, hand-mirrored) and `beat consolidate`/`beat_consolidate` (bakes a ratchet back into exact discrete notes) agree on. GUI: the Phase 22 per-note inspector panel remains for typing exact values; Phase 23 Stream BA added a visual tick-mark glyph on a ratcheted note itself (one mark per internal repeat boundary, using the same curve-warped spacing ratchetSlots computes) and wired Consolidate into the new Pitch & Time panel as a real button. Verified live: setting ratchetCount=4 shows exactly 3 ticks, and Consolidate produces exactly 4 discrete notes at the exact expected positions.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/22-opendaw-editing-workflow.md', plan: 'phase-23-stream-ba.md',
  },
  {
    area: 'Note editing (piano roll)', feature: 'Per-note micro-tuning (cent offset)',
    description: 'A ±50-cent float field independent of semitone pitch, applied as a frequency offset at playback for synth-track notes (ui/src/audio/engine.ts); NOT yet wired for instrument/SoundFont-track notes (WorkletSynthesizer\'s pitch-bend is channel-wide, a bigger lift than this pass\'s scope — see phase-22-stream-ad.md\'s Result section). GUI: editable via the per-note inspector panel.',
    core: 'partial', cli: 'done', gui: 'done', status: 'progress',
    research: 'research/22-opendaw-editing-workflow.md', plan: 'phase-22-stream-ad.md',
  },

  // ── Drum programming ─────────────────────────────────────────────────────
  {
    area: 'Drum programming', feature: 'Open per-track lane model + 12-lane GM-aligned default kit',
    description: 'v0.10: an open, declared, ordered lane list per drum track (synth:<voice>/sample/sf backings), layered additively alongside the legacy closed-5-lane mechanism so every pre-v0.10 file parses and re-serializes byte-identically. kit-808/kit-909 (synth) + kit-acoustic (SoundFont, MuldjordKit) ship in presets/drum-kits.json; `beat add-track --kind drums` defaults to the 12-lane kit going forward. No dedicated GUI knob surface for per-lane synth params yet (author via a kit preset or hand-edit) — the honest gap this leaves open.',
    core: 'done', cli: 'done', gui: 'partial', status: 'progress',
    research: 'research/19-drum-voice-expansion.md', plan: 'phase-22-stream-ab.md',
  },
  {
    area: 'Drum programming', feature: 'Optional per-hit duration field',
    description: 'One optional trailing duration token on hit lines, elided when absent (byte-identical for every pre-existing file); the lane\'s backing decides release (synth/SF) vs. truncation (sample) semantics. `beat add-hit`/`beat set <track>.hit.<id>.duration` and the GUI\'s drag-to-resize both write it.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/20-drum-clip-editor-redesign.md', plan: 'phase-22-stream-ab.md',
  },
  {
    area: 'Drum programming', feature: 'Unified drum clip editor',
    description: 'NoteView generalized behind a row-axis adapter (rowCount/rowLabel/rowOfValue/valueOfRow) — melodic tracks keep the unchanged pitch adapter, drum tracks get a named-lane adapter over the kit\'s declared lanes. A durationless hit renders as a marker; dragging its edge creates a duration (marker -> bar). Soft grid-snap by default, Alt/Cmd freehand bypass. StepSequencer.tsx retired (deleted, no second permanent editor).',
    core: 'na', cli: 'na', gui: 'done', status: 'done',
    research: 'research/20-drum-clip-editor-redesign.md', plan: 'phase-22-stream-ab.md',
  },
  {
    area: 'Drum programming', feature: 'Choke-group handling (hat pair)',
    description: 'A closed-hat hit silences a ringing open hat (declared-lane kits only, keyed by canonical lane name) — release for synth/SF voices, stop for sample players.',
    core: 'na', cli: 'na', gui: 'done', status: 'done',
    research: 'research/19-drum-voice-expansion.md', plan: 'phase-22-stream-ab.md',
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
    description: 'Resize the loop by dragging its edge on the timeline instead of using +/- controls. Extending outward (not just shrinking) needed a render-time preview at a frozen px/bar plus edge auto-scroll, since the timeline is normally fit-to-width — the gap Phase 19 explicitly deferred.',
    core: 'na', cli: 'na', gui: 'done', status: 'done',
    research: null, plan: 'phase-22-stream-ag.md',
  },
  {
    area: 'Arrangement / song structure', feature: 'Independent per-section scene editing',
    description: 'Today, appended sections share the source scene; editing one edits them all. Give each section its own scene.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: null, plan: null,
  },
  {
    area: 'Arrangement / song structure', feature: 'Clip-level loop/length/time-signature properties',
    description: 'Ableton’s Start/End/Loop/Position/Length/Signature clip panel. v0.10 format addition (BeatClipLoop/BeatTimeSignature — a clip-local bar-range override + metadata-only time signature; the engine is still constant-tempo 4/4), a small properties strip in the Clip View, and free CLI/MCP access via the existing generic beat set / beat_set path.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/18-ableton-ui-architecture.md', plan: 'phase-22-stream-ag.md',
  },
  {
    area: 'Arrangement / song structure', feature: 'Overlapping-region resolution policy (clip / push / keep-existing)',
    description: 'A user-configurable preference for what happens when two regions/sections overlap, push direction always downward, never cascading. "keep-existing" ("don\'t disturb my arrangement") is a real, non-obvious default worth having once dotbeat\'s section model needs overlap semantics. Reimplemented for dotbeat\'s 1D section-list timeline (no independently-positioned regions): only growing a non-last section can conflict with anything. A GUI/session preference (like openDAW\'s own Preferences->Editing setting), not project content, so it is not a .beat format field. The CLI\'s `beat song` is whole-list replace and has no equivalent single-section-resize verb, so there is no CLI collision scenario to wire.',
    core: 'done', cli: 'na', gui: 'done', status: 'done',
    research: 'research/22-opendaw-editing-workflow.md', plan: 'phase-22-stream-ag.md',
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
  {
    area: 'Synth sound design', feature: 'Per-instrument polyphony limit + glide mode',
    description: 'Mono/legato/portamento voice-count and glide-time fields per instrument — a concrete, bounded addition to the existing synth field set, not a new instrument.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/24-opendaw-roadmap-positioning.md', plan: null,
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
  {
    area: 'Instrument / SoundFont tracks', feature: 'One-shot sampler instrument track kind',
    description: 'A lean sampler instrument (volume, sample, release, pitch-tracking — 3-4 literal fields) as a track kind distinct from the implicit "every track is a synth" assumption.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/21-opendaw-devices-effects.md', plan: null,
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
  {
    area: 'Core effects', feature: 'Ordered, reorderable per-track effect chain',
    description: 'Replaced the fixed EQ→comp→dist→bitcrush insert order with an explicit ordered list of effect lines (format v0.10) — flat literal text (order = line order, stable per-instance ids), never a pointer/index indirection like openDAW\'s box graph uses. Add/remove/reorder/bypass a built-in insert per track; bypass is a real routing bypass, not a mix-knob illusion. Two independently-parameterized instances of the SAME type remain out of scope (documented) — new effect TYPES (Ping Pong Delay/Beat Repeat/Chorus/Saturator) are a separate stream to reconcile at merge time.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/21-opendaw-devices-effects.md', plan: 'phase-22-stream-aa.md',
  },

  // ── Extended FX arsenal ──────────────────────────────────────────────────
  {
    area: 'Extended FX arsenal', feature: 'Ping Pong Delay',
    description: 'A hand-built two-delay-line network (not the plain Tone.PingPongDelay built-in, which hardwires 100% cross-feedback with no dial) as a per-track insert — pingPongTime/Feedback/Mix plus continuously-variable pingPongCrossFeed and delay-time LFO wobble (pingPongWobbleRate/Depth, research 21 row 4) rather than a binary ping-pong toggle.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/17-track-fx-arsenal.md', plan: 'phase-22-stream-ac.md',
  },
  {
    area: 'Extended FX arsenal', feature: 'Beat Repeat',
    description: 'Grid/gate/chance/mode stutter-repeat — scheduling-layer note/hit re-triggering in engine.ts\'s tick() (not a Tone.js audio node, per research 17 §4.3), with a per-note-position-seeded RNG for the chance roll (research 21 row 5) so re-renders are bit-for-bit reproducible.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/17-track-fx-arsenal.md', plan: 'phase-22-stream-ac.md',
  },
  {
    area: 'Extended FX arsenal', feature: 'Expose Chorus-Ensemble / Phaser-Flanger as a per-track insert',
    description: 'Retired the old shared, un-configurable chorusBus/phaserBus/sendMod mod-send machinery; chorusMode (off/chorus/ensemble/vibrato)/chorusRate/Depth/Mix and phaserRate/Depth/Mix are now real per-track inserts, same one-instance-per-track precedent as EQ3/compressor.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/17-track-fx-arsenal.md', plan: 'phase-22-stream-ac.md',
  },
  {
    area: 'Extended FX arsenal', feature: 'Saturator',
    description: 'Tone.WaveShaper-based character saturation with an analog/warm/clip/fold curve family (authored once per curve CHANGE, not per sample) and a drive-controlled pre-gain into the shaper.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/17-track-fx-arsenal.md', plan: 'phase-22-stream-ac.md',
  },
  {
    area: 'Extended FX arsenal', feature: '7-band parametric EQ',
    description: 'HP/LP with selectable slope + Q, 3 bell bands, 2 shelf bands, each independently enabled — same field-set-device shape as EQ3/compressor, just more bands. EQ3 can\'t do a real parametric bell cut; natural next tier after the research-17 build-next-four.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/21-opendaw-devices-effects.md', plan: null,
  },
  {
    area: 'Extended FX arsenal', feature: 'Auto Filter / Auto Pan / Tremolo',
    description: 'Dedicated Ableton-named devices — deferred since the shared LFO destination matrix already covers the sonic capability.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/17-track-fx-arsenal.md', plan: null,
  },
  {
    area: 'Extended FX arsenal', feature: 'Redux (downsampling half)',
    description: 'Bit-reduction already ships; sample-rate downsampling needs a small custom node (no Tone.js built-in). Consider folding bits+downsample into one "Crusher"-style field group with a shared enable/mix, per research 21, rather than two independently-toggled devices.',
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
  {
    area: 'Versioning / history', feature: 'Musical-language git-merge conflict narration',
    description: 'A `beat merge --explain` that narrates a merge conflict in the same phrasing D8 already uses for diffs ("both changed trk_bass.cutoff: 1200Hz vs 800Hz") instead of raw <<<<<<< markers. Reuses D8\'s DiffEntry machinery unchanged.',
    core: 'missing', cli: 'missing', gui: 'na', status: 'not-started',
    research: 'research/23-opendaw-collaboration-storage.md', plan: null,
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
  {
    area: 'Metrics / critique loop', feature: 'GUI spectrum / level visualization',
    description: 'A real-time FFT/level display reusing the exact spectral data `beat metrics` already computes server-side — a visualization of existing data, not a new judgment surface, so it doesn\'t reopen D2\'s "LLM narrates, never judges alone" decision.',
    core: 'na', cli: 'na', gui: 'missing', status: 'not-started',
    research: 'research/24-opendaw-roadmap-positioning.md', plan: null,
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
    description: 'A collapsible left-sidebar browser (ContentBrowser.tsx) over the real presets/factory.json + presets/kit-*/ + presets/sf2/*.sf2, grouped by Phase 18 Stream S\'s taxonomy. Drag a preset onto a track (core\'s applyPreset — a literal edit list) or a kit sample onto a drum lane (registers into the project\'s own media/ + setLaneSample); a soundfont can also be dropped onto an instrument track or added as a brand-new one.',
    core: 'na', cli: 'na', gui: 'done', status: 'done',
    research: 'research/18-ableton-ui-architecture.md', plan: 'phase-22-stream-ah.md',
  },
  {
    area: 'Preset / content library', feature: 'Hot-swap preset browser in Device View',
    description: 'A preset picker/prev-next control living INSIDE SynthPanel/InstrumentPanel itself (Device View), distinct from the sidebar: swap a track\'s preset without leaving the panel. The sidebar (drag a preset onto a track header from outside Device View) does not cover this — SynthPanel.tsx/InstrumentPanel.tsx are untouched.',
    core: 'na', cli: 'done', gui: 'missing', status: 'not-started',
    research: 'research/18-ableton-ui-architecture.md', plan: null,
  },
  {
    area: 'Preset / content library', feature: 'Preview-before-load',
    description: 'Audition a preset/sample/soundfont before applying it — an ephemeral engine voice or a raw fetch-decode-play, real audio through the master bus, with zero writes to the .beat file (engine.previewSynthPreset/previewDrumPreset/previewBuffer/previewSoundfont).',
    core: 'na', cli: 'na', gui: 'done', status: 'done',
    research: 'research/18-ableton-ui-architecture.md', plan: 'phase-22-stream-ah.md',
  },

  // ── Macros ───────────────────────────────────────────────────────────────
  {
    area: 'Macros', feature: 'Macro tooling layer',
    description: 'A curated "front panel" of knobs mapped to real params, living outside the file (like presets) — turning a macro writes literal edits, never an in-file indirection. Phase 23 research stream RC scoped the concrete data shape (BeatMacro/MacroTarget), storage (presets/macros.json via the existing /library route), and GUI placement (a Macros row in SynthPanel.tsx) — see research/27.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/27-macro-tooling-layer.md', plan: null,
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
    description: 'Create a brand new project without dropping to the CLI first: a "new project…" toolbar action (next to "open folder…") prompts for a destination and POSTs the daemon\'s new POST /new-project route, which wraps the same initDocument() `beat init` uses. Works from ANY running daemon, not just the Tauri folder-repoint flow — verifiable live in a plain browser.',
    core: 'na', cli: 'done', gui: 'done', status: 'done',
    research: null, plan: 'phase-22-stream-af.md',
  },
  {
    area: 'Project / folder management', feature: 'Save project as template',
    description: '"Save as Template" opens as a fresh unsaved copy, never mutating the original — a natural fit for dotbeat\'s git-native model as "copy this file/folder as a new project," arguably cleaner than a browser-storage version. POST /save-as-template copies the CURRENT on-disk project bytes to a new path; starting a new project from a saved template reuses POST /new-project with a `from` template path (a byte copy, read-only against the template). No new core/CLI surface needed — a .beat file is a plain text file, so "save as template" is already just `cp project.beat template.beat` from a shell or agent; the GUI route exists for discoverability, not because the CLI/agent couldn\'t already do this.',
    core: 'na', cli: 'na', gui: 'done', status: 'done',
    research: 'research/24-opendaw-roadmap-positioning.md', plan: 'phase-22-stream-af.md',
  },
  {
    area: 'Project / folder management', feature: 'Optional cloud-folder sync (BYO storage)',
    description: 'Sync a project folder to a drive the user already has (Nextcloud/Dropbox/GDrive via one storage-agnostic interface) for multi-machine convenience — explicitly not live collaboration; git still owns history/versioning. Not scoped or requested yet, noted as the right shape if/when it is.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/23-opendaw-collaboration-storage.md', plan: null,
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
    description: 'Media reference + in-point + out-point + gain + a warp enum + optional markers (v0.10). Clip-only (no live/non-clip audio content this stream); one clip = one region, all six fields on one bundled `audio` line (note/hit discipline, no elision).',
    core: 'done', cli: 'done', gui: 'partial', status: 'progress',
    research: 'research/16-audio-clip-editing.md', plan: 'phase-22-stream-ae.md',
  },
  {
    area: 'Audio-region clip editing', feature: 'Repitch-mode warping',
    description: 'A playbackRate-equivalent `rate` field, wired into ui/src/audio/engine.ts via Tone.Player.playbackRate; canonically forced to 1 when warp isn\'t \'repitch\'. Verified live: rendered spectral centroid shifts ~2x for a 1.5x rate (measured off real captured audio, not the stored param). The warp/rate controls themselves are full GUI fields (not the clip-block visual, which is the format row\'s documented gap).',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/16-audio-clip-editing.md', plan: 'phase-22-stream-ae.md',
  },
  {
    area: 'Audio-region clip editing', feature: 'Split-at-point',
    description: 'splitAudioClip: a pure edit primitive, no DSP — converts a timeline step position to source-media seconds (accounting for repitch rate), trims the first clip\'s out, mints a second clip with adjusted in, partitions gain-automation points by time. CLI `beat audio-split` / MCP beat_audio_split / a GUI split-at-playhead button (POST /audio-split).',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/16-audio-clip-editing.md', plan: 'phase-22-stream-ae.md',
  },
  {
    area: 'Audio-region clip editing', feature: 'Clip gain (static + automation lane)',
    description: 'Static gainDb field (default 0) plus a \'gain\' automation lane reusing the v0.9 BeatAutomationLane/BeatAutomationPoint machinery UNCHANGED (confirmed research 16 §3\'s prediction) — only a new AUDIO_AUTOMATABLE_PARAMS=[\'gain\'] set and a track-kind branch in checkAutomatableParam. Verified live: both static gain and a gain ramp measurably change rendered level.',
    core: 'done', cli: 'done', gui: 'done', status: 'done',
    research: 'research/16-audio-clip-editing.md', plan: 'phase-22-stream-ae.md',
  },
  {
    area: 'Audio-region clip editing', feature: 'Region-level fade in/out handles',
    description: 'Two draggable, region-relative 0..1 handles at region edges (linear, crossing = min of both, snap-to-grid) — a small format addition (two normalized fields per region), well-specified prior art.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/24-opendaw-roadmap-positioning.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Tape-emulation knobs on audio-clip tracks',
    description: 'Four unipolar "tape character" fields (flutter/wow/noise/saturation) baked into the region player itself, not a separate effect — cheap, on-brand with SYNTH_FIELDS\' small evocative knobs, could share saturation-curve code with the Saturator FX.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/21-opendaw-devices-effects.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Warp markers + Complex-mode stretch',
    description: 'Marker-list format addition plus a real stretch-algorithm integration via signalsmith-stretch (MIT/WASM). Consider the 3-way TransientPlayMode vocabulary (Once/Repeat/Pingpong — research 22) for "what happens to a hit between two markers," smaller than Ableton\'s 5-way named-warp-mode system. Phase 23 research stream RA scoped the concrete grammar (`marker <id> <sourceTime> <timelineTime>`), WASM binding (official signalsmith-stretch npm package), and offline-pre-stretch engine architecture — see research/25.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/25-audio-warp-markers-stretch.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Beats-mode transient slicing',
    description: 'Onset/transient detection plus the stretch library; sequence after the rest of the audio-clip format proves out. Phase 23 research stream RB recommends a dependency-free pure-TypeScript energy-based detector populating the same BeatAudioRegion.markers grammar RA scoped, with an MVP tier (markers + waveform overlay + split-at-transient) shippable independent of the stretch engine — see research/26.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/26-beats-mode-transient-slicing.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Bounce / freeze a MIDI clip to audio',
    description: 'Render a MIDI clip, with its full effect chain, to a new audio clip in place — directly composable with the existing render engine once the audio-region clip format exists; sequence right after that lands.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/24-opendaw-roadmap-positioning.md', plan: null,
  },
  {
    area: 'Audio-region clip editing', feature: 'Reverse audio clip',
    description: 'An in-place reverse toggle on an audio region — trivial once regions exist, same dependency as bounce/freeze.',
    core: 'missing', cli: 'missing', gui: 'missing', status: 'not-started',
    research: 'research/24-opendaw-roadmap-positioning.md', plan: null,
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

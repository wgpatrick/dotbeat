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

## Snapshot — 82 features tracked

**52** Done · **1** In progress · **29** Not started

---

## File format & core engine

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Diff-friendly canonical text format (.beat v0.9) | The .beat grammar itself: stable IDs, canonical field order, byte-identical round-trip. | ✅ done | ✅ done | — | ✅ Done | [`04-format-prior-art.md`](research/04-format-prior-art.md) | [`format-spec.md`](format-spec.md) |
| git-lfs media/binary handling | Presets and sample media stored via git-lfs so the text file stays diff-clean (decisions.md D11). | ✅ done | ✅ done | — | ✅ Done | — | [`decisions.md`](decisions.md) |
| Reference-counted git-lfs asset GC | A `beat lfs gc`-style command tracking which LFS objects are still referenced by any project on the machine, so orphaned sample/preset media can be safely deleted. git-lfs dedupes by content hash within a repo but has no native answer to "is this still used anywhere." | ❌ missing | ❌ missing | — | ⬜ Not started | [`23-opendaw-collaboration-storage.md`](research/23-opendaw-collaboration-storage.md) | — |
| git-lfs file locking for binary media | Adopt git-lfs's existing `git lfs lock` (unused today) as a soft mutex with an honest override warning — the one part of a .beat project git genuinely can't diff/merge. | ❌ missing | ❌ missing | — | ⬜ Not started | [`23-opendaw-collaboration-storage.md`](research/23-opendaw-collaboration-storage.md) | — |

## Track management

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Add / delete tracks | Create a new synth/drums/instrument track or remove one, from the GUI or CLI. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-20-track-project-management.md`](phase-20-track-project-management.md) |
| Rename / recolor tracks | Inline double-click rename and a color picker on each track header. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-20-track-project-management.md`](phase-20-track-project-management.md) |
| Group tracks | Fold N tracks into one collapsible group header. A group is a flat, named, colored membership list (`group <id> <name> <color> <track-id>...`, v0.10) — a track belongs to at most one group, no nesting. Collapsed/expanded is deliberately UI-only session state (like mute/solo), never written to the file. | ✅ done | ✅ done | ✅ done | ✅ Done | [`18-ableton-ui-architecture.md`](research/18-ableton-ui-architecture.md) | [`phase-22-stream-af.md`](phase-22-stream-af.md) |

## Note editing (piano roll)

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Core note editing: add/move/resize/multi-select/marquee | Free-timed notes, keyboard strip + octave gridlines, pitch-aligned within 1px. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-19-piano-roll-keys.md`](phase-19-piano-roll-keys.md) |
| Fold mode | Collapse the piano roll to only the pitches actually in use, like Ableton’s Fold. | — | — | ❌ missing | ⬜ Not started | — | — |
| Scale-lock field + scale-tone highlighting | A per-clip/track scale + root note that constrains input and highlights in-scale keys. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`18-ableton-ui-architecture.md`](research/18-ableton-ui-architecture.md) | — |
| Pitch & Time operations (transpose, ×2/÷2, fit-to-scale, invert, humanize, reverse, legato) | One-shot edit primitives (src/core/pitchtime.ts) that rewrite note lines and produce a normal diff — same pattern as quantize. beat_humanize already covered the Humanize row (tracked separately under "Vary / audition loop" — its own GUI affordance is Stream BB's territory). Phase 22 Stream AD added transpose/time-scale/fit-scale/invert/reverse/legato as CLI verbs + MCP tools; Phase 23 Stream BA added a Pitch & Time panel in NoteView.tsx (always visible for a note track, scoped to the current note selection or the whole track) that calls the six ops plus Consolidate through a new daemon route (POST /pitch-time — AD shipped CLI/MCP-only "no daemon route needed," but each op's own batch parameter shape needed one after all, same as /song and /audio-split). Verified live: ui/verify-phase23-stream-ba.mjs drives real clicks and checks the resulting .beat diff for each of the seven ops. | ✅ done | ✅ done | ✅ done | ✅ Done | [`18-ableton-ui-architecture.md`](research/18-ableton-ui-architecture.md) | [`phase-23-stream-ba.md`](phase-23-stream-ba.md) |
| Groove / shuffle as a reversible time-warp | Two literal track-level fields (shuffleAmount, shuffleGrid — src/core/document.ts) applied at read/playback time via warpStep()/unwarpStep() (src/core/groove.ts, a Möbius-ease curve; exact-inverse round-trip unit-tested), never baked into stored note/hit start; ui/src/audio/engine.ts hand-mirrors the same math and applies it in the synth/instrument note-scheduling loop (drum-hit scheduling remains a follow-on, unchanged this stream). Phase 23 Stream BA added a Shuffle/Grid knob pair to each mixer channel strip (MixerView.tsx), writing shuffleAmount/shuffleGrid through the existing `<track>.shuffleAmount`/`<track>.shuffleGrid` postEdit grammar — no new CLI verb or daemon route needed, same as AD left it. Verified live (a real knob drag produces the exact `groove <amount> <grid>` line on disk). | ✅ done | ✅ done | ✅ done | ✅ Done | [`22-opendaw-editing-workflow.md`](research/22-opendaw-editing-workflow.md) | [`phase-23-stream-ba.md`](phase-23-stream-ba.md) |
| Per-note probability (chance) | A 0-100 int field (default 100 = today's always-fires behavior), re-rolled via a seeded RNG (src/core/chance.ts's chanceFires — mulberry32 + FNV-1a seed fold) once per playback pass in the scheduler, verified directly against the seeded sequence (statistical unit tests) rather than by rendering audio repeatedly. GUI: the Phase 22 per-note inspector panel remains for typing an exact value; Phase 23 Stream BA added the missing at-a-glance layer — a chance<100 note draws dimmed + dashed in the piano roll — plus a new chance lane below the velocity lane supporting a genuine draw-ACROSS-notes paint gesture (research 22 §1.4's PropertyDrawModifier reference): one continuous drag paints every note the pointer sweeps over to the same probability, not just the note first pressed. Verified live. | ✅ done | ✅ done | ✅ done | ✅ Done | [`22-opendaw-editing-workflow.md`](research/22-opendaw-editing-workflow.md) | [`phase-23-stream-ba.md`](phase-23-stream-ba.md) |
| Note ratchet / repeat (play-count + curve) | The richer 3-field shape (ratchetCount + ratchetCurve + ratchetLength) research 22 recommends over openDAW's own 2-field version (their team is mid-refactor away from it). src/core/pitchtime.ts's ratchetSlots is the one spacing function both live playback (engine.ts, hand-mirrored) and `beat consolidate`/`beat_consolidate` (bakes a ratchet back into exact discrete notes) agree on. GUI: the Phase 22 per-note inspector panel remains for typing exact values; Phase 23 Stream BA added a visual tick-mark glyph on a ratcheted note itself (one mark per internal repeat boundary, using the same curve-warped spacing ratchetSlots computes) and wired Consolidate into the new Pitch & Time panel as a real button. Verified live: setting ratchetCount=4 shows exactly 3 ticks, and Consolidate produces exactly 4 discrete notes at the exact expected positions. | ✅ done | ✅ done | ✅ done | ✅ Done | [`22-opendaw-editing-workflow.md`](research/22-opendaw-editing-workflow.md) | [`phase-23-stream-ba.md`](phase-23-stream-ba.md) |
| Per-note micro-tuning (cent offset) | A ±50-cent float field independent of semitone pitch, applied as a frequency offset at playback for synth-track notes (ui/src/audio/engine.ts); NOT yet wired for instrument/SoundFont-track notes (WorkletSynthesizer's pitch-bend is channel-wide, a bigger lift than this pass's scope — see phase-22-stream-ad.md's Result section). GUI: editable via the per-note inspector panel. | 🔶 partial | ✅ done | ✅ done | 🚧 In progress | [`22-opendaw-editing-workflow.md`](research/22-opendaw-editing-workflow.md) | [`phase-22-stream-ad.md`](phase-22-stream-ad.md) |

## Drum programming

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Open per-track lane model + 12-lane GM-aligned default kit | v0.10: an open, declared, ordered lane list per drum track (synth:<voice>/sample/sf backings), layered additively alongside the legacy closed-5-lane mechanism so every pre-v0.10 file parses and re-serializes byte-identically. kit-808/kit-909 (synth) + kit-acoustic (SoundFont, MuldjordKit) ship in presets/drum-kits.json; `beat add-track --kind drums` defaults to the 12-lane kit going forward. Phase 23 Stream BB closed the GUI gap: a Lanes panel in the drum Clip View (NoteView.tsx) materializes a legacy 5-lane kit into the open model, then adds/reorders/retypes lanes and edits per-lane synth/sample/sf backing params (new core primitives addLane/removeLane/moveLane/setLaneBacking/setLaneParam, POST /lane). | ✅ done | ✅ done | ✅ done | ✅ Done | [`19-drum-voice-expansion.md`](research/19-drum-voice-expansion.md) | [`phase-23-stream-bb.md`](phase-23-stream-bb.md) |
| Optional per-hit duration field | One optional trailing duration token on hit lines, elided when absent (byte-identical for every pre-existing file); the lane's backing decides release (synth/SF) vs. truncation (sample) semantics. `beat add-hit`/`beat set <track>.hit.<id>.duration` and the GUI's drag-to-resize both write it. | ✅ done | ✅ done | ✅ done | ✅ Done | [`20-drum-clip-editor-redesign.md`](research/20-drum-clip-editor-redesign.md) | [`phase-22-stream-ab.md`](phase-22-stream-ab.md) |
| Unified drum clip editor | NoteView generalized behind a row-axis adapter (rowCount/rowLabel/rowOfValue/valueOfRow) — melodic tracks keep the unchanged pitch adapter, drum tracks get a named-lane adapter over the kit's declared lanes. A durationless hit renders as a marker; dragging its edge creates a duration (marker -> bar). Soft grid-snap by default, Alt/Cmd freehand bypass. StepSequencer.tsx retired (deleted, no second permanent editor). | — | — | ✅ done | ✅ Done | [`20-drum-clip-editor-redesign.md`](research/20-drum-clip-editor-redesign.md) | [`phase-22-stream-ab.md`](phase-22-stream-ab.md) |
| Choke-group handling (hat pair) | A closed-hat hit silences a ringing open hat (declared-lane kits only, keyed by canonical lane name) — release for synth/SF voices, stop for sample players. | — | — | ✅ done | ✅ Done | [`19-drum-voice-expansion.md`](research/19-drum-voice-expansion.md) | [`phase-22-stream-ab.md`](phase-22-stream-ab.md) |

## Arrangement / song structure

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Section CRUD + loop→song conversion | Append/resize/delete song sections; a loop-mode project can grow into a full multi-section song. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-19-arrangement-length.md`](phase-19-arrangement-length.md) |
| Drag the rightmost loop boundary directly | Resize the loop by dragging its edge on the timeline instead of using +/- controls. Extending outward (not just shrinking) needed a render-time preview at a frozen px/bar plus edge auto-scroll, since the timeline is normally fit-to-width — the gap Phase 19 explicitly deferred. | — | — | ✅ done | ✅ Done | — | [`phase-22-stream-ag.md`](phase-22-stream-ag.md) |
| Independent per-section scene editing | Today, appended sections share the source scene; editing one edits them all. Give each section its own scene. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | — | — |
| Clip-level loop/length/time-signature properties | Ableton’s Start/End/Loop/Position/Length/Signature clip panel. v0.10 format addition (BeatClipLoop/BeatTimeSignature — a clip-local bar-range override + metadata-only time signature; the engine is still constant-tempo 4/4), a small properties strip in the Clip View, and free CLI/MCP access via the existing generic beat set / beat_set path. | ✅ done | ✅ done | ✅ done | ✅ Done | [`18-ableton-ui-architecture.md`](research/18-ableton-ui-architecture.md) | [`phase-22-stream-ag.md`](phase-22-stream-ag.md) |
| Overlapping-region resolution policy (clip / push / keep-existing) | A user-configurable preference for what happens when two regions/sections overlap, push direction always downward, never cascading. "keep-existing" ("don't disturb my arrangement") is a real, non-obvious default worth having once dotbeat's section model needs overlap semantics. Reimplemented for dotbeat's 1D section-list timeline (no independently-positioned regions): only growing a non-last section can conflict with anything. A GUI/session preference (like openDAW's own Preferences->Editing setting), not project content, so it is not a .beat format field. The CLI's `beat song` is whole-list replace and has no equivalent single-section-resize verb, so there is no CLI collision scenario to wire. | ✅ done | — | ✅ done | ✅ Done | [`22-opendaw-editing-workflow.md`](research/22-opendaw-editing-workflow.md) | [`phase-22-stream-ag.md`](phase-22-stream-ag.md) |

## Synth sound design

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Full grouped synth param panel | ~54-field SYNTH_FIELDS across osc/filter/envelope/inserts/sends, exposed in one grouped GUI panel. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-13-editing.md`](phase-13-editing.md) |
| Real wavetable oscillator | wtPos exists in the format and an LFO can target it, but no wavetable oscillator exists in the engine — currently a dead knob. | ❌ missing | — | ❌ missing | ⬜ Not started | — | — |
| Per-instrument polyphony limit + glide mode | Mono/legato/portamento voice-count and glide-time fields per instrument — a concrete, bounded addition to the existing synth field set, not a new instrument. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`24-opendaw-roadmap-positioning.md`](research/24-opendaw-roadmap-positioning.md) | — |

## LFOs / modulation

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| 16-destination tempo-synced LFOs | Two LFOs per track, 16 possible destinations, real tempo sync — deliberately literal/enumerated, not a free-routing matrix. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-18-lfo-depth.md`](phase-18-lfo-depth.md) |

## Instrument / SoundFont tracks

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Playback, program select, meters, mute/solo | SoundFont-backed instrument tracks with program selection and real audio-gated mute/solo. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-14-instrument-tracks.md`](phase-14-instrument-tracks.md) |
| Instrument-track FX chain | EQ/compression/sends per instrument track — today it’s level/pan only. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | — | — |
| One-shot sampler instrument track kind | A lean sampler instrument (volume, sample, release, pitch-tracking — 3-4 literal fields) as a track kind distinct from the implicit "every track is a synth" assumption. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`21-opendaw-devices-effects.md`](research/21-opendaw-devices-effects.md) | — |

## Mixer

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Inline strip + full-screen overlay | Per-track header mixer strip plus an on-demand all-strips overlay; real audio-gated mute/solo. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-16-instrument-mixer.md`](phase-16-instrument-mixer.md) |
| Persisted mute/solo representation | Decided, deliberately, to stay transient (ui/src/state/store.ts) — NOT a gap. Real DAWs (Ableton, Logic) treat mute/solo as session/monitoring state, not composition data; dotbeat already applies the identical rule to BeatGroup.collapsed (src/core/document.ts) for the same reason; and the .beat format's premise is a diff that means something musically (decisions.md) — soloing a track while arranging shouldn't leave a line in every commit. Nothing added to BeatTrack; the decision (and its reasoning) lives as a doc comment on store.ts's mutes/solos fields. | — | — | ✅ done | ✅ Done | [`18-ableton-ui-architecture.md`](research/18-ableton-ui-architecture.md) | [`phase-23-stream-bb.md`](phase-23-stream-bb.md) |

## Core effects

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| EQ3 / comp / distortion / bitcrush / reverb+delay sends / sidechain | The built-in insert set every synth and drum bus already carries. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-13-editing.md`](phase-13-editing.md) |
| Ordered, reorderable per-track effect chain | Replaced the fixed EQ→comp→dist→bitcrush insert order with an explicit ordered list of effect lines (format v0.10) — flat literal text (order = line order, stable per-instance ids), never a pointer/index indirection like openDAW's box graph uses. Add/remove/reorder/bypass a built-in insert per track; bypass is a real routing bypass, not a mix-knob illusion. Two independently-parameterized instances of the SAME type remain out of scope (documented) — new effect TYPES (Ping Pong Delay/Beat Repeat/Chorus/Saturator) are a separate stream to reconcile at merge time. | ✅ done | ✅ done | ✅ done | ✅ Done | [`21-opendaw-devices-effects.md`](research/21-opendaw-devices-effects.md) | [`phase-22-stream-aa.md`](phase-22-stream-aa.md) |

## Extended FX arsenal

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Ping Pong Delay | A hand-built two-delay-line network (not the plain Tone.PingPongDelay built-in, which hardwires 100% cross-feedback with no dial) as a per-track insert — pingPongTime/Feedback/Mix plus continuously-variable pingPongCrossFeed and delay-time LFO wobble (pingPongWobbleRate/Depth, research 21 row 4) rather than a binary ping-pong toggle. | ✅ done | ✅ done | ✅ done | ✅ Done | [`17-track-fx-arsenal.md`](research/17-track-fx-arsenal.md) | [`phase-22-stream-ac.md`](phase-22-stream-ac.md) |
| Beat Repeat | Grid/gate/chance/mode stutter-repeat — scheduling-layer note/hit re-triggering in engine.ts's tick() (not a Tone.js audio node, per research 17 §4.3), with a per-note-position-seeded RNG for the chance roll (research 21 row 5) so re-renders are bit-for-bit reproducible. | ✅ done | ✅ done | ✅ done | ✅ Done | [`17-track-fx-arsenal.md`](research/17-track-fx-arsenal.md) | [`phase-22-stream-ac.md`](phase-22-stream-ac.md) |
| Expose Chorus-Ensemble / Phaser-Flanger as a per-track insert | Retired the old shared, un-configurable chorusBus/phaserBus/sendMod mod-send machinery; chorusMode (off/chorus/ensemble/vibrato)/chorusRate/Depth/Mix and phaserRate/Depth/Mix are now real per-track inserts, same one-instance-per-track precedent as EQ3/compressor. | ✅ done | ✅ done | ✅ done | ✅ Done | [`17-track-fx-arsenal.md`](research/17-track-fx-arsenal.md) | [`phase-22-stream-ac.md`](phase-22-stream-ac.md) |
| Saturator | Tone.WaveShaper-based character saturation with an analog/warm/clip/fold curve family (authored once per curve CHANGE, not per sample) and a drive-controlled pre-gain into the shaper. | ✅ done | ✅ done | ✅ done | ✅ Done | [`17-track-fx-arsenal.md`](research/17-track-fx-arsenal.md) | [`phase-22-stream-ac.md`](phase-22-stream-ac.md) |
| 7-band parametric EQ | HP/LP with selectable slope + Q, 3 bell bands, 2 shelf bands, each independently enabled — same field-set-device shape as EQ3/compressor, just more bands. EQ3 can't do a real parametric bell cut; natural next tier after the research-17 build-next-four. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`21-opendaw-devices-effects.md`](research/21-opendaw-devices-effects.md) | — |
| Auto Filter / Auto Pan / Tremolo | Dedicated Ableton-named devices — thin wrappers around Tone.AutoFilter/AutoPanner/Tremolo, ADDITIVE entries in the same reorderable effect chain (autoFilter/autoPan/tremolo EffectType members), each with its own Rate/Depth/Mix (Tremolo also Spread). The shared LFO destination matrix already covers the sonic capability; the value here is Ableton-authentic naming and a third, independent modulation source, not new sound. | ✅ done | ✅ done | ✅ done | ✅ Done | [`17-track-fx-arsenal.md`](research/17-track-fx-arsenal.md) | [`phase-23-stream-be.md`](phase-23-stream-be.md) |
| Redux (downsampling half) | A new bitcrushRate field on the EXISTING bitcrush type (not a new EffectType) — Ableton's own Redux is one device, two dimensions, and bit-reduction already owned bitcrush's bit-depth half. A hand-built sample-and-hold decimator (raw ScriptProcessorNode; Tone.js has no built-in Rate/Jitter node), gated by the SAME bitcrushMix as bit-depth reduction — one shared dry/wet knob for the whole device. | ✅ done | ✅ done | ✅ done | ✅ Done | [`17-track-fx-arsenal.md`](research/17-track-fx-arsenal.md) | [`phase-23-stream-be.md`](phase-23-stream-be.md) |
| Utility (stereo width / gain trim) | Near-free via Tone.StereoWidener (utilityWidth, 0=mono/1=max stereo/0.5=neutral default) plus a static utilityGain dB trim — a mixing-hygiene tool, not a sound-design reach. No Mix field (like eq3, the chain's per-instance bypass is its only "off"). | ✅ done | ✅ done | ✅ done | ✅ Done | [`17-track-fx-arsenal.md`](research/17-track-fx-arsenal.md) | [`phase-23-stream-be.md`](phase-23-stream-be.md) |
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
| Musical-language git-merge conflict narration | A `beat merge --explain` that narrates a merge conflict in the same phrasing D8 already uses for diffs ("both changed trk_bass.cutoff: 1200Hz vs 800Hz") instead of raw <<<<<<< markers. Reuses D8's DiffEntry machinery unchanged. | ❌ missing | ❌ missing | — | ⬜ Not started | [`23-opendaw-collaboration-storage.md`](research/23-opendaw-collaboration-storage.md) | — |

## Vary / audition loop

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Rungs 1–3: vary / score / suggest | Generate parameter variants, audition live, keep or undo; a cold-start recommender picks the next group to try. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-15-vary-affordance.md`](phase-15-vary-affordance.md) |
| Rung-2 "feel" content variation, wired into the GUI | A second "≈ vary feel" trigger next to the existing rung-1 affordance (VaryAffordance.tsx), same audition/Keep/Undo shape. Each variant is a full document (humanize rewrites many note/hit fields, not a small edit list) generated by POST /vary-feel (read-only, selection-scoped, reuses varyTrack's enforced-scope guarantee) and previewed live via setDoc; Keep resends the variant's reproducible seed to POST /vary-feel/commit, which regenerates the identical content deterministically and writes it. Scoring (`beat score`/`beat suggest`) still isn't wired to either rung's GUI Keep — an honest gap carried forward from phase-15-vary-affordance.md, not closed here. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-23-stream-bb.md`](phase-23-stream-bb.md) |

## Render / export

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| GUI Export button | Reuses the live engine’s own capture path; verified against the CLI reference render. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-20-render-export.md`](phase-20-render-export.md) |

## Metrics / critique loop

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| LUFS / spectral / crest / stereo metrics + lint | Agent-facing per decisions.md D2 ("LLM narrates, never judges alone") — no GUI meter display planned, not a gap. | ✅ done | ✅ done | — | ✅ Done | — | [`decisions.md`](decisions.md) |
| GUI spectrum / level visualization | A real-time FFT/level display reusing the exact spectral data `beat metrics` already computes server-side — a visualization of existing data, not a new judgment surface, so it doesn't reopen D2's "LLM narrates, never judges alone" decision. | — | — | ❌ missing | ⬜ Not started | [`24-opendaw-roadmap-positioning.md`](research/24-opendaw-roadmap-positioning.md) | — |

## Selection protocol

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| daemon /selection + --scope selection | A shared selection axis grammar wired into both the arrangement and note views and the CLI. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-13-editing.md`](phase-13-editing.md) |

## Preset / content library

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| 36 presets + content taxonomy | Presets are tooling (never in-file indirection); categorized following Ableton’s browsable-kind logic. | ✅ done | ✅ done | — | ✅ Done | [`18-ableton-ui-architecture.md`](research/18-ableton-ui-architecture.md) | [`phase-18-content-taxonomy.md`](phase-18-content-taxonomy.md) |
| Content browser sidebar | A collapsible left-sidebar browser (ContentBrowser.tsx) over the real presets/factory.json + presets/kit-*/ + presets/sf2/*.sf2, grouped by Phase 18 Stream S's taxonomy. Drag a preset onto a track (core's applyPreset — a literal edit list) or a kit sample onto a drum lane (registers into the project's own media/ + setLaneSample); a soundfont can also be dropped onto an instrument track or added as a brand-new one. | — | — | ✅ done | ✅ Done | [`18-ableton-ui-architecture.md`](research/18-ableton-ui-architecture.md) | [`phase-22-stream-ah.md`](phase-22-stream-ah.md) |
| Hot-swap preset browser in Device View | A preset picker (select + prev/next) inside SynthPanel itself for synth/drum tracks, and a soundfont picker inside InstrumentPanel for instrument tracks — swap without leaving Device View. Both reuse the exact daemon mechanisms the Phase 22 sidebar already established (applyPresetToTrack/installSoundfont — GET /library, POST /library/apply-preset, POST /library/install-soundfont), so this stream added no new daemon surface, only the in-panel pickers. | — | ✅ done | ✅ done | ✅ Done | [`18-ableton-ui-architecture.md`](research/18-ableton-ui-architecture.md) | [`phase-23-stream-bb.md`](phase-23-stream-bb.md) |
| Preview-before-load | Audition a preset/sample/soundfont before applying it — an ephemeral engine voice or a raw fetch-decode-play, real audio through the master bus, with zero writes to the .beat file (engine.previewSynthPreset/previewDrumPreset/previewBuffer/previewSoundfont). | — | — | ✅ done | ✅ Done | [`18-ableton-ui-architecture.md`](research/18-ableton-ui-architecture.md) | [`phase-22-stream-ah.md`](phase-22-stream-ah.md) |

## Macros

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Macro tooling layer | A curated "front panel" of knobs mapped to real params, living outside the file (like presets) — turning a macro writes literal edits, never an in-file indirection. Phase 23 research stream RC scoped the concrete data shape (BeatMacro/MacroTarget), storage (presets/macros.json via the existing /library route), and GUI placement (a Macros row in SynthPanel.tsx) — see research/27. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`27-macro-tooling-layer.md`](research/27-macro-tooling-layer.md) | — |

## Undo / redo (in-session)

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Multi-level in-session undo/redo | Distinct from checkpoint/history versioning. Stripped from the original BeatLab port and never rebuilt — Ctrl+Z currently does nothing. | — | — | ❌ missing | ⬜ Not started | — | — |

## Project / folder management

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| beat init + "Open Folder" re-pointing | Initialize a new .beat project and re-point the desktop app at a different project folder. | ✅ done | ✅ done | ✅ done | ✅ Done | — | [`phase-20-track-project-management.md`](phase-20-track-project-management.md) |
| New-project-from-scratch, GUI-reachable | Create a brand new project without dropping to the CLI first: a "new project…" toolbar action (next to "open folder…") prompts for a destination and POSTs the daemon's new POST /new-project route, which wraps the same initDocument() `beat init` uses. Works from ANY running daemon, not just the Tauri folder-repoint flow — verifiable live in a plain browser. | — | ✅ done | ✅ done | ✅ Done | — | [`phase-22-stream-af.md`](phase-22-stream-af.md) |
| Save project as template | "Save as Template" opens as a fresh unsaved copy, never mutating the original — a natural fit for dotbeat's git-native model as "copy this file/folder as a new project," arguably cleaner than a browser-storage version. POST /save-as-template copies the CURRENT on-disk project bytes to a new path; starting a new project from a saved template reuses POST /new-project with a `from` template path (a byte copy, read-only against the template). No new core/CLI surface needed — a .beat file is a plain text file, so "save as template" is already just `cp project.beat template.beat` from a shell or agent; the GUI route exists for discoverability, not because the CLI/agent couldn't already do this. | — | — | ✅ done | ✅ Done | [`24-opendaw-roadmap-positioning.md`](research/24-opendaw-roadmap-positioning.md) | [`phase-22-stream-af.md`](phase-22-stream-af.md) |
| Optional cloud-folder sync (BYO storage) | Sync a project folder to a drive the user already has (Nextcloud/Dropbox/GDrive via one storage-agnostic interface) for multi-machine convenience — explicitly not live collaboration; git still owns history/versioning. Not scoped or requested yet, noted as the right shape if/when it is. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`23-opendaw-collaboration-storage.md`](research/23-opendaw-collaboration-storage.md) | — |

## Desktop app / packaging

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Tauri shell, compiled sidecar, bundled starter | Real desktop shell, force-quit-safe, local-machine distribution only (no notarization/signing, decisions.md D13). | ✅ done | — | ✅ done | ✅ Done | — | [`decisions.md`](decisions.md) |

## Audio-region clip editing

| Feature | Description | Core | CLI/MCP | GUI | Status | Research | Plan |
|---|---|---|---|---|---|---|---|
| Audio-region clip format | Media reference + in-point + out-point + gain + a warp enum + optional markers (v0.10). Clip-only (no live/non-clip audio content this stream); one clip = one region, all six fields on one bundled `audio` line (note/hit discipline, no elision). Phase 23 Stream BC closed the GUI gap: drag a kit one-shot from the content browser onto an audio track to create/replace a region (mints a clip and slots it into the current song section's scene, or fills an already-slotted clip in place), plus a static min/max-per-pixel waveform in the clip inspector so the in/out trim fields are visually legible. Also fixed a real bug the drag-drop flow surfaced: converting loop mode to song mode with an audio track present used to 500 (sceneFromLiveContent tried to snapshot a live-content clip an audio track structurally can't have) — audio tracks now correctly stay unmapped/silent until a real region is created. | ✅ done | ✅ done | ✅ done | ✅ Done | [`16-audio-clip-editing.md`](research/16-audio-clip-editing.md) | [`phase-23-stream-bc.md`](phase-23-stream-bc.md) |
| Repitch-mode warping | A playbackRate-equivalent `rate` field, wired into ui/src/audio/engine.ts via Tone.Player.playbackRate; canonically forced to 1 when warp isn't 'repitch'. Verified live: rendered spectral centroid shifts ~2x for a 1.5x rate (measured off real captured audio, not the stored param). The warp/rate controls themselves are full GUI fields (not the clip-block visual, which is the format row's documented gap). | ✅ done | ✅ done | ✅ done | ✅ Done | [`16-audio-clip-editing.md`](research/16-audio-clip-editing.md) | [`phase-22-stream-ae.md`](phase-22-stream-ae.md) |
| Split-at-point | splitAudioClip: a pure edit primitive, no DSP — converts a timeline step position to source-media seconds (accounting for repitch rate), trims the first clip's out, mints a second clip with adjusted in, partitions gain-automation points by time. CLI `beat audio-split` / MCP beat_audio_split / a GUI split-at-playhead button (POST /audio-split). | ✅ done | ✅ done | ✅ done | ✅ Done | [`16-audio-clip-editing.md`](research/16-audio-clip-editing.md) | [`phase-22-stream-ae.md`](phase-22-stream-ae.md) |
| Clip gain (static + automation lane) | Static gainDb field (default 0) plus a 'gain' automation lane reusing the v0.9 BeatAutomationLane/BeatAutomationPoint machinery UNCHANGED (confirmed research 16 §3's prediction) — only a new AUDIO_AUTOMATABLE_PARAMS=['gain'] set and a track-kind branch in checkAutomatableParam. Verified live: both static gain and a gain ramp measurably change rendered level. | ✅ done | ✅ done | ✅ done | ✅ Done | [`16-audio-clip-editing.md`](research/16-audio-clip-editing.md) | [`phase-22-stream-ae.md`](phase-22-stream-ae.md) |
| Region-level fade in/out handles | Two draggable, region-relative 0..1 handles at region edges (linear, crossing = min of both, snap-to-grid) — a small format addition (two normalized fields per region), well-specified prior art. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`24-opendaw-roadmap-positioning.md`](research/24-opendaw-roadmap-positioning.md) | — |
| Tape-emulation knobs on audio-clip tracks | Four unipolar "tape character" fields (flutter/wow/noise/saturation) baked into the region player itself, not a separate effect — cheap, on-brand with SYNTH_FIELDS' small evocative knobs, could share saturation-curve code with the Saturator FX. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`21-opendaw-devices-effects.md`](research/21-opendaw-devices-effects.md) | — |
| Warp markers + Complex-mode stretch | Marker-list format addition plus a real stretch-algorithm integration via signalsmith-stretch (MIT/WASM). Consider the 3-way TransientPlayMode vocabulary (Once/Repeat/Pingpong — research 22) for "what happens to a hit between two markers," smaller than Ableton's 5-way named-warp-mode system. Phase 23 research stream RA scoped the concrete grammar (`marker <id> <sourceTime> <timelineTime>`), WASM binding (official signalsmith-stretch npm package), and offline-pre-stretch engine architecture — see research/25. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`25-audio-warp-markers-stretch.md`](research/25-audio-warp-markers-stretch.md) | — |
| Beats-mode transient slicing | Onset/transient detection plus the stretch library; sequence after the rest of the audio-clip format proves out. Phase 23 research stream RB recommends a dependency-free pure-TypeScript energy-based detector populating the same BeatAudioRegion.markers grammar RA scoped, with an MVP tier (markers + waveform overlay + split-at-transient) shippable independent of the stretch engine — see research/26. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`26-beats-mode-transient-slicing.md`](research/26-beats-mode-transient-slicing.md) | — |
| Bounce / freeze a MIDI clip to audio | Render a MIDI clip, with its full effect chain, to a new audio clip in place — directly composable with the existing render engine once the audio-region clip format exists; sequence right after that lands. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`24-opendaw-roadmap-positioning.md`](research/24-opendaw-roadmap-positioning.md) | — |
| Reverse audio clip | An in-place reverse toggle on an audio region — trivial once regions exist, same dependency as bounce/freeze. | ❌ missing | ❌ missing | ❌ missing | ⬜ Not started | [`24-opendaw-roadmap-positioning.md`](research/24-opendaw-roadmap-positioning.md) | — |
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

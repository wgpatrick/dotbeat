# Feature matrix — status by layer

*Living document. Every feature in dotbeat exists (or should exist) at up to three layers: the
**core** (format + audio engine — the file and what makes sound), the **CLI/MCP** (the `beat`
command surface and the same operations exposed to an agent), and the **GUI** (`ui/`, what a human
sees/clicks). A feature is only really "done" when all three are done — the recurring confusion
this doc exists to prevent is a feature being fully real in the CLI/core and invisible in the GUI
(or vice versa), which reads as "missing" even though most of the work is finished.*

**Process, starting now**: every stream/phase that ships a feature updates this table as part of
its own completion checklist, alongside its `docs/phase-N-*.md` result doc — don't let it drift
stale. Status snapshot below is as of 2026-07-11, ~9pm — seven streams are running in the
background right now (Phase 20/21) and will move several "gap" rows to "done" shortly; those are
marked "in progress" rather than guessed at.

**Legend**: ✅ done and verified · 🔶 partial · 🚧 in progress right now · ❌ missing · 🔬 researched, not built · — not applicable

| Feature area | Core (format/engine) | CLI / MCP | GUI | Notes |
|---|---|---|---|---|
| **File format itself** | ✅ v0.9, diff-friendly, canonical ordering | ✅ full parse/serialize/diff | — | Mature since early sessions; the project's strongest layer |
| **Track management** (add/delete/rename/recolor) | ✅ `addTrack`/`removeTrack` | ✅ `beat add-track`/`rm-track` | 🚧 Stream W | Confirmed via direct audit tonight: zero GUI support until Stream W lands |
| **Note editing** (piano roll) | ✅ free-timed `BeatNote` | ✅ `beat add-note`/MCP | ✅ add/move/resize/multi-select/marquee, keyboard strip + octave gridlines, pitch-aligned within 1px | Phase 19 Stream U. Fold mode and scale-tone highlighting deferred (highlighting needs a per-clip scale field the format doesn't have yet — real gap, not faked) |
| **Drum programming** | 🔶 free-timed hits (v0.8) but closed 5-lane enum, no duration | ✅ for the 5 existing lanes | ❌ needs redesign | Format already supports arbitrary timing — GUI's rigid 16-step grid is the real ceiling. Research 19 (voice count) + research 20/21 (editing model, hit duration) both scoping the fix, not yet built |
| **Arrangement / song structure** | ✅ scenes/song (v0.4), `loopBars` | ✅ `beat scene`/`beat song` | ✅ viewing (Phase 13/18) · 🚧 length editing (Stream V) | Format/CLI could always build a full multi-section song; no GUI control to extend/shrink existed until tonight |
| **Synth sound design** (osc/filter/env/inserts/sends) | ✅ ~54-field `SYNTH_FIELDS` | ✅ `beat set` | ✅ full grouped panel (Phase 13) | Osc2 has a real GUI apply-chain bug, 🚧 fixing now (Stream Y) |
| **LFOs / modulation** | ✅ 16 destinations, real tempo-sync (Phase 18 R) | ✅ `beat set` | ✅ exposed in SynthPanel | Deliberately kept literal/enumerated, not a free-routing matrix (research 18) |
| **Wavetable oscillator** | ❌ `wtPos` field exists, no wavetable osc implementation | — | ❌ dead knob | Backlogged 2026-07-11, real gap not a bug |
| **Instrument / SoundFont tracks** | ✅ `BeatInstrument` | ✅ add + preset listing | ✅ playback, program select, meters, mute/solo (Ph. 14/16) · ❌ no FX chain | Level/pan only — no EQ/comp/sends per instrument track yet |
| **Mixer** (level/pan/mute/solo/sends) | ✅ | ✅ `beat set` | ✅ inline strip + full overlay, real audio-gated mute/solo | Phase 14/18 |
| **Core effects** (EQ3/comp/distortion/bitcrush/reverb/delay send/sidechain) | ✅ | ✅ | ✅ SynthPanel groups + mixer FX badges | Phase 13/16 |
| **Extended FX arsenal** (Ping Pong Delay, Beat Repeat, exposed Chorus/Phaser, Saturator) | 🔬 researched, prioritized | ❌ | ❌ | Research 17 — Ping Pong Delay is a near-free Tone.js drop-in, ready to build |
| **Automation** | ✅ `BeatAutomationLane` (v0.9), playback works | ✅ `beat automate` | ✅ playback reflects it · 🚧 editing UI (Stream Z) | Picker + inline draggable curve landing now |
| **Versioning / history** | ✅ git-backed checkpoints (D3/D10) | ✅ `checkpoint`/`history`/`pin`/`restore` | ✅ real panel, verified append-only restore, collapsed view | Phase 15/16. **Checkpoints are NOT automatic** — explicit `beat checkpoint` only, a recurring point of confusion |
| **Vary / audition loop** | ✅ rungs 1–3 (`vary`/`suggest`) | ✅ `beat vary`/`score`/`suggest` | ✅ live audition affordance, Keep/Undo verified | Phase 15/16. Rung-2 "feel" content variation not yet wired into the GUI affordance — explicitly deprioritized by owner for now |
| **Render / export** | ✅ real engine, self-contained since Phase 17 (no BeatLab dependency) | ✅ `beat render` | ✅ Export button in topbar, verified against the CLI reference render | Phase 20 Stream X — reuses the live engine's own capture path, no second engine spun up |
| **Metrics / critique loop** | ✅ LUFS/spectral/crest/stereo | ✅ `beat metrics`, lint | — (by design) | Agent-facing per D2 ("LLM narrates, never judges alone") — no GUI meter display planned, not a gap |
| **Selection protocol** (D2) | ✅ daemon `/selection` | ✅ `beat selection`, `--scope selection` | ✅ wired into arrangement + note views | Phase 13/17 |
| **Preset / content library** | ✅ 36 presets, taxonomy (Ph. 18 S) | ✅ `beat preset(s) --category` | ❌ no browser sidebar | Data layer is ready; nothing to drag/browse from yet |
| **Macros** | 🔬 researched — "tooling that resolves to literal values," never in-file indirection | ❌ | ❌ | Research 18. Design is ready; genuinely new subsystem, not started |
| **Undo / redo** (in-session) | — | — | ❌ | Backlogged 2026-07-11. Stripped from the original BeatLab port (Phase 12), never rebuilt. Distinct from checkpoint/history versioning |
| **Project / folder management** | ✅ `beat init`, Tauri folder re-pointing (Ph. 10/13) | ✅ | 🚧 Stream W (partial) | New-project/switch-folder not reachable from `ui/`'s own UI yet |
| **Desktop app / packaging** | ✅ | — | ✅ real Tauri shell, compiled sidecar, bundled starter, force-quit-safe | Phase 13/17. Local-machine distribution only (D13) |
| **Audio-region clip editing** (warp, split, clip gain, "velocity") | ❌ no audio-region-clip format concept at all | ❌ | ❌ | Research 16 (M4 scoping). Real format gap identified — most of what's wanted is web-tier-buildable once the format models a region, doesn't need the full native M4 tier |
| **Agent onboarding** (Claude Code skill) | — | ✅ `beat mcp-init`, live-verified skill | — | Phase 10/17 |

## How to read "done"

A row being ✅ across all three columns means a human can discover and use the feature entirely
through the GUI, *and* an agent can drive the identical capability through the CLI/MCP without
the GUI open, *and* the underlying data is real, diff-friendly, and durable in the file. Two
✅s and one gap is not done — it's exactly the kind of half-finished feature this table exists to
surface before it causes another round of "wait, does this even work?"

## Immediate priority order (owner's own tiering, 2026-07-11)

1. **Tier 1 — table stakes**: track management, render/export, project management (Stream W/X,
   in progress).
2. **Tier 2 — real editing gaps**: piano roll pitch reference, arrangement length, automation-lane
   UI, drum programming redesign, Osc2 fix (Streams U/V/Y/Z in progress; drum redesign researched,
   build next).
3. **Tier 3 — sound-design completeness**: extended FX arsenal, macros, content browser sidebar,
   instrument-track FX chain (all researched/scoped, not yet built).
4. **Backlog, not blocking**: undo/redo, real wavetable synthesis, audio-region clip editing (M4
   scoping done, format gap identified).

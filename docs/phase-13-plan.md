# Phase 13 — taking stock: what a *working system* still needs

*Kicked off 2026-07-11. Owner is stepping away for a while and asked for a full take-stock of the
project against the original design concept, then multiple streams to close the biggest gaps
toward an actually-working end-to-end system — not more isolated features. This doc is that
assessment plus the resulting plan.*

## Where the project actually is (the honest inventory)

**The thesis** (`ROADMAP.md` §1): a real GUI + diff-friendly text project file + full CLI/agent
access, occupying a quadrant no shipping tool combines. Three surfaces are supposed to be equal:
the file, the CLI/MCP, and the GUI.

**What's genuinely solid** — the file and CLI/MCP surfaces, and they're not close calls:
- Format is at v0.9 (general drum hits, clips/scenes/song arrangement, clip automation), with
  round-trip/diff/canonical-ordering discipline tested from commit one (D4, D7-D9).
- `beat` CLI covers render/inspect/set/diff/humanize/quantize/vary/suggest/preset/pin/history —
  effectively the whole document-editing surface, all tested (289 tests, 283 passing).
- `beat mcp` + `beat mcp-init` give an agent zero-setup access to all of it (Phase 10).
- The metrics/critique loop (LUFS, spectral balance, crest, stereo field) is real and was proven
  end-to-end with Claude driving it over the actual MCP protocol (`docs/sessions/2026-07-10-
  claude-over-mcp.md`).
- The variation-and-taste loop is on rung 3 (`beat vary`/`beat suggest`, preference ranking over
  a real scores log).
- The preset/drum-rack library is now genuinely broad (36 presets, Phase 12 Stream 2) and the
  sound-source licensing is clean and documented (research 09, D11's LFS handling).
- History/versioning (checkpoints, named pins, collapsed view) is shipped and tested (D3, D10).

**What's thin — the GUI surface, and it's the one users actually see first.** Phase 12 Stream 1
just built dotbeat's first real frontend from zero (`ui/`) and hit a genuinely proven exit bar
(live 2-way sync, real audio out), but by its own honest accounting it's a first slice:
- The engine is 257 lines vs. the ~1,500-line engine BeatLab actually ships (and CLI rendering
  already uses, via `render.mjs`/`render-offline.mjs`) — no drum-voice shaping, no sidechain, no
  LFOs/filter envelopes, no inserts/sends. **The GUI cannot yet make anything sound like what the
  CLI can already render.** This is the single biggest gap between "impressive backend" and
  "working system."
- Note/clip view is read-only — you can look at a song in the GUI but not compose one.
- Only one track's params are shown at a time, and not the full ~54-field `SYNTH_FIELDS` surface.
- No arrangement/song view yet (D4 — multiple attempts at this were BeatLab-side and discarded
  under D12; the *research* from that discarded work, canvas + density-LOD rendering for a dense
  timeline, is still valid and worth reusing even though the code was thrown away).
- No mixer view (track levels/pan/sends visible together).
- No instrument-track (soundfont) playback in the live engine at all yet.
- The Tauri shell (`desktop/`) still points its `frontendDist` at BeatLab's old bridge path
  (`"../src"`, a stale config from before D12) — it is not yet wired to `ui/`, so **there is no
  launchable Mac app pointed at dotbeat's own frontend today**, despite that being the stated top
  priority.
- Selection protocol (D2) and the vary-and-audition loop (D5) exist server-side but have no GUI
  surface yet — "highlight the hats, say change this up" isn't clickable anywhere.

**Read plainly**: the file/CLI/agent thesis is proven and strong. The GUI thesis — "a real GUI,
not a code editor with a visualizer bolted on" — is the newest, least-built leg of the stool, and
closing that gap is what turns this from "an impressive CLI tool with a demo frontend" into "the
DAW described in §1." That's the priority ordering below.

## Prioritized streams

Ordered by "what most blocks a genuinely usable system," not by ease:

### Stream A — Real engine parity in `ui/`

The GUI must be able to make a track sound like what `beat render` already produces from the same
`.beat` file — right now it can't, which undercuts the entire premise of a live GUI. Port the
*rest* of BeatLab's `engine.ts` (drum-voice synthesis per lane, sidechain duck, filter envelopes,
LFOs, insert/send chains, master bus/limiter) into `ui/src/audio/engine.ts`, same porting
discipline as Stream 1 used (adapt to dotbeat's document shape, strip nothing curriculum-related
since none of this is). Cross-check against `cli/render.mjs`'s real Tone.js graph construction
(the reference implementation) rather than re-deriving from BeatLab alone — the two should now
produce comparable output for the same document. Verify by rendering the same project through
both the CLI and a headless-Chromium drive of the live GUI engine and comparing metrics
(spectral balance / crest factor / LUFS via `src/metrics`) — they won't be bit-identical (D5's own
precedent: Chromium-vs-node-web-audio-api already has measured, documented divergence), but
should be *close*, and any large gap should be understood, not silently accepted.

### Stream B — Note/clip editing + the full param surface

Turn the read-only `NoteView`/`SynthPanel` into real editing surfaces: add/move/delete notes and
drum hits (writing through the daemon's `POST /edit` primitive Stream 1 already built), and
expand `SynthPanel` to cover the real `SYNTH_FIELDS` table (all ~54 fields, organized sensibly —
osc/filter/env/LFO/inserts/sends/drum-voice groups, not one flat list), reusing BeatLab's
`DevicePanel.tsx` metadata-table pattern research 15 §4 already flagged as portable (parameter
metadata as data feeding a generic renderer). This is what makes the GUI a place to actually
compose, not just observe.

### Stream C — Arrangement/song view + mixer, dotbeat's own build

D4's centerpiece screen, built fresh in `ui/` this time (not BeatLab's tree — no PR-against-
another-repo detour). Reuse the *research*, not the discarded code: canvas-based rendering with
density-LOD when zoomed out (validated approach from the discarded Phase 11 attempt, and
consistent with research 15 §2's canvas/rAF discipline for anything continuously updating), tracks
as rows, bars as columns, section boundaries, selection wired into the existing `/selection`
daemon route. Pair with a basic mixer view (per-track level/pan/mute/solo at minimum, visible
together rather than one track at a time) — the two views share a lot of "many tracks, one
glance" layout logic, reasonable to build together.

### Stream D — Wire the Tauri shell to `ui/`, make it a real launchable Mac app

Right now `desktop/`'s config still points at BeatLab's old bridge path — fix that first (quick),
then pick back up Phase 11 Stream 1's packaging work (stopped mid-flight under D12, before it
could finish — the yao-pkg daemon-sidecar research and distribution-scope reasoning from that
attempt is still valid, only the "bundle BeatLab's production build" half is void): daemon as a
real compiled sidecar (not a spawned `node` process), `ui/` built via `vite build` and served
locally instead of a dev server, folder re-pointing and persisted scope (already built in Phase 10
Stream A, just needs re-verifying against the new frontend instead of BeatLab's). Launch the
actual packaged app and verify for real, same evidence bar every prior stream has used.

## Process

Same worktree-per-stream pattern. Streams A and B both touch `ui/src/audio/engine.ts` /
`ui/src/components/SynthPanel.tsx` respectively — real but manageable collision risk (A owns
`engine.ts`, B owns the panel/note-editing components; if both touch `types.ts` for expanded
field coverage, that's a predictable, small conflict handled by whichever merges second, same
spirit as every prior phase's predicted overlaps). Stream C is a new, disjoint area of `ui/`.
Stream D is `desktop/` only, fully disjoint from the other three. `npm test` must stay green
(289+/283+/0/6) throughout.

## Result (2026-07-11)

All four streams shipped and are merged into `main`. Final suite unchanged at **289 tests, 283
passing, 0 failing, 6 skipped** (none of this phase's work is covered by the root suite except
Stream B's one core addition, which regression-tested clean).

- **Stream A**: full engine parity ported into `ui/src/audio/engine.ts` (257 → 945 lines) — drum
  voices, sidechain, filter envelopes/LFOs, inserts/sends, clip automation. Verified tight against
  the CLI reference render (LUFS/crest/spectral bands within ~0.7 points), plus a measured 2×
  sidechain duck and a real kick-spectrum check. Instrument/SoundFont playback explicitly
  deferred.
- **Stream B**: real note/clip editing (add/move/resize/delete) and the full ~54-field param
  surface (8 collapsible groups, a re-derived metadata-table pattern from BeatLab's
  `DevicePanel`). Needed one approved, small, additive addition outside its assigned files — a
  note-write grammar in `src/core/edit.ts`'s `setValue`, reusing already-tested `addNote`/
  `removeNote` — since the `/edit` primitive had no note-write path at all. Verified byte-identical
  to the equivalent `beat add-note` CLI output. **Merge required manual conflict resolution**
  against Stream C (both touched `App.tsx`'s view shell and `bridge.ts`'s edit-mirroring) — resolved
  by hand, re-typechecked `ui/` clean after.
- **Stream C**: arrangement/song view (canvas + density-LOD, the validated approach from a
  discarded Phase 11 attempt, rebuilt fresh here) and a mixer view, both live-verified against a
  real multi-scene project with real selection round-trips through the daemon.
- **Stream D**: the Tauri shell now actually points at `ui/` — production build embedded via
  Tauri's asset protocol, a real compiled daemon sidecar (yao-pkg, not a spawned `node` process),
  verified via `strings` on the built binary that zero BeatLab content remains and the app works
  with `node`/`npx` stripped from PATH. **This is the first point at which "the Mac app" is
  actually pointed at dotbeat's own product**, not a stale BeatLab-bridge config.
- **Honestly still open**, carried into Phase 14: mixer mute/solo is GUI-only (doesn't gate audio
  in the engine yet), no arrangement-view playhead during playback, instrument/SoundFont tracks
  have no live-engine playback or dedicated param UI, the new note-grammar addition to
  `src/core/edit.ts` has no dedicated unit test yet, no macOS notarization/distribution signing
  (local-machine target only, a deliberate scope call), only macOS arm64 built/verified.

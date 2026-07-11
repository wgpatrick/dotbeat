# Phase 12 — dotbeat's own frontend, and the preset/drum-rack library

*Kicked off 2026-07-11, immediately following D12 (`docs/decisions.md`): dotbeat gets its own UI,
hard fork from BeatLab. Owner is unavailable for several hours and asked for continuous
development in that window — streams below are scoped to run long, verify hard, and not require
a check-in. Owner's explicit steer after the plan was already drafted: it's fine to *learn* from
BeatLab's UI, but the app should be designed differently, and — since this is specifically a
desktop app — do real research on the technical implementation before committing to a stack, not
just default to "React in a webview." Sequencing changed accordingly: **Stream 0 (research) runs
first and gates Stream 1 (the frontend build)**; Stream 2 (presets/drum racks) is fully
independent and runs in parallel with both.*

## Stream 0 — desktop frontend architecture research (gates Stream 1)

Real, sourced research before any frontend code gets written — matching this project's own
established discipline (`docs/research/13-tauri-shell.md` did exactly this for the shell itself;
this is the equivalent pass for what's *inside* the shell). D3 already locked "web tech GUI,
Tauri wraps it" (`docs/decisions.md`) — but that was decided when the plan was to wrap BeatLab's
existing React app; now that dotbeat is building its own frontend from zero, specifically as a
desktop app, it's worth genuinely re-examining rather than inheriting the old assumption
unexamined.

Research questions, each wants real current sources, not priors:
1. **Web-in-webview vs. native-toolkit options for a Tauri app.** The default path (React/Svelte/
   Vue rendered in Tauri's webview) vs. Tauri-adjacent native-Rust-GUI options (egui, Iced, Slint,
   Dioxus's native renderer) vs. a platform-native shell (SwiftUI/AppKit directly, calling into a
   Rust core via FFI) — given the owner's current stated priority is specifically the *Mac* app,
   is a SwiftUI-native shell worth it for a "not a toy" feel, or does that trade away
   cross-platform reach and Tauri's already-proven sidecar/fs story for marginal polish? Look for
   real production examples and their own postmortems/blog writeups, not marketing pages.
2. **Real-time-audio-UI performance patterns**: how do web-tech DAW-adjacent UIs (WAM Studio,
   openDAW, any other real example findable) handle high-frequency visual updates — playhead
   position, meters, waveforms — without React re-render overhead fighting the audio thread?
   Canvas vs. WebGL vs. a dedicated render loop outside React's tree; how state updates get
   thrown over that wall cheaply.
3. **If web-in-webview wins (or splits the difference)**: React vs. a lighter alternative
   (Svelte, SolidJS, vanilla + a signals library) specifically for this workload — dense,
   frequently-updating UI (piano roll, arrangement view, meters) rather than typical CRUD-app UI,
   where React's rendering model has known, documented friction.
4. **What BeatLab's own UI gets right that's worth learning from, concretely** (the owner's own
   framing: "learn from BeatLab's UI, but think about the design entirely differently") — read
   its actual source (clone fresh, don't rely on stale notes from prior sessions) for patterns
   worth keeping (the step-sequencer grid interaction model, the knob/param panel layout, however
   it handles playhead-sync) separately from what NOT to carry over (its curriculum/lesson
   chrome, anything coupled to the teaching use case).

Produce `docs/research/15-desktop-frontend-architecture.md` in this repo, same rigor bar as the
project's other numbered research docs (real sources cited, findings distinguished from
open/unresolved questions, a clear recommendation with reasoning — not just an options list).
**End with an explicit recommendation** for Stream 1 to build against: stack, rendering approach
for dense/real-time views, and the native-vs-webview call with reasoning. This stream does NOT
write frontend code — its deliverable is the research doc and the recommendation.

## Stream 1 — dotbeat's own frontend: first real slice

**Do not start until Stream 0's recommendation exists** (`docs/research/15-desktop-frontend-architecture.md`) — read it in full and build against its actual conclusion, not a default assumption. If Stream 0 hasn't landed yet when you're dispatched, that's a sequencing bug; wait/check rather than proceeding on a guess.

There is currently no GUI code anywhere in this repo — `src/core`/`src/daemon`/`src/mcp`/`cli`
are all genuinely dotbeat's own and unaffected by D12, but the actual pixels have only ever come
from BeatLab's React tree, which is now off the table. This stream starts dotbeat's own frontend
from zero, inside *this* repo (a new top-level directory, e.g. `ui/` — your call on the exact
name, follow the existing repo's naming instincts).

**The real API surface to build against** (read `src/daemon/daemon.ts` yourself as the source of
truth, this is a paraphrase): `GET /doc` (current document as JSON), `GET /selection` /
`POST /selection`, `GET /events` (SSE for live updates), `POST /state` (push a full document
state — this is what BeatLab's `dawBridge.ts` used; check whether that's actually the right shape
for a fresh client or whether finer-grained edits should go through the `beat` CLI's edit
primitives via a route that doesn't exist yet — if the daemon is missing something a real GUI
needs, adding a small, additive route to `src/daemon/daemon.ts` is in scope, don't contort the
frontend around a gap that's cheap to close server-side).

**Target a proven, already-met exit bar** — M1's own criteria (`ROADMAP.md`, met by the old
BeatLab bridge, now unmet again since that bridge is gone): edit a knob in the GUI produces a
one-line `git diff`; editing the `.beat` file directly updates the GUI without a reload,
uninterrupted. Hitting this for real, on dotbeat's own frontend, is the deliverable — not a
mockup, not a Storybook of disconnected components.

1. **Stack**: whatever Stream 0 recommended, with its stated reasoning. Don't import anything
   from a BeatLab checkout (learning from its patterns while building it is fine and encouraged;
   copying its code is not — see D12).
2. **A real audio engine is a big, separate lift** (BeatLab's `engine.ts` is hundreds of lines of
   drum-voice synthesis, sidechain, automation — Phase 10 Stream D just spent a whole session
   verifying and fixing one corner of it). Do NOT try to fully rebuild it tonight. Scope audio
   for this stream as: simple, honest Tone.js playback (a basic synth/sampler triggering notes
   and drum hits on the transport) — good enough to prove the loop is real and something plays,
   not full parameter-for-parameter parity with every `SYNTH_FIELDS` knob. Say plainly what's a
   stub vs. fully wired.
3. **Build, in order of what proves the loop fastest**: (a) connect to a running daemon, render
   the real document — track list, BPM, a drum step-sequencer grid, a minimal piano-roll-ish note
   view for synth tracks; (b) live-update via `GET /events` SSE when the file changes externally;
   (c) an edit path back out — toggling a drum step, dragging a knob for a synth param — that
   round-trips through the daemon back into the `.beat` file.
4. **Verify like every other stream tonight has**: boot a real daemon against a real project file
   (`examples/night-shift.beat` or similar), load your new frontend against it (headless Chromium
   + Playwright, already a pattern this repo's own `scripts/` use elsewhere — check
   `cli/render.mjs`/`scripts/verify-phase*.mjs` for the existing convention), screenshot it and
   read the screenshot back to confirm it's showing real data. Toggle a step in the GUI, confirm
   via `git diff` on the `.beat` file that exactly one line changed. Edit the file directly on
   disk, confirm (via the SSE connection / a second screenshot) the GUI updated without a reload.

Owns: the new frontend directory entirely (your naming/structure call), plus additive-only
changes to `src/daemon/daemon.ts` if a real gap justifies it (small, don't restructure existing
routes). Do not touch `src/core`, `src/vary`, `src/history`, `src/metrics`, `cli/`, `presets/`,
`desktop/`, or `test/` beyond what a genuinely necessary daemon addition requires. Result in a
new `docs/phase-12-frontend.md`: what you built, the stack/engine-scope decisions and why, your
verification evidence (the actual `git diff` output, the actual screenshot descriptions), and
what's honestly deferred (this is a first slice of a huge screen — mixer, full arrangement view,
full param surface are follow-up streams, not failures of this one).

This is the biggest, most central piece of work tonight — budget real time for it rather than
rushing to "done."

## Stream 2 — the preset & drum-rack library, researched against real DAW conventions

Owner's explicit direction: *"research the types of preset synths and drum racks that are in
standard DAW systems. Let's build out our repo of synths and drum racks so it's similar."*

Today's library (`presets/factory.json`, `presets/kit-*`, `presets/sf2/*`) is thin and was grown
ad hoc (seeded from one approved mix, Phase 7's two CC0/CC-BY drum kits, Phase 10's two GM
soundfont banks). This stream gives it real shape.

1. **Research first, for real** (a focused pass, not a full 25-source adversarial harness, but
   genuinely sourced — cite what you find): how do shipping DAWs/synths organize their preset
   libraries? Concretely: Ableton Live's factory Instrument Racks and Drum Racks (its category
   taxonomy — Bass, Lead, Pad, Keys, Drums-by-genre, etc.); Serum/Vital's preset-bank categories;
   Logic Pro's ES2/Alchemy patch categories; Native Instruments Battery/Maschine kit categories;
   common genre-named drum kit conventions (808/trap, boom-bap, house, techno, acoustic/rock,
   lo-fi). Also look at what actually differentiates categories in parameter terms (e.g. what
   makes something read as "pluck" vs "pad" — attack/release shape, filter movement) so what you
   build is genuinely differentiated, not re-labeled duplicates of the existing 4-5 presets.
2. **Expand `presets/factory.json`** with a broader, categorized synth preset set built on
   dotbeat's own param surface (`SYNTH_FIELDS` in `src/core/document.ts` — read it, know the real
   knobs available) — organize by the categories your research turns up (Bass, Lead, Pad, Pluck,
   Keys, Arp, FX are a reasonable starting taxonomy but let the research actually inform this,
   don't just guess). Several genuinely distinct presets per category, not one token example.
3. **Expand drum content**: dotbeat's drum-voice params (`SYNTH_FIELDS`'s drum-voice shaping,
   added Phase 7) already support synthesized per-lane drum character without needing new
   licensed audio — build a handful of genre-named synthesized drum-voice presets (e.g. an 808
   trap kit, a house kit, a techno kit, a boom-bap kit) applied through the same `beat preset`
   mechanism synth tracks use, if drum tracks support named presets the same way (check
   `src/core/edit.ts`/`applyPreset` — if drum tracks *don't* support this yet, that's a real,
   valuable, small format/tooling gap worth closing as part of this stream, not a blocker to route
   around). If you also want to pull in more licensed sample content (more FreePats/Freesound CC0
   kits per research 09's already-cleared shortlist), that's in scope too, same provenance-sidecar
   convention as existing `presets/kit-*`/`presets/sf2/*` — but the synthesized drum-rack presets
   are the higher-value, lower-risk deliverable, prioritize those first.
4. **Verify concretely**: apply several new presets to real tracks via `beat preset`, render each,
   and confirm they're actually acoustically distinct — reuse the project's own metrics engine
   (spectral balance / crest factor, `src/metrics`) the way Phase 5's exit test did, rather than
   asserting "sounds different" without evidence. New tests for anything genuinely new
   (drum-track preset support, if you add it).

Owns: `presets/factory.json`, `presets/kit-*` (new dirs only), `presets/sf2/*` (new files only,
git-lfs already configured — content added here is automatically LFS-tracked, no extra step
needed), `src/core/edit.ts`/`document.ts` ONLY if drum-track preset support is genuinely missing
and worth adding (small, additive — if you touch these files, run the FULL `npm test` and confirm
286+/280+/0/6, not just your own new tests). Result in a new `docs/phase-12-presets.md`: your
research findings and sourcing, what you built (the actual preset list, organized by category),
your verification evidence (real metric deltas, not adjectives), what's deferred.

## Process

Same worktree-per-stream pattern, no cross-stream file overlap expected (Stream 1 is a new
frontend directory + maybe daemon routes; Stream 2 is `presets/` + maybe drum-preset-application
plumbing in `src/core`). Both run long — this is not a "quick pass," budget real hours. `npm test`
from the repo root must stay green (286+/280+/0/6) for both before either is considered done.

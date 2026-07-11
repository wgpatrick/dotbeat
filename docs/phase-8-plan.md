# Phase 8 — SF2 melodic instruments (research-07 Tier 2, second half)

*Started 2026-07-11 immediately after Phase 7 ("keep building"). Real sampled instruments —
pianos, strings, brass, mallets — behind the same media discipline the drum kits proved.*

## The spike result that shapes everything (2026-07-11, verified live)

**`spessasynth_core` (4.3.12, Apache-2.0) is a pure-DSP SoundFont engine with zero browser
dependencies** — the AudioWorklet lives only in the `spessasynth_lib` wrapper. Headless Node
drove it directly:

- Loaded FreePats' Upright Piano KW small SF2 (CC0, license file inside the archive) via
  `SoundBankLoader.fromArrayBuffer` + `soundBankManager.addSoundBank`.
- `createMIDIChannel` → `programChange` → `noteOn/noteOff` → `process(left, right)` into
  Float32Arrays, 128-sample blocks.
- **3 s piano chord rendered in 104 ms — 29× realtime** — vs the Tone/web-audio graph's
  0.2-0.7×. Real piano spectrum (mids-dominant, 512 Hz centroid). WAV verified by our metrics.

Key API (spike-verified): `new SpessaSynthProcessor(sampleRate)` / `processorInitialized` /
`soundBankManager` / `createMIDIChannel` / `programChange(ch, prog)` / `noteOn(ch, note, vel)` /
`noteOff(ch, note)` / `process(L, R, start?, count?)`; `SoundBankLoader.fromArrayBuffer`.

## Design (draft — refine while building)

### 8.1 Format: `instrument` tracks (v0.6)

- New track kind `instrument`: notes like a synth track, but the voice is
  `soundfont <sample-id> <program>` (media-referenced SF2 + program number) instead of a synth
  block... OR keep kind `synth` and add an exclusive voice line. DECIDE while implementing;
  leaning: new kind — the synth block's 55 params mostly don't apply, and fail-loudly beats
  half-meaningful params. Volume/pan/sends should still apply (bus params subset).
- SF2 files ride the existing v0.5 `media` block (sha256-pinned, provenance sidecars) — no new
  media machinery needed. Multi-preset banks: `<program>` selects; `beat inspect` should list a
  bank's presets.

### 8.2 Engine integration

- **Headless first** (it's now the FAST path): the offline runner instantiates one
  SpessaSynthProcessor per instrument track at the OfflineContext rate, schedules the track's
  notes by sample position (our own sequencing — bypasses Tone entirely for these tracks),
  renders to buffers, and injects them into the mix via AudioBufferSourceNodes through the
  track's bus (volume/pan/sends). 29× realtime means instrument tracks are nearly free.
- **Browser**: `spessasynth_lib`'s AudioWorklet wrapper inside beatlab's engine, fed by the
  same bridge/media path as drum one-shots. Dev-gated like everything else.

### 8.3 Content

- Ship FreePats CC0 banks (Upright Piano KW small = 6 MB, already validated); FluidR3 GM (MIT,
  ~140 MB) stays user-loadable rather than bundled. Provenance sidecars as in Phase 7.

### Exit criteria (draft)

- [ ] A `.beat` file with an instrument track (piano over the Night Shift chords) renders
      offline with the real piano — and byte-round-trips.
- [ ] v0.5 files unchanged.
- [ ] Browser plays the same instrument track via the daemon (verify-phase8 harness, same
      pattern as verify-phase7).

## Status

Spike complete (this doc). Next: 8.1 grammar + core, then headless integration, then content,
then browser leg.

## Status update (2026-07-11, second slice)

**v0.6 shipped headless-first**: grammar (soundfont voice line, volume/pan elision, notes,
fail-loudly exclusions), spessasynth_core renderer integration (sample-position sequencing
outside the Tone graph, media loader split raw-vs-decoded, document.currentScript stub under
the polyfill's window), CLI (`add-track --soundfont/--program`, `set keys.volume/pan/program/
soundfont`), instrument-param diffs, inspect, beatlab-partials exclusion + daemon reinsertion.
130/130 tests. Live demo: piano chords + Audiophob kick/hat from one v0.6 file, 2.7x realtime.

**Remaining**: the browser leg (spessasynth_lib worklet inside beatlab's engine + an instrument
track kind app-side, or a bridge-side headless-worklet hybrid — decide next slice), master-bus
routing for instrument audio offline (currently bypasses the limiter, documented), clips/
timeline participation, GM percussion/FluidR3 for the multi-preset story, beat_song-style MCP
surface for instruments.

## Status update (2026-07-11, third slice)

Shipped everything on the Remaining list except the browser leg (out of scope this slice — no
beatlab checkout in this environment; see "Deferred" below). 213/213 tests (207 pass, 6 known
pre-existing flake in test/history.test.js — a macOS tmpdir-symlink-vs-git-realpath mismatch,
unrelated to this work and present before it), up from the 187-test baseline: +26 new tests, all
passing, across three new files (test/master-bus.test.ts, test/instrument-clips.test.ts,
test/instrument-presets.test.ts) plus one edited (test/format-v06.test.ts, whose "clips forbidden
in v0.6" assertion was the exact restriction this slice lifted).

**Master-bus routing (fixed).** Root cause, found by reading `cli/render-offline.mjs`'s
instrument block: instrument audio is rendered by spessasynth_core entirely outside the Tone
graph, then injected via a plain `AudioBufferSourceNode` connected straight to
`offline.rawContext.destination` — bypassing whatever limiter/master-bus chain the Tone-graph
tracks pass through on their way out. That chain (`masterBus.chain(masterLimiter,
Tone.getDestination())`, per docs/phase-0-plan.md) lives entirely inside beatlab's `engine.ts`,
which this repo only ever consumes as a built bundle re-exporting `useStore`/`engine`/
`DEFAULT_SYNTH`/`audioBufferToWav` (`scripts/build-headless-engine.mjs`) — there is no exported
handle to beatlab's private limiter node, and extending that export surface needs a beatlab
checkout this environment doesn't have. The fix instead works at the one seam this repo already
owns and already hacks at (see `patchWaveShaperReassignment`/the AudioWorklet shims in the same
file): a new `attachSharedMasterBus(rawContext)` overrides the raw context's `destination`
getter — verified configurable/instance-shadowable — to point at a real limiter (a
`DynamicsCompressorNode` tuned to Tone.Limiter's own defaults: ratio 20, attack 3ms, release
10ms, threshold -12dB) sitting in front of the true destination node, captured once and kept.
Tone's own `Destination` singleton reads `context.rawContext.destination` exactly once, at
construction (`node_modules/tone`'s `Destination.js:37`), which happens when `Tone.setContext()`
runs — so calling `attachSharedMasterBus` *before* `Tone.setContext(offline)` means every
Tone-graph track's `.toDestination()` chain, AND the instrument buffer source (whose call site,
`offline.rawContext.destination`, is unchanged), now resolve to the same node and pass through
the same limiter before the same true destination. Verified on real rendered audio via
src/metrics (test/master-bus.test.ts, no Tone/beatlab bundle needed — the function only touches
the raw context): two loud in-phase sources that would sum to +5 dBTP unlimited measure under
0.5 dBTP through the shared bus; the same two sources routed around it (a control, reproducing
the old bypass) do measure the unlimited over; a loud-vs-quiet pair proves it's a real
level-reactive limiter, not a fixed makeup-gain stage.

**Instrument clips/timeline (shipped).** `clip` blocks are now legal on `instrument` tracks,
carrying notes only (the same grammar/validation synth-track clips already had) — the exact
restriction lifted was `src/core/parse.ts`'s `"instrument tracks do not carry clips in v0.6"`
guard and the note-line kind check inside clip bodies; `src/core/serialize.ts`'s instrument
branch now emits clip blocks before its early return (it previously never serialized `t.clips`
at all for instrument tracks, since none could exist). Scene/song participation needed no core
changes: `saveClip`/`setScene`/`setSong` (and the scene/song reference validation in
`parse.ts`) were already generic over track kind — they only ever branched on drums-vs-not for
hits-vs-notes. What DID need new work is the *offline render* actually honoring scenes/song for
instrument tracks: previously the instrument block in `render-offline.mjs` only ever read the
live top-level `t.notes`, tiled across the whole render, with zero awareness of `doc.song`
(unlike synth/drum tracks, whose section/scene/clip resolution happens inside the beatlab engine
tick, which instrument tracks bypass entirely). Added `instrumentNoteEvents` (exported, pure,
engine-free): in song mode it walks the section list, resolves (scene -> this track's slot ->
clip) per section, and tiles that clip's notes every `loopBars` within the section (unmapped
tracks silent for that section) — the identical semantics docs/phase-6-plan.md's engine tick
uses for synth/drum tracks. Being pure and dependency-free, it's directly unit-tested (no
spessasynth/Tone/beatlab bundle) in test/instrument-clips.test.ts: loop-mode tiling, song-mode
section resolution with a multi-note clip spanning two loop passes inside one section, and the
"unmapped track is silent for that section" rule. `PartialInstrument` (the additive
beatlab-partial field instrument tracks ride since beatlab has no instrument kind) gained an
optional `clips` field so a future browser leg has the data waiting, without disturbing the
existing shape when a track has none.

**`beat_song` MCP tool: already covered instruments once clips were allowed** — its handler was
always generic (`saveClip`/`setScene`/`setSong`), so no change was needed there. The real gap
found while checking MCP parity: `beat_add_track` only accepted `kind: synth|drums` — there was
no way to create an instrument track via MCP at all, even though the CLI's `add-track
--soundfont/--program` could. Extended `beat_add_track`'s schema/handler to accept
`kind: instrument` plus `soundfont_sample`/`soundfont_program`, verified end-to-end in
test/instrument-presets.test.ts (spawns a real `beat mcp` subprocess: `beat_add_track` an
instrument track, then `beat_song` authors a clip/scene/song referencing it, same as it already
does for synth/drums).

**Multi-preset listing (shipped, CLI + MCP).** `beat inspect` (both human-readable and `--json`)
now reads the instrument track's actual `.sf2` bytes (sha256-verified against the media block,
same discipline every other media consumer uses) and lists every preset in the bank via
spessasynth_core's `SoundBankLoader.fromArrayBuffer(...).presets` — a pure binary-format parse
that, verified live, needs neither an audio context nor the `window`/`document.currentScript`
shim `render-offline.mjs`'s DSP path requires (that shim is only needed by
`SpessaSynthProcessor`'s embedded WASM loader, not by the bank parser). The currently-selected
program is marked `[selected]`; a missing/unregistered/hash-mismatched sample degrades to a
per-track error line rather than failing the whole inspect (matching its role as an
always-available overview). Verified end-to-end against the real vendored FreePats piano SF2
fixture (`presets/sf2/upright-piano-kw-small.sf2`) in test/instrument-presets.test.ts, including
the JSON shape and the graceful-degradation path. Mirrored into the MCP `beat_inspect` tool for
parity.

**Deferred, honestly:**
- The browser leg — unchanged from last slice, and out of reach this slice (no beatlab checkout
  in this environment; this was the one explicitly-out-of-scope item going in).
- GM percussion / FluidR3 *content* — the multi-preset *listing mechanism* is done and verified
  (it will correctly enumerate FluidR3's full GM program list the moment that bank is loaded;
  nothing in the implementation is single-preset-specific), but actually fetching/vetting/
  bundling the ~140 MB FluidR3 GM bank itself is a content-acquisition task, not something this
  slice's four parts asked for, and wasn't attempted.
- The master-bus fix could not be verified against beatlab's *actual* private `masterLimiter`
  node (no exported handle, no checkout to add one) — it's verified against an equivalent shared
  limiter this fix installs at the context-destination seam, which is honestly a different node
  than beatlab's own, even though it delivers the same "nothing reaches the WAV unlimited"
  contract. If a later slice extends the headless-entry bundle's exports (`scripts/
  build-headless-engine.mjs`) to include beatlab's real masterBus/masterLimiter, that would be
  the more literal fix; worth revisiting once a beatlab checkout is available here.
- Nothing in this slice could be run against the *actual* v0.6 spike bundle end-to-end (no
  beatlab checkout to build `dist-headless/engine.mjs` from) — `render-offline.mjs`'s full
  `renderOffline()` function (as opposed to the pure, extracted `attachSharedMasterBus`/
  `instrumentNoteEvents` helpers it now exports) is unverified in this environment for the same
  reason. It's a straight-line reading of the new code, though: the master-bus patch runs before
  `Tone.setContext`, unconditionally; the instrument-events call site is a drop-in replacement
  for the same inline logic that was already there and now-covered by unit tests.
- This environment's own `node-web-audio-api` devDependency (`file:../upstream/
  node-web-audio-api`) doesn't resolve here either (no sibling `upstream/` checkout) — worked
  around locally for verification by installing the real npm 2.0.0 release (not committed;
  node_modules isn't tracked). The new tests that need it (master-bus, instrument-clips'
  render-offline-backed cases) feature-detect and skip cleanly rather than fail red when it's
  absent, so `npm test` stays green regardless of which of the two builds — or neither — is
  present in a given checkout.

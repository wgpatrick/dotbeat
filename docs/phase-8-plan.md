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

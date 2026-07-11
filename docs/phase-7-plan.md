# Phase 7 — Sample-backed drums (research-07 Tier 2, owner-approved "then move on to A")

## What exists in beatlab already (source-verified 2026-07-10)

Phase I built more than expected — the gaps are narrower than research 07 assumed:

- **The lane-granular switch point already exists**: `triggerDrum` plays
  `samplePlayers[lane]` if present, else the synthesized voice (`engine.ts:731`) — a mixed
  sample/synth kit needs no dispatch redesign.
- **One-shot infrastructure exists but is kit-global**: exactly one sample, auto-sliced across
  all five lanes (`sampleFullBuffer` + shared `sliceBoundaries`); `loadDrumSampleFromBuffer`
  wipes the whole kit. Per-lane loading needs a per-lane buffer store and a rebuild that
  doesn't clear sibling lanes.
- **Per-lane tune exists** (`setSlicePitch`, ±12 semitones, live via playbackRate/detune).
  **Per-lane gain node exists** but is repurposed per-hit for velocity — needs level/velocity
  separation (velocity currently overwrites level every hit at `engine.ts:743`).
- **The headless seam is documented in beatlab itself**: `loadDrumSampleFromBuffer(buffer,
  name)` (`engine.ts:461`) takes a decoded AudioBuffer — no File/fetch. node-web-audio-api
  supports `decodeAudioData(ArrayBuffer)`; our offline runner already restructured the graph
  onto Tone.OfflineContext (the MediaRecorder caveat applies to beatlab's own export, not us).
- **Samples do NOT persist**: no sample fields in SandboxPayload; audio is engine-memory only.
  The .beat media story is not just nice — it's the first persistence samples will ever have.

## Design

### 7.1 beatlab: per-lane one-shots *(engine work — approved scope)*

- Per-lane buffer store (`laneOneShots: Partial<Record<DrumLane, AudioBuffer>>`) +
  `loadLaneOneShot(lane, buffer, name)` / `clearLaneOneShot(lane)` that build a
  `Tone.Player` into the existing `samplePlayers[lane]` WITHOUT touching sibling lanes or
  `sampleFullBuffer` (whole-kit slicing keeps working; one-shot wins per lane if both set).
- Separate lane level from velocity: static `laneGain` (dB) applied at rebuild; per-hit
  velocity multiplies rather than overwrites.
- Reuse existing tune (`setSlicePitch` path) for one-shot lanes.
- New per-lane params ride a small descriptor (not 15 new SynthParams fields):
  `laneSamples: Partial<Record<DrumLane, { sampleId, gainDb, tune }>>` on the drums track's
  runtime state, applied via the bridge (persistence = the .beat file, see 7.2).

### 7.2 Format v0.5: media block + lane assignments

The first thing a `.beat` file references that cannot be text. Content-addressed, sidecar:

```
media
  sample kick-909 sha256:9f86d0... media/kick-909.wav

track drums Drums #e35d5d drums
  synth
    ...
  lane kick kick-909 -2 0        # lane <lane> <sample-id> <gain dB> <tune semitones>
  pattern kick ...
```

- `media` block: document-scoped sample ids (slugs), sha256 of the file bytes (integrity +
  dedup + the git story: media files are immutable blobs, the hash pins them), path relative
  to the .beat file. Fail loudly on missing file or hash mismatch at load time (render/daemon),
  not parse time (parse stays pure text).
- `lane` lines inside drum tracks: optional; absent = synthesized voice (today's sound,
  unchanged). One line per assigned lane — one-line diffs for swap-the-kick.
- Provenance sidecar convention (not grammar): `media/<file>.json` carries source URL, license,
  uploader, retrieval date — the research-07 requirement, kept out of the music file.

### 7.3 Plumbing

- Offline renderer: after `applyDawState`, read media refs, `readFileSync` + `decodeAudioData`,
  call the per-lane loader before `engine.play()`.
- Daemon: serve `media/*` over HTTP; bridge fetches and loads (browser side of the same seam).
- Converter/partials: lane descriptors + media table ride `beatDocumentToPartialTracks`.

### 7.4 Starter kit with zero licensing risk

Bootstrap content by **rendering our own synthesized kit to WAVs** (kick/snare/clap/hat/openhat
one-shots via the offline renderer, self-made = self-licensed), committed under
`presets/kit-init/` with provenance sidecars. Proves the whole pipeline (media block, hashes,
per-lane render) before any third-party content enters. The CC0 Freesound pipeline (research
07: APIv2 `license:"Creative Commons 0"` filter + per-file provenance) upgrades content later —
**gated on a Freesound API key from the owner**.

### Exit criteria

- [ ] A `.beat` file with a sample-backed kick (media block + lane line) renders offline with
      the sample playing (verified: transient/spectral difference vs the synth-kick render of
      the same pattern), while unassigned lanes stay synthesized.
- [ ] Round trip: the media block + lane lines survive parse→serialize byte-identically;
      hash mismatch and missing file fail loudly at load.
- [ ] v0.4 files (no media/lanes) parse and sound unchanged.
- [ ] GUI: a daemon-synced session plays the same sample-backed kit (browser loads media via
      the daemon).

### Sequencing

7.1 engine per-lane API → 7.4 starter kit render → 7.2 format v0.5 grammar → 7.3 renderer
plumbing → exit test → daemon/browser leg → docs.

## Result (2026-07-11)

Shipped: 123/123 tests green; both repos pushed.

- **Format v0.5**: media block (content-addressed, sha256-pinned, relative-paths-only) + `lane`
  assignments; canonical elision preserved (v0.2-v0.4 files byte-identical); semantic diff
  covers media re-pins and lane swaps ("drums: kick lane synth voice -> ap-kick (-1.5 dB, -2 st)").
- **Engine (beatlab main)**: per-lane one-shots in separate player maps (whole-kit slicer
  untouched), lane level × velocity separation, tune via playbackRate. Dev-bridge loads media
  from the daemon with (id, sha256)-keyed caching. 14/14 smoke checks.
- **Exit test met**: a sample-backed kick renders measurably differently from the synth kick
  (sub 48% vs 41%, centroid shift from tune) while unassigned hat lanes stay synthesized
  (97% air); hash mismatch exits 1 with a precise error; GUI push never erases media/lanes
  (carried over in the daemon).
- **Content**: kit-init (self-rendered CC0) + kit-audiophob (CC0, Debian-vetted, Freesound IDs
  in provenance) bundled; Freesound CC0 pipeline live at both audition (previews) and original
  (OAuth2) quality — full search→verify-license→download→prep→provenance in one command.
- **Browser leg live-verified** (`scripts/verify-phase7.mjs`, full real stack: daemon + vite +
  headless Chromium with ?daw=): the bridge fetched and loaded the sample-backed kick 654 ms
  after page load with zero errors, and a `beat lane` edit to the FILE propagated into the
  running browser in 75 ms. Every phase exit criterion is now met.
- **Deferred, honestly**: MuldjordKit (blocked on GitHub-release proxy access — say "add
  freepats/muldjordkit" to unblock), spessasynth SF2 tier (next phase), and the drum-craft prep
  conventions (research 09 struck out on book-grade sources — prep-oneshot defaults remain
  self-derived).

## Phase 10 Stream B update (2026-07-11)

Both deferred items above are resolved for real, against verified real content (not a mock/stub
bank) — see `docs/phase-10-plan.md` Stream B.

- **FluidR3 GM: fetched, MIT-verified, bundled.** `scripts/fetch-fluidr3-gm.mjs` pulls the
  Debian `fluid-soundfont-gm` package (a straight repack of the upstream musescore.org tarball;
  license double-checked against both the Debian `copyright` file AND the MIT-license comment
  embedded in the .sf2's own INFO chunk — "Licensed under the MIT License.", engineer "Frank
  Wen", 13 named contributors, matching research 09's audit exactly), trims the full 148MB bank
  down to 8 named GM presets (`Yamaha Grand Piano`, `Nylon String Guitar`, `Acoustic Bass`,
  `Violin`, `Trumpet`, `Flute`, `Synth Drum`, and the `Standard` GM drum kit) via
  spessasynth_core's own `trim()`/`writeSF2()` — same "small variant for repo size" move as the
  piano fixture — down to 26MB, committed at `presets/sf2/fluidr3-gm-small.sf2` +
  `.sf2.json` sidecar. **Exit criterion met**: `beat inspect` on a real `.beat` project pointed
  at this bank lists all 8 real GM program names verbatim (verified live, plus
  `test/fluidr3-gm-preset.test.ts`), exercising the multi-preset listing machinery
  (Phase 9 Stream C) against real content for the first time.
- **MuldjordKit: NOT actually blocked anymore — fetched, CC-BY-4.0-verified, bundled.** Phase 9
  Stream F was right: `github.com/freepats/muldjordkit/releases/...` 302-redirects to a working
  `release-assets.githubusercontent.com` URL and downloads fine from this machine.
  `scripts/fetch-muldjordkit.mjs` pulls the SF2 release variant (not `.h2drumkit` — same
  SoundBankLoader path as the other two fixtures, no new loader work needed), verifies
  `LICENSE.txt` reads as CC-BY 4.0 and the README names Lars Muldjord, trims the full ~209MB /
  480-sample kit to 2 velocity layers/key (76 samples, 43MB) via the same trim()/writeSF2() move,
  committed at `presets/sf2/muldjordkit-small.sf2` + sidecar carrying both required credit lines
  (Lars Muldjord's original + FreePats' assembly, plus the upstream DrumGizmo.org attribution
  ask). Verified live: `beat inspect` loads it and reports `"MuldjordKit"` as the single preset
  (`test/muldjordkit-preset.test.ts`). **Not yet done**: breaking this out into per-lane
  one-shots (the `kit-init`/`kit-audiophob` convention — `presets/kit-<name>/kick.wav` etc.) —
  mapping the kit's 13 real pieces onto dotbeat's 5 drum lanes is a curatorial judgment call
  (the kit has no clap, for instance), not a fetch step, and stayed out of this stream's scope
  (`presets/sf2/` only). Left as a clearly-flagged follow-up, not silently dropped.
- Both fetch scripts are additive and reproducible (`scripts/fetch-fluidr3-gm.mjs`,
  `scripts/fetch-muldjordkit.mjs`) — re-running them re-downloads and re-verifies from upstream
  rather than trusting a cached blob's provenance.
- `npm test`: 283/277/0/6 (was 280/274/0/6; +3 real tests against the newly bundled content, 0
  regressions).

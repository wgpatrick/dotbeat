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

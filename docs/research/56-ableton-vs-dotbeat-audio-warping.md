# Research 56 — Ableton Live 12 vs. dotbeat: audio warping feature/UI comparison

*2026-07-12. Direct structured comparison, grounded in the Ableton Live 12 Reference Manual's
chapter 9, "Audio Clips, Tempo, and Warping" (pp. 219-236, `prior_art/`, gitignored, local copy) —
both the extracted text (`docs/research/37-ableton-audio-warping.md`, already a grounded primer on
this chapter) and 14 of the chapter's own screenshots, viewed directly this pass
(`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch09/p-{219,220,221,223,224,225,226,
227,228,229,232,233,234,235,236}.jpg`) — plus a direct read of dotbeat's own source
(`src/core/document.ts`, `src/core/edit.ts`, `ui/src/audio/engine.ts`, `src/core/groove.ts`,
`ui/src/audio/waveform.ts`, `docs/format-spec.md`) done fresh this pass, not assumed from prior
docs. Cross-referenced against `docs/research/25-audio-warp-markers-stretch.md` (warp-marker
grammar + signalsmith-stretch integration design) and `docs/research/26-beats-mode-transient-
slicing.md` (onset-detection design) — this doc does not repeat their design work, it cites and
prioritizes it. Every Ableton claim is **[manual p.NNN]**; every dotbeat claim carries a
`file:line` citation.*

## How this doc differs from research 37

Research 37 is a grounded *primer* — it explains what each part of the Ableton chapter does and
notes dotbeat implications inline. This doc is a *direct comparison table* structured for planning:
what's shared, what Ableton has that dotbeat doesn't, what dotbeat has that Ableton doesn't, and a
priority-ranked build list for every gap. Read research 37 for texture and reasoning; read this doc
for "what do we build next, and in what order."

---

## 1. Feature & UI/UX comparison

### a) Shared features / parity

| Feature | Ableton | dotbeat |
|---|---|---|
| Per-clip warp on/off as a precondition for everything else | The Warp switch, in the Clip View's Audio Utilities panel — off means "plays at its original tempo, unaffected by the Set's tempo," recommended for one-shots/textures/spoken word **[manual p.223-224]** | `WarpMode` enum `'off' \| 'repitch' \| 'complex'` (`src/core/document.ts:481-486`); `'off'` plays the identical role. dotbeat's enum actually **subsumes** Ableton's separate switch-then-dropdown UI into one field — a design win, not just parity, per research 37 §2.1. |
| Re-Pitch / varispeed warp mode | Re-Pitch mode: literal variable-speed playback, turntable/vintage-sampler model, pitch and tempo NOT independent, transposition controls disabled **[manual p.236]** | `region.rate` as a `playbackRate` multiplier, consumed exactly this way: `const rate = region.warp === 'repitch' ? region.rate : 1` (`ui/src/audio/engine.ts:3262`). Full functional parity, shipped and live-verified (rendered spectral centroid shift ~2x at 1.5x rate, per `docs/product-roadmap.md`'s Audio-region clip editing row). |
| Static clip gain (level fader per clip) | A Gain slider in the Audio Utilities panel, -70dB to +24dB range visible in the panel chrome **[manual p.221, p.224 screenshots]** | `BeatAudioRegion.gainDb` (`src/core/document.ts:517-525`), read directly into `voice.player.volume.value` on clip trigger (`ui/src/audio/engine.ts:3264`). |
| Time-varying gain (clip envelope) | A drawable volume shape across the clip, interpreted as a percentage of the static Gain, never exceeding it (research 16 §3, confirmed against the manual's own Clip Envelopes documentation) | `AUDIO_AUTOMATABLE_PARAMS = ['gain']` (`src/core/document.ts:533`) reuses the existing v0.9 `BeatAutomationLane`/`BeatAutomationPoint` machinery unchanged — `content.automation.get('gain')` drives both the initial trigger value and a `linearRampToValueAtTime` ramp mid-region (`ui/src/audio/engine.ts:3264,3271-3274`). |
| Split-at-point | `Cmd/Ctrl+E` at the playhead splits one clip into two, same underlying sample reference, adjusted in/out — no new audio generated (research 16 §2) | `splitAudioClip(doc, trackId, clipId, atSteps, opts)` (`src/core/edit.ts:1256-1281`+) — converts a timeline step to source-media seconds via `in + atSteps × stepSeconds × rate`, auto-numbers the new clip, partitions gain-automation across the cut. Exposed as `beat audio-split` / `beat_audio_split`. |
| Basic waveform amplitude display | The Sample Editor renders a filled amplitude waveform with a horizontal timeline ruler; warp markers overlay as small tabs along the top **[manual p.225, p.227 screenshots]** | `ui/src/audio/waveform.ts` — a decode-and-cache utility (`loadWaveform`, `:37-57`) feeding a min/max-per-pixel-column canvas render (`drawWaveform`, `:64-114`), consumed by `AudioClipInspector` in `ArrangementView.tsx:1184-1233`. **Parity on the core visual convention only** — Ableton's is a fully interactive editing surface (drag markers, drag-to-trim, Shift-drag the underlying audio); dotbeat's is a static, non-interactive inspector image. The interactivity gap is tracked separately in §1b/§2. |
| Quantize's "Amount" partial-blend mechanism (not yet applied to audio) | Quantize Amount, 0-100%, "shifts the Warp Markers by a percentage of the chosen quantization value" **[manual p.234]** | `quantizeNotes` (`src/core/edit.ts:408-413`) already takes a validated `amount` in `0..1` and blends a note/hit's position toward the grid by that fraction — the *exact same mechanism* Ableton describes, just currently scoped to `BeatNote`/`BeatDrumHit`, not warp markers. Counted as parity **at the mechanism level**; applying it to audio markers is itself a §1b gap (below), made cheap by this existing code. |

### b) In Ableton, not in dotbeat

Everything below is either fully absent from dotbeat or present only as an inert reserved schema
field with zero engine/edit-primitive support — verified by direct grep this pass (`addWarpMarker`,
`moveWarpMarker`, `removeWarpMarker`, `setWarpMarker`, `detectTransients`, `detectBpm`,
`estimateBpm`, `estimateTempo`, `autoWarp`: **zero matches** anywhere in `src/` or `ui/src/`).

1. **Warp Markers as a working feature** — add/move/delete via double-click, `Cmd/Ctrl+I`, drag,
   Shift-drag-the-waveform **[manual p.225-226]**. dotbeat has the *type* (`BeatAudioWarpMarker`,
   `src/core/document.ts:495-505`) and the *grammar reserved on the parent region*
   (`BeatAudioRegion.markers`, `:517-525`, always `[]`) but zero parse grammar, zero edit
   primitives, zero engine consumption — confirmed by `docs/format-spec.md:656-659`'s own comment:
   "no `marker` line grammar, no edit primitives."
2. **Complex / Complex Pro time-stretch DSP** — the actual pitch-independent stretch algorithm for
   full mixed material, plus Complex Pro's Formants/Envelope controls **[manual p.236]**.
   `WarpMode` has a `'complex'` value, but the engine branch treats it identically to `'off'`:
   `region.warp === 'repitch' ? region.rate : 1` (`ui/src/audio/engine.ts:3262`) — no stretch code
   path exists at all.
3. **Beats mode** — transient-detecting slice-and-reposition stretch for drum loops, with its own
   **Preserve** (Transients vs. fixed grid division) and **Transient Loop Mode** (Loop Off / Loop
   Forward / Loop Back-and-Forth) sub-controls governing what plays in a stretched gap **[manual
   p.234-235]**.
4. **Tones mode** — pitch-aware Grain Size tuning for monophonic pitched material (vocals,
   basslines) **[manual p.235]**.
5. **Texture mode** — non-pitch-aware Grain Size plus a Fluctuation (randomness) control for
   unpitched/atmospheric material **[manual p.235]**.
6. **Transients & pseudo-warp markers** — auto-detected onset markers rendered as passive gray
   hints, a live hover preview before committing, one-click commit, a modifier for
   commit-with-neighbors **[manual p.226 screenshot]**.
7. **Import-time auto-warp settings** — `Loop/Warp Short Samples` (Unwarped One Shot / Warped One
   Shot / Warped Loop / Auto), `Auto-Warp Long Samples`, `Default Warp Mode` — all global defaults
   applied the moment audio lands on a track **[manual p.224-225]**.
8. **Tempo/BPM estimation on import** — even-length-loop heuristic (assume 1/2/4/8/16 bars, seed
   two markers, show an estimated BPM with ×2/÷2 correction buttons), plus explicit odd- and
   uneven-length-loop recovery workflows (`Set 1.1.1 Here`, `Warp From Here`) **[manual p.227-229,
   screenshots]**.
9. **The "Warp From Here" bulk re-derivation command family** — four distinct tempo-source
   strategies (re-run auto-warp / anchor to Set tempo / single-marker-straight /
   single-marker-at-typed-BPM), all re-deriving everything right of a chosen point **[manual p.232
   screenshot]**.
10. **Quantize Audio** — snap the nearest transient to the grid, with an Amount blend, a dedicated
    Quantize panel (grid division including triplets) **[manual p.233-234 screenshot]**. The
    underlying blend *mechanism* is shared (§1a); the *feature applied to audio* is not built.
11. **Persisting warp markers into the sample file itself** — a Save-button action so markers
    reappear whenever that file is dragged into any future project, with the caveat that it only
    works for the user's own samples **[manual p.227]**.
12. **Multi-clip / multi-track warp-marker editing** — selecting several same-length clips and
    editing markers on one applies to all of them, aimed at correcting a multitrack recording's
    timing uniformly **[manual p.229 screenshot]**.
13. **Manipulating groove via warp markers as a creative technique** — pinning a marker's neighbors
    and dragging the marker itself to deliberately reshape rhythm, distinct from timing-correction
    use **[manual p.233 screenshot]**.
14. **Interactive waveform editing** — drag a marker, Shift-drag to move the underlying audio under
    a fixed marker, double-click/Backspace to delete **[manual p.225]**. dotbeat's waveform render
    is display-only (§1a).
15. **Clip tempo leader/follower** — an Arrangement-View clip's Lead/Follow toggle lets it *set* the
    Set's tempo from its own warp markers, with a deterministic bottom-most-track tie-break rule and
    auto-generated tempo automation **[manual p.221-223, screenshots]**.
16. **Tap tempo** — a dedicated button/key/MIDI-mappable tap-to-set-tempo control, confidence
    improving with more taps, optionally triggering transport on the fourth tap in 4/4 **[manual
    p.220]**.
17. **Phase nudge** — Phase Nudge Up/Down buttons for real-time re-alignment against a
    non-tempo-locked external source (live musicians, turntables) **[manual p.221]**.
18. **Consolidate — bake a warped clip's actual audio output to a new file** — "these samples are
    essentially recordings of the time-warping engine's audio output" (research 16 §2, confirmed
    against the manual's own Arrangement View documentation). Distinct from the already-tracked
    roadmap row "Bounce/freeze a MIDI clip to audio" (`docs/product-roadmap.md`, Audio-region clip
    editing section) — that row is MIDI→audio; this is audio→audio with warp baked in.

### c) In dotbeat, not in Ableton

1. **The entire warp state is literal, diff-friendly text**, not a gzipped-XML/binary project file.
   Every `region.warp`/`rate`/`gainDb`/(eventually) `marker` field is a plain line in `.beat`
   (`docs/format-spec.md:635-655`) — a `git diff` on a warp edit reads as an edit, the way
   `ROADMAP.md` §1's whole thesis promises. Ableton's `.als` has no equivalent (`ROADMAP.md` §1's
   landscape table: "not confirmed cleanly human-readable even decompressed").
2. **Content-addressed audio media (sha256)** — `BeatMediaSample.sha256` (`src/core/document.ts:
   576-580`) is a stable hash-of-content key computed for every audio asset today, already used for
   dedup/integrity. This is a strictly better mechanism than Ableton's file-embedded marker-saving
   (§1b item 11) for exactly the same caching problem — a sha256-keyed sidecar survives file moves
   and renames; Ableton's file-embedded approach doesn't, per research 37 §3.3/§6.3. Not yet used
   for this purpose, but the hook already exists at zero marginal cost.
3. **CLI/MCP-scriptable region edits** — `beat audio-split` / `beat_audio_split`
   (`src/core/edit.ts:1256`+) and the general `beat set` path give an external agent or script
   direct, textual access to every audio-region field. Ableton has no CLI or agent surface for any
   of chapter 9's mechanics at all — every operation researched above is mouse/keyboard-only.
4. **A separate, mathematically-invertible note/hit-level groove-warp mechanism** —
   `shuffleAmount`/`shuffleGrid` (`document.ts`) applied via `warpStep`/`unwarpStep`
   (`src/core/groove.ts:51-69`), a Möbius-ease curve exact-round-trip tested. This is a genuinely
   different mechanism from Ableton's warp markers (which operate on audio, not notes/hits), but it
   occupies conceptually the same "reversible creative timing warp" territory Ableton's §9.2.6
   groove-manipulation covers for audio — dotbeat has it for notes/drum hits today, Ableton doesn't
   have a note-level analog at all (its groove pool is a different, separate mechanism entirely).
5. **Semantic, itemized diff of every audio-region edit** — `src/core/diff.ts`'s `DiffEntry[]`
   (D8) will itemize a future marker move as `clip "take-a" warp marker added m2 (source 5.0s,
   timeline step 4.0)` (research 25 §4.6's already-designed phrasing) the moment markers ship.
   Ableton has no diff concept for any warp state anywhere — there is nothing to compare this
   against, which is itself the gap this project exists to close.

---

## 2. Prioritized recommendations

Every row is one item from §1(b). Priorities:

- **P0** — blocking/foundational; nothing else in this feature area is real without it.
- **P1** — high-value, buildable soon, either cheap (reuses existing mechanisms) or a real quality/
  usability unlock once P0 lands.
- **P2** — real, worth doing eventually, but correctly sequenced after P0/P1 or gated on evidence
  that it's actually needed.
- **Do-not-recreate** — a deliberate no, with the reasoning stated so it isn't rediscovered as an
  accidental gap later.

| # | Feature | Priority | Build recommendation |
|---|---|---|---|
| 1 | Warp Markers (add/move/delete, piecewise time-varying stretch) | **P0** | Build exactly as research 25 Slice 1 scopes: `marker <id> <sourceTime> <timelineTime>` grammar nested under the `audio` line in `src/core/document.ts`/`docs/format-spec.md`, plus `addWarpMarker`/`moveWarpMarker`/`removeWarpMarker`/`setWarpMarker` in `src/core/edit.ts` (directly parallel to the existing `addAutomationPoint` family), CLI `beat warp-marker`/`beat warp-marker-remove`, MCP `beat_warp_marker`/`beat_warp_marker_remove`. Format-only, zero DSP, zero new dependency — unblocks GUI work immediately. |
| 2 | Complex-mode stretch (the actual DSP) | **P0** | Build as research 25 Slice 2: add `signalsmith-stretch` (MIT) as a dependency, batch-render (not real-time worklet) into a `warpedBuffers` cache in `ui/src/audio/engine.ts` keyed by `${mediaId}:${in}:${out}:${markersHash}`, gated behind `region.warp === 'complex' && region.markers.length > 0`. Sequence directly after #1 — markers with no stretch consumer are inert; stretch with no markers has nothing to interpolate between. |
| 3 | Beats mode (transient slicing + Preserve/Transient Loop Mode) | **P1** | Sequence after #1+#2. Reuse research 26's `detectTransients` core primitive (energy-based onset detection, `src/core/edit.ts`) to densely populate the same `markers` list with `source: 'auto'` provenance. Add a `TransientPlayMode` enum (`Once \| Repeat \| Pingpong`, openDAW-derived per research 22, cheaper than Ableton's 3-way Transient Loop Mode naming) as a new field on `BeatAudioRegion` for "what plays in a stretched gap." |
| 4 | Tones mode (pitch-aware grain size) | **P2** | Defer. Per research 37 §5's own scoping note, Tones/Texture are narrower material-specific optimizations of the same grain approach Complex already covers "adequately for a v1." Revisit only if real vocal/bassline material shows Complex's quality insufficient — don't pre-build against a hypothetical. |
| 5 | Texture mode (grain size + Fluctuation) | **P2** | Same reasoning and gate as #4 — defer until evidence from real pad/drone/ambient material demands it. |
| 6 | Transients & pseudo-warp marker UX (hover-preview-then-commit) | **P1** | Build `detectTransients` (research 26 §4.2, energy-based, zero new dependency) as soon as #1's marker grammar exists — it's decoupled from #2's stretch engine (research 26 §5.1: "detecting transients and writing markers requires zero dependency on any stretch engine at all"). GUI: extend `ui/src/audio/waveform.ts`'s canvas renderer with gray transient ticks, a hover-preview state, and click-to-commit in `AudioClipInspector` (`ArrangementView.tsx`). Cheap, shippable win independent of #2/#3. |
| 7 | Import-time auto-warp settings (Loop/Warp Short Samples, Auto-Warp Long Samples, Default Warp Mode) | **P2** | Model as session/GUI preference state (not `.beat` grammar — same precedent as mute/solo and `BeatGroup.collapsed` staying transient, `docs/product-roadmap.md`'s Mixer section), wired into the content-browser drop flow (`ui/src/components/ContentBrowser.tsx`, phase-22-stream-ah). Blocked on #8 (tempo estimation) existing first — there's nothing to decide automatically without it. |
| 8 | Tempo/BPM estimation on import (with ×2/÷2 correction) | **P1** | New core primitive, e.g. `detectTempo(doc, trackId, clipId)` in `src/core/edit.ts` — autocorrelation/comb-filter over the already-decoded buffer (reuse `audiojs/beat`'s MIT-licensed algorithm, or hand-roll per research 37's recommendation). CLI `beat detect-tempo` / MCP `beat_detect_tempo`, returning a *suggested* BPM — never silently overwrites `doc.bpm` (same "tool input, not grammar" posture as D9's quantize sensitivity). This is the one real, confirmed-absent gap upstream of both #7 and #9. |
| 9 | "Warp From Here" bulk re-derivation (4 tempo-source strategies) | **P2** | Explicitly sequence after #1 and #8 both land — research 37 §6 item 7 is explicit that this should NOT be retrofitted onto research 25's already-scoped direct-manipulation primitives now. When built, it's a new bulk primitive consuming #8's tempo estimate, with the four named strategies as CLI flags/modes. |
| 10 | Quantize Audio (snap transients to grid, Amount blend) | **P1** | Near-zero net-new design risk per research 37 §6 item 1: add `quantizeWarpMarkers(doc, trackId, clipId, { amount })` in `src/core/edit.ts`, directly modeled on the already-shipped, already-tested `quantizeNotes` (`edit.ts:408-413`) — identical validation, identical blend math. CLI `beat quantize-audio` / MCP `beat_quantize_audio`, direct sibling of `beat quantize`. Build immediately after #1 (needs a marker list to quantize). |
| 11 | Persist markers/tempo-detection results keyed by content, not per-project | **P2** | Cache `detectTransients`/`detectTempo` output in a sidecar keyed by `BeatMediaSample.sha256` (`document.ts:576-580`), same pattern as the existing `presets/sf2/*.sf2.json` provenance sidecars (D11). Strictly better than Ableton's file-embedded approach (§1c item 2) and cheap once #6/#8 exist — no urgency on its own. |
| 12 | Multi-clip / multi-track warp-marker editing | **P2** | Thin wrapper once #1 ships: extend the four marker primitives to accept `--scope selection`, reusing the already-wired daemon `/selection` channel (D2, `docs/product-roadmap.md`'s Selection protocol row) — the same mechanism `beat vary --scope selection` already uses. Low priority; Ableton frames this for multitrack-recording correction, a use case dotbeat doesn't clearly have yet. |
| 13 | Creative groove-via-markers (pin neighbors, drag to reshape) | **P2** | Pure GUI affordance once #1 and #14 exist — no new core primitive beyond `moveWarpMarker`. Worth a design note (not urgent): consider whether `src/core/groove.ts`'s warp/unwarp preview framing has anything to lend to the marker-drag interaction, per research 37 §3.7. |
| 14 | Interactive waveform editing (drag markers, drag-to-trim, Shift-drag underlying audio) | **P1** | This is what makes #1's markers actually usable day-to-day — numeric-only fields are an accepted v1 gap (research 25 §5), not a permanent one. Extend `ui/src/audio/waveform.ts` + `AudioClipInspector` with pointer-event drag handlers writing through `setWarpMarker`/`setClipAudioRegion`. Use research 25 §3's two-tier live-preview approach: a cheap `playbackRate`-scalar approximation during the drag (reusing the mechanism `repitch` mode already has), debounced to an authoritative `renderWarpedBuffer` call on release — avoids standing up a real-time worklet. |
| 15 | Clip tempo leader/follower | **Do-not-recreate** | Per research 37 §6 item 6: the entire mechanism exists in Ableton to solve "sync the Set to whatever tempo this clip happens to be at," which only matters given per-clip tempo variance plus live clip-triggering. dotbeat's engine is constant-tempo by design (`docs/product-roadmap.md`: "the engine is still constant-tempo 4/4") and has no Session-style live-triggering surface (research 18 already ruled that out). Write this down explicitly as an "Out of scope" line in `docs/product-roadmap.md` or `docs/decisions.md`, rather than leaving it an implicit, rediscoverable gap. |
| 16 | Tap tempo | **Do-not-recreate** | Same reasoning as #15 — exists for live-performance tempo-setting, a use case dotbeat's file-then-render, non-real-time-reactive model doesn't have. Note alongside #15/#17 in the same doc-level "out of scope" entry. |
| 17 | Phase nudge | **Do-not-recreate** | Same reasoning again — exists to re-align against a non-tempo-locked live external source (musicians, turntables). No load-bearing use case in dotbeat's architecture. Group with #15/#16 as one explicit decision, not three separate non-decisions. |
| 18 | Consolidate — bake warped-clip audio output to a new file | **P2** | Sequence directly after #1+#2 land (needs real warp output to bake) and after the already-tracked roadmap row "Bounce/freeze a MIDI clip to audio" (`docs/product-roadmap.md`, Audio-region clip editing) — this is the audio-to-audio sibling of that MIDI-to-audio feature, and can likely share the render/capture path `ui/src/audio/engine.ts` already exposes for GUI Export (`docs/phase-20-render-export.md`). |

---

## Sources

Ableton Live 12 Reference Manual, chapter 9, "Audio Clips, Tempo, and Warping," pp. 219-236
(`prior_art/`, local copy) — extracted text via `docs/research/37-ableton-audio-warping.md`, and 14
of the chapter's own screenshots viewed directly this pass (pp. 219, 220, 221, 223, 224, 225, 226,
227, 228, 229, 232, 233, 234, 235, 236). Cross-referenced against `docs/research/25-audio-warp-
markers-stretch.md`, `docs/research/26-beats-mode-transient-slicing.md`, `docs/research/16-audio-
clip-editing.md`, `docs/research/22-opendaw-editing-workflow.md` (`TransientPlayMode`),
`docs/decisions.md` (D2, D4, D6, D8, D9, D11), `docs/product-roadmap.md`. dotbeat source read
directly this pass: `src/core/document.ts` (`WarpMode`, `BeatAudioRegion`, `BeatAudioWarpMarker`,
`BeatMediaSample`, `bpm`), `src/core/edit.ts` (`splitAudioClip`, `quantizeNotes`,
`validateAudioRegionFields`, `addAudioClip`, `setClipAudioRegion`), `ui/src/audio/engine.ts`
(`buildAudioTrackVoice`, `syncAudioTracks`, the `tick()` audio-kind branch), `src/core/groove.ts`
(`warpStep`/`unwarpStep`, `moebiusEase`), `ui/src/audio/waveform.ts` (`loadWaveform`,
`drawWaveform`), `docs/format-spec.md` (v0.10 audio-region grammar section).

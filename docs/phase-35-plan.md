# Phase 35 — make the taste loop honest for drums, and make co-production real

Source: the owner's first real dogfood session (branch `claude/song-creation-mcp-cli-a33w4t`,
2026-07-13) + pilot 101 + the same-day `setLaneSample` declared-mode fix. The pattern across all
three: the modern declared-lane drum surface is where silent no-ops cluster (vary groups mutate
dead legacy params; `beat lane` wrote dead legacy fields until fixed; no inspect surface shows
lane truth), and the owner's own workflow notes name the next unlocks: one audition WAV instead
of N files, GUI interop as the next prototyping step, feedback loops that should be on by
default, and a music-session mode so a helper agent doesn't act like a repo engineer.

Owner priority order (confirmed 2026-07-13): (1) lane-aware drum vary + legibility, (2)
live-session mode, (3) contact-sheet audition WAV, (4) reference mix profile, (5) research pass
on track-analysis tooling.

## Streams

| Stream | Work | Primary files | Source |
|---|---|---|---|
| OA | Lane-aware drum vary/suggest (kill the no-op) | `src/vary/vary.ts`, `src/vary/suggest.ts`, `src/core/edit.ts` (lane-param set paths), tests | pilot 101 HIGH |
| OB | Drum-surface legibility: inspect shows lane truth; grid truncation; stale-legacy cleanup | `src/core/inspect.ts` (or equivalent), `cli/beat.mjs`, `src/core/serialize.ts` | pilot 101 mediums; pilots 94/96 cosmetics |
| OC | Live-session mode + one-WAV audition: music-session scaffold, selection-aware `beat_vary`, MCP-native adopt, contact-sheet WAV | `cli/beat.mjs` (mcp-init), `src/mcp/server.ts`, `src/vary/batch.ts` | owner dogfood notes; pilot 101 mediums 3-4 |
| OD | Reference mix profile: critique against a track you love | `src/metrics/`, `cli/beat.mjs`, `src/mcp/server.ts` | owner dogfood notes ("listening loop") |
| OE | Research pass: track-analysis tooling (structure / stems / chords / melody) | `docs/research/102-track-analysis-tooling.md` | owner dogfood notes ("learn from actual tracks") |

## OA — lane-aware drum vary/suggest

Pilot 101's high finding, verified three ways: `VARY_GROUPS`' kick/snare/hats groups mutate the
LEGACY track-wide drum-voice synth params, which the engine provably never plays on a
declared-lane track — every fresh drums track since Phase 25. Variants differ on paper, sound
identical, and score/suggest learn from the fake signal.

1. On a declared-lane drums track, `beat vary <file> <track> <lane-name>` targets the named
   lane's OWN backing params: synth-backed → that voice type's params
   (`DRUM_VOICE_PARAM_DEFAULTS` keys, musically-nonlinear ranges like the existing groups);
   sample-backed → `SAMPLE_LANE_PARAM_KEYS` (start/length/attack/hold/decay/cutoff/resonance)
   plus gainDb/tune. Any declared lane works — not just the historic five names.
2. Manifest edits must stay replayable via `beat set` — use the existing lane-param set-path
   grammar (`setLaneParam` shipped in Phase 26 Stream DK; find its path syntax and reuse it).
   If a mutated param has no set-path spelling, that's a gap to fix in core, not a reason to
   write non-replayable edits.
3. Legacy tracks: the existing groups keep working exactly as they do (they're correct there).
   A legacy group name on a declared-lane track must ERROR loudly, naming the declared lanes to
   target instead — never generate no-op variants. `beat vary --groups` output becomes
   track-aware where a file/track is given, or documents both modes.
4. `beat suggest` follows: group legality by track's actual lanes (declared) or kinds (legacy);
   cold-start on a declared-lane drums track recommends a real lane.
5. Tests: variants of a declared-lane track produce docs whose serialized lane lines differ;
   a legacy-group-on-declared-track call errors; suggest cold-start targets a real lane;
   round-trip replay of manifest edits via setValue reproduces the variant doc.

## OB — drum-surface legibility

The invisibility that let OA's no-op (and the setLaneSample bug) hide:

1. `beat inspect` plain-text: per-lane line for drums tracks — name, backing (synth voice /
   sample id + gain/tune / sf), and non-default lane params. The `--json` view gets the same
   under a `lanes` key if not already there.
2. Fix the pattern-grid truncation: the grid silently renders only 16 steps while hit counts
   say more (pilot 101 medium 1) — render the real loop length (chunked rows if wide).
3. Drums tracks no longer show the bogus `synth:` header line (pilot 94 cosmetic) — show the
   lane summary instead.
4. Stale-legacy cleanup: on a declared-lane track, `laneSamples` is dead data. Serializer keeps
   round-tripping it (D4 — never destroy content silently), but `beat inspect` flags it
   ("legacy lane lines ignored by playback — remove with `beat lane <track> <lane> none`"?? —
   no: removal must be an explicit new `beat lane --clear-legacy <track>` or similar, since
   `none` now means "revert declared backing"). Pick the smallest honest surface: flag in
   inspect + a one-shot cleanup flag on `beat lane`.
5. Tests for each; keep `--json` and text views consistent.

## OC — live-session mode + one-WAV audition

The owner's two workflow asks, plus pilot 101's two MCP-ergonomics mediums, as one coherent
"co-producing with an agent" stream:

1. **Music-session scaffold**: `beat mcp-init` also writes (or offers via `--claude`) a
   CLAUDE.md next to the `.beat` aimed at MUSIC sessions, not engineering: you're making music;
   after each render run metrics + lint and say what changed; use vary/score for taste
   decisions; checkpoint at musical milestones; velocity is 0-1; lane gain is dB; never edit
   the dotbeat repo. Keep it short (a screenful). This is the fix for "the agent started
   updating the README."
2. **Selection-aware `beat_vary`**: accept a `port` arg (running daemon) so `scope:
   "selection"` works over MCP exactly like the CLI's `--scope selection` — the GUI-interop
   bridge. `beat mcp-init` records the daemon port convention in the scaffold so agents know
   to look.
3. **MCP-native adopt**: pilot 101 medium — a feel winner is unadoptable MCP-only (the hint
   says `cp ...`). Add `beat_adopt` (or an `adopt: true` arg on beat_score) that copies the
   picked variant over the parent file through a real edit path (respecting daemon hot-reload
   if one is running — writing the file is enough, the daemon watches). CLI gets the same verb
   for parity (`beat adopt <batch-dir> <pick>`).
4. **Path defaults**: batch out-dirs and the scores log default relative to the `.beat` file's
   directory, not the server/CLI cwd (pilot 101 medium 4) — both surfaces, same rule, spelled
   out in help.
5. **Contact-sheet audition WAV**: `--audition` on `beat vary` (and `audition: true` on
   `beat_vary`, implies render) stitches the rendered variants into ONE `audition.wav` in
   pick order — 0.5s silence between variants, and a printed/returned timecode index
   (`v1 @ 0:00.0, v2 @ 0:09.2, ...`) plus an `audition.json` with the same map. Pure PCM
   concatenation of the vN.wavs (same sample rate/channels by construction). The owner's #1
   ergonomic ask from the dogfood session.
6. Tests: scaffold file contents; adopt round-trip (score then adopt → parent bytes equal
   picked variant); path-default resolution; audition stitching (frame math on tiny synthetic
   wavs — no real renders in CI).

## OD — reference mix profile

The strongest cheap upgrade to the listening loop: critique against a chosen reference track
instead of absolute targets.

1. `beat metrics <ref.wav> --save-profile <ref.json>`: writes the existing metric set (LUFS,
   true peak, crest, band shares, width, correlation) as a named, reusable profile with
   provenance (source filename, date, tool version).
2. `beat lint <mix.wav> --ref <ref.json>`: findings compare against the profile's numbers
   (band-share deltas, width delta, LUFS delta) with the Phase-34 variance constants padding
   thresholds; each finding names the reference value, the measured value, and the `.beat`
   edit to try — same actionable-finding discipline lint already has. Absolute-target mode
   stays the default when no `--ref`.
3. MCP parity: `beat_metrics` gains `save_profile`; `beat_lint` gains `ref`.
4. Honest limits stated in help/docs: profile compares full-mix statics; it does not hear
   arrangement, sections, or masking (per-stem/per-section metrics are separate roadmap rows).
5. Tests: profile round-trip; ref-mode lint findings on synthetic known-answer signals
   (reuse the existing known-answer fixtures pattern in test/metrics).

## OE — research pass: learning from real tracks

`docs/research/102-track-analysis-tooling.md`, following the repo's research conventions
(claims with sources, confidence labels, honest gaps). Questions, in priority order:

1. Source separation state of the art for local use (Demucs family and successors): quality,
   license, runtime cost, Node/Python integration reality.
2. Music structure segmentation (section boundaries/labels) — usable open implementations,
   accuracy expectations on electronic music.
3. Beat/downbeat/tempo and chord recognition — same lens.
4. Melody/MIDI transcription (basic-pitch and successors) — same lens.
5. Synthesis: which of these could feed dotbeat concretely (reference profile → OD; structure
   → a `.beat` song-skeleton generator; chords → clip suggestions), what the licensing allows,
   and a recommended first slice with effort estimate. Copyright posture stated plainly
   (analyze for reference, never copy audio into projects).

Web research; no code. Flag single-source claims as such rather than over-claiming.

## OF — multi-drums-track engine support *(added mid-phase, 2026-07-14)*

Found by the owner's music agent mid-song: **the engine wires only the FIRST drums-kind track**
(`ui/src/audio/engine.ts:2615` — `doc.tracks.find((t) => t.kind === 'drums')`, one global
`drumLanes` map, one drum bus, one `drumTrackId`, one sf voice). A second drums track parses,
serializes, edits, and inspects perfectly — and is pure silence at playback. The session had to
burn the main kit's unused tom/crash/ride lanes to get vocal chops sounding at all. The format
has no such limit; this is engine-only.

1. Per-drums-track state: lane voice maps, bus, declared-mode flag, and (if sf-backed lanes are
   in play) sf voice keyed by track id — `triggerDrum` becomes `(trackId, lane, ...)`; the
   scheduler routes each drums track's hits to its own map. Choke groups and the per-lane
   monotonic trigger guard become per-track too (two tracks' hats must not choke each other).
2. Mixer/solo/mute, per-track sends/effects, and the GUI drum-lane panel must keep addressing
   the right track (they mostly key by track id already — verify, don't assume).
3. Verification is the point: a committed `ui/verify-*.mjs` (or scripts/) proof rendering a
   two-drums-track project and measuring BOTH tracks sound (solo renders spectrally distinct,
   both present in the mix) — the exact test that would have caught this years of sessions ago.
   All existing single-drums behavior stays bit-for-bit (the full verify suite + 635 tests).

## Wrap-up (standing habits)

- CLI/MCP pilot against OA+OC surfaces (research/103+); a GUI-facing pilot is not needed
  (no GUI-facing behavior changes) unless OB's inspect work grows a GUI face.
- Roadmap rows + `docs/product-roadmap.md` + `docs/roadmap-dashboard.html` refresh; README
  taste-loop paragraph if OC changes the story (it does — one-WAV audition + adopt).
- The ND multi-region design (Phase 34) still awaits the owner's §5 decisions — unblocked
  separately, not part of this phase.

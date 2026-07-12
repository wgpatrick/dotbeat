# Phase 22 Stream AE — audio-region clip format foundation

*Built 2026-07-11. Implements `docs/research/16-audio-clip-editing.md` §8's "buildable in the
current web engine" bundle (items 1-4) as one coherent format-spec version bump: a new
audio-region clip-content type, repitch-mode warping, split-at-point, and clip gain (static +
automation). This is the prerequisite for everything else in the roadmap's "Audio-region clip
editing" area — before this stream, `BeatClip` had exactly two content shapes (notes, hits); it
now has three.*

## The grammar (v0.10)

A new track kind, `audio`, whose clips carry exactly one **audio region** — a span of a
content-addressed media file (the existing v0.5 `media` block; no second asset mechanism). An
audio-track clip *is* one region, the same "one clip, one thing" shape synth/drum clips already
have for notes/hits.

```
track <id> <name> <color> audio
  clip <clip-id>
    audio <media-id> <in> <out> <gain dB> <warp> <rate>
    auto <track-id>.gain              # optional; v0.9 automation-lane grammar, unchanged
      point <id> <time> <value>
```

Worked example:

```
media
  sample smp_drumloop sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a1 media/drumloop.wav

track solo Solo #e5c07b audio
  clip take-a
    audio smp_drumloop 0 8 -3 repitch 1.5
    auto solo.gain
      point p1 0 -3
      point p2 4 0
```

### Field-by-field

The `audio` line is **one bundled event, all six fields always present** — no canonical elision.
This deliberately follows the `note`/`hit` discipline (`format-spec.md`'s "why notes are
positional" section), not the ~50-field `SYNTH_FIELDS` elision discipline: a region's fields are
small, fixed, and edited together (a trim gesture changes `in`/`out` together — that's one edit,
and one line is the right diff granularity), the same reasoning that keeps a note's five fields on
one line instead of exploding into `note.pitch` / `note.start` / ... sub-lines.

| field | type | meaning |
|---|---|---|
| `media-id` | `BeatMediaSample` id | which registered sample (v0.5 `media` block) |
| `in` | seconds ≥ 0 | in-point — where in the **source file** the region starts |
| `out` | seconds > `in` | out-point — where in the source file the region ends |
| `gain dB` | number | static clip gain (the audio-clip analog of a mixer fader — not note velocity, see research 16 §3); default `0` |
| `warp` | `off \| repitch \| complex` | pitch/tempo relationship; default `off` |
| `rate` | number, `0.1`-`8` | playbackRate multiplier; meaningful only when `warp = repitch`; **must be exactly `1`** when `warp` isn't `repitch` — enforced at both parse and edit time (one canonical form per state, D4) |

`in`/`out` are seconds into the **source media**, not timeline steps — they describe which span of
the file plays, independent of tempo. This matters for the modes that don't warp: `off` plays the
span at its native rate; a document's `bpm` has no bearing on how long that takes in real time.

`warp: complex` is a **legal enum value with no implementation yet**. It's structurally reserved
(same move as `markers`, below) for the signalsmith-stretch integration research 16 §8 sequences as
its own future stream — picking it today is valid grammar, but the engine plays it back unwarped
(same as `off`) until that stream lands. This is documented, not silent: `BeatAudioRegion`'s doc
comment in `document.ts` says so explicitly, and the roadmap row for "Warp markers + Complex-mode
stretch" stays `not-started`.

`markers: BeatAudioWarpMarker[]` exists on the type (an ordered `(sourceTime, timelineTime)` list,
the same shape a v0.9 automation point already establishes) but is **always `[]` this stream** — no
`marker` line grammar shipped, no parser/edit-primitive support. Reserved so the eventual warp-marker
stream is a pure grammar *addition*, not a breaking change to `BeatAudioRegion`.

### Why clip-only (no live/non-clip audio content)

Every other content type (`note`, `hit`) exists both on the live track (`BeatTrack.notes`/`.hits`,
what plays in loop mode) and inside clips (song-mode arrangement). Audio regions were scoped
**clip-only** this stream: `BeatTrack` gets no `audio` field, only `BeatClip.audio?`. Consequences:

- An audio-region clip only plays when reachable through a scene + song section (`contentOf()` in
  `ui/src/audio/engine.ts` returns `audio: null` unconditionally in loop mode for every track kind).
- A freshly-created `audio` track starts with `clips: []` and plays nothing until a clip is added —
  same as a drum track with no lane samples assigned.

This cut real complexity (no live-region parse/serialize/edit-primitive surface, no engine branch
for triggering outside song mode) without narrowing anything the plan asked for — every verification
scenario in the task brief is phrased in terms of a clip. If a later stream wants "audio scratch
space" parity with notes/hits, it's an additive `BeatTrack.audio?` field, not a breaking change.

## Format-layer implementation

- **`src/core/document.ts`**: `TrackKind` widened to include `'audio'`; new `WarpMode`,
  `WARP_MODES`, `AUDIO_RATE_MIN`/`MAX`, `BeatAudioWarpMarker`, `BeatAudioRegion`,
  `AUDIO_AUTOMATABLE_PARAMS = ['gain']`; `BeatClip.audio?: BeatAudioRegion`.
- **`src/core/parse.ts`** / **`serialize.ts`**: `audio` line parse/serialize (fixed 7-token line,
  strict validation — `out > in`, `warp` enum, `rate` bounds + the repitch-only-rate-≠-1 canonical
  check); an `audio`-kind track skips the synth block, lane samples, and note/hit lines entirely
  (mirrors how instrument tracks skip the synth block); every clip on an audio track must carry an
  `audio` line (fail-loud, same stance as an instrument track missing its `soundfont` line); every
  region's `media` must resolve against the document's `media` block (same discipline as instrument
  soundfonts and drum lane samples).
- **`src/core/diff.ts`**: `audio-region-added` / `-removed` / `-changed` (field-itemized, like
  `hit-changed`) diff entries; a brand-new clip still reports as the existing `clip-added` (a
  clip is a snapshot — the region-level entries fire when a clip's region changes or
  appears/disappears on a *persisting* clip id, the same "itemize what's specific, don't itemize
  what's a re-snapshot" split notes/hits already draw).
- **Format version bumped to `0.10`** (`initDocument`'s default, `convert.ts`'s
  `BEAT_FORMAT_VERSION`) — a real grammar addition, not a footnote.

## Edit primitives (`src/core/edit.ts`)

- **`addAudioClip(doc, trackId, clipId, region)`** — creates or replaces a clip with a region in
  one call (defaults: `gainDb=0`, `warp='off'`, `rate=1`). The direct, one-shot creation path
  (mirrors `addNote`/`addHit`'s directness); `saveClip`'s generic "snapshot whatever's live"
  pattern doesn't apply here (no live content to snapshot from).
- **`setClipAudioRegion(doc, trackId, clipId, changes)`** — trims one or more fields on an
  *existing* clip's region directly. Switching `warp` away from `'repitch'` silently normalizes
  `rate` back to `1` unless the caller also passes an explicit rate in the same call (one canonical
  form per state, applied automatically rather than making every caller remember it).
- **`splitAudioClip(doc, trackId, clipId, atSteps, opts?)`** — split-at-point. `atSteps` (fractional
  16th steps from the clip's own start — same unit note/hit `start` already uses) converts to
  source-media seconds via `sourceSplit = in + atSteps × stepSeconds × rate` (repitch changes how
  much source material elapses per timeline second, so the conversion has to account for it). The
  first half keeps the clip id with `out` trimmed to the split point; the second half is a new clip
  (`<id>-2`, `<id>-3`, ... unless `newClipId` is given) inserted immediately after the first.
  Gain-automation points partition by time — before the split stay on the first clip; at/after move
  to the second, **retimed relative to its own new start** (`time - atSteps`) — the same "survive
  the split, attached to whichever segment they fall in" discipline research 16 §2 documents for
  warp markers (not built, but automation already behaves this way).
- **Gain automation reuses `addAutomationPoint`/`moveAutomationPoint`/`removeAutomationPoint`/
  `setAutomationPoint` completely unchanged** — `checkAutomatableParam` grew a track-kind branch
  (`audio` → `AUDIO_AUTOMATABLE_PARAMS`, everything else → `AUTOMATABLE_SYNTH_PARAMS`), and that's
  the entire diff. This **confirms research 16 §3's prediction** ("would very likely just plug into
  the existing automation-lane machinery rather than needing new grammar") rather than merely
  assuming it.
- **`setValue` path grammar** (the `beat set` / `POST /edit` surface): `<track>.clip.<id>.audio`
  (value `"<media> <in> <out> [gainDb] [warp] [rate]"`) creates/replaces a region;
  `<track>.clip.<id>.audio.<field>` (`field` ∈ `media|in|out|gainDb|warp|rate`) trims one field —
  the same shape `<track>.note.<id>.<field>` already establishes for notes. This is what lets the
  GUI's trim fields and the CLI's `beat set` reuse one code path with no new daemon route.

## Engine (`ui/src/audio/engine.ts`)

One `Tone.Player` per `'audio'`-kind track (`AudioTrackVoice`: player → dedicated `muteGain` →
master, plus a `levelTap` for the mixer meter — the same per-track shape `SynthChain`/
`InstrumentVoice` already use). A **content-addressed buffer cache** (`Map<mediaId,
Tone.ToneAudioBuffer>`) shared across every track/clip referencing the same sample, matching the
format's own content-addressing; `syncAudioTracks()` (called from `sync()`, mirroring
`syncInstruments()`) pre-fetches every media id any audio track's clips currently reference via the
daemon's existing `GET /media/<path>` route (no new bytes-serving path needed).

`Content` (the per-tick resolved-playable-content shape) grew an `audio: BeatAudioRegion | null`
field, populated by `contentOf()` from the active clip in song mode (always `null` in loop mode or
for other track kinds). `tick()`'s new `audio`-kind branch: at `contentStep === 0` (the same
loop-wrap signal notes/hits already tile on — an audio-track clip retriggers every `loopBars`
within a longer section, exactly like a note/hit pattern would), swap the player's buffer if the
active region's media changed, set `playbackRate` from `rate` (only when `warp === 'repitch'`,
else `1`), set `volume` from `gainDb` (or the interpolated gain-automation value), and
`player.start(time, region.in, region.out - region.in)` — `offset`/`duration` in **source-buffer
seconds**, unaffected by `playbackRate` (the same semantics the native
`AudioBufferSourceNode.start(when, offset, duration)` Tone.Player wraps already has). Mid-region
gain-automation ramps use `volume.linearRampToValueAtTime(...)`, the same discipline every other
automated synth param already uses.

## CLI / MCP

- `beat add-track <file> <id> audio` — already worked with zero CLI changes (kind was always
  forwarded generically to `addTrack`); the usage string and `--kind` enum were updated to mention
  it.
- `beat audio-clip <file> <track> <clip> <media> <in> <out> [gain] [warp] [rate]` — wraps
  `addAudioClip`. Trims go through the existing `beat set <track>.clip.<id>.audio.<field> <value>`.
- `beat audio-split <file> <track> <clip> <at-step> [--id new-clip-id]` — wraps `splitAudioClip`.
- MCP: `beat_audio_clip`, `beat_audio_split` (same shape as their CLI counterparts);
  `beat_add_track`'s `kind` enum widened to include `'audio'`.
- Daemon: one new route, `POST /audio-split` (mirrors the existing `/song` route's shape — an
  additive op that can't fit the `{path,value}` `/edit` grammar since it produces two clips, not
  one field). Everything else (`GET /document`, `POST /edit` for trims, `POST /add-track`) needed
  no daemon changes at all.

## GUI (`ui/src/components/ArrangementView.tsx`)

Shipped:

- `audio` is a selectable track kind in the "+ track" menu.
- Audio-region clips render as **flat-colored, labeled blocks** on the arrangement canvas (media id
  + warp mode, dark edge markers standing in for in/out handles) — the minimum-viable visual the
  task brief explicitly allowed.
- A **split-at-playhead button** (✂) next to the automation toggle: finds whichever section
  occurrence the playhead currently sits over, converts to a clip-relative step, calls
  `POST /audio-split`.
- An **`AudioClipInspector`** strip under the track (in/out/gain/warp/rate as number/select fields)
  for trimming — posts through the ordinary `<track>.clip.<id>.audio.<field>` `setValue` path, with
  an optimistic local mirror in `bridge.ts` for instant feedback.
- Gain automation reuses the existing `AutomationLane` canvas component unchanged (a `'gain'` entry
  in `AUTO_OPTIONS_BY_KIND`, a dB-ranged `specFor('gain')` case) — draggable breakpoints, same as
  any synth param's automation lane.

**Honest gap**: no canvas drag-to-trim handles and no waveform rendering. The in/out edge markers
on the clip block are visual only; trimming is via the numeric inspector fields, not a pointer
drag on the block itself. Building real drag-handle hit-testing on the canvas (plus, ideally, a
waveform min/max-per-pixel LOD render) is a real UI engineering lift the task brief flagged as
acceptable to defer ("a flat-colored block with in/out handles is an acceptable v1, note the gap
honestly") — tracked as the roadmap's separate "Region-level fade in/out handles" row (still
`not-started`) and worth folding a drag-handle pass into whenever that's picked up. Roadmap rows
for this stream are marked `gui: 'done'` where the underlying capability is fully reachable through
the GUI (repitch controls, split, gain — all real fields/buttons, not stubs) and `gui: 'partial'`
only for the format/visualization row itself, where the flat-block-not-waveform gap actually lives.

## Verification

- **`test/format-v10-audio.test.ts`** (41 tests) — grammar round-trip, canonical-form validation
  (rate-must-be-1 enforcement, out>in, warp enum, media-must-be-registered), every edit primitive
  (`addAudioClip`/`setClipAudioRegion`/`splitAudioClip`/the `setValue` paths), gain-automation reuse
  (including the negative case: synth params rejected on audio clips and vice versa), diff output,
  `describeDocument` output.
- **`test/mcp.test.ts`** — `beat_add_track(kind: audio)`, `beat_audio_clip`, `beat_audio_split`
  over the real JSON-RPC subprocess protocol, including an error-path (`isError`) case.
- **`test/daemon.test.ts`** — `POST /audio-split` over real HTTP, including the 400/no-write path
  for an out-of-range split.
- Full suite: 342/342 passing (`npm test`).
- **Live verification** (`ui/verify-phase22-audio-region.mjs`): boots the real daemon + the real
  built `ui/` in headless Chromium, drives `window.__engine` directly against a real media file
  (`presets/kit-init/kick.wav`, sha256-registered), and measures the *rendered audio*, not the
  stored params:
  - **Repitch**: off (rate 1) vs. repitch ×1.5, three independent capture pairs, MEDIAN spectral
    centroid ratio ~2.3× (comfortably >1.2, confirming a real, large pitch shift, not noise around
    1.0×; a single-trial measurement swung 1.7×-4× run to run — the median-of-3 is what actually
    made the check reliable, see the methodological note below).
  - **Trim**: a clip trimmed to stop at 0.04s vs. left at its near-full 0.26s — the untrimmed
    render carries measurably more signal (>8dB) at a point in time the trimmed one has already
    stopped playing.
  - **Split**: `splitAudioClip`'s own in/out math verified directly, then each half rendered
    independently — both start with real, audible signal (not silence) and the first half's
    audible duration matches its trimmed length.
  - **Gain**: static 0dB vs. −12dB — rendered peak drops ~10-15dB. A flat-gain render vs. a
    0dB→−24dB automation ramp — the ramped render's windowed RMS is measurably quieter than the
    flat one's, over the same window.
  - Multiple consecutive full runs, all checks passing every time.
  - **Real methodological lessons surfaced and fixed along the way**: (1) `engine.recordWav()`
    only captures from whenever it's called, with no sample-accurate handshake to the
    already-running transport, so a short one-shot region can finish playing before capture even
    starts — fixed by looping the transport (`loopBars=1`) and searching the capture for a
    cleanly-bounded retrigger via onset detection rather than assuming a fixed offset; (2)
    computing spectral centroid over a mostly-silent multi-second buffer is numerically unstable —
    fixed by cropping to a tight signal-dense window before calling `analyze()`; (3) even after
    both fixes, a SINGLE centroid measurement of a short transient through the lossy real-time
    (opus) capture still varies run to run — fixed by taking the median of 3 independent capture
    pairs rather than trusting one sample. All three are worth remembering for any future
    engine-verification script that renders short one-shot content.

## Explicitly not built this stream

Warp markers (the type is reserved, no grammar/primitives), Complex-mode stretch (needs
signalsmith-stretch — a separate dependency, deliberately not added), beats-mode transient slicing,
native audio recording, multi-take comping. All stay `not-started` in `scripts/roadmap-data.mjs`,
untouched by this stream.

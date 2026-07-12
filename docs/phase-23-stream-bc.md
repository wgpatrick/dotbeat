# Phase 23 Stream BC — audio-region clip GUI polish

*Built 2026-07-11. Closes the "Audio-region clip format" row's GUI gap Phase 22 Stream AE left open
(`docs/phase-22-stream-ae.md`'s own "Honest gap" note): drag-to-create-audio-clip from the content
browser, and a basic waveform render in the clip inspector so the in/out trim fields mean something
at a glance. Stream AE already shipped repitch/split/gain editing for an ALREADY-existing clip — this
stream is the other half, clip *creation*, plus visualization.*

## Scope

In scope (per `docs/phase-23-plan.md`'s BC section):
- Drag an audio file from the content browser (`ui/src/components/ContentBrowser.tsx`, Phase 22
  Stream AH) onto an `audio`-kind track to create a clip, calling `addAudioClip`.
- A basic static waveform render in the clip view, replacing "numeric fields only, no visual
  waveform, trim points hard to reason about."

Explicitly out of scope (unchanged from the plan): region-level fade in/out handles (a separate
future row, still `not-started`), and anything warp-marker or beats-mode related (gated on research
streams RA/RB running in parallel this phase).

## What counts as "an audio file" in the content browser

The content browser (Stream AH) has no general "browse arbitrary audio files from disk" section —
its content is presets, kit one-shots, and SoundFont banks. Kit one-shots
(`presets/kit-*/<lane>.wav`) ARE real, standalone audio files, so this stream reuses them as the
drag source rather than adding a new library section: dragging `kit-init`'s kick or snare (etc.) onto
an audio track creates a clip from that exact wav. The mechanism doesn't care that these particular
files are short one-shots rather than long loops — a future stream that adds a general "loops/samples"
library section gets clip creation for free through the same drop handler.

## Drag protocol: reused, not reinvented

Per the task brief's explicit instruction, this stream reuses `ui/src/daemon/library.ts`'s existing
drag-payload protocol (`LIBRARY_DND_MIME`, `DragPayload`, `setDragPayload`/`readDragPayload`) rather
than inventing a new one. The existing `{type: 'kit-lane', kit, lane}` payload — already set on drag
start by `ContentBrowser.tsx`'s `KitLaneRow` for the drop-onto-a-drum-lane interaction — is now ALSO
handled by a new landing zone: an `audio`-kind track's header
(`ui/src/components/ArrangementView.tsx`'s `TrackRow.handleLibraryDrop`). No new MIME type, no new
payload shape.

## Where the new clip lands: reusing the "primary occurrence" convention

A header drop carries no bar/position signal (unlike the canvas, "drop on the header" isn't "at bar
N"). Rather than build new position-picking UI, the target clip is resolved with the same "primary
(first-playing) occurrence" convention every other per-track panel in this file already uses
(`audioOccurrences[0]`, the same lookup `AudioClipInspector`, `AutomationLane`, and
`splitAudioAtPlayhead` all key off):

- **The track already has an occurrence** (already slotted into some scene): the drop **replaces**
  that clip's region in place — dropping a new sample onto a clip re-fills its content, the same
  mental model a preset drop re-applying params in place already establishes. No scene write.
- **The track has no occurrence yet** (a fresh audio track): the drop **mints a new clip** and slots
  it into the **first song section's scene**, so it's immediately visible on the arrangement canvas.
- **Loop mode** (no song block at all — no scene exists to slot into): the drop is **refused** with a
  clear message ("Add a song section first…") rather than silently creating an orphan clip nothing
  can reach. Audio-region clips are song-mode-only by Stream AE's own design (`BeatTrack` carries no
  live `audio` field), so this isn't a new limitation, just an honest surfacing of an existing one.

## A real bug the drag-drop flow surfaced (and fixed)

Building the live verification script (below) hit a genuine, pre-existing crash: converting loop
mode to song mode (`POST /song append`, `src/daemon/daemon.ts`'s `sceneFromLiveContent`) iterated
**every** track and called core's `saveClip` to snapshot its live content into the new scene —
including `audio`-kind tracks, which structurally have no live content to snapshot (Stream AE:
"`BeatTrack` gets no `audio` field, only `BeatClip.audio?`"). `saveClip` happily produced a clip with
no `audio` line; the very next `writeIfChanged` round-trip (`serialize` then re-`parse`) then
**rejected that document outright** — the parser requires every clip on an audio track to carry an
`audio` line, the same fail-loud stance an instrument track missing its `soundfont` line already gets
— 500-ing the whole `/song` route. This wasn't hypothetical: it reproduced immediately the first time
the verify script tried to add a song section on a project with an empty audio track present, which
is exactly the natural order a user would hit (add an audio track, then arrange it into a song).

Fixed by skipping `audio`-kind tracks in `sceneFromLiveContent`: they simply start **unmapped** in a
freshly-converted scene (silent that section, same as any track legitimately absent from a scene's
slot map — an established, already-handled state everywhere else in the codebase), rather than
getting a phantom, invalid clip. A track stays silent until a real region is created and slotted —
exactly what this stream's drag-to-create interaction now does. Covered by a new regression test in
`test/daemon.test.ts`.

## Waveform render (`ui/src/audio/waveform.ts`)

A small, standalone decode-and-cache module, deliberately independent of
`ui/src/audio/engine.ts`'s own `audioBuffers` cache (Stream AE's decode-for-*playback* path): that
cache is private, populated lazily off the engine's tick-driven `sync()`, with no "decode this
specific media right now" entry point a UI component can poll cleanly. `waveform.ts` instead
fetches+decodes independently — the same `GET /media/<path>` route, the same `decodeAudioData` call
— and caches by media id so re-rendering the inspector (every trim-field edit) doesn't re-fetch.

`drawWaveform(canvas, waveform, inSec, outSec, color)` draws a static min/max-per-pixel-column render
onto the canvas's full CSS box: for each pixel column, the min/max sample value in that column's
slice of the decoded buffer becomes a vertical stroke. Whatever falls outside `[inSec, outSec]`
(today's trim points) renders dimmed; the two boundaries get a vertical marker line. This is
deliberately the same LOD idea `ArrangementView.tsx`'s own note/hit density rendering already uses
("the audio-waveform min/max-per-pixel LOD idea generalized to notes" — Stream AE's own comment,
now built for real audio). No zoom/scroll, no drag-to-trim on the waveform itself — same deferred
lift as the region-level fade-handle row.

`AudioClipInspector` (`ArrangementView.tsx`) grew a `<canvas className="arr-audio-waveform"
data-audio-waveform={clip.id}>` above its existing numeric in/out/gain/warp/rate fields (now wrapped
in their own `.arr-audio-inspector-fields` row so the canvas can sit full-width above them). A
`data-waveform-ready` attribute flips to `"true"` once the decode completes — what the live
verification script polls on before sampling pixels.

## GUI (`ui/src/components/ArrangementView.tsx`, `ui/src/components/ContentBrowser.tsx`)

- `TrackRow`'s `handleLibraryDrop` gained an `audio`-kind branch for the existing `kit-lane` payload
  type: validates a single lane was dragged (not a whole kit — "one clip, one sample"), resolves the
  target clip/scene per the convention above, and calls the new `installAudioClip` client helper.
- `ui/src/daemon/library.ts` gained `installAudioClip(track, kit, lane, {clipId?, sceneId?})`,
  posting to the new daemon route below and applying the returned document to the store — same
  `postLibrary`-adjacent convention `installKitLane`/`installSoundfont` already establish.
- `ContentBrowser.tsx`'s kit-lane row title updated to mention the new drop target
  ("drag onto a drum lane, or onto an audio track to create a clip").

## Daemon (`src/daemon/daemon.ts`)

New route: `POST /library/install-audio-clip {track, kit, lane, clipId?, sceneId?}`. Reuses the exact
same copy-into-project-media/register/content-address discipline `install-kit` already established
just above it in the file (copies the wav into the project's own `media/`, sha256-registers it via
`setMediaSample` — never referenced by its `presets/` path). Two new pieces:
- **Real duration, not a guess**: reads the wav's own duration via `src/metrics/wav.ts`'s
  `decodeWav` (already used by the mix-metrics/MCP surface — a pure binary parse, no audio context,
  reused rather than re-implemented) to size the region's initial `out` to the file's actual length.
- **Create-or-replace via `addAudioClip`**: `clipId` given replaces that clip's region in place;
  omitted mints the next free `clip<n>` id (`nextFreeClipId`, same "mint the next free numbered id"
  idiom `splitAudioClip` already uses for its second half) and, if `sceneId` is also given, slots it
  into that scene — merged into the scene's *existing* slots via `setScene`, never clobbering other
  tracks' slots in the same scene.

## Verification

- **`test/content-library.test.ts`** (+5 tests): the new route's happy path (mint + register + real
  duration + slot into the given scene), replace-in-place (existing `clipId`, scene untouched),
  create-with-no-sceneId (loop-mode-safe, clip created but unslotted), rejects a non-audio track,
  rejects an unknown kit/lane.
- **`test/daemon.test.ts`** (+1 test): the `sceneFromLiveContent` regression fix — converting loop to
  song mode with an audio-kind track present no longer 500s; the audio track stays unmapped with zero
  clips, in-memory-equals-disk still holds.
- Full suite: 496/496 passing (`npm test`).
- **Live verification** (`ui/verify-phase23-stream-bc.mjs`): boots the real daemon + the real built
  `ui/` in headless Chromium against a copy of `examples/night-shift.beat`, and drives the actual
  drag-and-drop gesture (not `window.__engine`/in-memory doc injection) end-to-end:
  - **T1**: opens the content browser, adds a fresh `audio` track via the real "+ track" menu.
  - **T2**: dropping a kit one-shot onto it while still in loop mode is refused with a clear alert;
    the `.beat` file is byte-identical before/after.
  - **T3**: "+ section" converts to song mode; confirms the fresh audio track stays unmapped with
    zero clips (the bug-fix above, exercised for real, not just at the unit level).
  - **T4**: dropping kit-init's kick now creates a real region — a literal `audio kit-init-kick 0 …`
    line lands in the `.beat` file, the wav is copied into the project's own `media/`, `in=0` and
    `out` matches the wav's real duration (not a placeholder), `warp=off`/`rate=1` defaults, the new
    clip is actually slotted into the section's scene (not just created and orphaned), and it's the
    only clip on the track (no duplicate).
  - **T5**: the waveform canvas is sampled for real pixel data (not just DOM presence) — confirms
    painted (non-transparent) pixels and hundreds of distinct colors, ruling out a blank/no-op
    render.
  - **T6**: dropping a second one-shot (snare) replaces the region in place — still exactly one clip
    on the track, now carrying the new media.
  - All checks pass on repeated runs.

## Explicitly not built this stream

Region-level fade in/out handles, drag-to-trim on the waveform or clip block itself, warp markers,
Complex-mode stretch, beats-mode transient slicing, a general "browse arbitrary audio files/loops"
content-browser section (today's drag source is kit one-shots specifically). All stay `not-started`
or unchanged in `scripts/roadmap-data.mjs`, per the plan's explicit scope boundary.

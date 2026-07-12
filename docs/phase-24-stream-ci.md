# Phase 24 Stream CI — place a clip into the arrangement for the first time

*Built 2026-07-11. The owner's own framing: "I can't drag it into the arrangement." Phase 23 Stream
BC (`docs/phase-23-stream-bc.md`) already solved this for AUDIO clips — dragging a sample from the
content browser onto a track header. This stream generalizes the SAME mechanism to synth/drum clips
authored right in `NoteView.tsx`, which have no external file to drag in in the first place.*

## Scope, and the line against Stream CC

`docs/phase-24-plan.md`'s CI section is explicit: Stream CC (clip visibility + cross-track
select-and-drag-move) handles clips that **already have at least one occurrence** somewhere in the
song. This stream is the **first** placement of a clip that appears in **zero** scenes yet. At the
time this stream STARTED, no `docs/phase-24-stream-cc.md` existed in any worktree (checked directly —
no worktree under `.claude/worktrees/` carried that file), so there was no landed clip-drag machinery
to reuse. The two stay cleanly separated by construction: CI's new daemon route
(`POST /place-clip`) only ever WRITES a clip that's either brand new or was already the track's own
"primary occurrence" being re-saved in place (see below) — it never moves a clip between tracks or
sections, which is squarely CC's Part 2. If CC lands a general clip-drag/drop surface later, the
"drag straight from NoteView onto a track row" version of this stream's affordance becomes easy to
build on top of it — noted here for whoever picks that up next, not attempted in this stream (see
"Why a button, not a drag gesture" below).

**Update, discovered before finishing (main moved while this stream was in progress):** by the time
this stream's own work was done, `main` had already gained Stream CC (`6fe5858`, clip visualization +
`/clip-move`), Stream CJ (`a1408bd`, per-clip loop length), and Stream CE (`eb79dea`, loop
region/click-seek) — this worktree was branched from `main` BEFORE those landed and was never rebased
mid-stream (per the phase's own process notes, a worktree checks its base once at the start, not
continuously). Checking those diffs directly: **CC's new route is `POST /clip-move`**, entirely
separate from this stream's `POST /place-clip` — no route-level collision. There IS a real, and
genuinely funny, convergent-evolution collision: **Stream CJ independently exported the exact same
`primaryClipFor` from `ClipPropertiesPanel.tsx` into `NoteView.tsx`**, for the same reason this stream
did (its own drag-handle needed the same "which clip is this track's primary occurrence" lookup) — a
merge follow-up commit (`2206e2b`) already had to dedupe a THIRD independent copy (Stream CG's own
local one). Whoever merges this worktree into `main` should expect a textual conflict on
`ClipPropertiesPanel.tsx`'s `export function primaryClipFor` line (trivial — both sides export the
identical function, keep either) and on `NoteView.tsx`'s import list and toolbar JSX (CJ added a
`.noteview-cliploop-handle` drag affordance to the same file's clip canvas; this stream added a
`.place-clip-btn` to the toolbar a few lines away — additive, not overlapping regions, so a mechanical
concatenation should resolve it, per the phase's own established merge taxonomy). Not resolved here —
this stream's job was its own worktree, not merging four parallel streams together.

## Why a button, not a drag gesture

The plan explicitly allows either "a direct drag gesture from the clip editor onto a track/section in
the arrangement" or "an equally discoverable button/action" performing BC's same operation. A real
cross-pane HTML5 drag (NoteView, the bottom pane → a track header, the top pane) would need its own
drag-source wiring — `draggable`, `onDragStart`, a payload — duplicating `ui/src/daemon/library.ts`'s
existing `LIBRARY_DND_MIME` protocol (or inventing a second one) for a gesture that, in dotbeat's
single-page layout, drags from one visible pane to another already-visible pane a few hundred pixels
away. A button in `NoteView.tsx`'s own toolbar gets the same outcome — "slot this clip into a scene"
— with far less new surface area, and it's exactly as discoverable (it's the first thing right of the
existing "Delete" button, in the same toolbar row the owner is already looking at while authoring the
clip). This matches the plan's own permission to prefer a button "if a cross-pane drag is awkward
given dotbeat's single-page layout."

## The mechanism: generalizing BC's precedent exactly

BC's read of `ArrangementView.tsx`'s `handleLibraryDrop` (its own comment, "Phase 23 Stream BC"):

> reuse an existing occurrence if the track already has one, else mint a new clip and slot it into
> the FIRST song section's scene — refused with a clear message in loop mode, where there's no scene
> to slot into yet (add a song section first).

CI's "Place in Arrangement" button, `ui/src/components/NoteView.tsx`'s `placeInArrangement()`, does
the identical three-way branch, just with a different content SOURCE:

- **BC (audio)**: the dragged-in file's bytes become the clip's content (`addAudioClip`).
- **CI (synth/drums/instrument)**: the track's own LIVE content — `track.notes`/`track.hits`, what
  `NoteView.tsx` has been editing this whole time — becomes the clip's content (`saveClip`). There's
  nothing to "drag in" because the content already lives on the track; placing it is purely a
  snapshot-and-slot operation.

Both cases resolve the target clip id via the exact same "primary occurrence" convention every other
per-track panel in `ArrangementView.tsx` already uses (`primaryClipFor`, `ClipPropertiesPanel.tsx` —
now `export`ed so `NoteView.tsx` can reuse it instead of a third copy of the same four-line lookup):

- **The track already has an occurrence** (already slotted into some scene): re-place **updates that
  clip in place** — re-snapshotting the track's current live content over it. This is deliberately
  the same "drop a new sample re-fills the existing clip" mental model BC establishes, and it
  incidentally gives the owner a manual fix for exactly the kind of staleness bug
  `docs/phase-24-plan.md`'s own "Already fixed directly" section describes (a clip's saved snapshot
  drifting out of sync with the track's live content, fixed there via the CLI's `beat clip`) — now
  reachable from the GUI with one click, no CLI needed.
- **The track has no occurrence yet** (the genuine "first placement" case this stream targets): mints
  a new clip (`clip<n>`, `nextFreeClipId`) and slots it into the **first song section's scene**.
- **Loop mode** (no `song` block at all): refused client-side with the same wording pattern BC uses —
  *"Add a song section first (\"+ section\") — clips only play once slotted into a song-mode
  scene."* — before any network call, so a loop-mode click writes nothing.

## Daemon: `POST /place-clip` (`src/daemon/daemon.ts`)

`{track: string, clipId?: string, sceneId?: string}` → `{written, doc, clipId}`. Sits right next to
BC's `POST /library/install-audio-clip` and mirrors its shape deliberately:

- `clipId` given → `saveClip` re-snapshots that existing clip (BC's "replace in place").
- `clipId` omitted → mints the next free id via the same `nextFreeClipId` helper BC's route already
  uses (unexported, module-local — this route just calls it directly, no new export needed).
- `sceneId` given → `setScene(doc, sceneId, {...existingSlots, [track]: clipId})`, the same
  merge-not-replace read-then-write BC's route uses, so placing one track's clip into a scene never
  clobbers another track's slot in the same scene (covered by a dedicated test, see below).
- `sceneId` omitted → the clip is created/updated but not reachable from any section (same
  "created but not yet placed" state BC documents for its own loop-mode-safe path).
- `track.kind === 'audio'` → 400, pointing at `install-audio-clip` instead — an audio track has no
  live `notes`/`hits` to snapshot (Phase 22 Stream AE: `BeatTrack` carries no live `audio` field).

The route itself has **no opinion about loop mode** — same division of labor as BC: the client
refuses first (see below), the route just needs a real track and, if slotting, a real scene. This
keeps the route reusable as a plain "snapshot this track's live content" primitive independent of
whatever refusal wording the GUI wants to show.

## Client: `postPlaceClip` (`ui/src/daemon/bridge.ts`) + the button (`ui/src/components/NoteView.tsx`)

`postPlaceClip(track, {clipId?, sceneId?})` follows `postAudioSplit`'s exact shape (an additive route
next to the `{path,value}` `/edit` primitive) but, like `installAudioClip`, applies the daemon's
returned document straight to the store rather than re-pulling `/document` — the daemon returns the
full doc in one round trip already.

`NoteView.tsx` gained:
- `const doc = useStore((s) => s.doc)` (previously only reachable via other hooks indirectly).
- `existing = doc ? primaryClipFor(track, doc) : null` — imported from `ClipPropertiesPanel.tsx`
  (now exported) rather than a third local copy.
- `placeInArrangement()` — the loop-mode refusal, then `postPlaceClip(track.id, {clipId: existing?.id,
  sceneId: doc.song[0].scene})`.
- A toolbar button, `data-place-clip={track.id}` / `data-place-clip-state="unplaced"|"placed"`,
  hidden for `audio`-kind tracks (which never reach this code path usefully — `install-audio-clip` is
  their mechanism). Label and color read the current state at a glance: amber **"Place in
  Arrangement"** when unplaced, a muted **"Placed (clip \"…\") — update"** once an occurrence exists —
  still clickable (the re-save branch), but visually reads as "done," not "do this."

## Verification

- **`test/place-clip.test.ts`** (+5 tests): mint-and-slot with the right notes carried over;
  re-place-in-place reuses the same clip id and, run against a scene TWO tracks are already slotted
  into, leaves the other track's slot untouched; no-`sceneId` still creates an unslotted clip
  (loop-mode-safe); rejects an `audio`-kind track; rejects an unknown track id.
- Full suite: **550/550 passing** (`npm test`; 545 pre-existing + 5 new).
- Both typechecks clean (`npx tsc -p tsconfig.json --noEmit` at the repo root, `npx tsc --noEmit` in
  `ui/`).
- **Live verification** (`ui/verify-phase24-stream-ci.mjs`): boots the real daemon + the real built
  `ui/` in headless Chromium, driving actual clicks/pointer events against real `.beat` fixtures — not
  `window.__store`/in-memory doc injection for the interaction itself:
  - **T1**: clicking "Place in Arrangement" on a track with real content, in a project with no `song`
    block at all (`examples/night-shift.beat`), is refused with the "add a song section first" alert;
    the `.beat` file is byte-identical before/after.
  - **T2**: a synth track added via the real "+ track" menu **after** `examples/night-shift-song.beat`
    already entered song mode has zero clips and occurs in zero scenes — the genuine "first
    placement" state (distinct from a track that was present when the project first converted to
    song mode, which `daemon.ts`'s `sceneFromLiveContent` auto-snapshots at that moment — this stream
    covers the case that auto-conversion never reaches).
  - **T3**: authors 3 real notes via actual pointer clicks on `.noteview-grid` (not injected), reads
    their real pitches/starts back from the resolved document, mutes every OTHER track (session-only,
    the real `isEffectivelyMuted` audio gate), and renders the song's first section through the
    page's own live engine (`window.__engine.play()`/`recordWav`, the same technique `cli/render.mjs`
    uses) — confirms near-silence, since this track has zero occurrences anywhere yet.
  - **T4**: clicking "Place in Arrangement" — the resolved document state changes: the first
    section's scene now slots the track to a real clip, and that clip's notes match what was
    authored exactly (not just "a clip exists"). The `.beat` file gains a literal `slot <track>
    <clip>` line.
  - **T5**: AUDIO proof — re-rendering the same solo-muted section AFTERWARD shows a real, sharp jump
    in peak level (silence → real signal, ≥10 dB) — the placed clip is genuinely part of what plays
    (`engine.ts`'s `contentOf` resolution), not just a file fact.
  - **T6**: authors a 4th note, clicks the button again (now in "placed" state) — the SAME clip id is
    re-saved in place (still exactly 1 clip on the track, no orphan/duplicate minted), matching BC's
    "reuse an existing occurrence" precedent.
  - All checks pass on repeated runs.

### A race the live script surfaced (script-side, not a product bug)

`ui/src/daemon/bridge.ts`'s `postEdit` mirrors an edit into the CLIENT's Zustand store optimistically
and instantly, then sends the real write to the daemon on a separate 60ms-debounced timer. The first
draft of the verify script polled the CLIENT's store to decide "the authored note has landed," then
immediately clicked "Place in Arrangement" — which triggers a DAEMON-side read of `track.notes`. That
raced the debounced `/edit` POST: the daemon could still be holding the PREVIOUS note count when
`/place-clip` executed, snapshotting stale content. Fixed by adding `daemonDocNow()`, which polls the
daemon's own `GET /document` directly, and gating any daemon-triggering action on THAT resolving,
not the optimistic client mirror. No product code changed for this — `postEdit`'s optimistic-then-
debounced design is correct and intentional (Phase 13-era, documented at the top of `bridge.ts`); this
was purely a test-harness ordering bug.

## Explicitly not built this stream

A real cross-pane HTML5 drag gesture from `NoteView.tsx` onto `ArrangementView.tsx`'s track rows (see
"Why a button, not a drag gesture" above — left as a follow-on if CC's own drag machinery makes it
cheap later). Placing into a section OTHER than the first one, or choosing which existing occurrence
to update when a track appears in more than one scene — both are CC's Part 2 territory (cross-track
selection and drag-move of ALREADY-placed clips), not this stream's "first placement" scope.

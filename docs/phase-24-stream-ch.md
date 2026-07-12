# Phase 24 Stream CH — audition a clip in isolation

*2026-07-11. Owner-driven, per `docs/phase-24-plan.md`'s CH section: a third round of live GUI
feedback surfaced "I put some notes down [in the clip editor]. How can I hear it?" — confirmed by
grep, there was no `previewClip`/`auditionClip`/`playClip` anywhere in the codebase.*

## The bug, precisely

`ui/src/components/NoteView.tsx` ("Clip View" in the bottom pane) always edits a track's own
TOP-LEVEL `notes`/`hits` — the exact fields `App.tsx`'s `BottomPane` passes straight through
(`<NoteView track={track} />`, no clip-id selection anywhere in that path yet). Every edit gesture
in `NoteView.tsx` posts to `<track>.note`/`<track>.hit`, never to `<track>.clip.<id>.note`.

`ui/src/audio/engine.ts`'s `contentOf()` resolves what actually plays per track per tick:

- **Loop mode** (`doc.song` is null/empty): returns the track's own `notes`/`hits` directly — this
  IS what `NoteView.tsx` edits, so in loop mode the bug doesn't exist; whatever you type is
  audible on the next loop pass.
- **Song mode** (`doc.song` has sections): resolves `bar -> active section -> its scene -> this
  track's slot -> a clip in `track.clips[]`` and returns THAT clip's `notes`/`hits`. It **never**
  reads the track's top-level `notes`/`hits` in this branch, regardless of playhead position.

So the moment a project has a song/section structure — which is most real projects past the
sketch stage — editing a track's live content in Clip View has **zero** effect on what's audible,
not just "wrong section" or "not the current bar." This is dotbeat's own version of Ableton's
Session View (a track's live/looped clip, edited free-running) vs. Arrangement View (placed
clips); the owner's own framing in `docs/phase-24-plan.md`'s research stream RF says the same
thing. `NoteView.tsx`'s top-level `notes`/`hits` are the "Session View" clip; nothing in the GUI
today plays them once a song exists.

## Approach: a scoped isolation loop, not a `contentOf` hijack

The plan sketched two options: (1) temporarily override what `contentOf` resolves for one track
inside the main song transport, or (2) a self-contained render/playback path scoped to just the
open clip. Neither fit cleanly as first described — (1) would still run every OTHER track through
its normal song resolution too (everything else in the mix would also play, which isn't
"isolation," it's "start the song with one track patched"), and (2) would mean re-deriving a
second, parallel copy of `tick()`'s per-track-kind dispatch (drum bus / instrument voice / synth
oscillator bank), a large, bug-prone duplication.

The actual implementation lands between them and reuses `tick()` entirely unchanged below the
per-track content-resolution line:

- `Engine` gets one new field, `auditionTrackId: string | null`.
- `tick()`'s per-track loop resolves `content` per track as:
  - if `auditionTrackId` is set: the named track gets its own live `notes`/`hits` (exactly what
    `contentOf`'s loop-mode branch would give it), tiled every `doc.loopBars` bars; **every other
    track gets `null`** — skipped outright, the same `continue` path song mode already uses for an
    unmapped track.
  - otherwise: `contentOf()` runs exactly as it does today, unchanged.
- Everything downstream of that line (drum-bus triggering, instrument `noteOn`/`noteOff`, the full
  synth oscillator bank, LFOs, clip automation, Beat Repeat) is untouched — auditioning gets the
  real per-track DSP chain, not a stripped-down preview voice like `previewNote`/`previewDrum`.

This makes "isolation" structural, not a mute/solo trick: no track's `mutes`/`solos` state (session
GUI state, persisted across the session and visibly toggled in the mixer) is touched at all, so
auditioning a clip never perturbs what the mixer shows or leaves stray solo state behind.

### Transport scoping

`auditionClip(trackId)` mirrors `play()`'s own transport setup almost exactly, narrowed to one
track's own loop length:

```ts
async auditionClip(trackId: string): Promise<void> {
  await this.ensureStarted()
  const doc = useStore.getState().doc
  if (!doc) return
  useStore.getState().setPlaying(false) // this is not "the song playing" — TransportBar stays honest
  this.sync(doc)
  const t = Tone.getTransport()
  t.bpm.value = doc.bpm
  t.loop = true
  t.loopStart = 0
  t.loopEnd = `${doc.loopBars}m`   // narrowed to the track's own tiling length, not the whole song
  this.auditionTrackId = trackId
  if (this.repeatId !== null) t.clear(this.repeatId)
  this.repeatId = t.scheduleRepeat((time) => this.tick(time), '16n', 0)
  t.position = 0
  t.start()
  useStore.getState().setAuditioning(trackId)
}
```

Setting `t.loopEnd` to `doc.loopBars` bars (rather than the full song length `play()` uses) has a
nice side effect beyond correctness: it keeps the shared `currentStep` the global store publishes
every tick within `[0, doc.loopBars * 16)` for the whole audition — which happens to be exactly the
range `NoteView.tsx`'s existing (if currently buggy in song mode — see Stream CG) playhead-render
condition already checks (`currentStep < totalSteps`, `totalSteps = loopBars * 16`). So the
playhead line in Clip View visibly tracks the audition for free, no `NoteView.tsx` playhead changes
needed for this stream.

### Stop semantics (requirement: "stop cleanly on its own, or when normal song playback starts")

- `stopAudition()` clears `auditionTrackId`, clears the store's `auditioningTrackId`, and delegates
  to the existing `stop()` (full transport teardown: instrument/drum/audio voices stopped, position
  reset, `currentStep` reset to -1). Wired to the same button the user clicked to start it — a plain
  toggle, the same idiom `TransportBar`'s Play/Stop button already uses.
- `stop()` itself now also clears `auditionTrackId`/`auditioningTrackId` defensively, so any other
  path that calls the general "everything off" `stop()` leaves auditioning cleanly off too, not
  paused.
- `play()` (normal song/loop playback) now clears `auditionTrackId`/`auditioningTrackId` **before**
  its own `sync()`/`scheduleRepeat` — starting the real transport always wins over an in-progress
  audition, satisfying "stop... when the user starts normal song playback" with no race (the very
  next tick already resolves every track normally).

`playing` (the flag `TransportBar` reads) and `auditioningTrackId` (the flag `NoteView`'s button
reads) are deliberately two separate store fields, not one repurposed boolean — an audition is not
"the song playing," and conflating them would either make `TransportBar` show "Stop" while a clip
audition runs (misleading — pressing it would stop the wrong thing conceptually, even though
mechanically `engine.stop()` does stop everything) or require `NoteView` to guess song-transport
state from a flag that doesn't mean what it needs.

## GUI

`NoteView.tsx`'s `.editor-toolbar` (already home to the track-name label and the multi-select
delete button) gets one new button, right after the track name:

- Idle: `▶ Preview clip`, `data-action="audition-clip"`.
- Active (this track is the one being auditioned — `auditioningTrackId === track.id`): `■ Stop`,
  `.active` class (same red-accent language as `TransportBar`'s own `.play-btn.stop`).
- Click toggles `engine.auditionClip(track.id)` / `engine.stopAudition()`.

No changes to `NoteView.tsx`'s grid/gesture code, `ClipPropertiesPanel.tsx`, or `DrumLanePanel.tsx`
— this is additive, one button plus its store-reactive label.

## What this does *not* do (explicitly out of scope)

- **Does not** address Stream CG's separate, real playhead bug (the absolute-vs-clip-relative
  `currentStep` mismatch during NORMAL song playback) — CH's transport-scoping happens to make the
  playhead track correctly *during an audition*, which is a nice side effect, not a fix to CG's bug.
- **Does not** touch `track.clips[]` at all. Today's Clip View only ever edits a track's top-level
  live content — there is still no GUI for opening one of several *named* clips into `NoteView` for
  editing (that's the "Session View clip" the whole track's top-level content already represents).
  Auditioning that content is exactly "hear what's open in the editor right now," which is the
  literal ask; extending Clip View to multiple named clips per track is a separate, larger stream
  (arguably touches CC/CI's territory) not attempted here.
- **Does not** bypass mute/solo. If the user has explicitly muted the track being edited, the
  audition is silent too, same as `previewNote`/`previewDrum` already behave — an existing,
  unchanged precedent, not a new decision made by this stream.
- **Does not** handle a `duckSource` sidechain pointing at another track with full fidelity during
  audition — the cross-track lookup inside `tick()`'s duck branch still calls `contentOf()`
  normally for the sidechain source (not silenced), so a duck could theoretically fire based on
  content that isn't actually audible during the audition. A real edge case (duck routing + solo
  audition, at the same time), not worth the extra complexity for this stream.

## Verification

`ui/verify-phase24-stream-ch.mjs` — Playwright-driven against a real `beat daemon` and the real
built frontend (same harness convention as `ui/verify-phase23-stream-bd.mjs`). Fixture: a two-track,
two-bar song-mode project where `t1` has a held live note (what "the clip open in NoteView" is) but
is **not** slotted into the song's one scene at all (`scenes: [{ id: 'sceneA', slots: { t2: 'c2' }
}]`) — the exact "not yet placed in any scene" bug scenario from the plan. `t2` IS slotted, via a
real clip distinct from its own (empty) live content, giving the measurement pipeline something
real to cross-check against.

Checks (Goertzel single-bin magnitude off a real `engine.recordWav()` capture, decoded through
`src/metrics/wav.ts`, plus a broad `src/metrics/analyze.ts` RMS sanity read):

1. **Baseline reproduces the bug**: normal song playback is measurably silent at `t1`'s own note
   frequency (440 Hz / A4), while `t2`'s properly-slotted clip IS audible (~130.8 Hz / C3) —
   confirms the fixture is real, not just asserting the button exists.
2. **Audition produces real audio**: selecting `t1`, clicking "Preview clip," and recording shows a
   large, clear jump in energy at exactly 440 Hz — not silence, not noise.
3. **Isolation**: while `t1` auditions, `t2`'s otherwise-audible content measures silent — proving
   this is a solo-preview, not "start the song from here."
4. **Clean stop**: clicking the button again reverts its label, clears the store's
   `auditioningTrackId`, resets `currentStep` to -1, and a follow-up recording is silent.
5. **Mutual exclusion**: starting an audition, then pressing the main transport's Play button,
   clears the audition state and hands off to normal playback — the clip button reverts on its own.

Run: `node ui/verify-phase24-stream-ch.mjs` (builds the repo + `ui/` first, same as every other
`verify-phase2*` script). 12/12 checks pass, confirmed across repeated clean runs.

### Harness bugs found while closing this stream out (not engine bugs)

An early pass at this script produced flaky/failing T2b/T3/T4c reads (weak-but-nonzero magnitude at
`t1`'s frequency during audition, and a nonzero `t2` reading during isolation) that looked at first
like a real isolation bug in `engine.ts`'s `tick()`. Re-reading `tick()`'s content-resolution branch
(the `this.auditionTrackId ? ... : this.contentOf(...)` split) showed it was already correct — every
non-auditioned track unconditionally gets `content = null`, every tick, no exceptions. Multiple clean
(uncontended) runs confirmed this empirically too: `T3`'s measured `t2` magnitude is consistently
`0.0000`, not just "under threshold." The actual cause was **test timing**, not engine behavior: an
earlier version of this script recorded back-to-back across phases with only a fixed short sleep, so a
prior phase's still-decaying note (Tone.js schedules a voice's release as real AudioContext-time
automation at trigger time — `Transport.stop()` does not retroactively cancel it, see `buildDoc`'s
comment) could bleed into the next phase's measurement window under machine load. Fixed by adding an
explicit `settle()` (900ms) real-wall-clock gap between phases, independent of whatever DOM/network
overhead already elapsed, plus recalibrating thresholds to the shorter per-phase recording windows.

A second, separate bug turned up in the T4 (clean stop) step specifically: the script tried to
"re-trigger the audition fresh" by clicking the toolbar button again before testing Stop — but T2's
audition is a *looping* transport that was never stopped (`settle()` only sleeps the test process, it
doesn't pause playback), so `auditioningTrackId` was already `'t1'` and the button already read
"Stop." That extra click therefore toggled the audition **off**, and the very next line waited on a
`waitForFunction` for it to become `'t1'` again — a state transition that could now never happen. This
surfaced as a hang rather than a fast, clear failure because of a *third*, latent bug: every
`page.waitForFunction(fn, { timeout: N })` call in this file was missing Playwright's required `arg`
positional parameter (the real signature is `waitForFunction(pageFunction, arg, options)`), so the
`{ timeout: N }` object was silently being bound to `arg` (ignored, since these page functions take no
parameters) and every wait was actually running under Playwright's own 30s default instead of the
5s/12s written in the source. Fixed both: removed the erroneous re-click (T2's audition is already
live going into T4, so clicking Stop there is already a real, live stop), and added the missing `arg`
(`undefined`) to every `waitForFunction` call in the file so a genuine future hang fails fast instead
of masquerading as a 30-second stall.

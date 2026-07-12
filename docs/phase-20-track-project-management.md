# Phase 20 Stream W — track & project management

Adds the table-stakes track-management UI the GUI was missing (docs/phase-20-plan.md Stream W):
add-track, delete-track (with confirmation), inline rename, and a per-track color picker, all wired
through the format's real edit primitives; plus a project-folder affordance wired to the desktop
shell's existing folder picker.

## Ported from BeatLab vs. built fresh

**Nothing ported verbatim — there was nothing to port.** A fresh clone of BeatLab
(`github.com/wgpatrick/beatlab`) was read in full: its store (`src/state/store.ts`) has **no** track
add/remove/rename/recolor action, and no component implements them — BeatLab's tracks are
lesson-defined and fixed (it's a curriculum sandbox; you don't add tracks in a lesson). Its store
has `copyTrack`/`pasteTrack`/`saveClip`/`deleteClip`/`deleteScene`, but no track-structure editing
and no color picker. So D12's "port BeatLab's working UI" did not apply here the way the plan
anticipated; this is built fresh, honestly reusing BeatLab's UI *patterns*:

- the controlled inline `<input>` edit — from BeatLab's TrackLab section-note field
  (`value` + `onChange`) — for inline rename.
- the `style={{ background: color }}` swatch — from BeatLab's TrackStrip track-dot — for the color
  swatch.
- a small header delete button — the shape of BeatLab's `SceneLauncher` `scene-del` button — for
  delete-track.

Everything else (the kind-chooser add menu, the confirmation, the color-input-behind-swatch, the
daemon routes) is dotbeat's own, adapted to its document shape and daemon API.

## What was built

**UI (`ui/src/components/ArrangementView.tsx`)** — localized additions to the existing track-row
header and toolbar (the file Streams V and Z also touch; changes kept additive to keep the merge
clean):

- **Add track** — a `+ track` button in the arrangement toolbar opens a kind chooser
  (synth / drums / instrument). It mints a unique id from the kind (`synth`, then `synth2`…), lets
  core default the name (= id) and color (cycles `TRACK_COLORS` by index), then selects the new
  track. Instrument is offered only when the document already has a registered SoundFont sample
  (the GUI has no sample-registration surface — honest: disabled with a tooltip pointing at
  `beat sample` otherwise).
- **Delete track** — a per-header `×` button with a real `window.confirm` (destructive: removes the
  track's clips, notes, and mixer settings; core also cleans up dangling scene slots / duckSource
  refs and refuses to remove the last track).
- **Rename track** — double-click the track name to edit it in place; Enter/blur commits, Escape
  cancels. Whitespace is filtered as typed (format names are single tokens).
- **Color picker** — a native color input hidden behind the always-visible swatch; picking writes
  the new hex (lowercased for the format's `#rrggbb` rule).

**Daemon (`src/daemon/daemon.ts`, additive)** — two new routes, structurally identical to the
existing `/edit`:

- `POST /add-track {id, kind, name?, color?, soundfont?}` → wraps core's `addTrack`.
- `POST /remove-track {id}` → wraps core's `removeTrack`.

These are the exact functions `beat add-track` / `beat rm-track` call. Track add/remove change the
whole tracks list, so they don't fit `setValue`'s single-`path=value` shape (which is why `/edit`
can't carry them). Both routes write-if-changed, revalidate the selection, and **return the full raw
document** — because the daemon never SSE-echoes its own writes, the frontend applies the returned
doc directly (`postAddTrack`/`postRemoveTrack` in `ui/src/daemon/bridge.ts`) rather than round-trip
re-pulling, so an add/remove reflects instantly.

**Rename / color needed no new primitive** — core's `setValue` already handles `<track>.name` and
`<track>.color` (used by `beat set <track>.name`), so they go through the existing `/edit` route via
`postEdit`. One real fix was required in the GUI's optimistic mirror: `applyLocalEdit` in
`bridge.ts` had no case for `name`/`color`, so those edits fell through to the synth-param branch and
were mirrored to a phantom `synth.name`/`synth.color` — the same optimistic-mirror miss class Stream
Y fixed for osc2. Added the `name`/`color` → `track.name`/`track.color` case so the header reflects a
rename/recolor immediately (the file was always correct; only the in-browser mirror was stale).

**Project/folder management (`ui/src/daemon/tauri.ts`, new)** — Phase 10/13 already built folder
re-pointing in the Tauri shell (`desktop/src-tauri/src/lib.rs`), and it already exposes the native
folder picker as an **invokable** command, `pick_project_folder` (the app is built with
`withGlobalTauri: true`, so the web layer can reach it via `window.__TAURI__`). An **Open Folder**
button in the toolbar invokes it. In a plain browser (no Tauri runtime — e.g. the verify harness or
`vite dev`) `isTauri()` is false and the button is disabled with a "available in the desktop app"
tooltip. See "Deferred / honest limitations" for why New Project and live folder-switch verification
are not covered here.

## Verification evidence

`ui/verify-phase20-tracks.mjs` (headless Chromium, real `beat daemon`, real frontend, real
night-shift project) drives every operation through the GUI and asserts the **on-disk `.beat` file**
plus a git diff for localization. Full run: **ALL PASS** (W1 add, W2 rename, W3 color, W4 delete,
W5 open-folder present+disabled-outside-Tauri).

Real diffs each operation produces (captured against `examples/night-shift.beat`):

```
=== ADD synth track (POST /add-track) — adds exactly one track block ===
+track synth synth #98c379 synth
+  synth
+    osc sawtooth
+    volume -10
+    cutoff 2000
     … (INIT_SYNTH defaults) …

=== RENAME + RECOLOR (POST /edit synth.name, synth.color) — one line changed ===
-track synth synth #98c379 synth
+track synth BassPad #aa33cc synth

=== DELETE synth track (POST /remove-track) — removes exactly that block ===
-track synth BassPad #aa33cc synth
-  synth
     … (whole block gone; other tracks byte-identical) …
```

The delete assertion additionally checks the remaining tracks are **byte-identical** to the
pre-add baseline (delete touched nothing else).

- **Full test suite**: `npm test` → **295 / 295 / 0 / 0** (295 tests, all pass; +3 new daemon-route
  tests in `test/daemon.test.ts` covering add, duplicate-id rejection, and remove).
- **UI typecheck**: `cd ui && npx tsc --noEmit` → clean (exit 0).

## Deferred / honest limitations

- **New Project**: not built. Creating a new project means creating a new `.beat` file/folder **and
  repointing the daemon at it** — but the `beat daemon` owns exactly one file and cannot repoint
  itself; that is the Tauri shell's job (`spawn_project`/`reopen_project_folder`). A pure additive
  daemon route could `init` a new file but the daemon would keep serving the old one, so it would be
  a lie. The correct home is a small Tauri `new_project` command alongside `pick_project_folder`
  (create folder + `beat init` + repoint), which is a desktop-shell change, not a web-layer one.
  Deferred rather than faked.
- **Live folder-switch verification**: the "Open Folder" button genuinely works in the packaged
  desktop app (it invokes the existing, already-shipped `pick_project_folder`), but it **cannot be
  exercised by the headless-Chromium verify harness** — there is no Tauri runtime in a plain
  browser, so `window.__TAURI__` is undefined. The verify asserts the honest fallback: the button is
  present and disabled outside Tauri. This is the boundary documented in `ui/src/daemon/tauri.ts`.
- **Instrument tracks from the GUI**: only offered when the project already has a registered
  SoundFont sample (reuses the first one, program 0). The GUI has no `beat sample` equivalent, so
  registering a new SoundFont still needs the CLI. Disabled-with-tooltip rather than a broken option.

## Files touched

- `ui/src/components/ArrangementView.tsx` — track-header controls + add-track/open-folder toolbar
  (expected overlap with Streams V and Z; kept additive).
- `ui/src/daemon/bridge.ts` — `postAddTrack`/`postRemoveTrack`; `applyLocalEdit` name/color fix.
- `ui/src/daemon/tauri.ts` — new; `isTauri()` / `openProjectFolder()`.
- `ui/src/styles.css` — styles for the new controls.
- `src/daemon/daemon.ts` — additive `/add-track`, `/remove-track` routes.
- `test/daemon.test.ts` — +3 route tests.
- `ui/verify-phase20-tracks.mjs` — new live verification.

Did **not** touch `ui/src/components/NoteView.tsx` (Stream U) or engine internals.

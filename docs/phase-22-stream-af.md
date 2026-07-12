# Phase 22 Stream AF — track & project polish bundle

Three independent, small-to-medium GUI+daemon+core features (docs/phase-22-plan.md's AF): track
grouping (new format grammar, v0.10), new-project-from-scratch reachable from the GUI (not just
`beat init`), and save-project-as-template. All three ship together because they're the same shape
of work — "a small daemon route wrapping a real core primitive, plus a toolbar affordance" — not
because they're related features.

## 1. Track grouping

**Format (`src/core/document.ts`, `parse.ts`, `serialize.ts`, v0.10)** — the simplest version that
survives a reload, per the plan's explicit steer. A group is a flat, named, colored membership list:

```
group <id> <name> <color> <track-id> <track-id> ...
```

```ts
export interface BeatGroup {
  id: string
  name: string
  color: string
  tracks: string[] // member track ids, in this group's own order
}
```

Design decisions, each made to keep the addition genuinely minimal:

- **No nesting.** A track belongs to at most one group — enforced at both parse time (a track
  appearing in two `group` lines is a parse error: `track "X" is in more than one group`) and edit
  time (`addGroup`/`setGroupTracks` refuse to add an already-grouped track). No group-of-groups.
- **Collapsed/expanded is deliberately NOT in the grammar.** It's UI-only session state, the same
  treatment mute/solo already get (`ui/src/state/store.ts`'s existing precedent: "NOT persisted to
  the .beat file... real DAWs treat these as session state"). A collapsed group resets to expanded
  on reload — verified live (AF1d below). This was a real design choice, not an oversight: the plan
  explicitly frames a group as "a named collection of track IDs with a collapsed/expanded UI state,"
  and collapse doesn't change what plays or what an agent would want to see in a diff, so it stays
  out of the file. Membership/name/color are persisted because losing those on reload would be a
  real regression — the group wouldn't survive the session that created it.
- **Canonical order**: `group` blocks parse/serialize between tracks and scenes (`format_version →
  bpm → loop_bars → selected_track → media → tracks → groups → scenes → song`). Group blocks must
  reference already-declared tracks (parse validates this immediately since groups always come
  after all tracks), and a `track` line after any `group` line is a canonical-order parse error —
  symmetric with the existing track/scene/song ordering rules.
- **`removeTrack` cleans up membership**: a removed track is dropped from its group; a group left
  with zero members is dropped entirely (same elision discipline as an empty automation lane having
  no serialized form).
- **Format version bumped 0.9 → 0.10** (`initDocument`, `convert.ts`'s `BEAT_FORMAT_VERSION`) since
  this is a new top-level grammar keyword, consistent with how v0.4 (clips/scenes/song), v0.5
  (media), and v0.9 (automation) each bumped on a new block type. A v0.9 file with zero `group`
  lines parses unchanged (`groups: []`) — this is purely additive.

**Core edit primitives (`src/core/edit.ts`)** — `addGroup` (mints `group<n>` when `id` is omitted,
defaults `name` to the id and cycles `TRACK_COLORS` for `color`, same conventions as `addTrack`),
`removeGroup` (ungroups; member tracks are untouched), `renameGroup`, `setGroupColor`,
`setGroupTracks` (replaces the whole membership list in one statement — same "few entries, order
can matter, replace not patch" shape as `setSong`). `diffDocuments`/`formatDiff`
(`src/core/diff.ts`) report group add/remove/rename/recolor/membership-change as musical facts, the
same discipline every other block gets (`group added "keys" ("Keys": lead, bass)`, `group group1:
name "Keys" -> "Synths"`, ...).

**Daemon (`src/daemon/daemon.ts`, additive)** — one route, five ops (mirrors `/song`'s
"whole-statement op" shape rather than `/edit`'s `{path,value}` grammar, since a membership list
isn't a scalar):

```
POST /group {op: 'create',  trackIds, id?, name?, color?}
POST /group {op: 'delete',  id}
POST /group {op: 'rename',  id, name}
POST /group {op: 'recolor', id, color}
POST /group {op: 'set-tracks', id, trackIds}
```

Like `/add-track`/`/remove-track`, each returns the full raw document (the daemon never SSE-echoes
its own writes, so the frontend applies the response directly). `POST /state` (the older whole-doc
bridge route) now carries `doc.groups` over defensively — filtering out any member track the pushed
payload didn't include — so a GUI-bridge push can never silently corrupt or erase a group.

**GUI (`ui/src/components/ArrangementView.tsx`)** — a checkbox in each ungrouped track's header
("pick for grouping," hidden once a track is already in a group — grouping an already-grouped track
isn't offered, ungroup first) plus a toolbar `+ group` button (enabled once ≥2 tracks are picked).
Grouping does **not** reorder the document's tracks: a `GroupHeaderRow` renders once, at the
position of the group's first member in doc order, and every member row renders wherever it already
sits, visually indented (`arr-grouped-track`). This keeps the change additive and avoids a second,
unrelated "move a track" primitive — real DAWs mostly do reorder on group, but the plan's own steer
("don't build a nested/recursive group-of-groups system... keep it minimal") pointed at the smaller
change. Collapsing hides every member row (and their automation sub-lanes/pickers, correctly
excluded from the playhead height calculation); the header always stays visible so the fold can be
reopened. Double-click the group name to rename (same UX as track rename); the header's `×`
ungroups (tracks are kept).

**CLI/MCP (`cli/beat.mjs`, `src/mcp/server.ts`)** — `beat group <file> <id> <track-id>... [--name
N] [--color #hex]`, `beat rm-group <file> <id>`, `beat group-set <file> <id> [--name N] [--color
#hex] [--tracks id,id,...]`, and the MCP equivalents `beat_group`/`beat_rm_group`/
`beat_group_set`. Added so an agent driving dotbeat purely through the CLI/MCP surface has the same
capability the GUI does — this wasn't strictly asked for by the plan (framed as "GUI+daemon
features"), but every other structural edit in this codebase (`addTrack`/`removeTrack`,
`setScene`/`setSong`) gets a CLI+MCP face, and the marginal cost was one thin wrapper per already-
built core primitive.

## 2. New-project-from-scratch, GUI-reachable

**The gap**: only `beat init` (CLI) created a new project. Phase 20 Stream W looked at this and
explicitly deferred it, reasoning that "creating a new project means creating a new `.beat`
file/folder **and repointing the daemon at it** — but the `beat daemon` owns exactly one file and
cannot repoint itself... A pure additive daemon route could `init` a new file but the daemon would
keep serving the old one, so it would be a lie."

**The resolution taken here is a different shape than what that note anticipated**: `POST
/new-project` doesn't try to make the CALLING daemon serve the new file — it's a pure filesystem
write to an arbitrary target path, wrapping the exact function `beat init` uses:

```
POST /new-project {path, name?, bpm?, loopBars?, from?}
  -> { filePath, created: true }
```

`path` may be a folder (gets `<name ?? 'project'>.beat`) or an explicit `.beat` path; refuses to
overwrite an existing file (same stance as `beat init`). Since this never claims to open or switch
to the new project — creating and switching are still two separate, honest steps, exactly like
`beat init` followed by `beat daemon <file>` always were — it isn't a lie the way a route that
silently kept serving the old file would be. And critically, because it's a plain filesystem
operation unrelated to the calling daemon's own file, it works — and is **verifiable live** — from
ANY running daemon in a plain browser, not just through the Tauri folder-repoint dance. That's the
concrete reason this shape was chosen over a new Tauri command: it closes the "verify live" gap
Phase 20 also flagged ("cannot be exercised by the headless-Chromium verify harness") for the
*creation* half of the feature, even though switching the desktop shell into the new project
still needs "open folder…" as a second step (documented below, not hidden).

**GUI**: a `new project…` button next to `open folder…` in the arrangement toolbar. Prompts (plain
`window.prompt`, not a native picker — there is no filesystem access in a browser without Tauri, so
this is the honest fallback) for one destination — "a folder, or a path ending in .beat" — POSTs
the route, and alerts the created path.

## 3. Save project as template

Per `docs/research/24-opendaw-roadmap-positioning.md`'s "Project templates" row, scoped as the plan
suggested: "copy this project's file/folder to a new location as a new project," simpler than
openDAW's browser-storage version since dotbeat is already a real filesystem folder.

```
POST /save-as-template {path, name?}  -> { filePath, source }   (copies THIS project's on-disk bytes)
POST /new-project      {path, from}   -> { filePath, created }  (reuses #2's route with a template source)
```

`/save-as-template` is a literal `copyFileSync` of the daemon's own `filePath` — not a re-serialize,
so a template is exactly what was on disk at save time, comments and all. Opening/starting a
project from a template is `/new-project`'s existing `from` parameter (validated: must exist, must
parse as a real `.beat` document before duplicating) — the exact reuse the plan called for
("can reuse the 'new project' flow from #2 with a template source instead of blank"). Both routes
only ever **read** the template file; the new project is a fresh copy, never a reference, so nothing
that happens to the new project can reach back and mutate the template — verified live (AF3c).

**GUI**: `save as template…` and `new from template…` buttons alongside `new project…`. "New from
template" prompts twice (template source path, then destination) since it's a genuinely different
action from a blank "new project," not a chained follow-up.

## Verification evidence

`ui/verify-phase22-af.mjs` (headless Chromium, real `beat daemon`, real frontend, a real
night-shift project) drives all three features live and checks the **on-disk `.beat` file(s)**, not
just the in-browser store:

- **AF1a** — check two tracks' "pick for grouping" boxes, click `+ group`; a `group group1 group1
  #e06c75 lead drums` line lands in the file, and `git diff` shows it as the only addition (one
  blank separator + one line).
- **AF1b/c** — collapsing hides both member rows in the DOM (`[data-color="lead"]`/`"drums"`
  disappear); expanding brings them back.
- **AF1d** — reload the page: group **membership** survives (still `lead,drums`); the group is
  **expanded again** (collapse never touched the file, so there's nothing to restore it from — it
  just defaults open).
- **AF1e** — ungroup: the `group` line disappears; the two track lines are byte-identical to before
  grouping.
- **AF2** — click `new project…`, answer the folder prompt; a real `project.beat` exists on disk,
  parses, has the format's one-starter-track init patch and the default 120 bpm.
- **AF3a** — click `save as template…`; the template file is byte-identical to the live project.
- **AF3b** — click `new from template…`; the started project begins as a byte-identical copy of the
  template.
- **AF3c** — edit the started project for real (a **second** `startDaemon` instance's real `POST
  /add-track` — the same mechanism AF2/Phase 20 Stream W use, not a hand-written mutation); the
  template AND the original project are still byte-for-byte what they were before the edit.

Full run: **ALL PASS** (see the script's own header comment for the AF1–AF3 checklist it drives).

- **Full test suite**: `npm test` → **323 / 323 / 0 / 0** (323 tests, all pass) — +17 new format
  tests (`test/format-v10-groups.test.ts`: grammar round-trip, canonical order, one-group-per-track
  enforcement, every edit primitive, diff output), +7 new daemon-route tests (`test/daemon.test.ts`:
  `/group` create/rename/recolor/set-tracks/delete, `/new-project` blank/refuse-overwrite/
  from-template/bad-template, `/save-as-template`), +1 new MCP test
  (`test/mcp.test.ts`: `beat_group`/`beat_group_set`/`beat_rm_group` over the real JSON-RPC
  subprocess).
- **UI typecheck**: `cd ui && npx tsc --noEmit` → clean. **UI build**: `cd ui && npm run build` →
  clean.

## Deferred / honest limitations

- **Grouping never reorders tracks.** A group's members can be non-contiguous in the document's
  track order; the header renders at the first member's position and every member is indented
  wherever it sits. A real DAW's group track usually also reorders members to be contiguous — that's
  a second, unrelated primitive (a general "move track" edit doesn't exist yet) and was left out to
  keep this addition minimal, per the plan's explicit steer.
- **No incremental group-membership editing in the GUI.** The GUI offers create (pick ≥2, `+
  group`) and delete (ungroup) but not "add one more track to an existing group" or "remove one
  track without ungrouping everything." `setGroupTracks` (core/daemon/CLI/MCP) fully supports this;
  it just isn't wired to a GUI affordance yet — scoped out to keep the UI surface small, same
  reasoning as skipping reorder-on-group.
- **"New project" and "switch to it" are still two steps in the desktop app.** `POST /new-project`
  creates the file; actually viewing it in the Tauri shell still means using "open folder…"
  afterward (or restarting pointed at it). A one-click "create and switch" flow would need a new
  Tauri command (skip the native dialog, reopen a known path) — deliberately not added: it's Rust
  surface with no live-verify story in this harness (same boundary "open folder…" itself already
  documents), and the two-step version is fully functional and fully verified.
- **No native folder/file picker for these three actions** in a plain browser — `window.prompt`
  is the honest fallback (there's no filesystem access without Tauri). In the desktop shell these
  could eventually route through `tauri-plugin-dialog` the way "open folder…" already does; not
  done here because it would break live verifiability in the headless harness the same way "open
  folder…" itself is Tauri-only-and-unverifiable.

## Files touched

- `src/core/document.ts`, `parse.ts`, `serialize.ts`, `edit.ts`, `diff.ts`, `convert.ts`,
  `index.ts` — the v0.10 `BeatGroup` grammar, edit primitives, diff reporting, format-version bump.
- `src/daemon/daemon.ts` — `/group`, `/new-project`, `/save-as-template` routes; `/state` carries
  `groups` over defensively.
- `cli/beat.mjs` — `group` / `rm-group` / `group-set` commands.
- `src/mcp/server.ts` — `beat_group` / `beat_rm_group` / `beat_group_set` tools.
- `ui/src/types.ts` — `BeatGroup` mirror, `groups` on the frontend's `BeatDocument`.
- `ui/src/daemon/bridge.ts` — `postGroupOp`.
- `ui/src/components/ArrangementView.tsx` — grouping UI (`GroupHeaderRow`, pick checkboxes, row-plan
  rendering), new-project/from-template/save-as-template toolbar actions.
- `ui/src/styles.css` — styles for the new controls.
- `test/format-v10-groups.test.ts` — new, 17 tests.
- `test/daemon.test.ts` — +7 route tests.
- `test/mcp.test.ts` — +1 test, +3 tool names in the handshake check.
- `test/roundtrip.test.ts`, `test/format-v07.test.ts`, `test/format-v04.test.ts`, `test/diff.test.ts`
  — small updates for the `groups: []` field and the 0.9 → 0.10 version bump.
- `ui/verify-phase22-af.mjs` — new live verification (AF1/AF2/AF3), + `ui/verify-p22-af-group.png`.
- `scripts/roadmap-data.mjs`, `docs/product-roadmap.md` — three rows flipped to `done`.

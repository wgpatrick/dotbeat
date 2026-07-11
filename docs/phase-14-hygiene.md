# Phase 14 Stream G — hygiene pass: test coverage + Tauri robustness

*Built 2026-07-11, immediately following Phase 13's Result. Three small, disjoint cleanup items
picked from Phase 13's own "honestly still open" list — see `docs/phase-14-plan.md`'s Stream G
section. Files touched: `test/diff.test.ts` (extended, not new — see below for why), `desktop/src-
tauri/src/lib.rs`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/resources/night-
shift.beat` (new). No `ui/`, `src/`, `cli/`, or `desktop/sidecar/` changes.*

**Worktree note**: this stream's assigned worktree branch (`worktree-agent-a7f98f4fb0acb930c`) had
zero shared git history with `main` (`git merge-base` returned nothing) and was missing
`docs/phase-14-plan.md`, `desktop/`, and `ui/` entirely — the same stale-base problem
`docs/phase-9-tauri-spike-plan.md`'s Phase 13 Stream D section already documented once. Fixed by
switching the worktree to a fresh branch off the local `main` ref (`69e840f`, itself ahead of
`origin/main` — not yet pushed), rather than resetting the given branch, so the original branch is
left untouched. Recorded here for the same reason Phase 13 Stream D recorded it: unusual amount of
git archaeology for what should be a "just start working" stream.

## 1. Unit tests for the `setValue` note-write grammar

`src/core/edit.ts`'s `setValue` gained a `<track>.note` / `<track>.note.<id>.<field>` / delete
grammar in Phase 13 Stream B (`docs/phase-13-editing.md`), the note-side analog of
`pattern.<lane>[step]` for drums. It shipped with real GUI end-to-end coverage (`ui/verify.mjs`)
but, by that stream's own admission, no `test/`-side unit test — Stream B's own writeup names the
natural follow-up as "a `diff.test.ts` case for the three note paths."

Found where `setValue`'s other paths are tested: `test/diff.test.ts`'s `---- edit primitives
----` section already covers header fields, synth params, and the `pattern.<lane>[step]` drum
sugar via `setValue`, plus `addNote`/`removeNote` directly (but not through `setValue`'s string
grammar). No `test/edit.test.ts` exists — `diff.test.ts` is the established home for this. Added
four tests there, immediately after the existing `removeNote` test, matching the file's existing
conventions (`realDoc()` fixture, `assert.deepEqual`/`assert.throws(..., BeatEditError)`):

- **`setValue note-add grammar mints the same note addNote would, byte-for-byte`** — asserts
  `setValue(a, 'lead.note', '76 12 2 0.9')` produces a document `deepEqual` to
  `addNote(a, 'lead', {pitch:76,start:12,duration:2,velocity:0.9}).doc` (same id-minting, since
  both start from the same document), and that the newly-added note is exactly
  `{id, pitch:76, start:12, duration:2, velocity:0.9}` with `id` matching `/^u\d+$/`.
- **`setValue note.<id>.<field> moves/resizes exactly one field, leaving the rest untouched`** —
  adds a note, then applies `.start`, `.duration`, `.pitch`, `.velocity` edits one at a time,
  asserting after each step that only the just-edited field changed and every prior field stayed
  put (`assert.deepEqual(after, {...before, start: 20})`, then `{...before, start:20, duration:4}`,
  etc.).
- **`setValue note.<id> with an empty value deletes the note`** — asserts the track's note count
  drops by exactly one and the deleted id is no longer present.
- **`setValue note grammar rejects malformed adds, unknown note ids, and non-empty deletes`** —
  throws `BeatEditError` for: wrong arity (`'76 12 2'`), non-numeric fields (`'76 12 2 loud'`,
  `'not a valid note at all'`), an unknown note id on both a field edit and a delete, a delete with
  a non-empty value, and a note-add attempted on a drum track (notes only belong on synth/
  instrument tracks — `addNote`'s own check, reached through the grammar).

No bug was found in the grammar itself — `setValue`'s note paths behaved exactly as
`docs/phase-13-editing.md` describes and as the four tests above assert. No `src/core` changes.

**Result**: `npm test` → **293 tests, 287 pass, 0 fail, 6 skipped** (289/283/0/6 baseline + these 4
new tests, all passing). Full run:
```
tests 293
pass 287
fail 0
cancelled 0
skipped 6
```

## 2. Bundled starter project for a repo-less first launch

`docs/phase-9-tauri-spike-plan.md`'s Phase 13 Stream D section flagged: `initial_project_target`'s
last-resort fallback was `repo_root().join("examples/real-groove.beat")` — it required a dotbeat
git checkout to be reachable on disk, so a downloaded/repo-less `.app` with no folder chosen yet
and no previous session had nothing to open.

Fixed by shipping `examples/night-shift.beat` (a real 4-bar, 4-track song — synth lead with 7
notes, a full drum pattern, bass, and pad — chosen over `real-groove.beat` as a richer first-open
demo) as a genuine Tauri bundled resource, not a repo-relative path guess:

- Copied it to `desktop/src-tauri/resources/night-shift.beat` (new file, checked in — small,
  2.9KB, and living inside `src-tauri/` avoids any ambiguity about resource paths reaching outside
  the Tauri project directory).
- Declared it in `desktop/src-tauri/tauri.conf.json`'s `bundle.resources`:
  `{"resources/night-shift.beat": "night-shift.beat"}` — source relative to `tauri.conf.json`,
  target flattened to the resource root.
- Added `bundled_example_target()` in `lib.rs`, using `app.path().resource_dir()` (resolves
  correctly in every build mode — `cargo run`/`tauri dev` and `tauri build` alike, since
  `tauri-build`'s `build.rs` embeds/copies declared resources as part of the build script, not
  just at packaging time — confirmed empirically below, not just by reading the plugin docs).
- `initial_project_target`'s priority order is now: explicit env var override → last-opened folder
  (persisted-scope, unchanged from Phase 10 Stream A) → **the bundled example** → a repo-relative
  fallback (`repo_root().join("examples/night-shift.beat")`) kept only as a last-resort safety net
  in case resource resolution itself ever fails.

### Verification (real launch, not just reading the code)

Built the actual sidecar binary (`node desktop/sidecar/build.mjs`, `dotbeat-daemon-aarch64-apple-
darwin`, 58MB) and `cargo build`'d the Tauri shell, then launched the real debug binary directly
(`./desktop/src-tauri/target/debug/dotbeat-desktop`) with no `DOTBEAT_PROJECT_FILE` override and
no prior `last-project.json` (fresh `fs scope on startup: []`). Real log output:

```
[dotbeat] fs scope on startup (restored by persisted-scope): []
[dotbeat] no folder chosen yet — opening the bundled starter project: /Users/.../desktop/src-tauri/target/debug/night-shift.beat
[dotbeat] project target: /Users/.../desktop/src-tauri/target/debug/night-shift.beat
...
[dotbeat] port 8420 up after 2 attempt(s) (via 127.0.0.1:8420)
[dotbeat] daemon up: true
```

`curl http://localhost:8420/doc` against the running daemon returned the real bundled document:
`{"bpm":124,"loopBars":4,"selectedTrackId":"lead","tracks":[{"id":"lead",...,"notes":[{"id":"u100033","pitch":76,"start":20,...}` — i.e. the daemon really opened the resource-resolved copy of
`night-shift.beat` (note it resolved to a path under `target/debug/`, Tauri's dev-mode resource
location — proving `resource_dir()` genuinely works pre-packaging, not just in a built `.app`),
not a placeholder or an error path.

## 3. Sidecar-orphan-on-force-quit fix

`docs/phase-9-tauri-spike-plan.md` documented (Phase 10 Stream A, re-confirmed independently in
Phase 13 Stream D) that killing the app process directly (`pkill`/`kill -9`) leaves the daemon
sidecar running — `on_window_event`'s `CloseRequested` cleanup only fires on a graceful shutdown.

**The honest constraint that shaped the fix**: a real force-quit sends `SIGKILL`, which by POSIX
design cannot be caught, blocked, or handled by the receiving process — there is no hook, in Tauri
or anywhere else in userspace, that runs code inside a process after it has received `SIGKILL`.
`tauri::RunEvent::Exit` does **not** fire for `SIGKILL` either (it's a graceful-shutdown event).
So the only mechanism that can still act once the app process is gone is a *separate* process
watching it from outside. Two changes, in `desktop/src-tauri/src/lib.rs`:

1. **`spawn_watchdog(daemon_pid)`** — spawned once per daemon child (in `spawn_project`, right
   after the child is spawned, both the debug plain-`node` path and the release compiled-sidecar
   path). It's a tiny detached `sh -c` loop:
   ```sh
   while kill -0 <app_pid> 2>/dev/null && kill -0 <daemon_pid> 2>/dev/null; do sleep 1; done
   kill -9 <daemon_pid> 2>/dev/null
   ```
   Polls both PIDs once a second (`kill -0` is the standard POSIX liveness check — sends signal 0,
   which does nothing but fails with `ESRCH` if the PID is gone) and force-kills the daemon the
   moment either side disappears. It self-terminates within ~1s either way, so it doesn't
   accumulate stale watchdogs across graceful shutdowns or folder switches. Deliberately plain
   POSIX shell rather than a new Rust crate dependency or a second compiled binary — portable to
   macOS/Linux (the two platforms this project has actually built for so far); Windows would need
   a job-object-based mechanism instead, not implemented here.
2. **`RunEvent::Exit` handling**, as a second, broader *graceful*-shutdown net alongside
   `on_window_event`'s existing `CloseRequested` handler — switched `.run(tauri::generate_context!())`
   to `.build(...)?.run(|app_handle, event| { if RunEvent::Exit { kill_sidecars(...) } })` so
   cleanup also runs for graceful-exit paths that don't happen to fire a per-window
   `CloseRequested` first (e.g. `AppHandle::exit()` called from elsewhere). `kill_sidecars` is
   idempotent, so this and the window-close handler both firing for the same shutdown is harmless.
   This does not, and cannot, cover `SIGKILL` — that's what item 1 is for.

### Verification (real force-quit, PID before/after — not just reading the code)

Launched the real built binary (the same one from item 2's verification) and captured both PIDs
from the live log and `ps`:

```
[dotbeat] cleanup watchdog started: will force-kill daemon pid 45166 if app pid 45160 disappears for any reason, including SIGKILL/force-quit
```
```
$ ps -p 45160 -p 45166 -o pid,ppid,command
  PID  PPID COMMAND
45160     1 ./desktop/src-tauri/target/debug/dotbeat-desktop
45166 45160 node .../cli/daemon.mjs .../night-shift.beat --port 8420
```
`curl http://localhost:8420/doc` confirmed the daemon was live and serving real data before the
test.

Force-killed the **app** process directly (not a graceful quit): `kill -9 45160`. Immediately
after (0.3s later, before the watchdog's ~1s poll interval could fire), `ps -p 45160 -p 45166`
showed the app (45160) already gone and the daemon (45166) **still alive** — expected, confirms
the test is really exercising the watchdog's polling window rather than some other coincidental
cleanup path. Waited 2 more seconds and re-checked:

```
$ ps -p 45160 -p 45166 -o pid,command
  PID COMMAND
(no output — both gone)

$ lsof -i :8420
(no output — port fully released, not just an unresponsive process)

$ ps aux | grep -E "45160|45166|dotbeat-daemon|dotbeat-desktop"
(no output — no leftover app, daemon, or watchdog processes)
```

Both the app and the daemon sidecar are confirmed gone within ~2 seconds of a real `SIGKILL`, with
no orphaned watchdog process left behind either. This is the exact gap `docs/phase-9-tauri-spike-
plan.md` documented, reproduced once more as a sanity check (daemon *did* outlive the immediate
kill, confirming the watchdog — not some unrelated effect — is what reaped it), then shown fixed.

### Honestly still open

- **Windows**: the watchdog is POSIX shell (`sh -c`, `kill -0`); a Windows build would need a
  different mechanism (a job object tying the daemon's lifetime to the parent process is the
  idiomatic Win32 equivalent). Not implemented — this project has only ever built/verified
  `aarch64-apple-darwin` per every prior session in `docs/phase-9-tauri-spike-plan.md`.
- **The watchdog itself is a plain child-of-nobody process** — after the app dies, it's reparented
  like any other orphan (to `launchd`/`init`), which reaps it normally once its `sh -c` loop exits;
  no special handling was needed for that, but it's worth naming: for the ~1s between the app
  dying and the watchdog noticing, there is a brief real window where the app is gone and the
  daemon (and the watchdog itself) are still alive. Not zero-latency cleanup, but bounded and
  short, and it always completes — unlike the prior behavior (never completing at all without a
  graceful quit).

## Result

- `npm test` (repo root): **293 / 287 / 0 / 6** (289/283/0/6 baseline + 4 new note-grammar tests,
  all green).
- `cargo build` (`desktop/src-tauri`): clean, no new warnings beyond pre-existing ones.
- All three items verified against real running processes/binaries, not just by reading the code:
  a real `npm test` run, a real launched Tauri debug binary serving the real bundled example via
  `curl`, and a real `kill -9` against the app's own PID with `ps`/`lsof` confirming the daemon
  sidecar's PID (and the watchdog's own process) are both gone afterward.

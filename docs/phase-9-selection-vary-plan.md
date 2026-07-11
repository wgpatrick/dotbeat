# Phase 9 — Selection axis semantics, decided; `beat vary --scope selection` wired

*Started 2026-07-11. Closes the D2 loose end flagged in docs/product-spec-desktop.md §7: the
selection grammar (`src/core/selection.ts`) landed with the pointing protocol itself, but two
things were still open — whether an absent axis really means "unfiltered", and the milestone
note that `beat vary --scope selection` was "planned" without confirming it was ever built. It
wasn't. This phase decides the first and builds the second.*

## Problem

D2's design doc (§2, §6) named `beat vary --scope selection` as the demo: highlight the hi-hats
in the GUI, tell the agent to vary them, watch only the hats change. The selection channel
(daemon `/selection`, `beat selection` CLI, `parseSelection`/`serializeSelection`/
`validateSelection`/`selectionToNoteIds`) was built and tested — but nothing consumed it from
`beat vary`. Two gaps stood in the way:

1. **An open semantic question.** §7: *"does a selection of `bars 8 16` with no tracks mean 'all
   tracks'? (leaning yes — axes are filters, absent = unfiltered)."* The code already leaned this
   way in `selectionToNoteIds` (confirmed by an existing test), but it was never written down as
   *decided*, and it had never been extended to the axes `selectionToNoteIds` doesn't touch —
   `lanes` (drum-hit lanes) and mixed note/hit ids on drum tracks.
2. **No bridge from a selection to vary's scope.** `varyFeel` (rung 2, the humanize-based content
   variation) already accepts `--lanes`/`--ids` (`FeelVaryOptions.lanes`/`.ids` in
   `src/vary/vary.ts`) — but only if you type the lane/id list by hand. There was no code path
   from "the daemon's current selection" to those options.

## Design

### 1. Axis semantics — decided, not re-opened

`src/core/selection.ts` now carries a header comment (next to `BeatSelection`) stating the
resolution explicitly: **every axis (`tracks`, `lanes`, `bars`, `notes`) is an independent
filter; an absent axis is unfiltered ("matches everything on that axis"), not "nothing"; present
axes intersect (AND, not OR).** The wholly-empty selection `{}` is the degenerate case of "every
axis absent" — it reads as "no active selection", which is why the daemon and CLI display it as
"no selection", but it is the *same* code path as any other unfiltered axis, not a special case.

One real gap got closed as part of "deciding" this: `validateSelection`'s `notes` axis only ever
checked a track's `notes` array, so it silently could never resolve against a **drum** track
(drum tracks store `hits`, not `notes` — `BeatTrack.notes` is always `[]` for `kind: 'drums'`).
Since the grammar's `notes` axis is the *only* place individual events are named, and drum hits
are a drum track's events, `validateSelection` now checks `track.hits` when the track is a drum
track, `track.notes` otherwise. Same wire form (`track.hit-or-note-id`), track-kind-dependent
pool — documented on `SelectionNote`.

### 2. `selectionToVaryScope`: the pure resolution behind `--scope selection`

A new function in `src/core/selection.ts`, `selectionToVaryScope(sel, doc, trackId) ->
{ lanes?, ids? }`, resolves a selection into *exactly* the shape `FeelVaryOptions` already
accepts — no changes needed in `src/vary/vary.ts`. Rules (also in the function's doc comment):

- `tracks`, `lanes`, and `notes` each name a track per entry. If any of the three is present,
  their track names union into "the tracks this selection is about" — if `trackId` isn't in that
  union, this **throws**: the selection points at a different track/region entirely. This is the
  guard the task calls out explicitly (spec §2: "enforced scope, not suggested scope" — a
  structural rejection, not a silent no-op that varies the wrong thing).
- Once `trackId` clears that gate: a pure `lanes` selection (drum tracks only, nothing else
  narrowing) passes straight through as `{ lanes }` — vary's own `--lanes`.
- Anything narrower (a `bars` window, an explicit `notes`/hit id list, or `lanes` combined with
  `bars`/`notes`) resolves to concrete event ids — hits for drum tracks, notes for synth/
  instrument tracks — intersecting whichever axes are present. This generalizes
  `selectionToNoteIds`'s existing intersection rule (tracks AND bars AND notes) to hits and lanes.
- Nothing narrowing this track beyond the gate (e.g. `{}`, or `{ tracks: [id] }` naming it with
  nothing more specific) resolves to `{}` — no scope, i.e. vary's own default (the whole track).
- A non-empty selection that resolves to zero ids/lanes on this track (an empty bars window, a
  notes list that names the track but none of its actual ids) **throws**.

`selectionToNoteIds` itself is untouched — it remains the narrower, notes-only resolution it always
was (still used/testable independently); `selectionToVaryScope` is the new, vary-specific,
hit-and-lane-aware generalization.

### 3. CLI wiring: `beat vary <file> <track> feel --scope selection --port <p>`

`cli/beat.mjs`:

- `--scope selection` requires `--port <port>` — the exact convention `beat selection` already
  established for talking to a running daemon (`selectionCmd`'s `http://127.0.0.1:<port>`
  pattern). Reused verbatim, not reinvented.
- `--scope selection` cannot be combined with `--lanes`/`--ids` (pick one way to scope) — fails
  loudly via the existing `BeatEditError` convention.
- `--scope selection` only applies to `beat vary <file> <track> feel` (rung 2). Param-group
  variants (`beat vary <file> <track> filter`, etc. — rung 1, `varyTrack`) mutate whole-track
  synth params; there's no per-note/lane concept to scope by, so this is rejected up front with a
  clear message rather than silently ignored.
- The new `fetchSelectionScope(port, doc, track)` helper is the *only* part of the feature that
  touches the network: `GET /selection` from the daemon, then `selectionToVaryScope` (pure, from
  `src/core/index.ts`) resolves it against the already-parsed document. `BeatSelectionError` is
  caught and re-thrown as `BeatEditError`, matching every other CLI error path.
- The resolved scope prints (`scope: selection -> lanes hat` / `-> N id(s): ...` / `-> whole
  track`) so a human running the command can see what got scoped before variants land on disk.

`USAGE` gained a line for the new invocation form.

## Testing — what's real-daemon-verified vs pure-function-unit-tested

Per this repo's stated preference, the selection -> scope *resolution* is a pure function and is
tested with zero daemon/network involvement (`test/selection.test.ts`, 12 new tests: 2 for the
`validateSelection` drum-hit-id acceptance, 10 for `selectionToVaryScope` itself): empty
selections, tracks-only selections, the "different track" rejection, bars-only selections
applying across every track, pure-lane pass-through, lane+bars narrowing to concrete ids, a
notes-axis mapping to ids on both a drum track (hit ids) and a synth track (note ids), the full
tracks-AND-bars-AND-notes intersection, and the "resolves to zero" rejection.

What genuinely needs a live daemon is the network hop itself — `GET /selection` returning real
JSON to a real `fetch` call from a real `beat` subprocess — so `test/vary-scope-selection.test.ts`
spins up a real `startDaemon()` (same pattern as `test/daemon.test.ts`/`test/selection.test.ts`),
POSTs a selection to it over HTTP, then drives the actual `cli/beat.mjs` as a **separate OS
process** via `child_process.execFile` (6 new integration tests): a lanes selection scoping a
feel batch to one drum lane (hat hits move, everything else provably doesn't), a notes selection
scoping a synth track to one note id, the different-track rejection surfacing through the real
CLI exit code (2) and message, the empty-selection-falls-back-to-whole-track case, the
missing-`--port`/combined-with-`--lanes` rejections, and the param-group rejection.

**One easy-to-miss trap, worth recording:** the first draft of that integration test used
`execFileSync` to run the `beat` subprocess. Since the daemon lives in the *same test process*,
a synchronous spawn blocks that process's entire event loop until the child exits — which
deadlocks the instant the child `beat` process tries to open an HTTP connection back to the
daemon it's supposed to be querying. Switched to async `execFile` (promisified) so the event
loop stays free to service the daemon while the child runs. Left a comment in the test file so
nobody reintroduces it.

## Exit criteria

- [x] `src/core/selection.ts`: axis semantics documented as decided (not open), with the "absent
      axis = unfiltered" rule stated once near `BeatSelection` and referenced from
      `selectionToVaryScope`'s own doc comment.
- [x] `validateSelection` resolves a `notes`-axis entry against drum hits, not just synth notes.
- [x] `selectionToVaryScope` — pure, exported from `src/core/index.ts`, fully unit-tested.
- [x] `beat vary --scope selection --port <p>` wired in `cli/beat.mjs`, reusing `selectionCmd`'s
      daemon-fetch convention; `USAGE` updated.
- [x] Fails loudly (`BeatEditError`) on: missing `--port`, `--scope selection` combined with
      `--lanes`/`--ids`, `--scope selection` on a non-`feel` group, and a selection that doesn't
      cover the target track.
- [x] `npm test` green modulo the pre-existing `test/history.test.js` flake (macOS tmpdir-symlink
      vs git-realpath mismatch, unrelated to this change).
- [x] Test count increased from the 187-test baseline.

## Result (2026-07-11)

Shipped. `npm test`: **214 tests, 208 pass** (the pre-existing `history.test.js` flake accounts
for all 6 failures — same 6/6 failure mode as before this change, confirmed unrelated). This
change adds 18 tests: 12 new `selectionToVaryScope`/`validateSelection` unit tests in
`test/selection.test.ts` (no daemon), and 6 new CLI-level integration tests in
`test/vary-scope-selection.test.ts` that spin up a real daemon and drive the real `beat` binary
as a subprocess over real HTTP — comfortably clearing the 187-test baseline this phase started
from (214 total, up from 187).

Files touched: `src/core/selection.ts` (axis-semantics doc comment, drum-hit-aware
`validateSelection`, new `selectionToVaryScope`/`VaryScope`), `src/core/index.ts` (exports),
`cli/beat.mjs` (`--scope selection` in the vary path, `fetchSelectionScope`, `USAGE`),
`test/selection.test.ts`, `test/vary-scope-selection.test.ts` (new).

No changes needed in `src/vary/vary.ts` — `FeelVaryOptions.lanes`/`.ids` already generalized far
enough that the selection resolution slots in without touching vary/humanize internals, exactly
as hoped going in.

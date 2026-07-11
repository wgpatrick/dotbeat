# Phase 9 — the night-shift push (five parallel streams)

*Kicked off 2026-07-11, owner direction: "work a long night shift... come up with a roadmap and
just make it happen." Five independently-scoped streams dispatched in parallel git worktrees,
merged back into `main` as each lands. Scope was chosen from the backlog already sitting in
`ROADMAP.md` / `docs/decisions.md` / the phase-6/7/8 "Deferred"/"Remaining" sections and
`docs/product-spec-desktop.md`'s open questions — nothing invented from scratch, just picking up
threads already dropped.*

**Explicitly not attempted tonight**: the Tauri shell (D1). It needs the separate `beatlab` repo
checked out locally (not present on this machine) and a real display to verify WKWebView/Web Audio
behavior — not something that can be honestly verified headless overnight. Left for a session
where that checkout exists.

## Stream A — Format v0.9: clip automation grammar

Closes the exclusion phase-6 flagged explicitly: "Clip automation (needs the automation grammar —
next format phase)." Automation points as first-class text: per-param point lists inside a clip
(and/or a live track), same discipline as everything else — stable ids, canonical time ordering,
elided when absent. Full round-trip + diff + `beat set`-sugar + CLI/MCP surface.

Owns: `src/core/document.ts` (automation types only), `parse.ts`, `serialize.ts`, `diff.ts`,
`edit.ts` (automation edit primitives), `convert.ts` (automation conversion / no-longer-dropped
reporting), `inspect.ts` (automation display), `docs/format-spec.md`, one new CLI command block
in `cli/beat.mjs`, one new MCP tool in `src/mcp/server.ts`, new
`test/format-v09-automation.test.ts`. Result recorded in its own
`docs/phase-9-automation-plan.md`.

## Stream B — Variation loop rung 3: preference ranking from the scoring exhaust

`docs/variation-loop.md` names this explicitly as the next rung: "preference surrogate +
clustering" over the accumulated `(params, render, score)` triples in `beat-scores.jsonl`. Build
`beat suggest <file> <track> <target>` — reads the append-only scores log, derives a simple
pairwise preference signal (Bradley-Terry-style win counts from each round's ranked picks) per
mutation group, and proposes the next `beat vary` invocation (group + amount + seed) biased toward
what's been preferred so far, with the reasoning printed (which groups/directions won, sample
size) so it's a suggestion, not a black box.

Owns: new `src/vary/suggest.ts` (or similarly named new file), its exports off `src/vary`/`core`
index, one new CLI command in `cli/beat.mjs`, one new MCP tool, new
`test/vary-suggest.test.ts` with synthetic score logs. Result in its own
`docs/phase-9-vary-suggest-plan.md`.

## Stream C — Phase 8 finish line: instrument tracks

`docs/phase-8-plan.md`'s own "Remaining" list, worked off directly: master-bus routing for
instrument audio in the offline render (currently bypasses the limiter — fix it), instrument
tracks gaining clip/timeline participation (same note-based clip grammar synth tracks already
have), the `beat_song` MCP tool actually covering instrument tracks, and a multi-preset story
(`beat inspect` lists a loaded SF2 bank's available programs, not just the one in use).

Owns: `cli/render-offline.mjs` (bus routing fix — additive, don't touch drum/synth bus code),
`src/core/document.ts` (only the "clips allowed on instrument tracks" bit — do not touch
automation types, that's Stream A's), `convert.ts` (instrument clip conversion + a soundfont
preset-listing helper — additive functions, don't reformat existing ones), `inspect.ts`
(soundfont preset listing + instrument clip display), `src/mcp/server.ts` (extend `beat_song`,
additive only). New test file for instrument clips. Result appended to `docs/phase-8-plan.md`
under a new dated "Status update" section (don't rewrite existing sections).

**Merge note**: this stream's file list overlaps `document.ts`/`convert.ts` with Stream A. Keep
changes surgical and additive (new fields/functions, not edits to existing automation-unrelated
code) so a sequential merge stays low-conflict.

## Stream D — History UX: named pins + retention polish

`docs/product-spec-desktop.md` §4 names "named versions" (pin a checkpoint, ≤25-char title) and
"unnamed checkpoints collapse between named ones so the timeline skims" as still-open refinements
over the shipped D3 checkpoint/history/restore. Build `beat pin <file> <ref> <name>` (a lightweight
git-native tag on the history repo, not a new file format — keep the "no cloud, plain local git"
property), `beat history --pinned` (or equivalent flag) that collapses unnamed checkpoints between
pins, and surface pins in `beat history`'s normal output.

Owns: `src/history/history.ts`, the checkpoint/history/restore command block in `cli/beat.mjs`,
the corresponding MCP tools, `test/history.test.ts` additions. Result appended to
`docs/product-spec-desktop.md` §4 (mark the two open refinements as done) plus a short note in
`docs/decisions.md` if a new decision was actually made (e.g. tags vs sidecar file for pins).

**Known local flake**: `history.test.js` currently fails 6/6 of its own tests on this machine only
— a macOS tmpdir-symlink vs git-realpath mismatch (`/var/folders` vs `/private/var/folders`),
unrelated to this stream's code. Don't chase it as a regression; if the fix is cheap (resolve
realpath before shelling to git), take it, but don't block the stream on it.

## Stream E — Selection protocol refinement + `beat vary --scope selection`

Two open items from `docs/product-spec-desktop.md`: (1) the open question "does `bars 8 16` with
no `tracks` mean all tracks?" — resolve as documented-leaning: selection axes are independent
filters, an absent axis is unfiltered, and encode that in `src/core/selection.ts` with tests; (2)
the explicitly-planned wiring that never landed: "`beat vary --scope selection`" pulling the
*current* selection from a running daemon and using it to scope the batch (lanes/ids), so
"highlight the hats, run vary" works without typing the scope out by hand.

Owns: `src/core/selection.ts`, `src/vary/vary.ts` only if a pure-core hook is cleaner than
CLI-level resolution (prefer CLI-level — fetch selection over HTTP the same way `beat selection`
already does, then pass resolved `--lanes`/`--ids` through to the existing vary path, no core
changes needed if so), the `vary` command block in `cli/beat.mjs`, new tests. Result in its own
`docs/phase-9-selection-vary-plan.md`.

## Process

Each stream runs in its own git worktree/branch, keeps `npm test` green (modulo the Stream D flake
noted above), commits as it goes (not pushed), and is merged back into `main` sequentially by hand
once done, running the full suite after each merge. Streams A and C are the most likely to need a
manual merge conflict resolution pass given the file overlap noted above.

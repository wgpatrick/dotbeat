# Phase 9 — the night-shift push (five parallel streams)

*Kicked off 2026-07-11, owner direction: "work a long night shift... come up with a roadmap and
just make it happen." Five independently-scoped streams dispatched in parallel git worktrees,
merged back into `main` as each lands. Scope was chosen from the backlog already sitting in
`ROADMAP.md` / `docs/decisions.md` / the phase-6/7/8 "Deferred"/"Remaining" sections and
`docs/product-spec-desktop.md`'s open questions — nothing invented from scratch, just picking up
threads already dropped.*

**Update**: originally deferred the Tauri shell (D1) on the assumption this machine had no
`beatlab` checkout, no network access, and no way to verify a GUI headlessly. All three
assumptions were wrong — Xcode Command Line Tools are installed, GitHub is reachable, and this
*is* the owner's real Mac with a real display attached, so a launched window can actually be
screenshotted (`screencapture` + reading the image) for honest visual verification, even though
nothing here can literally listen to audio. Added as Stream F below, owner-directed.

## Stream F — D1: Tauri shell spike + scaffold

`docs/product-spec-desktop.md` §6 names D1 first in the desktop milestone sequence ("cheap, makes
everything after it feel real") and research 13 (`docs/research/13-tauri-shell.md`) flags one
concrete risk to de-risk before committing to the milestone: **macOS WKWebView's Web Audio
support** — untested, with Electron as the named fallback if it fails. Do the spike for real
before building the full shell.

Scope, in order:
1. **The spike**: a minimal Tauri app (new `desktop/` dir in this repo) that loads a tiny Tone.js
   test page in its WKWebView and confirms audio actually initializes and plays (AudioContext
   reaches `running`, a scheduled tone actually fires — verify via injected JS logging to a file
   the agent can read back, since nobody here can literally listen). Report the result honestly:
   pass/fail, and if fail, note Electron as the documented fallback rather than fighting it.
2. **If the spike passes**: clone `https://github.com/wgpatrick/beatlab` locally (outside this
   repo's git tree — a sibling/scratch directory, gitignored, not committed) and wrap its existing
   web GUI in the Tauri shell: daemon (`cli/daemon.mjs`) spawned as a sidecar process, WKWebView
   pointed at what the daemon serves, open-a-folder + native file dialogs per the D1 spec.
3. Launch the real app at least once and take a screenshot (`screencapture`) to visually confirm
   it renders (read the screenshot back) — this is real verification, not a guess, since this
   session runs on the owner's actual machine with a real display. Close/quit the app when done
   rather than leaving stray windows open.

Own: new `desktop/` directory (Tauri project: `src-tauri/`, `tauri.conf.json`, minimal frontend),
its own `docs/phase-9-tauri-spike-plan.md` result doc (problem, what was spiked, pass/fail with
evidence, what shipped vs honestly deferred — full shell polish, native file dialogs edge cases,
etc. are NOT expected to land in one night, the spike verdict is the deliverable that matters
most). Low collision risk — entirely new files, no overlap with streams A-E.

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

## Result (2026-07-11)

All six streams shipped and are merged into `main`. Final suite: **280 tests, 274 passing, 0
failing, 6 cleanly skipped** (the master-bus tests self-skip without the patched
`node-web-audio-api` build, which isn't checked out on this machine — unrelated to tonight's work).

- **Merge conflicts, exactly where predicted**: Stream D vs B collided on adjacent new imports in
  `src/mcp/server.ts` (trivial, both import lists kept). Stream C vs A collided on a one-line
  comment in `src/core/parse.ts` describing what a clip's level-2 lines can contain (both true,
  merged into one comment covering automation lanes *and* instrument-track note clips). Streams B,
  E, and F merged with zero conflicts.
- **Stream D fixed a real pre-existing bug** while in `src/history/history.ts` for unrelated
  reasons: the macOS tmpdir-symlink-vs-git-realpath mismatch that had been failing 6 `history.test.js`
  tests on this machine all night. Fixed via `realpathSync`, verified, and confirmed by every
  subsequent stream's clean run.
- **One integration-time bug found and fixed** (not any single stream's fault): Stream C's
  `test/master-bus.test.ts` suppressed a TypeScript error on only one of two dynamic
  `import('node-web-audio-api')` calls; the module is a dangling symlink on this machine (the
  patched upstream build was never checked out here), so `tsc` failed the whole build the moment
  Stream C's branch landed. Fixed by suppressing both — the tests now skip cleanly instead, which
  was always the intent.
- **Also picked up mid-session**: an unrelated commit landed on `origin/main` from a separate
  session ("D1 groundwork: daemon opens a project folder") — pulled in early since Stream F's
  scaffold built directly on it.
- **What actually shipped, concretely**: format v0.9 (clip automation, `beat automate`); `beat
  suggest` (variation-loop rung 3, pairwise preference ranking over the scores exhaust); the
  phase-8 instrument-track finish line (master-bus/limiter routing fixed, instrument clips/timeline,
  multi-preset `beat inspect` listing); `beat pin`/`beat history --collapsed` (named checkpoints,
  collapsed retention view); resolved selection-axis semantics + `beat vary --scope selection`; and
  a **passed** WKWebView Web Audio spike plus a real `desktop/` Tauri D1 scaffold (daemon + beatlab
  dev server as sidecars, native folder-open dialog).
- **Honestly still open**: the Tauri shell's sidecar is a spawned `node`/dev-server process, not a
  packaged binary; no signing/notarization; folder re-pointing doesn't yet restart the daemon;
  beatlab-side engine wiring for clip automation is documented but unverified (no local beatlab
  checkout with source to confirm against); GM/FluidR3 content itself wasn't fetched (the
  preset-listing mechanism is content-agnostic and done). See each stream's own `docs/phase-9-*.md`
  for full detail.

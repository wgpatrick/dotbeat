# Phase 2 build plan — the CLI becomes agent-native (ROADMAP M2)

> **STATUS: COMPLETE (2026-07-10).** Both exit criteria met — the diff-between-commits one is an
> automated test against a real git repo, and the offline-render spike came back with a
> decision-grade number (22×). See "Result" at the bottom.

Phase 1 left the file as the source of truth with a live sync daemon, and measured that sync is
nearly free (~10-60 ms per direction). M2 is where the *agent* side of "git-native, agent-native"
gets its primitives: inspect a project, mutate it surgically, and — the roadmap's exit criterion —
diff two versions **musically**, so `beat diff` between two commits reads like an edit list, not
like line noise.

## What the research already settled (apply, don't re-decide)

- **A semantic diff is the format's payoff, not a separate invention.** openDAW's undo system
  stores an inverse-update-log — a captured `Modification{forward, inverse}` *is* a computed diff
  (`docs/opendaw-notes.md` §7). Our `DiffEntry[]` list is the same shape: typed, per-entity,
  per-field changes. One data structure, usable for diff display now and undo/`--dry-run` later.
- **Stable IDs are what make musical diff possible at all** (D4): `alsdiff` matches Ableton
  entities by internal ID to defeat rename/reorder false-positives; REAPER's `.rpp` fails
  practitioners precisely because it lacks them. Our notes/tracks have stable IDs in the text, so
  matching is trivial by construction — the design bet paying off again.
- **`musicdiff` (prior art) diffs notation, not text** — its lesson (`docs/research/01-landscape.md`):
  a musical diff should say *what changed musically* ("note moved", "cutoff swept"), not which
  bytes changed. That's the target output style.
- **The render-speed path is known but gated** (D5 + `docs/opendaw-notes.md` §9):
  `node-web-audio-api` runs real Tone.js in Node with `OfflineAudioContext` — the exact
  incantation is documented from reading its own examples. But wiring the *actual BeatLab engine*
  through it requires the engine extraction (the M0 repo-split work deliberately deferred).
  Phase 2 does the honest intermediate step: a spike that validates the recipe in this
  environment and measures the speedup, so the extraction work is justified by numbers, not hope.
  Headless Chromium remains the fidelity reference either way.

## The pieces

| # | What | Where |
|---|---|---|
| 2.1 ✅ | `src/core/diff.ts`: `diffDocuments(a, b)` → typed `DiffEntry[]` (bpm/loop/selection, track added/removed/renamed/recolored, synth param changed, note added/removed/changed, pattern lane changed at step granularity) + `formatDiff()` — one edit per line, track-scoped, human- and agent-readable | core (architecture.md places "musical diff" in core explicitly) |
| 2.2 ✅ | `src/core/edit.ts`: `beat set` primitives — path-based mutation (`bpm`, `lead.cutoff`, `drums.pattern.kick[3]`, `lead.name`), plus `addNote`/`removeNote`. Pure document→document functions; strict errors on unknown paths/tracks/lanes (fail loudly, same stance as the parser) | core |
| 2.3 ✅ | `src/core/inspect.ts`: `describeDocument()` — compact overview (header, per-track kind/params-of-note/note-or-pattern summary); `--json` in the CLI is just the parsed document | core |
| 2.4 ✅ | `cli/beat.mjs`: one entry point — `beat render\|daemon\|inspect\|set\|diff\|help`. `render`/`daemon` refactored into importable commands (auto-run only when invoked directly). `beat set` re-serializes canonically and prints the resulting one-line-diff-able change; `beat diff` takes two files **or** `--git <rev1> <rev2> <file>` (via `git show rev:path`) | cli |
| 2.5 ✅ | Tests: diff/edit/inspect unit tests + an end-to-end `beat diff --git` test against a real temp git repo with two real commits (the literal exit criterion, automated) | test/ |
| 2.6 ✅ | Offline-render spike: install `tone` + `node-web-audio-api`, run the archaeology recipe (polyfill → `Tone.setContext` → `Tone.Offline`), measure the faster-than-real-time factor on a comparable workload, write findings here | `scripts/spike-offline-render.mjs` |

## Exit criteria (ROADMAP M2, verbatim)

- [x] Render a project to WAV from the command line with no GUI open. *(`beat render` under the
      unified entry point, re-verified post-refactor: same 1,365,376-byte WAV, exit 0. The faster
      offline path is spiked and measured — see Result — adoption gated on engine extraction.)*
- [x] A `beat diff` between two commits reads like an edit list. **Automated as a test** against
      a real temp git repo with a real editing session between two commits
      (`test/cli.test.ts`, "THE M2 EXIT CRITERION"), output verbatim:
      ```
      # song.beat: HEAD~1 -> HEAD
      bpm: 126 -> 124
      bass: note added u100001 (pitch 36, start 0, dur 4, vel 0.85)
      lead: cutoff 3200 -> 900
      ```

## Explicitly deferred past Phase 2

Full `node-web-audio-api` render of the real engine (needs the engine extraction — do it when
the spike numbers justify it); `beat mcp` (M3); metrics engine (M3); `beat set` for
clips/automation (not in the format yet); undo/`--dry-run` (the DiffEntry shape is ready for it).

## Sequencing

2.1 → 2.2/2.3 (independent) → 2.4 (consumes all three) → 2.5 (needs 2.4) → 2.6 (independent,
anytime).

## Result

55 tests green (was 36). The agent-facing loop now exists end to end without a GUI:

```bash
beat inspect song.beat            # compact overview, drum grids as X..x strips; --json for machines
beat set song.beat lead.cutoff 900 bpm 124    # prints "lead: cutoff 3200 -> 900", canonical write
beat add-note song.beat bass 36 0 4 0.85      # mints a non-colliding u-id, prints itself
beat diff --git HEAD~1 HEAD song.beat         # the edit list above; exit codes follow diff(1)
beat render song.beat -o mix.wav --beatlab-dir ../beatlab
```

**The spike number (the decision this phase was set up to buy):** real Tone.js running on
`node-web-audio-api` in this environment rendered a BeatLab-shaped workload (filtered-saw
bassline, 4 bars at 126 bpm, same length as `examples/real-groove.beat`) —
**7.62 s of audio in 343 ms, 22× faster than realtime**, real audio verified (peak 0.456), WAV
written. The realtime Chromium path needs 7.6 s of capture *plus* ~10-15 s of browser/vite boot
per render; the offline path would collapse an M3 agent's render-listen iteration from ~20 s to
well under a second once the real engine runs on it. **Conclusion: the engine extraction
(`engine/` split so beatlab's actual graph runs in Node) is now justified by measurement, not
hope — it should be the core of M3's engineering work**, with headless Chromium kept as the
fidelity reference to diff renders against (D5), exactly as planned.

Things found by running, this phase's collection:

1. The exit-criterion output needed one design pass to *read* like an edit list: track
   added/removed summarizes (one line) instead of exploding into per-note entries; renames can't
   cause false note diffs (ID matching); reorders report moves among common tracks only, so one
   insertion doesn't read as "everything moved."
2. `node-web-audio-api@2.0.0` exposes the polyfill as a plain subpath (`node-web-audio-api/polyfill.js`)
   — the `#`-alias import in the archaeology notes is their internal example wiring, not the
   public entry. The recipe otherwise held exactly as documented.
3. `beat set`'s path grammar reuses the file's own field names verbatim (`lead.cutoff`,
   `drums.pattern.kick[3]`) — no second vocabulary for agents to learn, and error messages
   enumerate the valid names so a wrong path is self-correcting in one round trip.

Next: M3 — `beat mcp` over these CLI ops, the metrics engine, and the engine extraction the
spike just green-lit.

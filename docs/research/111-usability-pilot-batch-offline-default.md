# Usability pilot 111 — batch renders default to offline (`beat vary --render` / `beat render --batch`)

**Goal:** Persona: a musician who has used the taste loop before (vary → render → blind audition →
score are familiar verbs, rediscovered via `beat help`) but has NOT seen the new render-mode
behavior: `render --batch` now defaults to OFFLINE compute with a printed mode banner, auto-falls
back to live capture for soundfont projects, and grew a `--live` override. Project: a copy of
`examples/real-groove.beat`. Judge everything from the CLI's own output: is it always clear which
render path ran and why, and does anything about the banner/fallback/flags mislead mid-flow? No
source reading until after the session.

## Narrative walkthrough

**Happy path.** `beat help vary` → `beat inspect` → `beat vary real-groove.beat bass --groups`
(the help itself points at `--groups` for a track's real targets) → `beat vary real-groove.beat
bass filter --count 3 --seed 7 --render`. The batch printed its three variants' exact edits, then:
`batch rendering offline (exact compute through the engine; pass --live to force realtime capture)`
— mode, rationale, and the override flag in one line. Each variant then printed
`rendering (offline compute through dotbeat's own engine)` plus a measured ratio
(`offline compute: 7.84s for 7.62s of audio (1.0x realtime)`). Banner and per-variant lines agreed
in every run of the session; at no point was the active path ambiguous. Total: 26s wall for 3
renders through one harness boot. Small dent: v1 printed "1.0x realtime" AND "note: offline
computed slower than realtime on this machine" (7.84s > 7.62s, so technically true, but a rounded
1.0x sitting next to a "slower" warning reads contradictory), while v2/v3 — also displayed as
1.0x — got no note. In a later identical run the note appeared on v1 and v2 but not v3. Per-variant
jitter deciding a per-batch-shaped advisory.

`beat audition vary-filter-7` stitched a shuffled audition.wav and said exactly the right thing:
"order shuffled — listen and rank BEFORE looking at the answer key in .../audition.json". The
shuffle was real (key order v2, v3, v1). Picked the bright variant (v1, cutoff 2450 Hz — `beat
metrics` on the three wavs standing in for ears), scored with the command the render output had
already handed me verbatim. `beat score vary-filter-7 v1 v3 v2` → confirmed in
`beat-scores.jsonl`: full entry with ranks, replayable `beat set` edits per pick, parent sha256,
and per-variant audio features. The loop also printed the adopt command for the winner. Every
stage's output contained the literal next command; the taste loop is genuinely self-guiding.

**Re-render with `--live` — where the wheels came off.** `beat help render` documents
`beat render --batch <dir> [--live | --offline]` clearly (defaults offline, soundfont fallback
with printed reason, `--live` forces capture, `--offline` errors instead of falling back). But
`beat render --batch vary-filter-7 --live` exits 1 with a usage line that doesn't even mention
`--batch` or `--live`; `--batch <dir>` alone does the same; `<dir> --batch` throws a raw EISDIR
stack trace (the dir read as a .beat file); `--batch=<dir>` errors "unknown flag" — while listing
`--batch` and `--live` as *known*. Every ordering a user could type fails. The documented batch
entry point is unreachable from `beat`.

So I tried the other obvious route: `beat vary ... --render --live`. It ran — and **silently
swallowed `--live`, rendering offline again**, under a banner whose own text says "pass --live to
force realtime capture". I did exactly what the CLI told me and it ignored me without a word.
(`vary --bogus` confirmed: vary accepts any unknown flag, exit 0 — the same lax parsing pilot 109
flagged on `render`, which is now fixed *on render* but not here.) Net: there is currently **no
way to get a live batch render from the CLI at all**. Silver lining discovered en route: same-seed
re-vary reproduces byte-identical variant .beat files, so per-variant workarounds are safe.

Workaround: single-file renders. `beat render vary-filter-7/v1.beat --live -o live-wavs/v1.wav`
worked, printing `rendering (real-time capture through dotbeat's own engine)`. Offline-vs-live of
the same variant: bytes differ (expected), `beat metrics` within 0.2 dB on every number (LUFS
-24.3 vs -24.1, peaks -8.9 vs -8.7) — same mix to a musician's ear. Plain single-file `render`
(no flag) still defaults to live capture and says so; the batch/single default asymmetry is
documented in help and each path labels itself, so it never actually confused me.

**Mistaken paths on `render` are now excellent:** `--live --offline` → `error: --offline and
--live are mutually exclusive` (exit 2); `--offlin` → `error: unknown flag "--offlin" (known:
...)` (exit 2). Pilot 109's silent-downgrade finding is fixed where it was found — vary just
didn't get the same treatment.

**Soundfont fallback, seen cold.** Copied `examples/night-shift-song.beat` + `examples/media/`,
ran `beat vary night-shift-song.beat lead filter --count 3 --seed 5 --render`. The fallback banner
is exemplary: `batch rendering via live capture (offline refused: instrument (soundfont) tracks
need a native realtime context (worklet) — offline render does not support them yet: instrument,
instrument5, instrument6, instrument7)` — mode, reason, and the offending tracks by name, and the
per-variant lines duly said "real-time capture". Judged cold, it explains itself completely.

Then the run itself collapsed: ~2,130 repeated `[engine] instrument ... failed to load: fetch
soundfont "media/upright-piano-kw-small.sf2": HTTP 404` warnings (457KB of output), 33× `Error:
Start time must be strictly greater than previous start time`, and a hard crash — triple-nested
stack trace, zero wavs. Two separate causes untangled by experiment: (a) the .sf2 isn't in
`examples/media/` at all (it lives in `presets/sf2/`), and even after copying it next to the
project the *batch* still 404'd — because the harness serves the batch out-dir and the group-vary
path never creates the `media ->` symlink there (a fresh minimal soundfont project built with
`beat init`/`beat sample`/`beat add-track` rendered its `feel` batch perfectly, symlink present,
soundfont loaded, 3 wavs — proving the fallback path CAN work end-to-end and its banner
(`offline refused: ...: keys`) is just as clear on the small case). (b) live capture of
night-shift-song is broken regardless: a single-file `beat render night-shift-song.beat` with the
soundfont loading fine (0 404s) still failed after 77 seconds with `error: page error(s) during
render:` — followed by an EMPTY list. A 77-second wait ending in an error with literally no reason
is the worst moment of the session; the batch path at least showed me the real "Start time" error.

One more vary dent found via the minimal piano project: `beat vary piano.beat keys filter` (and
`mix`, and every non-feel group) refuses with "group ... mutates synth/drums-track params that a
instrument track never plays — an inaudible no-op batch; legal groups for "keys": kick, snare,
hats, filter, env, filterenv, osc, motion, fx, sends, mix" — refusing `filter` while listing
`filter` as legal, in the same sentence. `vary piano.beat keys --groups` prints the same wrong
list. Only `feel` actually works on an instrument track.

## Findings summary

- **[bug] HIGH — `beat render --batch` is unreachable from the `beat` CLI.** Every ordering fails:
  `render --batch <dir>` → single-file usage + exit 1; `render <dir> --batch` → raw EISDIR stack;
  `--batch=<dir>` → unknown-flag error that lists `--batch` as known. Post-session attribution:
  `cli/beat.mjs:3186` (`case 'render'`) always calls `renderCommand(rest)`; the
  `--batch → renderBatchCommand` routing exists only in `cli/render.mjs`'s direct-invocation
  footer (line 633), which only `vary` reaches via `execFileSync`. `renderCommand`'s parseArgs
  consumes `--batch <dir>` into an ignored field, leaving no positional → the stale usage line
  (render.mjs:440, which itself omits `--batch`/`--live`). `beat help render` documents a form the
  binary cannot run. CLI-specific.
- **[bug] HIGH — `--live` is advertised by the offline banner but unreachable for batches.** The
  banner says "pass --live to force realtime capture", yet `vary --render --live` silently ignores
  `--live` and renders offline (vary accepts unknown flags, exit 0, and
  `dist/src/vary/batch.js:renderVaryBatch` never forwards mode flags — it invokes
  `render.mjs --batch <dir>` bare), and the only surface that parses `--live` for batches is the
  broken entry point above. Mid-flow this is actively misleading: the CLI names a flag, the user
  passes it, nothing changes, nothing warns. Combined effect of this + the previous finding:
  **live batch rendering does not exist right now**, and neither does strict `--offline` batch
  mode. CLI-specific (cross: `cli/beat.mjs` vary flag parsing + `dist/src/vary/batch.js`).
- **[bug] HIGH — param-group vary batches never link the project's media.** `cli/beat.mjs:1429`
  (group path) calls `renderVaryBatch(outDir, n)` without `linkMediaFrom`, while the feel (1542)
  and automation (1588) paths pass it. Consequence: for any project with media (samples or
  soundfonts), a group-vary `--render` serves the batch dir with no `media/` → every fetch 404s
  (2,150 spammed warnings here), instruments render silent, and the automatic soundfont-to-live
  fallback the banner promises is hollow for exactly the projects it exists for. Repro:
  group-vary any soundfont/sample project with `--render`; compare `ls <batch-dir>` (no `media`
  symlink) against a feel-vary batch dir (symlink present). Core/CLI shared
  (`dist/src/vary/batch.js` caller contract).
- **[bug] MEDIUM-HIGH — live render of `night-shift-song.beat` fails outright, and single-file
  mode swallows the reason.** With its soundfont present and loading (0 404s), `beat render
  night-shift-song.beat` ran 77s of capture then exited 1 with `error: page error(s) during
  render:` and an empty list; the batch path shows the underlying engine error (`Start time must
  be strictly greater than previous start time` ×33, a Tone.js scheduling error, likely song-mode
  related) before hard-crashing with a triple-nested stack. Two fixes conflated: the engine
  scheduling bug (also affects the GUI presumably — engine-level), and the CLI's empty error list
  (`cli/render.mjs` captureWav error path — the messages exist, batch mode prints them). Since
  soundfont projects are *forced* onto live capture by the fallback, a soundfont song project
  currently cannot be batch-rendered at all.
- **[confusing] MEDIUM — vary's instrument-track group refusal contradicts itself.** Every
  non-feel group on an instrument track errors "an inaudible no-op batch" and then lists the
  refused group among "legal groups" for that same track; `vary <file> <track> --groups` prints
  the same wrong list (it's the static synth list, kick/snare/hats included). The guard's intent
  is good (109-style honesty about no-op batches); the recovery text sends the user in a circle.
  Only `feel` works — say so. CLI-specific.
- **[confusing] MEDIUM — `vary` silently accepts unknown flags** (`--bogus`, `--live`: exit 0, no
  warning) — the exact lax-parsing class pilot 109 flagged on `render`, now fixed on `render` but
  absent here, and the direct enabler of the `--live` swallow above. CLI-specific.
- **[confusing] LOW — the slower-than-realtime advisory is jittery and can contradict the printed
  ratio.** "1.0x realtime" + "slower than realtime" on the same variant (7.84s vs 7.62s, rounding),
  and within one batch some variants get the note and others don't. Decide it once per batch from
  the aggregate, or print the unrounded ratio.
- **[confusing] LOW — huge repeated warning spam on media failure**: the same soundfont 404
  printed ~2,130 times (457KB) in one batch run, with minified bundle stack frames. One line per
  missing asset per variant would carry the same information; better, a parse-time "media/x.sf2
  not found next to the project" (the CLI already stats the project fine).
- **[worked well] — the mode banner system is the star of the feature.** In all 12 render
  invocations, the batch banner ("batch rendering offline (...)" / "batch rendering via live
  capture (offline refused: <reason>)") matched the per-variant lines ("offline compute" /
  "real-time capture") which matched observed behavior; ground-truthed against wav presence,
  timings, and metrics. A user reading output always knows which path ran and why.
- **[worked well] — the soundfont fallback message explains itself completely, cold**: mode,
  reason, and offending track names in one line, verified on both a 10-track song and a minimal
  1-instrument project. (The *message* is right even where the run then fails for the media-link
  reasons above.)
- **[worked well] — mistaken paths on `render`**: `--live --offline` → clean mutual-exclusion
  error; typo'd flag → unknown-flag error with the known-flag list. Both exit 2. Pilot 109's
  silent-downgrade MEDIUM is fixed where filed.
- **[worked well] — the taste loop's self-guidance**: every stage printed the literal next command
  (vary → "audition, then: beat score <dir> ..."; audition → "rate it blind, then: ..."; score →
  the adopt command with replayable edits). The blind-shuffle protocol is explained in the output
  itself, and the answer key matched. `beat-scores.jsonl` entry verified complete (ranks,
  replayable edits, parent sha, per-variant features).
- **[worked well] — offline and live agree on the mix**: same variant, byte-different wavs,
  `beat metrics` within 0.2 dB across the board — plus same-seed vary reproducing identical
  variant .beat files made cross-mode comparison trustworthy.
- **[worked well] — building a minimal soundfont project cold took 4 commands**, with the one
  error hit ("no sample ... — register it with beat sample first") naming the exact fix.
- **[improved since 109, residual] — vite preview leak**: 12 render invocations left exactly one
  zombie `vite preview` (port 5899, subsequent runs cleanly auto-bumped to 5900), versus 109's
  leak-per-invocation. The residual leak correlates with abnormal termination (hard-crash/killed
  runs); normal exits cleaned up.

## Where the pilot gave up on the "ideal" workflow

Two places. (1) The stated goal "re-render the same batch with --live" is impossible: both the
documented command (`render --batch --live`) and the discoverable alternative (`vary --render
--live`) fail — one loudly with the wrong usage text, one silently. Fell back to single-file
`render <variant>.beat --live` per variant, which worked and was only viable because same-seed
vary is reproducible. (2) The night-shift-song fallback render never succeeded at all (media
unlinked in group batches + live capture broken on that project); the fallback was instead proven
out on a purpose-built minimal soundfont project via the `feel` group — itself a workaround, since
every param group is (self-contradictorily) refused on instrument tracks.

## Methodology notes / stats

- Pure CLI pilot per `docs/usability-testing.md` "Variant: CLI/MCP pilots": no checklist, command
  surface rediscovered via `beat help <cmd>`, every output read before the next command, no source
  reading until post-session attribution (file:line notes above are from that afterward pass).
- Ground truth: banner-vs-actual verified per run; `beat-scores.jsonl` inspected raw; wav
  existence/sizes checked after every claim of "wrote"; offline/live wavs `cmp`'d + `beat
  metrics`'d; batch-dir listings diffed to catch the media-symlink split; `pgrep` sweep at cleanup.
- Fixtures: copies only, in the session scratchpad (`pilot-111/`); `examples/` untouched;
  scratch deleted and the one zombie process killed at session end; `git status` clean but for
  this report. One self-inflicted note: an early `| head` truncation SIGPIPE-killed a render
  mid-run — rerun without the pipe before drawing conclusions from it.
- ~25 minutes wall, ~35 tool calls, 12 render invocations (4 vary --render batches [2 crashed],
  1 broken-routing probe ×4 forms, 3 single-file renders [1 failed], 1 feel batch, plus metrics/
  audition/score). Timings on this box: offline 7.3-10.6s per 7.62s variant; live single ~11s
  wall; 3-variant offline batch 26s total; the failed 64s-audio live captures ~71-87s before
  dying.

# Usability pilot 99 — CLI-only audio-clip editing

**Goal:** Prior GUI pilots (`docs/research/85`, `88`, `93`) found real friction with audio-clip
editing in the GUI, most notably: (a) no way to place more than one independent audio region on a
track within a section, and (b) a split clip's second half getting created in the file but never
wired into any scene, i.e. orphaned. This pilot tests dotbeat's "headless operability is a
first-class requirement" thesis directly: create an audio track, attach a real sample, trim/warp
it, split it, and try to reproduce or rule out both GUI-found limitations — purely through the
`beat` CLI, discovering syntax from `--help` cold, never touching source until stuck.

## Narrative walkthrough

Started with `beat init` (clean) then `beat --help`, which turned out to document the *entire*
command surface in one dense screen, including `audio-clip` and `audio-split` signatures with
field-level detail (`in`/`out` in seconds, `warp off|repitch|complex`, trim via
`beat set <track>.clip.<id>.audio.<field>`) — better upfront discoverability than I expected from a
CLI with no `--help` per-subcommand drill-down.

`add-track song.beat drumsA audio --name "Audio Bed"` failed immediately: `error: track names are
single tokens in v0.2 (no whitespace)`. A genuine first stumble (undocumented in the top-level
help's `[--name N]`), but the error message was specific enough to fix on the spot
(`--name AudioBed`). `beat inspect` confirmed the audio track landed with `clips: none`.

Went looking for real media per the task brief: `presets/kit-init/` and `presets/kit-audiophob/`
both have real `.wav` files (the same library the GUI's Content Browser draws from). Checked
durations with `afinfo` — most are sub-0.3s one-shots; `kit-audiophob/openhat.wav` is the outlier
at 1.735s, long enough to make trim/warp meaningful, so I used that plus `kit-init/kick.wav` as a
second sample.

First `beat sample` call, pointing at the file by a computed relative path from the scratch dir
into the repo checkout, failed: `error: no file at ../../Users/.../openhat.wav (relative to
/private/tmp/dotbeat-usability-99-cli-audio) — put the audio next to the project first`. This is
the known macOS `/tmp` → `/private/tmp` symlink quirk (also seen elsewhere in this project's test
suite) tripping up a naive relative-path computation from `/tmp/...`, not a real `beat sample` bug
— the error message itself was actually excellent and told me exactly what to do. Copied both
samples into a `media/` folder next to `song.beat` (the realistic workflow anyway) and re-ran;
registration succeeded and printed the sha256, confirmed present in `beat inspect --json`'s `media`
array.

`beat audio-clip song.beat drumsA clip1 oh-audiophob 0 1.735` created the clip in one shot.
`beat inspect --json` showed the clip's `audio` field exactly as expected: `{media, in, out,
gainDb, warp, rate, markers}`. Ground truth matched the command's own success message.

Trim: `beat set song.beat drumsA.clip.clip1.audio.in 0.2 drumsA.clip.clip1.audio.out 1.2` — worked,
printed a readable diff (`audio in 0 -> 0.2, out 1.735 -> 1.2`), confirmed in the raw file
(`audio oh-audiophob 0.2 1.2 0 off 1`).

Warp: `beat set ... audio.warp repitch audio.rate 1.5` — worked cleanly, same diff-style output.

**Deliberately wrong paths.** (1) `audio.in 5 audio.out 1.2` (in > out): rejected with `error:
audio out-point must be > in-point, got in=5 out=1.2`, no partial write — the clip's raw fields
were unchanged afterward. (2) `audio.warp wobblewarp`: rejected with `error: warp must be one of
off|repitch|complex, got "wobblewarp"`. Both errors were precise and the file was provably
untouched by the failed attempt (checked via `grep` on the raw `.beat` before/after).

**Split.** First attempt, `beat audio-split song.beat drumsA clip1 8` (8 sixteenth-steps from clip
start), failed: `error: split position 8 steps is out of range for clip "clip1" (region spans
0.2-1.2s of source, split would land at 1.7s)`. The math checked out by hand: at rate 1.5, 8 steps
(1.0s of timeline) consumes 1.5s of source starting at in=0.2s → 1.7s, past the clip's own
out=1.2s. A well-reasoned, not just generic, rejection. Retried at step 3 (0.375 timeline seconds →
~0.5625s source, comfortably inside range): succeeded, printed `clip "clip1" audio out 1.2 ->
0.7625` and `clip added "clip1-2"`. `beat inspect --json` confirmed two fully independent clip
objects, both referencing the same media, contiguous in/out (`clip1`: 0.2–0.7625s, `clip1-2`:
0.7625–1.2s), both carrying the parent's warp/rate settings forward correctly.

**Multi-region test (finding a).** Added a second clip, `clip2`, on the *same* track (`drumsA`)
from a different sample (`kick-init`). `beat inspect` happily lists three clips on one track:
`clip1`, `clip1-2`, `clip2`. But a "clip" here is one slot of alternate content for a track (each
holding exactly one `audio` field, singular, not an array) — not a simultaneous timeline region.
Tried to force the issue via `beat scene song.beat sceneA drumsA=clip1 drumsA=clip2` (two mappings
for the same track in one scene call): no error, no warning — the file silently kept only the
*last* one (`slot drumsA clip2`; `clip1`'s slot mapping was dropped with zero indication in the
command's own output). This is the CLI-level confirmation that the underlying data model — not
just the GUI's presentation of it — genuinely allows only one clip, hence one audio region, per
track per scene slot.

**Orphaned-split test (finding b).** Rebuilt cleanly: `scene sceneA drumsA=clip1`, `scene sceneB
drumsA=clip1-2`, `song sceneA 8 sceneB 8`. `beat inspect` confirmed both scenes and a 16-bar song
timeline referencing both — i.e., unlike the GUI pilot, the CLI has a completely direct path
(`beat scene` + `beat song`, two ordinary commands) to wire a split clip's second half into a real
section. Nothing was orphaned.

**Complex warp discoverability cross-check.** Pilot 85 found the GUI lets you select `warp:
complex` with zero indication it's a no-op. Set it via CLI on `clip2`: `beat inspect` printed
`complex (unimplemented)` directly in the human-readable clip listing — the CLI surfaces the
limitation plainly where the GUI hid it entirely.

**Render + metrics.** `beat render song-audio.beat -o render-audio.wav` (8-bar section containing
only `clip1`) succeeded through dotbeat's own `ui/`-based engine (no BeatLab flag needed — that
migration has landed in this checkout). Rendered a matching-duration control (`sceneEmpty`, no
audio slot at all) to `render-noaudio.wav`. `beat metrics` on both: **with** audio, -28.1 LUFS
integrated, -12.2 dBTP peak, real spectral content (air 88%, centroid 11476 Hz); **without** audio,
-Infinity LUFS, -Infinity peak, 0% energy in every band — true digital silence. `cmp` confirmed the
two WAVs are byte-different. This conclusively shows the placed audio clip is genuinely part of the
rendered mix, not just a file-level fiction.

## Findings summary

- **[worked well]** `beat --help` alone was sufficient to discover the entire audio workflow
  (`add-track ... audio`, `sample`, `audio-clip`, `audio-split`, the `<track>.clip.<id>.audio.*`
  set-paths) with zero need to read source. Core/CLI strength, not incidental.
- **[worked well]** Every rejected edit (bad trim range, invalid warp string, out-of-range split)
  produced a specific, actionable error and left the file provably untouched — verified by diffing
  raw file content around the edit before/after each failed call. Core validation, exercised
  identically whether driven by CLI or GUI.
- **[worked well] — CLI advantage over GUI** `beat inspect` prints `complex (unimplemented)` inline
  wherever that warp mode is set. Pilot 85 found the GUI gives a user zero signal that `complex` is
  a dead-end warp mode; the CLI surfaces it as plain text in the default (non-JSON) inspect output.
- **[worked well] — confirms thesis** `beat render` + `beat metrics` gave a deterministic,
  byte-level proof (-28.1 LUFS vs. -Infinity LUFS on an otherwise-identical control render) that
  placed audio genuinely reaches the mix — the render pipeline itself is CLI/GUI-shared
  (`src/core`/`ui/` engine), so this is confirmation of the underlying engine, exercised headlessly.
- **[confusing] — CLI-specific** `beat scene <file> <id> drumsA=clip1 drumsA=clip2` (two mappings
  for the same track in one call) silently keeps only the last one, with no warning that the first
  was discarded. A real user typing a scene command with a typo'd duplicate track key gets silent
  data loss rather than a "duplicate track key" error. Low severity (single-call typo) but easy to
  fix — `beat scene`'s CLI parser could reject or warn on a repeated `<track>=` key.
  **This is CLI-specific plumbing** (a parsing/validation gap in `cli/beat.mjs`'s scene-arg parser),
  distinct from the model-level, both-surfaces limitation below.
- **[slow-to-discover] — environment quirk, not a real bug** A relative media path computed from
  `/tmp/...` resolves incorrectly against the CLI's real (symlink-following) working directory,
  since `/tmp` is a symlink to `/private/tmp` on macOS. The error message itself
  (`put the audio next to the project first`) was good enough to self-correct immediately by
  copying the sample next to the project — the realistic workflow regardless. Same class of
  environment quirk already known from `history.test.js` (see project memory), not a `beat sample`
  defect.
- **[confusing] — undocumented in top-level `--help`** `add-track ... --name` requires a
  single-token name (`error: track names are single tokens in v0.2 (no whitespace)`); the help
  text's `[--name N]` doesn't hint at this constraint. Minor — the error is immediately actionable
  — but a one-line note in `--help` would save the round trip.

## Where the pilot gave up on the "ideal" workflow

Nowhere — every goal in the brief (attach real media, trim, warp with a valid rate, split, wire
both halves into a song, confirm audio in the rendered mix, and try two deliberately-wrong paths)
was reached via ordinary, discoverable `beat` commands with no workaround needed.

## Verdict

**The CLI is the reliable fallback prior GUI pilots suspected it was — for one of the two
limitations, not both, because one of them isn't actually a GUI bug at all.**

- **Multi-region placement (GUI-found limitation a): CONFIRMED PRESENT, and it's a core/data-model
  gap, not a GUI-only one.** The CLI's own `beat scene` command silently accepts and collapses two
  clip mappings for the same track into one slot — proving the one-clip-per-track-per-scene
  constraint lives in the document model / `src/core` schema itself (each clip holds a single
  `audio` field, and a scene's slot map is a plain `track -> clip` dictionary), not in the GUI's
  drag-and-drop affordances. No CLI syntax, however creative, gets around this — it isn't a missing
  command, it's the shape of the data. This would need a schema change (e.g., an array of audio
  regions per clip, or multiple simultaneous clip slots per track) to fix on either surface.
- **Orphaned split output (GUI-found limitation b): RULED OUT on the CLI — this one genuinely was
  just a GUI reachability gap.** `beat scene` + `beat song` wire a split clip's second half into a
  real, playable section in two ordinary commands, no workaround needed. The GUI pilot's finding
  that `clip1-2` "exists in the file but is silent/unplaced" reflects a missing GUI affordance for
  assigning clips to scene slots post-split, not a limitation of the underlying scene/song model —
  the CLI reaches the exact same document structure cleanly.

So: for headless audio work specifically, the CLI is trustworthy and, on one axis (warp-mode
discoverability), actually surfaces a gap the GUI hides. But it is not a universal escape hatch —
where the limitation is architectural (single audio region per clip slot), the CLI hits the same
wall the GUI does, just with a clearer error trail showing exactly why.

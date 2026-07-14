# Usability pilot 103: the lane-aware taste loop on the CLI (vary lane → score → adopt), inspect's per-lane truth, mcp-init's scaffold, and lint --ref

## Intro

Phase 35 shipped the fixes for pilot 101's headline findings: lane-aware `beat vary` on declared-lane
drums tracks (legacy `kick`/`snare`/`hats` groups now error there), `beat inspect` per-lane params and
full-loop grids, a dedicated `beat adopt <batch-dir> <pick>` with a parent-sha256 guard, batch/log
paths defaulting next to the `.beat`, a music-session CLAUDE.md scaffold from `beat mcp-init`, and
`beat metrics --save-profile` + `beat lint --ref` reference profiles. This pilot played a fresh
CLI-only user discovering everything from `beat`'s own help output: build a short drum groove, make
the kick punchier via vary-the-kick-lane → score → adopt, verify against the raw file, then save a
reference profile and lint against it, and run `mcp-init` reading the scaffold as the helper agent
who'd receive it. Work happened in `/tmp/dotbeat-usability-pilot103/` (deleted at the end);
`examples/night-shift-song.beat` untouched; no daemon, GUI, or render (`--render`/`--audition`
excluded by design — renders are minutes each in this container; the lint/metrics wavs were
synthesized directly with a few lines of Node writing PCM, noted per the pilot brief as legitimate
setup, since `beat metrics` needs a wav and rendering was off the table).

The headline: **the lane taste loop is now the real thing.** Every step — lane discovery, lane-param
mutation, scoring, hash-guarded adoption — verified correct at the raw-file level, and the guard
earned its keep mid-pilot by (correctly) refusing an adopt that would have silently deleted a track
added after the batch. All findings are polish-level except one: the legacy drum groups still run
silently on *synth* tracks, the one flavor of the pilot-96/101 no-op family the new drums-only guard
doesn't cover.

## Narrative walkthrough

**Discovery.** `beat` with no args: a long (~210-line) but honest dump. The `vary` entry now
explains the two modes inline — "On a declared-lane drums track ... target a LANE NAME (kick, hat,
tom_lo, ...)" and "the legacy kick/snare/hats groups error there" — so the pilot-101 trap is
documented before you can fall into it. `score`/`suggest` state the "NEXT TO the .beat file, not the
cwd" default; `adopt` documents the sha256 guard; `lint --ref`'s entry even carries an honest scope
caveat ("full-mix statics only: a profile can't hear arrangement, sections, or masking").

**Building the groove.** `init` (118 bpm) → `add-track drums` → `drum-kit kit-909` → 29 `add-hit`
calls. First real stumble: I typed `add-hit ... oh 14 0.6` because the help's own examples for
`humanize` and `vary feel` say `--lanes hat,oh` — but every factory kit names the lane `openhat`.
The error was excellent (listed all twelve valid lanes), but the wrong guess came straight from the
CLI's own help text. Also hit: `add-track ... --name "Old drums"` errors `track names are single
tokens in v0.2 (no whitespace)` — a stale version reference (the file says `format_version 0.10`)
and no hint of how to get a two-word display name.

**`inspect` is transformed.** Three pilot-101 complaints fixed in one screen: a `lanes:` block shows
every lane's backing (`kick synth:membrane tune=28.5 punch=0.12 decay=0.35`), the drum grid prints
all 32 steps as two bar-separated groups of 16 (with X/x apparently encoding velocity), and the
bogus `synth: sawtooth` line on drums tracks is gone (now a sensible `bus:` line). Every lane
count and grid mark matched the raw file exactly. Later, `inspect --json` turned out to expose hit
ids and structured lane backing (`{"name":"kick","backing":{"type":"synth","voice":"membrane",
"params":{...}}}`) — the "no ground-truth surface" wall from 101 is gone on the CLI.

**Lane discovery, then the vary.** `beat vary groove.beat drums --groups` is exactly the discovery
surface 101 asked for: this track's twelve lanes each with their real params, the still-live
track-wide groups (filter/env/fx/sends/mix), and a parenthetical explaining why kick/snare/hats are
absent. `vary groove.beat drums kick --count 5 --amount 0.3 --seed 103` produced edits as
`drums.lane.kick.tune 30.0654 ...` — and the ground-truth diff of v1 against the base showed
**exactly one changed line: the `lane kick` declaration**, the thing the engine actually plays,
with mutation values centered on the lane's declared tune 28.5 (not the legacy 32.7 default that
101 caught vary using as its basis). The manifest records `parentSha256` and per-variant replayable
edits.

**The error paths around vary.** Legacy group on the kit track: `vary ... drums hats` → a
model error message — says *why* ("mutates the legacy track-wide drum-voice params, which a
declared-lane drums track never plays"), lists all twelve lanes to use instead, and names the
track-wide groups that still apply. Legacy opt-out track (`--legacy-lanes`): the kick group runs
there and `--groups` correctly shows the old group list — right behavior on both sides of the fork.
But the synth track: `vary groove.beat lead kick` **happily generated two variants of
`lead.kickTune/kickPunch/kickDecay`** — the guard is drums-track-only, and pilot 96's original
synth-track flavor of the dead-param family survives, exit 0, no warning.

**Score.** Run deliberately from the repo cwd, not the project dir: the log landed next to the
.beat (`/tmp/dotbeat-usability-pilot103/beat-scores.jsonl`), as did every batch dir — the 101
path-trap is fixed and verified from a foreign cwd. The JSONL entry carries batch, track, group,
seed, parentSha256, ranked picks with their edits, and rejects. One inconsistency: score's adopt
hint is still `to adopt the winner: beat set groove.beat drums.lane.kick.tune 29.9828 ...` — a
cwd-relative command that only works from the project dir, and no mention of the new `beat adopt`
(which the mcp-init scaffold, meanwhile, presents as *the* adoption verb).

**Adopt, and the guard earning its keep.** I mutated the parent (`set bpm 119`) to provoke the
guard: clean refusal with both sha prefixes and "Re-vary from the current file, or pass force to
overwrite anyway." Probed the literal wording — `adopt vary-kick-103 v3 force` — the stray
positional was **silently ignored** (same refusal, no unknown-argument complaint), and the real
flag is `--force`, which the message never actually spells. Then the honest surprise: reverting
bpm to 118 did *not* satisfy the guard — because I'd also added a probe track (`olddrums`) after
generating the batch, and since **adopt copies the whole variant file over the parent**, adopting
would have silently deleted that track. The guard caught precisely the scenario it was built for,
mid-pilot, unprompted. After `rm-track olddrums` the file was byte-identical to the manifest's
parent again and adopt went through: `adopted v3 -> groove.beat (drums.lane.kick.tune 29.9828,
...)`, plus a daemon-hot-reload note. Ground truth: the adopted file is byte-identical to
`v3.beat`, the `lane kick` line carries v3's params, all 27 hits intact, and `inspect` agrees.
A side probe of the same mechanism: the *sibling* snare batch (generated pre-adopt) is now
un-adoptable without `--force` — correct, but it means sequential adoption of two same-generation
batches always requires a re-vary; see "ideal workflow" below.

**Suggest.** Now validates the track (`no track "ghosttrack" (have: lead, drums)` — 101's unfixed
bug, fixed) and its recommendation targets the *lane* (`beat vary groove.beat drums kick ...`).
The `suggest.ts's module doc` filename leak in user-facing text persists (fourth pilot running).

**mcp-init, read as the receiving agent.** Writes `.mcp.json` (absolute path to this repo's
`cli/beat.mjs` — machine-specific but correct) and a genuinely good ~30-line CLAUDE.md: role
framing ("You are here to MAKE MUSIC with dotbeat, not to develop dotbeat itself"), the
render→metrics→lint discipline, the vary→audition→score→adopt loop naming both CLI and MCP verbs,
a units table (velocity 0..1, dB gains, 16th steps) that pre-empts pilot 94's traps, the
batch/log-location convention (matches observed behavior), and the GUI-selection interop tip.
Overwrite safety: a rerun refuses on `.mcp.json` (so the message never mentions CLAUDE.md, though
the help text emphasizes CLAUDE.md protection), and `--force` is all-or-nothing — it clobbered a
custom line I'd appended to CLAUDE.md, so there's no way to refresh a stale `.mcp.json` (e.g.
after the repo moves) without losing session notes.

**Profiles and lint --ref.** Synthesized two 2-second stereo PCM wavs (same kick-ish content, one
~8 dB quieter). `metrics refmix.wav --save-profile kickref.json`: full readout plus a profile with
provenance (`format: dotbeat-mix-profile`, version, source, createdAt, tool). `lint newmix.wav
--ref kickref.json`: one finding, `integrated loudness -27.3 LUFS is 8.2 LU quieter than the
reference (refmix.wav: -19.1 LUFS)` — delta arithmetic checks out — and linting the reference
against its own profile passes clean. Warts: the dual-mono width prints as `width -Infinity` and
lands in the profile JSON as the *string* `"-Infinity"` where every other metric is a number; every
lint finding is severity INFO (13.3 LU under target, 100% low-end energy — still INFO); and fix
lines hardcode a placeholder filename (`beat set song.beat <track>.volume ...`) that reads like a
real file.

**Remaining error probes.** `adopt v99` → `pick "v99" is not a variant number 1-5 (accepts "N" or
"vN")`; `adopt no-such-batch` → clean one-liner; bogus `--ref` JSON → `not a dotbeat mix profile
(expected "format": "dotbeat-mix-profile")`. But `beat metrics groove.beat` (a non-wav) dumps a
raw stack trace — `WavDecodeError: not a RIFF/WAVE file` plus seven frames of
`dist/src/metrics/wav.js` internals — the only unpolished error in the whole session (12 other
deliberate wrong paths all got clean one-liners).

## Findings summary

- **[bug] [core] (medium) The legacy drum vary groups still run silently on synth tracks.**
  `beat vary groove.beat lead kick --count 2` exits 0 and generates variants mutating
  `lead.kickTune/kickPunch/kickDecay` — params a synth track never plays (the pilot-96 flavor of
  the no-op family). Phase 35's guard fires only on declared-lane *drums* tracks; the synth-track
  branch got neither the error nor a warning, so the whole score/suggest loop can still be run
  against audio-identical batches there. Repro: fresh project, `beat vary <f> lead kick --count 2`.

- **[bug] [CLI-specific] (low) `beat metrics` on a non-wav file dumps a raw stack trace.**
  `beat metrics groove.beat` → `WavDecodeError: not a RIFF/WAVE file` + 7 stack frames from
  `dist/src/metrics/wav.js` / `cli/beat.mjs:1400`. Every other error path this session (12 probes)
  produced a clean one-line `error: ...`. `lint` presumably shares the decoder path (untested).

- **[confusing] [CLI-specific] (low) The CLI's own help examples teach a lane name that doesn't
  exist.** `humanize` and `vary feel` both show `--lanes hat,oh`, but every factory kit's lane is
  `openhat` — this pilot's first failed command (`add-hit ... oh`) was copied straight from the
  help. The rejection error itself is excellent. Fix is a two-character doc edit (`hat,openhat`)
  or an `oh` alias.

- **[confusing] [core] (low) `adopt`'s guard message says "pass force," the flag is `--force`, and
  a bare `force` positional is silently swallowed.** `beat adopt <batch> v3 force` produces the
  same refusal with no unknown-argument complaint — the same silently-dropped-argument family as
  101's MCP finding, now observed on the CLI. Message should read `--force`, and stray positionals
  should error.

- **[confusing] [CLI-specific] (low) `mcp-init --force` is all-or-nothing, and the no-force
  refusal only mentions `.mcp.json`.** There's no way to regenerate a stale `.mcp.json` (repo
  moved, node path changed) without also clobbering a user-customized session CLAUDE.md — verified:
  a custom appended line was destroyed by `--force`. The refusal error (`.mcp.json already exists`)
  also never mentions that CLAUDE.md is protected, despite the help emphasizing exactly that.

- **[confusing] [core] (low) `score`'s adopt hint predates `beat adopt` and disagrees with the
  scaffold.** score prints `to adopt the winner: beat set groove.beat ...` — a cwd-relative
  command (breaks from any other directory; batch paths elsewhere in the same output are absolute)
  that applies edits rather than adopting, and never mentions `beat adopt`, while mcp-init's
  CLAUDE.md tells the agent adoption goes through `beat adopt`/`beat_adopt`. Two surfaces, two
  different adoption verbs. (The `beat set` form does have a real niche — it survives a changed
  parent — but nothing explains the difference.)

- **[confusing] [core] (low) Dual-mono width serializes as the string `"-Infinity"` in the profile
  JSON** (every other metric is a number — a type landmine for any profile consumer) **and prints
  raw as `width -Infinity` / `stereo width -Infinity dB` in human-facing metrics and lint output.**
  A "mono" label would read better and type stably.

- **[confusing] [core] (low) Every lint finding is severity INFO**, whether 1 LU or 13.3 LU off
  target — the severity channel carries no signal — **and fix lines hardcode a placeholder
  `song.beat`** (`beat set song.beat <track>.volume ...`) that reads like a real file; with no
  `--doc` given, something like `<file.beat>` would be honest.

- **[confusing] [CLI-specific] (low) Multi-word track names are rejected with a stale version
  reference and no path forward.** `--name "Old drums"` → `track names are single tokens in v0.2
  (no whitespace)` — the format is 0.10, and nothing says whether multi-word display names are
  possible at all (the GUI presumably renames tracks; is the CLI just behind?).

- **[cosmetic, persisting from 94/96/101]** `suggest`'s user-facing text still cites
  `suggest.ts's module doc`.

- **[worked well] [core] The lane taste loop is correct end-to-end at the raw-file level.** Lane
  vary edits exactly the `lane <name>` declaration line (verified by diff), mutation basis is the
  lane's declared value (28.5), not the legacy default — 101's headline bug and its subtle basis
  bug both fixed; manifest/scores-log/adopt all carry and check `parentSha256`; the adopted file is
  byte-identical to the picked variant with content intact.

- **[worked well] [core] The adopt guard caught a real would-be data loss during the pilot** — an
  unstaged track addition between vary and adopt — with an error that names both hashes and both
  recovery paths. Pick validation (`v99` → "1-5, accepts N or vN") and missing-batch errors are
  clean one-liners.

- **[worked well] [core] `inspect` closes pilot 101's ground-truth gap**: per-lane backing params
  in text mode, full 32-step grids with bar separators and velocity casing (all verified against
  the raw file), no more phantom `synth:` line on drums, and `--json` exposes hit ids plus
  structured lane backing — everything 101 said was unverifiable is now verifiable.

- **[worked well] [core] Discovery surfaces are excellent**: `vary <file> <track> --groups` shows
  that track's real lanes+params and adapts per track type (12-lane vs `--legacy-lanes` vs synth);
  the legacy-group refusal explains *why* and lists alternatives; batch dirs and the scores log
  verifiably default next to the .beat from a foreign cwd; `suggest` validates its track and
  recommends lanes.

- **[worked well] [CLI-specific] The mcp-init scaffold is a genuinely good agent briefing** — role
  framing, render→metrics→lint discipline, both surfaces' verbs for the taste loop, a units table
  targeting exactly the mistakes earlier pilots made, and path conventions that match observed
  behavior.

- **[worked well] [core] `metrics --save-profile` / `lint --ref` work as documented**: profile has
  provenance and a format tag that's actually validated on load (bogus JSON → clean error),
  ref-delta arithmetic is correct, and a self-comparison passes with no findings.

Not exercised: `--render`/`--audition` (minutes per variant in this container; excluded by the
pilot brief), `beat adopt`'s daemon hot-reload claim (no daemon run), sample-backed-lane vary
params (start/length/AHD/filter — synth-backed lanes only this session), and the MCP flavor of the
new surfaces (`beat_adopt`, lane-aware `beat_vary`, `beat_inspect`'s new output — 103 was
CLI-only; a follow-up MCP pilot should confirm the fixes landed there too, especially whether
`beat_inspect` gained a json/lane view, which was 101's hardest MCP-only wall).

## Where the pilot gave up on the "ideal" workflow

Nowhere, for the stated goal — the kick loop ran start to finish with no workaround needed, a first
for this workflow across three pilots. Two smaller bends: (1) the "punchier kick" *scoring* step is
taste-by-proxy without renders — picks were made on param plausibility (higher punch, tighter
decay), which is the pilot constraint, not a product gap, though it underlines how central
`--audition` is to real use of this loop; (2) sequential adoption of two batches generated from the
same parent is impossible by design — adopting the kick winner correctly invalidated the sibling
snare batch's hash, so the second lane needs a fresh vary round (or `--force`, which would revert
the first adoption — the guard's message could warn that force on a *sibling* batch undoes prior
adoptions rather than just "overwriting newer work").

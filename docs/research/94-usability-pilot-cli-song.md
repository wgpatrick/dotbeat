# Usability pilot 94: building a song with only the `beat` CLI (no GUI)

## Intro

This is the first pilot in the new "CLI/MCP, no GUI at all" variant described at the bottom of
`docs/usability-testing.md`. The goal: build a small, real two-track, two-section song entirely
through `node cli/beat.mjs ...`, discovering every command's syntax from the tool's own help output
— never opening the GUI, never reading `cli/beat.mjs`'s source to shortcut the discovery process
(source was consulted exactly once, after hitting a genuine wall, purely to classify a finding as
"intentional design" vs. "bug" — see finding 4 below). Work happened in a disposable scratch
project at `/tmp/dotbeat-usability-94-cli-song/song.beat`; `examples/night-shift-song.beat` was
never touched.

## Narrative walkthrough

**Discovering the surface.** `node cli/beat.mjs` with no arguments dumped the *entire* command
surface in one shot — every subcommand, its full argument list, and a one-line (sometimes
multi-line) description, around 60 lines covering track/note/hit editing, presets, macros, drum
kits, song structure, effects, audio clips, scoring/variation tooling, metrics/lint, checkpoints,
and MCP. This is a lot to take in at once, but it's genuinely all there — nothing needed a second
lookup to *find*, only to *parse*. First impression: dense but complete, more like a man page than
a friendly onboarding flow, and that turned out to be an accurate preview of the whole session.

**`init`.** `beat init song.beat --bpm 118` worked first try, created a starter "lead" synth track,
and printed a one-line confirmation. `beat inspect` immediately after showed the new project state
in a compact, readable ASCII format — bpm, bar count, track list, per-track synth params, and (for
drums) a lane-by-lane hit grid. This became the go-to "did that actually work" check for the rest
of the session, exactly as the methodology intends.

**Adding a drums track.** `beat add-track song.beat drums drums --name "Drums"` worked and, per the
help text's own promise, defaulted to the full 12-lane kit (kick/snare/rimshot/clap/hat/openhat/
tom_lo/tom_mid/tom_hi/crash/ride/cowbell) rather than the legacy 5. One immediately-visible oddity:
`inspect` prints a full `synth: sawtooth, ...` line for the drums track even though drums are
lane-based, not pitch/oscillator-based — see finding 5.

**Wrong path #1 (intentional): bad track name.** `beat add-note song.beat bass 60 0 4 100` (before a
"bass" track existed) — got `error: no track "bass" (have: lead, drums)`, exit code 2. Genuinely
helpful: names the problem AND lists the valid alternatives. Good recovery signal for a real user.

**Wrong path #2 (unintentional, and the pilot's biggest real finding): velocity units.** The
help text for both `add-note` and `add-hit` gives argument *names* (`<velocity>`) but no units or
range. I defaulted to the universal MIDI convention (0-127) for both a set of `add-note` calls and
a set of `add-hit` calls — all 12 commands across both tracks failed with `error: velocity must be
0..1, got 100` / `error: hit velocity must be in (0, 1], got 110`. The error message itself is
clear and exit code was correctly non-zero, so recovery was fast once I saw it — but this cost a
full round-trip of guessing wrong on the single most common argument in the whole note/hit-adding
workflow, for a convention (0-127) that's near-universal in every other MIDI-adjacent tool. Retried
with `0.0-1.0` floats and all 16 calls (4 notes + 12 hits) succeeded, confirmed via `inspect`'s
pitch/step summary and the ASCII lane grid.

**Presets.** `beat presets --list-categories` gave a clean flat list (bass, lead, pad, pluck, keys,
arp, fx, house, 808-trap, techno, boom-bap, lofi, acoustic-rock). `beat presets` (no filter) printed
the full library — name, kind, category, param count, and a genuinely well-written one-line
rationale per preset (e.g. `acid-bass ... TB-303-style acid: very high filter resonance driven hard
by the filter envelope...`). This is the best-documented part of the CLI surface — a new user could
pick presets confidently from the descriptions alone with zero trial and error.
`beat preset song.beat lead pluck-lead` and `beat preset song.beat drums driving-kit` both applied
cleanly and printed an explicit before→after diff per changed param (`lead: cutoff 2000 -> 3500`,
etc.) — excellent transparency, and `inspect` afterward confirmed the params actually changed.

**Song structure.** The help text's `clip`/`scene`/`song` trio maps onto the GUI's
capture-scene/insert-scene/section concepts. Workflow used: `beat clip song.beat lead verse-lead`
and `beat clip song.beat drums verse-drums` snapshot the *live* pattern into a named clip; then
`beat scene song.beat verse lead=verse-lead drums=verse-drums` builds a scene from those clips.
For a second section, I added more notes/hits directly to the live tracks, then re-snapshotted as
`chorus-lead`/`chorus-drums`, then `beat scene song.beat chorus lead=chorus-lead drums=chorus-drums`.
Finally `beat song song.beat verse 2 chorus 2` set the timeline. `inspect`'s plain-text view then
showed everything at once — scenes, their slot maps, and the song timeline (`song: verse(2)
chorus(2) — 4 bars total`) — a clean single-command sanity check.

Ground-truth check via the raw `.beat` file (`Read` on the file directly, not `inspect`) confirmed
that `chorus-lead`'s clip contains all 7 notes (the original 4 "verse" notes plus the 3 new ones),
not just the 3 new ones — because `clip` snapshots *whatever is currently live on the track*, and I
never cleared the track between snapshots. This matches the command's own description ("snapshot
the track's live content into a clip") once you think about it, but a first-time user could easily
expect "chorus" to mean "distinct new content," not "verse content plus more" — see finding 3.

**Wrong path #3 (intentional): bad scene name.** `beat song song.beat bridge 4` (no "bridge" scene
exists) → `error: no scene "bridge" (have: verse, chorus)`, exit 2. Same good pattern as the
track-name error: names the problem, lists valid options.

**Render + metrics + lint.** `beat render song.beat -o song.wav` worked with zero extra setup —
no `beat daemon` was ever started manually; render spun up its own ephemeral internal
daemon/headless-Chromium pipeline, rendered, and tore it down automatically (confirmed via `ps aux`
post-render: nothing lingering). Output: 8.28s of real stereo audio at 48kHz. `beat metrics
song.wav` reported -23.4 LUFS integrated, -2.3 dBFS sample peak / -2.0 dBTP true peak, 25.9 dB
crest, and real spectral/stereo numbers — clearly non-silent, real audio, not a stub. `beat lint
song.wav` added a genuinely actionable finding on top of the raw numbers: `[loudness-vs-target]
integrated loudness -23.4 LUFS is 9.4 LU below the -14.0 LUFS target — fix: raise all track volumes
by ~9.4 dB (beat set song.beat <track>.volume <dB> per track)`. This is exactly the kind of
"ground truth over vibes" signal the project's own methodology asks for, and it came from the tool
itself, unprompted.

**Per-command help gap.** Tried `beat add-note --help` and `beat help add-note` hoping for a
scoped explanation of just that command (especially the velocity range, which the top-level dump
doesn't give). Neither worked as a filter: `--help` was parsed as a positional argument and
produced the "add-note needs <file> <track> ..." usage-count error; `beat help add-note` just
printed the entire ~60-line top-level dump again, unfiltered. There is no way to get help scoped to
a single subcommand — you always get everything or a generic arg-count error.

**Source check (only after the wall above).** After noticing `inspect` shows a
`eq3(eq3) -> comp(comp) -> distortion(distortion) -> bitcrush(bitcrush)` effects chain for both
tracks but the raw `.beat` file has zero `effect` lines anywhere, I grepped `src/core/serialize.ts`
to determine whether this was a bug (silent effect-chain loss on save) or intentional. It's
intentional: `serializeEffectLines` elides the chain entirely when it equals the canonical default
(`isDefaultEffectChain`) specifically so an unmodified track "round-trips byte-identically" and
diffs stay minimal — a deliberate, documented (in-code) design choice, not data loss. Confirmed
this only via source because there was no CLI-facing way to learn it — `inspect`'s effects line and
the raw file legitimately disagree in *literal content* while agreeing in *actual meaning*.

## Findings summary

- **[confusing] Velocity range for `add-note`/`add-hit` is undocumented in the help text and
  defies the near-universal MIDI 0-127 convention (real range: 0.0-1.0).** Every single note/hit
  I tried to add on the first pass failed for this reason — 4 `add-note` calls and 12 `add-hit`
  calls, 16 failed commands before I inferred the right scale from the error message. The error
  message itself is good (`velocity must be 0..1, got 100`) so recovery was fast, but the help
  text should just state the range up front (`<velocity 0-1>`) the way `fit-scale`'s help already
  states `<root 0-11>`. **CLI-specific** (a units/range annotation is purely a help-string fix;
  doesn't touch daemon/core capability).

- **[worked well] Preset and factory-library discovery is excellent.** `beat presets
  --list-categories` and `beat presets` gave a complete, well-annotated library with real rationale
  per preset, letting a new user pick with confidence and zero guessing. `beat preset <file> <track>
  <name>` applies with a transparent before→after diff of every changed param. This is the best
  part of the CLI's onboarding experience by a clear margin. **Applies equally to GUI/daemon** (the
  preset library and diff-application logic live in `src/core`, not the CLI layer).

- **[worked well] Error messages for bad references (track/scene names) are genuinely good.**
  `no track "bass" (have: lead, drums)` and `no scene "bridge" (have: verse, chorus)` both name the
  problem and list the valid alternatives inline — exactly what a lost user needs, no extra lookup
  required. **Core capability** — this pattern is consistent enough across commands to be baked
  into the shared error-construction code, not CLI-specific ad-hoc strings.

- **[confusing] `clip` snapshots "whatever is currently live," which silently accumulates content
  across sections unless the user manually clears the track first.** Building the "chorus" clip by
  adding notes on top of the still-present "verse" notes and then re-snapshotting produced a
  7-note chorus clip that's verse+more, not a distinct chorus — confirmed by reading the raw `.beat`
  file, since `inspect`'s summary view doesn't show individual clip contents by default. This
  matches the command's stated behavior ("snapshot the track's live content") but the CLI never
  hints that a user who wants an independent second section needs a "clear the live pattern first"
  step (no obvious `beat clear-track`-style command was surfaced in the top-level help — worth a
  follow-up check with the GUI/daemon team on whether one exists under a different name). **Likely
  a core/daemon concept, not CLI-specific** — the GUI's own capture-scene workflow presumably has
  the identical accumulate-unless-cleared semantics, since clips are a `src/core` construct.

- **[slow-to-discover] No per-command help.** `beat add-note --help` and `beat help add-note` both
  fail to produce scoped help — the first is parsed as a positional arg and errors on arg count,
  the second just reprints the entire ~60-line top-level usage dump unfiltered. For a command
  surface this large, a user hunting for one command's exact argument semantics (like the velocity
  range above) has no way to narrow the output; they re-read the whole dump every time.
  **CLI-specific** — purely an argument-parsing/help-routing gap in `cli/beat.mjs`.

- **[confusing, minor] `inspect`'s plain-text view shows a `synth: sawtooth, ...` line for `drums`
  tracks even though drums are lane-based, not oscillator-based**, which reads as though the drums
  track has a "real" synth voice the way `lead` does. Cosmetic only — didn't cause any actual
  mistake in this session — but worth a look for the next inspect-format pass. **CLI-specific**
  (display formatting in `src/core/inspect.ts`, not underlying data).

- **[worked well] `render` requires zero manual daemon setup.** No explicit `beat daemon` was
  needed at any point in this whole session; `render` bootstraps and tears down its own ephemeral
  headless pipeline, confirmed clean (no lingering processes) via `ps aux` after the run. This
  matches the project's stated "headless operability is a first-class requirement" goal in
  practice, not just on paper. **Core/daemon capability**, and a genuine strength.

- **[worked well] `lint` adds real, actionable analysis on top of raw `metrics` numbers** — e.g.
  flagging the rendered mix as 9.4 LU below the -14 LUFS target and suggesting the exact fix command
  (`beat set song.beat <track>.volume <dB>`). This is the kind of "ground truth over vibes" signal
  a new user (or agent) would otherwise have to infer by ear. **Core capability.**

- **[worked well, non-obvious but correct] `inspect`'s effects-chain line and the raw `.beat`
  file's effect content can legitimately differ without any bug being present.** An unmodified
  default effect chain (`eq3->comp->distortion->bitcrush`) is intentionally elided from the
  serialized file (`isDefaultEffectChain` in `src/core/document.ts` / `serializeEffectLines` in
  `src/core/serialize.ts`) so untouched tracks round-trip byte-identically and diffs stay minimal —
  `inspect` still shows the canonical chain because it reflects the resolved in-memory document, not
  the file's literal text. This is a deliberate, sound design decision, but it's undocumented at the
  CLI-help level, so a user diffing the raw file by hand (which this project's own methodology
  explicitly recommends as "ground truth") could reasonably read "no effect lines" as "no effects,"
  which would be wrong. **Core capability, with a CLI-documentation gap** — a one-line mention in
  `beat inspect`'s or `beat effect-add`'s help ("untouched tracks carry a default 4-effect chain not
  shown in the raw file") would close this.

## Could a genuinely new user build a real song using only `beat --help`-level knowledge?

**Yes, with real but survivable friction.** Every step in the goal — init, two tracks, real notes
and hits, a factory preset per track, a two-section song structure, a real non-silent render,
metrics/lint confirmation — was reachable purely from the CLI's own help output and its error
messages, with no source-reading required to get unstuck (source was consulted once, afterward,
purely to classify a finding, not to find the right command). The top-level help dump is dense but
genuinely complete — nothing was hidden or required tribal knowledge to locate. Error messages for
wrong track/scene names are excellent and self-correcting.

The real cost was the velocity-range guess: 16 failed commands in a row from assuming MIDI's
universal 0-127 convention when the actual range is 0-1. That's a first-conversation-ending kind of
friction for a less persistent user, even though the error message itself made recovery fast once
seen. The `clip`-accumulates-live-content behavior is a second, subtler trap — it didn't fail
loudly, it just produced content the user might not have intended (a "chorus" that's really
"verse plus"), and the only way to catch it was reading the raw file, not any CLI output. Both of
these are one-line help-text fixes away from being non-issues (`<velocity 0-1>` in the usage line;
a one-clause note on `clip`'s accumulate-vs-clear semantics). Net verdict: the CLI is honestly
usable standalone today, but its help text underserves exactly the two places where a new user's
prior intuition (MIDI velocity scale, "snapshot" implying "fresh copy") most actively misleads them.

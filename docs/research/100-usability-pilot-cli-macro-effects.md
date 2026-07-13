# Usability pilot 100: drum kits, macros, and the effect chain via the `beat` CLI (no GUI)

## Intro

Continuing the CLI/MCP variant from pilot 94 (`docs/research/94-usability-pilot-cli-song.md`), this
pilot targets CLI surface pilot 94 didn't cover: `beat drum-kits`/`beat drum-kit`, `beat macro
list`/`beat macro apply`, and the effect-chain verbs (`beat effect-add`/`effect-rm`/`effect-move`/
`effect-bypass`). Goal: build a small real project (a drums track + two synth tracks) entirely
through `node cli/beat.mjs ...`, discover syntax cold from `--help` output, and specifically put
pressure on the macro system's own documented claim — "resolves to literal set edits, same
discipline as presets, no indirection" — by reading the raw `.beat` text after applying one, not
just trusting `beat inspect` or the command's own success message. Work happened in a disposable
scratch project at `/tmp/dotbeat-usability-100-cli-macro/song.beat`;
`examples/night-shift-song.beat` was never touched.

## Narrative walkthrough

**Discovering the surface.** `beat --help` (no subcommand) dumped the full ~60-line command
surface in one shot, same as pilot 94 found — dense but complete. The macro/kit/effect lines were
right there with useful inline detail: `beat macro list [--json] list the factory macro library (a
knob -> N target params)`, `beat macro apply <file> <track> <name> <value> apply a macro to a
track at knob position 0..100 (resolves to literal set edits, same discipline as presets)`, `beat
drum-kits [--json] list the factory drum-kit library (kit-808/kit-909/kit-acoustic)`, `beat
drum-kit <file> <track> <name> apply a drum kit to a track (replaces its whole lane list)`. Also
notable and new since pilot 94: the `beat render` help line now reads "render to WAV through
dotbeat's own engine (headless Chromium driving ui/; no BeatLab needed)" — the BeatLab-dependency
caveat the dotbeat skill still warns about appears to have been resolved; confirmed later in this
session (render worked with no `--beatlab-dir` flag or error, see below).

**Init + drums track.** `beat init song.beat --bpm 120` then `beat add-track song.beat drums drums
--name Drums` worked first try. `beat inspect` immediately showed the new drums track already
defaulted to the full 12-lane kit (kick/snare/rimshot/clap/hat/openhat/tom_lo/tom_mid/tom_hi/
crash/ride/cowbell) — matches the help text's promise exactly.

**Drum kits.** `beat drum-kits` listed three: `kit-808`, `kit-909`, `kit-acoustic` — each with a
genuinely useful one-line description including provenance (`research 19 Part VII`) and, for the
acoustic kit, an explicit heads-up that it needs a sample registered first (`beat sample <file>
muldjordkit presets/sf2/...`, id must be exactly `muldjordkit`) — a real gotcha flagged proactively
in the listing itself, good design. `--json` gave the full per-lane backing spec (voice type,
tune/decay/tone/punch params) for all three kits, which is what let me actually verify the apply
step below rather than trust it blind. Applied the simplest one, `kit-808`
(`beat drum-kit song.beat drums kit-808`), which printed a clean per-lane diff (`drums: lane "kick"
synth:membrane -> synth:membrane tune=32.7 punch=0.08 decay=0.55`, one line per lane, 12 total).
Cross-checked against `beat inspect --json`: the `lanes` array's `kick` entry now reads
`{"voice":"membrane","params":{"punch":0.08,"decay":0.55}}` — tune 32.7 is baked into the applied
lane already (visible in the printed diff even though the JSON summary only echoes punch/decay for
that lane) — matches `kit-808`'s own `--json` listing for `kick` exactly. Kit apply does what it
says: real per-lane voice/param replacement, confirmed against ground truth, not just the tool's
own claim.

**Macros — the "no indirection" claim.** `beat macro list` gave 8 factory macros as a flat table
(name, kind, category, target count, description): `filter-sweep` (synth/tone, 2 targets, "The
canonical one — brighter + more resonant together"), `grit`, `space` (kind `any` — works on any
track), `warmth`, `motion`, `width`, and two drums-only ones, `punch` and `snap`. `--json` exposed
the full target spec per macro — param name, min/max, and an optional `curve` (`exp` on some
targets, linear by default). This was the key discovery: with the target's min/max/curve in hand
I could predict the exact literal value an apply *should* produce before running it, turning this
into a real verification rather than a trust exercise.

Applied `beat macro apply song.beat lead filter-sweep 70` (knob 0-100). Targets were `cutoff`
(min 80, max 18000, curve `exp`) and `resonance` (min 0.1, max 5, linear). Printed diff:
`lead: cutoff 2000 -> 8860.8` / `lead: resonance 0.8 -> 3.53`. Resonance matched a plain linear
interpolation exactly (`0.1 + (5-0.1)*0.7 = 3.53`). Cutoff did *not* match a textbook exponential
interpolation (`80 * (18000/80)^0.7 ≈ 3547`, nowhere close to 8860.8) — worked backward and found
it matches `min + (max-min)*t^2` (`80 + 17920*0.49 = 8860.8`) instead. So the `curve: exp` label in
`macro list --json` describes a quadratic ease-in, not a true exponential/log curve — see finding
below; doesn't affect correctness (the macro is internally consistent and reproducible), but the
name is a false cognate for anyone who knows what "exponential" means in audio-param interpolation
(typically log-space, matching how humans perceive frequency).

Then the actual "no indirection" check: read the raw `.beat` text directly (`sed`, not `inspect`).
Lines 9-10 of the file read `cutoff 8860.8` / `resonance 3.53` inside `track lead`'s plain `synth`
block — the exact same shape as every other literal synth param, sitting next to `osc sawtooth`,
`volume -10`, etc. `grep -n macro song.beat` returned nothing at all — no macro name, no knob
value, no reference of any kind persisted anywhere in the file. The claim holds up completely: a
macro apply is genuinely indistinguishable, at the file level, from someone hand-typing `beat set
song.beat lead.cutoff 8860.8 lead.resonance 3.53`. This is the single most important finding of the
pilot and it's a clean pass.

**Wrong path: macro/track-kind mismatch.** Tried `beat macro apply song.beat lead punch 50` (a
drums-only macro on the synth `lead` track) and, in the other direction, `beat macro apply
song.beat drums filter-sweep 50` (a synth-only macro on the drums track). Both failed immediately
with exit code 2 and precise, actionable errors: `error: macro "punch" is a drums macro — track
"lead" is a synth track` and `error: macro "filter-sweep" is a synth macro — track "drums" is a
drums track`. No half-applied state, no confusing partial diff — clean, recoverable-from-the-
message-alone failures exactly like pilot 94 found for its bad-track-name case.

**Programming real content.** Before touching effects, gave the project something to actually
render: `beat set` with quoted `drums.pattern.<lane>[<step>]` grid paths for kick/snare/hat hits,
and three `beat add-note` calls on `lead` (a short triad walk-up). All landed as expected per
`inspect`'s ASCII lane grid and note summary.

**Effect chain.** `beat add-track song.beat pad synth --name Pad` to get a second synth track
dedicated to the effect-chain steps (rather than reusing `lead`, whose chain was untouched from
kit defaults). Immediate finding, unprompted by the task but worth flagging: **every fresh synth
track — `lead` from `init`, `drums`, and this new `pad` — already ships with a 4-effect chain,
`eq3 -> comp -> distortion -> bitcrush`, all present and enabled from track creation**, not an
empty chain as the effect-chain help text's phrasing ("add an insert to a synth track's effect
chain") might imply to a first-time reader. Not a bug — presumably intentional (every knob has a
sane default at 0-mix), but it means "chain order" and "how many effects are on this track" start
non-trivial, which is worth knowing before reasoning about a diff.

Added two real effects on top: `beat effect-add song.beat pad autoPan --id ap1` and `... tremolo
--id trem1`, both appended cleanly (`pad: effect added ap1 (autoPan)`), confirmed via `inspect`'s
chain summary showing all 6 in order. `beat effect-move song.beat pad ap1 0` reordered it to the
front — printed a full cascade of every intermediate shift (`eq3 moved from position 0 to 1`,
`comp 1->2`, etc., 5 lines for a 6-effect chain even though only one effect conceptually "moved"),
and `inspect` confirmed the new order (`ap1 -> eq3 -> comp -> distortion -> bitcrush -> trem1`)
exactly. `beat effect-bypass song.beat pad trem1 true` flipped just that one effect's `enabled`
field to `false` in the JSON inspect output, leaving all five others untouched — confirmed via
`inspect --json`. `beat effect-rm song.beat pad eq3` removed it cleanly, chain collapsed to 5
entries with no gap or reindex artifact.

**Wrong path: effect id already removed.** With `eq3` gone, tried all three remaining effect verbs
against it: `effect-bypass ... eq3 false`, `effect-rm ... eq3`, `effect-move ... eq3 0`. All three
failed identically and immediately: `error: no effect "eq3" on track "pad" (have: ap1, comp,
distortion, bitcrush, trem1)`, exit code 2. Genuinely excellent recovery UX — the error doesn't
just say "not found," it hands back the complete current valid-id list in the same message, so a
real user (or agent) could self-correct without a second `inspect` round-trip.

**Render + metrics as sound-not-just-text sanity check.** `beat checkpoint` then `beat render
song.beat -o out.wav` — worked cleanly with zero flags, no BeatLab checkout needed (confirmed:
D15's engine migration mentioned in the dotbeat skill has landed). `beat metrics out.wav` gave
-22.5 LUFS, centroid 2144 Hz, mids 13%. To confirm the macro edit was audible and not just a text
change, re-applied `filter-sweep` at knob 0 (cutoff 80, resonance 0.1 — the dark extreme) on a copy
of the project and re-rendered: mids dropped from 13% to 8% and centroid from 2144 Hz to 2029 Hz.
The shift is real but modest in the full mix (the lead track is one of three, and the drum kit's
metal/membrane voices carry a lot of the spectral energy), which makes sense rather than being
alarming — but it's a genuine, measurable, reproducible fingerprint of the macro edit in the
rendered audio, not just a diff in the file's text. Restored the project back to the knob=70 state
afterward.

## Findings summary

- **[worked well] Drum kit apply is real, ground-truth-verifiable, and correctly documented.**
  `beat drum-kit`'s printed per-lane diff matches `beat drum-kits --json`'s own kit spec exactly,
  and the change is visible in `beat inspect --json`'s `lanes` array. No indirection, no surprise.

- **[worked well] The macro system's "no indirection" claim is true and directly verifiable.**
  After `beat macro apply`, `grep -n macro song.beat` finds nothing — the resolved params sit in
  the file as plain literal `cutoff`/`resonance` lines indistinguishable from hand-typed `beat set`
  edits. This is the single most important thing this pilot was designed to check, and it holds up
  under direct raw-text inspection, not just `inspect`'s summary or the command's own success text.

- **[confusing] `curve: "exp"` in `macro list --json` is not a true exponential curve.** Reverse-
  engineered from `filter-sweep`'s cutoff target (min 80, max 18000) at knob=70: the actual formula
  is `min + (max-min)*t^2` (quadratic ease-in), not `min*(max/min)^t` (true exponential/log-space,
  the standard for audio frequency controls). Not incorrect behavior — just a misleading label for
  anyone reasoning about macro curves from the JSON schema alone; a fresh integration (human or
  agent) trying to predict a resolved value from the target spec without empirically reverse-
  engineering it would guess wrong, as this pilot initially did. Core `src/core` naming issue, not
  CLI-specific — would mislead a GUI macro-curve UI equally.

- **[worked well] Macro/kind mismatch errors are exact and immediately actionable.** `error: macro
  "punch" is a drums macro — track "lead" is a synth track` — names the macro, its actual required
  kind, and the track's actual kind, in one line. No trial and error needed to recover.

- **[worked well] Stale effect-id errors hand back the full current valid-id list.** `error: no
  effect "eq3" on track "pad" (have: ap1, comp, distortion, bitcrush, trem1)` — all three of
  effect-bypass/effect-rm/effect-move share this exact error shape, letting a user self-correct
  from the error text alone with no extra `inspect` call. Best-in-session error message.

- **[confusing, slow-to-discover] Every fresh synth track auto-ships a 4-effect chain
  (`eq3 -> comp -> distortion -> bitcrush`), not an empty one.** True for `init`'s starter track,
  a fresh `add-track ... synth`, and even the `drums` kind. The `effect-add` help text's phrasing
  ("add an insert to a synth track's effect chain") doesn't hint that there's already a populated
  chain waiting — a first-time user reasoning purely from `--help` would likely expect to start
  from zero. Worth a one-line callout in the help text or `add-track`'s own success message (e.g.
  "4 default effects: eq3, comp, distortion, bitcrush"). Core `src/core` default, not CLI-specific.

- **[worked well] `effect-move`'s cascade-diff output is verbose but transparent.** Moving one
  effect to index 0 in a 6-effect chain printed 5 "moved from X to Y" lines (every effect whose
  position shifted), which is more output than the mental model "I moved one effect" suggests, but
  it's fully honest about what actually happened in the file — better to over-report than to hide
  the real reindex.

- **[worked well] `beat render` no longer needs a BeatLab checkout.** The dotbeat skill's own
  documented caveat (BeatLab dependency, `--offline` silent-silence risk) did not reproduce in this
  environment — `beat render` worked with zero extra flags and produced a real, non-silent WAV
  (confirmed via non-trivial `beat metrics` output: -22.5 LUFS, real spectral content). The skill
  reference (`references/mistakes.md` / D15 note) should be checked for whether it needs updating
  now that this appears to have landed, since it currently reads as still-open.

- **[worked well] Macro edit produced a measurable, reproducible spectral fingerprint in the
  rendered audio.** `filter-sweep` at knob 0 vs. 70 on the `lead` track shifted the full-mix render
  from 13% to 8% mids energy and centroid 2144 Hz -> 2029 Hz — modest given the drum kit dominates
  the mix, but genuine and directionally correct (closing the filter darkens the mix), confirming
  the macro's literal param edits actually drive the DSP, not just the file text.

## Where the pilot gave up on the "ideal" workflow

Nowhere, really — every discovery path resolved from `--help`/`--json` output alone, no source
reads were needed at any point (unlike pilot 94, which needed one source check to classify a
finding). The closest thing to a snag was reverse-engineering the `exp` curve's actual formula,
which required treating the macro system empirically (compute expected values, apply, compare)
rather than trusting the schema's own vocabulary — a reasonable thing for a careful user to do, but
not something the tool's own documentation would have led to on its own.

## Verdict

Yes: a new user (or agent) could manage drum kits, macros, and a synth effect chain end-to-end
using only this CLI's own `--help`/`--json` output, with no source reads required — every command
that would leave a user stuck (wrong macro kind, stale effect id) produces an error message
specific and complete enough to self-correct from immediately. And the macro system's headline
"no indirection" claim holds up completely under the most direct check available (raw `.beat` text
after apply, not `inspect`'s summary, not the command's own success message) — a macro-applied
param is byte-for-byte the same shape in the file as a hand-typed literal edit. The one real gap
found — `curve: "exp"` describing a quadratic rather than exponential interpolation — is a naming
accuracy issue, not a functional one, and doesn't undermine that verdict.

# Usability pilot 91: trance lead sound-design + melody

## Intro

Realistic goal, scoped smaller than prior multi-pilot sessions: sound-design a single trance-style
lead synth patch (bright, sawtooth-heavy, detuned/supersaw-ish, sweepable filter, snappy filter
envelope), write an actual melodic hook with rhythmic interest (not whole notes, not a chord
progression) on top of it, and place that into a minimal song structure. Fresh project via
`beat init /tmp/dotbeat-usability-91-trance-lead/song.beat --bpm 138` (138 BPM, a realistic trance
tempo), driven with a real headless Chrome via Playwright `connectOverCDP` (screenshot after every
action, actually read each one before the next move), cross-checked against `GET /doc` on the
daemon as ground truth throughout. This session put deliberate extra time into the sound-design
step specifically, per the brief, since synth depth hadn't been pushed hard by prior pilots.

*Process note: the daemon/vite ports specified in the task brief (9803/9804) collided with a
concurrently-running pilot session's own Chrome CDP debug port — moved to 9810 (daemon) / 9811
(vite) instead, confirming the existing docs' warning that stale/concurrent processes are a real
source of port collisions between pilots.*

## Narrative walkthrough

(written turn-by-turn as the session progressed)

**First load.** `beat init --bpm 138` seeds a starter "lead" **synth** track already — convenient,
since the goal needed a synth track anyway (no "+ track" / instrument-picker step required). The
app opened onto the Arrangement (2 bars, 1 section) with the `lead` clip editor open below, in
"Clip" sub-tab by default.

**Finding the synth panel.** The bottom pane has `Clip` / `Device` sub-tabs (`Shift+Tab toggles`,
per the hint text). Clicking `Device` swapped in a "LEAD — full synth surface · drag a knob · every
edit is one line in the .beat file" panel — exactly the kind of framing that primes a user
correctly: these are real per-parameter edits, not a black box. One immediate oddity: the `PRESET`
dropdown at the top of the panel showed **"deep-sub-bass — bass"** even though this is a fresh
"lead" synth track whose actual live params (sawtooth, cutoff 2000, resonance 0.8 — the `beat init`
defaults) don't match that preset at all. It reads as if a preset were already applied, but the
live values disagree — a stale/default dropdown label, not a real selection state. `[confusing]`,
flagged for the findings section below.

**Sound design.** The synth surface needed scrolling (`Effect chain` → `Oscillator` → `Filter &
Envelope` → `LFO` → `Amp & Output` → sends, all in one long vertical panel) to reach the oscillator
and filter sections. Design decisions, each made by dragging the actual knob and confirmed against
`GET /doc` immediately after (not just eyeballed on screen):

- **OSC2 level 71%, detune +23c, unison 4 voices @ 61% width** — this is the core "supersaw" move:
  stacking a second detuned sawtooth *and* unison voices (rather than either alone) for the dense,
  chorused trance-lead texture. Chose +23c over the wilder +48c I landed on mid-drag (a 25px flick
  overshot to +48c — noted below, filter/detune knobs are clearly log-ish and not 1:1 with drag
  pixels) because ~20-25c reads as "thick" without turning into an out-of-tune chorus effect.
- **Cutoff 4.2kHz, resonance 6.4** — deliberately left headroom above the base cutoff for the filter
  envelope to sweep into, rather than opening the filter all the way (a stray full drag briefly put
  cutoff at 18kHz, effectively bypassing the lowpass — see findings). Resonance dialed in for an
  audible "bite" at the sweep's peak without self-oscillating.
- **Filter envelope: amount 68%, attack 3ms, decay 130ms, sustain 16%, release 130ms** — the classic
  trance "pluck" filter shape: near-instant snap open, fast decay back down to a much darker
  sustained tone, so every note has a bright transient followed by a comparatively duller body. This
  is the "snappy filter envelope" and "filter that can sweep" from the brief, and it was *silent* by
  default — `filterEnvAmount` starts at 0 in `beat init`'s starter track, so the shape knobs
  (attack/decay/sustain/release) do nothing audible until amount is raised off zero. A first-time
  user who tweaks the shape knobs without noticing the separate amount knob would reasonably
  conclude "the filter envelope doesn't do anything."
- **Amp envelope: attack 7ms, decay 144ms, sustain 76%, release 92ms** — punchy pluck attack
  (matches the filter snap), high sustain so held notes actually sing instead of dying out
  (important since the melody isn't all staccato), short release for clean separation between fast
  16th-note runs.
- **Keytrack 43%** — a smaller, more "informed sound designer" choice: without keytracking the fixed
  4.2kHz cutoff sounds proportionally darker on high notes and brighter on low ones; a bit of
  positive keytracking keeps the filter's perceived brightness more consistent across the melody's
  pitch range.
- **Volume -6.2dB** (nudged up from the -10dB default, modestly, since the OSC2+unison stack already
  adds a lot of loudness on its own).

Full final `synth` block on `lead` (`GET /doc`, i.e. what actually persisted, not just what the
knobs displayed): `osc2Level 0.7143, osc2Detune 23.4286, unisonVoices 3.5714, unisonWidth 0.6071,
cutoff 4190.06, resonance 6.4286, filterEnvAmount 0.6786, filterEnvAttack 0.0034, filterEnvDecay
0.1295, filterEnvSustain 0.1571, filterEnvRelease 0.1295, attack 0.0072, decay 0.1444, sustain
0.7571, release 0.0917, keytrackAmount 0.4286, volume -6.2286`.

**Writing the melody.** Switched the bottom pane back to the `Clip` sub-tab. First surprise: the
"Clip" tab button click didn't register at all the first time (`page.click('text=Clip')` — no tab
switch, no error, panel stayed on `Device`); a coordinate-based click on the same visible button
worked immediately. Possibly a stray element or overlay intercepting that particular text match,
worth a second look — noted as `[confusing]` below since it cost a full round-trip to diagnose as a
real user wouldn't get silent no-ops explained to them.

Extended `loop_bars` from 2 to 4 via the `+` button next to `LOOP LENGTH` (confirmed `loopBars: 4`
in `GET /doc`) to give the melody room to breathe — a "few bars" hook needs more than a 2-bar loop.
Before placing any notes, calibrated the piano-roll's pixel geometry directly against the DOM
(`noteview-grid` bounding rect + row-label rects for `C5`/`C4`/etc.) rather than eyeballing it,
which caught a real interaction problem immediately: **two clicks in the upper part of the visible
note grid silently did nothing** (no note, no error, no visual change) — they landed on rows that
were geometrically "in the grid" per its own bounding rect but were actually covered by the sticky
`lead / Clip / Device` tab header sitting on top of it in z-order. A real user doing exactly this
(clicking a high note near the top of the currently-scrolled view) would see literally nothing
happen and have no idea why — no cursor change, no error toast, nothing. Scrolling the grid down
~120px so the target rows cleared the header's real (as opposed to nominal) bottom edge fixed it
completely. `[bug]`, flagged below — this isn't a one-off; it'll happen to any user whose melody
needs a note near the current scroll window's top edge.

With the geometry calibrated (14px/step horizontally, 12px/semitone vertically, both exactly
linear and pixel-precise — no surprises once the header-overlap issue was worked around), placed a
real trance-lead hook: 27 notes across the 4 bars, mostly on-grid eighth notes (the single-click
default duration) with one syncopated sixteenth-note pair per bar-transition (`drag its right edge
to resize` used to shrink two notes from the default 2-step duration down to 1), a syncopated,
sparser bar 3, and a long 6-step resolving note on the tonic (A4) in bar 4 followed by a 2-step
pickup note leading back into the loop. Every single note placement and every resize was confirmed
against `GET /doc` immediately, not just eyeballed — the final note list came back exactly as
designed, no stray notes from misclicks during the resize drags, no accidental overlaps:

```
0  A4 d2   2  C5 d2   4  E5 d2   6  A5 d2   8  G5 d2  10  E5 d2  12  C5 d2
16 A4 d2  18  C5 d2  20  E5 d2  22  A5 d2  24  G5 d1  25  F5 d1  26  E5 d2  28 D5 d2  30 C5 d2
34 C5 d2  36  A5 d2  40  G5 d2  42  E5 d2  44  C5 d4
48 E5 d2  50  D5 d2  52  C5 d2  54  B4 d2  56  A4 d6  62  A4 d2
```

A minor, spanning A4-A5 (a full octave, a realistic trance-lead range), monophonic (no chords, no
overlapping notes), with real rhythmic variety (running 8ths, syncopated 16th pairs, a mid-phrase
rest, a long cadential note, a pickup figure back into the loop) — not a static arpeggio and not
whole notes.

**Placing it into a song structure.** The clip editor's toolbar has a `Place in Arrangement`
button, which seemed like the obvious next step. Clicking it while the project was still in
loop-mode did nothing destructive but also nothing useful — it surfaced a clear, well-written toast
instead: *"Add a song section first ('+ section') — clips only play once slotted into a song-mode
scene."* That's a good example of the app catching a real ordering mistake and telling the user
exactly what to do next, rather than either silently no-op'ing or crashing. `[worked well]`.

Clicked `+ section` (in the Arrangement toolbar) as instructed. This one click did a lot at once:
converted the project from loop-mode to song-mode, and — unexpectedly — created **two** song
sections in a single click, both named "s1" and, confirmed via `GET /doc`, both pointing at the
**same** `sceneId: "s1"`. `SONG 8` / "8 bars · 2 sections" appeared in the header even though I'd
asked for one section. This is the same class of bug the project's own history already knows about
(`docs/research/54`, the Phase 26 "Insert Scene" work) — sections sharing a scene id means editing
one silently edits the other, which is exactly wrong for anyone who actually wants two independent
song sections. Since the task only needed a single minimal section anyway, I treated this as a
real-user workaround: deleted the second section via its own `x` button, which correctly left one
section (`song: [{sceneId:"s1", bars:4}]`) with the melody's clip (`clips:[{id:"s1"}]`, 27 notes)
intact and unaffected by the deletion. `[bug]`, flagged below — a first-time user who actually
wanted 2 distinct sections from this button would get 2 secretly-coupled ones instead, with no
indication anything was shared.

After that, the bottom panel updated to show real clip-level chrome that hadn't been available in
loop mode: `clip "s1"`, a loop range slider, `bars`/`sig` fields — exactly what the earlier
"clip properties: add this track to a scene..." placeholder message had promised.

**Playback sanity check.** Tried the Space bar first (common DAW convention for play/pause) —
nothing happened, no error, transport stayed on "Play"/stopped, `POSITION` didn't move.
Clicking the actual `Play` button worked immediately: button flipped to `Stop`, `POSITION` began
advancing (1.1 → 1.2 within under a second), a live waveform meter appeared top-right, and the
playhead (a thin orange line) visibly swept across both the Arrangement clip strip and the note
grid in sync. Clicking `Stop` correctly halted and reset the visible state. `[confusing]` on the
Space-bar miss (a genuinely common expectation for anyone coming from another DAW), `[worked well]`
on the actual playback/visual-feedback loop once triggered via the button.

Checkpointed the finished state (`beat checkpoint ... --label "trance lead sound design + melody"`)
as the final step, matching how a real session would end.

## Sound-design experience specifically

What felt genuinely expressive toward "trance lead":

- **OSC2 level + detune, together with unison voices/width, as two separate-but-complementary
  thickening controls.** Having both a classic detuned-second-oscillator control *and* a
  unison-voices/width pair (rather than only one or the other) is exactly the toolkit a supersaw
  needs, and both responded predictably and continuously to dragging — no stepping, no surprises.
- **A dedicated filter-envelope-amount knob, separate from the envelope's shape (A/D/S/R).** Once
  discovered, this is a genuinely good design — it lets you dial a filter-envelope shape once and
  then use amount as a single "how much sweep" macro, closer to how a real analog-style synth
  separates "envelope shape" from "how much this destination responds to it." The problem (below)
  is discoverability, not the underlying design.
- **Keytrack** as an available, real parameter (not buried in an "advanced" drawer) rewarded actual
  synthesis knowledge — a small but real signal that this synth surface isn't a toy.

What felt opaque or worked against the goal:

- **Filter-envelope amount defaulting to 0% is a trap.** The four shape knobs (attack/decay/
  sustain/release) are laid out immediately next to the filter's own cutoff/resonance, reading as
  "the filter envelope" as a complete, already-active unit. Nothing in the layout signals that a
  fifth, separate knob (`FENV`, amount) gates whether any of it does anything at all. A user who
  doesn't scrub through every knob methodically (as this pilot did) would very plausibly spend time
  tweaking attack/decay/sustain/release, hear zero difference, and conclude the feature is broken.
- **Knob-to-value sensitivity is wildly inconsistent across parameter types, with no visual
  hint.** A ~25px vertical drag moved `OSC2 level` by ~36 percentage points but moved `cutoff` from
  2000Hz to 18000Hz (basically the whole usable range) in one pass, and `resonance` from 0.8 to a
  full range-spanning swing in two corrective drags. Every knob looks visually identical (same
  size, same arc, same drag affordance) but some are linear-normalized and some are steep log
  curves with tiny effective pixel ranges. A real user sound-designing by ear would routinely
  overshoot exactly like this pilot did on cutoff and resonance, and there's no on-knob cue (like a
  tighter/looser arc, or a "sensitive" label) warning which is which before the first drag.
- **The `PRESET` dropdown's stale/default label** ("deep-sub-bass — bass" on a fresh sawtooth lead
  whose live params match none of that preset) reads as an applied selection that isn't real.

## Findings summary

- **[bug]** Clicking `+ section` from loop-mode to create the arrangement's first song section
  created **two** sections in one click, both sharing the identical `sceneId` (`s1`) — confirmed via
  `GET /doc` (`song: [{sceneId:"s1",bars:4},{sceneId:"s1",bars:4}]`), not just the "8 bars · 2
  sections" header text. Same class of shared-scene coupling bug the project has already fixed once
  for the "Insert Scene" button (`docs/research/54`, Phase 26) — this instance is in the plain
  `+ section` path instead. Repro: fresh loop-mode project with any track content, click `+ section`
  once, inspect `GET /doc`'s `song` array. Real-user impact: anyone who actually wants 2 independent
  song sections (the overwhelmingly common case — a verse and a chorus, an intro and a drop) gets 2
  secretly-linked ones with zero indication, and will discover the coupling only the hard way, by
  editing one and watching the other change.
- **[bug]** Clicking on note-grid rows near the top of the currently-scrolled clip editor viewport
  silently does nothing — no note created, no error, no visual feedback of any kind — because the
  sticky `<track> / Clip / Device` tab header sits in front of (higher z-order than) the top ~35-40px
  of the scrollable note grid, even though the grid's own DOM bounding rect claims that space as part
  of itself. Repro: open a synth track's Clip editor, without scrolling, click a note near the very
  top of the visible piano-roll rows. Real-user impact: any melody whose highest notes land near
  the current scroll position's top edge will have some clicks that just don't work, with no
  explanation — a new user would likely think the click landed wrong (off by a row) rather than
  understanding it hit a completely different, invisible layer.
- **[confusing]** The filter envelope's `FENV` amount knob defaults to 0% and is the sole gate for
  whether the adjacent attack/decay/sustain/release shape knobs have any audible effect at all — see
  the sound-design section above. Not a bug (the knob is there and works correctly once found), but
  a real discoverability trap given how it's laid out to look like a complete, self-contained
  envelope.
- **[confusing]** Knob drag-sensitivity varies hugely and unpredictably by parameter (near-linear for
  levels/percentages, steep-log for `cutoff`, a different steep curve for `resonance`) with no visual
  distinction between a "gentle" knob and a "twitchy" one. Every overshoot in this session's sound
  design (detune to +48c, cutoff to 18kHz, resonance to 0 then back past target) traces to this.
- **[confusing]** The synth panel's `PRESET` dropdown shows a stale/misleading label ("deep-sub-bass
  — bass") on a freshly-initialized track whose actual live parameter values don't match that preset
  at all — reads as an applied selection when none was made.
- **[confusing]** A text-based Playwright click (`page.click('text=Clip')`) on the `Clip` sub-tab
  button silently failed to switch tabs once, while a coordinate click on the same visible button
  worked immediately afterward — possibly an overlapping/duplicate element in that area worth a
  second look, though this could also be a harness-side quirk rather than an app bug; flagged for
  awareness rather than as a confirmed defect.
- **[confusing]** The Space bar, a near-universal DAW play/pause shortcut, did not start playback in
  this session (no error, no state change); the on-screen `Play` button worked immediately and
  reliably. Not confirmed as a total absence of the shortcut (focus state at the time of the
  keypress wasn't independently verified), but worth a deliberate check.
- **[worked well]** `beat init --bpm 138` seeding a synth track by default meant zero setup friction
  for a synth-sound-design-focused session — no "add track" / instrument-type picker step needed.
- **[worked well]** The `Place in Arrangement` button's refusal message when the project was still in
  loop-mode ("Add a song section first...") was specific, correctly diagnosed the actual missing
  precondition, and named the exact button to click next — an example of the app doing real
  user-guidance work instead of a generic error or a silent no-op.
- **[worked well]** Every knob-drag and every note click/resize in this session, once the two bugs
  above were worked around, matched `GET /doc` ground truth exactly — no silent data loss, no
  desync between what the UI showed and what was actually persisted, across roughly 50 individual
  parameter/note edits.
- **[worked well]** Playback, once triggered via the button, gave strong, synchronized visual
  feedback (playhead sweep across both the Arrangement strip and the note grid simultaneously, a
  live output meter, correct `POSITION` advancement) — good ground-truth-matches-screen behavior for
  the one thing usability testing can't otherwise verify (audio) short of rendering and measuring.

## Where the pilot gave up on the "ideal" workflow

Only one real deviation, and it was a legitimate workaround rather than an abandonment: the goal
called for "a single section" in the arrangement, but the discovered mechanism (`+ section` from
loop-mode) produces two shared-scene sections in one click. Rather than accept a 2-section,
secretly-coupled arrangement or hunt for an alternate GUI path that doesn't exist, the pilot deleted
the surplus section via its own `x` control, which the daemon's document confirmed left a clean,
correct single-section result. A real user without ground-truth access (`GET /doc`) would have no
way to know the two sections were coupled in the first place unless they happened to edit one and
notice the other changing — this is exactly the kind of thing that's invisible on screen and only
findable by asking the file what actually happened.

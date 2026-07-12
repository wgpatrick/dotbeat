# Usability pilot 86: song structure + mixing pass on an existing sketch

Exploratory pilot (no scripted checklist) driving the real dotbeat GUI with Playwright against a
real `beat daemon`, working from `examples/night-shift.beat` (copied to a disposable scratch
fixture, never the owner's live `night-shift-song.beat`). Goal: turn a loose 4-track sketch into
an arranged, mixed song using whatever section/scene mechanism the GUI provides, then a mixing
pass (levels, pan, a reverb send, a macro check), then a full playback scrub.

## Starting state and the plan

`night-shift.beat` was a single 4-bar loop, 124bpm, 4 tracks: `lead` (synth, 7 notes, entering
late at step 20/64), `drums` (kick/clap/hat/openhat, snare unused), `bass` (synth, 20 notes,
nearly the full 4 bars), `pad` (synth, 12 notes, nearly the full 4 bars). The material already had
a mini "build" baked in (lead entering late), and lead+pad already had some reverb/delay send
dialed in while drums+bass had none — a real, pre-existing mix gap.

Plan: stretch this single loop's content across a real arrangement — **Intro** (bass+pad only) →
**Build** (add drums) → **Drop** (all 4 tracks) → **Drop** again (repeat) → **Outro** (pad alone),
20 bars / 5 sections total — then mix (levels, pan, a reverb send, a macro tweak), then scrub the
whole thing.

## Narrative walkthrough (condensed)

The app opened straight into the `lead` track's note editor in the bottom panel; the arrangement
above showed "4 bars · 1 section · detail view" and a `+ section` button — the obvious first thing
to try. Track headers showed a fader, pan knob, mute/solo, and small "Rv"/"Dl" badges (reverb/
delay send) that only appeared on `lead` and `pad` — a first hint that the sketch's mix was already
uneven before I touched anything.

Clicking `+ section` converted the project to song mode (`LOOP 4` → `SONG 8`) and added a second
4-bar section — but both sections showed the identical scene id `s1`, and reading the daemon's
live document confirmed why: `+ section` **duplicates the previous section's scene by reference**,
so editing one edits both. That's a real footgun for someone trying to build genuinely different
sections and clicking the most obvious button repeatedly. The actual tools for independent content
are `+ insert scene` (empty) and `+ capture scene` (pre-populated snapshot) — functionally correct,
but nothing in the UI explains the difference between the three near-identical "+X" buttons; I only
found the distinction by reading a code comment.

Renaming a section to something musical ("Intro", "Drop") doesn't exist — the section's visible
label *is* the scene id (`s1`, `s2`, …). Double-clicking it (which the arrangement's own hint text
advertises as "double-click a name to rename," true for tracks) didn't rename anything — it started
playback from that point instead. Right-click produced no context menu anywhere I tried it
(section label, clip block).

The real per-section content workflow took the most digging: each track's "Place in Arrangement"
button (in its note editor) always targets **section index 0**, no matter which section is
currently in view. There's no direct "populate section 3" GUI action. The working (if
non-obvious) technique: create the new empty scene, use the section chip's `◀` move-left button to
temporarily walk it to index 0, click "Place in Arrangement" for each track that belongs in it,
then walk it back to its intended position with `◀`/`▶`. Once understood, this worked perfectly
and reliably every time (verified against the live document, not just the screen) — I built all
four scenes (`s1` full band, `s2` bass+pad, `s3` drums+bass+pad, `s4` pad-only) and reordered them
into `Intro → Build → Drop → Drop → Outro` this way. The visual payoff was immediate and clear:
once a scene has fewer tracks slotted, the arrangement grid shows only those tracks' clip blocks in
that section's columns — genuinely legible at a glance.

Mixing was much smoother. The dedicated Mixer view (top toolbar) gave clean channel strips —
fader, pan, groove knobs, mute/solo, effect-chain badges — and I rebalanced all four tracks'
levels there by dragging faders. Panning drums off-center used the pan knob's click-to-type numeric
field (discovered via the in-app Shortcuts panel, which does document that gesture). Adding a
reverb send to `drums` (previously 0%) required navigating the Device panel's Clip/Device toggle,
then scrolling past six collapsed accordion sections (Filter & Envelope, Amp & Output, Ping Pong
Delay, Beat Repeat, Chorus/Phaser, Saturator) to reach "Sends" — no shortcut or search, just a long
scroll — but the control itself worked immediately and the badge appeared live in both the Mixer
and the arrangement header.

The macro check (specifically flagged in the brief as worth double-checking) surfaced the single
most important finding of the session: drum-kit Device panels expose three named macro knobs
(SPACE/PUNCH/SNAP) tied to the loaded kit preset. Turning PUNCH genuinely drove three underlying
parameters at once (`kickPunch`, `kickDecay`, `compRatio`) — confirmed against the live document,
so the macro mapping itself is real and works. But switching the **preset** dropdown to a different
kit correctly re-applied a full new, coherent set of underlying params (confirmed: `kickTune`,
`hatTone`, `cutoff`, `distortionAmount` all changed) while the macro knobs kept displaying the
**previous** kit's numbers. A page reload made it worse, not better: the preset label itself
reverted to the wrong kit name (while the actual sound params were, correctly, still the new kit's)
and the macro knobs then showed a third, seemingly arbitrary set of numbers matching neither kit.
Re-selecting the correct preset fixed the label and the sound but never fixed the macro knobs. The
raw `.beat` file has no `preset` or `macro` field at all (grepped and confirmed) — only literal
synth params — so both the preset label and the macro readouts are purely client-side,
reverse-inferred display state, and that inference goes stale independently of the actual
(correct) underlying sound.

The final playback scrub was clean: pressing Play from bar 1 showed only bass+pad highlighted as
"currently playing" with the live meter active; seeking to bar 9 (Drop) lit up all four tracks with
a visibly busier meter; seeking to bar 17 (Outro) correctly showed only pad active. Playhead,
per-column "is this playing now" highlighting, and the live meter all stayed in sync — good
end-to-end confirmation that the structure and the mix are real and connected, not just a labeled
diagram.

## Findings summary

- **[bug] Macro knobs go stale/wrong after a preset switch.** Confirmed reproducible: switching a
  drum-kit's preset dropdown correctly changes the underlying sound (verified against the live
  document) but the SPACE/PUNCH/SNAP macro knob *readouts* keep showing the old preset's values;
  after a page reload the preset *label* itself can revert to the wrong kit name while the actual
  params stay correct, and the macro knobs then show a third, unrelated set of numbers. Root cause:
  neither "current preset" nor "macro dial position" is a real field in the `.beat` document —
  both are inferred/cached client-side from raw params, and that inference doesn't track a preset
  switch. This is exactly the regression class the task brief asked to double-check, and it's real
  and present today. Highest-impact finding — a user tweaking a macro after changing a kit would be
  turning a knob whose on-screen number is actively lying to them.
- **[confusing] "+ section" silently shares content, unlike its two siblings.** Clicking the most
  discoverable button (`+ section`) links the new section to the *same* scene as the last one —
  edit one, edit both — with no warning. The buttons that actually mint independent content
  (`+ insert scene`, `+ capture scene`) look like siblings of `+ section`, not clearly-different
  tools, and the difference isn't explained anywhere in the visible UI.
- **[confusing] Sections/scenes cannot be renamed to anything musical.** The label a user sees for
  a section is the raw scene id (`s1`, `s2`, …) forever. The arrangement's own hint text
  ("double-click a name to rename") sits directly above the sections toolbar and reads as if it
  applies there, but double-clicking a section label starts playback instead of opening a rename
  field, and right-click has no context menu.
- **[slow-to-discover] Populating a non-first section has no direct affordance.** "Place in
  Arrangement" (the natural, discoverable way to get a track's content into a scene) always targets
  section index 0. Building section 2+'s content requires temporarily reordering that section to
  index 0 with the chip's `◀` button, placing tracks, then reordering it back — a real, reliable
  workaround, but nothing in the UI hints that this is necessary or why a click "did nothing" when
  tried on a section that wasn't first.
- **[slow-to-discover] Effect sends are buried at the bottom of a long accordion stack.** Reverb/
  delay send knobs live in the Device panel's "Sends" section, reachable only after scrolling past
  five other collapsed sections, with no search/jump control.
- **[worked well] Once a scene has a subset of tracks, the arrangement grid shows it immediately
  and unambiguously** — empty columns for excluded tracks, populated columns for included ones.
  This is the single best piece of UX in the whole song-structure flow, once you know how to get
  there.
- **[worked well] The Mixer view** (centralized channel strips: fader, pan, groove, mute/solo,
  effect badges) was the most immediately usable surface in the whole session — no hidden
  mechanics, drag-to-set faders and pan, changes reflected instantly and consistently across the
  Mixer and the arrangement header badges.
- **[worked well] Click-to-type numeric entry on knobs** (click the value readout, type, Enter to
  commit) is real, documented in the Shortcuts panel, and worked reliably for both pan and send
  levels.
- **[worked well] Playback scrubbing** (click anywhere on the ruler) was instant and stayed in
  sync with per-track "currently playing" highlighting and the live meter across all 20 bars and
  every section boundary — the actual proof that the arranged structure is functionally real, not
  cosmetic.

## Scene/section song-structuring workflow specifically

Once understood, the underlying model is sound and actually elegant: a **scene** is just a
per-track map of "which saved clip plays here" (tracks can be entirely absent from a scene), and a
**song** is an ordered list of `(scene, bars)` sections — so "different combinations of tracks per
section" falls directly out of which tracks a scene's slots include. The mental model matches the
task's brief almost exactly (v1 deliberately supports one editable clip per track, reused by
reference across scenes — confirmed in source comments, not a bug, a documented scope cut).

The friction is entirely in *discoverability*, not in the underlying mechanism:
1. Three visually-similar "+" buttons (`+ section`, `+ insert scene`, `+ capture scene`) have
   meaningfully different semantics with no in-UI explanation.
2. The one GUI action that actually populates a scene ("Place in Arrangement") only ever targets
   the first section, with no visible indication of that scope, so it silently "does nothing
   useful" when a user's mental target is section 2+.
3. Sections/scenes have no human-readable name — only the auto-generated scene id — despite
   adjacent hint text implying double-click-to-rename should work.

Combining structuring with mixing in the same session had no real friction — the Arrangement,
Mixer, and Device panels compose cleanly, switching between them didn't lose context (selected
track carried over), and edits in one were reflected live in the others (e.g., a new reverb send
badge appearing in the arrangement header the instant it was set in the Device panel). The two
workflows interleave well; it's specifically the *first-time construction* of multi-scene structure
that has the rough edges above.

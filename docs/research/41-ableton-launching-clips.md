# Research 41 — Ableton Live 12 Reference Manual, Chapter 16 "Launching Clips" (pp. 345-356)

*Parallel research pass, one of several mining individual chapters of the official Ableton Live 12
Reference Manual (dropped into `prior_art/`, gitignored) for ideas/gaps relevant to dotbeat's own
design and roadmap. Research-only — no code was written or modified. Source text read directly
from the manual's own PDF extract (`pdftotext -layout`), not fetched from the web this pass — see
citation convention below.*

## How to read this doc

- **[manual p.NNN]** — a claim taken directly from the chapter text, cited to its actual PDF page
  number. Page numbers are derived from the chapter's own printed footers in the extracted text
  (the chapter runs pp. 345-356; each page's footer number is visible in the raw extract and used
  directly, not estimated).
- **[dotbeat]** — read directly from this repo's current source this pass, cited with exact
  file:line so a future stream can jump straight to the code.
- **[prior research]** — a claim or ruling already established in an earlier `docs/research/*.md`
  pass or `docs/decisions.md`, cited so this doc doesn't silently repeat or (worse) contradict
  already-decided ground.

## 0. Scope, said honestly up front

This chapter is Ableton's own documentation of **Session View clip-launching mechanics**: launch
modes, quantization, Legato Mode, velocity-scaled triggering, and Follow Actions. dotbeat has no
Session View, no clip-launch grid, and no plans to build one — this is not a new finding, it is
already an explicit, twice-confirmed ruling:

- `docs/research/18-ableton-ui-architecture.md`: *"Confirmed Session-only, do NOT port: clip-launch
  triangles, scenes/scene-launch, [...] launch modes/quantization... Follow Actions"* (line 76-80),
  and its own recommendation table: *"Extended 'Launch' panel (Follow Actions, launch quant) ->
  **Skip**. Confirmed Session-only. No dotbeat analog, none wanted."* (line 462). [prior research]
- `docs/research/30-ableton-clip-visualization.md` §0: *"clip-launch/scene-launch/Follow-Actions are
  Session-only and explicitly out of scope"* (line 31-32). [prior research]

This doc does not revisit that ruling — it stands. What this doc *does* do, per the owner's brief,
is check the chapter's actual mechanisms one more time against dotbeat's newest arrangement-only
surface that plays a single clip on demand: the **"Preview clip" audition feature**
(`docs/phase-24-stream-ch.md`, `ui/src/audio/engine.ts:2924` `auditionClip`/`stopAudition`,
`ui/src/components/NoteView.tsx:738-750`) — shipped after research 18/30 were written, and the
closest thing dotbeat has to "a clip being triggered to play." The chapter's own opening sentence
is the sharpest possible confirmation of the scope line: *"The clip launch settings only apply to
Session View clips, as Arrangement View clips are not launched but played according to their
positions in the Arrangement."* **[manual p.345]** That is Ableton's own manual drawing exactly
the boundary dotbeat already committed to.

## 1. The Launch Controls — where they live in Ableton

Launch settings live in a clip's own Clip View, under a dedicated "Clip Launch" tab/panel, opened
by double-clicking a Session clip; settings can be edited across a multi-clip selection at once.
**[manual p.345-346]** This is purely a Session-View clip-inspector detail — dotbeat's equivalent
inspector (`ClipPropertiesPanel.tsx`) already only ever describes an Arrangement clip's content
(loop points, automation), never launch behavior, and that's correct as-is.

## 2. Launch Modes — Trigger / Gate / Toggle / Repeat **[manual p.346]**

Four options for how a clip responds to "down"/"up" of a mouse click, key, or MIDI note:

- **Trigger**: down starts the clip; up is ignored.
- **Gate**: down starts the clip; up stops the clip (a held-note/held-button model).
- **Toggle**: down starts the clip; up is ignored; the clip stops on the *next* down.
- **Repeat**: while held, the clip retriggers repeatedly at the clip quantization rate.

These exist because a Session clip can be fired from a mouse, a computer-keyboard key, or a MIDI
note-on/note-off pair from a controller — three different physical input shapes that need
different sustain semantics. **This is worth a two-second check against dotbeat's own Preview
Clip button**, since it's the one place dotbeat has a click-to-play-a-clip control: reading the
handler directly, a single click either starts (`engine.auditionClip(track.id)`) or stops
(`engine.stopAudition()`) depending on current state — i.e. it already behaves exactly like
Ableton's **Toggle** mode (down starts; the clip stops on the next down), not Trigger, Gate, or
Repeat. **[dotbeat]** `ui/src/components/NoteView.tsx:744-748`. This is the right (and only
sensible) choice for a single mouse-click GUI button with no held-state input surface — Gate and
Repeat exist specifically for hardware controllers/keys that can report a genuine down/up or
held-duration, which Preview Clip has no equivalent of (no remote-control mapping, no MIDI
learn onto the audition button). No action needed; flagging only to confirm the existing behavior
already matches the one Ableton mode that actually fits a plain button.

## 3. Legato Mode **[manual p.347]**

Engaging Legato Mode on a clip means that when it's launched, **it takes over the play position
from whatever clip was playing in that track before**, rather than restarting from bar 0 — the
explicit purpose is letting a performer toggle between several looping clips in the same track
without ever losing sync, even with quantization off. The manual also flags a real cost: unless
all the clips share the same underlying sample, jumping mid-sample like this can produce audible
dropouts from unpreloaded disk regions (mitigated by "Clip RAM Mode," not otherwise relevant here).

**Checked against dotbeat's audition and found not to apply, for a specific, statable reason**:
`auditionClip` always sets `t.position = 0` before starting — every audition restarts from bar 0,
even when switching from auditioning one track to another. **[dotbeat]**
`ui/src/audio/engine.ts:2938`. Legato Mode's whole motivation is a *live performance* concern —
never breaking the audience's sense of groove while a performer flips between loop variations in
real time. dotbeat's Preview Clip is not a performance surface; it's a comparison/audition tool
used while authoring (per `NoteView.tsx`'s own comment, "preview this clip's own notes/hits
directly, regardless of song position"). For that use case, always restarting from bar 0 is
arguably the *correct* behavior, not a gap: it gives a deterministic, downbeat-aligned point of
comparison every time you click Preview, rather than a position that depends on unrelated prior
state. **No change recommended** — considered and explicitly rejected, not overlooked.

## 4. Clip Launch Quantization **[manual p.348]**

A per-clip (or "Global," tied to the Control Bar's quantization setting, with `Ctrl/Cmd 6-0`
shortcuts) onset-timing correction: when a clip is triggered, its actual start is delayed to the
next quantization boundary rather than starting instantly on click/keypress. Its purpose is
**synchronizing multiple, independently-triggered clips** (across tracks, or the same track over
time) onto one shared musical grid so simultaneous performers/triggers don't produce audible
seams. The manual also notes a subtlety: any setting other than "None" quantizes a clip's launch
*when triggered by a Follow Action* too (§16.7 below).

**Checked against dotbeat's audition and found genuinely not applicable, with the reasoning
written down rather than assumed**: launch quantization solves a *multi-clip synchronization*
problem — but dotbeat's Preview Clip is explicitly a **true solo**, silencing every other track
for its duration (`NoteView.tsx:743`, `"silences every other track while auditioning"`), so there
is never a second simultaneously-playing clip to stay in sync with. The entire justification for
this feature (avoid seams between multiple live-triggered clips) doesn't exist in a single-track
solo-preview model. **No recommendation to add it.** (If dotbeat ever grew a genuinely different
feature — e.g. auditioning two tracks' content back-to-back on a shared bar boundary without a
manual re-click — quantized-start-on-next-beat would become relevant again, but that's speculative
and not something this pass is recommending; noted only so a future stream doesn't have to
re-derive why it isn't here today.)

## 5. Velocity **[manual p.349]**

A per-clip "Velocity Amount" control scales how much a MIDI note-on's velocity (i.e., how hard a
performer hits a key/pad that triggers the clip) affects the clip's *overall playback volume* — at
0% no influence, at 100% the softest note-on velocities play the clip essentially silently. This is
an input-expressiveness feature for MIDI/keyboard-remote-controlled clip triggering (cross-
referenced in the manual to the MIDI and Key Remote Control chapter).

**Confirmed not applicable, cleanly**: this scales a *trigger event's* velocity, and dotbeat's
Preview Clip has no MIDI-mapped or velocity-sensitive trigger input at all — it's a plain GUI
click. Worth noting for precision: dotbeat *does* already have a concept named "velocity," but it's
a different thing entirely — a per-*note* compositional field (each note/hit's own velocity,
edited via drag in the piano roll, `NoteView.tsx`'s `velPreview`/`velocityFromY`) that shapes how
loud that individual note sounds when the clip plays, not how the act of triggering the clip
itself is scaled. No overlap, no gap, no action.

## 6. Clip Offset and Nudging **[manual p.349-350]**

Nudge Backward/Forward buttons jump a *currently-playing* clip's position by increments the size
of the global quantization period — a way to intentionally offset a clip's playback from Live's
master clock (e.g. deliberately introducing a subtle rush/drag), or to scrub through material.
These buttons can be mapped to keys or a MIDI controller; in MIDI Map Mode, a continuous **scrub
control** additionally appears between them for a rotary encoder.

**This is the one corner of the chapter with a genuinely usable, non-Session-specific idea buried
in it**, separate from its literal purpose (deliberately detuning sync against a live band's other
performers, which has no dotbeat analog). Read narrowly, "nudge/scrub through a *currently playing*
clip's timeline" is a transport-UX idea, not a Session-grid idea — and dotbeat already has real
precedent for exactly this class of feature on the Arrangement ruler: click-to-seek and a
session-only loop-region override, both shipped in `docs/phase-24-stream-ce.md` (*"Ableton-style
click-to-seek (click while stopped starts playback there, click while playing just relocates)"*).
**[dotbeat]** Checked directly: `ui/src/components/NoteView.tsx` has no equivalent — no
click-to-seek or scrub handler inside the piano roll grid at all (confirmed by grep: zero matches
for `seek`/`scrub` in the file), so while a clip is auditioning via Preview Clip, there is
currently no way to jump into the middle of it — you can only listen from bar 0 or stop it.
**Recommendation (small, optional, not a Follow-Action-shaped feature)**: consider a lightweight
click-to-seek-within-audition affordance on the NoteView grid (clicking a bar column while
auditioning relocates playback there, mirroring the pattern CE already established on the
Arrangement ruler) — genuinely useful for skipping to a specific bar of a long clip rather than
waiting for the loop to come back around, and small enough to be a follow-up line item rather than
its own stream. This is the one idea in this chapter worth flagging as *actually* actionable;
everything else in §2-5 and all of §7 below is either already matched or confirmed N/A.

## 7. Follow Actions **[manual p.351-356]**

By far the largest section of the chapter (6 of 12 pages). A per-clip (or per-scene) setting that
fires automatically after a clip finishes playing (or after a configured duration), choosing what
happens next among clips grouped by contiguous Session-grid slots in the same track:

- **Setup** [manual p.351-352]: a Follow-Action-enabled clip picks two actions, A and B, each with
  an independent percentage **Chance** (e.g. Chance A 100%/Chance B 0% always fires A; Chance B 90%
  in that same setup makes A fire roughly 1-in-10 times instead). A Linked/Unlinked switch (clips
  only) controls whether the action fires at the end of the clip (or after N loops) versus after a
  fixed **Follow Action Time** measured from clip start. Follow Actions circumvent *global*
  quantization but not *clip* quantization, and any Follow-Action-triggered launch is itself
  quantized if the clip's own launch-quantization isn't "None."
- **The ten available actions** [manual p.352] (icon glyphs were graphical and stripped by text
  extraction; names below reconstructed from the accompanying description text, standard Ableton
  terminology): **No Action** (nothing happens, and it suppresses any other pending Follow Action
  on that clip even at 100% chance), **Stop** (stops the clip, overriding its own loop/region
  settings), **Play Again** (restarts the clip), **Previous**/**Next** (step to the adjacent slot in
  the group, wrapping at the ends), **First**/**Last** (jump to the top/bottom of the group), **Any**
  (a random clip in the group), **Other** ("Any" but never repeats the current clip back-to-back
  unless it's the only one in the group), **Jump** (an explicit target slot/scene, set via a slider).
- **A global kill switch** [manual p.353]: "Enable Follow Actions Globally" disables every clip/scene
  Follow Action at once, specifically so a performer can edit running clips without playback
  jumping out from under them mid-edit — grayed out automatically when a Live Set has none defined.
  Scene Follow Actions take precedence over clip Follow Actions once triggered, though clip Follow
  Actions keep running underneath.
- **Six worked recipes** [manual p.354-356], each a distinct compositional pattern built from
  chance/linking/grouping: looping only the tail of a longer clip via a two-clip Split+Next+Loop
  chain (§16.7.1); chaining a group with "Next" on every clip to form an infinite cycle, optionally
  peppered with low-chance "Any" for rearrangement (§16.7.2); a single self-referential clip with
  high-chance "Play Again" and low-chance "No Action" to create a probabilistically-terminating
  micro-loop (§16.7.3); combining Follow Actions with Legato Mode across near-identical clips so a
  melody/beat gradually metamorphoses while staying in sync (§16.7.4); duplicating/varying a clip
  and chance-picking between instances for generative remix/mashup behavior (§16.7.5); and — the
  clearest statement of intent in the whole chapter — deliberately irregular Follow Action Times
  across a clip series specifically for **sound installations that play for weeks or months and
  never exactly repeat** (§16.7.6).

**Confirmed out of scope, consistent with prior rulings, and worth stating the sharper reason
why.** This is not just "a Session-grid feature dotbeat doesn't have a grid for" (though it is
that too — Follow Actions are defined entirely in terms of "successive slots of the same track,"
a concept with zero equivalent in dotbeat's linear Arrangement). It is, more fundamentally, in
**philosophical tension** with dotbeat's own thesis. §16.7.6 states Follow Actions' purpose
explicitly: build structures that "never quite play in the same order or musical position" twice.
dotbeat's entire value proposition (`ROADMAP.md` §1) is the opposite — a `.beat` file is a
deterministic, diff-friendly, git-committed document; two people (or an agent and a human) opening
the same file and pressing play should hear the *same* thing, because that's what makes `git diff`
and `git log` meaningful for music in the first place. A native Follow-Action-equivalent (chance-
weighted, non-reproducible clip sequencing baked into playback) would actively undermine that
guarantee, not just be redundant with it. This is a stronger case for exclusion than "no GUI
surface exists for it" — it would be actively wrong to add, not merely unbuilt.

**One narrow, already-resolved echo worth naming so it's not mistaken for a gap**: the Chance A/B
percentage mechanism (probabilistic branching at trigger time) does have a real, shipped analog in
dotbeat — just at a completely different granularity. dotbeat already has a per-*note* `chance`
field (0-100, edited by dragging a dedicated "chance lane" under the piano roll, rendered as
dashed/dim for `chance<100`). **[dotbeat]** `ui/src/components/NoteView.tsx:715-716` (tooltip
text), `:46` (`CHANCE_LANE_H`), `:660-` (the paint gesture). Ableton's Follow Actions decide *which
whole clip plays next*, at performance time, macro/structural, and explicitly non-reproducible by
design; dotbeat's `chance` decides *whether one note sounds*, at composition time, micro/textural,
and fully reproducible (it's a seeded, deterministic field written into the `.beat` file itself —
the opposite of Follow Actions' live-performance randomness). Both are "probability shapes music,"
but they solve unrelated problems at unrelated scales — this is a case where noting the surface
similarity and then explaining why it doesn't generalize is more useful than either ignoring it or
forcing a connection. No recommendation follows from this — it's confirmation dotbeat already has
the *right-shaped* answer to "where does probability belong" for its own model, and Follow Actions
aren't evidence of a gap there.

## Relevance to dotbeat — summary

| Chapter concept | Verdict | Why |
|---|---|---|
| Launch Controls panel location (§1) | N/A | Session-clip inspector; dotbeat's clip inspector already Arrangement-only, correctly |
| Launch Modes: Trigger/Gate/Toggle/Repeat (§2) | Confirmed, no action | Preview Clip already behaves as Toggle — the only mode that fits a plain click button; no held-input surface exists to make Gate/Repeat meaningful |
| Legato Mode (§3) | Considered, rejected | Solves a live-performance sync problem Preview Clip doesn't have; always-restart-from-0 is the *correct* choice for a deterministic audition tool |
| Clip Launch Quantization (§4) | N/A, reasoned | Solves multi-clip sync; Preview Clip is always a true solo, so there's never a second clip to sync against |
| Velocity (§5) | N/A | Scales a MIDI trigger event's velocity; Preview Clip has no MIDI/velocity-sensitive trigger input (distinct from dotbeat's existing per-note velocity, which is unrelated) |
| Clip Offset and Nudging (§6) | **Actionable, small** | No click-to-seek/scrub exists inside NoteView's audition; CE's Arrangement-ruler click-to-seek is a direct, already-shipped precedent to extend |
| Follow Actions (§7) | Confirmed out of scope, and philosophically opposed | Not just Session-grid-shaped; actively contradicts dotbeat's deterministic/diffable-document thesis. Chance A/B's only real echo is dotbeat's own per-note `chance`, a different, already-correct mechanism at a different scale |

The one concrete, low-cost recommendation from this whole chapter is **§6's click-to-seek inside
the audition transport** — everything else either already matches dotbeat's existing (correct)
behavior, is cleanly not applicable given dotbeat's true-solo/deterministic audition model, or is
Session-View machinery that prior research already ruled out and this pass found additional,
sharper reasons to leave ruled out.

## Sources

Ableton Live 12 Reference Manual, Chapter 16 "Launching Clips," pp. 345-356 (owner-supplied PDF,
`prior_art/`, gitignored — read via `pdftotext -layout` extract for this pass, not fetched from
the web). dotbeat internal (read directly this pass): `ui/src/audio/engine.ts` (`auditionClip`
line 2924, `stopAudition` line 2946); `ui/src/components/NoteView.tsx` (Preview Clip button
738-750, chance lane 46/660-716, velocity preview 282); `docs/phase-24-stream-ch.md` (the audition
feature's own design writeup); `docs/phase-24-stream-ce.md` (loop-region + click-to-seek
precedent); `docs/research/18-ableton-ui-architecture.md` (prior Session-only ruling, lines 70-80,
462); `docs/research/30-ableton-clip-visualization.md` (prior Session-only ruling, §0);
`docs/decisions.md` (D12, product/design-fork framing); `ROADMAP.md` §1 (dotbeat's own thesis).

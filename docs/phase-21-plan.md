# Phase 21 — the drum clip editor needs to be redone (research + design)

*Kicked off 2026-07-11, following direct owner feedback with two side-by-side screenshots
(dotbeat's current `StepSequencer` vs. a real Ableton drum-rack note editor). Extends research 19
(drum-voice expansion) rather than duplicating it — that research already scoped the voice-count/
taxonomy question; this scopes the *editing model* question, which turned out to be entangled
with a real format decision (D-log research 12's "drums have no duration") that needs revisiting.
Research + design only this round — the actual build should land after Stream U (piano roll
pitch reference) finishes, since the likely direction is reusing/extending `NoteView` for drums
rather than keeping `StepSequencer` permanently separate, and building both concurrently risks
wasted rework.*

## What's already confirmed, don't re-derive

Checked directly against the real code before writing this doc:

- **Arbitrary hit timing is already fully supported by the format.** `BeatDrumHit.start` is
  "16th steps, fractional, absolute over the loop" (v0.8, `src/core/document.ts`) — free-timed,
  not grid-locked. `StepSequencer.tsx`'s rigid 16-step toggle grid is a GUI ceiling on top of a
  format that already does what the owner is asking for. This is a real UI redesign, not a format
  change.
- **Hit duration is NOT modeled at all**, and that's not an oversight — v0.8 deliberately decided
  "no duration: drum voices/one-shots are triggers... research 12" (SMF note-off irrelevance for
  percussion, Hydrogen's length=-1 convention). The owner is explicitly asking to reverse this —
  legitimate (a tuned, sustained 808 kick played as a bass-like note is real production practice
  that decision didn't weigh), but it's a real format change requiring its own reasoning, not a
  quiet UI tweak.
- **Ableton's drum-rack editor is structurally the same component as its piano roll** — pitch rows
  become named drum-pad rows, notes become hits, everything else (marquee select, multi-select,
  group move/resize, velocity lane) is identical. dotbeat's own `NoteView.tsx` already has all of
  that interaction machinery (Phase 13/17) for melodic notes; `StepSequencer.tsx` is a structurally
  different, more limited component (toggle-grid, not free note placement).

## Research questions

1. **Confirm the note-editor unification precisely, from Ableton's own documentation** (not just
   the two screenshots already reviewed): does Ableton's drum-rack view share literal UI code with
   its piano roll, or just a similar visual language? What's different about it specifically for
   drums (e.g., is there still a concept of a fixed grid snap even though position is free — a
   "snap to 16th" toggle rather than a hard constraint)?
2. **Hit duration, precisely**: how does Ableton actually let you set a drum hit's length in the
   UI (drag the right edge, like a note?), and what does "length" *mean* for a triggered sample vs.
   a synthesized voice — does it choke/gate the sample early, or extend a synth voice's envelope
   release, or both depending on voice type? This directly determines what the format field and
   engine behavior need to be.
3. **Reconcile with research 12's original reasoning** (`docs/research/12-drum-representation.md`
   — read it) — what did that pass actually find, and does adding an *optional* duration field
   (defaulting to the current lengthless-trigger behavior when absent) cleanly coexist with its
   conclusions, or does it need to be revisited more substantially? Favor the smallest change that
   satisfies the owner's real request over a wholesale reversal if research 12's core finding
   still holds for most percussion.
4. **Cross-reference against research 19's voice-taxonomy recommendation** (12-lane GM-aligned kit,
   synthesized 808/909 voices + SoundFont-backed acoustic/percussion voices) — does hit duration
   apply differently to synthesized vs. sample-backed lanes? (Likely yes: a synthesized 808 kick
   has an obvious duration/release parameter already close to hand; a one-shot sample hit "length"
   more naturally means "how much of the sample plays" — truncation, not envelope release.)

## Deliverable

`docs/research/20-drum-clip-editor-redesign.md` (numbered research-doc convention). **End with a
concrete build plan**, specific enough for a future stream to execute without re-deriving this
analysis: the exact format change (a new optional field on `BeatDrumHit`, its semantics per voice
type), whether to extend `NoteView` to also handle drum tracks (with named-lane rows instead of
pitch rows) or build a new-but-NoteView-derived component, and how this sequences against
research 19's still-unbuilt voice-expansion work — these two pieces of work likely need to land
together (more voices + real length editing) rather than sequentially, say so if that's what the
evidence supports.

Do not touch any source code this round — this is research and design only. `ui/src/components/
NoteView.tsx` is mid-flight under Stream U right now; reading it for reference is fine, editing it
is not. When done, confirm `npm test` is unaffected. Commit your new research doc ending in
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Do not push, do not merge to main.

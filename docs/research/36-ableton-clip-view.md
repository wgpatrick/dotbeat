# Research 36 — Ableton Live 12's Clip View vs. dotbeat's just-shipped clip-authoring flow

*2026-07-12. Owner-commissioned parallel research pass, one chapter of the Ableton Live 12
Reference Manual per stream. This chapter: "8. Clip View," manual pp. 185-218. Research-only — no
code was written or modified. High priority: the owner is actively testing dotbeat's own
clip-authoring/audition/resize/place-in-arrangement flow live in the GUI this session (features
that shipped in Phase 24 — Streams CH "audition clip," CI "Place in Arrangement," CJ "clip-loop
resize handle" — plus the older Stream AG properties panel), and has open questions about exactly
those three things.*

## How to read this doc

- **[manual p.NNN]** — a claim read directly from the extracted chapter text
  (`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-chapters/ch08.txt`, raw `pdftotext -layout`
  output of manual pages 185-218). Page numbers are derived from the chapter's own printed
  page-footer numbers in the extract (the chapter starts at 185; each footer marks where a page
  ends), not estimated from position.
- **[dotbeat]** — read directly from this repo's current source this pass, cited file:line, not
  inferred or assumed.

## 0. Why this chapter, right now

The owner's own framing: *"how to hear a clip while authoring, how to resize a clip, how it gets
placed into the arrangement."* All three are real, recently-shipped dotbeat features —
`engine.auditionClip`/`stopAudition` (Phase 24 Stream CH), the clip-loop drag handle in
`NoteView.tsx` (Stream CJ), and the "Place in Arrangement" button (Stream CI) — built without a
direct pass against Ableton's own Clip View documentation. This chapter is that pass: Ableton's
Clip View is the single most directly analogous surface in the entire manual to what dotbeat just
built (`ClipPropertiesPanel.tsx` + `NoteView.tsx`), so the gap analysis here is unusually literal —
almost every subsection below has a direct dotbeat counterpart to check it against, not just an
analogy.

## 1. Clip View: what it is, how it opens, how it's laid out

**Opening and framing** [manual p.185]: double-click a clip in Session or Arrangement View, use the
Clip View Selector, or the Clip View Toggle (`Ctrl+Alt+3` / `Cmd+Option+3`). The Clip View **always
shows the currently selected clip** [manual p.186] — selecting a different clip elsewhere updates
it live, including across a second window (a genuinely two-window workflow: dedicate one window to
detailed clip editing while working the Session/Arrangement grid in the other). Clicking a **Track
Status Display** in Session View opens the Clip View for whatever clip is *currently playing* on
that track [manual p.186] — a direct "show me what's actually sounding right now" affordance.

**Layout** [manual pp.186-190]: a title bar, then two sections — **clip panels on the left**, an
**editor on the right**. The editor is content-type-specific: the **Sample Editor** for audio
clips, the **MIDI Note Editor** for MIDI clips [manual p.186]. Panels can be arranged horizontally
or vertically, or auto-switch by available height [manual p.190], and can be folded via
double-click on the title bar [manual p.191].

**Editor view modes** [manual pp.191-192]: audio clips toggle between the **Sample Editor** and an
**Envelope Editor**; MIDI clips toggle between the **MIDI Note Editor**, the same **Envelope
Editor**, and an **MPE Editor**, via `Alt+Tab`/`Option+Tab`. The manual is explicit about what each
does: Sample Editor shows the waveform and warp controls; **the Envelope Editor "manages the
clip's envelopes, which can be used to automate or modulate the effects, mixer, and clip or MIDI
controls"** [manual p.192]; the MIDI Note Editor edits notes and velocities; the MPE Editor edits
per-note MPE dimensions.

## 2. Clip title bar: activator, name, color, save-default

**Clip Activator toggle** [manual p.187]: deactivates a clip so it doesn't play, from the Clip View
title bar, the clip's context menu, or the `0` key. Multi-select toggles all selected clips at
once.

**Clip name** [manual p.187]: defaults to the referenced file's name, renamed via the title bar
context menu, the Session/Arrangement selection + Edit menu, or the clip's own context menu — plus
a separate free-text **"Edit Info Text"** command. Renaming an audio clip does **not** rename the
underlying sample file [manual p.188] — a deliberate separation between "what I call this clip"
and "what the file on disk is called."

**Clip color** [manual p.188]: new clips inherit their track's color; can be manually reassigned
from a palette; "Assign Track Color to Clips" bulk-reapplies the track's color, scoped **separately
per view** (a Session-clip recolor doesn't touch the Arrangement copy, and vice versa — consistent
with §4's "Arrangement is an independent copy" behavior, research 30 §4).

**Save Default Clip** [manual pp.188-189], audio-only: saves the *current clip's settings* (most
importantly Warp Markers) as the default applied whenever that same sample is dropped into a Set
again. Explicitly **not retroactive** — existing clips using the sample are untouched — and this is
explicitly **different from** "save as a Live Clip" (which also captures devices/device settings).

## 3. Main Clip Properties: region, loop, time signature, groove, scale

**Clip and Loop Region Settings** [manual pp.193-194] — this is the section most directly relevant
to "how to resize a clip." Ableton actually models **two distinct concepts**, not one:

1. **Clip start/end** — "the section of the clip that plays when a clip is launched." An unlooped
   clip plays start→end or until stopped. Adjustable via numeric fields, or **Set Start/Set End
   buttons that capture the current playhead position during playback**, quantized to the global
   quantization setting [manual p.193].
2. **Loop region** (Clip Loop toggle + Loop Position/Length fields) — a *separate*, potentially
   shorter region inside the clip that repeats. Default Loop Length = the clip's total length
   [manual p.193]. Critically: **the clip always begins playing at the start marker, not the loop
   start** [manual p.214] — "Setting the Clip to Run Into a Loop" — so a clip can have a pickup/intro
   section that plays once before falling into the loop. Audio clips require Warp to be on before
   Loop can be enabled at all [manual p.194].

The **Set Loop Position / Set Loop Length buttons support a live, spontaneous capture workflow**
[manual p.194] worth quoting closely, because it's almost exactly the owner's stated workflow:
*"Playing the clip and then clicking the Set Loop Position button moves the beginning of the loop
to the current playback position... Then, clicking the Set Loop Length button moves the end of the
loop to the current playback position. This lets you capture the music in a loop on the fly."*
There's also a narrower one-button version: with looping still off, clicking **Set Loop Length
alone** sets the loop to end at the current playback position (using the existing preset length)
and simultaneously turns looping on.

**The Loop Brace** [manual pp.213-214] is the *editor's* (not the panel's) representation of the
same loop region — click-drag either edge to move/resize, plus a rich keyboard vocabulary:
left/right arrows nudge by the grid; up/down arrows shift the whole brace by its own length;
`Ctrl`+left/right shortens/lengthens by one grid unit; `Ctrl`+up/down doubles/halves the loop
length. **Duplicate Loop** (Edit menu) doubles the loop's length and content, sliding any MIDI
notes past the old loop end to preserve their position relative to the new end [manual p.214].

**Clip Time Signature** [manual p.194]: settable per clip, **explicitly display-only — "does not
affect playback"** — independent of the project's own time signature, useful for visually flagging
polymetric material.

**Clip Groove** [manual pp.195-196]: a per-clip groove-pool assignment; a **Commit** button "writes"
the groove permanently into the clip and, for audio clips, converts positive groove velocity data
into an actual **volume clip envelope** (overwriting any existing one) — a concrete example of one
clip-property mechanism materializing into another (envelope).

**Clip Scale** [manual pp.196-197]: a per-clip Scale Mode (Root Note + Scale Name). For audio clips
it's metadata only, forwarded to scale-aware devices downstream. For MIDI clips it **highlights the
in-scale keys directly in the MIDI Note Editor's piano ruler** — a compositional aid, not a
constraint (notes outside the scale can still be entered; Fit to Scale, §5, is the enforcement
tool).

## 4. Extended Clip Properties: launch controls are Session-only

[manual pp.197-198] The Extended Clip Properties panel holds Follow Action / launch controls
(mouse/keyboard/MIDI triggering, launch quantization, scrub, velocity→volume) and MIDI bank/program
change controls. The manual states plainly: **"since Arrangement clips are not launched, but
instead played according to their position on the timeline, this panel shows the clip launch
controls only when a Session View clip is selected"** — for an Arrangement audio clip the panel
doesn't appear at all; for an Arrangement MIDI clip only the bank/program controls remain. This
directly corroborates research 18/30's already-settled scoping call: dotbeat targets Arrangement,
not Session, so the entire Follow Action/launch-control surface (a large fraction of what a real
Ableton Clip View contains) is out of scope by design, not an oversight.

## 5. Audio-specific and MIDI-specific tool panels

**Audio Utilities panel** [manual pp.199-207]: Warp toggle (on = sync to song tempo; off = play at
original speed, recommended for "percussion hits, atmospheres, sound effects, spoken word" [manual
p.201]), Reverse (creates a new sample; Warp Markers and envelopes both stay **fixed to their time
position** through the flip, per explicit rules [manual p.202]), Destructive Sample Editing (opens
an external editor; Warp Markers survive only if sample length is unchanged [manual p.203]), Clip
Start/End Fades (0-4ms, signal-dependent, **Session-View-only** — Arrangement fades are done via
envelopes instead [manual p.204]), RAM Mode (trades disk risk for RAM-swap risk, with an explicit
distinction: "disk overloads result in unwanted mutes, whereas RAM overload results in both mutes
and rhythmical 'hiccups'" [manual p.205]), High Quality Interpolation (~19 semitones of transposition
headroom before audible aliasing [manual p.206]), and Gain/Pitch sliders (Gain in dB; Pitch in
semitones + a separate cents field [manual p.207]).

**Pitch and Time Utilities panel**, MIDI-only [manual pp.207-210]: Transpose (semitones or scale
degrees if Scale Mode is on), **Fit to Scale** (snaps the selection into the clip's active scale;
inactive if no scale is set), **Invert** (flips the selection upside-down, swapping highest/lowest),
Interval Size + **Add Interval** (duplicate the selection at a fixed interval), a **Stretch** knob
plus ×2/÷2 buttons, a **Duration** chooser + **Set Length** button, a **Humanize Amount** slider
("up to half a grid division") + **Humanize** button, a selection **Reverse** button (flips note
*order*, distinct from the audio Reverse above), and **Legato** ("lengthen or shorten each selected
note so that it is just long enough to reach the beginning of the next note").

**Transform and Generate panels** [manual pp.210-211]: for audio, a single Quantize tool that nudges
Warp Markers by a settable percentage of the grid/meter value — "there is no Generate panel for
audio clips." For MIDI, a fuller "MIDI Tools" set: transformation tools that replace
selected/time-selected/all notes in place, and generative tools that add new note patterns within
the loop/selection range, both scale-aware when Scale Mode is on.

## 6. Playing, scrubbing, zooming — the audition-adjacent mechanics

[manual pp.211-213] Zoom/scroll in either editor works like Arrangement View (drag vertically in
the ruler to zoom, horizontally to scroll); `Z` zooms to the current selection, `X` steps back
through zoom history. A **Follow toggle** keeps the editor scrolled to the play position, and — a
detail worth noting — **pauses itself automatically the moment you make an edit**, resuming only on
stop/restart or an explicit click in the scrub area [manual pp.211-212].

**Scrubbing** [manual p.212]: clicking the lower half of the waveform, or the dedicated scrub strip
below the time ruler, jumps playback to that point; the jump size is quantized by the *global*
quantization setting (quick-switchable via `Ctrl+6..0`); holding the mouse down repeatedly re-plays
a chunk the size of that quantization — with a fine-enough setting, this becomes genuine scrubbing
through the audio. **Chase MIDI Notes** (Options menu) lets a MIDI note still sound if playback
starts mid-note.

## 7. Multi-clip editing, sample details, cropping, replacing, update rate

- **Sample details** [manual p.215]: the Sample Editor header shows the loaded sample's name,
  sample rate, bit depth, channel count; multi-select shows an asterisk wherever values disagree,
  plus a total-selected-count.
- **Cropping** [manual pp.216]: audio and MIDI clips both support "crop to start/end (or
  loop-bounds)" and "crop to time selection," `Ctrl+Shift+J`, producing a genuinely new (shorter)
  sample file for audio.
- **Replacing the sample** [manual p.216]: drag a new sample from the browser onto the Clip View;
  pitch/volume settings are retained, Warp Markers only if the new sample is the exact same length.
- **Multi-clip property editing** [manual p.217]: dragging from an empty slot, or Ctrl/Shift-click,
  builds a multi-clip selection; the panel shows only properties the selection has *in common*;
  differing numeric values show as a draggable range, collapsing to one shared value if dragged to
  an extreme.
- **Clip Defaults and Update Rate** [manual pp.217-218]: live edits to a running clip are quantized
  to a global "Clip Update Rate" setting (in Record, Warp & Launch Settings), and some properties
  (Launch Mode, Warp Mode) can be set as defaults applied to every newly created clip.

## 8. Relevance to dotbeat — concept-by-concept against the code that just shipped

Read directly this pass: `ui/src/components/ClipPropertiesPanel.tsx` (152 lines) and
`ui/src/components/NoteView.tsx` (1,304 lines), plus the data model (`src/core/document.ts`) and
daemon route (`src/daemon/daemon.ts`) they drive through.

### 8.1 "How to hear a clip while authoring" — dotbeat's answer is real, and matches a genuine gap Ableton itself has no single-button fix for

dotbeat's **"▶ Preview clip" button** (`NoteView.tsx:736-752`, `engine.auditionClip`/`stopAudition`,
`ui/src/audio/engine.ts:2924-2950`) plays a track's own live `notes`/`hits` in isolation, silencing
every other track, **regardless of the document's song position** — explicitly built (Phase 24
Stream CH) because in song mode, live edits made in `NoteView` are otherwise inaudible until
re-saved into a clip (research 30 §4's exact finding).

This is dotbeat's structurally-forced equivalent of a mechanism Ableton gets "for free" that
dotbeat cannot: in Ableton, **Session View clip-launch itself is the audition button** — click a
clip slot and it plays, immediately, independent of what's in the Arrangement timeline. Research 18
already scoped dotbeat away from building a Session-style launch grid, so a dedicated audition
control is the correct substitute, not a workaround — this is a confirmed-good design decision, not
a gap. One real, actionable delta from the manual, though: Ableton's **Follow toggle pausing itself
on edit and its scrub-area repeat-a-chunk gesture** (§6 above) are two additional low-effort
audition affordances dotbeat doesn't have yet — worth flagging for later, not blocking (see §9).

### 8.2 "How to resize a clip" — dotbeat conflates two Ableton concepts into one, and only half is drag-resizable

This is the sharpest, most actionable finding in this chapter. Ableton models **clip start/end**
(what plays, including a possible pickup before the loop) and **loop region** (what repeats) as two
separate, independently adjustable things (§3 above). dotbeat's `BeatClip` has only **one**:

```
// src/core/document.ts:464-467
export interface BeatClipLoop {
  start: number // bars, clip-local, >= 0
  end: number   // bars, clip-local, > start
}
```

There is no separate "clip start/end" field distinct from the loop — `BeatClip` (document.ts:544-552)
has `loop: BeatClipLoop | null` and nothing else region-shaped. This means Ableton's "run into a
loop" pattern (play an intro once, then repeat a shorter tail — manual p.214) has **no dotbeat
equivalent at all**; a dotbeat clip's playable region and its repeating region are definitionally
the same range.

Given that single-concept model, **resizing today means dragging the clip-loop strip's right-edge
handle** in `NoteView.tsx` (`noteview-cliploop-handle`, `startClipLoopResize`/`onClipLoopPointerMove`/
`onClipLoopPointerUp`, lines 469-523 and rendered at lines 872-908) — and the code says explicitly
why only the end is draggable:

> *"Only the END is drag-resizable (start stays wherever it already was, 0 for a fresh override) —
> matches Stream AG's own precedent of a single right-edge drag handle... rather than inventing a
> two-handle range-select gesture."* (`NoteView.tsx:477-479`)

So the direct answer to "how do I resize a clip" today is: **drag the thin strip above the note
grid, at its right edge** — the start is only editable numerically, via `ClipPropertiesPanel.tsx`'s
small `loop.start` number field (lines 66-108), which has no drag handle and is easy to miss
sitting in a compact toolbar strip. Ableton, by contrast, gives you drag handles on **both** the
loop brace's edges (§3) *and* the separate start/end markers, plus keyboard nudge (arrows, `Ctrl`+
arrows) on top. dotbeat's current resize surface is real but half of Ableton's — draggable end,
non-draggable (numeric-only) start.

### 8.3 "How it gets placed into the arrangement" — dotbeat's button is the direct, correctly-scoped analog of Ableton's mechanism 1 (research 30 confirmed this gap already existed; it's now closed)

Research 30 §3 flagged, as an open gap, that dotbeat had *no* GUI path to slot a synth/drum clip
into a scene — only CLI/MCP. **That gap is now closed**: `NoteView.tsx`'s "Place in Arrangement"
button (lines 525-553, 768-783) calls `postPlaceClip` → `POST /place-clip`
(`src/daemon/daemon.ts:1808-1867`), which mints a clip id (`nextFreeClipId`, unless one already
exists for this track — `existing = primaryClipFor(track, doc)`), snapshots the track's live
content into it via `saveClip`, and slots it into the **first song section's scene** via `setScene`.
This is architecturally the closest dotbeat equivalent to Ableton's "drag a Session clip onto the
Arrangement view-selector button as a drop target" (research 30's mechanism 3) — a one-click "send
this to the arrangement" action rather than a literal drag gesture, which the same research doc
already argued is the right call given dotbeat correctly has no Session grid to drag *out of*.

**Two real, concrete gaps against Ableton's documented model, though:**

1. **No clip naming.** Ableton's clips have a real, renamable name distinct from the file they
   reference (§2, manual p.187) — dotbeat's clips have only an auto-generated `id`
   (`nextFreeClipId`), shown verbatim in both the button's own label (`` `Placed (clip "${existing.id}")` ``,
   `NoteView.tsx:781`) and `ClipPropertiesPanel`'s label (`` `clip "${clip.id}"` ``, line 63). There is
   no rename affordance anywhere in `ui/src/` — confirmed by the fact that `BeatClip` itself
   (`document.ts:544-552`) has no `name` field, only `id`. Auto-generated ids are also generic and
   sequential (`nextFreeClipId`, `src/daemon/daemon.ts:531-536`, produces `clip1`, `clip2`, ...), so
   a user placing several clips on the same track from the GUI sees only `clip1`/`clip2`/`clip3`
   with no way to give them readable names — a small but real usability gap once a project has more
   than one or two clips per track (a hand-authored `.beat` file, or one edited via CLI/MCP, can
   still use a descriptive id like `groove` since `saveClip`/`beat clip` take an arbitrary id
   string — it's specifically the GUI's auto-mint path that's stuck with `clipN`).
2. **No Clip Activator / per-clip mute.** Ableton's Clip Activator toggle (§2, manual p.187, also
   the `0` key) deactivates one clip without touching the track. dotbeat has track-level mute
   (`MixerView.tsx:202,255` — `useStore((s) => !!s.mutes[track.id])`, explicitly **"session-only, not
   saved"**), but nothing at the clip level, and `document.ts` has no `active`/`muted` field on
   `BeatClip` at all. Not urgent (v1 explicitly scoped to one editable clip per track — see below),
   but worth naming as the reason "mute just this clip, not the whole track" currently has no
   answer.

### 8.4 Confirmed-correct, on-purpose scope cuts (not gaps)

- **No launch controls / Follow Actions** (§4). Correctly out of scope — research 18 already ruled
  this out for dotbeat's Arrangement-only target, and this chapter independently confirms Ableton's
  own manual gates the entire Extended Clip Properties panel behind "is this a Session clip,"
  reinforcing that decision rather than contradicting it.
- **Clip time signature is display-only** (§3, manual p.194) — matches `ClipPropertiesPanel.tsx`'s
  own comment exactly: *"clip-level time signature — metadata only for now; the audio engine still
  plays constant-tempo 4/4"* (line 110). This isn't dotbeat falling short of Ableton; it's
  independent convergence on the same "modeled for display, not yet wired to playback" posture —
  worth citing as validation the field is designed correctly, not a stopgap to apologize for.
- **Multi-clip property editing** (§7, manual p.217) is out of scope by dotbeat's own explicit v1
  design ("one editable clip per track... documented there as a deliberate scope cut," per the
  comment at `ClipPropertiesPanel.tsx:16`) — Ableton's multi-select-with-common-properties model is
  real prior art for whenever that scope cut is revisited, not an immediate gap.

### 8.5 Real, unaddressed gaps worth naming even though they're lower priority than 8.1-8.3

- **No Clip Groove / Commit workflow** (§3, manual pp.195-196). dotbeat has no per-clip groove
  concept at all (grep of `document.ts`/`ui/src/` turns up nothing groove-shaped at the clip level)
  — irrelevant until/unless a groove-quantize feature is ever built, but worth knowing Ableton ties
  it specifically to *clips*, not tracks or the document globally.
- **No Scale Mode / scale-aware piano roll highlighting** (§3, manual pp.196-197). `NoteView.tsx`'s
  `buildPitchAxis` (lines 93-119) has no concept of a clip scale, so there's no "highlight in-scale
  keys" affordance the way Ableton's MIDI Note Editor piano ruler does — a real, if optional,
  composition aid absent today.
- **No MIDI transform toolbar** (§5, manual pp.207-210: Fit to Scale, Invert, Add Interval,
  Humanize, Legato, Stretch ×2/÷2). `NoteView.tsx` has hand-drag move/resize/velocity/chance/ratchet
  editing (a genuinely richer *per-note* gesture set than Ableton's own MIDI Note Editor in some
  respects — the chance-paint lane and ratchet glyphs have no direct Ableton Clip View analog at
  all), but no *selection-level* one-click transforms. This dovetails with the still-open "macro
  tooling layer" roadmap item (`docs/research/27-macro-tooling-layer.md`) rather than being a new
  finding — cite as reinforcing evidence, not a fresh ask.
- **Envelope editing lives in a different view than Ableton's model.** Ableton keeps automation
  ("clip envelopes") as one of the Clip View's own editor tabs, alongside the MIDI Note
  Editor/Sample Editor (§1, manual p.192). dotbeat's automation lanes (`BeatAutomationLane`,
  `document.ts:451+`) are edited exclusively from `ArrangementView.tsx` (grep of
  `ui/src/components/*.tsx` for `BeatAutomationLane`/`automation` returns only that file — `NoteView.tsx`
  has none), not from the Clip View equivalent (`NoteView`/`ClipPropertiesPanel`) at all. Not
  necessarily wrong — dotbeat's automation is genuinely clip-scoped already (`clip.automation`,
  `document.ts:548`) and Arrangement-View editing has its own logic (visibility tied to which params
  already have points, `ArrangementView.tsx:1464-1472`) — but it is a real architectural divergence
  from Ableton's "everything about this clip lives under one Clip View roof" model, worth a
  deliberate yes/no rather than an accident of where Phase 22/23 streams happened to land the code.

## 9. Concrete recommendations, ranked by how directly they answer the owner's own three questions

1. **Add a "capture loop end at current playhead" affordance during audition** — the single most
   direct answer to "hear a clip while authoring AND resize it" as one workflow, mirroring manual
   p.194's Set Loop Position/Set Loop Length spontaneous-capture pattern exactly. Concretely: while
   `auditioning` is true (`NoteView.tsx:248`), add a small button next to "■ Stop" that reads the
   live `currentStep` (already tracked, `resolveClipPlayhead`/`useStore((s) => s.currentStep)`,
   lines 202-234, 239) and calls the *same* `setClipLoop`-backed edit path the drag handle already
   uses (`postEdit(`${path}.loop`, ...)`, line 522) with `end = Math.ceil(currentStep / 16)`. Low
   effort — no new state, no new daemon route, reuses `auditionClip`'s own transport and the
   existing loop-edit primitive.
2. **Make the clip-loop start handle drag-resizable, not just the end.** Directly closes the
   asymmetry named in §8.2. The existing `startClipLoopResize`/`onClipLoopPointerMove` gesture
   (lines 483-505) already has all the math needed (`g.origStart`, `g.rect`, `g.stepW`) — the fix is
   rendering a second handle at the *start* of `noteview-cliploop-range` (currently only the end,
   `noteview-cliploop-handle`, is rendered, lines 892-898) and letting it drag `loop.start` down to
   0 with the same clamp-and-preview pattern already written for the end. Whether to also introduce
   Ableton's separate "clip start/end vs. loop region" two-concept model (§3, §8.2) is a bigger
   format change (`BeatClip` would need a second range field) — worth flagging as a real product
   question (does dotbeat ever want pickup-into-loop authoring?) rather than deciding it here, but
   the *drag-both-edges* fix is worth doing regardless of that larger question.
3. **Give clips a real, renamable name distinct from `id`.** A one-line format addition
   (`BeatClip.name?: string`, canonically elided when absent, same discipline D9 already uses for
   every other optional field) plus a text input in `ClipPropertiesPanel.tsx`'s toolbar strip
   (currently just a static `` `clip "${clip.id}"` `` label, line 63) or in the "Placed (clip
   ...)" button's own title. Matches manual p.187's explicit "clip name ≠ referenced file name"
   precedent — for dotbeat, "clip name ≠ clip id" is the same idea, one level down.
4. **Consider a lightweight per-clip mute (Clip Activator equivalent)** once more than one clip per
   track per section becomes common — not urgent under the current one-clip-per-track v1 scope cut,
   but worth remembering `BeatClip` would need an `active`/`muted` field and the engine's
   `contentOf`-style resolution would need to check it.
5. **Lower priority, explicitly not blocking**: Scale Mode + piano-roll key highlighting (§8.5);
   selection-level MIDI transforms (Humanize/Legato/Fit to Scale/Invert) — track under the existing
   macro-tooling-layer research item rather than opening fresh scope here; and a deliberate decision
   (not necessarily a change) on whether envelope/automation editing should eventually move into
   `NoteView`'s own view-mode tabs to match Ableton's "one Clip View, several editor tabs" model,
   versus staying in `ArrangementView` as a track-level concern.

## Sources

Ableton Live 12 Reference Manual, Chapter 8 "Clip View," pp. 185-218 (extracted text read directly
this pass). dotbeat internal, read directly this pass: `ui/src/components/ClipPropertiesPanel.tsx`
(all 152 lines), `ui/src/components/NoteView.tsx` (all 1,304 lines), `src/core/document.ts`
(`BeatClip` lines 544-552, `BeatClipLoop` lines 464-467, `BeatTimeSignature` lines 476-479,
`BeatAutomationLane` line 451+), `src/daemon/daemon.ts` (`/place-clip` route, lines 1808-1867),
`ui/src/audio/engine.ts` (`auditionClip`/`stopAudition`, lines 2924-2950), `ui/src/state/store.ts`
(`auditioningTrackId`, lines 96-101, 144, 170), `ui/src/components/MixerView.tsx` (track mute,
lines 202, 255), `ui/src/components/ArrangementView.tsx` (automation-lane editing, confirmed as the
only component referencing `BeatAutomationLane`). Cross-referenced against
`docs/research/18-ableton-ui-architecture.md` and `docs/research/30-ableton-clip-visualization.md`
(prior Ableton-comparison passes in this repo) rather than re-deriving already-settled scoping
calls (Session View / launch controls out of scope).

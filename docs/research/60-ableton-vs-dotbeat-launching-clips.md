# Research 60 — Ableton Live 12 "Launching Clips" (ch.16) vs. dotbeat: a direct feature/UI comparison

*Follow-up to [`docs/research/41-ableton-launching-clips.md`](41-ableton-launching-clips.md), which
already did the grounded, per-section primer on the manual chapter and checked each mechanism
against dotbeat's current "Preview clip" audition feature. That pass is not repeated here — this
doc's job is different: a direct, structured comparison table plus a decisive, prioritized build
list. Screenshots for pp.345-354 were viewed directly this pass (`/Users/willpatrick/.claude/jobs/
32ed678c/tmp/ableton-images/ch16/p-345.jpg` through `p-354.jpg`) to confirm every claim below
against the actual UI, not just the extracted text.*

## Scope, stated once, not re-litigated

dotbeat has no Session View, no clip-launch grid, no scenes, and no plans to build any of it — an
**already-decided** scope ruling from two prior passes (`docs/research/18-ableton-ui-
architecture.md` line 76-80/462, `docs/research/30-ableton-clip-visualization.md` §0), restated but
not reopened here. The manual's own opening line draws the identical boundary dotbeat already
committed to: *"The clip launch settings only apply to Session View clips, as Arrangement View
clips are not launched but played according to their positions in the Arrangement."* **[manual
p.345]**

What *is* comparable, and is the actual subject of this doc: dotbeat's **"Preview clip" audition
feature** (`ui/src/components/NoteView.tsx:736-751`, `ui/src/audio/engine.ts`'s `auditionClip`/
`stopAudition`, lines 2924-2950) — the one place in dotbeat's Arrangement-only GUI where a single
clip's content is triggered to play on demand, independent of its structural position. That is the
closest functional analog to "launching a clip" that dotbeat has, and it's what every row below is
checked against.

---

## 1. Feature & UI/UX comparison

### a) Shared features / parity

| Concept | Ableton (ch.16) | dotbeat | Note |
|---|---|---|---|
| Single-click clip trigger with start/stop toggle semantics | **Toggle** launch mode: *"down starts the clip; up is ignored. The clip will stop on the next down."* **[manual p.346]** | Preview clip button: one click calls `engine.auditionClip(track.id)` to start; a second click (now showing "■ Stop") calls `engine.stopAudition()` **[dotbeat `NoteView.tsx:745-748`]** | dotbeat's button already implements exactly Ableton's Toggle mode — not Trigger, Gate, or Repeat. That's not an oversight; it's the only one of Ableton's four launch modes that makes sense for a plain mouse click with no held-state input surface (see 1b below). |
| Clip-specific controls live inside the clip's own editor, not a global panel | Clip Launch settings open from a clip's own Clip View, via a dedicated tab **[manual p.345-346]** | The audition button lives in `NoteView.tsx`'s own per-track toolbar, and clip-scoped properties (loop range, time signature) live in `ClipPropertiesPanel.tsx`, docked at the top of the same Clip View | Same underlying UI principle in both tools: per-clip playback/inspector controls are scoped to that clip's own editor surface, not a global transport panel. |
| Probability affecting what plays, at trigger time | Follow Action **Chance A / Chance B** — two percentage sliders that decide which of two configured actions fires when a clip finishes **[manual p.351]** | Per-note **`chance`** field (0-100, default 100), re-rolled via a seeded RNG (`chanceFires`, mulberry32 + FNV-1a) once per playback pass **[dotbeat `src/core/chance.ts`; tooltip `NoteView.tsx:715-716`]** | Real conceptual overlap ("probability decides what the listener hears next") but at different scales and with an opposite reproducibility contract: Ableton's Chance A/B is a live, non-reproducible coin-flip at the *clip* level; dotbeat's `chance` is a seeded, deterministic, `.beat`-file-committed field at the *note* level. Already reasoned through in research 41 §7 — restated here only because it genuinely is the one shared "probability" primitive between the two tools, not a gap in either direction. |
| A clip can be auditioned/previewed without disturbing what else is going on structurally | Launching a Session clip doesn't move the Arrangement playhead or alter song structure | Preview clip explicitly does not touch `playing` — `TransportBar`'s own Play/Stop keeps reflecting the real song transport while an audition runs **[dotbeat `engine.ts:2918-2919`, `2928`]** | Both tools treat "audition a clip" as a side-channel action, orthogonal to whatever the main transport/arrangement state is doing. |

### b) In Ableton, not in dotbeat

Checked item-by-item against dotbeat's actual audition feature (not assumed). The honest answer,
including on the one item the brief specifically flagged (audition-scrub): **seven of eight items
are correctly excluded on strong, tool-specific reasoning — but one, clip scrubbing during
audition, is a real, checkable gap, not a Session-View-only concept, and dotbeat currently has
zero implementation of it inside the audition surface** (confirmed by direct search: zero matches
for `seek`/`scrub` in `NoteView.tsx`). Full detail per item:

1. **Session-grid / clip-slot launching infrastructure itself** (multiple clips per track arranged
   in slots, scene-level launch, the colored Clip Launch button/triangle) **[manual p.345, p.352
   screenshot "Assigning a Follow Action to a Clip Changes Its Clip Launch Button"]** — this is the
   structural mechanic already ruled out at the architecture level (research 18/30); restated, not
   reopened.
2. **Gate launch mode** — *"down starts the clip; up stops the clip"* **[manual p.346]** — a
   held-note/held-button sustain model.
3. **Repeat launch mode** — *"As long as the mouse switch/key is held, the clip is triggered
   repeatedly at the clip quantization rate"* **[manual p.346]**.
4. **Legato Mode** — launching a clip takes over the play position from whatever was playing in
   that track before, instead of restarting from bar 0, so a performer can toggle between loop
   variations without losing sync **[manual p.347]**.
5. **Clip Launch Quantization** — delays a clip's actual start to the next musical grid boundary so
   multiple, independently-triggered clips land in sync **[manual p.348]**.
6. **Velocity Amount** — scales a clip's overall playback volume by the MIDI note-on velocity that
   triggered it, 0% = no effect, 100% = softest notes near-silent **[manual p.349]**.
7. **Clip Offset and Nudging / scrub** — Nudge Backward/Forward buttons jump a *currently-playing*
   clip's position in increments of the global quantization period; in MIDI Map Mode a continuous
   scrub control appears for a rotary encoder **[manual p.349-350, screenshots "Using the Nudge
   Backward/Forward Buttons to Jump Through a Clip" and "The Scrub Control in MIDI Map Mode"]**.
   Checked directly against `NoteView.tsx`: there is no click-to-seek, drag-to-scrub, or nudge
   control anywhere in the grid while an audition is running — you can only listen from bar 0 or
   hit Stop. This is the one item that survives honest scrutiny as a real, non-Session-specific
   gap, not a "doesn't apply here" case — see below.
8. **Follow Actions** (the chapter's largest section, 6 of 12 pages: 10 action types — No Action,
   Stop, Play Again, Previous, Next, First, Last, Any, Other, Jump — with Chance A/B, Linked/
   Unlinked timing, a global enable/disable switch, and six worked compositional recipes)
   **[manual p.351-356]**. §16.7.6's own stated purpose is building structures that "never quite
   play in the same order or musical position" twice — explicitly engineered non-reproducibility.

**The audition-scrub angle, checked honestly (not forced toward Do-not-recreate):** item 7 is
different in kind from items 2-6 and 8. Items 2-6 and 8 all solve problems that only exist because
Ableton clips are triggered by a live performer/controller in real time, with multiple clips
running concurrently and needing to stay in sync — none of that applies to a true-solo,
single-track authoring preview. Item 7, stripped of its *live-performance* framing (deliberately
detuning sync against a live band), reduces to a much more mundane and clearly useful idea:
**"let me jump into the middle of a clip that's currently playing instead of only hearing it from
the top."** That's a plain authoring/QA convenience, not a Session-grid concept, and dotbeat
already has the identical UX pattern shipped elsewhere: `ArrangementView.tsx`'s ruler click calls
`engine.seek(bar)` to relocate playback **[dotbeat `ArrangementView.tsx:1754`, `engine.ts:2897-
2910`]**. `NoteView.tsx`'s own grid already renders bar columns during audition; there is no
technical reason the same click-to-seek pattern couldn't be wired to the same `engine.seek()`
entry point, scoped to the audition's own tiled loop range instead of the song timeline. This is
flagged as buildable, not dismissed.

### c) In dotbeat, not in Ableton

Relative to this specific "launch a clip" domain (not a general feature diff), three things stand
out as places dotbeat's model produces a genuinely different, and in each case more opinionated,
answer than Ableton's chapter offers:

- **True solo, not layered preview, by design.** Session View's whole raison d'être is layering —
  clicking a clip launches it *alongside* whatever else is already running, which is why the
  chapter needs Follow Actions, Quantization, and Legato Mode at all (multiple concurrently-playing
  clips need to be coordinated). dotbeat's audition takes the opposite default: every other track
  is silenced outright for the duration (`content = null`, not just muted) — real isolation, not a
  mix **[dotbeat `engine.ts:3164-3174`]**. This isn't a missing feature, it's a different answer to
  "what does launching a clip mean" that fits an authoring tool rather than a performance
  instrument, and it's *why* items 4/5/8 above are correctly out of scope rather than merely
  unbuilt — there's no second concurrently-playing clip in this model for those features to
  coordinate with.
- **No Session/Arrangement object duality to keep in sync.** In Ableton, a Session clip and an
  Arrangement clip are separate objects; auditioning one doesn't place it, and placing one is a
  distinct drag/drop step. In dotbeat, `NoteView.tsx` edits a track's *live* content directly, the
  same data the audition plays; "Place in Arrangement" (`placeInArrangement()`,
  `NoteView.tsx:542-553`, backed by `saveClip`/`setScene` per `docs/phase-24-stream-ci.md`) snapshots
  that exact already-auditioned content into the song's first section. There is structurally no way
  for what you previewed to differ from what gets placed — no separate object to drift out of sync.
- **A written-into-the-file, reproducible answer to "probability shapes what plays"** — dotbeat's
  per-note `chance` field, already noted in 1(a), is worth restating from this angle: Ableton's
  chapter has no mechanism anywhere that lets probability-driven playback be captured as a
  diffable, re-playable document fact. Every Follow Action outcome is a runtime coin-flip lost the
  moment playback stops. dotbeat's equivalent is a `git diff`-visible line and a seeded RNG, so two
  people (or an agent and a human) opening the same file hear the *same* thing — directly serving
  `ROADMAP.md` §1's core thesis in a way nothing in ch.16 does or is trying to.

---

## 2. Prioritized recommendations

| Feature | Priority | Build recommendation |
|---|---|---|
| Session-grid / clip-slot launching infrastructure (scenes, multi-slot clips, colored launch button) | **Do-not-recreate** | Already-decided scope exclusion (`docs/research/18-ableton-ui-architecture.md`, `docs/research/30-ableton-clip-visualization.md`) — dotbeat is Arrangement-only by product decision, not oversight. Nothing new to add here; this row exists only so the "In Ableton, not in dotbeat" list is complete. |
| Gate launch mode (held-note sustain playback) | **Do-not-recreate** | Solves a live-controller "hold to play" problem. Preview Clip has no held-input surface (a plain mouse click, no MIDI-mapped remote control onto the button) and dotbeat has no plan to add MIDI-controller mapping infrastructure (D14: BYO-Claude-Code over `beat mcp` is the agent surface, not a hardware-control layer). Toggle mode already covers "start it, stop it" cleanly. |
| Repeat launch mode (retrigger while held, at clip quantization rate) | **Do-not-recreate** | Purely a live-performance retriggering effect (stutter-on-hold). No authoring/QA use case for it in a true-solo audition tool, and — like Gate — it presumes a held-input device dotbeat doesn't have and isn't building toward. |
| Legato Mode (launch takes over play-position instead of restarting) | **Do-not-recreate** | Already reasoned through directly (research 41 §3): Legato exists to preserve live-performance sync when toggling between loop variations. dotbeat's audition always restarts from bar 0, which is the *correct* behavior for a deterministic, comparison-oriented authoring tool — a different position every click would make "click Preview" a non-reproducible action, which cuts against the same thesis Follow Actions violate. |
| Clip Launch Quantization (onset-timing correction for multi-clip sync) | **Do-not-recreate** | Solves synchronizing multiple *concurrently* launched clips onto a shared grid. dotbeat's audition is always a true solo (`engine.ts:3164-3174`) — there is never a second simultaneously-playing clip to synchronize against, so the entire justification for the feature doesn't exist in this model. |
| Velocity Amount (MIDI trigger velocity scales clip playback volume) | **Do-not-recreate** | Scales a *trigger event's* velocity; Preview Clip has no MIDI-mapped or velocity-sensitive trigger input at all (plain button click). Distinct from — and not a gap relative to — dotbeat's existing per-*note* velocity field, which already covers "how loud does this specific note sound" at composition time. |
| Clip Offset, Nudging, and scrub (jump/scrub within a currently-playing clip) | **P1** | Build it. Stripped of its live-performance framing this is a plain, low-cost authoring convenience ("skip to bar N of a long clip instead of waiting for the loop or restarting"), and dotbeat already has the exact UX pattern proven and shipped one screen over: reuse `ArrangementView.tsx`'s click-to-seek pattern (`engine.seek(bar)`, `engine.ts:2897-2910`) inside `NoteView.tsx`'s grid, scoped to the audition's own tiled loop range instead of the song timeline. Small, self-contained, no format change, no new engine concept — a follow-up line item, not its own phase. |
| Follow Actions (10 action types, Chance A/B, Linked/Unlinked timing, global enable switch, 6 worked recipes) | **Do-not-recreate** | Two independent reasons, either sufficient alone: (1) defined entirely in terms of "successive slots of the same track" — a Session-grid concept with zero equivalent in dotbeat's linear Arrangement (structural, not just unbuilt); (2) §16.7.6's own stated purpose — build structures that "never quite play in the same order or musical position" twice — is in direct philosophical tension with dotbeat's deterministic, diff-friendly document thesis (`ROADMAP.md` §1, decisions.md D2/D8's reproducibility guarantees). Adding a native Follow-Action-equivalent wouldn't just be redundant, it would actively undermine the guarantee that two people opening the same `.beat` file and pressing play hear the same thing. The one narrow, already-correct echo dotbeat has of the *underlying idea* (probability shaping playback) is the per-note `chance` field, at a deliberately different scale and with the opposite reproducibility contract — see 1(a)/1(c) above; no further action follows from that overlap. |

---

## Sources

Ableton Live 12 Reference Manual, Chapter 16 "Launching Clips," pp.345-356 — text via
`docs/research/41-ableton-launching-clips.md`'s own `pdftotext -layout` extract; screenshots viewed
directly this pass at `/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch16/p-345.jpg`
through `p-354.jpg` (10 of 12 pages, covering every numbered section: 16.1 Launch Controls, 16.2
Launch Modes, 16.3 Legato Mode, 16.4 Clip Launch Quantization, 16.5 Velocity, 16.6 Clip Offset and
Nudging, and the opening two pages of 16.7 Follow Actions including the Follow Action Controls
diagram, the ten-action list, the Enable Follow Actions Globally screenshot, and the first worked
recipe §16.7.1).

dotbeat internal, read directly this pass: `ui/src/components/NoteView.tsx` (Preview clip button
736-751, Place in Arrangement 542-553, chance-lane tooltip 715-716); `ui/src/audio/engine.ts`
(`auditionClip` 2924-2941, `stopAudition` 2946-2950, `auditionTrackId` field 1667, true-solo branch
in `tick()` 3164-3174, `seek()` 2897-2910); `ui/src/components/ArrangementView.tsx` (click-to-seek
call site 1754); `ui/src/components/ClipPropertiesPanel.tsx` (`primaryClipFor` 30-40, panel intro
comment 5-29). Confirmed by direct search: zero matches for `seek`/`scrub` in `NoteView.tsx` (the
audition-scrub gap named above is real, not assumed).

Prior research/decisions relied on, not re-derived: `docs/research/41-ableton-launching-clips.md`
(the primer this doc follows up on); `docs/research/18-ableton-ui-architecture.md` and
`docs/research/30-ableton-clip-visualization.md` (Session-View-out-of-scope rulings);
`docs/decisions.md` D2/D8 (reproducibility/diff-as-the-one-changeset-representation, the basis for
Follow Actions' Do-not-recreate reasoning); `docs/decisions.md` D14 (BYO-Claude-Code, the basis for
ruling out MIDI-controller-mapping-dependent features); `ROADMAP.md` §1 (dotbeat's core thesis);
`docs/phase-24-stream-ch.md` (the audition feature's own design writeup); `docs/phase-24-stream-
ce.md` (the click-to-seek precedent this doc recommends extending); `docs/phase-24-stream-ci.md`
("Place in Arrangement").

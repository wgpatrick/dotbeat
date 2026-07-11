# Research 18 — Ableton Live's UI architecture, as the reference model for dotbeat's Phase 18 GUI redesign

*2026-07-11. Reference-and-translation pass for the Phase 18 frontend redesign. The owner (an
experienced Ableton user) concluded dotbeat's current three-tab layout — separate full-screen
Editor / Arrangement / Mixer views (`docs/phase-13-views.md`) — is the wrong shape, and that
dotbeat should "take all our cues from Ableton and not try to recreate the wheel." Four real
Ableton screenshots were walked through live in the session that commissioned this doc; those
direct observations are folded in below and marked **[observed]**. Everything else is researched
fresh from Ableton's own Live 12 reference manual (primary source) and cited. The deliverable's
centre of gravity is **Part II — the per-concept translation to dotbeat**; Part I is the reference
that makes Part II defensible.*

## How to read this doc

- **[manual]** — confirmed from the official Ableton Live 12 reference manual (URLs in Sources).
  The manual pages were fetched and summarized by a small model, so exact control *names* are
  reliable but I flag anywhere a nuance rests on a single ambiguous summary.
- **[observed]** — seen directly in the owner's real Ableton screenshots this session (captured in
  the commissioning brief); not independently re-derived here.
- **[general]** — well-established Ableton behavior I could not pin to a specific manual page this
  pass (the manual fetch returned nothing usable on it). Treat as lower-confidence; verify against
  a live Ableton before it drives an irreversible decision.
- **dotbeat constraints** are checked against `docs/format-spec.md` (the `.beat` grammar through
  v0.9), `src/core/document.ts` (`SYNTH_FIELDS`, `AUTOMATABLE_SYNTH_PARAMS`), and the current UI
  (`ui/src/components/*`, the three-tab `App.tsx` from `docs/phase-13-views.md`).

---

# Part I — Ableton's UI architecture, systematically

## 0. The single most important finding (frames everything else)

**Ableton is not a set of tabs you navigate between. It is one window with two orthogonal, always-
present regions that toggle *content* rather than swapping *screens*:**

1. a **main area** that is either the Session grid or the **Arrangement timeline** (Tab toggles
   the two — but they are two representations of the *same set*, not two different editors), and
2. a **bottom detail pane** that shows, for the *currently selected track/clip*, either the
   **Clip View** (edit this clip's notes/sample) or the **Device View** (edit this track's
   instrument + effect chain) — toggled by **Shift+Tab** [manual, keyboard-shortcuts]. The two can
   also be *stacked* (Clip View on top of Device View) rather than mutually exclusive [manual,
   clip-view].

This is what the owner's screenshots showed **[observed]**: one continuous screen, arrangement
always visible, a clip/note editor docking at the *bottom* contextually. The correct mental model
for dotbeat is therefore **not** "which of three tabs am I on" but **"the timeline is always
there; the bottom pane follows my selection and I toggle what facet of the selection it shows."**

Two consequences fall straight out for dotbeat:

- **The Session/Arrangement axis does not apply to dotbeat at all.** dotbeat has a `song`/
  `scenes`/`clips` arrangement model (v0.4) but no live clip-launching performance surface and
  explicitly doesn't want one (commissioning brief; `docs/format-spec.md` has no launch/scene-
  trigger grammar). So dotbeat's "main area" is *unconditionally* the Arrangement timeline — the
  Tab toggle collapses to nothing. Everything Session-specific below is **skip** territory.
- **dotbeat's three-tab Editor/Arrangement/Mixer split is the specific anti-pattern to remove.**
  Ableton's equivalent of all three is one screen: Arrangement timeline (≈ dotbeat's Arrangement
  tab) + a bottom detail pane (≈ dotbeat's Editor tab) + a mixer that lives inline in track
  headers with an *optional* dedicated all-strips panel (≈ dotbeat's Mixer tab, demoted from a
  peer screen to an on-demand overlay).

## 1. The view system in full

### Session View vs. Arrangement View [manual]

- **Session View**: a grid — tracks are columns, **scenes** are rows, each cell is a **clip slot**
  holding at most one clip. You **launch** clips in any order for performance/improvisation.
  Session-only concepts, confirmed present only here and absent from Arrangement: clip slots &
  launch buttons, **scenes** and scene-launch, **clip stop buttons**, per-clip **launch
  modes/quantization** and **Follow Actions**, **track status fields** (playing/looping pie-chart
  icon), and "record Session into Arrangement."
- **Arrangement View**: a linear left-to-right timeline. Tracks stack vertically, clips sit in
  track lanes at fixed song positions, a beat-time ruler runs across the top, plus **locators**,
  **time-signature markers**, and a **loop brace**. This is dotbeat's target [observed + manual].

**Confirmed Session-only, do NOT port** (Q2 answered): clip-launch triangles, scenes/scene-launch,
launch quantization, **Follow Actions**, the **Extended Clip Properties "Launch" panel** (the
collapsed "Launch" section the owner saw **[observed]** — the manual confirms this panel is
"Session clips only"), the crossfader-as-performance-tool, and clip **Fade** toggle for audio
(manual: "Session View only"). These are all performance-surface features; dotbeat has no
performance surface.

### Clip View vs. Device View — the bottom-pane toggle (Q1 answered) [manual]

This is the mechanism the brief specifically asked to nail down:

- **Clip View** opens by **double-clicking a clip**, or via the **Clip View Selector**, or
  **Cmd+Option+3** (Mac) / **Ctrl+Alt+3** (Win).
- **Device View** opens by **double-clicking a track's title bar**, or **Cmd+Option+4** /
  **Ctrl+Alt+4**.
- **Shift+Tab** toggles between them; **F12** also toggles [manual, keyboard-shortcuts].
- Critically: when Device View is active, toggling to Clip View **stacks it on top** rather than
  replacing it — you can have both visible, Clip above Device [manual, clip-view]. The pane is
  resizable (drag its top border) and closable (drag to window bottom).

So the answer to "is it a tab pair, a shortcut, or selection-driven?" is **all three, layered**:
selection sets the *default* (double-click a clip → Clip View; double-click a track header →
Device View), a persistent toggle (Shift+Tab) flips the facet, and the two can coexist stacked.
The unifying rule: **the bottom pane always reflects the selected track/clip; you choose whether
you're looking at its *content* (Clip) or its *sound* (Device).**

## 2. Arrangement View anatomy [manual, arrangement-view]

- **Tracks** stack vertically, reorderable by drag. Each track has a fixed **header** (left) and a
  clip lane (right). Clips are dragged to reposition (across time or to another track) and edge-
  dragged to resize. Clips **snap** to the editing grid *and* to objects: other clips' edges,
  locators, time-signature changes.
- **Track height**: an **"Optimize Height"** toggle fits all tracks to the current view; tracks
  **unfold** (expand button) to reveal internal detail (clip contents, waveform, automation).
- **Automation lanes** appear *beneath* a track when **Automation Mode** is on (the toggle above
  the track headers, or press **A**) — see §7. A **"Lock Envelopes"** toggle keeps automation
  pinned to song position vs. to clips when you move things.
- **Navigation**: an **Overview** strip (drag horizontally = scroll, vertically = zoom); the beat-
  time ruler does the same; **Z** zooms into the selection, **X** reverts; **Alt/Opt + wheel**
  zooms selected track height; a **Follow** switch auto-scrolls during playback.
- **Adding tracks**: drag an instrument/device from the browser into the **"Drop Area"** beneath
  the existing tracks — dropping a device *creates the track*. (This is the browser-as-creation
  idiom, §8.)
- **Clip↔editor sync**: selecting a time range inside an arrangement clip makes the Clip View's
  editor zoom to that same range — the bottom pane tracks the timeline selection [manual].

## 3. Track header anatomy & the mixer (Q3, Q4 answered)

### The inline Arrangement track header [manual, mixing + observed]

Ableton's own framing [manual, mixing]: "the mixer is accessible from both Session View and
Arrangement View … both provide identical mixing functionality," and the Arrangement track header
exposes an **inline subset** of the full mixer via its Track Controls. The owner's screenshots
**[observed]** showed, per track header: track name, **input routing** ("All Ins"), track number,
**Solo**, power/**mute** (Track Activator), **"All Channels"** (input channel chooser), **monitor
In/Auto/Off**, volume fader readout, pan, two numeric meter readouts (peak/gain-reduction),
**output routing** ("Main"), inline **Send A/B** buttons, and — expandable below — the automation
parameter picker (§7).

Decoding the routing labels (Q4):

- **"All Ins"** = the track's **input-type** chooser set to accept all available input sources
  (the default "Ext. In / All Ins"); a track can instead take a specific hardware input or another
  track's output ("resampling"/internal routing) [manual, general].
- **"All Channels"** = the **input-channel** sub-chooser: with an input source picked, this
  selects which channel(s) of it feed the track; "All Channels" = don't narrow it [general].
- **Monitor In / Auto / Off** [manual, general]: **In** = always pass input through the track
  (always monitor); **Auto** (default) = monitor only when the track is armed and not playing back
  a recorded clip; **Off** = never monitor the input. For dotbeat, monitoring is a *live-input*
  concept — dotbeat has no live audio input, so this is skip/placeholder territory.
- **Output** ("Main") = where the track's post-mixer signal goes: the Main (master) track by
  default, or a Return, a Group, or a hardware out [manual, general].

### The six core mixer controls [manual, mixing]

Per track, the mixer surfaces exactly six: **Meter** (peak + RMS), **Volume**, **Pan** (Stereo or
Split-Stereo mode), **Track Activator** (mute when off), **Solo** (with "Solo in Place" leaving
returns audible), **Arm** (record-enable). Plus **Sends** to return tracks, and **Crossfade
Assign** (A/B) buttons.

### The dedicated Mixer vs. the inline strip — what the full one adds (Q3) [manual, mixing]

The dedicated Mixer is **the same six controls, but shown as full vertical channel strips for all
tracks side by side**, plus a few things the inline header can't show ergonomically:

- **All tracks' full strips at once** — a true side-by-side mixing console, so you can balance levels
  visually across the whole set rather than one header at a time.
- **The Sends matrix** — every track's sends to every return, in a grid, rather than the two tiny
  A/B buttons inline.
- **Return tracks and the Main track as full strips** at the right edge. **[observed]** the returns
  ("A Reverb", "B Delay") and "Main" also appear as literal rows at the bottom of the Arrangement
  track list — so returns/main are *both* rows in the timeline *and* strips in the mixer; same
  objects, two representations.
- **The crossfader** and its seven curves + per-track A/B assignment (a performance/DJ tool —
  lower relevance to dotbeat).

**When you reach for which** [manual, general]: the inline header strip is for adjusting *one*
track while you're working on its clips/devices (it's right there in context); the dedicated Mixer
is for *balancing the whole set* — a deliberate "step back and mix" mode. They are the same
parameters, never a separate data model.

## 4. Clip View — the bottom detail pane's "content" facet [manual, clip-view + observed]

Three regions [manual]:

1. **Title bar**: clip name, **color selector**, **Clip Activator** toggle. (Audio clips also get
   "Save Default Clip.")
2. **Left property panels** (arranged horizontally or vertically):
   - **Main Clip Properties**: clip **Start/End** (with "Set" buttons), **Loop Position &
     Length**, **Clip Loop** toggle, **time signature**, **Clip Groove chooser** (+ Hot-Swap),
     **Scale Mode** toggle with **Root Note** + **Scale Name** selectors. **[observed]** matches:
     Start/End, Loop, Position/Length, Signature/Groove, a Scale field.
   - **Extended Clip Properties**: **Follow Actions**, launch controls, MIDI program/bank change —
     **Session-only** [manual]. This is the collapsed "Launch" section the owner saw **[observed]**
     — **confirmed Session-specific, skip for dotbeat**.
   - **Pitch & Time Utilities** (MIDI clips): **Transpose** (semitones or scale degrees), **Fit to
     Scale**, **Invert**, **Interval Size** + **Add Interval**, **Stretch** knob with **×2 / /2**,
     **Duration** chooser + **Set Length**, **Humanize Amount**, **Reverse**, **Legato**.
     **[observed]** matches exactly (stretch ×2/÷2, Fit to Scale, Invert, transpose, Grid, Humanize
     %, Reverse, Legato).
   - **Transform and Generate** panels: **MIDI Tools** that transform or generate notes within the
     active scale (the "Transform" section the owner saw but didn't explore **[observed]**). These
     are algorithmic note operations (arp, rhythm, ornament generators) — genuinely new capability,
     not just editing.
3. **Right editor** (context-dependent tabs): **Sample Editor** (audio) OR **MIDI Note Editor /
   Envelope Editor / MPE Editor** (MIDI).

### The MIDI Note Editor (piano roll) [manual + observed]

Notes on a grid against a **piano ruler** down the left edge; when **Scale Mode** is on, keys
belonging to the set scale are highlighted. Non-destructive editing with **velocity**,
**probability**, and quantization. **[observed]**: a clickable piano-key strip (click to
preview/select a pitch), note blocks on a grid, a **velocity sub-lane below**. For a **drum-rack
clip** specifically **[observed]**, the same editor instead lists *all* the kit's pad names as
rows (the full kit inventory, including empty pads) with hit markers along the timeline and the
same velocity sub-lane — this is the Drum Rack's note editor showing named pads instead of pitch
numbers.

**The Envelope Editor tab is the clip-scoped automation surface** — see §7; it's the same idea as
dotbeat's v0.9 clip automation.

## 5. Device View — the bottom pane's "sound" facet [manual, working-with-instruments-and-effects + observed]

- **Devices chain left→right**; "signals in a device chain always travel from left to right"
  [manual]. **[observed]**: instrument first (e.g. "Wub Bass"), then effects in order (e.g.
  "Reverb"), with an empty drop zone at the end; each device is a full panel with its complete
  control surface, all editable in place.
- **Add a device**: double-click it in the browser (adds to selected track, or creates a track),
  or drag it into the Device View / onto a track [manual, §8].
- **Reorder**: drag a device by its **title bar** and drop next to another device — including onto
  a different track [manual].
- **Bypass**: each device has an **Activator** toggle; "turning a device off is like temporarily
  deleting it … the device does not consume CPU" [manual].
- **Hot-Swap** (Q6): press **Q** or the **Hot-Swap Presets** button to link the device to the
  browser and audition/load presets with arrow keys + Enter; **Q/Esc/X** exits [manual]. Sample-
  based devices have a separate **Hot-Swap Sample** button.
- **Device title bar controls** [manual]: Activator, **Expanded View** toggle (show/hide extra
  panels), **Internal Expanded View** (expand an LFO/Envelope-Follower section), **Show Options**
  (context menu), **Hot-Swap Presets**, **Save Preset**. Every stock device also has an **A/B
  compare** pair of parameter states (**P** switches) — note "automation is disabled when switching
  device states" [manual].
- **Presets**: each device is a browser folder of presets; browse with arrows, Enter to load, drag
  to load, **Save Preset** to the User Library, **Save as Default Preset** for a customized default
  [manual].

**[observed]** one stock effect in depth — **Reverb**: Input Filter (Lo/Hi Cut + curve), Early
Reflections (Spin/Amount/Rate/Shape), Diffusion Network (a diffusion-curve graph, Diffusion %,
Scale %), internal Chorus (Amount/Rate), Reflect/Diffuse/Dry-Wet, Predelay, Smooth, Size, Decay,
Freeze, Stereo, Density. Cited here only as a concrete example of the *depth* of a single stock
device panel — dotbeat has nothing like this surface and won't for a long time (its effects are
the fixed `eq*/comp*/distortion*/bitcrush*` insert set baked into `SYNTH_FIELDS`, not swappable
device panels).

## 6. Racks & Macros — the deepest and most consequential subsystem (Q5, Q6) [manual, racks + observed]

This section gets extra weight because the **Macros/Racks decision is the single biggest scoping
call in Part II** and it needs an accurate picture of what Ableton actually does.

### Four rack types [manual]

- **Instrument Rack**: MIDI effects → instrument → audio effects, as parallel **chains**.
- **Drum Rack**: like an Instrument Rack but each chain is triggered by a single assigned MIDI
  note (a pad), plus up to six **return chains** with per-drum send levels.
- **Audio Effect Rack**: audio effects only (usable on MIDI tracks downstream of an instrument).
- **MIDI Effect Rack**: MIDI effects only.

### Chains [manual]

A rack holds **parallel chains**: each chain gets the *same* input, processes it serially through
its own devices, and all chains' outputs sum. (Drum Racks differ: each chain gets only its one
assigned note.) The **Chain List** is the entry point; each chain row shows a **Chain Activator**,
**Solo**, **Hot-Swap**, **volume**, **pan** (+ send levels & MIDI note assignment in Drum Racks).
**Auto Select** highlights chains currently passing signal.

### Zones [manual]

Chains can be filtered by **Key Zones** (which MIDI notes reach the chain — keyboard splits),
**Velocity Zones** (velocity range 1–127), and **Chain Select Zones** (a 0–127 **Chain selector**
that switches chains dynamically). All zones have **fade ranges**. This is how one rack becomes a
multi-sound, velocity-layered, key-split instrument.

### The Drum Rack pad grid [manual + observed]

A grid of **128 MIDI-note pads** (16 visible, shifted in groups of 16 by a left sidebar). Drag a
sample/instrument/effect/preset onto a pad to auto-map it. Empty pads show only their note name;
loaded pads show the chain name + **mute/solo/preview/Hot-Swap**. An **Input/Output section**
(Receive note, Play note, **Choke** groups) and a **Mixer section** (standard controls + send
sliders) per pad. **[observed]** matches: the same named pads as the clip-view lane list, shown as
a clickable grid, each tile with inline Mute/Solo, selecting a pad loads *its own device chain*
into the third panel (waveform, Classic/1-Shot/Slice mode, Gain, Warp, filter, LFO, Fade,
Transpose, Vel<Vel, Volume, and its own "Drop Audio Effects Here" chain).

### Macros — the "front panel" abstraction [manual + observed]

- **Up to 16 Macro knobs** (8 shown by default; selector buttons add/remove) [manual].
- **Map Mode** (the **Map** button): reveals colored parameter overlays and a **Map** button under
  each macro; you click a target parameter, then click a macro's Map button to bind it. The
  **Mapping Browser** lets you set per-mapping **Min/Max** range and invert. One macro can map to
  **many** target parameters, each with its own range [manual]. **[observed]** small dot indicators
  on some macro knobs = "this macro has an active mapping."
- **Rand** button (title bar): randomizes all mapped macro values; context-menu "**Exclude Macro
  from Randomization**" per knob [manual + observed].
- **Macro Variations**: snapshots of the *macro-knob positions only* (not the full device state),
  browsable, with **New** (auto-named) and **Launch** to recall; "Exclude Macro From Variations"
  per knob [manual]. **[observed]**: a browsable list (Default / Fat / Sub Motion), a lightweight
  preset-within-a-preset that only touches macro values.

**The essential nature of a macro** (this is the crux for Part II): a macro is an **indirection
layer**. The knob's value is not itself a sound parameter — it is a *pointer* that, through a
saved mapping table (target param + min/max + invert, possibly several), *derives* the real
parameter values. "Macro Variations" are then snapshots of the indirection layer's inputs, not of
the resolved outputs. Hold onto that — it is exactly what cuts against dotbeat's "every value is
literally in the file" thesis.

## 7. Automation, in full (Q7) [manual, automation-and-editing-envelopes]

- **What's automatable**: "practically all mixer and device controls … including song tempo."
- **Automation Mode**: the toggle above track headers, or **A**. Automated controls show small LED
  indicators.
- **The red line** [observed] is the envelope drawn **over** the clip content in the track's own
  lane — not a separate view. Confirmed by the manual: envelopes display "on top of" the waveform/
  MIDI in the **main automation lane**.
- **Lane choosers** [manual]: a **Device chooser** (track mixer / a specific device / None; LEDs
  show which devices hold automation; "Show Automated Parameters Only" filters) and an
  **Automation Control chooser** (the specific parameter). **[observed]** matches: an expandable
  per-track row showing "<Device> / <Parameter>" (e.g. "808 Drifter / Filter Cutoff", or "Track
  Volume") with +/- to add/remove lanes.
- **Multiple lanes**: an arrow-icon button moves an envelope into its **own dedicated lane below**
  the clip; **Alt/Cmd**+click moves *all* envelopes into separate lanes; left/right arrows fold/
  unfold the stack. So a track can show many parameter lanes stacked at once.
- **Editing**: with Draw Mode off — click a segment or double-click background to add a
  **breakpoint**, click a breakpoint to delete, drag to move; **Alt/Opt**-drag a segment to
  **curve** it, double-click while held to straighten; **Shift** for fine vertical resolution;
  breakpoints snap to grid unless **Alt/Cmd** held. With **Draw Mode** (**B**): paints grid-width
  steps; hold Alt/Cmd for freehand.
- **Overriding & re-enabling**: changing an automated control while not recording **deactivates**
  that automation (LED off); the Control Bar's **Re-Enable Automation** button lights up and
  reactivates it. This is a live-mixing affordance with no dotbeat analog.
- **Clip envelopes vs. arrangement automation**: the **Envelope Editor** tab in Clip View edits
  **clip-scoped** envelopes (which is exactly dotbeat's v0.9 model — automation lives *on a clip*);
  arrangement automation is timeline-scoped and track-based. dotbeat only has the clip-scoped kind
  today (`docs/format-spec.md` v0.9: "clip-scoped only, deliberately").

## 8. Browser / sidebar (Q8) [manual, managing-files-and-sets + observed]

- **Structure**: a left sidebar with **Collections** (color-tagged favorites), **Categories**
  (Sounds, Drums, Instruments, Audio Effects, MIDI Effects, Samples, Grooves, …), and **Places**
  (Current Project, User Library, added folders) [manual].
- **Preview before load**: audition a sample in the browser before committing; preview can be raw
  or warped [manual].
- **Drag-and-drop is the universal creation idiom**: drag a file/device onto a track, into a
  device chain, or into the arrangement Drop Area (which *creates* a track). Double-click also
  loads to the selected/new track [manual].
- **Groove Pool**: grooves saved with the set appear as a folder within the unfolded Set; the
  owner **[observed]** a Groove Pool scoped to the selected clip. Groove = timing/velocity
  template applied to a clip.

## 9. Color coding (Q9) [general — manual fetch returned little]

The manual pages fetched did not surface Live's color rules, so this is lower-confidence
**[general]**, to verify against a live Ableton:

- Every **track** has a color; **clips inherit their track's color** by default but can be
  recolored individually. New tracks/clips get auto-assigned colors from a palette (there's an
  "auto-assign track colors" preference).
- Color is **semantic-ish, not purely decorative**: it's the primary way you visually group
  related material across a busy arrangement (all the drum clips one color, all the vocals
  another), and clip color persists as an identity marker when a clip is duplicated/moved.
- **Group Tracks** (fold multiple tracks into one) get their own color and a folded summary; color
  is how you read group membership at a glance.
- dotbeat already models a per-track color (`track <id> <name> <color hex> <kind>` in the grammar)
  but has **no clip-level color and no group-track concept** — see Part II.

## 10. Keyboard shortcuts & interaction idioms (Q10) [manual, keyboard-shortcuts]

Non-note-editing idioms (note editing is covered by Phase 17 Stream M and not repeated):

| Action | Mac | Win |
|---|---|---|
| Toggle Session/Arrangement | Tab | Tab |
| Toggle Clip/Device View | Shift+Tab (or F12) | Shift+Tab (or F12) |
| Zoom in/out time ruler | + / − | + / − |
| Zoom to selection / revert | Z / X | Z / X |
| Zoom selected track height | Alt+wheel | Alt+wheel |
| Follow playback | Cmd+Shift+F | Ctrl+Shift+F |
| Duplicate | Cmd+D | Ctrl+D |
| Delete / Cut / Copy / Paste | Del / Cmd+X/C/V | Del / Ctrl+X/C/V |
| Insert audio track | Cmd+T | Ctrl+T |
| Insert MIDI track | Cmd+Shift+T | Ctrl+Shift+T |
| Group / Ungroup tracks | Cmd+G / Cmd+Shift+G | Ctrl+G / Ctrl+Shift+G |
| Fold/Unfold tracks | U (or arrows) | U (or arrows) |
| Undo / Redo | Cmd+Z / Cmd+Shift+Z | Ctrl+Z / Ctrl+Y |
| Toggle loop brace | Cmd+L | Ctrl+L |
| Draw (automation/pencil) mode | B | B |
| Automation Mode | A | A |

The overarching idioms: **direct manipulation** (drag the thing itself, don't open a dialog),
**one-window immediacy** (everything's on screen; the pointer does most jobs without a tool
palette), and **selection drives context** (the bottom pane, the mixer focus, the clip editor all
follow the current selection).

## 11. Why Ableton's UI is shaped this way (Q11) [Eric Carl / Ableton, + design writeups]

From **Eric Carl** (Principal Designer at Ableton, 10 years designing Live's instruments/effects —
a credible primary-adjacent source) and corroborating design writeups:

- **Single window on purpose**: "Window management has nothing to do with being a musician." All UI
  in one window; inspiration cited is an **aircraft cockpit** — mission-critical info always
  visible and logically placed, because Live began as *live-performance* software where hunting
  through windows mid-set is unacceptable.
- **Abstraction over skeuomorphism**: "A slider is just a line, a dial is just a curved slider."
  Deliberately *not* mimicking hardware — Bauhaus/Modernist minimalism, "everything reduced to its
  most essential nature," years ahead of the skeuomorphic norm of its era.
- **Immediacy & direct manipulation**: "directly manipulate musical content with the default
  pointer" — minimize tool-switching, minimize friction.
- **Undirected / sandbox**: the "adjacent in space" layout is intentionally open-ended — it
  "affords unexpected uses" and "leaves space for a personal emotional relationship" rather than
  guiding you down one workflow. The "studio as an instrument" idea.
- **Authenticity**: controls should honestly represent how the thing actually works.

**Why this matters for dotbeat's judgment calls**: when dotbeat can't have parity, the principle
to preserve is *immediacy + direct manipulation + selection-driven context in one window*, not the
specific pixels. A flat, abstract, decoration-free control language is also a *good* fit for an
agent-native tool where the file is the real artifact and the UI is a lens onto it — dotbeat can
lean into "the knob is just a view of a number in a text file" without betraying the Ableton
lineage, because Ableton itself already treats the knob as an abstraction, not a physical object.

---

# Part II — Translation to dotbeat (the point of the doc)

For each Ableton concept: **adopt** (build it close to as-is) / **adapt** (take the idea, change
the shape for dotbeat's constraints) / **skip** (don't build it, with the reason). dotbeat's hard
constraints, restated: it is **agent-native** — every visual concept needs a file/CLI
representation, checked against `docs/format-spec.md` and `SYNTH_FIELDS`; it has **no Session View**
and doesn't want one; its **automation is already per-param in the format (v0.9)**; and **Racks/
Macros have no format representation at all** and are the biggest single decision here.

## The overall layout — the redesign's spine

| Ableton concept | Verdict | dotbeat shape |
|---|---|---|
| One window, no view-swapping tabs | **Adopt** | Replace the three-tab Editor/Arrangement/Mixer switcher (`ui/src/App.tsx`, `docs/phase-13-views.md`) with one screen. |
| Always-visible Arrangement timeline as the main area | **Adopt** | dotbeat already has `ArrangementView.tsx` (canvas-per-track, density-LOD) — promote it from "a tab" to the permanent main area. |
| Session View as the alternate main area | **Skip** | dotbeat has no clip-launch performance surface and doesn't want one. The whole Session/Arrangement toggle collapses. |
| Bottom detail pane that follows selection | **Adopt** | The current `EditorView` / `NoteView` / `InstrumentPanel` / `SynthPanel` become the *content* of a docked bottom pane, not a separate screen. |
| Clip View ↔ Device View toggle (Shift+Tab; selection sets default; stackable) | **Adapt** | dotbeat's version: bottom pane toggles **Clip-edit** (notes/hits + clip properties) vs **Sound-edit** (the track's synth params — dotbeat's `SynthPanel`, standing in for Device View). Double-click a clip → Clip-edit; select a track header → Sound-edit; a persistent toggle flips. Stacking is optional polish, not required for v1. |
| Mixer as a dedicated full-screen peer | **Adapt (demote)** | Fold the mixer into **inline track-header controls** (volume/pan/mute/solo/sends) as the primary surface; keep an *optional* dedicated all-strips Mixer as an on-demand overlay/panel, not a peer tab. dotbeat already has `MixerView.tsx` — reuse it as the overlay, not a tab. |

**Most important single takeaway for implementation**: the redesign is primarily a *composition*
change, not a rebuild. dotbeat already has ArrangementView, a note editor, a synth panel, and a
mixer as **separate screens**; Phase 18 is mostly re-parenting them into **one screen with a
selection-driven bottom pane and inline mixer**, plus deleting the tab switcher. That's a much
smaller lift than the screenshots might suggest.

## Clip View (content facet)

| Concept | Verdict | Notes / format check |
|---|---|---|
| Piano roll with piano-key strip, note grid, velocity sub-lane | **Adopt** | dotbeat has `note` lines (v0.2, fractional v0.7) and `NoteView.tsx`. The piano-key preview strip and velocity lane are the main additions. Fully backed by the format. |
| Drum clip editor = all kit pad rows + hit markers + velocity lane | **Adopt** | dotbeat has `hit <id> <lane> <start> <velocity>` (v0.8) and exactly **five fixed lanes** (`kick/snare/clap/hat/openhat`). Show all five as rows (dotbeat's "kit inventory" is small and fixed) — this is *easier* than Ableton because the lane set is fixed, not a 128-pad rack. |
| Clip properties: Start/End, Loop, Position/Length, Signature | **Adapt** | dotbeat clips are `clip <slug>` blocks (v0.4) that snapshot content; clip-level loop/length/signature are **not currently in the grammar**. Adopt the *panel* but only wire the fields the format has; the rest is a format-extension decision, not free. |
| Groove chooser / Groove Pool | **Skip (for v1)** | No groove/timing-template representation in the format. dotbeat has `beat quantize` as an *operation* instead (v0.7) — that's the dotbeat-appropriate substitute; a live groove template is a new subsystem. |
| Scale field (scale-lock notes) | **Adapt** | No `scale` field in the grammar today. Scale-lock is genuinely useful and cheap to add (a per-clip or per-track enum + root note); good candidate for a small format addition. Until then it's a UI-only editing aid (constrain note input), not persisted. |
| Pitch & Time (Transpose, ×2/÷2, Fit to Scale, Invert, Humanize, Reverse, Legato) | **Adapt → operations** | These map cleanly onto dotbeat's "quantize is an operation, not grammar" precedent (v0.7). Implement each as a CLI/MCP edit primitive that rewrites `note`/`hit` lines and produces a normal diff — *not* as clip metadata. This is squarely in dotbeat's wheelhouse. |
| Transform / Generate (algorithmic MIDI tools) | **Skip (for v1)** | Note-generators are a large new capability; defer. If wanted later they're also "operations that emit literal notes," which fits dotbeat well — but out of scope for a layout redesign. |
| Extended "Launch" panel (Follow Actions, launch quant) | **Skip** | Confirmed Session-only. No dotbeat analog, none wanted. |

## Device View (sound facet)

| Concept | Verdict | Notes / format check |
|---|---|---|
| A left→right signal chain of full device panels | **Adapt (heavily simplified)** | dotbeat has **one implicit synth device per track** plus a **fixed insert set** baked into `SYNTH_FIELDS` (`eq*`, `comp*`, `distortion*`, `bitcrush*`, sends). There is no multi-device chain grammar (`format-spec.md` explicitly defers "multi-device chains beyond the built-in insert set"). So dotbeat's "Device View" = the existing `SynthPanel` showing the one synth + its fixed inserts, laid out as a chain-*styled* panel. Do **not** build swappable, reorderable device panels for v1. |
| Device Activator (bypass) toggles | **Adapt** | The fixed inserts have `*Mix` params (0 = effectively bypassed). A per-insert enable toggle is a thin UI over "set mix to 0 / restore," not new grammar. |
| Hot-swap device/preset browser | **Adapt** | dotbeat has **presets as tooling** (`presets/factory.json`, `beat preset`) that emit literal param edits. A hot-swap-style preset browser that applies these is a good fit — it's the same "apply a named bag of edits, get a normal diff" path that already exists. |
| A/B device compare | **Skip (for v1)** | Nice-to-have; no format need (could be a UI-only scratch state). Low priority. |
| Deep stock-effect panels (Reverb, etc.) | **Skip** | dotbeat's effects are fixed scalar inserts, not modeled devices with rich panels. Out of scope indefinitely. |

## Automation

| Concept | Verdict | Notes / format check |
|---|---|---|
| Per-track, per-parameter automation lane with a draggable curve drawn over the clip | **Adopt — "just build it"** | The format is **ready**: v0.9 `auto <track>.<param>` + `point <id> <time> <value>`, `AUTOMATABLE_SYNTH_PARAMS` derived from `SYNTH_FIELDS`, edit primitives (`addAutomationPoint`/`move`/`remove`/`set`) already exist in `src/core/edit.ts`. The UI is the missing half. Build the "<Device>/<Parameter>" picker + inline draggable breakpoint curve over the clip lane. |
| Device chooser + Control chooser (add/remove lanes) | **Adopt** | Maps directly onto `auto` lanes (one per param per clip). The +/- to add/remove a lane = create/delete an `auto` block (which the format already drops when it hits zero points). |
| Multiple stacked lanes per track | **Adopt** | Multiple `auto` blocks per clip already allowed; stacked-lane UI is straightforward. |
| Curved segments (Alt-drag to curve) | **Adapt / defer** | v0.9 is **points only — no interpolation/curve field** (`format-spec.md` defers curve shape). Ship linear-between-points first; curved segments need the deferred `interpolation` column (DAWproject `hold`/`linear`) added to the `point` grammar. Flag as a small, well-scoped format addition. |
| Clip envelopes vs. arrangement (timeline) automation | **Adopt clip-scoped; skip live/timeline** | dotbeat is clip-scoped by design (v0.9). Live/non-clip-track automation is explicitly deferred and would be a separate grammar decision. |
| Re-Enable Automation / override LEDs | **Skip** | Live-mixing affordance; no dotbeat analog (dotbeat edits the file, it doesn't "override then re-enable" a running automation). |

## Track header / mixer

| Concept | Verdict | Notes / format check |
|---|---|---|
| Inline volume / pan / mute / solo in the track header | **Adopt** | `volume`, `pan` exist per synth/instrument track. **Mute/Solo have no format representation** — decide: UI-only transient state (fine, like transport) vs. persisted (needs grammar). Recommend UI-only/transient for solo (it's a monitoring state), and consider a persisted `mute`/enabled flag only if projects need to save it. |
| Sends (A/B) inline | **Adapt** | dotbeat has `sendReverb`/`sendDelay`/`sendMod` scalar fields — a fixed set of built-in sends, not arbitrary return tracks. Show these as the "sends" inline; do **not** build an arbitrary return-track routing matrix. |
| Return tracks + Main as rows in the track list | **Adapt (cosmetic)** | dotbeat's returns are the fixed built-in reverb/delay/mod buses (implied by the send fields), not user-created return tracks. Optionally *show* them as pinned rows for familiarity, but they're not first-class routable tracks. Master/Main is the fixed output. |
| Input routing ("All Ins"/"All Channels"), Monitor In/Auto/Off | **Skip** | Live-input concepts; dotbeat has no live audio input. Omit entirely (don't show dead controls). |
| Dedicated full Mixer (all strips + sends matrix + crossfader) | **Adapt (demote to overlay)** | Keep `MixerView.tsx` as an *optional* all-strips overlay for "step back and balance," not a peer tab. Skip the crossfader (performance/DJ tool, no dotbeat need). |

## Browser / sidebar

| Concept | Verdict | Notes |
|---|---|---|
| Left sidebar browser (sounds/devices/samples), drag-drop to track/chain | **Adopt (scoped)** | dotbeat has media (`beat sample`), presets (`presets/factory.json`), and kits (`presets/kit-*`). A browser over *these* (drag a preset onto a track, a sample onto a drum lane) fits. Drag-to-create-track is a nice idiom to adopt. |
| Preview-before-load | **Adapt** | dotbeat already auditions Freesound previews (`scripts/freesound-cc0.mjs`); browser preview is consistent with that. |
| Collections / color-tagged favorites | **Skip (for v1)** | Library-management polish; defer until there's enough content to organize. |
| Groove Pool | **Skip** | See Clip View — no groove representation. |

## Color coding

| Concept | Verdict | Notes / format check |
|---|---|---|
| Per-track color | **Adopt (already have it)** | `track <id> <name> <color hex> <kind>` — already in grammar and UI. |
| Clips inherit track color / per-clip recolor | **Adapt** | No clip-level color in the grammar (v0.4 `clip <slug>`). Inherit track color in the UI for free; per-clip color is a small optional grammar addition if wanted. |
| Color as group-membership signal | **Skip (for v1)** | Depends on Group Tracks, which dotbeat doesn't have (below). |

## Keyboard shortcuts & idioms

**Adopt the idioms, borrow the specific keys where they don't collide.** Direct manipulation,
selection-drives-context, and one-window immediacy are the load-bearing principles (Part I §11).
Concrete keys worth matching for muscle-memory transfer (experienced Ableton users): `Tab`-family
for pane toggle, `Cmd+D` duplicate, `Z/X` zoom-to-selection, `A` automation mode, `B` draw mode,
`Cmd+L` loop. Phase 17 Stream M already owns note-editing keys — align with it, don't duplicate.

## Group tracks

**Skip (for v1).** No group-track concept in the format; folding N tracks into one is a real new
subsystem (grammar for the grouping + a folded summary render). Not needed for the layout redesign.

---

## The Macros / Racks recommendation (the biggest decision — treated with weight)

**Racks (multi-chain instruments, key/velocity zones, Drum Racks as 128-pad devices): SKIP for
Phase 18, and probably well beyond.** Reasons, concrete:

- dotbeat has **one implicit synth device per track** and a **fixed five-lane drum model**, no
  multi-device chains, no zones, no chain selector — none of it is in the grammar, and
  `format-spec.md` explicitly defers "multi-device chains beyond the built-in insert set." A Rack
  is not one feature; it's an entire nested-document subsystem (chains, zones, per-chain mixers,
  return chains). Building it is out of proportion to a *layout* redesign and would dominate the
  format's whole diff-friendliness story.
- dotbeat's **five fixed drum lanes already are a minimal "drum rack"** — a fixed, named, per-lane
  voice list with per-lane sample assignment (`lane <lane> <sample-id> <gain> <tune>`, v0.5). The
  *clip editor showing all five lanes as rows* (adopted above) already delivers the Drum-Rack-pad-
  list UX the owner liked, without the 128-pad rack machinery. Lean on that, don't rebuild it.

**Macros: ADAPT — but strictly as tooling-that-emits-literal-edits, mirroring the existing preset
decision — do NOT put the macro indirection in the `.beat` file.** This is the careful
recommendation the brief asked for, and the reasoning is the whole point:

- A macro is, in its essential nature (Part I §6), an **indirection layer**: knob value → a saved
  mapping (target param + min/max + invert, possibly several targets) → *derived* parameter values.
  dotbeat's format thesis is the exact opposite: **"literal data, not code — every note and knob
  value stated"** and **"a single-parameter change produces a single-line diff"** (`format-spec.md`
  Goals 1 & the CI invariants). Putting a live macro in the file means the file no longer states
  the cutoff value — it states `macro=0.7` plus a mapping, and the real cutoff is *computed*. That
  breaks "every value is directly in the file," makes a one-knob-move a *non-local* diff (the macro
  line changes but the affected params don't, so the diff no longer shows what actually changed to
  the sound), and forces the renderer/differ to resolve an indirection to know the truth. This is
  precisely the openDAW "opaque address you must walk the schema to resolve" anti-pattern the
  format spec's Open Questions call out as the thing to do *differently*.
- **dotbeat already solved the analogous problem for presets, and macros should copy that
  solution.** `format-spec.md` v0.3: *"Presets are tooling, not grammar. There is no preset
  reference or include in the file — a document always spells out its own sound in full. Applying
  a preset produces a normal edit list and a normal diff."* A **macro is a preset with a
  continuous input.** So the dotbeat-appropriate macro is:
  - A **macro definition lives outside the `.beat` file** — in the tooling library (alongside
    `presets/factory.json`), as `{ name, targets: [{param, min, max, invert}] }`.
  - The **macro knob is a UI/tooling control**, not a stored value. Turning it to `x` computes each
    target's value (`min + x·(max−min)`, inverted as needed) and **writes each target param's real
    value into the file as a normal edit** — one canonical line per affected param, exactly the
    diff you'd get by hand-turning those knobs. The file stays fully literal and diff-clean.
  - "**Macro Variations**" become **named snapshots of macro-knob inputs in the tooling layer**
    (like preset variants), each of which, when applied, emits the resolved literal edits. No new
    file grammar.
  - This costs exactly what the preset decision already costs and accepts: the file doesn't record
    "this value came from a macro," and re-deriving requires the tooling. That trade is already
    ratified in the format's own design; macros inherit it rather than reopening it.
- **The one thing this deliberately does NOT give you is an *automatable* live macro** (a single
  lane that modulates several params at once, as one automation curve). That genuinely requires the
  indirection to be in the file (the macro must persist as a real, addressable parameter with its
  own `auto` lane and a stored mapping). **Recommendation: do not build that for Phase 18.** If it's
  ever wanted, it is a *deliberate, versioned grammar addition* — a `macro` block with an explicit
  mapping table plus, for honesty, the resolved values — designed on its own merits with the same
  "one canonical form / diff-friendly" scrutiny every other grammar addition got, **not** smuggled
  in as part of a UI redesign. Note dotbeat already has a vestigial single `macroValue` scalar in
  `SYNTH_FIELDS` (a plain 0..1 number with no mapping) — that is *not* an Ableton-style macro and
  shouldn't be mistaken for a foothold; a real macro needs the mapping table, which is the part
  that doesn't exist and shouldn't casually be added.

**Net**: macros as **tooling that emits literal edits** = adopt the *ergonomics* Ableton users
love (a curated "front panel" of knobs, variations) while fully preserving dotbeat's literal-file,
clean-diff thesis. Macros as an *in-file indirection layer* = skip, because it directly contradicts
the format's founding goal, and defer any automatable-macro version to a separate, deliberate
format-design pass.

---

## Content taxonomy — Ableton's asset "kinds," and how to reorganize dotbeat's `presets/`

*(Added per owner direction — this drives what the browser sidebar (§8) actually lists and how the
preset-application CLI path is organized going forward.)*

### What Ableton treats as a distinct browsable "kind" [manual sidebar + file-types docs]

The left-sidebar categories observed this session — **Sounds, Drums, Instruments, Audio Effects,
MIDI Effects, Modulators, Grooves, Samples, Tunings, Templates, Packs** — are not arbitrary; each
corresponds to a real underlying asset type with its own file format. The categorization *logic*
(what counts as a distinct kind of thing) is the transferable part; the *file mechanics* (opaque,
often gzipped/binary bundles) are exactly what dotbeat should **not** copy.

| Sidebar category | Underlying file(s) | What it is |
|---|---|---|
| **Sounds** | `.adg` | Instrument-Rack presets — a whole "front panel" preset (instrument + effects + macros) as one draggable thing. The curated top-level "here's a playable sound" layer. |
| **Instruments** | `.adv` (device preset), `.adg` (instrument rack) | A single instrument device + its preset. |
| **Audio Effects** / **MIDI Effects** | `.adv`, `.adg` | Single effect presets and effect-rack presets. |
| **Drums** | `.adg` (Drum Rack) | A Drum Rack preset = a named kit (pads + per-pad chains + macros) as one asset. |
| **Modulators** | `.adv`/`.amxd` | LFO / Shaper / Envelope-Follower devices (see the LFO section below). |
| **Grooves** | `.agr` (single), `.ags` (Groove Pool set) | Timing/velocity "feel" templates applied to clips. |
| **Samples** | `.wav`/`.aif` (+ `.asd` sidecar) | Raw audio. The `.asd` sidecar carries warp/transient/analysis data — *a direct precedent for dotbeat's own `<sample>.json` provenance sidecar convention.* |
| **Tunings** | `.ascl` (Scala-derived) | Micro-tuning tables. |
| **Templates** | `.als` (a Set marked as template) | A starting-point project. |
| **Packs** | `.alp` | A distributable bundle = Set + its content, zipped. dotbeat's git repo + content-addressed `media/` is the diff-friendly analog of a Pack. |
| **(Projects)** | `.als` | Gzipped XML — the working file. dotbeat's `.beat` is the text-native analog. |

The load-bearing insight: **Ableton draws a hard line between a "device preset" (`.adv`, one
device) and a "Rack/Sound preset" (`.adg`, a curated multi-device+macros front panel).** The
`.adg` "Sound" is the thing users actually browse and drop most — a preset that is *more than one
device's worth of settings*, presented as a single named, categorized asset. That two-tier
distinction (raw device settings vs. curated named "Sound") is the piece dotbeat's own preset
organization is missing.

Sources: file-type list from the Ableton-file-types search results (help.ableton.com/… returned
403 on direct fetch, so the specific extensions are corroborated across the DJ TechTools / Sonic
Bloom / Archiveteam results, not a single authoritative page) plus `[general]` for `.asd`/`.ascl`.

### dotbeat's current state — read directly this pass

- **`presets/factory.json`** — 36 presets, but the structure is **flatter and more ad hoc than the
  brief assumed**: each preset has only `{ name, kind: "synth"|"drums", description, params }`.
  There is **no explicit category field** — the "Bass/Lead/Pad/Pluck/Keys/Arp/FX" grouping exists
  *only as a naming convention inside the `name` string* (`deep-sub-bass`, `bright-lead`,
  `lush-pad`, `crystal-pluck`, `e-piano`, `arp-sequence`, `riser-sweep`…). 30 synths + 6 drum
  kits, one undifferentiated list. A browser built on this today would have nothing to group by
  except parsing name prefixes.
- **`presets/kit-*/`** — sample kits (`kit-init`, `kit-audiophob`): five `.wav` files + one
  `.wav.json` provenance sidecar each (`source`, `license`, `preparedAt`, `prep{}`, `sha256`,
  `durationSeconds`). This convention is good and already mirrors Ableton's `.asd`-alongside-sample
  pattern.
- **`presets/sf2/`** — SoundFont banks with the same provenance-sidecar convention.

So dotbeat has three *physically* different preset mechanisms (a JSON param-bag for synth/drum
*shaping*; sample-kit directories; SF2 banks) with no shared taxonomy and no browsable "kind"
metadata beyond `kind: synth|drums`.

### Recommendation — borrow Ableton's categorization logic, keep dotbeat's text/hash mechanics

1. **Introduce an explicit `category` field** on every `factory.json` preset (`bass`, `lead`,
   `pad`, `pluck`, `keys`, `arp`, `fx`, and for drums the kit-genre) instead of encoding it in the
   name. This is the single highest-value change — it turns "parse the name prefix" into real,
   sortable metadata the browser sidebar (§8) can group by directly. Cheap, backward-compatible
   (default from name prefix on migration), and diff-clean (it's literal JSON).
2. **Adopt Ableton's two-tier distinction, dotbeat-appropriately**: dotbeat's `factory.json`
   entries *are* the "device preset" tier (`.adv`-equivalent: a bag of `SYNTH_FIELDS` edits). There
   is no "Sound/`.adg`" tier because there are no racks — and per the Racks recommendation, there
   shouldn't be. **The dotbeat equivalent of an `.adg` "Sound" is a full `.beat` track (or track
   template)** — instrument + its inserts + a representative clip — since dotbeat spells sounds out
   literally rather than bundling devices. Consider a `presets/sounds/*.beat`-fragment tier later
   if curated full-track starting points are wanted; not needed for v1.
3. **Unify the browsable taxonomy** the sidebar exposes as dotbeat's own small, fixed category set,
   mapping onto what the format actually has:
   - **Synth presets** (param-bag, by `category`) — from `factory.json`.
   - **Drum kits** — both the `factory.json` drum-shaping presets *and* the sample-based
     `kit-*/` directories, unified under one "Drums" heading (they're two implementations of the
     same user-facing kind).
   - **Instruments** — the `sf2/` SoundFont banks.
   - **Samples** — individual media files (drag onto a drum lane).
   - **(no Audio/MIDI Effects, Modulators, Grooves, Tunings categories** — dotbeat's effects are
     the fixed insert set, not browsable devices; grooves/tunings aren't modeled. Don't show empty
     categories.)
4. **Keep the mechanics dotbeat already has right**: content-addressed media (`sha256` in the
   `media` block), provenance sidecars, and "presets are tooling that emit literal edits, not
   file references." **Do not** introduce `.adg`-style opaque bundles — the git repo + text `.beat`
   + hashed `media/` *is* dotbeat's Pack/Library story, and it's strictly better for this project's
   diff-friendliness goal than Ableton's binary bundles.
5. **Preset-application CLI stays as-is in spirit** (`beat preset` applies a named param-bag through
   the `beat set` code path → normal diff), just gains category-awareness for listing/filtering.

**Net**: adopt Ableton's *category taxonomy and its device-preset-vs-curated-Sound two-tier idea*;
reject its *file formats* wholesale. The concrete first step is the `category` field on
`factory.json`, which is what makes the new browser sidebar actually organizable.

## LFO depth — Ableton's modulation model vs. dotbeat's hardwired two-LFO model

*(Added per owner direction. Context: dotbeat already ships a **fixed two-LFO model** —
`SYNTH_FIELDS` has `lfoRate/lfoDepth/lfoDest/lfoShape` and `lfo2Rate/lfo2Depth/lfo2Dest`, each with
an **enumerated destination set** (`LFO_DESTS`), rendered in `ui/src/audio/engine.ts` and exposed
in `ui/src/components/SynthPanel.tsx`. The question is whether to evolve toward a flexible
modulation matrix.)*

### Ableton actually has BOTH models — this is the key finding [manual + M4L docs]

- **Fixed, pre-routed LFOs inside effects/instruments** [manual, audio-effect-reference]: Auto
  Filter's LFO modulates *the filter*; Auto Pan modulates *pan*; Delay's LFO modulates *delay time
  and filter freq* via dedicated sliders. These are **hardwired destinations**, exactly dotbeat's
  current model. Waveforms available across these: **Sine, Triangle, Saw, Ramp Up, Ramp Down,
  Square, Wander/Noise, and S&H (sample-and-hold random)**. Rate is dual-mode: **Hz** *or*
  **tempo-synced note divisions** (Synced / Triplet / Dotted / 16th etc.).
- **A free-routing LFO *Modulator* device** [M4L docs, Modulators pack]: the standalone **LFO**
  modulator has a **Map button** — you activate it, click any automatable parameter (device *or*
  mixer), and it becomes a modulation target. **Up to 8 targets** via the Multimap button; each
  mapping has its own range; **Unmap** removes one. Two modes: **Modulation** (offsets the live
  value, which stays user-adjustable) vs. **Remote Control** (drives it absolutely). This *is* a
  flexible modulation matrix — but it ships as a Modulators pack / Max-for-Live device, i.e. an
  *add-on layer above* the core, not baked into every synth.

So Ableton's own answer to "fixed vs. flexible" is **"fixed inside each device, flexible as a
separate routable modulator device on top."** It did not make every instrument's built-in LFO
free-routing; it kept those hardwired and added routing as a distinct, explicit device.

### The format question — a free-routing matrix vs. dotbeat's enumerated destinations

This is a real diff-friendliness question, in the same spirit as the macro-indirection analysis.
dotbeat's current model is **maximally literal**: `lfoDest` is an *enum* (one of `LFO_DESTS`), so
"what does LFO1 modulate" is a single canonical token on one line, and a change is a one-line diff
with no indirection. A free-routing matrix would replace that with something like
`lfoTarget: <param-address>` + `lfoTargetMin`/`lfoTargetMax`/`lfoTargetInvert` per target, and (if
one LFO can hit several targets) a *list* of mappings — which reintroduces exactly the problems the
macro section warned about:

- **Indirection**: the modulation depth on cutoff is no longer readable from the cutoff line; you
  must resolve LFO → target-address → range to know what's happening. That's the openDAW
  "opaque address, walk the schema" anti-pattern the format spec calls out as the thing to avoid.
- **Multi-target = ordered lists = harder diffs**: a per-LFO list of `(target, min, max, invert)`
  mappings is an array — precisely the kind of construct `DELIBERATELY_UNMODELED` and the format's
  "one canonical form" discipline treat with suspicion (ordering, add/remove churn).
- But note a real asymmetry with macros: **LFO routing, unlike a macro, has no "resolved literal
  value" to fall back to** — an LFO is *continuous motion*, not a settable value, so you can't
  express it as "just emit the resolved param edits" the way macros can. If dotbeat wants
  *free-routed* LFO motion at all, the routing genuinely has to live in the file as some form of
  target reference. There's no tooling-only escape hatch here.

### Recommendation — grow the *enumerated* destination set; do not adopt a free-routing matrix (yet)

**The dotbeat-appropriate middle ground is "more LFOs and/or a larger but still-enumerated,
still-single-token destination set," not a free-routing `lfoTarget: string` matrix.** Reasoning:

- The enumerated-`lfoDest` model keeps LFO routing at **one canonical token per LFO** — fully
  literal, one-line diffs, no indirection, no ordered-list churn. That is squarely in the format's
  house style and worth protecting.
- The genuine limitation of the current model isn't "enum vs. free-routing," it's **coverage**: two
  LFOs with fixed *partitioned* destination pools (LFO1 → pitch/cutoff/amp; LFO2 → pan/sends/EQ/
  distortion). If a user wants LFO1 on pan, they can't. **Fix that by (a) widening each LFO's
  allowed destination enum toward the full automatable-param set (`AUTOMATABLE_SYNTH_PARAMS`
  already exists and is derived, not hand-maintained — reuse it as the destination enum), and/or
  (b) adding a third/fourth LFO.** Both are literal, enumerated, diff-clean additions with no new
  indirection — a bigger fixed matrix, not a free one.
- This mirrors what Ableton *actually did for its built-in synths*: kept them enumerated/hardwired
  and pushed genuinely-free routing into a separate opt-in device. If dotbeat ever wants a true
  modulation matrix, treat it — exactly like the automatable-macro case — as a **deliberate,
  versioned grammar addition** (a `mod` block with explicit `source → target` rows, designed with
  full "canonical form / diff" scrutiny), not an incremental widening of the existing LFO fields.
- Also worth adopting cheaply now, independent of routing: **tempo-synced LFO rate** (note
  divisions vs. Hz). The format already lists `lfoSync/lfoSyncRate` in `DELIBERATELY_UNMODELED` —
  this is the "redundant either-or pair" grammar problem flagged there, but it's a well-bounded one
  (a bool + an enum division) and a common, expected LFO feature; a good candidate to promote from
  unmodeled to modeled when LFOs next get attention.

**Net**: keep the literal enumerated-destination model, invest in *coverage* (wider enumerated
target sets via the existing `AUTOMATABLE_SYNTH_PARAMS`, more LFO slots, tempo-sync), and defer any
free-routing `lfoTarget` matrix to a deliberate future grammar pass — because free LFO routing,
unlike macros, *must* live in the file (no resolved-value fallback), so it carries the full
indirection cost with no way to buy it back in tooling.

## Honest gaps & things to verify before implementation

- **Color rules (§9) are [general], not manual-confirmed** — the manual fetch didn't surface Live's
  color-assignment/inheritance behavior. Verify against a live Ableton before copying specifics
  (auto-assign palette, clip-inherits-track default).
- **Exact stacking behavior of Clip-over-Device** is confirmed to exist but the precise resize/
  focus interaction wasn't fully captured; treat the stacked mode as optional polish, and confirm
  the interaction live if it's built.
- **Manual pages were summarized by a small model**, so control *names* are reliable but a few
  fine behavioral nuances (e.g. exact monitor-mode semantics, exact send pre/post-fader points)
  are stated at [general] confidence and flagged inline.
- **Clip-level properties dotbeat lacks** (loop/length/signature/scale/color per clip) are called
  out as *format-extension decisions*, not free UI wins — each is a small grammar addition to
  weigh on its own, not assumed.
- **This doc did not re-derive note-editing interactions** — those are Phase 17 Stream M's domain;
  align, don't duplicate.
- **The Ableton file-type extensions (§ Content taxonomy) come from third-party corroboration**,
  not the official help page (which 403'd on fetch). The categorization *logic* — which is what the
  recommendation rests on — is solid; a specific extension (`.ags` vs `.agr`, `.ascl`) is worth a
  5-second confirm if it ever matters, but nothing in the dotbeat recommendation depends on it.
- **The flexible LFO Modulator is a Max-for-Live / Modulators-pack device, not core built-in** —
  confirmed it exists and has Map/multimap, but the exact target count (stated as 8) and mode
  semantics come from pack/M4L docs summarized by a small model; the *architectural* point (Ableton
  keeps built-in LFOs hardwired and pushes free routing into a separate device) is the robust
  finding, not the exact numbers.

## Sources

- Ableton Live 12 Reference Manual — Arrangement View: https://www.ableton.com/en/live-manual/12/arrangement-view/
- — Clip View: https://www.ableton.com/en/live-manual/12/clip-view/
- — Session View: https://www.ableton.com/en/live-manual/12/session-view/
- — Mixing: https://www.ableton.com/en/live-manual/12/mixing/
- — Instrument, Drum and Effect Racks: https://www.ableton.com/en/live-manual/12/instrument-drum-and-effect-racks/
- — Working with Instruments and Effects: https://www.ableton.com/en/live-manual/12/working-with-instruments-and-effects/
- — Automation and Editing Envelopes: https://www.ableton.com/en/live-manual/12/automation-and-editing-envelopes/
- — Managing Files and Sets (Browser): https://www.ableton.com/en/live-manual/12/managing-files-and-sets/
- — Live Keyboard Shortcuts: https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/
- Eric Carl (Principal Designer, Ableton), "Ableton Live and Designing for Authenticity": https://ericcarl.link/blog/ableton-live-and-designing-for-authenticity/
- Nenad Milošević, Ableton Live redesign case study (design-philosophy corroboration): https://nenadmilosevic.co/ableton-live-redesign/
- Ableton Live-specific file types (help.ableton.com returned 403 on direct fetch; extensions corroborated across): https://help.ableton.com/hc/en-us/articles/209769625-Live-specific-file-types , https://sonicbloom.net/the-guide-to-ableton-live-file-formats/ , http://fileformats.archiveteam.org/wiki/Ableton_Live
- Ableton LFO Modulator (Map mode, multimap, Modulation vs Remote Control) — Live 12 manual Max-for-Live/Modulators + pack docs: https://www.ableton.com/en/live-manual/12/max-for-live-devices/ , https://www.ableton.com/en/packs/modulators/
- Ableton Live 12 Audio Effect Reference (in-effect LFO waveforms + sync): https://www.ableton.com/en/live-manual/12/live-audio-effect-reference/
- dotbeat internal (content taxonomy / LFO): `presets/factory.json` (36 presets, `kind`-only tagging), `presets/kit-*/` (provenance sidecars), `presets/sf2/`, `SYNTH_FIELDS` LFO fields + `LFO_DESTS` + `DELIBERATELY_UNMODELED` (`lfoSync/lfoSyncRate`) in `src/core/document.ts` / `src/core/convert.ts`.
- dotbeat internal: `docs/format-spec.md` (`.beat` grammar v0.2–v0.9), `src/core/document.ts`
  (`SYNTH_FIELDS`, `AUTOMATABLE_SYNTH_PARAMS`), `docs/phase-13-views.md` (current three-tab UI),
  `ui/src/components/*`, and the session's direct Ableton screenshot observations **[observed]**.

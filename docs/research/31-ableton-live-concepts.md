# Research 31 — Ableton Live 12 Reference Manual, chapter 3 "Live Concepts"

*2026-07-12. Owner-commissioned research pass: one of a set of parallel chapter-by-chapter reads
of Ableton's official 999-page Live 12 Reference Manual (`prior_art/`, gitignored, not tracked in
this repo). This pass covers chapter 3, "Live Concepts," manual pp. 33-59 — the extracted text is
`pdftotext -layout` output, read directly, not web-fetched. Research-only: no code was written or
modified.*

## How to read this doc

- **[manual p.NNN]** — a direct claim from the chapter text, cited to the actual printed page
  number (derived from the chapter's own page-break markers in the extracted text: the chapter
  starts at p.33 and each numeric marker in the raw extract is the printed footer page number for
  the content immediately preceding it).
- **[dotbeat]** — read directly from this repo's current source this pass, cited file:line, not
  inferred.
- This chapter is the one the owner specifically flagged as **foundational and cross-cutting**
  rather than feature-specific — it's Ableton's own vocabulary for Session/Arrangement, tracks,
  clips, devices, the mixer, routing, and Live Sets/Projects. Two existing research docs already
  cover large parts of this ground from a different angle:
  [`18-ableton-ui-architecture.md`](18-ableton-ui-architecture.md) (UI layout/navigation, sourced
  from ableton.com's web manual) and [`30-ableton-clip-visualization.md`](30-ableton-clip-visualization.md)
  (clip rendering specifics). Where this chapter overlaps with those, this doc cross-references
  rather than re-deriving; where chapter 3 adds new material those passes didn't cover — the
  Control Bar's actual anatomy, Devices/audio-vs-MIDI-effect structure, Scale Awareness, the
  Mixer's routing/return-track model, Presets and Racks, Automation vs. Clip Envelopes, and Saving/
  Exporting — this doc is the first pass to ground it.

## Why this chapter matters for dotbeat

Chapter 3 is Ableton's own glossary for the concepts every other chapter assumes: what a Set and a
Project are, why Session and Arrangement are "two representations of the same set" rather than two
apps, what a track actually manages (not just clips — signal flow, device chains, recording), the
structural distinction between audio and MIDI, and how Devices/Mixer/Automation/Presets compose. A
project positioning itself as "Ableton-familiar but git-native" (per `ROADMAP.md` §3, §9) needs to
get this vocabulary right at the foundation, not per-feature — a wrong mental model here (e.g.
treating "automation" and "clip envelopes" as the same thing, or a "group track" as pure UI chrome
when Ableton's is a real submixer) will misalign several roadmap items at once rather than one.

---

## 1. The Control Bar — one persistent strip, nine functional clusters

[manual p.33-34] The Control Bar is explicitly organized into nine named sections, always visible,
not a menu you open: **Browser Options**, **Tempo Settings and Metronome** (includes Ableton Link
and **Tempo Follower**), **Scale Settings** (root/scale for the *currently selected clip*, applies
forward to new clips too), **Follow and Arrangement Position** (a toggle plus a position readout —
"Follow" auto-scrolls the timeline to track the playhead), **Transport Controls**, **Automation and
Capture MIDI** (MIDI overdub, arming automation, **re-enabling automation for currently overridden
parameters**, Capture MIDI, Session recording), **Arrangement Loop Settings** (loop + punch in/out),
**MIDI and CPU Settings** (**Draw Mode**, Computer MIDI Keyboard, Key/MIDI map toggles, sample rate,
CPU meter), and the **View Selector** (Session/Arrangement toggle).

[manual p.34] The Status Bar is a second, thinner persistent strip: error/update messages by
default, but it becomes contextual — in the MIDI Note Editor it shows the selected note's location/
pitch/velocity/**probability**, and hovering an Arrangement/Session insert marker shows its precise
location.

## 2. The Browser and Sound Similarity

[manual p.35] The Browser is the single interaction point for the **Core Library** (bundled
sounds), Live Packs, saved presets/samples, devices (built-in and third-party), Ableton Cloud Sets,
Push-stored files, and manually added folders — one browser surface, many content sources.

[manual p.36-37] **Sound Similarity** is a real, named feature, not a marketing gloss: **Similarity
Search** compares a reference file (up to 60s) against the Core+User Library and ranks results
most-to-least similar; **Similar Sample Swapping** uses the same engine to let you replace a sample
inside Drum Rack/Simpler/Drum Sampler with something sonically close. A "Show Similar Files" icon
appears inline next to compatible browser items. [manual p.37] Content must be background-analyzed
first (Core Library ships pre-analyzed; user audio is analyzed in the background with progress shown
in the Status Bar, pausable).

## 3. Live Sets and Live Projects

[manual p.37-38] Terminology worth being precise about: the **document** you edit is a **Live Set**;
it lives inside a **Live Project** — a folder collecting the Set plus its related materials (samples,
etc.). Saving the Project folder is what makes the Set reopenable later via File > Open.

## 4. Arrangement and Session — "two representations of the same set"

[manual p.38] The chapter's own framing: a clip is "a piece of musical material," and Live gives you
two views onto the same clips — **Arrangement** ("a layout of clips along a musical and linear
timeline") and **Session** ("a real-time-oriented 'launching base'" where every clip has its own
launch button and per-clip launch behavior settings). [manual p.39] Toggled via Tab (single window)
or swapped across two windows; **the two views "hold individual collections of clips"** but switching
views during playback affects only the UI, never what's currently playing. [manual p.39] They
"interact in useful ways... connected via tracks" — e.g. improvising with Session clips and recording
the performance into Arrangement.

This is the same big-picture point research 18 §0 already made (Session/Arrangement as one
underlying model, not two apps) and the same territory research 30 covers for clip rendering — this
chapter adds the actual mechanics of how a track decides *which* of the two it's playing (§5 below),
which neither prior pass sourced from the manual directly.

## 5. Tracks: shared, but only one active source per track

[manual p.40] "The Session and Arrangement share the same set of tracks" — Session lays them out in
columns, Arrangement stacks them vertically with time flowing left-to-right. **A track can only play
one clip at a time**, which is *why* clips meant to play as alternatives go in one Session column and
clips meant to play together spread across tracks in a **scene** (a Session row).

[manual p.40] The precedence rule, stated explicitly: **at any moment a track plays either a Session
clip or an Arrangement clip, never both — and Session always wins.** Launching a Session clip stops
whatever Arrangement clip was playing on that track (only that track; other tracks keep playing
Arrangement uninterrupted), and that track's Arrangement playback stays stopped until you explicitly
hit **Back to Arrangement** [manual p.40-41] — a lit button (Session View's Main track, or per-track
in Arrangement View) signaling "one or more tracks aren't playing the Arrangement right now." [manual
p.42] It's also possible to *capture* the current Session performance into Arrangement via the
**Arrangement Record** button from Session View — described explicitly as good for building "multiple
takes for a clip and then put[ting] them together into a composite track."

[manual p.42] Tracks can also be **linked**, to perform the same operation (the example given: a
fade) across multiple tracks simultaneously.

## 6. Audio vs. MIDI — a structural signal-type split, not just a track color

[manual p.43] Live's clearest structural rule: **audio and MIDI are genuinely distinct signal types**
(a continuous-waveform-approximation series of numbers vs. a symbolic command stream, "closer to a
written score than to an audio recording"), and **audio clips cannot be added to MIDI tracks and vice
versa** — the track *kind* gates what clip kind can live on it. An instrument is required to turn
MIDI into audible audio (Simpler = chromatic one-sound-per-key; Impulse = one distinct sound per
key, i.e. drum-map style).

## 7. Audio clips, warping, and MIDI clips

[manual p.44] An audio clip is a **reference** (to a sample/sound file, possibly compressed like MP3)
plus playback instructions (where to start/end, how to play it) — previewable in the browser before
drag-in. [manual p.44-45] **Warping** — independently changing playback speed vs. pitch to match Set
tempo — is Live's signature audio-clip capability; **Auto-Warp** does automatic tempo-alignment even
on irregular material ("a drunken jazz band's performance" is the manual's own example), and extreme
warp settings are explicitly framed as a sound-design tool, not just a sync fix.

[manual p.45-46] A MIDI clip holds notes + controller envelopes; **importing** a MIDI file copies its
data into the Set and stops referencing the original file (unlike audio, which stays reference-based
by default). MIDI content can be added via live recording, **Draw Mode**, **MIDI Tools**, or
audio-to-MIDI conversion.

## 8. Devices: three kinds, gated by track type

[manual p.46-48] A track's device chain lives in the **Device View** (opened by double-clicking the
track header). **Audio effects** are the only device kind valid on an audio track or a return track.
**MIDI tracks additionally accept MIDI effects and instruments** — and the manual's own signal-order
statement (§9 below) makes the chain order explicit: MIDI effects process the note stream first, the
last MIDI effect feeds an instrument (MIDI in, audio out), and *after* the instrument comes any number
of audio effects, exactly as on an audio track. Devices are added by dragging from the Browser into
Device View (or directly onto a track), or by selecting + Enter. VST/AU plug-ins are browsable the
same way, under a dedicated Plug-Ins label [manual p.47].

## 9. Clip View and Device View — one bottom pane, two facets, stackable

[manual p.48] Clip View exposes clip properties (start/end, looping, scale); in Session View it also
exposes extended per-clip behavior (follow actions). Audio clips get warping/transform tools there;
MIDI clips get pitch/time utilities plus MIDI Transformation and **Generative** tools. Device View
lists the track's loaded device chain. [manual p.48] **The two can be stacked** (shown
simultaneously) via triangle toggles, not just toggled exclusively — this is the same mechanism
research 18 §0 already documented from the web manual (Shift+Tab / stacking), now confirmed from the
book manual's own text too.

## 10. Scale Awareness — a real, cross-cutting subsystem, not just a piano-roll option

[manual p.49-51] This section is more load-bearing than dotbeat's roadmap entry currently reflects.
Once **Scale Mode** is enabled for a clip (toggle in the Control Bar or Clip View), the clip becomes
**scale-aware**, with a **Root Note** and **Scale Name** chooser. Scale settings apply to the
currently selected clip, or — if nothing is selected — to *subsequently created* clips (a default-
going-forward semantic, not just a per-clip flag). Inside the MIDI Note Editor, scale-aware mode adds
**two distinct, separately-toggleable options**:

- **Fold to Scale** — collapses the visible pitch rows to *only the scale's own tones* (a music-
  theory filter — every C-major-scale row shown regardless of whether a clip currently uses it).
- **Highlight Scale** — keeps all rows visible but tints in-scale rows purple ("the color that
  signifies scale awareness across Live").

[manual p.50] These are explicitly a **different mechanism from a generic "show only pitches in
use" fold** — that's not named in this chapter at all (it would be the plain "Fold" feature
documented in Live's MIDI-editing chapter, a separate concept keyed to actual note content, not
scale membership). [manual p.50-51] Scale awareness also **propagates**: MIDI Tools and the Pitch and
Time Utilities panel constrain to the active scale; Live's own MIDI effects (**Arpeggiator, Chord,
Pitch, Random, Scale**) each carry a **Use Current Scale** toggle in their title bar, switching their
pitch parameters from semitones to scale degrees; Auto Shift's Quantizer and Meld's oscillators/
filters can independently opt into scale awareness too.

## 11. The Mixer: shared across views, sends/returns, and a many-track crossfader

[manual p.51] Session and Arrangement literally share one mixer (shown/hidden in either view via the
Mixer Config Menu). [manual p.51-52] Controls: **volume, pan, and sends** — a send determines how
much of a track's signal feeds a **return track's** input. **Return tracks hold only effects, never
clips**, and every track can route a send into any return, sharing its effect processing. [manual
p.52] The **crossfader** works like a DJ mixer crossfader but generalizes past two channels — **any
number of tracks (including returns) can be assigned to either side** via per-track Crossfader Assign
buttons.

[manual p.53] For a MIDI track specifically: MIDI effects → instrument (MIDI-in/audio-out) → any
number of audio effects, same as an audio track's chain from that point on. **If a MIDI track has no
instrument (and no audio effects), its mix/send controls disappear from the mixer entirely** — a
track that never produces audio isn't given audio-mixer controls, a clean, literal rule.

## 12. Presets and Racks

[manual p.54] Every device (built-in or plug-in) can save/recall **presets**, stored independently of
the Set — they populate the User Library and are available to *any* project. **Racks** (Instrument,
Drum, Effect) go a level further: they save a **combination of multiple devices and their settings as
one single preset** — e.g. an Instrument Rack bundling an instrument + a chain of effects + macro
mappings as one loadable unit, explicitly framed by the manual as adding "all the capabilities of
Live's MIDI and audio effects to the built-in instruments."

## 13. Routing: the In/Out "patchbay," group tracks, external hardware

[manual p.54-55] Every track's signal source/destination is set in the mixer's **In/Out section** —
Live's own name for it is literally "patchbay." This is what enables resampling, submixing, synth
layering, and complex effect setups. [manual p.55] **A group track is a real submixer** — tracks
folded into a group route their combined signal through the group as one processing point, not just a
UI collapse. Tracks can also be configured to receive input from another track/device inside Live
(not just external hardware), with monitoring controls governing when the input is actually heard.
[manual p.55] External hardware is reached from *inside* a track's device chain via dedicated
**External Audio Effect** and **External Instrument** devices — hardware routing is modeled as a
device in the chain, not a separate subsystem.

## 14. Recording new clips: arm, Arrangement Record, Session Record, quantization

[manual p.55] Recording is per-track, enabled via the **Arm** button (multi-arm via Ctrl/Cmd-click,
or all-selected-tracks-at-once); an **Exclusive Arm** preference auto-arms a new/empty MIDI track the
moment an instrument is inserted into it. With Arrangement Record on, every armed track's input
records straight into Arrangement — **each take yields a new clip per track** (i.e. multiple takes
don't overwrite, they accumulate as separate clips). [manual p.56] **Session Record** is the
alternative: recording directly into a Session slot *without stopping playback* — explicitly framed
for jamming musicians. Clicking Session Record again stops and **launches** the freshly recorded
clip; because this is subject to real-time launch quantization, the result can be auto-cut to the
beat. [manual p.56] The manual's own worked example for this whole mechanism: building a drum pattern
by overdubbing notes onto a looping MIDI clip in real time via Impulse + Session Record + Record
Quantization.

## 15. Automation Envelopes vs. Clip Envelopes — two distinct mechanisms, not one

This is the chapter's most consequential distinction for dotbeat's own automation roadmap gaps, and
it's worth stating precisely because the two are easy to conflate.

- [manual p.57] **Automation** = changes to a mixer/effect control's value over time, tracked as
  **breakpoint envelopes** along the **Arrangement timeline** (or, if recorded with Automation Arm on
  during Session-clip playback, attached to that **Session clip** instead). Recording it is literal:
  any control move while Automation Arm + Arrangement Record are both on becomes automation.
  "Practically all mixer and effect controls" are automatable, including **song tempo itself**.
- [manual p.57] **Manual override semantics, stated explicitly**: touching an automated control
  *without* recording behaves like launching a Session clip mid-Arrangement-playback — it doesn't
  erase the automation, it **deactivates tracking** in favor of the manually-set value, and stays that
  way until you press **Re-Enable Automation** (Control Bar) or launch a Session clip that itself
  carries automation. The underlying envelope data survives the override; only playback obedience to
  it is suspended.
- [manual p.57] **Clip Envelopes** are a separate concept living *inside* a clip, used to automate/
  modulate device and mixer controls **scoped to that clip specifically**. Audio clips get *extra*
  envelope types beyond the shared set (pitch, volume, etc. — enough to "change the melody and rhythm
  of recorded audio"); MIDI clips get extra envelope types for MIDI controller data. **Crucially, clip
  envelopes can be unlinked from the clip's own loop** — given independent loop settings so a longer
  gesture (a fade-out) or a shorter one (an arpeggio pattern) can be superimposed on the clip's
  material without being forced to repeat at the clip's own loop length.

## 16. MIDI and Key Remote

[manual p.57-58] Nearly every mixer/effect control is remote-mappable. **MIDI Map Mode**: click a
target control, then send the MIDI message you want bound (e.g. turn a hardware knob) — mappings take
effect the moment you leave map mode. **Key Map Mode** works identically for computer-keyboard keys,
and covers Session clips, switches, buttons, and radio buttons. [manual p.58] A structural rule worth
noting: MIDI messages consumed by a mapping are **filtered out before reaching MIDI tracks** — a
mapped controller knob can't simultaneously record as note/CC data. Session clips specifically can
also be mapped to a full keyboard *range* for chromatic triggering, not just a single key. Dedicated
Push 1/2/3 support exists alongside the general-purpose mapping system.

## 17. Saving and Exporting

[manual p.58] Saving a Set saves everything — clips, positions, settings, device/control state. An
audio clip's sample reference can go stale if the file moves/is deleted; **Collect All and Save**
fixes this by copying every referenced sample into the Project folder alongside the Set, making
references self-contained. [manual p.58] A **separate per-clip Save button** in an audio clip's title
bar persists a set of *default clip settings* (notably warp settings) tied to that specific sample, so
future drag-ins of the same sample auto-load with those settings.

[manual p.58-59] Export options: **Export Audio/Video** (from either view) renders the Main output;
individual **MIDI clips export as standalone MIDI files**. The most structurally interesting export
mechanism is the **Live Clip** format: a Session clip dragged out to the User Library becomes a
portable `.alc`-style asset that bundles **not just the clip's own Clip View settings but the
originating track's full instrument + effect chain** — reloading one anywhere restores original
envelopes and device settings intact. The manual's own suggested uses: a MIDI drum pattern bundled
with its Impulse+FX settings, multiple regions/loops referencing one source file, warp-marker/
envelope/effect variations of one loop, and a general "ideas that don't fit this project yet" library.

---

## Relevance to dotbeat

### Confirmations — places dotbeat's current model already matches Ableton's, worth knowing explicitly

- **The audio/MIDI structural split (§6) is already correctly enforced.** `TrackKind = 'synth' |
  'drums' | 'instrument' | 'audio'` [`src/core/document.ts:8`] keeps note-producing track kinds
  (synth/drums/instrument — Ableton's "MIDI track" umbrella) structurally separate from `'audio'`,
  and research 30 independently confirmed the GUI enforces this (audio-clip drag-drop is gated
  `track.kind === 'audio'`). No action needed — this is validated as the right model, not a gap.
- **The one-clip-per-track precedence rule (§5) is moot by design, correctly.** Ableton's whole
  Session/Arrangement precedence mechanism (§5) exists because Session is a live-performance surface
  that can preempt Arrangement mid-playback. `docs/research/18-ableton-ui-architecture.md` already
  concluded dotbeat should not build a Session-style clip-launch grid, and `docs/decisions.md`/the
  roadmap never queue one. Chapter 3 doesn't surface anything that should reopen that call — if
  anything it *reinforces* it: the precedence machinery is real complexity (Back to Arrangement
  buttons at two granularities, a whole "which source is a track currently obeying" state machine)
  that a Session-less design correctly sidesteps entirely.
- **Content-addressed, reference-based audio media (§17's "Collect All and Save" problem) is already
  solved more robustly.** Ableton's sample-reference-goes-stale failure mode (a real, named problem
  the manual dedicates a whole command to fixing) doesn't exist in dotbeat's model: `ROADMAP.md` §4
  notes media is content-addressed by SHA-256, and `docs/decisions.md` D11 has every preset/sample
  provenance-tracked via git-lfs with sha256 verification. Worth stating in any Ableton-comparison
  materials as a genuine, sourced advantage, not just an assumption.

### Gaps chapter 3 sharpens or newly surfaces

1. **Scale Awareness (§10) is more work than the roadmap's one-line description implies — and it has
   a real internal dependency worth sequencing on.** `docs/product-roadmap.md`'s "Scale-lock field +
   scale-tone highlighting" row is Not Started, `❌` on all three layers, and no scale field exists
   anywhere in `src/core/document.ts` (confirmed by grep this pass — zero matches). Chapter 3 shows
   the real shape: a root note + scale name pair that's clip-scoped (or track-scoped) but **also
   propagates forward** as a "sticky default for newly created clips," plus two genuinely distinct
   presentation modes (**Highlight Scale** = tint in-scale rows, **Fold to Scale** = hide out-of-scale
   rows entirely) that are *both* gated behind scale data existing at all. **Concrete recommendation**:
   don't treat "Scale-lock field" and "Fold mode" (`docs/product-roadmap.md`'s separate Note editing
   row, also Not Started, described as "collapse to only pitches actually in use, like Ableton's
   Fold") as unrelated backlog items — chapter 3 confirms Ableton itself has two different fold
   mechanisms (generic Fold = fold to notes-in-use, requires no scale data; **Fold to Scale** = fold
   to scale-members, requires Scale Mode). If dotbeat builds a piano-roll fold at all, scope it as
   "generic fold" first (cheaper, no format change) and treat "fold to scale" as a natural follow-on
   once the scale field lands, not a duplicate feature.

2. **The Instrument-track FX chain gap (roadmap: "EQ/compression/sends per instrument track — today
   it's level/pan only," Not Started) is exactly what Ableton's device-chain rule requires, not an
   optional nicety.** §8/§11 state the rule plainly: a MIDI track's chain is MIDI effects → instrument
   → **any number of audio effects**, same as an audio track from that point forward — Ableton doesn't
   treat "instrument track" as a special case that stops at level/pan. Dotbeat's synth/drum tracks
   already have the full reorderable effect chain (`docs/product-roadmap.md`'s "Ordered, reorderable
   per-track effect chain" row, Done); instrument tracks are the one track kind still missing it. This
   chapter is a direct, sourced argument for prioritizing that gap over other Not Started rows in the
   same area, since it's the one place dotbeat's current model visibly deviates from Ableton's own
   stated device-chain rule rather than just being incomplete.

3. **The shared reverb/delay send buses are architecturally close to Ableton's return tracks (§11)
   but not exposed as return tracks.** `ui/src/audio/engine.ts:1711-1712,1760-1771` builds exactly
   two lazy, fixed `Tone.Reverb`/`Tone.FeedbackDelay` buses (`reverbBus`/`delayBus`) that every
   track's `sendReverb`/`sendDelay` (`src/core/document.ts:386-387`) feeds into by a 0..1 amount — the
   send-to-shared-bus *mechanism* is right, matching §11's "all tracks can feed a part of their signal
   into a return track and share its effects." What's missing relative to Ableton's model: **return
   tracks are user-visible, user-addable, and hold an arbitrary effect chain** — dotbeat's two buses
   are hardcoded (fixed reverb decay/wet, fixed delay time/feedback/wet), not user-created, not
   independently processable beyond those two presets, and invisible in the mixer as their own
   channel. Not necessarily worth building a full N-return-track system for a solo-producer tool, but
   worth flagging as the honest gap if "shared reverb/delay send" is ever described as "return tracks"
   in product materials — it isn't one yet, structurally.
4. **Group tracks are currently pure UI fold, not a real submixer — Ableton's routing chapter treats
   grouping as a signal-flow feature, not a layout feature.** `docs/product-roadmap.md`'s "Group
   tracks" row (Done) describes dotbeat's implementation explicitly as "a flat, named, colored
   membership list... Collapsed/expanded is deliberately UI-only session state... never written to the
   file" — a visual fold, no shared gain stage or shared effect processing. §13's "tracks can also be
   combined into a group track which serves as a submixer for the selected tracks" [manual p.55] is a
   different, stronger claim: member tracks' audio actually sums through the group before the master.
   This is fine as a deliberate, documented scope choice (mirrors the mute/solo "session state, not
   composition data" precedent already established for other UI-only concepts per
   `docs/product-roadmap.md`'s Mixer section), but worth being precise about in any Ableton-parity
   claims: dotbeat's "group" is Ableton's *track-list organization* feature, not Ableton's *submix
   bus* feature. If group-level gain/FX (a true submix) is ever wanted, it's a new feature, not a
   trivial extension of the existing fold.
5. **Automation vs. Clip Envelopes (§15) is a real conceptual split dotbeat's format currently
   doesn't have, and it's directly relevant to two open roadmap rows.** dotbeat's automation today is
   uniformly clip-scoped (`docs/product-roadmap.md`'s Automation section: "Pick a track/param, draw
   breakpoints... Automation is currently scoped to one clip at a time — support more than one clip on
   the same track," Not Started) — there's no equivalent of Ableton's *timeline-level* automation
   (Arrangement-position-keyed, independent of any one clip) at all, only the clip-envelope half of
   Ableton's two-tier model. Two concrete, sourced takeaways: (a) Ableton's clip envelopes can be
   **unlinked from the clip's own loop length** [manual p.57] — worth reusing as the design precedent
   when dotbeat's clip-level loop override (`docs/product-roadmap.md`'s "Clip-level loop/length/
   time-signature properties," shipped Phase 24 Stream CJ) and per-clip automation eventually need to
   interact, since Ableton already solved "what happens when the automation's natural length and the
   clip's loop length disagree." (b) The **manual-override-doesn't-erase-automation** semantic
   (§15, touching an automated control suspends tracking rather than destroying the envelope, until
   Re-Enable Automation) has no equivalent in dotbeat's automation model at all today — worth a design
   note for whenever dotbeat's automation UI grows a "live record while playing" mode, since silently
   overwriting drawn automation on the first knob-touch would be a worse UX than what Ableton
   converged on.
6. **A note-transform ("MIDI effect") layer is a real Ableton concept dotbeat has no equivalent
   surface for — and it's compatible with D1, not excluded by it.** §8 names MIDI effects
   (Arpeggiator, Chord, Pitch, Random, Scale, all §10's scale-aware) as a distinct device class that
   transforms the note stream *before* it reaches an instrument, live and removable — different in
   kind from dotbeat's current "Humanize"/pitch-time operations
   (`docs/product-roadmap.md`'s "Pitch & Time operations" row), which are one-shot edit primitives
   that permanently rewrite note lines (`src/core/pitchtime.ts`), not standing, toggleable devices.
   This is worth flagging as a genuinely new idea rather than musing: `docs/decisions.md` D1
   (document-only, no generator-code layer) is often read as blocking anything "generative," but
   dotbeat's own `groove.ts` (`shuffleAmount`/`shuffleGrid` literal fields, warped at
   read/playback time via `warpStep()`/`unwarpStep()`, never baked into stored note data — see
   `docs/product-roadmap.md`'s Groove row) is proof the pattern already exists and fits D1 cleanly: a
   literal parameter in the file, interpreted deterministically at playback, with an explicit
   "consolidate to bake it in" escape hatch (`beat consolidate`, already shipped for ratchets per the
   Note ratchet row). An arpeggiator-as-effect (literal rate/pattern/octave-range params, applied at
   scheduling time, same escape-hatch-to-literal-notes precedent) is a plausible, D1-compatible future
   feature — not scoped or requested, but worth naming as a legitimate design direction distinct from
   the "generator code" non-goal, the next time the FX-arsenal or LFO/modulation backlog gets
   revisited.
7. **No crossfader, no In/Out routing matrix, no MIDI/Key remote-mapping surface exist anywhere in
   dotbeat today** (confirmed: no match for crossfade/routing/group-as-submixer controls in
   `ui/src/components/MixerView.tsx`, no MIDI-map mode anywhere in the codebase this pass). None of
   these are flagged as gaps in the current roadmap, and this pass doesn't recommend adding them
   speculatively — they're DJ-performance (crossfader) and external-hardware (MIDI Map, external
   audio/instrument routing) features that don't obviously serve dotbeat's stated agent-native/
   git-native production niche (`ROADMAP.md` §3). Worth naming only so a future MIDI-controller-support
   ask (a real possibility once the Tauri native tier lands, per M4) isn't scoped from zero — §16 gives
   the exact mechanism (generic MIDI Map Mode: bind any control to any incoming CC/note; a distinct
   Key Map Mode for computer-keyboard keys) to reference if that day comes.
8. **Presets vs. Racks (§12) — dotbeat's presets are Ableton's single-device presets; Racks are the
   next tier up, and dotbeat's Macro tooling layer research already independently converged on
   roughly that shape.** dotbeat's 36 presets + `presets/factory.json` (`docs/product-roadmap.md`'s
   Preset/content library section) are single-device-equivalent (one synth's or one drum kit's param
   bundle) — matching the *preset* half of §12, not the *Rack* half (multi-device bundle + macro
   mapping as one saved unit). The **Macro tooling layer** row (`docs/research/27-macro-tooling-layer.md`,
   Not Started) is already scoped as "a curated front panel of knobs mapped to real params" — almost
   exactly Ableton's Rack Macro-knob concept, just narrower (today: one device's params, not a
   multi-device chain). No action needed now, but worth noting explicitly for whoever picks up
   research 27's build: once the reorderable per-track effect chain (shipped) and instrument-track FX
   chain (recommendation #2 above) both exist, generalizing macros to map across an entire *chain*
   (synth + its inserts), not just one device's fields, is the Ableton-validated next step — sequence
   it after #2, not before.

---

## Sources

Ableton Live 12 Reference Manual, chapter 3 "Live Concepts," pp. 33-59 (`prior_art/`, gitignored,
extracted this pass as `pdftotext -layout` plain text). dotbeat internal (read directly this pass):
`docs/product-roadmap.md`; `docs/decisions.md` (D1, D11); `ROADMAP.md` (§3, §4, §9);
`src/core/document.ts` (`TrackKind` line 8, `sendReverb`/`sendDelay` lines 386-387);
`ui/src/audio/engine.ts` (`reverbBus`/`delayBus`, lines 1711-1712, 1760-1771);
`ui/src/components/TransportBar.tsx`; `ui/src/components/MixerView.tsx`;
`docs/research/18-ableton-ui-architecture.md`; `docs/research/30-ableton-clip-visualization.md`
(both cross-referenced rather than re-derived, per §0 above).

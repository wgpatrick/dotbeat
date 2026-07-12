# Research 47 — Ableton Live 12 Manual, Ch. 26 "Clip Envelopes": what dotbeat's clip automation already has and what it's missing

*2026-07-12. Research-only pass, one of a parallel set mining the official Ableton Live 12
Reference Manual chapter-by-chapter for ideas/gaps relevant to dotbeat's own design and roadmap.
Source: `prior_art/ableton-chapters/ch26.txt` (raw `pdftotext -layout` extract, manual pp. 494-506,
gitignored, not tracked in this repo). No code was written or modified.*

## How to read this doc

- **[manual p.NNN]** — a claim read directly from the extracted chapter text, cited to the actual
  printed page number (the extract's own page-footer numbers, confirmed to run 494→506 matching
  the chapter's stated range).
- Claims about dotbeat's own code are cited with exact `file:line`, read directly from `main` this
  pass, not assumed from other docs' prose.

## 0. Scope: how this differs from track automation (chapter 25, sibling doc)

Ableton draws a hard line between two automation surfaces that look similar but aren't:
**Arrangement-track automation lanes** (chapter 25 — one continuous curve per parameter, drawn
against absolute song time, living on the track itself) and **clip envelopes** (this chapter — one
curve per parameter, scoped to a single clip's own internal time, redrawn/retimed every time that
clip plays). The manual is explicit that these aren't just two views of the same data: "in the
Arrangement, clips only have modulation envelopes, while the automation envelopes reside on the
track's automation lane" **[manual p.499]** — a clip dropped into Arrangement View loses its
Session-only "Automation" toggle entirely and keeps only "Modulation" **[manual p.495]**.

dotbeat, as it stands today, only has the second of these two Ableton surfaces. `BeatClip.automation:
BeatAutomationLane[]` (`src/core/document.ts:548`) is explicitly, deliberately clip-scoped —
"automation lives on a `BeatClip`, never on a live/non-clip track" (`docs/format-spec.md:399`) —
and there is no separate track-level/arrangement-scoped automation lane anywhere in the format.
So everything in dotbeat's existing "Automation" feature area
(`docs/product-roadmap.md`'s Automation section, `phase-20-automation-lanes.md`) is, in Ableton's
own vocabulary, **clip envelopes**, not track automation. That makes this chapter dotbeat's most
directly applicable Ableton chapter of the pair — and it also means the "does dotbeat need a
genuinely separate Arrangement-track automation lane, decoupled from any one clip" question is a
real, live one this doc surfaces but leaves for chapter 25's own pass to answer, per that doc's own
scope.

Why this matters for dotbeat specifically: clip envelopes are the part of Ableton's automation
model that's cheapest to represent as literal, diff-friendly text (a handful of `(time, value)`
points scoped to one clip, exactly the shape D9's elision discipline already likes) and dotbeat has
already independently converged on almost the same design (v0.9, `phase-9-automation-plan.md`).
This chapter is therefore less "here's a feature to bolt on" and more "here's the mature version of
a system dotbeat already half-built — where does the mature version diverge, and is the divergence
deliberate or an oversight."

## 1. The Envelope Editor: choosers, LEDs, and the Automation/Modulation split

**Two nested pickers, not one.** The Clip View's Envelopes tab has a **Device chooser** (which
general category of controls — for audio clips: "Clip" (sample controls), every effect in the
track's device chain, and the mixer; for MIDI clips: "MIDI Ctrl", every device, and the mixer) and a
**Control chooser** next to it (which specific parameter within that category) **[manual p.494]**.
Both choosers show an **LED next to any entry that already has an altered envelope**, and either
chooser can be filtered to "Only show adjusted envelopes" **[manual p.494-495]** — the whole
picker is designed around discoverability of *what's already automated*, not just *what could be*.

**Automation vs. Modulation is the load-bearing distinction of the whole chapter.** For a *Session*
clip, two toggles sit below the choosers: Automation and Modulation **[manual p.495]**. These are
not two names for the same mechanism:

- **Automation envelopes define the absolute value** of a control at any point in time — drawing
  one *is* setting the knob, moment to moment.
- **Modulation envelopes can only influence an already-defined value**, relative to whatever the
  physical knob/fader is currently set to **[manual p.498]**.

The manual spells out why this split exists with a worked example: volume automated to fade out
over 4 bars, plus a *modulation* envelope that ramps volume up over the same 4 bars — the two don't
fight or silently overwrite each other; the fade-out is temporarily masked by the modulation's
upward pull, then reasserts itself as the automation's falling absolute value drags the operable
modulation range down with it, so "the two types of envelopes work together in harmony" **[manual
p.498]**. Visually: automation envelopes and their LEDs are **red**; modulation envelopes and their
LEDs are **blue**; a knob shows automation as the needle's absolute position, and modulation as a
blue arc/segment on the ring layered on top of it **[manual p.498-499]**. A single parameter can
carry both a red LED and a blue LED at once **[manual p.499]**.

**Drawing/editing mechanics are shared with Arrangement automation** — the manual explicitly says
so **[manual p.495]** — Draw Mode (paints discrete stepped values along the grid, fast) vs.
breakpoint/line-segment mode (deactivate Draw Mode; drag points and displace them horizontally to
smooth coarse steps) **[manual p.496]**, `Shift`-modified fine-resolution dragging **[manual p.496]**,
right-click/`Ctrl`+`Backspace` (`Cmd`+`Delete` on Mac) "Clear Envelope" to reset a parameter's
envelope to its default in one action **[manual p.495]**.

## 2. Audio clip envelopes: Clip Gain, Transposition, Sample Offset

Three specific "Clip" (sample-controls) envelope targets get their own worked examples, and all
three share a property the manual calls out explicitly: **non-destructive, real-time-calculated
modulation of the same underlying sample — hundreds of clips can share one sample file and all
sound different** **[manual p.495]**. (Baking a shape in permanently is a separate, deliberate
step: render, resample, or Arrangement View's Consolidate command **[manual p.495]**.)

- **Transposition** — pitch envelope, drawn in semitones. The manual is precise about the
  *combination* rule: "pitch is modulated in an additive way. The output of the transposition
  envelope is simply added to the Transpose control's value. The result... is clipped to stay in
  the available range (-48..48 semitones)" **[manual p.496]**. Warp settings (grain size in
  Tones/Texture mode, granulation resolution in Beats mode) determine how tightly the audio engine
  tracks a fast-moving envelope shape **[manual p.496]**.
- **Gain** — a volume envelope, but critically **relative, not absolute**: "the volume envelope's
  output is interpreted as a relative percentage of the Clip Gain slider's current value. The
  result... can therefore never exceed the absolute volume setting, but the clip envelope can drag
  the audible volume down to silence" **[manual p.497]**. This is the modulation-style combination
  rule again, applied to the specific case most producers reach for first.
- **Sample Offset ("scrambling beats")** — only available in Beats Warp Mode, and conceptually the
  most novel of the three: imagine a tape head reading the sample, and the envelope moves that
  head's read position forward or back in time. "A vertical grid line is worth a sixteenth note of
  offset and the modulation can reach from plus eight sixteenths to minus eight sixteenths"
  **[manual p.497]**. Named gestures with characteristic musical results: a downward "escalator"
  shape repeats the step at the envelope's start (stutter/glitch); a smooth downward ramp not quite
  at 45° slows/slurs time, especially effective at fine (1/32) granulation resolution **[manual
  p.497-498]**. The manual explicitly frames this as a *creative* tool for beat-loop variation, not
  a substitute for precise cut/splice editing (which it says belongs in Arrangement View, then
  consolidated back to a new clip) **[manual p.497]**.
- **Using clips as templates** — dragging a different sample onto an already-envelope-laden clip
  in Clip View replaces only the underlying audio; every clip setting including all envelopes
  survives unchanged **[manual p.498]**.

## 3. Mixer and device clip envelopes: the same absolute/relative split, applied everywhere

Section 26.3 generalizes the Clip Gain pattern (§2 above) to every mixer and device control a
track's clips can reach, and each specific target has its own relative-combination rule worth
naming precisely, because dotbeat's own recommendations below hinge on exactly these rules:

- **Volume/Sends**: relative percentage of the current fader/knob position; a small dot below the
  mixer's Volume slider thumb tracks the actual *modulated* value live as you move the fader
  **[manual p.500]**; a Send's modulation "cannot open the send further than the Send knob, but it
  can reduce the actual send value to minus infinite dB" **[manual p.501]** — note there are
  *two separate* volume-modulation targets, **Clip Gain** (pre-effects) and **Track Volume**
  (post-effects, the mixer gain stage) **[manual p.500]**.
- **Pan**: relative, but the *amount* of relative range available depends on the physical knob's
  own position — centered, the envelope can swing hard-left to hard-right; panned hard to one side
  already, the envelope has zero remaining room to modulate **[manual p.502]**. A geometrically
  interesting rule with no dotbeat equivalent today.
- **Device controls**: same relative-offset principle — "unlike a device preset, the clip envelope
  cannot define the values for the devices' controls, it can only change them relative to their
  current setting" **[manual p.502]**.

## 4. MIDI controller clip envelopes

A MIDI clip's Device chooser gets a "MIDI Ctrl" entry exposing raw MIDI CC data (up to controller
119) as drawable/editable clip envelopes, whether that data arrived via recording or was imported
from a `.mid` file **[manual p.503]**. The manual flags that a device on the receiving end may not
honor conventional CC semantics ("Pitch Bend" or "Pan" won't always do what the name implies)
**[manual p.503]** — a portability caveat specific to MIDI CC as a wire protocol, not really
applicable to dotbeat's closed, self-contained synth-param model (see §5 below).

## 5. Unlinking clip envelopes from clips: the chapter's most structurally distinct idea

Section 26.5 is where the chapter earns its length, and it's the one idea with no dotbeat analog
at all today. **A clip envelope can have its own local loop/region length, completely decoupled
from the clip's own sample loop** **[manual p.503]**. Concretely:

- **Long shape over a short loop**: unlink the Clip Gain (or Track Volume) envelope from a 1-bar
  drum loop, set the envelope's own loop length to 8 bars, draw one downward ramp across those 8
  bars. Result: the 1-bar sample keeps looping normally underneath, but the *volume* fades out once
  over 8 full repetitions, because the envelope now plays as its own one-shot region independent of
  the sample's loop **[manual p.504]**.
- **Re-looping that shape**: turn the envelope's own Loop switch back on and the whole 8-bar
  fade-and-reset pattern itself repeats — "how about a filter sweep every four bars?" **[manual
  p.504]** — any envelope shape, arbitrary length (including odd lengths like `3.2.1`, with an
  explicit warning that several odd-length envelopes stacked in one clip gets confusing fast)
  **[manual p.504-505]**.
- **Short shape over a long sample, the inverse direction**: a several-minutes-long song sample
  with a 1-bar volume-envelope loop "punching holes" into it rhythmically, e.g. removing every
  third beat **[manual p.505]** — the same mechanism read the other way.
- **Envelope as LFO**: an unlinked, short, looped envelope is functionally a tempo-synced LFO;
  hiding the grid lets you detune the loop length away from the meter for an intentionally
  unsynced LFO **[manual p.505]**.
- **A shared reference point** keeps sample-loop and envelope-loop from drifting into
  incomprehensibility: "the start marker identifies the point where sample or envelope playback
  depart from when the clip starts" **[manual p.504]**, and both the sample's and the envelope's
  start/end/loop-brace positions snap to the same zoom-adaptive grid **[manual p.505]**.
- **Warping interaction**: in "Linked" mode (the non-unlinked default), an envelope tracks the
  clip's own Warp Markers — move a warp marker and the envelope's timing stretches/compresses to
  match; Warp Markers are themselves editable from inside the envelope editor **[manual p.505-506]**.

## 6. Relevance to dotbeat

Grounded against `src/core/document.ts`, `src/core/edit.ts`, `ui/src/audio/engine.ts`,
`docs/format-spec.md`, `docs/phase-20-automation-lanes.md`, and the Automation section of
`docs/product-roadmap.md` (five rows: "Per-track picker + draggable curve" ✅ Done; "Curved
segments," "Same-row curve overlay," "Multi-clip-per-track automation," "Log-scale y-axis" all
⬜ Not started).

### 6.1 Confirmed, concrete bug: dotbeat's clip automation and its own LFOs don't compose "in harmony" the way Ableton's automation/modulation do — and the inconsistency is uneven across params

This is the single most actionable finding in this pass, verified by reading the actual per-tick
scheduling code, not inferred.

dotbeat's clip automation always writes an **absolute** value (Ableton's "Automation," never
"Modulation") — `interpolateAutomation` returns the raw value used directly:
`chain.filter.frequency.linearRampToValueAtTime(baseCutoff, rampTime)`, `chain.panner.pan.
linearRampToValueAtTime(val, rampTime)`, etc. (`ui/src/audio/engine.ts:3300-3352`). Separately,
dotbeat's two per-track LFOs can target many of the *same* parameters (`p.lfoDest`/`p.lfo2Dest`,
widened to a shared destination enum in Phase 18 Stream R per the code's own comment,
`ui/src/audio/engine.ts:3354-3361`). For **cutoff only**, the engine already does the Ableton-style
composition correctly: clip automation sets `baseCutoff` (the "absolute" layer), and the LFO
multiplies *around* that base — `chain.filter.frequency.linearRampToValueAtTime(Math.max(baseCutoff
* Math.pow(2, p.lfoDepth * lfo), 20), rampTime)` (`ui/src/audio/engine.ts:3300-3314`) — a real,
working instance of exactly the "automation defines the absolute value, modulation influences it
relatively" split the manual describes **[manual p.498]**.

But that composition is **hand-built once for cutoff and not generalized**. For every other
parameter both systems can reach — resonance, pan, sendReverb, sendDelay, eqLow/Mid/High, compMix,
distortionMix, bitcrushMix — the generic clip-automation loop
(`ui/src/audio/engine.ts:3329-3352`) writes the automated value first, then a separate
`applyLfoAdditive` pass (`ui/src/audio/engine.ts:3362-3387`, called at `3386-3387`, i.e. **later in
the same tick**) computes its own ramp as `p.<key> + depth*lfo` — relative to the **static field
value**, not to whatever the automation just set. Since it runs after, on any tick where both an
LFO and clip automation target the same parameter, the LFO's write silently wins and the automated
value is never heard for that tick — the opposite of "harmony," a clobber. Volume/amp is a third,
different case again: the LFO-amp branch (`ui/src/audio/engine.ts:3315-3320`) runs *before* the
generic automation loop, so for `volume` specifically, automation wins over the amp LFO instead.
**Three parameters, three different composition behaviors** (cutoff: correct multiplicative
composition; volume: automation-wins-over-LFO; everything else: LFO-wins-over-automation), none of
which is a documented or intentional design choice — it falls out of code order.

**Recommendation**: generalize the cutoff pattern. Change `applyLfoAdditive`'s relative offset from
`p.<key> + depth*lfo` to `(automated value if present, else p.<key>) + depth*lfo` for every shared
destination, the same shape `baseCutoff` already establishes. This is a small, scoped engine fix
(one function, `ui/src/audio/engine.ts:3362-3387`), not a format change — `BeatAutomationLane` needs
no new field, since the fix is purely about how two already-existing runtime signals combine at the
`AudioParam`. Worth a regression test asserting "clip automation + an LFO on the same destination
produces a value that oscillates *around* the automated curve, not one that ignores it."

### 6.2 A real, well-scoped feature gap: no per-lane loop length independent of clip loop

dotbeat's `BeatClipLoop` (v0.10, `src/core/document.ts:464-467`) already gives a *clip* its own
loop range independent of the section/`loopBars`-driven tiling — but automation lanes have no
equivalent independence from the *clip's* tiling. Per `phase-20-automation-lanes.md`, the drawn
curve is rendered "tiled every `loopBars*16` steps to match the engine's playback tiling" — i.e.
today, an automation lane's period is always locked to whatever period its clip plays at. There is
no way to build §5's two headline Ableton moves: a long, once-through envelope shape (e.g. an 8-bar
fade) laid over a short, fast-looping note/hit clip, or the inverse — a short, fast-repeating
envelope pattern gating a long clip.

This is a clean, additive extension of the exact same optionality pattern dotbeat already uses
twice (`BeatClipLoop | null` on a clip, `BeatTimeSignature | null` on a clip — both "canonical
elision: presence = override, absence = inherits the surrounding tiling," per their own doc
comments in `document.ts:456-479`). A parallel `loopBars: number | null` (or a `loop: {start, end}
| null`, mirroring `BeatClipLoop`'s own shape) on `BeatAutomationLane` would let a lane opt into its
own tiling period, defaulting to today's behavior (locked to the clip) when absent — no format
version bump beyond adding one optional field, no change to any file that doesn't already touch
automation.

**Recommendation**: add this as its own row to `docs/product-roadmap.md`'s Automation section —
"Per-lane loop length (envelope unlinked from clip loop)" — alongside the four already-listed
not-started rows (Curved segments, Same-row curve overlay, Multi-clip-per-track automation,
Log-scale y-axis). It's a genuinely new creative capability (long evolving shapes over short
loops, or rhythmic gating patterns over long clips), not a parity checkbox, and it reuses
`BeatClipLoop`'s exact design pattern rather than inventing a new one.

### 6.3 A design divergence worth naming explicitly, not necessarily fixing: dotbeat's automation is Ableton's "Automation," and dotbeat has no "Modulation" concept for anything except the cutoff special-case

Beyond the LFO-interaction bug in §6.1, there's a broader, more deliberate-looking choice worth
surfacing so it's a documented decision rather than an unexamined default: **every dotbeat clip
automation value (gain, pan, sends, EQ...) is absolute**, matching Ableton's "Automation" envelopes
throughout, never Ableton's relative "Modulation" envelopes (§2-3 above: Gain as % of Clip Gain
slider, Pan's knob-position-dependent range, Send's "never open further than the knob"). Given D9's
canonical-elision philosophy and D1's "document-only, literal data" stance, an absolute-value
automation point is arguably *more* diff-legible than a relative one — `point p1 8 548.8235` reads
as "cutoff is 548.8 Hz at this instant" with no need to also know the static `cutoff` field's value
to interpret it musically, whereas an Ableton-style relative point only means something in
combination with a knob position stored elsewhere. **This looks like the right call for dotbeat's
stated diff-friendliness goals, not a gap** — worth stating outright so a future session doesn't
"fix" it into a relative model without re-deriving this tradeoff. The one place this absolute-only
model creates a real usability question is §6.1's LFO-interaction bug, which is a composition-order
bug, not a reason to make automation itself relative.

### 6.4 Sample Offset ("beat scrambling") — a concrete, cheap addition once beats-mode warping lands

dotbeat's `WarpMode` is currently `'off' | 'repitch' | 'complex'` (`src/core/document.ts:485-486`),
with `'complex'` a declared-but-unimplemented enum value pending the warp-markers/stretch-engine
work already scoped in `docs/research/25-audio-warp-markers-stretch.md` and
`docs/research/26-beats-mode-transient-slicing.md` (both "Not started" in the product roadmap's
Audio-region clip editing section). Ableton's Sample Offset envelope (§2 above) only exists in
Beats Warp Mode, and is *cheap* to add once that mode exists: it's not a new stretch algorithm, just
a per-tick read-position offset (±8 sixteenths, one 16th = one grid line) applied to an
already-warped player.

**Recommendation, sequenced deliberately after 25/26, not before**: once beats-mode warping lands,
add `'sampleOffset'` to `AUDIO_AUTOMATABLE_PARAMS` (`src/core/document.ts:533`, currently `['gain']`
only) — this reuses `BeatAutomationLane`/`BeatAutomationPoint`/`addAutomationPoint`/
`setAutomationPoint` completely unchanged, the exact same "no new grammar" result the v0.9 gain
automation already proved for the audio-region format (`docs/format-spec.md:669-673`: "Gain
automation reuses the v0.9 `auto`/`point` grammar completely unchanged"). Only the engine
interpretation of a `sampleOffset` lane's value (tape-head-style read-position modulation, bounded
to whatever range beats-mode warping ends up using) is new work. This is a small, natural
follow-on to two already-scoped-but-unbuilt roadmap items, not a new research direction.

### 6.5 Already covered, worth confirming rather than re-flagging as a gap

- **"Using clips as templates" (§2, swap sample keep envelopes)**: dotbeat's `setClipAudioRegion`
  (`src/core/edit.ts:1233-1254`) already supports changing only `media` on an existing audio-region
  clip while every other field (`in`/`out`/`gainDb`/`warp`/`rate`) — and, by construction, the
  clip's separate `automation` array — is left untouched. The core primitive matches Ableton's
  behavior exactly; there is no GUI affordance specifically framed as "swap sample, keep
  automation" today, but that's a thin GUI-discoverability gap on top of already-correct core
  behavior, not a missing capability.
- **LED-style discoverability ("Only show adjusted envelopes")**: `phase-20-automation-lanes.md`
  already implements the core of this — "params that already carry points on the track's clip show
  as lanes automatically (no need to open the picker)" — matching the manual's LED-driven
  discoverability principle **[manual p.494-495]** even without a literal LED glyph.
- **MIDI Controller clip envelopes (§4)**: not applicable yet — dotbeat has no `.mid` file import
  path (confirmed: no `importMidi`/MIDI-import code anywhere under `src/` or `cli/`) and no MIDI-CC
  concept in `BeatNote`. Low priority until MIDI import itself is scoped; noted for completeness,
  not recommended as near-term work.

### 6.6 Not recommended: Ableton's Draw-Mode-as-a-toggle, in favor of the pattern dotbeat already shipped elsewhere

The manual treats Draw Mode (paint stepped values) vs. breakpoint editing (drag individual points)
as an explicit, uniform toggle across every envelope type **[manual p.495-496]**. dotbeat's
automation-lane editor today only supports the breakpoint style (click to add, drag to move,
alt-click to remove — `phase-20-automation-lanes.md` §2). Rather than porting Ableton's separate
mode toggle, dotbeat already has a closer, cheaper precedent to extend: the per-note chance lane's
"draw-across paint gesture" shipped in Phase 23 Stream BA — "one continuous drag paints every note
the pointer sweeps over to the same probability" (`docs/product-roadmap.md`'s "Per-note probability"
row; `docs/research/22-opendaw-editing-workflow.md` §1.4's `PropertyDrawModifier` reference). A
future automation-lane "paint mode" should reuse that exact interaction, not invent a
Draw-Mode/breakpoint-mode toggle from scratch — same visual language the user already learned on
the chance lane, less code than porting Ableton's two-mode model wholesale.

## Sources

Ableton Live 12 Reference Manual, chapter 26 "Clip Envelopes", pp. 494-506
(`prior_art/ableton-chapters/ch26.txt`, gitignored source extract).

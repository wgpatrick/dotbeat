# Research 42 — Ableton Live 12 Reference Manual, Ch. 18 "Mixing" (pp. 379-394)

*2026-07-12. Owner-commissioned parallel research pass, one of several mining the official Ableton
Live 12 Reference Manual (999 pages, dropped into `prior_art/`, gitignored) chapter-by-chapter for
ideas/gaps relevant to dotbeat's design. This one is unusually urgent: the owner just reported the
live app's volume fader sounds like it's "blowing out the audio... coming in weirdly" at high
volumes. A floor bug (fader minimum wasn't real silence) was already found and fixed this session
(`docs/volume-fader-bugfix.md`), and that same investigation found and fixed a second, real bug — a
missing headroom trim on the additive synth voice bank that was driving the master limiter into a
crest-factor collapse. This pass reads Ableton's own documented mixer/gain-staging conventions
closely to check dotbeat's fix against real prior art and to look for anything the fix might have
missed. Research-only — no code was written or modified.*

## How to read this doc

- **[manual p.NNN]** — a claim read directly from the chapter's extracted text (`pdftotext -layout`
  of the actual PDF), cited to the real manual page number (derived from the chapter's start page,
  379, plus the page-break markers — the chapter's own footer page numbers — in the extract). Not
  web-sourced; this is a direct read of the source document itself.
- **[dotbeat]** — read directly from this repo's current source this pass (`ui/src/audio/engine.ts`,
  `ui/src/components/MixerView.tsx`), cited with file:line.
- **[inference]** — my own synthesis connecting a [manual] claim to a [dotbeat] fact; flagged
  explicitly wherever the reasoning chain matters more than either fact alone.

## 1. What this chapter covers, and why it matters right now

Chapter 18 is Ableton's own account of its mixer: track volume/pan, mute/solo/arm, Group Tracks
(submixes), return tracks and sends, the Main track (master bus), the crossfader, soloing/cueing,
track delays, and CPU-impact metering. Most of it (crossfader, cueing, track delays, CPU meters) is
low-relevance to dotbeat today — dotbeat has no DJ-style crossfader, no multi-output cueing setup,
and no per-track delay-compensation UI yet. But two specific sections turn out to be exactly on
point for the live bug report: **18.1's meter/headroom philosophy (pp. 381-383)** and **18.4's
return-track Pre/Post-fader convention (pp. 386-387)**. Both are read closely below and checked
directly against `ui/src/audio/engine.ts`.

## 2. The mixer controls (18.1, pp. 379-382)

The mixer is available from both Session and Arrangement View, plus a per-track "Track Controls"
strip in Arrangement View **[manual p.379]**. Its six per-track controls, in Ableton's own order
**[manual p.381-382]**:

1. **Meter** — shows **both peak and RMS** simultaneously. "Peak meters show sudden changes in
   level, while RMS meters give a better impression of perceived loudness." **[manual p.381]**
2. **Volume** — adjusts the track's output level; with multiple tracks selected, adjusting one
   adjusts all of them, preserving relative offsets if they already differ. **[manual p.381, p.383]**
3. **Pan** — Stereo Pan Mode (single knob, click its triangle to reset to center) or Split Stereo
   Pan Mode (independent L/R sliders, double-click to reset); switchable via context menu.
   **[manual p.382]**
4. **Track Activator** (mute) — off = muted. **[manual p.382]**
5. **Solo** — mutes all other tracks; can be reconfigured as non-exclusive (`Ctrl`/`Cmd`-held, or
   turning off "Exclusive Solo" globally). **[manual p.382]**
6. **Arm** — record-enable, same exclusive/non-exclusive behavior as Solo. **[manual p.382]**

**Relevance:** dotbeat's mixer strip already covers volume, pan, mute, solo (`ui/src/components/
MixerView.tsx`) — the multi-select "adjust one, adjust all, preserve relative offsets" behavior is a
real Ableton feature dotbeat doesn't have, but it's a workflow nicety, not related to the reported
bug. The one gap worth flagging: **dotbeat's per-track meter is RMS-only.** See §5.1 — this turns
out to matter a lot for the headroom bug specifically.

## 3. The headroom philosophy (18.1.1, pp. 382-383) — the single most load-bearing passage in this chapter

This is the section that most directly bears on the reported bug. Quoted in full because the exact
wording matters **[manual p.383]**:

> "Because of the enormous headroom of Live's 32-bit floating point audio engine, Live's audio and
> MIDI tracks can be driven far 'into the red' without causing the signals to clip. The only time
> that signals over 0 dB will be problematic is when audio leaves Live and goes into the outside
> world. Examples include: When routing to or from physical inputs and outputs, like those of your
> sound card. Audio on the Main track (which is almost always connected to a physical output). When
> saving or exporting audio to a file. Nevertheless, Live provides this optional visual feedback for
> signals that travel beyond 0 dB in any track."

Two structural claims here, both worth pulling apart:

1. **Internal precision is not the bottleneck; the output boundary is.** Ableton's architecture
   deliberately does *not* try to prevent individual tracks from running hot — 32-bit float has so
   much dynamic range above 0 dBFS that intermediate "clipping" isn't a real risk anywhere inside the
   signal chain. The only places 0 dB actually matters are the three boundary points named:
   physical I/O, the Main track specifically (because it's "almost always" the thing feeding physical
   I/O), and file export (bit-depth reduction).
2. **The fix for "running hot" is *visibility*, not automatic correction.** Ableton's own answer to
   "what happens when a track runs hot" is "nothing bad, but here's an optional light to tell you."
   It is explicitly *not* "we insert a limiter to catch it for you." The resizable-mixer paragraph
   right above this one **[manual p.382-383]** spells out what that visibility looks like in
   practice: dragging the mixer taller adds "tick marks, a numeric volume field and **resettable
   peak level indicators**"; widening a track in that state adds "a decibel scale alongside the
   meter's tick marks."

**[inference]** This reframes dotbeat's own bug diagnosis in a useful way. `docs/
volume-fader-bugfix.md`'s Symptom 2 investigation found no "hard brick-wall digital clipping"
anywhere in the signal path — correctly, per Ableton's own doctrine, since Web Audio's internal
processing is float throughout and nothing clips until it reaches an actual boundary. What *did*
happen is exactly the boundary case Ableton names: dotbeat's master bus terminates in `Tone.Limiter(
-1)` right before `Tone.getDestination()` (`ui/src/audio/engine.ts:1722-1738`) — structurally the
same role as Ableton's Main track ("almost always connected to a physical output"). The bug wasn't
that dotbeat lacks Ableton's headroom (Web Audio has the same float headroom Live does); it's that
nothing upstream gave the user *visibility* into how hard individual tracks were driving that
boundary before it audibly squashed — which is precisely the gap Ableton's "optional visual
feedback" and "resettable peak level indicators" are for. See §5 for what this suggests concretely.

## 4. Group Tracks / submixes (18.3, pp. 384-386)

Any set of tracks can be grouped into a Group Track — "a special kind of summing container"
**[manual p.384]** — which gets its own mixer strip and can host its own effects, giving a quick
submix. Grouped tracks auto-route to the group unless they already have a custom routing
**[manual p.385]**. A folded Group Track in Arrangement View shows "an overview of the clips in the
contained tracks" **[manual p.385]**; a Group Track containing a soloed nested track shows a
half-colored Solo button **[manual p.386]**.

**Relevance:** dotbeat has exactly one hard-coded submix today — the drum bus (`DrumBus` in
`engine.ts`, all five drum lanes summing through one shared filter/EQ/comp/distortion/bitcrush/sends
chain before hitting the master, `engine.ts:1774+`). There's no general "group any tracks into a
submix" concept for synth/instrument tracks. Low priority relative to the headroom question, but
worth a line in the feature-inventory roadmap (§9 of `ROADMAP.md`) as a real, well-precedented gap —
not urgent, not touched further here.

## 5. Return tracks, sends, and the Main track (18.4, pp. 386-387)

Return tracks host effects that process audio **sent** from multiple tracks, rather than one track's
own signal **[manual p.386]** — the standard aux-send/return model. Two details matter for dotbeat:

### 5.1 Pre/Post fader tap point

> "Every return track has a Pre/Post toggle that determines if the signal a clip track sends to it is
> tapped **before or after the mixer stage (i.e., the pan, volume and track-active controls)**."
> **[manual p.387]**

The default is **Post** (send tapped *after* pan/volume/mute) — "Pre" is the special case, explicitly
framed as being for an independent auxiliary/monitor mix, not the normal signal path
**[manual p.387]**.

**[inference] This is a real, concrete divergence in dotbeat's current engine, worth checking against
the bug report.** `ui/src/audio/engine.ts:2219-2224`:

```ts
panner.chain(vol, this.getMaster())
vol.connect(levelTap) // post-fader side-tap for this track's meter (not in the audible path)
panner.connect(reverbSend)
reverbSend.connect(reverb)
panner.connect(delaySend)
delaySend.connect(delay)
```

`reverbSend`/`delaySend` are wired off `panner` — **upstream of `vol`, the track's own volume fader**.
`vol` sits between `panner` and `getMaster()`, so the dry signal passes through the fader but the wet
send does not. This means **dotbeat's sends are unconditionally pre-fader** — the opposite of
Ableton's documented default. Concretely: dragging a track's fader down attenuates only the dry
signal; the reverb/delay wet signal reaching the return buses stays exactly as loud as
`sendReverb`/`sendDelay` say it should be, regardless of fader position. At very low fader settings
this would make a track sound disproportionately wet (dry signal fades out, wet doesn't); at high
fader settings — closer to the actual bug report — it means the wet path is a *second*, currently
invisible contributor to how hard the master bus gets driven that the fader gives the user no control
over. Worth checking directly: any track in the reported session using `sendReverb`/`sendDelay` > 0
would have its wet contribution to the master bus totally unaffected by the "turn the fader down"
instinct a user would reach for first.

### 5.2 Sends are dangerous by default, and Live disables them defensively

Because return-track sends can be routed back into their own input (deliberately, for feedback
effects), "the Send controls in Return tracks are disabled by default" — right-click to
`Enable Send`/`Enable All Sends` **[manual p.387]**. This is a specific, deliberate safety default
Ableton ships to prevent exactly the kind of runaway-gain surprise the bug report describes ("boost
the level dramatically and unexpectedly" is the manual's own phrase for the failure mode it's
guarding against **[manual p.387]**). dotbeat has no equivalent safety default — `sendReverb`/
`sendDelay` are just numeric params with no "must be explicitly enabled" gate. Low priority (dotbeat
has no return-to-return feedback routing at all, so the specific runaway-feedback scenario Ableton is
guarding against structurally can't happen here), but the underlying design instinct — sends default
to *safe*, not *live* — is worth keeping in mind if return-to-return routing is ever added.

### 5.3 The Main track hosts user-editable mastering FX

"The Main track is the default destination for the signals from all other tracks. Drag effects here
to process the mixed signal before it goes to the Main output. Effects in the Main track usually
provide mastering-related functions, such as compression and/or EQ." **[manual p.387]**

**Relevance:** dotbeat's master chain is fixed and non-editable — `Tone.Gain(1)` → `Tone.Limiter(-1)`
→ destination, with a meter/waveform/FFT side-tap (`engine.ts:1722-1738`). There's no user-facing
master EQ/comp, and the limiter's -1dB threshold is hardcoded, not a parameter. This is already
adjacent to the roadmap's own M4/metrics-engine plans (a "learned auto-mix... master-bus EQ/DRC" is
explicitly named in `ROADMAP.md` §7), so it's not a new finding — but it's worth naming here because
it's the traditional, Ableton-documented place a user would go to *manage* exactly the kind of
overdrive the bug report describes, and dotbeat currently gives them no lever there at all beyond the
per-track fader.

## 6. Lower-relevance sections, briefly

- **Crossfader (18.5, pp. 388-391)** — a DJ-mixer-style crossfader with seven curves, MIDI-mappable,
  per-track A/B assign buttons that attenuate (not reroute) a track's gain stage
  **[manual p.388-391]**. No dotbeat equivalent; no relevance to the bug or current roadmap.
- **Soloing and cueing (18.6, pp. 391-392)** — solo-in-place vs. muting returns too; a full
  cue-bus/headphone-preview workflow requiring a 4-output audio interface **[manual p.391-392]**.
  dotbeat has solo; no cueing concept. Not relevant to the bug.
- **Track Delays (18.7, p.393)** — per-track ms offset to compensate for real-world latency, distinct
  from Live's automatic plug-in delay compensation **[manual p.393]**. Adjacent to the roadmap's
  already-flagged native-latency-compensation gap (M4, `ROADMAP.md` §6), not a new finding.
- **Keep Monitoring Latency (18.8, p.393)** and **Performance Impact Track Indicators (18.9, p.394)**
  — recording-monitoring timing and per-track CPU meters **[manual p.393-394]**. No relevance to the
  bug; the CPU-meter idea is a reasonable, low-priority future UI nicety.

## 7. Relevance to dotbeat — concrete recommendations

Read directly against `ui/src/audio/engine.ts`'s current volume/gain handling (the `applyVolumeFloor`
floor fix and the `-9dB` `headroom` gain stage from this session's earlier bugfix, `engine.ts:325-328`
and `2146-2231`).

### 7.1 The existing fix is correctly shaped, and Ableton's own doctrine validates *where* it acts

The floor fix (`applyVolumeFloor`, `-Infinity` at ≤ -60dB) and the master `Tone.Limiter(-1)`
positioned at the true output boundary (`engine.ts:1722-1738`, right before `Tone.getDestination()`)
both land exactly where Ableton's own model says the only real risk is: the boundary between the
engine and "the outside world" **[manual p.383]**. Nothing here needs to change — this is a
**confirmation**, not a gap.

### 7.2 Recommended: add a peak indicator, not just RMS, to the live per-track meter

**This is the single most actionable, directly-bug-relevant finding in this pass.**
`TrackMeter` (`ui/src/components/MixerView.tsx:93-122`) reads `engine.getTrackLevel(trackId)`, which
is explicitly RMS (`levelTap: Tone.Analyser` computing "true RMS, not a decaying Tone.Meter",
`engine.ts:1507-1510`). Ableton shows **peak and RMS side by side, specifically because they answer
different questions** — "Peak meters show sudden changes in level, while RMS meters give a better
impression of perceived loudness" **[manual p.381]** — and layers **resettable peak level
indicators** on top for exactly the "did this track go into the red at some point" question
**[manual p.382-383]**.

Why this matters for the bug: the crest-factor collapse this session's fix addressed (8.1dB → 1.3dB
crest factor pre-fix, per `docs/volume-fader-bugfix.md`) is **invisible on an RMS-only meter** — RMS
barely moves while crest factor collapses, because RMS-vs-peak divergence *is* what crest factor
measures. A user watching only an RMS meter has no way to see a track running hot enough to squash
the limiter until they hear it. Recommend: add a peak segment/indicator to `TrackMeter` (even a
simple "last N ms peak" line over the existing RMS bar, plus an optional sticky/resettable
"went over 0dB" marker) — directly modeled on what Ableton documents, and it would have made the
original bug audible-*and*-visible during development instead of audible only.

### 7.3 Recommended: fix or flag the pre-fader send tap

Per §5.1, `reverbSend`/`delaySend` tap off `panner` (pre-fader) while Ableton's documented default is
post-fader (after pan/volume/track-active, `[manual p.387]`). Two options, in order of effort:

- **Minimal fix**: move the send taps downstream of `vol` instead of `panner` — matches Ableton's
  documented default behavior with no new UI surface needed change (`sendReverb`/`sendDelay` params
  keep their current meaning, they'd just now be scaled by the fader like Ableton's are).
  Deliberately keep the same tap point pre-*insert-chain*-mute-gate vs post — that ordering nuance
  needs a careful look at `muteGain`/`panner` wiring before landing, not a blind swap.
  This is a plausible, real contributor to "sounds weird" independent of the headroom fix on any
  track that actually uses reverb/delay sends, and is worth verifying with the same measured-audio
  discipline `docs/volume-fader-bugfix.md` used (a track with `sendReverb > 0`, faded from `+6dB`
  down toward `-60dB`, checking whether the wet signal actually diminishes).
- **If pre-fader is intentional** (e.g., so automation/performance riding the fader doesn't yank the
  reverb tail out from under a note that already triggered it) — that's a legitimate design choice
  Ableton itself supports via the Pre toggle, but it should be a documented, deliberate decision (a
  line in `docs/decisions.md`), not an unexamined default, since it currently silently diverges from
  the DAW convention dotbeat otherwise mirrors closely (fader range, floor behavior, etc.).

### 7.4 Recommended: re-verify the headroom fix under multi-track summing, not just one track

`docs/volume-fader-bugfix.md`'s own measurements are explicit about scope: "a single held note on
the bare primary voice alone," "a single plain synth voice, default patch." Ableton's own framing of
where the problem actually bites — "the only time signals over 0dB will be problematic is when audio
**leaves** [the engine]" **[manual p.383]** — is a summed-signal boundary, not a per-track one. The
`-9dB` headroom trim was tuned and verified against one track's contribution to the master bus; it
was never verified against what a real song actually does — several tracks (synth + drums +
instrument tracks) all summing into the same `Tone.Gain(1)` → `Tone.Limiter(-1)` master chain
simultaneously, several of them possibly sitting at healthy-but-nonzero volumes at once. That's the
more realistic version of "sounds like I'm blowing out the audio" for an actual multi-track song
(e.g. `examples/night-shift-song.beat`) rather than a single isolated voice. Recommend extending
`ui/verify-volume-fader-bugfix.mjs`'s methodology (real fader drag, real recorded audio, peak/crest
measurement) to a multi-track scenario — several tracks at once, faders left at sane levels — to
confirm the fix holds under summing, not just in isolation. This is the most likely place a residual
version of the reported bug could still be hiding.

### 7.5 Lower-priority, roadmap-only

- A user-editable master EQ/comp stage (Ableton's Main-track pattern, §5.3) is the traditional lever
  a mix engineer would reach for instead of (or alongside) an automatic limiter — already adjacent to
  `ROADMAP.md` §7's planned metrics/auto-mix work, not a new ask, just cross-referenced here.
- Group Tracks / general submixing (§4) — dotbeat only has the hardcoded drum bus; a real gap, but
  unrelated to the current bug and not urgent.
- Resizable-mixer numeric dB field + dB scale (§3) — a nice, low-effort companion to 7.2's peak
  indicator if that lands; same Ableton passage motivates both.

## Sources

Ableton Live 12 Reference Manual, Chapter 18 "Mixing," pp. 379-394 (extracted via `pdftotext
-layout` from the manual PDF in `prior_art/`, not web-fetched — page numbers derived from the
chapter's own footer page numbers in the extract). Engine-code claims read directly from
`ui/src/audio/engine.ts` and `ui/src/components/MixerView.tsx` on this repo's current `main`, cross-
referenced against `docs/volume-fader-bugfix.md` (this session's earlier floor/headroom
investigation).

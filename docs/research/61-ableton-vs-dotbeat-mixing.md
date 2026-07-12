# Research 61 — Ableton Live 12 mixing vs. dotbeat: feature/UI comparison + recommendations

*2026-07-12. Direct follow-on to `docs/research/42-ableton-mixing.md` (the grounded primer on manual
ch.18, pp.379-394, read text-only). That pass already found a specific, plausible real bug —
dotbeat's reverb/delay sends are wired pre-fader while Ableton's documented default is post-fader —
prompted by the owner's live report that high volumes "sound like blowing out the audio... coming
in weirdly." This pass turns that into a structured feature/UI comparison, additionally grounded in
12 of the chapter's own screenshots (`p-379.jpg`–`p-388.jpg`, `p-391.jpg`, `p-393.jpg`), reads
`ui/src/audio/engine.ts`'s full signal chain and `ui/src/components/MixerView.tsx` directly for this
pass, and gives a decisive, per-item build plan. Nothing here proposes work that contradicts a
shipped feature or a decision in `docs/decisions.md`; where dotbeat's `docs/product-roadmap.md`
already lists something adjacent (Group tracks, mute/solo persistence) as ✅ Done, this doc is
careful to describe precisely what that shipped feature does and does not cover rather than
re-litigate it.*

## How to read this doc

- **[manual p.NNN]** — read directly from the chapter's extracted text and the 12 screenshots
  viewed this pass (`p-379.jpg` through `p-393.jpg`), cited to the manual's own footer page number.
- **dotbeat claims** — cited `file:line` against this repo's current `main`
  (`ui/src/audio/engine.ts`, `ui/src/components/MixerView.tsx`, `src/core/document.ts`,
  `ui/src/state/store.ts`).

---

## 1. Feature & UI/UX comparison

### a) Shared features / parity

| Capability | Ableton Live 12 | dotbeat |
|---|---|---|
| Fader range roughly matching a pro-audio convention, linear over dB | `-∞` to `+6` dB per-track volume, click-drag [manual p.381, screenshots throughout] | `VOL_MIN=-60` to `VOL_MAX=6` dB, linear-over-dB drag (`ui/src/components/MixerView.tsx:17-18, 46-81`) — deliberately modeled on Ableton's own `-∞..+6dB` convention (`docs/volume-fader-bugfix.md`) |
| Always-visible numeric dB readout per strip | The Volume field (e.g. `-5.0`, `-7.0`) is always shown under the meter, in every screenshot at every zoom level [manual pp.379-382] | `mixer-strip-db` div renders `fmtDb(vol)` under every fader (`MixerView.tsx:29, 251`) — genuine parity, not just a "nice to have" gap as an earlier pass's framing might suggest |
| Pan control | Stereo Pan Mode single knob, click triangle to reset [manual p.382] | Single `Knob` bound to `<id>.pan`, `-1..1` (`MixerView.tsx:223`) — no reset gesture, no Split Stereo mode (see 1b) |
| Mute (Track Activator) | Off = muted, toggle per track [manual p.382] | `M` button, `toggleMute` (`MixerView.tsx:255`, `ui/src/state/store.ts:166`) — real audio-gated mute (`isEffectivelyMuted`), not cosmetic |
| Solo | Mutes all other tracks; single-click is exclusive by default, `Ctrl`/`Cmd` for non-exclusive [manual p.382] | `S` button, `toggleSolo` (`store.ts:167`) — plain toggle, any number of tracks can be soloed simultaneously (Ableton's non-exclusive mode), but with no exclusive-by-default convenience layer (see 1b) |
| Per-track live level meter | Peak + RMS simultaneously [manual p.381] | RMS-only, true (non-decaying) RMS off a `Tone.Analyser('waveform')` side-tap (`engine.ts:2422-2431`, `getTrackLevel`) — see 1b for the peak gap |
| Aux-send / return-bus model | Return tracks receive sends from any number of clip tracks, host shared FX [manual p.386] | Two fixed, always-present shared buses (`reverbBus`/`delayBus`, `engine.ts:1766-1772`) that every track can send to via `sendReverb`/`sendDelay` — same conceptual model (send-to-shared-processor), narrower implementation (see 1b) |
| A hardcoded multi-source submix | Group Tracks are the general mechanism [manual pp.384-386] | The drum bus is exactly this pattern, just hardcoded to one instance: all drum lanes sum through one shared filter→EQ3→comp→distortion→bitcrush→sends→fader before the master (`engine.ts:1804-1847`) — real submix behavior, not available for synth/instrument tracks (see 1b, Group Tracks) |
| A fixed master/main output stage | The Main track, "almost always connected to a physical output" [manual p.387] | `getMaster()`: `Tone.Gain(1)` → `Tone.Limiter(-1)` → destination, plus meter/waveform/FFT side-taps (`engine.ts:1722-1738`) — architecturally the same role, non-editable (see 1b) |
| "32-bit-float headroom, only the output boundary matters" philosophy | Explicit doctrine: tracks can run hot internally, only physical I/O / Main track / file export are risk points [manual p.383] | Same architecture by construction — Web Audio is float throughout, and this session's own bugfix (`docs/volume-fader-bugfix.md`) landed its headroom trim and limiter at exactly this boundary, independently arriving at the same place Ableton's doctrine names |
| Reorderable per-track insert effects | Devices dragged into a track's chain, in Live's Device View | Explicit ordered `effects` list, add/remove/reorder/real-bypass (`docs/decisions.md`-adjacent, `phase-22-stream-aa.md`) — genuine parity, arguably more literal (bypass is a real routing bypass, not a wet-knob illusion) |

### b) In Ableton, not in dotbeat

1. **Peak metering alongside RMS, plus resettable peak indicators.** "The Meter shows both peak
   and RMS output levels for the track... Peak meters show sudden changes in level, while RMS
   meters give a better impression of perceived loudness" [manual p.381]; the resizable mixer adds
   "resettable peak level indicators" and a decibel scale [manual p.382-383, screenshot]. dotbeat's
   `TrackMeter` reads `engine.getTrackLevel(trackId)`, which is **RMS only** (`engine.ts:2409-2431`,
   `Engine.rmsDb` over a waveform buffer) — there is no peak segment, no sticky "went over 0dB"
   marker, anywhere in the mixer. This is the single most bug-relevant gap: the crest-factor
   collapse `docs/volume-fader-bugfix.md` found (8.1dB → 1.3dB pre-fix) is close to invisible on an
   RMS-only meter.
2. **Multi-select "adjust one, adjust all, preserve relative offsets."** Selecting several tracks
   and dragging one's volume/pan moves all of them together, keeping their existing differences
   intact [manual p.381, p.384]. dotbeat's `ChannelStrip` has no multi-select concept at all — every
   fader/pan/send edit is scoped to exactly one track (`MixerView.tsx:201-264`).
3. **Split Stereo Pan Mode.** Independent L/R pan sliders as an alternative to the single Stereo Pan
   knob, toggled via context menu, double-click to reset [manual p.382]. dotbeat's pan is a single
   `-1..1` `Knob` with no mode switch and no click/double-click reset gesture (`MixerView.tsx:223`).
4. **Resizable mixer strip (tick marks + numeric field + peak indicators + dB scale).** Dragging the
   mixer taller/wider progressively reveals tick marks, resettable peak indicators, and a decibel
   scale next to the meter [manual p.382-383, screenshot]. dotbeat's `Fader` is a fixed-height
   element with a single 0dB marker line and no tick marks, no dB scale, no resize affordance
   (`MixerView.tsx:71-81`).
5. **Group Tracks as real summing submixes, general-purpose.** "A special kind of summing
   container" [manual p.384] — any set of tracks can be grouped into one with its own mixer strip
   and its own hostable FX chain, auto-routing members' output into it [manual pp.384-386,
   screenshots]. dotbeat's `BeatGroup` (`src/core/document.ts:725-737`) is a **flat, named, colored
   membership list with zero audio-engine presence** — `engine.ts` contains no reference to
   `BeatGroup` at all. Grouping tracks in dotbeat today folds their headers in the GUI; it does not
   sum their audio, host shared FX, or give them a shared fader. The drum bus proves dotbeat's
   engine can build exactly this kind of submix (`engine.ts:1804-1847`) — it's just hardcoded to one
   instance instead of being a general mechanism.
6. **User-creatable Return tracks that host their own FX chain.** "You can create multiple return
   tracks using the Create menu's Insert Return Track command" [manual p.387] — an arbitrary number,
   each with its own devices. dotbeat has exactly two, fixed, un-editable buses: `reverbBus`
   (`Tone.Reverb`) and `delayBus` (`Tone.FeedbackDelay`), built once in `getBuses()`
   (`engine.ts:1766-1772`), with no user path to add a third bus, remove one, or drop an insert
   effect onto either.
7. **Pre/Post-fader toggle per return track — default Post.** "Every return track has a Pre/Post
   toggle that determines if the signal a clip track sends to it is tapped before or after the
   mixer stage (i.e., the pan, volume and track-active controls)" [manual p.387, screenshot
   `p-387.jpg`: the return-track strip's own `Sends` header carries the `Post`/`Post` toggle — the
   Pre/Post choice belongs to the *return track*, governing everything sent to it, not to each
   individual sender]. **This is the item this pass confirms as a real, current divergence** — see
   §2's dedicated row below.
8. **Sends disabled by default on return tracks, as a runaway-feedback safety net.** Because a
   return track's own output can be routed back into its own input, "the Send controls in Return
   tracks are disabled by default" [manual p.387]. dotbeat's `sendReverb`/`sendDelay` are plain
   numeric params with no enable/disable gate (`engine.ts:82-83, 297-298, 469-470`).
9. **User-editable mastering FX on the Main track.** "Drag effects here to process the mixed signal
   before it goes to the Main output... usually... compression and/or EQ" [manual p.387]. dotbeat's
   master chain is entirely fixed: `Tone.Gain(1)` → `Tone.Limiter(-1)` → destination
   (`engine.ts:1722-1738`) — no user-facing master EQ/comp exists anywhere in the GUI (verified: no
   component in `ui/src/components/` references the limiter or a master-bus effect).
10. **The DJ-style crossfader** — seven curves, per-track A/B assign, MIDI-mappable, automatable via
    an envelope device [manual pp.388-391, screenshots]. No dotbeat equivalent, no DJ/live-performance
    positioning in dotbeat's product at all.
11. **Cueing (pre-listen via a second audio-interface output) and exclusive/non-exclusive solo
    convenience.** A single click solos exclusively unless `Ctrl`/`Cmd` is held (or "Exclusive Solo"
    is turned off globally); cueing requires a 4-output (or two stereo-pair) audio interface and lets
    you preview a track before the audience/mix hears it [manual pp.391-392]. dotbeat's solo has
    no exclusive-by-default behavior (every toggle is independent, `store.ts:167`) and no cueing
    concept — no multi-output routing exists in dotbeat's audio backend at all today.
12. **Per-track Track Delay** — a millisecond offset (or pre-delay) per track to compensate for
    real-world monitoring/hardware/acoustic latency, distinct from Live's automatic plug-in delay
    compensation [manual p.393, screenshot]. No dotbeat equivalent; adjacent to (but not the same
    as) `ROADMAP.md`'s already-flagged native-latency-compensation gap (M4).
13. **Keep Monitoring Latency in Recording Track toggle** [manual p.393] and **Performance Impact
    (per-track CPU) indicators** [manual p.394] — both recording/monitoring-adjacent features dotbeat
    has no counterpart for; dotbeat has no recording capability at all yet (confirmed M4/Tauri-native
    scope per `ROADMAP.md` §6, `docs/decisions.md` D3).

### c) In dotbeat, not in Ableton

- **The `.beat` file makes every mixer edit a literal, reviewable one-line text diff.** A fader drag
  writes `<id>.volume` through `postEdit` straight into the project file (`MixerView.tsx:248`) —
  Ableton's `.als` is gzipped XML with no confirmed clean text-diff story
  (`ROADMAP.md` §1's landscape table). Out of scope for this mixing-specific doc to re-argue in
  depth (covered exhaustively elsewhere in `docs/research/`), but it's the one advantage that
  touches literally every row in this comparison: every gap in §1b is a GUI/engine feature; every
  row in this list is a property of *how* dotbeat's mixer state is stored, which Ableton's format
  structurally can't match regardless of what UI it ships.
- **CLI/MCP-settable mixer state, not just interactive.** Any fader/pan/send/effect param is
  reachable via `beat set`/`beat_set` from a script or an AI agent, not only by dragging a widget —
  no Ableton analog short of third-party socket-puppetry tools like `ableton-mcp`
  (`ROADMAP.md` §1's "Why now" section).
- **A glance-able "what's actually processing this track" FX badge row on every mixer strip.**
  `FxBadges` (`MixerView.tsx:125-199`) shows which inserts (EQ/Comp/Dist/Crush/Saturator/Chorus/
  Phaser/Ping-Pong/Beat Repeat/Auto Filter/Auto Pan/Tremolo/Utility/Grain Delay/Vinyl/Resonator/EQ7)
  are actually audible on a track, computed live from the same params the engine reads — directly on
  the mixer strip itself. Ableton's mixer strip shows no such summary; you'd need to open the
  track's Device View to see what's in the chain.
- **Real routing bypass on every insert**, not a wet/dry illusion — a bypassed effect is fully
  disconnected from the audio graph (`engine.ts`'s `reconcileEffectChain`, `2245-2270` area),
  distinct from Ableton's device on/off (which the manual doesn't document at the routing-graph
  level one way or the other, so this is a dotbeat implementation detail worth naming, not a claimed
  feature gap either direction).
- **Groove/Shuffle knobs live directly on the mixer channel strip** (`shuffleAmount`/`shuffleGrid`,
  `MixerView.tsx:225-244`) — Ableton keeps groove controls in a separate Groove Pool panel/clip
  inspector, never on the mixer strip itself [manual pp.330-335, already covered in
  `docs/research/59-ableton-vs-dotbeat-grooves.md`]. Noted here only as a UI-placement difference
  this pass's mixer-strip reading surfaced directly, not a re-scope of research 59's own findings.

---

## 2. Prioritized recommendations

### ⚠️ Pre/Post-fader send routing — flagged high-priority, plausible real audio bug

| Feature | Priority | Build recommendation |
|---|---|---|
| **Reverb/delay sends are wired pre-fader; Ableton's documented default is post-fader** — `reverbSend`/`delaySend` in both `buildSynthChain()` (`ui/src/audio/engine.ts:2221-2224`) and `getDrumBus()` (`engine.ts:1839-1842`) tap off `panner`, upstream of `vol` (the track's own fader). Concretely: dragging a track's fader down attenuates only the dry signal; the wet reverb/delay signal reaching the shared buses stays exactly as loud as `sendReverb`/`sendDelay` say, regardless of fader position — the opposite of Ableton's own documented model [manual p.387], where a return's default Pre/Post tap is **Post** (after pan/volume/track-active) and "Pre" is explicitly the special case for an independent monitor mix. | **P0** | Move both `reverbSend`/`delaySend` taps downstream of `vol` instead of `panner`, in both `buildSynthChain()` and `getDrumBus()` — matches Ableton's documented default with no format/UI change (`sendReverb`/`sendDelay` keep their current meaning, just now correctly scaled by the fader like Ableton's are). Needs a careful look at ordering vs. `muteGain` (currently upstream of `panner` in both chains, `engine.ts:2216-2217, 1834-1835` — mute should almost certainly still silence the sends too, so keep sends downstream of `muteGain` as well as `vol`). **Verify with the same measured-audio discipline `docs/volume-fader-bugfix.md` used**: a track with `sendReverb > 0`, faded from `+6dB` down toward `-60dB`, confirming the wet signal's measured level now tracks the fader instead of staying constant. This is independently plausible as a *second* contributor to the "blowing out... coming in weirdly" report, on top of the headroom fix already shipped this session — any track using reverb/delay sends has had its wet contribution to the master bus completely unresponsive to the fader the whole time. If, after investigation, pre-fader turns out to have been a deliberate choice (e.g. so riding a fader doesn't yank a reverb tail out from under an already-triggered note), that's a legitimate design Ableton itself supports via its Pre toggle — but it must become a written line in `docs/decisions.md`, not stay a silent, undocumented divergence from the DAW convention dotbeat otherwise mirrors closely (fader range, floor behavior, headroom trim). |

### Everything else from §1b

| Feature | Priority | Build recommendation |
|---|---|---|
| Peak metering + resettable peak indicator on `TrackMeter` | **P0** | Add a peak segment to `MixerView.tsx`'s `TrackMeter` (`93-123`) alongside the existing RMS bar — cheapest version: track a short-window (e.g. last 100-300ms) max of the same `levelTap`/`getTrackLevel` data already polled per `onAnimationFrame` tick, drawn as a thin line/cap over the RMS fill. Add a sticky "went over 0dB, click to reset" marker per strip (a tiny bit of new session state, not a `.beat` field — same treatment as mute/solo). This is the single most actionable, bug-relevant item in this whole doc: it would have made the shipped headroom bug *visible* during development, not just audible after the owner complained. Do this before or alongside the pre/post-fader fix above so both fixes are independently observable in the GUI, not just provable via `ui/verify-*.mjs` scripts. |
| A general-purpose Group Track / submix bus (not just the visual fold `BeatGroup` already ships) | **P1** | Generalize the drum bus's own proven pattern (`engine.ts:1804-1847`: shared filter→EQ3→comp→dist→bitcrush→sends→fader, one instance) into a per-`BeatGroup` submix: when a `BeatGroup` exists, route its member tracks' `panner`/`muteGain` output into a group-owned `Tone.Gain` instead of straight to `getMaster()`, and let that group bus carry its own insert chain (reuse the existing `effects`/`reconcileEffectChain` machinery already built for per-track chains, `phase-22-stream-aa.md`). Needs a mixer-strip UI for the group itself (fader + FX badges, same `ChannelStrip` shape). Real, well-precedented gap (Ableton's own Group Track is exactly this), not urgent relative to P0s, but a natural next step once dotbeat's `BeatGroup` already has membership tracked. |
| User-editable master-bus EQ/compression (Main-track pattern) | **P1** | This is the traditional lever Ableton gives a user for exactly the "master sounds hot/pumping" symptom the owner reported — currently dotbeat's only master-bus lever is the fixed, non-adjustable `Tone.Limiter(-1)` (`engine.ts:1726`). Already adjacent to `ROADMAP.md` §7's planned learned-auto-mix/master-bus-EQ-DRC work (Diff-MST names "master-bus EQ/DRC" explicitly) — don't build a bespoke one-off; sequence this as the first slice of that already-planned work, scoped down to "one EQ3 + one compressor, always in `getMaster()`'s chain, user-editable via a new Master strip in `MixerView.tsx`," not a full auto-mix system yet. |
| Return-track Pre/Post safety default (sends disabled by default) | **Do-not-recreate** | Ableton's default-disabled sends guard against runaway return-to-return feedback loops. dotbeat has no return-to-return routing at all — `reverbBus`/`delayBus` only ever receive from clip tracks and only ever output to `getMaster()` (`engine.ts:1766-1772`) — so the specific failure mode this default guards against is structurally impossible here. Recreating the friction (an extra "enable this send" click) would cost real UX with no matching risk to prevent. Revisit only if return-to-return routing is ever added. |
| Multi-select "adjust one, adjust all, preserve relative offset" | **P2** | A `ChannelStrip`-level workflow nicety once multi-track selection exists elsewhere in the GUI (the arrangement view already has cross-track marquee-select, `phase-24-stream-cc.md` — reuse that same selection state here rather than inventing a second one). Not urgent; no bug relevance. |
| Split Stereo Pan Mode + click/double-click reset gesture | **P2** | Small, well-specified addition to the existing pan `Knob` (`MixerView.tsx:223`): a context-menu toggle swapping the single `-1..1` knob for two independent L/R sliders, plus a reset-to-center double-click on the existing knob regardless of mode. Cheap, low-value relative to the P0/P1 items above. |
| Resizable mixer: tick marks + dB scale on the fader track | **P2** | Companion to the peak-indicator work above — once `TrackMeter` grows a peak segment, add tick marks (`-60/-48/-36/-24/-12/-6/0/+6`) along `Fader`'s track (`MixerView.tsx:71-81`) as static CSS-positioned labels (no resize interaction needed to get the value; Ableton's resize-to-reveal is a space-saving affordance dotbeat's fixed-width strip doesn't need to copy literally). |
| N user-creatable Return tracks with hostable FX (vs. today's 2 fixed buses) | **P2** | Real gap, but dotbeat's current 2 fixed sends (reverb, delay) already cover the dominant real-world use case Ableton's own return-track pattern targets. Only worth the real engineering (a new `BeatReturn` document type, a general `effects`-chain-hostable bus, a return-track mixer strip) once a user actually wants a third custom send bus — don't build ahead of that signal. |
| DJ-style crossfader (7 curves, A/B assign, automatable) | **Do-not-recreate** | No DJ/live-performance positioning anywhere in dotbeat's product thesis (`ROADMAP.md` §3's explicit non-goals list doesn't even need to name this — it's simply outside the "git-native production tool for people who code" scope). Building it would be pure feature-checklist chasing with zero users asking for it. |
| Cueing (multi-output preview) + exclusive-solo-by-default convenience | Cueing: **Do-not-recreate** (for now) / Exclusive-solo convenience: **P2** | Cueing needs a 4-output audio interface and real multi-output routing dotbeat's Web Audio / Tauri backend doesn't have at all — squarely M4-native-tier-or-later scope, not worth scoping until multi-output hardware routing exists for other reasons. The much cheaper piece — single-click-solos-exclusively-by-default, `Ctrl`/`Cmd`-click for the current non-exclusive behavior — is a two-line change to `toggleSolo` (`store.ts:167`) gated behind a modifier-key check in `MixerView.tsx`'s solo button handler; worth doing on its own, decoupled from cueing. |
| Per-track Track Delay (ms offset) | **P2** | Genuinely useful once dotbeat has real monitoring/recording latency to compensate for, but meaningless before that — sequence directly after (not ahead of) `ROADMAP.md`'s already-flagged M4 native-latency-compensation work, don't build it as an isolated knob first. |
| Keep Monitoring Latency toggle / per-track CPU (Performance Impact) indicators | **Do-not-recreate** (Keep Monitoring Latency) / **P2** (CPU indicator) | Keep Monitoring Latency is meaningless without a recording path, which doesn't exist and is explicitly out of scope until M4 (`docs/decisions.md` D3) — revisit only alongside actual recording work, don't scope it in isolation now. A per-track CPU/performance meter is a reasonable, cheap, low-priority GUI nicety independent of recording — cross-references `docs/product-roadmap.md`'s already-listed "GUI spectrum/level visualization" gap (same "visualize existing engine data, no new judgment surface" shape, doesn't reopen `docs/decisions.md` D2). |

---

## Sources

Ableton Live 12 Reference Manual, Chapter 18 "Mixing," pp. 379-394 — text extract (via
`docs/research/42-ableton-mixing.md`'s prior pass) plus 12 of the chapter's own screenshots viewed
directly this pass: `p-379.jpg`, `p-380.jpg`, `p-381.jpg`, `p-382.jpg`, `p-383.jpg`, `p-384.jpg`,
`p-385.jpg`, `p-386.jpg`, `p-387.jpg`, `p-388.jpg`, `p-391.jpg`, `p-393.jpg`
(`.claude/jobs/32ed678c/tmp/ableton-images/ch18/`). Engine/GUI claims read directly from
`ui/src/audio/engine.ts`, `ui/src/components/MixerView.tsx`, `src/core/document.ts`, and
`ui/src/state/store.ts` on this repo's current `main`, cross-referenced against
`docs/volume-fader-bugfix.md`, `docs/product-roadmap.md`, `docs/decisions.md`, and `ROADMAP.md`.

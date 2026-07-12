# Research 66 — Ableton Live 12 vs. dotbeat: Clip Envelopes / Automation, a direct feature & UI comparison

*2026-07-12. Grounded in Ableton Live 12 Reference Manual chapter 26 "Clip Envelopes" (pp.494-506,
text at `docs/research/47-ableton-clip-envelopes.md`'s source extract, plus 13 chapter screenshots
viewed directly this pass — pp.494-506 inclusive) and direct reads of dotbeat's own source
(`src/core/document.ts`, `src/core/edit.ts`, `ui/src/audio/engine.ts`,
`docs/phase-20-automation-lanes.md`, `docs/product-roadmap.md`). This doc does NOT re-derive
research 47's findings — it cites them where load-bearing and otherwise stands on its own reading
of the manual images and the code. No code was written or modified.*

**Relationship to research 47**: research 47 is a primer that reads chapter 26 top-to-bottom and
maps each section onto dotbeat's model, flagging a real engine bug along the way (automation/LFO
clobbering — see §3 below). This doc is a different artifact: a structured, decision-oriented
feature/UI comparison table with explicit priorities, meant to sit next to `docs/product-roadmap.md`
as an input to sequencing. The clobbering bug is **independently re-verified in §3** by reading the
current `ui/src/audio/engine.ts` directly (not assumed from research 47), because the task calling
for this doc treats it as more urgent than any feature gap below.

---

## 1. Feature & UI/UX comparison

### a) Shared features / parity

| Area | Ableton (manual citation) | dotbeat (file:line) |
|---|---|---|
| Clip-scoped envelope model | A clip's envelopes are private to that clip; the same underlying sample/pattern can be reused by many clips with different envelopes [manual p.495, "Clip Envelopes are Non-Destructive"] | `BeatClip.automation: BeatAutomationLane[]` is deliberately clip-scoped, never track-level (`src/core/document.ts:548`, `docs/format-spec.md:399`) |
| Parameter picker scoped to what's automatable | Device chooser (Clip / effects / mixer) + Control chooser, both LED-annotated [manual p.494] | Per-track "add lane" picker over `AUTOMATABLE_SYNTH_PARAMS` (all numeric SYNTH_FIELDS) for synth/drum tracks, `AUDIO_AUTOMATABLE_PARAMS=['gain']` for audio tracks (`src/core/document.ts:533,989-992`); UI in `ArrangementView.tsx` (`docs/phase-20-automation-lanes.md` §1) |
| Auto-discoverability of already-automated params | LED next to any Device/Control chooser entry with an altered envelope; "Only show adjusted envelopes" filter [manual p.494-495] | "Params that already carry points on the track's clip show as lanes automatically (no need to open the picker)" (`docs/phase-20-automation-lanes.md` §1) — same discoverability goal, no literal LED glyph |
| Breakpoint editing: click-add, drag-move, delete | Deactivate Draw Mode; drag points, horizontal displacement to smooth steps [manual p.496]; right-click/Ctrl+Backspace = Clear Envelope [manual p.495] | Canvas-rendered lane: click empty space adds a point, drag moves it, alt-click removes it (`docs/phase-20-automation-lanes.md` §2); last-point removal drops the `auto` block entirely (canonical elision) |
| Clip-local Start/End/Loop/Position/Length/Signature panel | Visible on every Clip View panel regardless of envelope state [manual p.494 screenshot] | `BeatClipLoop` (`start`/`end`, clip-local bars) and `BeatTimeSignature` (`src/core/document.ts:456-479`), both `null` = inherit, same canonical-elision discipline as v0.3 synth fields |
| Non-destructive by construction, no baking required to hear a shape | "Live calculates the envelope modulations in real time" [manual p.495] | Automation is read every scheduling tick via `interpolateAutomation` against the live document — no bake/render step needed to hear it (`ui/src/audio/engine.ts:3329-3352`) |
| At least one parameter where automation and a secondary modulation source compose correctly, "in harmony" rather than fighting | The chapter's central worked example: automation (absolute) + modulation (relative) combine without clobbering [manual p.498] | **`cutoff` only**: clip automation sets `baseCutoff` (absolute layer), either LFO multiplies around it (`ui/src/audio/engine.ts:3296-3314`) — a real, working instance of the same absolute-base/relative-offset composition rule, generalized nowhere else (see §3) |
| Audio-clip gain as a first-class automatable parameter | Clip Gain envelope, §26.2.3 [manual p.497] | `gainAuto`/`AUDIO_AUTOMATABLE_PARAMS=['gain']` reuses the same lane/point grammar unchanged (`src/core/document.ts:527-533`; applied at `ui/src/audio/engine.ts:3264,3271-3274`) |
| "Swap sample, keep the shape" workflow | Drag a new sample onto an envelope-laden clip; every envelope survives, only the sample changes [manual p.498, §26.2.5] | `setClipAudioRegion` changes only `media`, leaving `automation` untouched by construction (`src/core/edit.ts:1233-1254`) — core-complete; no dedicated GUI affordance framed this way yet (thin gap, not a missing capability) |

### b) In Ableton, not in dotbeat

1. **Relative "Modulation" envelope type, distinct from absolute "Automation"** — a second envelope
   kind per parameter (blue vs. red, LED-differentiated) whose output is *added to* or is a
   *percentage of* the current knob position rather than replacing it outright [manual p.498-499,
   screenshot p.499's Automation/Modulation toggle]. dotbeat has exactly one envelope kind per
   parameter, and it is always absolute (`interpolateAutomation` returns the raw stored value,
   written directly via `linearRampToValueAtTime` — `ui/src/audio/engine.ts:3331-3352`).
2. **Knob-position-dependent modulation range for Pan** — centered pan gives full hard-left-to-
   hard-right modulation headroom; panned hard to one side leaves zero headroom [manual p.502,
   §26.3.2]. A geometrically nontrivial rule with no dotbeat equivalent (dotbeat's `pan` automation
   is a flat absolute value, `ui/src/audio/engine.ts:3335`).
3. **Two independently-modulatable volume targets per track: Clip Gain (pre-effects) vs. Track
   Volume (post-effects/mixer gain stage)** [manual p.500, §26.3.1], with a live "modulated value"
   dot on the mixer fader tracking the composed result [manual p.501 screenshot]. dotbeat has one
   `volume` synth field and one automatable `volume` lane per track — no pre/post-FX split for
   synth/drum tracks (audio tracks do have a separate `gainDb`+`gain` lane, which is closer, but
   that's clip-level content gain, not a second mixer-stage target).
4. **A clip envelope's own local loop/region length, unlinked from the clip's own sample loop**
   [manual p.503-506, §26.5 — the chapter's longest, most novel section: long shapes over short
   loops, short rhythmic-gating shapes over long samples, hidden-grid unsynced LFO shapes, all via
   one mechanism]. `BeatAutomationLane` has no loop-range field at all; per
   `docs/phase-20-automation-lanes.md`, a drawn curve is rendered "tiled every `loopBars*16` steps
   to match the engine's playback tiling" — always locked to the clip's own period, no override.
5. **Sample Offset envelope ("beat scrambling")** — tape-head-style read-position modulation, ±8
   sixteenths, available only in Beats Warp Mode [manual p.497-498, §26.2.4, screenshot p.498].
   Blocked on dotbeat's own `'complex'`/beats-mode warp support, which doesn't exist yet
   (`src/core/document.ts:481-486`, `WarpMode = 'off' | 'repitch' | 'complex'`, `'complex'`
   declared-but-unimplemented).
6. **Curve-shape control per breakpoint: Draw Mode (stepped) vs. line-segment/breakpoint mode**, an
   explicit uniform toggle across every envelope type [manual p.495-496, screenshot p.496 showing
   the same transposition data as steps vs. ramps]. dotbeat's automation points are breakpoints
   only, connected by straight linear ramps — no stepped/hold drawing mode, and no per-point
   interpolation field at all (`BeatAutomationPoint`'s own doc comment: "no interpolation field
   (curve shape — linear vs hold — is deferred)", `src/core/document.ts:438-446`). This is also
   already tracked, independent of this pass, as `docs/product-roadmap.md`'s "Curved segments" row
   (⬜ Not started).
7. **MIDI Controller clip envelopes** — raw CC data (up to controller 119) exposed as a drawable
   envelope, whether recorded or imported from a `.mid` file [manual p.503, §26.4, screenshot]. Not
   applicable yet: dotbeat has no MIDI import path and no CC concept in `BeatNote` at all.
8. **Two-tier Device/Control chooser UI**, including "Only show adjusted envelopes" as an explicit
   filter toggle on *both* choosers [manual p.494-495]. dotbeat's picker is a single flat `<select>`
   of automatable params for the track's kind (`docs/phase-20-automation-lanes.md` §1) — functionally
   close (already-automated params surface as lanes automatically) but with no literal LED badge or
   filter control in the picker itself.
9. **Warp-marker-linked envelope timing** — in "Linked" mode, an envelope's timing stretches/
   compresses automatically when a Warp Marker moves, and Warp Markers are editable from inside the
   envelope editor itself [manual p.505-506, §26.5.5, screenshot p.506]. Not applicable yet: dotbeat
   has no warp markers (`BeatAudioWarpMarker` is schema-reserved only, `src/core/document.ts:495-505`,
   always `[]`).

### c) In dotbeat, not in Ableton

1. **Automation as literal, git-diffable text.** An Ableton envelope lives inside gzipped/binary
   `.als` state; a dotbeat automation point is a plain line reading as "cutoff is 548.8 Hz at this
   instant" with no external context needed (research 47 §6.3). This is the whole point of the
   project (`ROADMAP.md` §4) and has no Ableton analog by design, not oversight.
2. **CLI- and MCP-editable automation as a first-class, scriptable primitive.** `beat automate
   <file> <track> <clip> <param> <time> <value>` (`cli/beat.mjs:133,918`) and the `beat_automate`
   MCP tool (`src/mcp/server.ts:453-472`) both drive the exact same `setAutomationPoint` core
   primitive (`src/core/edit.ts:1149`) the GUI uses. An agent can draw an envelope without touching
   a mouse; Ableton's envelope editor has no headless/scriptable equivalent.
3. **One universal automation grammar spanning structurally different clip kinds.** The same
   `BeatAutomationLane`/`BeatAutomationPoint` shape automates ~54 synth params on synth/drum tracks
   *and* audio-region gain on audio tracks (`src/core/document.ts:527-533`) — Ableton, by contrast,
   presents genuinely different Device-chooser trees per clip type (Clip/effects/mixer for audio;
   MIDI Ctrl/devices/mixer for MIDI) [manual p.494, §26.1]. dotbeat's version is less discoverable
   as a picker UI but structurally simpler as a format.
4. **Absolute-only automation as a deliberate, documented tradeoff, not an oversight.** Every
   dotbeat clip-automation value is absolute, matching Ableton's "Automation" (never "Modulation")
   flavor even for parameters Ableton itself would model as relative (gain, pan, sends). Research 47
   §6.3 argues this is *more* diff-legible than a relative model would be, and this doc concurs —
   listed here as a real, considered divergence worth defending, not porting away from.

---

## 2. Prioritized recommendations

**Read this table together with §3 below — §3 is not a row here on purpose. It is a correctness
bug in code that already exists, not a feature gap, and it is the single most urgent item in this
entire document.**

| Feature | Priority | Build recommendation |
|---|---|---|
| §1b.4 — Unlinked clip-envelope loop length (long shape/short loop, short shape/long clip, hidden-grid LFO shapes) | **P1** | Additive schema field on `BeatAutomationLane`, mirroring the exact `BeatClipLoop \| null` pattern already used twice (`src/core/document.ts:456-467`): e.g. `loop: { start: number; end: number } \| null`, absent = today's behavior (locked to the clip's own tiling period). Engine change is localized to the tiling math already in `ui/src/audio/engine.ts`'s `contentOf`/automation-read path (§3300-3352) — read the lane's own loop window instead of the clip's when present. No format version bump beyond one optional field. Research 47 §6.2 already scoped this in detail; add it as its own `docs/product-roadmap.md` Automation row per that doc's own recommendation. |
| §1b.6 — Curved segments (per-point hold/linear/curve interpolation) | **P1** | Already an open `docs/product-roadmap.md` row ("Curved segments," ⬜ Not started) — this pass corroborates it directly against the manual's Draw-Mode-vs-breakpoint screenshots (p.496). Add an `interpolation: 'linear' \| 'hold'` field to `BeatAutomationPoint` (`src/core/document.ts:442-446`), default `'linear'` so existing files round-trip byte-identical (canonical elision, same discipline as every other v0.9/v0.10 optional field). `interpolateAutomation`'s ramp choice becomes conditional on the *preceding* point's interpolation field. Don't add a separate Draw-Mode toggle for authoring — see the P2 row below for the cheaper path to the same authoring UX. |
| §1b.8 — LED-style "already automated" indicator + "only show adjusted" filter in the param picker | **P2** | Cosmetic/discoverability polish on top of an already-working mechanism (already-automated params surface as lanes automatically, per `docs/phase-20-automation-lanes.md` §1). Add a small dot/badge to picker `<option>`s whose param already has a non-empty lane on the track's other clips, and a checkbox to hide unautomated options — pure `ArrangementView.tsx` UI work, no core/format change. |
| §1b.6 (authoring UX half) — stepped "paint" gesture as an alternative to click-and-drag breakpoints | **P2** | Do NOT port Ableton's separate Draw-Mode/breakpoint-mode toggle. Reuse the pattern dotbeat already shipped for the per-note chance lane — "one continuous drag paints every note the pointer sweeps over to the same probability" (Phase 23 Stream BA, `docs/research/22-opendaw-editing-workflow.md` §1.4's `PropertyDrawModifier`). Apply the identical drag-paint interaction to the automation canvas in `ArrangementView.tsx`; same visual language the user already learned, far less code than a real mode toggle. |
| §1c.1 (GUI half) — "swap sample, keep envelope" as a named, discoverable action | **P2** | Core primitive (`setClipAudioRegion`, `src/core/edit.ts:1233-1254`) already does the right thing; add a small "Replace sample" affordance in the audio-clip inspector that calls it directly, so the behavior is discoverable without already knowing the core supports it. |
| §1b.5 — Sample Offset envelope ("beat scrambling") | **P2, sequence AFTER beats-mode warping** | Do not build before `WarpMode: 'complex'`/beats-mode transient work lands (`docs/research/25-audio-warp-markers-stretch.md`, `docs/research/26-beats-mode-transient-slicing.md`, both currently ⬜ Not started). Once it does: add `'sampleOffset'` to `AUDIO_AUTOMATABLE_PARAMS` (`src/core/document.ts:533`) — reuses `BeatAutomationLane` completely unchanged, per research 47 §6.4's already-scoped recommendation. Only new work is the engine's per-tick read-position offset interpretation, bounded to whatever range beats-mode ends up using. |
| §1b.1 — Relative "Modulation" envelope type (second envelope kind per param, LED red/blue split) | **Do-not-recreate** | Research 47 §6.3's conclusion, endorsed here: an absolute-only automation model is *more* diff-legible than Ableton's relative model (`point p1 8 548.8235` is self-contained; a relative point is only meaningful alongside a knob position stored elsewhere) — directly serves D9/D1's document-only, literal-data philosophy. Building a second, relative envelope type would be working against dotbeat's own stated goals for a parity checkbox with no format-level payoff. If the *composition-with-LFO* behavior is what's actually wanted, that's §3 below, not this. |
| §1b.2 — Knob-position-dependent Pan modulation range | **Do-not-recreate** | A direct consequence of the relative-modulation model above; inherits the same reasoning. Skip unless the relative model itself is ever revisited (it shouldn't be, per D9/D1). |
| §1b.3 — Separate Clip Gain (pre-FX) vs. Track Volume (post-FX) modulation targets | **Do-not-recreate for synth/drum tracks; already effectively present for audio tracks** | Audio tracks already have the closer analog (`gainDb`+`gain` lane = clip-level content gain, distinct from the track's post-chain `volume`). For synth/drum tracks, a pre/post-FX volume split is real mixer-architecture surface area for a parameter most producers reach for once; not worth the schema/engine complexity unless a concrete use case surfaces. Revisit only if user feedback specifically asks for "automate gain before my inserts, separately from the track fader." |
| §1b.7 — MIDI Controller clip envelopes | **Do-not-recreate now — blocked, not declined** | No MIDI import path exists anywhere in `src/`/`cli/` (confirmed research 47 §6.5). Pointless to scope CC-envelope UI before MIDI import itself is a real roadmap item. Revisit only after MIDI import is scoped. |
| §1b.9 — Warp-marker-linked envelope timing | **Do-not-recreate now — blocked, not declined** | Depends entirely on warp markers existing (`BeatAudioWarpMarker`, currently schema-only, always `[]` — `src/core/document.ts:495-505`). Not independently schedulable; folds into whatever stream eventually builds `docs/research/25-audio-warp-markers-stretch.md`. |

---

## 3. Correctness bug, independently re-verified: clip automation and LFOs clobber each other on every shared parameter except `cutoff`

**This is a bug in shipped engine code, not a missing feature — it belongs above every P1/P2 row
in this document.** Flagged by research 47 §6.1; re-confirmed here by an independent read of the
current `ui/src/audio/engine.ts` on `main` (not assumed from the prior pass).

**The mechanism.** Every tick, dotbeat's scheduler does two separate passes over the same track's
parameters:

1. **Generic clip-automation pass** (`ui/src/audio/engine.ts:3329-3352`) — for every automated
   param except `cutoff`/`duckAmount`, writes the interpolated automation value directly:
   `chain.filter.Q.linearRampToValueAtTime(val, rampTime)` for `resonance`,
   `chain.panner.pan.linearRampToValueAtTime(val, rampTime)` for `pan`, and so on for `volume`,
   `sendReverb`, `sendDelay`, `eqLow/Mid/High`, `compMix`, `distortionMix`, `bitcrushMix`.
2. **LFO additive pass**, `applyLfoAdditive` (`ui/src/audio/engine.ts:3362-3387`, invoked at
   `3386-3387` — strictly *after* pass 1 in the same tick) — for the same destination set, writes
   `p.<key> + depth*lfo`, i.e. relative to the **static field value on the document**, never to
   whatever pass 1 just computed.

Because pass 2 runs later in the same tick and both passes call `linearRampToValueAtTime` on the
identical `AudioParam`, **the later write wins outright** — there is no summing, no blending, just
overwrite. On any tick where a clip-automation lane and an LFO target the same parameter, the
automated value is silently discarded for that tick. This is the literal opposite of the "harmony"
model the manual centers its own chapter around: *"the two types of envelopes work together in
harmony"* [manual p.498].

**Verified: only `cutoff` composes correctly, and it composes correctly precisely because it does
NOT follow the generic two-pass pattern.** `cutoff`'s automation and LFO logic
(`ui/src/audio/engine.ts:3296-3314`) is hand-written as a single, ordered computation: automation
sets `baseCutoff` first, then either LFO multiplies *around* that base
(`baseCutoff * Math.pow(2, p.lfoDepth * lfo)`) — and only if *neither* LFO targets cutoff does the
code fall back to writing the plain automated value. This is exactly Ableton's absolute-base/
relative-offset composition rule [manual p.498], just implemented once, by hand, for one parameter,
and never generalized.

**Also verified: the behavior is inconsistent across parameters, not just broken in one direction.**
`volume`/amp is a third, distinct case: the LFO-amp branch (`ui/src/audio/engine.ts:3315-3320`) runs
*before* the generic automation loop (`3329-3352`), so for `volume` specifically, **automation wins
over the LFO** — the opposite bug from every other shared parameter. Concretely, as of this read:

- **`cutoff`**: correct multiplicative composition (automation base + LFO offset). ✅
- **`volume`/amp**: automation overwrites the LFO (automation-wins). Not harmony, but at least
  automation isn't silently discarded.
- **`resonance`, `pan`, `sendReverb`, `sendDelay`, `eqLow`, `eqMid`, `eqHigh`, `compMix`,
  `distortionMix`, `bitcrushMix`**: the LFO overwrites automation every tick it's active
  (LFO-wins). This is the actively silent-data-loss direction — a user or agent draws an automation
  curve, it's stored correctly in the `.beat` file, it's simply never heard while an LFO also
  targets that parameter.

None of these three behaviors is a documented or intentional design choice — per research 47, "it
falls out of code order," and this pass's independent read confirms that characterization exactly.

**Why this is P0, ranked above every feature-gap row in §2.** A drawn automation curve that
silently doesn't play back — while the `.beat` file on disk correctly records the intended curve —
is a trust-breaking bug for a project whose entire premise is "the file is what you hear." It's also
asymmetric with effort: research 47 already scoped the fix precisely (generalize `applyLfoAdditive`
to read `(automated value if present, else p.<key>) + depth*lfo`, exactly `baseCutoff`'s existing
pattern), confined to one function (`ui/src/audio/engine.ts:3362-3387`), no format change. This is
the cheapest, highest-leverage fix available in the entire automation surface — cheaper than any P1
feature row above — and should be scheduled before them, not alongside them.

**Recommended regression coverage**: a live-verification test (in the style of
`ui/verify-phase20-automation.mjs`) asserting that a clip with both an automation lane and an LFO
on the same non-cutoff destination produces a rendered value that *oscillates around* the automated
curve at each tick, not one that flatlines to the LFO's static-value-relative output — the same
property `phase-20-automation-lanes.md`'s own Z-series checks already verify for automation alone.

---

## Sources

- Ableton Live 12 Reference Manual, chapter 26 "Clip Envelopes", pp.494-506 — text via
  `docs/research/47-ableton-clip-envelopes.md`'s source extract; 13 chapter screenshots
  (`p-494.jpg` through `p-506.jpg`) viewed directly this pass.
- `docs/research/47-ableton-clip-envelopes.md` — prior primer pass, cited where load-bearing.
- dotbeat source, read directly this pass: `src/core/document.ts`, `src/core/edit.ts`,
  `ui/src/audio/engine.ts`, `cli/beat.mjs`, `src/mcp/server.ts`.
- `docs/phase-20-automation-lanes.md`, `docs/product-roadmap.md` (Automation section).

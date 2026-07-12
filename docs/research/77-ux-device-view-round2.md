# Research 77 — Device View, round 2: what Phase 27 fixed, what's still gapped, what's newly visible

*2026-07-12. Owner-commissioned round 2 of the implementation-level Device View pass, following
[72](72-ux-device-view.md) (round 1) and [`phase-27-plan.md`](../phase-27-plan.md) (the build that
shipped against it). Phase 27 Stream EA fixed two of research 72's four "fix first" bugs on this
surface — knob-group render order now follows `track.effects`' real chain order instead of
`synthParams.ts`'s fixed `PARAM_GROUPS` array, and instrument tracks now get a real Macro row +
Preset-equivalent (`SoundfontPicker`) instead of nothing. Stream EH moved the effect-row bypass
toggle to a leading, Ableton-Activator-style filled/hollow circle, physically separated from the
destructive ✕ remove button. Stream EI made `Knob.tsx`'s value display a real click-to-type field.
This doc does not re-flag any of that — all four are re-verified live below, working together, in
one pass, against the actual running app. It exists to find what's still gapped or newly visible now
that those fixes are live, per the same implementation-level discipline as round 1: real screenshots
on both sides, not prose-only feature-presence claims.*

**Grounding.** Ableton side: 6 fresh screenshots read this pass from chapter 23 pages round 1 skipped
(pp.440, 453-455, 458, 460 of 428-460) plus 2 already-viewed pages (437, 438) re-read for detail round
1's own text didn't surface, and 4 fresh screenshots from chapter 24 (pp.473-475, 477) for the Macro
Control mapping workflow specifically — `/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch23/`
and `ch24/`. Chapter text (`ch23.txt` §23.2.2/23.2.4, `ch24.txt` §24.7) cross-referenced. dotbeat side:
9 fresh screenshots taken this pass against a real `beat daemon` (port 9205) + real built frontend
(`vite preview`, port 9206) in headless Chromium (Playwright), stored in
`/tmp/dotbeat-ux2-device/r2-{1..9}*.png`, on a scratch copy of `examples/night-shift.beat`
(`/tmp/dotbeat-ux2-device/song.beat`, `night-shift-song.beat` never touched), extended via the real
CLI with an instrument track (`keys`, GM soundfont) and doubled-up effect instances on `lead`
(`eq3`/`comp`/`distortion`/`bitcrush` each added twice, then reordered) specifically to stress-test
the round-1-fixed reorder logic and the still-open "duplicate effect type" gap live. Direct reads of
`ui/src/components/SynthPanel.tsx`, `InstrumentPanel.tsx`, `Knob.tsx`, `synthParams.ts`, and the
relevant `styles.css` blocks (`.effect-bypass`, `.macro-row`) as of this session's `main`.

---

## 1. Fresh Ableton detail round 1 missed

### 1.1 Device A/B Comparison — a whole capability round 1 never saw

`[manual p.437]`, §23.2.2: **every built-in Live device carries two independent parameter-value
states, A and B.** Loading a device seeds both from the same defaults; the instant you touch a
parameter, state A diverges while B silently keeps the original values. `Compare: Switch to B`
(context menu, Edit menu, or the `P` key) flips which state is live; when B is selected, a literal
**"(B)"** suffix appears next to the device's name in its own title bar (`[manual p.438]`, screenshot
"The B Device State" — `Auto Pan-Tremolo (B)` rendered as its own bordered device card, structurally
identical to the A card next to it, distinguished only by that suffix). `Compare: Copy A to B` lets
you seed B from A's current values rather than the original defaults. Two consequences worth noting
for anyone eventually scoping this against dotbeat: (1) **automation is disabled on state switch** —
any parameter automation drawn under A is silently suspended the instant you switch to B, and does
NOT re-enable itself switching back to A; a dedicated `Re-Enable Automation` context-menu command
(`[manual p.440]`) is required, positioned right below `Show Automation`/`Show Automation In New
Lane` in that menu; (2) the Compare commands are explicitly **not available for Racks, Max for Live
devices, or plug-ins** — built-in Live devices only.

This is a real, useful "try two variants of one device's tuning without leaving the device" workflow
that neither research 44 nor 63 nor round 1 (72) mention at all — not a duplicate finding. dotbeat has
no per-device analog and, per D9 ("presets are tooling, never in-file indirection") and dotbeat's own
structurally different safety net, probably shouldn't build a literal A/B toggle — but it's worth
naming explicitly rather than leaving unrecorded, the same way research 65 named Ableton's
automation-override-suspend behavior as "parked, dotbeat's undo/redo/checkpoint/history already covers
this at a coarser, arguably more useful grain" rather than silently dropping it. See §4 P2.

### 1.2 The full per-device context menu, read directly (not summarized from running text)

`[manual p.438]`, the actual context-menu screenshot for `Auto Pan-Tremolo`, in order: **Cut** (⌘X),
**Copy** (⌘C), **Duplicate** (⌘D), — divider — **Rename** (⌘R), **Edit Info Text**, — divider —
**Delete**, **Group** (⌘G), **Fold**, ✓**Show Preset Name**, — divider — **Copy Max for Live Path**,
— divider — **Compare: Switch to B** (P), **Compare: Copy A to B**, — divider — **Save as Default
Preset**. `[manual p.440]`'s context menu (mid-automation-editing state) additionally shows: **Show
Automation**, **Show Automation In New Lane**, **Re-Enable Automation**, **Show Modulation Source 1:
Clip Envelope**, **Return to Default** (Del), **Delete Automation** (⌘Del), **Edit MIDI Map** (⌘M),
**Edit Key Map** (⌘K), **Copy Parameter Name**. dotbeat's roadmap already tracks a per-device context
menu generically (`docs/product-roadmap.md` "Per-device context menu (rename, duplicate,
save-as-default)," Core effects area) — this is that item's citation getting sharper, not a new item:
`Edit MIDI Map`/`Edit Key Map` have no dotbeat equivalent (no live MIDI-mapping surface exists),
`Copy Max for Live Path` is Ableton-specific plumbing with no dotbeat analog, and the automation
commands are gated behind clip automation existing on that parameter — none of these change the
roadmap item's existing rename+duplicate recommendation, they just confirm nothing else in this list
clears a bar the roadmap doesn't already argue against building.

### 1.3 Sidechain parameters: a real expandable device sub-view, exactly the kind Part 1 asked about

`[manual pp.453-454]`, §23.3.2: **plug-in devices that support sidechaining show a collapsible
left-edge column** — a thin vertical "Sidechain" label with a small circle toggle, expanding into its
own bordered sub-panel containing: a routing chooser ("No Input" / any internal routing point), a
second text field below it, a **Gain** knob (dB), a **Mix** knob (0-100%, "how much sidechain vs.
original signal acts as the trigger"), and a **Mute** button ("listen to only the plug-in device's
output, bypassing the sidechain source's input"). This is the concrete visual for the
"expandable device sub-view" pattern the task asked about, distinct from Auto Filter's own inline
"Sidechain" toggle strip visible in its title-bar column (`[manual p.437]`, a small vertical label +
circle on the device's far-left edge, separate from the Frequency Display expand-triangle already
documented in round 1). dotbeat has no real audio-triggered sidechain today — `duckSource`/
`duckAmount` is a scheduled per-step volume dip, not an envelope follower — and the roadmap already
tracks the actual feature gap (`Gate`, Mixing area, research 67, "full Threshold/Return/Attack/
Hold/Release/Floor... full EQ'd external sidechain"). Filed here only as implementation-reference
detail for whenever Gate is built: model its sidechain sub-panel on this exact Gain/Mix/Mute/routing
shape rather than re-deriving it from scratch. See §4 P2.

### 1.4 Device Delay Compensation — real, but does not translate to dotbeat's architecture

`[manual p.460]`, §23.6, text only (no screenshot in this chapter's range): delay compensation is
automatic and on by default; a track's `Options` menu exposes a manual toggle plus a "Reduced Latency
When Monitoring" option that trades sync accuracy for lower live-input latency; per-track manual delay
controls are unavailable whenever compensation is switched off. This entire mechanism exists to solve
a **live-monitoring/real-time-input latency problem** — dotbeat has no live audio input, no real-time
monitoring path, and renders offline; there is no analogous "some devices in this chain report
non-zero latency, compensate or don't" problem for dotbeat to solve. Recorded here explicitly as **not
a gap** — the discipline research 72's own delay-compensation silence left ambiguous — rather than
left for a future pass to wonder if it was missed.

### 1.5 Macro Control mapping UI (ch.24 pp.473-475, 477) — the workflow research 27 already scoped, seen for the first time

`presets/macros.json`'s 8 factory macros are Phase 26's entire macro surface — there is no GUI (or
CLI) path to define a 9th macro or redefine what `grit` targets. Research
[27](27-macro-tooling-layer.md) §7 already named this explicitly (**"User-authored 'save this as a
macro' (Ableton's Map-Mode equivalent)"**) and deliberately deferred it, with a real sequencing
reason: dotbeat has no "save a new preset" feature yet either (`docs/product-roadmap.md`'s "User
Library (cross-project preset save)" row is still `❌ missing`), and building macro-saving before
preset-saving exists would build the harder version of a capability the easier version doesn't have
yet. **This section is not reopening that decision** — it's recording the concrete Ableton UI research
27 never had screenshots for, so whenever preset-saving unblocks this, the build stream doesn't have
to re-derive the interaction from prose:

- A **Rand** and **Map** button pair sits in the Rack's own title bar (`[manual p.474]`, next to the
  Rack name) — Map is a toggle; enabling it does three things at once: every mappable parameter on
  every device in the Rack gets a colored overlay tint, a small **Map** button appears directly
  beneath every visible Macro Control's dial (`[manual p.474]` screenshot "Making Macro Control
  Assignments in Map Mode" — each of the 8 macro cards grows a `Map` button under its knob/value), and
  a dedicated **Mapping Browser** panel opens.
- The gesture: click a device parameter once to select it (its overlay highlights), then click any
  Macro Control's `Map` button to bind them — the macro instantly takes that parameter's own name and
  units as its display label (only reverting to a generic "Macro N" name once a *second*, differently-
  unit'd parameter is also bound to it, `[manual p.475]`).
- The **Mapping Browser** (opens only while Map Mode is active) is where **Min/Max range** and
  **Invert Range** (right-click a mapping entry) live — this is the pp.474-475 "min/max/curve per
  mapping" the roadmap's existing Macro tooling layer row already cites; now grounded in the actual
  panel it lives in, not just the page number.
- `[manual p.477]`, §24.7.3 "Macro Control Variations": a separate view (its own selector button)
  lets you snapshot/name/launch different states of a Rack's macro knobs, shown as a "Variation 1/2/
  3/4" list with New/Launch/Overwrite controls. **Research 27 already recommended explicitly NOT
  building this** — once a macro resolves immediately to literal target values (dotbeat's confirmed
  design, no stored knob-position truth), "macro X at position 70" is byte-for-byte the same
  information as a preset snapshot of the resolved params, so preset-saving (once it exists) already
  gives this workflow for free without a second, redundant snapshot system. Having now seen the actual
  panel, that reasoning still holds — filed here as confirmation, not a reopened question.

---

## 2. dotbeat's current Device View — Phase 27's fixes, verified together live

Screenshots: `/tmp/dotbeat-ux2-device/r2-1-synth-lead-full.png` (full panel, "lead," reordered +
doubled chain), `r2-2-synth-lead-effectchain-zoom.png`, `r2-3-synth-lead-macro-zoom.png`,
`r2-4-knob-click-to-type.png`, `r2-5-instrument-keys-full.png`, `r2-6-instrument-keys-macro-zoom.png`,
`r2-7-drums-full.png`, `r2-8-drums-macro-zoom.png`. Fixture built via real CLI calls: `keys` added as
an `instrument` track (GM soundfont, program 73), `lead` given a *second* eq3/comp/distortion/bitcrush
set (`eq3_2`/`comp_2`/`distortion_2`/`bitcrush_2`) then reordered so `bitcrush` (not `bitcrush_2`)
leads the chain, `keys` given `distortion`+`eq7`.

### 2.1 Bug 3 (knob-group order) and Bug 4 (instrument macro/preset) — confirmed working, together, live

Reading the DOM directly (not inferring from a screenshot): after reordering `lead`'s chain to
`bitcrush, eq3, comp, distortion, eq3_2, comp_2, distortion_2, bitcrush_2`, the rendered knob-group
order is `osc, filter, velkeymod, lfo, amp, pingpong, beatrepeat, chorusphaser, saturator, sends,
sidechain, bitcrush, eq3, comp, distortion` — core (no-`effectType`) groups first as documented, then
every `effectType` group in exactly the chain's own order. Bug 3 is real and correctly implemented.
`r2-5-instrument-keys-full.png` confirms Bug 4 live: the "keys" instrument-track panel now shows
`SOUNDFONT` picker → soundfont program/volume/pan knobs → a real `MACROS` row → `EFFECT CHAIN`
(`distortion`, `EQ7 (Parametric)`) → the matching knob groups below — the "straight from SOUNDFONT to
EFFECT CHAIN, no macros anywhere" gap research 72 found is gone.

### 2.2 The leading bypass Activator does NOT visually compete with the reordered knob groups

The task asked directly whether Stream EH's leading bypass dot now competes for attention with Bug
3's reordering fix. Verified live (`r2-2-synth-lead-effectchain-zoom.png`): it doesn't, because
they're not in the same visual field at the same time — the Effect Chain list (with its 8 leading
dots, one per row) and the knob-group wall are still two structurally separate, vertically stacked
`.effect-chain` / `.param-groups` sections (research 72 §2.1's "structural split" finding — Phase 27
fixed *order*, not the split itself, and the roadmap's "Chain-list/knob-wall single-row UI
unification" row already tracks the split as a known, deferred, bigger rewrite). The 8 orange dots
read as a clean, repeated left-edge rhythm down the chain list; nothing about them draws the eye away
from the knob wall below, because scrolling separates the two moments in time, not competing for the
same screen region.

### 2.3 A new, sharp gap Bug 4's own fix exposes: the instrument-track Macro row is real but nearly empty

This is the sharpest new finding this round. `r2-6-instrument-keys-macro-zoom.png`, captured live off
the actual "keys" instrument track: the Macro row renders exactly **one** knob — `SPACE` (value 0) —
next to a wide stretch of empty background. Compare the same row on `lead`
(`r2-3-synth-lead-macro-zoom.png`, 6 knobs: filter-sweep/grit/space/warmth/motion/width) or `drums`
(`r2-8-drums-macro-zoom.png`, 3 knobs: space/punch/snap). The lone-knob instrument row reads, at a
glance, like something failed to load — not like a deliberate "instrument tracks get fewer macros"
design choice, because nothing in the UI explains why 7 of 8 factory macros vanished.

The root cause, read directly from `SynthPanel.tsx`'s `MacroRow` (`:462`) and `presets/macros.json`:
`MacroRow` filters candidate macros by `m.kind === track.kind || m.kind === 'any'` — for an
`instrument`-kind track, only macros literally tagged `kind: 'instrument'` (there are none in the
factory set) or `kind: 'any'` (only `space`, targeting `sendReverb`/`sendDelay`) survive. But
`isParamLegalForKind` (`synthParams.ts:508-511`) — the function `MacroKnob`'s own `onChange` already
calls to *silently skip* illegal targets per-param — uses a completely different, more precise test:
whether the target param belongs to a `PARAM_GROUPS` group whose `kinds` array includes `'instrument'`.
By that test, `grit` (targets `distortionAmount`/`distortionMix`/`bitcrushBits` — the `distortion` and
`bitcrush` groups both list `kinds: ['synth', 'drums', 'instrument']`) and `warmth` (targets
`eqHigh`/`eqLow`/`saturatorDrive`/`saturatorMix` — `eqHigh`/`eqLow` live in the `eq3` group, also
`instrument`-legal) are **both fully or partially legal on an instrument track with a `distortion` or
`eq3` effect in its chain** — exactly the setup `r2-5` screenshots — yet neither ever appears as an
option, because the row-level `kind` gate is coarser than the per-param legality gate the same file
already has and uses one line later in `MacroKnob`. The instrument-track macro row isn't wrong so much
as using the wrong filter — a visible, live-verified inconsistency between two adjacent pieces of the
same feature, not a hypothetical. See §3 P0 item 1.

### 2.4 Click-to-type (Stream EI), confirmed live with a real value commit

`r2-4-knob-click-to-type.png`: clicking a knob's value display swaps it for a real bordered `<input>`
(blue focus ring visible, pre-filled `0.5` for the synth's `WTPOS` field) — exactly the boxed,
distinct-background numeric-entry affordance research 72 §1.3/§2.3 found completely absent from round
1's screenshots. Typing `12.5` + Enter committed through the same `onChange` path the drag gesture
uses (confirmed by reading `Knob.tsx`'s `commitDraft`, not just the screenshot). This closes research
72 P0 item 3 cleanly; no new gap found here this round.

### 2.5 A new, minor cross-panel consistency gap: row order differs between SynthPanel and InstrumentPanel

`SynthPanel.tsx` renders, top to bottom: `PresetPicker` → `MacroRow` → `EffectChain` → knob groups
(`:554-563`). `InstrumentPanel.tsx` renders: `SoundfontPicker` → a soundfont program/volume/pan knob
group → `MacroRow` → `EffectChain` → knob groups (`:189-244`) — the soundfont's own 3-knob param block
sits *between* the picker and the Macro row, an extra section the synth/drums panels don't have at
that position. Live-verified: `r2-1`/`r2-7` (synth/drums) both go straight from their
picker/preset row into `MACROS`; `r2-5` (instrument) goes picker → a full bordered `SOUNDFONT` knob
box → `MACROS`. Not wrong — the soundfont program/volume/pan controls have to live somewhere, and
before the chain makes sense — but it breaks the "picker, then macros, then chain" rhythm the other
two panel kinds now consistently establish, on a page where consistency between three near-identical
components is exactly what a newcomer pattern-matches on. See §3 P2 item 3.

### 2.6 Live-illustrated (not new): duplicate effect-type instances share one knob group, invisibly

Deliberately built into this round's fixture (`lead`'s doubled chain, `r2-2`): with both `eq3` and
`eq3_2` in the chain, only one `EQ3` knob group renders (Bug-3's sort correctly places it at
`eq3_2`'s position via `findIndex`, which always resolves to the *first* matching type — so a knob
group's on-screen position can itself silently point at the wrong instance once duplicates exist).
Turning that one EQ3 knob edits `track.synth.eq*` fields, which both `eq3` and `eq3_2` effect
instances read from identically — there is no per-instance parameter storage. This is exactly
"Multiple independently-parameterized instances of the same effect type," already tracked in
`docs/product-roadmap.md` (Core effects area, research 63) as a known, scoped-out, real-engineering-
lift gap — not re-added here, just confirmed live and worth noting that Bug 3's `findIndex`-based sort
inherits the same "which instance does this knob group actually belong to" ambiguity once that item
ships, a detail for whoever picks it up next.

---

## 3. Prioritized NEW findings (round 2 only — see round 1 for the still-open P1/P2 backlog already in `product-roadmap.md`)

Cross-checked against `docs/product-roadmap.md`'s Core effects and Macros areas; every item below is
either newly discovered this round or a materially sharper version of something not otherwise tracked.

### P0

1. **Fix `MacroRow`'s track-kind filter to use per-target legality (`isParamLegalForKind`), not
   `m.kind === track.kind`.** Concretely: in `SynthPanel.tsx`'s `MacroRow` (`:462`), change the
   `applicable` filter so a macro qualifies if `m.kind === track.kind || m.kind === 'any'` **or** at
   least one of its targets passes `isParamLegalForKind(target.param, track.kind)` — the same test
   `MacroKnob`'s `onChange` already applies per-param one function away. Today this makes instrument
   tracks' Macro row render exactly one knob (`space`) out of 8 factory macros, despite `grit` and
   `warmth` targeting params (`distortionAmount`, `bitcrushBits`, `eqHigh`/`eqLow`) that are fully
   legal once the matching effect is in an instrument track's chain — the row reads as broken, not
   as a deliberate design choice, directly undercutting the Phase 27 Bug-4 fix that just shipped it.
   (§2.3)

### P1

2. *(none new this round beyond P0 item 1 — round 1's own P1 list, e.g. enlarging the Macro row's
   visual weight, remains open and already tracked; this pass found no additional P1-weight gap.)*

### P2

3. **Align `InstrumentPanel.tsx`'s row order with `SynthPanel.tsx`'s** — move the soundfont
   program/volume/pan knob block so the panel reads picker → macros → chain like the other two track
   kinds, with the soundfont knobs folded in as their own group alongside (or just before) the
   `EffectChain`, rather than wedged between the picker and the Macro row. Cosmetic ordering only, no
   data change. (§2.5)
4. **Record Ableton's Device A/B Comparison as a named, deliberately-not-built capability**, the same
   way research 65 named automation-override-suspend: dotbeat's checkpoint/history/undo-redo already
   covers "try a variant, keep or revert" at a coarser project-wide grain, and D9 ("presets are
   tooling, never in-file indirection") argues against a literal per-device A/B toggle. Worth one
   `product-roadmap.md` line under Core effects citing this doc, explicitly marked as covered by
   existing tooling rather than left as an unrecorded gap for a future pass to wonder about. (§1.1)
5. **When the `Gate` effect (`product-roadmap.md`, Mixing area, research 67) is eventually built,
   model its sidechain sub-panel on Ableton's actual shape**: a collapsible left-edge column with a
   routing chooser, Gain knob, Mix knob, and a Mute button — not re-derived from scratch. Pure
   implementation-reference detail attached to an already-tracked item, not a new roadmap row. (§1.3)

---

## Sources

- Ableton Live 12 Reference Manual, chapter 23 "Working with Instruments and Effects" — 6 fresh
  screenshots this pass (pp.440, 453, 454, 455, 458, 460) plus 2 re-read for detail (pp.437, 438):
  `/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch23/p-{437,438,440,453,454,455,458,460}.jpg`;
  chapter text `ch23.txt` §23.2.2 "Device A/B Comparison," §23.2.4 "Hot-Swapping Presets," §23.3.2
  "Sidechain Parameters," §23.6 "Device Delay Compensation."
- Ableton Live 12 Reference Manual, chapter 24 "Instrument, Drum and Effect Racks" — 4 fresh
  screenshots this pass (pp.473-475, 477):
  `/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch24/p-{473,474,475,477}.jpg`; chapter
  text `ch24.txt` §24.7 "Using the Macro Controls" (24.7.1 Map Mode, 24.7.2 Randomizing, 24.7.3
  Variations).
- dotbeat, `main`, this session: `ui/src/components/SynthPanel.tsx`, `InstrumentPanel.tsx`,
  `Knob.tsx`, `synthParams.ts`.
- 9 fresh screenshots of dotbeat's current (post-Phase-27) Device View, taken this pass via
  Playwright (`playwright-core`, headless Chromium) against a real `beat daemon` (port 9205) + real
  built frontend (`vite preview`, port 9206) on a scratch copy of `examples/night-shift.beat`
  extended with a `keys` instrument track and a doubled effect chain on `lead` via the real CLI
  (`night-shift-song.beat` never touched): `/tmp/dotbeat-ux2-device/r2-{1..9}*.png`.
- [`72-ux-device-view.md`](72-ux-device-view.md) (round 1) and [`phase-27-plan.md`](../phase-27-plan.md)
  — read first, both to confirm this doc doesn't re-flag what Streams EA/EH/EI already shipped, and
  for the exact bug numbering/citations reused in §2.
- [`27-macro-tooling-layer.md`](27-macro-tooling-layer.md) §7 — read before writing §1.5/§4 item 4 to
  confirm neither Map-Mode macro-authoring nor Macro Variations is being reopened as a "new" finding;
  both were already explicitly scoped and deferred with reasons that still hold.
- `docs/product-roadmap.md` — Core effects and Macros areas cross-checked before finalizing §3, to
  keep every P0/P1/P2 item here strictly additive to what's already tracked (per round 1's own
  citations plus research 63/64's prior passes).

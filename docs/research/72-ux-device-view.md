# Research 72 — Device View, implementation-level: Ableton's manual vs. dotbeat's real screen

*2026-07-12. Owner-commissioned UI/UX pass, explicitly scoped as different from research
[44](44-ableton-instruments-and-effects.md) and [63](63-ableton-vs-dotbeat-instruments-and-effects.md).
Those two did **feature-presence** comparison — a table of "does X exist in each product." This
doc does **implementation-level visual/interaction** comparison: exact layout, spacing, control
widget anatomy, icon placement, color, and gesture, grounded in the manual's own screenshots on
one side and dotbeat's own rendered pixels + source on the other. It also post-dates two things 44
and 63 could only partially see: `docs/effects-panel-redesign.md` (Phase 25, shipped this session —
the `effectType` gate that hides a knob group until its device is actually in the chain) and
`docs/phase-26-plan.md` Stream DC/DD (shipped this session — instrument/drum tracks got the same
reorderable Effect Chain as synth tracks, and a new Macros row landed). Every dotbeat claim below is
checked against the CURRENT state of `main`, not the pre-Phase-25/26 panel research 44 reviewed.*

**Grounding.** Ableton side: 27 screenshots read directly this pass from chapter 23 ("Working with
Instruments and Effects," pp.428–460, `/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch23/`)
— pp.428–439, 441–452, 456–457, 459 — plus 2 screenshots from chapter 24 ("Instrument, Drum and
Effect Racks," pp.461–462) specifically for the Macro Controls grid, since ch23's own page range
never shows a Rack and the task asked about macro-knob visual grouping. Chapter text
(`ch23.txt`) cross-referenced for a few captions. dotbeat side: 12 fresh screenshots taken this pass
against a real `beat daemon` + real built frontend in headless Chromium (Playwright), stored in
`/tmp/dotbeat-ux-device/screenshot-{1..12}*.png`, plus a direct read of
`ui/src/components/SynthPanel.tsx`, `ui/src/components/InstrumentPanel.tsx`,
`ui/src/components/Knob.tsx`, `ui/src/components/synthParams.ts`, and the relevant ~250 lines of
`ui/src/styles.css`. The `.beat` file used was a scratch copy of `examples/night-shift.beat`
(`/tmp/dotbeat-ux-device/song.beat`, never `night-shift-song.beat`), with a `keys` instrument
track and a couple of `effect-add`s layered on via the real CLI so all three track kinds (synth,
drums, instrument) had a populated Effect Chain to screenshot, per Phase 26 Stream DC.

---

## 1. Ableton's device/effects panel, in implementation-level terms

### 1.1 The chain as a row of physically discrete boxes

The Device View (`[manual p.428]`, screenshot "The Device View") is a **horizontal strip of
separate raised panels**, one per device, each its own light-grey card with a visible border and
its own internal padding — not a list of text rows. Signal order = left-to-right physical order
(`[manual p.432]`: "Signals in a device chain always travel from left to right"). Each device-card
is a self-contained object: **the title bar and the device's own knobs are the same box** — there
is no separation between "where I see the device's name/order" and "where I see its controls."
Compare the "Stacked Clip and Device View" screenshot (p.429): Instrument (Electric), Saturator,
and Chorus-Ensemble sit side by side as three visually distinct cards, each with its own
background shade, its own border, and its own knob layout — an empty grey "Drop Audio Effects
Here" zone caps the right end of the chain, showing exactly where the next device would land.

Between adjacent devices, Ableton draws **inter-device level meters** — thin vertical LED-style bars
sandwiched in the border zone between two device cards (`[manual p.433]`, "The Level Meters Between
Devices in a Chain") — so signal presence/absence at each hop is visible without opening anything.

### 1.2 One title bar, five to six controls, always in the same slots

Every device's title bar (clearest in the Phaser-Flanger screenshot, p.436, and the Auto
Filter/Auto Pan-Tremolo screenshots, pp.436–439) carries, left to right:

1. **Activator toggle** — a filled circle, ~14px, leftmost, always the first thing in the row. On =
   solid yellow/orange fill; off = grey/hollow (`[manual p.434]`, "Device Activator Toggles"). This
   is the single most prominent, highest-priority control on the entire device — first pixel your
   eye hits.
2. **Expand-view triangle** (▼) — present only on devices with a bespoke sub-view (Roar's Gain
   Stage/Modulation Matrix, EQ Eight's Frequency Display, Phaser-Flanger's LFO/Envelope-Follower
   section) — `[manual p.434–436]`. Absent on simpler devices.
3. **Device name** — plain text, no truncation shown in any sampled screenshot.
4. Right-aligned cluster, tightly packed: **Hot-Swap** (circular double-arrow icon, `[manual
   p.442]` "The Hot-Swap Presets Button"), **Save Preset** (floppy-disk icon, `[manual p.445]`
   "The Save Preset Button"), **context menu** ("…" ellipsis icon opening Cut/Copy/Duplicate/
   Rename/Group/Fold/Compare-A-B/Save-as-Default, `[manual p.436]` "Context Menu Options for Auto
   Filter"). All three are small (~16px) square icon buttons in a tight horizontal row, always in
   this fixed order.

The **fold affordance** is a separate gesture, not a title-bar icon: double-click the title bar, or
"Fold" from the context menu (`[manual p.429, 434]`). A folded device collapses to a narrow vertical
strip (screenshot "Devices Can Be Folded," p.430) that still shows its Activator dot at the top and
its name rotated 90°, so identity and on/off state survive folding — only the knob surface
disappears.

### 1.3 Knob anatomy and the editable-number convention

Knobs across every device screenshot (Roar p.434, Phaser-Flanger p.436, Auto Filter p.436, Auto
Pan-Tremolo p.437, the Macro Controls p.462) share one shape: a **rotary dial with a light
highlight ring**, a **label above** the dial, and a **numeric readout below** rendered as its own
small rectangular field with a slightly different background tint (e.g. Auto Filter's "1.01 kHz,"
Phaser-Flanger's "265 ms," Roar's "465 Hz"). These numeric fields read visually as **distinct,
separately-interactive boxes** from the dial itself — several (Phaser-Flanger's `Center`, `Rate`,
Roar's `Tone`) sit inside their own bordered rectangle with a contrasting fill, the standard Live
convention (not directly re-confirmed by this chapter's running text, but consistent across every
screenshot sampled) for "click this box and type an exact value" as an alternative to dragging the
dial. Knobs in these screenshots run noticeably larger than list-row icons — roughly 50–70px
diameter judging against adjacent 16px icon buttons — with generous whitespace between knob
columns and a clear visual grouping rule: knobs that belong to the same conceptual section (e.g.
Auto Pan-Tremolo's "Panning"/"Tremolo" tabs, p.437) sit under a shared colored tab header.

### 1.4 Macro Controls: a 4×2 grid of large, individually-named cards

The Macro Controls screenshot (`[manual p.462]`, ch.24 "The Macro Controls" — outside ch23's own
page range, included here because the task specifically asked about the macro rack's visual
grouping and ch23 never shows one) renders 8 macros as a **4-column × 2-row grid of bordered
cards**, each card containing: a **custom text label the user renamed** ("Time Delay 1," "Stereo
Width," "Rack Dry/Wet," "Chain Volume" — not generic "Macro 1..8"), a large cyan-ringed knob, and a
bold numeric value directly under it (e.g. "165 %," "-2.0 dB"). This whole grid sits inside the
Rack's own title bar frame (name "Elephant Smile," Rand/Map buttons, hot-swap, save) with a
left-edge vertical icon rail (rack-view toggle, chain +/−, chain list) — visually its own
sub-region of the device, clearly demarcated from any other device below/after it in the chain.

### 1.5 Hot-swap and drag-reorder mechanics (from the chapter text, not directly screenshotted for
the reorder-drop state)

Hot-swap (`[manual p.442]`) links the *currently selected preset* to the browser: pressing `Q` or
clicking the title-bar hot-swap icon expands that device's preset folder in the browser sidebar,
arrow-key navigation live-auditions each preset, `Enter`/double-click commits. Reordering
(`[manual p.433]`) is "drag a device by its title bar and drop it next to any of the other
devices" — the chapter's own text confirms the gesture but this image set does not include a
mid-drag screenshot showing a drop-line/ghost-card treatment, so that specific visual (insertion
line vs. full-card ghost) is not directly confirmed by this pass; flagged here rather than
invented.

---

## 2. dotbeat's current Device View, in the same terms

Screenshots referenced below: `/tmp/dotbeat-ux-device/screenshot-1-synth-lead-full.png` (synth
track "lead," full panel), `-2-synth-lead-macros.png`, `-3-synth-lead-effectchain.png`,
`-4-synth-lead-comp-group.png` (a forced-open Compressor group), `-5-instrument-keys-full.png`
(instrument track "keys"), `-7-instrument-keys-distortion-group.png`, `-8-drums-full.png`,
`-9-drums-macros.png`. Source: `ui/src/components/SynthPanel.tsx`, `InstrumentPanel.tsx`,
`Knob.tsx`, `synthParams.ts`, `ui/src/styles.css` lines ~569–784 and ~2856–2934.

### 2.1 Structural split: the chain list and the knobs are two separate DOM sections

This is the single biggest structural divergence from Ableton, and it is worse than research 63's
own framing ("mitigated, not eliminated divergence") suggested, because of a second-order effect
research 63 didn't check: **reordering the chain does not reorder the knobs.**

`SynthPanel.tsx` renders, top to bottom, inside one scrolling `.synth-panel` div:

1. `PresetPicker` (whole-track preset browser)
2. `MacroRow` (Phase 26 Stream DD)
3. `EffectChain` — a bordered box (`.effect-chain`, `background: var(--panel-2)`, `border: 1px
   solid var(--line)`, `border-radius: 6px`, `padding: 8px 10px 10px`) containing a vertical list
   of `.effect-row`s, each 1 line tall (`padding: 4px 6px`, `gap: 6px` between children, rows
   stacked with `gap: 4px`)
4. `.param-groups` — a *completely separate* flex column of `.param-group` `<details>` boxes
   (`background: var(--panel-2)`, same border/radius, `padding: 6px 10px 10px`, `gap: 8px` between
   groups), each with its own `<summary>` title and a `.knob-row` of `Knob` components inside.

Section 3 (the chain list) and section 4 (the knob wall) are visually identical in styling
(both `panel-2` grey boxes) but **structurally and spatially disconnected**: on the synth-track
screenshot (`screenshot-1`), the Effect Chain box (4 rows: EQ3/Compressor/Distortion/Bitcrush) ends
at document y≈980px, and — confirmed by scrolling — the actual EQ3/Compressor/Distortion/Bitcrush
knob groups don't even start rendering until further down, each in **its own separate bordered
card that never visually touches its chain-list row**. The only link between "Compressor" the
chain-list entry and "COMPRESSOR" the knob group (`screenshot-4`) is that both say "Compressor" —
same weak link research 63 flagged — but the deeper problem: `synthParams.ts`'s `PARAM_GROUPS` is a
**fixed, hardcoded array order** (`eq3, comp, distortion, bitcrush, pingpong, beatrepeat,
chorusphaser, saturator, autofilter, autopan, tremolo, utility, graindelay, vinyldistortion,
resonator, eq7, ...`, confirmed by `grep -n "id: '" synthParams.ts`), and `SynthPanel.tsx`'s group
filter (`PARAM_GROUPS.filter(...)`) iterates that fixed array — **never `track.effects`, the actual
chain order**. Drag an effect from position 4 to position 1 in the Effect Chain list (a real,
working gesture — `EffectRow`'s native HTML5 drag, `onDrop` → `postEffectMove`), and its knob group
stays exactly where `PARAM_GROUPS` put it, unmoved. In Ableton this scenario is physically
impossible — dragging a device *is* dragging its knobs, one object. In dotbeat, "the order I see in
the chain" and "the order I see the knobs in" are two independent facts that silently diverge the
first time anyone reorders anything.

### 2.2 The Effect Chain row: five controls, none of them a power-toggle-shaped power toggle

Reading `.effect-row` left to right (`screenshot-3`, `EffectRow` in `SynthPanel.tsx:153–223`):

1. **Drag handle** (`⠿`, `.effect-drag-handle`, 12px, `text-dim` color) — leftmost, `cursor: grab`
2. **Type label** (`EFFECT_LABELS[effect.type]`, e.g. "Compressor," `font-weight: 600`, 12px,
   `flex: 1` — takes all remaining horizontal space)
3. **Instance id** (`.effect-id`, e.g. "comp," 10px, dim) — small, easy to overlook, the only
   thing distinguishing two same-typed effects if that were ever possible (it currently isn't —
   research 63 §1b item 2)
4. **Per-effect level meter** (`.effect-meter`, Phase 26 Stream DE — a real 34×8px canvas, `-60dB`
   floor, green/amber/red by level) — genuinely closes the "is this even doing anything" gap
   Ableton's inter-device meters address, though it reads *inside* the device's own row rather than
   *between* devices, and it's tiny relative to Ableton's meters
5. **▲/▼ move buttons** — 10px icon buttons, keyboard/click-reachable reorder fallback
6. **Bypass checkbox + "on" label** — a stock unstyled HTML checkbox, 10px "on" text — this IS the
   power toggle, but it's the **fifth of six elements in the row, at the far right**, styled
   identically in weight/size to every other small icon around it. Nothing marks it as the single
   most important control on the row the way Ableton's leftmost, oversized, colored Activator
   circle does. A bypassed row does get `opacity: 0.55` across its entire row (`.effect-row.bypassed`)
   — a real, working visual signal, just a whole-row dimming rather than a dedicated glyph state.
7. **Remove (✕)** — rightmost, one button-width away from the bypass checkbox — a destructive
   action sitting immediately adjacent to the row's main toggle, no confirmation, no distance/
   friction differentiating "turn this off" from "delete this."

There is no Ableton-equivalent hot-swap icon on a chain row at all (confirmed absent from
`EffectRow`'s JSX) — swapping a device type in place isn't possible; the only path is remove, then
`+ Add effect` at the chain's end, which loses chain position (already flagged, research 63 §1b
item 6 — reconfirmed here at the pixel level: there is no icon-sized gap in the row layout where a
hot-swap button could even go without a redesign). There is also no context-menu affordance (no
"..." anywhere in `EffectRow` or `EffectChain`) and no fold/collapse per row — every row is always
exactly one line tall, which is fine at today's 4–6-row chains but has no answer for a longer one.

### 2.3 The knob widget itself: smaller, drag-only, no direct numeric entry

`Knob.tsx` (ported from BeatLab, ~90 lines) renders a 40×40px SVG: a 270° arc from 135° (bottom-left)
sweeping clockwise, dark-grey track (`#3a3a3a`, `strokeWidth 3`), an orange (`var(--accent)`,
`#e0a13c`) fill arc for the current value, a dark center disc (`r=12`, fill `#2b2b2b`, stroke
`#1a1a1a`), and a short pointer line (`#dedede`) — visually a plausible but noticeably smaller,
flatter version of Ableton's knobs (Ableton's sampled knobs read roughly 1.5–2× the diameter, with
a lighter highlight ring rather than a flat orange arc). Below the SVG: `.knob-value` (10px,
tabular-nums, plain `<div>` text — **not an `<input>`, not clickable, not editable**) and
`.knob-label` (10px, uppercase, dim, below the value).

Interaction is pointer-drag only: `onPointerDown` captures the pointer, `onPointerMove` maps
vertical mouse delta to value (`dy / 140` — 140px of drag covers the full range, `fromNorm`/
`toNorm` handle log scaling). Reading the whole file confirms **no keyboard handling** (no
`tabIndex`, no arrow-key nudge), **no scroll-wheel support**, **no double-click-to-reset-default**,
and **no click-to-type-a-value** — the value text is display-only. Ableton's screenshots
consistently show numeric readouts in their own bordered/tinted sub-box (`1.01 kHz`, `265 ms`,
`465 Hz`), the standard DAW affordance for "click this, type an exact number" as an alternative to
imprecise dragging; dotbeat has no equivalent anywhere in the device panel — every one of the ~54
optional synth fields plus every effect's own params is drag-only, vertical-mouse-pixel-precision
only. For someone trying to dial in, say, exactly `-18.0` dB or `1.00 kHz`, there is currently no
faster path than trial-and-error dragging (or leaving the GUI and using `beat set`/`/edit`
directly, which defeats the point of having a knob at all).

### 2.4 Group fold state: a native `<details>`/`<summary>`, not a custom control

Each `.param-group` is a plain `<details>` element; `open` is a boolean from `synthParams.ts`'s
static spec (some groups default open — eq3/comp/distortion/bitcrush, the legacy default chain per
`docs/effects-panel-redesign.md` — others default closed — eq7/autoFilter/grainDelay/etc.). The
`<summary>` title (`.param-group-title`, 10px uppercase bold, `text-dim`, turns `var(--accent)`
when open) is the only click target to fold/unfold — functionally fine, native-browser-accessible,
but visually it is the **plainest element on the page**: no chevron/triangle icon at all (the
browser's default `<details>` marker is suppressed — no `list-style` triangle visible in any
screenshot), no icon distinguishing "this group has an effect actually wired in" from "this is a
core synth section like Oscillator that's always there." A newcomer scanning the panel has no
visual cue for which of the ~10 open boxes are optional/removable effects vs. permanent synth
sections — that distinction only exists in code (`ParamGroup.effectType`), not on screen.

### 2.5 Phase 25's flash affordance — real, and it is the one genuinely Ableton-caliber polish
moment in this panel

`.param-group-flash` (1.6s CSS keyframe: border/box-shadow snap to `var(--accent)` then ease back
to `var(--line)`/transparent) plus a forced `<details open>` and `scrollIntoView` fire exactly once,
right after `+ Add effect` resolves for that type (`SynthPanel.tsx`'s `justAdded` state). This is a
real, deliberate answer to the owner's original complaint ("not clear if they're actually doing
anything") and it is the one interaction in this panel that proactively directs attention the way
Ableton's whole "one object, name+knobs together" model does implicitly. It only fires on *add*,
not on drag-reorder — consistent with §2.1's finding that reorder has no knob-side visual
consequence at all (there's nothing to flash, since nothing moves).

### 2.6 Macro row: correct row semantics, much thinner visual weight than Ableton's rack grid

`.macro-row` (`screenshot-2`, `screenshot-9`) is a single **horizontal row** (not a grid), left
label "MACROS" (10px bold uppercase, dim), then one ordinary `Knob` per applicable factory macro —
same 40px widget as every other knob on the page, `gap: 14px`, wrapped in a `flex-wrap: wrap`
container so it breaks to a second line only if the browser is narrow. Values are unitless 0–100
(`format={(v) => Math.round(v)}`), names are the factory macro's fixed name (`filter-sweep`,
`grit`, `space`, `warmth`, `motion`, `width` for synth tracks — confirmed live: `screenshot-2` shows
exactly these six; `space`, `punch`, `snap` for drums — confirmed live: `screenshot-9` shows
exactly these three). Against Ableton's 4×2 grid of large, individually-**renamed** cards each with
its own bordered card and a big bold value readout (`[manual p.462]`), dotbeat's macro row reads as
one more knob-row among many on the page — same size, same weight as a Filter cutoff knob — rather
than a distinct, elevated control surface. There is also no per-project renaming (factory macro
names are fixed, `presets/macros.json`) and no visual separation between "this knob controls one
param" (every other knob on the page) and "this knob controls 2–4 params at once" (a macro) beyond
the shared bordered row and the "MACROS" text label.

**A real, verified-live gap**: the instrument track ("keys") gets **no Macro row and no Preset
Picker at all** — confirmed directly in `screenshot-5`: the panel goes straight from the
"SOUNDFONT" section to "EFFECT CHAIN," no macros anywhere. `MacroRow`'s own guard
(`if (track.kind !== 'synth' && track.kind !== 'drums') return null`, `SynthPanel.tsx:434`) and
`PresetPicker`'s identical guard (`InstrumentPanel.tsx` never renders it, only `SoundfontPicker`)
exclude instrument tracks entirely. Given Phase 26 Stream DC just gave instrument tracks a real,
first-class Effect Chain — the exact mechanism macros act on — this is now an inconsistency: an
instrument track's *effects* (its distortion, its EQ7) are exactly as macro-able as a synth
track's, but the GUI has no path to assign one there.

### 2.7 Drag-reorder visual feedback: present but minimal

`.effect-row.dragging` → `opacity: 0.4` (the row being dragged fades in place — no ghost/preview
element following the cursor, since this uses native HTML5 drag-and-drop with no custom drag
image set). `.effect-row.drop-target` → `border-color: var(--accent)` on whichever row is currently
under the pointer — an orange outline around the *whole target row*, not a thin insertion line
between two rows, so **which side of the target row the dragged item will land on (before/after)
is not visually distinguished** — you only find out after dropping. This is a real, concrete
regression relative to typical reorderable-list conventions (and, per §1.5, Ableton's own text
describes dropping "next to" a device without this pass having a screenshot of its specific
drop-indicator treatment either — so this is dotbeat's own gap on its own terms, not strictly an
Ableton-parity claim).

---

## 3. Prioritized UI/UX changes

Scope discipline per the brief: **assume the underlying data/routing already exists** (chain order,
bypass, meters, macros — all real, all shipped) — every item below is look/feel/interaction only,
sized for a UI-polish phase, not a new-feature phase.

### P0 — do these first; they're the sharpest gaps between "looks like a settings list" and "looks like a device chain"

1. **Make the bypass toggle the leading, largest, most visually distinct element in `.effect-row`,
   not the fifth element after ▲▼.** Move it to the far left (before the drag handle, or replace
   the drag handle's slot with a combined affordance), give it a real filled/hollow circle glyph
   (Ableton's Activator convention) instead of a stock checkbox + "on" text, and separate it by more
   than one button-width from the destructive ✕ remove button — today they're adjacent, inviting
   mis-clicks.
2. **Fix knob-group order to track `track.effects` order, not `PARAM_GROUPS`'s fixed array order,**
   for every `effectType`-gated group. Concretely: in `SynthPanel.tsx`/`InstrumentPanel.tsx`, sort
   the filtered `groups` array by `effects.findIndex(e => e.type === g.effectType)` before
   rendering (fixed-insert groups with no `effectType` keep their existing fixed position,
   presumably pinned at the end or the start — pick one and document it). This is the single
   highest-leverage fix for §2.1's "reorder the chain, nothing visually reorders" problem, and it's
   pure render-order logic — no data model change.
3. **Give the knob's numeric value a click-to-type affordance.** `Knob.tsx`'s `.knob-value` div
   becomes a real `<input>` (or a text overlay swapped in on click/double-click) that commits on
   Enter/blur via the same `onChange` the drag path already uses. This is the single biggest
   precision/accessibility gap versus Ableton's boxed numeric readouts (§2.3) and is scoped to one
   component.
4. **Give the instrument-track panel the Macro row and Preset Picker** — drop the `track.kind !==
   'synth' && track.kind !== 'drums'` guard in `MacroRow` (and give `PresetPicker` an instrument
   path, or a dedicated small instrument-macro set) now that instrument tracks have a real,
   macro-able Effect Chain (Phase 26 Stream DC). Currently the only track kind with a working FX
   chain AND no macro affordance is the one kind that most needs a shortcut into a small param
   surface (SoundFont tracks expose almost nothing else tweakable).

### P1 — meaningfully closes the visual gap, more surface area than P0

5. **Visually separate the Effect Chain list from the knob wall less, or connect them more** — pick
   one: (a) make each chain row expand in place into its own knob group when clicked (collapsing
   the two-section structure into Ableton's "one object" model), or (b) at minimum, add a persistent
   visual link (a colored left-edge bar matching the row's position, or a "▸ show knobs" affordance
   on the row itself that scrolls to and flashes its group, reusing the existing
   `.param-group-flash` mechanism from Phase 25 for more than just the add moment).
6. **Add a visible chevron/triangle to `.param-group-title`** so fold state reads as a control, not
   just clickable text (currently the *only* affordance is the summary text turning orange when
   open — no icon at all, contrary to `<details>`'s usual disclosure-triangle convention which this
   markup currently suppresses).
7. **Distinguish optional (removable) groups from permanent synth-surface groups visually** — e.g.
   a small dot/badge on any `ParamGroup` that has `effectType` set, so "this box will disappear if
   I remove it from the chain above" is visible without reading source.
8. **Insertion-line drop indicator for chain reordering**, replacing the current whole-row orange
   border (§2.7) with a thin horizontal line between rows showing above/below placement before
   drop.
9. **Enlarge and visually elevate the Macro row** relative to ordinary knobs — larger knob size,
   individually bordered cards per macro (closer to Ableton's 4×2 grid treatment, §1.4, without
   requiring a literal grid if horizontal space is preferred), and consider whether per-track macro
   renaming is worth adding now that the row exists (today: fixed factory names only).
10. **Add keyboard support to `Knob`** — arrow-key nudge once focused (small/large step with a
    modifier), matching the click-to-type affordance in P0 item 3 for a fully non-drag path to
    every control.

### P2 — real but lower-leverage; do once P0/P1 are through

11. **Per-effect-row fold/collapse** so a longer chain (once multiple instances of the same type
    ship, research 63 §1b item 2) doesn't force one-line-per-row forever.
12. **Double-click-to-reset-to-default on a knob** (no per-param "default" concept currently
    exists in the data model to reset to — this one may need a small data-side companion, flagged
    here as lower priority precisely because it isn't purely cosmetic).
13. **A lightweight per-row context menu** (rename the instance id, duplicate — once same-type
    duplicates are supported) rather than growing the always-visible icon row further.
14. **Inter-device meters in addition to the existing per-effect meter** — today's meter
    (`EffectMeter`, §2.2 item 4) reads a single effect's own output; an Ableton-style meter *between*
    rows reading the chain's running signal at each hop is a nice-to-have once the row-level story
    (P0/P1 above) is solid, not before.

---

## Sources

- Ableton Live 12 Reference Manual, chapter 23 "Working with Instruments and Effects," pp.428–460
  — 27 screenshots read directly this pass:
  `/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch23/p-{428-439,441-452,456-457,459}.jpg`;
  chapter text `/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-chapters/ch23.txt`.
- Ableton Live 12 Reference Manual, chapter 24 "Instrument, Drum and Effect Racks," pp.461–462 —
  2 screenshots read this pass for the Macro Controls grid specifically:
  `/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch24/p-{461,462}.jpg`.
- dotbeat, `main`, this session: `ui/src/components/SynthPanel.tsx`,
  `ui/src/components/InstrumentPanel.tsx`, `ui/src/components/Knob.tsx`,
  `ui/src/components/synthParams.ts`, `ui/src/styles.css`.
- 12 fresh screenshots of dotbeat's own Device View, taken this pass via Playwright
  (`playwright-core`, headless Chromium) against a real `beat daemon` (port 9105) + real built
  frontend (`vite preview`, port 9106) on a scratch copy of `examples/night-shift.beat`
  (`night-shift-song.beat` was never touched): `/tmp/dotbeat-ux-device/screenshot-{1..12}*.png`.
- `docs/effects-panel-redesign.md` (Phase 25) and `docs/phase-26-plan.md` Stream DC/DD — read first
  to confirm this doc critiques the current, post-redesign, post-FX-parity state.
- `docs/research/44-ableton-instruments-and-effects.md` and
  `docs/research/63-ableton-vs-dotbeat-instruments-and-effects.md` — read first for what NOT to
  re-derive (feature presence/absence); this doc's §2.1 extends 63's "mitigated, not eliminated"
  title-bar finding with the previously-unchecked reorder-order divergence.

# Research 63 — Ableton vs. dotbeat: instruments & effects, a direct feature/UI comparison

*2026-07-12. Owner-commissioned. Builds directly on `docs/research/44-ableton-instruments-and-effects.md`
(the prior primer on Ableton Live 12 manual chapter 23, pp.428-460, and its read of dotbeat's
just-shipped effects-panel redesign, `docs/effects-panel-redesign.md`). That doc already found the
Phase 25 gating fix structurally correct and flagged per-device level meters as the sharpest gap.
This doc does something different: a full, structured side-by-side of what's in each product's
device/effects surface, grounded again directly in the manual's screenshots (16 of the ~20-page
sample viewed this pass: pp.428-429, 431-432, 434, 436-437, 439, 441-442, 444, 446, 451-452, 454,
459), plus a full read of `ui/src/components/SynthPanel.tsx` and `ui/src/components/synthParams.ts`
on `main` post-Phase-25. Research-only — no code changes. Every dotbeat claim is cited file:line;
every Ableton claim is cited [manual p.NNN].*

## How this doc is grounded

- **[manual p.NNN]** — read directly off the extracted chapter text and/or the page image itself
  (both consulted for every citation below), page numbers from the chapter's own printed footers.
- **`file:line`** — read directly from this repo, this session, on `main`.
- Where research 44 already established a finding, it's restated briefly with a pointer back
  rather than re-derived, to avoid duplicate work; this doc's job is the comparison table research
  44 didn't produce, plus a few things a *feature-comparison* framing surfaces that a *"check one
  redesign against the manual"* framing didn't have reason to go looking for (device categories,
  A/B compare, plugin hosting shape, delay compensation, drag-and-drop device placement).

---

## 1. Feature & UI/UX comparison

### a) Shared features / parity

| Area | Ableton | dotbeat |
|---|---|---|
| Ordered, left-to-right (dotbeat: top-to-bottom list) device/effect chain, signal order = list order | "Signals in a device chain always travel from left to right" [manual p.432] | `track.effects: BeatEffect[]` — array order is chain order (`src/core/document.ts`), rendered as `EffectChain`'s row list (`ui/src/components/SynthPanel.tsx:165-203`) |
| Adding a device only when explicitly wanted; nothing pre-rendered for a device that isn't there | "simply drag it there or double-click its name to append it to the device chain" — identical gesture whether the chain is empty or full [manual p.432] | Phase 25's `effectType` gate on `PARAM_GROUPS` (`ui/src/components/synthParams.ts:60-75`) — a group renders only once its type is `effect-add`ed, confirmed by research 44 as structurally the same rule |
| Real bypass = signal literally unprocessed, not a hidden mix-at-zero | "Turning a device off is like temporarily deleting it: the signal remains unprocessed... does not consume CPU cycles" [manual p.433, continues p.435] | `effect.enabled` checkbox → `postEffectEnabled` → `reconcileEffectChain` (`ui/src/audio/engine.ts:2245`) does a real routing splice, not a mix illusion — same design, confirmed in `docs/effects-panel-redesign.md`'s own framing ("bypass is a real routing bypass... not a mix-knob illusion") |
| Drag-to-reorder an existing chain member | drag the title bar, drop next to another device [manual p.433] | `EffectRow`'s native HTML5 drag-and-drop (`ui/src/components/SynthPanel.tsx:113-136`) plus ▲/▼ buttons as a keyboard/click-reachable fallback (dotbeat adds the fallback; Ableton's manual describes drag only) |
| Non-destructive add/remove/reorder — no audio interruption | "devices can be placed, reordered, and deleted without interrupting the audio stream" [manual p.433] | Not independently verified this pass, but architecturally true by construction — `reconcileEffectChain` splices nodes into a running graph rather than tearing down/rebuilding the chain |
| Preset browsing is browse-and-immediately-hear, not browse-then-confirm | Hot-Swap mode: "use the up and down arrow keys to navigate through the presets... load the selected preset" [manual p.442-443] | `PresetPicker`'s Prev/Next buttons, each immediately calling `applyPresetToTrack` (`ui/src/components/SynthPanel.tsx:214-309`) — independently arrived at the same shape (confirmed by research 44 §4 as pre-existing, not built against this chapter) |
| Sidechain controls isolated into their own labeled region, not mixed into the general knob wall | Dedicated sidechain region on supporting plug-ins: routing chooser, Gain, Mix, Mute-to-audition [manual p.453-454, confirmed on p.454's screenshot] | `sidechain` `ParamGroup` (`ui/src/components/synthParams.ts:436-445`) — `duckSource`/`duckAmount` in their own group, independently landing on the same instinct (research 44 §6) |
| Title-bar-adjacent identity: label text ties a chain-list entry to its detail controls | Title bar carries the device name directly above/beside its own knobs — one visual object [manual p.428-434, screenshots throughout] | `EFFECT_LABELS[effect.type]` in the `EffectChain` row and `ParamGroup.title` in the knob wall use matching text (research 44 §5 flags this as a mitigated, not eliminated, divergence — see §1b below) |

### b) In Ableton, not in dotbeat

1. **Per-device (inter-device) level meters.** "Devices in Live's tracks have input and output
   level meters... low or absent signals will be revealed by the level meters" [manual p.433-434,
   screenshot "The Level Meters Between Devices in a Chain"]. dotbeat's `EffectRow`
   (`ui/src/components/SynthPanel.tsx:94-163`) has a drag handle, label, ▲▼, bypass checkbox,
   remove button — **no signal indicator at all**. Already flagged by research 44 §2 as the
   sharpest single gap; this doc independently reconfirms it as the top Ableton-parity item.

2. **Multiple, independently-parameterized instances of the same effect type.** Ableton's chain is
   an unbounded ordered list — nothing stops two Auto Filters or two EQ Eights on one track (every
   screenshot in §2 shows this is just "another device," no dedup rule anywhere in the chapter).
   dotbeat's `product-roadmap.md` (Core effects row, `docs/product-roadmap.md:124`) explicitly
   documents "two independently-parameterized instances of the SAME type remain out of scope" — a
   known, named gap, not something this pass is newly discovering, but real relative to Ableton.

3. **Device A/B compare.** "Every built-in Live device includes two device states, A and B... B
   retains the initial values, and any changes you make only apply to A... Compare: Copy A to B"
   [manual p.437-439, screenshots "A Device Can Store Two Sets of Parameter Values" and "The B
   Device State"]. Automation is explicitly *not* shared between states and must be manually
   re-enabled per switch [manual p.439-440]. dotbeat has no equivalent at any layer — no A/B slot
   on `BeatEffect` or `BeatSynth` (`src/core/document.ts`), no UI toggle.

4. **Device-level fold/collapse (presentation only, not bypass).** "a device can be collapsed by
   double-clicking its title bar or choosing Fold from the title bar's context menu" [manual p.429,
   434] — pure vertical-space management, independent of the Activator toggle. dotbeat's
   `EffectRow` has no fold state; a row is always shown at full height (drag handle through remove
   button, one line). Low-stakes on its own, but relevant once meters (item 1) or A/B (item 3) add
   more per-row real estate.

5. **Expandable inline sub-views for individual devices** (Roar's Gain Stage/Modulation Matrix, EQ
   Eight's Frequency Display, Phaser-Flanger's LFO/Envelope-Follower section) toggled by an arrow
   next to the Activator [manual p.434-436, screenshots "The Expanded View Toggle for Roar" and
   "Phaser-Flanger's Expanded View"]. dotbeat's `ParamGroup`s are flat knob rows
   (`ui/src/components/SynthPanel.tsx:315-333`) — no device gets a bespoke larger visualization
   panel (e.g. a frequency-response curve for `eq7`, a filter-sweep display for `autoFilter`).

6. **Hot-swap linked to the browser with keyboard-arrow live audition**, defaulting sanely to "the
   first audio effect (or the instrument)" when nothing is explicitly selected [manual p.442].
   dotbeat's `PresetPicker` is parity for the *preset-browsing* half (§1a above) but has no
   equivalent for *swapping a device type itself* mid-chain (e.g., replacing a `comp` row with an
   `eq7` row in place, keeping its chain position) — today that's remove-then-add-at-end, which
   loses position.

7. **Per-device context menu**: Cut/Copy/Duplicate/Rename/Group/Fold/"Show Preset Name"/"Save as
   Default Preset"/device-specific extras (e.g. Auto Filter's Mono Sidechain toggle) [manual
   p.436-437, screenshot "Context Menu Options for Auto Filter"]. dotbeat's `EffectRow` exposes
   exactly two mutating actions directly (remove button, bypass checkbox) plus the ▲▼/drag reorder
   — no menu, no rename (chain members aren't independently named beyond their `EFFECT_LABELS`
   type name and internal id, `ui/src/components/SynthPanel.tsx:141-142`), no duplicate, no
   per-track "save as default chain."

8. **Per-project and per-action default presets/devices.** New MIDI/audio tracks can load with
   specific devices pre-configured; dropping a sample or converting audio to MIDI has its own
   configurable default chain [manual p.446-448, screenshot "The Default Presets folders in the
   User Library"]. dotbeat has presets (`presets/factory.json`) applied on demand
   (`applyPresetToTrack`) but no "new synth track always starts with X" or "dropping a sample onto
   a track always creates Y" default-configuration system.

9. **Plug-in hosting UI conventions**: auto-generated parameter panels for ≤64-parameter plug-ins,
   an empty "Configure Mode" panel for larger ones where the user clicks individual plug-in
   parameters to add just those to Live's panel [manual p.450-453, screenshots "The Show/Hide
   Plug-In Window Button" and "The Configure Button"]; a floating original-plugin window synced
   bidirectionally with Live's own panel [manual p.451]; VST/AU source-folder management and
   rescan [manual p.454, 457, 459, screenshot "Activating Audio Units Plug-Ins"]. dotbeat has zero
   third-party plugin hosting today — correctly out of scope per `ROADMAP.md` (WAM2/CLAP hosting is
   explicit Tauri/M4-tier future work, already noted by research 44 §6) — listed here for
   completeness of the comparison, not as a near-term gap.

10. **Device delay compensation.** "Live automatically compensates for delays caused by Live and
    plug-in instruments and effects... keeps Live's tracks in sync while minimizing delay" [manual
    p.459, §23.6]. dotbeat's effect chain has no latency-reporting or compensation mechanism —
    correctly out of scope for a web-audio-graph engine with no high-latency plugin hosting yet
    (nothing in dotbeat's current DSP has meaningful processing latency), but the moment plugin
    hosting (item 9) lands, this becomes load-bearing, not optional.

11. **Chain-list and knob-panel are the literal same row**, not two scrollable regions connected by
    label-matching. "[a] device's title bar (chain-membership controls) and its parameter panel
    (the knobs) are the same visual object, occupying the same row in the same list" [manual
    p.428-436, restated from research 44 §3/§5]. dotbeat's `EffectChain` list and `PARAM_GROUPS`
    knob wall remain two separate DOM regions (`ui/src/components/SynthPanel.tsx:165-203` vs.
    `:315-333`), mitigated since Phase 25 by the `justAdded` scroll-into-view + `.param-group-flash`
    highlight (`:354-362`) but not eliminated — research 44 §5 already flagged this as real but
    low-priority; this pass concurs.

12. **Racks (Instrument/Drum/Effect) and Macro Controls** — a named grouping mechanism that bundles
    multiple devices into one saveable unit with up to 16 continuous "macro" knobs mapped to any
    parameter inside [manual references this chapter's own cross-links to "Instrument, Drum and
    Effect Racks," e.g. line 15 of the raw chapter text, and the Drum Rack default-chain workflow
    at manual pp.446-448]. **Not a new gap** — `docs/product-roadmap.md`'s Macros row
    (`docs/product-roadmap.md:199`) and `docs/research/27-macro-tooling-layer.md` already scoped
    a macro-tooling-layer design in detail (outside-the-file tooling, same non-indirection
    principle as presets, per D9); Racks specifically (device-grouping-as-a-saveable-unit) have no
    scoped dotbeat equivalent at all and aren't mentioned in any roadmap row. Included here for
    completeness; not re-scoped by this pass.

### c) In dotbeat, not in Ableton

1. **Every effect parameter is `git diff`-able, literal text.** Turning a knob is one line changed
   in the `.beat` file (`format-spec.md`'s Goal 1, confirmed by `synthParams.ts`'s own header
   comment: "the actual edit path is `<track>.<key>` via POST /edit... adding a param here needs no
   other change," `ui/src/components/synthParams.ts:9-12`). Ableton's `.als` chain state has no
   comparable diff-friendly form (per `ROADMAP.md`'s landscape table, `.als` is "not confirmed
   cleanly human-readable even decompressed"). This is dotbeat's whole thesis, not a UI nicety, but
   it is a genuine device-chain-level UX difference: every add/remove/reorder/knob-turn a user
   makes in dotbeat is independently inspectable and revertible via plain `git diff`/`git log`,
   with no bolt-on tooling (`alsdiff`, Automator scripts) required.

2. **CLI/MCP parity for every chain operation.** `beat effect-add`/`beat effect-remove`/
   `beat effect-move`/`beat effect-enabled`/`beat set <track>.<param>` (and their `beat_*` MCP
   equivalents) do everything the GUI's `EffectChain`/`Group` components do, headless
   (`docs/product-roadmap.md`'s "Ordered, reorderable per-track effect chain" row confirms CLI/MCP
   ✅ done alongside GUI ✅ done, `docs/product-roadmap.md:124`). Ableton has no scripted/headless
   equivalent for device-chain manipulation (Max for Live gets partway there but is a very
   different, in-app-only surface, not a text/agent-native one).

3. **Reasoning about "what changed" in musical language, not a raw diff.** D8's `DiffEntry` shape
   (`decisions.md:254-268`) is designed to narrate chain edits as "kick track's Compressor threshold
   moved -18dB → -12dB," not `<<<<<<<` markers or an opaque binary delta — directly serving the
   agent-native thesis Ableton's chapter has no equivalent surface for at all (Live has no
   agent-facing description of *what a device-chain edit did*, only the edit itself, applied live).

4. **The just-added flash/scroll affordance is a direct answer to "did my add do anything," built
   for a two-region layout Ableton doesn't have.** Phase 25's `justAdded` mechanism
   (`ui/src/components/SynthPanel.tsx:354-362`, `Group`'s `useEffect` at `:317-322`) doesn't exist
   in Ableton because Ableton doesn't need it — item (b11) above. It's dotbeat's own compensating
   mechanism for a structural choice (list-of-rows + separate knob-wall) Ableton didn't make, not a
   feature Ableton also has.

5. **Explicit, uniform "fixed insert vs. opt-in chain member" transparency in code comments, even
   though the UI itself doesn't yet expose this distinction to the user.** Research 44 §3 already
   named this as dotbeat's own structural divergence (saturator/chorus/phaser/pingPong/beatRepeat
   are hardcoded always-on tail nodes outside `track.effects`, `ui/src/audio/engine.ts:1797`
   `wireFxTail`, `:1804` `getDrumBus`, `:2146` `buildSynthChain`) — worth restating in a
   feature-comparison frame as a *dotbeat-only* structural category with no Ableton parallel (every
   Ableton device, however commonly used, is a real chain member, per manual §2). This is listed
   under (c) rather than (b) because it is dotbeat *having* something Ableton's model doesn't
   (a two-tier device model), not dotbeat missing something Ableton has — but per research 44's own
   recommendation (§3), it is a divergence worth eventually closing, not a strength to preserve.

---

## 2. Prioritized recommendations

Covers every item in §1(b). Priority is decisive: **P0** = do next, directly blocks answering the
owner's own "is it doing anything" question or is cheap+high-leverage; **P1** = real gap, worth a
dedicated phase, not urgent; **P2** = real but low-value or expensive relative to payoff right now;
**Do-not-recreate** = Ableton's mechanism doesn't fit dotbeat's model and shouldn't be copied.

| # | Feature | Priority | Build recommendation |
|---|---|---|---|
| 1 | Per-device level meters | **P0** | Add a small in/out (or out-only) level indicator to each `EffectRow` (`ui/src/components/SynthPanel.tsx:94-163`). Reuse `TrackMeter`'s existing tap pattern (`ui/src/components/MixerView.tsx:93`, off `engine.getTrackLevel` via the shared rAF loop, `ui/src/audio/engine.ts:2422`) — extend the engine with a per-effect-node level tap keyed by `BeatEffect.id`, read off whatever node `reconcileEffectChain` (`ui/src/audio/engine.ts:2245`) spliced in for that entry. This is the single most direct answer to the owner's original "not clear if they're actually doing anything" complaint (already flagged by research 44 §2) — a bypassed-but-present row and a live one currently render identically. |
| 2 | Multiple instances of the same effect type | **P1** | Already tracked (`docs/product-roadmap.md:124`, explicitly out of scope for the Phase 22 Stream AA chain). To close: drop the implicit one-per-type assumption in `EFFECT_TYPES`/`applyEffectAdd` (wherever the daemon currently keys effect lookup by type rather than instance id — audit `src/daemon/daemon.ts`'s effect routes) so `track.effects` can legally hold two `eq3` entries; `EFFECT_LABELS` display already uses per-instance `effect.id` alongside the type label (`ui/src/components/SynthPanel.tsx:141-142`), so the row-list side mostly already supports this — the harder part is `synthParams.ts`'s `PARAM_GROUPS`/`effectType` gate (`ui/src/components/synthParams.ts:60-75`), which assumes one group per type; a second instance would need per-instance knob groups, not per-type ones. Real engineering lift, sequence after item 1. |
| 3 | Device A/B compare | **P1** | Add an `a`/`b` slot pair to `BeatEffect`'s param map (or a parallel shadow object held in `ui/src/state/store.ts`, session-only like mute/solo per `docs/product-roadmap.md:117`'s precedent for non-compositional state) plus a small A/B toggle + "copy A→B" button in `EffectRow`. Given D9's "no in-file indirection" principle and mute/solo's precedent, this is a strong candidate for **session-only UI state, not a `.beat` format field** — an A/B compare choice is a workflow aid, not a compositional decision worth a git diff line, exactly the same reasoning `docs/product-roadmap.md:117` already applied to `BeatGroup.collapsed`/mute/solo. Scope to synth-track `EffectRow`s first (parity with Ableton's own device-only, not-Rack scope [manual p.441]); automation-disable-on-switch (item 3's trickiest wrinkle, [manual p.439-440]) can be deferred since dotbeat's automation model is per-track-param, not per-device-state. |
| 4 | Device-level fold/collapse | **P2** | Cheap once item 1 or 3 add row height: a `<details>`-style collapse on `EffectRow` itself (mirrors the existing `Group` component's `<details>` pattern, `ui/src/components/SynthPanel.tsx:323-333`) — pure CSS/local state, no format or daemon change. Low priority until meters/A-B actually make rows taller enough to matter. |
| 5 | Expandable inline sub-views (frequency curve, filter-sweep display, etc.) | **P2** | Real value (visualizing `eq7`'s response curve, or `autoFilter`'s LFO sweep, is more legible than seven bell-band knobs) but meaningfully larger scope than any other item here — a bespoke `<canvas>` per device type, not a metadata-table addition. Defer past the GUI spectrum/level visualization row already scoped and unbuilt (`docs/product-roadmap.md:178`, `24-opendaw-roadmap-positioning.md`) — that's the more general version of the same rendering investment and should land first. |
| 6 | Hot-swap-in-place (replace a chain member's type, keep position) | **P1** | Extend `postEffectAdd`/`postEffectRemove` (`ui/src/daemon/bridge.ts`) with a `postEffectReplace(trackId, effectId, newType)` daemon route that removes the old entry and inserts the new one at the *same index* rather than the end — small, well-bounded core primitive (mirrors `songMove`'s "one clean fact, not delete+insert," `docs/product-roadmap.md:83`, as the right shape for a swap-in-place op). GUI: a small "swap" affordance on `EffectRow` next to remove, opening the same `EFFECT_TYPES` picker `EffectChain`'s add control already uses (`ui/src/components/SynthPanel.tsx:178-185`). |
| 7 | Per-device context menu (rename, duplicate, save-as-default, etc.) | **P2** | Rename/duplicate are the two with real payoff — duplicate an `EffectRow` (same type, same params, new id, inserted after) is a small core primitive; rename would need a new optional label field on `BeatEffect` (format addition, needs a version bump discussion). Cut/copy/paste across tracks and "save as default preset" are lower value given dotbeat already has presets-as-tooling (D9) covering most of that need. Bundle into one pass rather than one context-menu item at a time. |
| 8 | Per-project/per-action default devices | **P2** | Real but not urgent — `beat init`'s `initDocument()` already has one obvious hook point (seed new synth tracks with a configurable default chain instead of the hardcoded legacy four, `defaultEffectChain()` per `docs/effects-panel-redesign.md`'s wrinkle #3). Scope down from Ableton's three-tier system (per-device/per-action/per-project) to just "per-project new-track default chain, configurable in `presets/`" — matches dotbeat's existing presets-are-tooling-in-`presets/*.json` pattern rather than introducing a new Defaults-folder concept. |
| 9 | Third-party plugin hosting UI (auto-panel, Configure Mode, floating window sync) | **Do-not-recreate (for now)** | Correctly out of scope per `ROADMAP.md`'s Tauri/M4 tier — no plugin host exists to give this UI something to control. When WAM2/CLAP hosting lands, Configure Mode's "≤64 params auto-render, more than that starts empty and user clicks-to-add" rule (research 44 §6) is worth adopting wholesale at that point — flagged as a future-phase note, not scoped now. |
| 10 | Device delay compensation | **Do-not-recreate (for now)** | No current dotbeat DSP has meaningful processing latency (all Tone.js/Web Audio nodes, no plugin hosting) — building compensation infrastructure now has no problem to solve. Becomes P0-at-that-time the moment plugin hosting (item 9) ships, not before. |
| 11 | Chain-list/knob-wall single-row unification | **P2** | Real UX debt but Phase 25's flash/scroll fix already closes the acute "did my add do anything" version of this problem (research 44 §5's own verdict, concurred with here). Full fix (`EffectRow` discloses its own knobs inline, Fold-style, instead of a separate `param-groups` region) is a bigger interaction-model rewrite of `SynthPanel.tsx` — worth doing once items 1 and 3 (which both want to live *on* the row) make the two-region split more obviously wrong, not before. |
| 12 | Racks (device grouping) and Macro Controls | **P1 (Macros only) / P2 (Racks)** | Macros: already fully scoped, not re-litigated here — pick up `docs/research/27-macro-tooling-layer.md`'s design directly (`BeatMacro`/`MacroTarget` shape, `presets/macros.json` storage, a Macros row in `SynthPanel.tsx`) as the next stream in this area; it is the single largest *scoped-but-unbuilt* gap surfaced by this whole comparison. Racks: no existing dotbeat scoping at all; a "save this ordered effect sub-chain as one named, reusable, droppable unit" concept is real value (especially combined with macros mapped across the sub-chain) but is a bigger structural addition than anything else in this table — worth a dedicated research pass before a build phase, not a direct build recommendation yet. |

**Read-through for planning**: items 1 (meters) and 12/Macros (already scoped in research 27) are
the two highest-leverage next moves — one closes the owner's own stated complaint precisely, the
other is fully designed and only needs a build stream. Items 3 and 6 are the next tier: well-bounded,
clear payoff, no format-version risk. Items 2, 4, 7, 8, 11 are real but sequenced behind those.
Items 9 and 10 are correctly not-yet-buildable given `ROADMAP.md`'s own M4/Tauri sequencing.

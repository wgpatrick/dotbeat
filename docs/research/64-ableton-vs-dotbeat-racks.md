# Research 64 — Ableton Live 12 Racks vs. dotbeat: a direct feature/UI comparison

*2026-07-12. Grounded in `docs/research/45-ableton-racks.md` (the prior text-only primer on manual
ch.24, pp.461-480) plus a direct visual read of 15 of that chapter's own screenshots
(`p-461/464/465/466/468/469/470/471/472/473/474/475/476/478/479.jpg`,
`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch24/`) and this session's own reading
of dotbeat's current source (`src/core/document.ts`, `ui/src/audio/engine.ts`,
`ui/src/components/NoteView.tsx`). Also cross-checked against `docs/research/27-macro-tooling-layer.md`,
`docs/research/12-drum-representation.md`, `docs/research/19-drum-voice-expansion.md`,
`docs/ROADMAP.md`, `docs/decisions.md`, and `docs/product-roadmap.md` so nothing below re-opens an
already-made decision or re-proposes something already shipped. Unlike research 45 (a synthesis
essay), this doc is a direct, structured comparison built for planning: what's shared, what's
missing on each side, and a hard priority call on every gap.*

## How to read this doc

- **[manual p.NNN]** — read directly off that page of the chapter (text extract or screenshot).
- **[dotbeat: file:line]** — read directly from this repo's current source this pass.
- Priorities are decisive on purpose: **P0** = build next, blocks something else or fixes a
  flagged wrong default; **P1** = build soon, scoped and cheap relative to value; **P2** = real gap,
  worth doing, not urgent; **Do-not-recreate** = considered and rejected, with the reason restated
  so it isn't re-litigated by a future pass.

---

## 1. Feature & UI/UX comparison

### a) Shared features / parity

| # | Feature | Ableton | dotbeat |
|---|---|---|---|
| 1 | **Ordered, serial, reorderable, bypassable device/effect chain per voice** | A Rack's device chain runs devices serially, each with its own Chain Activator (bypass) [manual p.461, p.465] | `BeatTrack.effects: BeatEffect[]` — ordered, reorderable, per-effect `enabled` bypass [dotbeat: `src/core/document.ts:667-671, 708-712`], built/live-wired by `reconcileEffectChain` [`ui/src/audio/engine.ts:2245`] |
| 2 | **"Pad" = a named voice bound to a trigger identity** | A Drum Rack pad is a chain addressed by one MIDI note [manual pp.472-473] | A declared lane is a named voice addressed by `hit.lane` [dotbeat: `src/core/document.ts:130-133, 195-198`] — same abstraction, expressed as a text-line declaration instead of a GUI grid cell |
| 3 | **Interchangeable content substrate per voice** | A pad's chain can be a Simpler/sample, an instrument, or a full device chain — whatever's dropped on it [manual p.472] | `BeatLaneBacking` is a tagged union: `synth` / `sample` / `sf` (SoundFont) [dotbeat: `src/core/document.ts:103-124`] — same "pick what produces this voice" flexibility, three substrates instead of Ableton's arbitrary-device-chain generality (a deliberate, smaller design, per `docs/research/19-drum-voice-expansion.md` Part VII) |
| 4 | **Preview a single voice without a controller or playing the whole clip** | Per-chain Preview button [manual p.471] | `engine.previewDrum(lane)`, wired to the Lanes panel [dotbeat: `ui/src/components/NoteView.tsx:136`] |
| 5 | **Hot-swap alternate content for a voice without leaving the panel** | Chain Hot-Swap button [manual p.465] | Hot-swap preset browser in Device View (Phase 23 Stream BB — `docs/product-roadmap.md` "Preset / content library", Done) |
| 6 | **Choke groups (at least the canonical hi-hat pair)** | Any chain assignable to 1-of-16 named choke groups [manual p.471] | `chokeDeclaredLane`, currently hardcoded to `hat`→`openhat` only [dotbeat: `ui/src/audio/engine.ts:2118`, call site `2639-2640`] — real but narrower parity; the general N-group case is 1(b) item 1 |
| 7 | **Switch among discrete curated configs via one control/command** | Chain Select Zones spaced at unit length = a hard-switched "preset bank" [manual pp.469-470] | Named presets applied through the same edit path as any other change (`beat preset` / `beat_preset`) [`docs/decisions.md` D9] — same practical outcome, deliberately simpler (no live selector, no stored indirection) |
| 8 | **Per-voice character-shaping knobs, not just level** | Per-device params inside a chain — e.g. the 808 Core Kit rack's Drive/Tone/Decay/Glue knobs [manual p.464] | Per-lane `params` (`tune`/`punch`/`decay`/`tone`) on `BeatLaneSynthBacking` [dotbeat: `src/core/document.ts:106-110`, defaults at `142-146`] |

### b) In Ableton, not in dotbeat

Fourteen items, each with a table row in §2. Numbered to match §2's table exactly.

1. **Named, general choke groups** (any lane → any of N groups) vs. dotbeat's hat/openhat-only pair [manual p.471; dotbeat: `ui/src/audio/engine.ts:2118, 2639-2640`].
2. **Per-lane volume + pan** — Ableton's chain volume/pan sliders are first-class, same rank as devices [manual p.465]; dotbeat has neither a top-level lane `gain` nor any `pan` field — only `BeatLaneSampleBacking.gainDb`, which is backing-specific, not lane-wide [dotbeat: `src/core/document.ts:112-117`; confirmed no `Panner`/gain wiring on the lane-dispatch path in `ui/src/audio/engine.ts:2058-2082`].
3. **Per-lane sends to a shared, kit-level return bus** — Drum Racks get up to six return chains fed by per-chain send sliders [manual p.472]; dotbeat has only track-wide `sendReverb`/`sendDelay`, no per-lane send and no shared drum-bus return concept.
4. **Per-voice mute/solo, in a dedicated list/mixer surface** — every chain row carries its own Solo + Mute (Chain Activator) [manual p.465]; also **Auto Select** auto-highlights whichever chain is currently sounding [manual pp.466-467]. dotbeat has track-level mute/solo only (`docs/product-roadmap.md` Mixer table) — confirmed no `muteLane`/`soloLane` primitive exists (`grep` across `ui/src/components/*.tsx` and `src/core/*.ts` for lane-scoped mute/solo returns nothing this pass).
5. **Extract a chain to its own track**, carrying its devices and — for drum chains specifically — its MIDI/hit data with it [manual pp.479-480].
6. **Macro Controls** — up to 16 mappable, 8 visible by default, a curated knob that reshapes several device params at once via min/max/curve [manual pp.474-475]. Not yet built in dotbeat (`docs/product-roadmap.md` "Macros" row: ❌ missing / ⬜ Not started) — though fully designed already, see `docs/research/27-macro-tooling-layer.md`.
7. **Macro randomization + a per-macro exclude flag** (volume macros excluded from randomization by default) [manual p.476] — no equivalent in dotbeat; contingent on item 6 shipping first.
8. **Rack/chain-level mixer strip** — a Rack's chains appear alongside tracks in the Session mixer, full mixing/routing controls mirrored live with the chain list [manual pp.478-479]. dotbeat's lanes are never surfaced in `MixerView.tsx`.
9. **Reorderable insert-effect chain parity across all voice/track kinds** — Ableton's device chain works identically whether it's an Instrument Rack, Drum Rack, or Audio Effect Rack [manual p.463]. dotbeat's `effects: BeatEffect[]` reorderable list is explicitly **synth-tracks-only** — drum and instrument tracks get a fixed set of inserts wired after the (non-existent-for-them) reorderable list, never the list itself [dotbeat: `src/core/document.ts:708-712`; `ui/src/audio/engine.ts:1493-1494`, comment: *"v0.10's `effects` field is synth-tracks-only"*]. `docs/product-roadmap.md` already tracks the instrument-track half of this ("Instrument-track FX chain," ❌ missing); the drum-track half isn't a named roadmap row anywhere — this doc surfaces it.
10. **Key Zones / Velocity Zones / Chain Select Zones** — runtime-reactive, stored filter/indirection layers between what's on disk and what's heard [manual pp.467-470].
11. **Parallel device chains + recursive Rack nesting** (fan-out one input to N chains, sum the outputs; Racks can contain Racks) [manual p.461, p.463].
12. **128-pad grid UI**, drag-to-map onto a pad, chromatic multi-sample mapping, Alt/Cmd-drag layering into a nested Instrument Rack [manual pp.472-473].
13. **Macro Control Variations** — named snapshots of a Rack's macro-knob positions, launchable as instant jumps [manual p.477].
14. **MIDI Effect Racks / the MIDI-effect→instrument→audio-effect ordering rule** [manual p.463] — dotbeat has no MIDI-effect device family (arpeggiator, chord, scale-force, etc.) at all, so there's nothing for an ordering rule to apply to yet.

### c) In dotbeat, not in Ableton

1. **The whole "rack" is literal, diff-friendly text** — every lane declaration, backing, choke assignment, and effect-chain entry is a line in the `.beat` file [dotbeat: `BeatDrumLaneDecl`/`BeatLaneBacking`/`BeatEffect` shapes, `src/core/document.ts`]. Ableton's chapter documents no text serialization for any of this — rack state lives in the binary/XML `.als` (`docs/ROADMAP.md` §1's own landscape table: `.als` is "not confirmed cleanly human-readable even decompressed").
2. **CLI + MCP-scriptable structural edits** — an agent adds/removes/reorders a lane or an effect (`addLane`/`removeLane`/`moveLane`/`setLaneBacking`, `effect-add`/`effect-remove`/`effect-reorder`) as a one-line, reviewable diff, no GUI required (`docs/phase-23-stream-bb.md`, `docs/phase-22-stream-aa.md`). Ch.24 documents zero scripting surface for rack editing; Ableton's only programmatic path (Max for Live) is a heavier, non-text mechanism outside this chapter's scope entirely.
3. **Content-addressed, provenance-tracked kit media** — every sample/SoundFont a lane can point at carries a sha256 pin and a JSON provenance sidecar recording license/source (`docs/decisions.md` D11; `presets/sf2/*.sf2.json`). Nothing in ch.24 documents an equivalent for a Drum Rack's dropped samples.
4. **No stored knob→pointer indirection anywhere, by design** — swapping a lane's backing, bypassing an effect, or (once built) turning a macro all resolve immediately to literal `setValue`-shaped edits; there is no persistent mapping layer for `git diff` to fail to explain. This is an explicit, adjudicated departure from Ableton's own knob→pointer→target macro model, not an oversight (`docs/research/27-macro-tooling-layer.md` §1, `docs/research/45-ableton-racks.md` §8) — a real structural advantage for the git-native/agent-native use case specifically, not a general claim of superiority.
5. **A scored variation/audition loop over a lane or track's sound** (`beat vary`/`beat score`, rungs 1-3, `docs/product-roadmap.md` "Vary / audition loop," Done) — generates and ranks many parameter variants. Ch.24's closest analog, the Rand button, is a single unscored randomize-all-mapped-macros action [manual p.476], not a generate-and-compare loop.

---

## 2. Prioritized recommendations

| # | Feature | Priority | Build recommendation |
|---|---|---|---|
| 1 | Named, general choke groups | **P1** | Add `choke?: string` to `BeatDrumLaneDecl` (`src/core/document.ts:130-133`), elided when absent. Replace the hardcoded `lane === 'hat'` check in `chokeDeclaredLane` (`ui/src/audio/engine.ts:2118`, call site `2639-2640`) with "find other lanes sharing this lane's `choke` group id, stop/release them." Edit path: fold into the existing `setLaneBacking`-style lane primitives (`docs/phase-23-stream-bb.md`) rather than a new verb. Already flagged as an anticipated gap in dotbeat's own `docs/phase-22-stream-ab.md` §5 — this just closes it. Small, single-stream scope. |
| 2 | Per-lane volume + pan | **P1** | Add `gain: number` (dB, default 0) and `pan: number` (-1..1, default 0) as top-level fields on `BeatDrumLaneDecl`, sibling to `backing` (not inside it — gain/pan are lane properties, independent of what produces the sound, matching Ableton's chain-row-not-device placement [manual p.465]). Fold `BeatLaneSampleBacking.gainDb` (`document.ts:112-117`) into the new field as a small migration. Wire into `triggerDrum`/`syncDeclaredDrumLanes` (`ui/src/audio/engine.ts:2058-2082`) via a per-lane `Tone.Panner` + level multiplier. This directly closes the gap `docs/ROADMAP.md`'s Format v0.3 section has flagged open since the M3 session ("per-lane drum gain isn't a v0.2 lever and needs to be"). |
| 3 | Per-lane sends to a shared kit-level return bus | **P2** | Real capability gap, but sequence *after* #1/#2: needs (a) a fine-grained per-param lane edit path that doesn't exist yet (`docs/phase-22-stream-ab.md` §5's own scope cut) and (b) a new shared-return-bus concept with no current per-track analog. Not a small increment — scope as its own stream once #1/#2 land and a real "these five toms need one shared room verb" use case shows up. |
| 4 | Per-voice mute/solo + auto-highlight the sounding lane | **P2** | Extend the existing transient, session-only mute/solo pattern (`ui/src/state/store.ts`, already deliberately kept out of the `.beat` file per `docs/product-roadmap.md`'s Mixer table) down to lane granularity; add a small "currently sounding" highlight in the Lanes panel keyed off the same trigger path `previewDrum`/`triggerDrum` already share. Useful once kits regularly carry 10+ lanes (the new 12-lane default kit, `docs/research/19-drum-voice-expansion.md` Part VII), but no flagged user pain yet — don't front-run it. |
| 5 | Extract a lane to its own track | **P2** | A pure compound edit over primitives that already exist (`addLane`/`removeLane`/`moveLane`/`setLaneBacking`, plus `addTrack` from `src/core/edit.ts`), scoped concretely in `docs/research/45-ableton-racks.md` §7: new track with one lane copying the source's backing (+ gain/pan from #2), move every referencing `hit` line by id, remove the source lane. Ship as `beat extract-lane <file> <track> <lane> [<new-track-name>]` once #1/#2 land (shares their lane-primitive surface). Has a tedious manual workaround today — not urgent. |
| 6 | Macro Controls | **P1** | Fully scoped already — build directly from `docs/research/27-macro-tooling-layer.md`: `src/core/macro.ts` (`BeatMacro`/`MacroTarget`/`resolveMacro`/`applyMacro`, mirroring `src/core/preset.ts`), `presets/macros.json` (the 8-macro starter set in research 27 §2), daemon `GET /library` gains a `macros` array + one new `POST /library/apply-macro` route, CLI `beat macro list`/`beat macro apply` + MCP `beat_macro_list`/`beat_macro_apply`, and a Macros row in `SynthPanel.tsx` above the existing knob groups. Resolves immediately to literal edits — no in-file indirection, no new grammar. High value (the single biggest "front panel for sound design" gap) and cheap relative to value since the whole design pass is done. |
| 7 | Macro randomization + per-macro exclude flag | **P2** | Sequence strictly after #6. Add `excludeFromRandomize?: boolean` to `BeatMacro`, defaulted true for any macro whose sole/first target is a volume-shaped param (Ableton's own default behavior [manual p.476] — a concrete footgun-prevention precedent, not an arbitrary choice). A "Rand" button in the `SynthPanel.tsx` Macros row iterates visible, non-excluded macros. Research 27 §7 itself calls this "cheap, real v1.1 polish, not required" — correct call, keep it P2. |
| 8 | Rack/chain-level mixer strip (lanes visible in the mixer) | **P2** | Extend `MixerView.tsx` to optionally expand a drum track into its declared lanes as sub-strips (gain/pan from #2, mute/solo from #4) — a natural follow-on once both exist, not a standalone build. Don't build before #2/#4 land; there's nothing to show yet. |
| 9 | Effect-chain parity for drum and instrument tracks | **P1** | Generalize `BeatTrack.effects` off "synth-tracks-only" (`src/core/document.ts:708-712`; `ui/src/audio/engine.ts:1493-1494`'s comment names the exact constraint). The reorderable-chain machinery (`reconcileEffectChain`, `buildEffectRuntime`, `EFFECT_TYPES`) is already fully generic — the type-level restriction is the only thing narrowing it. `docs/product-roadmap.md` already tracks the instrument-track half as its own row ("Instrument-track FX chain," ❌ missing) — treat that as the vehicle, but widen its scope in planning to cover the drum-track bus too, since both are blocked by the identical `effects: []`-for-non-synth constraint and fixing one without the other leaves an asymmetry with no principled reason behind it. |
| 10 | Key/Velocity/Chain-Select Zones | **Do-not-recreate** | Restated from `docs/research/45-ableton-racks.md` §4, not re-litigated: Zones are runtime-reactive stored filters — genuine in-file indirection with no one-shot literal resolution, unlike a macro turn. Building them would be the first real breach of D1/D4/D7's literal-data thesis. The one useful pattern inside Zones (switch among N discrete configs via one control) is already covered by presets (D9) without the indirection cost. |
| 11 | Parallel device chains + recursive Rack nesting | **Do-not-recreate** | Fan-out-and-sum is a structurally new graph shape — nothing in dotbeat's flat-list effect chain or lane model has or needs it, and nothing currently asks for it. Confirmed disproportionate by both research 18's original call and research 45's fuller read of the full chapter. |
| 12 | 128-pad grid UI + drag-to-map / chromatic multi-map / Alt-drag layering | **Do-not-recreate** | dotbeat's shipped Lanes panel (Phase 23 Stream BB) already delivers the underlying capability — a named voice bound to a trigger identity, freely backed by synth/sample/sf — via declaration instead of a drag-and-drop grid. Building the grid UI on top would be pure surface-area with no new capability behind it. |
| 13 | Macro Control Variations | **Do-not-recreate** | Sequence-dependent on macros (#6) resolving immediately with no stored knob state — once true, a "variation" snapshot is byte-identical information to an ordinary preset. Once preset-saving exists, "save the current sound as a preset" already gives the Ableton-Variations workflow for free. Research 27 §7's own explicit rejection; restated here so it isn't re-proposed. |
| 14 | MIDI Effect Racks / MIDI-effect ordering rule | **Do-not-recreate (for now)** | Not a rejection on the merits — dotbeat simply has no MIDI-effect device family (arpeggiator/chord/scale-force) for an ordering rule to apply to. Revisit only if/when such a device family is ever scoped; until then there is nothing to build against. |

---

## Sources

- Ableton Live 12 Reference Manual, ch.24 "Instrument, Drum and Effect Racks," pp.461-480 — text
  extract `/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-chapters/ch24.txt`; 15 page images
  viewed directly this pass: `p-461/464/465/466/468/469/470/471/472/473/474/475/476/478/479.jpg`,
  `/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch24/` (manifest at
  `SAMPLE_MANIFEST.txt` in the same directory).
- `docs/research/45-ableton-racks.md` — the prior text-only primer this doc restructures into a
  direct comparison; its §1-§9 verdicts are cited, not re-derived, throughout.
- `docs/research/27-macro-tooling-layer.md` — the macro design this doc's item 6/7 build
  recommendations point at directly.
- `docs/research/12-drum-representation.md`, `docs/research/19-drum-voice-expansion.md` — drum
  event/lane model grounding.
- `docs/ROADMAP.md` (§Format v0.3, the M3-session per-lane-gain finding), `docs/decisions.md`
  (D1, D4, D7, D9, D11), `docs/product-roadmap.md` (Drum programming / Core effects / Mixer /
  Instrument tracks / Macros tables) — checked so nothing above contradicts a shipped feature or an
  already-made decision.
- dotbeat internal, read directly this pass: `src/core/document.ts` (`BeatDrumLaneDecl` and
  backings `95-133`, `BeatEffect`/`EffectType` `629-688`, `BeatTrack` `690-723`); `ui/src/audio/
  engine.ts` (`chokeDeclaredLane` `2118`, its call site `2639-2640`, `syncDeclaredDrumLanes`
  `2058-2082`, `reconcileEffectChain` `2245`, the synth-tracks-only `effects` comment `1493-1494`);
  `ui/src/components/NoteView.tsx` (`previewDrum` call `136`).

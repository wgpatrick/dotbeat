# Research 45 — Ableton Live 12 manual, ch.24 "Instrument, Drum and Effect Racks" (pp.461-480)

*2026-07-12. Owner-commissioned parallel research pass: one chapter of the Live 12 Reference Manual
(`prior_art/`, gitignored) per pass, mining Ableton's own documented behavior for dotbeat ideas/gaps.
This pass reads the chapter directly (`pdftotext -layout` extract, page-break markers preserved) —
citations below use the manual's own printed page numbers (461-480), which appear verbatim in the
extracted text at each page break, not a derived offset.*

## How to read this doc

- **[manual p.NNN]** — a claim read directly off that page of the chapter extract.
- **[dotbeat]** — read directly from this repo's current source this pass, cited with file:line.
- **[research N]** — a claim or verdict from an earlier dotbeat research pass, cited rather than
  re-derived.

## 0. Relationship to research 27, and to research 18/19

`docs/research/27-macro-tooling-layer.md` already did deep, load-bearing design work on **one
narrow slice** of this chapter — Macro Controls — and its verdict (macros are tooling that emit
literal edits, never in-file indirection; concrete `BeatMacro`/`MacroTarget` shape; storage in
`presets/macros.json`; GUI as a `SynthPanel` row) is **not re-litigated here**. `docs/research/
18-ableton-ui-architecture.md` §6 also already made the headline call on the rest of this chapter —
"Racks (multi-chain instruments, key/velocity zones, Drum Racks as 128-pad devices): SKIP for Phase
18, and probably well beyond" — grounded in a shorter read of the same manual section.

This pass reads the **full chapter** (Racks overview, the four Rack variants, Chain List, Zones,
Drum Rack specifics — Receive/Play/Choke, return chains, Pad View — Macro Control mechanics beyond
what 27 needed, Mixing With Racks, Extracting Chains) and checks each piece against dotbeat's
*current* state — which has moved a lot since research 18/19 were written: the open per-lane drum
model (research 19) and the reorderable per-track effect chain (research 21/`phase-22-stream-aa`)
are now both shipped (`docs/product-roadmap.md`'s Drum Programming / Core Effects tables). The job
here is narrower and more concrete than 18/19's: confirm the "skip the nested-chain machinery"
verdict still holds against the fuller picture, and mine the chapter's mixing/pad-mapping/
choke-group specifics for anything **actionable now**, independent of the Racks-skip decision.

**Headline finding, stated up front**: two concrete, small, already-flagged gaps in dotbeat's
shipped drum-lane model turn out to have a direct, documented Ableton precedent in this chapter —
per-chain volume/pan (§6, below) and named choke groups beyond the hardcoded hat pair (§5.2) — both
cheap, both already anticipated as scope cuts in dotbeat's own `phase-22-stream-ab.md`. Everything
else in the chapter (parallel chains, zones, the 128-pad grid, Rack nesting, Macro Variations) either
reconfirms an existing skip decision or is genuinely out of scope for a reason this pass can now
state precisely, not just by analogy to research 18's shorter read.

## 1. Rack overview: parallel chains, one Rack = one device [manual p.461]

A Rack is a device-chain container: "in any of Live's tracks, devices are connected serially in a
device chain... Racks allow additional device chains to be added to any track. When a track has
multiple chains, they operate in parallel: ...each chain receives the same input signal at the same
time, but then processes its signal serially through its own devices. The output of each of the
parallel chains is mixed together, producing the Rack's output." [manual p.461] Drum Racks are the
one exception to "same input to every chain": "each Drum Rack chain receives input from only a
single assigned MIDI note" [manual p.461-462]. The whole Rack — however many nested chains and
devices — "can be thought of as a single device" for chain-placement purposes, and "Racks can
contain any number of other Racks" [manual p.461] (recursive nesting).

This is the mechanism research 18 already named and rejected as out-of-scope machinery. Reading it
in full confirms the rejection is structurally sound, not just proportionate: a Rack is **fan-out +
parallel-process + sum**, a real second dimension of the device graph (not just a longer chain).
Nothing in dotbeat's current effect-chain model (`BeatTrack.effects: BeatEffect[]`, a flat ordered
list — `docs/research/29-instrument-track-fx-chain.md` §2.1) or drum-lane model (`BeatDrumLaneDecl[]`,
also a flat ordered list, `src/core/document.ts:130-133`) has this fan-out/sum shape, and nothing
currently asks for it.

## 2. The four Rack variants and device-ordering rules [manual p.463]

- **MIDI Effect Racks** — MIDI effects only, MIDI tracks only.
- **Audio Effect Racks** — audio effects only; usable on MIDI tracks *downstream* of an instrument.
- **Instrument Racks** — instruments plus MIDI and audio effects, ordered MIDI effects → instrument
  → audio effects.
- **Drum Racks** — like Instrument Racks (same ordering rule), *plus* up to six **return chains** of
  audio effects, fed by per-drum-chain send levels.

[manual p.463] All four are created either from a browser preset or by selecting existing devices
and choosing "Group"/"Group to Drum Rack" from the context menu — repeating Group on an
already-grouped selection nests a Rack inside a Rack [manual p.463].

**Relevance**: dotbeat has no MIDI-effect device concept at all (no arpeggiator/chord/scale-force
device family exists in the format or engine), so the MIDI-Effect-Rack ordering rule has no analog
to even discuss yet. The Instrument/Drum ordering rule (effects-around-an-instrument) is moot for
the same reason dotbeat's tracks are single-voice (§7). Not a gap — there is no instrument-plus-
effects-as-one-unit concept in dotbeat for this rule to order.

## 3. Rack anatomy, Chain List, Auto Select [manual pp.464-466]

A Rack exposes a **Chain List** (each parallel chain as a row: Chain Activator, Solo, Hot-Swap, and
— for Instrument/Drum/Audio-Effect Racks — **volume and pan sliders**; Drum Rack chains additionally
get **send-level and MIDI-assignment controls**) [manual p.465], a **Devices** view showing the
selected chain's contents, and (Drum Racks only) a **Pad View** [manual pp.464-465]. **Auto Select**
highlights whichever chain(s) are currently passing signal — for a Drum Rack, whichever chain's
assigned MIDI note is currently sounding [manual pp.466-467].

The one detail worth pulling out on its own, because it's the direct precedent for §6 below: **"Each
chain has its own Chain Activator, as well as Solo and Hot-Swap buttons. Chains in Instrument, Drum
and Audio Effect Racks also have their own volume and pan sliders, and Drum Rack chains have
additional send level and MIDI assignment controls."** [manual p.465] A Rack's per-chain mixer strip
is not an incidental UI nicety — it is documented as a first-class part of what a chain *is*, the
same rank as the devices in it.

## 4. Zones: splits, layers, and discrete switching [manual pp.467-470]

Zones are "sets of data filters that reside at the input of every chain in an Instrument or Effect
Rack. Together, they determine the range of values that can pass through to the device chain."
[manual p.467] Three kinds, each toggled via a button above the Chain List:

- **Key Zones** — a chain only receives MIDI notes inside its assigned key range; overlapping zones
  create *layers* (both chains sound), adjacent non-overlapping zones create *keyboard splits*.
  Key zones have a fade sub-range that attenuates velocity at the boundary. [manual p.468]
- **Velocity Zones** — same mechanism, filtering on Note-On velocity (1-127) instead of pitch;
  fade ranges attenuate velocity at the boundary. [manual p.468]
- **Chain Select Zones** — a single 0-127 **Chain selector** value (draggable, MIDI-mappable) that
  each chain's zone either does or doesn't overlap; only overlapping chains produce output. Default
  zone length is 1 at value 0, so by spacing four chains' zones at values 0/1/2/3 you get a
  hard-switched "preset bank" selectable by one control [manual pp.469-470]; widening the zones with
  fade ranges turns the same mechanism into a crossfade between chains instead of a hard cut [manual
  p.470].

**Explicitly out of scope, and here is the precise reason, not just "Racks are big"**: Zones are, by
the manual's own description, "data filters" — i.e. exactly the same category of thing research
27/18 already ruled out for macros: **a stored mapping that must be resolved to know the real
sound**, not a literal value. A Key/Velocity Zone's boundaries and a Chain Select Zone's selector
value are stateful indirection layers sitting between "what's in the file" and "what you hear" —
identical in kind to the macro-mapping problem research 27 §1 already solved by moving macros
entirely outside the `.beat` file. The difference here is that Zones can't be resolved the same way
macros are (compute-once, write-literal-edits) because they're **runtime-reactive filters on
incoming note/velocity data**, not a one-shot knob turn — there is no single "resolved value" to
write into the file the way a macro turn resolves to a cutoff value. Building Zones would mean
either (a) putting genuine live-resolved indirection into the format for the first time, breaking
D1/D4/D7's literal-data thesis in a way nothing else in the codebase does, or (b) flattening zones
into per-note-range static content at author time, which isn't zones anymore, just multiple tracks
with manually-split note ranges (which dotbeat already supports today, for free, with zero new
grammar — see §7).

**The Chain-Select "preset bank" pattern specifically** (§4's third bullet) is worth naming because
it looks superficially like it wants a feature: "switch between N discrete configurations via one
control." dotbeat already has this, structurally, via **presets** (`decisions.md` D9 — "presets are
tooling, never grammar") — applying a different named preset through the CLI/agent/GUI *is*
Ableton's chain-select preset-bank pattern, minus the runtime chain-selector value and the crossfade
machinery. No new mechanism needed.

## 5. Drum Racks specifically [manual pp.471-473]

### 5.1 Receive / Play / Choke, per chain

Each drum chain has an **Input/Output section**: a **Receive** chooser (which incoming MIDI note
triggers the chain — shown as note name, MIDI number, *and* the standard GM drum-equivalent name),
a **Play** slider (the outgoing note sent onward to the chain's own devices — independently
settable from Receive), and a **Choke** chooser: **"set a chain to one of sixteen choke groups. Any
chains that are in the same choke group will silence the others when triggered. This is useful for
choking open hihats by triggering closed ones, for example."** [manual p.471] A small **Preview**
button fires a note into the chain directly, without a MIDI controller [manual p.471].

### 5.2 Choke groups — a concrete, small, already-flagged gap

**[dotbeat]** dotbeat already ships choke-group behavior, but only for exactly one pair: `chokeDeclaredLane`
in `ui/src/audio/engine.ts` fires whenever `lane === 'hat'`, silencing a ringing `'openhat'` voice —
`docs/phase-22-stream-ab.md` §3 states this plainly: *"A closed-hat trigger... chokes a ringing
'openhat' voice first... keyed by canonical name, not a general choke-group declaration (out of
scope, see §5)"*, and §5's own scope-cut list repeats it: *"Choke groups are hardcoded to the
`hat`/`openhat` canonical names, not a general per-kit choke-group declaration... a kit using
different names for its hats won't choke automatically."* Ableton's documented model — **any chain
can be assigned to any of 16 named choke groups, and choke is symmetric within a group, not a
hardcoded hat-specific relationship** [manual p.471] — is exactly the generalization dotbeat's own
scope-cut note anticipated needing.

**Recommendation**: add an optional `choke: string` (or small int group id) field to
`BeatDrumLaneDecl` (`src/core/document.ts:130-133`), elided when absent (canonical elision, same
discipline as every other optional field). Engine change is small and localized: replace the
hardcoded `lane === 'hat'` check in `chokeDeclaredLane` with "find other lanes sharing this lane's
`choke` group id and stop/release them." This directly closes a gap dotbeat's own build docs already
named, using real precedent for the exact shape (a named group, not a boolean pair) rather than
guessing at the generalization. Scope: format field + one engine function change + a `beat set
<track>.lane.<name>.choke=<group>`-shaped edit path (or fold into the existing `setLaneBacking`-style
lane primitives, research 19/`phase-23-stream-bb.md`). Small enough to be a single build stream, not
a research question.

### 5.3 Return chains and per-chain sends

"A Drum Rack's return chains appear in a separate section at the bottom of the chain list. Up to six
chains of audio effects can be added here, which are fed by send sliders in each of the drum chains
above." [manual p.472] Each return chain's output can route to the Rack's main output or directly to
the Set's return tracks [manual p.472] — i.e. a drum kit gets its own miniature send-effects bus
(shared reverb/delay across multiple drum voices, e.g. one room-verb send all the toms feed into at
different amounts), independent of the track's own sends.

**Relevance**: dotbeat's synth/drum tracks already have track-level `sendReverb`/`sendDelay`
(`SYNTH_FIELDS`, `document.ts`), but there is no per-lane send — a drum lane can't send a different
amount of reverb than its sibling lanes on the same track. This is a real, documented capability gap
against Ableton's model, but **lower priority than §5.2 and §6**: it requires per-lane parameter
storage (already flagged as a genuine scope cut in `phase-22-stream-ab.md` §5 — "no dedicated
`setValue` path for `lanes[].backing.params`... extending... to a fine-grained per-param edit is
future work") *and* a shared-bus concept that doesn't exist per-track today, i.e. it's not a small
increment the way §5.2/§6 are. Worth naming as a real, well-grounded future direction, not
recommending for near-term work.

### 5.4 Pad View [manual pp.472-474]

Pad View shows 128 pads (16 visible at a time, shifted in groups of 16). Dropping a sample on an
empty pad "creates a new chain containing a Simpler [Ableton's clip-based sampler], with the dropped
sample ready to play from the pad's note" [manual p.472]; dropping an audio effect onto an already-
loaded pad appends it downstream "and only the Simpler and sample will be replaced" if you then drop
a different sample [manual p.472-473]. Multi-selecting samples and dropping them maps them
chromatically upward from the drop pad; Alt/Cmd-dragging a multi-selection layers all of them onto
one pad via a nested Instrument Rack [manual p.473]. Dragging one pad onto another **swaps** their
note mappings [manual p.473]. A pad's displayed state communicates cardinality directly: an empty
pad shows only its note name and "the suggested GM instrument"; a pad with exactly one chain shows
that chain's name and exposes mute/solo/preview/Hot-Swap inline; a pad with more than one chain shows
"Multi" and aggregates mute/solo across all of them [manual p.473].

**Relevance**: research 18 and research 19 already covered and rejected the 128-pad grid *UI*
specifically — research 19 Part II's own framing (*"dotbeat does **not** need the 128-pad grid UI or
the per-pad device chains; it needs the lane identity space to be bigger than five"*) is exactly
right and nothing in this fuller read changes it. What this pass adds is confirmation that dotbeat's
**already-shipped** Lanes panel (`phase-23-stream-bb.md`) is functionally the correct-sized answer:
"drag a sample onto a pad to create its chain" (Ableton) maps onto "declare a lane with a `sample`/
`sf` backing via the Lanes panel" (dotbeat, shipped) — same outcome (a named voice bound to a
trigger identity, backed by whatever content you point it at), without the drag-and-drop grid, the
Simpler-specific device chain, or the nested-Rack layering mechanic. **No action needed here** — this
is a confirmation, not a gap.

## 6. Mixing With Racks — the per-chain mixer strip [manual pp.478-479]

"Any Instrument or Drum Rack that contains more than one chain can be viewed and mixed alongside the
tracks in the Session View's mixer... Chains in the Session View mixer look similar to tracks, but
they have no clip slots. Their mixing and routing controls mirror those found in the Rack's chain
list." [manual p.478] Multi-selecting chains in this mixer and adjusting one parameter adjusts the
same parameter on all selected chains **only when done via the mixer, not the chain list** [manual
p.479] — a real, specific asymmetry worth noting as a UX precedent (bulk-edit behavior differs by
which surface you're in), though not something dotbeat needs to copy given it has no equivalent
dual-surface split.

**This is the direct precedent for the second concrete, small, near-term recommendation.**
`docs/ROADMAP.md`'s own Format v0.3 section already flags the underlying gap, verbatim: *"Still open
from the M3 session finding: per-lane drum gain isn't a v0.2 lever and needs to be... lane balance
is still pattern velocities only."* **[dotbeat]** Checking the current schema confirms this is still
true and pins down exactly what's missing: `BeatLaneSampleBacking` carries a static `gainDb: number`
field (`src/core/document.ts:112-117`), but `BeatLaneSynthBacking`'s `params: Record<string,
number>` (`document.ts:103-111`) has no equivalent — a synth-backed lane (the default for `kick`/
`snare`/`hat`/etc. in the shipped 12-lane kit) has **no** static level control independent of
per-hit velocity, and **no** lane has a pan control at all. Ableton's chain-level volume/pan sliders
[manual p.465] are exactly this missing control, generalized across backing types the way Ableton
generalizes it across Simpler/instrument/effect-chain pads uniformly.

**Recommendation**: add `gain: number` (dB, default 0) and `pan: number` (-1..1, default 0) as
fields on `BeatDrumLaneDecl` itself (sibling to `backing`, not inside it) rather than duplicating
them per-backing-type — this is the right level because gain/pan are properties of *the lane*
(how loud/where in the stereo field this voice sits in the mix), independent of what produces its
sound, exactly matching how Ableton's chain volume/pan sit on the chain row, not inside whatever
device happens to be loaded into it. Concretely: fold `BeatLaneSampleBacking.gainDb` into this new
top-level field (a small, mechanical migration — sample-backed lanes already have the exact concept,
just at the wrong level) and add the equivalent multiplier/offset to the synth voice trigger path in
`triggerDrum`/`syncDeclaredDrumLanes` (`ui/src/audio/engine.ts`). This is smaller than it looks:
gain is "multiply the voice's output level," pan is "route through a `Tone.Panner` per lane voice" —
both mechanical additions to the existing lane-voice construction, not a new subsystem. This closes
a gap dotbeat's own roadmap has been carrying since the M3 session (2026-07-10) with a concrete,
manual-grounded shape for the fields, rather than leaving it as an open TODO with no proposed shape.

## 7. Extracting chains [manual pp.479-480]

"All chains can be dragged from their parent Racks and placed into other tracks or Racks... Drum
chains have an additional feature: when dragged from the mixer to a new track, they take their MIDI
notes with them. For example, if you are working on a MIDI drum loop within a single track and
decide that you would like to move just the snare onto its own track, simply select the snare
chain's title bar in the mixer and drag it to the mixer's drop area. This creates a new track with
the full contents of the snare chain: both its devices and its MIDI data. If you would like to
extract only the devices, drag from the chain list instead of from the mixer." [manual p.479-480]

**Relevance**: this is a genuinely well-scoped, moderate-value feature dotbeat doesn't have an
equivalent for yet, and — unlike Zones/Pad-grid — it requires **zero new format concepts**, only a
new *compound edit* over primitives that already exist. dotbeat already has `addLane`/`removeLane`/
`moveLane`/`setLaneBacking`/`setLaneParam` (`phase-23-stream-bb.md`) and `addTrack`
(`src/core/edit.ts`). "Extract this lane to its own track" = create a new drum track with a single
declared lane copying the source lane's backing (+ the new `gain`/`pan` from §6), then move every
`hit` line referencing that lane (by id, preserving start/velocity/duration) onto the new track's
`hits`, then remove the lane from the source track. This is a real, useful workflow — "the hats are
too busy in this track's clip editor, split them onto their own track/mixer channel" — but it's
strictly a **convenience compound-edit**, not a capability gap (a user can already manually
`removeLane` + `addLane` + re-enter hits by hand, just tediously). Worth scoping as a small follow-up
CLI/MCP verb (`beat extract-lane <file> <track> <lane> [<new-track-name>]`) once §5.2/§6 land, since
it benefits from the same lane-primitive surface — **not urgent**, lower priority than §5.2/§6
because it has a (tedious) manual workaround today and neither closes a flagged roadmap gap nor
fixes a hardcoded-should-be-general mismatch the way the other two do.

## 8. Macro Control mechanics beyond research 27's scope [manual pp.462, 474-477]

Research 27 already designed dotbeat's macro system in full (target list shape, min/max/curve,
storage, GUI placement, MVP cut) and this pass doesn't reopen any of it. Two chapter details are
worth recording as **confirming evidence** for choices research 27 already made independently:

- **"Once assigned to a Macro Control, a device parameter will appear disabled, since it hands over
  all control to the Macro Control (although it can still be modulated externally, via clip
  envelopes)."** [manual p.475] Ableton has to solve a real runtime conflict here — a macro-mapped
  parameter and a clip-envelope-automated parameter are two *live* control sources on the same
  target, so the UI needs a disabled/still-modulatable distinction to keep them from silently
  fighting. **dotbeat's macro design (research 27) has no equivalent problem to solve**: because a
  macro turn resolves *immediately* to a literal `setValue` edit and there is no persistent
  macro-to-param binding stored anywhere, there is no live "who owns this parameter" question —
  turning a macro just overwrites the target's value the same as hand-editing it or drawing an
  automation point over it would. This is a genuine, concrete advantage of the "resolve immediately,
  never store the mapping" design research 27 landed on, worth naming explicitly as validated by
  seeing what Ableton has to build *because* it stores the mapping.
- **"Macro Controls assigned to Volume parameters in Instrument Rack presets are excluded from
  randomization by default"** [manual p.476], and per-macro **"Exclude Macro from Randomization"**
  [manual p.476] / **"Exclude Macro From Variations"** [manual p.477] context-menu flags. Research
  27 §7 already scoped a "Rand" button as "cheap, real v1.1 polish, not required" — this confirms the
  real implementation needs an exclude-flag per macro (not just a global randomize-all), a small but
  concrete addition to that future scope, worth a one-line note for whoever picks it up: don't ship
  "Rand" without a per-macro opt-out, since Ableton's own default behavior (excluding volume macros)
  shows blanket randomization has an obvious footgun (randomizing a track's output level into
  silence or clipping) that the exclude-flag exists specifically to prevent.
- **Macro Control Variations** [manual p.477] ("store different states of Macro Controls as
  individual presets... capture the state of a Rack as a 'snapshot'... launch instant jumps between
  different Macro Control settings") is exactly the feature research 27 §7 recommended **not
  building at all**, with a specific argument (once a macro resolves immediately with no stored knob
  state, a "variation" snapshot is byte-identical information to an ordinary preset, so it would be a
  second, redundant snapshot mechanism). Reading the full chapter section changes nothing about that
  argument — if anything it sharpens it: Ableton's own Variations feature exists specifically because
  a macro's *knob position* is itself stored state in their model (there is something to snapshot
  beyond the resolved params); dotbeat's model deliberately has no such state, so the entire feature
  category has no target to attach to. **Verdict unchanged, now with a clearer "why."**

## 9. Explicit scope summary

**Recommend building (concrete, small, near-term):**

1. **Named choke groups on `BeatDrumLaneDecl`** (§5.2) — generalizes an already-hardcoded mechanism
   dotbeat's own build docs flagged as a scope cut, direct 1:1 precedent in the manual (16 groups,
   any-chain-to-any-group).
2. **Per-lane `gain`/`pan` fields on `BeatDrumLaneDecl`** (§6) — closes a gap named in `ROADMAP.md`
   since the M3 session, direct precedent in the manual's per-chain mixer strip, folds in the
   existing but too-narrowly-scoped `BeatLaneSampleBacking.gainDb`.

**Worth scoping later, not urgent:**

3. **Per-lane sends to a shared per-kit return bus** (§5.3) — real capability gap, but needs the
   already-flagged per-param lane edit path first; bigger lift than 1-2.
4. **"Extract lane to its own track" compound edit** (§7) — convenience over existing primitives, has
   a manual workaround today, best scoped as a follow-on once 1-2 land.

**Confirmed out of scope, with the specific reason this pass adds:**

- **Parallel device chains / Rack fan-out-and-sum** (§1) — a structurally new graph shape (fan-out +
  sum) nothing in dotbeat's flat-list effect chain or lane model has or needs; research 18's
  proportionality argument holds and this pass adds the structural-shape argument on top.
- **Key/Velocity/Chain-Select Zones** (§4) — these are runtime-reactive stored filters, i.e. in-file
  indirection in the same family research 27 already ruled out for macros, but *worse*: unlike a
  macro turn, a zone can't be resolved to a one-shot literal edit at author time, so adopting zones
  would be a first, genuine breach of D1/D4/D7's literal-data thesis, not a tooling-layer workaround
  like macros/presets. The "preset bank" pattern zones enable is already available via presets.
- **128-pad grid UI / per-pad device chains / nested nested Racks** (§5.4) — research 18/19 already
  rejected the UI; this pass confirms dotbeat's shipped Lanes panel already delivers the underlying
  "named voice bound to a trigger identity, freely backed" capability without it.
- **Macro Control Variations** (§8) — research 27's rejection stands, now with the sharper reason
  that Ableton's Variations exist only because their macro model has knob-position state to
  snapshot; dotbeat's model deliberately doesn't.
- **MIDI Effect Racks / instrument-effect ordering rules** (§2) — no analog exists yet (dotbeat has
  no MIDI-effect device family, no multi-device-per-track instrument concept); not a rejection so
  much as "not applicable to anything currently in the format."

## Sources

Ableton Live 12 Reference Manual, chapter 24 "Instrument, Drum and Effect Racks", pp.461-480
(`prior_art/`, local extract `/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-chapters/ch24.txt`).

dotbeat internal, read directly this pass: `src/core/document.ts` (`BeatDrumLaneDecl`,
`BeatLaneSynthBacking`, `BeatLaneSampleBacking`, `BeatLaneSfBacking`, lines 95-133);
`ui/src/audio/engine.ts` (`chokeDeclaredLane`, `syncDeclaredDrumLanes`, `triggerDrum`);
`docs/phase-22-stream-ab.md` (choke-group and per-lane-param scope cuts, §5); `docs/ROADMAP.md`
(Format v0.3 section, the M3-session per-lane-gain finding); `docs/product-roadmap.md` (Drum
programming / Core effects / Extended FX arsenal tables); `docs/research/12-drum-representation.md`;
`docs/research/19-drum-voice-expansion.md`; `docs/research/18-ableton-ui-architecture.md` §6 and "The
Macros / Racks recommendation"; `docs/research/27-macro-tooling-layer.md`; `docs/research/
29-instrument-track-fx-chain.md`; `docs/decisions.md` D1/D4/D7/D9.

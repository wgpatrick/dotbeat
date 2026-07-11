# Research 19 — Expanding drum-voice cardinality beyond the 5-lane BeatLab holdover

*2026-07-11. Commissioned by the Phase 18 addendum (`docs/phase-18-plan.md`, "Addendum, same day:
drum voices are getting reconsidered separately"). The owner flagged dotbeat's current five fixed
drum lanes (`kick/snare/clap/hat/openhat`) as a **BeatLab holdover, not a deliberate design
constraint**, and wants real drum racks with many more named voices — "similar to piano roll,
except each 'note' is just a hit of a specific drum" — plus standard kit presets (808s etc.) with a
full, realistic drum-voice complement.*

## What this doc is, and is NOT

This is **not** a re-litigation of "adopt Ableton's Racks." Research 18
(`docs/research/18-ableton-ui-architecture.md`, "The Macros / Racks recommendation") already
concluded — correctly — that **Racks-the-nested-chain-machinery** (parallel chains, key/velocity
zones, per-chain device racks, chain selectors, return chains) is **skip for Phase 18 and probably
well beyond**, because a Rack is an entire nested-document subsystem out of proportion to what
dotbeat needs and destructive to its diff-friendliness story. Nothing here reopens that.

This doc is about the one axis research 18 *assumed away*: **lane cardinality** — how many named
drum voices a kit can have, and how that count is represented in the format and the engine.
Research 18 explicitly leaned on "dotbeat's five fixed drum lanes … the lane set is fixed, not a
128-pad rack" as a *simplifying* assumption ("this is *easier* than Ableton because the lane set is
fixed"). The owner has now removed that assumption. So the question is narrow and concrete: **do we
grow the lane set, and if so, mechanically how — a bigger closed enum, an open per-kit list, or by
leaning on the SoundFont instrument pathway dotbeat already built?**

## How to read this doc

- **[verified-local]** — confirmed by reading dotbeat source this pass (file + line cited).
- **[cited]** — from an external primary/standard source (URL in Sources).
- **[general]** — well-established domain knowledge I did not pin to a single authoritative page
  this pass; flagged so it can be confirmed before it drives an irreversible call.

---

# Part I — dotbeat's current drum model, confirmed exactly

The brief asked to confirm the exact closed set and the hardwiring. Confirmed, all five places:

1. **The lane enum is a closed 5-member union** [verified-local, `src/core/document.ts:14-15`]:
   ```ts
   export const DRUM_LANES = ['kick', 'snare', 'clap', 'hat', 'openhat'] as const
   export type DrumLane = (typeof DRUM_LANES)[number]
   ```
   Every drum-facing type is keyed to this: `BeatDrumHit.lane: DrumLane` (`:29`),
   `BeatDrumPattern = Record<DrumLane, number[]>` (`:21`), and
   `laneSamples: Partial<Record<DrumLane, BeatLaneSample>>` on `BeatTrack` (`:201`). Order is
   load-bearing and canonical: "all five lanes are always emitted, in this order, so toggling any
   drum step is always a one-line diff" (`:11-13`; `docs/format-spec.md:169` — "exactly five
   `pattern` lines, always all lanes, always in BeatLab's own `DRUM_LANES` order").

2. **The drum-voice character params in `SYNTH_FIELDS` are hardwired to those specific five lanes,
   by name** [verified-local, `src/core/document.ts:94-103, 289-296`]: `kickTune`, `kickPunch`,
   `kickDecay`, `snareTone`, `snareDecay`, `hatDecay`, `openHatDecay`, `hatTone`. There is **no
   `clapDecay`** and no per-voice param for anything beyond kick/snare/hat/openhat — the fifth lane
   (clap) has zero shaping params, and the naming is per-lane-literal (`kickTune`, not a generic
   `voice[i].tune`). Adding a sixth voice today means inventing `SYNTH_FIELDS` rows named for it.

3. **The engine is 5 hand-built Tone.js voices, one per lane, not data-driven** [verified-local,
   `ui/src/audio/engine.ts:288-296, 526-550`]: a `DrumKit` struct with concrete fields —
   `kick: Tone.MembraneSynth`, `snare: Tone.NoiseSynth` (+ a `snareTone: Tone.MembraneSynth` shell
   layer), `clap: Tone.NoiseSynth`, `hat: Tone.MetalSynth`, `openhat: Tone.MetalSynth`. Each is
   constructed by hand with bespoke filter/envelope wiring.

4. **`triggerDrum` is a hardcoded `switch (lane)`** [verified-local,
   `ui/src/audio/engine.ts:893-919`]: one `case` per lane, each calling a different voice with
   voice-specific arguments (`this.drums.kick.triggerAttackRelease(this.kickTuneHz, '8n', ...)`,
   `this.drums.hat.triggerAttackRelease(300, '32n', ...)`, etc.). There is no lane→voice table; a
   new lane is a new `case` plus a new node plus new `SYNTH_FIELDS` rows plus a new `applyDrumVoice`
   assignment (`:513-521`).

5. **The format grammar hardcodes five `pattern`/`hit` lanes** [verified-local,
   `docs/format-spec.md:114, 148-152, 169, 287, 349-351`]: `pattern <lane: kick|snare|clap|hat|
   openhat>`, `hit <id> <lane> <start> <velocity>` with "one of the five lanes," and the parser
   "rejects drum tracks with missing lanes or unequal lane lengths."

**So the 5-lane set is genuinely load-bearing across type / params / engine / grammar / parser** —
it is not cosmetic, and expanding it is a real format-and-engine change, not a UI tweak. That is
exactly why it deserved its own research pass rather than being smuggled into the layout redesign.

### One important subtlety: two playback substrates already coexist on a drum track

dotbeat already has **two different ways a drum lane can make sound**, and this matters enormously
for the recommendation:

- **Synthesized voice** — the hand-built Tone.js node (Part I.3 above). The default.
- **Sample one-shot** — `lane <lane> <sample-id> <gain> <tune>` (v0.5,
  `docs/format-spec.md:287-291`; `BeatLaneSample`, `src/core/document.ts:177-183`). "That lane
  plays the sample one-shot instead of the synthesized voice … Unassigned lanes stay synthesized —
  mixed kits are the normal case." This is how `presets/kit-init` / `presets/kit-audiophob` work: 5
  `.wav` one-shots + provenance sidecars, one per lane.

  *Caveat [verified-local]*: `ui/src/audio/engine.ts:42` lists "sample-slicing / per-lane one-shots
  (v0.5 media)" among **deferred** engine items, and the live drum path (`triggerDrum`) only ever
  fires the synthesized voices — the live browser engine does **not** currently substitute the
  sample when a `lane` line is present. So sample-backed lanes exist in the *format and CLI story*
  but the *live engine* still synthesizes. This is a pre-existing gap, noted so a future stream
  doesn't assume sample-lane playback already works in the GUI engine.

- **The instrument-track SoundFont path is a *third* substrate, currently on its own track kind**
  [verified-local, `ui/src/audio/engine.ts:799-830, 1048-1064`]: instrument tracks load an `.sf2`
  into a spessasynth `WorkletSynthesizer` and play MIDI notes — `synth.programChange(0, program)`
  then `synth.noteOn(0, midi, vel, { time })`. **This already plays arbitrary named percussion by
  MIDI note number** if pointed at a GM percussion bank — see Part IV. It is not wired to drum
  tracks today; it's a separate `kind: 'instrument'` with its own `BeatInstrument` voice
  (`src/core/document.ts:187-192`).

---

# Part II — Ableton's Drum Rack pad model (the cardinality/mapping specifics only)

Not the chains/zones machinery (research 18 §6 covered and rejected that). Just the pad-count,
naming, and note-mapping facts the brief asked to pin down.

- **128 addressable pads, 16 visible at a time** [cited, Ableton manual — corroborated by research
  18 §6 "The Drum Rack pad grid"]: "A grid of 128 MIDI-note pads (16 visible, shifted in groups of
  16 by a left sidebar)." Each pad **is** one MIDI note (0–127); the pad grid is literally a
  note-number grid. So a Drum Rack's *maximum* cardinality is 128 named voices, its *typical
  working* cardinality is the 16 you see, and a factory kit usually fills somewhere between ~10 and
  ~24 of them.

- **A pad maps to exactly one incoming MIDI note** [cited/general]: dropping a sample on a pad
  auto-assigns it that pad's note; the pad's "Receive" note (what triggers it) and "Play" note
  (what it sends onward, for chained instruments) are independently settable, and pads have **Choke
  groups** (a hi-hat choke: open hat silenced by closed hat) [cited, research 18 §6].

- **Pad naming is user-defined but factory kits follow a convention** [general]: a pad's displayed
  name is just its chain name (whatever sample/instrument you dropped, renameable); empty pads show
  only their note name (e.g. "C1"). There is no enforced vocabulary. **However**, Ableton's factory
  Drum Racks lay voices out on the **General MIDI convention** so that a MIDI clip written for one
  kit plays sensibly on another: the bottom-left visible pad is **C1 = MIDI note 36 = kick**, snare
  sits at **D1 = 38**, closed hat at **F#1 = 42**, open hat at **A#1 = 46**, etc. — i.e. the 16
  default-visible pads are notes 36–51, and they're populated in GM order [general; GM note
  numbers are [cited], see Part III]. The pad grid's reading order (bottom-left up, in rows of 4)
  is why kick/snare/hats cluster in the bottom rows of a factory kit.

**The transferable lesson for dotbeat**: a "pad" is nothing more exotic than *a named voice bound
to a trigger identity*. dotbeat's `hit <id> <lane> <start> <velocity>` already **is** a pad model —
`lane` is the pad identity, exactly as the owner framed it ("each 'note' is just a hit of a specific
drum"). dotbeat does **not** need the 128-pad grid *UI* or the per-pad device chains; it needs the
**lane identity space to be bigger than five and, ideally, drawn from a standard vocabulary** so
that kits are interchangeable and clips are portable — which is precisely what GM note-naming buys
Ableton. dotbeat's advantage: it can use **readable lane names** (`kick`, `snare`, `rimshot`,
`cowbell`) as the identity instead of MIDI note numbers, staying true to its "legible text file"
thesis while getting the same interchange property.

---

# Part III — Standard kit taxonomies (cited)

The brief asked for real voice lists from real sources, not assumed knowledge.

## Roland TR-808 — the canonical analog kit

The 808 has **16 drum voices + an accent** [cited, Roland official spec + Wikipedia]:
bass drum, snare drum, low/mid/high tom, low/mid/high **conga**, rimshot, claves, maracas, hand
clap, cowbell, cymbal, open hi-hat, closed hi-hat. (Note the 808's toms and congas are the *same
voice circuits* at different tunings — 3 tom + 3 conga = 6 pitched-percussion voices, a detail worth
remembering: "toms" is really "3 tuned membrane voices.") Per-voice tweakable params are minimal and
per-voice-specific: bass drum has level/tone/decay; snare has level/tone/snappy; cowbell and cymbal
have level/tone/decay [cited]. This near-1:1 matches dotbeat's existing per-voice-param philosophy
(`kickTune/kickPunch/kickDecay`) — the 808 is the *archetype* dotbeat's hand-synthesis model is
already imitating.

## Roland TR-909 — the canonical hybrid kit

The 909 has **11 voices** [cited, Wikipedia / Vintage Synth Explorer]: bass drum, snare, low/mid/hi
tom, rimshot, hand clap, closed hi-hat, open hi-hat, crash cymbal, ride cymbal. Notably **hybrid**:
the crash, ride and hi-hats are **6-bit samples**; the kick, snare, toms and clap are analog-
synthesized [cited]. **This is itself the "both substrates" answer in hardware form** — even the
archetypal drum machine used synthesis for the punchy tonal voices and samples for the metallic/
noisy cymbals, because sampling was the cheaper path to a convincing crash. dotbeat can and should
draw the same line for the same reason (Part V).

## General MIDI percussion key map — the broad "complete kit" reference

The GM Level 1 percussion map defines **47 named percussion sounds on MIDI notes 35–81**, played on
**MIDI channel 10** (channel index 9) [cited, GM spec via CMU / MuseScore / Computer Music
Resource]. The full map:

| Note | Sound | Note | Sound | Note | Sound |
|---|---|---|---|---|---|
| 35 | Acoustic Bass Drum | 51 | Ride Cymbal 1 | 67 | High Agogo |
| 36 | Bass Drum 1 | 52 | Chinese Cymbal | 68 | Low Agogo |
| 37 | Side Stick | 53 | Ride Bell | 69 | Cabasa |
| 38 | Acoustic Snare | 54 | Tambourine | 70 | Maracas |
| 39 | Hand Clap | 55 | Splash Cymbal | 71 | Short Whistle |
| 40 | Electric Snare | 56 | Cowbell | 72 | Long Whistle |
| 41 | Low Floor Tom | 57 | Crash Cymbal 2 | 73 | Short Guiro |
| 42 | Closed Hi-Hat | 58 | Vibraslap | 74 | Long Guiro |
| 43 | High Floor Tom | 59 | Ride Cymbal 2 | 75 | Claves |
| 44 | Pedal Hi-Hat | 60 | Hi Bongo | 76 | Hi Wood Block |
| 45 | Low Tom | 61 | Low Bongo | 77 | Low Wood Block |
| 46 | Open Hi-Hat | 62 | Mute Hi Conga | 78 | Mute Cuica |
| 47 | Low-Mid Tom | 63 | Open Hi Conga | 79 | Open Cuica |
| 48 | Hi-Mid Tom | 64 | Low Conga | 80 | Mute Triangle |
| 49 | Crash Cymbal 1 | 65 | High Timbale | 81 | Open Triangle |
| 50 | High Tom | 66 | Low Timbale | | |

This is the **genuinely standard, decades-stable reference** for "what counts as a complete drum
kit's voice list," and — critically — **it is already the addressing scheme the SoundFont path in
dotbeat's engine speaks** (Part IV). It is also the vocabulary Ableton's factory Drum Racks lay out
against (Part II). It is the natural spine for dotbeat's expanded lane naming.

**Reading these three together**: the 808 (16) and 909 (11) are *subsets/re-tunings* of the GM map's
low region (notes 35–59: kicks, snares, toms, hats, cymbals, clap, cowbell, claves). GM's upper
region (60–81) is the "world/aux percussion" long tail (bongos, congas, agogos, guiros, cuicas)
that a pop/electronic kit rarely uses. So a realistic dotbeat "standard kit" is **~10–16 voices from
the GM 35–59 band**, not all 47 — the 47 is the *ceiling*, the ~12 is the *working kit*.

---

# Part IV — Cross-reference against what dotbeat already has

This is the crux the brief flagged: is expanding cardinality better done by (a) generalizing the
hand-synthesized engine, or (b) leaning on the already-built sample/SoundFont pathway?

### What's already built and verified

- **Sample one-shot kits** [verified-local]: `presets/kit-init`, `presets/kit-audiophob` — 5 `.wav`
  + provenance-sidecar one-shots each, addressed via `lane <lane> <sample-id> …` (v0.5). The
  content-addressed-media machinery (sha256 pinning, sidecars) is solid and mature.
- **SoundFont banks, fetched and verified** [verified-local, `presets/sf2/*.json`]: `fluidr3-gm-
  small.sf2` (FluidR3 GM, MIT, Phase 10/12) and `muldjordkit-small.sf2` (FreePats MuldjordKit,
  CC-BY-4.0). Two facts here are decisive:
  1. **`fluidr3-gm-small.sf2` already includes a GM percussion preset** — its sidecar `notes` field
     lists the trimmed presets as including **"program 0 [drum] 'Standard'"** alongside the melodic
     programs. A GM "Standard" drum preset **is the full 47-voice map on notes 35–81**. dotbeat has
     already fetched, trimmed, licensed, and bundled a complete standard drum kit's worth of named
     voices, addressable by MIDI note — it just isn't wired to drum tracks.
  2. **`muldjordkit-small.sf2` is a realistic acoustic kit** — "13 kit pieces … 2 velocity layers
     per key … bundled as a single playable SF2 preset (loads via the same instrument-track +
     SoundBankLoader path)." Its sidecar even names the open follow-up: *"NOT yet broken out into
     per-lane one-shots (presets/kit-init/kit-audiophob convention); that mapping (13 kit pieces →
     5 dotbeat drum lanes) is a follow-up curation pass."* — i.e. someone already noticed that
     collapsing 13 real kit pieces into 5 lanes is lossy, and deferred it. **This research answers
     that deferred question: don't collapse to 5 — widen the lanes to fit the 13.**
- **The SoundFont engine path plays named percussion by note today** [verified-local,
  `engine.ts:829, 1060`]: `programChange` + `noteOn(channel, midi, vel)`. To play the GM "Standard"
  drum preset you select the drum bank/program and trigger notes 35–81. spessasynth follows GM, so
  **channel 9 (MIDI channel 10) is the drum channel** — a real detail: the current instrument path
  hardcodes channel `0` (`programChange(0, …)`, `noteOn(0, …)`), so a drum-oriented voice would need
  to target the drum channel (or select the drum preset explicitly). Small, known change; not free,
  but far from a new subsystem.

### The honest comparison

| Dimension | (a) Generalize hand-synthesized lanes | (b) SoundFont-backed pads |
|---|---|---|
| **New voices cost** | Each new voice = a hand-built Tone.js node + bespoke trigger `case` + new `SYNTH_FIELDS` char params. ~Linear hand-work per voice; 16 voices = a lot of bespoke DSP. | **Zero per-voice DSP** — the GM bank already contains all 47. Cost is one-time: wire the SoundFont path to drum tracks + a lane→note map. |
| **Character control** | **High and per-voice** — `kickTune/kickPunch/kickDecay` etc. give exactly the hand-tuned 808/909 knobs that *define* those electronic voices. This is the 808's whole identity. | **Low** — a sampled voice is what it is; you get gain/tune/velocity, not "punch"/"snappy." Realism is baked into the sample, not dialable. |
| **Realism (acoustic kits)** | **Poor** — hand-synthesizing a convincing acoustic ride/crash/brush is exactly the hard problem the 909's designers dodged by sampling. | **Excellent** — MuldjordKit is real multi-mic, multi-velocity acoustic samples. This is the *only* good path to a believable acoustic kit. |
| **Diff/format footprint** | Bigger `SYNTH_FIELDS` (more per-voice params) + a bigger lane enum. Stays in the "literal params" house style. | Reuses the mature media/sha256/sidecar machinery + a lane→note declaration. No new DSP surface in the format. |
| **Already proven in dotbeat** | Yes — the 5 current voices work and are verified. | Partly — the instrument-track SF path is verified (Phase 14); wiring it to *drum tracks* on the drum channel is the unbuilt piece. |

The two approaches are **strongest in opposite regimes**, and the 909 already demonstrated the split
in hardware (synth for punchy tonal voices, sample for metallic/noisy ones). This is the
"both, for different cases" answer the brief anticipated, and the evidence genuinely supports it —
so this doc gives that answer rather than forcing one.

---

# Part V — The recommendation on substrate: **both, cleanly separated by role**

**Synthesized lanes for the classic electronic-drum-machine voices where hand-tuned params define
the character; SoundFont/sample-backed pads for realistic acoustic and long-tail-percussion kits.**

Concretely:

1. **Keep and generalize the synthesized-voice engine for the electronic canon** — 808/909-style
   kits. These *need* the hand-tuned character params (`tune/punch/decay/tone/snappy`); a static
   sample can't be swept the way a real 808 kick's decay is. Generalize it so the voice set is
   **data-driven** (a lane→`{voiceType, params}` table) instead of a hardcoded 5-case switch, so
   adding "rimshot," "cowbell," "clap-with-decay," "3 toms" is a table entry, not new bespoke DSP
   each time. The existing `MembraneSynth`/`NoiseSynth`/`MetalSynth` building blocks already cover
   most 808/909 voices (membrane → kick/toms/congas/cowbell-ish, noise+filter → snare/clap/maracas,
   metal → hats/cymbals) — the work is *parameterizing and tabulating* what's already there, not
   inventing new synths.

2. **Wire the SoundFont path to drum tracks for realistic kits** — this is the cheap, high-leverage
   move. dotbeat already ships a complete GM "Standard" drum preset (all 47 voices) and a realistic
   acoustic kit (MuldjordKit). A drum track whose lanes are backed by SoundFont notes gets a full
   realistic kit **for near-zero new DSP** — reuse the verified spessasynth path, retargeted to the
   drum channel with a lane→note map. This directly closes the MuldjordKit "13 pieces → 5 lanes"
   TODO its own sidecar flagged.

3. **Unify all three substrates under one lane concept.** A lane's *identity* (its name, its
   position in canonical order, the `hit` events that trigger it) is independent of its *backing*
   (synthesized voice / sample one-shot / SoundFont note). dotbeat **already** has this shape at the
   lane level — a lane is synth-backed by default and sample-backed if a `lane` line names a sample
   (Part I). Extend that same either/or to add a SoundFont backing. This keeps the clip content
   (`hit` lines) — the thing the owner cares about, the "piano roll for drums" — **completely
   stable across kit swaps**, which is exactly the Drum-Rack interchange property from Part II.

---

# Part VI — Format implications (the diff-friendliness analysis D4/D7 requires)

This is a format change and must clear the same bar as every other (`docs/decisions.md` D4 —
"diff-friendliness is a format requirement"; D7 — "one canonical serialization per state"). Two
candidate shapes:

### Option A — grow the closed `DrumLane` enum

Add ~10 more members (`rimshot`, `tom_lo`, `tom_mid`, `tom_hi`, `cowbell`, `ride`, `crash`,
`clap_2`, `perc`, …) to the fixed union.

- **Pro**: minimal grammar change; the "always emit all lanes in canonical order" invariant
  (`format-spec.md:169`) still holds trivially.
- **Con (fatal-ish)**: the current invariant is **"all lanes always emitted."** With 5 lanes and a
  `pattern` line each that's tolerable; with 20 it means **every drum track serializes 20
  always-present lanes** even when 16 are empty — noisy files, and worse, *changing the canonical
  set later re-lines every existing drum track in the repo* (a global reflow diff — exactly the
  false-diff churn D4/D7 exist to prevent). Since v0.8 moved drums to **free-timed `hit` events**
  (not per-lane `pattern` strips), "emit all lanes" is *already* only a `pattern`-view constraint,
  not a storage one — `hit` lines only exist for lanes that actually have hits. So the "always emit
  all lanes" rule is **already softened** by the v0.8 event model. A bigger enum leans on a rule
  that's already half-gone.
- **Also**: a fixed universal enum can't express "this kit's lane is *rimshot*, that kit's lane is
  *timbale*" — it forces one global vocabulary, which is fine for GM-standard names but rigid for
  custom kits.

### Option B (recommended) — an **open, per-kit declared lane set**

Each drum track **declares its own ordered lane list**, the same way instrument tracks declare their
own soundfont program (`src/core/document.ts:187-192`) rather than drawing from a global enum. A
lane declaration names the lane and its backing:

```
track drums Drums #e35d5d drums
  # each lane: <name> <backing>. backing = synth:<voiceType> | sample <id> <gain> <tune> | sf <id> <program> <note>
  lane kick    synth:membrane
  lane snare   synth:noise
  lane hat     synth:metal
  lane rimshot sf kit-gm 0 37
  lane cowbell sf kit-gm 0 56
  ...
  hit h1 kick 0 0.9
  hit h2 snare 4 0.8
  hit h3 rimshot 6 0.6
```

- **Canonical ordering (D7)**: the lane list is **declaration-ordered** and that order *is* the
  canonical order — same discipline already used for `clip`s and `auto` lanes ("first-seen
  (creation) order … order of creation is meaningful, not alphabetized," `format-spec.md:411`).
  `hit` lines then serialize by `(start, lane, id)` as today, where "lane" sorts by declared
  position, not alphabetically. **One canonical form per state**: a given kit + set of hits has
  exactly one serialization. No global reflow when the *standard* kit changes, because each track
  carries its own list.
- **Diff-friendliness (D4)**: adding a lane = one new `lane` line + whatever `hit` lines reference
  it (a local, legible diff). Swapping a lane's backing (synth kick → sampled kick) = **one line
  changed**, and — crucially — **the `hit` lines don't move**, so "change the kick sound" stays a
  one-line diff exactly like the existing v0.5 "swap-the-kick is a one-line diff" property
  (`format-spec.md:291`). Renaming/removing a lane is a bounded, ID-anchored change.
- **Backward compatibility**: v<current> files with the implicit 5 lanes migrate by emitting the 5
  canonical `lane` declarations (`kick synth:membrane`, … in `DRUM_LANES` order) on read — lossless
  and automatic, the same migration pattern v0.8 used for pattern→hits (`format-spec.md:354`).
- **Per-voice character params**: the existing per-lane `SYNTH_FIELDS` (`kickTune` etc.) generalize
  into per-lane param sub-lines on synth-backed lanes (e.g. `lane kick synth:membrane tune=32.7
  punch=0.05 decay=0.4`), elided-when-default exactly like the current `SYNTH_FIELDS` canonical
  elision (D3). This retires the awkward "char params for exactly kick/snare/hat live in the
  track-wide synth block" arrangement and puts each voice's character next to the voice it shapes.

**Verdict: Option B.** It matches how dotbeat *already* declares per-track voices (instrument
tracks), keeps clip content stable across kit swaps (the interchange property that makes it a real
drum rack), and keeps every mutation a local, ID-anchored, one-canonical-form diff. Option A's
"bigger closed enum" fights the very invariant (all-lanes-always-emitted) that the v0.8 event model
already made vestigial. This is a **deliberate, versioned grammar addition** — the kind D7 says to
design on its own merits with full canonical-form scrutiny — not an incremental widening.

*(Scope note: this is a meaningfully bigger format change than the LFO-coverage widening research 18
recommended. It's the right size for its own dedicated stream, not a rider on Phase 18's layout
work.)*

---

# Part VII — Explicit, actionable recommendation

**Headline: do BOTH substrates, under one open per-kit lane model. Synthesized lanes for the
electronic drum-machine canon (808/909), SoundFont/sample-backed lanes for realistic acoustic and
long-tail percussion. Ship a ~12-voice standard kit as the new factory default, drawn from the GM
35–59 band so kits and clips are interchangeable.**

### Suggested default/factory kit voice list (dotbeat's new default drum track)

A **12-lane General-MIDI-aligned kit** — the working subset of the GM map (Part III), covering the
808/909 canon plus the few extras a real pop/electronic kit uses, each lane carrying its GM note so
it's interchangeable and SoundFont-playable:

| Lane name | GM note | Default backing | Rationale |
|---|---|---|---|
| `kick`      | 36 | synth:membrane | 808/909 core; hand-tuned punch matters |
| `snare`     | 38 | synth:noise    | 808/909 core; tone/snappy matter |
| `rimshot`   | 37 | synth:noise    | 808/909; cheap synth voice |
| `clap`      | 39 | synth:noise    | 808/909 core |
| `hat`       | 42 | synth:metal    | closed hat, 808/909 core |
| `openhat`   | 46 | synth:metal    | open hat, 808/909 core (choke pair with `hat`) |
| `tom_lo`    | 45 | synth:membrane | 808/909 tom (tuned membrane) |
| `tom_mid`   | 47 | synth:membrane | 808/909 tom |
| `tom_hi`    | 50 | synth:membrane | 808/909 tom |
| `crash`     | 49 | sf/sample      | metallic — sample wins (the 909 lesson) |
| `ride`      | 51 | sf/sample      | metallic — sample wins |
| `cowbell`   | 56 | synth:membrane | 808 signature voice |

This is a superset of today's 5 lanes (so migration is a pure superset — existing files keep
`kick/snare/clap/hat/openhat` and gain nothing they didn't ask for) and a subset of GM (so it's
portable and SoundFont-backable). Ship it two ways using the machinery already present:

- **`kit-808` / `kit-909`** — synth-backed presets, using the generalized data-driven voice table
  (the hand-tuned character params are the point).
- **`kit-acoustic`** — SoundFont-backed against the already-bundled `muldjordkit-small.sf2` (closes
  its own "13 pieces → lanes" TODO) or the FluidR3 GM "Standard" drum preset. Realistic, near-zero
  new DSP.

### Concrete build path (for a future stream to execute directly)

**Format** (`src/core/document.ts`, `docs/format-spec.md`, parser/serializer/convert/diff):
1. Replace the closed `DrumLane` enum with an **open per-track ordered lane list** (Part VI Option
   B): each `BeatTrack` (drum kind) carries `lanes: BeatDrumLaneDecl[]`, where a decl is
   `{ name, backing }` and `backing` is a tagged union `synth:<voiceType>` |
   `sample <id> <gain> <tune>` (existing `BeatLaneSample`, generalized off the fixed enum) |
   `sf <id> <program> <note>`.
2. Move the per-voice character params off the track-wide `SYNTH_FIELDS` block onto **per-lane
   param sub-lines** on synth-backed lanes, with the same canonical-elision (D3) discipline. Retire
   `kickTune/kickPunch/kickDecay/snareTone/snareDecay/hatDecay/openHatDecay/hatTone` from the
   track-wide synth block in favor of generic per-lane `tune/punch/decay/tone/…`.
3. `hit`/`pattern` reference lanes **by declared name**; canonical order is declaration order; the
   "all lanes always emitted" rule is dropped (v0.8's event model already made it vestigial). Parser
   validates that every `hit`'s lane is declared.
4. Migration: v<current> files → emit the 5 canonical lane decls in `DRUM_LANES` order; lossless.

**Engine** (`ui/src/audio/engine.ts`):
5. Replace the hardcoded `DrumKit` struct + `switch (lane)` `triggerDrum` with a **lane→backing
   dispatch table** built from the track's lane decls: synth-backed → a Tone.js voice built from
   `{voiceType, params}` (reuse the existing Membrane/Noise/Metal builders, now parameterized);
   sample-backed → a Tone.Player one-shot (this also finally implements the deferred v0.5 live
   sample-lane playback, `engine.ts:42`); sf-backed → a spessasynth voice on the **drum channel**
   (channel 9, not the hardcoded `0` the instrument path uses) triggered by the lane's GM note.
6. Add choke-group handling for the hat pair (open hat silenced by closed hat) — a small, standard
   behavior the 12-voice kit needs.

**Presets** (`presets/`): ship `kit-808`, `kit-909` (synth), `kit-acoustic` (SoundFont via
MuldjordKit / FluidR3 GM drum preset). The 12-lane GM-aligned list above is the default for
`beat init` drum tracks.

**Do NOT build**: the 128-pad grid UI, per-pad device chains, key/velocity zones, chain selectors,
return chains — research 18's Racks-skip stands. dotbeat gets the *drum-rack cardinality and
interchange* the owner asked for from the open lane list + GM naming alone, with none of the nested-
document machinery.

---

## Honest gaps & things to verify before implementation

- **Ableton factory pad→note layout (Part II)** is [general], corroborated by the GM note numbers
  which are [cited]. The *architectural* point (pads are notes; factory kits follow GM) is robust;
  the exact "16 visible = notes 36–51" default is worth a 5-second confirm against a live Ableton if
  it ever drives a UI decision.
- **spessasynth drum-channel behavior** — that channel 9 is the GM drum channel is [general/cited
  GM], but confirm spessasynth_lib honors GM channel-10 drum-map semantics (vs. requiring explicit
  drum-preset selection) before wiring the sf-backed path; the current instrument path only ever
  used channel 0 melodically.
- **Live sample-lane playback is currently unimplemented in the GUI engine** (`engine.ts:42`,
  Part I) — the recommendation *includes* building it; don't assume it already works.
- **Retiring the per-lane `SYNTH_FIELDS`** (`kickTune` etc.) is a breaking change to the synth
  block's field table; the migration must map old track-wide char params onto the new per-lane
  decls for the 5 legacy lanes. Lossless but non-trivial — size it as real work.
- **This doc did not re-verify the 808/909 exact per-voice param sets** beyond the cited high-level
  lists; if the synth voice table wants to faithfully model (say) the 808 cowbell's two-oscillator
  structure, that's a further sound-design pass (see `docs/research/07-sound-design-sources.md`).

## Sources

- General MIDI Percussion Key Map (notes 35–81, 47 sounds, channel 10) — CMU CMSIP archive of the
  GM spec: https://www.cs.cmu.edu/~music/cmp/archives/cmsip/readings/GMSpecs_PercMap.htm ;
  corroborated: https://computermusicresource.com/GM.Percussion.KeyMap.html ,
  https://musescore.org/sites/musescore.org/files/General%20MIDI%20Standard%20Percussion%20Set%20Key%20Map.pdf ,
  https://en.wikipedia.org/wiki/General_MIDI
- Roland TR-808 voice list (16 voices + accent) — Roland official technical specs:
  https://support.roland.com/hc/en-us/articles/201963539-TR-808-Technical-Specifications ;
  https://en.wikipedia.org/wiki/Roland_TR-808 ; https://www.vintagesynth.com/roland/tr-808
- Roland TR-909 voice list (11 voices, hybrid analog+sample) —
  https://en.wikipedia.org/wiki/Roland_TR-909 ; https://www.vintagesynth.com/roland/tr-909
- Ableton Drum Rack pad grid (128 pads, 16 visible, note-per-pad, choke groups) — Ableton Live 12
  manual, Instrument/Drum/Effect Racks: https://www.ableton.com/en/live-manual/12/instrument-drum-and-effect-racks/
  (summarized in `docs/research/18-ableton-ui-architecture.md` §6)
- dotbeat internal [verified-local]: `src/core/document.ts` (`DRUM_LANES`, `SYNTH_FIELDS` drum-voice
  rows, `BeatLaneSample`, `BeatInstrument`), `ui/src/audio/engine.ts` (`DrumKit`, `triggerDrum`
  switch, `applyDrumVoiceParams`, spessasynth instrument path, line 42 deferred-items note),
  `docs/format-spec.md` (v0.2 patterns, v0.5 sample lanes, v0.6 instrument tracks, v0.8 hits),
  `docs/decisions.md` (D4 diff-friendliness, D7 canonical ordering, D3 canonical elision),
  `presets/sf2/fluidr3-gm-small.sf2.json` (GM "Standard" drum preset included),
  `presets/sf2/muldjordkit-small.sf2.json` (13-kit-piece acoustic kit, "→ 5 lanes" TODO),
  `presets/kit-init` / `presets/kit-audiophob` (5-lane sample one-shot kits),
  `docs/research/12-drum-representation.md` (events-not-grids), `docs/research/18-ableton-ui-architecture.md`
  (Racks-skip, Drum Rack pad grid).

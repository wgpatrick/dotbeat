# Research 115 — the production layer: how produced electronic tracks get rich, and how dotbeat encodes it

*2026-07-21. Commissioned after the blind-eval findings that dotbeat's output loses to
commercial-record chops on production RICHNESS, not cleanliness: the measured gaps are
**mono output** (stereo-width metric ≈ -52 dB vs ≈ -11 dB for real records), **near-zero air-band
energy**, and the lowest **Audiobox production-COMPLEXITY** scores in the showdown pool (≈2.1 vs
≈4.5 for reference chops) — while production-QUALITY scores were flat across sources
(`docs/source-showdown-eval.md`, memory: showdown report 2026-07-21, engine 0/15 pairwise wins).
The diagnosis this doc starts from: the sound is too simple — unlayered, static, dry, narrow.
This pass researches how produced house/techno/electronica (the Floating Points / Four Tet /
Keinemusik / Dom Dolla reference space) actually achieves complexity, and maps each move onto
dotbeat features that exist, need small additions, or need real building. Research + proposal
only — no code changes.*

## How to read this doc

- Production-practice claims are web-sourced this pass (single-agent search + snippet extraction,
  NOT the 3-vote adversarial harness research 07/107 Part 1 used) — each carries a confidence
  label. Treat *(high)* as multi-source-corroborated tutorial/engineering consensus, *(medium)* as
  1-2 sources or partially snippet-derived, *(low)* as inference. URLs in Sources.
- dotbeat claims are read directly from this repo this pass: `src/core/document.ts`
  (`SYNTH_FIELDS`, `BeatGroup`, `EFFECT_TYPES`), `ui/src/audio/engine.ts` (buses, master chain,
  duck, unison), `src/analysis/genkit.ts`, `docs/format-spec.md`, and prior research docs 17
  (fx arsenal), 40 (grooves), 45 (racks/layering), 46/47 (automation/clip envelopes), 107
  (taste program) — cited as [research N] rather than re-derived.

## Headline

**dotbeat's engine already owns most of the DSP the production layer needs. What's missing is
(a) three genuinely absent primitives — bass-mono discipline, a band-limited exciter, and any
document-driven master-bus chain — and (b), much more importantly, the fact that nothing in the
generation/authoring path ever TOUCHES the production surface that exists.** Verified this pass:
`src/analysis/genkit.ts` — the gen-kit pipeline that produces the auditioned output — sets zero
occurrences of `sendReverb`, `sendDelay`, `unison*`, `chorus*`, `utility*`, `duckSource`, or any
`effect` line. Every gen-kit project ships at the canonical defaults, and the canonical defaults
are, by design (D9 elision: "an init patch is still 9 lines"), a dry, mono, static, one-oscillator
sound. The -52 dB width number is not an engine limitation — `unisonWidth`, `chorusMix`,
`pingPong*`, `utilityWidth`, `autoPan*`, and a stereo reverb bus all exist and all default to
off/neutral. The single highest-leverage move is therefore a **"produced defaults" layer**
(per-role preset profiles + gen-kit writing them), which needs zero format work, followed by a
short list of small format additions (below, §6) ordered by the measured gaps: width first, air
second, motion/sidechain third, master glue fourth.

---

## 1. Layering: how producers stack sounds per musical role

### 1.1 The practice

- **Bass is the canonical 3-layer stack: sub + mid + top.** A sine/near-sine SUB layer kept below
  ~100 Hz (low-passed, mono); a MID layer carrying ~100-500 Hz — "where most of the sound we hear
  resides"; a TOP/harmonics layer ~500 Hz-2 kHz adding presence and letting the bass read on small
  speakers. *(high — Subaqueous, Waves, Weapon Sounds all teach the same split)* The sub stays
  static and mono; the character/motion lives in the upper layers.
- **Leads/pads: 2-4 deliberately different layers, not "7 layers" for its own sake.** The
  "giant lead = many layers" cliché is real practice but the number is not the point: deadmau5's
  MasterClass approach is layering slightly-altered copies (different detune/envelope/waveform)
  until it's rich enough — "how much do you want to layer it?" — with EQ carving each layer into
  its own band so they read as one *(medium)*. Trance/house supersaw practice stacks "two or three
  saw-based layers with different unison counts, not one giant supersaw doing everything," plus a
  low-level white-noise layer for the wash *(high — Syntorial, Soundbridge, KVR)*. Four Tet — the
  reference-space counterexample worth keeping in view — works with only **10-14 channels total**
  and mostly presets, getting his complexity from *texture layers* ("little bits of texture mixed
  with everything") and processing rather than voice-count *(high — Tape Notes TN:140,
  MusicRadar)*. Lesson: **complexity per role saturates around 2-4 distinct layers; past that
  it's EQ carving and texture, not more voices.**
- **What glues layers into one instrument** *(high, multi-source)*:
  1. **Shared/similar envelopes** — layers that attack and release together read as one note;
     a shared pitch envelope glues layers whose amp/filter envelopes differ.
  2. **Bus compression** — route the layers to one bus, light glue compression (2:1-ish, slow
     attack, 2-4 dB reduction) so they "move in sync" dynamically.
  3. **Shared saturation/chorus on the summed bus** — common harmonic distortion and common
     modulation stamp one identity onto all layers at once.
  4. **EQ carving** — each layer owns a band (the deadmau5 point); overlap is what makes stacks
     sound like mud instead of one big sound.

### 1.2 dotbeat mapping — what a "layer" means here

Three distinct answers, and the codebase already ranks them:

- **Synth-internal layering already exists and is the cheap 80%.** One dotbeat synth track is
  itself a 2-4 layer stack when the fields are used: `osc` + `osc2Type/osc2Level/osc2Detune`
  (second detuned layer), `subLevel` (the mono sub layer, default 0), `noiseLevel` (the texture/
  wash layer, default 0), `unisonVoices/unisonWidth` (the width stack), `fm*` (character). All
  glue mechanisms are automatic — one amp/filter envelope, one insert chain, one saturator drive
  the whole bank. **The 3-layer bass stack is expressible today in one track**: sub sine via
  `subLevel`, mid via the main osc + filter, top via `osc2` + `distortion`/`saturator`. Nothing
  ships with these on ([Headline]); that's a defaults problem, not a format problem.
- **Cross-track layering exists but has no glue.** Layering a sampled top over a synth sub means
  two tracks playing duplicated notes: (a) note edits must be made twice (no shared-note
  mechanism — acceptable churn for 2 tracks, and `beat vary`/tooling can keep them in sync), and
  (b) there is **no group bus**: `BeatGroup` (`document.ts:976`) is a named, colored *visual fold*
  only — no volume, no fx chain, no sends, explicitly "a view convenience, not a musical fact."
  So Ableton's rack-style glue (per-chain mix into one processed sum — [research 45] §1, §6) has
  no dotbeat equivalent: cross-track layers can't share a compressor or saturator. Sends to the
  shared reverb are the only shared processing two tracks can have.
- **A `layer` primitive should be tooling first, grammar maybe never.** [research 45] and
  [research 27] already establish the house pattern: indirection (racks, macro mappings) stays out
  of the file; compound edits that emit literal lines are the dotbeat-native shape. A
  `beat layer <file> <track> [--role sub|top|noise]` compound edit — clone the track, apply a
  role-appropriate param delta (e.g. `--role top`: +12/+24 st transpose or osc2-heavy patch,
  high-passed via `eq7HpOn`), copy notes — delivers the workflow with zero grammar. The
  format-level change worth considering separately is **giving `BeatGroup` bus semantics**
  (group `volume`, group `effect` chain — the glue-compression target); that is a real, additive
  format design (routing between two flat lists), scoped in §6 P6.

---

## 2. Stereo width: the toolbox, its WebAudio cost, and mono discipline

The -52 dB vs -11 dB width gap is the single largest measured deficit, and it is the cheapest to
close because the output is currently *centered mono by default*, not narrowly mixed — almost any
non-zero width move registers.

### 2.1 The actual toolbox, by practice

| Technique | What it is | Mono-sum risk | dotbeat today | WebAudio cost |
|---|---|---|---|---|
| **Detuned unison spread** | 3-9 detuned voices panned across the field (the supersaw); practice: detune "until it just starts to sound out of tune," width 60-80% leaving mono energy in the center *(high)* | Low — different frequencies barely comb | **EXISTS**: `unisonVoices`/`unisonWidth` + `osc2Detune` (outer pairs panned, `engine.ts` uniPairs); defaults 1/0 = off | Already paid (extra voices per note) |
| **Chorus / ensemble** | Modulated short delays; the standard pad/lead widener | Low-moderate | **EXISTS**: per-track `chorus*` insert (Phase 22 AC), default mix 0 | Already paid (`Tone.Chorus`) |
| **Mid/side width control** | Widen by scaling the side signal | None (side scales down to mono cleanly) | **EXISTS**: `utility` insert wraps `Tone.StereoWidener` (0.5 = neutral) | Trivial (2 gains + M/S matrix) |
| **Ping-pong / stereo delay** | Echoes alternating L/R | Low | **EXISTS** per-track (`pingPong*`); but the shared `delayBus` is a MONO `Tone.FeedbackDelay` (`engine.ts:1949`) — `sendDelay` adds zero width today | Trivial |
| **Stereo reverb** | Decorrelated L/R tails — the passive width bed under everything in produced tracks | None in practice | **EXISTS**: `reverbBus` is `Tone.Reverb` (stereo convolution), but `sendReverb` defaults 0 and gen-kit never sets it | Already paid |
| **Auto-pan** | LFO pan movement — width via motion | None | **EXISTS**: `autoPan*` insert + `lfo2Dest: pan` | Already paid |
| **Haas / micro-delay** | 5-35 ms one-sided delay; dramatic width from any mono source | **HIGH — the layered part thins or vanishes on mono sum (comb filtering)**; SOS and mastering guides consistently flag it; M/S width is "often a better option" *(high)* | Absent as a primitive (a `pingPongTime` at ~10ms approximates it badly) | Trivial (one DelayNode) — but see verdict below |
| **Mid-side EQ (side high-shelf)** | +2-4 dB shelf ~10 kHz on the SIDE channel only — width *and* air in one move, mastering-standard *(high)* | None | Absent — `eq3`/`eq7` are L/R-linked only | Cheap (M/S matrix + one shelf ×2) |

**Verdict on Haas**: skip it as a first-class primitive. Every cheap-width alternative above is
mono-safe; Haas is the one classic tool whose failure mode (disappearing in mono — clubs and
phone speakers both sum) directly attacks the genre's own delivery targets. *(high)*

### 2.2 Mono-compatibility discipline

- **Bass stays mono below ~100-120 Hz.** Standard club-delivery practice: sides high-passed
  ~100-200 Hz so the sub exists only in the mid channel; below ~120 Hz humans can't localize and
  club systems often sum the lows *(high — Weapon Sounds, MusicRadar, Quora consensus)*. The
  standard tool is Ableton Utility's "Bass Mono below N Hz" switch ([research 17] §1 noted
  dotbeat's `utility` skipped exactly this half).
- dotbeat's exposure today is the inverse problem — output is *too* mono, not mono-unsafe. But the
  moment width defaults ship (§6 P1), a **`utilityMonoBelow` field** (crossover Hz, 0 = off) on
  the existing `utility` insert becomes the guard rail: split at the crossover, sum the low band
  to mono, pass the high band. ~15 lines of `Tone.Filter` + gain plumbing, one new
  `SYNTH_FIELDS` number, automatable for free. *(engine estimate: low)*
- Worth adding to the analysis tooling ([research 102] family): a **stereo-correlation /
  width-below-120 Hz metric** alongside the existing width metric, so produced defaults can be
  verified mono-safe in the same eval loop that measured the gap.

---

## 3. Air / top-end: what fills 8-16 kHz in produced tracks

The reference chops have continuous energy above ~10 kHz; dotbeat renders have near-zero. Four
distinct fill mechanisms in practice, cheapest first:

1. **Open hi-hats and cymbal-class percussion as spectral fill.** Hats live at 4-10 kHz with
   sizzle above; a running eighth/sixteenth hat pattern is the genre's default air-band carrier
   *(high — iZotope, eMastered)*. dotbeat: `openhat` lane exists in every default kit, hat voices
   are filtered noise (`hatTone`/`openHatDecay`), and gen-kit's starter groove writes eighth
   hats — but sample-picked hats are chosen by centroid ~6 kHz and nothing pushes sustained
   >10 kHz content. Cheap fixes: raise `hatTone`, prefer brighter hat candidates (add an air-band
   energy term to the hats-role pick heuristic in `genkit.ts`), and make the seeded groove
   actually use `openhat` (sustained decay = sustained air) rather than closed hats only.
2. **Noise layers.** Low-level filtered white noise under leads/pads ("washy sizzle" of supersaw
   stacks *(high)*), or as its own riser/texture track. dotbeat: `noiseLevel` exists per synth
   track (default 0); a dedicated noise-pad track is expressible today (osc silent,
   `noiseLevel` 1, high-passed via `eq7HpOn`, `sendReverb` up).
3. **High-shelf EQ.** +2-4 dB shelf in the 10-15 kHz zone; "decent results with almost any EQ
   with a shelving filter set in the 10-15 kHz area" *(high — Production Expert, eMastered)*.
   dotbeat: `eq7HighShelfFreq/Gain` exists (default 8 kHz, off) — usable TODAY, per track; the
   missing surface is a master-bus location for it (§5) and side-only shelving (§2.1).
4. **Exciters — harmonic generation, not boost.** The modern "air" tools (Fresh Air, Maag Air
   band at 10-40 kHz, Clariphonic) *synthesize new* band-limited harmonics from the existing
   top end — they add sheen where a shelf can only amplify what's already there (and dotbeat's
   synth output above 10 kHz is often nothing, so a shelf boosts silence) *(high)*. dotbeat:
   absent. The classic exciter topology is small: parallel path → high-pass ~3-6 kHz →
   waveshaper → mix back at low level. That is exactly the `vinyl`/`saturator` build tier
   ([research 17] §3: WaveShaper + filter primitives already proven) — a new `exciter`
   `EffectType` with `exciterFreq`/`exciterAmount`/`exciterMix`, additive to `EFFECT_TYPES` like
   eq7 was. *(engine estimate: low-moderate, smaller than grainDelay was)*

Note the interaction: mechanisms 1-2 create real top-end content; 3-4 shape/extend it. A shelf
alone cannot fix a synth patch whose lowpass `cutoff` default (and taste-searched values) sits
at 1-9 kHz — patch-level brightness (cutoff, noise, hats) has to come first. *(medium/inference)*

---

## 4. Motion: what actually moves in produced tracks

Audiobox production-complexity plausibly rewards exactly this — spectral/dynamic change over
time — and dotbeat's renders are near-static end to end.

### 4.1 What moves, at what rates *(high unless noted; EDMProd, Hyperbits, MusicRadar, Unison)*

- **Filter cutoff** — the genre's #1 automation target. Slow macro sweeps (8-16 bars: intro
  "opening up," pre-drop closing) and per-phrase LFO motion (1-4 bar synced wobbles on pads).
- **Send levels** — second most common: reverb/delay "throws" (send spikes on the last hit of a
  phrase, then back to dry), and slow send rises through builds. This is cited as the thing that
  makes a static loop feel produced.
- **The layered-timeline rule**: produced tracks run *simultaneous motion at different rates* —
  one slow move (16-bar filter), one medium (2-4 bar pan/width), one event-rate (once-per-phrase
  throw). One moving parameter per section is the floor; the *stacking of rates* is what reads
  as complexity. *(medium-high — Hyperbits/Beat Kitchen framing)*
- **Width automation** — narrow the field in breakdowns, open it at the drop (sub stays mono)
  *(high — Weapon Sounds)*. Maps to automating `utilityWidth`/`unisonWidth`.
- **Sample start/offset, pitch** — Ableton's Sample Offset envelope ("beat scrambling") and
  per-phrase transposes; already scoped for dotbeat post-warp-markers ([research 47] §6.4).
- **LFO vs envelope vs drawn automation, division of labor**: LFOs for continuous intra-bar
  motion (autoFilter/autoPan/tremolo-class); envelopes for per-note shape; drawn automation for
  phrase- and song-scale moves. dotbeat has all three lanes — 2 tempo-syncable LFOs + a third
  independent source via `autoFilter`/`autoPan`/`tremolo` inserts, per-note envelopes, and v0.9
  clip automation on every numeric field.

### 4.2 Sidechain pumping — the genre's defining glue

- Four-on-the-floor house/techno ducks bass/pads/sometimes-everything under the kick: fast attack
  (<10-20 ms), release tuned so the signal recovers *just before the next kick* — ~200-350 ms at
  ~128 BPM for the classic pump; shorter = tight groove, longer = dramatic breathing *(high —
  gearnews, Waves, benrainey, CMUSE)*. Depth ranges from transparent 2-3 dB (mix hygiene) to
  10 dB+ (audible pump as an aesthetic).
- **Ghost-kick triggering** — driving the duck from a silent duplicate kick, decoupled from the
  audible kick — is standard practice *(high — FaderPro, gearnews)*. **dotbeat's `duckSource`
  scheduled duck is architecturally the ghost-trigger pattern already** (it reads the source
  track's kick-lane hits, not audio): a strength, not a shortcut.
- Current gaps in the duck (engine, `engine.ts:4145-4163`): recovery is a **hardcoded 5 ms dip +
  160 ms linear ramp** — no release control (the single most musical parameter per the sources),
  no curve, and it triggers on `kick` lane hits only. A 160 ms fixed release at 122-128 BPM is a
  fast, subtle duck; the classic deep-house pump needs 250-350 ms and an exponential-ish
  recovery. Proposed: `duckRelease` (seconds or 16th-steps, default 0.16 for byte-compat) and
  optionally `duckHold`; both plain `SYNTH_FIELDS` numbers, automatable free.
- Interaction warning, already documented: [research 47] §6.1's verified engine bug — LFO writes
  clobber clip-automation writes for most shared destinations (three params, three different
  composition behaviors). Any "one moving parameter per track" default makes collisions likelier;
  that fix should land with or before the motion defaults.

### 4.3 What dotbeat's automation layer can and can't carry today

Exists: clip-scoped lanes on every numeric synth field + audio gain ([format-spec] v0.9), linear
interpolation only, plays **only in song mode** and only for a track's first-playing clip
([research 46] §7.1). Missing, in priority order for this doc's purposes: curve/hold
interpolation (already roadmap-flagged), envelope loop-length unlinked from the clip (the
envelope-as-LFO / "filter sweep every 4 bars over a 1-bar loop" move — [research 47] §6.2's
concrete proposal), and arrangement-level automation spanning scenes ([research 46] §7.2 item 3 —
the 16-bar intro sweep currently requires one long clip). None of these block the §6 P3 defaults
(a per-section sweep fits in today's clip lanes); all three raise the ceiling.

---

## 5. Bus and master glue

- **The mix-bus chain concept** *(high — Produce Like A Pro, Puremix/Fab Dupont, Music Guy
  Mixing)*: produced records pass the summed mix through a short fixed chain — typically
  gentle EQ → **glue compressor** (SSL-style: 2:1 ratio, slow attack 10-30 ms so transients pass,
  auto/~100 ms release, 2-4 dB reduction — smooths the whole mix into one moving object) →
  saturation (subtle harmonic density; "make it sound less digital") → limiter. The glue
  compressor also *couples* elements: everything ducks slightly with the kick, a second, subtler
  layer of the §4.2 pump.
- **dotbeat's master chain today** (`engine.ts:1962-1971`): `masterBus → Tone.Limiter(-1) →
  destination`. No compressor, no saturation, no EQ, no width, and **nothing document-driven** —
  the file cannot express a master-bus decision at all. Group buses: none (§1.2); the per-drum-
  track bus has a fixed insert chain.
- **Proposal shape** (new grammar, but small and precedented): a top-level `master` block carrying
  the existing `effect` line grammar (reuse `EFFECT_TYPES` + the same `SYNTH_FIELDS`-style param
  table, or a scoped subset: `comp`, `saturator`, `eq7`, `utility`) — canonical elision: absent
  block = today's limiter-only chain, byte-identical round-trip for every existing file. This is
  the same "adapt the reorderable chain" move Phase 22 AA already built once, relocated to a
  second scope. A "produced master" default chain (glue comp ~2:1/2-3 dB + saturator low +
  high-shelf air + width guard) then becomes a preset, not grammar, per D9. *(design estimate:
  the largest single format item in this doc; sequenced after the zero-format wins)*

---

## 6. Proposals — ordered by expected blind-rating impact against the measured gaps

Ordering logic: width (-52 dB vs -11 dB) and air (near-zero) are the two *measured, mechanical*
gaps and both are mostly reachable with zero format changes; production-complexity (2.1 vs 4.5)
needs motion + layering; production-quality was flat, so nothing here should trade cleanliness
for richness (mono-safety and the LFO/automation composition fix are the guard rails). Every
proposal is verifiable in the existing eval loop (width metric, air-band energy, Audiobox PC,
showdown win rate) — run before/after on the same seeds.

**P1 — "Produced defaults" for width — ZERO format work, highest expected impact.**
Ship a per-role production profile applied by gen-kit (step 5, alongside starter patterns) and
by the factory seed presets — literal param edits per D9, spelled out in the file:
- every synth pad/lead: `unisonVoices 5`, `unisonWidth 0.6-0.8`, `osc2Detune` in the
  just-audible zone; `chorusMix 0.2-0.3` on pads; effect line `utility` with `utilityWidth
  0.6-0.7` on non-bass tracks;
- every track except kick/bass/sub: `sendReverb 0.15-0.3` (the stereo bus is the passive width
  bed — currently unused);
- lead or perc: `pingPongMix ~0.15` synced;
- hats/perc: `autoPan` insert, slow (0.1-0.25 Hz) shallow.
Bass/kick stay dry-center (§2.2). Expected effect: the width metric moves from "hard mono" into
the produced range on every render; this is the single largest measured gap closed by defaults
alone. *(confidence in impact: high — the gap is definitionally the absence of these moves)*

**P2 — "Produced defaults" for air — zero format work + one small effect.**
(a) Defaults: `eq7HighShelfOn` + `Gain +2-4 dB` at 10-12 kHz on hats/lead/pads; `noiseLevel
0.05-0.15` on pads/leads; gen-kit hats-role pick adds an air-band (>8 kHz) energy term and the
seeded groove uses `openhat` sustain; raise default `hatTone`. (b) Small addition: an `exciter`
`EffectType` (parallel HPF→waveshaper→mix; `exciterFreq`/`exciterAmount`/`exciterMix`) — the
vinyl/saturator build tier, additive to `EFFECT_TYPES` exactly as eq7 was. Shelves amplify what
exists; the exciter manufactures air where synth patches have none (§3). *(impact: high on the
air metric; medium on blind preference alone — air without width reads as thin brightness)*

**P3 — Motion + sidechain defaults — zero format work, targets production-complexity directly.**
Every gen-kit/seed project ships with: `duckSource` = the drum track + `duckAmount 0.3-0.5` on
bass and pads (the genre-defining pump, machinery fully built and currently never invoked); one
tempo-synced LFO move per project (e.g. pad `lfoSync` 2-4 bars → cutoff, depth moderate); one
clip-automation lane (filter sweep across the section, or a `sendReverb` throw on the phrase's
last hit); `autoPan` on hats from P1. Follow the layered-timeline rule: one slow + one medium +
one event-rate mover, not five movers on one track. Prerequisites folded in: fix [research 47]
§6.1's LFO-vs-automation clobber, and add `duckRelease` (default 0.16 = byte-compatible) so the
pump can be tuned to tempo (§4.2). *(impact: high on Audiobox PC, the complexity axis; this is
the "static" half of the diagnosis)*

**P4 — Master-bus chain — small-to-medium format addition (§5).**
Top-level `master` block reusing the `effect` grammar; produced-master preset = glue comp (2:1,
slow attack, 2-3 dB) + low saturator + air shelf + width-guard utility. Affects every render at
once — high leverage per line of format — but sequenced after P1-P3 because those close the
measured gaps without any grammar risk. *(impact: medium-high, cumulative "one record" cohesion)*

**P5 — Width/air plumbing polish — small engine/format items.**
Stereo-ize the shared `delayBus` (mono `FeedbackDelay` → ping-pong or L/R-offset stereo — today
`sendDelay` contributes zero width); per-lane `pan`/`gain` on drum lanes ([research 45] §6's
already-made recommendation — hats slightly off-center is standard practice); `utilityMonoBelow`
crossover field (the mono-discipline guard rail, §2.2); a side-only flag or `eq7` M/S mode is the
bigger, deferrable cousin. *(impact: medium individually; the delay-bus fix is ~free)*

**P6 — Layer tooling, then maybe group buses — the §1 program.**
First `beat layer` as a compound edit (clone track + role delta + note copy — zero grammar,
[research 27]'s macro pattern). Only if cross-track layering becomes common practice should
`BeatGroup` grow bus semantics (group volume + effect chain = the glue-compression target); that
is the largest format design in this doc and the practice evidence (§1.1: synth-internal layering
+ texture covers most of the reference space; Four Tet ships records on 10-14 channels) says it
is not the bottleneck today. *(impact: medium; complexity axis, long tail)*

**P7 — Automation-ceiling raisers (already flagged elsewhere, re-ranked here).**
Curve/hold interpolation ([research 46] rec 1), per-lane envelope loop length — the
envelope-as-LFO move ([research 47] §6.2), arrangement-spanning automation ([research 46] rec 3).
None block P3; all raise how far the motion layer can go. *(impact: medium, deferred)*

### The "produced defaults" direction, stated as policy

Every seed patch, factory preset, and gen-kit output should leave the file with, per track where
role-appropriate: **width (unison/chorus/utility) + air (shelf or noise or bright hats) + one
send + one moving parameter**, and per project: **one sidechain pump + one section-scale
automation lane** — all as literal, elided-when-default lines, so a produced project reads as a
list of deliberate production decisions and an init patch stays 9 lines. The taste loop then
searches *from a produced starting point* instead of asking CMA-ES/vary to rediscover mixing
practice — which the showdown numbers show it does not do.

## Honest gaps and confidence notes

- Single-agent web pass: no adversarial verification. The settings numbers (release 200-350 ms,
  +2-4 dB shelves, 2:1/2-4 dB glue) are tutorial-consensus ranges, not measured from the
  reference records; a follow-up could measure them directly from `taste-dataset` chops (width,
  air-band energy, pump depth/period via envelope analysis) and tune the default profiles to the
  owner's actual references — that measurement loop is more trustworthy than any tutorial.
- Artist-specific claims are thin: Four Tet's channel-count/texture practice is well-sourced
  (Tape Notes); nothing artist-specific was verified for Floating Points, Keinemusik, or
  Dom Dolla this pass — the genre-practice claims stand on the general house/techno literature.
- "Audiobox production-complexity rewards motion/layering" is a plausible reading of the axis
  name and training setup ([research 107] §1.4), not a validated causal claim; P1-P3's effect on
  the PC score is exactly what the before/after eval will test.
- The impact ordering is inference from the measured gaps, not from an ablation; P1-P3 are cheap
  enough to ship together and ablate in one showdown round (defaults-off vs width-only vs
  width+air vs full).

## Sources

Layering: ModeAudio "Layering Synths" (modeaudio.com/magazine/layering-synths); Hyperbits
"Layering Sounds" (hyperbits.com/blog/layering-sounds/); Waves "Mixing and Layering Synth Bass"
(waves.com/mixing-and-layering-synth-bass-step-by-step); Subaqueous "Layers of Bass"
(subaqueousmusic.com/layers-of-bass-for-an-epic-low-end/); deadmau5 MasterClass chapter notes
(masterclass.com/classes/deadmau5-teaches-electronic-music-production) + sonical.ly "The
Deadmau5 Approach"; KVR lead-layering threads (kvraudio.com/forum/viewtopic.php?t=573450).
Width/mono: Weapon Sounds "Mono Sub + Stereo Body" (weaponsounds.com/blogs/production-tips/
mono-sub-stereo-body-bass-techno); Sound On Sound "Can Haas delays be mono-compatible?"
(soundonsound.com/sound-advice/q-can-haas-delays-be-mono-compatible); remasterify.com Haas
cost-in-mono article; Syntorial supersaw lead tutorial (syntorial.com/tutorials/synth-quickie-
supersaw-trance-lead/); Soundbridge "Design Your Own Super Saw"; MusicRadar "work with stereo
bass"; Mastering The Mix / iconcollective.edu / unison.audio mid-side EQ guides.
Air: Production Expert "When Should You Use An Exciter" (production-expert.com); eMastered
"High Shelf EQ"; prosoundpicks.com Fresh Air review; KVR "air band battle" thread; iZotope
"How to Mix Hi-Hats" (izotope.com/en/learn/how-to-mix-hi-hats.html); MusicRadar "10 steps to
hotter hi-hats".
Motion/sidechain: EDMProd "Definitive Guide to Automation" (edmprod.com/automation-guide/);
Hyperbits "Guide to Automation and Movement"; Beat Kitchen "Automation and Movement"
(beatkitchen.io/guides/electronic-music/08-automation-and-movement/); unison.audio "Reverb
Automation 101"; gearnews "Sidechain Compression in Techno"; benrainey.co.uk "Sidechain
Compression for House Music"; FaderPro "Ghost Sidechain Compression" (blog.faderpro.com);
CMUSE sidechain release calculator; Waves "Sidechain Compression Explained".
Bus/master: Produce Like A Pro "Mix Bus Compression Tips" (producelikeapro.com); Puremix
"Fab Dupont SSL Bus Compressor"; Music Guy Mixing "Ultimate Guide to Bus Compression";
Nail The Mix SSL bus settings.
Reference-space practice: Tape Notes TN:140 Four Tet (tapenotes.co.uk/project/tn140-fourtet);
MusicRadar/MusicTech Four Tet Tape Notes coverage ("I pretty much only use presets", texture
layering); MusicTech "7 production techniques from Four Tet's 'Three'".
dotbeat internal, read this pass: `src/core/document.ts` (SYNTH_FIELDS, BeatGroup, EFFECT_TYPES,
eq7/noise/sub/unison/duck fields), `ui/src/audio/engine.ts` (master chain 1962-1971, buses
2002-2007, duck 4145-4163, unison bank), `src/analysis/genkit.ts` (zero production params —
verified by grep), `docs/format-spec.md`, `docs/gen-kit-pipeline.md`, research docs 17, 27, 40,
45, 46, 47, 102, 107.

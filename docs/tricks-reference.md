# dotbeat — production tricks reference

*Generated from `presets/tricks.json` via `node scripts/gen-tricks-reference.mjs` — **do not
hand-edit**. Edit the catalog and regenerate, so this file can never drift from the validated
library (research 118 §3.1). See `docs/tricks.md` for how the system works, and drive it with
`beat trick list|show|apply|suggest`.*

A **trick is a preset with preconditions and a receipt**: a named production move with
machine-readable preconditions over the metric vector the eval loop already computes
(`FEATURE_KEYS`) and over document state, a recipe in a closed step vocabulary (every step an
existing edit primitive), and a declared metric delta (the verification contract). Before
production-polishing a project, run `beat trick suggest <file.beat>` and read the cards below.

**15 tricks**, across 4 measured gap axes.

## Width — the -52 dB-vs--11 dB stereo gap (research 115 §2)

### `unison-spread`

- **applies to** — kind **synth**, roles lead/pad/chords/arp
- **when** — `stereoWidthDb < -30` AND `unisonVoices == 1`
- **recipe** — `set $track.unisonVoices 5`; `set $track.unisonWidth 0.7`; `set $track.osc2Level 0.4`; `set $track.osc2Detune 12`
- **expect** — `stereoWidthDb` up (≥ 10), `stereoCorrelation` down
- **counter** —
    - never on bass/sub tracks — the low end stays mono for club mono-sum delivery (115 §2.2)
    - chorus/unison smears attacks; skip on percussive transient-critical parts
- **why** — Five detuned unison voices spread across the stereo field turn a mono synth wide while summing mono-safe (detuned voices barely comb). The single biggest lever on the measured -52 dB-vs--11 dB width gap. (research 115 §2.1, high confidence)

### `detune-double`

- **applies to** — kind **synth**, not bass/sub
- **when** — `osc2Level == 0`
- **recipe** — `set $track.osc2Level 0.5`; `set $track.osc2Detune 7`
- **expect** — `stereoWidthDb` up, `bandPresencePct` up
- **counter** —
    - on bass keep osc2Detune <= 5 and re-check the mono sum — this trick's notRoles already exclude bass/sub, so --force is required there
- **why** — A second oscillator detuned +7 cents (the just-audible zone) layers a slightly-altered copy for thickness and spectral density — layering slightly-altered copies is the oldest width move in the book. (research 115 §1.1, high confidence)

### `pad-chorus`

- **applies to** — kind **synth**, roles pad/chords
- **when** — `chorusMix == 0`
- **recipe** — `set $track.chorusMode ensemble`; `set $track.chorusMix 0.25`
- **expect** — `stereoWidthDb` up
- **counter** —
    - chorus smears transient attacks — not on percussive or pluck-attack parts
- **why** — An ensemble-mode chorus insert (3-voice, wider) is the classic pad-widener — mild, always-on stereo motion under sustained chords. (research 115 §2.1, high confidence)

### `utility-widen`

- **applies to** — kind **synth**, not bass/sub, knobs `width`=0.65
- **when** — `stereoWidthDb < -25`
- **recipe** — `effect-add utility`; `set $track.utilityWidth $width`
- **expect** — `stereoWidthDb` up
- **counter** —
    - a mid/side widener does nothing to a source with zero side content — run unison-spread / pad-chorus / detune-double FIRST to create side signal, then this scales it
    - keep width <= 0.75 — side-heavy mixes collapse on a club's mono subs
- **why** — The Utility insert's mid/side width control is the mono-sum-safe final widener (M/S scaling, 115 §2.1 table). Best applied after the osc-bank width tricks have created side content for it to scale. (research 115 §2.1, high confidence)

### `reverb-bed`

- **applies to** — kind **synth**, not bass/sub, knobs `amount`=0.2
- **when** — `sendReverb == 0`
- **recipe** — `set $track.sendReverb $amount`
- **expect** — `stereoWidthDb` up, `bandAirPct` up, `crestDb` down
- **counter** —
    - bass and kick stay dry — reverb on the low end is mud (115 §2.2); this trick's notRoles exclude bass/sub
- **why** — A modest reverb send is the passive width bed under everything in produced tracks: the shared stereo reverb bus is decorrelated L/R, so any dry mono source picks up width and a little air just by feeding it. (research 115 §2.1, high confidence)

### `bass-mono-anchor`

- **applies to** — kind **synth**, roles bass/sub
- **when** — (no preconditions)
- **recipe** — `set $track.unisonWidth 0`; `set $track.chorusMix 0`; `set $track.utilityWidth 0.5`; `set $track.sendReverb 0`; `set $track.pan 0`
- **expect** — `stereoWidthDb` down, `stereoCorrelation` up
- **counter** —
    - no counter-indications — this IS the discipline that lets every other width trick run safely; apply it to the bass after any project-wide width pass
- **why** — The guard-rail: assert the bass/sub back to mono-center (no unison spread, no chorus, neutral utility, no reverb, centered pan) so the low end sums cleanly on a club's mono subs. Club delivery sums lows — a widened sub is the one mistake that never survives the room. (research 115 §2.2, high confidence)

### `autopan-hats`

- **applies to** — kind **drums**
- **when** — `autoPanMix == 0`
- **recipe** — `effect-add autoPan`; `set $track.autoPanRate 0.15`; `set $track.autoPanDepth 0.5`; `set $track.autoPanMix 1`
- **expect** — `stereoWidthDb` up
- **counter** —
    - keep the rate slow and depth shallow — fast, deep autopan on the timekeeper reads as seasickness, not width
- **why** — A slow, shallow auto-pan gives the hats width via motion (time-variance) rather than static stereo spread — mono-safe, and it lifts the production-complexity score the showdown found lowest. (research 115 §2.1 / §4.1, high confidence)

## Air — the near-zero-vs-1.9% air-band gap (research 115 §3)

### `air-shelf`

- **applies to** — kind **any**, roles hats/perc/lead/pad/chords/arp
- **when** — `bandAirPct < 1`
- **recipe** — `effect-add eq7`; `set $track.eq7HighShelfOn true`; `set $track.eq7HighShelfFreq 11000`; `set $track.eq7HighShelfGain 3`
- **expect** — `bandAirPct` up, `centroidLog2` up
- **counter** —
    - a shelf amplifies what already exists — if the patch has no top end (cutoff below ~6 kHz), run bright-cutoff or noise-wash first, or the shelf boosts silence
- **why** — An 11 kHz high shelf is the direct fix for the near-zero-vs-1.9% air-band gap the showdown measured — the genre's default sheen. (research 115 §3.3, high confidence)

### `noise-wash`

- **applies to** — kind **synth**, roles pad/lead/chords/arp
- **when** — `noiseLevel == 0`
- **recipe** — `set $track.noiseLevel 0.12`
- **expect** — `bandAirPct` up, `bandPresencePct` up
- **counter** —
    - keep noiseLevel <= 0.15 — above that it reads as a broken patch, not a washy one
- **why** — A low-level filtered-noise wash under a pad or lead adds air and sizzle that a pure oscillator can't produce — the texture carrier for the top octave. (research 115 §3.2, high confidence)

### `open-hat-air`

- **applies to** — kind **drums**
- **when** — `openhat hits == 0`
- **recipe** — `addHits openhat offbeat-8ths v0.5`; `set $track.hatTone 6500`; `set $track.openHatDecay 0.5`
- **expect** — `bandAirPct` up
- **counter** —
    - clashes with a ride-heavy pattern; halve the velocities if the air band was already above ~1.5%
- **why** — Sustained open-hat hits on the 8th-note offbeats are the genre's default air carrier — sustained >8 kHz content that lifts the air band and the onset density at once. (research 115 §3.1, high confidence)

### `bright-cutoff`

- **applies to** — kind **synth**, roles lead/pad/chords
- **when** — `cutoff < 4000` AND `bandAirPct < 0.5`
- **recipe** — `macro filter-sweep @ 70`
- **expect** — `centroidLog2` up, `bandPresencePct` up, `bandAirPct` up
- **counter** —
    - a taste-searched dark patch may be deliberate — this is the trick most likely to fight the taste model; prefer it on supporting layers, not the hero sound
- **why** — Opening the filter (cutoff + resonance together, via the factory filter-sweep macro) is the most direct brightener when a patch is simply too dark to have any air to shelf. (research 115 §3 interaction note, medium confidence)

## Motion & sidechain — the Audiobox PC 2.1-vs-4.5 gap (research 115 §4)

### `slow-filter-lfo`

- **applies to** — kind **synth**, roles pad/chords
- **when** — `lfoDest == off`
- **recipe** — `set $track.lfoDest cutoff`; `set $track.lfoSync true`; `set $track.lfoSyncRate 1/1`; `set $track.lfoDepth 0.35`
- **expect** — `centroidLog2` flat, `lufs` flat
- **counter** —
    - one intra-bar/phrase mover per track (the layered-timeline rule) — don't stack with another cutoff mover
    - an LFO write can clobber a cutoff automation lane on the same clip (research 47 §6.1); don't combine with section-sweep on cutoff
- **why** — A whole-note-synced filter LFO on a pad adds the slow spectral breathing that reads as production motion — the Audiobox production-complexity axis the showdown scored 2.1 vs 4.5. (research 115 §4.1; the format's longest LFO sync division is 1/1, so the 2-bar rate 118 sketches is approximated by a whole note. Motion has no static FEATURE_KEY yet — hence the flat expect; the real target is Audiobox PC. medium confidence)

### `section-sweep`

- **applies to** — kind **synth**, roles lead/pad/chords/arp, needs a clip
- **when** — `song mode == true`
- **recipe** — `automate $track.cutoff` → (0, 400), ($clipEndStep, 4500)
- **expect** — `centroidLog2` up
- **counter** —
    - automation plays only in song mode and only for a track's first-playing clip (research 46 §7.1) — the songMode precondition enforces the first half
    - don't combine with slow-filter-lfo on the same cutoff param (LFO-vs-automation clobber, research 47 §6.1)
- **why** — A rising cutoff automation across a clip is the genre's #1 automation target — the intro/build filter open that pulls a section forward. (research 115 §4.1, high confidence)

## Glue & character — harmonic density / "less digital" (research 115 §1 / §5)

### `glue-saturation`

- **applies to** — kind **synth**, roles lead/bass/chords/pad
- **when** — `saturatorMix == 0`
- **recipe** — `set $track.saturatorCurve warm`; `set $track.saturatorDrive 0.25`; `set $track.saturatorMix 0.3`
- **expect** — `bandPresencePct` up
- **counter** —
    - per-track only — the real glue target is the master bus, which needs the master block (115 P4); this is the available per-track approximation
- **why** — Gentle warm saturation adds harmonic density that makes a track read as less digital and helps it sit in the mix — the glue axis the showdown found flat-but-thin. (research 115 §5, high confidence on practice / medium on the per-track approximation)

### `sub-foundation`

- **applies to** — kind **synth**, roles bass/sub
- **when** — `subLevel == 0` AND `bandSubPct < 8`
- **recipe** — `set $track.subLevel 0.5`
- **expect** — `bandSubPct` up
- **counter** —
    - check the kick relationship first — if the sub band is already above ~20%, skip (mud)
    - keep the sub mono (pair with bass-mono-anchor) — a widened sub-bass never survives a club's mono sum
- **why** — A dedicated sub-oscillator layer is the foundation of the 3-layer bass stack, expressible in one track — it fills the sub band that a mid-forward bass patch leaves empty. (research 115 §1.1, high confidence)

---

*15 tricks. Deferred (blocked on format additions or a richer recipe vocabulary — see
research 118 §2's "Explicitly NOT in v1" list and §3.4): `sidechain-pump` (needs a second
source-track slot), `reverb-throw` (phrase-spike automation), `tremolo-motion`,
`pingpong-echo` (bpm-synced delay-time arithmetic), `layered-timeline` (a stacking policy, not
edits), and the arrangement/transition family (`drum-pull`, `snare-build` — clip-copy
semantics). Each enters this same catalog, under the same eager validation, when its prerequisite
lands.*

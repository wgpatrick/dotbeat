# Bass Sound Design Priors — House / Tech-House / Deep House

Vein: rolling / plucky / sub-anchored bass family. Compiled from practitioner-grade
tutorials (Attack Magazine, Splice, ModeAudio, MusicRadar/Loopmasters, EDMProd,
SoundBridge, forum threads with named preset walkthroughs). Each recipe below is
what the source actually stated — gaps are marked explicitly rather than filled in.

---

## Recipe 1 — Tech-House Rolling Sub-Pluck (Vital)

**Source**: SoundBridge — [Tech House Bass Sound Design](https://www.soundbridge.io/tech-house-bass-sound-design) (tutorial site, synth used: Vital)

**Layers**: 2 oscillators, single patch (no separate sub layer described — the two oscillators together cover sub+body).

**Oscillators**:
- Osc 1: square wave
- Osc 2: sawtooth, "slightly lower volume" than Osc 1
- Phase randomization disabled on both (for a stable, un-detuned low end)

**Filter**:
- 24 dB/oct slope
- Cutoff ≈ 150 Hz
- Resonance: 0 (reduced to zero)

**Envelopes** (qualitative only — no ms given):
- Amp env: short attack, increased decay, shortened sustain, increased release
- Env 2 (pluck modulation → filter cutoff + distortion cutoff): quick release, some sustain, slight decay increase, applied "with a small amount"

**Effects chain (in order)**:
1. Distortion — drive ≈ 8 dB, post-filter placement
2. Compressor — multiband (only one band engaged), attack and release both at 50%
3. EQ — peak band, +10 dB boost at 75 Hz, Q set to "12 o'clock" (~1–2)

**Gaps**: no ms envelope times, no compression ratio, no chorus/reverb send specified.

---

## Recipe 2 — House Bassline Synth Patch (Thorn/Vital-style, sync+metal)

**Source**: MusicRadar — [How to program a bassline house synth patch](https://www.musicradar.com/how-to/how-to-program-a-bassline-house-synth-patch)

**Layers**: 2 body oscillators + 1 dedicated sub layer (explicit 3-layer structure).

**Oscillators**:
- Osc 1: square wave, wavetable position 50%, FX = Sync, sync amount tweaked "for a ringing synth tone"
- Osc 2: "Metal 04" wavetable, position 50%, FX = Sync, sync amount 30%, sub amount 30% (Osc 2 contributes its own sub blend)
- Separate sub-bass layer: preset "Bass >> Sub Power", level **-9 dB** relative to main patch, high-pass filtered on the mid layer below **100 Hz** (i.e., mid layer HPF'd out below 100 Hz so it doesn't fight the dedicated sub)

**Filter**:
- Mode: "Dirty LP"
- Cutoff: 80 Hz
- Envelope 1 → cutoff modulation: 100%

**Filter envelope (Env 1)**:
- Attack: fast
- Decay: 50%
- Sustain: 10%
- Release: 0%

**Effects chain (in order)**:
1. EQ: +6 dB boost at 800 Hz
2. Reverb: "Space 06" preset, 20% wet/dry mix
3. Distortion: "Acid Drive"
4. Master volume trimmed to 22% (gain staging step, not a "sound" per se)

**Numeric target**: sub layer sits **-9 dB** under the main/mid layer; mid layer HPF'd below **100 Hz** to leave room for the sub — a concrete "keep the sub layer clean of competing content" rule.

---

## Recipe 3 — Classic/Deep House Bass on Juno-60 (DCO analog)

**Source**: Attack Magazine, Synth Secrets — [Make A House Bass With The Juno-60](https://www.attackmagazine.com/technique/synth-secrets/make-a-house-bass-with-the-juno-60/) (applies to Juno-60/JU-06A/Juno-X/System-8 Plug-Out)

**Layers**: single DCO voice + built-in sub-oscillator (2-source single voice, not multi-layered patch).

**Oscillators**:
- Range: 8' (lowest DCO range)
- Sawtooth: full level (all the way up)
- Square/Pulse: ~75%
- Sub-oscillator: ~45%
- PWM: 75%, modulated by Envelope 2 (E2+)

**Filter**:
- Cutoff: "halfway point"
- Resonance: "a little"
- Keyboard tracking: on

**Filter envelope (Env 1)**:
- Decay: ~15%
- Sustain: 0
- Env 1 amount: ~75% (halfway between half and full)

**Amp envelope (Env 2 / VCA)**:
- Attack: 0
- Decay: "almost halfway"
- Sustain: ~25%
- Release: "just a little" (short)

**Effects**:
- Chorus: Type I, slowest rate setting, depth ~70%
- Reverb: Room algorithm, Time/Level tuned "for a nice bloom" (no numbers)
- Oscillator "Condition" knob: fully clockwise for tight, in-tune output

**Gap**: no ms values, no compression/EQ/sidechain discussion — this is a synthesis-only tutorial.

---

## Recipe 4 — UK Garage / House Bass (Diva-style FM-lite, monophonic)

**Source**: Attack Magazine, Synth Secrets — [Garage Bass](https://www.attackmagazine.com/technique/synth-secrets/garage-bass/) (u-he Diva)

**Layers**: single monophonic voice, 2 carrier-ish oscillators + 1 phase-mod oscillator (effectively FM/phase-mod bass).

**Oscillators**:
- Osc 1: Sin-Squ wavetable, pitch **-24 semitones**, wavetable position fully left (pure sine)
- Osc 2: Sin-Squ wavetable, pitch **-12 semitones**, level ~2 o'clock
- Modulation oscillator: phase-modulates Osc 1, pitch **-12 semitones** (or **-12.30** for a deliberately "wonkily detuned" variant), phase control ~50%

**Filter**:
- Type: "Daft" (Diva's filter model)
- Cutoff: ~25%
- Resonance: 0
- Envelope modulation: maximum

**Envelopes**:
- Filter/mod envelope (1Env): fast attack, medium-fast decay, no sustain, short release; modulates phase ~60% and filter cutoff at max
- Amp envelope (4Env): release ~33% "to eliminate tail clicks"

**Voice mode**: Monophonic ("Monophon"), glide 10–15%, phase restart per key-press.

**Effects chain (in order)**:
1. Classic Tube distortion — dry/wet and drive both ~10 o'clock
2. Dimension Expander — size 0, dry/wet ~10 o'clock

**Note**: -24 / -12 semitone stacking with a phase-mod oscillator at -12 is the defining move here — pitching oscillators down two octaves and one octave rather than using sub-oscillator modules.

---

## Recipe 5 — Deep House Ring-Modulated Sine Bass (Massive)

**Source**: ModeAudio Magazine — [Deep Foundation: Designing a Deep House Bass Sound in Massive](https://modeaudio.com/magazine/deep-foundation-designing-a-deep-house-bass-sound-in-massive)

**Layers**: 2 oscillators + ring modulator (single-voice patch).

**Oscillators**:
- Osc 1: sine wavetable, WT-position fully down (pure sine), phase offset applied to reduce "honky character"
- Osc 2: same wavetable, tuned **-12 semitones** (one octave down), WT-position raised to blend toward a square-ish tone
- Ring modulator applied to Osc 1, mod oscillator tuned **-12 semitones**, generating sidebands

**Filter**:
- Type: "Lowpass 4" (steep slope)
- Resonance: dialed up, tuned to roughly the 5th harmonic of the note
- Envelope (Env 3) → cutoff, with an extended attack for a "rounded" onset

**Verbatim quote**: "a little goes a long way" (re: ring-mod amount and resonance — over-application breaks the "deep" character).

**Gaps**: no Hz/ms/dB values given anywhere in this article — purely qualitative/relative guidance. Flagged explicitly by the source as a "download the patch" tutorial rather than a numeric walkthrough.

---

## Recipe 6 — Tech-House Bass on U-he Repro-1 (analog Juno/Prophet-style, named synth deep-dive)

**Source**: Attack Magazine, Synth Secrets — [Tech-House Bass With U-he Repro-1](https://www.attackmagazine.com/technique/synth-secrets/tech-house-bass-u-repro-1/)

**Layers**: 2 oscillators, single voice, heavily processed post-chain (this is as much an effects-chain recipe as a synthesis one).

**Oscillators**:
- Osc A: sawtooth + pulse simultaneously, pulse width narrowed slightly
- Osc B: pulse wave, **one octave below** Osc A
- Master tune: -12 (whole patch down an octave)
- Mixer: A and B both turned up; Feedback/noise circuit set to ~25% feedback

**Filter**:
- Cutoff: nearly fully closed
- Envelope amount: high
- Keyboard tracking: slight

**Filter envelope**: attack default, decay ~1/3, sustain near-zero, release default.

**Amp envelope**: attack default, decay pushed up slightly, sustain just under 25%, release default.

**Effects chain (in order)** — notable because it's a full 4-stage chain with named plugins:
1. **Jaws** (waveshaper) — fold slightly up, Teeth fully clockwise, F-mod 75%, Resonance turned up
2. **Lyrebird** (delay/mod effect) — mode: Echo, Time 1.26, Mix 14.50, Modulation: Medium
3. **RESQ** (EQ) — low shelf boosted
4. **Sonic Conditioner** (saturation) — gain increased

**Takeaway**: the tone here comes almost as much from the waveshaper/saturation stack after the synth as from the oscillator/filter programming — a full 4-device post-chain rather than a single distortion unit.

---

## Recipe 7 — Splice / Tracey Brakes: Crunchy Bass Layer over Sub (Serum 2, named sound designer)

**Source**: Splice Blog — [Tracey Brakes on 5 Sound Design Tips with Serum 2](https://splice.com/blog/synthesis-sound-design-tips-tracey-brakes/) (Tracey Brakes, working sound designer/preset author)

**Layers**: explicit 2-layer structure — Oscillator A as sub layer, Oscillator B as a "crunchy layer on top of the sub layer" (her words).

**Oscillator B settings given exactly**:
- Octave: **-3**
- Unison: **7** voices
- Detune: **0.15**
- Sync ½ Win: **-1.45%**
- WT Position / LFO2 depth: **36**

**Filter**:
- Type: High 12 (12 dB/oct highpass-flavored filter in Serum's filter list)
- Cutoff: **913 Hz**
- Resonance: **22%**

**Gap**: wavetables loaded in Osc A/B, amp envelope ADSR, and the rest of the effects chain not specified in the excerpt — this is one settings panel from a larger walkthrough, not the full patch.

**Why it's valuable despite gaps**: it's one of the only sources with exact unison-voice-count (7) + detune-amount (0.15, Serum's 0–1 scale) + sync-window numbers from a named, credentialed sound designer rather than a generic tutorial site.

---

## Recipe 8 — Plucky Korg M1-style House Bass

**Source**: EDMProd — [Synth Bass: 9 Crucial Bass Sounds You Need To Know](https://www.edmprod.com/synth-bass/)

**Layers**: 2 oscillators, single voice.

**Oscillators**:
- Osc 1: triangle wave, pitched **-2 octaves**
- Osc 2: square wave, pitched **+7 semitones** relative to Osc 1 (a fifth above, classic M1-piano-bass-style interval stacking)

**Filter**: low-pass, "adjust cutoff and amount to taste" — no Hz given.

**Note**: credited as "made popular by the Korg M1" — i.e. an homage to the M1's piano-bass/organ-bass patches that seeded a lot of early house bass sounds. The +7-semitone (perfect 5th) oscillator interval is the specific, reusable detail here, distinct from the more common octave-only stacking seen elsewhere.

**Companion recipe, same article — Acid Bass**: sawtooth oscillator → 24 dB low-pass filter → distortion, reverb, delay (order/dosage not specified).

---

## Recipe 9 — FM "Hoover-adjacent" Deep House Bass (4-operator FM, DX21-style)

**Source**: KVR Audio forum thread — [How to make these deep house bass sounds?](https://www.kvraudio.com/forum/viewtopic.php?t=361988) (practitioner reply citing a Yamaha DX21 "Wood Piano" preset repurposed as bass; discussion referencing Jamie Jones-style deep house bass)

**Layers**: 4-operator FM voice (no separate sub layer — FM operators do the low end).

**Operator structure** (exact ratios/amounts as posted):
- Op 1: sine, ratio 0.5, routed to output
- Op 2: sine, ratio 1.0, modulates Op 1 at amount **34**
- Op 3: sine, ratio 0.4998, offset **-0.11 Hz**, routed to output
- Op 4: modulates Op 2 at amount **39** and self-modulates (feedback) at amount **27**

**Envelopes**: "short attacks, some decay, no sustain" across all four operators (qualitative only).

**Verbatim quote** (on a Jamie Jones-style remix bass): "the jamie remix sounds more like the lately bass preset found in any FM synth but you could get close using any synth wit[h] saw wave osc's and a lowpass filter" — i.e., a practitioner explicitly saying the FM version can be approximated with plain subtractive saw + LPF, which is a useful equivalence for our purposes.

**Recommended engines**: FM8, Sylenth1, Massive, or hardware DX7/DX21/FB-01/TX81Z.

---

## Recipe 10 — Phased Techno/Tech-House Legato Bass

**Source**: Attack Magazine, Synth Secrets — [Phased Techno Bass](https://www.attackmagazine.com/technique/synth-secrets/phased-techno-bass/)

**Layers**: single oscillator only — explicitly "turn the volume for oscillators two and three down to zero," i.e. a deliberately single-voice patch for a lean, rolling low end.

**Oscillator**: sawtooth (rich harmonic content), voicing mode: legato (for the rolling/gliding rhythmic feel between repeated notes).

**Filter**: cutoff opened wide; Feedback knob ~1 o'clock; LFO2→filter modulation depth ~9 o'clock.

**Amp envelope**: decay ~9 o'clock; release present but exact value not given.

**Effects chain (in order)**:
1. Phaser (Phaser1 preset) — parameters shown only as a screenshot, not transcribed
2. Reverb (Plate2 preset) — same caveat
3. Parallel processing: stereo widener + band-passed overdrive on a parallel bus
4. Bus processing: OTT (multiband) + glue compression

**Notable structural point**: legato voicing (not fully monophonic-with-retrigger, not polyphonic) is called out as central to the "rolling" phrasing feel — matches the "mono mode + 0 ms glide" consensus point below but via a different mechanism (legato vs. retriggered mono).

---

## Mixing / Numeric Targets (not tied to one synth patch)

**Source**: Attack Magazine — [Mixing Deep House](https://www.attackmagazine.com/technique/tutorials/mixing-deep-house/)
- Kick's fundamental identified at **~44–45 Hz** (via spectrum analyzer) — low-end boost (RBass-style exciter) targeted there.
- Multiband crossover between bass "keys" mid content and sub content set at **~137 Hz** (SPLTTR-style band splitter); everything below gets dedicated sub enhancement; the low band is sidechained to the kick (no ratio/attack/release numbers given — only "that classic pumping effect").
- Parallel compression on the full drum group: compressor driven hard ("OneKnob Pressure" set to **9**, i.e. near-max), compressed signal blended in at **~-15 dB** under the dry signal.
- Final loudness targets: **-6 to -5 dB RMS** for a "commercial" master; **-10 to -15 dB RMS** if sending out to a mastering engineer; limiter output ceiling **-0.3 dB**.

**Source**: MusicTech — [How to make synth bass sit in your mix](https://musictech.com/tutorials/how-to-make-synth-bass-sit-in-your-mix/)
- High-pass filter recommendation: gentle slope (2-pole / **6 dB/octave**) rolling out content below **~50 Hz**, contrasted explicitly against a much steeper **24 dB/octave** option for more surgical removal.
- Verbatim framing: the piece deliberately avoids prescriptive EQ/compression numbers, advising "well-attuned ears rather than rulebooks" — flagged here as a source that self-consciously argues against numeric recipes, which is itself useful context (practitioners disagree on how prescriptive to be).

---

## Consensus across multiple independent sources (high confidence)

1. **Two-octave-apart oscillator stacking is the dominant house-bass structure.** Recipes 3, 4, 5, 6, and 8 all stack a sub/root oscillator with a second oscillator **exactly one or two octaves higher** (Juno-60: sub + saw/square at base pitch; Repro-1: Osc B one octave below Osc A; Massive: second osc -12 st; Diva garage bass: -24 st and -12 st layers; Korg M1 style: -2 octaves). The specific interval varies (octave vs. octave+5th in Recipe 8) but "simple integer-octave offset between two osc layers" recurs everywhere.
2. **Low-pass filter cutoff parked low (roughly 80–200 Hz) with an envelope opening it on note attack** appears in Recipes 1 (150 Hz), 2 (80 Hz), and the aggregated tech-house description (200 Hz) — i.e. sources converge on "start the cutoff near/at the fundamental and let a fast, short filter envelope give the pluck," rather than a bright, wide-open cutoff.
3. **Short/near-zero sustain, moderate-to-short decay and release on the amp envelope** is universal across every recipe that specifies envelope shape at all (1, 2, 3, 4, 6, 8) — nobody uses a long sustain for this bass family; it's consistently "pluck," not "held tone."
4. **A distortion/saturation stage is standard, usually placed post-filter, before or alongside EQ/compression** — present in Recipes 1, 2, 4, 6, and the "Acid Bass" companion in Recipe 8. Placement order (distortion before EQ, or EQ before distortion) is not always stated, but "some form of drive is always present" is consistent.
5. **Sidechain compression from the kick is treated as mandatory for house/deep-house bass** in the mixing sources (Attack's Mixing Deep House, MusicTech, and the general EDMProd guidance) — though exact ratio/attack/release numbers are almost never given (see disagreement note below); it's asserted as a genre convention more than specified as a parameter set.
6. **Monophonic or legato voicing (not full polyphony) is treated as necessary for a clean rolling bass line** — stated explicitly in the aggregated tech-house description (mono mode, 0 ms glide) and independently in Recipe 10 (legato voicing) and Recipe 4 (monophonic mode) and Recipe 2 (monophonic sampler mode in the Loopmasters variant). Multiple unrelated sources agree overlapping notes "muddy" the low end.

## Disagreements / notable tension between sources

- **How much filter resonance to use is contested.** Recipe 1 explicitly sets resonance to **zero**, while Recipe 5 (Massive deep house) deliberately dials resonance **up**, tuned to the 5th harmonic, for character. Recipe 7's Serum patch uses a moderate 22% resonance on a highpass-flavored filter. There is no single "house bass resonance number" — it's genre/character dependent even within this one narrow vein.
- **Filter cutoff frequency range varies by an order of magnitude** depending on whether the goal is a sub-heavy rolling bass (80–200 Hz, Recipes 1–2 and the aggregated description) versus a brighter "crunchy" top layer (913 Hz in Recipe 7). Both are legitimately "house bass" — they're just different layers of the same composite sound, which matters for how a multi-layer patch should be interpreted.
- **Prescriptiveness itself is debated.** MusicTech's mixing article explicitly argues against numeric rulebooks ("use your ears... rather than rulebooks"), while Attack Magazine's Mixing Deep House and the Serum/Vital walkthroughs are comfortable giving exact dB/Hz/percentage figures. Worth flagging since it affects how much we should trust "genre convention" claims that aren't backed by a number.
- **Oscillator interval choice**: most sources default to plain octave doubling, but Recipe 8's Korg M1-style patch uses a **+7 semitone (perfect fifth)** interval instead of an octave — a real alternative to the "always stack in octaves" consensus, and one worth keeping as an explicit option rather than assuming octaves are the only valid choice.

---

## Sources consulted but low-yield (numeric content thin or absent)

- Attack Magazine, [Ten Production Tips For Better Basslines](https://www.attackmagazine.com/technique/tutorials/ten-production-tips-for-better-basslines/) — only page 1 accessible via fetch; conceptual guidance only ("get the sound right in your synth first"), no numbers surfaced.
- ModeAudio, [Deep House: 5 Production Essentials](https://modeaudio.com/magazine/deep-house-5-production-essentials) — qualitative FM/filtering advice, no Hz/dB/ms values.
- Attack Magazine, [Dusted Deep House (Beat Dissected)](https://www.attackmagazine.com/technique/beat-dissected/dusted-deep-house/) — focused on drum programming, not bass.
- Splice, [Making Analog House Using Serum](https://splice.com/blog/making-analog-house-serum/) and [Drum & Bass Sounds in Serum](https://splice.com/blog/drum-and-bass-sounds-in-serum/) — described technique conceptually (saw+pulse octave-below stacking, LFO-modulated detune) but omitted exact Hz/cents/ms values in the accessible text.
- EDMProd, [How to Make Bass House](https://www.edmprod.com/how-to-make-bass-house/) — good structural advice (FM-from-B technique, octave+semitone shift amounts like "2 octaves and 7 semitones" for a drop variant) but no filter Hz or envelope ms.
- Finish More Music, Ableton Operator deep-house FM bass tutorials — page text promotional only; real parameters are in an un-transcribed video.
- Chris Stussy "3-note rolling bassline" article (The Producer School) — repeatedly returned HTTP 429 on fetch; could not verify content directly. A separate web-search summary (not independently confirmed against the article text) associated the rolling-bass technique with Chris Stussy, Max Dean, Toman, and Cloonee as popularizers, and with mono-mode + 0 ms glide + Serum filter settings (MG Low 24 @ 200 Hz, resonance 5–10%, Env2 attack 1 ms/decay 80 ms/sustain 30%/release 100 ms at 40% amount) — flagged here as **unverified/second-hand** rather than a confirmed recipe, since the source page itself couldn't be read.

---

## Recipe count: 10 full recipes + 2 mixing/numeric-target sources + consensus/disagreement analysis.

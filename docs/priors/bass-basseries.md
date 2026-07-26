# Bass priors: Reese, growl/wobble, sub, and 808 design (DnB / dubstep / trap)

Mined from practitioner tutorials (Attack Magazine, Sound on Sound, MusicRadar, Splice,
Native Instruments blog, and specialist tutorial/sample sites). 15 recipes below, ordered
roughly Reese → wobble/growl → 808/trap. Every recipe lists only what the source stated
explicitly; gaps are marked "not specified" rather than filled in.

---

## 1. Basic Detuned-Sine Reese (Attack Magazine, "Reese Bass Redux")

- **Source**: https://www.attackmagazine.com/technique/tutorials/reese-bass-redux/ — Attack Magazine tutorials desk (long-running UK electronic-production trade publication; article is paginated, only page 1 content retrieved).
- **Character**: the "textbook minimal" Reese — foundational patch before layering/effects.
- **Oscillators**: 2x sine wave. Osc 1 fine-tuned **+0.27 semitones**, Osc 2 **-0.27 semitones** (i.e. ±27 cents). Mono synth mode, single note playback.
- **Filter**: not specified at this stage (pre-filter patch).
- **Amp envelope**: Sustain 1.00, **Release 24ms**.
- **Effect produced**: "creates harmonics with rhythmic movement, the tempo of which can be controlled by adjusting the fine tuning of either oscillator."
- **Named limitation** (verbatim): the basic version has "rather inconsistent volume level" — flagged as needing further processing (article continues into filtering/effects on later pages not captured here).
- **Measurable target**: none stated at this stage; beating rate is explicitly tied to the ±27-cent detune value.

---

## 2. Classic Sawtooth Reese, ±55–61 cents (MusicRadar, "How to make a classic Reese like Renegade's Terrorist")

- **Source**: https://www.musicradar.com/how-to/classic-reese-bass-renegade-terrorist — MusicRadar (staff tutorial, covering the actual "Terrorist" (Renegade & Ray Keith, 1994) sample source).
- **Character**: the jungle/DnB "Terrorist"-style Reese.
- **Oscillators**: 2x sawtooth, same octave, note-on reset (phase reset) enabled. Detune: **±55 cents** between oscillators (i.e. a 110-cent/​~1-semitone spread). A variant is noted at **±61 cents** where the producer tuned the beating rate to lock to track BPM.
- **Filter**: Low-pass, **24 dB/octave**, cutoff **~4 kHz**, resonance **low** ("for grit").
- **Filter envelope**: short decay, **~15% amount** on attack.
- **Performance**: legato playback mode with portamento.
- **Extra layers**: 2-voice unison at **65% spread / 50% detune** stacked on top; white noise blended low in the oscillator mixer; separate sub oscillator plus a high-pass filter on the main signal specifically "to manage phase cancellation artifacts" between sub and Reese layers.
- **Counterintuitive quote**: "the speed of the beating effect was influenced by both the notes and the pitch offset" — i.e. detune amount alone doesn't fix the beat rate, played pitch also changes it. The original patch "is quite noisy and this adds character" — noise/grit treated as a feature, not a flaw to remove.
- **Measurable target**: beating rate tunable to song BPM via cents value (example given: ±61 cents for their tempo).

---

## 3. Reese with fine-tune ±0.3 semitones, 650Hz cutoff (Native Instruments blog)

- **Source**: https://blog.native-instruments.com/reese-bass/ — Native Instruments editorial (instrument manufacturer, house sound-design writers).
- **Oscillators**: Both oscillators use a "Sin-Tri-Saw-SQ" morphing wavetable. Detune: **+0.300 / -0.300 semitones** (≈ ±30 cents). 2 oscillators, monophonic voicing.
- **Filter**: Low-pass, cutoff **~650 Hz**, resonance **~14%**.
- **Effects**: optional Guitar Rig 7 Pro "Rock Seeker" overdrive preset; optional notch filter with automated cutoff sweep for movement.
- **Envelope**: not specified.
- **Counterintuitive quote**: "the rumbling movement of these harmonics give the sound a sinister feel" — richness/harmonic density framed as producing menace, not warmth, despite harmonic content technically sitting above the fundamental.

---

## 4. DnB Reese full chain, asymmetric detune (Noise Masters, "How to Make Reese Basses for Drum and Bass")

- **Source**: https://noisemasters.eu/blogs/dnb-guides/how-to-make-reese-basses-for-drum-and-bass-a-step-by-step-guide — Noise Masters (sample-pack house, DnB-focused).
- **Oscillators**: 2x saw, one octave down. **Asymmetric** detune: Osc A **-30 cents**, Osc B **+50 cents** (not symmetric ± around zero — a rarer, deliberately lopsided spread).
- **Filter**: low-pass with LFO modulation; **LFO rate "slow, ~4 bars"** — much slower than typical wobble rates, used for a Reese-appropriate slow evolving swell rather than a rhythmic wobble.
- **Full effects chain, in order**:
  1. Low-pass filter with slow LFO
  2. EQ: boost a resonant peak **100–200 Hz**
  3. Tube distortion: **Drive 100%, Mix 100%**
  4. Phaser (for width)
  5. Chorus, high-pass filtered
  6. Multiband compression (to boost/restore high end lost to distortion)
  7. Short-decay reverb
- **Layering**: separate sub layer = sine wave one octave below the main patch, routed direct-out (not through the distortion chain); bright white noise layer blended at **25% volume**.
- **Counterintuitive quote**: "A small detune (e.g., ±6 cents) creates slow phasing" while larger detunings create faster/more aggressive movement — stated as counter to the assumption that small detune = subtle in every dimension, not just amplitude of effect but rate.

---

## 5. "Fred Again–inspired" Reese bassline, Twin 3 (Attack Magazine, Synth Secrets)

- **Source**: https://www.attackmagazine.com/technique/synth-secrets/fred-again-inspired-reese-basslines-with-twin-3/ — Attack Magazine Synth Secrets column (FabFilter Twin 3 walkthrough).
- **This is the single most numerically complete recipe found.**
- **Oscillators**:
  - Osc 1: sine, **-1 octave**, 0.00 dB (pure sub foundation)
  - Osc 2: sawtooth, **-0.070 semitones** (≈ -7 cents), **-8.00 dB**
  - Osc 3: sawtooth, **+0.070 semitones** (≈ +7 cents), **-8.00 dB**
  - Osc 4: sawtooth, 0 octaves, **sync amount 4.00**, **-12 dB** (adds metallic sync texture on top)
- **Voicing**: Mono, **64-voice unison, 10% spread**. Output trimmed to **-18 dB** after chorus. High-Quality mode on.
- **Filter**: two filters in **parallel** —
  - Filter 1: low-pass, **600 Hz** cutoff, "Metal" filter type
  - Filter 2: low shelf, **30 Hz**, "Clean" filter type
  - Filter freq offset 3 octaves, filter peak offset 40%.
- **Modulation**: XLFO1 synced **1/16**; Envelope Generator 2 — **delay 1714 ms, attack 3428 ms, sustain 0 dB, release 1 ms** (an unusually long attack/delay pair used for slow morphing rather than per-note triggering).
- **Effects chain, in order**:
  1. Chorus: 60% amount, double mode, 0.005 Hz rate, 100% depth, 30 ms delay
  2. Distortion (FabFilter Saturn 2), **multiband split at 400 Hz**:
     - Low band: Warm Tube, **30% drive**, +1 dB bass, +3 dB level
     - High band: Warm Tape, **65% drive**, +1 dB level, -3 dB output
  3. EQ (FabFilter Pro-Q 3): mid-side processing for low-end management
  4. Compression (FabFilter Pro-C 2): "Bass Control mk1" preset, **+25 dB wet gain**
- **Counterintuitive quote**: "This will be a heavily distorted bass, so gain-staging from the very beginning is essential" — the article stresses setting compression/headroom (-14 dB stated gain-stage target) *before* stacking saturation, i.e. gain-stage first, distort second, not the reverse.
- **Measurable target**: multiband distortion split explicitly at 400 Hz to keep low band cleaner than high band (30% vs 65% drive).

---

## 6. Techno Reese Bass, Massive X (Attack Magazine, Synth Secrets)

- **Source**: https://www.attackmagazine.com/technique/synth-secrets/techno-reese-bass-with-massive-x/ — Attack Magazine Synth Secrets.
- **Oscillators**: Osc 1 = "Bumb SQ" wavetable, Bend mode, pitch **+0.100** (semitones); Osc 2 = "FM Math" wavetable, pitch **-0.100**. Master pitch **-24.000** (-2 octaves).
- **Unison**: **6 voices**, increased stereo width, fractional spread. Glide enabled, "turned up a little to taste." Mono voicing.
- **Filter**: "Blue Monark" model, cutoff reduced, resonance pushed up, envelope-controlled.
- **Modulation**: Envelope 2 (decay pushed up, mono, modulates wavetable position on both oscillators + filter cutoff); Envelope 3 (pitch, **24.00 amount**, decay rolled down for punchy attack); LFO1 (saw shape, minimal rate, unipolar, modulates wavetable position + cutoff).
- **Effects chain**: Insert A = Distortion (Rectify mode, mix reduced); Insert B = Folder (Wrap mode, mix + drive rolled down); Master bus = Quad Chorus, Stereo Expander, EQ with modulated mid-band resonance; DAW-level = sidechain compression, EQ Eight **80 Hz rolloff**, Drum Buss, reverb.
- **Counterintuitive note**: the article restates the received wisdom "the classic 'Reese' sound is simply two sine waves detuned" while the actual patch it builds uses two complex wavetables (Bumb SQ / FM Math), not sine waves — evidence that "classic Reese = sines" is a commonly repeated but loosely-applied definition even within a single article.

---

## 7. Dubstep sub + wobble/growl layer, Logic ES2 (Sound on Sound, "Dubstep Secrets")

- **Source**: https://www.soundonsound.com/techniques/dubstep-secrets — Sound on Sound (UK trade magazine, senior technical-editorial staff).
- **Sub-bass layer**: Oscillators 1 & 2 blended, "mainly oscillator 1 with a bit of oscillator 2." Osc 1 driven with FM ("three o'clock" for a pronounced FM effect); Osc 2 modulator = "bell5" digiwave. Coarse pitch: Osc 2 **-12**, Osc 1 **-24** (semitones). Playback range **C2–C3**.
- **Wobble/growl layer**: Filters in series, Filter 2 = **24 dB low-pass**; LFO 2 modulates Cutoff 2 at maximum intensity; **LFO rate 1/8-note**, tempo-synced (just under halfway on the rate slider); amp **release 570 ms** "so that the notes ring on for a while"; monophonic.
- **Effects chain, in order**:
  1. ES2-internal soft distortion (mild) + phaser, sine level raised to "one o'clock"
  2. Parallel insert: Pedalboard "Double Dragon" distortion + Vibe modulation (via splitter/mixer, run in parallel with the dry signal)
  3. Stereo delay, short times, "to thicken a bass part without pushing it to the back"
  4. Bitcrusher, described as adding "aggression and top end, courtesy of some judicious clipping"
  5. Channel EQ: roll off bass, boost top end
- **No exact Hz/dB/ratio values given** for the EQ or compression stages — the article is patch-parameter-driven (ES2 dial positions) rather than Hz-labeled.

---

## 8. LFO wobble bass, precise ADSR (MusicRadar, "How to build an LFO wobble bass")

- **Source**: https://www.musicradar.com/how-to/lfo-wobble-bass — MusicRadar staff tutorial.
- **Oscillators**: Osc 1 = "2Pulse" waveform, PD (phase distortion) pot at **25**. Osc 2 = Square (primary) + 2Pulse (secondary), PD pot at **52**, tuned **+19 semitones**, volume reduced to **25**.
- **Filter**: type **LP6** (6-pole low-pass). Cutoff **45** (dial units), resonance **17**.
- **LFO**: rate **1/8 triplet**, centered at 12 o'clock; waveform **triangle**; onset delay **48** (dial units) — "delay" is explicitly called out as necessary "for the classic dubstep effect" (i.e. wobble should ramp in, not start instantly).
- **Filter cutoff modulation depth**: LFO **40**, Envelope 2 **130** (env contributes more depth than the LFO itself).
- **Envelope 2** (snappy mode on): Attack **0**, Delay **34**, Sustain **0**, Release **17**.
- **Effects**: overdrive/distortion for brightness; heavy compression — verbatim: "compress to impress," justified because "many dubstep examples [are] very high in the mix of a track."
- **Counterintuitive quote**: "despite the sense of analogue that we often consider part of distortion, the brightness will have the opposite effect in the mix, producing a sharper tone" — i.e. distortion here is used to brighten/sharpen, not to warm/soften, contradicting the usual "distortion = warmth" association.

---

## 9. Liquid dubstep bass, dual-filter parallel (Crossfadr, "Advanced Liquid Dubstep Bass Tutorial")

- **Source**: https://crossfadr.com/2013/05/29/advanced-liquid-dubstep-bass-tutorial/ — Crossfadr (tutorial/sample-pack site; NI Massive-based walkthrough, .NMSV patch provided).
- **Character**: smoother, more melodic "liquid" dubstep bass vs. aggressive growl.
- **Oscillator/filter routing**: "Escalation II" oscillator in Massive. **Filter 1 = highpass 4, Filter 2 = lowpass 2, run in parallel with equal signal levels** — the defining technique, stated verbatim: "using both the lowpass and highpass filters at the same time... a 'liquid' sound is produced."
- **Modulation**: multiple LFOs, phase modulation recommended on the primary oscillator; approach described as "trial-and-error, using the ear as a guide" (no fixed rate given).
- **Effects chain**: (1) optional flanger, suggested as "flanger negative mono"; (2) multiband compression "for boldness"; (3) optional distortion for aggression; (4) EQ cutting above **9 kHz**.
- **Gap**: no cutoff Hz, resonance, envelope ms, or compression ratio values given — patch file is the source of truth, prose is conceptual only.

---

## 10. 808 with multiband saturation, Serum + Saturn 2 (Attack Magazine, "808 Bass with Saturation")

- **Source**: https://www.attackmagazine.com/technique/synth-secrets/808-bass-with-saturation/ — Attack Magazine Synth Secrets.
- **Oscillator**: Serum "Analog_BD_Sin" wavetable, mono with portamento, **glide time ~300 ms**. Detune/Blend/Rand all fully counterclockwise (zero).
- **Envelopes**: Amp envelope — slow attack ("to prevent clicks"), longer release for a smooth tail (exact ms not given). Pitch envelope modulates OSC A semitone control, producing the downward pitch-sweep characteristic of an 808 hit (exact ms not given, but shape is explicitly a decaying pitch drop).
- **In-synth processing**: filter reduces highs to emphasize rumble; FAT/DRIVE dials tuned to taste; internal distortion = tube type, with an internal high-pass filter specifically to preserve sub frequencies from being distorted away. Wavetable position **~209**.
- **External chain**:
  1. FabFilter Saturn (multiband saturation), **split point 123 Hz**, both bands set to "Warm Tape," **lower band drive significantly reduced** to protect the sub.
  2. UAV Neve 31102 EQ, "fairly extreme settings" to boost highs (no exact dB given).
- **Counterintuitive quote**: "Taking out some of the high frequencies will focus it more towards the rumble" — the article's overall move is to *first* strip highs to concentrate energy in the rumble, *then* deliberately reintroduce distortion + EQ boost to restore commercial-mix high-frequency presence. Cut-then-re-add, not just "add treble."
- **Measurable target**: multiband split explicitly placed at **123 Hz** to separate "sub that must stay clean" from "everything above that gets Warm Tape saturation."

---

## 11. 808-style bass for jungle/trap/footwork (Attack Magazine)

- **Source**: https://www.attackmagazine.com/technique/tutorials/creating-808-style-basslines-for-jungle-trap-and-footwork/ — Attack Magazine tutorials.
- **Glide**: "halfway" glide setting for trap-style portamento between notes (no ms given).
- **Distortion chain, described in stages**: Drive "about halfway until it distorts nicely" → Shaper (described as acting "like a wavefolder") → LoFi (bit-crushes the signal) → Dirty Tape and Tape Drive for further saturation. This is a 4-stage sequential distortion chain, order as listed.
- **EQ**: for trap/footwork specifically, "use EQ Eight to carve out the bass below 200 Hz" — an explicit **200 Hz** carve target to prevent sub-vs-bass-body conflicts.
- **Compression**: u-he Presswerk "to help solidify the subs" (no ratio/attack/release given).
- **Counterintuitive quote**: "Sometimes you just have to say screw it and do what you like" — given in the context of adding reverb/width processing directly to a sub-bass part, i.e. explicitly breaking the usual "keep subs dry and mono" rule when it serves the track.

---

## 12. 808 sound design — most numerically complete 808 recipe (unison.audio, "Best 808 Sound Design Tricks, Techniques & Secrets")

- **Source**: https://unison.audio/808-sound-design/ — Unison Audio (sample-pack/tutorial publisher).
- **Oscillator/tuning**: sine wave for sub, **40–60 Hz** fundamental range; duplicate an octave up with **-7 cents** detune "for analog movement." Key-tune fine adjustment **±30–50 cents**; automate pitch to follow the chord progression.
- **Glide**: **80–120 ms**, achieved by overlapping MIDI notes to trigger the glide.
- **Amp envelope**:
  - Tight/fast tracks: attack **0–5 ms**, decay **550–650 ms**, sustain 0, release **400 ms**
  - Slower tracks: attack **5 ms**, decay **550–650 ms**, sustain 0, release **750–900 ms**
- **Pitch envelope**: drop **24 semitones over 40–60 ms** for the classic 808 pitch-dive; use an **exponential** curve rather than linear "for natural feel."
- **Distortion staging**: start with soft saturation, **4–6 dB input gain**; for a heavier tone push to **8–10 dB then pull back 1–2 dB**. Post-distortion: cut above **6 kHz**; if muddy, dip **300–500 Hz by -1.5 dB**.
- **EQ**:
  - High-pass **20–22 Hz at 24 dB/oct**
  - Notch vs. kick clash: **-3 dB, Q 2.8**, placed at wherever the kick lands
  - Mid-body boost: **+1.5 dB around 130–160 Hz**, wide Q
  - Harmonic texture boost: **+2 dB at 850–1200 Hz**
  - Dynamic EQ for harsh transients: **3.2–5.5 kHz**, threshold -20 dB, ratio 2:1, attack 10 ms, release 80 ms
- **Compression**: ratio **2:1 or 3:1**, threshold **-24 dB**, attack **25 ms** (35–40 ms for a softer transient), release **90–120 ms**.
- **Sidechain to kick**: ratio **4:1**, attack **5–10 ms**, release **70–110 ms**.
- **Multiband compression** (mid-body only): split **200–400 Hz**, ratio 2:1, gain reduction capped below **3 dB**.
- **Layer structure**:
  - Sub-bass layer **20–80 Hz**: pure sine, mono, left untouched by processing
  - Mid-body layer **80–300 Hz**: sub duplicated one octave up, high-passed at **200 Hz**, slight distortion added
  - Click/transient layer **1–5 kHz**: a filtered rimshot or stick hit, kept **under 50 ms** duration, high-passed at **800–1000 Hz**, boosted **+3–4 dB at 2.5–3.2 kHz**
- **Mono rule (explicit)**: **mono below 150–200 Hz minimum**; stereo imaging reserved for content above **400 Hz**.
- **Counterintuitive quotes**: "Sometimes cutting a very small amount of low end at the precise frequency can actually enhance your low end"; "The better it sounds on bad or cheap speakers, the better off you'll be on a good system (usually)" — mix-translation framed as more important than mix-on-good-speakers.

---

## 13. Trap 808 tuning/glide performance workflow (Production Music Live)

- **Source**: https://www.productionmusiclive.com/blogs/news/trap-beat-guide-bass-essential-tips-for-making-808-patterns — Production Music Live (trap-focused tutorial site).
- **Tuning**: tune 808 sample to **C3** using Ableton Simpler's transposition; play "the root of the chord, often the first note of the scale"; verify with Ableton's Tuner effect.
- **Glide**: two techniques — (a) enable glide in Simpler's dropdown, choose a glide time, then overlap notes in the clip to trigger it; (b) draw pitch-bend automation in the Envelopes section as an alternative slide method.
- **Sample warping**: enable Complex mode in Simpler specifically for 808s "to prevent cutting off at higher pitches" (i.e. Complex-mode time-stretch avoids truncation artifacts when pitching an 808 sample up).
- **Pitch envelope**: "a few semitones up and a short decay" applied for tonal enhancement (exact values not given).
- **Rhythm placement (explicit MIDI rule)**: "the red bass notes play each time the kick hits" — the author's workflow is literally to copy the kick-drum MIDI pattern onto the bass track, then modify pitch, rather than composing the bassline independently.
- **Counterintuitive note**: prioritizing rhythmic cohesion (bass = kick pattern, repitched) over independent melodic bassline composition — a compositional shortcut stated as a norm, not just a beginner crutch.

---

## 14. Reese layer-split synthesis with named crossover points (The Dystopian Collective, "How to Create Reese Bass: The Complete Guide")

- **Source**: https://www.thedystopiancollective.com/tutorials-2/how-to-create-reese-bass-the-complete-guide-to-the-iconic-drum-amp-bass-sound — The Dystopian Collective (DnB-focused tutorial site). This is the source with the most explicit sub/mid/top layer-split language.
- **Layer architecture**:
  - **Sub-bass layer**: simple sine, tuned to track key, **completely mono**, **crossover point 80–120 Hz**
  - **Mid-bass/Reese layer**: sawtooth oscillators, **high-pass filtered at the crossover frequency**, detune range **5–50 cents** depending on desired aggression
  - **Top layer**: mid/high frequencies for presence; stereo width applied here specifically, "not below 100–150 Hz"
- **Oscillators**: classic approach = sawtooth pair detuned **5–10 cents** (subtle); modern neurofunk pushes **25–50 cents** for "rapid beating and aggressive character." Thickening option: unison per oscillator, **4–8 voices**.
- **Filter**: **24 dB/octave low-pass**; cutoff **1–3 kHz** initial setting; resonance **20–40%**, described as adding definition "without a honky, whistling sound." Modulation: slow LFO (1/4 to 1 bar) for evolving Reese movement, or faster 1/8–1/16 for a modern wobble variant.
- **Saturation strategy by band** (explicitly multiband, via FabFilter Saturn 2 or iZotope Trash 2): sub-bass = minimal/gentle warm saturation; mid-bass (**100–500 Hz**) = moderate saturation; mid-range (**500 Hz–3 kHz**) = heavier saturation; highs (**3 kHz+**) = selective/light.
- **Compression**: attack **10–30 ms** (preserve transients), release **50–150 ms** (tempo-dependent), gain reduction **3–6 dB** typical.
- **Sidechain**: attack **0–5 ms**, release **50–100 ms**, described as producing "transparent ducking."
- **Explicit frequency-preservation rules**:
  - Keep everything **mono below 100–150 Hz** for club systems
  - High-pass to remove content below **80–120 Hz** on non-sub layers
  - Cut buildup around **200–400 Hz**
  - Boost presence at **1–3 kHz** for cross-system audibility
- **Counterintuitive quotes**: "More detuning creates faster beating, less detuning creates slower, more subtle movement"; "Too much distortion creates harsh, unpleasant sounds" (more saturation is not strictly better); Reese demands "constant evolution" via modulation or it becomes "boring quickly" — i.e. a static Reese patch is considered a design failure, not just a stylistic choice.

---

## 15. Reese detune-vs-pitch physics note (FutureProof Music School)

- **Source**: https://futureproofmusicschool.com/blog/reese-bass-sound-design-everything-you-need-to-know — FutureProof Music School (production-education site).
- **Concrete content is thin** (no cents/Hz/ms values), but it contains a physically precise mechanism explanation worth keeping as a cross-check on recipe #2's claim: **verbatim** — "The amount of detune affects how fast it beats, which is also why, when you go up the keyboard, it beats faster: it's oscillating faster, so it detunes faster." This corroborates MusicRadar's (#2) observation that beat rate is a function of both cents *and* played pitch, not cents alone — useful for an agent deciding whether to compensate detune amount by register.
- **Performance note**: recommends turning phase randomization *down* so both oscillators "start at the exact same point" each note — i.e. phase-reset/reset-on-trigger is treated as necessary for a consistent, reproducible Reese attack, not left to free-running phase.

---

## Cross-source consensus

1. **Reese = 2 (or more) detuned oscillators, saw or sine, run mono, filtered low-pass.** Every Reese source (1,2,3,4,5,6,14,15) agrees on this base architecture regardless of synth used.
2. **Detune amount is a rate control, not just a timbre control**: more cents = faster beating/wobble; this is stated independently by #2, #4, #14, #15 and is the single most repeated mechanism claim in the corpus. #15 adds the register-dependence corollary (higher notes beat faster at a fixed cents value).
3. **Sub bass is near-universally split out as its own mono sine layer**, distinct from the (mid-range) Reese/growl layer, with a crossover typically landing somewhere in **80–150 Hz** (#2, #4, #10, #12, #14). No source puts the sub/mid crossover above 200 Hz.
4. **Mono-below-X-Hz is treated as a hard rule for all bass**, not a suggestion, appearing independently for Reese (#14: below 100–150 Hz), 808 (#12: below 150–200 Hz), and implicitly in #2 and #4's separate-sub-layer treatment. Stereo/width processing is consistently reserved for content **above ~400 Hz**.
5. **Distortion/saturation is almost always multiband**, splitting a cleaner/less-driven low band from a more heavily driven mid/high band, so the sub stays intact while the body gets harmonics: #5 (400 Hz split, 30%/65% drive), #10 (123 Hz split), #14 (banded saturation by 100–500 Hz / 500 Hz–3 kHz / 3 kHz+).
6. **808 design consistently uses**: sine oscillator, a downward pitch envelope at note-on (the "dive"/"thump"), glide/portamento for slides between notes, and post-distortion EQ to carve space against the kick (#10 notch, #11 200 Hz carve, #12 explicit -3 dB/Q 2.8 kick notch).
7. **Sidechain compression against the kick** is standard for both Reese/growl basses and 808s, generally fast attack (0–10 ms) and a release in the 50–120 ms range (#12, #14).

## Contradictions

1. **Detune amount for a "classic" Reese has no agreed number.** Sources variously state: ±27 cents (#1, sine), ±30 cents (#3), ±55–61 cents (#2, saw), asymmetric -30/+50 cents (#4), ±7 cents (#5, on top of a separate sine sub), "5–10 cents subtle / 25–50 cents neurofunk" (#14). These aren't different genres necessarily — #2 and #14 both claim to describe DnB/jungle Reese but disagree by roughly 5x on cents.
2. **Waveform identity of "the classic Reese" is inconsistently claimed.** #6 (Attack Magazine) states outright "the classic 'Reese' sound is simply two sine waves detuned" while building a patch from two complex wavetables in the same article; #2 and #4 both use saw waves and call that "classic"; #1 explicitly uses sine. There is no cross-source agreement on whether saw or sine is "the" original waveform — likely because the real Kevin Saunderson original (Casio CZ-5000 phase-distortion synth, per Splice's history piece) doesn't map cleanly onto either modern category, and writers project their preferred DAW's default onto "classic."
3. **Filter cutoff for Reese ranges an order of magnitude** across sources that all claim to be describing similar dark/DnB-style Reese: 650 Hz (#3), 600 Hz (#5), 1–3 kHz (#14), ~4 kHz (#2). Whether the cutoff should be static (#2, #3) or continuously LFO-modulated (#4, #6, #14's "modern" variant) is also unresolved — some treat filter movement as optional/genre-dependent, others as core to the sound.
4. **Wobble-bass oscillator waveform choice is unresolved.** #8 uses "2Pulse" + square with a **+19 semitone** offset on the second oscillator (an unusually large interval, not a detune-in-cents relationship at all); other general guidance (search-summary level, not a single deep source) suggests plain saw+square; #9's liquid-dubstep approach is preset-based ("Escalation II") with no waveform specified. No two deep sources describe the same oscillator pairing for wobble.
5. **808 glide time varies by roughly 3–4x** depending on source and implied genre-feel: 80–120 ms (#12, "smooth slides"), ~300 ms (#10, Serum patch), "halfway on the dial"/unspecified ms (#11, #13). No source reconciles this — likely tempo- and taste-dependent, but none say so explicitly; they present their number as the recipe.
6. **Whether to keep sub content dry/mono is not universal even within the same genre cluster.** #11 (Attack Magazine, jungle/trap/footwork 808) explicitly breaks the mono-sub rule: "Sometimes you just have to say screw it and do what you like," describing adding reverb/width directly to a sub part — directly contradicting #12's and #14's stated hard mono-below-150–200 Hz rules.
7. **Distortion's perceptual effect is framed in opposite directions.** #8 states distortion here produces brightness/sharpness "despite the sense of analogue that we often consider part of distortion" (i.e. distortion = brighter, counter to the "distortion = warm/analog" association), while #4 and #10 use distortion in the more conventional "adds warmth/grit/rumble" sense, and #10 explicitly cuts highs *before* distortion specifically to avoid excess brightness. Distortion's role (warming vs. brightening) is not treated consistently across sources.

